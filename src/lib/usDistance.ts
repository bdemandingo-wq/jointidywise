/** Statute mile. GPS check-ins are shown in feet and miles, never kilometers. */
const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.280839895;

/** Under this, show feet. About 0.1 mile (528 ft). */
const FEET_CUTOFF_MILES = 0.1;

/** Over this, the check-in is allowed and flagged to the owner. About 0.25 mile. */
export const FAR_CHECKIN_METERS = 0.25 * METERS_PER_MILE;

export function isFarFromProperty(meters: number): boolean {
  return meters > FAR_CHECKIN_METERS;
}

/**
 * `120 ft` when under about 0.1 mile, otherwise miles (`0.3 miles`, `1,072 miles`).
 */
export function formatUsDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < FEET_CUTOFF_MILES) {
    const feet = Math.max(0, Math.round(meters * FEET_PER_METER));
    return `${feet.toLocaleString('en-US')} ft`;
  }
  if (miles < 10) {
    const rounded = Math.round(miles * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    const unit = rounded === 1 ? 'mile' : 'miles';
    return `${text} ${unit}`;
  }
  const whole = Math.round(miles);
  const unit = whole === 1 ? 'mile' : 'miles';
  return `${whole.toLocaleString('en-US')} ${unit}`;
}

/** `120 ft from the property` or `1,072 miles from the property`. */
export function propertyDistancePhrase(meters: number): string {
  return `${formatUsDistance(meters)} from the property`;
}
