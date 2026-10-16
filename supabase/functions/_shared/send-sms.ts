/**
 * The only outbound OpenPhone message POST.
 *
 * Every customer, cleaner, and lead text goes through sendOpenPhoneMessage.
 * Before the request, the destination is normalized to E.164 and checked with
 * phoneOptOutStatus. A number is blocked when customers.marketing_status is
 * opted_out for that phone in the org, or when sms_suppressions has a row for
 * the org and that E.164 number. Either source blocks every text, including
 * transactional ones.
 * A match returns { skipped: true, reason: "opted_out" }, writes system_logs,
 * and does not call OpenPhone and does not throw.
 *
 * The inbound webhook is the only caller that may pass purpose
 * "stop_confirmation" or "help". Those two replies are the only sends that
 * skip the gate. START/UNSTOP deletes the suppression row and sets
 * marketing_status to a non-blocking value. It does not send a text.
 *
 * This file is the only place that may POST the OpenPhone messages URL.
 * Read-only GETs live in openphone-messages-read.ts and cannot POST.
 * scripts/check-openphone-messages-endpoint.mjs fails any other copy of the
 * URL, any POST outside this file, and any compliance purpose outside the
 * inbound webhook.
 */
import { phoneOptOutStatus } from "./marketing-guard.ts";
import { toE164 } from "./phone.ts";

const OPENPHONE_MESSAGES_URL = "https://api.openphone.com/v1/messages";

/** TidyWise's own org. Platform-line alerts use this scope for the same check. */
export const TIDYWISE_PLATFORM_ORG_ID = "e95b92d0-7099-408e-a773-e4407b34f8b4";

/** Named replies the inbound webhook may send after a number is suppressed. */
export type SmsSendPurpose = "stop_confirmation" | "help";

const COMPLIANCE_PURPOSES: ReadonlySet<string> = new Set<SmsSendPurpose>([
  "stop_confirmation",
  "help",
]);

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
  insert(
    values: Record<string, unknown>,
  ): PromiseLike<{ error: { message?: string } | null }>;
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
   * stop_confirmation and help are the only purposes that may text a
   * suppressed number. Only the inbound webhook passes them.
   */
  purpose?: SmsSendPurpose;
  tag?: string;
  fetchImpl?: FetchLike;
}

function isCompliancePurpose(purpose: string | undefined): purpose is SmsSendPurpose {
  return purpose !== undefined && COMPLIANCE_PURPOSES.has(purpose);
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
  return tag && tag.length > 0 ? tag : "send-sms";
}

function looseConfirmationAddress(raw: string): string | null {
  const trimmed = raw.trim();
  return /^\+\d{10,15}$/.test(trimmed) ? trimmed : null;
}

async function logBlockedSend(
  supabase: SmsSuppressionDb,
  organizationId: string,
  to: string,
  tag: string,
): Promise<void> {
  try {
    const logged = await supabase.from("system_logs").insert({
      level: "info",
      source: "send-sms",
      message: "SMS skipped: number opted out",
      organization_id: organizationId,
      details: { to, tag, reason: "opted_out" },
    });
    if (logged.error) {
      console.error(
        `[${tag}] opted-out skip was not written to system_logs: ${logged.error.message ?? "unknown"}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${tag}] opted-out skip log failed: ${message}`);
  }
}

/**
 * Upsert the org + E.164 suppression written for every inbound STOP.
 * Returns false when the phone cannot be normalized or the write fails.
 */
export async function recordSmsSuppression(
  supabase: SmsSuppressionDb,
  organizationId: string,
  phone: string,
): Promise<boolean> {
  const e164 = toE164(phone);
  if (!e164) {
    console.error(`[send-sms] suppression not recorded: phone cannot be normalized (${organizationId})`);
    return false;
  }
  try {
    const written = await supabase.from("sms_suppressions").upsert(
      { organization_id: organizationId, phone: e164, source: "sms_stop" },
      { onConflict: "organization_id,phone" },
    );
    if (written.error) {
      console.error(
        `[send-sms] sms_suppressions upsert failed org=${organizationId}: ${written.error.message ?? "unknown"}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[send-sms] sms_suppressions upsert threw org=${organizationId}: ${message}`);
    return false;
  }
}

/** Delete the org + E.164 suppression. A missing row is success. */
export async function clearSmsSuppression(
  supabase: SmsSuppressionDb,
  organizationId: string,
  phone: string,
): Promise<boolean> {
  const e164 = toE164(phone);
  if (!e164) {
    console.error(`[send-sms] suppression not cleared: phone cannot be normalized (${organizationId})`);
    return false;
  }
  try {
    const removed = await supabase
      .from("sms_suppressions")
      .delete()
      .eq("organization_id", organizationId)
      .eq("phone", e164);
    if (removed.error) {
      console.error(
        `[send-sms] sms_suppressions delete failed org=${organizationId}: ${removed.error.message ?? "unknown"}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[send-sms] sms_suppressions delete threw org=${organizationId}: ${message}`);
    return false;
  }
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
  const complianceReply = isCompliancePurpose(input.purpose);
  const destination = e164 ?? (complianceReply ? looseConfirmationAddress(input.to) : null);
  if (!destination) {
    console.error(`[${tag}] not sent: phone cannot be normalized (${input.organizationId})`);
    return { skipped: false, response: httpResult(0, false, "invalid phone") };
  }

  if (!complianceReply) {
    const gate = await phoneOptOutStatus(
      input.supabase as never,
      input.organizationId,
      destination,
    );
    if (gate === "opted_out") {
      console.log(
        `[${tag}] skipped opted_out org=${input.organizationId} to=${destination}`,
      );
      await logBlockedSend(input.supabase, input.organizationId, destination, tag);
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
