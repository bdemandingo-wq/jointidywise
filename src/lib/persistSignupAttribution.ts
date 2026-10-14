/**
 * Ask the database to store the first-touch landing on the signed-in account.
 *
 * The RPC ignores a capture that happened after the account already existed,
 * and it does not overwrite a row that is already there. Failures are logged
 * and swallowed so signup and onboarding still finish.
 */

import { supabase } from "@/lib/supabase";
import { readCapturedUtm, signupAttributionArgs } from "@/lib/utmAttribution";

export async function persistSignupAttribution(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const args = signupAttributionArgs(readCapturedUtm());
    const { error } = await supabase.rpc("save_signup_attribution", args);
    if (error) console.error("[utm] save failed", error.message);
  } catch (err) {
    console.error("[utm] save threw", err);
  }
}
