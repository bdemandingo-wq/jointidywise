import { sendOpenPhoneMessage } from "../_shared/send-openphone.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * SMS-Only Invoice Payment Reminder
 * Triggered daily by pg_cron. Sends automated SMS reminders for unpaid invoices
 * based on each organization's payment reminder settings.
 * Also auto-marks past-due invoices as "overdue".
 */

function formatPhoneE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null; // Invalid
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron-only endpoint: require shared x-cron-secret header.
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log("[send-invoice-reminder] Starting reminder check...");

    // Step 1: Auto-mark past-due invoices as "overdue"
    const today = new Date().toISOString().split('T')[0];
    const { data: overdueUpdated, error: overdueError } = await supabase
      .from("invoices")
      .update({ status: "overdue" })
      .eq("status", "sent")
      .lt("due_date", today)
      .not("due_date", "is", null)
      .select("id");

    if (overdueError) {
      console.error("[send-invoice-reminder] Error updating overdue invoices:", overdueError);
    } else {
      console.log(`[send-invoice-reminder] Marked ${overdueUpdated?.length || 0} invoices as overdue`);
    }

    // Step 2: Get all active SMS payment reminders
    const { data: reminders, error: remindersError } = await supabase
      .from("invoice_payment_reminders")
      .select("*")
      .eq("is_active", true)
      .eq("send_sms", true);

    if (remindersError) {
      throw new Error(`Failed to fetch reminders: ${remindersError.message}`);
    }

    console.log(`[send-invoice-reminder] Found ${reminders?.length || 0} active SMS reminders`);

    let sentCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    for (const reminder of reminders || []) {
      const organizationId = reminder.organization_id;
      const daysAfterDue = reminder.days_after_due;

      // Calculate the target due date (invoices that were due exactly X days ago)
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - daysAfterDue);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      // Get unpaid invoices for this organization that match the reminder timing
      // Check both "sent" and "overdue" statuses
      const { data: invoices, error: invoicesError } = await supabase
        .from("invoices")
        .select(`
          *,
          customers:customer_id (
            first_name,
            last_name,
            phone,
            email
          ),
          leads:lead_id (
            name,
            phone,
            email
          )
        `)
        .eq("organization_id", organizationId)
        .in("status", ["sent", "overdue"])
        .eq("due_date", targetDateStr);

      if (invoicesError) {
        console.error(`[send-invoice-reminder] Error fetching invoices for org ${organizationId}:`, invoicesError);
        continue;
      }

      if (!invoices || invoices.length === 0) {
        continue;
      }

      console.log(`[send-invoice-reminder] Found ${invoices.length} invoices due on ${targetDateStr} for org ${organizationId}`);

      // Get organization SMS settings (STRICT ISOLATION)
      const { data: smsSettings } = await supabase
        .from("organization_sms_settings")
        .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (!smsSettings?.openphone_api_key || !smsSettings?.openphone_phone_number_id || !smsSettings?.sms_enabled) {
        console.log(`[send-invoice-reminder] Skipping org ${organizationId} - SMS not configured or disabled`);
        skippedCount += invoices.length;
        continue;
      }

      // Get business settings for company name
      const { data: businessSettings } = await supabase
        .from("business_settings")
        .select("company_name")
        .eq("organization_id", organizationId)
        .maybeSingle();

      const companyName = businessSettings?.company_name || "Your service provider";

      // Send SMS reminders for each matching invoice
      for (const invoice of invoices) {
        // Get customer/lead phone number
        const customer = invoice.customers;
        const lead = invoice.leads;
        const rawPhone = customer?.phone || lead?.phone;
        const customerName = customer
          ? `${customer.first_name} ${customer.last_name}`.trim()
          : lead?.name || "Customer";

        if (!rawPhone) {
          console.log(`[send-invoice-reminder] Skipping invoice ${invoice.id} - no phone number`);
          skippedCount++;
          continue;
        }

        const formattedPhone = formatPhoneE164(rawPhone);
        if (!formattedPhone) {
          console.log(`[send-invoice-reminder] Skipping invoice ${invoice.id} - invalid phone: ${rawPhone}`);
          skippedCount++;
          continue;
        }

        const paymentUrl = invoice.stripe_invoice_url || '';
        const smsContent = `Hi ${customerName}! 📋 Friendly reminder: Your invoice #${invoice.invoice_number} for $${invoice.total_amount.toFixed(2)} from ${companyName} is now ${daysAfterDue} day${daysAfterDue > 1 ? 's' : ''} past due.\n\n${paymentUrl ? `Pay now: ${paymentUrl}` : 'Please contact us to arrange payment.'}`;

        try {
          const smsResponse = await sendOpenPhoneMessage( {
      organizationId: organizationId,
            method: "POST",
            headers: {
              "Authorization": smsSettings.openphone_api_key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: smsContent,
              from: smsSettings.openphone_phone_number_id,
              to: [formattedPhone],
            }),
          });

          if (smsResponse.ok) {
            console.log(`[send-invoice-reminder] SMS sent for invoice #${invoice.invoice_number} to ${formattedPhone}`);
            sentCount++;
          } else {
            const errorText = await smsResponse.text();
            console.error(`[send-invoice-reminder] SMS failed for invoice #${invoice.invoice_number}:`, errorText);
            errorCount++;
          }
        } catch (smsError) {
          console.error(`[send-invoice-reminder] SMS error for invoice #${invoice.invoice_number}:`, smsError);
          errorCount++;
        }
      }
    }

    console.log(`[send-invoice-reminder] Complete. Sent: ${sentCount}, Errors: ${errorCount}, Skipped: ${skippedCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        errors: errorCount,
        skipped: skippedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-invoice-reminder] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
