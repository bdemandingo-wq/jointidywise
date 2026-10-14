/**
 * Routes where the iOS edge swipe must not pop history.
 *
 * These are the screens a session opens onto: the admin home, the staff
 * portal (its tabs do not change the URL), and every admin tab-bar
 * destination. Popping them goes back to login or the pre-login site.
 * A page under one of those paths, such as a customer or a staff job,
 * is not a root and can still go back.
 */
const ADMIN_TAB_ROOTS = [
  '/dashboard',
  '/dashboard/ai-intelligence',
  '/dashboard/scheduler',
  '/dashboard/bookings',
  '/dashboard/recurring',
  '/dashboard/customers',
  '/dashboard/client-portal',
  '/dashboard/invoices',
  '/dashboard/messages',
  '/dashboard/tasks',
  '/dashboard/leads',
  '/dashboard/operations',
  '/dashboard/campaigns',
  '/dashboard/feedback',
  '/dashboard/services',
  '/dashboard/staff',
  '/dashboard/checklists',
  '/dashboard/booking-photos',
  '/dashboard/inventory',
  '/dashboard/discounts',
  '/dashboard/payroll',
  '/dashboard/expenses',
  '/dashboard/finance',
  '/dashboard/reports',
  '/dashboard/subscription',
  '/dashboard/automation-center',
  '/dashboard/payment-integration',
] as const;

export const IOS_BACK_SWIPE_ROOTS: ReadonlySet<string> = new Set([
  ...ADMIN_TAB_ROOTS,
  '/staff',
]);

/** WKWebView's back gesture is also enabled. Wait for it to move the route. */
export const IOS_BACK_SWIPE_SETTLE_MS = 300;

export function isIosBackSwipeRoot(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
  return IOS_BACK_SWIPE_ROOTS.has(path);
}
