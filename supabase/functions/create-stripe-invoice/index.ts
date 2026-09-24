import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateInvoiceRequest {
  invoiceId: string;
  organizationId: string;
  customerEmail: string | null;
  customerName: string;
  customerPhone?: string | null;
  sendEmail?: boolean;
  sendSms?: boolean;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  totalAmount: number;
  taxAmount: number;
  dueDate?: string;
  notes?: string;
  ccEmails?: string[];
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      throw new Error("Invalid authentication");
    }

    const data: CreateInvoiceRequest = await req.json();
    console.log("Creating Stripe invoice for:", data.invoiceId);

    // Verify user belongs to the organization
    const { data: membership, error: membershipError } = await supabase
      .from("org_memberships")
      .select("organization_id, role")
      .eq("user_id", userData.user.id)
      .eq("organization_id", data.organizationId)
      .maybeSingle();

    if (membershipError || !membership) {
      throw new Error("User not authorized for this organization");
    }

    // STRICT ISOLATION: Get organization-specific Stripe credentials - NO FALLBACK ALLOWED
    const { data: secretRows, error: stripeSettingsError } = await supabase.rpc("get_org_stripe_secret", {
      p_org_id: data.organizationId,
    });

    if (stripeSettingsError) {
      console.error("[create-stripe-invoice] Error fetching Stripe settings for org:", data.organizationId, stripeSettingsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch Stripe configuration" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orgSecret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
    const stripeApiKey: string | null = orgSecret?.stripe_access_token || orgSecret?.stripe_secret_key || null;

    // CRITICAL: NO FALLBACK - Organization must have its own Stripe key configured
    if (!stripeApiKey) {
      console.error("[create-stripe-invoice] No Stripe key configured for organization:", data.organizationId);
      return new Response(
        JSON.stringify({ error: "Stripe not configured for this organization. Please connect your Stripe account in Settings → Payments." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-stripe-invoice] Using organization-specific Stripe key for org:", data.organizationId);

    // Determine send channels (default: both if not specified, for backward compat)
    const wantsEmail = data.sendEmail !== false;
    const wantsSms = data.sendSms !== false;

    const stripe = new Stripe(stripeApiKey, { apiVersion: "2025-08-27.basil" });

    // Need a valid email for Stripe customer - use provided or generate placeholder
    const emailForStripe = data.customerEmail || `noemail+${data.invoiceId.substring(0, 8)}@placeholder.local`;

    // Get or create Stripe customer
    const customers = data.customerEmail 
      ? await stripe.customers.list({ email: data.customerEmail, limit: 1 })
      : { data: [] };
    let customerId: string;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: emailForStripe,
        name: data.customerName,
        phone: data.customerPhone || undefined,
      });
      customerId = customer.id;
    }

    console.log("Using Stripe customer:", customerId);

    // Get business settings for branding
    const { data: businessSettings } = await supabase
      .from("business_settings")
      .select("company_name, timezone")
      .eq("organization_id", data.organizationId)
      .maybeSingle();

    const companyName = businessSettings?.company_name || "Your Business";
    const orgTimezone = businessSettings?.timezone || "America/New_York";

    // Get organization invoice/payment settings
    const { data: invoiceSettings } = await supabase
      .from("organization_invoice_settings")
      .select("accept_cards, accept_ach")
      .eq("organization_id", data.organizationId)
      .maybeSingle();

    // Determine payment methods based on settings (default to card if no settings)
    const paymentMethodTypes: string[] = [];
    if (invoiceSettings?.accept_cards !== false) {
      paymentMethodTypes.push("card");
    }
    if (invoiceSettings?.accept_ach === true) {
      paymentMethodTypes.push("us_bank_account");
    }
    // Fallback to card if nothing enabled
    if (paymentMethodTypes.length === 0) {
      paymentMethodTypes.push("card");
    }

    console.log("Enabled payment methods:", paymentMethodTypes);

    // Create a Stripe Checkout Session for this invoice
    const lineItems = data.items.map(item => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: item.description,
        },
        unit_amount: Math.round(item.unitPrice * 100), // Convert to cents
      },
      quantity: item.quantity,
    }));

    // Add tax as a line item if applicable
    if (data.taxAmount > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Sales Tax",
          },
          unit_amount: Math.round(data.taxAmount * 100),
        },
        quantity: 1,
      });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: lineItems,
      mode: "payment",
      payment_method_types: paymentMethodTypes as any,
      success_url: `${req.headers.get("origin")}/dashboard/invoices?paid=true`,
      cancel_url: `${req.headers.get("origin")}/dashboard/invoices`,
      metadata: {
        invoice_id: data.invoiceId,
        organization_id: data.organizationId,
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          metadata: {
            invoice_id: data.invoiceId,
          },
        },
      },
    });

    console.log("Created Stripe checkout session:", session.id);

    // Update the invoice with Stripe info
    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        stripe_invoice_url: session.url,
        stripe_invoice_id: session.id,
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", data.invoiceId);

    if (updateError) {
      console.error("Failed to update invoice:", updateError);
    }

    // Fetch the actual invoice to get the auto-generated invoice number + address
    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("invoice_number, address, subtotal, total_amount, due_date, notes, created_at, send_copy_to_self")
      .eq("id", data.invoiceId)
      .maybeSingle();

    const resolvedInvoiceNumber = invoiceRow?.invoice_number ?? null;

    // Send SMS if requested
    if (wantsSms && data.customerPhone) {
      // Get organization SMS settings
      const { data: smsSettings } = await supabase
        .from("organization_sms_settings")
        .select("openphone_api_key, openphone_phone_number_id, sms_enabled")
        .eq("organization_id", data.organizationId)
        .maybeSingle();

      const openPhoneApiKey = smsSettings?.openphone_api_key;
      const openPhoneNumberId = smsSettings?.openphone_phone_number_id;

      if (!openPhoneApiKey || !openPhoneNumberId) {
        return new Response(
          JSON.stringify({ error: "SMS is not configured for this organization. Add an OpenPhone API key and phone number in Settings → SMS." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        let formattedPhone = data.customerPhone.replace(/\D/g, '');
        if (!formattedPhone.startsWith('+')) {
          if (formattedPhone.length === 10) {
            formattedPhone = `+1${formattedPhone}`;
          } else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) {
            formattedPhone = `+${formattedPhone}`;
          } else {
            formattedPhone = `+${formattedPhone}`;
          }
        }

        const dueDateText = data.dueDate
          ? ` Due: ${new Intl.DateTimeFormat('en-US', { timeZone: orgTimezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(data.dueDate))}.`
          : '';

        const invLabel = resolvedInvoiceNumber ? `INV-${String(resolvedInvoiceNumber).padStart(4, '0')}` : 'your invoice';
        const smsContent = `Hi ${data.customerName}! 📄 ${invLabel} for $${data.totalAmount.toFixed(2)} from ${companyName}.${dueDateText}\n\nPay securely here: ${session.url}`;

        const smsResponse = await fetch("https://api.openphone.com/v1/messages", {
          method: "POST",
          headers: {
            "Authorization": openPhoneApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: smsContent,
            from: openPhoneNumberId,
            to: [formattedPhone],
          }),
        });

        if (smsResponse.ok) {
          console.log("Invoice SMS sent to:", formattedPhone);
        } else {
          const errorText = await smsResponse.text();
          console.error("Invoice SMS failed:", errorText);
          return new Response(
            JSON.stringify({ error: `Failed to send SMS: ${errorText}` }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (smsError: any) {
        console.error("Failed to send invoice SMS:", smsError);
        return new Response(
          JSON.stringify({ error: `Failed to send SMS: ${smsError?.message || smsError}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (wantsSms && !data.customerPhone) {
      return new Response(
        JSON.stringify({ error: "Customer has no phone number on file." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email if requested
    if (wantsEmail && data.customerEmail) {
      try {
        const lineItemsForEmail = data.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: Number((it.quantity * it.unitPrice).toFixed(2)),
        }));

        const { error: emailError } = await supabase.functions.invoke('send-invoice', {
          body: {
            organizationId: data.organizationId,
            customerEmail: data.customerEmail,
            customerName: data.customerName,
            customerPhone: data.customerPhone || undefined,
            invoiceNumber: resolvedInvoiceNumber,
            lineItems: lineItemsForEmail,
            subtotal: lineItemsForEmail.reduce((s, it) => s + it.total, 0),
            total: data.totalAmount,
            address: invoiceRow?.address || undefined,
            invoiceDate: invoiceRow?.created_at || new Date().toISOString(),
            dueDate: data.dueDate || invoiceRow?.due_date || undefined,
            notes: data.notes || invoiceRow?.notes || undefined,
            ccEmails: Array.isArray(data.ccEmails) ? data.ccEmails : [],
            sendCopyToSelf: invoiceRow?.send_copy_to_self !== false,
          },
        });
        if (emailError) {
          console.error("Invoice email failed:", emailError);
        } else {
          console.log("Invoice email sent to:", data.customerEmail);
        }
      } catch (emailErr) {
        console.error("Failed to send invoice email:", emailErr);
      }
    } else {
      console.log("Email not requested or no email address");
    }

    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error creating Stripe invoice:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
