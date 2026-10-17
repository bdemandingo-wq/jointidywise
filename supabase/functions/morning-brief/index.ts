import { createClient } from "npm:@supabase/supabase-js@2";
import { requireCronOrUser } from "../_shared/requireCronOrUser.ts";
import { checkOrgEmailEligibility } from "../_shared/emailEligibility.ts";
import { tidywiseSupportFrom } from "../_shared/email-footer.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";

function plainPerson(c: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  const raw = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "";
  return raw || "Unknown";
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
  const tomorrowEndNY = new Date(new Date(`${y}-${m}-${d}T00:00:00-04:00`).getTime() + 2 * 86400000).toISOString();
  const tomorrowBookings = await safeQuery("Tomorrow's bookings", async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, scheduled_at, status, total_amount")
      .eq("organization_id", orgId)
      .gte("scheduled_at", tomorrowStartNY)
      .lt("scheduled_at", tomorrowEndNY)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }, []);
  const tomorrowRevenue = tomorrowBookings.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
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
  // Branded morning-brief design only: today's jobs, new leads, tomorrow,
  // and week-over-week revenue. Alerts, pipeline, and marketing stats are
  // still queried above for the send summary and are not rendered.
  // ════════════════════════════════════════════════════

  const subjectDate = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });
  const subjectLine = `📋 Tidywise Daily Brief — ${subjectDate} — ${todayBookings.length} jobs • ${fmt(todayRevenue)} booked • ${newLeads.length} leads`;
  const appUrl = Deno.env.get("APP_URL") || "https://jointidywise.com";
  const wowChange = pctChange(wow.thisWeek.revenue, wow.lastWeek.revenue);

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

  const brief = renderCrmEmail("morning-brief", {
    vars: {
      subjectDate,
      todayBookingsCount: todayBookings.length,
      todayRevenue: fmt(todayRevenue),
      newLeadsCount: newLeads.length,
      staffOnToday: staffUtilization.length,
      APP_URL: appUrl,
      tomorrowCount: tomorrowBookings.length,
      tomorrowRevenue: fmt(tomorrowRevenue),
      wowChange,
      UNSUBSCRIBE_URL: eligibility.unsubscribeUrl,
    },
    repeats: [
      {
        prefix: "job.",
        rows: todayBookings.map((b) => ({
          "job.time": formatTime(b.scheduled_at),
          "job.customer": plainPerson(b.customers),
          "job.service": b.services?.name || "—",
          "job.staff": b.staff?.name || "Unassigned",
          "job.total": fmt(Number(b.total_amount) || 0),
        })),
      },
      {
        prefix: "lead.",
        rows: newLeads.map((l) => ({
          "lead.name": l.name || "Unknown",
          "lead.source": l.source || "",
        })),
      },
    ],
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
        subject: subjectLine,
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
