import { homeConditionOptions } from "../data/pricingData.ts";

export const CALCULATOR_PATH = "/tools/house-cleaning-price-calculator";

export const CALCULATOR_TITLE =
  "House Cleaning Price Calculator (Free) – What to Charge in 2026";

export const CALCULATOR_DESCRIPTION =
  "Price a house clean from size, clean type, condition, add-ons, and your wage, supplies, overhead, and margin. Same rate-sheet math TidyWise uses for quotes.";

export const CALCULATOR_H1 = "House Cleaning Price Calculator";

export const TRIAL_CTA_LABEL = "Start your 30-day free Pro trial, no card";

export const SEE_PLANS_LABEL = "See plans";

export const CALCULATOR_INPUT_LABELS = {
  squareFootage: "Square footage",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  cleanType: "Clean type",
  homeCondition: "Home condition",
  frequency: "Frequency",
  oven: "Inside oven",
  fridge: "Inside fridge",
  windows: "Windows",
  laundry: "Laundry",
  wage: "Cleaner hourly wage",
  teamSize: "Team size",
  supplyCost: "Supply cost per visit",
  overhead: "Monthly overhead",
  margin: "Target profit margin",
} as const;

export const CLEAN_TYPE_OPTIONS = [
  { id: "standard_recurring", label: "Standard recurring" },
  { id: "deep", label: "Deep" },
  { id: "move_in_out", label: "Move-in/out" },
  { id: "airbnb", label: "Airbnb turnover" },
] as const;

export const FREQUENCY_OPTIONS = [
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Biweekly" },
  { id: "monthly", label: "Monthly" },
  { id: "one_time", label: "One-time" },
] as const;

export const ADDON_OPTIONS = [
  { id: "oven", label: "Inside oven" },
  { id: "fridge", label: "Inside fridge" },
  { id: "windows", label: "Windows" },
  { id: "laundry", label: "Laundry" },
] as const;

export const FORMULA_STEPS = [
  "Base = the rate-sheet price for the clean type and the home (square-foot tier or bed and bath grid), raised to the service minimum when that price is lower.",
  "Subtotal = base + home condition amount + add-ons that this clean does not already include.",
  "Quote = round(subtotal × (1 − frequency discount)). One-time uses a discount of zero. Rounding is to the nearest dollar, the same step a TidyWise quote uses.",
  "The price range is the lowest and highest of that same subtotal repriced at weekly, biweekly, monthly, and one-time. That list is the suggested recurring discount ladder, using the default discounts.",
  "Overhead per visit = monthly overhead ÷ visits per month. Weekly uses 52 ÷ 12. Biweekly uses 26 ÷ 12. Monthly uses 1. A one-time clean uses 1 as well, so the full monthly overhead you entered is assigned to that visit.",
  "Labor budget = quote × (1 − margin) − supply cost per visit − overhead per visit.",
  "Estimated hours = labor budget ÷ (cleaner hourly wage × team size), when the labor budget is above zero.",
  "Effective hourly rate = (quote − supply cost − overhead per visit) ÷ (estimated hours × team size).",
  "Profit per job = quote − (hourly wage × estimated hours × team size) − supply cost − overhead per visit.",
] as const;

export const EXPLAINER_PARAGRAPHS = [
  "Pricing a house clean has two parts: a price the customer can be quoted again tomorrow, and a check that the price still pays your team. This page keeps those parts separate. The quote uses the TidyWise rate sheet, the same base, minimum, condition amounts, add-ons, and default frequency discounts a booking uses. Wage, supply cost, monthly overhead, and target margin stay blank until you type them. The page does not fill those in, and it does not borrow a price from any other company.",
  "Describe the home by square footage or by bedrooms and bathrooms. Only the one you select is used. Square footage matches a tier, and every home up to that tier's ceiling shares one base. A home past the last tier uses the last tier. There is no second per-foot charge. Bedrooms and bathrooms use a grid: an exact pair uses that row, a missing pair keeps your bedroom count and takes the closest bathroom on that row, and a bathroom alone uses the smallest bedroom count for that bath. The booking form uses that same fallback.",
  "A base of zero falls back to the service minimum. A positive base below the minimum is raised to it. The minimum is a floor on the base only. Condition, add-ons, and the frequency discount come after it. It is not added again at the end.",
  "Clean type picks the rate sheet. Standard recurring is the maintenance clean, deep is the heavier clean, and move-in/out and Airbnb turnover each have their own sheet. Frequency is separate. A deep clean can be one-time, and a standard clean can be weekly. Choosing a type does not change the discount, and choosing a frequency does not switch the sheet.",
  "Home condition is a flat amount from the condition list, added to the base. It is not a percent of the base. An excellent home adds nothing. Each later step adds the amount stored for that step. The amount goes in before the frequency discount, so a recurring discount reduces the condition dollars along with the base. The discount applies to the whole subtotal of the visit.",
  "Add-ons are the rate-sheet extras. Windows and laundry each have their own amount. Inside oven and inside fridge share the appliances extra, so either or both adds it once. A deep clean already includes the oven, and a move-in/out clean already includes the fridge, so those are not added again. The oven on a move-in/out, or the fridge on a deep clean, does add the appliances extra. A zero line means the clean already includes that item.",
  "Subtotal is the base, plus condition, plus add-ons that are not already included. The frequency discount multiplies that subtotal. One-time uses no discount. Weekly, biweekly, and monthly use the default recurring discount for that frequency, the same defaults the booking form uses when a business has not saved its own. The quote is that result rounded to the nearest dollar, which is the rounding a public booking total uses.",
  "The recommended price is the rounded quote for the frequency you picked. The range is that same subtotal at weekly, biweekly, monthly, and one-time. The low end is the smallest of the four and the high end is the largest. That list is the discount ladder. Change the home or the clean and every rung moves. Change only the frequency and the other rungs stay up for comparison.",
  "Hourly wage, team size, supply cost per visit, monthly overhead, and target margin are your figures. A blank supply cost or overhead counts as zero. A blank wage or margin still shows the quote and the ladder, and waits to estimate hours and profit. Team size starts at one.",
  "Overhead is monthly, because rent, insurance, and software are monthly. Weekly spreads it over 52 ÷ 12 visits. Biweekly spreads it over 26 ÷ 12. Monthly uses one visit. A one-time clean has no later visit to share the month, so the full monthly overhead you entered lands on that visit. Enter zero when the job should not carry it. The page shows the divisor beside the overhead per visit.",
  "Estimated hours are not a measured clean time. The rate sheet stores prices, not durations. Hours are how long the team can work and still leave your margin after supplies and overhead. Labor budget is the quote times one minus the margin, minus supply cost, minus overhead per visit. Divide that budget by wage times team size. Above zero, that is the time the price can pay for. At zero, nothing is left for wages. Below zero, the page shows the shortfall instead of a negative hour count.",
  "Effective hourly rate is the quote, minus supply cost, minus overhead per visit, divided by those hours times team size. It is the labor money in the quote per cleaner-hour when the visit uses the full hour budget. It equals the wage you typed only when supplies, overhead, and margin are all zero. The gap is what non-labor costs and the margin take. It is not a wage to promise a cleaner.",
  "Profit per job is the quote minus wage times hours times team size, minus supply cost, minus overhead per visit. When the hours equal that budget, profit equals the quote times your margin. That match defines the budget. It is not a timer reading. A longer clean drops profit, because wages keep adding while the quote stays put. A shorter clean raises it. The page does not guess which will happen.",
  "A larger tier changes the base. Condition and add-ons land in the subtotal before the discount, so the discount changes their dollars too. Frequency changes the multiplier and leaves the ladder up. Compare the hours with the time the team needs. Shorter hours than the work means the sheet price does not support your margin. Charge more, lower the overhead on the visit, lower the margin, or keep the sheet price. The page recomputes from what you enter.",
];

export const CALCULATOR_FAQS: { question: string; answer: string }[] = [
  {
    question: "Where do the prices on this calculator come from?",
    answer:
      "The base, the service minimum, the home-condition amounts, the add-on amounts, and the frequency discounts come from the TidyWise rate sheet that quotes use. Wage, supply cost, overhead, and margin are the numbers you enter. The page does not look up what other companies charge.",
  },
  {
    question: "Should I enter square footage or bedrooms and bathrooms?",
    answer:
      "Use one. Square footage picks a tier, and every home up to that tier's ceiling shares one base. A home past the largest tier uses the largest tier. Bedrooms and bathrooms use the grid. An exact pair uses that row. If the pair is missing, the calculator keeps your bedroom count and uses the closest bathroom on that row, which is the same fallback the booking form uses. A base of zero uses the service minimum. A positive base below the minimum is raised to the minimum before condition, add-ons, and the discount.",
  },
  {
    question: "Why do the oven and the fridge share one price?",
    answer:
      "The rate sheet has one appliances extra. Selecting inside oven, inside fridge, or both adds that extra once. A deep clean already includes the inside of the oven, and a move-in/out clean already includes the fridge, so those included items are not charged again. Windows and laundry each have their own amount.",
  },
  {
    question: "What is the recommended price range?",
    answer:
      "It is the same subtotal priced at weekly, biweekly, monthly, and one-time, after rounding to the nearest dollar. The low end is the smallest of those prices and the high end is the largest. It is the suggested recurring discount ladder, using the default discounts. It is not a survey of local prices.",
  },
  {
    question: "What are estimated hours?",
    answer:
      "The rate sheet stores prices, not how long a clean takes. Estimated hours are how long the team can work and still leave your target margin after supply cost and the overhead share. Enter an hourly wage and a margin to see them. If the quote cannot cover supplies, overhead, and the margin, the page shows the shortfall instead of a negative hour count.",
  },
  {
    question: "How is monthly overhead split across visits?",
    answer:
      "Weekly divides the month by 52 ÷ 12 visits. Biweekly divides it by 26 ÷ 12. Monthly uses one visit. A one-time clean has no later visit to share the month with, so the full monthly overhead you entered is assigned to that visit. Enter zero if the job should not carry overhead.",
  },
  {
    question: "Will this match a quote inside TidyWise?",
    answer:
      "It matches a quote on the default rate sheet: the same base calculation, the same minimum, the same condition amounts, the same add-on amounts, the same default frequency discounts, and the same round-to-the-nearest-dollar step. Pet fees, skipped-room reductions, weekend or holiday surcharges, and discounts a business has edited live on that business's booking form, not on this public page.",
  },
  {
    question: "Do I need an account or an email to use it?",
    answer:
      "No. The math runs in the browser from the rate sheet and the numbers you type. This page does not ask for an email. Starting a trial is a separate step and does not require a card.",
  },
];

export function explainerWordCount(): number {
  return EXPLAINER_PARAGRAPHS.join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCalculatorPrerenderBody(): string {
  const labels = [
    ...Object.values(CALCULATOR_INPUT_LABELS),
    ...CLEAN_TYPE_OPTIONS.map((option) => option.label),
    ...FREQUENCY_OPTIONS.map((option) => option.label),
    ...homeConditionOptions.map((option) => option.label),
  ];
  const parts: string[] = ['<h2>How to price a house clean</h2>'];
  for (const paragraph of EXPLAINER_PARAGRAPHS) {
    parts.push(`<p>${escapeHtml(paragraph)}</p>`);
  }
  parts.push("<h2>Formula</h2><ol>");
  for (const step of FORMULA_STEPS) {
    parts.push(`<li>${escapeHtml(step)}</li>`);
  }
  parts.push("</ol><h2>Calculator inputs</h2><ul>");
  for (const label of labels) {
    parts.push(`<li>${escapeHtml(label)}</li>`);
  }
  parts.push("</ul><h2>Frequently asked questions</h2><dl>");
  for (const faq of CALCULATOR_FAQS) {
    parts.push(`<dt>${escapeHtml(faq.question)}</dt><dd>${escapeHtml(faq.answer)}</dd>`);
  }
  parts.push("</dl>");
  parts.push(`<p><a href="/signup">${escapeHtml(TRIAL_CTA_LABEL)}</a></p>`);
  parts.push(`<p><a href="/pricing">${escapeHtml(SEE_PLANS_LABEL)}</a></p>`);
  return parts.join("");
}

export function calculatorJsonLd(): Record<string, unknown>[] {
  return [
    {
      "@type": "WebApplication",
      name: "House Cleaning Price Calculator",
      url: `https://www.jointidywise.com${CALCULATOR_PATH}`,
      description: CALCULATOR_DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: CALCULATOR_FAQS.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
  ];
}
