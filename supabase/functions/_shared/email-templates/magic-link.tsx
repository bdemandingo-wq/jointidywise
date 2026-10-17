import { renderAuthEmail } from '../crm-email/render.ts'

interface Props { token?: string }

/** Magic-link / password reset code. `token` is the one-time code. */
export function renderMagicLinkHtml(props: Props = {}) {
  return renderAuthEmail('magiclink', { token: props.token })
}

export const MagicLinkEmail = renderMagicLinkHtml
export default renderMagicLinkHtml
