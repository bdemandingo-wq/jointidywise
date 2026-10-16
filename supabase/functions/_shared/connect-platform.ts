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
 * New connections store the account id of the secret key that created them
 * (stripe.accounts.retrieve with no id). STRIPE_PLATFORM_ACCOUNT_ID, when
 * set, must equal that id. This module does not call Stripe itself and
 * does not read Deno unless connectPlatformFromEnv() is called.
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
 * True once STRIPE_SECRET_KEY must not be used for billing. Naming
 * STRIPE_PLATFORM_ACCOUNT_ID is enough: the Connect secret may already
 * have been swapped, even while the switch flag is still off.
 */
export function connectSecretExcludedFromBilling(input: {
  switched: boolean;
  platformAccountId?: string | null;
}): boolean {
  if (input.switched) return true;
  return (input.platformAccountId ?? "").trim().length > 0;
}

/**
 * Billing stays on its own Stripe account when the Connect secret moves.
 * Explicit STRIPE_BILLING_SECRET_KEY always wins. The Connect secret is a
 * fallback only while no platform account id is set and the switch flag
 * is off.
 */
export function selectBillingSecret(input: {
  billingSecret?: string | null;
  connectSecret?: string | null;
  switched: boolean;
  platformAccountId?: string | null;
}): string {
  const billing = (input.billingSecret ?? "").trim();
  if (billing) return billing;
  if (connectSecretExcludedFromBilling(input)) return "";
  return (input.connectSecret ?? "").trim();
}

export function selectBillingPublishableKey(input: {
  billingPublishable?: string | null;
  connectPublishable?: string | null;
  switched: boolean;
  platformAccountId?: string | null;
}): string | null {
  const billing = (input.billingPublishable ?? "").trim();
  const fallback = connectSecretExcludedFromBilling(input) ? "" : (input.connectPublishable ?? "").trim();
  const key = billing || fallback;
  if (key.startsWith("pk_test_") || key.startsWith("pk_live_")) return key;
  return null;
}

/**
 * Backfill may use a restricted read key on the billing account.
 * STRIPE_SECRET_KEY is not that key once a platform account id is set
 * or the Connect platform has switched.
 */
export function selectBackfillReadKey(input: {
  billingSecret?: string | null;
  backfillReadKey?: string | null;
  connectSecret?: string | null;
  switched: boolean;
  platformAccountId?: string | null;
}): string {
  const billing = (input.billingSecret ?? "").trim();
  if (billing) return billing;
  const backfill = (input.backfillReadKey ?? "").trim();
  if (backfill) return backfill;
  if (connectSecretExcludedFromBilling(input)) return "";
  return (input.connectSecret ?? "").trim();
}

export const PLATFORM_ACCOUNT_UNSET_ERROR =
  "STRIPE_PLATFORM_ACCOUNT_ID is not set. Nothing was created.";

/**
 * OAuth and Express creation refuse when the switch flag is on and the
 * platform account has not been named. Returns null when the request may
 * continue. Does not call Stripe.
 */
export function platformAccountRequiredError(config: ConnectPlatformConfig): string | null {
  if (config.switched && !config.platformAccountId) return PLATFORM_ACCOUNT_UNSET_ERROR;
  return null;
}

export type PlatformStampResult =
  | { ok: true; platformAccountId: string }
  | { ok: false; error: string };

/**
 * platform_account_id is the account that owns the secret key, from
 * stripe.accounts.retrieve() with no account id. When
 * STRIPE_PLATFORM_ACCOUNT_ID is set, a different retrieved id is refused
 * and nothing is written. The env value is not used as a substitute, so
 * the stamp does not depend on setting that variable first.
 */
export function platformAccountIdFromKey(input: {
  retrievedAccountId?: string | null;
  config: ConnectPlatformConfig;
  nothingVerb?: "created" | "saved";
}): PlatformStampResult {
  const required = platformAccountRequiredError(input.config);
  if (required) return { ok: false, error: required };
  const verb = input.nothingVerb ?? "saved";
  const retrieved = (input.retrievedAccountId ?? "").trim();
  if (!retrieved) {
    return { ok: false, error: `Could not read the Stripe account for this key. Nothing was ${verb}.` };
  }
  const expected = input.config.platformAccountId;
  if (expected && retrieved !== expected) {
    return {
      ok: false,
      error: `STRIPE_SECRET_KEY belongs to ${retrieved}, which is not STRIPE_PLATFORM_ACCOUNT_ID (${expected}). Nothing was ${verb}.`,
    };
  }
  return { ok: true, platformAccountId: retrieved };
}

/**
 * Reads the key's own account, then applies platformAccountIdFromKey.
 * Does not call retrieve when the switch flag is on and the platform id
 * is unset. The caller passes stripe.accounts.retrieve with no id.
 */
export async function readKeyPlatformAccountId(
  retrieveOwnAccount: () => Promise<{ id?: string | null } | null>,
  config: ConnectPlatformConfig,
  nothingVerb: "created" | "saved" = "saved",
): Promise<PlatformStampResult> {
  const required = platformAccountRequiredError(config);
  if (required) return { ok: false, error: required };
  let retrieved: string | null = null;
  try {
    const account = await retrieveOwnAccount();
    retrieved = account?.id ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "retrieve failed";
    console.error("[connect-platform] could not retrieve the key account:", message);
    return {
      ok: false,
      error: `Could not read the Stripe account for this key. Nothing was ${nothingVerb}.`,
    };
  }
  return platformAccountIdFromKey({
    retrievedAccountId: retrieved,
    config,
    nothingVerb,
  });
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
