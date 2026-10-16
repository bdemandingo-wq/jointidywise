// Fires on every new lead. Two jobs, in this order:
//   1. Dispatch lead.created to Zapier/GHL — closing the gap where only the
//      frontend's manual create-lead mutation ever fired it, so Facebook,
//      chatbot and booking-form leads silently reached no integration.
//   2. Send the speed-to-lead SMS, if that automation is enabled for the org.
//
// Invoked by trg_notify_new_lead on public.leads via pg_net. That trigger
// carries `WHEN (new.backfilled_at IS NULL)`, so historical imports never reach
// here — but step 3 below re-checks anyway, because this function is also
// callable directly with the secret and a manual call bypasses the trigger.
//
// Task S1b/S3 of docs/superpowers/plans/2026-08-12-speed-to-lead.md
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { isPhoneOptedOut } from "../_shared/marketing-guard.ts";
import { sendOpenPhoneMessage } from "../_shared/openphone-send.ts";
import { phoneMatchKey, toE164 } from "../_shared/phone.ts";
import { greetingNameFromLead } from "../_shared/facebook-lead-mapping.ts";
import {
  resolveTemplate,
  withStopSentence,
  AUTOMATION_DEFAULTS,
} from "../_shared/automation-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const AUTOMATION_KEY = "facebook_lead_speed_to_lead" as const;

type Outcome =
  | "sent"
  | "already_handled"
  | "skipped_backfilled"
  | "skipped_internal_source"
  | "skipped_automation_off"
  | "skipped_no_phone"
  | "skipped_unusable_phone"
  | "skipped_opted_out"
  | "skipped_duplicate_phone"
  | "skipped_sms_not_configured"
  | "failed";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const gate = requireCronSecret(req);
  if (gate) return gate;

  let body: { lead_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  if (!leadId) return json({ error: "lead_id is required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 2. Load the lead ──
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, name, phone, source, organization_id, backfilled_at")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr) return json({ error: `lead lookup failed: ${leadErr.message}` }, 500);
  if (!lead) return json({ error: `lead ${leadId} not found` }, 404);

  const organizationId = lead.organization_id as string | null;
  if (!organizationId) return json({ error: `lead ${leadId} has no organization_id` }, 400);

  // ── 3. Belt and braces on the backfill guard ──
  // The trigger's WHEN clause should make this unreachable. It is here because a
  // direct call with the secret bypasses the trigger entirely, and texting
  // someone about a July enquiry is the mistake this whole feature must not make.
  if (lead.backfilled_at) {
    console.log(`[notify-new-lead] lead ${leadId} is backfilled, no outbound action`);
    return json({ outcome: "skipped_backfilled" satisfies Outcome, lead_id: leadId });
  }

  // ── 3b. Only INBOUND enquiries get the speed-to-lead text ──
  // Creating a customer (e.g. from the New Booking form) auto-creates a lead
  // row with source 'customer_import'. That is a record-keeping row, not a new
  // enquiry, and texting "I saw your request come in" to someone who just got
  // a booking confirmation is wrong. Same for leads staff type in by hand.
  const INTERNAL_SOURCES = new Set(["customer_import", "manual", "admin", "import"]);
  const leadSource = typeof lead.source === "string" ? lead.source.trim().toLowerCase() : "";
  if (INTERNAL_SOURCES.has(leadSource)) {
    console.log(`[notify-new-lead] lead ${leadId} source '${leadSource}' is internal, no SMS`);
    return json({ outcome: "skipped_internal_source" satisfies Outcome, lead_id: leadId });
  }



  // ── 4. Dispatch lead.created, regardless of the SMS automation ──
  // Deliberately before the SMS and deliberately non-fatal: an integration
  // failure must not cost the customer their text.
  let dispatched = false;
  try {
    const { error: dispatchErr } = await supabase.functions.invoke("zapier-dispatch", {
      body: { event: "lead.created", organizationId, payload: lead },
    });
    if (dispatchErr) {
      console.error(`[notify-new-lead] lead.created dispatch failed:`, dispatchErr);
    } else {
      dispatched = true;
    }
  } catch (err) {
    console.error(`[notify-new-lead] lead.created dispatch threw:`, err);
  }

  const done = (outcome: Outcome, extra: Record<string, unknown> = {}) =>
    json({ outcome, lead_id: leadId, organization_id: organizationId, dispatched, ...extra });

  // ── 5. Is the automation on for this org? ──
  const { data: automation, error: autoErr } = await supabase
    .from("organization_automations")
    .select("is_enabled, settings")
    .eq("organization_id", organizationId)
    .eq("automation_type", AUTOMATION_KEY)
    .maybeSingle();

  if (autoErr) {
    console.error(`[notify-new-lead] automation lookup failed:`, autoErr);
    return done("failed", { reason: autoErr.message });
  }
  if (!automation?.is_enabled) {
    return done("skipped_automation_off");
  }

  // ── 6. A text needs a number ──
  const phone = typeof lead.phone === "string" ? lead.phone.trim() : "";
  if (!phone) {
    await supabase.from("lead_notification_sends").insert({
      lead_id: leadId,
      organization_id: organizationId,
      status: "skipped",
      skip_reason: "no_phone",
      completed_at: new Date().toISOString(),
    });
    return done("skipped_no_phone");
  }

  // ── 6b. And a USABLE number ──
  // toE164 returns null rather than a best effort, so a 9-digit number no
  // longer reaches OpenPhone as "+405252227". phoneMatchKey is the dedupe key:
  // the last 10 digits, so "+1 813…", "813…" and "1813…" are one person.
  const matchKey = phoneMatchKey(phone);
  const toPhone = toE164(phone);
  if (!matchKey || !toPhone) {
    console.error(`[notify-new-lead] lead ${leadId} has an unusable phone, not sending`);
    await supabase.from("lead_notification_sends").insert({
      lead_id: leadId,
      organization_id: organizationId,
      status: "skipped",
      skip_reason: "unusable_phone",
      completed_at: new Date().toISOString(),
    });
    return done("skipped_unusable_phone");
  }

  // ── 7. Consent. Fails closed: any lookup error returns true. ──
  // isPhoneOptedOut rather than isOptedOut because a lead has no customers row,
  // so marketing_status is not reachable by customer id.
  if (await isPhoneOptedOut(supabase, organizationId, phone)) {
    await supabase.from("lead_notification_sends").insert({
      lead_id: leadId,
      organization_id: organizationId,
      status: "skipped",
      skip_reason: "opted_out",
      completed_at: new Date().toISOString(),
    });
    return done("skipped_opted_out");
  }

  // ── 7b. Have we already texted this NUMBER for this org? ──
  // The claim in step 9 is keyed on lead_id, so it cannot see the same person
  // arriving twice under two lead rows — Facebook plus the booking form, or two
  // Facebook submissions. This is that check, keyed on the phone instead.
  //
  // Both lead rows are KEPT. Both are real. Only the second text is suppressed.
  //
  // Only sending/sent/failed suppress. A `skipped` row means no message went
  // out, so it must not block a later genuine send. `failed` DOES suppress, for
  // the same reason step 12 refuses to release its claim: OpenPhone may have
  // accepted the message before the response failed.
  //
  // Fails CLOSED. A lookup error skips the send, because a duplicate text to a
  // real person is worse than a missed one — the same trade-off step 12 already
  // makes. The two cases get different skip_reasons so they stay tellable apart.
  const dedupeHours =
    Number(
      (automation.settings as { speed_to_lead_dedupe_hours?: unknown } | null)
        ?.speed_to_lead_dedupe_hours,
    ) || 24;
  const since = new Date(Date.now() - dedupeHours * 3600_000).toISOString();

  const { data: recent, error: recentErr } = await supabase
    .from("lead_notification_sends")
    .select("lead_id")
    .eq("organization_id", organizationId)
    .eq("phone_key", matchKey)
    .in("status", ["sending", "sent", "failed"])
    .gte("claimed_at", since)
    .limit(1)
    .maybeSingle();

  if (recentErr || recent) {
    if (recentErr) {
      console.error(`[notify-new-lead] dedupe lookup failed, failing closed:`, recentErr);
    } else {
      console.log(
        `[notify-new-lead] lead ${leadId} shares a phone with lead ${recent?.lead_id} texted within ${dedupeHours}h, not re-sending`,
      );
    }
    await supabase.from("lead_notification_sends").insert({
      lead_id: leadId,
      organization_id: organizationId,
      status: "skipped",
      skip_reason: recentErr ? "dedupe_lookup_failed" : "duplicate_phone_recent",
      phone_key: matchKey,
      completed_at: new Date().toISOString(),
    });
    return done("skipped_duplicate_phone", {
      duplicate_of_lead_id: recent?.lead_id ?? null,
      dedupe_hours: dedupeHours,
    });
  }

  // ── 8. SMS transport configured? ──
  const { data: smsSettings } = await supabase
    .from("organization_sms_settings")
    .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (
    !smsSettings?.sms_enabled ||
    !smsSettings.openphone_api_key ||
    !smsSettings.openphone_phone_number_id
  ) {
    return done("skipped_sms_not_configured");
  }

  // ── 9. Claim BEFORE sending ──
  // lead_id is the PK, so a concurrent or repeat invocation loses the race
  // atomically. Claiming after the send is how campaign_sms_sends ended up
  // texting someone twice: it hit 23505 once the SMS was already delivered,
  // left no dedupe row, and the customer stayed eligible.
  const { error: claimErr } = await supabase
    .from("lead_notification_sends")
    .insert({ lead_id: leadId, organization_id: organizationId, status: "sending", phone_key: matchKey });

  if (claimErr) {
    if (claimErr.code === "23505") {
      console.log(`[notify-new-lead] lead ${leadId} already handled, not re-sending`);
      return done("already_handled");
    }
    console.error(`[notify-new-lead] claim failed:`, claimErr);
    return done("failed", { reason: claimErr.message });
  }

  // ── 10. Copy: org override, else the shipped default ──
  const { data: businessSettings } = await supabase
    .from("business_settings")
    .select("company_name")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const savedTemplate =
    ((automation.settings as { templates?: Record<string, string> } | null)
      ?.templates?.[AUTOMATION_KEY]) ?? null;

  const resolved = resolveTemplate(AUTOMATION_KEY, savedTemplate, {
    // greetingNameFromLead, not `name.split(' ')[0] || 'there'`: a nameless lead
    // is stored as "Facebook Lead", whose first word is the non-empty
    // "Facebook", so a bare fallback would send "Hey Facebook,".
    first_name: greetingNameFromLead(lead.name as string | null),
    company_name: businessSettings?.company_name || "us",
  });
  if (resolved.warning) {
    console.warn(`[notify-new-lead] org=${organizationId}: ${resolved.warning}`);
  }

  // ── 11. Marketing class, so the opt-out line is appended here ──
  // Appended at send time rather than baked into the body, so an owner
  // rewording their copy in the Automation Center cannot drop it.
  const messageText =
    AUTOMATION_DEFAULTS[AUTOMATION_KEY].message_class === "marketing"
      ? withStopSentence(resolved.text)
      : resolved.text;

  // ── 12. Send ──
  // toPhone was resolved in step 6b by toE164, which returns null rather than a
  // malformed address, so there is nothing to format here.

  try {
    const sent = await sendOpenPhoneMessage({
      supabase,
      organizationId,
      to: toPhone,
      content: messageText,
      from: smsSettings.openphone_phone_number_id,
      apiKey: smsSettings.openphone_api_key,
      tag: "notify-new-lead",
    });
    if (sent.skipped) {
      await supabase
        .from("lead_notification_sends")
        .update({
          status: "skipped",
          skip_reason: "opted_out",
          completed_at: new Date().toISOString(),
        })
        .eq("lead_id", leadId);
      return done("skipped_opted_out");
    }
    const res = sent.response;

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[notify-new-lead] SMS failed for lead ${leadId}: ${res.status} ${detail}`);
      // The claim is NOT released. Deliberately the opposite of the backfill's
      // decision: OpenPhone may have accepted the message before the response
      // failed, and a duplicate text to a real person is worse than a missed
      // one. The failed row stays visible for an operator to act on.
      await supabase
        .from("lead_notification_sends")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("lead_id", leadId);
      return done("failed", { reason: `openphone ${res.status}` });
    }
  } catch (err) {
    console.error(`[notify-new-lead] SMS threw for lead ${leadId}:`, err);
    await supabase
      .from("lead_notification_sends")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("lead_id", leadId);
    return done("failed", { reason: String(err instanceof Error ? err.message : err) });
  }

  // ── 13. Record success, and log the fire for the Automation Center ──
  await supabase
    .from("lead_notification_sends")
    .update({ status: "sent", completed_at: new Date().toISOString() })
    .eq("lead_id", leadId);

  // automation_fire_log's invariant is that a row means success — which is why
  // the claim lives in its own table rather than here. Written only now.
  await supabase.from("automation_fire_log").insert({
    organization_id: organizationId,
    automation_type: AUTOMATION_KEY,
    target_id: leadId,
    metadata: { source: lead.source ?? null },
  });

  console.log(`[notify-new-lead] sent speed-to-lead SMS for lead ${leadId} org=${organizationId}`);
  return done("sent");
});
