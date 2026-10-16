import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CARD_PAYMENTS_UNAVAILABLE,
  NEEDS_RECONNECT,
  PLATFORM_ACCOUNT_UNSET_ERROR,
  connectNeedsReconnect,
  connectSecretExcludedFromBilling,
  isMissingPlatformAccountColumn,
  orgConnectNeedsReconnect,
  parseSwitchFlag,
  platformAccountColumnReady,
  platformAccountIdFromKey,
  platformAccountRequiredError,
  readConnectPlatformConfig,
  readKeyPlatformAccountId,
  selectBackfillReadKey,
  selectBillingPublishableKey,
  selectBillingSecret,
  staffConnectNeedsReconnect,
  writeRowRetryWithoutPlatform,
} from "./connect-platform.ts";

const current = readConnectPlatformConfig({
  platformAccountId: "acct_new",
  switchFlag: "false",
});

const switched = readConnectPlatformConfig({
  platformAccountId: "acct_new",
  switchFlag: "true",
});

test("needs_reconnect when the stored platform account does not match", () => {
  assert.equal(connectNeedsReconnect("acct_old", current), true);
  assert.equal(connectNeedsReconnect("acct_new", current), false);
  assert.equal(connectNeedsReconnect("  acct_new  ", current), false);
});

test("null platform_account_id needs reconnect only after the switch flag", () => {
  assert.equal(connectNeedsReconnect(null, current), false);
  assert.equal(connectNeedsReconnect(undefined, current), false);
  assert.equal(connectNeedsReconnect("  ", current), false);
  assert.equal(connectNeedsReconnect(null, switched), true);
  assert.equal(connectNeedsReconnect("", switched), true);
});

test("a stored id with no current platform configured is not a mismatch", () => {
  const unnamed = readConnectPlatformConfig({ platformAccountId: "  ", switchFlag: "" });
  assert.equal(connectNeedsReconnect("acct_old", unnamed), false);
  assert.equal(connectNeedsReconnect(null, unnamed), false);
});

test("switch flag accepts true, 1, yes, and on", () => {
  for (const value of ["true", "TRUE", "1", " yes ", "on"]) {
    assert.equal(parseSwitchFlag(value), true, value);
  }
  for (const value of ["", "false", "0", "off", "no", null, undefined]) {
    assert.equal(parseSwitchFlag(value), false, String(value));
  }
});

test("org OAuth connections reconnect; manual keys do not", () => {
  const oauth = {
    platformAccountId: null,
    stripeAccountId: "acct_connected",
    hasAccessToken: true,
    hasManualSecret: true,
  };
  assert.equal(orgConnectNeedsReconnect(oauth, switched), true);
  assert.equal(orgConnectNeedsReconnect({ ...oauth, platformAccountId: "acct_new" }, switched), false);
  assert.equal(orgConnectNeedsReconnect({ ...oauth, platformAccountId: "acct_old" }, current), true);

  const manual = {
    platformAccountId: null,
    stripeAccountId: null,
    hasAccessToken: false,
    hasManualSecret: true,
  };
  assert.equal(orgConnectNeedsReconnect(manual, switched), false);

  assert.equal(orgConnectNeedsReconnect({
    platformAccountId: null,
    stripeAccountId: null,
    hasAccessToken: false,
    hasManualSecret: false,
  }, switched), false);
});

test("staff Express accounts reconnect; a cleaner who never started does not", () => {
  assert.equal(staffConnectNeedsReconnect(null, null, switched), false);
  assert.equal(staffConnectNeedsReconnect(null, "acct_express", current), false);
  assert.equal(staffConnectNeedsReconnect(null, "acct_express", switched), true);
  assert.equal(staffConnectNeedsReconnect("acct_old", "acct_express", current), true);
  assert.equal(staffConnectNeedsReconnect("acct_new", "acct_express", switched), false);
});

test("status string and invoice copy stay stable", () => {
  assert.equal(NEEDS_RECONNECT, "needs_reconnect");
  assert.equal(CARD_PAYMENTS_UNAVAILABLE, "Card payments unavailable");
  const ui = readFileSync(new URL("../../../src/lib/invoiceCardPayments.ts", import.meta.url), "utf8");
  assert.match(ui, /Card payments unavailable/);
});

test("billing drops the Connect secret once a platform account id is set", () => {
  assert.equal(connectSecretExcludedFromBilling({ switched: false, platformAccountId: "acct_new" }), true);
  assert.equal(connectSecretExcludedFromBilling({ switched: true, platformAccountId: null }), true);
  assert.equal(connectSecretExcludedFromBilling({ switched: false, platformAccountId: "  " }), false);
  assert.equal(connectSecretExcludedFromBilling({ switched: false, platformAccountId: null }), false);

  assert.equal(selectBillingSecret({
    billingSecret: "",
    connectSecret: "sk_test_connect",
    switched: false,
    platformAccountId: "acct_new",
  }), "");
  assert.equal(selectBillingSecret({
    billingSecret: "sk_test_billing",
    connectSecret: "sk_test_connect",
    switched: false,
    platformAccountId: "acct_new",
  }), "sk_test_billing");
  assert.equal(selectBillingPublishableKey({
    billingPublishable: "",
    connectPublishable: "pk_test_connect",
    switched: false,
    platformAccountId: "acct_new",
  }), null);
  assert.equal(selectBackfillReadKey({
    billingSecret: "",
    backfillReadKey: "",
    connectSecret: "sk_test_connect",
    switched: false,
    platformAccountId: "acct_new",
  }), "");
  assert.equal(selectBackfillReadKey({
    billingSecret: "",
    backfillReadKey: "rk_test_backfill",
    connectSecret: "sk_test_connect",
    switched: false,
    platformAccountId: "acct_new",
  }), "rk_test_backfill");
});

test("billing prefers an explicit key and drops the Connect fallback after the switch", () => {
  assert.equal(selectBillingSecret({
    billingSecret: "sk_test_billing",
    connectSecret: "sk_test_connect",
    switched: true,
  }), "sk_test_billing");
  assert.equal(selectBillingSecret({
    billingSecret: "",
    connectSecret: "sk_test_connect",
    switched: false,
  }), "sk_test_connect");
  assert.equal(selectBillingSecret({
    billingSecret: "  ",
    connectSecret: "sk_live_connect",
    switched: true,
  }), "");
});

test("billing publishable key does not follow the Connect key after the switch", () => {
  assert.equal(selectBillingPublishableKey({
    billingPublishable: "pk_test_billing",
    connectPublishable: "pk_test_connect",
    switched: true,
  }), "pk_test_billing");
  assert.equal(selectBillingPublishableKey({
    billingPublishable: "",
    connectPublishable: "pk_live_connect",
    switched: false,
  }), "pk_live_connect");
  assert.equal(selectBillingPublishableKey({
    billingPublishable: "",
    connectPublishable: "pk_live_connect",
    switched: true,
  }), null);
  assert.equal(selectBillingPublishableKey({
    billingPublishable: "not-a-key",
    connectPublishable: "pk_test_connect",
    switched: false,
  }), null);
});

test("backfill keeps its restricted key and stops using the Connect secret after the switch", () => {
  assert.equal(selectBackfillReadKey({
    billingSecret: "",
    backfillReadKey: "rk_test_backfill",
    connectSecret: "sk_test_connect",
    switched: true,
  }), "rk_test_backfill");
  assert.equal(selectBackfillReadKey({
    billingSecret: "sk_test_billing",
    backfillReadKey: "rk_test_backfill",
    connectSecret: "sk_test_connect",
    switched: true,
  }), "sk_test_billing");
  assert.equal(selectBackfillReadKey({
    billingSecret: "",
    backfillReadKey: "",
    connectSecret: "sk_test_connect",
    switched: false,
  }), "sk_test_connect");
  assert.equal(selectBackfillReadKey({
    billingSecret: "",
    backfillReadKey: "",
    connectSecret: "sk_test_connect",
    switched: true,
  }), "");
});

test("a missing platform_account_id column is recognizable and writes can retry without it", async () => {
  assert.equal(isMissingPlatformAccountColumn(null), false);
  assert.equal(isMissingPlatformAccountColumn({ code: "42501", message: "permission denied" }), false);
  assert.equal(isMissingPlatformAccountColumn({
    code: "42703",
    message: "column platform_account_id does not exist",
  }), true);
  assert.equal(isMissingPlatformAccountColumn({
    code: "PGRST204",
    message: "Could not find the 'platform_account_id' column of 'org_stripe_settings' in the schema cache",
  }), true);

  const writes: Record<string, unknown>[] = [];
  const result = await writeRowRetryWithoutPlatform(async (row) => {
    writes.push(row);
    if ("platform_account_id" in row) {
      return { error: { code: "42703", message: "column platform_account_id does not exist" } };
    }
    return { error: null };
  }, { organization_id: "org", platform_account_id: "acct_new", is_connected: true });

  assert.equal(result.error, null);
  assert.equal(writes.length, 2);
  assert.equal("platform_account_id" in writes[1], false);
  assert.equal(await platformAccountColumnReady(async () => ({ error: null })), true);
  assert.equal(await platformAccountColumnReady(async () => ({
    error: { code: "42703", message: "column platform_account_id does not exist" },
  })), false);
});

test("platform stamp uses the key account and refuses a different named account", () => {
  const unnamed = readConnectPlatformConfig({ platformAccountId: "", switchFlag: "false" });
  const named = readConnectPlatformConfig({ platformAccountId: "acct_new", switchFlag: "false" });
  const switchedUnnamed = readConnectPlatformConfig({ platformAccountId: "", switchFlag: "true" });

  assert.equal(platformAccountRequiredError(unnamed), null);
  assert.equal(platformAccountRequiredError(switchedUnnamed), PLATFORM_ACCOUNT_UNSET_ERROR);

  const fromKey = platformAccountIdFromKey({
    retrievedAccountId: " acct_key ",
    config: unnamed,
    nothingVerb: "saved",
  });
  assert.deepEqual(fromKey, { ok: true, platformAccountId: "acct_key" });

  const match = platformAccountIdFromKey({ retrievedAccountId: "acct_new", config: named });
  assert.deepEqual(match, { ok: true, platformAccountId: "acct_new" });

  const mismatch = platformAccountIdFromKey({
    retrievedAccountId: "acct_other",
    config: named,
    nothingVerb: "created",
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.match(mismatch.error, /acct_other/);
    assert.match(mismatch.error, /acct_new/);
    assert.match(mismatch.error, /Nothing was created/);
  }

  const missing = platformAccountIdFromKey({ retrievedAccountId: "  ", config: unnamed, nothingVerb: "saved" });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /Nothing was saved/);

  const flagOn = platformAccountIdFromKey({ retrievedAccountId: "acct_key", config: switchedUnnamed });
  assert.deepEqual(flagOn, { ok: false, error: PLATFORM_ACCOUNT_UNSET_ERROR });
});

test("key retrieve is skipped when the flag is on and the platform id is unset", async () => {
  let called = false;
  const switchedUnnamed = readConnectPlatformConfig({ platformAccountId: "", switchFlag: "on" });
  const blocked = await readKeyPlatformAccountId(async () => {
    called = true;
    return { id: "acct_key" };
  }, switchedUnnamed, "created");
  assert.equal(called, false);
  assert.deepEqual(blocked, { ok: false, error: PLATFORM_ACCOUNT_UNSET_ERROR });

  const named = readConnectPlatformConfig({ platformAccountId: "acct_new", switchFlag: "false" });
  const refused = await readKeyPlatformAccountId(async () => ({ id: "acct_other" }), named, "saved");
  assert.equal(refused.ok, false);

  const stamped = await readKeyPlatformAccountId(async () => ({ id: "acct_from_key" }), readConnectPlatformConfig({
    platformAccountId: "",
    switchFlag: "false",
  }), "saved");
  assert.deepEqual(stamped, { ok: true, platformAccountId: "acct_from_key" });

  const failed = await readKeyPlatformAccountId(async () => {
    throw new Error("network");
  }, named, "created");
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /Nothing was created/);
});

test("connect writes stamp the retrieved account and disputes use the billing key", () => {
  const oauth = readFileSync(new URL("../stripe-connect-oauth/index.ts", import.meta.url), "utf8");
  const staff = readFileSync(new URL("../create-staff-connect-account/index.ts", import.meta.url), "utf8");
  const reset = readFileSync(new URL("../reset-stripe-connect/index.ts", import.meta.url), "utf8");
  for (const src of [oauth, staff, reset]) {
    assert.match(src, /readKeyPlatformAccountId/);
    assert.match(src, /accounts\.retrieve\(\s*\)/);
    assert.match(src, /platform_account_id: stamped\.platformAccountId/);
    assert.doesNotMatch(src, /platform_account_id: platform\.platformAccountId/);
  }
  assert.match(oauth, /platformAccountRequiredError\(connectPlatformFromEnv\(\)\)/);

  for (const name of ["sync-dispute-status", "get-dispute-evidence", "submit-dispute-evidence"]) {
    const src = readFileSync(new URL(`../${name}/index.ts`, import.meta.url), "utf8");
    assert.match(src, /billingSecretKey\(/);
    assert.doesNotMatch(src, /Deno\.env\.get\(["']STRIPE_SECRET_KEY["']\)/);
  }
});

test("migration adds platform_account_id and does not backfill or call Stripe", () => {
  const sql = readFileSync(
    new URL("../../migrations/20261016183000_stripe_connect_platform_account.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ALTER TABLE public\.org_stripe_settings\s+ADD COLUMN IF NOT EXISTS platform_account_id text/);
  assert.match(sql, /ALTER TABLE public\.staff_payout_accounts\s+ADD COLUMN IF NOT EXISTS platform_account_id text/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.org_stripe_settings/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.staff_payout_accounts/i);
  assert.doesNotMatch(sql, /GRANT EXECUTE/i);
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
});
