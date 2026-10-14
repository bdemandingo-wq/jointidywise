import { readEdgeFunctionErrorBody } from "./edgeFunctionError.ts";

export const PRICE_NOT_CONFIGURED_CODE = "price_not_configured";

/**
 * Custom checkout has no Stripe price id. The button goes to /contact
 * instead of toasting the 503. Basic and Pro still surface their error.
 *
 * Matches the code this PR adds, and the message the already-deployed
 * functions return before that code is live.
 */
export async function isCustomPriceMissing(error: unknown): Promise<boolean> {
  const body = await readEdgeFunctionErrorBody(error);
  if (!body) return false;
  const plan = typeof body.plan === "string" ? body.plan : "";
  if (plan === "basic" || plan === "pro") return false;
  if (body.code === PRICE_NOT_CONFIGURED_CODE && plan === "custom") return true;
  const message = typeof body.error === "string" ? body.error : "";
  return /stripe price for custom\b/i.test(message) && /not configured/i.test(message);
}

export class CustomPriceMissing extends Error {
  constructor() {
    super("Custom pricing is not available online.");
    this.name = "CustomPriceMissing";
  }
}
