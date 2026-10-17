import { renderAuthEmail } from '../crm-email/render.ts'

interface Props { confirmationUrl?: string }

/** Auth invite. confirmationUrl is the accept link from the auth hook. */
export function renderInviteHtml(props: Props = {}) {
  return renderAuthEmail('invite', { confirmationUrl: props.confirmationUrl })
}

export const InviteEmail = renderInviteHtml
export default renderInviteHtml
