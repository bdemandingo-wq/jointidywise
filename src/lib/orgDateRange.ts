/**
 * Business-day boundaries in the ORGANISATION's timezone, never the device's.
 *
 * WHY THIS EXISTS
 * On 2026-07-31 the dashboard's gross volume read $888 on a Miami computer and
 * $616 on a phone in Manila. `AdminDashboard` filtered with date-fns `isToday`,
 * which compares against the BROWSER's calendar day. Manila is twelve hours
 * ahead of EDT, so the phone's "today" ran from noon on 31 July to noon on
 * 1 August in Miami terms — a band spanning two business days and matching
 * neither. Thirty files across the app compute windows that way.
 *
 * The rule this module exists to hold: **a business day starts and ends in the
 * business's timezone.** Where the person looking happens to be standing is
 * never part of the answer.
 *
 * WHY NOT date-fns-tz
 * It isn't installed, and this network has been unable to add packages all
 * session. `Intl.DateTimeFormat` with a timeZone is in every browser this app
 * supports and handles DST correctly, because the IANA database is what it
 * reads. The offset maths below is the standard trick for inverting it.
 */

/** 0 = Sunday … 6 = Saturday, matching Date.getDay() and Postgres `dow`. */
export type WeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * payroll_settings.payroll_week_start_day is stored as a lowercase day name and
 * is, as of 2026-07-31, read by nothing at all. This is the one place it has a
 * home: the week helper below is the only code that needs to know when a
 * business's week begins.
 */
const DAY_NAME_TO_INDEX: Record<string, WeekStartDay> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** Monday, matching the value PayrollPage hardcoded before this existed. */
export const DEFAULT_WEEK_START: WeekStartDay = 1;

export function parseWeekStartDay(value: unknown): WeekStartDay {
  if (typeof value === 'number' && value >= 0 && value <= 6) return value as WeekStartDay;
  if (typeof value === 'string') {
    const idx = DAY_NAME_TO_INDEX[value.trim().toLowerCase()];
    if (idx !== undefined) return idx;
  }
  return DEFAULT_WEEK_START;
}

/**
 * What UTC offset does `timeZone` have at `instant`, in minutes?
 *
 * Formats the instant in that zone, reads the numbers back as if they were UTC,
 * and takes the difference. Correct across DST because Intl applies whichever
 * rule was in force at that instant, rather than today's.
 */
/**
 * The parts→offset arithmetic, extracted so it can be tested directly.
 *
 * EXPORTED FOR TESTS. The bug this fixes cannot be reproduced in Node: V8 never
 * renders midnight as hour "24", so a test driving the real Intl can never fail
 * before the fix and therefore proves nothing. Testing the transform with
 * hand-written parts is what makes a red-green possible.
 *
 * WebKit — which is what the iOS Capacitor WebView runs — can render exact local
 * midnight as `24:00` carrying the date of the day that is ENDING. The previous
 * code mapped hour "24" to "00" but kept that ending day, so the computed offset
 * came out exactly 1440 minutes short and every start-of-day/week/month/year
 * resolution landed a full day early. Measured: -1680 instead of -240 for
 * America/New_York.
 */
export function offsetFromParts(parts: Record<string, string>, instantMs: number): number {
  let day = Number(parts.day);
  let hour = Number(parts.hour);
  // "24:00 on day D" IS "00:00 on day D+1". Advance the day as well as zeroing
  // the hour — Date.UTC normalises an overflowing day into the next month.
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, day,
    hour, Number(parts.minute), Number(parts.second),
  );
  // ROUND, don't divide raw. formatToParts has second precision, so `asUTC`
  // carries no milliseconds while `instant` may. Without rounding, asking for
  // 23:59:59.999 produced an offset 999ms off true, which pushed every
  // end-of-day/week/month one millisecond PAST local midnight and reported the
  // next day. Real UTC offsets are always whole minutes.
  return Math.round((asUTC - instantMs) / 60000);
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // hourCycle h23 forces 00-23 and prevents the "24" rendering at source.
    // The guard in offsetFromParts stays as defence in case an engine ignores
    // it — belt and braces, because the failure is silent and a full day wide.
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return offsetFromParts(parts, instant.getTime());
}

/** The wall-clock Y/M/D in `timeZone` at this instant. */
export function orgYMD(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = dtf.format(instant).split('-').map(Number);
  return { y, m, d };
}

/**
 * The instant at which a given wall-clock time occurs in `timeZone`.
 *
 * Two passes: guess using the offset at the naive timestamp, then re-measure at
 * the guess and correct. One correction is enough for every real zone — the
 * only case needing more would be an offset change of more than a day.
 */
function zonedTimeToInstant(
  y: number, m: number, d: number, hh: number, mm: number, ss: number, ms: number,
  timeZone: string,
): Date {
  /*
    Normalise first. Date.UTC happily accepts day 33 or hour 25 and rolls them
    over, but the gap loop below compares the RESOLVED date against the numbers
    passed in — so an un-normalised 33 could never match, all eight probes ran,
    and the result came back four hours late. Found when orgAddDaysPreservingTime
    passed d + days without rolling it over first; the trap was open to every
    caller, not just that one.
  */
  const norm = new Date(Date.UTC(y, m - 1, d, hh, mm, ss, ms));
  y = norm.getUTCFullYear();
  m = norm.getUTCMonth() + 1;
  d = norm.getUTCDate();

  const naive = norm.getTime();
  let instant = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60000);
  instant = new Date(naive - offsetMinutes(instant, timeZone) * 60000);

  // ── DST GAP POLICY ──────────────────────────────────────────────────────
  // On a spring-forward day the requested wall time may not exist. Where the
  // transition is at local midnight — Havana, Cairo, Beirut, Santiago and the
  // Azores all do this in 2026 — "00:00" is skipped entirely and the arithmetic
  // above lands on the PREVIOUS day. A start-of-day that returns yesterday is
  // the worst possible answer: silent, and off by a whole day.
  //
  // Policy: a business day begins at the first instant that actually exists on
  // it. If the resolved instant renders as a different calendar date than the
  // one asked for, step forward until it doesn't. Gaps are at most a couple of
  // hours, so a few 30-minute probes settle it; the loop is bounded so a zone
  // with pathological rules cannot hang the caller.
  const wanted = { y, m, d };
  for (let probe = 0; probe < 8; probe++) {
    const got = orgYMD(instant, timeZone);
    if (got.y === wanted.y && got.m === wanted.m && got.d === wanted.d) break;
    // Only ever step FORWARD. Stepping back could cross the transition again
    // and oscillate.
    instant = new Date(instant.getTime() + 30 * 60000);
  }
  return instant;
}

/**
 * The instant at which a given wall-clock time occurs on a given org-local day.
 *
 * For pairing a picked date with a picked time — both of which are the
 * business's wall clock, not the viewer's. Using `new Date(d).setHours(...)`
 * instead resolves against the DEVICE, which is how a fetch window and the
 * instant it is compared against ended up on different calendar days.
 */
export function orgSetTimeOnDay(
  y: number, m: number, d: number, hours: number, minutes: number, timeZone: string,
): Date {
  return zonedTimeToInstant(y, m, d, hours, minutes, 0, 0, timeZone);
}

/**
 * The calendar day a DATE-PICKER token represents, as `yyyy-MM-dd`.
 *
 * react-day-picker hands back a local-midnight Date standing for the cell the
 * user clicked — it is a token for a calendar day, not an instant on a
 * timeline. Reading its local fields is therefore correct, and converting it
 * through a timezone would be wrong: it would shift the day the user picked.
 *
 * Use this ONLY for picker output. For a real instant (a scheduled_at, a
 * created_at) use orgDateKey, which resolves against the org's clock.
 */
export function calendarDayKey(pickerDate: Date): string {
  const y = pickerDate.getFullYear();
  const m = pickerDate.getMonth() + 1;
  const d = pickerDate.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Inverse of calendarDayKey. A DATE column (`yyyy-MM-dd`) is a calendar day,
 * not an instant. `new Date('yyyy-MM-dd')` parses as UTC midnight and lands on
 * the previous evening in US timezones — that is how an expense opened on
 * yesterday's date. Build a local-midnight Date from the fields instead.
 */
export function calendarDayFromKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!match) return new Date(NaN);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return new Date(y, m - 1, d);
}

/** First instant of the org-local day containing `instant`. */
export function orgStartOfDay(instant: Date, timeZone: string): Date {
  const { y, m, d } = orgYMD(instant, timeZone);
  return zonedTimeToInstant(y, m, d, 0, 0, 0, 0, timeZone);
}

/** Last instant of the org-local day containing `instant` (23:59:59.999). */
export function orgEndOfDay(instant: Date, timeZone: string): Date {
  const { y, m, d } = orgYMD(instant, timeZone);
  return zonedTimeToInstant(y, m, d, 23, 59, 59, 999, timeZone);
}

/** Is `instant` on the same org-local calendar day as `other`? */
export function isSameOrgDay(instant: Date, other: Date, timeZone: string): boolean {
  const a = orgYMD(instant, timeZone);
  const b = orgYMD(other, timeZone);
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Is `instant` on the org's current calendar day? Replaces date-fns isToday. */
export function isOrgToday(instant: Date, timeZone: string, now: Date = new Date()): boolean {
  return isSameOrgDay(instant, now, timeZone);
}

/** Day of week (0=Sun) of the org-local day containing `instant`. */
export function orgDayOfWeek(instant: Date, timeZone: string): number {
  const { y, m, d } = orgYMD(instant, timeZone);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * First instant of the org-local week containing `instant`.
 *
 * `weekStartsOn` comes from payroll_settings.payroll_week_start_day via
 * parseWeekStartDay, defaulting to Monday.
 */
export function orgStartOfWeek(
  instant: Date, timeZone: string, weekStartsOn: WeekStartDay = DEFAULT_WEEK_START,
): Date {
  const dow = orgDayOfWeek(instant, timeZone);
  const back = (dow - weekStartsOn + 7) % 7;
  const { y, m, d } = orgYMD(instant, timeZone);
  // Step in whole days on the UTC calendar, then resolve — so a DST shift
  // inside the week cannot drag the boundary off midnight.
  const stepped = new Date(Date.UTC(y, m - 1, d - back));
  return zonedTimeToInstant(
    stepped.getUTCFullYear(), stepped.getUTCMonth() + 1, stepped.getUTCDate(),
    0, 0, 0, 0, timeZone,
  );
}

export function orgEndOfWeek(
  instant: Date, timeZone: string, weekStartsOn: WeekStartDay = DEFAULT_WEEK_START,
): Date {
  const start = orgStartOfWeek(instant, timeZone, weekStartsOn);
  const { y, m, d } = orgYMD(start, timeZone);
  const stepped = new Date(Date.UTC(y, m - 1, d + 6));
  return zonedTimeToInstant(
    stepped.getUTCFullYear(), stepped.getUTCMonth() + 1, stepped.getUTCDate(),
    23, 59, 59, 999, timeZone,
  );
}

/**
 * Add (or subtract) whole CALENDAR days in the org's timezone.
 *
 * Not `instant + n * 86400000`. Across a DST change a local day is 23 or 25
 * hours, so millisecond arithmetic drifts off midnight and eventually lands on
 * the wrong date. Steps on the calendar, then resolves back to an instant.
 */
export function orgAddDays(instant: Date, days: number, timeZone: string): Date {
  const { y, m, d } = orgYMD(instant, timeZone);
  const stepped = new Date(Date.UTC(y, m - 1, d + days));
  return zonedTimeToInstant(
    stepped.getUTCFullYear(), stepped.getUTCMonth() + 1, stepped.getUTCDate(),
    0, 0, 0, 0, timeZone,
  );
}

/** Whole calendar days between two instants, in org-local terms. */
/**
 * N org-calendar days later, KEEPING the org-local time of day.
 *
 * orgAddDays returns midnight, which is right for a range boundary and wrong
 * for anything scheduled. Stepping a booking with `d.setDate(d.getDate() + 1)`
 * instead adds a fixed 24 hours, so a recurring 9am job crosses its own DST
 * transition and becomes 10am — or 8am — for the rest of the series.
 *
 * "Same time next week" means the same WALL CLOCK time, not the same elapsed
 * seconds. That is what this does.
 */
export function orgAddDaysPreservingTime(instant: Date, days: number, timeZone: string): Date {
  const { y, m, d } = orgYMD(instant, timeZone);
  const [hh, mm] = formatInOrgTz(instant, timeZone, {
    hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23',
  }).split(':').map(Number);
  // Date.UTC normalises day overflow, so d + days may exceed the month length.
  return orgSetTimeOnDay(y, m, d + days, hh, mm, timeZone);
}

export function orgDaysBetween(a: Date, b: Date, timeZone: string): number {
  const x = orgYMD(a, timeZone);
  const y2 = orgYMD(b, timeZone);
  const ax = Date.UTC(x.y, x.m - 1, x.d);
  const bx = Date.UTC(y2.y, y2.m - 1, y2.d);
  return Math.round((bx - ax) / 86400000);
}

export function orgStartOfYear(instant: Date, timeZone: string): Date {
  const { y } = orgYMD(instant, timeZone);
  return zonedTimeToInstant(y, 1, 1, 0, 0, 0, 0, timeZone);
}

/**
 * First instant of the org-local QUARTER containing `instant`.
 *
 * Added because ReportsOverview had orgStartOfDay(startOfQuarter(now), tz) —
 * the quarter boundary picked in the DEVICE's zone, then snapped to the org's
 * midnight. Its MTD and YTD neighbours were both fully org-resolved; only QTD
 * was left, in an adjacent switch case. Without an org-aware quarter helper
 * there was nothing else to reach for, which is how it survived the sweep.
 */
export function orgStartOfQuarter(instant: Date, timeZone: string): Date {
  const { y, m } = orgYMD(instant, timeZone);
  const firstMonthOfQuarter = Math.floor((m - 1) / 3) * 3 + 1;
  return orgSetTimeOnDay(y, firstMonthOfQuarter, 1, 0, 0, timeZone);
}

export function orgStartOfMonth(instant: Date, timeZone: string): Date {
  const { y, m } = orgYMD(instant, timeZone);
  return zonedTimeToInstant(y, m, 1, 0, 0, 0, 0, timeZone);
}

export function orgEndOfMonth(instant: Date, timeZone: string): Date {
  const { y, m } = orgYMD(instant, timeZone);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return zonedTimeToInstant(y, m, lastDay, 23, 59, 59, 999, timeZone);
}

/**
 * Format an instant using the ORG's wall clock.
 *
 * A label rendered with date-fns `format()` uses the device's clock, so it can
 * name a different day than the boundary it is describing — the label and the
 * data disagreeing is worse than either being wrong alone.
 */
export function formatInOrgTz(
  instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(instant);
}

/**
 * `yyyy-MM-dd` for the org-local day containing `instant`.
 *
 * This is the format payroll_payments.week_start is stored in, so it is the one
 * function whose output ends up in the database. It must never be produced with
 * `format(date)` from date-fns, which renders in device-local time.
 */
export function orgDateKey(instant: Date, timeZone: string): string {
  const { y, m, d } = orgYMD(instant, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
