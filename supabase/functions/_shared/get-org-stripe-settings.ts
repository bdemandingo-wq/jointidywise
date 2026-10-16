import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  CARD_PAYMENTS_UNAVAILABLE,
  NEEDS_RECONNECT,
  connectPlatformFromEnv,
  isMissingPlatformAccountColumn,
  orgConnectNeedsReconnect,
} from "./connect-platform.ts";

interface OrgStripeSettings {
  stripe_publishable_key: string | null;
  stripe_account_id: string | null;
  is_connected: boolean;
  platform_account_id: string | null;
}

interface GetOrgStripeResult {
  success: boolean;
  stripe?: Stripe;
  settings?: OrgStripeSettings;
  error?: string;
  code?: typeof NEEDS_RECONNECT;
}

type ServiceClient = ReturnType<typeof createClient>;

export interface OrgConnectBlock {
  blocked: boolean;
  code?: typeof NEEDS_RECONNECT;
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
function serviceClient(): ServiceClient | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

async function loadOrgStripeRow(supabase: ServiceClient, organizationId: string) {
  const full = await supabase
    .from("org_stripe_settings")
    .select("stripe_publishable_key, stripe_account_id, is_connected, platform_account_id")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (full.error && isMissingPlatformAccountColumn(full.error)) {
    const plain = await supabase
      .from("org_stripe_settings")
      .select("stripe_publishable_key, stripe_account_id, is_connected")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (plain.error) return { row: null, error: plain.error };
    return {
      row: plain.data ? { ...plain.data, platform_account_id: null as string | null } : null,
      error: null,
    };
  }

  return { row: full.data, error: full.error };
}

/**
 * Read-only gate. Returns needs_reconnect without constructing a Stripe
 * client, so callers do not charge or list objects on a stale connection.
 */
export async function orgConnectBlock(organizationId: string): Promise<OrgConnectBlock> {
  if (!organizationId) return { blocked: false };
  const supabase = serviceClient();
  if (!supabase) return { blocked: false };

  const [{ data: secretRows, error: secretError }, settingsResult] = await Promise.all([
    supabase.rpc("get_org_stripe_secret", { p_org_id: organizationId }),
    loadOrgStripeRow(supabase, organizationId),
  ]);

  if (secretError || settingsResult.error) {
    console.error("[get-org-stripe-settings] reconnect check failed", secretError || settingsResult.error);
    return { blocked: true, error: "Failed to verify Stripe connection" };
  }

  const secretRow = Array.isArray(secretRows) ? secretRows[0] : secretRows;
  const settings = settingsResult.row;
  const needs = orgConnectNeedsReconnect({
    platformAccountId: settings?.platform_account_id ?? null,
    stripeAccountId: settings?.stripe_account_id ?? secretRow?.stripe_account_id ?? null,
    hasAccessToken: !!secretRow?.stripe_access_token,
    hasManualSecret: !!secretRow?.stripe_secret_key && !secretRow?.stripe_access_token,
  }, connectPlatformFromEnv());

  if (!needs) return { blocked: false };
  return { blocked: true, code: NEEDS_RECONNECT, error: CARD_PAYMENTS_UNAVAILABLE };
}

export async function orgReconnectResponse(
  organizationId: string,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const block = await orgConnectBlock(organizationId);
  if (!block.blocked) return null;
  return new Response(JSON.stringify({
    error: block.error,
    ...(block.code ? { status: block.code } : {}),
  }), {
    status: block.code === NEEDS_RECONNECT ? 409 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function getOrgStripeClient(organizationId: string): Promise<GetOrgStripeResult> {
  if (!organizationId) {
    return { success: false, error: "Organization ID is required" };
  }

  const supabase = serviceClient();
  if (!supabase) {
    return { success: false, error: "Supabase configuration missing" };
  }

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

  const { row: settings, error: settingsError } = await loadOrgStripeRow(supabase, organizationId);

  if (settingsError) {
    console.error("[get-org-stripe-settings] Error fetching org settings:", settingsError);
    return { success: false, error: "Failed to fetch Stripe settings" };
  }

  if (orgConnectNeedsReconnect({
    platformAccountId: settings?.platform_account_id ?? null,
    stripeAccountId: settings?.stripe_account_id ?? secretRow?.stripe_account_id ?? null,
    hasAccessToken: !!secretRow?.stripe_access_token,
    hasManualSecret: !!secretRow?.stripe_secret_key && !secretRow?.stripe_access_token,
  }, connectPlatformFromEnv())) {
    return {
      success: false,
      code: NEEDS_RECONNECT,
      error: CARD_PAYMENTS_UNAVAILABLE,
    };
  }

  try {
    const stripe = new Stripe(stripeApiKey, {
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
            platform_account_id: settings.platform_account_id ?? null,
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
