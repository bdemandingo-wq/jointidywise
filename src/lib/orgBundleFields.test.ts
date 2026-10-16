// Runner: node --experimental-strip-types --test src/lib/orgBundleFields.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORG_BUNDLE_COLUMNS,
  ORG_BUNDLE_SELECT,
  ORG_MEMBERSHIP_SELECT,
  orgBundleSelect,
  readGrandfatheredLifetime,
} from "./orgBundleFields.ts";

test("the org bundle select includes grandfathered_lifetime", () => {
  assert.equal(ORG_BUNDLE_COLUMNS.includes("grandfathered_lifetime"), true);
  assert.equal(orgBundleSelect(), ORG_BUNDLE_SELECT);
  assert.match(ORG_BUNDLE_SELECT, /(^|,)grandfathered_lifetime$/);
  assert.match(ORG_MEMBERSHIP_SELECT, /organizations\([^)]*grandfathered_lifetime\)/);
});

test("only a real true flag is grandfathered", () => {
  assert.equal(readGrandfatheredLifetime(true), true);
  assert.equal(readGrandfatheredLifetime(false), false);
  assert.equal(readGrandfatheredLifetime(null), false);
  assert.equal(readGrandfatheredLifetime(undefined), false);
  assert.equal(readGrandfatheredLifetime("true"), false);
});
