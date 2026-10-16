/**
 * One winner for the iOS push token wait.
 * NotificationAuth.register() and the Capacitor registration listener can
 * both resolve. The first real token wins. An empty token does not settle
 * the race, so a later listener can still deliver the token. A failure
 * settles it, and a late token is ignored.
 */
export function createRegistrationRace() {
  let settled = false;
  return {
    finish(token: string): boolean {
      if (settled || !token) return false;
      settled = true;
      return true;
    },
    fail(): boolean {
      if (settled) return false;
      settled = true;
      return true;
    },
  };
}
