/**
 * Drop an organization to the free plan when Stripe deletes its subscription.
 *
 * The exclusion is on the UPDATE itself. A prior read would race with the
 * lifetime purchase path and could still write plan_type free.
 *
 * - plan_type lifetime never matches (.neq)
 * - grandfathered_lifetime true never matches
 * - grandfathered_lifetime null still matches, so a normal org with a null
 *   flag is downgraded. .neq on the boolean would drop those rows, because
 *   NULL <> true is unknown in SQL.
 */
/** Rows that are not grandfathered, including a null flag. */
export const EXCLUDE_GRANDFATHERED_LIFETIME =
  "grandfathered_lifetime.is.null,grandfathered_lifetime.eq.false";

export interface PlanDowngradeResult {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

/** Chain the webhook's service-role client actually uses for this update. */
export interface PlanDowngradeUpdate {
  eq(column: string, value: string): PlanDowngradeUpdate;
  neq(column: string, value: string): PlanDowngradeUpdate;
  or(filters: string): PlanDowngradeUpdate;
  select(columns: string): PromiseLike<PlanDowngradeResult>;
}

export interface PlanDowngradeClient {
  from(table: string): {
    update(values: { plan_type: "free" }): PlanDowngradeUpdate;
  };
}

export async function downgradeOrgOnSubscriptionDeleted(
  // The generated service-role client is not assignable to PlanDowngradeClient
  // (PostgrestFilterBuilder's generics). Same escape as updateOrgPlanTier.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  organizationId: string,
): Promise<{ downgraded: boolean; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("organizations")
    .update({ plan_type: "free" })
    .eq("id", organizationId)
    .neq("plan_type", "lifetime")
    .or(EXCLUDE_GRANDFATHERED_LIFETIME)
    .select("id");

  if (error) return { downgraded: false, error };
  return { downgraded: Array.isArray(data) && data.length > 0, error: null };
}
