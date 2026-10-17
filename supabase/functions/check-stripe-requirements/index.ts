import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveCallerOrg, isServiceRoleRequest } from "../_shared/require-caller-org.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { PLATFORM_SENDER_EMAIL } from "../_shared/email-sender-resolution.ts";
import { orgBrandVars, renderCrmEmail } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const platformStripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const globalResendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !serviceRoleKey || !platformStripeKey) {
      console.error("[check-stripe-requirements] Missing env vars");
      return new Response(JSON.stringify({ error: "Server config error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const stripe = new Stripe(platformStripeKey, { apiVersion: "2025-08-27.basil" });

    // Optional: filter to specific org
    let requestedOrgId: string | null = null;
    try {
      const body = await req.json();
      requestedOrgId = body?.organizationId || null;
    } catch {
      // cron call with no body
    }

    // SECURITY: a single-org request is the manual/frontend path — require a
    // real caller and resolve the org from THEIR JWT, never the body. A
    // request with no organizationId is the full cross-org sweep and must
    // only run for the scheduler (service role).
    let filterOrgId: string | null = null;
    if (requestedOrgId) {
      const callerOrg = await resolveCallerOrg(req);
      if (!callerOrg.ok) {
        return new Response(JSON.stringify({ error: callerOrg.error }), {
          status: callerOrg.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      filterOrgId = callerOrg.ctx.organizationId;
    } else if (!isServiceRoleRequest(req)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all payout accounts with payouts_enabled = false that have a stripe_account_id
    let query = supabase
      .from("staff_payout_accounts")
      .select("id, staff_id, organization_id, stripe_account_id")
      .eq("payouts_enabled", false)
      .not("stripe_account_id", "is", null);

    if (filterOrgId) {
      query = query.eq("organization_id", filterOrgId);
    }

    const { data: accounts, error: accountsError } = await query;

    if (accountsError) {
      console.error("[check-stripe-requirements] Error fetching accounts:", accountsError);
      throw new Error("Failed to fetch payout accounts");
    }

    if (!accounts || accounts.length === 0) {
      console.log("[check-stripe-requirements] No accounts need checking");
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[check-stripe-requirements] Checking ${accounts.length} accounts`);

    let notificationsCreated = 0;
    let emailsSent = 0;
    let skipped = 0;
    let errors = 0;

    for (const account of accounts) {
      try {
        const stripeAccount = await stripe.accounts.retrieve(account.stripe_account_id);

        const currentlyDue = stripeAccount.requirements?.currently_due || [];
        const pastDue = stripeAccount.requirements?.past_due || [];
        const pendingVerification = stripeAccount.requirements?.pending_verification || [];
        const disabledReason = stripeAccount.requirements?.disabled_reason || null;

        // Update local record
        const newStatus = stripeAccount.details_submitted
          ? (stripeAccount.payouts_enabled ? "active" : "pending_verification")
          : "onboarding";

        await supabase
          .from("staff_payout_accounts")
          .update({
            account_status: newStatus,
            payouts_enabled: stripeAccount.payouts_enabled || false,
            charges_enabled: stripeAccount.charges_enabled || false,
            details_submitted: stripeAccount.details_submitted || false,
            requirements_currently_due: currentlyDue,
            requirements_pending_verification: pendingVerification,
            disabled_reason: disabledReason,
            stripe_requirements_errors: stripeAccount.requirements?.errors || [],
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id);

        if (stripeAccount.payouts_enabled) {
          console.log(`[check-stripe-requirements] Account ${account.stripe_account_id} is now active, skipping`);
          continue;
        }

        // Determine requirement type
        let requirementType: string;
        let requirementCodes: string[];

        if (pastDue.length > 0) {
          requirementType = "past_due";
          requirementCodes = pastDue;
        } else if (currentlyDue.length > 0) {
          requirementType = "currently_due";
          requirementCodes = currentlyDue;
        } else if (pendingVerification.length > 0) {
          requirementType = "pending_verification";
          requirementCodes = pendingVerification;
        } else if (disabledReason) {
          requirementType = "currently_due";
          requirementCodes = [disabledReason];
        } else {
          continue;
        }

        // Generate fresh onboarding link scoped to cleaner portal
        let accountLinkUrl = "";
        let linkExpiresAt: string | null = null;

        if (requirementType !== "pending_verification") {
          try {
            const accountLink = await stripe.accountLinks.create({
              account: account.stripe_account_id,
              refresh_url: "https://jointidywise.com/staff-portal?tab=payouts&payout=refresh",
              return_url: "https://jointidywise.com/staff-portal?tab=payouts&payout=success",
              type: "account_onboarding",
            });
            accountLinkUrl = accountLink.url;
            linkExpiresAt = new Date(accountLink.expires_at * 1000).toISOString();
          } catch (linkErr: any) {
            console.error(`[check-stripe-requirements] Failed to create account link for ${account.stripe_account_id}:`, linkErr.message);
            errors++;
            continue;
          }
        }

        // Check existing notification for dedupe
        const { data: existingNotif } = await supabase
          .from("stripe_requirement_notifications")
          .select("id, email_sent_count, last_emailed_at, email_sent_at, needs_manual_followup, in_app_notified")
          .eq("staff_id", account.staff_id)
          .eq("requirement_type", requirementType)
          .is("resolved_at", null)
          .maybeSingle();

        if (existingNotif?.needs_manual_followup) {
          skipped++;
          continue;
        }

        // Create in-app notification (bell icon) if not already done.
        // inAppNotifiedOk tracks whether the bell notification is
        // actually in place — it feeds the in_app_notified value written
        // below, instead of that being hard-coded true regardless of
        // whether this insert succeeded (which previously meant a failed
        // insert still permanently suppressed all future retries via the
        // `if (!existingNotif?.in_app_notified)` guard above).
        let inAppNotifiedOk = existingNotif?.in_app_notified ?? false;
        if (!inAppNotifiedOk) {
          const notifMessage = requirementType === "pending_verification"
            ? "Your bank is verifying your account — this usually takes 2-3 business days."
            : "Your payout setup needs attention — tap to fix.";

          const { error: cleanerNotifError } = await supabase.from("cleaner_notifications").insert({
            staff_id: account.staff_id,
            organization_id: account.organization_id,
            title: requirementType === "pending_verification" ? "Bank Verification In Progress" : "Payout Setup Needs Attention",
            message: notifMessage,
            type: "payout_requirement",
          });
          if (cleanerNotifError) {
            errors++;
            console.error("[check-stripe-requirements] cleaner_notifications insert failed, will retry next run:", {
              staffId: account.staff_id, organizationId: account.organization_id, requirementType, error: cleanerNotifError,
            });
          } else {
            notificationsCreated++;
            inAppNotifiedOk = true;
          }
        }

        // Low-priority email: only if cleaner hasn't logged in 72+ hours
        let shouldSendEmail = false;
        if (requirementType !== "pending_verification") {
          const { data: staff } = await supabase
            .from("staff")
            .select("name, email, user_id")
            .eq("id", account.staff_id)
            .maybeSingle();

          if (staff?.email && staff?.user_id) {
            // Check last sign-in time via profiles
            const { data: profile } = await supabase
              .from("profiles")
              .select("updated_at")
              .eq("id", staff.user_id)
              .maybeSingle();

            const lastActivity = profile?.updated_at ? new Date(profile.updated_at).getTime() : 0;
            const hoursSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60);

            // Dedupe: no email within 72 hours
            const lastEmailedAt = existingNotif?.email_sent_at || existingNotif?.last_emailed_at;
            const hoursSinceLastEmail = lastEmailedAt 
              ? (Date.now() - new Date(lastEmailedAt).getTime()) / (1000 * 60 * 60)
              : 999;

            if (hoursSinceActivity >= 72 && hoursSinceLastEmail >= 72) {
              shouldSendEmail = true;

              // Get org email settings
              const { data: orgEmailSettings } = await supabase
                .from("organization_email_settings")
                .select("from_name, from_email, resend_api_key")
                .eq("organization_id", account.organization_id)
                .maybeSingle();

              const resendApiKey = orgEmailSettings?.resend_api_key || globalResendApiKey;
              if (resendApiKey) {
                const firstName = staff.name?.split(" ")[0] || "there";
                const fromName = orgEmailSettings?.from_name || "TidyWise";
                const fromEmail = orgEmailSettings?.from_email || PLATFORM_SENDER_EMAIL;
                const portalUrl = "https://jointidywise.com/staff-portal?tab=payouts";
                const supportEmail = tidywiseSupportEmail();
                const supportMailto = `mailto:${tidywiseSupportEmail()}`;
                const brand = await loadLooseBrand(account.organization_id);
                const requirementsMail = renderCrmEmail("stripe-requirements", {
                  vars: {
                    ...orgBrandVars(brand),
                    firstName,
                    portalUrl,
                    supportEmail,
                  },
                  rawKeys: ["email_footer"],
                });
                const requirementsText = requirementsMail.text.includes(supportMailto)
                  ? requirementsMail.text
                  : `${requirementsMail.text}\n${supportMailto}`;

                const resendRes = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${resendApiKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    from: `${fromName} <${fromEmail}>`,
                    reply_to: tidywiseSupportEmail(),
                    to: [staff.email],
                    subject: "You have a pending action in your TidyWise Cleaner Portal",
                    html: requirementsMail.html,
                    text: requirementsText,
                  }),
                });

                if (resendRes.ok) {
                  emailsSent++;
                  console.log(`[check-stripe-requirements] Login reminder sent to ${staff.email}`);
                } else {
                  const errData = await resendRes.json();
                  console.error(`[check-stripe-requirements] Resend error for ${staff.email}:`, errData);
                  errors++;
                  shouldSendEmail = false;
                }
              }
            }
          }
        }

        // Upsert notification tracking
        const newCount = (existingNotif?.email_sent_count || 0) + (shouldSendEmail ? 1 : 0);
        const needsManualFollowup = newCount >= 3;

        if (existingNotif) {
          const { error: updateNotifError } = await supabase
            .from("stripe_requirement_notifications")
            .update({
              email_sent_count: newCount,
              ...(shouldSendEmail ? { email_sent_at: new Date().toISOString(), last_emailed_at: new Date().toISOString() } : {}),
              account_link_url: accountLinkUrl || existingNotif.id ? undefined : null,
              link_expires_at: linkExpiresAt,
              email_status: shouldSendEmail ? "sent" : existingNotif.id ? undefined : "pending",
              needs_manual_followup: needsManualFollowup,
              stripe_requirement_codes: requirementCodes,
              in_app_notified: inAppNotifiedOk,
            })
            .eq("id", existingNotif.id);
          if (updateNotifError) {
            errors++;
            console.error("[check-stripe-requirements] stripe_requirement_notifications update failed:", {
              staffId: account.staff_id, notifId: existingNotif.id, error: updateNotifError,
            });
          }
        } else {
          const { error: insertNotifError } = await supabase
            .from("stripe_requirement_notifications")
            .insert({
              staff_id: account.staff_id,
              organization_id: account.organization_id,
              requirement_type: requirementType,
              stripe_requirement_codes: requirementCodes,
              email_sent_count: shouldSendEmail ? 1 : 0,
              ...(shouldSendEmail ? { email_sent_at: new Date().toISOString(), last_emailed_at: new Date().toISOString() } : {}),
              account_link_url: accountLinkUrl || null,
              link_expires_at: linkExpiresAt,
              email_status: shouldSendEmail ? "sent" : "pending",
              needs_manual_followup: false,
              in_app_notified: inAppNotifiedOk,
              detected_at: new Date().toISOString(),
            });
          if (insertNotifError) {
            errors++;
            console.error("[check-stripe-requirements] stripe_requirement_notifications insert failed — dedupe/tracking for this staff member will not work next run:", {
              staffId: account.staff_id, organizationId: account.organization_id, requirementType, error: insertNotifError,
            });
          }
        }
      } catch (err: any) {
        console.error(`[check-stripe-requirements] Error processing account ${account.stripe_account_id}:`, err.message);
        errors++;
      }
    }

    console.log(`[check-stripe-requirements] Done: ${notificationsCreated} notifications, ${emailsSent} emails, ${skipped} skipped, ${errors} errors`);

    return new Response(
      JSON.stringify({ processed: accounts.length, notificationsCreated, emailsSent, skipped, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[check-stripe-requirements] Unhandled error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
