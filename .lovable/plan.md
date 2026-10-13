# Display service durations as hour ranges

## What changes
- Use one shared formatter for service and estimated booking duration labels across the app: Services & Pricing, public booking, admin booking details, client portal, and staff job views.
- Match your examples exactly: **90 → 1.5–2 hrs**, **120 → 2–3 hrs**, **180 → 3–4 hrs**, **240 → 4–5 hrs**, **300 → 5–6 hrs**. Below an hour, retain minutes: **45 → 45 min**.
- Keep service duration inputs in minutes. Show a live preview alongside/below the input, such as **300 min → 5–6 hrs**, without crowding narrow screens.
- Preserve the existing layouts, colors, and controls.

## What stays unchanged
- No database changes, migrations, function deployments, or changes to stored duration values.
- Scheduling, calendar placement, end-time calculations, payroll, and actual worked-time measurements continue using raw minutes.
- Unrelated minute labels (travel time, call length, countdowns, clocked time) remain unchanged.

## Formatter decisions
Your 90-minute example takes precedence over the phrase “floor to hours”: the lower bound retains fractional hours; the upper bound is the next whole hour, including for exact-hour values. Thus 150 minutes displays **2.5–3 hrs**, while 60 displays **1–2 hrs**.
- Use an en dash and the suffix `hrs`, with no unnecessary trailing `.0`.
- Round fractional hours to at most two decimal places for unusual minute values.
- Zero displays **0 min**. Missing, negative, or non-finite values display **—**, rather than inventing an estimate.
- Empty editor input shows no preview until a valid number is entered.

## Technical implementation
- Add a pure shared formatter in `src/lib/formatDuration.ts` and colocated tests using the existing Node test convention, without adding dependencies.
- Inventory duration renderers, including existing hour conversions, then replace only service/estimated booking display expressions.
- Keep numeric form values, submitted payloads, query results, and calculation code unchanged.
- Document the shared display-only boundary in the project conventions.

## Review and verification
1. Test all five requested examples plus below-hour values, 60, zero, fractional-hour values, large durations, missing values, negative values, NaN, and infinity.
2. Review the diff for leftover service-duration minute labels and accidental changes to arithmetic or saved values.
3. Run formatter tests, relevant existing tests, focused lint, and check the preview’s automatic build results.
4. Inspect the real Services table and editor preview, plus public booking service selection and summary, on desktop and phone widths. Verify labels fit and the editor preview updates without saving.
5. Check representative admin booking, client, and staff views where sessions/data permit; report any unavailable checks rather than claiming they passed.
6. Present the updated preview and a short verification summary. Do not publish automatically.