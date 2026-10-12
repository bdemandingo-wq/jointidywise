import { test } from "node:test";
import assert from "node:assert/strict";
import { displayBusinessName } from "./businessDisplayName.ts";

test("a typed company name wins", () => {
  assert.equal(displayBusinessName("Jane's Business", "Sparkle Co"), "Sparkle Co");
});

test("placeholder company names fall back to the organization name", () => {
  assert.equal(displayBusinessName("Sparkle Co", "My Business"), "Sparkle Co");
  assert.equal(displayBusinessName("Sparkle Co", "My Cleaning Business"), "Sparkle Co");
  assert.equal(displayBusinessName("Sparkle Co", ""), "Sparkle Co");
});

test("nothing real yet still has a label", () => {
  assert.equal(displayBusinessName("My Cleaning Business", "My Business"), "My Business");
  assert.equal(displayBusinessName("", null), "Your business");
});
