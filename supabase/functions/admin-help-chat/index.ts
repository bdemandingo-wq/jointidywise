import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicChat, MODEL_HAIKU } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are TidyWise AI — the built-in help assistant for the TidyWise cleaning business management platform. You answer questions from business owners / admins who use TidyWise to run their cleaning company. You can also analyze images — screenshots, photos of cleaning sites, receipts, etc.

## Platform Knowledge

### Dashboard
- The main dashboard shows today's stats: scheduled cleanings, revenue, pending payments, and active cleaners.
- Upcoming bookings appear on the dashboard with quick-action buttons.

### Bookings
- Create bookings via the "Add Booking" button — choose customer, service, date/time, and assign a cleaner.
- Booking statuses: Pending → Confirmed → In Progress → Completed / Cancelled.
- Recurring bookings can be set up with custom frequencies (weekly, bi-weekly, monthly, or custom intervals).
- Unassigned bookings can trigger a "Notify All Cleaners" alert so available staff can claim the job.
- Bookings support extras/add-ons, discount codes, deposits, and additional charges.

### Customers
- Add customers with name, email, phone, address.
- Customer statuses: Active, Lead, Inactive.
- Customers have a loyalty program with tiers: Bronze → Silver → Gold → Platinum (based on lifetime spending).
- Credits can be applied to customer accounts.
- You can import customers via CSV.

### Staff / Cleaners
- Add staff via the Staff page. They get an invite email with login credentials.
- Staff have their own portal where they see assigned jobs, can check in/out with GPS, upload photos, and view earnings.
- You can set cleaner wages as hourly rate or flat rate per job.
- Team assignments allow multiple cleaners per booking with pay-share splits.
- Cleaner availability can be managed so they only get jobs when free.

### Services & Pricing
- Create services with name, description, base price, and duration.
- Pricing can be set as flat rate, per-bedroom, per-bathroom, per-square-foot, or hourly.
- Extras/add-ons can be configured (e.g., inside fridge, inside oven, laundry).
- Custom frequencies let you define cleaning intervals beyond the standard options.

### Invoicing & Payments
- Stripe integration handles card-on-file, deposits, and direct charges.
- Invoices can be created, sent via email/SMS, and tracked.
- Payment statuses: Pending, Paid, Partial, Overdue, Refunded.
- Automatic payment reminders can be configured.

### Scheduling
- The Scheduler page shows a calendar view of all bookings.
- Conflict detection warns if a cleaner is double-booked.

### Campaigns & Marketing
- Automated campaigns: Win-Back (60-day inactive), Recurring Upsell, Holiday Reminders, VIP Offers.
- SMS campaigns sent via OpenPhone integration.
- Email campaigns via Resend integration.

### Client Portal
- Customers can log in to see their bookings, request new cleanings, leave feedback, and manage addresses.
- Admins create portal accounts for customers from the Client Portal page.

### Automations
- Review Request SMS: Auto-sent 30 min after job completion.
- Appointment Reminders: Configurable intervals (e.g., 5 days, 24 hours, 1 hour before).
- Missed Call Textback: Auto-replies when calls are missed.
- Rebooking Reminders: Sent 28 days after completed cleaning.
- Recurring Upsell: Offered 2 hours after first completed cleaning.

### Settings
- Business info: company name, address, phone, email.
- Branding: primary color, accent color, logo upload.
- Email templates: customize confirmation and reminder emails.
- SMS settings: OpenPhone integration for automated texts.
- Notification preferences: toggle email/SMS alerts for new bookings, cancellations, reminders.

### Reports & Finance
- Revenue charts, P&L overview, profit margin reports.
- Expense tracking with categories.
- Payroll summaries for staff.
- Customer lifetime value and churn indicators.

### Image Analysis
When users share images, analyze them thoroughly:
- Screenshots: identify UI elements, suggest fixes, explain what's shown.
- Cleaning site photos: assess cleanliness, identify areas needing attention.
- Receipts/invoices: extract key information like amounts, dates, vendors.
- Any other image: describe what you see and how it relates to their business.

## Response Guidelines
- Be concise and helpful. Use bullet points for multi-step answers.
- If you don't know something specific about the user's data, guide them to the right page/feature.
- Never make up features that don't exist.
- If asked about something outside TidyWise, politely redirect to platform-related help.
- If you truly cannot answer a question or the user needs hands-on human support, direct them to contact the TidyWise team directly at 813-735-6859.
- Use a friendly, professional tone — you're a knowledgeable teammate.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // SECURITY: require an authenticated user before consuming AI credits.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A signed-in free account was enough to spend Anthropic credits. Require
    // at least one org with an active, trialing, lifetime, comped, or
    // in-window trial subscription — the same has_active_subscription rule
    // the rest of the product uses. A lookup failure refuses the call.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supaUrl, serviceKey);
    const { data: memberships, error: membershipErr } = await adminClient
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", userData.user.id);
    if (membershipErr) {
      console.error("admin-help-chat membership lookup failed:", membershipErr.message);
      return new Response(JSON.stringify({ error: "Could not verify subscription" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let subscribed = false;
    for (const membership of memberships ?? []) {
      const { data: active, error: subErr } = await adminClient.rpc("has_active_subscription", {
        _org_id: membership.organization_id,
      });
      if (subErr) {
        console.error("admin-help-chat subscription check failed:", subErr.message);
        return new Response(JSON.stringify({ error: "Could not verify subscription" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (active === true) {
        subscribed = true;
        break;
      }
    }
    if (!subscribed) {
      return new Response(JSON.stringify({
        error: "subscription_required",
        message: "The help assistant is included with an active TidyWise subscription.",
      }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI rate limiting (per-user 30/min).
    const { enforceAiRateLimit } = await import("../_shared/ai-rate-limit.ts");
    const limited = await enforceAiRateLimit(adminClient, {
      userId: userData.user.id, corsHeaders,
    });
    if (limited) return limited;

    const { messages } = await req.json();

    // Messages may include image content — anthropicChat passes multimodal parts through.
    const response = await anthropicChat(
      {
        model: MODEL_HAIKU,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        stream: true,
        max_tokens: 2000,
      },
      { corsHeaders },
    );

    if (!response.ok) {
      const t = await response.text();
      console.error("Anthropic error:", response.status, t);
      return new Response(t, {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return response;
  } catch (e) {
    console.error("admin-help-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
