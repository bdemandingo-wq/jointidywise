// Account metrics: monthly price math, CSV shape, and the admin-only SQL gate.
//
// Runner:
//   node --experimental-strip-types --test src/lib/platformAccountMetrics.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  classifySaasRefund,
  incomingBillingIsNewer,
  normalizeMonthlyBilledCents,
  replaySubscriptionEvents,
  replayTestModeBillingEvents,
  saasRefundDrafts,
  subscriptionBillingSnapshot,
  type ReplaySubscriptionEvent,
  type SubscriptionEventPayload,
  type TestModeBillingEvent,
} from "../../supabase/functions/_shared/subscription-billing-snapshot.ts";
import {
  buildAccountMetricsCsv,
  fetchAllAccountMetrics,
  mrrDollars,
  type AccountMetricsRow,
} from "./platformAccountMetricsExport.ts";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261015010000_platform_account_metrics.sql", import.meta.url),
  "utf8",
);

function row(over: Partial<AccountMetricsRow> = {}): AccountMetricsRow {
  return {
    organization_id: "org-1",
    organization_name: "North Shore Clean",
    owner_email: "owner@example.com",
    signup_at: "2026-01-15T12:00:00.000Z",
    trial_status: "not_on_trial",
    trial_ends_at: null,
    trial_end_source: null,
    latest_milestone: "staff_added",
    latest_milestone_at: "2026-02-01T00:00:00.000Z",
    activation_milestones: {
      trial_signup: "2026-01-15T12:00:00.000Z",
      staff_added: "2026-02-01T00:00:00.000Z",
      first_payment_received: "2026-03-01T00:00:00.000Z",
    },
    last_login_at: "2026-04-01T00:00:00.000Z",
    how_heard: "fb_ad, tiktok",
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "spring",
    referrer: "https://instagram.com/tidywise",
    stripe_subscription_status: "active",
    subscription_status: "active",
    stripe_subscription_id: "sub_123",
    plan: "Pro",
    is_lifetime: false,
    billing_interval: "month",
    monthly_amount_cents: 8900,
    monthly_amount_basis: "monthly",
    monthly_amount_source: "stripe_subscription",
    mrr_cents: 8900,
    counts_toward_mrr: true,
    loyalty_discount_cents: 800,
    canceled_at: null,
    cancellation_source: null,
    cancel_at_period_end: false,
    cancel_scheduled_for: null,
    refund_dates: [],
    is_demo_or_test: false,
    ...over,
  };
}

test("monthly loyalty discount is taken off a monthly invoice", () => {
  const priced = normalizeMonthlyBilledCents({
    unitAmountCents: 9700,
    quantity: 1,
    billingInterval: "month",
    intervalCount: 1,
    discountAmountCents: 800,
  });
  assert.equal(priced.monthlyAmountCents, 8900);
  assert.equal(priced.amountBasis, "monthly");
});

test("an annual invoice is divided by 12 after the coupon", () => {
  const priced = normalizeMonthlyBilledCents({
    unitAmountCents: 97000,
    quantity: 1,
    billingInterval: "year",
    intervalCount: 1,
    discountAmountCents: 12000,
  });
  assert.equal(priced.monthlyAmountCents, 7083);
  assert.equal(priced.amountBasis, "normalized_from_annual");
});

test("a missing unit amount stays null", () => {
  const priced = normalizeMonthlyBilledCents({
    unitAmountCents: null,
    billingInterval: "month",
  });
  assert.equal(priced.monthlyAmountCents, null);
  assert.equal(priced.amountBasis, null);
});

test("a weekly price is converted to a month", () => {
  const priced = normalizeMonthlyBilledCents({
    unitAmountCents: 1000,
    billingInterval: "week",
    intervalCount: 1,
  });
  assert.equal(priced.monthlyAmountCents, 4333);
  assert.equal(priced.amountBasis, "normalized_from_weekly");
});

test("an unexpanded discount id is unknown, not treated as zero", () => {
  const snap = subscriptionBillingSnapshot({
    items: { data: [{ quantity: 1, price: { unit_amount: 9700, recurring: { interval: "month", interval_count: 1 } } }] },
    discounts: ["di_unexpanded"],
  });
  assert.equal(snap.unitAmountCents, 9700);
  assert.equal(snap.discountKnown, false);
  assert.equal(snap.discountAmountCents, null);
});

test("an expanded amount-off coupon is stored", () => {
  const snap = subscriptionBillingSnapshot({
    items: { data: [{ price: { unit_amount: 9700, recurring: { interval: "month", interval_count: 1 } } }] },
    discounts: [{ coupon: { amount_off: 800, percent_off: null } }],
    canceled_at: 1_700_000_000,
  });
  assert.equal(snap.discountKnown, true);
  assert.equal(snap.discountAmountCents, 800);
  assert.equal(snap.canceledAt, new Date(1_700_000_000 * 1000).toISOString());
});

test("no coupon is a known zero discount", () => {
  const snap = subscriptionBillingSnapshot({
    items: { data: [{ price: { unit_amount: 4900, recurring: { interval: "year", interval_count: 1 } } }] },
    discounts: [],
  });
  assert.equal(snap.discountKnown, true);
  assert.equal(snap.discountAmountCents, 0);
  assert.equal(snap.billingInterval, "year");
});

test("a charge.refunded payload without the refund list still keeps a date", () => {
  const drafts = saasRefundDrafts({
    id: "ch_1",
    customer: "cus_1",
    currency: "USD",
    refunds: { data: [] },
  }, 1_700_000_000);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].stripeRefundId, "ch_1:unitemized");
  assert.equal(drafts[0].stripeCustomerId, "cus_1");
  assert.equal(drafts[0].refundedAt, new Date(1_700_000_000 * 1000).toISOString());
});

test("listed refunds are kept and the synthetic row is not added", () => {
  const drafts = saasRefundDrafts({
    id: "ch_1",
    customer: "cus_1",
    refunds: { data: [{ id: "re_1", amount: 500, created: 1_700_000_100 }, { id: "re_2", amount: 200, created: 1_700_000_200 }] },
  }, 1_700_000_000);
  assert.deepEqual(drafts.map((draft) => draft.stripeRefundId), ["re_1", "re_2"]);
});

test("lifetime MRR is blank even when mrr_cents is filled", () => {
  const lifetime = row({
    is_lifetime: true,
    plan: "Lifetime",
    how_heard: "google",
    monthly_amount_cents: 30000,
    mrr_cents: 30000,
    counts_toward_mrr: true,
    monthly_amount_basis: "lifetime_excluded",
  });
  assert.equal(mrrDollars(lifetime), "");
  const csv = buildAccountMetricsCsv([lifetime], new Date("2026-10-14T00:00:00.000Z"));
  const header = csv.split("\n").find((line) => line.startsWith('"Organization id"'));
  assert.ok(header);
  const columns = header.split(",");
  const mrrIndex = columns.findIndex((column) => column === '"MRR ($)"');
  const milestoneIndex = columns.findIndex((column) => column === '"milestone_first_payment_received (UTC)"');
  assert.ok(mrrIndex > milestoneIndex && milestoneIndex > 0);
  const data = csv.trim().split("\n").at(-1)?.split(",") ?? [];
  assert.equal(data[mrrIndex], '""');
  assert.equal(data[columns.findIndex((column) => column === '"Monthly amount ($)"')], '""');
});

test("milestone columns follow whatever keys are on the rows", () => {
  const csv = buildAccountMetricsCsv([
    row({ activation_milestones: { zebra_added: "2026-05-01T00:00:00.000Z", alpha_added: "2026-04-01T00:00:00.000Z" } }),
  ], new Date("2026-10-14T00:00:00.000Z"));
  const header = csv.split("\n").find((line) => line.includes("milestone_alpha_added"));
  assert.ok(header);
  const alpha = header.indexOf("milestone_alpha_added");
  const zebra = header.indexOf("milestone_zebra_added");
  assert.ok(alpha > 0 && zebra > alpha);
  assert.match(csv, /Facebook ad, TikTok/);
  assert.match(csv, /"North Shore Clean"/);
});

test("a comma in the organization name stays inside one cell", () => {
  const csv = buildAccountMetricsCsv([row({ organization_name: "North, Shore" })], new Date("2026-10-14T00:00:00.000Z"));
  assert.match(csv, /"North, Shore"/);
});

test("paging stops on a short page and keeps order", async () => {
  const calls: number[] = [];
  const rows = await fetchAllAccountMetrics(async (offset, limit) => {
    calls.push(offset);
    assert.equal(limit, 2);
    if (offset === 0) return [row({ organization_id: "a" }), row({ organization_id: "b" })];
    return [row({ organization_id: "c" })];
  }, 2);
  assert.deepEqual(calls, [0, 2]);
  assert.deepEqual(rows.map((item) => item.organization_id), ["a", "b", "c"]);
});

test("a cell that starts with a formula character is prefixed with a quote", () => {
  const csv = buildAccountMetricsCsv([
    row({
      organization_name: "=HYPERLINK(\"http://evil\")",
      owner_email: "+1",
      utm_source: "-cmd",
      utm_medium: "@SUM(A1)",
      utm_campaign: "\t=1",
      referrer: "\r=1",
      how_heard: "google",
    }),
  ], new Date("2026-10-14T00:00:00.000Z"));
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
  assert.match(csv, /"'\+1"/);
  assert.match(csv, /"'-cmd"/);
  assert.match(csv, /"'@SUM\(A1\)"/);
  assert.match(csv, /"'\t=1"/);
  assert.match(csv, /"'\r=1"/);
  assert.match(csv, /"89\.00"/);
  const header = csv.split("\n").find((line) => line.startsWith('"Organization id"'));
  assert.ok(header);
  const columns = header.split(",");
  const statusIndex = columns.findIndex((column) => column === '"Subscription status"');
  const stripeIndex = columns.findIndex((column) => column === '"Stripe subscription status"');
  assert.ok(statusIndex > 0 && stripeIndex === statusIndex + 1);
  const data = csv.trim().split("\n").at(-1) ?? "";
  assert.match(data, /"past_due"|"active"/);
});

test("subscription status in the CSV is the raw Stripe status", () => {
  const csv = buildAccountMetricsCsv([
    row({ subscription_status: "past_due", stripe_subscription_status: "past_due", how_heard: "google" }),
  ], new Date("2026-10-14T00:00:00.000Z"));
  const header = csv.split("\n").find((line) => line.startsWith('"Organization id"')) ?? "";
  const columns = header.split(",");
  const data = csv.trim().split("\n").at(-1)?.split(",") ?? [];
  const statusIndex = columns.findIndex((column) => column === '"Subscription status"');
  assert.equal(data[statusIndex], '"past_due"');
});

function priceEvent(created: number, unit: number, canceledAt: number | null, livemode = false): TestModeBillingEvent {
  return {
    livemode,
    created,
    subscription: {
      items: { data: [{ quantity: 1, price: { unit_amount: unit, recurring: { interval: "month", interval_count: 1 } } }] },
      canceled_at: canceledAt,
      discounts: [],
    },
  };
}

test("a duplicate or older test-mode event does not replace a newer price or cancel date", () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.push("fetch");
    throw new Error("network");
  }) as typeof fetch;
  try {
    assert.throws(
      () => replayTestModeBillingEvents([priceEvent(1, 100, null, true)]),
      /test-mode payloads only/,
    );
    const row = replayTestModeBillingEvents([
      priceEvent(200, 9700, null),
      priceEvent(100, 1000, 1_600_000_000),
      priceEvent(200, 500, 1_600_000_100),
      priceEvent(300, 9700, 1_700_000_000),
      priceEvent(250, 111, null),
    ]);
    assert.equal(calls.length, 0);
    assert.equal(row?.unit_amount_cents, 9700);
    assert.equal(row?.canceled_at, new Date(1_700_000_000 * 1000).toISOString());
    assert.equal(row?.billing_event_at, new Date(300 * 1000).toISOString());
  } finally {
    globalThis.fetch = original;
  }
});

test("event time wins over a later stored updated time, and an equal time does not overwrite", () => {
  const storedEvent = new Date(300 * 1000).toISOString();
  const laterWrite = new Date(900 * 1000).toISOString();
  assert.equal(incomingBillingIsNewer({ billing_event_at: storedEvent, updated_at: laterWrite }, 400), true);
  assert.equal(incomingBillingIsNewer({ billing_event_at: storedEvent, updated_at: laterWrite }, 300), false);
  assert.equal(incomingBillingIsNewer({ billing_event_at: null, updated_at: new Date(500 * 1000).toISOString() }, 400), false);
  assert.equal(incomingBillingIsNewer({ billing_event_at: null, updated_at: new Date(500 * 1000).toISOString() }, 500), false);
  assert.equal(incomingBillingIsNewer({ billing_event_at: null, updated_at: new Date(500 * 1000).toISOString() }, 501), true);
  assert.equal(incomingBillingIsNewer({ billing_event_at: storedEvent }, null), false);
  assert.equal(incomingBillingIsNewer(null, 100), true);
});

test("the metrics view is not granted to org users and does not name milestone keys", () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /is_platform_admin\(\)/);
  assert.match(migration, /USING ERRCODE = '42501'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.platform_account_metrics\(integer, integer\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.platform_account_metrics\(integer, integer\) TO authenticated/);
  assert.match(migration, /REVOKE ALL ON public\.platform_account_metrics_v FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /GRANT SELECT ON public\.platform_account_metrics_v TO authenticated/);
  assert.doesNotMatch(migration, /DROP CONSTRAINT IF EXISTS organization_activation_events_milestone_check/);
  assert.match(migration, /AS subscription_status/);
  assert.match(migration, /stripe_subscription_loyalty_discount/);
  assert.match(migration, /normalized_from_annual/);
  assert.match(migration, /jsonb_object_agg/);
  assert.match(migration, /lifetime_excluded/);
  assert.doesNotMatch(migration, /first_payment_received/);
  assert.doesNotMatch(migration, /service_added/);
  assert.doesNotMatch(migration, /GRANT SELECT ON public\.platform_subscription_refunds TO authenticated/);
  const mrr = migration.slice(migration.indexOf("AS mrr_cents") - 500, migration.indexOf("AS mrr_cents"));
  assert.doesNotMatch(mrr, /organization_activation_events/);
  assert.match(mrr, /price\.monthly_amount_cents/);
  const stripeDiscountArm = migration
    .split("\n")
    .find((line) => line.includes("WHEN 'stripe' THEN COALESCE(p.sub_discount_amount_cents, 0)"));
  assert.ok(stripeDiscountArm);
  assert.doesNotMatch(stripeDiscountArm, /loyalty_discount_cents/);
});

function subscriptionPayload(
  status: string,
  periodEnd: number | null,
  unit: number,
): SubscriptionEventPayload {
  return {
    id: "sub_1",
    status,
    cancel_at_period_end: false,
    trial_end: null,
    current_period_end: periodEnd,
    canceled_at: status === "canceled" ? 1_700_000_000 : null,
    items: {
      data: [{
        quantity: 1,
        current_period_end: periodEnd,
        price: { unit_amount: unit, recurring: { interval: "month", interval_count: 1 } },
      }],
    },
    discounts: [],
  };
}

test("a deleted subscription stays canceled when an older update is replayed", async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.push("fetch");
    throw new Error("network");
  }) as typeof fetch;
  const canceled = subscriptionPayload("canceled", 1_700_100_000, 9700);
  const olderActive = subscriptionPayload("active", 1_600_000_000, 4900);
  const events: ReplaySubscriptionEvent[] = [
    { livemode: false, created: 300, type: "customer.subscription.deleted", subscription: canceled },
    { livemode: false, created: 100, type: "customer.subscription.updated", subscription: olderActive },
  ];
  try {
    const retrieved: string[] = [];
    const row = await replaySubscriptionEvents(events, {
      subscriptions: {
        retrieve: async (id) => {
          retrieved.push(id);
          return canceled;
        },
      },
    });
    assert.deepEqual(retrieved, ["sub_1", "sub_1"]);
    assert.equal(calls.length, 0);
    assert.equal(row?.status, "canceled");
    assert.equal(row?.current_period_end, new Date(1_700_100_000 * 1000).toISOString());
    assert.equal(row?.unit_amount_cents, 9700);
    assert.equal(row?.mrr_cents, null);
    assert.equal(row?.counts_toward_mrr, false);

    const fallback = await replaySubscriptionEvents(events, {
      subscriptions: {
        retrieve: async () => {
          throw new Error("stripe unavailable");
        },
      },
    });
    assert.equal(fallback?.status, "canceled");
    assert.equal(fallback?.current_period_end, new Date(1_700_100_000 * 1000).toISOString());
    assert.equal(fallback?.mrr_cents, null);
    assert.equal(fallback?.counts_toward_mrr, false);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("connected-account and unlinked refunds are ignored, and lifetime is not a subscription refund", () => {
  assert.equal(classifySaasRefund({
    account: "acct_connected",
    charge: { invoice: { id: "in_1", subscription: "sub_1" }, payment_intent: "pi_1" },
  }), null);
  assert.equal(classifySaasRefund({
    account: null,
    charge: { invoice: null, payment_intent: "pi_one_off", metadata: {} },
  }), null);
  assert.equal(classifySaasRefund({
    charge: { invoice: { id: "in_credits", subscription: null }, payment_intent: "pi_credits" },
  }), null);
  assert.deepEqual(classifySaasRefund({
    charge: { invoice: { id: "in_plan", subscription: "sub_1" }, payment_intent: "pi_plan" },
  }), { kind: "subscription", subscriptionId: "sub_1" });
  assert.deepEqual(classifySaasRefund({
    charge: { invoice: "in_plan", payment_intent: "pi_plan" },
    resolvedSubscriptionId: "sub_1",
  }), { kind: "subscription", subscriptionId: "sub_1" });
  assert.deepEqual(classifySaasRefund({
    charge: { invoice: null, payment_intent: "pi_life", metadata: { plan: "lifetime" } },
  }), { kind: "lifetime", subscriptionId: null });
  assert.deepEqual(classifySaasRefund({
    charge: { invoice: null, payment_intent: "pi_life" },
    linkedLifetimePurchase: true,
  }), { kind: "lifetime", subscriptionId: null });
  assert.equal(classifySaasRefund({
    charge: { invoice: { id: "in_ads", subscription: "sub_ads", metadata: { purpose: "tidywise_ad_management" } } },
  }), null);
});

test("an org owner and a cleaner are rejected with 42501", () => {
  const db = "platform_account_metrics_test";
  const sql = new URL("../../supabase/tests/platform_account_metrics_access.sql", import.meta.url);
  const drop = spawnSync("sudo", ["-u", "postgres", "dropdb", "--if-exists", db], { encoding: "utf8" });
  assert.equal(drop.status, 0, drop.stderr || drop.stdout);
  const create = spawnSync("sudo", ["-u", "postgres", "createdb", db], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr || create.stdout);
  const run = spawnSync("sudo", [
    "-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-f", sql.pathname,
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
});
