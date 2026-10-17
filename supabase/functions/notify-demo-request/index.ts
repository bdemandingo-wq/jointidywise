import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      fullName,
      email,
      phone,
      businessName,
      teamSize,
      bookedDate,
      bookedTime,
    } = await req.json();

    if (!fullName || !email || !phone || !businessName) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const TIDYWISE_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";
    // ADMIN_PHONES removed — admin alerts are now email-only.

    // Format date/time for display
    let dateDisplay = "";
    let timeDisplay = "";
    if (bookedDate && bookedTime) {
      const [year, month, day] = bookedDate.split("-");
      const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      dateDisplay = `${days[dateObj.getDay()]}, ${months[dateObj.getMonth()]} ${parseInt(day)}, ${year}`;
      
      const [h, m] = bookedTime.split(":").map(Number);
      const period = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      timeDisplay = `${h12}:${m.toString().padStart(2, "0")} ${period}`;
    }

    // Platform-wide default demo meeting link (service role bypasses the
    // admin-only read policy). At booking time a demo's link always equals
    // this default; per-demo overrides are a later admin action.
    const { data: linkSetting } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "demo_default_meeting_link")
      .maybeSingle();
    const meetingLink =
      ((linkSetting?.value as { url?: string } | null)?.url || "").trim();

    // SMS removed for cost control — see admin email below for the
    // alert, and the prospect confirmation email further down for the
    // booking acknowledgment.

    // 2. Send confirmation email to prospect via Resend
    const { data: emailSettings } = await supabase
      .from("organization_email_settings")
      .select("resend_api_key, from_email, from_name")
      .eq("organization_id", TIDYWISE_ORG_ID)
      .maybeSingle();

    if (emailSettings?.resend_api_key) {
      const supportMailbox = tidywiseSupportEmail();
      const from = `${emailSettings.from_name || "TidyWise"} <${emailSettings.from_email || PLATFORM_SENDER_EMAIL}>`;
      const prospectPhone = String(phone);
      const teamLabel = teamSize === undefined || teamSize === null || String(teamSize).trim() === ""
        ? "—"
        : String(teamSize);
      // Button href must be a real URL. Phone demos have no meeting link,
      // so the button falls back to the support mailbox already used here.
      const meetingHref = meetingLink || `mailto:${supportMailbox}`;
      const booked = Boolean(bookedDate && bookedTime);

      // Admin alert email — replaces the previous admin SMS. Sent BEFORE
      // the prospect confirmation so a Resend hiccup hits the lower-
      // priority message first if we're throttled.
      try {
        const adminMail = booked
          ? renderCrmEmail("internal-demo-booked", {
            vars: {
              fullName,
              dateDisplay,
              timeDisplay,
              email,
              prospectPhone,
              businessName,
              teamSize: teamLabel,
              meetingLink: meetingHref,
            },
          })
          : renderCrmEmail("internal-demo-request", {
            vars: {
              fullName,
              email,
              prospectPhone,
              businessName,
              teamSize: teamLabel,
            },
          });
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${emailSettings.resend_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [supportMailbox],
            reply_to: email,
            subject: booked
              ? `📅 Demo booked: ${fullName} — ${dateDisplay}`
              : `📅 Demo request: ${fullName}`,
            html: adminMail.html,
            text: adminMail.text,
          }),
        });
        console.log("[notify-demo-request] Admin email alert sent");
      } catch (adminErr) {
        console.error("[notify-demo-request] Admin email error:", adminErr);
      }

      const emailSubject = booked
        ? `Your TidyWise Demo is Confirmed for ${dateDisplay} at ${timeDisplay} ✅`
        : "Your TidyWise Demo Request is Confirmed! 🎉";

      // Phone demos have no video link. Tell the prospect Emmanuel will
      // call their number. howDetail is inserted as HTML.
      const howDetail = meetingLink
        ? "The meeting link is the button below. Join the video call at your booked time."
        : `Emmanuel will call you at ${escapeHtml(prospectPhone)}`;

      const prospectMail = booked
        ? renderCrmEmail("demo-confirmed", {
          vars: {
            dateDisplay,
            timeDisplay,
            fullName,
            howDetail,
            meetingLink: meetingHref,
          },
          rawKeys: ["howDetail"],
        })
        : renderCrmEmail("demo-request", {
          vars: { fullName },
        });

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${emailSettings.resend_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [email],
            subject: emailSubject,
            html: prospectMail.html,
            text: prospectMail.text,
          }),
        });
        console.log("[notify-demo-request] Confirmation email sent to", email);
      } catch (emailErr) {
        console.error("[notify-demo-request] Email error:", emailErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[notify-demo-request] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
