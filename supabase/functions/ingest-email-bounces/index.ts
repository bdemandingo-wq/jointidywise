// Bounce ingestion: scans each gmail_smtp org's inbox over IMAP for
// mailer-daemon DSNs, extracts the stamped <tw-...> Message-ID and records
// bounce state on email_send_log. Read-only against the mailbox (BODY.PEEK).
//
// NOTE: never flips email_send_log.status to 'bounced' — a partial unique index
// on message_id WHERE status='sent' depends on that row keeping 'sent'.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_PER_ORG = 200;

class Imap {
  private conn!: Deno.TlsConn;
  private buf = "";
  private dec = new TextDecoder();
  private enc = new TextEncoder();
  private tag = 0;

  async connect() {
    this.conn = await Deno.connectTls({ hostname: "imap.gmail.com", port: 993 });
    await this.readUntil((l) => l.startsWith("* OK"));
  }

  private async readUntil(done: (line: string) => boolean, timeoutMs = 20000): Promise<string> {
    const start = Date.now();
    const chunk = new Uint8Array(65536);
    let out = "";
    for (;;) {
      const idx = this.buf.indexOf("\r\n");
      if (idx >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 2);
        out += line + "\n";
        if (done(line)) return out;
        continue;
      }
      if (Date.now() - start > timeoutMs) throw new Error("IMAP read timeout");
      const n = await this.conn.read(chunk);
      if (n === null) throw new Error("IMAP connection closed");
      this.buf += this.dec.decode(chunk.subarray(0, n));
    }
  }

  async cmd(command: string): Promise<string> {
    const tag = `a${++this.tag}`;
    await this.conn.write(this.enc.encode(`${tag} ${command}\r\n`));
    const res = await this.readUntil((l) => l.startsWith(`${tag} `));
    const last = res.trimEnd().split("\n").pop() ?? "";
    if (!last.startsWith(`${tag} OK`)) throw new Error(last.replace(new RegExp(`^${tag} `), ""));
    return res;
  }

  close() {
    try { this.conn.close(); } catch { /* ignore */ }
  }
}

function classify(body: string): { type: "hard" | "soft" | "unknown"; detail: string } {
  const status = body.match(/Status:\s*([245])\.\d{1,3}\.\d{1,3}/i) ??
    body.match(/\b([45])\.\d{1,3}\.\d{1,3}\b/);
  const first = status?.[1];
  const type = first === "5" ? "hard" : first === "4" ? "soft" : "unknown";

  const reason =
    body.match(/Diagnostic-Code:[^\r\n]*(?:\r?\n[ \t][^\r\n]*)*/i)?.[0] ??
    body.match(/Status:[^\r\n]*/i)?.[0] ??
    body.slice(0, 500);

  return { type, detail: reason.replace(/\s+/g, " ").trim().slice(0, 500) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const gate = requireCronSecret(req);
  if (gate) return gate;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: unknown[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const onlyOrg: string | undefined = body?.organization_id;

    let q = supabase
      .from("organization_email_settings")
      .select("organization_id, smtp_email, smtp_app_password, email_send_method")
      .eq("email_send_method", "gmail_smtp")
      .not("smtp_email", "is", null)
      .not("smtp_app_password", "is", null)
      .order("organization_id");
    if (onlyOrg) q = q.eq("organization_id", onlyOrg);

    const { data: orgs, error: orgErr } = await q;
    if (orgErr) throw orgErr;

    for (const org of orgs ?? []) {
      const orgId = org.organization_id as string;
      const stat = {
        org_id: orgId,
        scanned: 0,
        matched: 0,
        unmatched: 0,
        by_type: { hard: 0, soft: 0, unknown: 0 } as Record<string, number>,
        error: null as string | null,
      };
      let imap: Imap | null = null;
      try {
        const { data: cursor } = await supabase
          .from("email_bounce_cursor")
          .select("last_uid")
          .eq("organization_id", orgId)
          .maybeSingle();
        const lastUid = Number(cursor?.last_uid ?? 0);

        imap = new Imap();
        await imap.connect();
        const qs = (v: string) => `"${v.replace(/(["\\])/g, "\\$1")}"`;
        await imap.cmd(`LOGIN ${qs(org.smtp_email as string)} ${qs(org.smtp_app_password as string)}`);
        await imap.cmd("SELECT INBOX");

        const search = await imap.cmd(
          `UID SEARCH UID ${lastUid + 1}:* FROM "mailer-daemon@googlemail.com"`,
        );
        const line = search.split("\n").find((l) => l.startsWith("* SEARCH")) ?? "";
        const uids = line
          .replace("* SEARCH", "")
          .trim()
          .split(/\s+/)
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n) && n > lastUid)
          .sort((a, b) => a - b)
          .slice(0, MAX_PER_ORG);

        let highest = lastUid;
        for (const uid of uids) {
          // BODY.PEEK keeps this read-only (no \Seen flag set).
          const msg = await imap.cmd(`UID FETCH ${uid} (BODY.PEEK[])`);
          stat.scanned++;
          highest = Math.max(highest, uid);

          const m = msg.match(/<tw-[0-9a-f-]{36}@[^>]+>/i);
          if (!m) { stat.unmatched++; continue; }

          const { type, detail } = classify(msg);
          const { data: updated, error: upErr } = await supabase
            .from("email_send_log")
            .update({ bounced_at: new Date().toISOString(), bounce_type: type, bounce_detail: detail })
            .eq("message_id", m[0])
            .eq("organization_id", orgId)
            .select("id, recipient_email");
          if (upErr) throw upErr;

          if (updated && updated.length > 0) {
            stat.matched++;
            stat.by_type[type] = (stat.by_type[type] ?? 0) + 1;

            // Only hard bounces suppress. Soft/unknown are transient or
            // unclassifiable and must never block future sends.
            if (type === "hard") {
              for (const row of updated) {
                const addr = String(row.recipient_email ?? "").trim().toLowerCase();
                if (!addr || addr === "unknown") continue;
                const { data: existing } = await supabase
                  .from("email_suppressions")
                  .select("bounce_count")
                  .eq("organization_id", orgId)
                  .eq("email", addr)
                  .maybeSingle();
                const { error: supErr } = await supabase
                  .from("email_suppressions")
                  .upsert(
                    {
                      organization_id: orgId,
                      email: addr,
                      reason: "hard_bounce",
                      bounce_count: (Number(existing?.bounce_count) || 0) + 1,
                      last_bounce_detail: detail,
                    },
                    { onConflict: "organization_id,email" },
                  );
                if (supErr) {
                  console.error(`[ingest-email-bounces] suppression upsert failed org ${orgId}:`, supErr.message);
                }
              }
            }
          } else {
            stat.unmatched++;
          }

        }

        await imap.cmd("LOGOUT").catch(() => {});

        if (highest > lastUid) {
          const { error: curErr } = await supabase
            .from("email_bounce_cursor")
            .upsert(
              { organization_id: orgId, last_uid: highest, updated_at: new Date().toISOString() },
              { onConflict: "organization_id" },
            );
          if (curErr) throw curErr;
        }
      } catch (e) {
        stat.error = e instanceof Error ? e.message : String(e);
        console.error(`[ingest-email-bounces] org ${orgId}:`, stat.error);
      } finally {
        imap?.close();
      }
      results.push(stat);
    }

    return new Response(JSON.stringify({ orgs: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest-email-bounces]", msg);
    return new Response(JSON.stringify({ error: msg, orgs: results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
