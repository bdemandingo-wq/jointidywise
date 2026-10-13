// Shared CAN-SPAM-compliant footer for all TidyWise platform emails.
//
// CAN-SPAM (15 U.S.C. § 7704) requires every commercial email to
// include:
//   1. A valid physical postal address of the sender
//   2. A clear way to opt out of further commercial messages
//
// Transactional emails (welcome, receipt, password reset, etc.) are
// exempt from the opt-out requirement, but Gmail / Outlook deliverability
// scoring still rewards having one. Including it on every email also
// keeps the policy simple: one footer, always.

export const TIDYWISE_MAILING_ADDRESS = "TidyWise, 65 SW 12th Ave, Apt 110, Deerfield Beach, FL 33442";

/**
 * TidyWise's public support inbox.
 *
 * jointidywise.com is the verified Resend domain. This is a contact address,
 * not a login. Do not use it in platform-admin predicates — the owner's
 * login stays support@tidywisecleaning.com until that account is migrated
 * on purpose.
 *
 * Keep this default in sync with SUPPORT_EMAIL in src/lib/supportEmail.ts.
 * Edge functions cannot import from src/.
 */
export const TIDYWISE_SUPPORT_EMAIL = "support@jointidywise.com";

type DenoEnv = { env?: { get?: (name: string) => string | undefined } };

/**
 * Address used on outbound platform mail.
 * The SUPPORT_EMAIL secret overrides the default without a code change.
 */
export function tidywiseSupportEmail(): string {
  const deno = (globalThis as { Deno?: DenoEnv }).Deno;
  const override = deno?.env?.get?.("SUPPORT_EMAIL")?.trim();
  return override || TIDYWISE_SUPPORT_EMAIL;
}

/** From header for mail that should come from the public support inbox. */
export function tidywiseSupportFrom(name = "TidyWise"): string {
  return `${name} <${tidywiseSupportEmail()}>`;
}

/**
 * HTML footer for branded TidyWise emails. Drop into the bottom of any
 * email <body> before the closing tag.
 */
export function tidywiseEmailFooterHtml(): string {
  const email = tidywiseSupportEmail();
  const unsubscribeHref = `mailto:${email}?subject=Unsubscribe`;
  return `
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
    <p style="color: #888; font-size: 12px; line-height: 1.5; text-align: center; margin: 0 0 8px;">
      ${TIDYWISE_MAILING_ADDRESS}
    </p>
    <p style="color: #888; font-size: 12px; line-height: 1.5; text-align: center; margin: 0;">
      You're receiving this because you have a TidyWise account.
      <a href="${unsubscribeHref}" style="color: #888;">Unsubscribe</a>
      ·
      <a href="mailto:${email}" style="color: #888;">${email}</a>
    </p>`;
}

/**
 * Plain-text footer for emails that send a text alternative. Same data
 * as the HTML version, no markup.
 */
export function tidywiseEmailFooterText(): string {
  const email = tidywiseSupportEmail();
  const unsubscribeHref = `mailto:${email}?subject=Unsubscribe`;
  return [
    "",
    "----------",
    TIDYWISE_MAILING_ADDRESS,
    `Unsubscribe: ${unsubscribeHref}`,
    `Support: ${email}`,
  ].join("\n");
}
