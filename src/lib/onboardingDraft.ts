/**
 * Onboarding wizard draft, stored per user so a refresh does not wipe the form.
 *
 * Deliberately free of browser globals so node:test can pass a memory Storage.
 * The payload is plain JSON — never a Set or Map (those survive in memory and
 * come back as {} after JSON.parse).
 */

import { HOW_HEARD_VALUES, normalizeHowHeardOther } from "./onboardingAnswers.ts";

export interface OnboardingServiceDraft {
  name: string;
  description: string;
}

export interface OnboardingDraft {
  step: 1 | 2 | 3;
  businessName: string;
  phoneNumber: string;
  currency: string;
  timezone: string;
  selectedServices: string[];
  customServices: OnboardingServiceDraft[];
  /** Single self-reported source slug. Not UTM. Empty until they tap one. */
  howHeard: string;
  /** Free text when howHeard is other. Capped at 200 characters. */
  howHeardOther: string;
}

const KEY_PREFIX = "tw_onboarding_draft:";

export function onboardingDraftKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function clampStep(value: unknown): 1 | 2 | 3 {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 2 || n === 3) return n;
  return 1;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/** One current option. Accepts a legacy array or fb_ad / fb_group. */
export function oneHowHeard(value: unknown): string {
  const rawList = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const slugs = rawList
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .map((item) => (item === "fb_ad" || item === "fb_group" ? "facebook" : item));
  return HOW_HEARD_VALUES.find((option) => slugs.includes(option)) ?? "";
}

function serviceList(value: unknown): OnboardingServiceDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const name = (row as { name?: unknown }).name;
    const description = (row as { description?: unknown }).description;
    if (typeof name !== "string" || !name.trim()) return [];
    return [{
      name: name.trim(),
      description: typeof description === "string" ? description : "",
    }];
  });
}

export function parseOnboardingDraft(raw: unknown): OnboardingDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const draft: OnboardingDraft = {
    step: clampStep(source.step),
    businessName: typeof source.businessName === "string" ? source.businessName : "",
    phoneNumber: typeof source.phoneNumber === "string" ? source.phoneNumber : "",
    currency: typeof source.currency === "string" && source.currency ? source.currency : "",
    timezone: typeof source.timezone === "string" && source.timezone ? source.timezone : "",
    selectedServices: stringList(source.selectedServices),
    customServices: serviceList(source.customServices),
    howHeard: oneHowHeard(source.howHeard),
    howHeardOther: oneHowHeard(source.howHeard) === "other"
      ? normalizeHowHeardOther(source.howHeardOther)
      : "",
  };
  const empty =
    !draft.businessName &&
    !draft.phoneNumber &&
    draft.selectedServices.length === 0 &&
    draft.customServices.length === 0 &&
    !draft.howHeard &&
    !draft.howHeardOther &&
    draft.step === 1;
  return empty ? null : draft;
}

export function readOnboardingDraft(storage: Storage, userId: string): OnboardingDraft | null {
  try {
    const raw = storage.getItem(onboardingDraftKey(userId));
    if (!raw) return null;
    return parseOnboardingDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeOnboardingDraft(storage: Storage, userId: string, draft: OnboardingDraft): void {
  const payload: OnboardingDraft = {
    step: clampStep(draft.step),
    businessName: draft.businessName,
    phoneNumber: draft.phoneNumber,
    currency: draft.currency,
    timezone: draft.timezone,
    selectedServices: [...draft.selectedServices],
    customServices: draft.customServices.map((s) => ({ name: s.name, description: s.description })),
    howHeard: oneHowHeard(draft.howHeard),
    howHeardOther: oneHowHeard(draft.howHeard) === "other"
      ? normalizeHowHeardOther(draft.howHeardOther)
      : "",
  };
  storage.setItem(onboardingDraftKey(userId), JSON.stringify(payload));
}

export function clearOnboardingDraft(storage: Storage, userId: string): void {
  storage.removeItem(onboardingDraftKey(userId));
}

/** One-time owner prompt. Per user and org, so a second business can still be asked. */
export function howHeardSeenKey(userId: string, orgId: string): string {
  return `tw-how-heard-seen:${userId}:${orgId}`;
}

export function readHowHeardSeen(storage: Storage, userId: string, orgId: string): boolean {
  try {
    return storage.getItem(howHeardSeenKey(userId, orgId)) === "1";
  } catch {
    return false;
  }
}

export function writeHowHeardSeen(storage: Storage, userId: string, orgId: string): void {
  try {
    storage.setItem(howHeardSeenKey(userId, orgId), "1");
  } catch {
    // A full quota must not block the dashboard. The server asked-at flag still applies.
  }
}
