import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { platformAdminPhones } from "../_shared/platform-admin-phones.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOpenPhoneMessage } from "../_shared/openphone-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIDYWISE_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";
const ADMIN_PHONES = platformAdminPhones();

function formatTime12h(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// Eastern Time offset (minutes) for a UTC instant: Eastern = UTC + offset
// (-240 during EDT, -300 during EST). Uses the IANA tz database so DST is
// handled correctly year-round.
function etOffsetMinutes(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - instant.getTime()) / 60000;
}

// Eastern wall-clock (the format demos are stored in) -> UTC epoch ms, DST-aware.
function etWallClockToUtcMs(y: number, mo: number, d: number, h: number, min: number): number {
  const approx = Date.UTC(y, mo - 1, d, h, min);
  return approx - etOffsetMinutes(new Date(approx)) * 60000;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // Cron auth gate (allows manual invocation only with x-cron-secret)
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;


  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get confirmed demos
    const { data: demos, error } = await supabase
      .from("demo_bookings")
      .select("*")
      .in("status", ["confirmed", "rescheduled"]);

    if (error) {
      console.error("[demo-reminders] DB error:", error);
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!demos || demos.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get SMS settings
    const { data: smsSettings } = await supabase
      .from("organization_sms_settings")
      .select("openphone_api_key, openphone_phone_number_id")
      .eq("organization_id", TIDYWISE_ORG_ID)
      .maybeSingle();

    if (!smsSettings?.openphone_api_key || !smsSettings?.openphone_phone_number_id) {
      console.log("[demo-reminders] No SMS settings configured");
      return new Response(JSON.stringify({ success: true, sent: 0, reason: "no_sms_settings" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check which reminders already sent
    const { data: sentReminders, error: sentRemindersErr } = await supabase
      .from("demo_reminder_log")
      .select("demo_booking_id, reminder_type");

    if (sentRemindersErr) {
      // Fail closed: if we can't read what's already been sent, don't
      // guess it's empty — that would re-send every reminder to every
      // demo in the window on this run.
      console.error("[demo-reminders] Failed to load sent-reminder log, aborting run to avoid duplicate sends:", sentRemindersErr);
      return new Response(JSON.stringify({ success: false, error: sentRemindersErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sentSet = new Set(
      (sentReminders || []).map((r: any) => `${r.demo_booking_id}:${r.reminder_type}`)
    );

    let sentCount = 0;

    for (const demo of demos) {
      const [year, month, day] = demo.booked_date.split("-").map(Number);
      const [hours, minutes] = demo.booked_time.split(":").map(Number);
      const demoUtcMs = etWallClockToUtcMs(year, month, day, hours, minutes);
      const hoursUntilDemo = (demoUtcMs - Date.now()) / (1000 * 60 * 60);

      const firstName = demo.full_name.split(" ")[0];
      const dowIdx = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const dateDisplay = `${DAYS[dowIdx]}, ${MONTHS[month - 1]} ${day}`;
      const timeDisplay = formatTime12h(demo.booked_time.substring(0, 5));
      const howLine = demo.meeting_link
        ? `Join here: ${demo.meeting_link}`
        : `He'll call you at ${demo.phone}`;

      // 24-hour reminder to client (send between 23-25 hours before)
      if (hoursUntilDemo >= 23 && hoursUntilDemo <= 25 && !sentSet.has(`${demo.id}:24h_client`)) {
        try {
          const sent = await sendOpenPhoneMessage({
            supabase,
            organizationId: TIDYWISE_ORG_ID,
            to: demo.phone,
            content: `Hey ${firstName}! Just a reminder your TidyWise demo with Emmanuel is tomorrow at ${timeDisplay} EST. ${howLine}\n\nNeed to reschedule?\n→ jointidywise.com/demo\nor reply to this message.\n\nSee you tomorrow! 🎉`,
            from: smsSettings.openphone_phone_number_id,
            apiKey: smsSettings.openphone_api_key,
            tag: "demo-reminders:24h",
          });
          if (sent.skipped) {
            console.log(`[demo-reminders] 24h client reminder skipped opted_out ${demo.phone}`);
          } else {
            if (!sent.response.ok) {
              console.error(`[demo-reminders] 24h client reminder failed:`, sent.response.status, await sent.response.text());
            }
            const { error: logErr } = await supabase.from("demo_reminder_log").insert({
              demo_booking_id: demo.id,
              reminder_type: "24h_client",
            });
            if (logErr) {
              console.error(`[demo-reminders] 24h reminder sent but log insert failed for demo ${demo.id} — dedupe will not catch this next run:`, logErr);
            }

            console.log(`[demo-reminders] 24h client reminder sent to ${demo.phone}`);
            sentCount++;
          }
        } catch (err) {
          console.error(`[demo-reminders] 24h client reminder failed:`, err);
        }
      }

      // 1-hour reminder to Emmanuel (send 45-75 min before; 30-min band so the
      // */15 cron always samples it at least once)
      if (hoursUntilDemo >= 0.75 && hoursUntilDemo <= 1.25 && !sentSet.has(`${demo.id}:1h_admin`)) {
        const adminMsg = `⏰ DEMO REMINDER\n\n${demo.full_name} from ${demo.business_name}\nin 1 hour at ${timeDisplay} EST\n\n📞 ${demo.phone}\n📧 ${demo.email}\nChallenge: ${demo.biggest_challenge || "N/A"}`;

        try {
          for (const adminPhone of ADMIN_PHONES) {
            const sent = await sendOpenPhoneMessage({
              supabase,
              organizationId: TIDYWISE_ORG_ID,
              to: adminPhone,
              content: adminMsg,
              from: smsSettings.openphone_phone_number_id,
              apiKey: smsSettings.openphone_api_key,
              tag: "demo-reminders:1h-admin",
            });
            if (sent.skipped) {
              console.log(`[demo-reminders] 1h admin reminder skipped opted_out ${adminPhone}`);
              continue;
            }
            if (!sent.response.ok) {
              console.error(`[demo-reminders] 1h admin reminder failed:`, sent.response.status, await sent.response.text());
            }
          }

          const { error: logErr } = await supabase.from("demo_reminder_log").insert({
            demo_booking_id: demo.id,
            reminder_type: "1h_admin",
          });
          if (logErr) {
            console.error(`[demo-reminders] 1h admin reminder sent but log insert failed for demo ${demo.id} — dedupe will not catch this next run:`, logErr);
          }

          console.log(`[demo-reminders] 1h admin reminder sent for ${demo.full_name}`);
          sentCount++;
        } catch (err) {
          console.error(`[demo-reminders] 1h admin reminder failed:`, err);
        }
      }

      // 30-minute reminder to client with the join link (send 20-40 min before)
      if (hoursUntilDemo >= 0.33 && hoursUntilDemo <= 0.67 && !sentSet.has(`${demo.id}:30min_client`)) {
        const soonLine = demo.meeting_link
          ? `Join here: ${demo.meeting_link}`
          : `Emmanuel will call you at ${demo.phone}.`;
        try {
          const sent = await sendOpenPhoneMessage({
            supabase,
            organizationId: TIDYWISE_ORG_ID,
            to: demo.phone,
            content: `Hi ${firstName}! Your TidyWise demo with Emmanuel starts in 30 minutes (${timeDisplay} EST).\n\n${soonLine}\n\nSee you soon! 🎉`,
            from: smsSettings.openphone_phone_number_id,
            apiKey: smsSettings.openphone_api_key,
            tag: "demo-reminders:30min",
          });
          if (sent.skipped) {
            console.log(`[demo-reminders] 30min client reminder skipped opted_out ${demo.phone}`);
          } else {
            if (!sent.response.ok) {
              console.error(`[demo-reminders] 30min client reminder failed:`, sent.response.status, await sent.response.text());
            }
            const { error: logErr } = await supabase.from("demo_reminder_log").insert({
              demo_booking_id: demo.id,
              reminder_type: "30min_client",
            });
            if (logErr) {
              console.error(`[demo-reminders] 30min reminder sent but log insert failed for demo ${demo.id} — dedupe will not catch this next run:`, logErr);
            }

            console.log(`[demo-reminders] 30min client reminder sent to ${demo.phone}`);
            sentCount++;
          }
        } catch (err) {
          console.error(`[demo-reminders] 30min client reminder failed:`, err);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, checked: demos.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[demo-reminders] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
