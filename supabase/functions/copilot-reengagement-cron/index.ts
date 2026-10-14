import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
// copilot-reengagement-cron — hourly stall-detection and nudge dispatch.
//
// Loops every active org, evaluates the 5 stall conditions, and sends at most
// one nudge per user per 24h. Stops entirely once the org is activated or
// reengagement_paused is set on onboarding_progress.
//
// Channel rules:
//   in_app  → row in copilot_reengagement_log; frontend renders banners
//   email   → per-org Resend via getOrgEmailSettings (no platform fallback)
//   sms     → OpenPhone via the platform's OPENPHONE_API_KEY
//
// Trial-expiring stall is left out — no trials/subscriptions table exists yet.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendResendSdkEmail } from "../_shared/send-resend.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import {
  formatEmailFrom,
  getOrgEmailSettings,
  getReplyTo,
} from "../_shared/get-org-email-settings.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const APP_URL = Deno.env.get("APP_URL") ?? "https://app.jointidywise.com";
const FOUNDER_EMAIL = Deno.env.get("FOUNDER_EMAIL")?.trim() || tidywiseSupportEmail();
const FOUNDER_NAME = Deno.env.get("FOUNDER_NAME") ?? "Emmanuel";

type NudgeReason =
  | "no_bookings_after_24h"
  | "bookings_but_no_clients"
  | "staff_invited_no_stripe"
  | "idle_7_days_after_signup";

type Channel = "in_app" | "email" | "sms";

interface PlannedNudge {
  organizationId: string;
  userId: string;
  reason: NudgeReason;
  channel: Channel;
  recipient: string | null; // email or phone for email/sms
  subject?: string;
  body: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError(500, "Supabase configuration missing");
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // Pull every org with its owner profile + onboarding state in a single sweep.
  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select("id, name, owner_id, created_at");
  if (orgsError) return jsonError(500, orgsError.message);

  const summary = {
    orgs_checked: 0,
    nudges_sent: 0,
    nudges_skipped_throttled: 0,
    nudges_skipped_paused: 0,
    nudges_failed: 0,
    by_reason: {} as Record<string, number>,
    by_channel: {} as Record<string, number>,
  };

  for (const org of (orgs ?? []) as Array<{
    id: string;
    name: string;
    owner_id: string;
    created_at: string;
  }>) {
    summary.orgs_checked++;
    try {
      const planned = await planNudgesForOrg(supabase, org);
      for (const nudge of planned) {
        const skipReason = await throttleOrPauseCheck(supabase, nudge);
        if (skipReason === "paused") {
          summary.nudges_skipped_paused++;
          continue;
        }
        if (skipReason === "throttled") {
          summary.nudges_skipped_throttled++;
          continue;
        }

        const result = await dispatch(supabase, nudge);
        if (result.success) {
          summary.nudges_sent++;
          summary.by_reason[nudge.reason] =
            (summary.by_reason[nudge.reason] ?? 0) + 1;
          summary.by_channel[nudge.channel] =
            (summary.by_channel[nudge.channel] ?? 0) + 1;
        } else {
          summary.nudges_failed++;
          console.error(
            `[copilot-reengagement-cron] Dispatch failed for org ${org.id} (${nudge.channel}/${nudge.reason}):`,
            result.error,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[copilot-reengagement-cron] Org ${org.id} threw:`, msg);
    }
  }

  return new Response(
    JSON.stringify({ success: true, summary }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

// ---------------------------------------------------------------------------
// Planning — figure out which nudges (if any) apply to one org
// ---------------------------------------------------------------------------

async function planNudgesForOrg(
  supabase: SupabaseClient,
  org: { id: string; name: string; owner_id: string; created_at: string },
): Promise<PlannedNudge[]> {
  // Skip if onboarding is complete or re-engagement is explicitly paused.
  const { data: progress } = await supabase
    .from("onboarding_progress")
    .select("activated_at, reengagement_paused, copilot_dismissed_at")
    .eq("organization_id", org.id)
    .maybeSingle();
  if (progress?.activated_at) return [];
  if (progress?.reengagement_paused) return [];

  // Owner profile — most nudges target the owner directly.
  const { data: ownerProfile } = await supabase
    .from("profiles")
    .select("first_name, email, phone")
    .eq("id", org.owner_id)
    .maybeSingle();
  if (!ownerProfile) return []; // can't nudge a ghost

  const ownerEmail = (ownerProfile.email as string | null) ?? null;
  const ownerPhone = (ownerProfile.phone as string | null) ?? null;
  const firstName = (ownerProfile.first_name as string | null) ?? null;
  const greeting = firstName ? `Hey ${firstName}` : "Hey there";

  const ageHours = (Date.now() - new Date(org.created_at).getTime()) /
    (1000 * 60 * 60);

  // Counts we need across multiple checks — pull once.
  const [bookingsCount, customersCount, staffCount, payoutEnabledCount] =
    await Promise.all([
      countRows(supabase, "bookings", org.id),
      countRows(supabase, "customers", org.id),
      countRows(supabase, "staff", org.id),
      countPayoutsEnabled(supabase, org.id),
    ]);

  const planned: PlannedNudge[] = [];

  // Condition 1: signed up >24h ago, no bookings yet → SMS + email
  if (ageHours >= 24 && bookingsCount === 0) {
    if (ownerEmail) {
      planned.push({
        organizationId: org.id,
        userId: org.owner_id,
        reason: "no_bookings_after_24h",
        channel: "email",
        recipient: ownerEmail,
        subject: "Stuck on something? I can help with your first booking.",
        body:
          `${greeting},\n\n` +
          `I noticed you signed up for TidyWise yesterday and haven't created your first booking yet. Totally normal — most people get tripped up at the same step.\n\n` +
          `Want me to walk you through it? Takes about 3 minutes start to finish.\n\n` +
          `Hop back in: ${APP_URL}/dashboard\n\n` +
          `— Tidy (your TidyWise co-pilot)`,
      });
    }
    if (ownerPhone) {
      planned.push({
        organizationId: org.id,
        userId: org.owner_id,
        reason: "no_bookings_after_24h",
        channel: "sms",
        recipient: ownerPhone,
        body:
          `${greeting} — saw you signed up for TidyWise yesterday. Need a hand creating your first booking? Hop back in and I'll walk you through it: ${APP_URL}/dashboard`,
      });
    }
  }

  // Condition 2: 1+ bookings but no clients imported → in-app banner
  if (bookingsCount > 0 && customersCount === 0) {
    planned.push({
      organizationId: org.id,
      userId: org.owner_id,
      reason: "bookings_but_no_clients",
      channel: "in_app",
      recipient: null,
      subject: "Speed things up — import your existing clients in one click",
      body:
        "You've got bookings but no clients imported yet. Drop in a CSV and I'll handle the cleanup — duplicates, formatting, the works.",
    });
  }

  // Condition 3: staff invited but Stripe Connect not completed by anyone
  if (staffCount > 0 && payoutEnabledCount === 0 && ownerEmail) {
    planned.push({
      organizationId: org.id,
      userId: org.owner_id,
      reason: "staff_invited_no_stripe",
      channel: "email",
      recipient: ownerEmail,
      subject: "Your cleaners can't get paid yet",
      body:
        `${greeting},\n\n` +
        `Looks like you've added cleaners to TidyWise, but none of them have finished Stripe Connect onboarding yet. Until they do, payouts can't go through.\n\n` +
        `Want me to send them a reminder? Open Staff → Payouts to nudge them: ${APP_URL}/dashboard/staff\n\n` +
        `— Tidy`,
    });
  }

  // Condition 4: idle 7+ days after signup → personal email "from Emmanuel"
  if (ageHours >= 24 * 7 && ownerEmail) {
    planned.push({
      organizationId: org.id,
      userId: org.owner_id,
      reason: "idle_7_days_after_signup",
      channel: "email",
      recipient: ownerEmail,
      subject: "Anything I can help with personally?",
      body:
        `${greeting},\n\n` +
        `I'm ${FOUNDER_NAME}, founder of TidyWise. I noticed you signed up about a week ago but haven't been back since.\n\n` +
        `I'd love to know what got in the way — was it pricing? A missing feature? Just ran out of time? Reply to this email and I'll get back to you within an hour.\n\n` +
        `Either way, I'm rooting for you.\n\n` +
        `${FOUNDER_NAME}`,
      // Replies go to the founder, not the org's per-org Resend setup.
    });
  }

  return planned;
}

async function countRows(
  supabase: SupabaseClient,
  table: string,
  organizationId: string,
): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  return count ?? 0;
}

async function countPayoutsEnabled(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<number> {
  const { count } = await supabase
    .from("staff_payout_accounts")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("payouts_enabled", true);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Throttle — max 1 nudge per user per 24h, across all reasons/channels.
// Returns "throttled" / "paused" / null.
// ---------------------------------------------------------------------------

async function throttleOrPauseCheck(
  supabase: SupabaseClient,
  nudge: PlannedNudge,
): Promise<"throttled" | "paused" | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("copilot_reengagement_log")
    .select("id")
    .eq("user_id", nudge.userId)
    .gte("sent_at", since)
    .limit(1);
  if (error) {
    console.error("[copilot-reengagement-cron] Throttle check failed:", error.message);
    return null; // fail open — better to risk a duplicate than to silently drop
  }
  return data && data.length > 0 ? "throttled" : null;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(
  supabase: SupabaseClient,
  nudge: PlannedNudge,
): Promise<{ success: boolean; error?: string }> {
  if (nudge.channel === "in_app") {
    return await logAndReturn(supabase, nudge, true);
  }

  if (nudge.channel === "email") {
    const result = await sendEmail(nudge);
    return await logAndReturn(supabase, nudge, result.success, {
      error: result.error,
      provider_message_id: result.providerMessageId,
    });
  }

  if (nudge.channel === "sms") {
    const result = await sendSms(nudge);
    return await logAndReturn(supabase, nudge, result.success, {
      error: result.error,
      provider_message_id: result.providerMessageId,
    });
  }

  return { success: false, error: `Unknown channel: ${nudge.channel}` };
}

async function sendEmail(
  nudge: PlannedNudge,
): Promise<{ success: boolean; providerMessageId?: string; error?: string }> {
  if (!nudge.recipient) return { success: false, error: "no recipient" };

  // The 7-day "from Emmanuel" nudge bypasses per-org Resend — it's literally
  // the founder writing, so it goes through the platform Resend account.
  if (nudge.reason === "idle_7_days_after_signup") {
    const platformKey = Deno.env.get("RESEND_API_KEY");
    if (!platformKey) {
      return { success: false, error: "Platform RESEND_API_KEY not configured" };
    }
    try {
      const r = await sendResendSdkEmail(platformKey, {
        from: `${FOUNDER_NAME} <${FOUNDER_EMAIL}>`,
        to: [nudge.recipient],
        reply_to: FOUNDER_EMAIL,
        subject: nudge.subject ?? "Checking in",
        text: nudge.body,
      }, { organizationId: nudge.organizationId });
      if ((r as { error?: { message: string } | null })?.error) {
        return { success: false, error: (r as { error: { message: string } }).error.message };
      }
      return { success: true, providerMessageId: (r as { data?: { id: string } })?.data?.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // All other emails come from the org's own Resend setup — no platform
  // fallback (per the payroll-period precedent).
  const settingsResult = await getOrgEmailSettings(nudge.organizationId);
  if (!settingsResult.success || !settingsResult.settings) {
    return { success: false, error: settingsResult.error ?? "Email settings missing" };
  }
  if (!settingsResult.settings.resend_api_key) {
    return { success: false, error: "Org has no Resend API key configured" };
  }
  try {
    const r = await sendResendSdkEmail(settingsResult.settings.resend_api_key, {
      from: formatEmailFrom(settingsResult.settings),
      to: [nudge.recipient],
      reply_to: getReplyTo(settingsResult.settings),
      subject: nudge.subject ?? "Quick nudge from TidyWise",
      text: nudge.body,
    }, { organizationId: nudge.organizationId });
    if ((r as { error?: { message: string } | null })?.error) {
      return { success: false, error: (r as { error: { message: string } }).error.message };
    }
    return { success: true, providerMessageId: (r as { data?: { id: string } })?.data?.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendSms(
  nudge: PlannedNudge,
): Promise<{ success: boolean; providerMessageId?: string; error?: string }> {
  if (!nudge.recipient) return { success: false, error: "no recipient" };
  const apiKey = Deno.env.get("OPENPHONE_API_KEY");
  const fromNumber = Deno.env.get("OPENPHONE_FROM_NUMBER");
  if (!apiKey || !fromNumber) {
    return { success: false, error: "OpenPhone not configured" };
  }
  try {
    const res = await sendOpenPhoneMessage( { organizationId: nudge.organizationId,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey,
      },
      body: JSON.stringify({
        from: fromNumber,
        to: [nudge.recipient],
        content: nudge.body,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { success: false, error: `OpenPhone ${res.status}: ${txt}` };
    }
    const data = await res.json() as { data?: { id?: string } };
    return { success: true, providerMessageId: data?.data?.id };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function logAndReturn(
  supabase: SupabaseClient,
  nudge: PlannedNudge,
  success: boolean,
  extra: Record<string, unknown> = {},
): Promise<{ success: boolean; error?: string }> {
  const { error: logError } = await supabase
    .from("copilot_reengagement_log")
    .insert({
      organization_id: nudge.organizationId,
      user_id: nudge.userId,
      trigger_reason: nudge.reason,
      channel: nudge.channel,
      recipient: nudge.recipient,
      message_subject: nudge.subject ?? null,
      message_body: nudge.body,
      metadata: {
        success,
        ...extra,
      },
    });
  if (logError) {
    console.error("[copilot-reengagement-cron] Log insert failed:", logError.message);
  }
  return { success, error: extra.error as string | undefined };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function jsonError(status: number, error: string): Response {
  return new Response(
    JSON.stringify({ success: false, error }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
