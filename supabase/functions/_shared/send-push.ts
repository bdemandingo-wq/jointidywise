/**
 * Fire-and-forget push to devices in an org.
 *
 * audience "operators" goes to owner/admin/manager devices only. That is
 * what cleaner-initiated job events use: the push function itself rejects
 * a cleaner's JWT, so this helper calls it with the service role key.
 * audience "org" is the previous broadcast (every registered device).
 */
export async function sendPushToOrg(
  organizationId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  opts?: { audience?: "org" | "operators" },
): Promise<{ sent: number }> {
  try {
    const { demoSendShouldSkip } = await import("./demo-guard.ts");
    const reason = await demoSendShouldSkip({ channel: "push", organizationId });
    if (reason) return { sent: 0 };
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return { sent: 0 };

    const res = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        organization_id: organizationId,
        title,
        body,
        data,
        audience: opts?.audience ?? "org",
      }),
    });
    const json = await res.json().catch(() => ({}));
    return { sent: Number((json as { sent?: number }).sent ?? 0) };
  } catch (err) {
    console.error("[send-push] helper error:", err);
    return { sent: 0 };
  }
}
