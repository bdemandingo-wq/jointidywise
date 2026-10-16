// stripe-subscription-webhook success paths must return JSON.
// tier and result used to be declared inside the applyState branch and read
// after it, which threw ReferenceError and became a 500 Stripe retried forever.
//
// Runner:
//   node --experimental-strip-types --test src/lib/subscriptionWebhookEvent.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleSubscriptionWebhookEvent } from "../../supabase/functions/_shared/subscription-webhook-event.ts";
import { updateOrgPlanTier } from "../../supabase/functions/_shared/plan-tier.ts";

const SUBSCRIPTION_SOURCE = "stripe-subscription-webhook";
const INVOICE_SOURCE = "stripe-invoice-webhook";

const ORG_ID = "org-1";

function subscriptionObject() {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    items: {
      data: [{
        quantity: 1,
        price: { unit_amount: 9700, recurring: { interval: "month", interval_count: 1 } },
      }],
    },
    metadata: {} as Record<string, string>,
  };
}

function claimKey(source: string, eventId: string): string {
  return `${source}\0${eventId}`;
}

function fakeDb(opts: {
  billing: { billing_event_at: string; updated_at: string; organization_id?: string } | null;
  billingReadError?: { message: string; code?: string } | null;
  billingWriteError?: { message: string } | null;
  profile?: { id: string } | null;
  membership?: { organization_id: string } | null;
  claims?: Set<string>;
  ilikePatterns?: string[];
}) {
  const writes: string[] = [];
  const claims = opts.claims ?? new Set<string>();
  const ilikePatterns = opts.ilikePatterns ?? [];
  const supabase = {
    from(table: string) {
      const filters: Array<{ column: string; value: string }> = [];
      let pendingDelete = false;
      const api: {
        select: () => typeof api;
        eq: (column?: string, value?: string) => typeof api;
        ilike: (column: string, pattern: string) => typeof api;
        in: () => typeof api;
        order: () => typeof api;
        limit: () => typeof api;
        range: () => typeof api;
        update: (payload: unknown) => typeof api;
        insert: (payload: { event_id?: string; source?: string }) => Promise<{ error: { code?: string; message: string } | null }>;
        delete: () => typeof api;
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        then: (
          onFulfilled: (value: { data: null; error: { message: string } | null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise<unknown>;
      } = {
        select() { return api; },
        eq(column?: string, value?: string) {
          if (typeof column === "string") filters.push({ column, value: String(value ?? "") });
          return api;
        },
        ilike(_column: string, pattern: string) {
          ilikePatterns.push(pattern);
          return api;
        },
        in() { return api; },
        not() { return api; },
        order() { return api; },
        limit() { return api; },
        range() { return api; },
        update() {
          writes.push(table);
          return api;
        },
        insert(payload) {
          writes.push(`insert:${table}`);
          if (table === "stripe_webhook_events") {
            const key = claimKey(payload.source ?? "", payload.event_id ?? "");
            if (claims.has(key)) {
              return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
            }
            claims.add(key);
          }
          return Promise.resolve({ error: null });
        },
        delete() {
          writes.push(`delete:${table}`);
          pendingDelete = true;
          return api;
        },
        maybeSingle() {
          if (table === "profiles") {
            return Promise.resolve({ data: opts.profile === undefined ? { id: "user-1" } : opts.profile, error: null });
          }
          if (table === "org_memberships") {
            return Promise.resolve({
              data: opts.membership === undefined ? { organization_id: ORG_ID } : opts.membership,
              error: null,
            });
          }
          if (table === "stripe_subscriptions") {
            return Promise.resolve({ data: opts.billing, error: opts.billingReadError ?? null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(onFulfilled, onRejected) {
          if (pendingDelete && table === "stripe_webhook_events") {
            const eventId = filters.find((filter) => filter.column === "event_id")?.value;
            const source = filters.find((filter) => filter.column === "source")?.value;
            if (eventId && source) claims.delete(claimKey(source, eventId));
          }
          const error = table === "stripe_subscriptions" ? (opts.billingWriteError ?? null) : null;
          return Promise.resolve({ data: null, error }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
  return { supabase, writes, claims, ilikePatterns };
}

function stripeClient(
  retrieve: () => Promise<ReturnType<typeof subscriptionObject>>,
  opts: {
    email?: string;
    listThrows?: boolean;
    customerDeleted?: boolean;
    customerRetrieveThrows?: boolean;
    customerRetrieves?: { count: number };
  } = {},
) {
  return {
    customers: {
      retrieve: async () => {
        if (opts.customerRetrieves) opts.customerRetrieves.count += 1;
        if (opts.customerRetrieveThrows) throw new Error("customer retrieve failed");
        if (opts.customerDeleted) return { id: "cus_123", deleted: true };
        return { email: opts.email ?? "owner@example.com" };
      },
    },
    subscriptions: {
      retrieve,
      list: async () => {
        if (opts.listThrows) throw new Error("subscriptions.list failed");
        return { data: [] };
      },
    },
  };
}

async function run(opts: {
  created: number;
  eventId?: string;
  retrieve: () => Promise<ReturnType<typeof subscriptionObject>>;
  billing: { billing_event_at: string; updated_at: string; organization_id?: string } | null;
  planResult?: { updated: boolean; skipped?: string };
  billingWriteError?: { message: string } | null;
  profile?: { id: string } | null;
  membership?: { organization_id: string } | null;
  claims?: Set<string>;
  metadataOrg?: string;
  customerEmail?: string;
  listThrows?: boolean;
  planThrows?: boolean;
  customerDeleted?: boolean;
  customerRetrieveThrows?: boolean;
  billingReadError?: { message: string; code?: string } | null;
  notify?: boolean;
}) {
  const planCalls: string[] = [];
  const planOrgs: string[] = [];
  const loyaltyCalls: string[] = [];
  const ilikePatterns: string[] = [];
  const sms: string[] = [];
  const customerRetrieves = { count: 0 };
  const { supabase, writes } = fakeDb({
    billing: opts.billing,
    billingReadError: opts.billingReadError,
    billingWriteError: opts.billingWriteError,
    profile: opts.profile,
    membership: opts.membership,
    claims: opts.claims,
    ilikePatterns,
  });
  const object = subscriptionObject();
  if (opts.metadataOrg) object.metadata.organization_id = opts.metadataOrg;
  const response = await handleSubscriptionWebhookEvent({
    event: {
      id: opts.eventId,
      type: "customer.subscription.updated",
      created: opts.created,
      data: { object },
    },
    stripe: stripeClient(opts.retrieve, {
      email: opts.customerEmail,
      listThrows: opts.listThrows,
      customerDeleted: opts.customerDeleted,
      customerRetrieveThrows: opts.customerRetrieveThrows,
      customerRetrieves,
    }),
    supabase,
    subscriptionToPlanTier: () => "pro",
    updateOrgPlanTier: async (_supabase, orgId, tier) => {
      if (opts.planThrows) throw new Error("plan read exploded");
      planCalls.push(tier);
      planOrgs.push(orgId);
      return opts.planResult ?? { updated: true };
    },
    syncLoyaltySubscription: async (_supabase, _stripe, args) => {
      loyaltyCalls.push(args.organizationId);
    },
    adminPhones: opts.notify ? ["+15555550100"] : [],
    env: (name) => {
      if (!opts.notify) return undefined;
      if (name === "OPENPHONE_API_KEY") return "test-key";
      if (name === "OPENPHONE_PHONE_NUMBER_ID") return "pn_test";
      return undefined;
    },
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { content?: string };
      sms.push(payload.content ?? "");
      return { ok: true, status: 200, text: async () => "" };
    },
  });
  const text = await response.text();
  const body = JSON.parse(text);
  return {
    response,
    body,
    planCalls,
    planOrgs,
    loyaltyCalls,
    writes,
    ilikePatterns,
    sms,
    customerRetrieves: customerRetrieves.count,
  };
}

test("applyState true returns 200 JSON with the written tier", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, planCalls, writes } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
  });
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.tier, "pro");
  assert.equal(body.updated, true);
  assert.equal(body.error, undefined);
  assert.deepEqual(planCalls, ["pro"]);
  assert.deepEqual(writes, ["stripe_subscriptions"]);
});

test("applyState false returns 200 JSON and does not write the tier", async () => {
  const stored = new Date(5_000 * 1000).toISOString();
  const { response, body, planCalls, loyaltyCalls, writes } = await run({
    created: 1_000,
    retrieve: async () => {
      throw new Error("stripe unavailable");
    },
    billing: { billing_event_at: stored, updated_at: stored },
  });
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.tier, null);
  assert.equal(body.updated, false);
  assert.equal(body.error, undefined);
  assert.deepEqual(planCalls, []);
  assert.deepEqual(loyaltyCalls, []);
  assert.deepEqual(writes, []);
});

test("a lifetime skip returns 200 JSON with skipped set", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, planCalls, writes } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    planResult: { updated: false, skipped: "lifetime_locked" },
  });
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.tier, "pro");
  assert.equal(body.updated, false);
  assert.equal(body.skipped, "lifetime_locked");
  assert.equal(body.error, undefined);
  assert.deepEqual(planCalls, ["pro"]);
  assert.deepEqual(writes, ["stripe_subscriptions"]);
});

test("a failed plan_tier write still returns 500 JSON", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    planResult: { updated: false, skipped: "permission denied" },
  });
  assert.equal(response.status, 500);
  assert.equal(body.ok, undefined);
  assert.match(body.error, /not saved/);
});

test("a missing profile is an orphan and sends the admin SMS", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, planCalls, sms } = await run({
    created: 2_000,
    eventId: "evt_orphan_profile",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    profile: null,
    notify: true,
  });
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.orphan, true);
  assert.deepEqual(planCalls, []);
  assert.equal(sms.length, 1);
  assert.match(sms[0], /orphan subscription/);
  assert.match(sms[0], /sub_123/);
});

test("a missing org is an orphan and sends the admin SMS", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, planCalls, sms } = await run({
    created: 2_000,
    eventId: "evt_orphan_org",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    membership: null,
    notify: true,
  });
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.orphan, true);
  assert.deepEqual(planCalls, []);
  assert.equal(sms.length, 1);
  assert.match(sms[0], /Couldn't auto-link/);
});

test("a deleted customer resolves from the stored row and does not require an email", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, planOrgs, customerRetrieves } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored, organization_id: "org-stored" },
    customerDeleted: true,
    customerRetrieveThrows: true,
  });
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.orphan, undefined);
  assert.deepEqual(planOrgs, ["org-stored"]);
  assert.equal(customerRetrieves, 0);

  const orphan = await run({
    created: 2_000,
    eventId: "evt_deleted_customer",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    customerDeleted: true,
    profile: null,
    notify: true,
  });
  assert.equal(orphan.response.status, 200);
  assert.equal(orphan.body.orphan, true);
  assert.deepEqual(orphan.planCalls, []);
  assert.equal(orphan.customerRetrieves, 1);
  assert.equal(orphan.sms.length, 1);
  assert.match(orphan.sms[0], /Email: unknown/);
});

test("the subscription's own org is used and a duplicate event skips side effects", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const claims = new Set<string>();
  const first = await run({
    created: 2_000,
    eventId: "evt_sub",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    profile: null,
    metadataOrg: "org-from-subscription",
    claims,
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.ok, true);
  assert.deepEqual(first.planCalls, ["pro"]);
  assert.deepEqual(first.loyaltyCalls, ["org-from-subscription"]);

  const second = await run({
    created: 2_000,
    eventId: "evt_sub",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    claims,
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.deepEqual(second.planCalls, []);
  assert.deepEqual(second.loyaltyCalls, []);
});

test("a failed write releases the subscription webhook claim", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const claims = new Set<string>();
  const failed = await run({
    created: 2_000,
    eventId: "evt_fail",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    planResult: { updated: false, skipped: "permission denied" },
    claims,
  });
  assert.equal(failed.response.status, 500);
  assert.equal(claims.has(claimKey(SUBSCRIPTION_SOURCE, "evt_fail")), false);

  const retry = await run({
    created: 2_000,
    eventId: "evt_fail",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    claims,
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.duplicate, undefined);
  assert.deepEqual(retry.planCalls, ["pro"]);
});

test("a throw after the claim releases it so the retry is not a duplicate", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const claims = new Set<string>();
  const exploded = await run({
    created: 2_000,
    eventId: "evt_throw",
    retrieve: async () => ({ ...subscriptionObject(), status: "canceled" }),
    billing: { billing_event_at: stored, updated_at: stored },
    listThrows: true,
    claims,
  });
  assert.equal(exploded.response.status, 500);
  assert.match(exploded.body.error, /subscriptions\.list failed/);
  assert.equal(claims.has(claimKey(SUBSCRIPTION_SOURCE, "evt_throw")), false);

  const retry = await run({
    created: 2_000,
    eventId: "evt_throw",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    claims,
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.duplicate, undefined);
  assert.deepEqual(retry.planCalls, ["pro"]);
});

test("an invoice claim of the same event id does not block the subscription handler", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const claims = new Set<string>([claimKey(INVOICE_SOURCE, "evt_shared")]);
  const subscriptionFirst = await run({
    created: 2_000,
    eventId: "evt_shared",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    claims,
  });
  assert.equal(subscriptionFirst.response.status, 200);
  assert.equal(subscriptionFirst.body.duplicate, undefined);
  assert.equal(claims.has(claimKey(SUBSCRIPTION_SOURCE, "evt_shared")), true);
  assert.equal(claims.has(claimKey(INVOICE_SOURCE, "evt_shared")), true);
});

test("releasing a subscription claim leaves the invoice claim of the same event", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const claims = new Set<string>([
    claimKey(INVOICE_SOURCE, "evt_fail"),
    claimKey(SUBSCRIPTION_SOURCE, "evt_other"),
  ]);
  const failed = await run({
    created: 2_000,
    eventId: "evt_fail",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    planResult: { updated: false, skipped: "permission denied" },
    claims,
  });
  assert.equal(failed.response.status, 500);
  assert.equal(claims.has(claimKey(SUBSCRIPTION_SOURCE, "evt_fail")), false);
  assert.equal(claims.has(claimKey(INVOICE_SOURCE, "evt_fail")), true);
  assert.equal(claims.has(claimKey(SUBSCRIPTION_SOURCE, "evt_other")), true);

  const retry = await run({
    created: 2_000,
    eventId: "evt_fail",
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    claims,
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.duplicate, undefined);
  assert.equal(claims.has(claimKey(INVOICE_SOURCE, "evt_fail")), true);
});

test("the stored subscription org wins over metadata, and email wildcards are escaped", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, planOrgs, ilikePatterns } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored, organization_id: "org-stored" },
    metadataOrg: "org-from-metadata",
    profile: null,
    customerEmail: "owner_name@example.com",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(planOrgs, ["org-stored"]);
  assert.deepEqual(ilikePatterns, []);

  const emailFallback = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    customerEmail: "owner_name@example.com",
  });
  assert.equal(emailFallback.response.status, 200);
  assert.deepEqual(emailFallback.planOrgs, ["org-1"]);
  assert.deepEqual(emailFallback.ilikePatterns, ["owner\\_name@example.com"]);
});

test("an organization lookup database error is still a 500", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, sms } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    billingReadError: { message: "connection reset", code: "08006" },
    notify: true,
  });
  assert.equal(response.status, 500);
  assert.match(body.error, /connection reset/);
  assert.deepEqual(sms, []);
});

test("an organization read error is a 500, and a missing org stays org_not_found", async () => {
  const failed = await updateOrgPlanTier({
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: null, error: { message: "connection reset", code: "08006" } }),
      };
    },
  }, "org-1", "pro");
  assert.equal(failed.updated, false);
  assert.equal(failed.skipped, "connection reset");

  const missing = await updateOrgPlanTier({
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: null, error: null }),
      };
    },
  }, "org-1", "pro");
  assert.equal(missing.skipped, "org_not_found");

  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    planResult: { updated: false, skipped: "connection reset" },
  });
  assert.equal(response.status, 500);
  assert.match(body.error, /not saved/);
});

test("membership lookup is ordered by organization id", () => {
  const source = readFileSync(
    new URL("../../supabase/functions/_shared/subscription-webhook-event.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function resolveWebhookOrganization");
  const fn = source.slice(start);
  const orderAt = fn.indexOf('.order("organization_id", { ascending: true })');
  const limitAt = fn.indexOf(".limit(1)", orderAt);
  assert.ok(orderAt > 0);
  assert.ok(limitAt > orderAt);
});
