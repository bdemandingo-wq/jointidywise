import { createClient } from "npm:@supabase/supabase-js@2";
import { platformAdminPhones } from "../_shared/platform-admin-phones.ts";
import { sendOpenPhoneMessage } from "../_shared/openphone-send.ts";

/**
 * Tells the founder that product feedback has arrived.
 *
 * The row is already written by the client under RLS (user_id pinned to
 * auth.uid()), so this function never accepts feedback content from the
 * request — only an id. Anything else would let a caller send an SMS saying
 * whatever it liked from an address that looks like TidyWise.
 *
 * Notification path is deliberately the same one notify-new-organization-signup
 * uses: TidyWise's own OpenPhone credentials out of organization_sms_settings,
 * to the same two admin phones, logged to platform_notifications. Nothing new
 * to configure, and it fails the same way the signup alert already does.
 *
 * Delivery failing must NOT fail the submission: the feedback is already
 * stored and readable at /dashboard/platform-feedback, so this returns 200 with
 * sms_sent:false rather than handing the sender an error for something that
 * already worked.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_PHONES = platformAdminPhones();
const TIDYWISE_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";

const TOPIC_LABEL: Record<string, string> = {
  broken: "Something's broken",
  suggestion: "A suggestion",
  like: "Something they like",
  dislike: "Something they don't like",
  other: "Other",
};

const SEVERITY_LABEL: Record<string, string> = {
  blocking: "BLOCKING",
  annoying: "Annoying",
  idea: "Just an idea",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // verify_jwt is false for Lovable-managed functions, so authenticate here.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ success: false, error: "unauthenticated" }, 401);

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ success: false, error: "unauthenticated" }, 401);
    }

    let body: { feedback_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "invalid_json" }, 400);
    }

    const feedbackId = typeof body.feedback_id === "string" ? body.feedback_id : "";
    if (!UUID_RE.test(feedbackId)) {
      return json({ success: false, error: "invalid_feedback_id" }, 400);
    }

    const { data: fb, error: fbErr } = await supabase
      .from("product_feedback")
      .select(
        "id, organization_id, user_id, topic, message, app_area, severity, sender_name, reply_email, created_at",
      )
      .eq("id", feedbackId)
      .maybeSingle();

    if (fbErr) {
      console.error("[notify-product-feedback] lookup failed:", fbErr);
      return json({ success: false, error: "lookup_failed" }, 500);
    }
    if (!fb) return json({ success: false, error: "not_found" }, 404);

    // Only the author may trigger the alert for their own row. Without this a
    // signed-in user could re-notify on someone else's feedback repeatedly.
    if (fb.user_id !== userData.user.id) {
      return json({ success: false, error: "forbidden" }, 403);
    }

    let orgName = "Unknown business";
    if (fb.organization_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", fb.organization_id)
        .maybeSingle();
      if (org?.name) orgName = org.name;
    }

    const senderEmail = userData.user.email || fb.reply_email || "N/A";
    const severityLine = fb.severity ? `Impact: ${SEVERITY_LABEL[fb.severity] ?? fb.severity}\n` : "";
    const areaLine = fb.app_area ? `Where: ${fb.app_area}\n` : "";
    const replyLine = fb.reply_email ? `Reply to: ${fb.reply_email}\n` : "";

    const timestamp = new Date(fb.created_at as string).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // SMS is a summary, not the record. The message is truncated because a long
    // one would silently split into several billed segments; the full text is
    // on the page the last line links to.
    const excerpt = String(fb.message).trim();
    const shortMessage = excerpt.length > 400 ? `${excerpt.slice(0, 397)}...` : excerpt;

    const message =
      `💬 NEW FEEDBACK\n\n` +
      `${TOPIC_LABEL[fb.topic] ?? fb.topic}\n` +
      `${severityLine}` +
      `From: ${fb.sender_name?.trim() || orgName}\n` +
      `Account: ${senderEmail}\n` +
      `${areaLine}${replyLine}` +
      `Time: ${timestamp} EST\n\n` +
      `"${shortMessage}"\n\n` +
      `→ jointidywise.com/dashboard/platform-feedback`;

    const { data: smsSettings } = await supabase
      .from("organization_sms_settings")
      .select("openphone_api_key, openphone_phone_number_id")
      .eq("organization_id", TIDYWISE_ORG_ID)
      .maybeSingle();

    const apiKey = smsSettings?.openphone_api_key || Deno.env.get("OPENPHONE_API_KEY");
    const phoneNumberId =
      smsSettings?.openphone_phone_number_id || Deno.env.get("OPENPHONE_PHONE_NUMBER_ID");

    let smsSent = false;
    const smsResults: { phone: string; success: boolean; error?: string }[] = [];

    if (apiKey && phoneNumberId) {
      for (const phone of ADMIN_PHONES) {
        try {
          const sent = await sendOpenPhoneMessage({
            supabase,
            organizationId: TIDYWISE_ORG_ID,
            to: phone,
            content: message,
            from: phoneNumberId,
            apiKey,
            tag: "notify-product-feedback",
          });
          if (sent.skipped) {
            smsResults.push({ phone, success: false, error: "opted_out" });
            continue;
          }
          const res = sent.response;

          if (res.ok) {
            smsSent = true;
            smsResults.push({ phone, success: true });
          } else {
            const errText = await res.text();
            console.error(`[notify-product-feedback] SMS failed to ${phone}:`, res.status, errText);
            smsResults.push({ phone, success: false, error: errText });
          }
        } catch (err) {
          console.error(`[notify-product-feedback] SMS error to ${phone}:`, err);
          smsResults.push({ phone, success: false, error: String(err) });
        }
      }
    } else {
      console.error("[notify-product-feedback] OpenPhone not configured for TidyWise org");
    }

    for (const phone of ADMIN_PHONES) {
      const result = smsResults.find((r) => r.phone === phone);
      await supabase.from("platform_notifications").insert({
        org_id: fb.organization_id,
        notification_type: "product_feedback",
        sent_to: phone,
        message_preview: `Feedback: ${TOPIC_LABEL[fb.topic] ?? fb.topic} — ${orgName}`,
        metadata: {
          feedback_id: fb.id,
          topic: fb.topic,
          severity: fb.severity,
          app_area: fb.app_area,
          org_name: orgName,
          sender_email: senderEmail,
          sms_sent: result?.success ?? false,
          sms_error: result?.error || null,
        },
      });
    }

    return json({ success: true, sms_sent: smsSent, sms_results: smsResults });
  } catch (err) {
    console.error("[notify-product-feedback] Error:", err);
    return json({ success: false, error: "internal_error" }, 500);
  }
});
