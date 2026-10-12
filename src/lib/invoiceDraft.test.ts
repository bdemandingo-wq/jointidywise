import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "date-fns";
import { orgAddDays, orgDateKey } from "./orgDateRange.ts";
import {
  formatInvoiceDateLabel,
  invoiceAmountError,
  parseCalendarDate,
} from "./invoiceDraft.ts";

const NY = "America/New_York";

test("In 7 days from Oct 11 is Oct 18, and the label does not shift to Oct 17", () => {
  // Noon EDT on Oct 11. Testers saw this render as Oct 17 because
  // new Date('2026-10-18') is UTC midnight — the previous evening in the US.
  const oct11 = new Date("2026-10-11T16:00:00Z");
  const due = orgDateKey(orgAddDays(oct11, 7, NY), NY);
  assert.equal(due, "2026-10-18");

  const calendar = parseCalendarDate(due);
  assert.ok(calendar);
  // These reads are the assertion: the parsed value must be the calendar day
  // itself, which is exactly what `new Date("YYYY-MM-DD")` gets wrong.
  /* eslint-disable local/no-device-local-dates */
  assert.equal(calendar.getFullYear(), 2026);
  assert.equal(calendar.getMonth(), 9);
  assert.equal(calendar.getDate(), 18);
  /* eslint-enable local/no-device-local-dates */
  assert.equal(formatInvoiceDateLabel(due), format(calendar, "MMM d, yyyy"));
  assert.equal(formatInvoiceDateLabel(due), "Oct 18, 2026");
});

test("a full timestamp still formats as an instant", () => {
  const label = formatInvoiceDateLabel("2026-10-11T16:00:00.000Z");
  assert.match(label, /Oct 1[12], 2026/);
});

test("negative prices, quantities, and totals are rejected", () => {
  assert.equal(
    invoiceAmountError({
      items: [{ description: "Clean", quantity: 1, unitPrice: -50 }],
      discountPercent: 0,
      taxPercent: 0,
      total: -50,
    }),
    "Price cannot be negative.",
  );
  assert.equal(
    invoiceAmountError({
      items: [{ description: "Clean", quantity: -1, unitPrice: 50 }],
      discountPercent: 0,
      taxPercent: 0,
      total: -50,
    }),
    "Quantity cannot be negative.",
  );
  assert.equal(
    invoiceAmountError({
      items: [{ description: "Clean", quantity: 1, unitPrice: 100 }],
      discountPercent: 150,
      taxPercent: 0,
      total: -50,
    }),
    "Total due cannot be negative.",
  );
  assert.equal(
    invoiceAmountError({
      items: [{ description: "Clean", quantity: 1, unitPrice: 100 }],
      discountPercent: 0,
      taxPercent: 0,
      total: 100,
    }),
    null,
  );
});
