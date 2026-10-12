import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearOnboardingDraft,
  parseOnboardingDraft,
  readOnboardingDraft,
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
  });
  assert.deepEqual(readOnboardingDraft(storage, "user-1"), {
    step: 2,
    businessName: "Sparkle Co",
    phoneNumber: "(555) 123-4567",
    currency: "USD",
    timezone: "America/Chicago",
    selectedServices: ["Deep Clean"],
    customServices: [],
  });
  assert.equal(readOnboardingDraft(storage, "someone-else"), null);
  clearOnboardingDraft(storage, "user-1");
  assert.equal(readOnboardingDraft(storage, "user-1"), null);
});

test("an empty draft is treated as no draft", () => {
  assert.equal(parseOnboardingDraft({ step: 1, businessName: "" }), null);
  assert.equal(parseOnboardingDraft(null), null);
});
