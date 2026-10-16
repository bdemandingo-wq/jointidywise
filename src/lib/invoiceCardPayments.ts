/** Shown on invoices when the org Connect account needs a reconnect. Keep identical to CARD_PAYMENTS_UNAVAILABLE. */
export const CARD_PAYMENTS_UNAVAILABLE = "Card payments unavailable";

export function cardPaymentMethodLabel(needsReconnect: boolean, acceptCards: boolean): string | null {
  if (needsReconnect) return CARD_PAYMENTS_UNAVAILABLE;
  if (acceptCards) return "Debit/Credit Cards";
  return null;
}

export function invoiceNeedsReconnect(status: {
  needs_reconnect?: boolean;
  status?: string | null;
} | null | undefined): boolean {
  if (!status) return false;
  return status.needs_reconnect === true || status.status === "needs_reconnect";
}

/**
 * Card payments, onboarding, sidebar, and health all use this.
 * needs_reconnect is not available, even when a Stripe account id is still stored.
 */
export function stripeConnectAvailable(status: {
  connected?: boolean;
  is_connected?: boolean | null;
  needs_reconnect?: boolean;
  status?: string | null;
  stripe_account_id?: string | null;
  account_id?: string | null;
} | null | undefined): boolean {
  if (!status || invoiceNeedsReconnect(status)) return false;
  if (status.connected === true || status.is_connected === true) return true;
  const accountId = (status.stripe_account_id ?? status.account_id ?? "").trim();
  return accountId.length > 0;
}
