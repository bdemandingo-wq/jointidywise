import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Env names that host a git SHA. Lovable and the usual CI hosts. */
const SHA_ENV_KEYS = [
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
  "CI_COMMIT_SHA",
  "CI_COMMIT_SHORT_SHA",
  "SOURCE_VERSION",
  "COMMIT_REF",
  "LOVABLE_GIT_COMMIT_SHA",
  "LOVABLE_COMMIT_SHA",
  "LOVABLE_SHA",
  "GPT_ENGINEER_COMMIT_SHA",
  "GPT_ENGINEER_SHA",
];

function looksLikeSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

export function shaFromEnv(env: NodeJS.ProcessEnv): string {
  for (const key of SHA_ENV_KEYS) {
    const value = (env[key] ?? "").trim();
    if (value) return value;
  }
  for (const [key, raw] of Object.entries(env)) {
    if (!/^(LOVABLE_|GPT_ENGINEER_)/.test(key)) continue;
    const value = (raw ?? "").trim();
    if (looksLikeSha(value)) return value;
  }
  return "";
}

export function gitHeadSha(): string {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

/** Stable across identical trees. Paths are sorted and stored with `/`. */
export function hashSourceTree(root: string): string {
  const hash = createHash("sha256");
  let version = "";
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
    version = pkg.version ?? "";
  } catch {
    version = "";
  }
  hash.update(`version:${version}\n`);
  const files: string[] = [];
  const srcRoot = path.join(root, "src");
  const walk = (dir: string) => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = path.join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(srcRoot);
  files.sort();
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 20);
}

/**
 * One id for the JS bundle and version.json. Identical source must keep
 * the same id, or a Lovable rebuild of an unchanged tree shows the
 * "new version" bar.
 */
export function resolveAppBuildId(options?: {
  env?: NodeJS.ProcessEnv;
  root?: string;
  gitSha?: () => string;
  sourceHash?: (root: string) => string;
}): string {
  const env = options?.env ?? process.env;
  const fromEnv = shaFromEnv(env);
  if (fromEnv) return fromEnv;
  const fromGit = (options?.gitSha ?? gitHeadSha)();
  if (fromGit) return fromGit;
  const root = options?.root ?? process.cwd();
  return (options?.sourceHash ?? hashSourceTree)(root);
}
