import { createStripeClient } from "./stripe-client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

interface OrgStripeSettings {
  stripe_publishable_key: string | null;
  stripe_account_id: string | null;
  is_connected: boolean;
}

interface GetOrgStripeResult {
  success: boolean;
  stripe?: Stripe;
  settings?: OrgStripeSettings;
  error?: string;
}

/**
 * Retrieves the organization's Stripe credentials and initializes a Stripe client.
 *
 * Secrets live in `org_stripe_secrets`, which has no RLS policies for any
 * non-service role. Reads go through the SECURITY DEFINER RPC
 * `get_org_stripe_secret`, which records every access in `security_audit_log`.
 *
 * Non-sensitive metadata (account id, publishable key, connection state)
 * still lives on `org_stripe_settings` and is fetched separately.
 */
export async function getOrgStripeClient(organizationId: string): Promise<GetOrgStripeResult> {
  if (!organizationId) {
    return { success: false, error: "Organization ID is required" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !supabaseServiceKey) {
    return { success: false, error: "Supabase configuration missing" };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: secretRows, error: secretError } = await supabase.rpc("get_org_stripe_secret", {
    p_org_id: organizationId,
  });

  if (secretError) {
    console.error("[get-org-stripe-settings] Error fetching secret:", secretError);
    return { success: false, error: "Failed to fetch Stripe credentials" };
  }

  const secretRow = Array.isArray(secretRows) ? secretRows[0] : secretRows;
  const stripeApiKey: string | null = secretRow?.stripe_access_token || secretRow?.stripe_secret_key || null;

  if (!stripeApiKey) {
    console.log("[get-org-stripe-settings] No Stripe credentials configured for organization:", organizationId);
    return {
      success: false,
      error: "Stripe not configured for this organization. Please connect your Stripe account in Settings → Payments.",
    };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("org_stripe_settings")
    .select("stripe_publishable_key, stripe_account_id, is_connected")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (settingsError) {
    console.error("[get-org-stripe-settings] Error fetching org settings:", settingsError);
    return { success: false, error: "Failed to fetch Stripe settings" };
  }

  try {
    const stripe = await createStripeClient(stripeApiKey, { organizationId: organizationId,
      apiVersion: "2025-08-27.basil",
    });

    return {
      success: true,
      stripe,
      settings: settings
        ? {
            stripe_publishable_key: settings.stripe_publishable_key ?? null,
            stripe_account_id: settings.stripe_account_id ?? null,
            is_connected: settings.is_connected ?? false,
          }
        : undefined,
    };
  } catch (error) {
    console.error("[get-org-stripe-settings] Error initializing Stripe:", error);
    return {
      success: false,
      error: "Failed to initialize Stripe client. Please check your API key.",
    };
  }
}
