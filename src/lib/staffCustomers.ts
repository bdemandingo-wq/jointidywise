import { supabase } from '@/integrations/supabase/client';

/**
 * Cleaner screens read customer details through the get_staff_customers RPC,
 * never by embedding `customers(...)` in a bookings query. Direct customer-row
 * access for cleaners is gated by the org's "Show customer phone to cleaners"
 * setting, so an embed would come back null when it is off. The RPC returns
 * name/email always and `phone` only when the org allows it (operators always).
 */
export interface StaffCustomer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  /** True when the customer has a number on file, even if it is hidden. */
  has_phone: boolean;
}

export async function fetchStaffCustomers(ids: (string | null | undefined)[]): Promise<Record<string, StaffCustomer>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => !!v)));
  if (unique.length === 0) return {};
  const { data, error } = await (supabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: StaffCustomer[] | null; error: unknown }>;
  }).rpc('get_staff_customers', { p_customer_ids: unique });
  if (error) throw error;
  const out: Record<string, StaffCustomer> = {};
  for (const c of data ?? []) out[c.id] = c;
  return out;
}

/** Attach `customer` to each row from its `customer_id`. */
export async function withStaffCustomers<T extends { customer_id?: string | null }>(
  rows: T[] | null | undefined,
): Promise<(T & { customer: StaffCustomer | null })[]> {
  const list = rows ?? [];
  const map = await fetchStaffCustomers(list.map((r) => r.customer_id));
  return list.map((r) => ({ ...r, customer: (r.customer_id && map[r.customer_id]) || null }));
}

export async function withStaffCustomer<T extends { customer_id?: string | null }>(
  row: T | null | undefined,
): Promise<(T & { customer: StaffCustomer | null }) | null> {
  if (!row) return null;
  const [r] = await withStaffCustomers([row]);
  return r;
}
