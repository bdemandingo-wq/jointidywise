import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";

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
      biggestChallenge,
      bookedDate,
      bookedTime,
      timezone,
      // Legacy fields (kept for backward compatibility)
      preferredDays,
      preferredTime,
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

    // Get total demo count
    const { count: totalDemos } = await supabase
      .from("demo_bookings")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed");

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
      const firstName = fullName.split(" ")[0];
      const safeName = escapeHtml(fullName);
      const safeFirst = escapeHtml(firstName);
      const safeBusiness = escapeHtml(businessName);
      const safePhone = escapeHtml(phone);
      const safeEmail = escapeHtml(email);
      const safeTeam = escapeHtml(String(teamSize || "N/A"));
      const safeChallenge = escapeHtml(String(biggestChallenge || "N/A"));

      // Admin alert email — replaces the previous admin SMS. Sent BEFORE
      // the prospect confirmation so a Resend hiccup hits the lower-
      // priority message first if we're throttled.
      try {
        const adminAlertHtml = bookedDate && bookedTime
          ? `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
              <h2>📅 New demo BOOKED</h2>
              <p><strong>${safeName}</strong> — ${safeBusiness}</p>
              <p>📆 ${dateDisplay} at ${timeDisplay} EST</p>
              <p>📞 ${safePhone} • ✉️ <a href="mailto:${safeEmail}">${safeEmail}</a></p>
              <p>Team: ${safeTeam} • Challenge: ${safeChallenge}</p>
              <p style="color:#888;font-size:12px;">Total demos booked: ${totalDemos || 1}</p>
            </div>`
          : `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
              <h2>📅 New demo REQUEST</h2>
              <p><strong>${safeName}</strong> — ${safeBusiness}</p>
              <p>📞 ${safePhone} • ✉️ <a href="mailto:${safeEmail}">${safeEmail}</a></p>
              <p>Team: ${safeTeam} • Challenge: ${safeChallenge}</p>
              <p>Prefers: ${escapeHtml(preferredDays?.join(", ") || "Any")} ${escapeHtml(preferredTime || "")}</p>
              <p style="color:#b91c1c;">Reach out to confirm a time.</p>
            </div>`;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${emailSettings.resend_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${emailSettings.from_name || "TidyWise"} <${emailSettings.from_email || PLATFORM_SENDER_EMAIL}>`,
            to: [tidywiseSupportEmail()],
            reply_to: email,
            subject: bookedDate && bookedTime
              ? `📅 Demo booked: ${fullName} — ${dateDisplay}`
              : `📅 Demo request: ${fullName}`,
            html: adminAlertHtml,
          }),
        });
        console.log("[notify-demo-request] Admin email alert sent");
      } catch (adminErr) {
        console.error("[notify-demo-request] Admin email error:", adminErr);
      }

      const emailSubject = bookedDate && bookedTime
        ? `Your TidyWise Demo is Confirmed for ${dateDisplay} at ${timeDisplay} ✅`
        : "Your TidyWise Demo Request is Confirmed! 🎉";

      // "How" line + prominent join button flip to video when a link exists.
      const howLine = meetingLink
        ? `<strong>💻 How:</strong> <a href="${escapeHtml(meetingLink)}" style="color:#2563eb;">Join the video call</a> at your booked time`
        : `<strong>📞 How:</strong> Emmanuel will call you at ${safePhone}`;
      const joinButton = meetingLink
        ? `<div style="text-align:center;margin:24px 0;">
             <a href="${escapeHtml(meetingLink)}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">Join Video Call</a>
           </div>`
        : "";

      const emailHtml = bookedDate && bookedTime
        ? `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
          <h1 style="color: #1a1a1a; font-size: 24px;">Your Demo is Locked In! ✅</h1>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">Hi ${safeFirst}!</p>
          <div style="background: #f5f5f5; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <p style="margin: 5px 0; font-size: 16px;"><strong>📆 Date:</strong> ${dateDisplay}</p>
            <p style="margin: 5px 0; font-size: 16px;"><strong>⏰ Time:</strong> ${timeDisplay} EST</p>
            <p style="margin: 5px 0; font-size: 16px;">${howLine}</p>
          </div>
          ${joinButton}
          <h3 style="color: #1a1a1a; font-size: 18px;">What we'll cover:</h3>
          <ul style="color: #555; font-size: 16px; line-height: 2;">
            <li>Your specific business workflow</li>
            <li>Bookings and scheduling automation</li>
            <li>Client communication and payments</li>
            <li>Staff management and payroll</li>
            <li>Live Q&A — ask anything</li>
          </ul>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">While you wait, explore TidyWise:</p>
          <p style="font-size: 16px;">
            → <a href="https://jointidywise.com/pricing" style="color: #2563eb;">Pricing</a><br/>
            → <a href="https://jointidywise.com/#features" style="color: #2563eb;">Features</a>
          </p>
          <p style="color: #555; font-size: 16px; line-height: 1.6; margin-top: 20px;">
            Talk soon!<br/>
            <strong>Emmanuel Forkuoh</strong><br/>
            Founder, TidyWise<br/>
            📞 (561) 571-8725<br/>
            🌐 jointidywise.com
          </p>
        </div>`
        : `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
          <h1 style="color: #1a1a1a; font-size: 24px;">Your TidyWise Demo Request is Confirmed! 🎉</h1>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">Hi ${safeFirst}!</p>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Thanks for your interest in TidyWise! We received your demo request and Emmanuel will reach out to you at <strong>${safePhone}</strong> or <strong>${safeEmail}</strong> within 2 hours to confirm your demo time.
          </p>
          <h3 style="color: #1a1a1a; font-size: 18px;">Here's what to expect:</h3>
          <ul style="color: #555; font-size: 16px; line-height: 2;">
            <li>20-minute live walkthrough</li>
            <li>See your exact workflow automated</li>
            <li>Q&A — ask anything you want</li>
            <li>Get set up same day if you're ready</li>
          </ul>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Talk soon,<br/>
            <strong>Emmanuel Forkuoh</strong><br/>
            Founder, TidyWise<br/>
            📞 (561) 571-8725<br/>
            🌐 jointidywise.com
          </p>
        </div>`;

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${emailSettings.resend_api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${emailSettings.from_name || "TidyWise"} <${emailSettings.from_email || PLATFORM_SENDER_EMAIL}>`,
            to: [email],
            subject: emailSubject,
            html: emailHtml,
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
