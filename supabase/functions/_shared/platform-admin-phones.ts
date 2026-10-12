// Platform-owner SMS recipients.
//
// Set PLATFORM_ADMIN_PHONES to a comma-separated E.164 list
// (example: +15551234567,+15557654321) to rotate who receives founder
// alerts without a code change. Until that secret is set, the historical
// recipients stay in place so deploys do not silently drop signup,
// billing, and demo alerts.

const FALLBACK_PHONES = ["+15615718725", "+18137356859"] as const;

function parsePhones(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const phone = part.trim();
    if (/^\+\d{10,15}$/.test(phone) && !out.includes(phone)) out.push(phone);
  }
  return out;
}

/** Every platform-admin phone. Env overrides the fallback entirely. */
export function platformAdminPhones(): string[] {
  const fromEnv = parsePhones(Deno.env.get("PLATFORM_ADMIN_PHONES"));
  if (fromEnv.length > 0) return fromEnv;
  return [...FALLBACK_PHONES];
}

/**
 * The phone a function used when it alerted only one of the two founders.
 * `primary` is the first fallback number, `secondary` the second.
 * A configured PLATFORM_ADMIN_PHONES list replaces both: primary is the
 * first entry, secondary the second (or the first, if only one is set).
 */
export function platformAdminPhone(which: "primary" | "secondary" = "primary"): string {
  const phones = platformAdminPhones();
  if (Deno.env.get("PLATFORM_ADMIN_PHONES")?.trim()) {
    if (which === "secondary") return phones[1] ?? phones[0];
    return phones[0];
  }
  return which === "secondary" ? FALLBACK_PHONES[1] : FALLBACK_PHONES[0];
}
