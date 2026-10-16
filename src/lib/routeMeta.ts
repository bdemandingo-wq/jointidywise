/**
 * Per-route SEO metadata.
 *
 * Used by the build-time prerender plugin to bake correct title / description /
 * canonical / OG tags / H1 into static HTML for each known marketing route.
 *
 * Constraints (Encited audit):
 * - title: 10–60 chars
 * - description: 50–160 chars
 * - canonical: absolute URL on the preferred (www) domain
 *
 * If a route isn't listed here, the prerender falls back to the homepage tags.
 */

export type RouteMeta = {
  title: string;
  description: string;
  h1: string;
  /**
   * Override the canonical URL. Use when this route is a duplicate of
   * another (e.g. /auth is a duplicate of /login) and search engines
   * should consolidate ranking on the preferred URL.
   * Path-only (e.g. "/login"); the prerender prepends the base URL.
   */
  canonicalPath?: string;
  /**
   * Optional extra HTML to inject into the prerendered <body> inside a
   * <noscript> block. Use to surface internal links to non-JS crawlers
   * on pages that gate their navigation behind React-rendered components.
   * Keep escaped/trusted only — value is inlined verbatim.
   */
  noscriptBody?: string;
  /**
   * Visible HTML injected inside <div id="root"> in prerendered pages.
   * React's createRoot replaces #root children on mount, so this is only
   * seen by crawlers reading the static HTML and by users during the
   * sub-second window before JS loads. Provides real body content for
   * crawlers that would otherwise see an empty page.
   */
  prerenderBody?: string;
  /**
   * Optional JSON-LD structured data injected into <head> as
   * <script type="application/ld+json">. Pass a single schema object or an
   * array (will be wrapped in @graph). Useful for LocalBusiness, Article, etc.
   */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

const BRAND = "TidyWise";

// Static marketing routes — handcrafted metadata so each is unique.
export const STATIC_ROUTE_META: Record<string, RouteMeta> = {
  "/": {
    title: "TidyWise — Cleaning Business Software & CRM",
    description:
      "All-in-one cleaning business software: online booking, scheduling, invoicing, payroll, GPS tracking, and CRM. Plans from $49/mo, or a one-time Lifetime spot at $300.",
    h1: "Run your cleaning business on one platform",
    noscriptBody: `
      <nav aria-label="Features">
        <ul>
          <li><a href="/features/scheduling-software">Scheduling Software</a></li>
          <li><a href="/features/booking">Online Booking</a></li>
          <li><a href="/features/invoicing-software">Invoicing</a></li>
          <li><a href="/features/payroll-software">Payroll</a></li>
          <li><a href="/features/route-optimization">Route Optimization</a></li>
          <li><a href="/features/crm">CRM</a></li>
          <li><a href="/features/automated-dispatching">Automated Dispatching</a></li>
          <li><a href="/features/sms-notifications">SMS Notifications</a></li>
          <li><a href="/features/payment-processing">Payment Processing</a></li>
          <li><a href="/features/quote-software">Quote Software</a></li>
          <li><a href="/pricing">Pricing — plans from $49/mo</a></li>
          <li><a href="/demo">Book a demo</a></li>
          <li><a href="/blog">Blog</a></li>
          <li><a href="/cleaning-business-software">Cleaning software by state</a></li>
          <li><a href="/score/search">TidyWise Score directory</a></li>
        </ul>
      </nav>`,
  },
  "/terms": {
    title: "Terms of Service | TidyWise",
    description:
      "The terms governing use of TidyWise cleaning business software, including subscriptions, acceptable use, and cancellation.",
    h1: "Terms of Service",
  },
  // Public, no signup required — it had been in the sitemap without meta since
  // it shipped, so crawlers were served the homepage's title and description.
  "/score/generate": {
    title: "Generate Your Free TidyWise Score | TidyWise",
    description:
      "Get a free TidyWise Score for your cleaning business in under a minute. No signup required — see how your online presence and operations compare.",
    h1: "Generate your TidyWise Score",
  },
  "/get-the-app": {
    title: "Get the TidyWise App — iPhone, iPad, Mac & Windows",
    description:
      "Install TidyWise on iPhone and iPad from the App Store, or as a desktop app on Mac and Windows. Same account and data on every device.",
    h1: "Get TidyWise on every device you work from",
  },
  "/pricing": {
    title: "Pricing — Plans from $49/mo | TidyWise",
    description:
      "TidyWise plans start at $49/mo (Basic) for cleaning businesses. Upgrade to Pro at $97/mo — unlimited users, no per-booking fees, cancel anytime.",
    h1: "Pick the plan that fits your business",
  },
  "/demo": {
    title: "Book a Demo — TidyWise Cleaning Software",
    description:
      "See how TidyWise replaces 5+ tools for cleaning businesses. Book a 20-minute demo and watch us run your scheduling, payroll, and CRM in one place.",
    h1: "See TidyWise in action",
  },
  "/referral": {
    title: "Refer a cleaning business | TidyWise",
    description:
      "Share TidyWise with another cleaning business. When two of them become paying customers, you earn a free month.",
    h1: "Refer another cleaning business",
  },
  "/contact": {
    title: "Contact TidyWise — Cleaning Business Support",
    description:
      "Reach the TidyWise team for sales, support, or partnership questions. We reply to most messages within one business day.",
    h1: "Contact our team",
    noscriptBody: `
      <nav aria-label="Related pages">
        <ul>
          <li><a href="/">TidyWise home</a></li>
          <li><a href="/pricing">Pricing</a></li>
          <li><a href="/demo">Book a demo</a></li>
          <li><a href="/blog">Cleaning business blog</a></li>
          <li><a href="/cleaning-business-software">Cleaning software by state</a></li>
          <li><a href="/privacy-policy">Privacy policy</a></li>
        </ul>
      </nav>`,
  },
  "/login": {
    title: "Log In to TidyWise | Cleaning Business Software",
    description:
      "Sign in to TidyWise to manage cleaning jobs, schedules, invoices, payroll, and your team from one dashboard.",
    h1: "Log in to TidyWise",
  },
  "/signup": {
    title: "Create your TidyWise Account",
    description:
      "Create your TidyWise account in under 60 seconds. Schedule, invoice, and run payroll from day one.",
    h1: "Create your TidyWise account",
  },
  "/auth": {
    title: "Sign In or Create Your TidyWise Account",
    description:
      "Access your TidyWise account to run your cleaning business — bookings, scheduling, invoicing, payroll, GPS, and team dispatch from one dashboard.",
    h1: "Sign in or create your TidyWise account",
    // Same underlying page as /login — consolidate ranking on /login.
    canonicalPath: "/login",
  },
  "/forgot-password": {
    title: "Reset Your TidyWise Password | Account Recovery",
    description:
      "Forgot your TidyWise password? Enter your email and we'll send a one-time reset code so you can get back into your cleaning business dashboard in minutes.",
    h1: "Reset your TidyWise password",
  },
  "/reset-password": {
    title: "Enter Reset Code & New Password | TidyWise",
    description:
      "Confirm your TidyWise reset code and choose a new password. Codes expire after a short window for account security on your cleaning business dashboard.",
    h1: "Set a new password for your TidyWise account",
  },
  "/privacy-policy": {
    title: "Privacy Policy | TidyWise",
    description:
      "How TidyWise collects, uses, and protects your cleaning business data. Read our privacy practices for customer records, payments, and staff information.",
    h1: "Privacy Policy",
  },
  "/do-not-sell": {
    title: "Do Not Sell or Share My Personal Information | TidyWise",
    description:
      "Opt out of TidyWise using Google and Meta cookies on our marketing and signup pages to measure the site and show ads.",
    h1: "Do Not Sell or Share My Personal Information",
  },
  "/delete-account": {
    title: "Delete Your TidyWise Account",
    description:
      "Request permanent deletion of your TidyWise account and associated data. Required disclosure for App Store and Google Play data-rights compliance.",
    h1: "Delete your account",
  },
  "/cleaning-business-software": {
    title: "Cleaning Business Software by State | TidyWise",
    description:
      "Cleaning business software tailored to every US state — local wage rules, market context, and pricing. Find your state's TidyWise guide.",
    h1: "Cleaning business software in every US state",
    // State grid built at prerender time below — see buildStateGridNoscript().
  },
  "/staff/login": {
    title: "Staff Login — TidyWise Cleaner App",
    description:
      "Sign in to the TidyWise staff app to view your schedule, check in to jobs, upload photos, and track your pay across all assigned cleanings.",
    h1: "Cleaner staff login",
  },
  "/portal/login": {
    title: "Client Portal Login | TidyWise",
    description:
      "Log in to your TidyWise client portal to view upcoming cleanings, request changes, manage payments, and message your cleaning team.",
    h1: "Client portal login",
  },
  "/score/search": {
    title: "TidyWise Score — Search Cleaning Companies",
    description:
      "Look up the TidyWise Score for any US cleaning business. Free, AI-graded ranking of reviews, reputation, and online presence — no signup needed.",
    h1: "Search the TidyWise Score directory",
  },

  // Blog
  "/blog": {
    title: "TidyWise Blog — Cleaning Business Insights",
    description:
      "Guides, comparisons, and growth playbooks for cleaning business owners. How to start, scale, hire, and automate a profitable cleaning company.",
    h1: "TidyWise Blog",
  },
  "/blog/best-software-for-cleaning-business": {
    title: "Best Software for Cleaning Businesses in 2026",
    description:
      "We ranked the top cleaning business software for scheduling, CRM, invoicing, and payroll. See which platform fits your size and budget.",
    h1: "The Best Cleaning Business Software in 2026",
  },
  "/blog/booking-koala-vs-jobber-vs-tidywise": {
    title: "Booking Koala vs Jobber vs TidyWise",
    description:
      "Side-by-side comparison of Booking Koala, Jobber, and TidyWise across pricing, features, payroll, and support. Pick the right tool for your cleaning business.",
    h1: "Booking Koala vs Jobber vs TidyWise",
  },
  "/blog/cleaning-business-management-software": {
    title: "Cleaning Business Management Software Guide",
    description:
      "What cleaning business management software actually does, what to look for, and how to choose between the top platforms in 2026.",
    h1: "Cleaning Business Management Software: A 2026 Guide",
  },
  "/blog/crm-for-cleaning-business": {
    title: "Best CRM for Cleaning Businesses (2026)",
    description:
      "Why a cleaning-specific CRM beats generic tools, what features matter, and how to migrate your client list without losing booking history.",
    h1: "Choosing a CRM for Your Cleaning Business",
  },
  "/blog/gps-tracking-cleaning-business": {
    title: "GPS Tracking for Cleaning Businesses",
    description:
      "How GPS tracking cuts fuel costs, proves on-time arrivals, and protects you from disputes. Setup, privacy, and best practices for cleaning crews.",
    h1: "GPS Tracking for Cleaning Crews",
  },
  "/blog/how-to-automate-cleaning-company": {
    title: "How to Automate Your Cleaning Company",
    description:
      "The 7 workflows every cleaning company should automate first — booking confirmations, payroll, invoicing, reviews, reminders, payments, and reports.",
    h1: "How to Automate Your Cleaning Company",
  },
  "/blog/how-to-grow-cleaning-business-2025": {
    title: "How to Grow a Cleaning Business in 2026",
    description:
      "The marketing channels, pricing moves, and hiring strategies that actually grow cleaning businesses in 2026. Real tactics, no fluff.",
    h1: "How to Grow a Cleaning Business in 2026",
  },
  "/blog/how-to-start-a-cleaning-business": {
    title: "How to Start a Cleaning Business (Step-by-Step)",
    description:
      "A complete checklist for starting a cleaning business: licensing, insurance, pricing, first customers, hiring, and the software stack you actually need.",
    h1: "How to Start a Cleaning Business",
  },
  "/blog/invoicing-software-for-cleaning-business": {
    title: "Invoicing Software for Cleaning Businesses",
    description:
      "Compare invoicing tools built for cleaning companies. Auto-bill recurring clients, accept card and ACH, and chase overdue invoices on autopilot.",
    h1: "Invoicing Software for Cleaning Businesses",
  },
  "/blog/maid-service-software": {
    title: "Maid Service Software That Cuts Admin Time",
    description:
      "Maid service software for booking, dispatch, payroll, and client comms — built for residential cleaning teams of 1–50 cleaners.",
    h1: "Maid Service Software for Residential Teams",
  },
  "/blog/payroll-software-for-cleaning-businesses": {
    title: "Payroll Software for Cleaning Businesses",
    description:
      "How payroll works for cleaners — W-2 vs 1099, tips, mileage, bonuses — and the tools that automate it without an accountant on speed dial.",
    h1: "Payroll Software for Cleaning Businesses",
  },
  "/blog/scheduling-software-for-cleaning-business": {
    title: "Scheduling Software for Cleaning Businesses",
    description:
      "The scheduling features cleaning businesses actually use: recurring jobs, route-aware assignments, drag-and-drop calendar, and crew apps.",
    h1: "Scheduling Software for Cleaning Businesses",
  },

  // Compare
  "/compare/booking-koala": {
    title: "TidyWise vs Booking Koala — Honest Comparison",
    description:
      "How TidyWise and Booking Koala compare on price, scheduling, payroll, support, and what each one is actually best at. No marketing fluff.",
    h1: "TidyWise vs Booking Koala",
  },
  "/compare/housecall-pro": {
    title: "TidyWise vs Housecall Pro for Cleaners",
    description:
      "Housecall Pro is built for trades; TidyWise is built for cleaners. Compare features, pricing, and which fits a residential cleaning business better.",
    h1: "TidyWise vs Housecall Pro",
  },
  "/compare/jobber": {
    title: "TidyWise vs Jobber — Cleaner-Focused Alternative",
    description:
      "Jobber is broad; TidyWise is cleaning-specific. Side-by-side breakdown of pricing, payroll, online booking, and client portal features.",
    h1: "TidyWise vs Jobber",
  },
  "/compare/servicetitan": {
    title: "TidyWise vs ServiceTitan for Cleaning Companies",
    description:
      "ServiceTitan targets large home-service companies. See where TidyWise fits cleaning businesses better at a fraction of the cost.",
    h1: "TidyWise vs ServiceTitan",
  },
  "/compare/zenmaid": {
    title: "TidyWise vs ZenMaid — Modern Alternative",
    description:
      "Compare TidyWise and ZenMaid on pricing, scheduling, CRM, payroll, and mobile app polish. See which one your team will actually use daily.",
    h1: "TidyWise vs ZenMaid",
  },
  "/compare/launch27": {
    title: "TidyWise vs Launch27 — Flat-Rate Alternative",
    description:
      "See how TidyWise compares with Launch27. TidyWise plans start at $49/mo and include payroll and a mobile app.",
    h1: "TidyWise vs Launch27",
  },

  // Features
  "/features/automated-dispatching": {
    title: "Automated Dispatching for Cleaning Crews",
    description:
      "Auto-assign cleaners to jobs based on location, availability, skills, and customer preferences. Cut dispatch time from hours to seconds.",
    h1: "Automated Dispatching for Cleaning Teams",
  },
  "/features/booking": {
    title: "Online Booking Software for Cleaners",
    description:
      "Let customers book cleanings online 24/7. Real-time availability, custom pricing rules, deposits, and auto-confirmation. Built for cleaning businesses.",
    h1: "Online Booking for Cleaning Businesses",
  },
  "/features/crm": {
    title: "CRM Software Built for Cleaning Businesses",
    description:
      "Full client profiles, booking history, notes, communication log, and lifetime value. Know your customers without leaving the platform.",
    h1: "CRM for Cleaning Businesses",
  },
  "/features/invoicing-software": {
    title: "Invoicing Software for Cleaning Businesses",
    description:
      "Auto-generate professional invoices, bill recurring clients on schedule, accept card and ACH, and automate overdue reminders.",
    h1: "Invoicing Software for Cleaners",
  },
  "/features/payment-processing": {
    title: "Payment Processing for Cleaning Businesses",
    description:
      "Accept card, ACH, Apple Pay, and tips. Auto-charge after job completion. Built-in Stripe processing with transparent rates and instant payouts.",
    h1: "Payment Processing for Cleaning Businesses",
  },
  "/features/payroll-software": {
    title: "Payroll Software for Cleaning Crews",
    description:
      "Pay cleaners by flat rate, hourly, or percentage of job. Auto-calculate from completed jobs, track tips and mileage, file 1099s and W-2s.",
    h1: "Payroll Software for Cleaning Crews",
  },
  "/features/quote-software": {
    title: "Quote Software for Cleaning Estimates",
    description:
      "Send polished cleaning quotes in seconds. Auto-calculated pricing, photo attachments, e-signature, and one-click convert to booking.",
    h1: "Quote Software for Cleaning Businesses",
  },
  "/features/route-optimization": {
    title: "Route Optimization for Cleaning Crews",
    description:
      "AI-optimized cleaner routes squeeze more jobs into every day. Auto-recalculate when schedules change.",
    h1: "Route Optimization for Cleaning Crews",
  },
  "/features/scheduling-software": {
    title: "Scheduling Software for Cleaning Businesses",
    description:
      "Drag-and-drop calendar, recurring jobs, conflict detection, crew assignments, and customer self-rescheduling. Built for cleaning teams.",
    h1: "Scheduling Software for Cleaners",
  },
  "/features/sms-notifications": {
    title: "SMS Notifications for Cleaning Businesses",
    description:
      "Auto-send booking confirmations, reminders, on-my-way texts, and review requests. Cut no-shows and earn more 5-star reviews on autopilot.",
    h1: "SMS Notifications for Cleaning Businesses",
  },
};

/**
 * Get metadata for a location page (state or city) using locationData.
 * Imported lazily to avoid bundling locationData into the prerender script
 * when it's invoked from a Vite plugin context.
 */
export function locationRouteMeta(
  slug: string,
  loc: { type: "state" | "city"; name: string; stateName?: string; seoDescription?: string }
): RouteMeta {
  const isCity = loc.type === "city";
  const place = isCity && loc.stateName ? `${loc.name}, ${loc.stateName}` : loc.name;
  const title = `Cleaning Business Software in ${loc.name} | ${BRAND}`.slice(0, 60);
  const description =
    loc.seoDescription ??
    `Cleaning business software for ${place} — scheduling, payroll, invoicing, and CRM built for local cleaners. Plans from $49/mo.`.slice(0, 160);
  const h1 = isCity
    ? `Cleaning Business Software in ${place}`
    : `Cleaning Business Software in ${loc.name}`;
  return { title, description, h1 };
}

export function homepageMeta(): RouteMeta {
  return STATIC_ROUTE_META["/"];
}

/**
 * Metadata for a programmatic /compare/:competitorSlug/for/:nicheSlug page.
 * Data passed in from compareNicheData (imported lazily by the prerender
 * script, same pattern as locationRouteMeta).
 */
export function compareNicheRouteMeta(c: {
  name: string;
  pricing: string;
}, n: {
  name: string;
  inline: string;
}): RouteMeta {
  const title = `TidyWise vs ${c.name} for ${n.name}`.slice(0, 60);
  const description =
    `${c.name} vs TidyWise for ${n.inline}: features, payroll, and what each is best at. TidyWise plans start at $49/mo.`.slice(0, 160);
  const h1 = `TidyWise vs ${c.name} for ${n.name}`;
  return { title, description, h1 };
}

/**
 * Per-route metadata for a /score/c/:slug company page. Includes
 * LocalBusiness + AggregateRating JSON-LD so the rating can show in SERPs.
 */
export type ScoreCompanyForMeta = {
  slug: string;
  name: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  phone?: string | null;
  score?: number | null;
  google_rating?: number | null;
  google_review_count?: number | null;
};

export function scoreCompanyRouteMeta(c: ScoreCompanyForMeta): RouteMeta {
  const location = [c.city, c.state].filter(Boolean).join(", ");
  const title = `${c.name} — Reputation Score & Review Analysis | ${BRAND}`;
  const reviewCount = c.google_review_count ?? 0;
  const description =
    c.score != null
      ? `See ${c.name}'s reputation score (${c.score}/100)${location ? ` in ${location}` : ""} — analyzed from ${reviewCount} Google reviews across reliability, communication, quality, and value.`
      : `See ${c.name}'s reputation analysis${location ? ` in ${location}` : ""} — TidyWise scores reliability, communication, quality, and value from Google reviews.`;
  const h1 = `${c.name} — Reputation Score${location ? ` · ${location}` : ""}`;

  const pageUrl = `https://www.jointidywise.com/score/c/${c.slug}`;
  const fallbackImage = "https://www.jointidywise.com/images/tidywise-og.png";

  const business: Record<string, unknown> = {
    "@type": "LocalBusiness",
    "@id": pageUrl,
    name: c.name,
    url: c.website || pageUrl,
    image: fallbackImage,
  };
  if (c.formatted_address || c.city || c.state) {
    business.address = {
      "@type": "PostalAddress",
      ...(c.formatted_address ? { streetAddress: c.formatted_address } : {}),
      ...(c.city ? { addressLocality: c.city } : {}),
      ...(c.state ? { addressRegion: c.state } : {}),
      ...(c.zip ? { postalCode: c.zip } : {}),
      addressCountry: "US",
    };
  }
  if (c.phone) business.telephone = c.phone;
  if (c.latitude && c.longitude) {
    business.geo = {
      "@type": "GeoCoordinates",
      latitude: c.latitude,
      longitude: c.longitude,
    };
  }
  if (c.google_rating && c.google_review_count && c.google_review_count > 0) {
    business.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(c.google_rating),
      reviewCount: c.google_review_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return {
    title: title.length > 60 ? title.slice(0, 57) + "..." : title,
    description: description.length > 160 ? description.slice(0, 157) + "..." : description,
    h1,
    jsonLd: [business],
  };
}

/**
 * Per-route metadata for a /blog/post/:slug article. Field fallbacks mirror
 * DynamicBlogPost.tsx's own <SEOHead> call so the prerendered snapshot and
 * the client-rendered page agree.
 */
export type BlogPostForMeta = {
  slug: string;
  title: string;
  meta_title?: string | null;
  meta_description?: string | null;
  excerpt?: string | null;
  author?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  /** Full article HTML — injected into prerendered body so crawlers see content. */
  content?: string | null;
};

export function blogPostRouteMeta(post: BlogPostForMeta): RouteMeta {
  const title = post.meta_title || `${post.title} | TIDYWISE Blog`;
  const description = post.meta_description || post.excerpt || post.title;
  const canonicalPath = `/blog/post/${post.slug}`;
  const pageUrl = `https://www.jointidywise.com${canonicalPath}`;

  const article: Record<string, unknown> = {
    "@type": "Article",
    headline: post.title,
    description,
    image: "https://www.jointidywise.com/images/tidywise-og.png",
    author: { "@type": "Organization", name: post.author || "TIDYWISE Team" },
    publisher: {
      "@type": "Organization",
      name: "TIDYWISE",
      logo: { "@type": "ImageObject", url: "https://www.jointidywise.com/images/tidywise-logo.png" },
    },
    ...(post.published_at ? { datePublished: post.published_at } : {}),
    dateModified: post.updated_at || post.published_at,
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
  };

  return {
    title: title.length > 60 ? title.slice(0, 57) + "..." : title,
    description: description.length > 160 ? description.slice(0, 157) + "..." : description,
    h1: post.title,
    canonicalPath,
    jsonLd: [article],
  };
}

/**
 * Per-route metadata for a /score/city/:citySlug rankings page. Title and
 * description mirror ScoreCityPage.tsx's own inline computation.
 */
export type ScoreCityForMeta = {
  city_slug: string;
  city: string;
  state: string;
};

export function scoreCityRouteMeta(c: ScoreCityForMeta): RouteMeta {
  const label = `${c.city}, ${c.state}`;
  const title = `Cleaning Companies in ${label} | TidyWise Score`.slice(0, 60);
  const description =
    `See how cleaning companies in ${label} rank by the TidyWise Score — an AI analysis of reviews, reputation, and online presence.`.slice(0, 160);
  return {
    title,
    description,
    h1: `Cleaning companies in ${label}`,
  };
}
