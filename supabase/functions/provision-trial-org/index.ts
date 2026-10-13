import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

const log = (step: string, details?: unknown) =>
  console.log(`[PROVISION-TRIAL-ORG] ${step}${details ? " — " + JSON.stringify(details) : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.slice("Bearer ".length).trim();

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    // Idempotency: already a member of an org → nothing to provision.
    const { data: existing, error: existingError } = await supabase
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing?.organization_id) {
      log("already provisioned", { organization_id: existing.organization_id });
      return json({ already_provisioned: true, organization_id: existing.organization_id });
    }

    // Never create a business for an invited account. The invite acceptance
    // flow signs the user in BEFORE the membership row is written, and the
    // client-side invite flag lives in sessionStorage (per-tab), so an emailed
    // password link opened in a new tab can otherwise provision a stray org.
    // Accepted invite history remains a durable server-side marker even after
    // the membership is later revoked.
    const email = (user.email || "").toLowerCase();
    if (email) {
      const { data: invites, error: inviteError } = await supabase
        .from("organization_invites")
        .select("id, organization_id, expires_at, accepted_at, accepted_by")
        .ilike("email", email)
        .order("created_at", { ascending: false });
      if (inviteError) throw inviteError;

      const now = Date.now();
      const blockingInvite = invites?.find((invite) => {
        const pendingAndValid = !invite.accepted_at && new Date(invite.expires_at).getTime() > now;
        const acceptedByUser = invite.accepted_at && invite.accepted_by === user.id;
        return pendingAndValid || acceptedByUser;
      });

      if (blockingInvite?.id) {
        const reason = blockingInvite.accepted_at ? "accepted_team_invite" : "pending_team_invite";
        log(`skipped — ${reason}`, { invite_id: blockingInvite.id });
        return json({
          skipped: true,
          reason,
          invite_organization_id: blockingInvite.organization_id,
        });
      }
    }


    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, trial_ends_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    const fullName = profile?.full_name?.trim();
    const orgName = fullName ? `${fullName}'s Business` : "My Cleaning Business";

    // New orgs only (the already-provisioned branch returned above). If the
    // signup trigger did not stamp a trial end, give this new profile 30 days.
    // Never overwrite a date that is already set.
    let trialEndsAt = profile?.trial_ends_at ?? null;
    if (!trialEndsAt) {
      trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error: trialError } = await supabase
        .from("profiles")
        .update({ trial_ends_at: trialEndsAt })
        .eq("id", user.id)
        .is("trial_ends_at", null);
      if (trialError) throw trialError;
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({ name: orgName, plan_type: "trial", owner_id: user.id, needs_onboarding: true })
      .select("id")
      .single();
    if (orgError) throw orgError;

    const { error: membershipError } = await supabase
      .from("org_memberships")
      .insert({ organization_id: org.id, user_id: user.id, role: "owner" });
    if (membershipError) throw membershipError;

    log("provisioned", { organization_id: org.id });
    return json({ organization_id: org.id, trial_ends_at: trialEndsAt });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { msg });
    return json({ error: msg }, 500);
  }
});
