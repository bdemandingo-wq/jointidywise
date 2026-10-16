import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCallerOrg } from "../_shared/require-caller-org.ts";
import { sendOpenPhoneMessage } from "../_shared/openphone-send.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotifyCleanersRequest {
  jobDetails: {
    booking_id: string;
    booking_number: number;
    service_name: string;
    scheduled_date: string;
    scheduled_time: string;
    address: string;
    square_footage: string;
    duration: number;
    total_amount: number;
  };
  companyName: string;
  organizationId: string;
  staffIds?: string[]; // Optional filter — if provided, only notify these staff
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { jobDetails, companyName: providedCompanyName, staffIds, organizationId: requestedOrgId }: NotifyCleanersRequest = await req.json();

    // SECURITY: never trust organizationId from the request body — resolve it
    // from the caller's own JWT + org_memberships instead.
    const callerOrg = await resolveCallerOrg(req, requestedOrgId ?? null);
    if (!callerOrg.ok) {
      return new Response(
        JSON.stringify({ error: callerOrg.error }),
        { status: callerOrg.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const organizationId = callerOrg.ctx.organizationId;

    console.log(`Notifying cleaners for org ${organizationId} about job #${jobDetails.booking_number}`);

    // Fetch org-specific OpenPhone settings from the correct table
    const { data: phoneSettings } = await supabase
      .from("organization_sms_settings")
      .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!phoneSettings?.sms_enabled) {
      console.log("SMS disabled for this org — skipping SMS, in-app notifications still created");
    }

    const orgOpenPhoneApiKey = phoneSettings?.openphone_api_key;
    const orgPhoneNumberId = phoneSettings?.openphone_phone_number_id;

    // Get company name from business settings
    let companyName = providedCompanyName || "Your Cleaning Company";
    const { data: settings } = await supabase
      .from("business_settings")
      .select("company_name")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (settings?.company_name) {
      companyName = settings.company_name;
    }

    // CRITICAL: Filter staff by organization_id — never notify staff from other orgs
    let staffQuery = supabase
      .from("staff")
      .select("id, name, email, phone, hourly_rate, percentage_rate")
      .eq("organization_id", organizationId)
      .eq("is_active", true);

    // If specific staff IDs were provided, filter to only those
    if (staffIds && staffIds.length > 0) {
      staffQuery = staffQuery.in("id", staffIds);
    }

    const { data: staffMembers, error: staffError } = await staffQuery;

    if (staffError) {
      console.error("Error fetching staff:", staffError);
      throw staffError;
    }

    if (!staffMembers || staffMembers.length === 0) {
      console.log("No active staff members to notify for this organization");
      return new Response(
        JSON.stringify({ success: true, message: "No staff to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${staffMembers.length} active staff members for org ${organizationId}`);

    // Create in-app notifications for org staff only
    const notifications = staffMembers.map((staff) => {
      const totalAmount = Number(jobDetails.total_amount) || 0;
      const percentageRate = Number(staff.percentage_rate) || 0;
      const hourlyRate = Number(staff.hourly_rate) || 0;
      let potentialPay = 0;
      if (percentageRate > 0) {
        potentialPay = (totalAmount * percentageRate) / 100;
      } else if (hourlyRate > 0) {
        potentialPay = hourlyRate * 5;
      }

      return {
        staff_id: staff.id,
        booking_id: jobDetails.booking_id,
        organization_id: organizationId,
        title: "New Job Available!",
        message: `${jobDetails.service_name} on ${jobDetails.scheduled_date} at ${jobDetails.scheduled_time}. Address: ${jobDetails.address}.${jobDetails.square_footage ? ` Sq Ft: ${jobDetails.square_footage}.` : ''} Potential pay: $${potentialPay.toFixed(2)}`,
        type: "new_job",
      };
    });

    const { error: notifError } = await supabase
      .from("cleaner_notifications")
      .insert(notifications);

    if (notifError) {
      console.error("Error creating in-app notifications:", notifError);
      throw notifError;
    }

    console.log(`Created ${notifications.length} in-app notifications`);

    // Send SMS via OpenPhone to staff with phone numbers
    let smsSent = 0;
    let smsFailed = 0;

    if (orgOpenPhoneApiKey && orgPhoneNumberId) {
      const smsPromises = staffMembers
        .filter((staff) => staff.phone)
        .map(async (staff) => {
          const totalAmount = Number(jobDetails.total_amount) || 0;
          const percentageRate = Number(staff.percentage_rate) || 0;
          const hourlyRate = Number(staff.hourly_rate) || 0;
          let potentialPay = 0;
          if (percentageRate > 0) {
            potentialPay = (totalAmount * percentageRate) / 100;
          } else if (hourlyRate > 0) {
            potentialPay = hourlyRate * 5;
          }

          // Normalize phone to E.164
          let phone = staff.phone.replace(/\D/g, "");
          if (phone.length === 10) phone = `+1${phone}`;
          else if (!phone.startsWith("+")) phone = `+${phone}`;

          const sqftInfo = jobDetails.square_footage ? ` | Sq Ft: ${jobDetails.square_footage}` : '';
          const smsBody =
            `🎉 New Job Available!\n\n` +
            `Service: ${jobDetails.service_name}\n` +
            `Date: ${jobDetails.scheduled_date} at ${jobDetails.scheduled_time}\n` +
            `Address: ${jobDetails.address}${sqftInfo}\n` +
            `Potential pay: $${potentialPay.toFixed(2)}\n\n` +
            `Log in to the Staff Portal to claim it.\n- ${companyName}`;

          try {
            const sent = await sendOpenPhoneMessage({
              supabase,
              organizationId,
              to: phone,
              content: smsBody,
              from: orgPhoneNumberId,
              apiKey: orgOpenPhoneApiKey,
              tag: "notify-cleaners-open-job",
            });
            if (sent.skipped) {
              console.log(`SMS skipped opted_out for staff ${staff.name} (${phone})`);
              return { success: false, skipped: true };
            }
            const response = sent.response;

            if (response.ok) {
              console.log(`SMS sent to staff ${staff.name} (${phone})`);
              return { success: true };
            } else {
              const errBody = await response.text();
              console.error(`Failed SMS to ${staff.name}: ${response.status} ${errBody}`);
              return { success: false };
            }
          } catch (err) {
            console.error(`Error sending SMS to ${staff.name}:`, err);
            return { success: false };
          }
        });

      const results = await Promise.all(smsPromises);
      smsSent = results.filter((r) => r.success).length;
      smsFailed = results.filter((r) => !r.success && !r.skipped).length;
      console.log(`SMS sent: ${smsSent}, failed: ${smsFailed}`);
    } else {
      console.log("OpenPhone not configured for this org — skipping SMS, in-app notifications still created");
    }

    return new Response(
      JSON.stringify({
        success: true,
        notifications: notifications.length,
        smsSent,
        smsFailed,
        message: `Notified ${staffMembers.length} cleaner(s) for org ${organizationId}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending notifications:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
