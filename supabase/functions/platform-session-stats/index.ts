import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Owner login. Not the public support inbox.
const PLATFORM_ADMIN_EMAIL = "support@tidywisecleaning.com";

type SessionRow = {
  user_id: string | null;
  user_email: string | null;
  duration_seconds: number | null;
};

type ClientPortalSessionRow = {
  client_user_id: string | null;
  customer_email: string | null;
  duration_seconds: number | null;
};

type UserStat = {
  user_id: string;
  user_email: string;
  total_duration_seconds: number;
  session_count: number;
  user_type: 'admin' | 'client_portal';
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Authentication error: Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userEmail = claimsData.claims.email as string | undefined;

    if (!userEmail || userEmail !== PLATFORM_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "Unauthorized: Platform admin access only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // If days is 0, null, or not provided, fetch ALL TIME
    const days = body?.days;
    const isAllTime = !days || days === 0;
    
    const startIso = isAllTime 
      ? new Date('2020-01-01').toISOString() // Far back date for "all time"
      : new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();

    // IMPORTANT:
    // PostgREST has a default max of 1000 rows per request.
    // We must paginate and aggregate server-side.
    const pageSize = 1000;
    const maxPages = 100; // safety cap (100k sessions)

    // === ADMIN USER SESSIONS ===
    const adminStats: Record<string, UserStat> = {};
    let adminTotalDuration = 0;
    let adminTotalSessions = 0;

    for (let page = 0; page < maxPages; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabaseAdmin
        .from("user_sessions")
        .select("user_id, user_email, duration_seconds")
        .gte("session_start", startIso)
        .gt("duration_seconds", 0) // Exclude ghost/duplicate 0-duration sessions
        .order("session_start", { ascending: false })
        // Unique tiebreaker required for deterministic .range() paging. Do not remove.
        .order("id", { ascending: true })
        .range(from, to);


      if (error) throw error;

      const rows = (data ?? []) as SessionRow[];
      if (rows.length === 0) break;

      for (const row of rows) {
        const userId = row.user_id ?? "__unknown__";
        const email = row.user_email ?? "Unknown";
        const duration = row.duration_seconds ?? 0;

        adminTotalDuration += duration;
        adminTotalSessions++;

        if (!adminStats[userId]) {
          adminStats[userId] = {
            user_id: userId,
            user_email: email,
            total_duration_seconds: 0,
            session_count: 0,
            user_type: 'admin',
          };
        }

        adminStats[userId].total_duration_seconds += duration;
        adminStats[userId].session_count++;

        // Preserve the first non-unknown email we see
        if (adminStats[userId].user_email === "Unknown" && email !== "Unknown") {
          adminStats[userId].user_email = email;
        }
      }

      if (rows.length < pageSize) break;
    }

    // === CLIENT PORTAL SESSIONS ===
    const clientStats: Record<string, UserStat> = {};
    let clientTotalDuration = 0;
    let clientTotalSessions = 0;

    for (let page = 0; page < maxPages; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabaseAdmin
        .from("client_portal_sessions")
        .select("client_user_id, customer_email, duration_seconds")
        .gte("session_start", startIso)
        .gt("duration_seconds", 0) // Exclude ghost/duplicate 0-duration sessions
        .order("session_start", { ascending: false })
        // Unique tiebreaker required for deterministic .range() paging. Do not remove.
        .order("id", { ascending: true })
        .range(from, to);


      if (error) throw error;

      const rows = (data ?? []) as ClientPortalSessionRow[];
      if (rows.length === 0) break;

      for (const row of rows) {
        const userId = row.client_user_id ?? "__unknown__";
        const email = row.customer_email ?? "Unknown";
        const duration = row.duration_seconds ?? 0;

        clientTotalDuration += duration;
        clientTotalSessions++;

        if (!clientStats[userId]) {
          clientStats[userId] = {
            user_id: userId,
            user_email: email,
            total_duration_seconds: 0,
            session_count: 0,
            user_type: 'client_portal',
          };
        }

        clientStats[userId].total_duration_seconds += duration;
        clientStats[userId].session_count++;

        // Preserve the first non-unknown email we see
        if (clientStats[userId].user_email === "Unknown" && email !== "Unknown") {
          clientStats[userId].user_email = email;
        }
      }

      if (rows.length < pageSize) break;
    }

    // === COMBINED STATS ===
    const totalDuration = adminTotalDuration + clientTotalDuration;
    const totalSessions = adminTotalSessions + clientTotalSessions;
    const avgSessionDuration = totalSessions > 0 ? Math.floor(totalDuration / totalSessions) : 0;
    
    // Combined user list sorted by time spent
    const adminList = Object.values(adminStats);
    const clientList = Object.values(clientStats);
    const combinedList = [...adminList, ...clientList].sort(
      (a, b) => b.total_duration_seconds - a.total_duration_seconds
    );

    return new Response(
      JSON.stringify({
        avgSessionDuration,
        totalSessions,
        userList: combinedList,
        // Separate stats for filtering in UI
        adminStats: {
          totalSessions: adminTotalSessions,
          totalDuration: adminTotalDuration,
          avgDuration: adminTotalSessions > 0 ? Math.floor(adminTotalDuration / adminTotalSessions) : 0,
          userCount: adminList.length,
        },
        clientPortalStats: {
          totalSessions: clientTotalSessions,
          totalDuration: clientTotalDuration,
          avgDuration: clientTotalSessions > 0 ? Math.floor(clientTotalDuration / clientTotalSessions) : 0,
          userCount: clientList.length,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
