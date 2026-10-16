/**
 * The OpenPhone messages URL may appear only in supabase/functions/_shared/send-sms.ts.
 * Every outbound SMS goes through sendOpenPhoneMessage there, which applies the
 * STOP check. Message reads import OPENPHONE_MESSAGES_URL from that file.
 *
 * A second copy of the endpoint is how a new sender skips the opt-out gate.
 *
 * Run: node scripts/check-openphone-messages-endpoint.mjs
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const ALLOWED_FILE = "supabase/functions/_shared/send-sms.ts";

const NEEDLE = ["api.openphone.com", "v1", "messages"].join("/");

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
      if (rel === ALLOWED_FILE) continue;
      let text = "";
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes(NEEDLE)) hits.push(rel);
    }
  }

  walk(root);
  return hits.sort();
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
      "OpenPhone messages endpoint is only allowed in supabase/functions/_shared/send-sms.ts:",
    );
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
  }
  console.log("✓ openphone messages endpoint is only named in send-sms.ts");
}
