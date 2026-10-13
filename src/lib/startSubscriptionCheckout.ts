import { supabase } from "@/lib/supabase";
import { readEdgeFunctionError } from "@/lib/edgeFunctionError";
import { isAlreadyLifetimeError, ALREADY_LIFETIME_MESSAGE } from "@/lib/alreadyLifetime";
import { openEmbeddedCheckout, readCheckoutSession } from "@/lib/embeddedCheckout";

export type CheckoutPlanId = "basic" | "pro" | "custom";
export type CheckoutInterval = "monthly" | "yearly";

export class AlreadyLifetimeCheckout extends Error {
  constructor() {
    super(ALREADY_LIFETIME_MESSAGE);
    this.name = "AlreadyLifetimeCheckout";
  }
}

/**
 * Open in-app Embedded Checkout for a TidyWise plan.
 *
 * Throws a message safe to show in a toast — never supabase-js's
 * "non-2xx status code" wrapper. Does not change which Stripe key or
 * mode the function uses. The buyer stays on this origin.
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

  const session = readCheckoutSession(data);
  openEmbeddedCheckout({
    ...session,
    plan: planId,
    interval,
    cancelPath: `/pricing?plan=${encodeURIComponent(planId)}&interval=${encodeURIComponent(interval)}&canceled=1`,
  });
}
