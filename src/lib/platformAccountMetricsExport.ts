/**
 * CSV for the platform-admin account metrics function.
 *
 * One row per organization. Amounts are dollars. Timestamps are UTC.
 * MRR ($) is blank for lifetime plans, even if a caller filled mrr_cents.
 * Activation milestones are their own columns. A milestone that a cleaning
 * client paid the business is not TidyWise revenue and is not copied into
 * MRR ($).
 */

import { labelForOption } from "./onboardingAnswers.ts";

export interface AccountMetricsRow {
  organization_id: string;
  organization_name: string;
  owner_email: string | null;
  signup_at: string;
  trial_status: string;
  trial_ends_at: string | null;
  trial_end_source: string | null;
  latest_milestone: string | null;
  latest_milestone_at: string | null;
  activation_milestones: unknown;
  last_login_at: string | null;
  how_heard: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer: string | null;
  stripe_subscription_status: string | null;
  /** Raw Stripe status: active, past_due, trialing, canceled, and the rest. */
  subscription_status: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  is_lifetime: boolean;
  billing_interval: string | null;
  monthly_amount_cents: number | null;
  monthly_amount_basis: string | null;
  monthly_amount_source: string | null;
  mrr_cents: number | null;
  counts_toward_mrr: boolean;
  loyalty_discount_cents: number | null;
  canceled_at: string | null;
  cancellation_source: string | null;
  cancel_at_period_end: boolean | null;
  cancel_scheduled_for: string | null;
  refund_dates: string[] | null;
  subscription_refund_dates?: string[] | null;
  lifetime_refund_dates?: string[] | null;
  is_demo_or_test: boolean;
}

const PAGE_LIMIT = 1000;
const MAX_ROWS = 100_000;

export async function fetchAllAccountMetrics(
  fetchPage: (offset: number, limit: number) => Promise<AccountMetricsRow[]>,
  limit = PAGE_LIMIT,
): Promise<AccountMetricsRow[]> {
  const rows: AccountMetricsRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, limit);
    rows.push(...page);
    if (page.length < limit) return rows;
    offset += limit;
    if (offset > MAX_ROWS) {
      throw new Error("Account metrics export exceeded 100000 rows");
    }
  }
}

export function milestoneMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw) out[key] = raw;
  }
  return out;
}

export function milestoneKeys(rows: AccountMetricsRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(milestoneMap(row.activation_milestones))) keys.add(key);
  }
  return [...keys].sort();
}

function dollars(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function yesNo(value: boolean | null | undefined): string {
  if (value == null) return "";
  return value ? "Yes" : "No";
}

/** Excel and Sheets treat a leading = + - @ tab or CR as a formula, including after spaces. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  const raw = String(value ?? "");
  const text = FORMULA_LEAD.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: unknown[]): string {
  return values.map(cell).join(",");
}

function heardLabel(raw: string | null): string {
  if (!raw) return "";
  return raw.split(", ").map((part) => labelForOption("howHeard", part)).join(", ");
}

function basisLabel(basis: string | null): string {
  switch (basis) {
    case "monthly":
      return "Monthly invoice";
    case "normalized_from_annual":
      return "Annual invoice divided by 12";
    case "normalized_from_multi_month":
      return "Multi-month invoice divided into months";
    case "normalized_from_weekly":
      return "Weekly invoice converted to a month";
    case "normalized_from_daily":
      return "Daily invoice converted to a month";
    case "lifetime_excluded":
      return "Lifetime — omitted from MRR";
    case "discount_unknown":
      return "Price not shown — coupon was not stored";
    case "unknown_interval":
      return "Price not shown — billing interval was not recognized";
    default:
      return basis ?? "";
  }
}

/** Blank when the row must not be summed into MRR. */
export function mrrDollars(row: AccountMetricsRow): string {
  if (row.is_lifetime || row.counts_toward_mrr !== true) return "";
  return dollars(row.mrr_cents);
}

export function monthlyAmountDollars(row: AccountMetricsRow): string {
  if (row.is_lifetime) return "";
  return dollars(row.monthly_amount_cents);
}

export function buildAccountMetricsCsv(rows: AccountMetricsRow[], generatedAt: Date): string {
  const keys = milestoneKeys(rows);
  const generated = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(generatedAt);

  const lines: string[] = [
    csvRow(["TidyWise account metrics"]),
    csvRow([`Generated ${generated} UTC. Amounts are US dollars. Timestamps are UTC.`]),
    csvRow(["One row per organization. Demo and test organizations are included and flagged in Is demo or test."]),
    csvRow(["MRR ($) counts a Stripe subscription only when Is lifetime is No, Counts toward MRR is Yes, and the amount is filled in. Sum that column. Blank is not zero."]),
    csvRow(["Monthly amount ($) and MRR ($) are what is collected after one discount. A stored Stripe coupon is used once. When that coupon was not readable, the loyalty amount-off is subtracted once for monthly Basic or Pro. Loyalty is never subtracted on top of a known coupon. Annual invoice divided by 12 means the yearly price, after that single discount, was converted to a month in both columns."]),
    csvRow(["Lifetime plans are omitted from Monthly amount ($) and from MRR ($)."]),
    csvRow(["Subscription status is the raw Stripe status, including past_due."]),
    csvRow(["Activation milestone columns are not revenue. milestone_first_payment_received, when present, means a cleaning client paid that business. It is not TidyWise revenue and it is not included in MRR ($)."]),
    csvRow(["Loyalty discount stored ($) is the loyalty coupon last written for that organization. It is not added again when Monthly amount source is stripe_subscription or billing_subscription_period. Source stripe_subscription_loyalty_discount means that stored amount was the only discount applied."]),
    csvRow(["Subscription refund dates are plan-invoice refunds. Lifetime refund dates are Lifetime purchases. They are reported apart from each other. Connected-account charges are not included."]),
    "",
    csvRow([
      "Organization id",
      "Organization name",
      "Owner email",
      "Signup (UTC)",
      "Trial status",
      "Trial ends (UTC)",
      "Trial end source",
      "Latest activation milestone",
      "Latest milestone at (UTC)",
      ...keys.map((key) => `milestone_${key} (UTC)`),
      "Last login (UTC)",
      "How heard",
      "How heard (raw)",
      "UTM source",
      "UTM medium",
      "UTM campaign",
      "Referrer",
      "Subscription status",
      "Stripe subscription status",
      "Plan",
      "Is lifetime",
      "Billing interval",
      "Monthly amount ($)",
      "Monthly amount basis",
      "Monthly amount source",
      "MRR ($)",
      "Counts toward MRR",
      "Loyalty discount stored ($)",
      "Canceled at (UTC)",
      "Cancellation source",
      "Cancel at period end",
      "Cancel scheduled for (UTC)",
      "Refund dates (UTC)",
      "Subscription refund dates (UTC)",
      "Lifetime refund dates (UTC)",
      "Is demo or test",
      "Stripe subscription id",
    ]),
  ];

  for (const row of rows) {
    const milestones = milestoneMap(row.activation_milestones);
    const refunds = Array.isArray(row.refund_dates) ? row.refund_dates.map((value) => stamp(value)).filter(Boolean) : [];
    lines.push(csvRow([
      row.organization_id,
      row.organization_name,
      row.owner_email ?? "",
      stamp(row.signup_at),
      row.trial_status,
      stamp(row.trial_ends_at),
      row.trial_end_source ?? "",
      row.latest_milestone ?? "",
      stamp(row.latest_milestone_at),
      ...keys.map((key) => stamp(milestones[key])),
      stamp(row.last_login_at),
      heardLabel(row.how_heard),
      row.how_heard ?? "",
      row.utm_source ?? "",
      row.utm_medium ?? "",
      row.utm_campaign ?? "",
      row.referrer ?? "",
      row.subscription_status ?? row.stripe_subscription_status ?? "",
      row.stripe_subscription_status ?? "",
      row.plan ?? "",
      yesNo(row.is_lifetime),
      row.billing_interval ?? "",
      monthlyAmountDollars(row),
      basisLabel(row.monthly_amount_basis),
      row.monthly_amount_source ?? "",
      mrrDollars(row),
      yesNo(row.counts_toward_mrr),
      row.is_lifetime ? "" : dollars(row.loyalty_discount_cents),
      stamp(row.canceled_at),
      row.cancellation_source ?? "",
      yesNo(row.cancel_at_period_end),
      stamp(row.cancel_scheduled_for),
      refunds.join("; "),
      (Array.isArray(row.subscription_refund_dates) ? row.subscription_refund_dates : []).map((value) => stamp(value)).filter(Boolean).join("; "),
      (Array.isArray(row.lifetime_refund_dates) ? row.lifetime_refund_dates : []).map((value) => stamp(value)).filter(Boolean).join("; "),
      yesNo(row.is_demo_or_test),
      row.stripe_subscription_id ?? "",
    ]));
  }

  return `${lines.join("\n")}\n`;
}
