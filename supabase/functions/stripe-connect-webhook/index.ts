import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, stripe-signature",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const platformStripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !platformStripeKey) {
      console.error("[stripe-connect-webhook] Missing environment variables");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.text();

    if (!webhookSecret) {
      console.error("[stripe-connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET not configured — refusing");
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.error("[stripe-connect-webhook] Missing stripe-signature header");
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(platformStripeKey, { apiVersion: "2025-08-27.basil" });
    let event: Stripe.Event;
    try {
      // Deno-compatible async signature verification. The sync
      // constructEvent() throws "SubtleCryptoProvider cannot be used
      // in a synchronous context" in Supabase Edge Functions.
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err: any) {
      console.error("[stripe-connect-webhook] Signature verification failed:", err.message);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[stripe-connect-webhook] Received event:", event.type, event.id, "for account:", (event.data.object as any)?.id || "unknown");

    // Only handle account.updated events
    if (event.type !== "account.updated") {
      console.log("[stripe-connect-webhook] Ignoring event type:", event.type);
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── IDEMPOTENCY CHECK ───────────────────────────────────────────────────
    // Stripe may retry events; ensure we only process each account.updated once.
    if (event.id) {
      const { error: idempotencyError } = await supabase
        .from("stripe_webhook_events")
        .insert({
          event_id: event.id,
          event_type: event.type,
          source: "stripe-connect-webhook",
        });

      if (idempotencyError) {
        if (idempotencyError.code === "23505") {
          console.log("[stripe-connect-webhook] Event already processed, skipping:", event.id);
          return new Response(JSON.stringify({ received: true, duplicate: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.error("[stripe-connect-webhook] Idempotency insert error (non-fatal):", idempotencyError);
      }
    }

    const account = event.data.object as Stripe.Account;
    const stripeAccountId = account.id;

    console.log("[stripe-connect-webhook] Processing account.updated for:", stripeAccountId, {
      payouts_enabled: account.payouts_enabled,
      charges_enabled: account.charges_enabled,
      details_submitted: account.details_submitted,
      requirements_currently_due: account.requirements?.currently_due,
      requirements_pending: account.requirements?.pending_verification,
      disabled_reason: account.requirements?.disabled_reason,
    });

    // Find the matching staff_payout_accounts record
    const { data: payoutAccount, error: lookupError } = await supabase
      .from("staff_payout_accounts")
      .select("id, staff_id, organization_id")
      .eq("stripe_account_id", stripeAccountId)
      .maybeSingle();

    if (lookupError) {
      console.error("[stripe-connect-webhook] DB lookup error:", lookupError);
      return new Response(JSON.stringify({ error: "Database error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payoutAccount) {
      console.log("[stripe-connect-webhook] No matching staff_payout_accounts for Stripe account:", stripeAccountId);
      return new Response(JSON.stringify({ received: true, matched: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine status
    const newStatus = account.details_submitted
      ? (account.payouts_enabled ? "active" : "pending_verification")
      : "onboarding";

    // Extract bank info
    let bankLast4: string | null = null;
    if (account.external_accounts?.data?.length && account.external_accounts.data.length > 0) {
      const bankAccount = account.external_accounts.data[0];
      bankLast4 = (bankAccount as any).last4 || null;
    }

    // Build update payload
    const updatePayload: Record<string, any> = {
      account_status: newStatus,
      payouts_enabled: account.payouts_enabled || false,
      charges_enabled: account.charges_enabled || false,
      details_submitted: account.details_submitted || false,
      bank_last4: bankLast4,
      last_webhook_at: new Date().toISOString(),
      requirements_currently_due: account.requirements?.currently_due || [],
      requirements_pending_verification: account.requirements?.pending_verification || [],
      disabled_reason: account.requirements?.disabled_reason || null,
      stripe_requirements_errors: account.requirements?.errors || [],
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("staff_payout_accounts")
      .update(updatePayload)
      .eq("id", payoutAccount.id);

    if (updateError) {
      console.error("[stripe-connect-webhook] Failed to update staff_payout_accounts:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[stripe-connect-webhook] Updated staff", payoutAccount.staff_id, "to status:", newStatus);

    // Auto-resolve outstanding requirement notifications when payouts are enabled
    if (account.payouts_enabled) {
      const { data: unresolvedNotifs } = await supabase
        .from("stripe_requirement_notifications")
        .select("id")
        .eq("staff_id", payoutAccount.staff_id)
        .is("resolved_at", null);

      if (unresolvedNotifs && unresolvedNotifs.length > 0) {
        await supabase
          .from("stripe_requirement_notifications")
          .update({ resolved_at: new Date().toISOString() })
          .eq("staff_id", payoutAccount.staff_id)
          .is("resolved_at", null);

        console.log("[stripe-connect-webhook] Resolved", unresolvedNotifs.length, "notifications for staff", payoutAccount.staff_id);

        // Send one-time "You're all set" email
        try {
          const { data: staff } = await supabase
            .from("staff")
            .select("name, email")
            .eq("id", payoutAccount.staff_id)
            .maybeSingle();

          if (staff?.email) {
            const globalResendApiKey = Deno.env.get("RESEND_API_KEY");
            const { data: orgEmailSettings } = await supabase
              .from("organization_email_settings")
              .select("from_name, from_email, resend_api_key")
              .eq("organization_id", payoutAccount.organization_id)
              .maybeSingle();

            const resendApiKey = orgEmailSettings?.resend_api_key || globalResendApiKey;
            if (resendApiKey) {
              const firstName = staff.name?.split(" ")[0] || "there";
              const fromName = orgEmailSettings?.from_name || "TidyWise";
              const fromEmail = orgEmailSettings?.from_email || PLATFORM_SENDER_EMAIL;

              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${resendApiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from: `${fromName} <${fromEmail}>`,
                  reply_to: tidywiseSupportEmail(),
                  to: [staff.email],
                  subject: "You're all set — payouts are now active on your TidyWise account",
                  html: `
                    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
                      <h2 style="color:#1a1a2e;">Hi ${firstName},</h2>
                      <p style="color:#333;font-size:15px;line-height:1.6;">
                        Great news — your payout setup is now complete! 🎉
                      </p>
                      <p style="color:#333;font-size:15px;line-height:1.6;">
                        Payouts are now active on your TidyWise account. Your earnings will be processed automatically on our net 30 schedule.
                      </p>
                      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
                      <p style="color:#888;font-size:13px;">
                        Need help? Contact us at <a href="mailto:${tidywiseSupportEmail()}" style="color:#4f46e5;">${tidywiseSupportEmail()}</a> or call <a href="tel:+15615718725" style="color:#4f46e5;">(561) 571-8725</a>.
                      </p>
                      <p style="color:#888;font-size:13px;">— The TidyWise Team</p>
                    </div>
                  `,
                }),
              });
              console.log("[stripe-connect-webhook] Sent 'all set' email to", staff.email);
            }
          }
        } catch (emailErr: any) {
          console.error("[stripe-connect-webhook] Failed to send resolved email:", emailErr.message);
        }
      }
    }

    return new Response(JSON.stringify({ received: true, matched: true, status: newStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[stripe-connect-webhook] Unhandled error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
