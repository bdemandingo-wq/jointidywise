import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { authenticateUser } from "../_shared/auth-org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function clampStep(value: unknown): 1 | 2 | 3 {
  const n = typeof value === "number" ? value : Number(value);
  if (n === 2 || n === 3) return n;
  return 1;
}

type Offer = "trial_30" | "half_off_first_month" | "first_month_free";

function asOffer(value: unknown): Offer | null {
  if (value === "trial_30" || value === "half_off_first_month" || value === "first_month_free") {
    return value;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await authenticateUser(req);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const { supabase, userId } = auth.ctx;
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "sync";

    const { data: memberships } = await supabase
      .from("org_memberships")
      .select("organization_id, role, organizations(needs_onboarding, owner_id)")
      .eq("user_id", userId);

    const owned = (memberships ?? []).flatMap((row) => {
      const org = row.organizations as { needs_onboarding?: boolean; owner_id?: string } | null;
      if (!org || org.owner_id !== userId) return [];
      return [{ id: row.organization_id as string, needsOnboarding: org.needs_onboarding === true }];
    });
    const stillSettingUp = owned.some((org) => org.needsOnboarding);
    const finishedOwner = owned.length > 0 && !stillSettingUp;

    const { data: existing } = await supabase
      .from("onboarding_winback")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (action === "sync") {
      if (finishedOwner && !existing) return json({ skipped: true });
      const draft = body?.draft && typeof body.draft === "object" ? body.draft : {};
      const step = clampStep(body?.step ?? draft.step);
      const organizationId = stillSettingUp
        ? owned.find((org) => org.needsOnboarding)?.id ?? null
        : existing?.organization_id ?? null;
      const now = new Date().toISOString();
      if (!existing) {
        const token = newToken();
        const { error } = await supabase.from("onboarding_winback").insert({
          user_id: userId,
          organization_id: organizationId,
          resume_token: token,
          step,
          draft,
          started_at: now,
          last_seen_at: now,
        });
        if (error) return json({ error: error.message }, 500);
        return json({ resume_token: token, offer_used: null, draft: null });
      }
      const clientHasDraft = body?.hasLocalDraft === true;
      const { error } = await supabase.from("onboarding_winback").update({
        organization_id: organizationId ?? existing.organization_id,
        step: clientHasDraft ? step : existing.step,
        draft: clientHasDraft ? draft : existing.draft,
        last_seen_at: now,
      }).eq("id", existing.id);
      if (error) return json({ error: error.message }, 500);
      return json({
        resume_token: existing.resume_token,
        offer_used: existing.offer_used,
        trial_30_accepted: Boolean(existing.trial_30_accepted_at),
        modal_shown: Boolean(existing.modal_shown_at),
        draft: clientHasDraft ? null : existing.draft,
        step: clientHasDraft ? step : existing.step,
      });
    }

    if (action === "modal_shown") {
      if (!existing || finishedOwner) return json({ skipped: true });
      if (!existing.modal_shown_at) {
        await supabase.from("onboarding_winback").update({
          modal_shown_at: new Date().toISOString(),
        }).eq("id", existing.id);
      }
      return json({ ok: true });
    }

    if (action === "accept_trial_30") {
      if (!existing || finishedOwner || existing.completed_at) return json({ skipped: true });
      if (existing.offer_used === "half_off_first_month" || existing.offer_used === "first_month_free") {
        return json({ skipped: true, reason: "discount_already_claimed" });
      }
      const now = new Date().toISOString();
      await supabase.from("onboarding_winback").update({
        trial_30_accepted_at: existing.trial_30_accepted_at ?? now,
        offer_used: "trial_30",
        offer_used_at: existing.offer_used_at ?? now,
      }).eq("id", existing.id);
      return json({ ok: true, offer_used: "trial_30" });
    }

    if (action === "claim_link") {
      const token = typeof body?.token === "string" ? body.token : "";
      if (!existing || existing.resume_token !== token) return json({ error: "Offer not found" }, 404);
      if (existing.completed_at) return json({ error: "Setup is already finished" }, 409);
      const requested = asOffer(body?.offer);
      let offer: Offer | null = requested;
      if (offer === "first_month_free" && !existing.email_24h_sent_at) offer = null;
      if (offer === "half_off_first_month" && !existing.email_1h_sent_at) offer = null;
      if (!offer) {
        if (existing.email_24h_sent_at) offer = "first_month_free";
        else if (existing.email_1h_sent_at) offer = "half_off_first_month";
      }
      if (!offer || offer === "trial_30") {
        return json({
          draft: existing.draft,
          step: existing.step,
          offer_used: existing.offer_used,
        });
      }
      const now = new Date().toISOString();
      await supabase.from("onboarding_winback").update({
        offer_used: offer,
        offer_used_at: now,
        last_seen_at: now,
      }).eq("id", existing.id);
      return json({ draft: existing.draft, step: existing.step, offer_used: offer });
    }

    if (action === "complete") {
      if (!existing || existing.completed_at) return json({ ok: true, already: true });
      const now = new Date().toISOString();
      let trialExtended = false;
      const discount = existing.offer_used === "half_off_first_month" || existing.offer_used === "first_month_free";
      if (!discount && existing.trial_30_accepted_at) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("created_at, trial_ends_at")
          .eq("id", userId)
          .maybeSingle();
        const createdMs = profile?.created_at ? Date.parse(profile.created_at) : NaN;
        const target = Number.isFinite(createdMs) ? createdMs + 30 * DAY_MS : NaN;
        const current = profile?.trial_ends_at ? Date.parse(profile.trial_ends_at) : NaN;
        if (Number.isFinite(target) && target > Date.now() && (!Number.isFinite(current) || target > current)) {
          const { error: trialError } = await supabase
            .from("profiles")
            .update({ trial_ends_at: new Date(target).toISOString() })
            .eq("id", userId);
          if (trialError) console.error("[onboarding-winback] trial extend failed", trialError);
          else trialExtended = true;
        }
      }
      await supabase.from("onboarding_winback").update({
        completed_at: now,
        offer_used: discount ? existing.offer_used : (existing.trial_30_accepted_at ? "trial_30" : existing.offer_used),
        offer_used_at: existing.offer_used_at ?? (existing.trial_30_accepted_at ? now : null),
      }).eq("id", existing.id);
      return json({ ok: true, trialExtended, offer_used: discount ? existing.offer_used : (existing.trial_30_accepted_at ? "trial_30" : existing.offer_used) });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[onboarding-winback]", message);
    return json({ error: message }, 500);
  }
});
