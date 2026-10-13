/**
 * Device-token save retries and operator delivery.
 *
 * Run with: node --experimental-strip-types --test src/lib/pushTokenSave.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  claimPushSaveFailureToast,
  clearPushSaveFailureToast,
  persistDevicePushToken,
  PUSH_TOKEN_SAVE_FAILED_MESSAGE,
} from "./pushTokenSave.ts";
import { tokensForPush } from "../../supabase/functions/_shared/push-tokens.ts";

const OWNER = "ddf79d04-cb18-4830-ad4d-129cf3995436";
const TIDYWISE = "e95b92d0-7099-408e-a773-e4407b34f8b4";
const CLEAN_COLLECTIVE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TOKEN = "E8A46CC0ABCDEF";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("retries the save with backoff, then stops on success", async () => {
  const sleeps: number[] = [];
  let calls = 0;
  const result = await persistDevicePushToken({
    backoffMs: [0, 10, 25],
    sleep: async (ms) => { sleeps.push(ms); },
    save: async () => {
      calls += 1;
      if (calls < 3) return { ok: false, errorMessage: "duplicate key value violates unique constraint" };
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.alreadyStored, false);
  assert.deepEqual(sleeps, [10, 25]);
  assert.equal(calls, 3);
});

test("a row that already holds this token counts as saved after the writes fail", async () => {
  let confirms = 0;
  const result = await persistDevicePushToken({
    backoffMs: [0, 5],
    sleep: async () => {},
    save: async () => { throw new Error("Edge Function returned a non-2xx status code"); },
    confirmStored: async () => {
      confirms += 1;
      return true;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyStored, true);
  assert.equal(result.attempts, 2);
  assert.equal(confirms, 1);
});

test("all retries failing, and no stored row, is a real failure", async () => {
  const result = await persistDevicePushToken({
    backoffMs: [0, 5, 5],
    sleep: async () => {},
    save: async () => ({ ok: false, errorMessage: "No session" }),
    confirmStored: async () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.alreadyStored, false);
});

test("the failure toast is shown once until a save succeeds", () => {
  const storage = memoryStorage();
  assert.equal(claimPushSaveFailureToast(storage), true);
  assert.equal(claimPushSaveFailureToast(storage), false);
  clearPushSaveFailureToast(storage);
  assert.equal(claimPushSaveFailureToast(storage), true);
});

test("the failure copy does not ask the person to pull to refresh", () => {
  assert.equal(PUSH_TOKEN_SAVE_FAILED_MESSAGE.includes("Pull to refresh"), false);
  assert.match(PUSH_TOKEN_SAVE_FAILED_MESSAGE, /couldn't save this iPhone/);
});

test("one owner token reaches both companies' operator pushes, once each", () => {
  const rows = [
    { id: "1", token: TOKEN, user_id: OWNER, organization_id: TIDYWISE },
    // A duplicate row for the same phone must not send a second push.
    { id: "2", token: TOKEN, user_id: OWNER, organization_id: CLEAN_COLLECTIVE },
    { id: "3", token: "OTHER-DEVICE", user_id: "someone-else", organization_id: CLEAN_COLLECTIVE },
  ];

  const tidywise = tokensForPush({
    rows,
    organizationId: TIDYWISE,
    audience: "operators",
    operatorUserIds: [OWNER],
  });
  const collective = tokensForPush({
    rows,
    organizationId: CLEAN_COLLECTIVE,
    audience: "operators",
    operatorUserIds: [OWNER, "manager-2"],
  });

  assert.deepEqual(tidywise.map((row) => row.token), [TOKEN]);
  assert.deepEqual(collective.map((row) => row.token), [TOKEN]);
});

test("a token saved under the other company still matches operator lookup by user", () => {
  const rows = [{ token: TOKEN, user_id: OWNER, organization_id: TIDYWISE }];
  const collective = tokensForPush({
    rows,
    organizationId: CLEAN_COLLECTIVE,
    audience: "operators",
    operatorUserIds: [OWNER],
  });
  assert.equal(collective.length, 1);

  // Org broadcasts stay on the company stored on the row. Job-available
  // alerts must not also fan out to every company this person owns.
  const broadcast = tokensForPush({
    rows,
    organizationId: CLEAN_COLLECTIVE,
    audience: "org",
    operatorUserIds: [OWNER],
  });
  assert.equal(broadcast.length, 0);
});

test("staff delivery is that user's devices, deduped, not the whole company", () => {
  const rows = [
    { token: TOKEN, user_id: OWNER, organization_id: TIDYWISE },
    { token: TOKEN, user_id: "staff-user", organization_id: TIDYWISE },
    { token: "STAFF-PHONE", user_id: "staff-user", organization_id: CLEAN_COLLECTIVE },
  ];
  const staff = tokensForPush({
    rows,
    organizationId: TIDYWISE,
    audience: "org",
    operatorUserIds: [OWNER],
    staffUserId: "staff-user",
  });
  assert.deepEqual(staff.map((row) => row.token), [TOKEN, "STAFF-PHONE"]);
});

test("the hook retries saves and does not tell the user to pull to refresh", () => {
  const src = readFileSync(new URL("../hooks/usePushNotifications.ts", import.meta.url), "utf8");
  assert.equal(src.includes("Pull to refresh"), false);
  assert.match(src, /persistDevicePushToken/);
  assert.match(src, /Try again/);
  assert.match(src, /background/);
});

test("register-push-token updates an existing row instead of only inserting", () => {
  const src = readFileSync(new URL("../../supabase/functions/register-push-token/index.ts", import.meta.url), "utf8");
  assert.match(src, /\.update\(/);
  assert.match(src, /23505|duplicate key/);
  assert.equal(src.includes('onConflict: "user_id,token"'), false);
});

test("push alerts play the bundled chime, and the App target copies that file", () => {
  const sender = readFileSync(new URL("../../supabase/functions/send-push-notification/index.ts", import.meta.url), "utf8");
  assert.match(sender, /sound: "tidywise_chime\.caf"/);
  assert.equal(sender.includes('sound: "default"'), false);

  const project = readFileSync(new URL("../../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
  const resources = project.slice(project.indexOf("504EC3021FED79650016851F /* Resources */"));
  assert.match(resources, /tidywise_chime\.caf in Resources/);

  const caf = readFileSync(new URL("../../ios/App/App/tidywise_chime.caf", import.meta.url));
  assert.equal(caf.subarray(0, 4).toString(), "caff");
  // Linear PCM, little-endian 16-bit mono. flags bit 1 is little-endian.
  const flags = caf.readUInt32BE(8 + 12 + 12);
  const channels = caf.readUInt32BE(8 + 12 + 24);
  const bits = caf.readUInt32BE(8 + 12 + 28);
  assert.equal(caf.subarray(8 + 12 + 8, 8 + 12 + 12).toString(), "lpcm");
  assert.equal(flags & 2, 2);
  assert.equal(channels, 1);
  assert.equal(bits, 16);
  assert.ok(caf.length < 500_000);
});

test("send-push uses user_id for operators and dedupes the token", () => {
  const src = readFileSync(new URL("../../supabase/functions/send-push-notification/index.ts", import.meta.url), "utf8");
  assert.match(src, /tokensForPush/);
  assert.match(src, /\.in\("user_id", targetUserIds\)/);
  const timeOff = readFileSync(new URL("../../supabase/functions/notify-time-off-request/index.ts", import.meta.url), "utf8");
  assert.match(timeOff, /audience: "operators"/);
});
