import {
  resolveTemplate,
  resolveSubject,
} from "../_shared/automation-templates.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { getOrgEmailSettings, formatEmailFrom } from "../_shared/get-org-email-settings.ts";
import {
  resolveSender,
  PLATFORM_SENDER_FROM,
} from "../_shared/email-sender-resolution.ts";
import { anthropicChat, MODEL_SONNET } from "../_shared/anthropic.ts";
import { renderCrmEmail } from "../_shared/crm-email/render.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // Cron auth gate (allows manual invocation only with x-cron-secret)
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;


  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase configuration");
    }

    // STRICT ISOLATION: Require platform-level Resend key
    if (!RESEND_API_KEY) {
      console.error("[weekly-business-report] Missing RESEND_API_KEY");
      throw new Error("Email service not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Gate: only orgs that opted in via the `weekly_summary` automation toggle
    // get the digest. Loads enabled org_ids first, then fans out only those.
    const { data: enabled } = await supabase
      .from('organization_automations')
      .select('organization_id')
      .eq('automation_type', 'weekly_summary')
      .eq('is_enabled', true);
    const enabledOrgIds = new Set((enabled ?? []).map((r: { organization_id: string }) => r.organization_id));

    if (enabledOrgIds.size === 0) {
      console.log('[weekly-business-report] No orgs have weekly_summary enabled — exiting.');
      return new Response(
        JSON.stringify({ success: true, summary: { total: 0, sent: 0 } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name, owner_id')
      .in('id', Array.from(enabledOrgIds));

    const reports = [];

    for (const org of orgs || []) {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);
      const previousWeekStart = new Date(weekStart);
      previousWeekStart.setDate(weekStart.getDate() - 7);

      // This week's data
      const { data: thisWeekBookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('organization_id', org.id)
        .gte('scheduled_at', weekStart.toISOString())
        .lte('scheduled_at', now.toISOString());

      // Previous week's data (for comparison)
      const { data: prevWeekBookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('organization_id', org.id)
        .gte('scheduled_at', previousWeekStart.toISOString())
        .lt('scheduled_at', weekStart.toISOString());

      // Calculate metrics
      const thisWeekRevenue = (thisWeekBookings || [])
        .filter(b => b.status === 'completed' && b.payment_status === 'paid')
        .reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

      const prevWeekRevenue = (prevWeekBookings || [])
        .filter(b => b.status === 'completed' && b.payment_status === 'paid')
        .reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

      const thisWeekCompleted = (thisWeekBookings || []).filter(b => b.status === 'completed').length;
      const prevWeekCompleted = (prevWeekBookings || []).filter(b => b.status === 'completed').length;

      const thisWeekNewBookings = (thisWeekBookings || []).length;
      const prevWeekNewBookings = (prevWeekBookings || []).length;

      const thisWeekCancelled = (thisWeekBookings || []).filter(b => b.status === 'cancelled').length;

      // Get new customers this week
      const { count: newCustomers } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .gte('created_at', weekStart.toISOString());

      // Get new leads this week
      const { count: newLeads } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .gte('created_at', weekStart.toISOString());

      // Get reviews this week
      const { data: reviews } = await supabase
        .from('review_requests')
        .select('rating')
        .not('rating', 'is', null)
        .gte('responded_at', weekStart.toISOString());

      const avgRating = reviews && reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : null;

      // Staff performance
      const { data: staffBookings } = await supabase
        .from('bookings')
        .select('staff_id, staff:staff(name)')
        .eq('organization_id', org.id)
        .eq('status', 'completed')
        .gte('scheduled_at', weekStart.toISOString());

      const staffPerformance: Record<string, { name: string; jobs: number }> = {};
      for (const b of staffBookings || []) {
        if (b.staff_id && b.staff) {
          const staffId = b.staff_id;
          const staffName = (b.staff as any).name || 'Unknown';
          if (!staffPerformance[staffId]) {
            staffPerformance[staffId] = { name: staffName, jobs: 0 };
          }
          staffPerformance[staffId].jobs += 1;
        }
      }

      const topPerformer = Object.values(staffPerformance).sort((a, b) => b.jobs - a.jobs)[0];

      // Calculate percentage changes
      const revenueChange = prevWeekRevenue > 0 
        ? ((thisWeekRevenue - prevWeekRevenue) / prevWeekRevenue * 100).toFixed(1)
        : 'N/A';
      const bookingsChange = prevWeekCompleted > 0
        ? ((thisWeekCompleted - prevWeekCompleted) / prevWeekCompleted * 100).toFixed(1)
        : 'N/A';

      // Get admin email
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', org.owner_id)
        .single();

      const { data: settings } = await supabase
        .from('business_settings')
        .select('company_name, company_email')
        .eq('organization_id', org.id)
        .maybeSingle();

      const adminEmail = profile?.email || settings?.company_email;
      const companyName = settings?.company_name || org.name;

      if (!adminEmail) continue;

      // Owner-editable intro line and subject. The metrics below them are
      // generated and are not editable.
      const { data: wsAutomation, error: wsAutoErr } = await supabase
        .from('organization_automations')
        .select('settings')
        .eq('organization_id', org.id)
        .eq('automation_type', 'weekly_summary')
        .maybeSingle();
      if (wsAutoErr) {
        console.warn(`[weekly-business-report] template lookup failed org=${org.id}, using defaults:`, wsAutoErr);
      }
      const wsSettings = (wsAutomation?.settings ?? {}) as {
        templates?: Record<string, string>;
        template_subjects?: Record<string, string>;
      };
      const weekRange = `${weekStart.toLocaleDateString()} - ${now.toLocaleDateString()}`;
      const wsTokens = { company_name: companyName, week_range: weekRange };
      const wsResolved = resolveTemplate(
        'weekly_summary',
        wsSettings.templates?.weekly_summary ?? null,
        wsTokens,
      );
      if (wsResolved.warning) {
        console.warn(`[weekly-business-report] org=${org.id}: ${wsResolved.warning}`);
      }
      const wsSubject = resolveSubject(
        'weekly_summary',
        wsSettings.template_subjects?.weekly_summary ?? null,
        wsTokens,
      );

      // Generate AI insights if ANTHROPIC_API_KEY is available
      let aiInsights = '';
      if (ANTHROPIC_API_KEY) {
        try {
          const prompt = `You are a business analyst for a cleaning company. Based on this week's metrics, provide 2-3 brief, actionable insights (max 50 words each):

Revenue: $${thisWeekRevenue} (${revenueChange}% vs last week)
Jobs Completed: ${thisWeekCompleted} (${bookingsChange}% vs last week)
New Bookings: ${thisWeekNewBookings}
Cancellations: ${thisWeekCancelled}
New Customers: ${newCustomers || 0}
New Leads: ${newLeads || 0}
Average Rating: ${avgRating ? avgRating.toFixed(1) : 'No reviews'}
Top Performer: ${topPerformer ? `${topPerformer.name} (${topPerformer.jobs} jobs)` : 'N/A'}

Give practical advice for a cleaning business owner.`;

          const aiResponse = await anthropicChat(
            {
              model: MODEL_SONNET,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 800,
            },
            { corsHeaders },
          );

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            aiInsights = aiData.choices?.[0]?.message?.content || '';
          }
        } catch (aiError) {
          console.error('[weekly-business-report] AI error:', aiError);
        }
      }

      // The weekly report had no unsubscribe link before the branded shell.
      // A global token would also silence morning briefs, evening briefs, and
      // trial reminders, which this report never did.
      const introHtml = escapeHtml(wsResolved.text)
        .replace(/\{/g, "&#123;")
        .replace(/\}/g, "&#125;")
        .replace(/\n/g, "<br>");
      const report = renderCrmEmail("weekly-business-report", {
        vars: {
          company_name: companyName,
          week_range: weekRange,
          revenue: `$${thisWeekRevenue.toFixed(2)}`,
          jobsCompleted: thisWeekCompleted,
          newLeads: newLeads || 0,
          avgRating: avgRating ? avgRating.toFixed(1) : "No reviews",
          topStaff: topPerformer ? `${topPerformer.name} (${topPerformer.jobs} jobs)` : "N/A",
          APP_URL: Deno.env.get("APP_URL") || "https://jointidywise.com",
          aiSummary: escapeHtml(aiInsights)
            .replace(/\{/g, "&#123;")
            .replace(/\}/g, "&#125;")
            .replace(/\n/g, "<br>"),
        },
        slots: [introHtml],
        includeOptional: aiInsights.trim().length > 0,
        rawKeys: ["aiSummary"],
      });

      // Send email using organization-specific settings
      const emailSettingsResult = await getOrgEmailSettings(org.id);
      
      const orgSettings =
        emailSettingsResult.success && emailSettingsResult.settings
          ? emailSettingsResult.settings
          : null;

      const platformKey = RESEND_API_KEY;

      const resolved = resolveSender({
        settings: orgSettings,
        platformFrom: PLATFORM_SENDER_FROM,
        platformKeyPresent: !!platformKey,
        allowPlatformFallback: true,   // owner-facing internal report
      });

      if (!resolved.ok) {
        console.error(`[weekly-business-report] no sender for org ${org.id}: ${resolved.error}`);
        await supabase.rpc("log_org_email_send_failure", {
          _organization_id: org.id,
          _method: "resend",
          _fell_back_to: null,
          _recipient: adminEmail,
          _subject: wsSubject,
          _error_message: resolved.error,
        });
      } else {
        // The key must match the address. keySource 'org' means send with the
        // org's OWN key, which is what makes their own verified domain work —
        // the previous code always used the platform key and so could never
        // succeed for an org sending from its own domain.
        const keyFor = (source: "org" | "platform") =>
          source === "org" ? (orgSettings?.resend_api_key || platformKey) : platformKey;

        let fromHeader = resolved.sender.from;
        let resend = new Resend(keyFor(resolved.sender.keySource) as string);
        let fellBackTo: string | null = resolved.sender.usedFallback ? "platform" : null;

        const attempt = async () => {
          const { data, error } = await resend.emails.send({
            from: fromHeader,
            to: [adminEmail],
            subject: wsSubject,
            html: report.html,
            text: report.text,
          });
          return { data, error };
        };

        let { data: sendData, error: sendError } = await attempt();

        // Escalation. Without this Regal Rest still fails: its settings are
        // complete, so the first resolve returns the ORG identity, and only a
        // second resolve carrying priorFailure switches to the platform.
        if (sendError) {
          const firstError =
            typeof sendError === "string"
              ? sendError
              : (sendError as { message?: string })?.message ?? JSON.stringify(sendError);

          const escalated = resolveSender({
            settings: orgSettings,
            platformFrom: PLATFORM_SENDER_FROM,
            platformKeyPresent: !!platformKey,
            allowPlatformFallback: true,
            priorFailure: firstError,
          });

          if (escalated.ok && escalated.sender.usedFallback && !resolved.sender.usedFallback) {
            console.warn(
              `[weekly-business-report] org ${org.id}: own identity failed (${firstError}); retrying from the platform sender.`,
            );
            // No backoff. An unverified From or a rejected key is a permanent
            // validation error — waiting cannot change it, only the identity
            // swap on the next two lines can.
            resend = new Resend(platformKey as string);
            fromHeader = escalated.sender.from;
            fellBackTo = "platform";
            ({ data: sendData, error: sendError } = await attempt());
          }
        }

        if (sendError) {
          const detail =
            typeof sendError === "string"
              ? sendError
              : (sendError as { message?: string })?.message ?? JSON.stringify(sendError);
          console.error(`[weekly-business-report] send FAILED for org ${org.id}: ${detail}`);
          await supabase.rpc("log_org_email_send_failure", {
            _organization_id: org.id,
            _method: "resend",
            _fell_back_to: fellBackTo,
            _recipient: adminEmail,
            _subject: wsSubject,
            _error_message: detail,
          });
          // No automation_fire_log row. Unchanged from the previous paste.
        } else {
          console.log(
            `[weekly-business-report] sent to ${adminEmail} for org ${org.id} ` +
            `(from=${fromHeader}, fellBackTo=${fellBackTo ?? "none"})`,
          );
          if (fellBackTo) {
            // Not an error, but the owner should eventually be told their own
            // identity is not working. Logged so it is countable.
            await supabase.rpc("log_org_email_send_failure", {
              _organization_id: org.id,
              _method: "resend",
              _fell_back_to: fellBackTo,
              _recipient: adminEmail,
              _subject: wsSubject,
              _error_message: `weekly report sent via platform sender: ${resolved.sender.fallbackReason ?? "org_send_failed"}`,
            });
          }
          const { error: fireLogErr } = await supabase.from("automation_fire_log").insert({
            organization_id: org.id,
            automation_type: "weekly_summary",
            target_id: org.id,
            metadata: {
              sent_at: new Date().toISOString(),
              to: adminEmail,
              provider_message_id: sendData?.id ?? null,
              from: fromHeader,
              fell_back_to: fellBackTo,
            },
          });
          if (fireLogErr) console.error(`[weekly-business-report] fire-log insert failed for org ${org.id}:`, fireLogErr);
        }
      }


      reports.push({
        organizationId: org.id,
        revenue: thisWeekRevenue,
        jobsCompleted: thisWeekCompleted,
        newCustomers: newCustomers || 0,
      });
    }

    return new Response(
      JSON.stringify({ success: true, reports }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[weekly-business-report] Error:", errorMessage);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
