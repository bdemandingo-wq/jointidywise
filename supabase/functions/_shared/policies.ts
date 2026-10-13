/**
 * Canonical refund/cancellation policy strings for Stripe dispute evidence.
 *
 * REFUND_POLICY and CANCELLATION_POLICY are copied VERBATIM from
 * src/components/legal/termsContent.tsx (the single source of truth for the
 * Terms of Service rendered at /terms and in the signup dialog). Keep these
 * in sync if that file changes.
 *
 * The contact address is TIDYWISE_SUPPORT_EMAIL (the published default), not
 * the SUPPORT_EMAIL secret, so dispute evidence matches the terms page.
 */

import { TIDYWISE_SUPPORT_EMAIL } from "./email-footer.ts";

export const TOS_VERSION = '2026-07-22';

/** Verbatim copy of REFUND_POLICY from src/components/legal/termsContent.tsx */
export const REFUND_POLICY =
  'All payments are final and non-refundable. This includes subscription fees ' +
  '(monthly and yearly), one-time lifetime purchases, and AI credit top-ups. ' +
  'You may cancel your subscription at any time; cancellation stops future ' +
  'billing but no refunds, credits, or prorated amounts are issued for the ' +
  'current or past billing periods. This policy is disclosed at signup ' +
  'directly beside the required consent checkbox, in the Terms of Service, ' +
  'and on the public terms page at jointidywise.com/terms.';

/** Verbatim copy of CANCELLATION_POLICY from src/components/legal/termsContent.tsx */
export const CANCELLATION_POLICY =
  'Subscriptions may be cancelled at any time, self-serve, from Settings → ' +
  'Billing inside the TidyWise dashboard, or by emailing ' +
  `${TIDYWISE_SUPPORT_EMAIL}. Cancellation takes effect at the end of the ` +
  'current billing period; access continues until that date. No further ' +
  'charges occur after cancellation. Failure to cancel before a renewal date ' +
  'constitutes authorization of the renewal charge.';

export const POLICY_DISCLOSURE =
  "Policy disclosed at account signup directly beside the required consent " +
  "checkbox ('I agree to the TidyWise Terms of Service. All payments are " +
  "non-refundable...'), inside the linked Terms of Service (Sections 5-7), " +
  "and on the public page jointidywise.com/terms. Acceptance is recorded " +
  "with timestamp, IP address, user agent, and terms version.";
