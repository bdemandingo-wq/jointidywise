/**
 * Public pricing catalog. /pricing is the source of truth for plan names,
 * prices, and the short feature lists on the cards. Post-onboarding
 * (/choose-plan) imports this module so the two pages cannot drift.
 *
 * The long comparison table stays on the public page; these are the bullets
 * a person uses to choose.
 */

export interface PublicTier {
  id: "basic" | "pro" | "custom";
  name: string;
  tagline: string;
  monthlyPrice: number;
  yearlyPrice: number;
  highlight?: boolean;
  features: string[];
}

export const PUBLIC_TIERS: PublicTier[] = [
  {
    id: "basic",
    name: "Basic",
    tagline: "Run jobs, get paid, keep customers organized.",
    monthlyPrice: 49,
    yearlyPrice: 490,
    features: [
      "Unlimited customers, jobs and staff — no per-user fees",
      "Online booking that takes payment",
      "Scheduling and recurring jobs",
      "Estimates, invoices and Stripe payouts",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Everything in Basic, plus the growth toolkit.",
    monthlyPrice: 97,
    yearlyPrice: 970,
    highlight: true,
    features: [
      "Everything in Basic",
      "Automated review requests, reminders and win-backs",
      "Payroll for your cleaners",
      "AI assistant and advanced reports",
      "Client portal — your customers get their own login",
    ],
  },
  {
    id: "custom",
    name: "Custom",
    tagline: "Pro features + we do the heavy lifting for you.",
    monthlyPrice: 197,
    yearlyPrice: 1970,
    features: [
      "Everything in Pro",
      "One done-for-you request every month — website build, CRM import, marketing setup, or anything custom",
      "Priority support",
    ],
  },
];

export const LIFETIME_PRICE = 300;

/**
 * Founding lifetime spots. Auth copy and the client cap both read this.
 * The owner is confirming 50 vs 100; leave it at 100 until that lands.
 * The spots-left counter still uses the live remaining count.
 */
export const LIFETIME_SPOT_CAP = 100;

export const LIFETIME_FEATURES = [
  "Every Pro feature, forever",
  "All future features included free",
  "No recurring bill — ever",
  "Excludes the Custom plan done-for-you requests",
];
