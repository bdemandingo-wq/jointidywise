import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ALLOWED_FILE,
  findOpenPhoneMessageEndpointViolations,
} from "./check-openphone-messages-endpoint.mjs";

const ENDPOINT = ["https://api.openphone.com", "v1", "messages"].join("/");

test("the repository names the OpenPhone messages endpoint only in send-sms.ts", () => {
  assert.deepEqual(findOpenPhoneMessageEndpointViolations(process.cwd()), []);
});

test("a messages call outside the shared sender fails the check", () => {
  const root = mkdtempSync(join(tmpdir(), "sms-endpoint-"));
  mkdirSync(join(root, "supabase/functions/_shared"), { recursive: true });
  writeFileSync(join(root, ALLOWED_FILE), `export const URL = "${ENDPOINT}";\n`);
  writeFileSync(join(root, "direct.ts"), `await fetch("${ENDPOINT}", { method: "POST" });\n`);
  try {
    assert.deepEqual(findOpenPhoneMessageEndpointViolations(root), ["direct.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
