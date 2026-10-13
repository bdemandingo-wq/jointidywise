# Booking Media: phone-style gallery

## What will change
- Replace grid originals with **400px / quality 70 private, signed thumbnails**. Try Storage transformations first. Detect unsupported transformation responses and fall back to lazy, asynchronously decoded images without changing bucket privacy. Show a clear retry state for other failures.
- **Virtualize grid rows** so only visible tiles plus a small buffer mount, including when the library contains hundreds of photos. Keep square placeholders and a subtle loading background so tiles never jump.
- Fetch **metadata in ordered 40-record database pages**, cached by organization for five minutes. Retain the legacy booking-linked media lookup, deduplicate records, and use a unique ID ordering tiebreaker. Render available metadata progressively; complete the lightweight metadata index to preserve existing full-library search and stats without fetching image bytes. Counts must not masquerade as complete while metadata is still loading.
- Keep the existing Before/After/Inspection and Photos/Videos filters, customer/cleaner/booking search, stats, download, delete and Move actions. Filter changes reuse the cached metadata rather than restarting requests.
- Open a **full-screen viewer** with touch swipe, desktop arrows and mobile pinch zoom. Display cleaner, customer, booking number, business-timezone date and Before/After badge, plus existing proof stamps and inspection details. Respect native safe areas.
- Fetch originals only for the open image and its immediate previous/next photos. Deduplicate prefetch requests and reuse signed URLs; skip videos during image prefetch. Changing filters keeps navigation in the current filtered order.

## Tests and review
- Add concrete tests for inclusive 40-record ranges, page termination, deduplication/stable order and adjacent-image prefetch boundaries, including filtered order and videos.
- Verify authenticated gallery loading, filters/search, full-size opening and navigation, requests using transformed thumbnail URLs, cache reuse and bounded tile count.
- Check desktop and phone-width layouts and touch gestures using browser tests. Native iOS safe-area and gesture compatibility will be implemented, but a physical iOS/Capacitor run requires your installed app and its next build; browser emulation cannot establish native verification.
- No publishing, bucket-setting changes, migrations, upload changes or unrelated pages.

## Technical approach
Use the existing TanStack Virtual dependency for row virtualization and React Query for serializable organization-scoped paged metadata. Keep private media within the SignedImage/signed-URL pipeline. Use a maintained zoom library for pinch/pan, coordinated with swipe so zooming cannot accidentally advance photos. Consolidate the duplicate realtime subscriptions and invalidate only this organization’s gallery cache after uploads or edits.