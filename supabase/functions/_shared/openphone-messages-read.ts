/**
 * Read-only OpenPhone message list.
 *
 * Callers pass query params. This module always uses GET and does not export
 * the messages URL, so a caller cannot turn the helper into a send.
 * Outbound texts go through sendOpenPhoneMessage in send-sms.ts.
 */

const OPENPHONE_MESSAGES_READ_URL = "https://api.openphone.com/v1/messages";

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<Response>;

/**
 * GET /v1/messages. Authorization is forwarded as the caller stored it.
 */
export async function fetchOpenPhoneMessages(
  apiKey: string,
  applyParams: (params: URLSearchParams) => void,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const url = new URL(OPENPHONE_MESSAGES_READ_URL);
  applyParams(url.searchParams);
  return fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
  });
}
