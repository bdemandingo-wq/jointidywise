import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from "@/lib/supabasePublicEnv";
import {
  outcomeFromUnsubscribeResponse,
  payloadFromUnsubscribeBody,
  type UnsubscribeOutcome,
  type UnsubscribePayload,
} from "@/lib/emailUnsubscribeOutcome";

export {
  outcomeFromUnsubscribeResponse,
  unsubscribeSuccessDetail,
  type UnsubscribeOutcome,
  type UnsubscribePayload,
} from "@/lib/emailUnsubscribeOutcome";

export async function requestEmailUnsubscribe(token: string): Promise<UnsubscribeOutcome> {
  const trimmed = token.trim();
  if (!trimmed) return { status: "missing_token" };

  // Token stays on the query string so a function that has not picked up
  // the JSON body yet still records the opt-out. The body is what the
  // updated function reads, and what one-click does not send.
  const endpoint = `${SUPABASE_PUBLIC_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(trimmed)}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLIC_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLIC_ANON_KEY}`,
      },
      body: JSON.stringify({ token: trimmed }),
    });
  } catch {
    return outcomeFromUnsubscribeResponse(0, null);
  }

  let payload: UnsubscribePayload | null = null;
  try {
    payload = payloadFromUnsubscribeBody(await response.json());
  } catch {
    payload = null;
  }
  return outcomeFromUnsubscribeResponse(response.status, payload);
}
