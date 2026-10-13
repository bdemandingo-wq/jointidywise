/**
 * Hand-off from a plan checkout function to the in-app Embedded Checkout page.
 *
 * The client secret never goes in a query string. Same-tab navigation uses
 * sessionStorage. Breaking out of a preview iframe has to put it in the URL
 * hash, because the new top-level document cannot see the iframe's storage.
 * The checkout page reads that hash once and strips it.
 *
 * Stored minutes, prices, and Stripe webhooks are not involved here.
 */

export type EmbeddedCheckoutHandoff = {
  clientSecret: string;
  publishableKey: string;
  plan: string;
  interval?: string | null;
  cancelPath?: string | null;
  stagedAt?: number;
};

const STORAGE_KEY = "tw-embedded-checkout";
const MAX_AGE_MS = 30 * 60 * 1000;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function safeCancelPath(value: string | null | undefined): string {
  if (!value) return "/pricing";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return "/pricing";
  }
  return value;
}

export function readCheckoutSession(data: unknown): { clientSecret: string; publishableKey: string } {
  const payload = data as { clientSecret?: unknown; publishableKey?: unknown; error?: unknown } | null;
  if (payload && typeof payload.error === "string" && payload.error) {
    throw new Error(payload.error);
  }
  const clientSecret = payload?.clientSecret;
  const publishableKey = payload?.publishableKey;
  if (typeof clientSecret !== "string" || !clientSecret.startsWith("cs_")) {
    throw new Error("Checkout did not open. Nothing was charged.");
  }
  if (
    typeof publishableKey !== "string" ||
    (!publishableKey.startsWith("pk_test_") && !publishableKey.startsWith("pk_live_"))
  ) {
    throw new Error("Checkout is not configured. Nothing was charged.");
  }
  return { clientSecret, publishableKey };
}

export function handoffFromHash(hash: string): EmbeddedCheckoutHandoff | null {
  const raw = hash.replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  try {
    const session = readCheckoutSession({
      clientSecret: params.get("client_secret"),
      publishableKey: params.get("pk"),
    });
    const plan = params.get("plan") || "pro";
    const interval = params.get("interval");
    return {
      ...session,
      plan,
      interval,
      cancelPath: safeCancelPath(params.get("cancel")),
      stagedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

export function stageEmbeddedCheckout(
  handoff: EmbeddedCheckoutHandoff,
  storage: StorageLike,
  now = Date.now(),
): void {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...handoff,
      cancelPath: safeCancelPath(handoff.cancelPath),
      stagedAt: now,
    }),
  );
}

export function readStagedCheckout(
  storage: StorageLike,
  now = Date.now(),
): EmbeddedCheckoutHandoff | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EmbeddedCheckoutHandoff;
    const session = readCheckoutSession(parsed);
    if (typeof parsed.stagedAt !== "number" || now - parsed.stagedAt > MAX_AGE_MS) {
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      ...session,
      plan: typeof parsed.plan === "string" && parsed.plan ? parsed.plan : "pro",
      interval: parsed.interval ?? null,
      cancelPath: safeCancelPath(parsed.cancelPath),
      stagedAt: parsed.stagedAt,
    };
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearStagedCheckout(storage: StorageLike = sessionStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Leave the current page for /billing/checkout without leaving the origin.
 * Stays inside the Capacitor webview. A preview iframe breaks out to the
 * top window and carries the secret in the hash for that one navigation.
 */
export function openEmbeddedCheckout(handoff: EmbeddedCheckoutHandoff): void {
  const cancelPath = safeCancelPath(handoff.cancelPath);
  const staged: EmbeddedCheckoutHandoff = { ...handoff, cancelPath, stagedAt: Date.now() };
  try {
    stageEmbeddedCheckout(staged, sessionStorage);
  } catch {
    /* storage unavailable — the hash path below still works for a breakout */
  }

  const path = "/billing/checkout";
  try {
    if (window.top && window.top !== window.self) {
      const hash = new URLSearchParams({
        client_secret: staged.clientSecret,
        pk: staged.publishableKey,
        plan: staged.plan,
        ...(staged.interval ? { interval: staged.interval } : {}),
        cancel: cancelPath,
      }).toString();
      window.top.location.assign(`${window.location.origin}${path}#${hash}`);
      return;
    }
  } catch {
    /* cross-origin top — fall through to same-frame navigation */
  }
  window.location.assign(path);
}

export function consumeEmbeddedCheckout(): EmbeddedCheckoutHandoff | null {
  if (typeof window === "undefined") return null;
  const fromHash = handoffFromHash(window.location.hash);
  if (fromHash) {
    try {
      stageEmbeddedCheckout(fromHash, sessionStorage, fromHash.stagedAt);
    } catch {
      /* still return the hash handoff */
    }
    const clean = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", clean);
    return fromHash;
  }
  try {
    return readStagedCheckout(sessionStorage);
  } catch {
    return null;
  }
}
