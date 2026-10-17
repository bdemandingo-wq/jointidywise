import { renderAuthEmail } from '../crm-email/render.ts'

interface Props { confirmationUrl?: string }

/** Password recovery. confirmationUrl is the reset link. */
export function renderRecoveryHtml(props: Props = {}) {
  return renderAuthEmail('recovery', { confirmationUrl: props.confirmationUrl })
}

export const RecoveryEmail = renderRecoveryHtml
export default renderRecoveryHtml
