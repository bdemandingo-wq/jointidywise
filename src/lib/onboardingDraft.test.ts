import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearOnboardingDraft,
  parseOnboardingDraft,
  readHowHeardSeen,
  readOnboardingDraft,
  writeHowHeardSeen,
  writeOnboardingDraft,
} from "./onboardingDraft.ts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => map.set(key, value),
  };
}

test("parseOnboardingDraft drops junk and clamps the step", () => {
  const draft = parseOnboardingDraft({
    step: 9,
    businessName: "Sparkle Co",
    phoneNumber: "555",
    selectedServices: ["Standard Clean", 4, ""],
    customServices: [{ name: "Windows", description: "Glass" }, { name: "" }],
    extra: "nope",
  });
  assert.deepEqual(draft, {
    step: 1,
    businessName: "Sparkle Co",
    phoneNumber: "555",
    currency: "",
    timezone: "",
    selectedServices: ["Standard Clean"],
    customServices: [{ name: "Windows", description: "Glass" }],
    howHeard: "",
    howHeardOther: "",
  });
});

test("a refresh round-trip keeps step 2 and the typed name", () => {
  const storage = memoryStorage();
  writeOnboardingDraft(storage, "user-1", {
    step: 2,
    businessName: "Sparkle Co",
    phoneNumber: "(555) 123-4567",
    currency: "USD",
    timezone: "America/Chicago",
    selectedServices: ["Deep Clean"],
    customServices: [],
    howHeard: "instagram",
    howHeardOther: "",
  });
  assert.deepEqual(readOnboardingDraft(storage, "user-1"), {
    step: 2,
    businessName: "Sparkle Co",
    phoneNumber: "(555) 123-4567",
    currency: "USD",
    timezone: "America/Chicago",
    selectedServices: ["Deep Clean"],
    customServices: [],
    howHeard: "instagram",
    howHeardOther: "",
  });
  assert.equal(readOnboardingDraft(storage, "someone-else"), null);
  clearOnboardingDraft(storage, "user-1");
  assert.equal(readOnboardingDraft(storage, "user-1"), null);
});

test("an empty draft is treated as no draft", () => {
  assert.equal(parseOnboardingDraft({ step: 1, businessName: "" }), null);
  assert.equal(parseOnboardingDraft(null), null);
});

test("a legacy howHeard array restores one current option", () => {
  const draft = parseOnboardingDraft({
    step: 2,
    businessName: "Sparkle Co",
    howHeard: ["fb_ad", "reddit"],
    howHeardOther: "ignored unless other",
  });
  assert.equal(draft?.howHeard, "facebook");
  assert.equal(draft?.howHeardOther, "");
  const other = parseOnboardingDraft({
    step: 1,
    howHeard: ["other"],
    howHeardOther: `  ${"y".repeat(250)}`,
  });
  assert.equal(other?.howHeard, "other");
  assert.equal(other?.howHeardOther.length, 200);
  const skipped = parseOnboardingDraft({ step: 1, businessName: "Sparkle Co", howHeard: "not_sure" });
  assert.equal(skipped?.howHeard, "not_sure");
});

test("the how-heard prompt seen flag is per user and org", () => {
  const storage = memoryStorage();
  assert.equal(readHowHeardSeen(storage, "user-1", "org-1"), false);
  writeHowHeardSeen(storage, "user-1", "org-1");
  assert.equal(readHowHeardSeen(storage, "user-1", "org-1"), true);
  assert.equal(readHowHeardSeen(storage, "user-1", "org-2"), false);
});
