import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import { claimSaasReferral } from "../_shared/saas-referral-db.ts";
import { extendShortCardFreeTrial } from "../_shared/trial-end.ts";
import { createInFlightGate, workspaceToReuse } from "../_shared/provision-trial-org.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

const log = (step: string, details?: unknown) =>
  console.log(`[PROVISION-TRIAL-ORG] ${step}${details ? " — " + JSON.stringify(details) : ""}`);

type ProvisionOutcome = { body: unknown; status: number };

// One isolate can receive the signup call and the auth-effect call together.
// They share this promise so the second does not insert another placeholder.
const provisionGate = createInFlightGate<ProvisionOutcome>();

function isDuplicate(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || (error.message ?? "").toLowerCase().includes("duplicate");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  let referralCode: string | null = null;
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { referral_code?: unknown };
        if (typeof parsed?.referral_code === "string") referralCode = parsed.referral_code;
      } catch {
        // No JSON body. Provisioning still proceeds.
      }
    }
  }

  const claimIfPresent = async (organizationId: string, userId: string, email: string | null) => {
    if (!referralCode) return;
    try {
      await claimSaasReferral(supabase, {
        organizationId,
        userId,
        email,
        code: referralCode,
      });
    } catch (claimError) {
      console.error("[PROVISION-TRIAL-ORG] referral claim failed", claimError);
    }
  };

  const lookupWorkspace = async (userId: string): Promise<{ id: string; hasMembership: boolean } | null> => {
    const { data: membership, error: membershipError } = await supabase
      .from("org_memberships")
      .select("organization_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;

    const { data: owned, error: ownedError } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ownedError) throw ownedError;

    const id = workspaceToReuse({
      membershipOrgId: membership?.organization_id ?? null,
      ownedOrgId: owned?.id ?? null,
    });
    if (!id) return null;
    return { id, hasMembership: Boolean(membership?.organization_id) };
  };

  const ensureOwnerMembership = async (organizationId: string, userId: string) => {
    const { error } = await supabase
      .from("org_memberships")
      .insert({ organization_id: organizationId, user_id: userId, role: "owner" });
    if (error && !isDuplicate(error)) throw error;
  };

  const reuseWorkspace = async (
    found: { id: string; hasMembership: boolean },
    userId: string,
    email: string | null,
    step: string,
  ): Promise<ProvisionOutcome> => {
    // A membership row is already there. Inserting again would duplicate it
    // when the table has no unique (user_id, organization_id) constraint.
    if (!found.hasMembership) await ensureOwnerMembership(found.id, userId);
    log(step, { organization_id: found.id });
    await claimIfPresent(found.id, userId, email);
    return { body: { already_provisioned: true, organization_id: found.id }, status: 200 };
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.slice("Bearer ".length).trim();

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const outcome = await provisionGate.run(user.id, async () => {
      // Idempotency: already a member, or already owns a placeholder that
      // has not received its membership row yet.
      const existing = await lookupWorkspace(user.id);
      if (existing) {
        return reuseWorkspace(existing, user.id, user.email ?? null, "already provisioned");
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
          return {
            body: {
              skipped: true,
              reason,
              invite_organization_id: blockingInvite.organization_id,
            },
            status: 200,
          };
        }
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, trial_ends_at, created_at")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;

      const fullName = profile?.full_name?.trim();
      const orgName = fullName ? `${fullName}'s Business` : "My Cleaning Business";

      // New orgs only (the already-provisioned branch returned above).
      // A missing stamp is signup + 30 days. A shorter stamp (the live
      // 14-day trigger) is lengthened to the same instant. A longer stamp
      // is left alone.
      let trialEndsAt = profile?.trial_ends_at ?? null;
      const extended = extendShortCardFreeTrial({
        trialEndsAt: profile?.trial_ends_at,
        createdAt: profile?.created_at ?? null,
      });
      if (extended.extended && extended.trialEndIso) {
        trialEndsAt = extended.trialEndIso;
        const { error: trialError } = await supabase
          .from("profiles")
          .update({ trial_ends_at: trialEndsAt })
          .eq("id", user.id)
          .lt("trial_ends_at", trialEndsAt);
        if (trialError) throw trialError;
      } else if (!trialEndsAt && extended.trialEndIso) {
        trialEndsAt = extended.trialEndIso;
        const { error: trialError } = await supabase
          .from("profiles")
          .update({ trial_ends_at: trialEndsAt })
          .eq("id", user.id)
          .is("trial_ends_at", null);
        if (trialError) throw trialError;
      } else if (!trialEndsAt) {
        trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const { error: trialError } = await supabase
          .from("profiles")
          .update({ trial_ends_at: trialEndsAt })
          .eq("id", user.id)
          .is("trial_ends_at", null);
        if (trialError) throw trialError;
      }

      // The other signup call may have committed while the trial stamp
      // was being written. Insert only if this user still has nothing.
      const raced = await lookupWorkspace(user.id);
      if (raced) {
        return reuseWorkspace(raced, user.id, user.email ?? null, "already provisioned before insert");
      }

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .insert({ name: orgName, plan_type: "trial", owner_id: user.id, needs_onboarding: true })
        .select("id")
        .single();
      // 23505 means the other signup call inserted first (or a unique
      // guard rejected a second placeholder). Reuse that workspace.
      if (orgError) {
        if (!isDuplicate(orgError)) throw orgError;
        const conflicted = await lookupWorkspace(user.id);
        if (!conflicted) throw orgError;
        return reuseWorkspace(conflicted, user.id, user.email ?? null, "duplicate insert reused existing workspace");
      }

      const { error: membershipError } = await supabase
        .from("org_memberships")
        .insert({ organization_id: org.id, user_id: user.id, role: "owner" });
      if (membershipError && !isDuplicate(membershipError)) throw membershipError;

      await claimIfPresent(org.id, user.id, user.email ?? null);

      log("provisioned", { organization_id: org.id });
      return { body: { organization_id: org.id, trial_ends_at: trialEndsAt }, status: 200 };
    });

    return json(outcome.body, outcome.status);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { msg });
    return json({ error: msg }, 500);
  }
});
