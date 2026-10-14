/**
 * APNs sender.
 *
 * Secrets the project owner must set (Lovable Cloud → secrets, then redeploy
 * this function):
 *   APNS_KEY_ID       Apple key id for the .p8
 *   APNS_TEAM_ID      Apple team id (JV99ZGTGR3)
 *   APNS_PRIVATE_KEY  contents of the AuthKey .p8, including the BEGIN/END lines
 *   APNS_BUNDLE_ID    optional, defaults to com.TidyWiseApp.app
 *   APNS_ENV          "production" for TestFlight and App Store.
 *                     "sandbox" only for Xcode debug installs.
 *                     When unset, this function tries production first
 *                     (TestFlight/App Store tokens) and, on BadDeviceToken,
 *                     retries the other host and remembers which one worked
 *                     on device_push_tokens.apns_env.
 *
 * The committed App.entitlements value aps-environment=development is what
 * Xcode Debug uses. Archive/TestFlight/App Store re-signs that entitlement
 * to production. A single global host cannot serve both; per-token apns_env
 * is how mixed devices work.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { isServiceRoleRequest } from "../_shared/require-caller-org.ts";
import { tokensForPush } from "../_shared/push-tokens.ts";
import { defaultApnsEnv, deliverApns, otherApnsEnv, type ApnsEnv } from "../_shared/apns-deliver.ts";
import { demoModeEnabledForOrg } from "../_shared/demo-guard.ts";
import { isDemoSendBlocked, isKnownDemoOrganization } from "../_shared/demo-org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: any) => {
  console.log(`[PUSH] ${step}${details ? " — " + JSON.stringify(details) : ""}`);
};

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    const { organization_id, title, body, data, staff_id, audience } = await req.json() as {
      organization_id: string;
      title: string;
      body: string;
      data?: Record<string, string>;
      staff_id?: string;
      /** "operators" = owner/admin/manager devices. Omit to broadcast to the org. */
      audience?: "org" | "operators";
    };

    if (!organization_id || !title || !body) {
      return new Response(JSON.stringify({ error: "organization_id, title, body required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // SECURITY: accept service-role callers, OR an authenticated owner/admin/manager
    // of `organization_id`. A cleaner's JWT is rejected here on purpose — a
    // cleaner must not be able to push arbitrary text to the company.
    // Cleaner job events (on the way, arrived, complete) call this function
    // with the service role from their own edge function, after that function
    // has checked the cleaner is assigned to the booking.
    if (!isServiceRoleRequest(req)) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const token = authHeader.slice("Bearer ".length).trim();
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: membership } = await supabase
        .from("org_memberships")
        .select("role")
        .eq("user_id", userData.user.id)
        .eq("organization_id", organization_id)
        .maybeSingle();
      const role = membership?.role;
      if (!role || !["owner", "admin", "manager"].includes(role)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (isKnownDemoOrganization(organization_id) || await demoModeEnabledForOrg(supabase, organization_id)) {
      log("skipped demo org", { organization_id });
      return new Response(JSON.stringify({ sent: 0, skipped: "demo_mode" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    log("Sending push", { organization_id, title, staff_id, audience });

    // Resolve target device tokens.
    let targetUserIds: string[] | null = null;
    if (audience === "operators") {
      const { data: mems, error: memErr } = await supabase
        .from("org_memberships")
        .select("user_id")
        .eq("organization_id", organization_id)
        .in("role", ["owner", "admin", "manager"]);
      if (memErr) throw memErr;
      targetUserIds = (mems ?? []).map((m: { user_id: string }) => m.user_id);
      if (targetUserIds.length === 0) {
        log("No operator memberships", { organization_id });
        return new Response(JSON.stringify({ sent: 0, message: "No operator devices" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
        });
      }
    } else if (staff_id) {
      const { data: staffRow, error: staffErr } = await supabase
        .from("staff")
        .select("user_id, organization_id")
        .eq("id", staff_id)
        .maybeSingle();
      if (staffErr || !staffRow) {
        return new Response(JSON.stringify({ error: "staff_id not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (staffRow.organization_id !== organization_id) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!staffRow.user_id) {
        log("Staff has no user_id — no devices", { staff_id });
        return new Response(JSON.stringify({ sent: 0, message: "Staff has no linked user" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
        });
      }
      targetUserIds = [staffRow.user_id];
    }

    // Operators are matched by user_id, not organization_id. An owner of more
    // than one company has a single device row, last saved under whichever
    // company the app was showing. Filtering that row by organization_id
    // would drop pushes for the other company. Staff sends also match
    // user_id. An org broadcast (no audience) still matches organization_id.
    const loadTokens = async (columns: string) => {
      let q = supabase.from("device_push_tokens").select(columns).eq("platform", "ios");
      if (targetUserIds) q = q.in("user_id", targetUserIds);
      else q = q.eq("organization_id", organization_id);
      return await q;
    };

    let tokenResult = await loadTokens("id, token, user_id, organization_id, apns_env");
    if (tokenResult.error && /apns_env|42703/i.test(tokenResult.error.message ?? "")) {
      // Migration not applied yet. Send without a stored environment.
      tokenResult = await loadTokens("id, token, user_id, organization_id");
    }
    const { data: tokens, error } = tokenResult;

    if (error) throw error;

    const staffUserId = staff_id && audience !== "operators" ? targetUserIds?.[0] ?? null : null;
    const deliverable = tokensForPush({
      rows: (tokens ?? []) as { id?: string; token: string; user_id: string; organization_id?: string | null; apns_env?: string | null }[],
      organizationId: organization_id,
      audience: audience === "operators" ? "operators" : "org",
      operatorUserIds: audience === "operators" ? (targetUserIds ?? []) : [],
      staffUserId,
    });

    if (deliverable.length === 0) {
      log("No device tokens found", { organization_id, staff_id, audience });
      return new Response(JSON.stringify({ sent: 0, message: "No registered devices" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    log("Sending to devices", { count: deliverable.length, fetched: tokens?.length ?? 0 });

    const deliver = async (row: { id?: string; token: string; apns_env?: string | null }) => {
      const stored: ApnsEnv | null = row.apns_env === "sandbox" || row.apns_env === "production"
        ? row.apns_env
        : null;
      const first = stored ?? defaultApnsEnv();
      let resolved: ApnsEnv | null = null;
      let result;
      try {
        result = await deliverApns(row.token, first, title, body, data, organization_id);
      } catch (err) {
        if (isDemoSendBlocked(err)) return false;
        throw err;
      }

      if (result.ok) {
        resolved = first;
      } else if (result.reason === "BadDeviceToken") {
        // Sandbox token sent to production, or the reverse. Remember the host
        // that actually accepted it so the next send doesn't pay this round trip.
        const fallback = otherApnsEnv(first);
        const retry = await deliverApns(row.token, fallback, title, body, data, organization_id);
        if (retry.ok) {
          result = retry;
          resolved = fallback;
        } else if (retry.status === 410 || retry.reason === "Unregistered") {
          if (row.id) await supabase.from("device_push_tokens").delete().eq("id", row.id);
          return false;
        }
      }

      if (result.ok) {
        if (row.id && resolved && resolved !== stored) {
          await supabase.from("device_push_tokens").update({ apns_env: resolved }).eq("id", row.id);
        }
        return true;
      }

      if (!result.ok && (result.status === 410 || result.reason === "Unregistered")) {
        if (row.id) await supabase.from("device_push_tokens").delete().eq("id", row.id);
      }
      return false;
    };

    const results = await Promise.allSettled(deliverable.map((t) => deliver(t)));

    const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;
    log("Push sent", { sent, total: deliverable.length });

    return new Response(JSON.stringify({ sent, total: deliverable.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
