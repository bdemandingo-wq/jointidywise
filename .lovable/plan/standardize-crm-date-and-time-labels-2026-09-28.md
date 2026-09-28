# Standardize CRM date and time labels

## Scope
- Keep calendar-only dates unchanged, since they are not timestamps.
- Convert every user-facing CRM timestamp to the active business timezone.
- Show the timezone abbreviation on each timestamp, matching `Sep 24, 11:04 PM EDT`.
- Cover admin, messaging, notifications, bookings, staff, payroll, automation, and client portal screens.
- Preserve the existing layouts and controls.

## Implementation
- Reuse the existing organization-timezone source and shared formatter.
- Add a small shared timestamp display component so future screens inherit the same rule.
- Replace device-local timestamp formatting and add the zone label to already timezone-aware timestamp displays.
- Keep date-only business fields, date pickers, calendar headings, file names, and generated export dates unchanged.

## Verification
- Run the full TypeScript check and lint the touched files.
- Check the live preview on desktop and mobile widths, including Staff Activity and representative messaging, notification, and booking screens.
