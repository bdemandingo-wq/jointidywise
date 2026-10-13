import { useAuth } from "@/hooks/useAuth";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { supabase } from "@/lib/supabase";
import {
  isLifetimePlan,
  loyaltyPlanOf,
  quoteLoyaltyPrice,
  type LoyaltyQuote,
} from "../../supabase/functions/_shared/loyalty-pricing";

export interface LoyaltyPricingRow {
  organization_id: string;
  continuous_since: string | null;
  plan: string | null;
  billing_interval: string | null;
}

/**
 * The loyalty table ships in a separate migration from the web app. Until
 * that migration has run, PostgREST reports a missing relation. That is the
 * feature not being live yet, which is different from a failed read of a
 * table that exists.
 */
export function loyaltyTableNotLive(error: Error | null): boolean {
  if (!error) return false;
  return /org_subscription_loyalty|schema cache|does not exist|PGRST205|42P01/i.test(error.message);
}

export function useLoyaltyPricing() {
  const { subscription } = useAuth();
  const lifetime = isLifetimePlan({ productId: subscription?.product_id });
  const query = useOrgQuery<LoyaltyPricingRow>({
    key: ["org-subscription-loyalty"],
    query: async (organizationId) => {
      const { data, error } = await supabase
        .from("org_subscription_loyalty")
        .select("organization_id, continuous_since, plan, billing_interval")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data ? [data] : [];
    },
  });

  const row = query.rows[0] ?? null;
  const plan = loyaltyPlanOf(row?.plan, row?.billing_interval);
  const quote: LoyaltyQuote | null = !lifetime && plan && row?.continuous_since
    ? quoteLoyaltyPrice(plan, row.continuous_since, new Date().toISOString())
    : null;

  return { ...query, quote, tableNotLive: loyaltyTableNotLive(query.error) };
}

export type LoyaltyPricingState = ReturnType<typeof useLoyaltyPricing>;
