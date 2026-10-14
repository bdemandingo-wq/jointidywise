import { createStripeClient } from "../_shared/stripe-client.ts";
// billing-backfill — replays PLATFORM Stripe history into the owned revenue ledger.
// Reads Stripe (read-only restricted key) and writes ONLY:
//   public.billing_events, public.billing_subscription_periods, public.billing_backfill_jobs
//
// HARD RULES (see docs/superpowers/prompts/2026-07-31-billing-ledger-task2-backfill.md):
//  - billing_events is append-only and service_role is NOT exempt -> ON CONFLICT DO NOTHING only.
//  - billing_subscription_periods may be upserted with DO UPDATE.
//  - PLATFORM Stripe only. Never touch an org's Connect account.
//  - Money is integer cents from Stripe, stored as-is. No division, no rounding, no floats.
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-secret",
};

type Resource =
  | "subscriptions"
  | "invoices"
  | "charges"
  | "refunds"
  | "disputes"
  | "checkout_sessions";

const RESOURCES: Resource[] = [
  "subscriptions",
  "invoices",
  "charges",
  "refunds",
  "disputes",
  "checkout_sessions",
];

const log = (step: string, details?: unknown) =>
  console.log(`[BILLING-BACKFILL] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// ---------------------------------------------------------------- price map
function priceStreamMap(): Record<string, "plan" | "lifetime" | "ad_management"> {
  const map: Record<string, "plan" | "lifetime" | "ad_management"> = {};
  const add = (env: string, stream: "plan" | "lifetime" | "ad_management") => {
    const v = Deno.env.get(env);
    if (v) map[v] = stream;
  };
  add("STRIPE_BASIC_MONTHLY_PRICE_ID", "plan");
  add("STRIPE_BASIC_YEARLY_PRICE_ID", "plan");
  add("STRIPE_PRO_MONTHLY_PRICE_ID", "plan");
  add("STRIPE_PRO_YEARLY_PRICE_ID", "plan");
  add("STRIPE_CUSTOM_MONTHLY_PRICE_ID", "plan");
  add("STRIPE_CUSTOM_YEARLY_PRICE_ID", "plan");
  add("STRIPE_LIFETIME_PRICE_ID", "lifetime");
  add("STRIPE_AD_FACEBOOK_PRICE_ID", "ad_management");
  add("STRIPE_AD_GOOGLE_LSA_PRICE_ID", "ad_management");
  add("STRIPE_AD_GOOGLE_SEARCH_PRICE_ID", "ad_management");
  return map;
}

// ------------------------------------------------------------- identity map
const emailToOrg = new Map<string, { id: string | null; name: string | null }>();
const customerEmailCache = new Map<string, string | null>();
let adSubIds: Set<string> | null = null;

async function loadAdSubscriptionIds(): Promise<Set<string>> {
  if (adSubIds) return adSubIds;
  const ids = new Set<string>();
  const { data, error } = await admin
    .from("ad_management_subscriptions")
    .select("stripe_subscription_id")
    .not("stripe_subscription_id", "is", null);
  if (error) throw new Error(`ad_management_subscriptions read failed: ${error.message}`);
  for (const r of data ?? []) if (r.stripe_subscription_id) ids.add(r.stripe_subscription_id);
  adSubIds = ids;
  return ids;
}

async function customerEmail(
  stripe: Stripe,
  customer: string | { id?: string; email?: string | null } | null | undefined,
): Promise<string | null> {
  if (!customer) return null;
  if (typeof customer === "object") {
    if (customer.email) return customer.email.toLowerCase();
    if (!customer.id) return null;
    customer = customer.id;
  }
  const id = customer as string;
  if (customerEmailCache.has(id)) return customerEmailCache.get(id)!;
  let email: string | null = null;
  try {
    const c = await stripe.customers.retrieve(id);
    email = (c as any)?.deleted ? null : ((c as any)?.email ?? null);
  } catch (_e) {
    email = null;
  }
  email = email ? email.toLowerCase() : null;
  customerEmailCache.set(id, email);
  return email;
}

async function resolveOrg(email: string | null) {
  if (!email) return { id: null as string | null, name: null as string | null };
  if (emailToOrg.has(email)) return emailToOrg.get(email)!;
  let result: { id: string | null; name: string | null } = { id: null, name: null };
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (profile?.id) {
    const { data: membership } = await admin
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", profile.id)
      .limit(1)
      .maybeSingle();
    if (membership?.organization_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("id, name")
        .eq("id", membership.organization_id)
        .maybeSingle();
      result = { id: org?.id ?? membership.organization_id, name: org?.name ?? null };
    }
  }
  emailToOrg.set(email, result);
  return result;
}

// Metadata-first attribution: a Stripe customer on a cleaning job is the
// homeowner, not the tenant. raw.metadata.organization_id is authoritative.
const idToOrg = new Map<string, { id: string | null; name: string | null }>();
async function resolveOrgById(orgId: string | null | undefined) {
  if (!orgId) return null;
  if (idToOrg.has(orgId)) return idToOrg.get(orgId)!;
  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  const result = { id: org?.id ?? orgId, name: org?.name ?? null };
  idToOrg.set(orgId, result);
  return result;
}

// Stream classification from object metadata. Applies to raw charge/refund/
// dispute objects, which carry no price id of their own.
function streamFromMetadata(md: Record<string, unknown> | null | undefined): string | null {
  if (!md) return null;
  const m = md as Record<string, string | undefined>;
  const purpose = (m.purpose ?? m.type ?? "").toLowerCase();
  if (m.booking_id || m.invoice_id || purpose === "booking" || purpose === "additional_charge" || purpose === "tip") {
    return "merchant_cleaning";
  }
  if (purpose.includes("ai_credit") || purpose === "credits" || m.credits) return "ai_credits";
  if (purpose.includes("lifetime")) return "lifetime";
  if (purpose.includes("ad_management") || m.ad_platform) return "ad_management";
  return null;
}


// ------------------------------------------------------------------ writers
type EventRow = Record<string, unknown>;

async function insertEvents(rows: EventRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  // APPEND-ONLY: DO NOTHING, never DO UPDATE (service_role is not trigger-exempt).
  const { data, error } = await admin
    .from("billing_events")
    .upsert(rows, { onConflict: "stripe_object_id,event_type", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`billing_events insert failed: ${error.message}`);
  return data?.length ?? 0;
}

async function upsertPeriods(rows: EventRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await admin
    .from("billing_subscription_periods")
    .upsert(rows, { onConflict: "stripe_subscription_id,effective_from" })
    .select("id");
  if (error) throw new Error(`billing_subscription_periods upsert failed: ${error.message}`);
  return data?.length ?? 0;
}

const iso = (unix: number | null | undefined, fallback?: number) =>
  new Date(((unix ?? fallback ?? Math.floor(Date.now() / 1000)) as number) * 1000).toISOString();

// -------------------------------------------------------------- page mapper
async function processPage(
  stripe: Stripe,
  resource: Resource,
  objects: any[],
  write: boolean,
): Promise<number> {
  const streams = priceStreamMap();
  const events: EventRow[] = [];
  const periods: EventRow[] = [];

  for (const obj of objects) {
    const email = await customerEmail(stripe, obj.customer);
    const mdOrgId = (obj.metadata?.organization_id ?? obj.metadata?.org_id ?? null) as string | null;
    // metadata wins; the email lookup is only a fallback when metadata is absent
    const org = (await resolveOrgById(mdOrgId)) ?? (await resolveOrg(email));
    const identity = {
      organization_id: org.id,
      organization_name: org.name,
      customer_email: email,
      stripe_customer_id: typeof obj.customer === "string" ? obj.customer : obj.customer?.id ?? null,
    };


    if (resource === "subscriptions") {
      const item = obj.items?.data?.[0];
      const price = item?.price;
      const adIds = await loadAdSubscriptionIds();
      let stream: string = streams[price?.id] ?? "plan";
      let description: string | null = null;
      if (adIds.has(obj.id)) {
        stream = "ad_management";
      } else if (!streams[price?.id]) {
        description = `unmatched_price:${price?.id ?? "none"}`;
      }
      const coupon = obj.discount?.coupon;
      const rawReason = obj.cancellation_details?.reason ?? null;
      const cancellation_reason =
        rawReason === "cancellation_requested"
          ? "voluntary"
          : rawReason === "payment_failed"
          ? "involuntary"
          : null;
      periods.push({
        ...identity,
        stripe_subscription_id: obj.id,
        stripe_price_id: price?.id ?? null,
        revenue_stream: stream,
        plan_label: description ?? price?.nickname ?? price?.product?.name ?? null,
        unit_amount_cents: price?.unit_amount ?? 0,
        quantity: item?.quantity ?? 1,
        currency: (obj.currency ?? price?.currency ?? "usd").toLowerCase(),
        billing_interval: price?.recurring?.interval ?? "month",
        interval_count: price?.recurring?.interval_count ?? 1,
        discount_percent: coupon?.percent_off ?? null,
        discount_amount_cents: coupon?.amount_off ?? null,
        status: obj.status,
        effective_from: iso(obj.start_date ?? obj.current_period_start ?? obj.created),
        effective_to: obj.ended_at ? iso(obj.ended_at) : null,
        cancellation_reason,
        cancellation_detail:
          obj.cancellation_details?.comment ??
          obj.cancellation_details?.feedback ??
          rawReason ??
          null,
        raw: obj,
      });
      continue;
    }

    if (resource === "invoices") {
      if (obj.status === "draft") continue;
      const priceId = obj.lines?.data?.[0]?.price?.id ?? obj.lines?.data?.[0]?.pricing?.price_details?.price;
      const stream = streams[priceId] ?? "plan";
      const paid = obj.status === "paid";
      const failed = obj.status === "uncollectible" || (obj.attempt_count ?? 0) > 0 && !paid;
      if (!paid && !failed) continue;
      const isProration = (obj.lines?.data ?? []).some((l: any) => l.proration === true);
      events.push({
        ...identity,
        event_type: paid ? "invoice.paid" : "invoice.payment_failed",
        revenue_stream: stream,
        stripe_object_id: obj.id,
        stripe_invoice_id: obj.id,
        stripe_subscription_id:
          typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id ?? null,
        occurred_at: iso(obj.status_transitions?.paid_at, obj.created),
        amount_cents: paid ? obj.amount_paid ?? 0 : obj.amount_due ?? 0,
        currency: (obj.currency ?? "usd").toLowerCase(),
        counts_as_cash: paid,
        is_proration: isProration,
        description: streams[priceId] ? null : priceId ? `unmatched_price:${priceId}` : null,
        raw: obj,
      });
      continue;
    }

    if (resource === "charges") {
      const hasInvoice = Boolean(obj.invoice);
      const bt = typeof obj.balance_transaction === "object" ? obj.balance_transaction : null;
      events.push({
        ...identity,
        event_type: obj.status === "succeeded" ? "charge.succeeded" : "charge.failed",
        revenue_stream: streamFromMetadata(obj.metadata) ?? "plan",

        stripe_object_id: obj.id,
        stripe_charge_id: obj.id,
        stripe_invoice_id: typeof obj.invoice === "string" ? obj.invoice : obj.invoice?.id ?? null,
        stripe_payment_intent_id:
          typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id ?? null,
        occurred_at: iso(obj.created),
        amount_cents: obj.amount ?? 0,
        currency: (obj.currency ?? "usd").toLowerCase(),
        fee_cents: bt?.fee ?? null,
        net_cents: bt?.net ?? null,
        counts_as_cash: obj.status === "succeeded" && !hasInvoice,
        is_proration: false,
        description: hasInvoice ? "invoiced_charge_not_counted_as_cash" : null,
        raw: obj,
      });
      continue;
    }

    if (resource === "refunds") {
      events.push({
        ...identity,
        event_type: "charge.refunded",
        revenue_stream: streamFromMetadata(obj.metadata) ?? "plan",

        stripe_object_id: obj.id,
        stripe_charge_id: typeof obj.charge === "string" ? obj.charge : obj.charge?.id ?? null,
        stripe_payment_intent_id:
          typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id ?? null,
        occurred_at: iso(obj.created),
        amount_cents: -(obj.amount ?? 0),
        currency: (obj.currency ?? "usd").toLowerCase(),
        counts_as_cash: true,
        is_proration: false,
        raw: obj,
      });
      continue;
    }

    if (resource === "disputes") {
      events.push({
        ...identity,
        event_type: "charge.dispute",
        revenue_stream: streamFromMetadata(obj.metadata) ?? "plan",
        stripe_object_id: obj.id,
        stripe_charge_id: typeof obj.charge === "string" ? obj.charge : obj.charge?.id ?? null,
        occurred_at: iso(obj.created),
        amount_cents: -(obj.amount ?? 0),
        currency: (obj.currency ?? "usd").toLowerCase(),
        counts_as_cash: true,
        is_proration: false,
        description: obj.reason ?? null,
        raw: obj,
      });
      continue;
    }

    if (resource === "checkout_sessions") {
      if (obj.payment_status !== "paid") continue;
      const purpose = obj.metadata?.purpose ?? "";
      const lifetimePrice = Deno.env.get("STRIPE_LIFETIME_PRICE_ID");
      const isLifetime =
        purpose === "lifetime" ||
        purpose === "lifetime_access" ||
        obj.metadata?.type === "lifetime" ||
        (lifetimePrice && JSON.stringify(obj.metadata ?? {}).includes(lifetimePrice));
      if (purpose === "ai_credits_topup") {
        events.push({
          ...identity,
          event_type: "credits.purchased",
          revenue_stream: "ai_credits",
          stripe_object_id: obj.id,
          stripe_payment_intent_id:
            typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id ?? null,
          occurred_at: iso(obj.created),
          amount_cents: obj.amount_total ?? 0,
          currency: (obj.currency ?? "usd").toLowerCase(),
          counts_as_cash: true,
          is_proration: false,
          raw: obj,
        });
      } else if (isLifetime) {
        events.push({
          ...identity,
          event_type: "lifetime.purchased",
          revenue_stream: "lifetime",
          stripe_object_id: obj.id,
          stripe_payment_intent_id:
            typeof obj.payment_intent === "string" ? obj.payment_intent : obj.payment_intent?.id ?? null,
          occurred_at: iso(obj.created),
          amount_cents: obj.amount_total ?? 0,
          currency: (obj.currency ?? "usd").toLowerCase(),
          counts_as_cash: true,
          is_proration: false,
          raw: obj,
        });
      }
      continue;
    }
  }

  if (!write) return events.length + periods.length;
  const a = await insertEvents(events);
  const b = await upsertPeriods(periods);
  return a + b;
}

async function listPage(stripe: Stripe, resource: Resource, startingAfter?: string) {
  const params: any = { limit: 100 };
  if (startingAfter) params.starting_after = startingAfter;
  switch (resource) {
    case "subscriptions":
      return await stripe.subscriptions.list({ ...params, status: "all" });
    case "invoices":
      return await stripe.invoices.list(params);
    case "charges":
      return await stripe.charges.list({ ...params, expand: ["data.balance_transaction"] });
    case "refunds":
      return await stripe.refunds.list(params);
    case "disputes":
      return await stripe.disputes.list(params);
    case "checkout_sessions":
      return await stripe.checkout.sessions.list(params);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Authorization, in order: cron secret, admin shared secret, platform-admin JWT.
    //
    // requireCronSecret is used as a PREDICATE here, deliberately not as the
    // usual `const gate = requireCronSecret(req); if (gate) return gate;`
    // early return. That shape would 401 every platform-admin call this
    // function already serves from the browser, because an admin request
    // carries no x-cron-secret header. A request without the header must fall
    // through to the paths below, not be rejected.
    let authorized = requireCronSecret(req) === null;
    const provided = req.headers.get("x-admin-secret");
    const accepted = [
      Deno.env.get("BILLING_BACKFILL_ADMIN_SECRET"),
      Deno.env.get("CRON_SECRET"),
    ].filter(Boolean) as string[];
    if (!authorized) authorized = Boolean(provided && accepted.includes(provided));
    if (!authorized) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace("Bearer ", "");
      if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
        authorized = true;
      } else if (token) {
        const { data: userData } = await admin.auth.getUser(token);
        if (userData?.user) {
          const scoped = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
          );
          const { data: isAdmin } = await scoped.rpc("is_platform_admin");
          authorized = isAdmin === true;
        }
      }
    }
    if (!authorized) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const resource = body.resource as Resource;
    const mode: "count" | "run" = body.mode === "count" ? "count" : "run";
    const maxPages = Math.max(1, Math.min(50, Number(body.maxPages ?? 5)));
    // Scheduled runs must re-walk from the newest object. Without this the
    // cursor stays parked on the oldest object from the previous complete run,
    // every subsequent call returns an empty page, and the job marks itself
    // complete having imported nothing while refreshing finished_at.
    const restart = body.restart === true;
    if (!RESOURCES.includes(resource)) {
      return json({ error: `resource must be one of ${RESOURCES.join(", ")}` }, 400);
    }

    // New billing account when STRIPE_BILLING_SECRET_KEY is set. Until then
    // keep STRIPE_BACKFILL_READ_KEY, the restricted key this job already
    // uses. STRIPE_SECRET_KEY is the last fallback. A restricted key on the
    // new account can be stored as STRIPE_BILLING_SECRET_KEY.
    const key = (
      Deno.env.get("STRIPE_BILLING_SECRET_KEY")
      || Deno.env.get("STRIPE_BACKFILL_READ_KEY")
      || Deno.env.get("STRIPE_SECRET_KEY")
      || ""
    ).trim();
    if (!key) return json({ error: "STRIPE_BILLING_SECRET_KEY is not set" }, 500);
    const stripe = await createStripeClient(key, { apiVersion: "2025-08-27.basil" });

    // --- job row
    const { data: existing } = await admin
      .from("billing_backfill_jobs")
      .select("*")
      .eq("resource", resource)
      .maybeSingle();

    let cursor: string | null = restart ? null : (existing?.cursor_after ?? null);
    let pagesDone = restart ? 0 : (existing?.pages_done ?? 0);
    let objectsSeen = restart ? 0 : (existing?.objects_seen ?? 0);
    let rowsWritten = restart ? 0 : (existing?.rows_written ?? 0);

    if (mode === "run") {
      await admin.from("billing_backfill_jobs").upsert(
        {
          resource,
          status: "running",
          started_at: existing?.started_at ?? new Date().toISOString(),
          last_error: null,
          cursor_after: cursor,
          pages_done: pagesDone,
          objects_seen: objectsSeen,
          rows_written: rowsWritten,
        },
        { onConflict: "resource" },
      );
    }

    let pages = 0;
    let hasMore = true;
    let countSeen = 0;
    let countWould = 0;

    try {
      while (pages < maxPages && hasMore) {
        const page: any = await listPage(stripe, resource, cursor ?? undefined);
        const objects = page.data ?? [];
        const written = await processPage(stripe, resource, objects, mode === "run");
        pages += 1;
        hasMore = Boolean(page.has_more);
        if (objects.length > 0) cursor = objects[objects.length - 1].id;

        if (mode === "run") {
          pagesDone += 1;
          objectsSeen += objects.length;
          rowsWritten += written;
          await admin
            .from("billing_backfill_jobs")
            .update({
              cursor_after: cursor,
              pages_done: pagesDone,
              objects_seen: objectsSeen,
              rows_written: rowsWritten,
              status: hasMore ? "running" : "complete",
              finished_at: hasMore ? null : new Date().toISOString(),
            })
            .eq("resource", resource);
        } else {
          countSeen += objects.length;
          countWould += written;
        }
        log("page", { resource, mode, pages, objects: objects.length, hasMore });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log("ERROR", { resource, message });
      if (mode === "run") {
        await admin
          .from("billing_backfill_jobs")
          .update({ status: "failed", last_error: message, cursor_after: cursor })
          .eq("resource", resource);
      }
      return json({
        resource,
        mode,
        status: "failed",
        error: message,
        pages_done: mode === "run" ? pagesDone : pages,
        objects_seen: mode === "run" ? objectsSeen : countSeen,
        rows_written: mode === "run" ? rowsWritten : countWould,
        has_more: hasMore,
      });
    }

    return json({
      resource,
      mode,
      status: mode === "count" ? "counted" : hasMore ? "running" : "complete",
      pages_done: mode === "run" ? pagesDone : pages,
      objects_seen: mode === "run" ? objectsSeen : countSeen,
      rows_written: mode === "run" ? rowsWritten : 0,
      would_write: mode === "count" ? countWould : undefined,
      has_more: hasMore,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("FATAL", { message });
    return json({ error: message }, 500);
  }
});
