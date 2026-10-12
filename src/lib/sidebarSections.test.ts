import { test } from "node:test";
import assert from "node:assert/strict";
import { SIDEBAR_SECTIONS, groupNavItems } from "./sidebarSections.ts";

const ALL_HREFS = [
  "/dashboard",
  "/dashboard/ai-intelligence",
  "/dashboard/scheduler",
  "/dashboard/tracking",
  "/dashboard/bookings",
  "/dashboard/recurring",
  "/dashboard/customers",
  "/dashboard/client-portal",
  "/dashboard/invoices",
  "/dashboard/messages",
  "/dashboard/tasks",
  "/dashboard/leads",
  "/dashboard/operations",
  "/dashboard/campaigns",
  "/dashboard/discounts",
  "/dashboard/feedback",
  "/dashboard/services",
  "/dashboard/staff",
  "/dashboard/checklists",
  "/dashboard/booking-photos",
  "/dashboard/inventory",
  "/dashboard/payroll",
  "/dashboard/expenses",
  "/dashboard/finance",
  "/dashboard/reports",
  "/dashboard/benchmarks",
  "/dashboard/notifications",
  "/dashboard/automation-center",
  "/dashboard/payment-integration",
];

test("the full menu collapses to 8 sections and keeps every link", () => {
  const items = ALL_HREFS.map((href) => ({ href, name: href }));
  const groups = groupNavItems(items);
  assert.equal(groups.length, 8);
  assert.ok(groups.length <= 10);
  const flat = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(new Set(flat), new Set(ALL_HREFS));
  assert.equal(flat.length, ALL_HREFS.length);
});

test("saved order is kept inside a section, and unknown links are not dropped", () => {
  const items = [
    { href: "/dashboard/bookings", name: "Bookings" },
    { href: "/dashboard/scheduler", name: "Scheduler" },
    { href: "/dashboard/brand-new", name: "Brand new" },
  ];
  const groups = groupNavItems(items);
  const schedule = groups.find((g) => g.id === "schedule");
  assert.deepEqual(schedule?.items.map((i) => i.name), ["Bookings", "Scheduler"]);
  assert.equal(groups.at(-1)?.name, "More");
  assert.equal(groups.at(-1)?.items[0].href, "/dashboard/brand-new");
});

test("every declared section id is unique", () => {
  const ids = SIDEBAR_SECTIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});
