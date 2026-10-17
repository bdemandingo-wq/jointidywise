/**
 * Public Help FAQ copy for /help.
 *
 * Wording matches the approved FAQ. Bold runs are the only formatting,
 * and the support address is the one mailto on the page.
 */
import { SUPPORT_EMAIL } from "../lib/supportEmail.ts";

export const HELP_FAQ_PATH = "/help";
export const HELP_FAQ_TITLE = "TidyWise Help & FAQ";
export const HELP_FAQ_H1 = "TidyWise Help FAQ";
export const HELP_FAQ_DESCRIPTION =
  "Quick answers for getting your cleaning business set up and running on TidyWise, from the free trial and plans through booking, payments, and texts.";

type Run = string | { strong: string };

type Block =
  | { kind: "p"; runs: Run[] }
  | { kind: "ul"; items: Run[][] }
  | { kind: "ol"; items: Run[][] };

export type HelpFaqEntry = {
  question: string;
  blocks: Block[];
};

export type HelpFaqSection = {
  id: string;
  title: string;
  entries: HelpFaqEntry[];
};

const strong = (text: string): Run => ({ strong: text });

const INTRO: Run[] = [
  "Quick answers for getting your cleaning business set up and running on TidyWise. Features marked ",
  strong("(Pro)"),
  " are part of the Pro plan and are included during your free trial.",
];

export const HELP_FAQ_SECTIONS: HelpFaqSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    entries: [
      {
        question: "How does the free trial work? Do I need a card?",
        blocks: [
          {
            kind: "p",
            runs: [
              "No card is needed. Every new account gets a 30-day free trial with all Pro features. We'll email you a reminder on day 25 and day 29. If the trial ends without a plan, your account goes into limited mode with up to 5 customers until you choose a plan.",
            ],
          },
        ],
      },
      {
        question: "What plans are there, and what's the difference?",
        blocks: [
          {
            kind: "ul",
            items: [
              [
                strong("Basic ($49/mo or $490/yr):"),
                " bookings, customers, recurring jobs, the scheduler, estimates, invoices, payments, staff, checklists, messages and services.",
              ],
              [
                strong("Pro ($97/mo or $970/yr):"),
                " everything in Basic, plus Payroll (cleaner payouts), the Automation Center (automatic reminders, review requests and win-backs), the Client Portal, Booking Photos, live Tracking, Data Import, reports, the AI assistant, Leads, Campaigns, Expenses, Inventory and Tasks.",
              ],
              [
                strong("Custom ($197/mo or $1,970/yr):"),
                " everything in Pro, plus one done-for-you request a month and priority support.",
              ],
              [
                strong("Lifetime ($300 one-time):"),
                " every Pro feature with no recurring bill. It's limited to 100 founding spots and doesn't include the Custom plan's done-for-you requests.",
              ],
            ],
          },
        ],
      },
      {
        question: "How do I add my cleaning services?",
        blocks: [
          {
            kind: "ol",
            items: [
              [
                "Go to ",
                strong("Services"),
                " in the sidebar and open the ",
                strong("Custom Services"),
                " tab.",
              ],
              ["Click ", strong("Add Service"), "."],
              [
                "Enter the Service Name, Description, Duration (minutes) and Base Price ($).",
              ],
              [
                "Turn on ",
                strong("Active (visible in booking form)"),
                " so customers can book it online.",
              ],
            ],
          },
        ],
      },
      {
        question: "How do I set my prices?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Go to ",
              strong("Services → Service Pricing"),
              " and choose a service under \"Select Service Category\". There you can set square footage pricing (with a minimum price), bedroom and bathroom pricing, add-on extras, pet options and home condition options. This tab controls the prices customers see on your booking page. For recurring discounts, custom frequencies and surge pricing, go to ",
              strong("Settings → Pricing"),
              ".",
            ],
          },
        ],
      },
      {
        question: "Can I import my clients and other data? (Pro)",
        blocks: [
          {
            kind: "p",
            runs: [
              "Yes, using CSV files. For customers only, go to ",
              strong("Customers"),
              ", open the ",
              strong("⋯"),
              " menu and choose ",
              strong("Import"),
              ". To move everything over, go to ",
              strong("Settings → Import Data → Open Import Wizard"),
              ", pick your source (",
              strong("BookingKoala"),
              ", ",
              strong("Jobber"),
              " or ",
              strong("Other CSV"),
              ") and the type of data (customers, staff, bookings, recurring plans, services or property notes), then upload your file.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "booking",
    title: "Booking",
    entries: [
      {
        question: "Where is my online booking page, and how do I share it?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Go to ",
              strong("Settings → Booking Form"),
              ". The ",
              strong("Share Booking Form"),
              " card has your ",
              strong("Direct Link"),
              " to copy or preview, plus ",
              strong("Embed Code"),
              " to add the form to your website. Good places to share the link are your social bios, email signature, Google Business Profile and website.",
            ],
          },
        ],
      },
      {
        question: "Do customers pay when they book online?",
        blocks: [
          {
            kind: "p",
            runs: [
              "No. During booking, customers save a card on file, but they're not charged at that point. The card is charged only after the job is done. Booking takes 5 steps: Select Service, Choose Time, Your Details, Payment Method and Confirmation.",
            ],
          },
        ],
      },
      {
        question: "What is the client portal, and how do I give a customer access? (Pro)",
        blocks: [
          {
            kind: "p",
            runs: [
              "The client portal lets customers sign in to see upcoming and past cleanings, job photos, notifications, referrals, their saved card and more. They can also request a booking from it. To give a customer access:",
            ],
          },
          {
            kind: "ol",
            items: [
              [
                "Go to ",
                strong("Client Portal"),
                " and open the ",
                strong("Users"),
                " tab.",
              ],
              ["Click ", strong("Add User"), " and pick the customer."],
              [
                "Enter their login email, then set a password or click ",
                strong("Generate"),
                ".",
              ],
              [
                "Send them their login details. They sign in at jointidywise.com/portal.",
              ],
            ],
          },
          {
            kind: "p",
            runs: [
              "Note: the portal has no messaging tab, so customers can't message you or their cleaner there.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "team-and-cleaners",
    title: "Team & cleaners",
    entries: [
      {
        question: "How do I add a cleaner?",
        blocks: [
          {
            kind: "ol",
            items: [
              ["Go to ", strong("Staff"), " and click ", strong("Add Staff"), "."],
              [
                "Enter their name, email, a password (at least 6 characters), phone, tax classification (W-2 or 1099) and pay rate (hourly or percentage).",
              ],
              [
                "Save, then click ",
                strong("Copy Credentials"),
                " and send the login to your cleaner.",
              ],
            ],
          },
          {
            kind: "p",
            runs: [
              "To deactivate a cleaner, switch them off. They're removed from assignment lists, but their history is kept.",
            ],
          },
        ],
      },
      {
        question: "How do my cleaners get the app and sign in?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Cleaners can use the TidyWise iPhone app or any web browser. They sign in at the ",
              strong("Staff Portal"),
              " (jointidywise.com/staff/login) with the email and password you created for them. There's no Android app right now, so Android users should use their phone's browser.",
            ],
          },
        ],
      },
      {
        question: "How do I give my office manager access?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Go to ",
              strong("Settings → Team"),
              ", enter their email under \"Invite a teammate\", pick a role and send the invite. ",
              strong("Owners"),
              " have full access, including billing and financial data. ",
              strong("Managers"),
              " handle day-to-day operations but can't see financial data (payroll, expenses, finance, reports). Cleaners aren't added here. Add them under ",
              strong("Staff"),
              " instead.",
            ],
          },
        ],
      },
      {
        question: "Can I hide customer phone numbers from cleaners?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Yes. Go to ",
              strong("Settings → Team"),
              " and turn off ",
              strong("Show customer phone to cleaners"),
              " in the Cleaner privacy card. Cleaners will still see the customer's name and address.",
            ],
          },
        ],
      },
      {
        question: "Can cleaners upload before and after photos?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Yes. Each job in the cleaner app lets them upload photos or videos (MP4 or MOV, up to 2 minutes, under 100 MB) marked as Before or After. Uploads are saved on the phone first, so a weak signal won't lose them. You can see them under ",
              strong("Booking Photos"),
              " (Pro), and customers can see them in the client portal's ",
              strong("Journal"),
              " tab.",
            ],
          },
        ],
      },
      {
        question: "Is there GPS check-in? Can I see where my cleaners are?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Yes. On the day of a job, cleaners tap ",
              strong("On The Way → I've Arrived → Start Job → Complete Job"),
              ", and can use ",
              strong("GPS Check-In"),
              " and ",
              strong("GPS Check-Out"),
              ". You'll get a flag if a check-in is far from the job address. You can see your team under ",
              strong("Tracking"),
              " (Pro).",
            ],
          },
        ],
      },
      {
        question: "What happens when a cleaner marks a job done?",
        blocks: [
          {
            kind: "p",
            runs: [
              "When a cleaner taps ",
              strong("Complete Job"),
              ", you (the owner or office) get notified. The customer doesn't get a \"job done\" text. They get a review request instead.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "payments",
    title: "Payments",
    entries: [
      {
        question: "How do I connect Stripe to take payments?",
        blocks: [
          {
            kind: "ol",
            items: [
              ["Click ", strong("Payment Setup"), " in the sidebar."],
              ["Click ", strong("Connect with Stripe"), "."],
              [
                "Log in to Stripe (or create an account) and authorize TidyWise.",
              ],
            ],
          },
          {
            kind: "p",
            runs: [
              "Use your own Stripe account with your business details and bank account. Payments go straight to you, and TidyWise takes no cut. Only the account owner can connect Stripe. If a message ever points you to \"Settings → Payments\", go to ",
              strong("Payment Setup"),
              " instead.",
            ],
          },
        ],
      },
      {
        question: "How do I send an invoice and get paid online?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Go to ",
              strong("Invoices"),
              ", create an invoice and click ",
              strong("Send"),
              ". Your customer gets an email with a secure link to pay online (Stripe must be connected). When they pay, the invoice is marked Paid automatically and they get a receipt email. For cash, check or other payments, click ",
              strong("Mark Paid"),
              " and choose the method.",
            ],
          },
        ],
      },
      {
        question: "How do my cleaners get paid? (Pro)",
        blocks: [
          {
            kind: "p",
            runs: [
              "Each cleaner connects their bank account in the Staff Portal under the ",
              strong("Payouts"),
              " tab. Then go to ",
              strong("Payroll"),
              " and process their payout. If the cleaner has connected Stripe, the money is sent through Stripe. If not, the payout is just recorded as paid outside TidyWise. If you pay by cash, Zelle, Venmo or check, turn off ",
              strong("Require cleaners to set up Stripe payouts"),
              " under ",
              strong("Settings → Integrations"),
              ".",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "texts-and-reminders",
    title: "Texts & reminders",
    entries: [
      {
        question: "How do I connect OpenPhone so TidyWise can text my customers?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Texts are sent from your own OpenPhone account and number. TidyWise doesn't provide a number.",
            ],
          },
          {
            kind: "ol",
            items: [
              [
                "Go to ",
                strong("Settings → SMS"),
                " and turn on ",
                strong("Enable SMS Notifications"),
                ".",
              ],
              [
                "Paste your OpenPhone ",
                strong("API Key"),
                " (in OpenPhone, go to Settings → API).",
              ],
              [
                "Paste your ",
                strong("Phone Number ID"),
                ". It starts with \"PN\" (in OpenPhone, go to Phone Numbers and click your number). Use the ID only, not the full link.",
              ],
              [
                "Click ",
                strong("Save Settings"),
                ", then use ",
                strong("Send Test"),
                " to check that it works.",
              ],
            ],
          },
        ],
      },
      {
        question: "Do I need A2P 10DLC registration?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Yes. Carriers need it to deliver your texts reliably. You register in your OpenPhone dashboard, not in TidyWise. If your number isn't approved yet, TidyWise will show a message reminding you to finish registration in OpenPhone.",
            ],
          },
        ],
      },
      {
        question: "Which automatic texts go out to my customers?",
        blocks: [
          {
            kind: "p",
            runs: [
              "You can turn each one on or off under ",
              strong("Settings → Notifications"),
              ":",
            ],
          },
          {
            kind: "ul",
            items: [
              [
                strong("Booking confirmation:"),
                " sent when a booking is confirmed.",
              ],
              [
                strong("Appointment reminders (Pro):"),
                " by text and email. Set the timing in ",
                strong("Automation Center → Automations"),
                " and edit the wording in the ",
                strong("Messages"),
                " tab.",
              ],
              [
                strong("On the way:"),
                " sent when the cleaner taps On The Way. It can include an arrival time and a live tracking link.",
              ],
              [
                strong("Arrived:"),
                " sent when the cleaner taps I've Arrived.",
              ],
            ],
          },
          {
            kind: "p",
            runs: [
              "There's no \"job done\" text to customers. They get a review request instead. All texts need OpenPhone connected.",
            ],
          },
        ],
      },
      {
        question: "How do review requests work?",
        blocks: [
          {
            kind: "p",
            runs: [
              "First, add your ",
              strong("Google Review URL"),
              " under ",
              strong("Settings → Reviews"),
              ", where you can also edit the review request text. When a cleaner completes a job, the customer gets a review request by email. With the ",
              strong("Review Requests"),
              " automation (Pro), they also get a text 30 minutes after the job. Customers who rate 4 or 5 stars are sent to Google, and lower ratings go to your ",
              strong("Feedback"),
              " page so you can follow up privately.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "account-and-billing",
    title: "Account & billing",
    entries: [
      {
        question: "How do I change my plan or update billing?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Go to ",
              strong("Settings → Plan & billing"),
              ". From there you can upgrade or switch plans. If you're already subscribed, click ",
              strong("Manage billing"),
              " to open your billing portal, powered by Stripe.",
            ],
          },
        ],
      },
      {
        question: "Can I buy a plan in the iPhone app?",
        blocks: [
          {
            kind: "p",
            runs: [
              "No. Plans and billing are managed in a web browser at jointidywise.com. Sign in there and go to ",
              strong("Settings → Plan & billing"),
              ".",
            ],
          },
        ],
      },
      {
        question: "Need help?",
        blocks: [
          {
            kind: "p",
            runs: [
              "Email us at ",
              strong(SUPPORT_EMAIL),
              ". You can also watch tutorial videos under ",
              strong("Help"),
              " in the sidebar. We offer free setup: reply with your services, prices and client list, and we'll help get your account ready.",
            ],
          },
        ],
      },
    ],
  },
];

export function helpFaqEntries(): HelpFaqEntry[] {
  return HELP_FAQ_SECTIONS.flatMap((section) => section.entries);
}

function runsToText(runs: Run[]): string {
  return runs.map((run) => (typeof run === "string" ? run : run.strong)).join("");
}

/** Plain answer text for FAQPage JSON-LD. Wording is unchanged; lists keep their order. */
export function helpFaqAnswerText(entry: HelpFaqEntry): string {
  return entry.blocks
    .map((block) => {
      if (block.kind === "p") return runsToText(block.runs);
      return block.items
        .map((item, index) => {
          const text = runsToText(item);
          return block.kind === "ol" ? `${index + 1}. ${text}` : text;
        })
        .join("\n");
    })
    .join("\n\n");
}

export function helpFaqJsonLd(): Record<string, unknown> {
  return {
    "@type": "FAQPage",
    mainEntity: helpFaqEntries().map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: helpFaqAnswerText(entry),
      },
    })),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runsToHtml(runs: Run[]): string {
  return runs
    .map((run) => {
      if (typeof run === "string") return escapeHtml(run);
      const inner =
        run.strong === SUPPORT_EMAIL
          ? `<a href="mailto:${SUPPORT_EMAIL}">${escapeHtml(SUPPORT_EMAIL)}</a>`
          : escapeHtml(run.strong);
      return `<strong>${inner}</strong>`;
    })
    .join("");
}

function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "p") return `<p>${runsToHtml(block.runs)}</p>`;
      const tag = block.kind === "ol" ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${runsToHtml(item)}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    })
    .join("");
}

/** Crawler HTML for the full FAQ. The page heading is added separately by prerender. */
export function helpFaqPrerenderBody(): string {
  const intro = `<p>${runsToHtml(INTRO)}</p>`;
  const sections = HELP_FAQ_SECTIONS.map((section) => {
    const entries = section.entries
      .map(
        (entry) =>
          `<details><summary>${escapeHtml(entry.question)}</summary>${blocksToHtml(entry.blocks)}</details>`,
      )
      .join("");
    return `<section><h2>${escapeHtml(section.title)}</h2>${entries}</section>`;
  }).join("");
  return `${intro}${sections}`;
}

export function helpFaqIntroRuns(): Run[] {
  return INTRO;
}
