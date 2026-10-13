import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronOrUser } from "../_shared/requireCronOrUser.ts";
import { checkOrgEmailEligibility, unsubscribeFooterHtml } from "../_shared/emailEligibility.ts";
import { tidywiseSupportFrom } from "../_shared/email-footer.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";

function htmlPerson(c: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  const raw = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "";
  return escapeHtml(raw || "Unknown");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // Allow either cron secret OR authenticated user (manual "Run Now")
  const gate = await requireCronOrUser(req);
  if (gate) return gate;


  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let orgId: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      orgId = body.org_id || null;
    }
  } catch { /* ignore */ }

  // If no org_id provided, fan out to ALL organizations and self-invoke
  if (!orgId) {
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, business_settings(notify_evening_brief)");
    if (orgsErr) {
      return new Response(JSON.stringify({ error: orgsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/evening-brief`;
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const results: Array<{ org_id: string; ok: boolean; status: number }> = [];
    for (const o of orgs ?? []) {
      const bs: any = (o as any).business_settings;
      const enabled = Array.isArray(bs) ? bs[0]?.notify_evening_brief === true : bs?.notify_evening_brief === true;
      if (!enabled) {
        results.push({ org_id: o.id, ok: true, status: 204 });
        continue;
      }
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret,
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
          },
          body: JSON.stringify({ org_id: o.id }),
        });
        results.push({ org_id: o.id, ok: r.ok, status: r.status });
      } catch (e: any) {
        results.push({ org_id: o.id, ok: false, status: 0 });
      }
    }
    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Calculate today boundaries in America/New_York
  const now = new Date();
  const nyFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = nyFormatter.formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;

  const todayStartNY = new Date(`${y}-${m}-${d}T00:00:00-04:00`).toISOString();
  const tomorrowStartNY = new Date(
    new Date(`${y}-${m}-${d}T00:00:00-04:00`).getTime() + 86400000
  ).toISOString();

  const errors: string[] = [];

  // 1. Today's bookings with completion stats
  let todayBookings: any[] = [];
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, scheduled_at, status, payment_status, total_amount, customers(first_name, last_name, phone)"
      )
      .eq("organization_id", orgId)
      .gte("scheduled_at", todayStartNY)
      .lt("scheduled_at", tomorrowStartNY)
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    todayBookings = data || [];
  } catch (e: any) {
    errors.push(`Bookings query error: ${e.message}`);
  }

  const completedJobs = todayBookings.filter((b) => b.status === "completed");
  const cancelledJobs = todayBookings.filter((b) => b.status === "cancelled");
  const pendingJobs = todayBookings.filter((b) => !["completed", "cancelled"].includes(b.status));
  const totalRevenue = completedJobs.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);
  const unpaidJobs = completedJobs.filter((b) => b.payment_status !== "paid");

  // 2. Open estimates
  let openEstimates: any[] = [];
  try {
    const { data, error } = await supabase
      .from("estimates")
      .select("id, client_name, estimated_total, quote_sent_at, status")
      .eq("organization_id", orgId)
      .not("quote_sent_at", "is", null)
      .is("quote_approved_at", null)
      .is("quote_declined_at", null)
      .is("converted_booking_id", null)
      .order("quote_sent_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    openEstimates = data || [];
  } catch (e: any) {
    errors.push(`Estimates query error: ${e.message}`);
  }

  // 3. Tomorrow's jobs preview
  const tomorrowEndNY = new Date(
    new Date(`${y}-${m}-${d}T00:00:00-04:00`).getTime() + 2 * 86400000
  ).toISOString();

  let tomorrowBookings: any[] = [];
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, scheduled_at, status, customers(first_name, last_name)"
      )
      .eq("organization_id", orgId)
      .gte("scheduled_at", tomorrowStartNY)
      .lt("scheduled_at", tomorrowEndNY)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    tomorrowBookings = data || [];
  } catch (e: any) {
    errors.push(`Tomorrow bookings query error: ${e.message}`);
  }

  // Format date for subject
  const subjectDate = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });

  // Build summary section
  const summaryHtml = `
    <div style="display:flex;gap:12px;margin-bottom:24px;">
      <div style="flex:1;background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:bold;color:#16a34a;">${completedJobs.length}</div>
        <div style="font-size:12px;color:#4ade80;">Completed</div>
      </div>
      <div style="flex:1;background:#fef3c7;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:bold;color:#ca8a04;">${pendingJobs.length}</div>
        <div style="font-size:12px;color:#ca8a04;">Pending</div>
      </div>
      <div style="flex:1;background:#fef2f2;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:bold;color:#dc2626;">${cancelledJobs.length}</div>
        <div style="font-size:12px;color:#dc2626;">Cancelled</div>
      </div>
      <div style="flex:1;background:#eff6ff;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:bold;color:#2563eb;">$${totalRevenue.toFixed(0)}</div>
        <div style="font-size:12px;color:#2563eb;">Revenue</div>
      </div>
    </div>`;

  // Build completed jobs list
  let completedHtml = "";
  if (completedJobs.length === 0) {
    completedHtml = `<p style="color:#888;">No jobs completed today.</p>`;
  } else {
    completedHtml = completedJobs
      .map((b) => {
        const c = b.customers;
        const name = htmlPerson(c);
        return `<div style="padding:6px 0;border-bottom:1px solid #eee;">
          <strong>${name}</strong> — ${formatTime(b.scheduled_at)} · 
          $${Number(b.total_amount || 0).toFixed(2)} · 
          Payment: <span style="color:${b.payment_status === 'paid' ? '#16a34a' : '#dc2626'}">${b.payment_status}</span>
        </div>`;
      })
      .join("");
  }

  // Build unpaid jobs alert
  let unpaidHtml = "";
  if (unpaidJobs.length > 0) {
    unpaidHtml = `
      <div style="background:#fef2f2;border:1px solid #fca5a5;padding:12px;border-radius:8px;margin:16px 0;">
        <h3 style="color:#dc2626;margin:0 0 8px;font-size:14px;">⚠️ ${unpaidJobs.length} Unpaid Completed Job${unpaidJobs.length > 1 ? 's' : ''}</h3>
        ${unpaidJobs.map((b) => {
          const c = b.customers;
          const name = htmlPerson(c);
          return `<div style="padding:4px 0;color:#991b1b;">${name} — $${Number(b.total_amount || 0).toFixed(2)}</div>`;
        }).join("")}
      </div>`;
  }

  // Build tomorrow preview
  let tomorrowHtml = "";
  if (tomorrowBookings.length === 0) {
    tomorrowHtml = `<p style="color:#888;">No jobs scheduled for tomorrow.</p>`;
  } else {
    tomorrowHtml = tomorrowBookings
      .map((b) => {
        const c = b.customers;
        const name = htmlPerson(c);
        return `<div style="padding:6px 0;border-bottom:1px solid #eee;">
          <strong>${name}</strong> — ${formatTime(b.scheduled_at)}
        </div>`;
      })
      .join("");
  }

  // Open estimates section
  let estimatesHtml = "";
  if (openEstimates.length > 0) {
    estimatesHtml = `
      <h2 style="font-size:16px;color:#ca8a04;margin:24px 0 12px;">🟡 Open Estimates (${openEstimates.length})</h2>
      ${openEstimates.map((e) => {
        const amount = e.estimated_total ? `$${Number(e.estimated_total).toFixed(2)}` : "N/A";
        return `<div style="padding:6px 0;border-bottom:1px solid #eee;">
          <strong>${escapeHtml(e.client_name || "Unknown")}</strong> — ${amount}
        </div>`;
      }).join("")}`;
  }

  let errorsHtml = "";
  if (errors.length > 0) {
    errorsHtml = `<div style="background:#fef2f2;border:1px solid #fca5a5;padding:12px;border-radius:8px;margin-top:20px;">
      <h3 style="color:#dc2626;margin:0 0 8px;">⚠️ Errors</h3>
      ${errors.map((e) => `<p style="margin:4px 0;color:#991b1b;">${escapeHtml(e)}</p>`).join("")}
    </div>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9fafb;">
  <div style="background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
    <h1 style="font-size:22px;margin:0 0 4px;">🌙 Tidywise End of Day Report</h1>
    <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">${subjectDate}</p>

    ${summaryHtml}

    <h2 style="font-size:16px;color:#16a34a;margin:0 0 12px;">✅ Completed Jobs (${completedJobs.length})</h2>
    ${completedHtml}

    ${unpaidHtml}

    ${estimatesHtml}

    <h2 style="font-size:16px;color:#2563eb;margin:24px 0 12px;">📋 Tomorrow's Preview (${tomorrowBookings.length})</h2>
    ${tomorrowHtml}

    ${errorsHtml}

    <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;text-align:center;">
      Sent by Tidywise · <a href="${Deno.env.get("APP_URL") || "https://jointidywise.com"}" style="color:#6b7280;">Dashboard</a>
    </p>
  </div>
</body>
</html>`;

  // Eligibility: subscription status, unsubscribe flag, owner email
  const eligibility = await checkOrgEmailEligibility(supabase, orgId);
  if (!eligibility.ok) {
    console.log(`Skipping org ${orgId}: ${eligibility.reason}`);
    return new Response(
      JSON.stringify({ skipped: true, reason: eligibility.reason, org_id: orgId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const recipientEmail = eligibility.email;

  // Inject unsubscribe footer before closing container div
  const footer = unsubscribeFooterHtml(eligibility.unsubscribeUrl);
  const htmlWithFooter = html.replace(/<\/body>/i, `${footer}</body>`);

  // Send via Resend
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: tidywiseSupportFrom(),
        to: [recipientEmail],
        subject: `Tidywise End of Day Report — ${subjectDate}`,
        html: htmlWithFooter,
        headers: {
          "List-Unsubscribe": `<${eligibility.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      console.error("Resend error:", result);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: result }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Evening brief sent successfully:", result);
    return new Response(
      JSON.stringify({
        success: true,
        emailId: result.id,
        summary: {
          completed: completedJobs.length,
          pending: pendingJobs.length,
          cancelled: cancelledJobs.length,
          revenue: totalRevenue,
          unpaid: unpaidJobs.length,
          tomorrow: tomorrowBookings.length,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("Send error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
