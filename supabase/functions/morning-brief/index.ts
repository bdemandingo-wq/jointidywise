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
      .select("id, business_settings(notify_morning_brief)");
    if (orgsErr) {
      return new Response(JSON.stringify({ error: orgsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/morning-brief`;
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const results: Array<{ org_id: string; ok: boolean; status: number }> = [];
    for (const o of orgs ?? []) {
      const bs: any = (o as any).business_settings;
      const enabled = Array.isArray(bs) ? bs[0]?.notify_morning_brief === true : bs?.notify_morning_brief === true;
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

  // ── Time helpers (America/New_York) ──
  const now = new Date();
  const nyFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = nyFormatter.formatToParts(now);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;

  const todayStartNY = new Date(`${y}-${m}-${d}T00:00:00-04:00`).toISOString();
  const tomorrowStartNY = new Date(new Date(`${y}-${m}-${d}T00:00:00-04:00`).getTime() + 86400000).toISOString();
  const yesterdayStartNY = new Date(new Date(`${y}-${m}-${d}T00:00:00-04:00`).getTime() - 86400000).toISOString();
  const twentyFourAgo = new Date(Date.now() - 24 * 3600000).toISOString();
  const fortyEightAgo = new Date(Date.now() - 48 * 3600000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Week boundaries (Monday start)
  const nyDow = new Date(`${y}-${m}-${d}T12:00:00-04:00`).getDay();
  const daysSinceMonday = nyDow === 0 ? 6 : nyDow - 1;
  const thisWeekStart = new Date(new Date(`${y}-${m}-${d}T00:00:00-04:00`).getTime() - daysSinceMonday * 86400000).toISOString();
  const lastWeekStart = new Date(new Date(thisWeekStart).getTime() - 7 * 86400000).toISOString();
  const lastWeekEnd = thisWeekStart;

  // Month boundaries
  const thisMonthStart = new Date(`${y}-${m}-01T00:00:00-04:00`).toISOString();
  const lastMonthDate = new Date(new Date(`${y}-${m}-01T00:00:00-04:00`).getTime() - 86400000);
  const lmParts = nyFormatter.formatToParts(lastMonthDate);
  const lmY = lmParts.find(p => p.type === "year")!.value;
  const lmM = lmParts.find(p => p.type === "month")!.value;
  const lastMonthStart = new Date(`${lmY}-${lmM}-01T00:00:00-04:00`).toISOString();
  const lastMonthSameDayEnd = new Date(`${lmY}-${lmM}-${d}T00:00:00-04:00`).toISOString();
  const lastMonthSameDayEndPlusOne = new Date(new Date(lastMonthSameDayEnd).getTime() + 86400000).toISOString();

  const errors: string[] = [];
  const skippedSections: string[] = [];

  // Helper for safe queries
  async function safeQuery<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      errors.push(`${label}: ${e.message}`);
      skippedSections.push(label);
      return fallback;
    }
  }

  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const formatShortDate = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const pctChange = (curr: number, prev: number) => {
    if (prev === 0 && curr === 0) return "—";
    if (prev === 0) return "🔼 ∞%";
    const pct = ((curr - prev) / prev * 100).toFixed(1);
    return Number(pct) >= 0 ? `🔼 ${pct}%` : `🔽 ${Math.abs(Number(pct)).toFixed(1)}%`;
  };

  // ════════════════════════════════════════════════════
  // SECTION 1: OPERATIONS TODAY
  // ════════════════════════════════════════════════════
  const todayBookings = await safeQuery("Today's bookings", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, scheduled_at, status, payment_status, total_amount, address, customer_id, staff_id, service_id, customers(first_name, last_name, phone), staff(name), services(name)")
      .eq("organization_id", orgId)
      .gte("scheduled_at", todayStartNY)
      .lt("scheduled_at", tomorrowStartNY)
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }, []);

  const todayRevenue = todayBookings.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  const confirmedCount = todayBookings.filter(b => b.status === "confirmed" || b.status === "completed").length;
  const unconfirmedBookings = todayBookings.filter(b => b.status !== "confirmed" && b.status !== "completed" && b.status !== "cancelled");

  // ════════════════════════════════════════════════════
  // SECTION 2: ALERTS
  // ════════════════════════════════════════════════════
  const cancellations24h = await safeQuery("Cancellations 24h", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, scheduled_at, customers(first_name, last_name), total_amount")
      .eq("organization_id", orgId)
      .eq("status", "cancelled")
      .gte("updated_at", twentyFourAgo)
      .limit(20);
    if (error) throw error;
    return data || [];
  }, []);

  const noShows = await safeQuery("No-shows", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, scheduled_at, customers(first_name, last_name)")
      .eq("organization_id", orgId)
      .gte("scheduled_at", yesterdayStartNY)
      .lt("scheduled_at", todayStartNY)
      .neq("status", "cancelled")
      .is("cleaner_checkin_at", null)
      .limit(20);
    if (error) throw error;
    return data || [];
  }, []);

  const overduePayments = await safeQuery("Overdue payments", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, scheduled_at, total_amount, customers(first_name, last_name)")
      .eq("organization_id", orgId)
      .eq("payment_status", "unpaid")
      .lt("scheduled_at", yesterdayStartNY)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data || [];
  }, []);

  const lowRatings = await safeQuery("Low ratings", async () => {
    const results: any[] = [];
    try {
      const { data } = await supabase.from("client_portal_feedback").select("rating, comment, customer_id, created_at, customers(first_name, last_name)").eq("organization_id", orgId).lte("rating", 3).gte("created_at", fortyEightAgo).limit(10);
      if (data) results.push(...data.map(r => ({ ...r, source: "portal" })));
    } catch {}
    try {
      const { data } = await supabase.from("client_feedback").select("*").eq("organization_id", orgId).gte("created_at", fortyEightAgo).limit(10);
      if (data) results.push(...data.map(r => ({ ...r, source: "feedback" })));
    } catch {}
    return results;
  }, []);

  // ════════════════════════════════════════════════════
  // SECTION 3: REVENUE
  // ════════════════════════════════════════════════════
  const yesterdayCompletedRevenue = await safeQuery("Yesterday revenue", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("total_amount")
      .eq("organization_id", orgId)
      .eq("status", "completed")
      .eq("payment_status", "paid")
      .gte("scheduled_at", yesterdayStartNY)
      .lt("scheduled_at", todayStartNY);
    if (error) throw error;
    return (data || []).reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  }, 0);

  const thisWeekRevenue = await safeQuery("This week revenue", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("total_amount")
      .eq("organization_id", orgId)
      .neq("status", "cancelled")
      .gte("scheduled_at", thisWeekStart)
      .lt("scheduled_at", tomorrowStartNY);
    if (error) throw error;
    return (data || []).reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  }, 0);

  const thisMonthRevenue = await safeQuery("This month revenue", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("total_amount")
      .eq("organization_id", orgId)
      .neq("status", "cancelled")
      .gte("scheduled_at", thisMonthStart)
      .lt("scheduled_at", tomorrowStartNY);
    if (error) throw error;
    return (data || []).reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  }, 0);

  const lastMonthSamePeriodRevenue = await safeQuery("Last month same period", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("total_amount")
      .eq("organization_id", orgId)
      .neq("status", "cancelled")
      .gte("scheduled_at", lastMonthStart)
      .lt("scheduled_at", lastMonthSameDayEndPlusOne);
    if (error) throw error;
    return (data || []).reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  }, 0);

  const outstandingReceivables = await safeQuery("Outstanding receivables", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("total_amount")
      .eq("organization_id", orgId)
      .eq("payment_status", "unpaid")
      .neq("status", "cancelled");
    if (error) throw error;
    return (data || []).reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
  }, 0);

  const pendingDeposits = await safeQuery("Pending deposits", async () => {
    const { data, error } = await supabase
      .from("deposit_requests")
      .select("amount")
      .eq("organization_id", orgId)
      .neq("status", "paid");
    if (error) throw error;
    const arr = data || [];
    return { count: arr.length, total: arr.reduce((s, d) => s + (Number(d.amount) || 0), 0) };
  }, { count: 0, total: 0 });

  const expensesThisMonth = await safeQuery("Expenses this month", async () => {
    const { data, error } = await supabase
      .from("expenses")
      .select("amount")
      .eq("organization_id", orgId)
      .gte("expense_date", thisMonthStart)
      .lt("expense_date", tomorrowStartNY);
    if (error) throw error;
    return (data || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  }, 0);

  // ════════════════════════════════════════════════════
  // SECTION 4: SALES PIPELINE
  // ════════════════════════════════════════════════════
  const newLeads = await safeQuery("New leads", async () => {
    const leads: any[] = [];
    try {
      const { data } = await supabase.from("client_booking_requests").select("id, created_at, notes, customers(first_name, last_name), services(name)").eq("organization_id", orgId).gte("created_at", twentyFourAgo).order("created_at", { ascending: false });
      if (data) leads.push(...data.map(r => ({ name: r.customers ? `${r.customers.first_name || ""} ${r.customers.last_name || ""}`.trim() : "Unknown", source: "Booking Request", service: r.services?.name || "N/A", created_at: r.created_at })));
    } catch {}
    try {
      const { data } = await supabase
        .from("facebook_lead_webhook_events")
        .select("id, created_at, payload")
        .eq("organization_id", orgId)
        .gte("created_at", twentyFourAgo);
      if (data) leads.push(...data.map(r => ({ name: (r.payload as any)?.name || "FB Lead", source: "Facebook", service: "N/A", created_at: r.created_at })));
    } catch {}
    return leads;
  }, []);

  const openEstimates = await safeQuery("Open estimates", async () => {
    const { data, error } = await supabase
      .from("estimates")
      .select("id, client_name, estimated_total, quote_sent_at, status")
      .eq("organization_id", orgId)
      .not("quote_sent_at", "is", null)
      .is("quote_approved_at", null)
      .is("quote_declined_at", null)
      .is("converted_booking_id", null)
      .order("quote_sent_at", { ascending: false })
      .limit(15);
    if (error) throw error;
    return data || [];
  }, []);

  const staleEstimates = await safeQuery("Stale estimates", async () => {
    const sevenDaysAgoDate = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await supabase
      .from("estimates")
      .select("id, client_name, estimated_total, quote_sent_at")
      .eq("organization_id", orgId)
      .not("quote_sent_at", "is", null)
      .lt("quote_sent_at", sevenDaysAgoDate)
      .is("quote_approved_at", null)
      .is("quote_declined_at", null)
      .is("converted_booking_id", null)
      .limit(10);
    if (error) throw error;
    return data || [];
  }, []);

  const estimateWins = await safeQuery("Estimate wins", async () => {
    const { data, error } = await supabase
      .from("estimates")
      .select("id, client_name, estimated_total")
      .eq("organization_id", orgId)
      .gte("quote_approved_at", sevenDaysAgo)
      .limit(10);
    if (error) throw error;
    return data || [];
  }, []);

  const estimateConversion = await safeQuery("Estimate conversion", async () => {
    const { count: sentCount, error: e1 } = await supabase
      .from("estimates")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("quote_sent_at", "is", null)
      .gte("quote_sent_at", thirtyDaysAgo);
    if (e1) throw e1;
    const { count: approvedCount, error: e2 } = await supabase
      .from("estimates")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("quote_approved_at", "is", null)
      .gte("quote_approved_at", thirtyDaysAgo);
    if (e2) throw e2;
    return { sent: sentCount ?? 0, approved: approvedCount ?? 0 };
  }, { sent: 0, approved: 0 });

  const abandonedBookings24h = await safeQuery("Abandoned bookings", async () => {
    const { data, error } = await supabase
      .from("abandoned_bookings")
      .select("id, first_name, last_name, email, phone, step_reached, created_at")
      .eq("organization_id", orgId)
      .gte("created_at", twentyFourAgo)
      .limit(10);
    if (error) throw error;
    return data || [];
  }, []);

  // ════════════════════════════════════════════════════
  // SECTION 5: CUSTOMERS
  // ════════════════════════════════════════════════════
  const newCustomers24h = await safeQuery("New customers 24h", async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("id, first_name, last_name")
      .eq("organization_id", orgId)
      .gte("created_at", twentyFourAgo)
      .limit(20);
    if (error) throw error;
    return data || [];
  }, []);

  const newCustomers7d = await safeQuery("New customers 7d", async () => {
    const { count, error } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", sevenDaysAgo);
    if (error) throw error;
    return count ?? 0;
  }, 0);

  const totalActiveCustomers = await safeQuery("Active customers", async () => {
    const { count, error } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("customer_status", "active");
    if (error) throw error;
    return count ?? 0;
  }, 0);

  const churnRisk = await safeQuery("Churn risk", async () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    // Get customers whose latest booking is > 90 days ago, ordered by spend
    const { data, error } = await supabase.rpc("get_user_organization_id"); // just to check - we'll do manual query
    // Simple approach: get customers with old last bookings
    const { data: custs, error: e2 } = await supabase
      .from("customers")
      .select("id, first_name, last_name")
      .eq("organization_id", orgId)
      .eq("customer_status", "active")
      .limit(500);
    if (e2) throw e2;
    if (!custs || custs.length === 0) return [];
    
    // Get last booking dates
    const churnList: any[] = [];
    for (const c of custs.slice(0, 200)) {
      const { data: lastBooking } = await supabase
        .from("bookings")
        .select("scheduled_at, total_amount")
        .eq("customer_id", c.id)
        .eq("organization_id", orgId)
        .neq("status", "cancelled")
        .order("scheduled_at", { ascending: false })
        .limit(1);
      if (lastBooking && lastBooking.length > 0 && lastBooking[0].scheduled_at < ninetyDaysAgo) {
        churnList.push({ ...c, lastBooking: lastBooking[0].scheduled_at, spend: Number(lastBooking[0].total_amount) || 0 });
      }
    }
    churnList.sort((a, b) => b.spend - a.spend);
    return churnList.slice(0, 10);
  }, []);

  const topCustomersMonth = await safeQuery("Top customers month", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("customer_id, total_amount, customers(first_name, last_name)")
      .eq("organization_id", orgId)
      .neq("status", "cancelled")
      .gte("scheduled_at", thisMonthStart)
      .lt("scheduled_at", tomorrowStartNY);
    if (error) throw error;
    const byCustomer: Record<string, { name: string; total: number }> = {};
    for (const b of data || []) {
      const cid = b.customer_id;
      if (!cid) continue;
      const name = b.customers ? `${b.customers.first_name || ""} ${b.customers.last_name || ""}`.trim() : "Unknown";
      if (!byCustomer[cid]) byCustomer[cid] = { name, total: 0 };
      byCustomer[cid].total += Number(b.total_amount) || 0;
    }
    return Object.values(byCustomer).sort((a, b) => b.total - a.total).slice(0, 5);
  }, []);

  const loyaltyChanges = await safeQuery("Loyalty changes", async () => {
    const { data, error } = await supabase
      .from("customer_loyalty")
      .select("tier, customer_id, updated_at, customers(first_name, last_name)")
      .eq("customers.organization_id", orgId)
      .gte("updated_at", twentyFourAgo)
      .limit(10);
    if (error) throw error;
    return data || [];
  }, []);

  // ════════════════════════════════════════════════════
  // SECTION 6: MARKETING & CAMPAIGNS
  // ════════════════════════════════════════════════════
  // NOTE: these two used `{ count: 'exact', head: true }` and then read
  // `data?.length`. With head:true no rows are returned, so both figures were
  // hard-zero in every brief ever sent. Read `count` instead.
  const emailsSent24h = await safeQuery("Emails sent 24h", async () => {
    const { count, error } = await supabase
      .from("campaign_emails")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("sent_at", twentyFourAgo);
    if (error) throw error;
    return count ?? 0;
  }, 0);

  const smsSent24h = await safeQuery("SMS sent 24h", async () => {
    const { count, error } = await supabase
      .from("campaign_sms_sends")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("sent_at", twentyFourAgo);
    if (error) throw error;
    return count ?? 0;
  }, 0);

  const activeAutomations = await safeQuery("Active automations", async () => {
    let count = 0;
    try {
      const { data } = await supabase.from("automated_campaigns").select("id").eq("organization_id", orgId).eq("is_active", true);
      count += (data || []).length;
    } catch {}
    try {
      const { data } = await supabase.from("custom_automations").select("id").eq("organization_id", orgId).eq("is_active", true);
      count += (data || []).length;
    } catch {}
    return count;
  }, 0);

  const automationErrors = await safeQuery("Automation errors", async () => {
    const { data, error } = await supabase
      .from("custom_automation_logs")
      .select("id, automation_id, error, created_at")
      .eq("organization_id", orgId)
      .eq("status", "error")
      .gte("created_at", twentyFourAgo)
      .limit(10);
    if (error) throw error;
    return data || [];
  }, []);

  const fbLeads24h = await safeQuery("FB leads 24h", async () => {
    const { data, error } = await supabase
      .from("facebook_lead_webhook_events")
      .select("id")
      .eq("organization_id", orgId)
      .gte("created_at", twentyFourAgo);
    if (error) throw error;
    return (data || []).length;
  }, 0);

  const reviewQueueDepth = await safeQuery("Review queue", async () => {
    const { data, error } = await supabase
      .from("automated_review_sms_queue")
      .select("id")
      .eq("organization_id", orgId)
      .eq("sent", false);
    if (error) throw error;
    return (data || []).length;
  }, 0);

  // ════════════════════════════════════════════════════
  // SECTION 7: MESSAGES & COMMUNICATION
  // ════════════════════════════════════════════════════
  const aiReplies24h = await safeQuery("AI replies 24h", async () => {
    const { data, error } = await supabase
      .from("ai_reply_log")
      .select("inbound_message_id")
      .gte("created_at", twentyFourAgo);
    if (error) throw error;
    return (data || []).length;
  }, 0);

  const portalSessions = await safeQuery("Portal sessions", async () => {
    const { data, error } = await supabase
      .from("client_portal_sessions")
      .select("id")
      .eq("organization_id", orgId)
      .gte("session_start", twentyFourAgo);
    if (error) throw error;
    return (data || []).length;
  }, 0);

  // ════════════════════════════════════════════════════
  // SECTION 8: OPERATIONS ANALYTICS
  // ════════════════════════════════════════════════════
  const checklistCompletion = await safeQuery("Checklist completion", async () => {
    const { data: checklists, error } = await supabase
      .from("booking_checklists")
      .select("id, completed_at")
      .eq("organization_id", orgId)
      .gte("created_at", sevenDaysAgo);
    if (error) throw error;
    const total = (checklists || []).length;
    const completed = (checklists || []).filter(c => c.completed_at).length;
    return { total, completed, rate: total > 0 ? Math.round(completed / total * 100) : 0 };
  }, { total: 0, completed: 0, rate: 0 });

  const avgRatingWeek = await safeQuery("Avg rating", async () => {
    const { data, error } = await supabase
      .from("client_portal_feedback")
      .select("rating")
      .eq("organization_id", orgId)
      .gte("created_at", sevenDaysAgo);
    if (error) throw error;
    if (!data || data.length === 0) return { avg: 0, count: 0 };
    const sum = data.reduce((s, r) => s + r.rating, 0);
    return { avg: Number((sum / data.length).toFixed(1)), count: data.length };
  }, { avg: 0, count: 0 });

  const staffUtilization = await safeQuery("Staff utilization", async () => {
    const byStaff: Record<string, { name: string; count: number }> = {};
    for (const b of todayBookings) {
      const sid = b.staff_id;
      if (!sid) continue;
      const name = b.staff?.name || "Unknown";
      if (!byStaff[sid]) byStaff[sid] = { name, count: 0 };
      byStaff[sid].count++;
    }
    return Object.values(byStaff).sort((a, b) => b.count - a.count);
  }, []);

  const serviceVolume = await safeQuery("Service volume", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("service_id, services(name)")
      .eq("organization_id", orgId)
      .neq("status", "cancelled")
      .gte("scheduled_at", thisWeekStart)
      .lt("scheduled_at", tomorrowStartNY);
    if (error) throw error;
    const bySvc: Record<string, { name: string; count: number }> = {};
    for (const b of data || []) {
      const sid = b.service_id || "other";
      const name = b.services?.name || "Other";
      if (!bySvc[sid]) bySvc[sid] = { name, count: 0 };
      bySvc[sid].count++;
    }
    return Object.values(bySvc).sort((a, b) => b.count - a.count).slice(0, 5);
  }, []);

  // ════════════════════════════════════════════════════
  // SECTION 9: WEEK-OVER-WEEK
  // ════════════════════════════════════════════════════
  const wow = await safeQuery("Week-over-week", async () => {
    const queryWeek = async (start: string, end: string) => {
      const { data: bookings, error: e1 } = await supabase
        .from("bookings")
        .select("id, total_amount, status, customer_id")
        .eq("organization_id", orgId)
        .gte("scheduled_at", start)
        .lt("scheduled_at", end);
      if (e1) throw e1;
      const arr = bookings || [];
      const totalBookings = arr.filter(b => b.status !== "cancelled").length;
      const totalRevenue = arr.filter(b => b.status !== "cancelled").reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
      const cancellations = arr.filter(b => b.status === "cancelled").length;

      const { data: custs } = await supabase
        .from("customers")
        .select("id")
        .eq("organization_id", orgId)
        .gte("created_at", start)
        .lt("created_at", end);

      const { data: estWins } = await supabase
        .from("estimates")
        .select("id")
        .eq("organization_id", orgId)
        .gte("quote_approved_at", start)
        .lt("quote_approved_at", end);

      return {
        bookings: totalBookings,
        revenue: totalRevenue,
        newCustomers: (custs || []).length,
        cancellations,
        estimateWins: (estWins || []).length,
      };
    };

    const thisW = await queryWeek(thisWeekStart, tomorrowStartNY);
    const lastW = await queryWeek(lastWeekStart, lastWeekEnd);
    return { thisWeek: thisW, lastWeek: lastW };
  }, { thisWeek: { bookings: 0, revenue: 0, newCustomers: 0, cancellations: 0, estimateWins: 0 }, lastWeek: { bookings: 0, revenue: 0, newCustomers: 0, cancellations: 0, estimateWins: 0 } });

  // ════════════════════════════════════════════════════
  // BUILD HTML
  // ════════════════════════════════════════════════════

  const subjectDate = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  const subjectLine = `📋 Tidywise Daily Brief — ${subjectDate} — ${todayBookings.length} jobs • ${fmt(todayRevenue)} booked • ${newLeads.length} leads`;

  const renderList = (items: string[], max = 5) => {
    if (items.length === 0) return `<p style="color:#9ca3af;margin:4px 0;">None</p>`;
    const shown = items.slice(0, max).join("");
    const remaining = items.length - max;
    return shown + (remaining > 0 ? `<p style="color:#6b7280;font-size:13px;margin:8px 0;">+ ${remaining} more — <a href="${Deno.env.get("APP_URL") || "https://jointidywise.com"}/dashboard" style="color:#2563eb;">see admin dashboard</a></p>` : "");
  };

  const sectionStyle = `margin:0 0 28px;`;
  const headerStyle = (color: string) => `font-size:16px;color:${color};margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid ${color}20;`;
  const rowStyle = `padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;line-height:1.5;`;
  const metricRow = (label: string, value: string, highlight = false) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${label}</td><td style="padding:4px 0;font-weight:600;font-size:13px;${highlight ? "color:#dc2626;" : ""}">${value}</td></tr>`;

  // Section 1: Operations Today
  const unconfirmedHtml = unconfirmedBookings.length > 0
    ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;margin-bottom:12px;">
        <strong style="color:#dc2626;">⚠️ ${unconfirmedBookings.length} Unconfirmed Booking${unconfirmedBookings.length > 1 ? "s" : ""}</strong>
        ${unconfirmedBookings.map(b => {
          const c = b.customers;
          const name = htmlPerson(c);
          return `<div style="${rowStyle}"><strong>${name}</strong> — ${formatTime(b.scheduled_at)} · ${escapeHtml(String(b.status || ""))}</div>`;
        }).join("")}
      </div>` : "";

  const jobRows = todayBookings.map(b => {
    const c = b.customers;
    const name = htmlPerson(c);
    const staffName = escapeHtml(b.staff?.name || "Unassigned");
    const serviceName = escapeHtml(b.services?.name || "—");
    const statusColor = b.status === "completed" ? "#16a34a" : b.status === "cancelled" ? "#dc2626" : b.status === "confirmed" ? "#2563eb" : "#ca8a04";
    const payColor = b.payment_status === "paid" ? "#16a34a" : "#dc2626";
    return `<div style="${rowStyle}">
      <strong>${name}</strong> · ${formatTime(b.scheduled_at)}<br/>
      <span style="color:#6b7280;">👤 ${staffName} · 🧹 ${serviceName}</span><br/>
      <span style="color:#6b7280;">📍 ${escapeHtml(b.address || "No address")}</span><br/>
      <span style="color:${statusColor};">${b.status}</span> · <span style="color:${payColor};">💳 ${b.payment_status}</span> · ${fmt(Number(b.total_amount) || 0)}
    </div>`;
  });

  const sec1Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#dc2626")}">🔥 OPERATIONS TODAY</h2>
    <table style="margin-bottom:12px;">${metricRow("Total Jobs", String(todayBookings.length))}${metricRow("Booked Revenue", fmt(todayRevenue))}${metricRow("Confirmed", String(confirmedCount))}${metricRow("Unconfirmed", String(unconfirmedBookings.length), unconfirmedBookings.length > 0)}</table>
    ${unconfirmedHtml}
    ${todayBookings.length === 0 ? `<p style="color:#9ca3af;">All clear — no jobs scheduled today.</p>` : renderList(jobRows, 15)}
  </div>`;

  // Section 2: Alerts
  const alertItems: string[] = [];
  if (cancellations24h.length > 0) alertItems.push(`<div style="margin-bottom:12px;"><strong style="color:#dc2626;">🚫 ${cancellations24h.length} Cancellation${cancellations24h.length > 1 ? "s" : ""} (24h)</strong>${renderList(cancellations24h.map(b => `<div style="${rowStyle}">${htmlPerson(b.customers)} — ${formatShortDate(b.scheduled_at)} · ${fmt(Number(b.total_amount) || 0)}</div>`))}</div>`);
  if (noShows.length > 0) alertItems.push(`<div style="margin-bottom:12px;"><strong style="color:#dc2626;">❌ ${noShows.length} No-Show${noShows.length > 1 ? "s" : ""} Yesterday</strong>${renderList(noShows.map(b => `<div style="${rowStyle}">${htmlPerson(b.customers)} — ${formatShortDate(b.scheduled_at)}</div>`))}</div>`);
  if (overduePayments.length > 0) {
    const overdueTotal = overduePayments.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    alertItems.push(`<div style="margin-bottom:12px;"><strong style="color:#dc2626;">💸 ${overduePayments.length} Overdue Payment${overduePayments.length > 1 ? "s" : ""} (${fmt(overdueTotal)})</strong>${renderList(overduePayments.map(b => `<div style="${rowStyle}">${htmlPerson(b.customers)} — ${formatShortDate(b.scheduled_at)} · ${fmt(Number(b.total_amount) || 0)}</div>`))}</div>`);
  }
  if (lowRatings.length > 0) alertItems.push(`<div style="margin-bottom:12px;"><strong style="color:#ca8a04;">⭐ ${lowRatings.length} Low Rating${lowRatings.length > 1 ? "s" : ""} (48h)</strong>${renderList(lowRatings.map(r => `<div style="${rowStyle}">${escapeHtml(r.customer_name || "") || htmlPerson(r.customers)} — ${r.rating ? `${r.rating}★` : "N/A"} · ${escapeHtml(r.comment || r.issue_description || "No comment")}</div>`))}</div>`);

  const sec2Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#dc2626")}">🚨 ALERTS & ATTENTION NEEDED</h2>
    ${alertItems.length === 0 ? `<p style="color:#16a34a;">✅ All clear — no alerts.</p>` : alertItems.join("")}
  </div>`;

  // Section 3: Revenue
  const momDelta = pctChange(thisMonthRevenue, lastMonthSamePeriodRevenue);
  const grossProfit = thisMonthRevenue - expensesThisMonth;

  const sec3Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#16a34a")}">💰 REVENUE</h2>
    <table>
      ${metricRow("Today Booked", fmt(todayRevenue))}
      ${metricRow("Yesterday Completed", fmt(yesterdayCompletedRevenue))}
      ${metricRow("This Week (Mon–Today)", fmt(thisWeekRevenue))}
      ${metricRow("This Month", fmt(thisMonthRevenue))}
      ${metricRow("Last Month Same Period", fmt(lastMonthSamePeriodRevenue))}
      ${metricRow("Month-over-Month", momDelta)}
      ${metricRow("Outstanding Receivables", fmt(outstandingReceivables), outstandingReceivables > 0)}
      ${metricRow("Pending Deposits", `${pendingDeposits.count} (${fmt(pendingDeposits.total)})`)}
      ${metricRow("Expenses This Month", fmt(expensesThisMonth))}
      ${metricRow("Gross Profit Est.", fmt(grossProfit), grossProfit < 0)}
    </table>
  </div>`;

  // Section 4: Sales Pipeline
  const convRate = estimateConversion.sent > 0 ? `${Math.round(estimateConversion.approved / estimateConversion.sent * 100)}%` : "N/A";

  const sec4Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#7c3aed")}">📈 SALES PIPELINE</h2>
    <strong>New Leads (24h): ${newLeads.length}</strong>
    ${renderList(newLeads.map(l => `<div style="${rowStyle}"><strong>${escapeHtml(l.name)}</strong> · ${escapeHtml(l.source)} · ${escapeHtml(l.service)}</div>`))}
    <div style="margin-top:12px;"><strong>Open Estimates: ${openEstimates.length}</strong></div>
    ${renderList(openEstimates.map(e => `<div style="${rowStyle}"><strong>${escapeHtml(e.client_name || "Unknown")}</strong> — ${e.estimated_total ? fmt(Number(e.estimated_total)) : "N/A"} · Sent ${formatShortDate(e.quote_sent_at)}</div>`))}
    ${staleEstimates.length > 0 ? `<div style="margin-top:12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:8px;"><strong style="color:#92400e;">⏰ ${staleEstimates.length} Stale Estimate${staleEstimates.length > 1 ? "s" : ""} (>7 days)</strong>${renderList(staleEstimates.map(e => `<div style="${rowStyle}">${escapeHtml(e.client_name || "Unknown")} — ${e.estimated_total ? fmt(Number(e.estimated_total)) : "N/A"}</div>`))}</div>` : ""}
    <table style="margin-top:12px;">
      ${metricRow("Wins (7 days)", String(estimateWins.length))}
      ${metricRow("Conversion Rate (30d)", convRate)}
      ${metricRow("Abandoned Bookings (24h)", String(abandonedBookings24h.length), abandonedBookings24h.length > 0)}
    </table>
  </div>`;

  // Section 5: Customers
  const sec5Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#0891b2")}">👥 CUSTOMERS</h2>
    <table>
      ${metricRow("New (24h)", `${newCustomers24h.length}${newCustomers24h.length > 0 ? " — " + newCustomers24h.slice(0, 3).map(c => htmlPerson(c)).join(", ") : ""}`)}
      ${metricRow("New (7 days)", String(newCustomers7d))}
      ${metricRow("Total Active", String(totalActiveCustomers))}
    </table>
    ${churnRisk.length > 0 ? `<div style="margin-top:12px;"><strong style="color:#dc2626;">⚠️ Churn Risk (no booking >90 days)</strong>${renderList(churnRisk.map(c => `<div style="${rowStyle}">${htmlPerson(c)} — Last: ${formatShortDate(c.lastBooking)}</div>`))}</div>` : ""}
    ${topCustomersMonth.length > 0 ? `<div style="margin-top:12px;"><strong>🏆 Top Customers This Month</strong>${topCustomersMonth.map((c, i) => `<div style="${rowStyle}">${i + 1}. ${escapeHtml(c.name)} — ${fmt(c.total)}</div>`).join("")}</div>` : ""}
  </div>`;

  // Section 6: Marketing
  const sec6Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#ea580c")}">📣 MARKETING & CAMPAIGNS</h2>
    <table>
      ${metricRow("Emails Sent (24h)", String(emailsSent24h))}
      ${metricRow("SMS Sent (24h)", String(smsSent24h))}
      ${metricRow("Active Automations", String(activeAutomations))}
      ${metricRow("Automation Errors (24h)", String(automationErrors.length), automationErrors.length > 0)}
      ${metricRow("Facebook Leads (24h)", String(fbLeads24h))}
      ${metricRow("Review SMS Queue", String(reviewQueueDepth))}
    </table>
  </div>`;

  // Section 7: Messages
  const sec7Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#6366f1")}">💬 MESSAGES & COMMUNICATION</h2>
    <table>
      ${metricRow("AI Replies (24h)", String(aiReplies24h))}
      ${metricRow("Client Portal Sessions (24h)", String(portalSessions))}
    </table>
  </div>`;

  // Section 8: Operations Analytics
  const sec8Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#0d9488")}">🧹 OPERATIONS ANALYTICS</h2>
    <table>
      ${metricRow("Checklist Completion (7d)", `${checklistCompletion.rate}% (${checklistCompletion.completed}/${checklistCompletion.total})`)}
      ${metricRow("Avg Rating (7d)", avgRatingWeek.count > 0 ? `${avgRatingWeek.avg}★ (${avgRatingWeek.count} reviews)` : "No reviews")}
    </table>
    ${staffUtilization.length > 0 ? `<div style="margin-top:12px;"><strong>Staff Utilization Today</strong>${staffUtilization.map(s => `<div style="${rowStyle}">${escapeHtml(s.name)}: ${s.count} job${s.count > 1 ? "s" : ""}</div>`).join("")}</div>` : ""}
    ${serviceVolume.length > 0 ? `<div style="margin-top:12px;"><strong>Top Services This Week</strong>${serviceVolume.map(s => `<div style="${rowStyle}">${escapeHtml(s.name)}: ${s.count} booking${s.count > 1 ? "s" : ""}</div>`).join("")}</div>` : ""}
  </div>`;

  // Section 9: Week-over-Week
  const wowRow = (label: string, thisW: number, lastW: number, isCurrency = false) => {
    const thisVal = isCurrency ? fmt(thisW) : String(thisW);
    const lastVal = isCurrency ? fmt(lastW) : String(lastW);
    return `<tr><td style="padding:4px 8px;border:1px solid #e5e7eb;font-size:13px;">${label}</td><td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center;font-size:13px;">${lastVal}</td><td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center;font-size:13px;">${thisVal}</td><td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center;font-size:13px;">${pctChange(thisW, lastW)}</td></tr>`;
  };

  const sec9Html = `<div style="${sectionStyle}">
    <h2 style="${headerStyle("#374151")}">📊 WEEK-OVER-WEEK SNAPSHOT</h2>
    <table style="border-collapse:collapse;width:100%;">
      <tr style="background:#f3f4f6;"><th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Metric</th><th style="padding:6px 8px;border:1px solid #e5e7eb;font-size:12px;">Last Week</th><th style="padding:6px 8px;border:1px solid #e5e7eb;font-size:12px;">This Week</th><th style="padding:6px 8px;border:1px solid #e5e7eb;font-size:12px;">Change</th></tr>
      ${wowRow("Bookings", wow.thisWeek.bookings, wow.lastWeek.bookings)}
      ${wowRow("Revenue", wow.thisWeek.revenue, wow.lastWeek.revenue, true)}
      ${wowRow("New Customers", wow.thisWeek.newCustomers, wow.lastWeek.newCustomers)}
      ${wowRow("Cancellations", wow.thisWeek.cancellations, wow.lastWeek.cancellations)}
      ${wowRow("Estimate Wins", wow.thisWeek.estimateWins, wow.lastWeek.estimateWins)}
    </table>
  </div>`;

  // Errors section
  const errorsHtml = skippedSections.length > 0 ? `<div style="margin-top:20px;padding:8px;background:#f9fafb;border-radius:6px;font-size:11px;color:#9ca3af;">
    <strong>Sections with issues:</strong> ${skippedSections.join(", ")}${errors.length > 0 ? `<br/>${errors.map(e => `• ${e}`).join("<br/>")}` : ""}
  </div>` : "";

  const generatedAt = now.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#f9fafb;color:#1f2937;">
  <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb;">
    <h1 style="font-size:22px;margin:0 0 4px;">📋 Tidywise Daily Brief</h1>
    <p style="color:#6b7280;margin:0 0 28px;font-size:14px;">${subjectDate}</p>
    ${sec1Html}${sec2Html}${sec3Html}${sec4Html}${sec5Html}${sec6Html}${sec7Html}${sec8Html}${sec9Html}
    ${errorsHtml}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;">
      <a href="${Deno.env.get("APP_URL") || "https://jointidywise.com"}/dashboard/notifications" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Open Dashboard</a>
      <p style="color:#9ca3af;font-size:11px;margin:12px 0 0;">Generated ${generatedAt}</p>
    </div>
  </div>
</body></html>`;

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
        subject: subjectLine,
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

    console.log("Daily brief sent successfully:", result);
    return new Response(
      JSON.stringify({
        success: true,
        emailId: result.id,
        summary: {
          jobs: todayBookings.length,
          revenue: todayRevenue,
          leads: newLeads.length,
          alerts: cancellations24h.length + noShows.length + overduePayments.length + lowRatings.length,
          skippedSections: skippedSections.length,
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
