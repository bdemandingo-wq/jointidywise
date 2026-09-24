export interface InvoicePartyLike {
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}

export interface InvoiceLineItemLike {
  id?: string;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  sort_order?: number | null;
}

export interface InvoiceLike {
  invoice_number: number;
  status?: string | null;
  customer?: InvoicePartyLike | null;
  lead?: InvoicePartyLike | null;
  invoice_items?: InvoiceLineItemLike[] | null;
  subtotal?: number | null;
  total_amount: number;
  notes?: string | null;
  address?: string | null;
  created_at: string;
  due_date?: string | null;
  paid_at?: string | null;
  /**
   * Extra addresses to copy on the invoice email, as saved by
   * InvoiceFormDialog's "CC recipients" field.
   *
   * Optional because callers pass loosely-typed rows, but the column is
   * NOT NULL on `invoices` and every current caller selects `*`, so it is
   * populated in practice.
   */
  cc_emails?: string[] | null;
}

function addDaysToDateString(value: string, days: number) {
  // A due date is N days of ELAPSED time from the invoice's creation instant.
  // setDate() added a device-local calendar day, which is 23 or 25 hours across
  // a DST transition and shifted the deadline by an hour for the rest of its
  // life. Plain milliseconds are exact and carry no zone.
  return new Date(new Date(value).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function formatInvoiceNumber(invoiceNumber: number | string) {
  return `INV-${String(invoiceNumber).padStart(4, "0")}`;
}

export function getInvoiceParty(invoice: InvoiceLike): InvoicePartyLike | null {
  return invoice.customer ?? invoice.lead ?? null;
}

export function getInvoiceContact(invoice: InvoiceLike) {
  const party = getInvoiceParty(invoice);
  const name = party?.name || [party?.first_name, party?.last_name].filter(Boolean).join(" ") || "Unknown Customer";

  return {
    name,
    email: party?.email || "",
    phone: party?.phone || "",
  };
}

export function getInvoiceLineItems(invoice: InvoiceLike) {
  const items = [...(invoice.invoice_items ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((item) => ({
      description: item.description?.trim() || "Service",
      quantity: Number(item.quantity ?? 1),
      unitPrice: Number(item.unit_price ?? item.total ?? 0),
      total: Number(item.total ?? item.unit_price ?? 0),
    }));

  return items.length > 0
    ? items
    : [
        {
          description: "Service",
          quantity: 1,
          unitPrice: Number(invoice.total_amount ?? 0),
          total: Number(invoice.total_amount ?? 0),
        },
      ];
}

export function getInvoiceServiceAddressLines(invoice: InvoiceLike) {
  const party = getInvoiceParty(invoice);
  const street = invoice.address || party?.address || "";
  const cityStateZip = [party?.city, party?.state, party?.zip_code].filter(Boolean).join(", ").replace(", ,", ",");

  return [street, cityStateZip].filter(Boolean);
}

export function getInvoiceServiceAddress(invoice: InvoiceLike) {
  return getInvoiceServiceAddressLines(invoice).join("\n");
}

export function getInvoiceDueDate(invoice: InvoiceLike) {
  return invoice.due_date || addDaysToDateString(invoice.created_at, 7);
}

export function isInvoicePaid(invoice: InvoiceLike) {
  return invoice.status === 'paid' || Boolean(invoice.paid_at);
}

export function buildInvoiceEmailPayload(invoice: InvoiceLike, organizationId: string) {
  const contact = getInvoiceContact(invoice);

  return {
    organizationId,
    invoiceNumber: invoice.invoice_number,
    customerName: contact.name,
    customerEmail: contact.email,
    customerPhone: contact.phone || undefined,
    invoiceDate: invoice.created_at,
    dueDate: getInvoiceDueDate(invoice),
    subtotal: Number(invoice.subtotal ?? invoice.total_amount ?? 0),
    total: Number(invoice.total_amount ?? 0),
    address: getInvoiceServiceAddress(invoice) || undefined,
    notes: invoice.notes || undefined,
    isPaid: isInvoicePaid(invoice),
    paidAt: invoice.paid_at || undefined,
    lineItems: getInvoiceLineItems(invoice),
    // CC recipients were collected by InvoiceFormDialog, stored on the invoice
    // row, and accepted by send-invoice — but omitted here, so every send that
    // went through this builder (the list-row Send/Resend button and
    // InvoiceViewDialog) silently dropped them. Only sending straight from the
    // create/edit dialog, which builds its own body, ever carried them.
    //
    // Key name is `ccEmails` to match what send-invoice actually reads
    // (`data.ccEmails`) and what InvoiceFormDialog already sends — not the
    // column name. The function treats an empty array as "no CC", so passing
    // [] is safe and mirrors the dialog's behaviour.
    ccEmails: Array.isArray(invoice.cc_emails)
      ? invoice.cc_emails.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      : [],
    // "Send a copy to myself" — saved on the invoice, BCCs the business inbox.
    sendCopyToSelf: (invoice as { send_copy_to_self?: boolean | null }).send_copy_to_self !== false,
  };
}
