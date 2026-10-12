/**
 * Name shown in the admin sidebar.
 *
 * Provisioning creates "Jane's Business" / "My Cleaning Business" before the
 * owner types a real name, and business_settings.company_name defaults to
 * "My Business". A placeholder must not beat the name they actually saved.
 */
const PLACEHOLDERS = new Set([
  "my business",
  "my booking business",
  "my cleaning business",
]);

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isPlaceholder(value: string): boolean {
  return value.length === 0 || PLACEHOLDERS.has(value.toLowerCase());
}

export function displayBusinessName(
  orgName: string | null | undefined,
  companyName: string | null | undefined,
): string {
  const org = clean(orgName);
  const company = clean(companyName);
  if (!isPlaceholder(company)) return company;
  if (!isPlaceholder(org)) return org;
  return company || org || "Your business";
}
