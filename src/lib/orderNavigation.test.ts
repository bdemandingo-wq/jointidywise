import { test } from "node:test";
import assert from "node:assert/strict";
import { orderBySavedHrefs } from "./orderNavigation.ts";

const items = [
  { href: "/dashboard/reports", name: "Reports" },
  { href: "/dashboard/payroll", name: "Payroll" },
];

test("a saved order is the first result, not the default followed by a swap", () => {
  const ordered = orderBySavedHrefs(items, ["/dashboard/payroll", "/dashboard/reports"]);
  assert.deepEqual(ordered.map((item) => item.name), ["Payroll", "Reports"]);
});

test("a missing save keeps the default order", () => {
  assert.deepEqual(orderBySavedHrefs(items, null).map((item) => item.href), items.map((item) => item.href));
});
