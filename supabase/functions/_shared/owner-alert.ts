// Owner/admin alert: in-app bell + operator push, with email when push
// cannot land, and SMS only when that event's "Also text me" switch is on.
//
// Customer and cleaner texts do not go through here.
// Keep this file free of Deno URL imports so node:test can load it.
// sendOrgEmail is imported only when an email is actually sent.

import { parseAlertPhones } from "./alertPhones.ts";
import { escapeHtml } from "./escapeHtml.ts";
import { notifyOffice } from "./office-notify.ts";
import { ownerChannelMasterOn } from "./owner-notify-gates.ts";

const APP_ORIGIN = "https://jointidywise.com";

/** Events whose email fallback is on until the owner turns that event's email off. */
export const OWNER_ALERT_EMAIL_DEFAULT_KEYS = [
  "booking.new",
  "booking.cancelled",
  "client.portal_request",
  "job.on_the_way",
  "job.arrived",
  "job.completed",
] as const;

export interface OwnerAlertOrg {
  supabase: OwnerAlertDb;
  organizationId: string;
  /** Present for booking-scoped events. Dedupe is one alert per event and booking. */
  bookingId?: string | null;
}

export interface OwnerAlertContent {
  title: string;
  body: string;
  link?: string;
}

export interface OwnerAlertResult {
  deduped: boolean;
  bell: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
  smsSkippedReason: string | null;
  emailSkippedReason: string | null;
}

export interface OwnerAlertContext {
  matrix: unknown;
  channels: unknown;
  snoozedUntil: unknown;
  notificationPhone: string | null;
  companyPhone: string | null;
  emailTo: string | null;
  smsEnabled: boolean;
  openPhoneApiKey: string | null;
  openPhoneFrom: string | null;
  operatorIosTokens: number;
}

type QueryError = { message?: string } | null;
type Row = Record<string, unknown>;

export interface OwnerAlertDb {
  from: (table: string) => {
    select: (columns: string) => unknown;
    insert: (values: Record<string, unknown>) => Promise<{ error: QueryError }>;
  };
}

export interface OwnerAlertDeps {
  load: (org: OwnerAlertOrg) => Promise<OwnerAlertContext>;
  notifyOffice: typeof notifyOffice;
  sendSms: (args: {
    phones: string[];
    content: string;
    from: string;
    apiKey: string;
  }) => Promise<{ sent: number }>;
  sendEmail: (args: {
    organizationId: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    messageId?: string;
  }) => Promise<{ success: boolean }>;
}

export function ownerAlertDedupeKey(eventKey: string, bookingId: string | null | undefined): string | undefined {
  if (!bookingId) return undefined;
  return `${eventKey}:${bookingId}`;
}

/** Personal cells first. company_phone is the fallback, and every number on that field is included. */
export function ownerAlertPhones(
  notificationPhone: string | null | undefined,
  companyPhone: string | null | undefined,
): string[] {
  const personal = parseAlertPhones(notificationPhone);
  if (personal.length > 0) return personal;
  return parseAlertPhones(companyPhone);
}

export function ownerAlertSmsAllowed(args: {
  eventKey: string;
  matrix: unknown;
  channels: unknown;
  smsEnabled: boolean;
}): boolean {
  if (args.smsEnabled !== true) return false;
  if (!ownerChannelMasterOn(args.channels, "sms")) return false;
  return matrixFlag(args.matrix, args.eventKey, "sms") === true;
}

export function ownerAlertEmailAllowed(args: {
  eventKey: string;
  matrix: unknown;
  channels: unknown;
  snoozedUntil: unknown;
  now?: number;
}): boolean {
  if (!ownerChannelMasterOn(args.channels, "email")) return false;
  if (eventSnoozed(args.snoozedUntil, args.eventKey, args.now ?? Date.now())) return false;
  const saved = matrixFlag(args.matrix, args.eventKey, "email");
  if (typeof saved === "boolean") return saved;
  return (OWNER_ALERT_EMAIL_DEFAULT_KEYS as readonly string[]).includes(args.eventKey);
}

export function ownerAlertNeedsEmail(operatorIosTokens: number, pushDelivered: boolean): boolean {
  return operatorIosTokens === 0 || !pushDelivered;
}

function matrixFlag(matrix: unknown, eventKey: string, channel: string): boolean | undefined {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) return undefined;
  const row = (matrix as Record<string, unknown>)[eventKey];
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const value = (row as Record<string, unknown>)[channel];
  return typeof value === "boolean" ? value : undefined;
}

function eventSnoozed(snoozed: unknown, eventKey: string, now: number): boolean {
  if (!snoozed || typeof snoozed !== "object" || Array.isArray(snoozed)) return false;
  const iso = (snoozed as Record<string, unknown>)[eventKey];
  if (typeof iso !== "string") return false;
  const until = new Date(iso).getTime();
  return Number.isFinite(until) && until > now;
}

export function openPhoneFromId(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  const match = trimmed.match(/phone-numbers\/([A-Za-z0-9]+)/);
  return match ? match[1] : trimmed;
}

function textField(row: Row | null, key: string): string | null {
  const value = row?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function maybeOne(
  supabase: OwnerAlertDb,
  table: string,
  columns: string,
  organizationId: string,
): Promise<{ row: Row | null; error: string | null }> {
  const selected = supabase.from(table).select(columns) as {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{ data: Row | null; error: QueryError }>;
    };
  };
  const { data, error } = await selected.eq("organization_id", organizationId).maybeSingle();
  return { row: data, error: error?.message ?? null };
}

async function listRows(
  supabase: OwnerAlertDb,
  table: string,
  columns: string,
  filters: Array<{ op: "eq" | "in"; column: string; value: string | readonly string[] }>,
): Promise<{ rows: Row[]; error: string | null }> {
  let query = supabase.from(table).select(columns) as {
    eq: (column: string, value: string) => typeof query;
    in: (column: string, values: readonly string[]) => Promise<{ data: Row[] | null; error: QueryError }>;
  };
  let pending: Promise<{ data: Row[] | null; error: QueryError }> | null = null;
  for (const filter of filters) {
    if (filter.op === "eq") {
      query = query.eq(filter.column, filter.value as string);
    } else {
      pending = query.in(filter.column, filter.value as readonly string[]);
    }
  }
  if (!pending) return { rows: [], error: "list query had no in() filter" };
  const { data, error } = await pending;
  return { rows: data ?? [], error: error?.message ?? null };
}

export async function loadOwnerAlertContext(org: OwnerAlertOrg): Promise<OwnerAlertContext> {
  const empty: OwnerAlertContext = {
    matrix: null,
    channels: null,
    snoozedUntil: null,
    notificationPhone: null,
    companyPhone: null,
    emailTo: null,
    smsEnabled: false,
    openPhoneApiKey: null,
    openPhoneFrom: null,
    operatorIosTokens: 0,
  };

  const prefs = await maybeOne(
    org.supabase,
    "organization_notification_preferences",
    "notification_matrix, channels, snoozed_until",
    org.organizationId,
  );
  if (prefs.error) console.warn("[notifyOwner] prefs read failed:", prefs.error);

  const business = await maybeOne(
    org.supabase,
    "business_settings",
    "notification_phone, company_phone, company_email",
    org.organizationId,
  );
  if (business.error) console.warn("[notifyOwner] business settings read failed:", business.error);

  const sms = await maybeOne(
    org.supabase,
    "organization_sms_settings",
    "sms_enabled, openphone_api_key, openphone_phone_number_id",
    org.organizationId,
  );
  if (sms.error) console.warn("[notifyOwner] sms settings read failed:", sms.error);

  let emailTo = textField(business.row, "company_email");
  if (!emailTo) {
    const emailSettings = await maybeOne(
      org.supabase,
      "organization_email_settings",
      "from_email",
      org.organizationId,
    );
    if (emailSettings.error) console.warn("[notifyOwner] email settings read failed:", emailSettings.error);
    emailTo = textField(emailSettings.row, "from_email");
  }

  let operatorIosTokens = 0;
  const members = await listRows(org.supabase, "org_memberships", "user_id", [
    { op: "eq", column: "organization_id", value: org.organizationId },
    { op: "in", column: "role", value: ["owner", "admin", "manager"] },
  ]);
  if (members.error) {
    console.warn("[notifyOwner] operator membership read failed, email fallback stays available:", members.error);
  } else {
    const userIds = members.rows
      .map((row) => row.user_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (userIds.length > 0) {
      const tokens = await listRows(org.supabase, "device_push_tokens", "token", [
        { op: "eq", column: "platform", value: "ios" },
        { op: "in", column: "user_id", value: userIds },
      ]);
      if (tokens.error) {
        console.warn("[notifyOwner] operator token read failed, email fallback stays available:", tokens.error);
      } else {
        operatorIosTokens = new Set(
          tokens.rows.map((row) => row.token).filter((token): token is string => typeof token === "string" && token.length > 0),
        ).size;
      }
    }
  }

  return {
    ...empty,
    matrix: prefs.row?.notification_matrix ?? null,
    channels: prefs.row?.channels ?? null,
    snoozedUntil: prefs.row?.snoozed_until ?? null,
    notificationPhone: textField(business.row, "notification_phone"),
    companyPhone: textField(business.row, "company_phone"),
    emailTo,
    smsEnabled: sms.row?.sms_enabled === true,
    openPhoneApiKey: textField(sms.row, "openphone_api_key"),
    openPhoneFrom: openPhoneFromId(textField(sms.row, "openphone_phone_number_id")),
    operatorIosTokens,
  };
}

async function defaultSendSms(args: {
  phones: string[];
  content: string;
  from: string;
  apiKey: string;
}): Promise<{ sent: number }> {
  const auth = args.apiKey.trim().replace(/^Bearer\s+/i, "");
  let sent = 0;
  for (const to of args.phones) {
    const response = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ from: args.from, to: [to], content: args.content }),
    });
    if (response.ok) {
      sent += 1;
    } else {
      console.error("[notifyOwner] SMS failed", response.status, await response.text());
    }
  }
  return { sent };
}

async function defaultSendEmail(args: {
  organizationId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId?: string;
}): Promise<{ success: boolean }> {
  const { sendOrgEmail } = await import("./send-org-email.ts");
  const result = await sendOrgEmail({
    organizationId: args.organizationId,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    templateName: "owner-alert",
    messageId: args.messageId,
  });
  return { success: result.success };
}

function alertHtml(body: string, link: string | undefined): string {
  const text = escapeHtml(body).replace(/\n/g, "<br>");
  if (!link) return `<p>${text}</p>`;
  const href = /^https?:\/\//i.test(link)
    ? link
    : `${APP_ORIGIN}${link.startsWith("/") ? link : `/${link}`}`;
  return `<p>${text}</p><p><a href="${escapeHtml(href)}">Open in TidyWise</a></p>`;
}

const defaultDeps: OwnerAlertDeps = {
  load: loadOwnerAlertContext,
  notifyOffice,
  sendSms: defaultSendSms,
  sendEmail: defaultSendEmail,
};

export async function notifyOwner(
  org: OwnerAlertOrg,
  eventKey: string,
  alert: OwnerAlertContent,
  deps?: Partial<OwnerAlertDeps>,
): Promise<OwnerAlertResult> {
  const io: OwnerAlertDeps = { ...defaultDeps, ...deps };
  const ctx = await io.load(org);
  const dedupeKey = ownerAlertDedupeKey(eventKey, org.bookingId);
  const link = alert.link ?? "/dashboard/bookings";

  const office = await io.notifyOffice(org.supabase, {
    organizationId: org.organizationId,
    type: eventKey,
    title: alert.title,
    message: alert.body,
    link,
    metadata: {
      event_key: eventKey,
      ...(org.bookingId ? { booking_id: org.bookingId } : {}),
    },
    dedupeKey,
    pushTitle: alert.title,
    pushBody: alert.body,
    pushData: {
      kind: eventKey,
      ...(org.bookingId ? { booking_id: org.bookingId } : {}),
    },
  });

  if (office.duplicate) {
    return {
      deduped: true,
      bell: true,
      push: false,
      sms: false,
      email: false,
      smsSkippedReason: "Already sent",
      emailSkippedReason: "Already sent",
    };
  }

  let sms = false;
  let smsSkippedReason: string | null = null;
  const smsAllowed = ownerAlertSmsAllowed({
    eventKey,
    matrix: ctx.matrix,
    channels: ctx.channels,
    smsEnabled: ctx.smsEnabled,
  });
  if (!smsAllowed) {
    smsSkippedReason = ctx.smsEnabled ? "Owner text is off for this event" : "SMS is not enabled";
  } else {
    const phones = ownerAlertPhones(ctx.notificationPhone, ctx.companyPhone);
    if (phones.length === 0) {
      smsSkippedReason = "No alert phone configured";
    } else if (!ctx.openPhoneApiKey || !ctx.openPhoneFrom) {
      smsSkippedReason = "SMS not configured";
    } else {
      const sent = await io.sendSms({
        phones,
        content: alert.body,
        from: ctx.openPhoneFrom,
        apiKey: ctx.openPhoneApiKey,
      });
      sms = sent.sent > 0;
      if (!sms) smsSkippedReason = "SMS delivery failed";
    }
  }

  let email = false;
  let emailSkippedReason: string | null = null;
  const emailAllowed = ownerAlertEmailAllowed({
    eventKey,
    matrix: ctx.matrix,
    channels: ctx.channels,
    snoozedUntil: ctx.snoozedUntil,
  });
  const needsEmail = ownerAlertNeedsEmail(ctx.operatorIosTokens, office.push);
  if (!needsEmail) {
    emailSkippedReason = "Push delivered";
  } else if (!emailAllowed) {
    emailSkippedReason = "Owner email is off for this event";
  } else if (!ctx.emailTo) {
    emailSkippedReason = "No alert email configured";
  } else {
    const sent = await io.sendEmail({
      organizationId: org.organizationId,
      to: ctx.emailTo,
      subject: alert.title,
      text: alert.body,
      html: alertHtml(alert.body, link),
      messageId: dedupeKey,
    });
    email = sent.success;
    if (!email) emailSkippedReason = "Email delivery failed";
  }

  return {
    deduped: false,
    bell: office.bell,
    push: office.push,
    sms,
    email,
    smsSkippedReason,
    emailSkippedReason,
  };
}
