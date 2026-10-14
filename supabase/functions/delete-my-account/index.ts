import { createStripeClient } from "../_shared/stripe-client.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { logToSystem } from "../_shared/system-logger.ts";
import { billingSecretKey } from "../_shared/billing-stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cancel every Stripe subscription tied to the user's email on the
 * TidyWise platform Stripe account. This MUST run before deleting
 * the auth user — otherwise Stripe keeps retrying failed charges
 * forever, generating decline noise and customer complaints.
 *
 * Returns the list of subscription IDs that were cancelled (or were
 * already inactive) so we can audit-log it.
 */
async function cancelStripeSubscriptionsForEmail(email: string): Promise<string[]> {
  const stripeKey = billingSecretKey();
  if (!stripeKey || !email) return [];
  const stripe = await createStripeClient(stripeKey, { apiVersion: "2025-08-27.basil" });
  const cancelled: string[] = [];
  try {
    // Stripe can have multiple customers per email — handle them all
    const customers = await stripe.customers.list({ email, limit: 100 });
    for (const customer of customers.data) {
      // Pull every non-terminal subscription for this customer
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        status: "all",
        limit: 100,
      });
      for (const sub of subs.data) {
        if (["canceled", "incomplete_expired"].includes(sub.status)) continue;
        try {
          await stripe.subscriptions.cancel(sub.id, {
            invoice_now: false,
            prorate: false,
          });
          cancelled.push(sub.id);
          console.log(`[DELETE-MY-ACCOUNT] Cancelled Stripe sub ${sub.id} (customer ${customer.id})`);
        } catch (e) {
          console.error(`[DELETE-MY-ACCOUNT] Failed to cancel sub ${sub.id}:`, e);
        }
      }
    }
  } catch (e) {
    console.error("[DELETE-MY-ACCOUNT] Stripe cleanup error:", e);
  }
  return cancelled;
}

/**
 * Self-service account deletion for App Store compliance
 * Users can delete their own account and all associated data
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const requestId = crypto.randomUUID();
    
    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Authentication error: Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = userData.user;
    const userId = user.id;
    const userEmail = user.email;

    console.log(`[DELETE-MY-ACCOUNT] User ${userId} (${userEmail}) requesting account deletion`);

    // Parse request body for confirmation
    const body = await req.json();
    const { confirmEmail } = body;

    // Require email confirmation to prevent accidental deletions
    if (!confirmEmail || confirmEmail.toLowerCase() !== userEmail?.toLowerCase()) {
      return new Response(JSON.stringify({ error: "Email confirmation does not match" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's organization memberships
    const { data: memberships } = await supabaseClient
      .from('org_memberships')
      .select('organization_id, role')
      .eq('user_id', userId);

    // If user is an owner of an organization, delete the organization and all its data
    for (const membership of memberships || []) {
      if (membership.role === 'owner') {
        const orgId = membership.organization_id;
        console.log(`[DELETE-MY-ACCOUNT] Deleting organization ${orgId} owned by user`);

        // Delete all organization-related data in order (respecting foreign keys)
        // Note: Many tables have ON DELETE CASCADE, but we'll be explicit
        
        // Delete bookings and related data
        await supabaseClient.from('booking_team_assignments').delete().eq('organization_id', orgId);
        await supabaseClient.from('booking_photos').delete().eq('organization_id', orgId);
        await supabaseClient.from('booking_checklist_items').delete().eq('organization_id', orgId);
        await supabaseClient.from('booking_checklists').delete().eq('organization_id', orgId);
        await supabaseClient.from('bookings').delete().eq('organization_id', orgId);
        
        // Delete customer-related data
        await supabaseClient.from('customer_intelligence').delete().eq('organization_id', orgId);
        await supabaseClient.from('customers').delete().eq('organization_id', orgId);
        
        // Delete staff and related data
        await supabaseClient.from('cleaner_notifications').delete().eq('organization_id', orgId);
        await supabaseClient.from('staff').delete().eq('organization_id', orgId);
        
        // Delete services
        await supabaseClient.from('services').delete().eq('organization_id', orgId);
        
        // Delete other org data
        await supabaseClient.from('discounts').delete().eq('organization_id', orgId);
        await supabaseClient.from('expenses').delete().eq('organization_id', orgId);
        await supabaseClient.from('invoices').delete().eq('organization_id', orgId);
        await supabaseClient.from('inventory_items').delete().eq('organization_id', orgId);
        await supabaseClient.from('automated_campaigns').delete().eq('organization_id', orgId);
        await supabaseClient.from('business_settings').delete().eq('organization_id', orgId);
        await supabaseClient.from('business_intelligence').delete().eq('organization_id', orgId);
        
        // Delete all memberships for this org
        await supabaseClient.from('org_memberships').delete().eq('organization_id', orgId);
        
        // Finally delete the organization
        await supabaseClient.from('organizations').delete().eq('id', orgId);
      }
    }

    // Delete any remaining memberships for this user (if they were members of other orgs)
    await supabaseClient.from('org_memberships').delete().eq('user_id', userId);

    // CRITICAL: Cancel any active Stripe subscriptions tied to this email
    // BEFORE deleting the auth user. Otherwise Stripe keeps retrying
    // failed charges and the customer thinks they're being charged after
    // cancelling their account.
    const cancelledSubs = userEmail
      ? await cancelStripeSubscriptionsForEmail(userEmail)
      : [];

    // Delete user profile
    await supabaseClient.from('profiles').delete().eq('id', userId);

    // Delete the user from auth.users
    const { error: deleteError } = await supabaseClient.auth.admin.deleteUser(userId);
    
    if (deleteError) {
      console.error("[DELETE-MY-ACCOUNT] Error deleting user:", deleteError);
      throw new Error(`Failed to delete account: ${deleteError.message}`);
    }

    await logToSystem({
      level: "info",
      source: "delete-my-account",
      message: `User account deleted successfully: ${userId} (${userEmail}). Cancelled ${cancelledSubs.length} Stripe subscription(s): ${cancelledSubs.join(', ') || 'none'}`,
      userId,
      requestId,
    });

    console.log(`[DELETE-MY-ACCOUNT] Successfully deleted account for user ${userId}`);

    return new Response(JSON.stringify({ success: true, message: "Account deleted successfully" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DELETE-MY-ACCOUNT] Error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
