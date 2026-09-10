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
import { phoneMatchKey } from "./phone.ts";

const OPTED_OUT = "opted_out";

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

type PhoneRow = { id: string; phone: string | null; marketing_status: string | null };

/**
 * Loads the org's customers that have a phone number. Throws on error so
 * callers can fail closed. Paged with a unique tiebreaker.
 */
async function loadOrgPhoneRows(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<PhoneRow[]> {
  const pageSize = 1000;
  const rows: PhoneRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, phone, marketing_status")
      .eq("organization_id", organizationId)
      .not("phone", "is", null)
      .order("id")
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (error) throw new Error(error.message);
    const batch = (data ?? []) as PhoneRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

/**
 * Phone-based opt-out check for paths with no customer_id (abandoned bookings,
 * STOP webhook fallback). Matches on the last 10 digits, digits only.
 *
 * Returns TRUE (do not send) on any error, on a null/unusable phone, and when
 * ANY customer in the org sharing that number is opted out.
 */
export async function isPhoneOptedOut(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string | null | undefined,
): Promise<boolean> {
  const target = phoneMatchKey(phone);
  if (!target) {
    console.error(
      `[marketing-guard] isPhoneOptedOut got an unusable phone — failing closed | org:${organizationId}`,
    );
    return true;
  }

  try {
    const rows = await loadOrgPhoneRows(supabase, organizationId);
    const matches = rows.filter((r) => phoneMatchKey(r.phone) === target);
    // No matching customer record: nothing says this person opted out.
    if (matches.length === 0) return false;
    // Any single opt-out among duplicates is enough.
    return matches.some((r) => r.marketing_status === OPTED_OUT);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[marketing-guard] isPhoneOptedOut lookup failed — failing closed | org:${organizationId} | ${message}`,
    );
    return true;
  }
}

/**
 * Resolves a phone number to a customer id within the org, matching on the
 * last 10 digits. Returns null on error or when nothing matches. When several
 * records share the number, an opted-out one is preferred so callers acting on
 * a STOP request update the record that already reflects it.
 */
export async function findCustomerIdByPhone(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string | null | undefined,
): Promise<string | null> {
  const target = phoneMatchKey(phone);
  if (!target) return null;

  try {
    const rows = await loadOrgPhoneRows(supabase, organizationId);
    const matches = rows.filter((r) => phoneMatchKey(r.phone) === target);
    if (matches.length === 0) return null;
    const optedOut = matches.find((r) => r.marketing_status === OPTED_OUT);
    return (optedOut ?? matches[0]).id;
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

