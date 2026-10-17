// Renders the PayrollPeriodReport email to ./preview/payroll-period-report.html
// using realistic sample data shaped like a real TidyWise Cleaning period.
//
// Usage:
//   deno run --allow-read --allow-write --allow-net --allow-env scripts/render-payroll-preview.ts
//
// The MCP / runtime doesn't have access to the prod jointidywise Supabase
// project (slwfkaqczvwvvvavkgpr), so this preview uses sample data that
// matches the schema and shape the cron will produce. Visual review is the
// point — real numbers populate once the function is deployed.

import { renderCrmEmail } from "../supabase/functions/_shared/crm-email/render.ts";

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUsdCents = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const props = {
  orgName: "TidyWise Cleaning",
  periodLabel: "Apr 28 – May 4, 2026",
  totals: {
    revenue: 14_240,
    payroll: 7_812,
    profit: 6_428,
    laborPct: 54.9,
    jobs: 47,
    cleanersWorked: 6,
  },
  changeVsPrevious: {
    revenuePct: 8.4,
    payrollPct: 5.1,
    jobsPct: 11.9,
  },
  cleaners: [
    {
      name: "Maria Sanchez",
      jobs: 14,
      revenue: 4_120,
      payout: 2_064.5,
      hours: 51.5,
      payoutChangePct: 12.3,
    },
    {
      name: "Aisha Williams",
      jobs: 11,
      revenue: 3_280,
      payout: 1_804.0,
      hours: 45.0,
      payoutChangePct: 4.8,
    },
    {
      name: "Jamal Thompson",
      jobs: 9,
      revenue: 2_580,
      payout: 1_419.0,
      hours: 35.5,
      payoutChangePct: -3.2,
    },
    {
      name: "Sofia Gutierrez",
      jobs: 7,
      revenue: 2_100,
      payout: 1_155.0,
      hours: 28.5,
      payoutChangePct: 21.0,
    },
    {
      name: "Devin Park",
      jobs: 4,
      revenue: 1_360,
      payout: 850.0,
      hours: 17.0,
      payoutChangePct: null,
    },
    {
      name: "Hannah Cole",
      jobs: 2,
      revenue: 800,
      payout: 519.5,
      hours: 10.0,
      payoutChangePct: -38.5,
    },
  ],
  standouts: {
    topEarner: { name: "Maria Sanchez", payout: 2_064.5 },
    mostJobs: { name: "Maria Sanchez", jobs: 14 },
    highestAvg: { name: "Devin Park", avgPayout: 212.5 },
  },
  warnings: {
    idleCleaners: ["Brian Lee", "Olivia Nakamura"],
    noStripeCleaners: ["Devin Park", "Hannah Cole"],
    negativeMarginBookings: 1,
    zeroPayBookings: 2,
  },
  ctaUrl: "https://app.jointidywise.com/dashboard/payroll",
};

const currency = fmtUsd(props.totals.payroll);
const { html } = renderCrmEmail("payroll-period-report", {
  vars: {
    periodLabel: props.periodLabel,
    currency,
    orgName: props.orgName,
    changeVsPrevious: `Revenue +${props.changeVsPrevious.revenuePct}% · Payroll +${props.changeVsPrevious.payrollPct}% · Jobs +${props.changeVsPrevious.jobsPct}%`,
    "totals.revenue": fmtUsd(props.totals.revenue),
    "totals.payroll": fmtUsd(props.totals.payroll),
    "totals.profit": fmtUsd(props.totals.profit),
    "totals.laborPct": `${props.totals.laborPct.toFixed(1)}%`,
    "totals.jobs": props.totals.jobs,
    "totals.cleanersWorked": props.totals.cleanersWorked,
    ctaUrl: props.ctaUrl,
  },
  repeats: [
    {
      prefix: "cleaner.",
      rows: props.cleaners.map((c) => ({
        "cleaner.name": c.name,
        "cleaner.jobs": String(c.jobs),
        "cleaner.pay": fmtUsdCents(c.payout),
      })),
    },
    {
      prefix: "standout",
      rows: [
        { standout: `Top earner: ${props.standouts.topEarner.name} — ${fmtUsdCents(props.standouts.topEarner.payout)}` },
        { standout: `Most jobs: ${props.standouts.mostJobs.name} — ${props.standouts.mostJobs.jobs} jobs` },
        { standout: `Highest average per job: ${props.standouts.highestAvg.name} — ${fmtUsdCents(props.standouts.highestAvg.avgPayout)}` },
      ],
    },
    {
      prefix: "warning",
      rows: [
        { warning: `Stripe Connect not set up: ${props.warnings.noStripeCleaners.join(", ")}` },
        { warning: `Idle cleaners: ${props.warnings.idleCleaners.join(", ")}` },
        { warning: `Negative-margin bookings: ${props.warnings.negativeMarginBookings}` },
        { warning: `$0 cleaner pay: ${props.warnings.zeroPayBookings}` },
      ],
    },
  ],
});

const previewDir = new URL("../preview/", import.meta.url);
try {
  await Deno.mkdir(previewDir, { recursive: true });
} catch (_e) { /* exists */ }

const outFile = new URL("payroll-period-report.html", previewDir);
await Deno.writeTextFile(outFile, html);

console.log(`Wrote ${outFile.pathname}`);
console.log(`Open with: open ${outFile.pathname}`);
