// Account metrics: monthly price math, CSV shape, and the admin-only SQL gate.
//
// Runner:
//   node --experimental-strip-types --test src/lib/platformAccountMetrics.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  billingTimestampRelation,
  classifySaasRefund,
  escapeIlikeExact,
  incomingBillingIsNewer,
  invoiceIdOf,
  isMissingBillingColumn,
  isMissingRelation,
  subscriptionIdFromInvoice,
  normalizeMonthlyBilledCents,
  replaySubscriptionEvents,
  replayTestModeBillingEvents,
  refundDraftsToStore,
  saasRefundDrafts,
  saasRefundInsertRows,
  subscriptionBillingSnapshot,
  subscriptionDeleteShouldDowngrade,
  subscriptionPersistHttpStatus,
  subscriptionPersistReleasesIdempotency,
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
import { PLATFORM_OWNER_EMAIL } from "./platformOwner.ts";

const migration = readFileSync(
  new URL("../../supabase/migrations/20261016050200_platform_account_metrics.sql", import.meta.url),
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
  const replaced = refundDraftsToStore(drafts, ["ch_1:unitemized"]);
  assert.equal(replaced.dropUnitemized, true);
  assert.deepEqual(replaced.rows.map((draft) => draft.stripeRefundId), ["re_1", "re_2"]);
  const placeholder = saasRefundDrafts({ id: "ch_1", refunds: { data: [] } }, 1_700_000_000);
  const kept = refundDraftsToStore(placeholder, ["re_1"]);
  assert.deepEqual(kept.rows, []);
  assert.match(migration, /stripe_refund_id LIKE '%:unitemized'/);
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
  assert.match(csv, /Facebook, TikTok/);
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
  const spaced = buildAccountMetricsCsv([
    row({ organization_name: " =HYPERLINK(\"http://evil\")", owner_email: "  +1", how_heard: "google" }),
  ], new Date("2026-10-14T00:00:00.000Z"));
  assert.match(spaced, /"' =HYPERLINK\(""http:\/\/evil""\)"/);
  assert.match(spaced, /"'  \+1"/);
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

  const basilInvoice = {
    id: "in_basil",
    parent: { subscription_details: { subscription: "sub_basil" } },
  };
  assert.equal(subscriptionIdFromInvoice(basilInvoice), "sub_basil");
  assert.equal(invoiceIdOf(basilInvoice), "in_basil");
  assert.deepEqual(classifySaasRefund({
    charge: { invoice: basilInvoice, payment_intent: "pi_basil" },
  }), { kind: "subscription", subscriptionId: "sub_basil" });
  assert.deepEqual(classifySaasRefund({
    charge: {
      invoice: {
        id: "in_both",
        parent: { subscription_details: { subscription: { id: "sub_parent" } } },
        subscription: "sub_legacy",
      },
      payment_intent: "pi_both",
    },
  }), { kind: "subscription", subscriptionId: "sub_parent" });
  assert.equal(subscriptionIdFromInvoice({
    id: "in_legacy",
    parent: { subscription_details: { subscription: null } },
    subscription: "sub_legacy",
  }), "sub_legacy");
});

test("a deleted subscription does not set a lifetime org to free", () => {
  const invoice = readFileSync(
    new URL("../../supabase/functions/stripe-invoice-webhook/index.ts", import.meta.url),
    "utf8",
  );
  const deletedAt = invoice.indexOf('event.type === "customer.subscription.deleted"');
  const failedAt = invoice.indexOf("PAYMENT FAILED", deletedAt);
  const deleted = invoice.slice(deletedAt, failedAt);
  assert.match(deleted, /downgradeOrgOnSubscriptionDeleted\(/);
  assert.doesNotMatch(deleted, /\.update\(\{ plan_type: "free" \}\)/);

  const helper = readFileSync(
    new URL("../../supabase/functions/_shared/subscription-deleted-plan.ts", import.meta.url),
    "utf8",
  );
  const updateAt = helper.indexOf('.update({ plan_type: "free" })');
  assert.ok(updateAt > 0);
  const guard = helper.slice(updateAt, updateAt + 500);
  assert.match(guard, /\.neq\("plan_type", "lifetime"\)/);
  assert.match(guard, /\.or\(EXCLUDE_GRANDFATHERED_LIFETIME\)/);
  // Null grandfathered_lifetime still matches. .not(..., "is", true) would
  // drop those rows because NULL is not true is unknown in SQL.
  assert.match(
    helper,
    /EXCLUDE_GRANDFATHERED_LIFETIME\s*=\s*"grandfathered_lifetime\.is\.null,grandfathered_lifetime\.eq\.false"/,
  );
});

test("a failed refund write releases the claim so the retry stores the refund", async () => {
  const invoice = readFileSync(
    new URL("../../supabase/functions/stripe-invoice-webhook/index.ts", import.meta.url),
    "utf8",
  );
  const persistAt = invoice.indexOf("const saved = await persistSaasRefunds(");
  const flagAt = invoice.indexOf("if (!saved) subscriptionStateFailed = true", persistAt);
  const releaseAt = invoice.indexOf('from("stripe_webhook_events")\n          .delete()', persistAt);
  assert.ok(persistAt > 0);
  assert.ok(flagAt > persistAt);
  assert.ok(releaseAt > flagAt);

  const claims = new Set<string>();
  const stored: string[] = [];
  const deliver = async (writeFails: boolean) => {
    const eventId = "evt_refund";
    if (claims.has(eventId)) return { status: 200, duplicate: true };
    claims.add(eventId);
    if (writeFails) {
      if (subscriptionPersistReleasesIdempotency("failed")) claims.delete(eventId);
      return { status: subscriptionPersistHttpStatus("failed"), duplicate: false };
    }
    stored.push(eventId);
    return { status: subscriptionPersistHttpStatus("wrote"), duplicate: false };
  };

  const first = await deliver(true);
  assert.equal(first.status, 500);
  assert.equal(first.duplicate, false);
  const retry = await deliver(false);
  assert.equal(retry.duplicate, false);
  assert.equal(retry.status, 200);
  assert.deepEqual(stored, ["evt_refund"]);
});

test("a paying non-lifetime org is not demo, and is_test still applies", () => {
  const start = migration.indexOf("A real paying subscription is not a demo org");
  const end = migration.indexOf("AS is_demo_or_test", start);
  const block = migration.slice(start, end);
  assert.ok(start > 0 && end > start);
  const whenAt = block.indexOf("s.status IN ('active', 'past_due')");
  const thenAt = block.indexOf("THEN false");
  const elseAt = block.indexOf("ELSE public.activation_subject_is_demo(o.id)");
  const caseEnd = block.indexOf("END");
  assert.ok(whenAt > 0);
  assert.ok(thenAt > whenAt);
  assert.ok(elseAt > thenAt);
  assert.ok(caseEnd > elseAt);
  assert.match(block, /grandfathered_lifetime IS TRUE/);
  assert.match(block, /starts_with\(coalesce\(s\.stripe_subscription_id, ''\), 'lifetime_'\)/);
  const afterCase = block.slice(caseEnd);
  assert.match(afterCase, /jsonb_flag_true\(to_jsonb\(o\), 'is_test'\)/);
  assert.match(afterCase, /jsonb_flag_true\(to_jsonb\(ps\), 'is_test'\)/);
  assert.doesNotMatch(
    migration,
    /CREATE OR REPLACE FUNCTION public\.activation_subject_is_demo/,
  );
});

test("created and deleted side effects run only after the subscription mirror", () => {
  const invoice = readFileSync(
    new URL("../../supabase/functions/stripe-invoice-webhook/index.ts", import.meta.url),
    "utf8",
  );
  const createdAt = invoice.indexOf('event.type === "customer.subscription.created"');
  const updatedAt = invoice.indexOf('event.type === "customer.subscription.updated"');
  const created = invoice.slice(createdAt, updatedAt);
  const mirrorAt = created.indexOf("upsertStripeSubscription(");
  const wroteAt = created.indexOf('outcome === "wrote"');
  const gateAt = created.indexOf("if (notifyAfterMirror)");
  assert.ok(wroteAt > mirrorAt);
  assert.ok(gateAt > wroteAt);
  const adminAt = created.indexOf("sendAdminNotification", gateAt);
  const emailAt = created.indexOf("hook.us2.make.com");
  assert.ok(mirrorAt > 0);
  assert.ok(gateAt > mirrorAt);
  assert.ok(adminAt > gateAt);
  assert.ok(emailAt > adminAt);

  const deletedAt = invoice.indexOf('event.type === "customer.subscription.deleted"');
  const failedAt = invoice.indexOf("PAYMENT FAILED", deletedAt);
  const deleted = invoice.slice(deletedAt, failedAt);
  const mirrorWrite = deleted.indexOf('.from("stripe_subscriptions")');
  const cancelAt = deleted.indexOf("stripe.subscriptions.cancel");
  const noticeAt = deleted.indexOf("Ad Mgmt Cascade-Cancelled");
  const catchAt = deleted.indexOf("subscription.deleted handler error");
  assert.ok(mirrorWrite > 0);
  assert.ok(cancelAt > mirrorWrite);
  assert.ok(noticeAt > cancelAt);
  assert.ok(catchAt > noticeAt);
  const cascade = deleted.slice(cancelAt, catchAt);
  assert.doesNotMatch(cascade, /subscriptionStateFailed\s*=\s*true/);
  assert.match(deleted.slice(catchAt), /subscriptionStateFailed = true/);
  assert.doesNotMatch(deleted, /org_memberships/);
  assert.match(deleted, /organizationIdForDeletedSubscription/);
  assert.match(deleted, /subscription delete customer retrieve failed/);
});

test("a failed subscription write returns 500 and releases the idempotency claim", () => {
  assert.equal(subscriptionPersistHttpStatus("failed"), 500);
  assert.equal(subscriptionPersistHttpStatus("wrote"), 200);
  assert.equal(subscriptionPersistHttpStatus("skipped"), 200);
  assert.equal(subscriptionPersistReleasesIdempotency("failed"), true);
  assert.equal(subscriptionPersistReleasesIdempotency("wrote"), false);
  assert.equal(subscriptionPersistReleasesIdempotency("skipped"), false);

  const invoice = readFileSync(
    new URL("../../supabase/functions/stripe-invoice-webhook/index.ts", import.meta.url),
    "utf8",
  );
  const subscription = readFileSync(
    new URL("../../supabase/functions/_shared/subscription-webhook-event.ts", import.meta.url),
    "utf8",
  );
  assert.match(invoice, /subscriptionPersistHttpStatus\("failed"\)/);
  assert.match(invoice, /subscriptionPersistReleasesIdempotency\("failed"\)/);
  assert.match(invoice, /from\("stripe_webhook_events"\)\s*\.delete\(\)/);
  assert.match(invoice, /return "skipped"/);
  assert.match(subscription, /subscriptionPersistHttpStatus\("failed"\)/);
  const retryAt = subscription.indexOf('subscriptionPersistHttpStatus("failed")');
  const smsAt = subscription.indexOf("Trial -> paid conversion notification");
  assert.ok(retryAt > 0);
  assert.ok(smsAt > retryAt);
});

test("a referral reversal matches the qualifying charge, not any refund on the subscription", () => {
  const source = readFileSync(
    new URL("../../supabase/functions/_shared/saas-referral-db.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function recordReferralReversal");
  const fn = source.slice(start);
  assert.ok(start > 0);
  assert.match(fn, /qualifying_charge_id/);
  assert.match(fn, /qualifying_invoice_id/);
  assert.doesNotMatch(fn, /referred_org_id/);
});

test("platform admin is the support address only", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20261016040000_platform_admin_support_only.sql", import.meta.url),
    "utf8",
  );
  const allowlist = sql.slice(sql.indexOf("lower(email) IN"), sql.indexOf("REVOKE EXECUTE"));
  assert.match(allowlist, /support@tidywisecleaning\.com/);
  assert.doesNotMatch(allowlist, /@gmail\.com/);
  assert.equal(PLATFORM_OWNER_EMAIL, "support@tidywisecleaning.com");
  assert.match(allowlist, new RegExp(PLATFORM_OWNER_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const access = readFileSync(
    new URL("../../supabase/tests/platform_account_metrics_access.sql", import.meta.url),
    "utf8",
  );
  assert.match(access, /SET LOCAL ROLE authenticated/);
  assert.match(access, /SET LOCAL ROLE anon/);
});

test("a missing billing column is only 42703 or PGRST204", () => {
  assert.equal(isMissingBillingColumn({ code: "42703", message: "column billing_event_at does not exist" }), true);
  assert.equal(isMissingBillingColumn({ code: "PGRST204", message: "Could not find the 'refund_kind' column of 'platform_subscription_refunds' in the schema cache" }), true);
  assert.equal(isMissingBillingColumn({ message: "column billing_event_at does not exist" }), false);
  assert.equal(isMissingBillingColumn({ code: "42P01", message: "relation platform_subscription_refunds does not exist" }), false);
  assert.equal(isMissingBillingColumn({ code: "PGRST205", message: "Could not find the table 'public.platform_subscription_refunds' in the schema cache" }), false);
  assert.equal(isMissingBillingColumn(null), false);
  assert.equal(isMissingRelation({ code: "42P01", message: "relation platform_subscription_refunds does not exist" }), true);
  assert.equal(isMissingRelation({ code: "PGRST205", message: "Could not find the table in the schema cache" }), true);
  assert.equal(isMissingRelation({ code: "42703", message: "column refund_kind does not exist" }), false);
  assert.equal(isMissingRelation({ code: "PGRST204", message: "column missing" }), false);
  assert.equal(isMissingRelation(null), false);
});

test("an equal-timestamp terminal delete still downgrades when retrieve failed", () => {
  const storedAt = new Date(1_700_000_000 * 1000).toISOString();
  const stored = { billing_event_at: storedAt, updated_at: storedAt };
  assert.equal(billingTimestampRelation(stored, 1_700_000_000), "equal");
  assert.equal(incomingBillingIsNewer(stored, 1_700_000_000), false);
  assert.equal(subscriptionDeleteShouldDowngrade({
    authoritative: false,
    status: "canceled",
    stored,
    incomingCreatedSec: 1_700_000_000,
    blocked: false,
  }), true);
  assert.equal(subscriptionDeleteShouldDowngrade({
    authoritative: false,
    status: "canceled",
    stored,
    incomingCreatedSec: 1_699_000_000,
    blocked: false,
  }), false);
  assert.equal(subscriptionDeleteShouldDowngrade({
    authoritative: true,
    status: "active",
    stored,
    incomingCreatedSec: 1_700_000_000,
    blocked: false,
  }), false);
  assert.equal(subscriptionDeleteShouldDowngrade({
    authoritative: false,
    status: "canceled",
    stored,
    incomingCreatedSec: 1_700_000_100,
    blocked: false,
  }), true);
});

test("invoice delete uses the downgrade helper and checkout notifies after the mirror", () => {
  const invoice = readFileSync(
    new URL("../../supabase/functions/stripe-invoice-webhook/index.ts", import.meta.url),
    "utf8",
  );
  const deletedAt = invoice.indexOf('event.type === "customer.subscription.deleted"');
  const failedAt = invoice.indexOf("PAYMENT FAILED", deletedAt);
  const deleted = invoice.slice(deletedAt, failedAt);
  assert.match(deleted, /subscriptionDeleteShouldDowngrade\(/);
  assert.match(deleted, /downgradeOrgOnSubscriptionDeleted\(/);
  assert.doesNotMatch(deleted, /if \(applyState && !subscriptionStateFailed/);
  const unresolved = deleted.slice(
    deleted.indexOf("if (!organizationId)"),
    deleted.indexOf("Mark the org's subscription row"),
  );
  assert.match(unresolved, /logSubscriptionOrphan\(/);
  assert.doesNotMatch(unresolved, /subscriptionStateFailed/);
  const reader = invoice.slice(
    invoice.indexOf("async function readCurrentSaasSubscription"),
    invoice.indexOf("async function upsertStripeSubscription"),
  );
  assert.match(reader, /stripe\.subscriptions\.retrieve/);
  assert.doesNotMatch(reader, /billingStripe\(/);

  const checkoutAt = invoice.indexOf('event.type === "checkout.session.completed"');
  const paidAt = invoice.indexOf('event.type === "invoice.paid"', checkoutAt);
  const checkout = invoice.slice(checkoutAt, paidAt);
  const mirrorAt = checkout.indexOf("upsertStripeSubscription(");
  const adminAt = checkout.indexOf('subscriptionType: "New Subscription"');
  const emailAt = checkout.indexOf("hook.us2.make.com");
  assert.ok(mirrorAt > 0);
  assert.ok(adminAt > mirrorAt);
  assert.ok(emailAt > adminAt);

  const refundAt = invoice.indexOf('event.type === "charge.refunded"');
  const disputeAt = invoice.indexOf("DISPUTE", refundAt);
  const refund = invoice.slice(refundAt, disputeAt);
  assert.match(refund, /persistSaasRefunds\(/);
  assert.match(refund, /if \(!saved\) subscriptionStateFailed = true/);
  const persist = invoice.slice(
    invoice.indexOf("async function persistSaasRefunds"),
    invoice.indexOf("function resolvePlanTierFromSubscription"),
  );
  assert.match(persist, /saasRefundInsertRows\(/);
  assert.match(persist, /stripe\.invoices\.retrieve/);
  assert.doesNotMatch(persist, /billingStripe\(/);
  assert.match(persist, /invoice retrieve failed; Stripe will retry the refund/);
  assert.match(persist, /lifetime purchase lookup failed; Stripe will retry the refund/);
  assert.match(persist, /isMissingRelation\(/);
  assert.match(persist, /platform_subscription_refunds is not migrated yet/);
  assert.match(persist, /\.not\("organization_id", "is", null\)/);
  assert.match(persist, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(persist, /return false/);
  assert.equal((invoice.match(/await upsertStripeSubscription\(/g) ?? []).length, 3);
  assert.doesNotMatch(
    invoice.slice(invoice.indexOf('event.type === "invoice.paid"')),
    /await upsertStripeSubscription\(/,
  );
  for (const source of [
    invoice,
    readFileSync(new URL("../../supabase/functions/_shared/subscription-deleted-plan.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../supabase/functions/_shared/subscription-webhook-event.ts", import.meta.url), "utf8"),
  ]) {
    const releases = [...source.matchAll(/from\("stripe_webhook_events"\)\s*\.delete\(\)([\s\S]{0,240})/g)];
    assert.ok(releases.length > 0);
    for (const release of releases) assert.match(release[1], /\.eq\("source"/);
  }
});

test("a subscription refund persists kind and replaces the placeholder row", () => {
  const drafts = saasRefundDrafts({
    id: "ch_sub",
    customer: "cus_1",
    invoice: "in_1",
    currency: "usd",
    refunds: { data: [{ id: "re_9", amount: 9700, created: 1_700_000_100 }] },
  }, 1_700_000_000);
  const stored = saasRefundInsertRows({
    drafts,
    storedRefundIds: ["ch_sub:unitemized"],
    organizationId: "org-1",
    kind: "subscription",
    subscriptionId: "sub_1",
  });
  assert.equal(stored.dropUnitemized, true);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].stripe_refund_id, "re_9");
  assert.equal(stored.rows[0].refund_kind, "subscription");
  assert.equal(stored.rows[0].stripe_subscription_id, "sub_1");
  assert.equal(stored.rows[0].organization_id, "org-1");
  assert.equal(stored.rows[0].source, "charge.refunded");

  const lifetime = saasRefundInsertRows({
    drafts: saasRefundDrafts({ id: "ch_life", refunds: { data: [] } }, 1_700_000_000),
    storedRefundIds: [],
    organizationId: "org-life",
    kind: "lifetime",
    subscriptionId: null,
  });
  assert.equal(lifetime.rows[0].stripe_refund_id, "ch_life:unitemized");
  assert.equal(lifetime.rows[0].refund_kind, "lifetime");
  assert.equal(lifetime.dropUnitemized, false);
});

test("exact email matches escape LIKE wildcards", () => {
  assert.equal(escapeIlikeExact("owner_name@example.com"), "owner\\_name@example.com");
  assert.equal(escapeIlikeExact("100%@example.com"), "100\\%@example.com");
  assert.equal(escapeIlikeExact("a\\b@example.com"), "a\\\\b@example.com");
});

test("metrics function returns the view and the claim key is per source", () => {
  assert.match(migration, /RETURNS SETOF public\.platform_account_metrics_v/);
  const claim = readFileSync(
    new URL("../../supabase/migrations/20261016050100_stripe_webhook_events_source_key.sql", import.meta.url),
    "utf8",
  );
  assert.match(claim, /PRIMARY KEY \(event_id, source\)/);
  assert.match(claim, /c\.conname/);
  assert.match(claim, /DROP CONSTRAINT %I/);
  assert.match(migration, /DROP VIEW IF EXISTS public\.platform_account_metrics_v CASCADE/);
  const admin = "20261016040000_platform_admin_support_only.sql";
  const metrics = "20261016050200_platform_account_metrics.sql";
  const afterMain = "20261015040000_sms_message_opt_out_review.sql";
  assert.ok(admin > afterMain);
  assert.ok(metrics > afterMain);
  assert.ok(metrics > admin);
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
