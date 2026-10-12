// Simple sliding-window rate limiter backed by public.abuse_throttle.
//
// Usage in an edge function:
//
//   const blocked = await checkAndRecord(supabase, "password_reset",
//     `email:${email}`, { maxPerWindow: 3, windowSeconds: 600 });
//   if (blocked) {
//     // Return a generic "if an account exists..." response so we
//     // don't tell attackers whether the email is real OR whether
//     // they tripped the rate limit. Failing closed silently is the
//     // safest UX here.
//     return jsonOk({ success: true, message: "If an account exists, we'll reach out." });
//   }
//
// Composite key example for stricter scopes:
//   `email:${email}|ip:${getClientIp(req)}`

export interface RateLimitOptions {
  /** How many calls allowed inside the window before blocking. */
  maxPerWindow: number;
  /** Window size in seconds. */
  windowSeconds: number;
}

/**
 * Looks up recent throttle rows for the given bucket. If the count is
 * already at/over the max, returns true (BLOCKED). Otherwise records a
 * fresh row and returns false (ALLOWED).
 *
 * A database error used to fail open, which let a caller who could induce
 * a throttle-table error skip the limit entirely. On a DB error we now
 * count the attempt in an in-isolate window with the same budget. Callers
 * still get through during a short blip, up to maxPerWindow, and further
 * attempts are blocked. `error` is set so the caller can log the failure.
 */
const memoryBuckets = new Map<string, number[]>();

function memoryAllows(bucket: string, options: RateLimitOptions): { blocked: boolean; count: number } {
  const now = Date.now();
  const cutoff = now - options.windowSeconds * 1000;
  const prev = (memoryBuckets.get(bucket) ?? []).filter((ts) => ts > cutoff);
  if (prev.length >= options.maxPerWindow) {
    memoryBuckets.set(bucket, prev);
    return { blocked: true, count: prev.length };
  }
  prev.push(now);
  memoryBuckets.set(bucket, prev);
  if (memoryBuckets.size > 5000) {
    const oldest = memoryBuckets.keys().next().value;
    if (oldest) memoryBuckets.delete(oldest);
  }
  return { blocked: false, count: prev.length };
}

export async function checkAndRecord(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  action: string,
  identifier: string,
  options: RateLimitOptions,
): Promise<{ blocked: boolean; count: number; error?: string }> {
  const bucket = `${action}:${identifier}`;
  const since = new Date(Date.now() - options.windowSeconds * 1000).toISOString();

  try {
    const { count, error: countErr } = await supabase
      .from("abuse_throttle")
      .select("*", { count: "exact", head: true })
      .eq("bucket", bucket)
      .gte("created_at", since);

    if (countErr) {
      console.error(`[rate-limit] count failed for ${bucket}:`, countErr.message);
      const mem = memoryAllows(bucket, options);
      return { blocked: mem.blocked, count: mem.count, error: countErr.message };
    }

    const seen = count ?? 0;
    if (seen >= options.maxPerWindow) {
      return { blocked: true, count: seen };
    }

    const { error: insertErr } = await supabase
      .from("abuse_throttle")
      .insert({ bucket, action });
    if (insertErr) {
      console.error(`[rate-limit] insert failed for ${bucket}:`, insertErr.message);
      // The count check passed, but the row did not land. Remember the
      // attempt in memory so a stuck insert cannot be retried without limit.
      const mem = memoryAllows(bucket, options);
      return { blocked: mem.blocked, count: Math.max(seen, mem.count), error: insertErr.message };
    }

    return { blocked: false, count: seen + 1 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[rate-limit] unexpected error for ${bucket}:`, msg);
    const mem = memoryAllows(bucket, options);
    return { blocked: mem.blocked, count: mem.count, error: msg };
  }
}

/**
 * Client IP for rate-limit keys.
 *
 * The left-most X-Forwarded-For value is chosen by the caller, so it is
 * not a limit key. Prefer the platform-set connecting IP. If that header
 * is absent, use the right-most X-Forwarded-For entry (the hop the edge
 * appended) rather than the spoofable left-most one.
 */
export function getClientIp(req: Request): string {
  const connecting = req.headers.get("cf-connecting-ip")?.trim();
  if (connecting) return connecting;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}
