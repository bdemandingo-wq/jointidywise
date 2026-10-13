/**
 * The single account allowed to see platform-wide surfaces — Platform
 * Analytics and everything reachable from it.
 *
 * This lived as a bare string literal compared inline in
 * PlatformAnalyticsPage, and separately in AdminSidebar, HelpPage and
 * useSubscription. Those copies are untouched here, but nothing new should
 * add a fifth: a broadcast composer and the send's own detail page drifting
 * apart on who may open them is exactly the bug this constant exists to make
 * unrepresentable.
 *
 * This is a client-side convenience gate, not a security boundary. It hides
 * UI; it does not stop a crafted request. The real enforcement is RLS and the
 * platform-admin check inside the broadcast-admin edge function.
 *
 * This is the owner's login, not TidyWise's public support inbox. Public
 * contact mail is SUPPORT_EMAIL in supportEmail.ts. Changing this string
 * hides platform admin from the account that actually signs in.
 */
export const PLATFORM_OWNER_EMAIL = 'support@tidywisecleaning.com';

export function isPlatformOwner(user: { email?: string | null } | null | undefined): boolean {
  return user?.email === PLATFORM_OWNER_EMAIL;
}
