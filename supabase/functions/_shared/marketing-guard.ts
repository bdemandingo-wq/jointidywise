/**
 * marketing-guard.ts — single source of truth for "may we send this person marketing?"
 *
 * FAIL CLOSED. TCPA damages are statutory and per-message. Skipping a send we
 * should have made is a support ticket. Making a send we should have skipped is
 * a legal exposure. When the database will not answer, we do not send.
 *
 * Always scope by organization_id — never look a customer up by id alone.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { phoneMatchKey, toE164 } from "./phone.ts";

const OPTED_OUT = "opted_out";
const SMS_STOP_METHOD = "sms_stop";

/**
 * Returns true when the customer is opted out of marketing for this org.
 * Returns TRUE on any lookup error (fail closed).
 */
export async function isOptedOut(
  supabase: SupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("customers")
      .select("id, marketing_status")
      .eq("organization_id", organizationId)
      .eq("id", customerId)
      .maybeSingle();

    if (error) {
      console.error(
        `[marketing-guard] isOptedOut lookup failed — failing closed | org:${organizationId} customer:${customerId} | ${error.message}`,
      );
      return true;
    }

    if (!data) {
      console.error(
        `[marketing-guard] isOptedOut found no customer in org — failing closed | org:${organizationId} customer:${customerId}`,
      );
      return true;
    }

    return data.marketing_status === OPTED_OUT;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[marketing-guard] isOptedOut threw — failing closed | org:${organizationId} customer:${customerId} | ${message}`,
    );
    return true;
  }
}

/**
 * Batch version: one query for the whole list. Returns only customers that are
 * NOT opted out, preserving input order. Returns an EMPTY array on any error.
 */
export async function filterOptedIn<T extends { id: string }>(
  supabase: SupabaseClient,
  organizationId: string,
  customers: T[],
): Promise<T[]> {
  if (!customers || customers.length === 0) return [];

  try {
    const ids = [...new Set(customers.map((c) => c.id))];

    const { data, error } = await supabase
      .from("customers")
      .select("id, marketing_status")
      .eq("organization_id", organizationId)
      .in("id", ids);

    if (error) {
      console.error(
        `[marketing-guard] filterOptedIn lookup failed — failing closed (0 recipients) | org:${organizationId} | ${error.message}`,
      );
      return [];
    }

    const statusById = new Map<string, string | null>(
      (data ?? []).map((row: { id: string; marketing_status: string | null }) => [
        row.id,
        row.marketing_status,
      ]),
    );

    // Customers missing from the org-scoped result are excluded (fail closed).
    return customers.filter(
      (c) => statusById.has(c.id) && statusById.get(c.id) !== OPTED_OUT,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[marketing-guard] filterOptedIn threw — failing closed (0 recipients) | org:${organizationId} | ${message}`,
    );
    return [];
  }
}

type CustomerPhoneRow = {
  id: string;
  phone: string | null;
  marketing_status: string | null;
  opted_out_method: string | null;
};

/**
 * Stored customer phones are not always E.164. These are the forms a US number
 * is written as, so one indexed filter can find the row without reading every
 * phone in the org. The sms_suppressions lookup stays an exact E.164 match on
 * (organization_id, phone).
 */
export function phoneLookupCandidates(raw: string | null | undefined): string[] {
  const key = phoneMatchKey(raw);
  if (!key) return [];
  const area = key.slice(0, 3);
  const prefix = key.slice(3, 6);
  const line = key.slice(6);
  const dashed = `${area}-${prefix}-${line}`;
  const pretty = `(${area}) ${prefix}-${line}`;
  const values = [
    raw?.trim() ?? "",
    toE164(raw) ?? "",
    key,
    `1${key}`,
    `+1${key}`,
    pretty,
    `(${area})${prefix}-${line}`,
    `(${area}) ${prefix} ${line}`,
    dashed,
    `${area}.${prefix}.${line}`,
    `${area} ${prefix} ${line}`,
    `+1 ${pretty}`,
    `+1 ${dashed}`,
    `+1 ${area} ${prefix} ${line}`,
    `1-${dashed}`,
    `1 ${pretty}`,
  ];
  return [...new Set(values.filter((value) => value.length > 0))];
}

async function loadCustomersForPhone(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
): Promise<CustomerPhoneRow[]> {
  const candidates = phoneLookupCandidates(phone);
  if (candidates.length === 0) return [];
  const { data, error } = await supabase
    .from("customers")
    .select("id, phone, marketing_status, opted_out_method")
    .eq("organization_id", organizationId)
    .in("phone", candidates);
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerPhoneRow[];
}

function isSmsStop(row: { marketing_status: string | null; opted_out_method: string | null }): boolean {
  return row.marketing_status === OPTED_OUT && row.opted_out_method === SMS_STOP_METHOD;
}

export type PhoneOptOutStatus = "opted_out" | "clear" | "lookup_failed" | "invalid_phone";

/**
 * Opt-out for one org and phone. A text is blocked only by an SMS STOP:
 * - a row in sms_suppressions for this org and the E.164 number (indexed on
 *   organization_id, phone), including leads and cleaners with no customer row
 * - a customer in this org whose stored phone is that number and whose
 *   marketing_status is opted_out with opted_out_method sms_stop
 * An email unsubscribe or an admin bulk opt-out (method manual) does not block
 * texts. No matching row is clear. A lookup error is lookup_failed so the
 * sender does not text and does not call it an opt-out.
 */
export async function phoneOptOutStatus(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string | null | undefined,
): Promise<PhoneOptOutStatus> {
  const target = phoneMatchKey(phone);
  if (!target) return "invalid_phone";

  try {
    const e164 = toE164(phone);
    if (e164) {
      const suppressed = await supabase
        .from("sms_suppressions")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("phone", e164)
        .maybeSingle();
      if (suppressed.error) {
        throw new Error(suppressed.error.message ?? "sms_suppressions lookup failed");
      }
      if (suppressed.data) return "opted_out";
    }

    const rows = await loadCustomersForPhone(supabase, organizationId, phone ?? "");
    if (rows.some(isSmsStop)) return "opted_out";
    return "clear";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[marketing-guard] isPhoneOptedOut lookup failed — failing closed | org:${organizationId} | ${message}`,
    );
    return "lookup_failed";
  }
}

/**
 * Phone-based opt-out check for paths with no customer_id (abandoned bookings,
 * STOP webhook fallback). Matches on the last 10 digits, digits only.
 *
 * Returns TRUE (do not send) on any error, on a null/unusable phone, and when
 * this number has an SMS STOP (a suppression row, or a customer opted out by
 * texting STOP). An email unsubscribe or admin opt-out does not count.
 */
export async function isPhoneOptedOut(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string | null | undefined,
): Promise<boolean> {
  const status = await phoneOptOutStatus(supabase, organizationId, phone);
  if (status === "invalid_phone") {
    console.error(
      `[marketing-guard] isPhoneOptedOut got an unusable phone — failing closed | org:${organizationId}`,
    );
    return true;
  }
  return status !== "clear";
}

/**
 * Customer ids in this org whose stored phone is this number. Looks the number
 * up by its stored forms. Does not read the rest of the org. Empty on error.
 */
export async function findCustomerIdsByPhone(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string | null | undefined,
): Promise<string[]> {
  if (!phoneMatchKey(phone)) return [];
  try {
    const rows = await loadCustomersForPhone(supabase, organizationId, phone ?? "");
    return rows.map((row) => row.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[marketing-guard] findCustomerIdsByPhone lookup failed | org:${organizationId} | ${message}`,
    );
    return [];
  }
}

/**
 * Resolves a phone number to a customer id within the org. Returns null on
 * error or when nothing matches. When several records share the number, an
 * SMS STOP row is preferred so callers acting on a STOP request update the
 * record that already reflects it.
 */
export async function findCustomerIdByPhone(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string | null | undefined,
): Promise<string | null> {
  if (!phoneMatchKey(phone)) return null;

  try {
    const rows = await loadCustomersForPhone(supabase, organizationId, phone ?? "");
    if (rows.length === 0) return null;
    const smsStop = rows.find(isSmsStop);
    return (smsStop ?? rows[0]).id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[marketing-guard] findCustomerIdByPhone lookup failed | org:${organizationId} | ${message}`,
    );
    return null;
  }
}

/**
 * Email counterpart of isPhoneOptedOut. Same contract: org-scoped, fail closed.
 *
 * Returns TRUE (do not send) on any error or unusable address, and when ANY
 * customer in the org with that address is opted out. Returns FALSE when no
 * customer in the org has that address — recipients who are not customers
 * (owners, staff, leads) have nothing to opt out of here.
 */
export async function isEmailOptedOut(
  supabase: SupabaseClient,
  organizationId: string,
  email: string | null | undefined,
): Promise<boolean> {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr || !addr.includes("@")) {
    console.error(
      `[marketing-guard] isEmailOptedOut got an unusable address — failing closed | org:${organizationId}`,
    );
    return true;
  }

  try {
    const { data, error } = await supabase
      .from("customers")
      .select("id, marketing_status")
      .eq("organization_id", organizationId)
      .ilike("email", addr);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{ marketing_status: string | null }>;
    if (rows.length === 0) return false;
    return rows.some((r) => r.marketing_status === OPTED_OUT);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[marketing-guard] isEmailOptedOut lookup failed — failing closed | org:${organizationId} | ${message}`,
    );
    return true;
  }
}

