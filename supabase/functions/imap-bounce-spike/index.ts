// THROWAWAY SPIKE: can an edge function reach imap.gmail.com:993 over raw TLS
// and read a mailer-daemon bounce using the org's existing SMTP app password?
// Read-only: no STORE, no flags, no deletes, no sends.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { getOrgEmailSettings } from "../_shared/get-org-email-settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const gate = requireCronSecret(req);
  if (gate) return gate;

  const result: Record<string, unknown> = {
    imap_connected: false,
    auth_ok: false,
    mailer_daemon_count: 0,
    sample_extracted_message_id: null,
    error: null,
  };

  const json = (status = 200) =>
    new Response(JSON.stringify(result), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let imap: Imap | null = null;
  try {
    const { organization_id } = await req.json().catch(() => ({}));
    if (!organization_id) throw new Error("Missing organization_id");

    const s = await getOrgEmailSettings(organization_id);
    if (!s.success || !s.settings) throw new Error(s.error || "No email settings");
    const { smtp_email, smtp_app_password } = s.settings;
    if (!smtp_email || !smtp_app_password) throw new Error("Org has no Gmail SMTP credentials configured");

    imap = new Imap();
    await imap.connect();
    result.imap_connected = true;

    const q = (v: string) => `"${v.replace(/(["\\])/g, "\\$1")}"`;
    await imap.cmd(`LOGIN ${q(smtp_email)} ${q(smtp_app_password)}`);
    result.auth_ok = true;

    await imap.cmd("SELECT INBOX");

    const search = await imap.cmd('SEARCH FROM "mailer-daemon@googlemail.com"');
    const line = search.split("\n").find((l) => l.startsWith("* SEARCH")) ?? "";
    const ids = line.replace("* SEARCH", "").trim().split(/\s+/).filter(Boolean);
    result.mailer_daemon_count = ids.length;

    if (ids.length > 0) {
      const newest = ids[ids.length - 1];
      // BODY.PEEK does not set \Seen — keeps this read-only.
      const body = await imap.cmd(`FETCH ${newest} (BODY.PEEK[])`);
      const m = body.match(/<tw-[0-9a-f-]{36}@[^>]+>/i);
      result.sample_extracted_message_id = m ? m[0] : null;
    }

    await imap.cmd("LOGOUT").catch(() => {});
    return json();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    console.error("[imap-bounce-spike]", result.error);
    return json(200);
  } finally {
    imap?.close();
  }
});
