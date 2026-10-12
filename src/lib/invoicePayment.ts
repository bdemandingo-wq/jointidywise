import { supabase } from "@/lib/supabase";
import { mustAffectRows } from "@/lib/mustAffectRows";
import type { OfflinePaymentMethod } from "@/lib/invoiceDraft";

function isMissingPaymentMethodColumn(message: string): boolean {
  return /payment_method|42703|schema cache/i.test(message);
}

/**
 * Mark an invoice paid without Stripe. Tries to store cash/check/Zelle on
 * `invoices.payment_method`. If that column is not migrated yet, the status
 * update still lands and the caller is told the method was not stored.
 */
export async function markInvoicePaidOffline(
  id: string,
  method: OfflinePaymentMethod,
): Promise<"stored" | "status-only"> {
  const paidAt = new Date().toISOString();
  const withMethod = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: paidAt, payment_method: method } as never)
    .eq("id", id)
    .select("id");

  if (!withMethod.error && (withMethod.data?.length ?? 0) > 0) return "stored";

  if (withMethod.error && !isMissingPaymentMethodColumn(withMethod.error.message)) {
    throw withMethod.error;
  }
  if (!withMethod.error && (withMethod.data?.length ?? 0) === 0) {
    throw new Error("Invoice not marked as paid. Nothing was written.");
  }

  await mustAffectRows(
    supabase.from("invoices").update({ status: "paid", paid_at: paidAt }).eq("id", id),
    "Invoice not marked as paid. Nothing was written.",
    { table: "invoices" },
  );
  return "status-only";
}

export async function undoInvoicePaid(id: string, previousStatus: string): Promise<void> {
  const withMethod = await supabase
    .from("invoices")
    .update({ status: previousStatus, paid_at: null, payment_method: null } as never)
    .eq("id", id)
    .select("id");

  if (!withMethod.error && (withMethod.data?.length ?? 0) > 0) return;
  if (withMethod.error && !isMissingPaymentMethodColumn(withMethod.error.message)) {
    throw withMethod.error;
  }

  await mustAffectRows(
    supabase
      .from("invoices")
      .update({ status: previousStatus, paid_at: null })
      .eq("id", id),
    "Payment not undone. The invoice was not writable.",
    { table: "invoices" },
  );
}
