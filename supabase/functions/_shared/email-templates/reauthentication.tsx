import { renderAuthEmail } from '../crm-email/render.ts'

interface Props { token?: string }

/** Reauthentication code. `token` is the one-time code from the auth hook. */
export function renderReauthenticationHtml(props: Props = {}) {
  return renderAuthEmail('reauthentication', { token: props.token })
}

export const ReauthenticationEmail = renderReauthenticationHtml
export default renderReauthenticationHtml
