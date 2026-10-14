// node --experimental-strip-types --test src/lib/appUpdate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldOfferAppUpdate } from "./appUpdate.ts";

test("same build id does not offer a reload", () => {
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "abc123",
    remoteBuildId: "abc123",
    dismissedBuildId: null,
  }), false);
});

test("a different build id offers a reload", () => {
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "abc123",
    remoteBuildId: "def456",
    dismissedBuildId: null,
  }), true);
});

test("ids are compared as strings, not numbers", () => {
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "010",
    remoteBuildId: "10",
    dismissedBuildId: null,
  }), true);
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "10",
    remoteBuildId: "10",
    dismissedBuildId: null,
  }), false);
});

test("dismissing one remote id hides only that id", () => {
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "old",
    remoteBuildId: "new",
    dismissedBuildId: "new",
  }), false);
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "old",
    remoteBuildId: "newer",
    dismissedBuildId: "new",
  }), true);
});

test("a failed or empty version check stays quiet", () => {
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "abc",
    remoteBuildId: null,
    dismissedBuildId: null,
  }), false);
  assert.equal(shouldOfferAppUpdate({
    localBuildId: "  ",
    remoteBuildId: "abc",
    dismissedBuildId: null,
  }), false);
});
