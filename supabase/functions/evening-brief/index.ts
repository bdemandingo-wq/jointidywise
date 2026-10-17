import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronOrUser } from "../_shared/requireCronOrUser.ts";
import { checkOrgEmailEligibility } from "../_shared/emailEligibility.ts";
import { tidywiseSupportFrom } from "../_shared/email-footer.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";

function htmlPerson(c: any): string {
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
        "id, scheduled_at, status, total_amount, customers(first_name, last_name)"
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
  const appUrl = Deno.env.get("APP_URL") || "https://jointidywise.com";
  const tomorrowRevenue = tomorrowBookings.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    });
  if (errors.length > 0) {
    console.warn("[evening-brief] query issues included in the email:", errors);
  }

  // Eligibility: subscription status, unsubscribe flag, owner email.
  // Sent through Resend directly, so the unsubscribe URL must be the real one.
  const eligibility = await checkOrgEmailEligibility(supabase, orgId);
  if (!eligibility.ok) {
    console.log(`Skipping org ${orgId}: ${eligibility.reason}`);
    return new Response(
      JSON.stringify({ skipped: true, reason: eligibility.reason, org_id: orgId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const recipientEmail = eligibility.email;

  const completedHtml = completedJobs.length === 0
    ? `<p style="color:#888;margin:4px 0 12px;">No jobs completed today.</p>`
    : completedJobs.map((b) => {
      const pay = escapeHtml(String(b.payment_status || ""));
      const payColor = b.payment_status === "paid" ? "#16a34a" : "#dc2626";
      return `<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;"><strong>${htmlPerson(b.customers)}</strong> — ${formatTime(b.scheduled_at)} · $${Number(b.total_amount || 0).toFixed(2)} · Payment: <span style="color:${payColor};">${pay}</span></div>`;
    }).join("");

  const unpaidHtml = unpaidJobs.length > 0
    ? `<div style="background:#fef2f2;border:1px solid #fca5a5;padding:12px;border-radius:8px;margin:16px 0;"><h3 style="color:#dc2626;margin:0 0 8px;font-size:14px;">⚠️ ${unpaidJobs.length} Unpaid Completed Job${unpaidJobs.length > 1 ? "s" : ""}</h3>${unpaidJobs.map((b) => `<div style="padding:4px 0;color:#991b1b;">${htmlPerson(b.customers)} — $${Number(b.total_amount || 0).toFixed(2)}</div>`).join("")}</div>`
    : "";

  const estimatesHtml = openEstimates.length > 0
    ? `<h2 style="font-size:16px;color:#ca8a04;margin:24px 0 12px;">Open Estimates (${openEstimates.length})</h2>${openEstimates.map((e) => {
      const amount = e.estimated_total ? `$${Number(e.estimated_total).toFixed(2)}` : "N/A";
      return `<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;"><strong>${escapeHtml(e.client_name || "Unknown")}</strong> — ${amount}</div>`;
    }).join("")}`
    : "";

  const tomorrowHtml = tomorrowBookings.length === 0
    ? `<p style="color:#888;margin:4px 0;">No jobs scheduled for tomorrow.</p>`
    : tomorrowBookings.map((b) => `<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px;"><strong>${htmlPerson(b.customers)}</strong> — ${formatTime(b.scheduled_at)}</div>`).join("");

  const errorsHtml = errors.length > 0
    ? `<div style="background:#fef2f2;border:1px solid #fca5a5;padding:12px;border-radius:8px;margin-top:20px;"><h3 style="color:#dc2626;margin:0 0 8px;">Errors</h3>${errors.map((e) => `<p style="margin:4px 0;color:#991b1b;">${escapeHtml(e)}</p>`).join("")}</div>`
    : "";

  const opsDetail = `<h2 style="font-size:16px;color:#16a34a;margin:8px 0 12px;">Completed Jobs (${completedJobs.length})</h2>${completedHtml}${unpaidHtml}${estimatesHtml}<h2 style="font-size:16px;color:#2563eb;margin:24px 0 12px;">Tomorrow's Preview (${tomorrowBookings.length})</h2>${tomorrowHtml}${errorsHtml}`;

  const brief = renderCrmEmail("evening-brief", {
    vars: {
      subjectDate,
      completedCount: completedJobs.length,
      pendingCount: pendingJobs.length,
      cancelledCount: cancelledJobs.length,
      revenue: fmt(totalRevenue),
      APP_URL: appUrl,
      tomorrowCount: tomorrowBookings.length,
      tomorrowRevenue: fmt(tomorrowRevenue),
      openEstimatesCount: openEstimates.length,
      UNSUBSCRIBE_URL: eligibility.unsubscribeUrl,
      opsDetail,
    },
    rawKeys: ["opsDetail"],
  });


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
        html: brief.html,
        text: brief.text,
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
