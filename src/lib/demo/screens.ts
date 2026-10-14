/**
 * Public demo deep links. `/demo?screen=` opens one of these screens.
 * The ids are the data-tour-id / element id values a future tour can target.
 * This module does not render a tour.
 */

export const DEMO_TOUR = {
  revenue: 'demo-revenue',
  calendar: 'demo-calendar',
  booking: 'demo-booking-form',
  scheduling: 'demo-staff-scheduling',
  payments: 'demo-payments',
} as const;

export type DemoScreen = 'dashboard' | 'calendar' | 'booking' | 'scheduling' | 'payments';

const SCREENS: Record<DemoScreen, { path: string; tourId: string }> = {
  dashboard: { path: '/dashboard', tourId: DEMO_TOUR.revenue },
  calendar: { path: '/dashboard/scheduler', tourId: DEMO_TOUR.calendar },
  booking: { path: '/book/harbor-pine-cleaning', tourId: DEMO_TOUR.booking },
  scheduling: { path: '/dashboard/scheduler', tourId: DEMO_TOUR.scheduling },
  payments: { path: '/dashboard/invoices', tourId: DEMO_TOUR.payments },
};

export function isDemoScreen(value: string | null | undefined): value is DemoScreen {
  return value === 'dashboard'
    || value === 'calendar'
    || value === 'booking'
    || value === 'scheduling'
    || value === 'payments';
}

/** Path the public demo should open for `?screen=`. Null keeps the booked-walkthrough page. */
export function demoScreenPath(screen: string | null | undefined): string | null {
  if (!isDemoScreen(screen)) return null;
  const target = SCREENS[screen];
  return `${target.path}#${target.tourId}`;
}

export function demoScreenTourId(screen: string | null | undefined): string | null {
  if (!isDemoScreen(screen)) return null;
  return SCREENS[screen].tourId;
}
