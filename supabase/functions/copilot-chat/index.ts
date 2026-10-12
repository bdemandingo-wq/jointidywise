// copilot-chat — ambient assistant chat backed by Claude.
//
// Loads org/user context, calls Anthropic, and persists both the user message
// and assistant reply to copilot_conversations. The frontend (Phase 2) renders
// the streamed/returned text and optional follow-up action suggestions.
//
// Phase 1 returns plain text. Structured tool-use actions land in Phase 2 once
// we know which actions the frontend wants to execute (create_booking, etc).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.40.0";
import { requireOrgAdmin, sharedCorsHeaders } from "../_shared/requireOrgAdmin.ts";

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 4096;
const HISTORY_TURN_LIMIT = 12; // cap how much prior chat we replay per turn

// ---------------------------------------------------------------------------
// System prompt — the stable persona. Per-org context is appended as a
// separate system block on every request so this prefix can be cached
// later if it grows past 4096 tokens (Opus 4.7 minimum).
// ---------------------------------------------------------------------------
const PERSONA_PROMPT = `You are Tidy, the friendly AI co-pilot inside TidyWise — a CRM for cleaning businesses. You help business owners get set up and use TidyWise effectively.

CRITICAL ACCURACY RULES — read these first, follow them always:

1. NEVER invent features, buttons, menus, pages, or workflows that you are not 100% certain exist in TidyWise. If unsure → say so directly.

2. If a user asks how to do something and you don't know whether the feature exists, respond with:
   "I'm not sure if TidyWise has that exact feature yet. Want me to flag this as a feature request to Emmanuel? Or — if you can describe what you're trying to accomplish, I might know an alternative way to get there using features I'm confident exist."

3. Features I AM confident exist in TidyWise (safe to discuss):
   - Bookings (one-time + recurring)
   - Customers list (NO merge feature, NO duplicate detection, NO actions menu in top-right)
   - Stripe Connect for payments + payouts
   - OpenPhone integration for SMS
   - Staff/team management with W-9 vs W-2 distinction
   - Payroll periods (weekly, bi-weekly) with period reports emailed
   - Services + pricing (sqft tiers + frequency discounts)
   - Invoices with org-branded styling
   - Recurring booking discounts — configurable per-org in Settings → Pricing (admin-only). Each org sets their own percentages for one-time, monthly, bi-weekly, and weekly. Defaults vary by org; do not quote specific numbers unless the user asks about their own org and you have access to their settings.
   - Booking photos, Inventory, Campaigns, Tasks, Leads
   - Client Portal, Checklists, Discounts
   - Dashboard with KPIs
   - AI co-pilot (you, Tidy) — toggleable in Settings → General
   - Product tour for new signups
    - Help videos at /dashboard/help
   - Bulk CSV export of customers. Admins can export their customer list to CSV from /dashboard/customers using the "Export CSV" button in the page header (exports the currently filtered list) or via the "Export Selected" item in the row actions dropdown (exports only checkbox-selected rows). The export includes 14 columns: First Name, Last Name, Email, Phone, Street Address, City, State, ZIP, Customer Type (residential/commercial), Total Bookings, Total Revenue, Last Booking Date, Created Date, Notes. Files are named tidywise-customers-{date}.csv or tidywise-customers-selected-{date}.csv. Admin-only feature.

4. Features I am NOT sure exist — DO NOT describe these as if they do:
   - Duplicate customer detection / merge
   - Bulk customer import (CSV import in dev for Phase 4, not live)
   - Customer tags / segments
   - Email marketing campaigns (only SMS via OpenPhone confirmed)
   - Refund flows beyond Stripe's native dashboard
   - Mobile app (iOS pending Apple approval)
   - Reports beyond dashboard KPIs
   - Custom fields on customers/bookings
   - Zapier or any third-party integrations beyond Stripe + OpenPhone
   - Anything I haven't explicitly listed in section 3

5. When describing HOW to do something, give the exact route path (e.g. /dashboard/customers, /dashboard/settings) but NEVER invent UI elements like "the actions menu in the top-right" or "the merge button" unless certain.

6. If a user reports that the feature you described doesn't exist where you said: APOLOGIZE, acknowledge you may have been wrong, offer to file a feature request rather than guessing.

7. When in doubt, defer to the user. They're looking at the actual TidyWise UI right now. You are not.

The accuracy rules above take priority over personality below.

YOUR PERSONALITY:
- Warm, operator-to-operator, never corporate
- Use contractions ("you're", "I'll", "let's")
- Short, action-oriented replies (this is chat, not an essay)
- Cleaning-business language: clients, bookings, cleaners — not users, appointments, staff
- Empathy when users are stuck or frustrated; light humor when it fits, never sarcasm
- End most replies with a clear next step the user can take in the app

WHAT YOU CAN DO:
- Walk users through any feature in TidyWise (settings, bookings, clients, payroll, etc.)
- Help with CSV imports of existing client lists
- Surface relevant help docs
- Suggest the next best step based on where the user is in onboarding

WHAT YOU DON'T DO:
- Invent features that don't exist
- Promise specific outcomes ("you'll definitely make $10k/month")
- Discuss competitor pricing in detail
- Provide legal, tax, or financial advice — defer to professionals
- Speak for Anthropic, OpenAI, or any other AI provider — you're Tidy, that's it

OUTPUT FORMAT:
Plain text. No markdown headers. Use short paragraphs. If you're suggesting the user click something, name the exact path (e.g. "Settings → Emails"). When listing options, use a tight 1–3 item list, not a wall of bullets.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatRequest {
  organization_id?: string;
  conversation_id?: string;
  message?: string;
  context?: Record<string, unknown>;
}

interface OrgContext {
  companyName: string | null;
  servicesSummary: string | null;
  milestonesComplete: number;
  totalMilestones: number;
  activated: boolean;
  recentActivity: string[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: sharedCorsHeaders });
  }

  let body: ChatRequest = {};
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const { organization_id: organizationId, message, context = {} } = body;
  let { conversation_id: conversationId } = body;

  if (!organizationId) return jsonError(400, "organization_id required");
  if (!message || typeof message !== "string" || !message.trim()) {
    return jsonError(400, "message is required and must be non-empty");
  }
  if (message.length > 8000) {
    return jsonError(413, "message too long (8000 char max)");
  }

  // Auth — any org member can chat with the co-pilot.
  const auth = await requireOrgAdmin(req, organizationId, { allowMember: true });
  if (auth instanceof Response) return auth;
  const userId = auth.user.id;

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return jsonError(500, "ANTHROPIC_API_KEY not configured");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError(500, "Supabase configuration missing");
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // Per-org AI credit consumption (1 credit per Copilot turn)
  const { enforceAiCredit } = await import("../_shared/ai-credits.ts");
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  const denied = await enforceAiCredit(supabase, { orgId: organizationId, corsHeaders });
  if (denied) return denied;


  // Generate a conversation thread id if the caller didn't provide one.
  if (!conversationId) conversationId = crypto.randomUUID();

  const orgContext = await loadOrgContext(supabase, organizationId);
  const history = await loadChatHistory(supabase, userId, conversationId);

  // Build messages — prior turns, then the new user message.
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({
      role: h.message_role as "user" | "assistant",
      content: h.message_content,
    })),
    { role: "user", content: message },
  ];

  const orgBlock = renderOrgContextBlock(orgContext, context);

  // Anthropic call. claude-opus-4-7 — adaptive thinking is off by default
  // (matches Opus 4.6 behavior); for short chat replies we want fast turns,
  // so we leave it off and use effort=low.
  const anthropic = new Anthropic({ apiKey });
  let response: Anthropic.Message;
  try {
    // SDK overload returns Message | Stream depending on `stream`. We don't
    // stream here, so cast through unknown to the non-stream variant.
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: PERSONA_PROMPT },
        { type: "text", text: orgBlock },
      ],
      messages,
    } as Anthropic.MessageCreateParams) as unknown as Anthropic.Message;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return jsonError(429, "AI is busy — try again in a moment.");
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[copilot-chat] Anthropic API error", err.status, err.message);
      return jsonError(502, `AI request failed: ${err.message}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[copilot-chat] Unexpected error:", msg);
    return jsonError(500, "AI request failed");
  }

  // Extract text. Opus 4.7 may return thinking blocks (empty by default), so
  // narrow on type and concat any text blocks.
  const replyText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!replyText) {
    return jsonError(502, "AI returned no text content");
  }

  // Persist both turns. Insert errors are logged but don't fail the call —
  // returning the reply matters more than the audit trail.
  const insertContext = {
    ...context,
    org: { id: organizationId, milestones: orgContext.milestonesComplete },
    usage: response.usage,
  };
  const { error: insertError } = await supabase
    .from("copilot_conversations")
    .insert([
      {
        organization_id: organizationId,
        user_id: userId,
        conversation_id: conversationId,
        message_role: "user",
        message_content: message,
        context: insertContext,
      },
      {
        organization_id: organizationId,
        user_id: userId,
        conversation_id: conversationId,
        message_role: "assistant",
        message_content: replyText,
        context: { ...insertContext, model: MODEL, stop_reason: response.stop_reason },
      },
    ]);
  if (insertError) {
    console.error("[copilot-chat] Failed to log conversation:", insertError.message);
  }

  return jsonOk({
    conversation_id: conversationId,
    response: replyText,
    usage: response.usage,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadOrgContext(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  organizationId: string,
): Promise<OrgContext> {
  const [bsResult, opResult, servicesResult] = await Promise.all([
    supabase
      .from("business_settings")
      .select("company_name, timezone")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("onboarding_progress")
      .select(
        "milestone_1_company_info_completed_at, milestone_2_services_pricing_completed_at, " +
          "milestone_3_clients_added_completed_at, milestone_4_staff_added_completed_at, " +
          "milestone_5_stripe_connected_completed_at, milestone_6_first_booking_completed_at, " +
          "activated_at",
      )
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("services")
      .select("name")
      .eq("organization_id", organizationId)
      .limit(8),
  ]);

  const bs = bsResult.data ?? null;
  const op = opResult.data ?? null;
  const servicesRows = (servicesResult.data ?? []) as Array<{ name: string }>;

  let milestonesComplete = 0;
  if (op) {
    for (let i = 1; i <= 6; i++) {
      const col = milestoneCol(i);
      if (op[col]) milestonesComplete++;
    }
  }

  const servicesSummary = servicesRows.length > 0
    ? servicesRows.map((s) => s.name).join(", ")
    : null;

  return {
    companyName: bs?.company_name ?? null,
    servicesSummary,
    milestonesComplete,
    totalMilestones: 6,
    activated: !!op?.activated_at,
    recentActivity: [], // populated in Phase 2 when we wire activity tracking
  };
}

function milestoneCol(n: number): string {
  return [
    "milestone_1_company_info_completed_at",
    "milestone_2_services_pricing_completed_at",
    "milestone_3_clients_added_completed_at",
    "milestone_4_staff_added_completed_at",
    "milestone_5_stripe_connected_completed_at",
    "milestone_6_first_booking_completed_at",
  ][n - 1];
}

async function loadChatHistory(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  conversationId: string,
): Promise<Array<{ message_role: string; message_content: string }>> {
  const { data, error } = await supabase
    .from("copilot_conversations")
    .select("message_role, message_content")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_TURN_LIMIT);
  if (error) {
    console.error("[copilot-chat] Failed to load history:", error.message);
    return [];
  }
  return (data ?? []) as Array<{ message_role: string; message_content: string }>;
}

function renderOrgContextBlock(
  ctx: OrgContext,
  reqContext: Record<string, unknown>,
): string {
  const lines: string[] = ["CURRENT ORG CONTEXT:"];
  if (ctx.companyName) lines.push(`- Company: ${ctx.companyName}`);
  lines.push(
    `- Onboarding: ${ctx.milestonesComplete}/${ctx.totalMilestones} milestones complete${
      ctx.activated ? " — activated" : ""
    }`,
  );
  if (ctx.servicesSummary) lines.push(`- Services configured: ${ctx.servicesSummary}`);
  else lines.push("- Services: none configured yet");

  const currentPage = typeof reqContext.current_page === "string"
    ? reqContext.current_page
    : null;
  if (currentPage) lines.push(`- User is currently on: ${currentPage}`);
  const recentAction = typeof reqContext.recent_action === "string"
    ? reqContext.recent_action
    : null;
  if (recentAction) lines.push(`- Most recent action: ${recentAction}`);

  lines.push(
    "",
    "Use this context to give specific, situation-aware help. Don't repeat it back to the user verbatim.",
  );
  return lines.join("\n");
}

function jsonError(status: number, error: string): Response {
  return new Response(
    JSON.stringify({ success: false, error }),
    { status, headers: { ...sharedCorsHeaders, "Content-Type": "application/json" } },
  );
}

function jsonOk(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ success: true, ...payload }),
    { status: 200, headers: { ...sharedCorsHeaders, "Content-Type": "application/json" } },
  );
}
