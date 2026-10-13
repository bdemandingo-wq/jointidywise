// Human clicks go to the app. Supabase serves edge-function HTML as
// text/plain under a sandbox CSP, so a function URL in the mail body
// renders as source, or not at all, in Gmail.
//
// One-click (RFC 8058) is a POST from the mail client to the HTTPS URI in
// List-Unsubscribe. That has to be the function, which returns JSON. The
// app page is a document; a POST there would not record the opt-out.

export const UNSUBSCRIBE_PAGE_ORIGIN = "https://jointidywise.com";

export function unsubscribePageUrl(token?: string | null): string {
  const base = `${UNSUBSCRIBE_PAGE_ORIGIN}/unsubscribe`;
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return base;
  return `${base}?token=${encodeURIComponent(trimmed)}`;
}

export function unsubscribeTokenFromParts(
  queryToken: string | null,
  contentType: string | null,
  jsonBody: unknown,
): string {
  const fromQuery = queryToken?.trim() ?? "";
  if (
    contentType?.includes("application/json") &&
    jsonBody &&
    typeof jsonBody === "object" &&
    "token" in jsonBody
  ) {
    const value = (jsonBody as { token?: unknown }).token;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fromQuery;
}

export function oneClickUnsubscribeUrl(supabaseUrl: string, token: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token.trim())}`;
}

export function listUnsubscribeHeaders(oneClickUrl: string): {
  "List-Unsubscribe": string;
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click";
} {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
