/**
 * Timezone utilities for converting between org timezone and UTC.
 * 
 * The system stores all timestamps in UTC (via .toISOString()).
 * These helpers ensure that when a user picks "9:00 AM" they mean
 * 9:00 AM in the *organization's* timezone (e.g. America/New_York),
 * regardless of the browser's local timezone.
 */

/**
 * Convert a date + time intended in a specific timezone to a UTC ISO string.
 * 
 * Example: orgTimeToUTCISO(2026, 1, 23, 9, 0, 'America/New_York')
 * → the UTC equivalent of 9:00 AM EST on Feb 23, 2026
 */
export function orgTimeToUTCISO(
  year: number,
  month: number, // 0-indexed (JS convention)
  day: number,
  hours: number,
  minutes: number,
  timezone: string
): string {
  // Create a UTC date with the desired numeric values
  const fakeUTC = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));

  // Find what this UTC timestamp looks like in the target timezone vs UTC
  const inTZ = new Date(fakeUTC.toLocaleString('en-US', { timeZone: timezone }));
  const inUTC = new Date(fakeUTC.toLocaleString('en-US', { timeZone: 'UTC' }));

  // The difference = timezone offset from UTC (in ms)
  const offsetMs = inTZ.getTime() - inUTC.getTime();

  // Actual UTC = fake UTC - offset
  const actualUTC = new Date(fakeUTC.getTime() - offsetMs);
  return actualUTC.toISOString();
}

/**
 * Convert a selected Date object + time string to UTC ISO, interpreting
 * the date/time as being in the org timezone.
 */
export function selectedDateTimeToUTCISO(
  date: Date,
  time: string, // "HH:mm" format
  timezone: string
): string {
  const [hours, minutes] = time.split(':').map(Number);
  return orgTimeToUTCISO(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    timezone
  );
}

/**
 * Get the date string (YYYY-MM-DD) of a UTC timestamp in a specific timezone.
 * Used for calendar day matching.
 */
export function getDateInTimezone(dateInput: Date | string, timezone: string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const dayPart = parts.find(p => p.type === 'day')!.value;
  return `${year}-${month}-${dayPart}`;
}

/**
 * Format a UTC timestamp for display in a specific timezone.
 */
export function formatInTimezone(
  dateInput: Date | string,
  timezone: string,
  options: Intl.DateTimeFormatOptions
): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(d);
}

/**
 * Extract hours and minutes from a UTC timestamp as they appear in a specific timezone.
 * Returns "HH:mm" in 24h format. Used when loading an existing booking for editing.
 */
export function getTimeInTimezone(dateInput: Date | string, timezone: string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const hour = parts.find(p => p.type === 'hour')!.value;
  const minute = parts.find(p => p.type === 'minute')!.value;
  // Intl may return "24" for midnight in some locales, normalize to "00"
  const normalizedHour = hour === '24' ? '00' : hour;
  return `${normalizedHour}:${minute}`;
}

/**
 * Get a Date object representing the calendar date (year/month/day) of a UTC
 * timestamp as it appears in a specific timezone. The returned Date uses
 * local date components only (time is set to noon to avoid edge issues).
 */
export function getLocalDateInTimezone(dateInput: Date | string, timezone: string): Date {
  const dateStr = getDateInTimezone(dateInput, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Format a timestamp as "Sep 24, 11:04 PM EDT" in the given IANA timezone,
 * independent of the viewer's device timezone.
 */
export function formatTimestampWithZone(dateInput: Date | string, timezone: string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`;
}
