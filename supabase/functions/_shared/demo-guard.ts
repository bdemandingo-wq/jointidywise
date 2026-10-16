/**
 * Classifies an organization with the same rules as public.is_demo_or_test.
 * A lookup failure is treated as demo and is not cached, so the next send
 * tries again. The preview org id and sample recipients still block with
 * no database call.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  DEMO_FLAG_TTL_MS,
  DEMO_ORG_ID,
  demoFlagCacheDecision,
  demoFlagCacheFresh,
  demoSendBlockReason,
  isDemoOrTest,
  isKnownDemoOrganization,
  type StripeSubscriptionSnapshot,
} from "./demo-org.ts";

type Row = Record<string, unknown>;
type QueryError = { message?: string } | null;
type SingleResult = { data: Row | null; error: QueryError };
type ListResult = { data: Row[] | null; error: QueryError };

type Filter = PromiseLike<ListResult> & {
  maybeSingle: () => Promise<SingleResult>;
};

export type DemoLookup = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string | boolean) => Filter;
    };
  };
};

type CachedFlag = { at: number; value: boolean };

const cache = new Map<string, CachedFlag>();

function serviceClient(): DemoLookup | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as DemoLookup;
}

function asRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((row): row is Row => !!row && typeof row === "object");
  return [];
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function loadDemoSnapshot(client: DemoLookup, organizationId: string) {
  const [settingsRes, orgRes, subsRes] = await Promise.all([
    client.from("organization_pricing_settings").select("demo_mode_enabled").eq("organization_id", organizationId).maybeSingle(),
    client.from("organizations").select("name, slug, owner_id").eq("id", organizationId).maybeSingle(),
    client.from("stripe_subscriptions").select("status, plan").eq("organization_id", organizationId),
  ]);
  if (settingsRes.error || orgRes.error || subsRes.error) {
    throw new Error(settingsRes.error?.message || orgRes.error?.message || subsRes.error?.message || "demo lookup failed");
  }
  let ownerEmail: string | null = null;
  const ownerId = text(orgRes.data?.owner_id);
  if (ownerId) {
    const profile = await client.from("profiles").select("email").eq("id", ownerId).maybeSingle();
    if (profile.error) throw new Error(profile.error.message || "demo lookup failed");
    ownerEmail = text(profile.data?.email);
  }
  const subscriptions: StripeSubscriptionSnapshot[] = asRows(subsRes.data).map((row) => ({
    status: text(row.status),
    plan: text(row.plan),
  }));
  return {
    organizationId,
    demoModeEnabled: settingsRes.data?.demo_mode_enabled === true,
    name: text(orgRes.data?.name),
    slug: text(orgRes.data?.slug),
    ownerEmail,
    subscriptions,
  };
}

export async function demoModeEnabledForOrg(
  supabase: DemoLookup | null | undefined,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!organizationId) return false;
  if (isKnownDemoOrganization(organizationId)) return true;
  const cached = cache.get(organizationId);
  if (cached && demoFlagCacheFresh(cached.at, Date.now(), DEMO_FLAG_TTL_MS)) return cached.value;
  const client = supabase ?? serviceClient();
  if (!client) {
    console.error("[demo-guard] flag lookup failed", organizationId, "no service client");
    return demoFlagCacheDecision({ ok: false }).value;
  }
  try {
    const snapshot = await loadDemoSnapshot(client, organizationId);
    const decision = demoFlagCacheDecision({ ok: true, value: isDemoOrTest(snapshot) });
    if (decision.store) cache.set(organizationId, { at: Date.now(), value: decision.value });
    return decision.value;
  } catch (err) {
    console.error("[demo-guard] flag lookup failed", organizationId, err);
    const failed = demoFlagCacheDecision({ ok: false });
    return failed.value;
  }
}

type OrgIdQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: boolean) => Promise<{
        data: { organization_id?: string | null }[] | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

/** Orgs whose demo flag is on, plus the public preview id. */
export async function listDemoModeOrgIds(supabase: OrgIdQuery): Promise<string[]> {
  const ids = new Set<string>([DEMO_ORG_ID]);
  try {
    const { data, error } = await supabase
      .from("organization_pricing_settings")
      .select("organization_id")
      .eq("demo_mode_enabled", true);
    if (error) {
      console.error("[demo-guard] demo org list failed", error.message ?? error);
      return [...ids];
    }
    for (const row of data ?? []) {
      if (row.organization_id) ids.add(row.organization_id);
    }
  } catch (err) {
    console.error("[demo-guard] demo org list threw", err);
  }
  return [...ids];
}

export { DemoSendBlocked } from "./demo-org.ts";

/** Returns the skip reason, already logged, or null when the send may proceed. */
export async function demoSendShouldSkip(input: {
  channel: string;
  organizationId?: string | null;
  recipients?: Array<string | null | undefined>;
  supabase?: DemoLookup | null;
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
