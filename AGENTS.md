# Project conventions

- Service and estimated booking duration labels use `src/lib/formatDuration.ts` only at presentation boundaries; persisted minutes and scheduling/payroll calculations stay numeric to avoid changing booked time or pay.
- Booking Media uses an organization-scoped paged metadata hook with serializable results and window-virtualized rows; completing metadata separately preserves full-library search/stats without mounting every image.
- Booking Media thumbnail capability detection is opt-in through SignedImage; session-only signed-URL and prefetch caches keep private image credentials out of persisted query results.
- Full-screen gallery zoom uses react-zoom-pan-pinch, disabling swipe while zoomed or multi-touching so gestures cannot accidentally change the selected media.