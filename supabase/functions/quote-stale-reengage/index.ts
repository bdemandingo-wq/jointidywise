// quote-stale-reengage — daily SMS follow-up for quotes that have been sitting
// in 'sent' status for 3-4 days without conversion.
//
// The 3-4 day window is intentional: it fires earlier than
// quote-expiry-reminder (which fires 24h before valid_until), so a customer
// gets one nudge mid-life and another right before expiry.
//
// Hard cap: 50 quotes per org per run.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";
import { isOptedOut, isPhoneOptedOut } from "../_shared/marketing-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const PER_ORG_CAP = 50;
const QUOTE_LINK_BASE = "https://app.jointidywise.com/quote";

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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: enabledOrgs } = await supabase
    .from("organization_automations")
    .select("organization_id")
    .eq("automation_type", "quote_stale_reengage")
    .eq("is_enabled", true);

  // Quotes whose created_at is between 3 and 4 days ago.
  const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

  const summary = { orgs: 0, sent: 0, skipped: 0, errors: 0 };

  for (const row of enabledOrgs ?? []) {
    const orgId = row.organization_id as string;
    summary.orgs += 1;

    try {
      const { data: staleQuotes } = await supabase
        .from("quotes")
        .select(
          "id, customer_id, service_id, total_amount, organization_id, customer:customers(first_name, phone), service:services(name)",
        )
        .eq("organization_id", orgId)
        .eq("status", "sent")
        .gte("created_at", fourDaysAgo)
        .lte("created_at", threeDaysAgo)
        .limit(PER_ORG_CAP);

      if (!staleQuotes || staleQuotes.length === 0) continue;

      const { data: bs } = await supabase
        .from("business_settings")
        .select("company_name")
        .eq("organization_id", orgId)
        .maybeSingle();
      const companyName = (bs as { company_name?: string } | null)?.company_name ??
        "Our team";

      // ── template lookup ──────────────────────────────────────────────
      // One join, once per org — hoisted above the per-quote loop.
      // A missing definition, a missing step, or a query error ALL leave
      // templateBody null, which resolveTemplate turns into the seeded
      // default. There is deliberately no path here that skips a customer:
      // a lookup failure degrades to stock wording, never to silence.
      let templateBody: string | null = null;
      {
        const { data: def, error: defErr } = await supabase
          .from("automation_definitions")
          .select("id, enabled")
          .eq("organization_id", orgId)
          .eq("automation_key", "quote_stale_reengage")
          .maybeSingle();

        if (defErr) {
          console.warn(
            `[quote-stale-reengage] template lookup failed org=${orgId}, using default:`,
            defErr,
          );
        } else if (def && def.enabled !== false) {
          const { data: step, error: stepErr } = await supabase
            .from("automation_steps")
            .select("sms_body")
            .eq("automation_id", def.id)
            .in("channel", ["sms", "both"])
            .eq("recipient_client", true)
            .order("position", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (stepErr) {
            console.warn(
              `[quote-stale-reengage] step lookup failed org=${orgId}, using default:`,
              stepErr,
            );
          } else {
            templateBody = step?.sms_body ?? null;
          }
        }
      }

      for (const q of staleQuotes) {
        const quote = q as unknown as {
          id: string;
          customer_id: string | null;
          customer: { first_name: string | null; phone: string | null } | null;
          service: { name: string | null } | null;
        };

        if (!quote.customer?.phone) {
          summary.skipped += 1;
          continue;
        }

        // Already nudged this quote? (target_id = quote.id)
        const { data: prior, error: dedupeErr } = await supabase
          .from("automation_fire_log")
          .select("id")
          .eq("organization_id", orgId)
          .eq("automation_type", "quote_stale_reengage")
          .eq("target_id", quote.id)
          .limit(1);
        if (dedupeErr) {
          // Can't confirm this wasn't already sent — fail closed rather
          // than risk a duplicate SMS to a real customer.
          summary.errors += 1;
          console.error(
            `[quote-stale-reengage] dedupe check failed org=${orgId} quote=${quote.id}, skipping to avoid a possible duplicate send:`,
            dedupeErr,
          );
          continue;
        }
        if (prior && prior.length > 0) {
          summary.skipped += 1;
          continue;
        }

        const customerName = quote.customer.first_name ?? "there";
        const serviceName = quote.service?.name ?? "cleaning service";
        const quoteLink = `${QUOTE_LINK_BASE}/${quote.id}`;

        // ── opt-out check — a quote nudge is classed marketing, so someone
        // who has opted out must not receive it however the copy is worded.
        // Argument order is (supabase, organizationId, customerId) — org FIRST.
        // Both are strings, so reversing them type-checks and then fails CLOSED,
        // muting the whole automation. If a run reports zero sends, check here.
        if (quote.customer_id) {
          if (await isOptedOut(supabase, orgId, quote.customer_id)) {
            summary.skipped += 1;
            continue;
          }
        } else if (await isPhoneOptedOut(supabase, orgId, quote.customer.phone)) {
          summary.skipped += 1;
          continue;
        }

        // ── resolve ──────────────────────────────────────────────────────
        const resolved = resolveTemplate("quote_stale_reengage", templateBody, {
          customer_name: customerName,
          service_name: serviceName,
          company_name: companyName,
          quote_link: quoteLink,
        });
        if (resolved.warning) {
          console.warn(
            `[quote-stale-reengage] org=${orgId} quote=${quote.id}: ${resolved.warning}`,
          );
        }

        // ── STOP line — appended by code, never part of the editable body ──
        // withStopSentence is idempotent, so an owner who types their own STOP
        // sentence does not get two.
        const message =
          AUTOMATION_DEFAULTS.quote_stale_reengage.message_class === "marketing"
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
                to: quote.customer.phone,
                message,
                organizationId: orgId,
              }),
            },
          );
          const result = await res.json() as { success?: boolean; error?: string; skipped?: boolean };
          if (result.skipped) {
            summary.skipped += 1;
            console.log(`[quote-stale-reengage] SMS skipped opted_out org=${orgId} quote=${quote.id}`);
            continue;
          }
          if (!result.success) {
            summary.errors += 1;
            console.warn(
              `[quote-stale-reengage] SMS failed org=${orgId} quote=${quote.id}: ${result.error}`,
            );
            continue;
          }
          summary.sent += 1;
          const { error: logErr } = await supabase.from("automation_fire_log").insert({
            organization_id: orgId,
            automation_type: "quote_stale_reengage",
            target_id: quote.id,
            metadata: {
              customer_name: customerName,
              service_name: serviceName,
              used_default: resolved.usedDefault,
              template_warning: resolved.warning,
              sent_at: new Date().toISOString(),
            },
          });
          if (logErr) {
            // The SMS already went out — this only breaks dedupe for next
            // run, not the send itself. Log loudly since a silent failure
            // here is exactly what let this quote get re-sent forever.
            console.error(
              `[quote-stale-reengage] SMS sent but fire-log insert failed org=${orgId} quote=${quote.id} — dedupe will not catch this next run:`,
              logErr,
            );
          }
        } catch (smsErr) {
          summary.errors += 1;
          console.error(
            `[quote-stale-reengage] SMS error org=${orgId} quote=${quote.id}:`,
            smsErr,
          );
        }
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`[quote-stale-reengage] Org ${orgId} threw:`, err);
    }
  }

  return new Response(
    JSON.stringify({ success: true, summary }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
