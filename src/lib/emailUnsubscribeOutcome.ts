const SUPPORT_EMAIL = "support@tidywisecleaning.com";

export type UnsubscribePayload = {
  ok?: boolean;
  email?: string | null;
  orgName?: string | null;
  unknownToken?: boolean;
};

export type UnsubscribeOutcome =
  | { status: "success"; detail: string }
  | { status: "missing_token" }
  | { status: "error"; detail: string };

export function unsubscribeSuccessDetail(input: {
  email?: string | null;
  orgName?: string | null;
}): string {
  const email = input.email?.trim() || "";
  const orgName = input.orgName?.trim() || "";
  if (email && orgName) {
    return `${email} will no longer receive marketing emails from ${orgName}. You'll still receive essential account and transactional emails, such as booking confirmations and invoices.`;
  }
  if (email) {
    return `${email} will no longer receive Morning Briefs, End of Day Reports, or marketing emails from TidyWise. You'll still receive essential account and transactional emails.`;
  }
  return "You'll no longer receive marketing emails from TidyWise. You'll still receive essential account and transactional emails.";
}

export function outcomeFromUnsubscribeResponse(
  status: number,
  payload: UnsubscribePayload | null,
): UnsubscribeOutcome {
  if (status === 400) return { status: "missing_token" };
  // A test send can carry a token that does not match a row, and the
  // previous function answered 404 with an HTML page Supabase would not
  // render. Either way the person is done: there is nobody left to mail.
  if (status === 404 || (status >= 200 && status < 300 && payload?.unknownToken === true)) {
    return { status: "success", detail: unsubscribeSuccessDetail({}) };
  }
  if (status >= 200 && status < 300 && payload?.ok !== false) {
    return {
      status: "success",
      detail: unsubscribeSuccessDetail({
        email: payload?.email,
        orgName: payload?.orgName,
      }),
    };
  }
  return {
    status: "error",
    detail: `Something went wrong. Try again, or email ${SUPPORT_EMAIL}.`,
  };
}

export function payloadFromUnsubscribeBody(raw: unknown): UnsubscribePayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    ok: typeof record.ok === "boolean" ? record.ok : undefined,
    email: typeof record.email === "string" ? record.email : null,
    orgName: typeof record.orgName === "string" ? record.orgName : null,
    unknownToken: record.unknownToken === true,
  };
}
