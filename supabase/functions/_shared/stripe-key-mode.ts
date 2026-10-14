/**
 * Prefix check for a Stripe secret. check-subscription passes the billing key.
 * Does not read, log, or change the key.
 * Keep identical to stripeKeyMode() in src/lib/stripeMode.ts.
 */
export type StripeKeyMode = "live" | "test" | "unset" | "unknown";

export function stripeKeyMode(secret: string | null | undefined): StripeKeyMode {
  if (!secret || !secret.trim()) return "unset";
  const key = secret.trim();
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unknown";
}
