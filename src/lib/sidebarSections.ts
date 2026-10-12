/**
 * Sidebar grouping. Every href in the flat nav belongs to one section.
 * Items the section list does not know about land in "More" so a new page
 * cannot silently disappear from the menu.
 *
 * Order inside a section follows `items` (the saved order), not the order
 * hrefs are declared here.
 */

export interface SidebarSectionDef {
  id: string;
  name: string;
  hrefs: string[];
}

export const SIDEBAR_SECTIONS: SidebarSectionDef[] = [
  { id: "home", name: "Dashboard", hrefs: ["/dashboard"] },
  {
    id: "schedule",
    name: "Schedule",
    hrefs: [
      "/dashboard/scheduler",
      "/dashboard/bookings",
      "/dashboard/recurring",
      "/dashboard/tracking",
      "/dashboard/tasks",
    ],
  },
  {
    id: "customers",
    name: "Customers",
    hrefs: [
      "/dashboard/customers",
      "/dashboard/leads",
      "/dashboard/client-portal",
      "/dashboard/messages",
      "/dashboard/feedback",
    ],
  },
  {
    id: "money",
    name: "Money",
    hrefs: [
      "/dashboard/invoices",
      "/dashboard/discounts",
      "/dashboard/payroll",
      "/dashboard/expenses",
      "/dashboard/finance",
      "/dashboard/reports",
    ],
  },
  {
    id: "team",
    name: "Team",
    hrefs: [
      "/dashboard/staff",
      "/dashboard/checklists",
      "/dashboard/booking-photos",
      "/dashboard/operations",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    hrefs: [
      "/dashboard/campaigns",
      "/dashboard/automation-center",
      "/dashboard/ai-intelligence",
      "/dashboard/benchmarks",
      "/dashboard/notifications",
    ],
  },
  {
    id: "catalog",
    name: "Services",
    hrefs: ["/dashboard/services", "/dashboard/inventory"],
  },
  {
    id: "payments",
    name: "Payments",
    hrefs: ["/dashboard/payment-integration"],
  },
];

export interface SidebarGroup<T> {
  id: string;
  name: string;
  items: T[];
}

export function groupNavItems<T extends { href: string }>(
  items: T[],
  sections: SidebarSectionDef[] = SIDEBAR_SECTIONS,
): SidebarGroup<T>[] {
  const membership = new Map<string, string>();
  for (const section of sections) {
    for (const href of section.hrefs) membership.set(href, section.id);
  }

  const buckets = new Map<string, T[]>();
  const leftovers: T[] = [];
  for (const item of items) {
    const id = membership.get(item.href);
    if (!id) {
      leftovers.push(item);
      continue;
    }
    const list = buckets.get(id) ?? [];
    list.push(item);
    buckets.set(id, list);
  }

  const groups = sections
    .map((section) => ({
      id: section.id,
      name: section.name,
      items: buckets.get(section.id) ?? [],
    }))
    .filter((group) => group.items.length > 0);

  if (leftovers.length > 0) {
    groups.push({ id: "more", name: "More", items: leftovers });
  }
  return groups;
}
