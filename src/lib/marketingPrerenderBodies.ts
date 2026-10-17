/**
 * Static HTML for crawlers on hand-built marketing routes.
 *
 * Copy is taken from each page's React source (hero, lists, comparison
 * tables, FAQ, footer and related links). Nothing here is a new claim.
 * React replaces #root on mount; this is only in the prerendered document.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function points(items: Array<{ title: string; description: string }>): string {
  return `<ul>${items
    .map((item) => `<li><strong>${esc(item.title)}:</strong> ${esc(item.description)}</li>`)
    .join("")}</ul>`;
}

function bullets(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function nav(items: Array<{ href: string; label: string }>): string {
  return `<nav aria-label="Related"><ul>${items
    .map((item) => `<li><a href="${esc(item.href)}">${esc(item.label)}</a></li>`)
    .join("")}</ul></nav>`;
}

function table(headers: string[], rows: string[][]): string {
  const head = `<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function cell(value: boolean | string): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return value;
}

function page(intro: string, sections: string[], links: Array<{ href: string; label: string }>): string {
  return `<p>${esc(intro)}</p>${sections.join("")}${nav(links)}`;
}

const RELATED_GUIDES = [
  { href: "/blog/how-to-start-a-cleaning-business", label: "How to Start a Cleaning Business in 2026" },
  { href: "/blog/booking-koala-vs-jobber-vs-tidywise", label: "Booking Koala vs Jobber vs TidyWise: Complete Comparison" },
  { href: "/blog/best-software-for-cleaning-business", label: "Best Software for Cleaning Business Owners (2025)" },
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
];

export const MARKETING_PRERENDER_BODIES: Record<string, string> = {
  "/compare/booking-koala": page(
    "Looking for a BookingKoala alternative? TIDYWISE Basic starts at $49/mo. Automated payroll, P&L reports, and AI revenue tools are on Pro at $97/mo.",
    [
      `<h2>Feature-by-Feature Comparison</h2>`,
      `<p>Compare TIDYWISE vs BookingKoala feature by feature. See what's included vs what costs extra.</p>`,
      table(
        ["Feature", "TIDYWISE", "BookingKoala"],
        [
          ["Online Booking", "Yes", "Yes"],
          ["Smart Scheduling", "Yes", "Yes"],
          ["GPS Check-ins", "Yes", "Yes"],
          ["Automated Payroll", "Yes", "Manual"],
          ["P&L Reports", "Yes", "No"],
          ["Demo/Test Mode", "Yes", "No"],
          ["In-App SMS Inbox", "Yes", "Extra cost"],
          ["AI Revenue Tools", "Yes", "No"],
          ["Photo Documentation", "Yes", "Yes"],
          ["Review Requests", "Yes", "Yes"],
          ["Loyalty Programs", "Yes", "No"],
          ["Revenue Forecasting", "Yes", "No"],
          ["Inventory Tracking", "Yes", "No"],
        ],
      ),
      `<h2>Why Switch from BookingKoala to TIDYWISE?</h2>`,
      points([
        { title: "Plans from $49/mo", description: "TIDYWISE plans start at $49/mo. Pro is $97/mo and Custom is $197/mo." },
        { title: "Real Financial Insights", description: "P&L reports, revenue forecasting, and profit margin analysis. Know your numbers." },
        { title: "True Automation", description: "Automated payroll from GPS check-ins. No more spreadsheets or manual calculations." },
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/compare/jobber", label: "vs Jobber" },
      { href: "/compare/housecall-pro", label: "vs Housecall Pro" },
      { href: "/features/scheduling-software", label: "Scheduling" },
      { href: "/features/route-optimization", label: "Route Optimization" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/compare/housecall-pro": page(
    "Housecall Pro was built for plumbers and HVAC techs. TidyWise is built specifically for cleaning businesses. Square footage pricing is on Basic at $49/month. Automated payroll and P&L reports are on Pro at $97/month.",
    [
      `<h2>Feature comparison</h2>`,
      table(
        ["Feature", "TIDYWISE", "Housecall Pro"],
        [
          ["Online Booking", "Yes", "Yes"],
          ["Smart Scheduling", "Yes", "Yes"],
          ["GPS Check-ins", "Yes", "Yes"],
          ["Automated Payroll", "Yes", "No"],
          ["P&L Reports", "Yes", "No"],
          ["Demo/Test Mode", "Yes", "No"],
          ["Cleaning-Specific Pricing", "Yes", "No"],
          ["AI Revenue Tools", "Yes", "No"],
          ["Unlimited Users", "Yes", "Add-on"],
          ["Review Requests", "Yes", "Yes"],
          ["Loyalty Programs", "Yes", "No"],
          ["Inventory Tracking", "Yes", "No"],
          ["Square Footage Pricing", "Yes", "No"],
        ],
      ),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/compare/jobber", label: "vs Jobber" },
      { href: "/compare/booking-koala", label: "vs Booking Koala" },
      { href: "/features/scheduling-software", label: "Scheduling" },
      { href: "/features/invoicing-software", label: "Invoicing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/compare/jobber": page(
    "TIDYWISE Basic starts at $49/mo. Automated payroll, P&L reports, and loyalty programs are on Pro at $97/mo. Compare the features and see why cleaning businesses are switching.",
    [
      `<h2>Feature comparison</h2>`,
      table(
        ["Feature", "TIDYWISE", "Jobber"],
        [
          ["Online Booking", "Yes", "Yes"],
          ["Smart Scheduling", "Yes", "Yes"],
          ["GPS Check-ins", "Yes", "Yes"],
          ["Automated Payroll", "Yes", "No"],
          ["P&L Reports", "Yes", "No"],
          ["Demo/Test Mode", "Yes", "No"],
          ["In-App SMS Inbox", "Yes", "Add-on"],
          ["AI Revenue Tools", "Yes", "No"],
          ["Photo Documentation", "Yes", "Yes"],
          ["Review Requests", "Yes", "Add-on"],
          ["Loyalty Programs", "Yes", "No"],
          ["Multi-location", "Yes", "Higher tiers"],
          ["Inventory Tracking", "Yes", "No"],
        ],
      ),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/compare/booking-koala", label: "vs Booking Koala" },
      { href: "/compare/housecall-pro", label: "vs Housecall Pro" },
      { href: "/features/scheduling-software", label: "Scheduling" },
      { href: "/features/invoicing-software", label: "Invoicing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/compare/launch27": page(
    "Launch27 is an established booking platform for maid services. The mobile app is included from $49/mo (Basic). Payroll, P&L reporting, and AI tools are on Pro at $97/mo.",
    [
      `<h2>TIDYWISE</h2>`,
      bullets([
        "Basic is $49/mo — booking, scheduling, and invoicing",
        "Payroll, P&L, and AI are on Pro at $97/mo",
        "Mobile app included at every tier",
        "30 days of Pro, no card",
      ]),
      `<h2>Launch27</h2>`,
      bullets([
        "Payroll is not on every plan",
        "The mobile app is not on every plan",
        "No P&L reporting",
        "No AI tools",
        "14-day trial",
      ]),
      `<h2>Pricing Comparison</h2>`,
      table(
        ["Plan", "TIDYWISE", "Launch27"],
        [
          ["Entry plan", "$49/mo", "—"],
          ["With payroll", "$97/mo (Pro)", "—"],
          ["With mobile app", "$49/mo (included)", "—"],
          ["Annual cost (full features)", "See pricing", "—"],
        ],
      ),
      `<h2>Feature comparison</h2>`,
      table(
        ["Feature", "TIDYWISE", "Launch27"],
        [
          ["Online Booking", "Yes", "Yes"],
          ["Smart Scheduling", "Yes", "Yes"],
          ["GPS Check-ins", "Yes", "No"],
          ["Automated Payroll", "Yes", "Higher plan only"],
          ["P&L Reports", "Yes", "No"],
          ["Mobile App", "Yes", "Higher plan only"],
          ["AI Revenue Tools", "Yes", "No"],
          ["Inventory Tracking", "Yes", "No"],
          ["In-App SMS Inbox", "Yes", "No"],
          ["Loyalty Programs", "Yes", "No"],
          ["Review Requests", "Yes", "Pro plan only"],
          ["Gift Cards", "No", "Pro plan only"],
          ["QuickBooks Integration", "No", "Pro plan only"],
          ["Custom Booking Form Branding", "Yes", "Pro plan only"],
        ],
      ),
    ],
    [
      { href: "/pricing", label: "See Pricing" },
      { href: "/blog", label: "Blog" },
      { href: "/", label: "Home" },
    ],
  ),

  "/compare/servicetitan": page(
    "ServiceTitan is enterprise software built for HVAC and plumbing companies. TIDYWISE is built specifically for cleaning businesses. The difference matters more than any feature list.",
    [
      `<h2>TIDYWISE</h2>`,
      bullets([
        "Basic is $49/mo — all users included",
        "Built specifically for cleaning businesses",
        "Operational in hours, not weeks",
        "30 days of Pro, no card",
        "Square footage and room-based pricing",
        "Automated payroll on Pro at $97/mo",
      ]),
      `<h2>ServiceTitan</h2>`,
      bullets([
        "Built for HVAC, plumbing, and electrical",
        "Implementation takes weeks to months",
        "No self-serve trial — demo only",
        "No cleaning-specific pricing features",
        "Payroll is a separate product",
      ]),
      `<h2>Pricing Comparison</h2>`,
      table(
        ["", "TIDYWISE", "ServiceTitan"],
        [
          ["Starting price", "$49/mo", "—"],
          ["5-user team", "$49/mo", "—"],
          ["10-user team", "$49/mo", "—"],
          ["Setup cost", "$0", "Implementation fee"],
          ["Annual contract required", "No", "Typically yes"],
        ],
      ),
      `<p>ServiceTitan pricing requires a sales call and varies by contract. The figures above reflect typical small business rates.</p>`,
      `<h2>Feature comparison</h2>`,
      table(
        ["Feature", "TIDYWISE", "ServiceTitan"],
        [
          ["Setup Time", "Hours", "Weeks to months"],
          ["Cleaning-Specific Features", "Yes", "No"],
          ["Online Booking", "Yes", "Yes"],
          ["Smart Scheduling", "Yes", "Yes"],
          ["GPS Tracking", "Yes", "Yes"],
          ["Automated Payroll", "Yes", "Add-on cost"],
          ["P&L Reports", "Yes", "Yes"],
          ["Square Footage Pricing", "Yes", "No"],
          ["Small Business Friendly", "Yes", "No"],
          ["No Per-User Fees", "Yes", "No"],
          ["Inventory Tracking", "Yes", "Yes"],
          ["Loyalty Programs", "Yes", "No"],
        ],
      ),
    ],
    [
      { href: "/pricing", label: "See Pricing" },
      { href: "/blog", label: "Blog" },
      { href: "/", label: "Home" },
    ],
  ),

  "/compare/zenmaid": page(
    "Both are cleaning-specific platforms. TIDYWISE adds automated payroll, P&L reporting, AI tools, and inventory tracking — at a flat rate that doesn't scale with booking volume.",
    [
      `<h2>TIDYWISE</h2>`,
      bullets([
        "Basic is $49/mo — price does not rise with bookings",
        "Payroll, P&L, and AI are on Pro at $97/mo",
        "30 days of Pro, no card",
      ]),
      `<h2>ZenMaid</h2>`,
      bullets([
        "Pricing scales with booking volume",
        "No automated payroll",
        "Basic reporting (no P&L)",
        "No AI tools",
        "No inventory tracking",
      ]),
      `<h2>Pricing Comparison</h2>`,
      table(
        ["Plan", "TIDYWISE", "ZenMaid"],
        [
          ["Starter", "Plans from $49/mo", "—"],
          ["Growing business", "$49/mo", "—"],
          ["Scaling business", "$49/mo", "—"],
          ["Payroll included", "Yes", "No"],
          ["P&L reporting", "Yes", "No"],
        ],
      ),
      `<h2>Feature comparison</h2>`,
      table(
        ["Feature", "TIDYWISE", "ZenMaid"],
        [
          ["Online Booking", "Yes", "Yes"],
          ["Smart Scheduling", "Yes", "Yes"],
          ["GPS Check-ins", "Yes", "Yes"],
          ["Automated Payroll", "Yes", "No"],
          ["P&L Reports", "Yes", "No"],
          ["Demo/Test Mode", "Yes", "No"],
          ["AI Revenue Tools", "Yes", "No"],
          ["Inventory Tracking", "Yes", "No"],
          ["In-App SMS Inbox", "Yes", "No"],
          ["Loyalty Programs", "Yes", "No"],
          ["Review Requests", "Yes", "Yes"],
          ["Square Footage Pricing", "Yes", "Yes"],
          ["Unlimited Bookings", "Yes", "Volume-based pricing"],
        ],
      ),
    ],
    [
      { href: "/pricing", label: "See Pricing" },
      { href: "/blog", label: "Blog" },
      { href: "/", label: "Home" },
    ],
  ),

  "/features/automated-dispatching": page(
    "Stop manually assigning jobs. TIDYWISE automatically dispatches cleaners based on location, skills, and availability. Save 5+ hours per week on scheduling.",
    [
      `<h2>How automated dispatching helps</h2>`,
      points([
        { title: "GPS-Based Assignment", description: "Automatically assign cleaners based on their proximity to job locations. Reduce travel time by 30%." },
        { title: "Smart Time Slots", description: "AI analyzes travel time between jobs and schedules optimal routes for your team." },
        { title: "Skill-Based Matching", description: "Match cleaners to jobs based on their skills, certifications, and customer preferences." },
        { title: "Instant Notifications", description: "Cleaners get push notifications for new jobs. Accept or decline with one tap." },
        { title: "Route Optimization", description: "Minimize drive time with optimized daily routes. Fit more jobs into each day." },
        { title: "Mobile Check-ins", description: "Staff check in/out with GPS verification. Automatic time tracking and payroll." },
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/pricing", label: "Pricing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/features/booking": page(
    "Stop playing phone tag with clients. TidyWise gives your cleaning business a professional online booking system that works around the clock — even while you're on the job.",
    [
      `<h2>How It Works</h2>`,
      `<p>Clients visit your booking page, select their service, pick a date and time, and confirm instantly. No back-and-forth. No missed calls. Just confirmed bookings straight to your calendar.</p>`,
      bullets([
        "Client visits your booking page",
        "Selects service, date & time",
        "Gets instant confirmation",
        "Job appears on your calendar",
      ]),
      `<h2>What You Get</h2>`,
      bullets([
        "Instant online booking available 24/7",
        "Automated confirmation emails and reminders",
        "Custom service types and pricing",
        "Real-time calendar sync",
        "Mobile-friendly booking page for your clients",
      ]),
    ],
    RELATED_GUIDES,
  ),

  "/features/crm": page(
    "Spreadsheets can't scale your business. TidyWise gives you a simple, powerful CRM designed for cleaning companies — so you always know who your clients are, what they need, and when they last booked.",
    [
      points([
        { title: "Full Job & Payment History", description: "View every client's complete job history and payment records in one place." },
        { title: "Notes & Special Instructions", description: "Add notes and special instructions per client so your team always knows what to expect." },
        { title: "Lead Tracking & Auto Follow-Up", description: "Track leads and follow up automatically. Never lose a potential customer again." },
        { title: "Client Segmentation", description: "Segment clients by service type, frequency, or location. See your best clients at a glance." },
        { title: "Retention Insights", description: "Identify at-risk customers before they churn. Build loyalty with data-driven decisions." },
        { title: "Scales With You", description: "Whether you have 10 clients or 500, TidyWise keeps everything organized so you can focus on delivering great cleans." },
      ]),
    ],
    RELATED_GUIDES,
  ),

  "/features/invoicing-software": page(
    "Stop using spreadsheets and paper invoices. TidyWise creates professional invoices automatically after every cleaning. Get paid 2x faster with online payments and automated reminders.",
    [
      points([
        { title: "Professional Invoice Templates", description: "Beautiful, branded invoices that look professional. Add your logo, colors, and payment terms automatically." },
        { title: "One-Click Invoice Sending", description: "Generate and send invoices instantly after a job is completed. No manual data entry required." },
        { title: "Online Payment Processing", description: "Accept credit cards, ACH, and digital payments. Customers can pay directly from the invoice email." },
        { title: "Automated Payment Reminders", description: "Stop chasing late payments. Automatic reminders go out on your schedule until the invoice is paid." },
        { title: "Recurring Invoice Automation", description: "Set up recurring invoices for repeat customers. They're generated and sent automatically." },
        { title: "Real-Time Payment Tracking", description: "See which invoices are paid, pending, or overdue at a glance. Get notified when payments arrive." },
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/features/payment-processing", label: "Payments" },
      { href: "/features/quote-software", label: "Quotes" },
      { href: "/compare/housecall-pro", label: "vs Housecall Pro" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/features/payment-processing": page(
    "Chasing invoices is the worst part of running a cleaning business. TidyWise handles billing automatically so you get paid on time, every time — without lifting a finger.",
    [
      `<p>Whether you charge per job, weekly, or on a subscription basis, TidyWise flexes to match how you run your business.</p>`,
      points([
        { title: "Instant Professional Invoices", description: "Send professional invoices instantly after each job. No more manual billing." },
        { title: "Accept Cards, ACH & Recurring", description: "Accept credit cards, ACH, and recurring payments. Clients pay online with one click." },
        { title: "Auto-Billing for Recurring Clients", description: "Set up weekly or monthly auto-billing for recurring clients. Set it and forget it." },
        { title: "Automatic Payment Reminders", description: "Payment reminders sent automatically. Stop chasing payments manually." },
        { title: "Full Payment History", description: "Complete payment history per client. Know exactly who paid what and when." },
        { title: "PCI Compliant & Secure", description: "Bank-level security with Stripe. Your customers' data is always protected." },
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/pricing", label: "Pricing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/features/payroll-software": page(
    "Stop spending hours on payroll every two weeks. TidyWise automatically calculates wages from completed jobs — flat rates, hourly, or percentage of service price. Tips, mileage, and deductions handled too. Included with the Pro plan ($97/mo).",
    [
      `<p>TidyWise handles scheduling, CRM, and invoicing from $49/mo (Basic). Payroll is on Pro at $97/mo.</p>`,
      points([
        { title: "Automatic Wage Calculation", description: "Set flat per-job rates, hourly rates, or a percentage of the job price per cleaner. Wages calculate automatically from completed bookings — no spreadsheets." },
        { title: "Tip Tracking & Distribution", description: "Track customer tips and distribute them to the right cleaners automatically. Every dollar accounted for, no manual tallying." },
        { title: "Mileage Reimbursement", description: "Auto-calculate mileage from job to job using GPS data. Apply IRS rates or your custom rate — no more self-reported miles." },
        { title: "Pay Period Reports", description: "View gross pay, deductions, and net pay per cleaner every pay period. Export or process in one click." },
        { title: "Staff Pay Portal", description: "Cleaners see their own earnings, pay stubs, and mileage from their phone. No calls asking 'what did I make this week?'" },
        { title: "W-2 & 1099 Support", description: "Supports both employee and contractor pay structures. Generates the correct documentation for each worker type." },
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/features/scheduling-software", label: "Scheduling" },
      { href: "/features/route-optimization", label: "Route Optimization" },
      { href: "/blog/payroll-software-for-cleaning-businesses", label: "Payroll Guide" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/features/quote-software": page(
    "Create and send professional quotes in under 60 seconds. Auto-calculate prices, track quote status, and convert 40% more leads to bookings.",
    [
      points([
        { title: "Instant Price Calculation", description: "Auto-calculate quotes based on square footage, bedrooms, bathrooms, and add-on services." },
        { title: "Professional Templates", description: "Beautiful, branded quote templates that make your business look established and trustworthy." },
        { title: "One-Click Sending", description: "Send quotes via email or SMS instantly. Customers can accept and pay in one click." },
        { title: "Automated Follow-ups", description: "Never lose a lead. Automatic reminders for quotes that haven't been accepted yet." },
        { title: "Deposit Collection", description: "Collect deposits when quotes are accepted. Secure payment with Stripe integration." },
        { title: "AI-Powered Suggestions", description: "AI suggests upsells and add-ons based on the service type and customer history." },
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/pricing", label: "Pricing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/features/route-optimization": page(
    "Stop wasting time and money on inefficient routes. TidyWise automatically plans the fastest routes for your cleaning team and fits more jobs into every day.",
    [
      points([
        { title: "AI-Powered Route Planning", description: "Our algorithm calculates the fastest routes between jobs, considering traffic, distance, and time windows." },
        { title: "Shorter drives between jobs", description: "Optimized routes mean less driving between appointments." },
        { title: "Fit More Jobs Per Day", description: "Eliminate wasted drive time. Most cleaning businesses add 1-2 extra jobs per week with optimized routes." },
        { title: "Zone-Based Scheduling", description: "Group jobs by neighborhood. Assign cleaners to specific zones to minimize travel between appointments." },
        { title: "Real-Time GPS Tracking", description: "See where every cleaner is in real-time. Know exactly when they'll arrive at the next job." },
        { title: "One-Click Navigation", description: "Cleaners get turn-by-turn directions to every job. Integrates with Google Maps and Apple Maps." },
      ]),
      `<h2>Included</h2>`,
      bullets([
        "Automatic route optimization",
        "Traffic-aware scheduling",
        "Multi-stop route planning",
        "Zone-based job assignment",
        "Real-time ETA updates",
        "GPS check-in verification",
        "Mileage tracking & reports",
        "Fuel cost analytics",
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/features/automated-dispatching", label: "Dispatching" },
      { href: "/features/scheduling-software", label: "Scheduling" },
      { href: "/compare/booking-koala", label: "vs Booking Koala" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/features/scheduling-software": page(
    "Juggling cleaners, clients, and jobs manually is costing you time and money. TidyWise makes scheduling effortless — assign jobs, manage your team, and handle last-minute changes without the headache.",
    [
      `<h2>Features That Keep Your Team on Track</h2>`,
      points([
        { title: "Drag-and-Drop Scheduling", description: "See your entire week at a glance. Drag jobs to reschedule. Assign cleaners with a click." },
        { title: "Assign Jobs to Specific Cleaners", description: "Match the right cleaner to the right job based on skills, location, and availability." },
        { title: "Automatic Reminders", description: "Your team and clients get SMS/email reminders before appointments. Reduce no-shows dramatically." },
        { title: "Handle Changes in Seconds", description: "Reschedules and cancellations handled instantly. No more frantic phone calls." },
        { title: "Full Week or Month View", description: "View your full week or month at a glance. Know exactly what's happening across your business." },
        { title: "Recurring Job Automation", description: "Set up weekly, bi-weekly, or monthly recurring cleans. They're scheduled automatically forever." },
      ]),
      `<h2>The Result</h2>`,
      bullets(["Less no-shows", "Fewer mix-ups", "A cleaning operation that runs like clockwork"]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/features/booking", label: "Booking" },
      { href: "/features/crm", label: "CRM" },
      { href: "/features/invoicing-software", label: "Invoicing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/features/sms-notifications": page(
    "Automated SMS for every touchpoint. Confirmations, reminders, on-my-way alerts, and review requests. Reduce no-shows by 80% and boost your reviews.",
    [
      points([
        { title: "Booking Confirmations", description: "Instant SMS when a booking is made. Customers know their clean is scheduled." },
        { title: "Appointment Reminders", description: "Automatic reminders 24 hours and 1 hour before. Reduce no-shows by 80%." },
        { title: "On-My-Way Alerts", description: "Cleaners tap 'On My Way' and customers get a text. Professional and reassuring." },
        { title: "Review Requests", description: "Automatic review requests after completed jobs. Build your Google reviews." },
        { title: "Two-Way Messaging", description: "Full SMS inbox for conversations with customers. All messages in one place." },
        { title: "Team Notifications", description: "Alert cleaners about new jobs, schedule changes, and urgent updates via SMS." },
      ]),
    ],
    [
      { href: "/", label: "Home" },
      { href: "/pricing", label: "Pricing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/blog/best-software-for-cleaning-business": page(
    "Choosing the right software can make or break your cleaning business. The best tools handle scheduling, client management, invoicing, and team coordination — so you can focus on cleaning, not paperwork. Here's our 2025 breakdown.",
    [
      `<h2>What to Look For in Cleaning Business Software</h2>`,
      `<p>The ideal cleaning business software should offer: online booking, client CRM, team scheduling, automated notifications, invoicing, and reporting. Bonus points for mobile apps, payment processing, and a client portal.</p>`,
      `<h2>1. TidyWise — Best All-in-One Platform</h2>`,
      `<p>TidyWise is purpose-built for cleaning businesses. Booking, scheduling, CRM, invoicing, and the staff portal start at $49/month. SMS/email automation, the client portal, and AI-powered business intelligence are on Pro at $97/month. Every new account begins with 30 days of Pro, no card.</p>`,
      `<p><strong>Best for:</strong> Growing cleaning businesses that want everything in one place without juggling multiple tools.</p>`,
      `<h2>2. Jobber — Best for Field Service Variety</h2>`,
      `<p>Jobber serves many home service industries. It has solid scheduling and invoicing but lacks cleaning-specific features like checklist management and cleaner portals.</p>`,
      `<h2>3. Booking Koala</h2>`,
      `<p>Good for solo cleaners just starting out. Offers basic booking and client management. However, it lacks team management, automation, and advanced reporting.</p>`,
      `<h2>4. Housecall Pro — Best for Larger Teams</h2>`,
      `<p>Strong dispatching and GPS tracking for larger operations. Less tailored to residential cleaning workflows.</p>`,
    ],
    [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in to your dashboard" },
      { href: "/blog", label: "Blog" },
      { href: "/pricing", label: "Pricing" },
    ],
  ),

  "/blog/booking-koala-vs-jobber-vs-tidywise": page(
    "Choosing the right cleaning business software can make or break your maid service. We compare Booking Koala, Jobber, and TIDYWISE on price, features, and ease of use to help you decide.",
    [
      `<h2>Quick Verdict</h2>`,
      `<p>TIDYWISE is built for cleaning businesses. Plans start at $49/mo. Pro at $97/mo adds P&L reports and inventory tracking. Custom is $197/mo.</p>`,
      `<h2>Feature comparison</h2>`,
      table(
        ["Feature", "TIDYWISE", "Booking Koala", "Jobber"],
        [
          ["Online Booking Form", cell(true), cell(true), cell(true)],
          ["Smart Scheduling & Auto-Assignment", cell(true), cell(true), cell(true)],
          ["Staff Mobile App", cell(true), cell(true), cell(true)],
          ["Client Portal (Self-Service)", cell(true), cell(false), "Add-on"],
          ["GPS Check-ins & Route Optimization", cell(true), cell(true), "Add-on"],
          ["SMS Notifications", cell(true), "Add-on", "Add-on"],
          ["Invoicing & Auto-Reminders", cell(true), cell(true), cell(true)],
          ["Drag & Drop Scheduler", cell(true), cell(false), cell(true)],
          ["Payroll Management", cell(true), cell(false), cell(false)],
          ["Expense Tracking", cell(true), cell(false), cell(false)],
          ["Task Management", cell(true), cell(false), cell(false)],
          ["Automated Email Campaigns", cell(true), "Premium", cell(false)],
          ["Client Feedback Collection", cell(true), cell(false), cell(false)],
          ["Automation Center (Workflows)", cell(true), cell(false), cell(false)],
          ["Tip & Deposit Collection", cell(true), cell(false), cell(false)],
          ["Referral Program", cell(true), cell(false), cell(false)],
          ["Automated Quote Follow-ups", cell(true), "Premium", cell(true)],
          ["P&L Reports & Revenue Forecasting", cell(true), cell(false), cell(false)],
          ["AI Business Intelligence", cell(true), cell(false), cell(false)],
          ["Inventory Tracking", cell(true), cell(false), cell(false)],
          ["Operations Tracker", cell(true), cell(false), cell(false)],
          ["Demo/Test Mode", cell(true), cell(false), cell(false)],
          ["Offline Mode", cell(true), cell(false), cell(false)],
          ["In-App SMS Inbox", cell(true), cell(false), cell(false)],
          ["Home Condition Pricing", cell(true), cell(false), cell(false)],
        ],
      ),
    ],
    [
      { href: "/blog/how-to-start-a-cleaning-business", label: "How to Start a Cleaning Business in 2026" },
      { href: "/blog/best-software-for-cleaning-business", label: "Best Software for Cleaning Business Owners (2025)" },
      { href: "/blog/how-to-automate-cleaning-company", label: "How to Automate Your Cleaning Company" },
      { href: "/pricing", label: "Pricing" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/blog/cleaning-business-management-software": page(
    "\"Management software\" is a broad term. For a cleaning business, it means the platform that runs your day-to-day operations — scheduling, booking, billing, payroll, client communication, and reporting. The right software is the difference between spending your evenings doing admin and actually running a business. Here's a practical breakdown of what matters and what doesn't.",
    [
      `<h2>The Problem with Running a Cleaning Business on Spreadsheets</h2>`,
      `<p>Most cleaning business owners start with spreadsheets, a calendar app, and manual invoicing. It works at first. By the time you have 20+ recurring clients and 3+ cleaners, the cracks show:</p>`,
      bullets([
        "Double-bookings because the calendar isn't synced with the booking form",
        "Clients calling to find out where their cleaner is",
        "Forgetting to invoice a job or charging the wrong amount",
        "Friday payroll taking 3 hours because you're cross-referencing job logs",
        "No visibility into which jobs are actually profitable",
      ]),
      `<p>Management software solves all of these by connecting your data — a booking creates a schedule entry, which creates a payroll entry, which creates an invoice, which creates a payment record. One system, not five.</p>`,
      `<h2>Questions that matter</h2>`,
      points([
        { title: "How fast can you get operational?", description: "Some platforms require a week of setup and training. Others can be up and running in an afternoon. Time to value matters as much as the feature set." },
        { title: "Can your cleaners actually use it?", description: "The cleaner app needs to be simple enough that non-tech-savvy staff can adopt it without training. If adoption fails, the whole system fails." },
        { title: "Does pricing scale painfully?", description: "Per-user or per-booking pricing makes software increasingly expensive as you grow. Flat-rate pricing lets you scale without cost anxiety." },
      ]),
    ],
    [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in to your dashboard" },
      { href: "/blog", label: "Blog" },
      { href: "/pricing", label: "Pricing" },
    ],
  ),

  "/blog/crm-for-cleaning-business": page(
    "A comprehensive CRM for cleaning business is essential for managing customers, scheduling jobs, processing payments, and growing your maid service. This ultimate guide covers everything you need to choose the right cleaning business CRM software—including feature comparisons, pricing, and expert recommendations.",
    [
      `<h2>What cleaning CRM software covers</h2>`,
      points([
        { title: "Customer Database & CRM", description: "Store all customer info, service history, preferences, property details, and notes in one centralized platform" },
        { title: "Smart Scheduling & Dispatch", description: "Drag-and-drop calendar with automated reminders, recurring bookings, and real-time team coordination" },
        { title: "Automated Client Communication", description: "SMS and email notifications, automated follow-ups, review requests, and marketing campaigns" },
        { title: "Payment Processing & Invoicing", description: "Accept cards on-site, send digital invoices, automate billing, and track payments with Stripe integration" },
        { title: "Route Optimization & GPS", description: "GPS-based job assignments, travel time estimates, check-in/check-out tracking for accountability" },
        { title: "Business Analytics & Reporting", description: "Revenue forecasting, P&L reports, customer lifetime value, staff productivity, and profit margins" },
        { title: "Workflow Automation", description: "Automate repetitive tasks: confirmations, reminders, follow-ups, and re-engagement campaigns" },
        { title: "Team Management & Payroll", description: "Staff scheduling, time tracking, wage calculations, performance metrics, and payroll reports" },
      ]),
      `<h2>Comparison</h2>`,
      table(
        ["Software", "Price", "Users", "Trial", "Cleaning-specific", "Mobile"],
        [
          ["TIDYWISE", "$49/mo", "Unlimited", "30 days", "Yes", "Yes"],
          ["Jobber", "—", "Up to 15", "14 days", "No", "Yes"],
          ["Booking Koala", "—", "Unlimited", "14 days", "Yes", "Yes"],
          ["Housecall Pro", "—", "1 user", "14 days", "No", "Yes"],
          ["ServiceTitan", "—", "Custom", "Demo only", "No", "Yes"],
          ["ZenMaid", "—", "Limited", "14 days", "Yes", "No"],
        ],
      ),
      `<h2>Frequently Asked Questions About Cleaning Business CRMs</h2>`,
      `<dl>`,
      `<dt>What is the best CRM for a small cleaning business?</dt><dd>TIDYWISE is built for small cleaning businesses. Basic is $49/month for scheduling, invoicing, and customer management, with unlimited users and no per-user fees. Automated reminders are on Pro at $97/month.</dd>`,
      `<dt>Do I need a CRM for my maid service?</dt><dd>Yes, if you have more than 5-10 recurring clients. A CRM helps you avoid double-bookings, reduces no-shows by 40% with automated reminders, tracks customer preferences, manages payments, and saves 2+ hours daily on admin tasks.</dd>`,
      `<dt>Can I use a free CRM for my cleaning business?</dt><dd>Free CRMs like HubSpot or Zoho aren't designed for cleaning businesses and lack scheduling, dispatching, invoicing, and route optimization features. TIDYWISE gives you 30 days of Pro, no card, so you can test every feature before committing to a paid plan.</dd>`,
      `<dt>How much does cleaning business software cost?</dt><dd>TIDYWISE starts at $49/mo, with Pro at $97/mo and Custom at $197/mo, and includes unlimited users.</dd>`,
      `<dt>What features should I look for in cleaning business CRM software?</dt><dd>Look for a customer database, drag-and-drop scheduling, online booking, payment processing, invoicing, and staff management. Those are on TidyWise Basic at $49/month. Automated SMS/email reminders and business analytics are on Pro at $97/month.</dd>`,
      `<dt>Can cleaning business CRM software help me get more customers?</dt><dd>Yes. CRM software with automated review requests can triple your online reviews. Lead capture forms, follow-up campaigns, and professional online booking increase conversion rates by 25-40% according to industry studies.</dd>`,
      `<dt>Is there a CRM specifically designed for cleaning companies?</dt><dd>Yes, TIDYWISE is built specifically for cleaning businesses including maid services, janitorial companies, and residential cleaning businesses. It includes industry-specific features like recurring booking management, square footage pricing, and cleaning checklists.</dd>`,
      `<dt>How do I switch from spreadsheets to cleaning business software?</dt><dd>TIDYWISE offers free data import assistance. You can upload your customer list via CSV, and our system will organize your data automatically. Most cleaning businesses complete the transition in under 24 hours.</dd>`,
      `</dl>`,
    ],
    [
      { href: "/compare/jobber", label: "TIDYWISE vs Jobber" },
      { href: "/compare/booking-koala", label: "TIDYWISE vs Booking Koala" },
      { href: "/compare/housecall-pro", label: "TIDYWISE vs Housecall Pro" },
      { href: "/features/scheduling-software", label: "Scheduling" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/blog/gps-tracking-cleaning-business": page(
    "GPS tracking is one of those features that sounds like overkill until you have a cleaner show up late to a job — or not at all — and you have no idea where they are. For cleaning businesses managing multiple routes and teams, real-time location visibility can be the difference between a smooth operation and a day of firefighting.",
    [
      `<h2>What GPS Tracking Actually Does for Cleaning Teams</h2>`,
      `<p>GPS tracking in the context of cleaning business software isn't about surveillance — it's about coordination. The practical uses are:</p>`,
      points([
        { title: "Job arrival verification", description: "See when a cleaner actually arrived at a job site vs. when they were scheduled. Helps resolve customer disputes about whether the team showed up." },
        { title: "Real-time ETA updates", description: "When a customer calls asking where the cleaner is, you can give them an actual answer instead of 'I'll check and call you back.'" },
        { title: "Route optimization input", description: "GPS data from past jobs shows actual drive times between locations — not the estimated times from mapping software. This makes route planning more accurate over time." },
        { title: "Mileage tracking", description: "Automatic mileage logging for cleaner reimbursement and business tax deductions. More accurate than asking cleaners to self-report." },
        { title: "Team accountability", description: "Cleaners know you can see where they are. This alone tends to reduce late arrivals and early departures without any confrontation needed." },
      ]),
    ],
    [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in to your dashboard" },
      { href: "/blog", label: "Blog" },
      { href: "/pricing", label: "Pricing" },
    ],
  ),

  "/blog/how-to-automate-cleaning-company": page(
    "If you're spending more time on admin than actual cleaning, it's time to automate. Modern cleaning business software can handle booking, scheduling, invoicing, reminders, and follow-ups — freeing you up to grow your business.",
    [
      `<h2>1. Automate Booking & Scheduling</h2>`,
      `<p>Replace phone tag with online booking. Clients pick their service, date, and time. The system checks availability, assigns a cleaner, and sends confirmation — all without you touching anything. This alone saves 5-10 hours per week for most cleaning business owners.</p>`,
      `<h2>2. Automate Client Communication</h2>`,
      `<p>Set up automatic booking confirmations, appointment reminders (24 hours before), "on the way" notifications, and post-service review requests. SMS and email automation reduces no-shows by up to 40%.</p>`,
      `<h2>3. Automate Invoicing & Payments</h2>`,
      `<p>Generate invoices automatically after each job. Store cards on file and charge automatically. Send payment reminders for outstanding balances. Stop chasing payments manually.</p>`,
      `<h2>4. Automate Team Management</h2>`,
      `<p>Auto-assign cleaners based on availability, location, and skills. Let staff check in/out of jobs via the app. Calculate payroll automatically based on completed jobs.</p>`,
      `<h2>5. Automate Follow-Up & Retention</h2>`,
      `<p>Set up re-booking campaigns for one-time clients. Send loyalty rewards to regulars. Identify at-risk customers before they churn. A good cleaning business CRM handles all of this on autopilot.</p>`,
      `<h2>6. Automate Reporting</h2>`,
      `<p>Stop manually calculating revenue, expenses, and profit. Your cleaning business software should give you real-time dashboards showing daily revenue, team productivity, customer lifetime value, and profit margins.</p>`,
      `<h2>How Much Time Can You Save?</h2>`,
      `<p>Most cleaning business owners report saving 15-20 hours per week after automating these six areas. That's essentially getting a half-time employee for free.</p>`,
    ],
    [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in to your dashboard" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/blog/how-to-grow-cleaning-business-2025": page(
    "Growing a cleaning business takes more than word-of-mouth referrals. In 2025, the most successful cleaning companies combine great service with smart technology and targeted marketing. Here's your complete growth playbook.",
    [
      `<h2>1. Invest in Online Booking Software</h2>`,
      `<p>Clients expect to book online. If you're still taking bookings over the phone, you're losing customers to competitors with 24/7 online booking. A tool like TidyWise lets clients book, reschedule, and manage appointments without calling you.</p>`,
      `<h2>2. Automate Your Follow-Ups</h2>`,
      `<p>Most cleaning businesses lose 30-40% of leads because they don't follow up fast enough. Set up automated email and SMS sequences that reach out within minutes of an inquiry. Cleaning business CRM software handles this automatically.</p>`,
      `<h2>3. Build a Referral Program</h2>`,
      `<p>Your happiest clients are your best marketing channel. Create a structured referral program that rewards clients for sending friends your way. Even a simple $25 credit for each referral can double your organic growth.</p>`,
      `<h2>4. Optimize for Local SEO</h2>`,
      `<p>Claim and optimize your Google Business Profile. Collect reviews after every job (automate this with your scheduling software). Target keywords like "cleaning service near me" and "house cleaning [your city]."</p>`,
      `<h2>5. Systemize Your Operations</h2>`,
      `<p>Growth stalls when you can't delegate. Document your cleaning checklists, pricing, and communication templates. Use cleaning business scheduling software to assign jobs, track team performance, and manage payroll without micromanaging.</p>`,
      `<h2>6. Offer Recurring Service Plans</h2>`,
      `<p>One-time cleanings are feast or famine. Push clients toward weekly, biweekly, or monthly plans with a small discount. Recurring revenue creates predictability and makes your business more valuable.</p>`,
      `<h2>7. Track Your Numbers</h2>`,
      `<p>You can't grow what you don't measure. Track revenue per client, average job value, customer retention rate, and profit margins. The right cleaning business software gives you a dashboard with these metrics built in.</p>`,
    ],
    [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in to your dashboard" },
      { href: "/blog", label: "Blog" },
      { href: "/pricing", label: "Pricing" },
    ],
  ),

  "/blog/how-to-start-a-cleaning-business": page(
    "Starting a cleaning business has never been more accessible. With the right tools—like automated payroll software for maid services, a cleaning business inventory management tool, and real-time messenger for cleaning teams—you can compete with established companies from day one.",
    [
      `<h2>In This Guide</h2>`,
      bullets([
        "Getting Started: Business Fundamentals",
        "How to Manage a Cleaning Schedule",
        "How to Handle Staff Payroll",
        "How to Track Client Leads",
        "Cleaning Business Inventory Management",
        "Real-Time Team Communication",
      ]),
    ],
    [
      { href: "/blog/booking-koala-vs-jobber-vs-tidywise", label: "Booking Koala vs Jobber vs TidyWise: Complete Comparison" },
      { href: "/blog/best-software-for-cleaning-business", label: "Best Software for Cleaning Business Owners (2025)" },
      { href: "/blog/how-to-automate-cleaning-company", label: "How to Automate Your Cleaning Company" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/blog/invoicing-software-for-cleaning-business": page(
    "Manual invoicing is one of the biggest revenue leaks in a cleaning business. Jobs get billed late, at the wrong amount, or occasionally not at all. Clients pay slowly when they have to write a check. And every hour you spend chasing payments is an hour not spent growing the business. Good invoicing software eliminates all of this — here's what to look for.",
    [
      `<h2>The Invoicing Challenges Unique to Cleaning Businesses</h2>`,
      `<p>Cleaning businesses have billing patterns that generic invoicing tools don't handle well:</p>`,
      points([
        { title: "High volume of small recurring invoices", description: "A 50-client business generates 100+ invoices per month — mostly for recurring jobs. Manual invoicing at this volume takes hours weekly. Automation is essential, not optional." },
        { title: "Variable job pricing", description: "Job prices change based on home size, extras added, one-off services, or seasonal deep cleans. The invoicing system needs to pull from the actual job record, not a fixed template." },
        { title: "Tips that vary per job", description: "Tips need to be captured separately from job revenue, tracked per cleaner, and reported accurately for payroll. Generic invoicing tools treat tips as line items rather than separate pay components." },
        { title: "Card-on-file for recurring clients", description: "Asking a recurring client to pay via check or link every visit creates friction and slow payment. The default should be card-on-file auto-charge after each completed job." },
        { title: "Deposit collection for new clients", description: "Many cleaning businesses require a deposit for first-time or move-in/move-out jobs. Invoicing software should support collecting deposits before the job, with the balance collected after." },
      ]),
    ],
    [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in to your dashboard" },
      { href: "/features/invoicing-software", label: "Invoicing software" },
      { href: "/blog", label: "Blog" },
    ],
  ),

  "/blog/maid-service-software": page(
    "Maid service software is the operational backbone of a residential cleaning company — handling scheduling, online booking, invoicing, payroll, client communication, and reporting in one place. The right platform saves 10-20 hours per week, reduces billing errors, and makes it possible to scale beyond what you can manually coordinate. This guide covers what to look for and how the top options compare.",
    [
      `<h2>What Maid Service Software Actually Does</h2>`,
      `<p>The term covers a lot of ground. Here are the core capabilities that matter for a residential cleaning business:</p>`,
      points([
        { title: "Online booking and instant quotes", description: "A public booking page where clients enter home details (bedrooms, bathrooms, extras) and get an instant price — then book in minutes without calling you." },
        { title: "Scheduling and dispatch", description: "Visual calendar for managing all jobs, assigning cleaners, handling recurring schedules, and rescheduling when plans change." },
        { title: "Client management (CRM)", description: "Contact history, cleaning notes, preferred products, access instructions, and payment info stored per client. Never ask a repeat customer for their entry code again." },
        { title: "Invoicing and payment collection", description: "Automatic invoices sent after job completion, online payment links, card-on-file charging, and deposit collection — reducing payment chasing to near zero." },
        { title: "Payroll and wage calculation", description: "Automated wage calculations based on hours, job type, and tips. The best platforms generate a payroll report — you just review and approve." },
        { title: "Cleaner mobile app", description: "A smartphone app where cleaners see their daily schedule, get job details, check in on arrival, mark jobs complete, and upload before/after photos." },
        { title: "Reporting and P&L", description: "Revenue by service type, profit per job, cancellation rates, and cleaner productivity — the data you need to run the business, not just log jobs." },
      ]),
      `<h2>Maid Service Software vs. General Field Service Software</h2>`,
      `<p><strong>Cleaning-specific platforms (TIDYWISE, ZenMaid, Launch27).</strong> Built from the ground up for residential cleaning. Features like square footage pricing, bedroom/bathroom-based quotes, cleaner checklists, and home entry notes are native. No workarounds required.</p>`,
      `<p><strong>General field service platforms (Jobber, Housecall Pro, ServiceTitan).</strong> Built for any home services business (plumbing, HVAC, landscaping). Can work for cleaning, but require configuration to handle cleaning-specific needs, often cost more, and include features you'll never use.</p>`,
      `<h2>Pricing: What to Expect</h2>`,
      `<p><strong>TIDYWISE:</strong> Plans from $49/mo, with Pro at $97/mo and Custom at $197/mo. Unlimited bookings on every tier.</p>`,
    ],
    [
      { href: "/signup", label: "Get started" },
      { href: "/login", label: "Sign in to your dashboard" },
      { href: "/blog", label: "Blog" },
      { href: "/pricing", label: "Pricing" },
    ],
  ),

  "/blog/payroll-software-for-cleaning-businesses": page(
    "Payroll is one of the most time-consuming parts of running a cleaning business. Between tracking hours, calculating tips, handling mileage reimbursements, and staying compliant with tax withholding — it adds up fast. The right payroll software can cut that time to minutes per pay period.",
    [
      `<h2>Why Cleaning Businesses Need Dedicated Payroll Software</h2>`,
      `<p>Generic payroll software like QuickBooks or Gusto wasn't built for the cleaning industry. They don't understand per-job wages, tip splits, mileage-based pay, or the reality of part-time cleaners working variable hours. You end up doing manual math in spreadsheets — which defeats the purpose.</p>`,
      `<p>Cleaning-specific payroll software handles the nuances: flat per-job rates, percentage-of-job pay, team splits, tip distribution, and automatic deductions — all calculated from the jobs your cleaners actually completed.</p>`,
      `<h2>Key Features to Look For</h2>`,
      points([
        { title: "Per-job wage calculation", description: "Automatically calculates cleaner pay based on completed jobs — flat rate, hourly, or percentage of service price." },
        { title: "Tip tracking and distribution", description: "Tracks customer tips and distributes them to the right cleaners automatically." },
        { title: "Mileage reimbursement", description: "Calculates mileage from job to job and applies the IRS reimbursement rate (or your custom rate)." },
        { title: "Tax withholding", description: "Handles federal and state tax withholding, W-2/1099 generation, and quarterly filings." },
        { title: "Direct deposit", description: "Pays cleaners directly to their bank accounts on your pay schedule." },
        { title: "Mobile access", description: "Cleaners can view their pay stubs and earnings history from their phone." },
      ]),
    ],
    [
      { href: "/features/payroll-software", label: "Payroll software" },
      { href: "/blog", label: "Blog" },
      { href: "/pricing", label: "Pricing" },
    ],
  ),

  "/blog/scheduling-software-for-cleaning-business": page(
    "Scheduling a cleaning business isn't like scheduling a dentist appointment. You're assigning specific cleaners to specific clients, managing recurring jobs, handling last-minute cancellations, optimizing drive routes, and keeping clients informed — all while billing correctly and paying staff accurately. Generic scheduling tools don't handle this. Here's what cleaning-specific scheduling software actually does, and what to look for.",
    [
      `<h2>Why Generic Scheduling Tools Fall Short for Cleaning Businesses</h2>`,
      `<p>Most scheduling apps are built for single-location businesses with walk-in appointments. Cleaning businesses have fundamentally different needs:</p>`,
      points([
        { title: "Multiple simultaneous jobs", description: "You might have 3 teams at different addresses at the same time — the software needs to track all of them independently." },
        { title: "Recurring schedules with exceptions", description: "A client books bi-weekly cleanings, skips one, then wants to add a deep clean for the next visit. This kind of flexibility breaks basic scheduling tools." },
        { title: "Cleaner assignment logic", description: "Some clients request specific cleaners. Some cleaners can only drive to certain areas. The software needs to support these constraints." },
        { title: "Square footage and room-based pricing", description: "Cleaning pricing depends on home size and number of bathrooms — not session length. Your scheduling tool needs to calculate job duration and price from property details, not just block time." },
        { title: "Integration with payments and payroll", description: "A completed job should automatically trigger an invoice and a payroll entry. Disconnected tools mean manual data entry and errors." },
      ]),
    ],
    [
      { href: "/blog/post/cleaning-business-scheduling-software", label: "Cleaning Business Scheduling Software: How to Pick the Right One" },
      { href: "/signup", label: "Get started" },
      { href: "/blog", label: "Blog" },
      { href: "/pricing", label: "Pricing" },
    ],
  ),
};

/** Posts the blog index renders from code, in the same titles the page uses. */
export const BLOG_INDEX_STATIC_LINKS: Array<{ href: string; title: string }> = [
  { href: "/blog/crm-for-cleaning-business", title: "Best CRM for Cleaning Business: Complete Guide to Maid Service Software" },
  { href: "/blog/how-to-start-a-cleaning-business", title: "The Ultimate Guide on How to Start a Cleaning Business in 2026" },
  { href: "/blog/booking-koala-vs-jobber-vs-tidywise", title: "Booking Koala vs Jobber vs TidyWise: Which Software Wins in 2026?" },
  { href: "/blog/how-to-grow-cleaning-business-2025", title: "How to Grow Your Cleaning Business in 2025" },
  { href: "/blog/best-software-for-cleaning-business", title: "Best Software for Cleaning Business Owners" },
  { href: "/blog/how-to-automate-cleaning-company", title: "How to Automate Your Cleaning Company" },
  { href: "/blog/payroll-software-for-cleaning-businesses", title: "Best Payroll Software for Cleaning Businesses (2026 Guide)" },
  { href: "/blog/gps-tracking-cleaning-business", title: "GPS Tracking for Cleaning Businesses — Do You Need It?" },
  { href: "/blog/scheduling-software-for-cleaning-business", title: "Scheduling Software for Cleaning Businesses (2026 Guide)" },
  { href: "/blog/invoicing-software-for-cleaning-business", title: "Invoicing Software for Cleaning Businesses — Get Paid Faster" },
  { href: "/blog/maid-service-software", title: "Best Maid Service Software in 2026 — Complete Buyer's Guide" },
  { href: "/blog/cleaning-business-management-software", title: "Cleaning Business Management Software — What You Actually Need" },
  { href: "/features/scheduling-software", title: "Cleaning Scheduling Software That Reduces No-Shows by 40%" },
  { href: "/features/route-optimization", title: "Route Optimization Software for Cleaning Businesses" },
  { href: "/features/invoicing-software", title: "Cleaning Business Invoicing Software: Get Paid Faster" },
  { href: "/compare/jobber", title: "TidyWise vs Jobber: Complete 2026 Comparison" },
  { href: "/compare/booking-koala", title: "TidyWise vs Booking Koala: Feature-by-Feature Breakdown" },
  { href: "/compare/housecall-pro", title: "Best Housecall Pro Alternative for Cleaning Businesses" },
  { href: "/features/payroll-software", title: "Payroll Software for Cleaning Businesses — Pro at $97/mo" },
];

export function blogIndexPrerenderBody(dynamicPosts: Array<{ slug: string; title: string }>): string {
  const seen = new Set<string>();
  const links: Array<{ href: string; title: string }> = [];
  const add = (href: string, title: string) => {
    if (!href || !title || seen.has(href)) return;
    seen.add(href);
    links.push({ href, title });
  };
  for (const link of BLOG_INDEX_STATIC_LINKS) add(link.href, link.title);
  for (const post of dynamicPosts) {
    if (!post.slug || !post.title) continue;
    add(`/blog/post/${post.slug}`, post.title);
  }
  const items = links
    .map((link) => `<li><a href="${esc(link.href)}">${esc(link.title)}</a></li>`)
    .join("");
  return [
    `<p>Expert insights on growing your cleaning business. From automated payroll to inventory management, we've got you covered.</p>`,
    `<h2>All posts</h2>`,
    `<ul>${items}</ul>`,
    nav([
      { href: "/", label: "Back to Home" },
      { href: "/pricing", label: "Pricing" },
      { href: "/demo", label: "Book a demo" },
    ]),
  ].join("");
}
