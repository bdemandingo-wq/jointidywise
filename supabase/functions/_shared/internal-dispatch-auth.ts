// Function-to-function auth that does not put the service-role key on the
// wire once INTERNAL_DISPATCH_SECRET is configured.
//
// Deploy order (so AI SMS replies keep working):
//   1. Deploy the functions that import this helper.
//   2. Set the same INTERNAL_DISPATCH_SECRET on the caller and the callee.
// Until the secret exists, callers still present the service-role key and
// callees still accept it — identical to the previous behavior.

import { isServiceRoleRequest, timingSafeEqualString } from "./require-caller-org.ts";

export const INTERNAL_SECRET_HEADER = "x-internal-secret";

export function internalDispatchSecret(): string {
  return Deno.env.get("INTERNAL_DISPATCH_SECRET") ?? "";
}

/** Headers for a server-to-server POST. Omits the service-role key when the shared secret is set. */
export function internalDispatchHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const secret = internalDispatchSecret();
  if (secret) {
    headers[INTERNAL_SECRET_HEADER] = secret;
    return headers;
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey) headers.Authorization = `Bearer ${serviceKey}`;
  return headers;
}

/**
 * True when the caller presented the shared secret, or — only when that
 * secret is not configured yet — the service-role key.
 */
export function isInternalDispatchRequest(req: Request): boolean {
  const secret = internalDispatchSecret();
  if (secret) {
    const presented = req.headers.get(INTERNAL_SECRET_HEADER) ?? "";
    return presented.length > 0 && timingSafeEqualString(presented, secret);
  }
  return isServiceRoleRequest(req);
}
