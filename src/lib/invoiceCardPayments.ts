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
