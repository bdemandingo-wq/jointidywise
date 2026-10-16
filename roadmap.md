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

- [x] Deploy 16 functions from main
- [x] Seed Broward, Miami-Dade, Palm Beach FL (45 inserted)
- [x] Deploy create-subscription, admin-send-resubscribe-email, platform-analytics from main 8e831bf (all live; not invoked)
- [x] Deploy check-subscription from main e9b4cf5 (live; new-signup database trial when Stripe has no subscription)
- [x] Sync to e5424ab (#45 trial 30 days, #46 sitemap build fix); deploy check-subscription + provision-trial-org (live preflight 401s, not invoked); build OK, tsc OK
- [x] Deploy send-arrival-sms from current code (main 844f2826c; source sha 9e3a20589b0a; live: OPTIONS 200, unassigned-staff probe 403 before any send; no text sent)
- [x] Fix blank-screen 500: get_public_activity_feed() "column reference \"i\" is ambiguous" (42702) — plpgsql loop variable `i` collided with the `invoices i` alias; renamed the variable to `idx`. Migration 20261016200100_fix_public_activity_feed_name_collision.sql written and applied live; RPC + public-growth now 200; landing/pricing render.
