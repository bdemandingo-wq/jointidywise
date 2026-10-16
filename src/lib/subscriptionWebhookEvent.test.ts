// stripe-subscription-webhook success paths must return JSON.
// tier and result used to be declared inside the applyState branch and read
// after it, which threw ReferenceError and became a 500 Stripe retried forever.
//
// Runner:
//   node --experimental-strip-types --test src/lib/subscriptionWebhookEvent.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSubscriptionWebhookEvent } from "../../supabase/functions/_shared/subscription-webhook-event.ts";

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

function fakeDb(opts: {
  billing: { billing_event_at: string; updated_at: string; organization_id?: string } | null;
  billingReadError?: { message: string; code?: string } | null;
  billingWriteError?: { message: string } | null;
  profile?: { id: string } | null;
  membership?: { organization_id: string } | null;
  claims?: Set<string>;
}) {
  const writes: string[] = [];
  const claims = opts.claims ?? new Set<string>();
  const supabase = {
    from(table: string) {
      const api: {
        select: () => typeof api;
        eq: () => typeof api;
        ilike: () => typeof api;
        in: () => typeof api;
        order: () => typeof api;
        limit: () => typeof api;
        update: (payload: unknown) => typeof api;
        insert: (payload: { event_id?: string }) => Promise<{ error: { code?: string; message: string } | null }>;
        delete: () => typeof api;
        maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        then: (
          onFulfilled: (value: { data: null; error: { message: string } | null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise<unknown>;
      } = {
        select() { return api; },
        eq() { return api; },
        ilike() { return api; },
        in() { return api; },
        order() { return api; },
        limit() { return api; },
        update() {
          writes.push(table);
          return api;
        },
        insert(payload) {
          writes.push(`insert:${table}`);
          if (table === "stripe_webhook_events") {
            const id = payload.event_id ?? "";
            if (claims.has(id)) {
              return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
            }
            claims.add(id);
          }
          return Promise.resolve({ error: null });
        },
        delete() {
          writes.push(`delete:${table}`);
          if (table === "stripe_webhook_events") claims.clear();
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
          const error = table === "stripe_subscriptions" ? (opts.billingWriteError ?? null) : null;
          return Promise.resolve({ data: null, error }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
  return { supabase, writes, claims };
}

function stripeClient(retrieve: () => Promise<ReturnType<typeof subscriptionObject>>) {
  return {
    customers: {
      retrieve: async () => ({ email: "owner@example.com" }),
    },
    subscriptions: {
      retrieve,
      list: async () => ({ data: [] }),
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
}) {
  const planCalls: string[] = [];
  const loyaltyCalls: string[] = [];
  const { supabase, writes } = fakeDb({
    billing: opts.billing,
    billingWriteError: opts.billingWriteError,
    profile: opts.profile,
    membership: opts.membership,
    claims: opts.claims,
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
    stripe: stripeClient(opts.retrieve),
    supabase,
    subscriptionToPlanTier: () => "pro",
    updateOrgPlanTier: async (_supabase, _orgId, tier) => {
      planCalls.push(tier);
      return opts.planResult ?? { updated: true };
    },
    syncLoyaltySubscription: async (_supabase, _stripe, args) => {
      loyaltyCalls.push(args.organizationId);
    },
    adminPhones: [],
    env: () => undefined,
    fetchImpl: async () => {
      throw new Error("conversion SMS must not be sent by these branches");
    },
  });
  const text = await response.text();
  const body = JSON.parse(text);
  return { response, body, planCalls, loyaltyCalls, writes };
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

test("a missing profile returns 500 so Stripe retries", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, planCalls } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    profile: null,
  });
  assert.equal(response.status, 500);
  assert.match(body.error, /not resolved/);
  assert.deepEqual(planCalls, []);
});

test("a missing org returns 500 so Stripe retries", async () => {
  const stored = new Date(1_000 * 1000).toISOString();
  const { response, body, planCalls } = await run({
    created: 2_000,
    retrieve: async () => subscriptionObject(),
    billing: { billing_event_at: stored, updated_at: stored },
    membership: null,
  });
  assert.equal(response.status, 500);
  assert.match(body.error, /not resolved/);
  assert.deepEqual(planCalls, []);
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
  assert.equal(claims.has("evt_fail"), false);

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
