// Renders every branded CRM email with sample data.
//
//   node --experimental-strip-types --test src/lib/crm-email.test.ts
//
// Each design must come back with no leftover {{token}} or {token}, and
// without TidyWise's own phone number. Owner-editable shells are filled
// the same way the senders fill them: the slot is caller HTML, and the
// tokens inside that HTML are already resolved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, type CrmSlug } from "../../supabase/functions/_shared/crm-email/templates.ts";
import { renderCrmEmail, containsBlockedPhone, orgBrandVars, UNSUBSCRIBE_URL_SENTINEL } from "../../supabase/functions/_shared/crm-email/render.ts";
import { wrapBroadcastDocument } from "../../supabase/functions/_shared/crm-email/broadcast-shell.ts";
import { renderBroadcastHtml } from "./broadcast-render.ts";

const APP = "https://app.jointidywise.com";
const LOGO = "https://jointidywise.com/email-logo.png";
const ORG_LOGO = "https://example.com/logo.png";

const brand = orgBrandVars({
  companyName: "Brightside Home Cleaning",
  logoUrl: ORG_LOGO,
  primaryColor: "#0f766e",
  accentColor: "#f59e0b",
  emailFooter: "Brightside Home Cleaning · 210 Palm Ave, Boca Raton, FL 33432",
});

const base: Record<string, string> = {
  ...brand,
  APP_URL: APP,
  LOGO_URL: LOGO,
  UNSUBSCRIBE_URL: "https://app.jointidywise.com/unsubscribe?token=sample",
  confirmationUrl: `${APP}/confirm`,
  token: "482913",
  companyName: "TidyWise",
  userName: "Maria",
  senderEmail: "support@jointidywise.com",
  headline: "Your booking page is one step away.",
  detail: "Finish setting up today and your first month is 50% off.",
  link: `${APP}/onboarding`,
  amount: "$49.00",
  planLine: "Pro · monthly",
  subjectPlan: " (Pro · monthly)",
  invoice_id: "in_1QX8T2",
  nextDate: "Nov 16, 2026",
  hosted_invoice_url: `${APP}/invoice`,
  SUPPORT_EMAIL: "support@jointidywise.com",
  renewDate: "Oct 20, 2026",
  plan: "Pro (monthly)",
  email: "maria@brightside.co",
  userName2: "Jordan Lee",
  checkoutUrl: `${APP}/checkout`,
  firstName: "Maria",
  bookings: "214",
  customers: "86",
  revenue: "$18,420",
  membershipLabel: "Pro (monthly)",
  when: "Oct 16, 2026 at 9:42 PM ET",
  forgotPasswordUrl: `${APP}/forgot-password`,
  request: "Please delete my account and personal data.",
  "b.subject": "New: send quotes your clients can approve online",
  "b.body_text": "Hi there, turn on automatic review requests.",
  "b.signature_text": "Emmanuel Forkuoh, Founder, TidyWise",
  subjectDate: "Friday, October 16, 2026",
  todayBookingsCount: "6",
  todayRevenue: "$1,140",
  newLeadsCount: "3",
  staffOnToday: "4",
  tomorrowCount: "5",
  tomorrowRevenue: "$980",
  wowChange: "+12% vs last week",
  completedCount: "6",
  pendingCount: "1",
  cancelledCount: "0",
  openEstimatesCount: "2",
  company_name: "Brightside Home Cleaning",
  week_range: "Oct 5 – Oct 11",
  jobsCompleted: "31",
  newLeads: "9",
  avgRating: "4.9",
  topStaff: "Rosa M. (11 jobs)",
  aiSummary: "Tuesdays were your busiest day.",
  periodLabel: "Oct 1 – Oct 15",
  currency: "$4,120",
  orgName: "Brightside Home Cleaning",
  "totals.revenue": "$9,860",
  "totals.payroll": "$4,120",
  "totals.profit": "$5,740",
  "totals.laborPct": "41.8%",
  "totals.jobs": "58",
  "totals.cleanersWorked": "5",
  changeVsPrevious: "+8% revenue",
  ctaUrl: `${APP}/dashboard/payroll`,
  serviceName: "Deep Clean",
  appointmentDate: "Oct 21, 2026",
  appointmentTime: "9:00 AM",
  customerName: "Dana Whitfield",
  customerEmail: "dana@example.com",
  customerPhone: "555-014-2291",
  address: "48 Ocean Dr, Boca Raton, FL",
  total: "$260.00",
  extras: "Inside fridge, Inside oven",
  "alert.title": "New booking #BK-1042",
  "alert.body": "Dana Whitfield booked a Deep Clean.",
  "alert.url": `${APP}/dashboard/bookings`,
  name: "Chris",
  fullName: "Chris Patel",
  dateDisplay: "Tue, Oct 20",
  timeDisplay: "2:00 PM ET",
  meetingLink: `${APP}/meet`,
  howDetail: `Use your <a href="${APP}/meet" style="color:#1d5fbf;">meeting link</a> at start time.`,
  customer_name: "Dana",
  booking_number: "BK-1042",
  service_name: "Deep Clean",
  scheduled_date: "Tue, Oct 21, 2026",
  scheduled_time: "9:00 AM",
  total_amount: "$260.00",
  estimatedTotal: "$240",
  bedrooms: "3",
  bathrooms: "2",
  bookingUrl: `${APP}/book/brightside`,
  quoteLabel: "#123",
  totalDisplay: "$240.00",
  reviewPageUrl: `${APP}/review`,
  pointsEarned: "50",
  totalPoints: "320",
  lifetimePoints: "820",
  currentTier: "Gold",
  bookingNumber: "BK-1042",
  referrerName: "Sam",
  creditAmount: "25",
  referral_code: "SAM25",
  sessionUrl: "https://checkout.stripe.com/c/pay/cs_test",
  first_name: "Dana",
  last_name: "Whitfield",
  booking_link: `${APP}/book/brightside`,
  offer_percent: "10",
  BOOK_URL: `${APP}/book/brightside`,
  role: "Manager",
  acceptUrl: `${APP}/accept`,
  loginEmail: "rosa@example.com",
  passwordLine: "Use your existing password",
  passwordNotice: "You already have a password, so use that one to sign in.",
  loginUrl: `${APP}/staff-login`,
  staffName: "Rosa",
  businessName: "Brightside Home Cleaning",
  adminIdentity: "Maria (Owner)",
  resetLink: `${APP}/reset`,
  first: "Rosa",
  biz: "Brightside Home Cleaning",
  amt: "$412.50",
  week_start: "Oct 5, 2026",
  estStr: "in about 2 business days",
  portalUrl: "https://jointidywise.com/staff-portal?tab=payouts",
  supportEmail: "support@jointidywise.com",
  message: "Hi! I run a 6-person cleaning team and want to move off spreadsheets.",
  prospectPhone: "555-019-8833",
  teamSize: "6",
  serviceLabel: "Google Ads",
  requesterEmail: "maria@brightside.co",
  notes: "We want more deep-clean bookings. Budget around $600/month.",
  lastAttempt: "Oct 16, 2026 6:00 AM ET",
  lastError: "Timeout calling content model after 60s",
  logsUrl: `${APP}/admin/blog/keywords`,
  details: "Organization: Brightside. Reason: Pausing for slow season. Access until Nov 16, 2026.",
};

const repeats = [
  {
    prefix: "job.",
    rows: [{ "job.time": "9:00 AM", "job.customer": "Dana Whitfield", "job.service": "Deep clean", "job.staff": "Rosa M.", "job.total": "$260" }],
  },
  {
    prefix: "lead.",
    rows: [{ "lead.name": "Chris Patel", "lead.source": "Booking page" }],
  },
  {
    prefix: "cleaner.",
    rows: [{ "cleaner.name": "Rosa M.", "cleaner.jobs": "16", "cleaner.pay": "$1,180" }],
  },
  {
    prefix: "tier.",
    rows: [{ "tier.name": "Gold", "tier.min": "500" }],
  },
  {
    prefix: "standout",
    rows: [{ standout: "Rosa M. finished 16 jobs with a 5.0 rating." }],
  },
  {
    prefix: "warning",
    rows: [{ warning: "2 jobs are missing clock-out times." }],
  },
  {
    prefix: "section.",
    rows: [{ "section.title": "Before we arrive", "section.body": "<em>Please make sure we can get in.</em>" }],
  },
];

const ORG_SLUGS = new Set<CrmSlug>([
  "booking-confirmation", "quote", "quote-approved", "review-request", "loyalty-progress",
  "referral-invite", "card-on-file-link", "portal-password-reset", "followup-campaign",
  "customer-winback-drip", "team-invite", "staff-welcome", "staff-password-link",
  "staff-password-notice", "staff-payout-notice", "stripe-requirements", "payouts-active",
]);

test("every CRM design renders with no leftover tokens and no TidyWise phone", () => {
  const slugs = Object.keys(TEMPLATES) as CrmSlug[];
  assert.equal(slugs.length, 52);
  for (const slug of slugs) {
    const vars = { ...base };
    if (!ORG_SLUGS.has(slug)) {
      // Platform mail keeps the TidyWise name in {{companyName}} (welcome).
      // Org mail uses the business name. Both keys exist; welcome reads companyName.
    }
    if (slug !== "welcome") {
      vars.companyName = brand.companyName;
    }
    const { html, text } = renderCrmEmail(slug, {
      vars,
      repeats,
      includeOptional: true,
      rawKeys: ["howDetail", "section.body", "email_footer"],
    });
    assert.equal(containsBlockedPhone(html), false, `${slug} html contains 5615718725`);
    assert.equal(containsBlockedPhone(text), false, `${slug} text contains 5615718725`);
    assert.ok(!html.includes("{{"), `${slug} still has a double-brace token`);
    assert.ok(!/\{[a-z_]+\}/.test(html.replace(/\{[0-9#.%]/g, "")), `${slug} still has a single-brace token`);
    assert.ok(html.includes("65 SW 12th Ave"), `${slug} is missing the postal address`);
    assert.ok(html.includes("Deerfield Beach, FL 33442"), `${slug} is missing the city line`);
    assert.ok(text.length > 40, `${slug} plain text is empty`);
    if (ORG_SLUGS.has(slug)) {
      assert.equal(html.includes("#1d5fbf"), false, `${slug} leaked TidyWise blue`);
      assert.equal(html.includes("#3fbf2a"), false, `${slug} leaked TidyWise green`);
      assert.ok(html.includes("#0f766e") || html.includes(ORG_LOGO) || html.includes("Brightside"), `${slug} missing org brand`);
    }
  }
});

test("new-booking admin copy includes the client phone", () => {
  const { html } = renderCrmEmail("new-booking-admin-copy", {
    vars: base,
    rawKeys: ["email_footer"],
  });
  assert.ok(html.includes("555-014-2291"));
  assert.ok(html.includes("Phone"));
  assert.equal(containsBlockedPhone(html), false);
});

test("owner slot replaces the design default and does not leave the sample sentence", () => {
  const { html } = renderCrmEmail("booking-confirmation", {
    vars: { ...base, companyName: brand.companyName },
    slots: ["<p>Custom owner intro for Dana.</p>"],
    repeats,
    rawKeys: ["section.body", "email_footer"],
  });
  assert.ok(html.includes("Custom owner intro for Dana."));
  assert.equal(html.includes("Thank you for booking with"), false);
});

test("empty optional insight is omitted and weekly tokens still resolve", () => {
  const { html } = renderCrmEmail("weekly-business-report", {
    vars: base,
    includeOptional: false,
  });
  assert.equal(html.includes("aiSummary"), false);
  assert.equal(html.includes("Insight"), false);
  assert.ok(html.includes("Brightside Home Cleaning"));
  assert.ok(html.includes("Oct 5"));
});

test("broadcast shell keeps the inner unsubscribe rules", () => {
  const inner = renderBroadcastHtml({
    bodyText: "Hello owners",
    unsubscribeUrl: null,
    signature: undefined,
  });
  const wrapped = wrapBroadcastDocument({ subject: "A note", innerHtml: inner });
  assert.equal(wrapped.toLowerCase().includes("unsubscribe"), false);
  assert.ok(wrapped.includes("A note"));
  assert.ok(wrapped.includes("Hello owners"));
  assert.ok(wrapped.includes("Emmanuel Forkuoh"));
  assert.equal(containsBlockedPhone(wrapped), false);
  assert.ok(wrapped.includes("65 SW 12th Ave"));

  const marketing = wrapBroadcastDocument({
    subject: "Offer",
    innerHtml: renderBroadcastHtml({
      bodyText: "Two weeks free",
      unsubscribeUrl: "https://x.test/u?token=abc",
    }),
  });
  assert.ok(marketing.includes("https://x.test/u?token=abc"));
  assert.ok(marketing.includes("Unsubscribe"));
  assert.equal(marketing.includes(UNSUBSCRIBE_URL_SENTINEL), false);
  assert.equal(marketing.includes("{{"), false);
});
