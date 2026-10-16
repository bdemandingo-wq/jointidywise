import { supabase } from "@/lib/supabase";
import { readEdgeFunctionError } from "@/lib/edgeFunctionError";
import { invoiceNeedsReconnect, stripeConnectAvailable } from "@/lib/invoiceCardPayments";

export interface OrgStripeStatus {
  connected: boolean;
  needs_reconnect: boolean;
  available: boolean;
  connected_at: string | null;
  payouts_enabled: boolean | null;
}

/**
 * Owner-facing Stripe status. skip_refresh avoids a Stripe API call.
 * needs_reconnect comes back as connected: false from stripe-connect-oauth.
 */
export async function fetchOrgStripeStatus(organizationId: string): Promise<OrgStripeStatus> {
  const { data, error } = await supabase.functions.invoke("stripe-connect-oauth", {
    body: { action: "get_status", organization_id: organizationId, skip_refresh: true },
  });
  if (error) {
    throw new Error(await readEdgeFunctionError(error, "Could not check whether Stripe is connected."));
  }
  if (data?.error) {
    throw new Error(String(data.error));
  }
  const needsReconnect = invoiceNeedsReconnect(data);
  const connected = data?.connected === true && !needsReconnect;
  return {
    connected,
    needs_reconnect: needsReconnect,
    available: stripeConnectAvailable(data),
    connected_at: typeof data?.connected_at === "string" ? data.connected_at : null,
    payouts_enabled: typeof data?.payouts_enabled === "boolean" ? data.payouts_enabled : null,
  };
}
