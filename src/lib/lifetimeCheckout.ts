import { readEdgeFunctionError, readEdgeFunctionErrorBody } from "./edgeFunctionError.ts";

const RETRY_DELAYS_MS = [0, 700, 1400, 2100];

type InvokeClient = {
  functions: {
    invoke: (
      name: string,
      options: { body: Record<string, never> },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
};

export class LifetimeCheckoutError extends Error {
  readonly alreadyLifetime: boolean;

  constructor(message: string, options?: { alreadyLifetime?: boolean }) {
    super(message);
    this.name = "LifetimeCheckoutError";
    this.alreadyLifetime = options?.alreadyLifetime === true;
  }
}

export function isRetryableLifetimeBody(body: Record<string, unknown> | null): boolean {
  if (!body) return false;
  if (body.code === "org_not_ready") return true;
  const message = typeof body.error === "string" ? body.error : "";
  return /workspace is still being set up/i.test(message);
}

function messageFrom(body: Record<string, unknown> | null, fallback: string): string {
  const fromBody = body?.error;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody;
  return fallback;
}

/**
 * Opens a lifetime Checkout Session for the signed-in user.
 * A brand-new account may still be provisioning its org, so a
 * not-ready response is retried a few times before it is shown.
 */
export async function invokeLifetimeCheckout(client: InvokeClient): Promise<{ url: string }> {
  let last: LifetimeCheckoutError | null = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    const { data, error } = await client.functions.invoke("buy-lifetime", { body: {} });
    if (error) {
      const body = await readEdgeFunctionErrorBody(error);
      if (body?.alreadyLifetime === true) {
        throw new LifetimeCheckoutError(
          messageFrom(body, "You already have lifetime access. No need to buy again."),
          { alreadyLifetime: true },
        );
      }
      const message = body
        ? messageFrom(body, "Could not start the lifetime checkout. Try again.")
        : await readEdgeFunctionError(error, "Could not start the lifetime checkout. Try again.");
      const failure = new LifetimeCheckoutError(message);
      if (isRetryableLifetimeBody(body) && attempt < RETRY_DELAYS_MS.length - 1) {
        last = failure;
        continue;
      }
      throw failure;
    }

    const payload = (data && typeof data === "object" ? data : null) as {
      url?: unknown;
      error?: unknown;
      code?: unknown;
      alreadyLifetime?: unknown;
    } | null;
    if (payload?.alreadyLifetime === true) {
      throw new LifetimeCheckoutError(
        typeof payload.error === "string" ? payload.error : "You already have lifetime access. No need to buy again.",
        { alreadyLifetime: true },
      );
    }
    const payloadBody: Record<string, unknown> | null = payload
      ? { error: payload.error, code: payload.code }
      : null;
    if (isRetryableLifetimeBody(payloadBody)) {
      last = new LifetimeCheckoutError(
        typeof payload?.error === "string"
          ? payload.error
          : "Your workspace is still being set up. Try again in a moment.",
      );
      if (attempt < RETRY_DELAYS_MS.length - 1) continue;
      throw last;
    }
    if (typeof payload?.error === "string" && payload.error.trim()) {
      throw new LifetimeCheckoutError(payload.error);
    }
    if (typeof payload?.url !== "string" || !payload.url) {
      throw new LifetimeCheckoutError("Checkout URL missing");
    }
    return { url: payload.url };
  }
  throw last ?? new LifetimeCheckoutError("Could not start the lifetime checkout. Try again.");
}
