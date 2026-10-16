/**
 * The only outbound OpenPhone message POST.
 *
 * Every customer, cleaner, and lead text goes through sendOpenPhoneMessage.
 * Before the request, the destination is normalized to E.164 and checked with
 * phoneOptOutStatus — the same org-scoped phone match as isPhoneOptedOut.
 * STOP is stored on customers (marketing_status = opted_out) by
 * persistSmsConsent. Any opted-out customer who shares that number blocks
 * every text from the org, including transactional ones.
 * A match returns { skipped: true, reason: "opted_out" } and does not call
 * OpenPhone and does not throw.
 *
 * The one STOP confirmation passes allowOptedOut. START/UNSTOP restores the
 * customer columns through persistSmsConsent; it does not send a text.
 */
import { phoneOptOutStatus } from "./marketing-guard.ts";
import { toE164 } from "./phone.ts";

export const OPENPHONE_MESSAGES_URL = "https://api.openphone.com/v1/messages";

/** TidyWise's own org. Platform-line alerts use this scope for the same check. */
export const TIDYWISE_PLATFORM_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";

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
    const gate = await phoneOptOutStatus(
      input.supabase as never,
      input.organizationId,
      destination,
    );
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
