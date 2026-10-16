// Runner (this file is executed; vitest is not installed and reports no suite):
//   node --experimental-strip-types --test src/lib/planBillingCopy.test.ts
// tsconfig.app.json sets allowImportingTsExtensions and excludes *.test.ts,
// so `tsc -p tsconfig.app.json` does not typecheck this import. Node does.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOWNGRADE_EFFECT_NOTE,
  CHARGE_TODAY_NO_AMOUNT,
  chargeLineFromPreview,
  chargePreviewRefetchMs,
  expiredTrialNudgeCopy,
  formatChargeDollars,
  lifetimeSpotsToShow,
  planBillingAction,
  planChoicesFooter,
  renewalDisclosure,
  showPlanChoices,
  todayChargeCopy,
  trialEndDateLabel,
  visibleBillingLine,
} from "./planBillingCopy.ts";
import {
  WINBACK_PERCENT_OFF,
  amountCentsAfterDiscounts,
  chooseCheckoutOrg,
  subscriptionChargeTiming,
} from "../../supabase/functions/_shared/subscription-charge.ts";
import { stripeTrialEndUnix as stripeTrialEndForTiming } from "../../supabase/functions/_shared/trial-end.ts";
import { stripeTrialEndUnix } from "../../supabase/functions/_shared/trial-end.ts";
import { LIFETIME_SPOT_CAP, PUBLIC_TIERS } from "./publicPlans.ts";

test("basic and pro stay on checkout and custom is contact", () => {
  assert.equal(planBillingAction("basic"), "checkout");
  assert.equal(planBillingAction("pro"), "checkout");
  assert.equal(planBillingAction("custom"), "contact");
});

test("renewal disclosure names the real price and how to cancel", () => {
  assert.equal(
    renewalDisclosure(49),
    "Renews monthly at $49 until you cancel. Cancel anytime in Settings.",
  );
  assert.equal(
    renewalDisclosure(97),
    "Renews monthly at $97 until you cancel. Cancel anytime in Settings.",
  );
  assert.equal(
    renewalDisclosure(490, "yearly"),
    "Renews yearly at $490 until you cancel. Cancel anytime in Settings.",
  );
  assert.equal(renewalDisclosure(0), "");
});

test("trial charge copy follows stripeTrialEndUnix, the same rule as create-subscription", () => {
  // Nov 13, 11:00pm Eastern is already Nov 14 in UTC.
  const elevenPmEastern = "2026-11-14T04:00:00.000Z";
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  assert.equal(trialEndDateLabel(elevenPmEastern, "America/New_York"), "Nov 13");
  assert.equal(trialEndDateLabel(elevenPmEastern, "UTC"), "Nov 14");
  assert.equal(trialEndDateLabel(null, "America/New_York"), null);
  assert.equal(trialEndDateLabel("not-a-date", "America/New_York"), null);
  assert.equal(trialEndDateLabel(elevenPmEastern, ""), null);

  assert.equal(stripeTrialEndUnix(elevenPmEastern, now) != null, true);
  const eastern = chargeLineFromPreview({
    billNow: false,
    firstChargeAt: elevenPmEastern,
    amountCents: null,
    timeZone: "America/New_York",
  });
  assert.equal(eastern, "Your first charge is Nov 13, 2026.");
  assert.equal(
    chargeLineFromPreview({
      billNow: false,
      firstChargeAt: elevenPmEastern,
      amountCents: null,
      timeZone: "UTC",
    }),
    "Your first charge is Nov 14, 2026.",
  );

  const soon = new Date(now + 36 * 60 * 60 * 1000).toISOString();
  assert.equal(stripeTrialEndUnix(soon, now), null);

  const exactly48h = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  assert.equal(stripeTrialEndUnix(exactly48h, now) != null, true);
  assert.match(
    chargeLineFromPreview({
      billNow: false,
      firstChargeAt: exactly48h,
      amountCents: null,
      timeZone: "America/New_York",
    }) ?? "",
    /^Your first charge is /,
  );

  const justUnder = new Date(now + 48 * 60 * 60 * 1000 - 1000).toISOString();
  assert.equal(stripeTrialEndUnix(justUnder, now), null);

  assert.equal(
    chargeLineFromPreview({ billNow: false, firstChargeAt: null, amountCents: null, timeZone: "America/New_York" }),
    null,
  );
  assert.equal(
    chargeLineFromPreview({ billNow: false, firstChargeAt: "not-a-date", amountCents: null, timeZone: "America/New_York" }),
    null,
  );
  assert.equal(
    chargeLineFromPreview({ billNow: false, firstChargeAt: elevenPmEastern, amountCents: null, timeZone: "Not/AZone" }),
    null,
  );
  const copySource = readFileSync(new URL("./planBillingCopy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(copySource, /function trialFirstChargeLine/);
  assert.doesNotMatch(copySource, /function trialBillsOnCheckout/);

  const innerPx = 375 - 32 - 40;
  assert.ok(eastern);
  assert.ok(eastern.length * 6.6 <= innerPx);
  assert.ok("You'll be charged $1970 today.".length * 6.6 <= innerPx);
});

test("the charge preview uses the server clock and the discounted cents", () => {
  const now = Date.parse("2026-10-16T16:00:00.000Z");
  const soon = new Date(now + 36 * 60 * 60 * 1000).toISOString();
  const exactly48h = new Date(now + 48 * 60 * 60 * 1000).toISOString();
  const billedNow = subscriptionChargeTiming({
    hasUser: true,
    orgPlanType: "trial",
    trialEndsAt: soon,
    nowMs: now,
  });
  assert.equal(billedNow.billNow, true);
  assert.equal(billedNow.firstChargeAt, null);
  assert.equal(billedNow.trialEndUnix, null);
  assert.equal(billedNow.trialPeriodDays, null);
  assert.equal(stripeTrialEndForTiming(soon, now), null);

  const held = subscriptionChargeTiming({
    hasUser: true,
    orgPlanType: "trial",
    trialEndsAt: exactly48h,
    nowMs: now,
  });
  assert.equal(held.billNow, false);
  assert.equal(held.trialEndUnix, stripeTrialEndForTiming(exactly48h, now));
  assert.equal(held.firstChargeAt, new Date(held.trialEndUnix! * 1000).toISOString());

  const missing = subscriptionChargeTiming({
    hasUser: true,
    orgPlanType: "trial",
    trialEndsAt: null,
    nowMs: now,
  });
  assert.equal(missing.billNow, true);

  const existing = subscriptionChargeTiming({
    hasUser: true,
    orgPlanType: "pro",
    trialEndsAt: exactly48h,
    nowMs: now,
  });
  assert.equal(existing.billNow, false);
  assert.equal(existing.trialPeriodDays, 14);
  assert.equal(existing.paymentMethodCollection, "always");

  const anonymous = subscriptionChargeTiming({
    hasUser: false,
    orgPlanType: null,
    trialEndsAt: null,
    nowMs: now,
  });
  assert.equal(anonymous.trialPeriodDays, 30);
  assert.equal(anonymous.paymentMethodCollection, "if_required");

  assert.equal(amountCentsAfterDiscounts(9700, { percentOff: 50 }), 4850);
  assert.equal(amountCentsAfterDiscounts(9700, { percentOff: WINBACK_PERCENT_OFF.first_month_free }), 0);
  assert.equal(amountCentsAfterDiscounts(9700, { amountOffCents: 500 }), 9200);
  assert.equal(WINBACK_PERCENT_OFF.half_off_first_month, 50);

  const chosen = chooseCheckoutOrg(
    [
      { role: "owner", organizations: { id: "paid", plan_type: "pro" } },
      { role: "staff", organizations: { id: "trial-org", plan_type: "trial" } },
    ],
    "",
  );
  assert.equal(chosen.referredOrgId, "trial-org");
  assert.equal(chosen.orgPlanType, "trial");
  const requested = chooseCheckoutOrg(
    [
      { role: "owner", organizations: { id: "paid", plan_type: "pro" } },
      { role: "staff", organizations: { id: "trial-org", plan_type: "trial" } },
    ],
    "paid",
  );
  assert.equal(requested.orgPlanType, "pro");

  assert.equal(formatChargeDollars(4850), "$48.50");
  assert.equal(formatChargeDollars(9700), "$97");
  assert.equal(CHARGE_TODAY_NO_AMOUNT, "You'll be charged today.");
  assert.equal(visibleBillingLine(null), null);
  assert.equal(visibleBillingLine(""), null);
  assert.equal(visibleBillingLine("   "), null);
  assert.equal(visibleBillingLine("Renews monthly at $49 until you cancel. Cancel anytime in Settings."), renewalDisclosure(49));
  assert.equal(
    chargeLineFromPreview({
      billNow: true,
      firstChargeAt: null,
      amountCents: null,
      timeZone: "America/New_York",
    }),
    "You'll be charged today.",
  );
  assert.equal(
    chargeLineFromPreview({
      billNow: true,
      firstChargeAt: null,
      amountCents: 4850,
      timeZone: "America/New_York",
    }),
    "You'll be charged $48.50 today.",
  );
  const inThreeDays = new Date(now + 72 * 60 * 60 * 1000).toISOString();
  assert.equal(
    chargePreviewRefetchMs(
      { pro: { bill_now: false, first_charge_at: inThreeDays } },
      now,
    ),
    24 * 60 * 60 * 1000,
  );
  const insideLead = new Date(now + 10 * 60 * 60 * 1000).toISOString();
  assert.equal(
    chargePreviewRefetchMs(
      { pro: { bill_now: false, first_charge_at: insideLead } },
      now,
    ),
    60_000,
  );
  assert.equal(
    chargePreviewRefetchMs({ pro: { bill_now: true, first_charge_at: null } }, now),
    false,
  );
  const hook = readFileSync(new URL("../hooks/useSubscriptionChargePreview.ts", import.meta.url), "utf8");
  assert.match(hook, /chargePreviewRefetchMs/);
  assert.match(hook, /refetchOnWindowFocus: true/);
  assert.equal(todayChargeCopy(undefined, "America/New_York"), null);
  assert.equal(todayChargeCopy(null, "America/New_York"), null);
  assert.equal(
    todayChargeCopy(
      { bill_now: true, first_charge_at: null, amount_cents_after_discounts: null },
      "America/New_York",
    ),
    "You'll be charged today.",
  );
  assert.equal(
    todayChargeCopy(
      { bill_now: true, first_charge_at: null, amount_cents_after_discounts: 4850 },
      "America/New_York",
    ),
    "You'll be charged $48.50 today.",
  );
  assert.equal(
    todayChargeCopy(
      { bill_now: false, first_charge_at: exactly48h, amount_cents_after_discounts: 9700 },
      "America/New_York",
    ),
    null,
  );
  assert.equal(
    chargeLineFromPreview({
      billNow: false,
      firstChargeAt: exactly48h,
      amountCents: 4850,
      timeZone: "America/New_York",
    })?.startsWith("Your first charge is "),
    true,
  );

  const preview = readFileSync(new URL("../../supabase/functions/preview-subscription-charge/index.ts", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../../supabase/functions/create-subscription/index.ts", import.meta.url), "utf8");
  assert.match(preview, /subscriptionChargeTiming/);
  assert.match(preview, /lookupCheckoutDiscount/);
  assert.doesNotMatch(preview, /checkout\.sessions\.create/);
  assert.doesNotMatch(preview, /coupons\.create/);
  assert.doesNotMatch(preview, /\.update\(/);
  assert.match(checkout, /subscriptionChargeTiming/);
  assert.match(checkout, /lookupCheckoutDiscount/);
  const pricing = readFileSync(new URL("../pages/PricingPage.tsx", import.meta.url), "utf8");
  assert.match(pricing, /LIFETIME_SPOT_CAP\} spots only/);
  assert.doesNotMatch(pricing, /\(100 spots only\)/);
  const switcher = readFileSync(new URL("../components/subscription/PlanSwitcher.tsx", import.meta.url), "utf8");
  const dialogs = readFileSync(new URL("../components/subscription/PlanChangeDialogs.tsx", import.meta.url), "utf8");
  const choose = readFileSync(new URL("../pages/ChoosePlanPage.tsx", import.meta.url), "utf8");
  assert.match(switcher, /choosingFirstPlan = organization\?\.plan_type === "trial"/);
  assert.match(switcher, /rawPlanType: organization\?\.plan_type \?\? currentPlanId/);
  assert.doesNotMatch(switcher, /currentPlanId === "trial" \|\| isActiveOrgTrial/);
  assert.doesNotMatch(switcher, /choosingFirstPlan = isActiveOrgTrial/);
  assert.doesNotMatch(switcher, /showRenewal = true;\s*planButton = onTheWebsite/);
  assert.match(switcher, /showChargeLine && orgTrialCheckout && !contactPlan/);
  assert.match(switcher, /showRenewal && !contactPlan \? renewalDisclosure/);
  assert.doesNotMatch(pricing, /isActiveOrgTrial/);
  assert.match(pricing, /organization\?\.plan_type === 'trial'/);
  assert.doesNotMatch(choose, /isActiveOrgTrial/);
  assert.doesNotMatch(dialogs, /isActiveOrgTrial/);
  assert.match(switcher, /visibleBillingLine/);
  assert.match(pricing, /orgTrialCheckout && !contactPlan \? todayChargeCopy/);
  assert.match(pricing, /contactPlan \? null : renewalDisclosure/);
  assert.match(choose, /orgTrialCheckout && !contactPlan \? todayChargeCopy/);
  assert.match(choose, /contactPlan \? null : renewalDisclosure/);
  assert.match(dialogs, /contactPlan \? null : renewalDisclosure/);
  assert.match(dialogs, /enabled: open && canShowPaymentFlows && orgTrialCheckout/);
  assert.match(dialogs, /if \(!open \|\| !targetPlan \|\| !canShowPaymentFlows\) return/);
  assert.match(dialogs, /if \(!targetPlan \|\| !canShowPaymentFlows\) return/);
  assert.match(dialogs, /This app cannot take a card/);
  assert.doesNotMatch(dialogs, /CHARGE_TODAY_NO_AMOUNT/);
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /subscription-charge-preview/);
  assert.doesNotMatch(readFileSync(new URL("./planBillingCopy.ts", import.meta.url), "utf8"), /You'll be charged \$\$\{/);
});

test("Custom is $197/mo in the app and in SEO copy", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const comparison = read("../components/landing/CompetitorComparison.tsx");
  const switcher = read("../components/subscription/PlanSwitcher.tsx");
  const seo = read("../components/seo/AuthSEOContent.tsx");
  const pricing = read("../pages/PricingPage.tsx");
  const schema = read("./seo/schemas.ts");
  const facts = read("../../supabase/functions/generate-daily-blogs/index.ts");
  const pricingMd = read("../../public/pricing.md");
  const customPrice = PUBLIC_TIERS.find((tier) => tier.id === "custom")?.monthlyPrice;
  assert.equal(customPrice, 197);
  assert.deepEqual(
    PUBLIC_TIERS.map((tier) => [tier.id, tier.monthlyPrice, tier.yearlyPrice]),
    [
      ["basic", 49, 490],
      ["pro", 97, 970],
      ["custom", 197, 1970],
    ],
  );
  assert.match(switcher, /PUBLIC_TIERS\.map/);
  assert.doesNotMatch(switcher, /monthlyPrice:\s*(49|97|197)\b/);
  assert.match(comparison, /\$\$\{tier\.monthlyPrice\}\/mo/);
  assert.match(comparison, /custom\.monthlyPrice/);
  assert.doesNotMatch(comparison, /Booking Koala/);
  assert.doesNotMatch(comparison, /Jobber/);
  assert.doesNotMatch(comparison, /\$349/);
  assert.doesNotMatch(comparison, /bookingKoala/);
  assert.doesNotMatch(switcher, /plan\.id !== "custom"/);
  assert.match(switcher, /\/mo/);
  assert.match(schema, /id === "custom"\)\?\.monthlyPrice\}\/mo for Custom/);
  assert.doesNotMatch(schema, /\$197\/month/);
  for (const source of [seo, pricing, facts, pricingMd]) {
    assert.match(source, /\$197\/mo/);
    assert.doesNotMatch(source, /\$197\/month/);
    assert.doesNotMatch(source, /Custom \$197(?!\/mo)/);
  }
});

test("the lifetime cap is one shared constant at 100", () => {
  assert.equal(LIFETIME_SPOT_CAP, 100);
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const cap = read("../../supabase/functions/_shared/lifetime-cap.ts");
  const plans = read("./publicPlans.ts");
  const seo = read("../components/seo/AuthSEOContent.tsx");
  const counter = read("../hooks/useLifetimeCounter.ts");
  const signup = read("../pages/SignupPage.tsx");
  const spotsHelper = read("../../supabase/functions/_shared/lifetime-spots.ts");
  assert.match(spotsHelper, /lifetime_offer_state/);
  assert.match(spotsHelper, /total_spots/);
  assert.match(spotsHelper, /\?\? LIFETIME_SPOT_CAP/);
  assert.match(spotsHelper, /lifetime_access_purchases/);
  assert.match(spotsHelper, /count:\s*"exact"/);
  assert.doesNotMatch(spotsHelper, /sold_spots/);
  const lifetimeCheckout = read("../../supabase/functions/create-lifetime-checkout/index.ts");
  const lifetimeSpots = read("../../supabase/functions/get-lifetime-spots/index.ts");
  const buyLifetime = read("../../supabase/functions/buy-lifetime/index.ts");
  for (const source of [lifetimeCheckout, lifetimeSpots, buyLifetime]) {
    assert.match(source, /countLifetimeSpots/);
    assert.doesNotMatch(source, /sold_spots/);
  }
  const consumers = [
    "../../supabase/functions/_shared/lifetime-spots.ts",
    "../../supabase/functions/generate-daily-blogs/index.ts",
    "../../supabase/functions/get-lifetime-spots/index.ts",
  ].map(read);
  const schema = read("./seo/schemas.ts");
  const webhook = read("../../supabase/functions/stripe-invoice-webhook/index.ts");
  assert.match(webhook, /from "\.\.\/_shared\/lifetime-cap\.ts"/);
  assert.match(webhook, /offerRow\?\.total_spots \?\? LIFETIME_SPOT_CAP/);
  assert.doesNotMatch(webhook, /50 spots/);
  assert.doesNotMatch(webhook, /51st/);
  assert.doesNotMatch(webhook, /Spot #51/);
  const dialog = read("../components/admin/SubscriptionDialog.tsx");
  assert.match(dialog, /LIFETIME_PRICE/);
  assert.match(dialog, /PUBLIC_TIERS\.find/);
  assert.doesNotMatch(dialog, /\$200/);
  assert.doesNotMatch(dialog, /\$97</);
  const blogIndex = read("../pages/blog/BlogIndex.tsx");
  const crm = read("../pages/blog/CleaningBusinessCRM.tsx");
  const routes = read("../pages/features/RouteOptimization.tsx");
  assert.doesNotMatch(blogIndex, /Join 5,000/);
  assert.doesNotMatch(crm, /4\.9\/5/);
  assert.doesNotMatch(routes, /25%/);
  assert.doesNotMatch(routes, /fuel costs/i);
  for (const page of ["CompareBookingKoala", "CompareJobber", "CompareHousecallPro"]) {
    assert.doesNotMatch(read(`../pages/compare/${page}.tsx`), /4\.9★/);
  }
  assert.match(schema, /limited to \$\{LIFETIME_SPOT_CAP\} spots/);
  assert.match(schema, /LIFETIME_PRICE/);
  assert.doesNotMatch(schema, /limited to 100 spots/);
  assert.doesNotMatch(schema, /\$300/);
  assert.doesNotMatch(schema, /"300"/);
  assert.match(read("../pages/PricingPage.tsx"), /LIFETIME_PRICE/);
  const payroll = read("../pages/blog/PayrollSoftwareForCleaners.tsx");
  assert.doesNotMatch(payroll, /\$40\/month/);
  assert.doesNotMatch(payroll, /\$45\/month/);
  assert.doesNotMatch(payroll, /\$65\/month/);
  assert.doesNotMatch(read("../lib/routeMeta.ts"), /fuel costs up to 25%/);
  const launch = read("../pages/compare/CompareLaunch27.tsx");
  assert.match(launch, /With payroll", tw: "\$97\/mo \(Pro\)"/);
  assert.doesNotMatch(launch, /With payroll", tw: "\$49/);
  assert.doesNotMatch(crm, /all features for \$49\/month/);
  assert.match(cap, /export const LIFETIME_SPOT_CAP = 100/);
  assert.match(plans, /lifetime-cap\.ts/);
  assert.doesNotMatch(plans, /LIFETIME_SPOT_CAP = 100/);
  assert.match(seo, /LIFETIME_SPOT_CAP/);
  assert.doesNotMatch(seo, /first 50 customers/);
  assert.match(counter, /LIFETIME_SPOT_CAP/);
  assert.match(signup, /LIFETIME_SPOT_CAP/);
  assert.doesNotMatch(signup, /one of 100 lifetime/);
  for (const source of consumers) {
    assert.match(source, /LIFETIME_SPOT_CAP/);
    assert.doesNotMatch(source, /TOTAL_SPOTS\s*=\s*100/);
    assert.doesNotMatch(source, /\?\?\s*100/);
    assert.doesNotMatch(source, /first 100 customers/);
    assert.doesNotMatch(source, /all 100 lifetime/);
    assert.doesNotMatch(source, /Spot #51/);
  }
});

test("an ended trial and a never-subscribed account get different dashboard nudges", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const ended = expiredTrialNudgeCopy("2026-10-01T00:00:00.000Z", now);
  assert.equal(ended.title, "Your trial has ended");
  assert.match(ended.detail, /Lifetime is \$300 once/);
  const future = expiredTrialNudgeCopy("2026-11-13T23:00:00.000Z", now);
  assert.equal(future.title, "Pick a plan to unlock the dashboard");
  assert.match(expiredTrialNudgeCopy(null, now).title, /Pick a plan/);
  assert.match(expiredTrialNudgeCopy("not-a-date", now).detail, /\$49/);
});

test("native trial and payment-failed accounts do not see checkout or portal copy", () => {
  const native = "Subscriptions are managed at jointidywise.com. This app cannot take a card.";
  assert.equal(
    planChoicesFooter({ canShowPaymentFlows: false, paymentFailed: true, orgTrial: false }),
    native,
  );
  assert.equal(
    planChoicesFooter({ canShowPaymentFlows: false, paymentFailed: false, orgTrial: true }),
    native,
  );
  assert.match(
    planChoicesFooter({ canShowPaymentFlows: true, paymentFailed: true, orgTrial: true }),
    /billing portal/,
  );
  assert.match(
    planChoicesFooter({ canShowPaymentFlows: true, paymentFailed: false, orgTrial: true }),
    /Stripe Checkout/,
  );
});

test("an invalid timezone does not throw", () => {
  assert.equal(trialEndDateLabel("2026-11-14T04:00:00.000Z", "Not/AZone"), null);
});

test("downgrade buttons say the change waits for renewal", () => {
  assert.equal(DOWNGRADE_EFFECT_NOTE, "Takes effect at your next renewal.");
});

test("lifetime and grandfathered accounts do not see the plan grid", () => {
  assert.equal(showPlanChoices({ lifetime: false, grandfathered: false }), true);
  assert.equal(showPlanChoices({ lifetime: true, grandfathered: false }), false);
  assert.equal(showPlanChoices({ lifetime: false, grandfathered: true }), false);
});

// Pro features from features.ts (automation_center, client_portal, ai_intelligence,
// payroll, tracking). A clause may sit next to $49 only when that same clause
// names Pro or $97. A $97 later on the line does not clear an earlier clause.
const PRO_FEATURE_IN_PRICE_COPY =
  /payroll|\bGPS\b|automated reminders?|automations?|client portal|\bAI\b/i;

function proFeatureMispricedOnLine(line: string): string[] {
  if (!/\$49(?!\d)/.test(line)) return [];
  const bad: string[] = [];
  for (const clause of line.split(/[.!?;]+/)) {
    if (!PRO_FEATURE_IN_PRICE_COPY.test(clause)) continue;
    // Denial, not a price claim: "Payroll is not included on Basic ($49/mo)."
    if (/\bnot included\b/i.test(clause)) continue;
    if (/\bPro\b/.test(clause) || /\$97(?!\d)/.test(clause)) continue;
    bad.push(clause.trim());
  }
  return bad;
}

test("a $49 line attributes automation, client portal, AI, payroll, and GPS to Pro", () => {
  const caught = [
    "TidyWise is purpose-built for cleaning businesses with booking, scheduling, CRM, invoicing, SMS/email automation, a staff portal, client portal, and AI-powered business intelligence. Pricing starts at $49/month, and every new account begins with 30 days of Pro, no card.",
    "TidyWise gives you booking, scheduling, CRM, invoicing, and automation in one platform. Plans start at $49/mo.",
    "SMS/email automation, the client portal, and AI are included. Pricing starts at $49/month. Pro is $97/month.",
  ];
  for (const line of caught) {
    assert.notEqual(proFeatureMispricedOnLine(line).length, 0, line);
  }

  const allowed = [
    "Booking, scheduling, CRM, invoicing, and the staff portal start at $49/month. SMS/email automation, the client portal, and AI-powered business intelligence are on Pro at $97/month.",
    "Booking, scheduling, CRM, and invoicing from $49/mo. Automation is on Pro at $97/mo.",
    "Scheduling and invoicing on Basic at $49/mo, and payroll on Pro at $97/mo.",
    "Pro at $97/mo. Payroll is not included on Basic ($49/mo).",
    "The mobile app is included from $49/mo (Basic). Payroll, GPS check-ins, and P&L reports are on Pro at $97/mo.",
  ];
  for (const line of allowed) {
    assert.deepEqual(proFeatureMispricedOnLine(line), [], line);
  }

  const root = new URL("../", import.meta.url);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(root.pathname);
  const bad: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const clause of proFeatureMispricedOnLine(line)) {
        bad.push(`${file}:${index + 1}: ${clause}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test("lifetime spots stay hidden unless both the count and the cap are real", () => {
  assert.equal(lifetimeSpotsToShow(null, 100), null);
  assert.equal(lifetimeSpotsToShow(12, null), null);
  assert.equal(lifetimeSpotsToShow(undefined, undefined), null);
  assert.equal(lifetimeSpotsToShow(1.5, 100), null);
  assert.equal(lifetimeSpotsToShow(-1, 100), null);
  assert.equal(lifetimeSpotsToShow(0, 0), null);
  assert.equal(lifetimeSpotsToShow(150, 100), null);
  assert.deepEqual(lifetimeSpotsToShow(97, 100), { remaining: 97, total: 100 });
  assert.deepEqual(lifetimeSpotsToShow(88, 100), { remaining: 88, total: 100 });
});
