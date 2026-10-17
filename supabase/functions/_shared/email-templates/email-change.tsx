import { TIDYWISE_SUPPORT_EMAIL } from '../email-footer.ts'
import { renderAuthEmail } from '../crm-email/render.ts'

interface Props { confirmationUrl?: string; email?: string; newEmail?: string }

/**
 * Email-change confirm. confirmationUrl is the auth hook link.
 * `email` and `newEmail` are passed by the hook and stay unused, matching
 * the previous template. The support inbox is TIDYWISE_SUPPORT_EMAIL.
 */
export function renderEmailChangeHtml(props: Props = {}) {
  const rendered = renderAuthEmail('email_change', { confirmationUrl: props.confirmationUrl })
  if (!rendered.html.includes(TIDYWISE_SUPPORT_EMAIL)) {
    throw new Error('email-change design is missing the support inbox')
  }
  return rendered
}

export const EmailChangeEmail = renderEmailChangeHtml
export default renderEmailChangeHtml
