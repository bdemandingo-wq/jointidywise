import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "").trim()
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { token, platform = "ios", apns_env, organization_id: requestedOrgId } = await req.json() as {
      token: string;
      platform?: string;
      apns_env?: string;
      organization_id?: string;
    };
    if (!token) {
      return new Response(JSON.stringify({ error: "token required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Attach the token to a company this user actually belongs to.
    // maybeSingle() on every membership failed (PGRST116) for an owner of
    // more than one business, the error was ignored, and the token was stored
    // with a null organization_id — send-push-notification then could not
    // find it. Prefer the org the app is signed into, then any
    // owner/admin/manager membership, then a staff row.
    let organizationId: string | null = null;
    if (requestedOrgId) {
      const { data: member } = await supabase
        .from("org_memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("organization_id", requestedOrgId)
        .maybeSingle();
      if (member?.organization_id) organizationId = member.organization_id;

      if (!organizationId) {
        const { data: staffRows } = await supabase
          .from("staff")
          .select("organization_id")
          .eq("user_id", user.id)
          .eq("organization_id", requestedOrgId)
          .limit(1);
        const staffOrg = staffRows?.[0]?.organization_id;
        if (staffOrg) organizationId = staffOrg;
      }
    }

    if (!organizationId) {
      const { data: memberships } = await supabase
        .from("org_memberships")
        .select("organization_id, role")
        .eq("user_id", user.id);
      const rank = (role: string) =>
        role === "owner" ? 0 : role === "admin" ? 1 : role === "manager" ? 2 : 3;
      const preferred = [...(memberships ?? [])].sort((a, b) => rank(a.role) - rank(b.role))[0];
      if (preferred?.organization_id) organizationId = preferred.organization_id;
    }

    if (!organizationId) {
      const { data: staffRows } = await supabase
        .from("staff")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1);
      const staffOrg = staffRows?.[0]?.organization_id;
      if (staffOrg) organizationId = staffOrg;
    }

    // One row per user + device token. Operator pushes select by user_id, so
    // this same row receives a push for every company the user operates.
    // Inserting a second row per organization would deliver that push twice.
    //
    // Update-then-insert, not a single upsert. PostgREST upsert requires a
    // unique constraint that matches ON CONFLICT exactly; when that
    // constraint is missing or the insert races, the call used to 500 and
    // the iPhone showed "couldn't save the device token" even though the
    // row was already there (and a later APNs send was accepted).
    // apns_env is only written when the client knows it, so a later
    // server-side correction (the push function retries the other APNs host
    // on BadDeviceToken) is not wiped by a registration that omits the field.
    const saved = await saveDeviceToken(supabase, {
      userId: user.id,
      organizationId,
      token,
      platform: platform === "android" ? "android" : "ios",
      apnsEnv: apns_env === "sandbox" || apns_env === "production" ? apns_env : null,
    });
    if (!saved.ok) throw new Error(saved.message);

    console.log("[REGISTER-TOKEN] Saved token for user", user.id, saved.action);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[REGISTER-TOKEN] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

type AdminClient = ReturnType<typeof createClient>;

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /23505|duplicate key/i.test(error.message ?? "");
}

function isMissingApnsEnv(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /apns_env/i.test(error.message ?? "");
}

/**
 * Update the existing (user, token) row, or insert it. A unique violation
 * means the row appeared between the two statements (or a token-wide unique
 * index already holds this device). Update that row instead of failing.
 * Other accounts' copies of this same device token are removed so a previous
 * login on the phone does not keep receiving pushes.
 */
async function saveDeviceToken(
  supabase: AdminClient,
  input: {
    userId: string;
    organizationId: string | null;
    token: string;
    platform: string;
    apnsEnv: "sandbox" | "production" | null;
  },
): Promise<{ ok: true; action: string } | { ok: false; message: string }> {
  const patch: Record<string, unknown> = {
    organization_id: input.organizationId,
    platform: input.platform,
    updated_at: new Date().toISOString(),
  };
  if (input.apnsEnv) patch.apns_env = input.apnsEnv;

  const apply = async (values: Record<string, unknown>) => {
    const updated = await supabase
      .from("device_push_tokens")
      .update(values)
      .eq("user_id", input.userId)
      .eq("token", input.token)
      .select("id");
    if (updated.error && values.apns_env && isMissingApnsEnv(updated.error)) {
      const withoutEnv = { ...values };
      delete withoutEnv.apns_env;
      return supabase
        .from("device_push_tokens")
        .update(withoutEnv)
        .eq("user_id", input.userId)
        .eq("token", input.token)
        .select("id");
    }
    return updated;
  };

  let updated = await apply(patch);
  if (updated.error) return { ok: false, message: updated.error.message ?? "update failed" };
  if ((updated.data ?? []).length > 0) {
    await dropOtherAccounts(supabase, input.token, input.userId);
    return { ok: true, action: "updated" };
  }

  const inserted = await supabase
    .from("device_push_tokens")
    .insert({ user_id: input.userId, token: input.token, ...patch })
    .select("id");

  if (!inserted.error) {
    await dropOtherAccounts(supabase, input.token, input.userId);
    return { ok: true, action: "inserted" };
  }

  if (inserted.error && patch.apns_env && isMissingApnsEnv(inserted.error)) {
    const withoutEnv = { user_id: input.userId, token: input.token, ...patch };
    delete withoutEnv.apns_env;
    const retried = await supabase.from("device_push_tokens").insert(withoutEnv).select("id");
    if (!retried.error) {
      await dropOtherAccounts(supabase, input.token, input.userId);
      return { ok: true, action: "inserted" };
    }
    if (!isUniqueViolation(retried.error)) {
      return { ok: false, message: retried.error.message ?? "insert failed" };
    }
  } else if (!isUniqueViolation(inserted.error)) {
    return { ok: false, message: inserted.error.message ?? "insert failed" };
  }

  // Lost a race, or the token is already stored. Update whichever row holds it.
  updated = await apply(patch);
  if (updated.error) return { ok: false, message: updated.error.message ?? "update failed" };
  if ((updated.data ?? []).length > 0) {
    await dropOtherAccounts(supabase, input.token, input.userId);
    return { ok: true, action: "updated" };
  }

  // Updating every row with this token in one statement can violate
  // UNIQUE (user_id, token) when two accounts each hold a copy. Keep one
  // row, point it at the current account, and delete the rest.
  const holders = await supabase
    .from("device_push_tokens")
    .select("id")
    .eq("token", input.token);
  if (holders.error) return { ok: false, message: holders.error.message ?? "lookup failed" };
  const ids = (holders.data ?? []).map((row) => row.id);
  if (ids.length === 0) {
    return { ok: false, message: "device token conflicted and no row could be updated" };
  }

  let kept = await supabase
    .from("device_push_tokens")
    .update({ ...patch, user_id: input.userId })
    .eq("id", ids[0])
    .select("id");
  if (kept.error && patch.apns_env && isMissingApnsEnv(kept.error)) {
    const withoutEnv = { ...patch, user_id: input.userId };
    delete withoutEnv.apns_env;
    kept = await supabase.from("device_push_tokens").update(withoutEnv).eq("id", ids[0]).select("id");
  }
  if (kept.error || (kept.data ?? []).length === 0) {
    return { ok: false, message: kept.error?.message ?? "reassign failed" };
  }
  for (const extra of ids.slice(1)) {
    await supabase.from("device_push_tokens").delete().eq("id", extra);
  }
  await dropOtherAccounts(supabase, input.token, input.userId);
  return { ok: true, action: "reassigned" };
}

async function dropOtherAccounts(supabase: AdminClient, token: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("device_push_tokens")
    .delete()
    .eq("token", token)
    .neq("user_id", userId);
  if (error) console.error("[REGISTER-TOKEN] Could not drop stale token rows", error.message);
}
