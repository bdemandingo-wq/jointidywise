// TidyWise email brand tokens — shared across all auth email templates.
export const BRAND = {
  logoUrl: 'https://jointidywise.com/email-logo.png',
  logoHeight: 56,
  siteName: 'TidyWise',
  primary: '#4f46e5',
  primaryHover: '#4338ca',
  accent: '#4CAF3F',
  bg: '#ffffff',
  body: '#111827',
  muted: '#6b7280',
  footerMuted: '#9ca3af',
  border: '#e5e7eb',
  codeBg: '#f3f4f6',
  helpUrl: 'https://www.jointidywise.com/help',
  privacyUrl: 'https://www.jointidywise.com/privacy-policy',
  termsUrl: 'https://www.jointidywise.com/terms-of-service',
}

const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const monoStack =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

export const styles = {
  main: { backgroundColor: BRAND.bg, fontFamily: fontStack, margin: 0, padding: 0 },
  container: {
    maxWidth: '480px',
    margin: '0 auto',
    padding: '32px 24px',
  },
  logoWrap: { textAlign: 'center' as const, padding: '0 0 24px' },
  logo: { height: `${BRAND.logoHeight}px`, width: 'auto', margin: '0 auto' },
  logoText: {
    fontFamily: fontStack,
    fontSize: '24px',
    fontWeight: 700 as const,
    color: BRAND.primary,
    margin: 0,
    textAlign: 'center' as const,
    letterSpacing: '-0.02em',
  },
  h1: {
    fontSize: '22px',
    fontWeight: 700 as const,
    color: BRAND.body,
    margin: '0 0 16px',
    lineHeight: '1.3',
  },
  text: {
    fontSize: '15px',
    color: BRAND.body,
    lineHeight: '1.6',
    margin: '0 0 20px',
  },
  link: { color: BRAND.primary, textDecoration: 'underline' },
  button: {
    backgroundColor: BRAND.primary,
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600 as const,
    borderRadius: '8px',
    padding: '14px 28px',
    textDecoration: 'none',
    display: 'inline-block',
  },
  buttonWrap: { textAlign: 'center' as const, margin: '28px 0' },
  codeBox: {
    backgroundColor: BRAND.codeBg,
    border: `1px solid ${BRAND.border}`,
    borderRadius: '10px',
    padding: '24px 16px',
    margin: '24px 0',
    textAlign: 'center' as const,
  },
  code: {
    fontFamily: monoStack,
    fontSize: '36px',
    fontWeight: 700 as const,
    letterSpacing: '12px',
    color: BRAND.primary,
    margin: 0,
    textAlign: 'center' as const,
  },
  hint: {
    fontSize: '13px',
    color: BRAND.muted,
    lineHeight: '1.5',
    margin: '20px 0 0',
  },
  divider: {
    border: 'none',
    borderTop: `1px solid ${BRAND.border}`,
    margin: '32px 0 20px',
  },
  footer: {
    textAlign: 'center' as const,
    paddingTop: '8px',
  },
  footerText: {
    fontSize: '12px',
    color: BRAND.footerMuted,
    margin: '0 0 6px',
    lineHeight: '1.6',
  },
  footerLink: {
    color: BRAND.footerMuted,
    textDecoration: 'underline',
    margin: '0 6px',
  },
}
