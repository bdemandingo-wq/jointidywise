# Fix the homepage text flash and make multiple alert numbers obvious

## 1. Text flash on jointidywise.com

What's happening: the live site is already fixed. The server now sends that text hidden. But your browser kept an older saved copy of the homepage for offline use, and it keeps showing that copy until an update is accepted. So returning visitors, like you, still see the plain text for a moment. First-time visitors don't.

Fix:
- When someone opens the site, their browser gets the newest homepage from the server first. It uses the saved offline copy only when there's no internet. The offline app still works.
- Old saved copies of the homepage are cleared automatically, so nobody has to accept an update or clear their browser.
- This takes effect after you publish.

## 2. Personal Cell(s): clear "add another number" controls

Replace the single text box in Settings → General with a list:

```text
Personal Cell(s) (alerts)
[ 813-735-6859        ] [x]
[ 561-555-0100        ] [x]
[ + Add another number ]
Every text alert goes to all of these numbers. Never shown to customers.
```

- Each number gets its own box and a remove button.
- "+ Add another number" adds an empty box, up to 5 numbers.
- Blank or too-short numbers are flagged inline and never saved.
- Numbers are still saved in the same place as today, so the alert texts already built for several numbers work unchanged.

## Technical details

- `vite.config.ts` (workbox): set a `NetworkFirst` runtime rule for navigation requests with a short network timeout, falling back to the cache. Drop `index.html` from the precache navigateFallback path, or keep it only as the offline fallback. Add `cleanupOutdatedCaches: true`. `registerType: "prompt"` stays as it is for JS/CSS assets.
- `src/pages/admin/SettingsPage.tsx`: the UI splits `settings.notification_phone` on `[,;\n]` into an array and joins it with `, ` on change. Load and save stay the same. Validation requires at least 10 digits per entry.
- No backend or database changes.
