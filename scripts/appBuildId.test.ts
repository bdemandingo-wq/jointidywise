import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashSourceTree, resolveAppBuildId, shaFromEnv } from "./appBuildId.ts";

test("a git SHA from the environment wins", () => {
  assert.equal(
    resolveAppBuildId({
      env: { GITHUB_SHA: "abc1234" },
      gitSha: () => "from-git",
      sourceHash: () => "from-source",
    }),
    "abc1234",
  );
});

test("a Lovable SHA env wins over the clock", () => {
  assert.equal(shaFromEnv({ LOVABLE_COMMIT_SHA: " deadbeef " }), "deadbeef");
  assert.equal(
    resolveAppBuildId({
      env: { GPT_ENGINEER_BUILD_SHA: "a1b2c3d" },
      gitSha: () => "",
      sourceHash: () => "from-source",
    }),
    "a1b2c3d",
  );
});

test("git HEAD is used when no env SHA is set", () => {
  assert.equal(
    resolveAppBuildId({
      env: {},
      gitSha: () => "from-git",
      sourceHash: () => "from-source",
    }),
    "from-git",
  );
});

test("identical source hashes match and do not use the clock", () => {
  const root = mkdtempSync(path.join(tmpdir(), "tw-build-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(path.join(root, "src", "main.ts"), "export const n = 1;\n");
  const first = hashSourceTree(root);
  const second = hashSourceTree(root);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{20}$/);
  const id = resolveAppBuildId({
    env: {},
    root,
    gitSha: () => "",
  });
  assert.equal(id, first);
});
