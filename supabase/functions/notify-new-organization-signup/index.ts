import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const ADMIN_PHONES = ["+15615718725", "+18137356859"];

function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // The organizations INSERT trigger is the only legitimate caller. It sends
  // x-cron-secret from vault (see notify_new_org_signup). No user JWT, and
  // the anon key must not be enough to read owner PII or text admin phones.
  const expectedSecret = Deno.env.get("CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  if (!expectedSecret || !providedSecret || !timingSafeEqualString(providedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { org_id, created_at } = await req.json();

    if (!org_id) {
      console.error("[notify-new-org] Missing org_id in payload");
      return new Response(
        JSON.stringify({ success: false, error: "Missing org_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch owner details from org_memberships
    const { data: membership } = await supabase
      .from("org_memberships")
      .select("user_id, role")
      .eq("organization_id", org_id)
      .eq("role", "owner")
      .maybeSingle();

    let ownerName = "Unknown";
    let ownerEmail = "N/A";
    let ownerPhone = "N/A";

    if (membership?.user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email, full_name, phone")
        .eq("id", membership.user_id)
        .maybeSingle();

      if (profile) {
        ownerName = profile.full_name?.trim() || "—";
        ownerEmail = profile.email || "N/A";
        ownerPhone = profile.phone || "N/A";
      }
    }

    // Get subscription plan. plan_type is the live column. The two columns this
    // previously selected do not exist on organizations, so the lookup silently
    // errored and every signup printed the constant "trial (trial)".

    const { data: orgData, error: orgError } = await supabase
      .from("organizations")
      .select("name, plan_type, owner_id")
      .eq("id", org_id)
      .maybeSingle();

    // Name comes from the row, not the request body, so the secret cannot
    // be used to put arbitrary text in the admin SMS.
    const org_name = orgData?.name || "Unnamed";
    console.log(`[notify-new-org] New org: ${org_name} (${org_id})`);

    if (orgError) {
      console.error("[notify-new-organization-signup] org lookup failed:", orgError);
    }

    let trialEndsAt: string | null = null;
    if (orgData?.owner_id) {
      const { data: ownerProfile, error: profileError } = await supabase
        .from("profiles")
        .select("trial_ends_at")
        .eq("id", orgData.owner_id)
        .maybeSingle();

      if (profileError) {
        console.error("[notify-new-organization-signup] profile lookup failed:", profileError);
      }

      trialEndsAt = ownerProfile?.trial_ends_at ?? null;
    }

    // No `|| "trial"` fallback. If the lookup failed we do not know the plan,
    // and saying "trial" would reproduce the exact bug being fixed: a
    // confident-looking constant standing in for a missing answer.
    const plan = orgData?.plan_type ?? "unknown";

    const trialLine = trialEndsAt
      ? `Trial ends: ${new Date(trialEndsAt).toISOString().slice(0, 10)}`
      : "Trial end: unknown";


    // Get total org count
    const { count: totalOrgs } = await supabase
      .from("organizations")
      .select("id", { count: "exact", head: true });

    // Get this month's org count
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: monthOrgs } = await supabase
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfMonth.toISOString());

    // Format time in EST
    const timestamp = new Date(created_at || Date.now()).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const message =
      `🎉 NEW ORG SIGNED UP!\n\n` +
      `Business: ${org_name || "Unnamed"}\n` +
      `Owner: ${ownerName}\n` +
      `Email: ${ownerEmail}\n` +
      `Phone: ${ownerPhone}\n` +
      `Plan: ${plan}\n${trialLine}\n` +
      `Time: ${timestamp} EST\n` +
      `Total Orgs: ${totalOrgs || 0}\n` +
      `This Month: ${monthOrgs || 0}\n\n` +
      `→ jointidywise.com/platform-analytics`;

    // Use TidyWise org's OpenPhone credentials from organization_sms_settings
    const TIDYWISE_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";
    const { data: smsSettings } = await supabase
      .from("organization_sms_settings")
      .select("openphone_api_key, openphone_phone_number_id")
      .eq("organization_id", TIDYWISE_ORG_ID)
      .maybeSingle();

    const openphoneApiKey = smsSettings?.openphone_api_key || Deno.env.get("OPENPHONE_API_KEY");
    const openphonePhoneNumberId = smsSettings?.openphone_phone_number_id || Deno.env.get("OPENPHONE_PHONE_NUMBER_ID");

    console.log(`[notify-new-org] API key source: ${smsSettings ? 'org_sms_settings' : 'env'}, present: ${!!openphoneApiKey}`);
    console.log(`[notify-new-org] Phone ID source: ${smsSettings ? 'org_sms_settings' : 'env'}, present: ${!!openphonePhoneNumberId}`);

    let smsSent = false;
    const smsResults: { phone: string; success: boolean; error?: string }[] = [];

    if (openphoneApiKey && openphonePhoneNumberId) {
      // Send individually to each admin phone to ensure delivery
      for (const phone of ADMIN_PHONES) {
        try {
          const smsRes = await fetch("https://api.openphone.com/v1/messages", {
            method: "POST",
            headers: {
              Authorization: openphoneApiKey.trim().replace(/^Bearer\s+/i, ''),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: openphonePhoneNumberId,
              to: [phone],
              content: message,
            }),
          });

          if (smsRes.ok) {
            smsSent = true;
            const smsResult = await smsRes.json();
            console.log(`[notify-new-org] SMS sent to ${phone}:`, smsResult?.data?.id);
            smsResults.push({ phone, success: true });
          } else {
            const errText = await smsRes.text();
            console.error(`[notify-new-org] SMS failed to ${phone}:`, smsRes.status, errText);
            smsResults.push({ phone, success: false, error: errText });
          }
        } catch (smsErr) {
          console.error(`[notify-new-org] SMS error to ${phone}:`, smsErr);
          smsResults.push({ phone, success: false, error: String(smsErr) });
        }
      }
    } else {
      console.error("[notify-new-org] OpenPhone not configured - missing PLATFORM_OPENPHONE_API_KEY or PLATFORM_OPENPHONE_PHONE_ID");
    }

    // Log to platform_notifications for each admin phone
    for (const phone of ADMIN_PHONES) {
      const result = smsResults.find(r => r.phone === phone);
      await supabase.from("platform_notifications").insert({
        org_id,
        notification_type: "new_org",
        sent_to: phone,
        message_preview: `${org_name || "Unnamed"} signed up`,
        metadata: {
          org_name: org_name || "Unnamed",
          owner_name: ownerName,
          owner_email: ownerEmail,
          owner_phone: ownerPhone,
          plan,
          trial_ends_at: trialEndsAt,
          sms_sent: result?.success ?? false,
          sms_error: result?.error || null,
          total_orgs: totalOrgs,
          month_orgs: monthOrgs,
        },
      });
    }

    return new Response(
      JSON.stringify({ success: true, sms_sent: smsSent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[notify-new-org] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
