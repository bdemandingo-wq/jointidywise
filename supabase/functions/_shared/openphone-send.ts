/**
 * The only outbound OpenPhone message POST.
 *
 * Every customer, cleaner, and lead text goes through sendOpenPhoneMessage.
 * Before the request, the destination is normalized to E.164 and checked for
 * this organization against sms_suppressions and the customer columns
 * classifySmsOptOut / nextSmsConsent write (opted_out_method = sms_stop).
 * A match returns { skipped: true, reason: "opted_out" } and does not call
 * OpenPhone and does not throw.
 *
 * The one STOP confirmation passes allowOptedOut. START/UNSTOP clears the
 * sms_suppressions row via clearSmsSuppression; it does not send a text.
 */
import { phoneMatchKey, toE164 } from "./phone.ts";

export const OPENPHONE_MESSAGES_URL = "https://api.openphone.com/v1/messages";

/** TidyWise's own org. Platform-line alerts use this scope for the same check. */
export const TIDYWISE_PLATFORM_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";

const SMS_STOP_METHOD = "sms_stop";
const CUSTOMER_PAGE = 500;

export interface OpenPhoneHttpResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

export type OpenPhoneSendResult =
  | { skipped: true; reason: "opted_out" }
  | { skipped: false; response: OpenPhoneHttpResponse };

interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface SmsQuery {
  select(columns: string): SmsQuery;
  eq(column: string, value: string): SmsQuery;
  order(column: string, options?: { ascending: boolean }): SmsQuery;
  range?(from: number, to: number): SmsQuery;
  maybeSingle(): Promise<QueryResult>;
  then<T>(onfulfilled: (value: QueryResult) => T | PromiseLike<T>): Promise<T>;
}

export interface SmsTable {
  select(columns: string): SmsQuery;
  upsert(
    values: Record<string, unknown>,
    options?: { onConflict?: string },
  ): PromiseLike<{ error: { message?: string } | null }>;
  delete(): SmsQuery;
}

export interface SmsSuppressionDb {
  from(table: string): SmsTable;
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface SendOpenPhoneMessageInput {
  supabase: SmsSuppressionDb;
  organizationId: string;
  to: string;
  content: string;
  from: string;
  apiKey: string;
  /**
   * The single STOP confirmation. It is the only send allowed after the
   * number has already been suppressed.
   */
  allowOptedOut?: boolean;
  tag?: string;
  fetchImpl?: FetchLike;
}

function httpResult(status: number, ok: boolean, body: string): OpenPhoneHttpResponse {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function logTag(tag: string | undefined): string {
  return tag && tag.length > 0 ? tag : "openphone-send";
}

interface CustomerStopRow {
  id?: string;
  phone?: string | null;
  opted_out_method?: string | null;
}

async function listSmsStopCustomers(
  supabase: SmsSuppressionDb,
  organizationId: string,
): Promise<CustomerStopRow[] | "failed"> {
  const rows: CustomerStopRow[] = [];
  for (let offset = 0; offset < 20000; offset += CUSTOMER_PAGE) {
    let query = supabase
      .from("customers")
      .select("id, phone, opted_out_method")
      .eq("organization_id", organizationId)
      .eq("opted_out_method", SMS_STOP_METHOD)
      .order("id", { ascending: true });
    if (typeof query.range === "function") {
      query = query.range(offset, offset + CUSTOMER_PAGE - 1);
    }
    const { data, error } = await query;
    if (error) {
      console.error(
        `[openphone-send] customer opt-out lookup failed for org ${organizationId}: ${error.message ?? "unknown"}`,
      );
      return "failed";
    }
    const page = Array.isArray(data) ? data as CustomerStopRow[] : [];
    rows.push(...page);
    if (page.length < CUSTOMER_PAGE || typeof query.range !== "function") break;
  }
  return rows;
}

/**
 * True when this org must not text the number because of a STOP.
 * Lookup failures fail closed: the caller does not send.
 */
export async function smsStopBlocksSend(
  supabase: SmsSuppressionDb,
  organizationId: string,
  rawPhone: string,
): Promise<"opted_out" | "clear" | "lookup_failed" | "invalid_phone"> {
  const phone = toE164(rawPhone);
  if (!phone) return "invalid_phone";
  const key = phoneMatchKey(phone);
  try {
    const suppressed = await supabase
      .from("sms_suppressions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", phone)
      .maybeSingle();
    if (suppressed.error) {
      console.error(
        `[openphone-send] sms_suppressions lookup failed for org ${organizationId}: ${suppressed.error.message ?? "unknown"}`,
      );
      return "lookup_failed";
    }
    if (suppressed.data) return "opted_out";

    const customers = await listSmsStopCustomers(supabase, organizationId);
    if (customers === "failed") return "lookup_failed";
    for (const row of customers) {
      if (row.opted_out_method !== SMS_STOP_METHOD) continue;
      if (key && phoneMatchKey(row.phone) === key) return "opted_out";
    }
    return "clear";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[openphone-send] opt-out lookup threw for org ${organizationId}: ${message}`);
    return "lookup_failed";
  }
}

/** Store the STOP against this org and E.164 number. Idempotent. */
export async function recordSmsSuppression(
  supabase: SmsSuppressionDb,
  organizationId: string,
  rawPhone: string,
  source = SMS_STOP_METHOD,
): Promise<boolean> {
  const phone = toE164(rawPhone);
  if (!phone) {
    console.error(
      `[openphone-send] STOP not recorded for org ${organizationId}: phone cannot be normalized`,
    );
    return false;
  }
  const { error } = await supabase
    .from("sms_suppressions")
    .upsert(
      { organization_id: organizationId, phone, source },
      { onConflict: "organization_id,phone" },
    );
  if (error) {
    console.error(
      `[openphone-send] sms_suppressions upsert failed for org ${organizationId} ${phone}: ${error.message ?? "unknown"}`,
    );
    return false;
  }
  console.log(`[openphone-send] recorded sms suppression org=${organizationId} to=${phone}`);
  return true;
}

/** START / UNSTOP. Removes the phone-level STOP row for this org. */
export async function clearSmsSuppression(
  supabase: SmsSuppressionDb,
  organizationId: string,
  rawPhone: string,
): Promise<boolean> {
  const phone = toE164(rawPhone);
  if (!phone) {
    console.error(
      `[openphone-send] START could not clear suppression for org ${organizationId}: phone cannot be normalized`,
    );
    return false;
  }
  const { error } = await supabase
    .from("sms_suppressions")
    .delete()
    .eq("organization_id", organizationId)
    .eq("phone", phone);
  if (error) {
    console.error(
      `[openphone-send] sms_suppressions delete failed for org ${organizationId} ${phone}: ${error.message ?? "unknown"}`,
    );
    return false;
  }
  console.log(`[openphone-send] cleared sms suppression org=${organizationId} to=${phone}`);
  return true;
}

function looseConfirmationAddress(raw: string): string | null {
  const trimmed = raw.trim();
  return /^\+\d{10,15}$/.test(trimmed) ? trimmed : null;
}

/**
 * Send one SMS, or skip it.
 * Does not throw when the number is opted out or the lookup cannot be completed.
 * Network failures from fetch still reject, matching the previous call sites.
 */
export async function sendOpenPhoneMessage(
  input: SendOpenPhoneMessageInput,
): Promise<OpenPhoneSendResult> {
  const tag = logTag(input.tag);
  const e164 = toE164(input.to);
  const destination = e164 ?? (input.allowOptedOut ? looseConfirmationAddress(input.to) : null);
  if (!destination) {
    console.error(`[${tag}] not sent: phone cannot be normalized (${input.organizationId})`);
    return { skipped: false, response: httpResult(0, false, "invalid phone") };
  }

  if (!input.allowOptedOut) {
    const gate = await smsStopBlocksSend(input.supabase, input.organizationId, destination);
    if (gate === "opted_out") {
      console.log(
        `[${tag}] skipped opted_out org=${input.organizationId} to=${destination}`,
      );
      return { skipped: true, reason: "opted_out" };
    }
    if (gate !== "clear") {
      console.error(
        `[${tag}] not sent: opt-out lookup ${gate} org=${input.organizationId} to=${destination}`,
      );
      return { skipped: false, response: httpResult(0, false, "opt-out lookup failed") };
    }
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const rawKey = input.apiKey.trim().replace(/^Bearer\s+/i, "");
  const body = JSON.stringify({
    from: input.from,
    to: [destination],
    content: input.content,
  });
  const attempt = (authorization: string) => fetchImpl(OPENPHONE_MESSAGES_URL, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });

  let res = await attempt(rawKey);
  if (res.status === 401) {
    await res.text();
    res = await attempt(`Bearer ${rawKey}`);
  }
  const text = await res.text();
  return { skipped: false, response: httpResult(res.status, res.ok, text) };
}
