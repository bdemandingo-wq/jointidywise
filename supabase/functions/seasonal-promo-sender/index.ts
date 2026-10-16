// seasonal-promo-sender — fires 3 days before each major US holiday for every
// org that has the `seasonal_promo` automation enabled.
//
// Deduplication is per (org, customer, holiday-key) for 300 days via
// automation_fire_log so a second cron run on the same day is a no-op.
//
// Hard cap: 200 SMS per org per holiday firing to keep OpenPhone happy.

import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const FIRE_OFFSET_DAYS = 3; // days before holiday to fire
const PER_ORG_CAP = 200;
const DEDUPE_DAYS = 300;

interface Holiday {
  key: string;
  name: string;
  date: Date; // calendar date (UTC midnight)
}

// Anonymous Gregorian Computus — returns Easter Sunday for a given year.
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// nth occurrence of dayOfWeek in month. dayOfWeek: 0=Sun … 6=Sat.
function nthDayOfMonth(
  year: number,
  month1to12: number,
  dayOfWeek: number,
  n: number,
): Date {
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const offset = (dayOfWeek - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month1to12 - 1, 1 + offset + (n - 1) * 7));
}

function holidaysForYear(year: number): Holiday[] {
  return [
    { key: "valentines",   name: "Valentine's Day",  date: new Date(Date.UTC(year, 1, 14)) },
    { key: "easter",       name: "Easter",           date: computeEaster(year) },
    { key: "mothers_day",  name: "Mother's Day",     date: nthDayOfMonth(year, 5, 0, 2) },
    { key: "fathers_day",  name: "Father's Day",     date: nthDayOfMonth(year, 6, 0, 3) },
    { key: "independence", name: "Independence Day", date: new Date(Date.UTC(year, 6, 4)) },
    { key: "halloween",    name: "Halloween",        date: new Date(Date.UTC(year, 9, 31)) },
    { key: "thanksgiving", name: "Thanksgiving",     date: nthDayOfMonth(year, 11, 4, 4) },
    { key: "christmas",    name: "Christmas",        date: new Date(Date.UTC(year, 11, 25)) },
    { key: "new_years_eve", name: "New Year's Eve",  date: new Date(Date.UTC(year, 11, 31)) },
  ];
}

// Returns the first holiday whose date matches today + FIRE_OFFSET_DAYS, or null.
function findTargetHoliday(now: Date): Holiday | null {
  const target = new Date(now.getTime() + FIRE_OFFSET_DAYS * 86_400_000);
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const targetDay = target.getUTCDate();

  // Check this year + next year so we cover the New Year's-Eve-into-January boundary.
  const candidates = [...holidaysForYear(targetYear), ...holidaysForYear(targetYear + 1)];
  return candidates.find(
    (h) =>
      h.date.getUTCFullYear() === targetYear &&
      h.date.getUTCMonth() === targetMonth &&
      h.date.getUTCDate() === targetDay,
  ) ?? null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing Supabase configuration" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const holiday = findTargetHoliday(new Date());
  if (!holiday) {
    console.log("[seasonal-promo-sender] No holiday matches today + 3 days. Exiting.");
    return new Response(
      JSON.stringify({ success: true, holiday: null, summary: { orgs: 0, sent: 0 } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log(
    `[seasonal-promo-sender] Target holiday: ${holiday.name} (${holiday.key})`,
  );

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: enabledOrgs, error: orgsErr } = await supabase
    .from("organization_automations")
    .select("organization_id, settings")
    .eq("automation_type", "seasonal_promo")
    .eq("is_enabled", true);
  if (orgsErr) {
    console.error("[seasonal-promo-sender] Failed to load enabled orgs:", orgsErr);
    return new Response(
      JSON.stringify({ success: false, error: orgsErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const summary = { orgs: 0, sent: 0, skipped: 0, errors: 0 };
  const cutoff = new Date(Date.now() - DEDUPE_DAYS * 86_400_000).toISOString();

  for (const row of enabledOrgs ?? []) {
    const orgId = row.organization_id as string;
    // Owner-reworded copy, or null for the shipped default. Read from the row
    // we already loaded — no extra query per org.
    const customTemplate =
      ((row as { settings?: { templates?: Record<string, string> } | null }).settings
        ?.templates?.seasonal_promo) ?? null;
    summary.orgs += 1;
    try {
      const { data: orgRow, error: orgErr } = await supabase
        .from("organizations")
        .select("id, name, slug")
        .eq("id", orgId)
        .maybeSingle();
      if (orgErr) {
        console.error(
          `[seasonal-promo-sender] org=${orgId} table=organizations select failed, falling back: ${orgErr.message}`,
        );
      }
      const orgName = orgRow?.name ?? "Your cleaning team";
      const orgSlug = (orgRow as { slug?: string } | null)?.slug ?? "";

      const { data: bsRow, error: bsErr } = await supabase
        .from("business_settings")
        .select("company_name")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (bsErr) {
        console.error(
          `[seasonal-promo-sender] org=${orgId} table=business_settings select failed, falling back to organization name: ${bsErr.message}`,
        );
      }
      const companyName = (bsRow as { company_name?: string } | null)?.company_name ?? orgName;

      const appUrl = (Deno.env.get("APP_URL") || "https://jointidywise.com").replace(/\/+$/, "");
      const bookingLink = orgSlug ? `${appUrl}/book/${orgSlug}` : `${appUrl}/book`;

      // Customers: respect marketing_status opt-out, must have a phone, capped 200.
      const { data: customers } = await supabase
        .from("customers")
        .select("id, first_name, phone, marketing_status, created_at")
        .eq("organization_id", orgId)
        .neq("marketing_status", "opted_out")
        .not("phone", "is", null)
        .order("created_at", { ascending: false })
        .limit(PER_ORG_CAP + 50); // overshoot a bit so dedupe doesn't starve us

      const eligible = (customers ?? []).filter((c) => !!c.phone);
      if (eligible.length > PER_ORG_CAP) {
        console.warn(
          `[seasonal-promo-sender] Org ${orgId} has more than ${PER_ORG_CAP} customers; processing first ${PER_ORG_CAP}.`,
        );
      }

      let sentForThisOrg = 0;
      for (const c of eligible) {
        if (sentForThisOrg >= PER_ORG_CAP) break;

        // Dedupe by (org, customer, holiday key) within DEDUPE_DAYS.
        const { data: prior, error: dedupeErr } = await supabase
          .from("automation_fire_log")
          .select("id")
          .eq("organization_id", orgId)
          .eq("automation_type", "seasonal_promo")
          .eq("target_id", c.id)
          .eq("metadata->>holiday", holiday.key)
          .gte("fired_at", cutoff)
          .limit(1);
        if (dedupeErr) {
          summary.errors += 1;
          console.error(
            `[seasonal-promo-sender] dedupe check failed org=${orgId} customer=${c.id}, skipping to avoid a possible duplicate send:`,
            dedupeErr,
          );
          continue;
        }
        if (prior && prior.length > 0) {
          summary.skipped += 1;
          continue;
        }

        // The default no longer carries its own "Reply STOP" sentence: this
        // key is marketing, so the sender appends it. withStopSentence is
        // idempotent, so an owner who writes their own does not get two.
        const resolved = resolveTemplate("seasonal_promo", customTemplate, {
          company_name: companyName,
          holiday_name: holiday.name,
          booking_link: bookingLink,
        });
        if (resolved.warning) {
          console.warn(`[seasonal-promo-sender] org=${orgId}: ${resolved.warning}`);
        }
        const message =
          AUTOMATION_DEFAULTS.seasonal_promo.message_class === "marketing"
            ? withStopSentence(resolved.text)
            : resolved.text;

        try {
          const res = await fetch(
            `${SUPABASE_URL}/functions/v1/send-openphone-sms`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                to: c.phone,
                message,
                organizationId: orgId,
              }),
            },
          );
          const result = await res.json() as { success?: boolean; error?: string; skipped?: boolean; reason?: string };
          if (result.skipped) {
            summary.skipped += 1;
            console.log(`[seasonal-promo-sender] SMS skipped opted_out org=${orgId} customer=${c.id}`);
            continue;
          }
          if (!result.success) {
            console.warn(
              `[seasonal-promo-sender] SMS failed org=${orgId} customer=${c.id}: ${result.error}`,
            );
            summary.errors += 1;
            continue;
          }
          sentForThisOrg += 1;
          summary.sent += 1;

          const { error: logErr } = await supabase.from("automation_fire_log").insert({
            organization_id: orgId,
            automation_type: "seasonal_promo",
            target_id: c.id,
            metadata: {
              holiday: holiday.key,
              holiday_name: holiday.name,
              sent_at: new Date().toISOString(),
            },
          });
          if (logErr) {
            console.error(
              `[seasonal-promo-sender] SMS sent but fire-log insert failed org=${orgId} customer=${c.id} — dedupe will not catch this next run:`,
              logErr,
            );
          }
        } catch (smsErr) {
          summary.errors += 1;
          console.error(
            `[seasonal-promo-sender] SMS error org=${orgId} customer=${c.id}:`,
            smsErr,
          );
        }
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`[seasonal-promo-sender] Org ${orgId} threw:`, err);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      holiday: { key: holiday.key, name: holiday.name, date: holiday.date.toISOString() },
      summary,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
