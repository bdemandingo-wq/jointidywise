import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_ORG_STORAGE_KEY,
  readCachedMobileNav,
  readLaunchMobileNav,
  sameMobileNav,
  sanitizeMobileNavSlots,
  writeCachedMobileNav,
} from "./mobileNavSlots.ts";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => { memory.clear(); },
  key: () => null,
  length: 0,
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

const payroll = [
  { id: "dashboard", label: "Dashboard", to: "/dashboard", iconKey: "Home" },
  { id: "scheduler", label: "Calendar", to: "/dashboard/scheduler", iconKey: "Calendar" },
  { id: "bookings", label: "Bookings", to: "/dashboard/bookings", iconKey: "CalendarDays" },
  { id: "payroll", label: "Payroll", to: "/dashboard/payroll", iconKey: "DollarSign" },
];

test("a saved 4th tab of Payroll is kept and a short list is not", () => {
  assert.equal(sanitizeMobileNavSlots(payroll)?.[3].label, "Payroll");
  assert.equal(sanitizeMobileNavSlots(payroll.slice(0, 3)), null);
  assert.equal(sanitizeMobileNavSlots([{ label: "Nope", to: "/pricing", iconKey: "Home" }]), null);
});

test("launch reads the active org's saved tabs and does not invent Reports", () => {
  memory.clear();
  assert.equal(readLaunchMobileNav(), null);
  localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, "org-1");
  writeCachedMobileNav("org-1", payroll);
  const slots = readLaunchMobileNav();
  assert.equal(slots?.[3].label, "Payroll");
  assert.equal(readCachedMobileNav("org-2"), null);
  assert.equal(sameMobileNav(slots, payroll), true);
});
