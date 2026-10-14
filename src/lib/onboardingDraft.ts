/**
 * Onboarding wizard draft, stored per user so a refresh does not wipe the form.
 *
 * Deliberately free of browser globals so node:test can pass a memory Storage.
 * The payload is plain JSON — never a Set or Map (those survive in memory and
 * come back as {} after JSON.parse).
 */

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
  /** Self-reported "How did you hear about us?" slugs. Not UTM. */
  howHeard: string[];
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
    howHeard: stringList(source.howHeard),
  };
  const empty =
    !draft.businessName &&
    !draft.phoneNumber &&
    draft.selectedServices.length === 0 &&
    draft.customServices.length === 0 &&
    draft.howHeard.length === 0 &&
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
    howHeard: stringList(draft.howHeard),
  };
  storage.setItem(onboardingDraftKey(userId), JSON.stringify(payload));
}

export function clearOnboardingDraft(storage: Storage, userId: string): void {
  storage.removeItem(onboardingDraftKey(userId));
}
