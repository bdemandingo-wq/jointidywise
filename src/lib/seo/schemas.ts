// Reusable schema.org JSON-LD builders for TidyWise pages.

import { SUPPORT_EMAIL } from "../supportEmail";
import { LIFETIME_PRICE, LIFETIME_SPOT_CAP, PUBLIC_TIERS } from "../publicPlans";

const SITE = "https://www.jointidywise.com";

export const HOME_FAQS: FaqItem[] = [
  {
    question: "What is TidyWise?",
    answer:
      "TidyWise is all-in-one cleaning business software for solo cleaners and teams. It handles online booking, scheduling, CRM, invoicing, payments, payroll, GPS tracking, two-way SMS, and route optimization in a single app.",
  },
  {
    question: "How much does TidyWise cost?",
    answer:
      `Plans start at $${PUBLIC_TIERS.find((tier) => tier.id === "basic")?.monthlyPrice}/mo for Basic, $${PUBLIC_TIERS.find((tier) => tier.id === "pro")?.monthlyPrice}/mo for Pro, $${PUBLIC_TIERS.find((tier) => tier.id === "custom")?.monthlyPrice}/mo for Custom, and a one-time $${LIFETIME_PRICE} Lifetime deal (limited to ${LIFETIME_SPOT_CAP} spots). All plans include unlimited users and bookings.`,
  },
  {
    question: "Is there a free trial?",
    answer:
      "Yes — every new account gets 30 days of Pro with no card, so you can run real jobs, schedule cleaners, send invoices, and test payroll before paying anything.",
  },
  {
    question: "Can I manage my cleaning team with TidyWise?",
    answer:
      "Yes. TidyWise includes staff scheduling, automated payroll, GPS check-ins, on-the-way SMS, performance tracking, and a dedicated cleaner mobile app so your whole team works from one system.",
  },
  {
    question: "Does TidyWise work for solo cleaners?",
    answer:
      "Absolutely. Solo cleaners use TidyWise for online booking, automated reminders, invoicing, card payments, and recurring jobs — without any team setup required.",
  },
  {
    question: "What happens after my free trial ends?",
    answer:
      "After the trial you can pick any paid plan to keep using TidyWise. Your data, customers, and schedule remain intact. If you don't upgrade, your account simply pauses — nothing is deleted.",
  },
];

const PRICE_LOW = "49";
const PRICE_HIGH = String(LIFETIME_PRICE);

const CORE_FEATURES = [
  "Online booking",
  "Drag-and-drop scheduling",
  "Automated payroll",
  "GPS tracking & on-the-way alerts",
  "Invoicing and payments",
  "CRM and customer messaging",
  "Recurring jobs and reminders",
  "Estimates and quotes",
  "Route optimization",
  "Two-way SMS via OpenPhone",
];

export function organizationSchema() {
  return {
    "@type": "Organization",
    name: "TIDYWISE",
    url: SITE,
    logo: `${SITE}/images/tidywise-logo.png`,
    email: SUPPORT_EMAIL,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      url: `${SITE}/contact`,
    },
    sameAs: [] as string[],
  };
}

/**
 * LocalBusiness-style entry for the homepage. TidyWise is SaaS (no
 * physical storefront), so we describe the service area as the United
 * States rather than fabricating an address.
 */
export function localBusinessSchema() {
  return {
    "@type": "LocalBusiness",
    "@id": `${SITE}#localbusiness`,
    name: "TIDYWISE",
    url: SITE,
    image: `${SITE}/images/tidywise-og.png`,
    logo: `${SITE}/images/tidywise-logo.png`,
    email: SUPPORT_EMAIL,
    description:
      "Cleaning business management software — booking, scheduling, invoicing, payroll, CRM, and GPS tracking for residential and commercial cleaning companies.",
    priceRange: `$49 – $${LIFETIME_PRICE}`,
    areaServed: {
      "@type": "Country",
      name: "United States",
    },
    serviceType: "Cleaning business management software",
  };
}

const PRICING_OFFERS = [
  { name: "Basic", price: "49", interval: "month" },
  { name: "Pro", price: "97", interval: "month" },
  { name: "Custom", price: "197", interval: "month" },
  { name: "Lifetime", price: String(LIFETIME_PRICE), interval: "lifetime" },
];

export function softwareApplicationSchema(opts?: {
  name?: string;
  description?: string;
  featureList?: string[];
  withOfferList?: boolean;
}) {
  const withOfferList = opts?.withOfferList ?? false;
  return {
    "@type": "SoftwareApplication",
    name: opts?.name ?? "TIDYWISE",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    description:
      opts?.description ??
      "All-in-one cleaning business software: booking, scheduling, CRM, invoicing, payroll, and GPS tracking. Plans from $49/mo.",
    featureList: opts?.featureList ?? CORE_FEATURES,
    offers: withOfferList
      ? PRICING_OFFERS.map((o) => ({
          "@type": "Offer",
          name: o.name,
          price: o.price,
          priceCurrency: "USD",
          category: o.interval === "lifetime" ? "OneTimePayment" : "Subscription",
          url: `${SITE}/pricing`,
        }))
      : {
          "@type": "AggregateOffer",
          lowPrice: PRICE_LOW,
          highPrice: PRICE_HIGH,
          priceCurrency: "USD",
          offerCount: "4",
        },
  };
}

export interface Crumb {
  name: string;
  path: string; // site-relative, e.g. "/features/booking"
}

export function breadcrumbSchema(crumbs: Crumb[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.path.startsWith("http") ? c.path : `${SITE}${c.path}`,
    })),
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqSchema(faqs: FaqItem[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

/**
 * Convenience helper — every /features/* page gets a SoftwareApplication
 * scoped to the feature, plus a Home > Features > {feature} breadcrumb.
 */
export function featurePageSchemas(args: {
  featureName: string; // e.g. "Online Booking Software"
  description: string;
  path: string; // e.g. "/features/booking"
  crumbLabel?: string; // override the leaf label
  featureList?: string[];
}) {
  return [
    softwareApplicationSchema({
      name: `TIDYWISE — ${args.featureName}`,
      description: args.description,
      featureList: args.featureList,
    }),
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Features", path: "/" },
      { name: args.crumbLabel ?? args.featureName, path: args.path },
    ]),
  ];
}
