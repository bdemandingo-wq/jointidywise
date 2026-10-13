# Team jobs: multiple cleaners per booking

Builds on the new booking fields (cleaners needed, pay per cleaner, flat/hourly). Every booking with 1 cleaner keeps working exactly as today.

## 1. Admin booking form (new + edit)
- "Team needed" checkbox. When checked: number of cleaners (2–6) and pay per cleaner with a Flat / Hourly toggle.
- Unchecked saves 1 cleaner and clears both pay fields.
- Summary line under the inputs: "2 cleaners · $100 each (flat)" or "3 cleaners · $25/hr each (hourly)".
- Only owners can set team pay, matching the existing pay rules (pay fields added to the owner-only database check).

## 2. Staff portal: available jobs
- Team jobs show a badge: "2 cleaners needed · $100 each potential pay" (hourly: "$25/hr each").
- After one claim, others see "1 more cleaner needed". The job stays available until it is full, then disappears from the list.
- A cleaner who already claimed it does not see it in Available; it appears in My Jobs as usual.

## 3. Claiming (safe against races)
- A new server-side claim action locks the booking, counts current claims, and either adds the cleaner or refuses.
- The first claimer becomes the main cleaner (same as today); later claimers are added as team members.
- If full: "This job was just filled". If already claimed by this cleaner: "You already claimed this job".
- Single-cleaner jobs use the same action and behave exactly as before ("already claimed by another cleaner").

## 4. Admin booking detail
- "1 of 2 claimed" with the names of cleaners who claimed.

## 5. Payroll
- Flat team pay: each assigned cleaner earns the pay per cleaner amount for that booking.
- Hourly team pay: each cleaner earns the hourly rate times their own hours, using today's hours logic.
- 1-cleaner bookings: no change to any pay calculation.

## 6. Tests
- Remaining spots math (including 1-cleaner jobs and over-full data).
- Badge text for flat and hourly.
- Payroll: flat per cleaner, hourly per cleaner, single-cleaner regression.
- Live database checks of the claim action: double claim refused, last-spot race (two claims at once, only one wins), single-cleaner job unchanged. Test rows are removed afterwards.
- Staff portal cards checked at phone and desktop widths.

## Technical details
- Shared pure helpers in `src/lib/teamJobs.ts` (remaining spots, badge/summary text, per-cleaner pay), with colocated tests.
- Migration: `claim_booking(p_booking_id uuid)` SECURITY DEFINER RPC. Authorizes the caller as active staff in the booking's organization, `SELECT ... FOR UPDATE` on the booking, counts `staff_id` + distinct `booking_team_assignments` staff, returns `claimed | full | already_claimed`. Sets `bookings.staff_id` for the first claim and inserts team assignment rows (primary + others) for team jobs. EXECUTE granted to `authenticated` only because it checks the caller internally.
- Extend the bookings financial guard to cover `pay_per_cleaner` and `pay_type`.
- Available-jobs query: include team jobs that still have open spots (not only `staff_id is null`), excluding ones the cleaner already holds. My Jobs includes bookings where the cleaner has a team assignment.
- Payroll: `wageCalculation` / `cleanerPay` resolve per-cleaner pay from `pay_per_cleaner` + `pay_type` when `cleaners_needed > 1`; otherwise the existing path is untouched.
- Not published automatically.
