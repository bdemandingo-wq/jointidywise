/**
 * Columns the org bundle must read. grandfathered_lifetime is a real
 * organizations column (generated types and the pricing-tier migration).
 * Both bundle queries select this list, so a grandfathered account is
 * not dropped by organizations(*).
 *
 * A scan of src for organization.<field> reads, including the plan_type
 * cast in useReferrals, found only id, name, slug, logo_url, owner_id,
 * needs_onboarding, created_at, plan_type, and grandfathered_lifetime.
 * No timezone, Stripe id, or settings blob is read off this object.
 */
export const ORG_BUNDLE_COLUMNS = [
  "id",
  "name",
  "slug",
  "logo_url",
  "owner_id",
  "needs_onboarding",
  "created_at",
  "plan_type",
  "grandfathered_lifetime",
] as const;

/** Literal so the generated client parses grandfathered_lifetime as a real column. */
export const ORG_BUNDLE_SELECT =
  "id,name,slug,logo_url,owner_id,needs_onboarding,created_at,plan_type,grandfathered_lifetime" as const;

export const ORG_MEMBERSHIP_SELECT =
  "organization_id,role,organizations(id,name,slug,logo_url,owner_id,needs_onboarding,created_at,plan_type,grandfathered_lifetime)" as const;

export function orgBundleSelect(): string {
  return ORG_BUNDLE_SELECT;
}

export function readGrandfatheredLifetime(value: unknown): boolean {
  return value === true;
}
