# Payout status timeline + expected deposit date

## What you and your cleaners will see

Each payout will have a simple timeline:

```text
Sent  ->  On the way (pending)  ->  Deposited in bank
                 \-> Failed  /  Reversed
```

- **Pending** – money sent to the cleaner's Stripe account and waiting to go to the bank.
- **Paid** – Stripe has started the bank payout.
- **Deposited** – the expected arrival date has passed and the payout is complete.
- **Failed** – the bank rejected it (for example, a wrong account number). The screen shows the reason and what to fix.
- **Reversed** – you pulled the transfer back, like you did last time.

**Expected deposit date:** each payout shows "Expected deposit: Fri, Sep 26". The date comes from Stripe's own arrival estimate, so it matches what the bank will do. Until Stripe gives a date, it shows an estimate labeled "Estimated: 2–3 business days".

Where it shows up:
- **Cleaner Payouts tab (staff portal):** a list of her payouts. Each one has the amount, the week, the timeline, and the expected deposit date.
- **Admin Payroll page:** a status badge on each paid week plus a "View timeline" popover for each cleaner.
- **Texts and emails:** the payout message the cleaner already gets will now include the expected deposit date. She also gets a short text if a payout fails or is reversed.

Manual payments (cash, Zelle and similar) show only "Marked paid", because there's nothing to track for them.

## Technical details

- Migration: add to `payroll_payments` the columns `payout_status` (pending/paid/failed/reversed/deposited, default pending for stripe_transfer and paid for manual), `status_updated_at`, `expected_arrival_date` (date), `stripe_payout_id`, `failure_reason`, and `status_history` (jsonb array of {status, at, note}). No grant or policy changes are needed, because the existing organization-scoped rules stay in place.
- `process-staff-payout`: after the transfer is created, set status to pending and seed the history. Add the expected deposit date to the existing SMS/email.
- New edge function `sync-staff-payout-status` (cron-secret gated, runs every 30 min, plus an on-demand refresh button that checks organization authorization):
  - For each non-final Stripe row, read the transfer on the platform key (reversed → reversed). Then list the payouts on the connected account (`stripeAccount` header) created after the transfer, and map the payout status and `arrival_date`: pending/in_transit → paid with the expected date, paid → deposited, failed/canceled → failed with the `failure_message`.
  - Only record a status change if it's new. Send the cleaner an SMS on failed/reversed using the organization's OpenPhone settings.
  - Page through rows with `.order('created_at').order('id')`.
- Frontend: a shared `PayoutTimeline` component (lucide icons, semantic tokens) and a `useStaffPayouts(orgId, staffId)` hook. Use it in the StaffPayoutSetup/Payouts tab and in PayrollPage.
- Known limit: Stripe pools transfers into daily payouts, so matching a payout to a transfer is approximate. It uses the first connected-account payout created after the transfer. This is noted in the code.
