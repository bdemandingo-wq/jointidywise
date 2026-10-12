/**
 * Ratchet for explicit `any`.
 *
 * `@typescript-eslint/no-explicit-any` is not enabled. Turning it on would
 * fail the build on the existing backlog. This script freezes the current
 * count so new `any` (and new disables of that rule) fail lint, while the
 * existing backlog can be burned down by lowering BASELINE.
 *
 * Counted under src/:
 *   - `: any` type annotations
 *   - `as any` assertions
 *   - `<any>` / `<any,` type arguments
 *   - comments that disable no-explicit-any
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src");
// Frozen 2026-10-12 after the P4 frontend pass. Lower this when `any` is removed.
const BASELINE = 1000;

const ANNOTATION = /:\s*any\b/g;
const ASSERTION = /\bas\s+any\b/g;
const TYPE_ARG = /<any\b/g;
const DISABLE = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-any/g;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(path);
  }
}

function countIn(source) {
  const hits = (re) => source.match(re)?.length ?? 0;
  return hits(ANNOTATION) + hits(ASSERTION) + hits(TYPE_ARG) + hits(DISABLE);
}

const files = [];
walk(ROOT, files);
let total = 0;
for (const file of files) {
  total += countIn(readFileSync(file, "utf8"));
}

if (process.argv.includes("--print")) {
  console.log(total);
  process.exit(0);
}

if (total > BASELINE) {
  console.error(
    `Explicit any increased from ${BASELINE} to ${total}. ` +
      `Remove the new any, or lower the backlog and update BASELINE in scripts/check-no-explicit-any.mjs.`,
  );
  process.exit(1);
}

console.log(`explicit any ${total} (baseline ${BASELINE})`);
