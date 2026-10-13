# Timezone display update

## Service duration display
- [x] Review and approve the display-only plan.
- [x] Add the shared duration formatter and concrete edge-case tests (20 passed).
- [x] Replace available service/booking duration labels and add the minute-input preview.
- [x] Review changes and verify real table/booking flows at desktop and mobile widths.
- [ ] Existing client portal bookings: API omits duration; requires an authorized data-response change outside this frontend-only task.

- [ ] Standardize shared timestamp formatting with a visible EST/EDT label.
- [ ] Update admin CRM timestamp displays.
- [ ] Update staff and client portal timestamp displays.
- [ ] Verify type checking, lint, preview rendering, and mobile layout.

## Team jobs
- [x] Admin form, staff badge, safe claim, admin detail, payroll, tests
- [ ] Live phone check of staff card with a real team job (needs a test team booking)

## Booking Media gallery
- [x] Approve the gallery performance plan.
- [x] Implement transformed thumbnails with unsupported-plan fallback, cached paginated metadata and virtualized grid.
- [x] Add full-screen swipe/pinch viewer and adjacent-image prefetch; preserve filters, stats and actions.
- [x] Six pagination/order/prefetch/fallback tests passed; authenticated 320-photo desktop/mobile gallery verified, touch swipe and 2.55x pinch verified, cached return reused metadata, unsupported-plan original fallback verified, targeted lint and preview build clean.
- [ ] Physical iOS/Capacitor verification needs the next native build and an installed device; browser gestures are verified, not native gestures.
