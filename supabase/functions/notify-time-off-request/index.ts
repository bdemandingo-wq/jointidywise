// Notifies admins on new time-off requests and staff on decisions.
// Auth: standard user JWT — RLS already governs read access; we use service role
// server-side purely to fetch email/push targets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { requestId, event } = await req.json();
    if (!requestId || !["created", "decision"].includes(event)) {
      return json({ error: "Missing requestId or invalid event" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: r, error } = await admin
      .from("time_off_requests")
      .select("*, staff:staff(id,name,email,user_id)")
      .eq("id", requestId)
      .maybeSingle();

    if (error || !r) return json({ error: "Request not found" }, 404);

    const range = r.start_date === r.end_date
      ? r.start_date
      : `${r.start_date} → ${r.end_date}`;
    const staffName = r.staff?.name ?? "A staff member";

    // Bell notification for admins
    if (event === "created") {
      await admin.from("admin_system_notifications").insert({
        organization_id: r.organization_id,
        type: "time_off_request",
        title: "New time-off request",
        message: `${staffName} requested time off (${range})`,
        link: "/dashboard/staff?tab=time-off",
        metadata: { request_id: r.id, staff_id: r.staff_id },
        dedupe_key: `time_off_req:${r.id}`,
      });

      // Fire-and-forget push to admins
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          organization_id: r.organization_id,
          // Operators, not every device stored under this organization_id.
          // An owner of two companies has one token row; user_id lookup
          // reaches it from either company, and a duplicate row is not sent twice.
          audience: "operators",
          title: "New time-off request",
          body: `${staffName} requested ${range}`,
        }),
      }).catch(() => {});

      // Email admins via org sender (best-effort)
      try {
        const { data: mems } = await admin
          .from("org_memberships")
          .select("user_id, role")
          .eq("organization_id", r.organization_id)
          .in("role", ["owner", "admin", "manager"]);
        const userIds = (mems ?? []).map((m: any) => m.user_id);
        if (userIds.length) {
          const { data: profs } = await admin.from("profiles").select("email").in("id", userIds);
          const emails = (profs ?? []).map((p: any) => p.email).filter(Boolean);
          for (const to of emails) {
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-org-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({
                organization_id: r.organization_id,
                to,
                subject: "New time-off request",
                html: `<p><strong>${escapeHtml(staffName)}</strong> requested time off for <strong>${escapeHtml(range)}</strong>.</p>${r.reason ? `<p>${escapeHtml(r.reason)}</p>` : ""}<p>Open the Staff → Time Off tab to review.</p>`,
                text: `${staffName} requested time off (${range}).${r.reason ? "\n\n" + r.reason : ""}`,
              }),
            }).catch(() => {});
          }
        }
      } catch (_) { /* non-fatal */ }
    }

    if (event === "decision" && (r.status === "approved" || r.status === "denied")) {
      // Notify the staff member
      await admin.from("cleaner_notifications").insert({
        staff_id: r.staff_id,
        title: `Time off ${r.status}`,
        message: `Your request for ${range} was ${r.status}${r.admin_note ? `: ${r.admin_note}` : "."}`,
        type: "time_off_decision",
        is_read: false,
      }).select().maybeSingle();

      if (r.staff?.email) {
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-org-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            organization_id: r.organization_id,
            to: r.staff.email,
            subject: `Your time-off request was ${r.status}`,
            html: `<p>Your request for <strong>${escapeHtml(range)}</strong> was <strong>${escapeHtml(String(r.status))}</strong>.</p>${r.admin_note ? `<p>${escapeHtml(r.admin_note)}</p>` : ""}`,
            text: `Your time-off request for ${range} was ${r.status}.${r.admin_note ? "\n\n" + r.admin_note : ""}`,
          }),
        }).catch(() => {});
      }
    }

    return json({ success: true });
  } catch (e: any) {
    console.error("[notify-time-off-request]", e);
    return json({ error: e?.message || "unexpected" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
