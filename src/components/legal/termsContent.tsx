import { ArticleBody } from "@/components/ArticleBody";
import { SUPPORT_EMAIL } from "@/lib/supportEmail";
/**
 * Canonical TidyWise Terms of Service.
 *
 * Single source of truth: rendered in the signup dialog AND at /terms, and the
 * REFUND_POLICY / CANCELLATION_POLICY strings below are what the dispute
 * evidence pipeline submits to Stripe — keep them in sync with the sections
 * of the same name. supabase/functions/_shared/policies.ts holds a verbatim
 * copy for edge functions to import; update both together.
 *
 * When you materially change the terms, bump TOS_VERSION (date format). New
 * acceptances record the new version; old tos_acceptances rows keep theirs,
 * which is exactly what you want for dispute evidence.
 *
 * NOTE: reviewed for dispute-evidence completeness, not by a lawyer. Have
 * counsel skim before relying on it in litigation (Stripe disputes are fine).
 */

export const TOS_VERSION = '2026-07-22';
export const TOS_EFFECTIVE_DATE = 'July 22, 2026';

/** Verbatim string sent as Stripe dispute evidence `refund_policy`. */
export const REFUND_POLICY =
  'All payments are final and non-refundable. This includes subscription fees ' +
  '(monthly and yearly), one-time lifetime purchases, and AI credit top-ups. ' +
  'You may cancel your subscription at any time; cancellation stops future ' +
  'billing but no refunds, credits, or prorated amounts are issued for the ' +
  'current or past billing periods. This policy is disclosed at signup ' +
  'directly beside the required consent checkbox, in the Terms of Service, ' +
  'and on the public terms page at jointidywise.com/terms.';

/** Verbatim string sent as Stripe dispute evidence `cancellation_policy`. */
export const CANCELLATION_POLICY =
  'Subscriptions may be cancelled at any time, self-serve, from Settings → ' +
  'Billing inside the TidyWise dashboard, or by emailing ' +
  `${SUPPORT_EMAIL}. Cancellation takes effect at the end of the ` +
  'current billing period; access continues until that date. No further ' +
  'charges occur after cancellation. Failure to cancel before a renewal date ' +
  'constitutes authorization of the renewal charge.';

interface Section {
  title: string;
  body: string[];
}

export const TOS_SECTIONS: Section[] = [
  {
    title: '1. Agreement to Terms',
    body: [
      `These Terms of Service ("Terms") are a binding agreement between you and TidyWise ("TidyWise", "we", "us") governing your use of the TidyWise platform, applications, and related services (the "Service"). By creating an account, checking the acceptance box at signup, or using the Service, you agree to these Terms. Version ${TOS_VERSION}, effective ${TOS_EFFECTIVE_DATE}.`,
      'If you use the Service on behalf of a business, you represent that you have authority to bind that business, and "you" includes that business.',
    ],
  },
  {
    title: '2. The Service',
    body: [
      'TidyWise is business-management software for cleaning companies: scheduling, customer management, invoicing, payroll tools, client and staff portals, automations, and AI-assisted features. The Service is provided on a subscription basis as described at checkout.',
      "We continuously improve the Service and may add, change, or remove features. Material reductions to a paid plan's core functionality will be communicated in advance where practical.",
    ],
  },
  {
    title: '3. Accounts and Security',
    body: [
      'You are responsible for the accuracy of your account information, for maintaining the confidentiality of your credentials, and for all activity under your account. Notify us immediately of any unauthorized use.',
      'We log account and security activity — including signup and sign-in timestamps, IP addresses, and device information — to protect your account, operate the Service, and document consent and usage.',
    ],
  },
  {
    title: '4. Subscriptions, Billing, and Renewal',
    body: [
      'Paid plans are billed in advance on a recurring basis (monthly or yearly, as selected at checkout) through our payment processor, Stripe. By subscribing you authorize us to charge your payment method the plan price, applicable taxes, and any add-ons you purchase, on each renewal date, until you cancel.',
      'Subscriptions renew automatically. Your renewal date and amount are shown at checkout and in Settings → Billing. We may send a courtesy renewal reminder, but the renewal charge is authorized whether or not a reminder is received.',
      'Price changes will be notified at least 14 days before they apply to your next renewal. Continued use after a price change takes effect constitutes acceptance.',
      'One-time purchases (including lifetime access offers and AI credit top-ups) are charged immediately at the price shown. AI credit top-ups never expire but are consumed by usage.',
      'If a renewal payment fails, we may retry the charge and will notify you. We may suspend or downgrade the account if payment is not completed.',
    ],
  },
  {
    title: '5. Cancellation Policy',
    body: [CANCELLATION_POLICY],
  },
  {
    title: '6. Refund Policy',
    body: [
      REFUND_POLICY,
      `If you believe a charge was made in error, contact ${SUPPORT_EMAIL} within 7 days of the charge and we will investigate in good faith.`,
    ],
  },
  {
    title: '7. Chargebacks and Payment Disputes',
    body: [
      `You agree to contact us at ${SUPPORT_EMAIL} to resolve any billing concern before initiating a chargeback or payment dispute with your bank or card issuer. Most billing issues are resolved within one business day.`,
      'Initiating a chargeback on a properly authorized charge — including a renewal you did not cancel before its renewal date — is a breach of these Terms. We respond to disputes with our records, which include your acceptance of these Terms (timestamp, IP address, and version), your account activity and access logs, and your billing history. We reserve the right to suspend the account associated with a pending dispute and to recover dispute fees and costs for chargebacks resolved in our favor.',
    ],
  },
  {
    title: '8. Free Trials and Promotional Access',
    body: [
      'Trial or promotional access, where offered, converts to a paid subscription only if you affirmatively subscribe. We may modify or end trial programs at any time. Features available during a trial may differ from paid plans.',
    ],
  },
  {
    title: '9. Your Data',
    body: [
      'You retain ownership of the customer, booking, and business data you enter into the Service. You grant us the rights needed to host, process, back up, and display that data in order to operate the Service. Our handling of personal data is described in the Privacy Policy.',
      "You are responsible for the lawfulness of the data you upload, including obtaining any consents required to store your customers' and staff members' information and to send them communications through the Service.",
      'For 30 days following account closure you may request an export of your data, after which we may delete it.',
    ],
  },
  {
    title: '10. Communications You Send Through the Service',
    body: [
      'The Service can send SMS and email to your customers and staff on your behalf. You are solely responsible for the content of those messages and for complying with applicable communications laws (including the TCPA and CAN-SPAM in the United States), including consent and opt-out requirements. We may suspend messaging features that generate spam complaints or carrier violations.',
    ],
  },
  {
    title: '11. Acceptable Use',
    body: [
      "You agree not to: misuse, probe, or disrupt the Service; access another tenant's data; resell the Service without authorization; use the Service for unlawful activity; upload malicious code; or use automated means to extract data at scale. We may suspend or terminate accounts engaged in prohibited conduct.",
    ],
  },
  {
    title: '12. AI Features',
    body: [
      "AI-assisted features consume plan credits and may produce inaccurate output. You are responsible for reviewing AI-generated content (messages, prices, analyses) before relying on it or sending it to customers. AI features are provided as-is within your plan's credit limits.",
    ],
  },
  {
    title: '13. Disclaimers',
    body: [
      'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE." TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE.',
    ],
  },
  {
    title: '14. Limitation of Liability',
    body: [
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, TIDYWISE WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, OR DATA. OUR TOTAL LIABILITY FOR ALL CLAIMS ARISING FROM THE SERVICE IS LIMITED TO THE AMOUNTS YOU PAID US IN THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM.',
    ],
  },
  {
    title: '15. Termination',
    body: [
      'You may stop using the Service and cancel at any time (Section 5). We may suspend or terminate the Service or your account for breach of these Terms, non-payment, unlawful use, or risk to the Service or other users. Sections that by their nature should survive termination (including Sections 6, 7, 13, 14, and 17) survive.',
    ],
  },
  {
    title: '16. Changes to These Terms',
    body: [
      'We may update these Terms from time to time. Each version is identified by its version date. Material changes will be notified in-app or by email, and continued use of the Service after the effective date constitutes acceptance of the updated Terms. The version you accepted, and when and from where you accepted it, is recorded.',
    ],
  },
  {
    title: '17. Governing Law and Disputes',
    body: [
      'These Terms are governed by the laws of the State of Florida, without regard to conflict-of-law rules. The exclusive venue for any dispute not subject to arbitration or small-claims jurisdiction is the state or federal courts located in Broward County, Florida, and you consent to their jurisdiction.',
    ],
  },
  {
    title: '18. Contact',
    body: [
      `Questions about these Terms or billing: ${SUPPORT_EMAIL}. Please contact us before disputing any charge — most issues are resolved within one business day.`,
    ],
  },
];

export function TermsContent() {
  return (
    <ArticleBody size="sm">
      <p>
        Version {TOS_VERSION} · Effective {TOS_EFFECTIVE_DATE}
      </p>
      {TOS_SECTIONS.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          {s.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}
    </ArticleBody>
  );
}
