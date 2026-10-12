import { format } from "date-fns";

export type OfflinePaymentMethod = "cash" | "check" | "zelle";

export const OFFLINE_PAYMENT_METHODS: { id: OfflinePaymentMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "check", label: "Check" },
  { id: "zelle", label: "Zelle" },
];

export function offlinePaymentLabel(method: string | null | undefined): string {
  return OFFLINE_PAYMENT_METHODS.find((m) => m.id === method)?.label ?? "";
}

export interface InvoiceAmountInput {
  items: { description: string; quantity: number; unitPrice: number }[];
  discountPercent: number;
  taxPercent: number;
  total: number;
}

/** Blocks the "Total due -$50.00" case and any negative price or quantity. */
export function invoiceAmountError(input: InvoiceAmountInput): string | null {
  if (!Number.isFinite(input.discountPercent) || input.discountPercent < 0) {
    return "Discount cannot be negative.";
  }
  if (!Number.isFinite(input.taxPercent) || input.taxPercent < 0) {
    return "Tax cannot be negative.";
  }
  for (const item of input.items) {
    if (!item.description.trim()) continue;
    if (!Number.isFinite(item.quantity) || item.quantity < 0) {
      return "Quantity cannot be negative.";
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      return "Price cannot be negative.";
    }
  }
  if (!Number.isFinite(input.total) || input.total < 0) {
    return "Total due cannot be negative.";
  }
  return null;
}

/**
 * Date-only strings (`YYYY-MM-DD`) are calendar days. `new Date(value)` is
 * UTC midnight, which is the previous evening west of UTC — "Due in 7 days"
 * on Oct 11 showed Oct 17.
 */
export function formatInvoiceDateLabel(value: string): string {
  const calendar = parseCalendarDate(value);
  if (calendar) return format(calendar, "MMM d, yyyy");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "MMM d, yyyy");
}

export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

export interface LocalInvoiceDraft {
  version: 1;
  savedAt: number;
  formData: Record<string, unknown>;
  lineItems: unknown[];
  showDiscount: boolean;
  showTax: boolean;
}

const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function draftKey(organizationId: string): string {
  return `tw-invoice-draft:${organizationId}`;
}

export function readLocalInvoiceDraft(organizationId: string): LocalInvoiceDraft | null {
  if (!organizationId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(draftKey(organizationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalInvoiceDraft;
    if (!parsed || parsed.version !== 1 || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_DRAFT_AGE_MS) {
      localStorage.removeItem(draftKey(organizationId));
      return null;
    }
    if (!parsed.formData || typeof parsed.formData !== "object" || !Array.isArray(parsed.lineItems)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalInvoiceDraft(organizationId: string, draft: LocalInvoiceDraft): void {
  if (!organizationId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(draftKey(organizationId), JSON.stringify(draft));
  } catch {
    // A full disk must not block typing. The database draft is the other copy.
  }
}

export function clearLocalInvoiceDraft(organizationId: string): void {
  if (!organizationId || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(draftKey(organizationId));
  } catch {
    // ignore
  }
}
