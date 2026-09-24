# Make sure cleaners can always receive payouts

## How it works today
- A cleaner sets up payouts inside the TidyWise staff portal. Stripe creates a payout account for them. It's run by TidyWise, so the cleaner never makes a separate Stripe username or password.
- When you send money, it goes straight into that account. Stripe then moves it to the cleaner's bank on its normal schedule. **The cleaner doesn't need to log in to accept it.** If her setup was finished, the money would have reached her bank on its own.
- What's missing: the cleaner has **no way to open her Stripe payout page** to check balances or deposits, or to fix a problem Stripe flags. So if Stripe asks her for something, she's stuck. Also, nothing tells her she's been paid or how to get back into the staff portal.

## What we'll build
1. **"View my payouts on Stripe" button** on the cleaner's Payouts tab. It opens her own Stripe payout page with a one-time secure link, so no Stripe password is needed. It shows her balance, deposits and bank details, plus anything Stripe needs from her.
2. **"You've been paid" text and email** sent to the cleaner when you send a payout, from your business's own number and email. It includes the amount, when to expect it in her bank, and a link to the staff portal. It also has a "Forgot password?" link.
3. **Safety check before sending money:** just before sending, TidyWise asks Stripe again whether the cleaner's account can receive money right now. If it can't, you're told why (for example "Stripe needs her ID") and nothing is sent.
4. **Portal access in the payout window:** if the cleaner has never signed in or can't sign in, you'll see a warning and a **"Text her a sign-in link"** button. It reuses the existing staff password-reset text.
5. **Welcome text when payout setup finishes:** it confirms she's set up, says pay will go to her bank automatically, and includes the portal link and app download link.

## Technical details
- New function `staff-payout-dashboard-link`: checks that the signed-in user owns the staff row in that business, then calls `stripe.accounts.createLoginLink(stripe_account_id)` with the platform key and returns the URL. The page opens it with `openExternalUrl` so it works on iPhone.
- `process-staff-payout`: before the transfer, calls `stripe.accounts.retrieve`. It blocks the send unless `payouts_enabled` is true and `requirements.disabled_reason` is empty, then syncs the saved status. After a successful transfer it sends the paid text and email through the business's own email and phone settings, and logs them. If a text or email fails, the payment still goes through.
- Payout window (admin): shows the staff member's `user_id` and last sign-in, and adds a button that calls the existing `send-staff-password-reset`.
- `check-staff-payout-status`: the first time the status changes to `active`, sends the welcome text once. A flag stops it being sent again.
- The functions are deployed and checked live, and the app build passes.
