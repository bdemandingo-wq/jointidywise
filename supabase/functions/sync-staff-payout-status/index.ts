// Tracks Stripe payouts to cleaners: pending -> paid (bank payout started, expected
// arrival known) -> deposited, or failed / reversed.
// Two callers:
//   - pg_cron with x-cron-secret: syncs every open Stripe payout, all orgs.
//   - a signed-in user (refresh button): syncs only open payouts for an org they
//     belong to; a cleaner only their own rows.
// Known limit: Stripe pools transfers into daily payouts, so we match the first
// connected-account payout created at/after the transfer. Approximate by design.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { sendStaffSms } from "../_shared/staff-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const log = (s: string, d?: unknown) => console.log(`[SYNC-PAYOUT-STATUS] ${s}${d ? " - " + JSON.stringify(d) : ""}`);

type Status = "pending" | "paid" | "failed" | "reversed" | "deposited";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let orgFilter: string | null = null;
  let staffFilter: string | null = null;

  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedCron = req.headers.get("x-cron-secret");
  if (providedCron) {
    if (!cronSecret || providedCron !== cronSecret) return json({ error: "Unauthorized" }, 401);
  } else {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const orgId = typeof body?.organization_id === "string" ? body.organization_id : null;
    if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) return json({ error: "organization_id required" }, 400);
    const { data: fin } = await admin.rpc("has_org_financial_access", { _org_id: orgId }).then(
      () => ({ data: null }), () => ({ data: null })); // RPC relies on auth.uid(); not usable with service role — check tables directly
    void fin;
    const { data: mem } = await admin.from("org_memberships").select("role").eq("organization_id", orgId).eq("user_id", u.user.id).maybeSingle();
    if (mem && mem.role === "owner") {
      orgFilter = orgId;
    } else {
      const { data: st } = await admin.from("staff").select("id").eq("organization_id", orgId).eq("user_id", u.user.id).maybeSingle();
      if (!st) return json({ error: "Forbidden" }, 403);
      orgFilter = orgId;
      staffFilter = st.id;
    }
  }

  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return json({ error: "Platform Stripe key not configured" }, 500);
  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

  let q = admin.from("payroll_payments")
    .select("id, organization_id, staff_id, amount, stripe_transfer_id, payout_status, status_history, created_at")
    .in("payout_status", ["pending", "paid"])
    .not("stripe_transfer_id", "is", null)
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(200);
  if (orgFilter) q = q.eq("organization_id", orgFilter);
  if (staffFilter) q = q.eq("staff_id", staffFilter);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  let changed = 0;
  for (const r of rows ?? []) {
    try {
      const transfer = await stripe.transfers.retrieve(r.stripe_transfer_id!);
      let next: Status = r.payout_status as Status;
      let expected: string | null = null;
      let payoutId: string | null = null;
      let failure: string | null = null;

      if (transfer.reversed || (transfer.amount_reversed ?? 0) >= transfer.amount) {
        next = "reversed";
      } else if (typeof transfer.destination === "string") {
        const payouts = await stripe.payouts.list(
          { created: { gte: transfer.created }, limit: 10 },
          { stripeAccount: transfer.destination },
        );
        const p = payouts.data.sort((a, b) => a.created - b.created)[0];
        if (p) {
          payoutId = p.id;
          expected = new Date(p.arrival_date * 1000).toISOString().slice(0, 10);
          if (p.status === "paid") next = "deposited";
          else if (p.status === "failed" || p.status === "canceled") {
            next = "failed";
            failure = p.failure_message || p.failure_code || "The bank rejected this payout.";
          } else next = "paid";
        }
      }

      if (next === r.payout_status && !expected) continue;
      const history = Array.isArray(r.status_history) ? r.status_history : [];
      const isNew = next !== r.payout_status;
      const upd: Record<string, unknown> = { expected_arrival_date: expected, stripe_payout_id: payoutId };
      if (isNew) {
        upd.payout_status = next;
        upd.status_updated_at = new Date().toISOString();
        upd.failure_reason = failure;
        upd.status_history = [...history, { status: next, at: new Date().toISOString(), note: failure ?? undefined }];
      }
      await admin.from("payroll_payments").update(upd).eq("id", r.id).eq("organization_id", r.organization_id);
      if (!isNew) continue;
      changed++;

      if (next === "failed" || next === "reversed") {
        const { data: s } = await admin.from("staff").select("name, phone").eq("id", r.staff_id).eq("organization_id", r.organization_id).maybeSingle();
        const { data: org } = await admin.from("organizations").select("name").eq("id", r.organization_id).maybeSingle();
        const amt = `$${Number(r.amount).toFixed(2)}`;
        const msg = next === "failed"
          ? `${org?.name || "Your employer"}: your ${amt} payout couldn't reach your bank (${failure}). Please check your bank details in the Payouts tab of the staff portal.`
          : `${org?.name || "Your employer"}: your ${amt} payout was reversed. Please reach out to your manager for details.`;
        await sendStaffSms(admin, r.organization_id!, s?.phone ?? null, msg, "sync-staff-payout-status");
      }
    } catch (e) {
      log("row failed", { id: r.id, err: e instanceof Error ? e.message : String(e) });
    }
  }
  log("done", { checked: rows?.length ?? 0, changed });
  return json({ checked: rows?.length ?? 0, changed });
});
