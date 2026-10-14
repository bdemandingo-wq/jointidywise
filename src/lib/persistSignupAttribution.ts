/**
 * Ask the database to store the first-touch landing on the signed-in account.
 *
 * The RPC ignores a capture that happened after the account already existed,
 * and it does not overwrite a row that is already there. Failures are logged
 * and swallowed so signup and onboarding still finish. A successful call
 * clears the browser capture so the landing is not kept after it is saved.
 */

import { supabase } from "@/lib/supabase";
import { attributionSaveSucceeded, clearCapturedUtm, readCapturedUtm, signupAttributionArgs } from "@/lib/utmAttribution";

export async function persistSignupAttribution(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const args = signupAttributionArgs(readCapturedUtm());
    const { error } = await supabase.rpc("save_signup_attribution", args);
    if (!attributionSaveSucceeded(error)) {
      console.error("[utm] save failed", error?.message);
      return;
    }
    clearCapturedUtm();
  } catch (err) {
    console.error("[utm] save threw", err);
  }
}
