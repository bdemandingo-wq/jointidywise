/**
 * Pure demo-send decision. No Deno, no network. Edge helpers and the
 * boundary test both import this so the rule stays in one place.
 *
 * A send is blocked when the organization has demo mode on, when the
 * organization id is the in-memory Harbor & Pine preview, or when a
 * recipient is sample data. Sample rows are never a send target.
 */

export const DEMO_ORG_ID = "d00000de-0000-4000-8000-000000000001";

export function isKnownDemoOrganization(organizationId: string | null | undefined): boolean {
  return organizationId === DEMO_ORG_ID;
}

/** Sample customers, staff, and leads from the in-browser demo dataset. */
export function isSampleSendTarget(value: string | null | undefined): boolean {
  if (!value) return false;
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (text.endsWith("@example.com") || text.endsWith("@harborpine.example")) return true;
  const digits = text.replace(/\D/g, "");
  // Harbor & Pine phones are 512-555-01xx and 512-555-2xxx. 555-01xx is the
  // fictional NANP range. A broader "contains 555" match would catch real numbers.
  if (digits.includes("512555")) return true;
  if (/55501\d{2}$/.test(digits)) return true;
  return false;
}

export function demoSendBlockReason(input: {
  organizationId?: string | null;
  demoModeEnabled?: boolean | null;
  recipients?: Array<string | null | undefined>;
}): string | null {
  if (input.demoModeEnabled) return "demo_mode_enabled";
  if (isKnownDemoOrganization(input.organizationId)) return "demo_org";
  if ((input.recipients ?? []).some((recipient) => isSampleSendTarget(recipient))) {
    return "sample_recipient";
  }
  return null;
}
