import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { readEdgeFunctionError } from "@/lib/edgeFunctionError";

export type ChargePreviewPlan = "basic" | "pro" | "custom";
export type ChargePreviewInterval = "monthly" | "yearly";

export type SubscriptionChargePreview = {
  bill_now: boolean;
  first_charge_at: string | null;
  amount_cents_after_discounts: number;
};

export type ChargePreviewKey = `${ChargePreviewPlan}:${ChargePreviewInterval}`;

export function chargePreviewKey(plan: ChargePreviewPlan, interval: ChargePreviewInterval): ChargePreviewKey {
  return `${plan}:${interval}`;
}

/**
 * Read-only preview of what create-subscription would charge. One request
 * per plan. A failed plan is omitted so the others can still render.
 * This hook does not start checkout.
 */
export function useSubscriptionChargePreview(opts: {
  enabled: boolean;
  organizationId?: string | null;
  items: { plan: ChargePreviewPlan; interval: ChargePreviewInterval }[];
}) {
  const items = opts.items;
  return useQuery({
    queryKey: ["subscription-charge-preview", opts.organizationId ?? null, items],
    enabled: opts.enabled && items.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const previews: Partial<Record<ChargePreviewKey, SubscriptionChargePreview>> = {};
      const errors: Partial<Record<ChargePreviewKey, string>> = {};
      await Promise.all(items.map(async (item) => {
        const key = chargePreviewKey(item.plan, item.interval);
        try {
          const { data, error } = await supabase.functions.invoke("preview-subscription-charge", {
            body: {
              plan: item.plan,
              interval: item.interval,
              ...(opts.organizationId ? { organization_id: opts.organizationId } : {}),
            },
          });
          if (error) {
            throw new Error(await readEdgeFunctionError(error, "Could not preview the charge."));
          }
          const body = data as SubscriptionChargePreview & { error?: string };
          if (body?.error) throw new Error(body.error);
          if (typeof body?.bill_now !== "boolean" || typeof body.amount_cents_after_discounts !== "number") {
            throw new Error("Charge preview was incomplete.");
          }
          previews[key] = body;
        } catch (err) {
          errors[key] = err instanceof Error ? err.message : "Could not preview the charge.";
        }
      }));
      return { previews, errors };
    },
  });
}
