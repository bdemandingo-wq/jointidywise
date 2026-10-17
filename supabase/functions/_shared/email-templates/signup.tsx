import { renderAuthEmail } from '../crm-email/render.ts'

interface Props { siteName?: string; confirmationUrl?: string }

/** Signup confirm. confirmationUrl is the auth hook's one-time link. */
export function renderSignupHtml(props: Props = {}) {
  return renderAuthEmail('signup', { confirmationUrl: props.confirmationUrl })
}

export const SignupEmail = renderSignupHtml
export default renderSignupHtml
