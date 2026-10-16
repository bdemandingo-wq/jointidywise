/**
 * The OpenPhone messages URL may be named in two files:
 * - supabase/functions/_shared/send-sms.ts, the only file that may POST it
 * - supabase/functions/_shared/openphone-messages-read.ts, GET only
 *
 * A POST next to that URL anywhere else fails. A compliance send purpose
 * (stop_confirmation or help) may appear only in the inbound webhook.
 *
 * Run: node scripts/check-openphone-messages-endpoint.mjs
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const POST_FILE = "supabase/functions/_shared/send-sms.ts";
export const READ_FILE = "supabase/functions/_shared/openphone-messages-read.ts";
export const PURPOSE_FILE = "supabase/functions/openphone-webhook/index.ts";

const NEEDLE = ["api.openphone.com", "v1", "messages"].join("/");
const POST_RE = /method\s*:\s*['"]POST['"]/;
const PURPOSE_RE = /purpose\s*:\s*['"](?:stop_confirmation|help)['"]/;

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  "qa-report",
  "playwright-report",
  "ios",
  "android",
]);

const SKIP_FILES = new Set(["package-lock.json"]);

export function findOpenPhoneMessageEndpointViolations(root) {
  const hits = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || SKIP_FILES.has(entry.name)) continue;
      const full = join(dir, entry.name);
      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        continue;
      }
      if (size > 1_000_000) continue;
      const rel = relative(root, full).split(sep).join("/");
      let text = "";
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const namesEndpoint = text.includes(NEEDLE);
      const posts = POST_RE.test(text);
      if (namesEndpoint && rel !== POST_FILE) {
        if (rel !== READ_FILE || posts) hits.push(rel);
      }
      if (PURPOSE_RE.test(text) && rel !== PURPOSE_FILE) hits.push(rel);
    }
  }

  walk(root);
  return [...new Set(hits)].sort();
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const hits = findOpenPhoneMessageEndpointViolations(process.cwd());
  if (hits.length > 0) {
    console.error(
      "OpenPhone messages POST is only allowed in send-sms.ts. " +
      "GET reads belong in openphone-messages-read.ts. " +
      "stop_confirmation and help belong only in openphone-webhook:",
    );
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log("✓ openphone messages endpoint and compliance purposes are contained");
}
