import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = Deno.env.get("APP_URL") || "https://jointidywise.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which reminder is due. Copied from src/lib/trialClock.ts so the cron
 * function does not import the Vite app. Keep the two in step: day 25 and
 * day 29 only, and only while trial_ends_at is still in the future.
 * A 14-day trial ends before day 25, so those accounts are not emailed.
 */
function dueTrialReminder(opts: {
  createdAt: string;
  trialEndsAt: string;
  alreadySent: number[];
  now: number;
}): 25 | 29 | null {
  const start = Date.parse(opts.createdAt);
  const end = Date.parse(opts.trialEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= opts.now) return null;
  const day = Math.floor((opts.now - start) / DAY_MS) + 1;
  const sent = new Set(opts.alreadySent);
  const reaches = (reminderDay: number) => end > start + (reminderDay - 1) * DAY_MS;
  if (day >= 29 && !sent.has(29) && reaches(29)) return 29;
  if (day >= 25 && day < 29 && !sent.has(25) && reaches(25)) return 25;
  return null;
}

/**
 * Daily cron for the card-free org trial (plan_type = 'trial').
 * Does not read or write Stripe, and does not change trial_ends_at.
 * A Stripe trial (card already collected) has a paid plan_type and is
 * skipped here, so those accounts are not emailed or billed differently.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("id, name, owner_id")
    .eq("plan_type", "trial");
  if (orgError) {
    return new Response(JSON.stringify({ error: orgError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const owners = [...new Set((orgs ?? []).map((org) => org.owner_id).filter(Boolean))] as string[];
  if (owners.length === 0) {
    return new Response(JSON.stringify({ sent: 0, skipped: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const profiles: Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    created_at: string;
    trial_ends_at: string | null;
    email_unsubscribed: boolean | null;
  }> = [];
  const sentRows: Array<{ profile_id: string; reminder_day: number }> = [];
  for (let i = 0; i < owners.length; i += 100) {
    const slice = owners.slice(i, i + 100);
    const { data: profilePage, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, created_at, trial_ends_at, email_unsubscribed")
      .in("id", slice);
    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    profiles.push(...(profilePage ?? []));

    const { data: sentPage, error: sentError } = await supabase
      .from("trial_reminder_log")
      .select("profile_id, reminder_day")
      .in("profile_id", slice);
    if (sentError) {
      return new Response(JSON.stringify({ error: sentError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    sentRows.push(...(sentPage ?? []));
  }

  const sentByProfile = new Map<string, number[]>();
  for (const row of sentRows ?? []) {
    const list = sentByProfile.get(row.profile_id) ?? [];
    list.push(row.reminder_day);
    sentByProfile.set(row.profile_id, list);
  }
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  let sent = 0;
  let skipped = 0;

  for (const org of orgs ?? []) {
    const profile = profileById.get(org.owner_id);
    if (!profile?.trial_ends_at || !profile.created_at || profile.email_unsubscribed) {
      skipped++;
      continue;
    }
    const reminderDay = dueTrialReminder({
      createdAt: profile.created_at,
      trialEndsAt: profile.trial_ends_at,
      alreadySent: sentByProfile.get(profile.id) ?? [],
      now,
    });
    if (!reminderDay) {
      skipped++;
      continue;
    }

    const { error: claimError } = await supabase.from("trial_reminder_log").insert({
      profile_id: profile.id,
      organization_id: org.id,
      reminder_day: reminderDay,
    });
    if (claimError) {
      skipped++;
      continue;
    }

    const daysLeft = reminderDay === 29 ? "tomorrow" : "in 5 days";
    const title = reminderDay === 29
      ? "Your free trial ends tomorrow"
      : "5 days left in your free trial";
    const message = `Your TidyWise trial ends ${daysLeft}. Pick a plan before then or the dashboard locks. Nothing is charged unless you add a card.`;

    const { error: notifError } = await supabase.from("admin_system_notifications").insert({
      organization_id: org.id,
      type: "trial_reminder",
      title,
      message,
      link: "/choose-plan?upgrade=1",
      dedupe_key: `trial_reminder_${reminderDay}_${profile.id}`,
    });
    if (notifError && !String(notifError.message).toLowerCase().includes("duplicate")) {
      console.error("[trial-reminder] notification insert failed", org.id, notifError);
    }

    let emailed = false;
    if (RESEND_API_KEY && profile.email) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "TidyWise <billing@jointidywise.com>",
          to: [profile.email],
          subject: title,
          ...renderCrmEmail(
            reminderDay === 29 ? "trial-reminder-day-29" : "trial-reminder-day-25",
            { vars: { APP_URL } },
          ),
        }),
      });
      emailed = response.ok;
      if (!response.ok) {
        console.error("[trial-reminder] resend error", response.status, await response.text());
      }
    }

    if (!emailed && profile.email && RESEND_API_KEY) {
      await supabase.from("trial_reminder_log").delete()
        .eq("profile_id", profile.id)
        .eq("reminder_day", reminderDay);
      skipped++;
      continue;
    }

    sent++;
  }

  return new Response(JSON.stringify({ sent, skipped, emailConfigured: Boolean(RESEND_API_KEY) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
