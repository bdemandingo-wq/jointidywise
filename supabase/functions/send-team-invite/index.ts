import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrgEmail } from "../_shared/send-org-email.ts";
import { renderCrmEmail, orgBrandVars } from "../_shared/crm-email/render.ts";
import { loadLooseBrand } from "../_shared/org-email-renderer.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  organization_id: string;
  email: string;
  role: 'owner' | 'manager';
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "auth_required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userRes, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userRes.user) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const actorId = userRes.user.id;

    const body = (await req.json()) as Body;
    const email = String(body.email || "").toLowerCase().trim();
    const orgId = String(body.organization_id || "");
    // Legacy 'admin' invites are silently normalized to 'manager'.
    const role = (body.role as string) === 'admin' ? 'manager' : body.role;
    if (!email || !orgId || !['owner','manager'].includes(role)) {
      return new Response(JSON.stringify({ error: "invalid_input" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return new Response(JSON.stringify({ error: "invalid_email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Actor must be owner of the org
    const { data: actorMem } = await admin
      .from("org_memberships").select("role")
      .eq("user_id", actorId).eq("organization_id", orgId).maybeSingle();
    if (!actorMem || actorMem.role !== 'owner') {
      return new Response(JSON.stringify({ error: "insufficient_permission" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create invite (or refresh existing pending invite)
    const { data: existing } = await admin
      .from("organization_invites")
      .select("id, token, accepted_at")
      .eq("organization_id", orgId)
      .ilike("email", email)
      .is("accepted_at", null)
      .maybeSingle();

    let inviteToken: string;
    if (existing) {
      const { data: upd, error: uErr } = await admin
        .from("organization_invites")
        .update({ role, expires_at: new Date(Date.now() + 14*24*3600*1000).toISOString(), invited_by: actorId })
        .eq("id", existing.id)
        .select("token").single();
      if (uErr) throw uErr;
      inviteToken = upd.token;
    } else {
      const { data: ins, error: iErr } = await admin
        .from("organization_invites")
        .insert({ organization_id: orgId, email, role, invited_by: actorId })
        .select("token").single();
      if (iErr) throw iErr;
      inviteToken = ins.token;
    }

    // Load org name for email context
    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
    const orgName = org?.name || "your team";

    // Always send invite links to the production domain, never the preview/staging origin.
    const origin = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.jointidywise.com").replace(/\/$/, "");
    const acceptUrl = `${origin}/accept-invite?token=${encodeURIComponent(inviteToken)}`;

    const brand = await loadLooseBrand(orgId);
    const rendered = renderCrmEmail("team-invite", {
      vars: {
        ...orgBrandVars(brand),
        orgName,
        acceptUrl,
        role,
      },
      rawKeys: ["email_footer"],
    });

    const sendResult = await sendOrgEmail({
      templateName: "team_invite",
      organizationId: orgId,
      to: email,
      subject: `You're invited to join ${orgName}`,
      html: rendered.html,
      text: rendered.text,
      // Auth/account-access mail: must reach the user even if a previous
      // send to this address hard-bounced.
      ignoreSuppression: true,
    });
    console.log("send-team-invite email result:", JSON.stringify(sendResult));
    if (!sendResult.success) {
      const raw = (sendResult.error || "").toLowerCase();
      const plain = raw.includes("not verified") || raw.includes("domain is not")
        ? "The invite was created, but the email couldn't be sent because the sending domain isn't verified yet. Copy the link and send it yourself, or verify the domain in Settings."
        : raw.includes("api key") || raw.includes("missing")
          ? "The invite was created, but email isn't set up for this business yet. Copy the link and send it yourself."
          : "The invite was created, but the email didn't send. Copy the link and send it yourself.";
      return new Response(JSON.stringify({
        error: plain,
        accept_url: acceptUrl,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, accept_url: acceptUrl, method: sendResult.method, fellBack: sendResult.fellBack }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
