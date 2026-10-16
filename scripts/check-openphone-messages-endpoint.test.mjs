import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  POST_FILE,
  PURPOSE_FILE,
  READ_FILE,
  findOpenPhoneMessageEndpointViolations,
} from "./check-openphone-messages-endpoint.mjs";

const ENDPOINT = ["https://api.openphone.com", "v1", "messages"].join("/");

function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), "sms-endpoint-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the repository names the messages endpoint only in the sender and the GET helper", () => {
  assert.deepEqual(findOpenPhoneMessageEndpointViolations(process.cwd()), []);
});

test("a messages POST outside the shared sender fails the check", () => {
  const hits = withTree({
    [POST_FILE]: `const url = "${ENDPOINT}";\nmethod: "POST"\n`,
    "direct.ts": `await fetch("${ENDPOINT}", { method: "POST" });\n`,
  }, findOpenPhoneMessageEndpointViolations);
  assert.deepEqual(hits, ["direct.ts"]);
});

test("a GET-only copy of the messages URL outside the read helper fails", () => {
  const hits = withTree({
    "sync.ts": `const url = "${ENDPOINT}";\nmethod: "GET"\n`,
  }, findOpenPhoneMessageEndpointViolations);
  assert.deepEqual(hits, ["sync.ts"]);
});

test("the read helper may name the messages URL when it does not POST", () => {
  const hits = withTree({
    [POST_FILE]: `const url = "${ENDPOINT}";\nmethod: "POST"\n`,
    [READ_FILE]: `const url = "${ENDPOINT}";\nmethod: "GET"\n`,
  }, findOpenPhoneMessageEndpointViolations);
  assert.deepEqual(hits, []);
});

test("a POST in the read helper fails", () => {
  const hits = withTree({
    [READ_FILE]: `const url = "${ENDPOINT}";\nmethod: "POST"\n`,
  }, findOpenPhoneMessageEndpointViolations);
  assert.deepEqual(hits, [READ_FILE]);
});

test("docs are outside the endpoint check", () => {
  const name = ["OPENPHONE", "MESSAGES", "URL"].join("_");
  const hits = withTree({
    [POST_FILE]: `const ${name} = "${ENDPOINT}";\nmethod: "POST"\n`,
    "docs/paste.txt": `fetch("${ENDPOINT}", { method: "POST" });\nconst ${name} = "x";\n`,
  }, findOpenPhoneMessageEndpointViolations);
  assert.deepEqual(hits, []);
});

test("the messages URL identifier outside the sender fails the check", () => {
  const name = ["OPENPHONE", "MESSAGES", "URL"].join("_");
  const hits = withTree({
    [POST_FILE]: `const ${name} = "${ENDPOINT}";\nmethod: "POST"\n`,
    "notes.txt": `const ${name} = "x";\n`,
  }, findOpenPhoneMessageEndpointViolations);
  assert.deepEqual(hits, ["notes.txt"]);
});

test("a compliance purpose outside the inbound webhook fails the check", () => {
  const purposeKey = "purpose";
  const stopPurpose = ["stop_confirma", "tion"].join("");
  const helpPurpose = ["hel", "p"].join("");
  const hits = withTree({
    [PURPOSE_FILE]: `send({ ${purposeKey}: "${stopPurpose}" });\n`,
    "other.ts": `send({ ${purposeKey}: "${helpPurpose}" });\n`,
  }, findOpenPhoneMessageEndpointViolations);
  assert.deepEqual(hits, ["other.ts"]);
});
