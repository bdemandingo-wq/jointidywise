import { LIFETIME_SPOT_CAP } from "./lifetime-cap.ts";

/**
 * Same numbers as get_lifetime_spots_remaining.
 * The cap is lifetime_offer_state.total_spots, falling back to
 * LIFETIME_SPOT_CAP when that row is missing. Sold is the count of
 * lifetime_access_purchases. The offer row's sold counter is not that
 * count — it can sit at 0 while purchase rows exist.
 */
export async function countLifetimeSpots(admin: {
  from: (table: string) => any;
}): Promise<{ total: number; used: number; remaining: number; available: boolean }> {
  const { data: offerState, error: offerError } = await admin
    .from("lifetime_offer_state")
    .select("total_spots")
    .eq("id", 1)
    .maybeSingle();
  if (offerError) throw offerError;

  const total = offerState?.total_spots ?? LIFETIME_SPOT_CAP;

  const { count, error: countError } = await admin
    .from("lifetime_access_purchases")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;

  const used = typeof count === "number" ? count : 0;
  const remaining = Math.max(0, total - used);
  return { total, used, remaining, available: remaining > 0 };
}
