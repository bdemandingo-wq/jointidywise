import { supabase } from "@/lib/supabase";

/**
 * Stamp profiles.last_login_at and the caller's organizations.
 * Called after a session exists, never from inside onAuthStateChange
 * (that callback holds the auth lock).
 *
 * The migration is applied by hand. Until touch_my_last_login exists,
 * a missing-function error is ignored so sign-in still works.
 */
export async function touchLastLogin(): Promise<void> {
  const { error } = await supabase.rpc("touch_my_last_login");
  if (!error) return;
  const message = error.message ?? "";
  const missing =
    error.code === "PGRST202" ||
    /touch_my_last_login|schema cache|could not find the function|404/i.test(message);
  if (!missing) {
    console.warn("touch_my_last_login failed", message);
  }
}
