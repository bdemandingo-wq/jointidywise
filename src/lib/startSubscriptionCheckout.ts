import { supabase } from "@/lib/supabase";
import { readEdgeFunctionError } from "@/lib/edgeFunctionError";
import { isAlreadyLifetimeError, ALREADY_LIFETIME_MESSAGE } from "@/lib/alreadyLifetime";

export type CheckoutPlanId = "basic" | "pro" | "custom";
export type CheckoutInterval = "monthly" | "yearly";

export class AlreadyLifetimeCheckout extends Error {
  constructor() {
    super(ALREADY_LIFETIME_MESSAGE);
    this.name = "AlreadyLifetimeCheckout";
  }
}

/**
 * Open Stripe Checkout for a TidyWise plan.
 *
 * The card form lives on Stripe, not in the app. Throws a message safe to
 * show in a toast — never supabase-js's "non-2xx status code" wrapper.
 * Does not change which Stripe key or mode the function uses.
 */
export async function startSubscriptionCheckout(
  planId: CheckoutPlanId,
  interval: CheckoutInterval = "monthly",
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("create-subscription", {
    body: { plan: planId, interval },
  });

  if (error) {
    if (await isAlreadyLifetimeError(error)) {
      throw new AlreadyLifetimeCheckout();
    }
    throw new Error(
      await readEdgeFunctionError(
        error,
        "Could not start checkout. Nothing was charged.",
      ),
    );
  }

  const payload = data as { url?: string; error?: string } | null;
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.url) {
    throw new Error("Checkout did not return a payment link. Nothing was charged.");
  }
  window.location.href = payload.url;
}
