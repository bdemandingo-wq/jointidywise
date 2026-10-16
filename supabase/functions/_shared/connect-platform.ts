/**
 * Stripe Connect platform binding.
 *
 * Org OAuth connections and cleaner Express accounts are created under one
 * platform Stripe account. STRIPE_PLATFORM_ACCOUNT_ID is that account's
 * acct_… id. STRIPE_CONNECT_PLATFORM_SWITCHED is the cutover flag.
 *
 * A stored platform_account_id that differs from the current one needs a
 * reconnect. A null stored id needs a reconnect only after the switch flag
 * is on, so rows connected before this column existed keep working until
 * the owner flips the flag. Manual API keys are the business's own Stripe
 * account and are not platform-bound.
 *
 * This module does not call Stripe and does not read Deno unless
 * connectPlatformFromEnv() is called.
 */

export const NEEDS_RECONNECT = "needs_reconnect";

export const CARD_PAYMENTS_UNAVAILABLE = "Card payments unavailable";

export const PLATFORM_ACCOUNT_ID_ENV = "STRIPE_PLATFORM_ACCOUNT_ID";

export const PLATFORM_SWITCH_ENV = "STRIPE_CONNECT_PLATFORM_SWITCHED";

export interface ConnectPlatformConfig {
  platformAccountId: string | null;
  switched: boolean;
}

export function parseSwitchFlag(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function readConnectPlatformConfig(env: {
  platformAccountId?: string | null;
  switchFlag?: string | null;
}): ConnectPlatformConfig {
  const platformAccountId = (env.platformAccountId ?? "").trim() || null;
  return {
    platformAccountId,
    switched: parseSwitchFlag(env.switchFlag),
  };
}

export function connectPlatformFromEnv(): ConnectPlatformConfig {
  const read = (name: string): string | undefined => {
    const deno = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno;
    return deno?.env?.get?.(name);
  };
  return readConnectPlatformConfig({
    platformAccountId: read(PLATFORM_ACCOUNT_ID_ENV),
    switchFlag: read(PLATFORM_SWITCH_ENV),
  });
}

/**
 * True when a platform-bound connection must not be charged or paid.
 * Unset current platform id is not a mismatch: the owner has not named an
 * account yet. A stored id still has to match once one is named.
 */
export function connectNeedsReconnect(
  storedPlatformAccountId: string | null | undefined,
  config: ConnectPlatformConfig,
): boolean {
  const stored = (storedPlatformAccountId ?? "").trim();
  const current = config.platformAccountId;
  if (stored && current && stored !== current) return true;
  if (!stored && config.switched) return true;
  return false;
}

export function orgConnectNeedsReconnect(
  input: {
    platformAccountId?: string | null;
    stripeAccountId?: string | null;
    hasAccessToken?: boolean;
    hasManualSecret?: boolean;
  },
  config: ConnectPlatformConfig,
): boolean {
  const accountId = (input.stripeAccountId ?? "").trim();
  const platformBound = accountId.length > 0 || input.hasAccessToken === true;
  if (!platformBound) return false;
  return connectNeedsReconnect(input.platformAccountId, config);
}

export function staffConnectNeedsReconnect(
  storedPlatformAccountId: string | null | undefined,
  stripeAccountId: string | null | undefined,
  config: ConnectPlatformConfig,
): boolean {
  if (!(stripeAccountId ?? "").trim()) return false;
  return connectNeedsReconnect(storedPlatformAccountId, config);
}

export function isMissingPlatformAccountColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  if (!/platform_account_id/i.test(message)) return false;
  return error.code === "42703"
    || error.code === "PGRST204"
    || /does not exist|schema cache|could not find/i.test(message);
}

/**
 * Billing stays on its own Stripe account when the Connect secret moves.
 * Explicit STRIPE_BILLING_SECRET_KEY always wins. The Connect secret is a
 * fallback only while the platform switch flag is off.
 */
export function selectBillingSecret(input: {
  billingSecret?: string | null;
  connectSecret?: string | null;
  switched: boolean;
}): string {
  const billing = (input.billingSecret ?? "").trim();
  if (billing) return billing;
  if (input.switched) return "";
  return (input.connectSecret ?? "").trim();
}

export function selectBillingPublishableKey(input: {
  billingPublishable?: string | null;
  connectPublishable?: string | null;
  switched: boolean;
}): string | null {
  const billing = (input.billingPublishable ?? "").trim();
  const fallback = input.switched ? "" : (input.connectPublishable ?? "").trim();
  const key = billing || fallback;
  if (key.startsWith("pk_test_") || key.startsWith("pk_live_")) return key;
  return null;
}

/**
 * Backfill may use a restricted read key on the billing account.
 * STRIPE_SECRET_KEY is not that key once the Connect platform has switched.
 */
export function selectBackfillReadKey(input: {
  billingSecret?: string | null;
  backfillReadKey?: string | null;
  connectSecret?: string | null;
  switched: boolean;
}): string {
  const billing = (input.billingSecret ?? "").trim();
  if (billing) return billing;
  const backfill = (input.backfillReadKey ?? "").trim();
  if (backfill) return backfill;
  if (input.switched) return "";
  return (input.connectSecret ?? "").trim();
}

type QueryError = { code?: string; message?: string } | null;

export async function platformAccountColumnReady(
  query: () => Promise<{ error: QueryError }>,
): Promise<boolean> {
  const { error } = await query();
  if (!error) return true;
  return !isMissingPlatformAccountColumn(error);
}

export async function writeRowRetryWithoutPlatform(
  write: (row: Record<string, unknown>) => Promise<{ error: QueryError }>,
  row: Record<string, unknown>,
): Promise<{ error: QueryError }> {
  const first = await write(row);
  if (first.error && isMissingPlatformAccountColumn(first.error) && "platform_account_id" in row) {
    const rest = { ...row };
    delete rest.platform_account_id;
    return write(rest);
  }
  return first;
}
