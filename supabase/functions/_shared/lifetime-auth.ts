/**
 * Lifetime checkout is a live charge. The anon key is a valid JWT, so the
 * gateway cannot tell a logged-out caller from a user. Callers must pass a
 * real user from auth.getUser before a Checkout Session is created.
 */

export const LIFETIME_SIGN_IN_ERROR = "Sign in to claim a lifetime spot.";
export const LIFETIME_ORG_NOT_READY = "org_not_ready";
export const LIFETIME_ORG_NOT_READY_ERROR =
  "Your workspace is still being set up. Try again in a moment.";

export function lifetimeCallerStatus(args: {
  authorization: string | null;
  anonKey: string;
  user: { id: string; email?: string | null } | null;
}): { status: 401; error: string } | null {
  const header = args.authorization?.trim() ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return { status: 401, error: LIFETIME_SIGN_IN_ERROR };
  }
  const token = header.slice(header.indexOf(" ") + 1).trim();
  if (!token || (args.anonKey !== "" && token === args.anonKey)) {
    return { status: 401, error: LIFETIME_SIGN_IN_ERROR };
  }
  const email = args.user?.email?.trim() ?? "";
  if (!args.user?.id || !email) {
    return { status: 401, error: LIFETIME_SIGN_IN_ERROR };
  }
  return null;
}

export function lifetimeOrgStatus(
  organizationId: string | null | undefined,
): { status: 409; error: string; code: typeof LIFETIME_ORG_NOT_READY } | null {
  if (typeof organizationId !== "string" || !organizationId.trim()) {
    return {
      status: 409,
      error: LIFETIME_ORG_NOT_READY_ERROR,
      code: LIFETIME_ORG_NOT_READY,
    };
  }
  return null;
}
