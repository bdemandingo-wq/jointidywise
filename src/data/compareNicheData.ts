/**
 * Data powering the programmatic /compare/:competitorSlug/for/:nicheSlug pages.
 *
 * 6 competitors × 6 niches = 36 pages, all rendered by CompareNichePage.tsx.
 * Content is intentionally differentiated per niche (pain points, feature
 * mapping, FAQs) so pages don't read as thin duplicates — the comparison
 * genuinely changes depending on who's doing the cleaning.
 *
 * Pricing claims mirror the handcrafted /compare/* pages — keep both in sync.
 */

export interface CompetitorData {
  slug: string;
  name: string;
  /** Display pricing range, e.g. "$69–$349/month" */
  pricing: string;
  /** One-line positioning of the competitor */
  positioning: string;
  /** What this competitor lacks (used in verdict + table) */
  weaknesses: string[];
  /** Feature map for the comparison table. true / false / string caveat */
  features: Record<string, boolean | string>;
}

export interface NicheData {
  slug: string;
  /** e.g. "Airbnb Cleaners" — used in H1/title */
  name: string;
  /** lowercase inline usage, e.g. "Airbnb turnover cleaners" */
  inline: string;
  /** 2–3 sentence intro paragraph, niche-specific */
  intro: string;
  /** Pain points specific to this niche */
  painPoints: string[];
  /** TidyWise features that matter most to this niche */
  tidywiseFeatures: { title: string; description: string }[];
  /** Feature-table rows that matter to this niche (keys into features map) */
  tableRows: string[];
  /** Niche-specific FAQs (competitor name interpolated with {competitor}) */
  faqs: { question: string; answer: string }[];
}

export const TIDYWISE_FEATURE_MAP: Record<string, boolean | string> = {
  "Monthly Pricing": "$49/month flat",
  "Automated Payroll": true,
  "P&L Reports": true,
  "Recurring Bookings": true,
  "Online Booking": true,
  "GPS Check-ins": true,
  "Photo Documentation": true,
  "In-App SMS Inbox": true,
  "Review Requests": true,
  "Square Footage Pricing": true,
  "Quotes & Estimates": true,
  "Deposits & Card-on-File": true,
  "Multi-location": true,
  "Team Scheduling": true,
  "Client Portal": true,
  "Loyalty Programs": true,
  "AI Revenue Tools": true,
  "Inventory Tracking": true,
};

export const COMPETITORS: Record<string, CompetitorData> = {
  jobber: {
    slug: "jobber",
    name: "Jobber",
    pricing: "",
    positioning:
      "Jobber is a general field-service platform covering landscaping, HVAC, plumbing, and cleaning. Solid scheduling, but cleaning-specific workflows are an afterthought and pricing climbs fast as you add features.",
    weaknesses: [
      "No automated payroll",
      "No P&L reporting",
      "SMS inbox and review requests are paid add-ons",
      "Cleaning-specific workflows are limited",
    ],
    features: {
      "Monthly Pricing": "—",
      "Automated Payroll": false,
      "P&L Reports": false,
      "Recurring Bookings": true,
      "Online Booking": true,
      "GPS Check-ins": true,
      "Photo Documentation": true,
      "In-App SMS Inbox": "Add-on",
      "Review Requests": "Add-on",
      "Square Footage Pricing": false,
      "Quotes & Estimates": true,
      "Deposits & Card-on-File": true,
      "Multi-location": "Higher tiers",
      "Team Scheduling": true,
      "Client Portal": true,
      "Loyalty Programs": false,
      "AI Revenue Tools": false,
      "Inventory Tracking": false,
    },
  },
  "housecall-pro": {
    slug: "housecall-pro",
    name: "Housecall Pro",
    pricing: "",
    positioning:
      "Housecall Pro was built for plumbers and HVAC techs first. It handles dispatch well, but has no cleaning-specific pricing models, no payroll, and no P&L reporting.",
    weaknesses: [
      "Built for HVAC and plumbing, not cleaning",
      "No square-footage or room-based pricing",
      "No automated payroll",
      "No P&L reports",
    ],
    features: {
      "Monthly Pricing": "—",
      "Automated Payroll": false,
      "P&L Reports": false,
      "Recurring Bookings": true,
      "Online Booking": true,
      "GPS Check-ins": true,
      "Photo Documentation": true,
      "In-App SMS Inbox": true,
      "Review Requests": "Add-on",
      "Square Footage Pricing": false,
      "Quotes & Estimates": true,
      "Deposits & Card-on-File": true,
      "Multi-location": "Higher tiers",
      "Team Scheduling": true,
      "Client Portal": true,
      "Loyalty Programs": false,
      "AI Revenue Tools": false,
      "Inventory Tracking": false,
    },
  },
  zenmaid: {
    slug: "zenmaid",
    name: "ZenMaid",
    pricing: "",
    positioning:
      "ZenMaid is a simple scheduler for maid services. It's affordable at low volume, but pricing scales with your booking count, and there's no payroll, P&L, or AI tooling as you grow.",
    weaknesses: [
      "Pricing scales with booking volume",
      "No automated payroll",
      "Basic reporting — no P&L",
      "No AI tools or inventory tracking",
    ],
    features: {
      "Monthly Pricing": "—",
      "Automated Payroll": false,
      "P&L Reports": false,
      "Recurring Bookings": true,
      "Online Booking": true,
      "GPS Check-ins": true,
      "Photo Documentation": "Limited",
      "In-App SMS Inbox": true,
      "Review Requests": true,
      "Square Footage Pricing": "Limited",
      "Quotes & Estimates": "Limited",
      "Deposits & Card-on-File": true,
      "Multi-location": false,
      "Team Scheduling": true,
      "Client Portal": false,
      "Loyalty Programs": false,
      "AI Revenue Tools": false,
      "Inventory Tracking": false,
    },
  },
  "booking-koala": {
    slug: "booking-koala",
    name: "BookingKoala",
    pricing: "",
    positioning:
      "BookingKoala focuses on online booking forms and customer-facing flows. Booking is strong, but back-office features like payroll, P&L, and AI pricing tools are missing.",
    weaknesses: [
      "No automated payroll",
      "No P&L reports",
      "No AI revenue tools",
      "Back-office tools such as payroll and P&L are missing",
    ],
    features: {
      "Monthly Pricing": "—",
      "Automated Payroll": false,
      "P&L Reports": false,
      "Recurring Bookings": true,
      "Online Booking": true,
      "GPS Check-ins": "Limited",
      "Photo Documentation": "Limited",
      "In-App SMS Inbox": true,
      "Review Requests": true,
      "Square Footage Pricing": true,
      "Quotes & Estimates": true,
      "Deposits & Card-on-File": true,
      "Multi-location": "Higher tiers",
      "Team Scheduling": true,
      "Client Portal": true,
      "Loyalty Programs": "Limited",
      "AI Revenue Tools": false,
      "Inventory Tracking": false,
    },
  },
  launch27: {
    slug: "launch27",
    name: "Launch27",
    pricing: "",
    positioning:
      "Launch27 handles booking for cleaning companies.",
    weaknesses: [
      "Not built around cleaner payroll",
      "Not built as a cleaner mobile app",
      "No P&L reporting",
      "No AI tools",
    ],
    features: {
      "Monthly Pricing": "—",
      "Automated Payroll": "Not on every plan",
      "P&L Reports": false,
      "Recurring Bookings": true,
      "Online Booking": true,
      "GPS Check-ins": "Limited",
      "Photo Documentation": "Limited",
      "In-App SMS Inbox": true,
      "Review Requests": true,
      "Square Footage Pricing": true,
      "Quotes & Estimates": true,
      "Deposits & Card-on-File": true,
      "Multi-location": false,
      "Team Scheduling": true,
      "Client Portal": true,
      "Loyalty Programs": false,
      "AI Revenue Tools": false,
      "Inventory Tracking": false,
    },
  },
  servicetitan: {
    slug: "servicetitan",
    name: "ServiceTitan",
    pricing: "",
    positioning:
      "ServiceTitan is enterprise software for HVAC, plumbing, and electrical contractors. It's powerful but priced per user, takes weeks to implement, and has no cleaning-specific features.",
    weaknesses: [
      "Priced per user",
      "Built for HVAC/plumbing/electrical",
      "Implementation takes weeks to months",
      "Payroll is a separate add-on cost",
    ],
    features: {
      "Monthly Pricing": "—",
      "Automated Payroll": "Paid add-on",
      "P&L Reports": true,
      "Recurring Bookings": true,
      "Online Booking": true,
      "GPS Check-ins": true,
      "Photo Documentation": true,
      "In-App SMS Inbox": true,
      "Review Requests": true,
      "Square Footage Pricing": false,
      "Quotes & Estimates": true,
      "Deposits & Card-on-File": true,
      "Multi-location": true,
      "Team Scheduling": true,
      "Client Portal": true,
      "Loyalty Programs": false,
      "AI Revenue Tools": "Limited",
      "Inventory Tracking": true,
    },
  },
};

export const NICHES: Record<string, NicheData> = {
  "airbnb-cleaners": {
    slug: "airbnb-cleaners",
    name: "Airbnb Cleaners",
    inline: "Airbnb turnover cleaners",
    intro:
      "Airbnb turnover cleaning runs on tight windows: guest checks out at 11, next guest arrives at 4, and the calendar changes without warning. The software you pick either handles same-day rescheduling, recurring turnovers, and photo proof of every clean — or it becomes the bottleneck.",
    painPoints: [
      "Turnover windows of 3–5 hours with zero room for scheduling errors",
      "Hosts demand photo proof the unit is guest-ready",
      "Booking calendars change constantly with guest cancellations",
      "Managing 10–50 recurring units across multiple hosts",
    ],
    tidywiseFeatures: [
      {
        title: "Recurring Turnover Scheduling",
        description:
          "Set up recurring cleans per unit and adjust on the fly when a host's calendar shifts. Drag-and-drop rescheduling keeps tight turnover windows intact.",
      },
      {
        title: "Photo Documentation",
        description:
          "Cleaners photograph every room before clocking out. Hosts get visual proof the unit is guest-ready — disputes drop to near zero.",
      },
      {
        title: "GPS Check-ins & On-My-Way Texts",
        description:
          "Know the moment your cleaner arrives at the unit. Hosts get automatic notifications, so you stop fielding \"is it done yet?\" messages.",
      },
      {
        title: "Client Portal for Hosts",
        description:
          "Each host logs in to see their units' cleaning history, photos, and invoices. One portal replaces dozens of text threads.",
      },
    ],
    tableRows: [
      "Monthly Pricing",
      "Recurring Bookings",
      "Photo Documentation",
      "GPS Check-ins",
      "Client Portal",
      "In-App SMS Inbox",
      "Automated Payroll",
      "P&L Reports",
    ],
    faqs: [
      {
        question: "Can TidyWise handle same-day turnover rescheduling?",
        answer:
          "Yes. The drag-and-drop calendar lets you move a turnover clean in seconds and automatically notifies the assigned cleaner by SMS and push notification. {competitor} supports rescheduling too, but TidyWise pairs it with automatic host notifications and photo proof at completion.",
      },
      {
        question: "How do hosts get proof the unit is guest-ready?",
        answer:
          "Cleaners are required to photo-document rooms before clocking out. Photos appear instantly in the host's client portal, creating a visual record for every turnover.",
      },
      {
        question: "Does per-booking pricing hurt high-volume turnover businesses?",
        answer:
          "It can. Turnover businesses run high booking counts at lower ticket prices, so software that charges by booking volume gets expensive fast. TidyWise is a flat $49/month regardless of how many turnovers you run.",
      },
    ],
  },
  "solo-cleaners": {
    slug: "solo-cleaners",
    name: "Solo Cleaners",
    inline: "solo cleaners and owner-operators",
    intro:
      "When you're the owner, the cleaner, the scheduler, and the bookkeeper, software has to earn its cost from day one. Solo cleaners need booking, invoicing, reminders, and simple finances in one place — without paying enterprise prices for features built for 50-person crews.",
    painPoints: [
      "Every dollar of software cost comes straight out of your pocket",
      "Admin work happens at night after cleaning all day",
      "Missed appointment reminders mean lost income you can't recover",
      "No time to stitch together five different tools",
    ],
    tidywiseFeatures: [
      {
        title: "One Flat Price, Everything Included",
        description:
          "Booking, scheduling, invoicing, reminders, and reviews for $49/month. No per-user fees, no add-ons, no surprise tier upgrades as you grow.",
      },
      {
        title: "Automated Reminders & Review Requests",
        description:
          "Confirmations, reminders, and review requests send themselves. Fewer no-shows and a steady stream of 5-star reviews with zero evening admin.",
      },
      {
        title: "Online Booking That Sells While You Clean",
        description:
          "Clients book and pay online 24/7 with square-footage or room-based pricing. Wake up to new jobs instead of missed calls.",
      },
      {
        title: "Simple P&L",
        description:
          "See profit per job and per month without a spreadsheet. Know exactly what you made after supplies and mileage.",
      },
    ],
    tableRows: [
      "Monthly Pricing",
      "Online Booking",
      "Square Footage Pricing",
      "Review Requests",
      "In-App SMS Inbox",
      "P&L Reports",
      "Quotes & Estimates",
      "Deposits & Card-on-File",
    ],
    faqs: [
      {
        question: "Is TidyWise overkill for a one-person cleaning business?",
        answer:
          "No — everything is usable solo from day one, and the features you grow into (payroll, team scheduling) are already included when you hire your first cleaner. You never migrate platforms mid-growth.",
      },
      {
        question: "How does the pricing compare for solo operators?",
        answer:
          "TidyWise is a flat $49/month. Review requests, SMS, and reporting are included. Check {competitor}'s site for their current price.",
      },
      {
        question: "Can clients book online without me answering the phone?",
        answer:
          "Yes. Your booking page quotes by square footage or room count, takes payment or a card on file, and drops the job straight onto your calendar.",
      },
    ],
  },
  "commercial-cleaning": {
    slug: "commercial-cleaning",
    name: "Commercial Cleaning Companies",
    inline: "commercial cleaning companies",
    intro:
      "Commercial cleaning is a contracts business: recurring office schedules, multi-site clients, crews on payroll, and invoices on net-30 terms. The software question isn't \"can it book a house clean\" — it's whether it can run recurring contracts, teams, and real financial reporting.",
    painPoints: [
      "Recurring contracts across dozens of sites with different schedules",
      "Crews and supervisors that need payroll, not gig payouts",
      "Clients that expect monthly invoicing and clean paper trails",
      "Bidding new contracts requires knowing your true cost per job",
    ],
    tidywiseFeatures: [
      {
        title: "Recurring Contract Scheduling",
        description:
          "Set nightly, weekly, or custom recurring schedules per site. Assign crews, track completion, and adjust without rebuilding the calendar.",
      },
      {
        title: "Automated Payroll",
        description:
          "Flat, hourly, or percentage pay calculated automatically from completed jobs. Payroll periods, reports, and payouts without spreadsheets.",
      },
      {
        title: "P&L and Profit-Per-Contract Reporting",
        description:
          "Know which contracts make money and which bleed it. Real P&L reporting makes your next bid a calculation, not a guess.",
      },
      {
        title: "Multi-location & Team Management",
        description:
          "Run multiple branches or territories under one account with team scheduling, GPS check-ins, and supervisor oversight.",
      },
    ],
    tableRows: [
      "Monthly Pricing",
      "Recurring Bookings",
      "Automated Payroll",
      "P&L Reports",
      "Multi-location",
      "Team Scheduling",
      "GPS Check-ins",
      "Quotes & Estimates",
    ],
    faqs: [
      {
        question: "Can TidyWise handle recurring commercial contracts?",
        answer:
          "Yes. Recurring schedules are per-client and per-site, with crew assignment and completion tracking. Invoicing can run per visit or consolidated monthly.",
      },
      {
        question: "How does payroll compare to {competitor}?",
        answer:
          "TidyWise calculates wages automatically from completed jobs — flat, hourly, or percentage — and generates payroll period reports. With {competitor}, payroll is either missing or requires a separate paid product.",
      },
      {
        question: "Does per-user pricing punish growing crews?",
        answer:
          "TidyWise includes unlimited users on Pro, so headcount growth doesn't add a per-seat software bill.",
      },
    ],
  },
  "move-out-cleaning": {
    slug: "move-out-cleaning",
    name: "Move-Out Cleaning Companies",
    inline: "move-out and move-in cleaning companies",
    intro:
      "Move-out cleaning is a big-ticket, one-shot business: $300–$1,500 jobs, strangers on tight lease deadlines, and no repeat relationship to fall back on. Quotes must be fast, deposits must be collected up front, and before/after photos are your only defense in disputes.",
    painPoints: [
      "One-off customers with no booking history — every job starts cold",
      "High ticket prices mean no-shows and cancellations hurt badly",
      "Landlord and tenant disputes over what was actually cleaned",
      "Quoting accurately for homes you've never seen",
    ],
    tidywiseFeatures: [
      {
        title: "Instant Square-Footage Quotes",
        description:
          "Customers get an accurate quote online by entering home size and condition. No site visits, no phone tag, no underpriced surprises.",
      },
      {
        title: "Deposits & Card-on-File",
        description:
          "Collect a deposit at booking and keep a card on file. No-shows and last-minute cancellations stop costing you a full day's revenue.",
      },
      {
        title: "Before/After Photo Documentation",
        description:
          "Cleaners document every room. When a landlord claims the oven wasn't cleaned, you have timestamped photos that say otherwise.",
      },
      {
        title: "Automated Follow-Ups",
        description:
          "Quote reminders and abandoned-booking follow-ups run automatically, recovering big-ticket jobs that would otherwise slip away.",
      },
    ],
    tableRows: [
      "Monthly Pricing",
      "Square Footage Pricing",
      "Deposits & Card-on-File",
      "Photo Documentation",
      "Quotes & Estimates",
      "Online Booking",
      "Review Requests",
      "P&L Reports",
    ],
    faqs: [
      {
        question: "Can I require a deposit for move-out cleans?",
        answer:
          "Yes. TidyWise collects deposits at booking and stores a card on file for the balance, which protects you on high-ticket jobs where a no-show means losing a full day.",
      },
      {
        question: "How do quotes work for homes I haven't seen?",
        answer:
          "Your booking page prices by square footage, bedrooms/bathrooms, and condition add-ons. Customers see the price instantly, and you can adjust before confirming if needed.",
      },
      {
        question: "How does this compare to {competitor} for one-off jobs?",
        answer:
          "{competitor} can book one-off jobs, but TidyWise pairs booking with deposits, before/after photo proof, and automated quote follow-ups — the three things that decide whether a move-out cleaning business is profitable.",
      },
    ],
  },
  "maid-services": {
    slug: "maid-services",
    name: "Maid Services",
    inline: "recurring residential maid services",
    intro:
      "Recurring residential cleaning lives and dies by retention: the same homes, every week or two, with the same trusted cleaners. Software for maid services has to protect the recurring schedule, keep clients loyal, and run payroll for a growing W-2 team.",
    painPoints: [
      "One lost recurring client erases months of acquisition work",
      "Clients expect the same cleaner and a consistent routine",
      "Weekly payroll across a team of cleaners eats owner hours",
      "Skipped and rescheduled cleans quietly drain revenue",
    ],
    tidywiseFeatures: [
      {
        title: "Recurring Schedules with Preferred Cleaners",
        description:
          "Lock in weekly or biweekly schedules with cleaner preferences honored automatically. Reschedules and skips are tracked so lapses don't slip by.",
      },
      {
        title: "Loyalty Programs",
        description:
          "Built-in points and rewards keep recurring clients from shopping around. Loyalty progress emails run automatically.",
      },
      {
        title: "Automated Payroll",
        description:
          "Wages calculate from completed jobs across your whole team. Weekly payroll reports arrive without opening a spreadsheet.",
      },
      {
        title: "Lapse Alerts & Win-Back Campaigns",
        description:
          "When a recurring client skips or cancels, TidyWise flags it and can trigger win-back offers automatically before they're gone for good.",
      },
    ],
    tableRows: [
      "Monthly Pricing",
      "Recurring Bookings",
      "Loyalty Programs",
      "Automated Payroll",
      "Team Scheduling",
      "Review Requests",
      "Client Portal",
      "P&L Reports",
    ],
    faqs: [
      {
        question: "Can clients keep their preferred cleaner?",
        answer:
          "Yes. Cleaner preferences are stored per client and honored in scheduling, which is one of the biggest drivers of recurring retention.",
      },
      {
        question: "What happens when a recurring client starts skipping cleans?",
        answer:
          "TidyWise flags lapsed recurring bookings and can automatically send win-back offers. Most platforms, including {competitor}, leave you to notice churn on your own.",
      },
      {
        question: "How much time does automated payroll actually save?",
        answer:
          "Owners running 5–15 cleaners typically spend 3–6 hours per pay period on manual payroll. TidyWise calculates wages from completed jobs automatically and emails the payroll report.",
      },
    ],
  },
  "carpet-cleaning": {
    slug: "carpet-cleaning",
    name: "Carpet Cleaning Companies",
    inline: "carpet and upholstery cleaning companies",
    intro:
      "Carpet cleaning is a quote-and-upsell business: price by rooms and square footage, then grow the ticket with upholstery, stain treatment, and protectant on site. The right software quotes accurately, captures upsells, and books the repeat clean before the tech leaves the driveway.",
    painPoints: [
      "Pricing varies by room count, square footage, and condition",
      "The real profit is in on-site upsells that often go untracked",
      "Customers only think of you once a year — repeat visits must be engineered",
      "Equipment and chemical costs eat margins if untracked",
    ],
    tidywiseFeatures: [
      {
        title: "Room & Square-Footage Pricing",
        description:
          "Quote by rooms, square footage, and add-ons like stain treatment or pet odor. Customers see accurate prices online before you roll a truck.",
      },
      {
        title: "Post-Booking Upsells",
        description:
          "Offer upholstery, protectant, and add-on services at booking and after. Ticket sizes grow without awkward on-site pitches.",
      },
      {
        title: "Rebooking Reminders",
        description:
          "Automatic 6- or 12-month rebooking reminders bring customers back when their carpets need it — before they Google a competitor.",
      },
      {
        title: "Inventory Tracking",
        description:
          "Track chemicals and supplies per job so margins stay visible. Know your true cost per clean, not just revenue.",
      },
    ],
    tableRows: [
      "Monthly Pricing",
      "Square Footage Pricing",
      "Quotes & Estimates",
      "Inventory Tracking",
      "Review Requests",
      "Online Booking",
      "AI Revenue Tools",
      "P&L Reports",
    ],
    faqs: [
      {
        question: "Can TidyWise price by rooms and square footage?",
        answer:
          "Yes — booking pages support room-based, square-footage, and add-on pricing, so carpet jobs quote accurately online without a site visit.",
      },
      {
        question: "How do rebooking reminders work?",
        answer:
          "TidyWise automatically reminds past customers to rebook on the schedule you set — typically 6 or 12 months for carpet cleaning — turning one-off jobs into a recurring revenue base.",
      },
      {
        question: "Does {competitor} track supplies and chemicals?",
        answer:
          "Generally no — inventory tracking is rare in this category. TidyWise tracks supplies per job so you can see true margin per clean, which matters when chemical and fuel costs fluctuate.",
      },
    ],
  },
};

/** All valid competitor/niche combos for routing + prerender enumeration. */
export function allCompareNicheRoutes(): { competitorSlug: string; nicheSlug: string; path: string }[] {
  const routes: { competitorSlug: string; nicheSlug: string; path: string }[] = [];
  for (const c of Object.keys(COMPETITORS)) {
    for (const n of Object.keys(NICHES)) {
      routes.push({ competitorSlug: c, nicheSlug: n, path: `/compare/${c}/for/${n}` });
    }
  }
  return routes;
}
