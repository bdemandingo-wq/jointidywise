// Shared: map a Stripe price id -> plan_tier used by the AI credits system.
// Returns null when the price doesn't match a known tier.
export type PlanTier = "trial" | "basic" | "pro" | "custom";

export function priceIdToPlanTier(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  const map: Record<string, PlanTier> = {};
  const add = (env: string, tier: PlanTier) => {
    const v = Deno.env.get(env);
    if (v) map[v] = tier;
  };
  add("STRIPE_BASIC_MONTHLY_PRICE_ID", "basic");
  add("STRIPE_BASIC_YEARLY_PRICE_ID", "basic");
  add("STRIPE_PRO_MONTHLY_PRICE_ID", "pro");
  add("STRIPE_PRO_YEARLY_PRICE_ID", "pro");
  add("STRIPE_CUSTOM_MONTHLY_PRICE_ID", "custom");
  add("STRIPE_CUSTOM_YEARLY_PRICE_ID", "custom");
  add("STRIPE_LIFETIME_PRICE_ID", "custom");
  return map[priceId] ?? null;
}

// Given a Stripe subscription, derive its plan_tier. Returns null if no known price.
// Uses the first known-tier line item (subscriptions typically have one).
export function subscriptionToPlanTier(subscription: any): PlanTier | null {
  const items = subscription?.items?.data ?? [];
  for (const item of items) {
    const tier = priceIdToPlanTier(item?.price?.id);
    if (tier) return tier;
  }
  return null;
}

// Update an org's plan_tier, but never downgrade a lifetime/grandfathered org.
export async function updateOrgPlanTier(
  supabase: any,
  organizationId: string,
  planTier: PlanTier,
): Promise<{ updated: boolean; skipped?: string }> {
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, plan_type, grandfathered_lifetime")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) return { updated: false, skipped: error.message || "org_read_failed" };
  if (!org) return { updated: false, skipped: "org_not_found" };
  if (org.grandfathered_lifetime || org.plan_type === "lifetime") {
    return { updated: false, skipped: "lifetime_locked" };
  }
  const { error: upErr } = await supabase
    .from("organizations")
    .update({ plan_tier: planTier })
    .eq("id", organizationId);
  if (upErr) return { updated: false, skipped: upErr.message };
  return { updated: true };
}
