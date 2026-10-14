/**
 * Looks up organization_pricing_settings.demo_mode_enabled and logs a skip.
 * Lookup failures stay open so a settings outage does not stop every real
 * send. The known preview org id and sample recipients still block with no
 * database call.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  DEMO_FLAG_TTL_MS,
  demoFlagCacheFresh,
  demoSendBlockReason,
  isKnownDemoOrganization,
} from "./demo-org.ts";

type Lookup = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: { demo_mode_enabled?: boolean | null } | null; error: { message?: string } | null }>;
      };
    };
  };
};

type CachedFlag = { at: number; value: Promise<boolean> };

const cache = new Map<string, CachedFlag>();

function serviceClient(): Lookup | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as Lookup;
}

export async function demoModeEnabledForOrg(
  supabase: Lookup | null | undefined,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!organizationId) return false;
  if (isKnownDemoOrganization(organizationId)) return true;
  const cached = cache.get(organizationId);
  if (cached && demoFlagCacheFresh(cached.at, Date.now(), DEMO_FLAG_TTL_MS)) return cached.value;
  const pending = (async () => {
    const client = supabase ?? serviceClient();
    if (!client) return false;
    try {
      const { data, error } = await client
        .from("organization_pricing_settings")
        .select("demo_mode_enabled")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) {
        console.error("[demo-guard] flag lookup failed", organizationId, error.message ?? error);
        return false;
      }
      return data?.demo_mode_enabled === true;
    } catch (err) {
      console.error("[demo-guard] flag lookup threw", err);
      return false;
    }
  })();
  cache.set(organizationId, { at: Date.now(), value: pending });
  return pending;
}

export class DemoSendBlocked extends Error {
  readonly channel: string;
  constructor(channel: string) {
    super("Disabled in demo mode");
    this.name = "DemoSendBlocked";
    this.channel = channel;
  }
}

/** Returns the skip reason, already logged, or null when the send may proceed. */
export async function demoSendShouldSkip(input: {
  channel: string;
  organizationId?: string | null;
  recipients?: Array<string | null | undefined>;
  supabase?: Lookup | null;
  /** A reply the recipient just requested, such as a STOP confirmation. */
  requestedReply?: boolean;
}): Promise<string | null> {
  if (input.requestedReply) return null;
  const demoModeEnabled = input.organizationId
    ? await demoModeEnabledForOrg(input.supabase ?? null, input.organizationId)
    : false;
  const reason = demoSendBlockReason({
    organizationId: input.organizationId,
    demoModeEnabled,
    recipients: input.recipients,
    requestedReply: input.requestedReply,
  });
  if (reason) {
    console.log(`[demo-block] skipped ${input.channel} reason=${reason} org=${input.organizationId ?? "none"}`);
  }
  return reason;
}

export function recipientsFromJsonBody(body: BodyInit | null | undefined): string[] {
  if (typeof body !== "string") return [];
  try {
    const parsed = JSON.parse(body) as { to?: unknown; cc?: unknown; bcc?: unknown };
    return [...list(parsed.to), ...list(parsed.cc), ...list(parsed.bcc)];
  } catch {
    return [];
  }
}

function list(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}
