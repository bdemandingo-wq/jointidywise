// Owner/admin alert: in-app bell + operator push, with email when push
// cannot land, and SMS only when that event's "Also text me" switch is on.
//
// Customer and cleaner texts do not go through here.
// Keep this file free of Deno URL imports so node:test can load it.
// sendOrgEmail is imported only when an email is actually sent.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseAlertPhones } from "./alertPhones.ts";
import { escapeHtml } from "./escapeHtml.ts";
import { renderCrmEmail } from "./crm-email/render.ts";
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
  supabase: SupabaseClient;
  organizationId: string;
  /** Present for booking-scoped events. */
  bookingId?: string | null;
  /** Separates one cleaner's job alert from another cleaner on the same booking. */
  staffId?: string | null;
  /** Separates one cancellation of a booking from a later one. cancelled_at is the usual value. */
  occurrenceId?: string | null;
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
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: QueryError }>;
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
    organizationId: string;
    supabase: SupabaseClient;
  }) => Promise<{ sent: number; skipped?: boolean }>;
  sendEmail: (args: {
    organizationId: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    messageId?: string;
  }) => Promise<{ success: boolean }>;
}

const JOB_ALERT_EVENTS = new Set(["job.on_the_way", "job.arrived", "job.completed"]);
const LIVE_BELL_EVENTS = new Set(["booking.new", "client.portal_request", "booking.cancelled"]);

/** The in-app bell already builds these from live rows, so notifyOwner does not show a second one. */
export function ownerAlertSkipsLiveBell(eventKey: string): boolean {
  return LIVE_BELL_EVENTS.has(eventKey);
}

export function ownerAlertDedupeKey(
  eventKey: string,
  bookingId: string | null | undefined,
  scope?: { staffId?: string | null; occurrenceId?: string | null },
): string | undefined {
  const booking = (bookingId ?? "").trim();
  if (!booking) return undefined;
  if (JOB_ALERT_EVENTS.has(eventKey)) {
    const staffId = (scope?.staffId ?? "").trim();
    return staffId ? `${eventKey}:${booking}:${staffId}` : `${eventKey}:${booking}`;
  }
  if (eventKey === "booking.cancelled") {
    const occurrenceId = (scope?.occurrenceId ?? "").trim();
    // A bare booking id would swallow the next cancellation of the same job.
    if (!occurrenceId) return undefined;
    return `${eventKey}:${booking}:${occurrenceId}`;
  }
  return `${eventKey}:${booking}`;
}

/** Bell is on unless this event is snoozed, the group turned it off, or the live bell already shows it. */
export function ownerAlertBellOn(args: {
  eventKey: string;
  matrix: unknown;
  snoozedUntil: unknown;
  now?: number;
}): boolean {
  if (ownerAlertSkipsLiveBell(args.eventKey)) return false;
  if (eventSnoozed(args.snoozedUntil, args.eventKey, args.now ?? Date.now())) return false;
  return matrixFlag(args.matrix, args.eventKey, "bell") !== false;
}

/** Push is on unless this event is snoozed, the group turned native push off, or the push master is off. */
export function ownerAlertPushOn(args: {
  eventKey: string;
  matrix: unknown;
  channels: unknown;
  snoozedUntil: unknown;
  now?: number;
}): boolean {
  if (eventSnoozed(args.snoozedUntil, args.eventKey, args.now ?? Date.now())) return false;
  if (!ownerChannelMasterOn(args.channels, "native_push")) return false;
  return matrixFlag(args.matrix, args.eventKey, "native_push") !== false;
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
  // Saved values are a bare id, a phone-numbers URL, or a my.openphone.com/inbox URL.
  const pathMatch = trimmed.match(/(?:phone-numbers|inbox)\/([A-Za-z0-9]+)/);
  if (pathMatch) return pathMatch[1];
  const pnMatch = trimmed.match(/(PN[A-Za-z0-9]+)/);
  if (pnMatch) return pnMatch[1];
  return trimmed;
}

function textField(row: Row | null, key: string): string | null {
  const value = row?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function eqOne(
  supabase: OwnerAlertDb,
  table: string,
  columns: string,
  column: string,
  value: string,
): Promise<{ row: Row | null; error: string | null }> {
  const selected = supabase.from(table).select(columns) as {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{ data: Row | null; error: QueryError }>;
    };
  };
  const { data, error } = await selected.eq(column, value).maybeSingle();
  return { row: data, error: error?.message ?? null };
}

async function maybeOne(
  supabase: OwnerAlertDb,
  table: string,
  columns: string,
  organizationId: string,
): Promise<{ row: Row | null; error: string | null }> {
  return eqOne(supabase, table, columns, "organization_id", organizationId);
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

  let emailTo: string | null = null;
  const organization = await eqOne(org.supabase, "organizations", "owner_id", "id", org.organizationId);
  if (organization.error) console.warn("[notifyOwner] organization read failed:", organization.error);
  const ownerId = textField(organization.row, "owner_id");
  if (ownerId) {
    const profile = await eqOne(org.supabase, "profiles", "email", "id", ownerId);
    if (profile.error) console.warn("[notifyOwner] owner profile read failed:", profile.error);
    emailTo = textField(profile.row, "email");
  }
  if (!emailTo) emailTo = textField(business.row, "company_email");
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
  organizationId: string;
  supabase: SupabaseClient;
}): Promise<{ sent: number; skipped: boolean }> {
  // Loaded only when a text is sent. A static import pulls marketing-guard's
  // esm.sh type into every node:test that loads this file.
  const { sendOpenPhoneMessage } = await import("./send-sms.ts");
  let sent = 0;
  let optedOut = 0;
  let failed = 0;
  for (const to of args.phones) {
    // Bearer retry on 401 stays in sendOpenPhoneMessage. This number still
    // goes through the org opt-out check; it is the business's own phone.
    const result = await sendOpenPhoneMessage({
      supabase: args.supabase,
      organizationId: args.organizationId,
      to,
      content: args.content,
      from: args.from,
      apiKey: args.apiKey,
      tag: "notifyOwner",
    });
    if (result.skipped) {
      optedOut += 1;
      console.log("[notifyOwner] SMS skipped opted_out", to);
      continue;
    }
    if (result.response.ok) {
      sent += 1;
    } else {
      failed += 1;
      console.error("[notifyOwner] SMS failed", result.response.status, await result.response.text());
    }
  }
  return { sent, skipped: sent === 0 && failed === 0 && optedOut > 0 };
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

function ownerAlertMail(title: string, body: string, link: string): { html: string; text: string } {
  const href = /^https?:\/\//i.test(link)
    ? link
    : `${APP_ORIGIN}${link.startsWith("/") ? link : `/${link}`}`;
  const bodyHtml = escapeHtml(body)
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;")
    .replace(/\n/g, "<br>");
  return renderCrmEmail("owner-alert", {
    vars: {
      "alert.title": title,
      "alert.url": href,
    },
    slots: [
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#111111;text-align:left;padding:0 0 14px 0;">${bodyHtml}</div>`,
    ],
  });
}

const defaultDeps: OwnerAlertDeps = {
  load: loadOwnerAlertContext,
  notifyOffice,
  sendSms: defaultSendSms,
  sendEmail: defaultSendEmail,
};

const EMPTY_CONTEXT: OwnerAlertContext = {
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

function failureText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function notifyOwner(
  org: OwnerAlertOrg,
  eventKey: string,
  alert: OwnerAlertContent,
  deps?: Partial<OwnerAlertDeps>,
): Promise<OwnerAlertResult> {
  const io: OwnerAlertDeps = { ...defaultDeps, ...deps };
  let ctx = EMPTY_CONTEXT;
  try {
    ctx = await io.load(org);
  } catch (err) {
    console.error("[notifyOwner] prefs load failed, continuing with the other channels:", failureText(err));
  }

  const now = Date.now();
  if (eventSnoozed(ctx.snoozedUntil, eventKey, now)) {
    return {
      deduped: false,
      bell: false,
      push: false,
      sms: false,
      email: false,
      smsSkippedReason: "Snoozed",
      emailSkippedReason: "Snoozed",
    };
  }

  const dedupeKey = ownerAlertDedupeKey(eventKey, org.bookingId, {
    staffId: org.staffId,
    occurrenceId: org.occurrenceId,
  });
  const link = alert.link ?? "/dashboard/bookings";
  const bellOn = ownerAlertBellOn({ eventKey, matrix: ctx.matrix, snoozedUntil: ctx.snoozedUntil, now });
  const pushOn = ownerAlertPushOn({
    eventKey,
    matrix: ctx.matrix,
    channels: ctx.channels,
    snoozedUntil: ctx.snoozedUntil,
    now,
  });
  const smsAllowed = ownerAlertSmsAllowed({
    eventKey,
    matrix: ctx.matrix,
    channels: ctx.channels,
    smsEnabled: ctx.smsEnabled,
  });
  const emailAllowed = ownerAlertEmailAllowed({
    eventKey,
    matrix: ctx.matrix,
    channels: ctx.channels,
    snoozedUntil: ctx.snoozedUntil,
    now,
  });
  // Write a row when the owner will see the bell, or when another channel needs
  // the dedupe key. Live-bell events are filtered out of the bell list.
  const writeBell = (bellOn || !!dedupeKey) && (bellOn || pushOn || smsAllowed || emailAllowed);

  let office = { bell: false, push: false, duplicate: false };
  try {
    office = await io.notifyOffice(org.supabase, {
      organizationId: org.organizationId,
      type: eventKey,
      title: alert.title,
      message: alert.body,
      link,
      metadata: {
        event_key: eventKey,
        ...(org.bookingId ? { booking_id: org.bookingId } : {}),
        ...(org.staffId ? { staff_id: org.staffId } : {}),
      },
      dedupeKey,
      writeBell,
      sendPush: pushOn,
      pushTitle: alert.title,
      pushBody: alert.body,
      pushData: {
        kind: eventKey,
        ...(org.bookingId ? { booking_id: org.bookingId } : {}),
        ...(org.staffId ? { staff_id: org.staffId } : {}),
      },
    });
  } catch (err) {
    console.error("[notifyOwner] bell/push failed:", failureText(err));
  }

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
  if (!smsAllowed) {
    smsSkippedReason = ctx.smsEnabled ? "Owner text is off for this event" : "SMS is not enabled";
  } else {
    const phones = ownerAlertPhones(ctx.notificationPhone, ctx.companyPhone);
    if (phones.length === 0) {
      smsSkippedReason = "No alert phone configured";
    } else if (!ctx.openPhoneApiKey || !ctx.openPhoneFrom) {
      smsSkippedReason = "SMS not configured";
    } else {
      try {
        const sent = await io.sendSms({
          phones,
          content: alert.body,
          from: ctx.openPhoneFrom,
          apiKey: ctx.openPhoneApiKey,
          organizationId: org.organizationId,
          supabase: org.supabase,
        });
        if (sent.skipped) {
          smsSkippedReason = "Number opted out";
        } else {
          sms = sent.sent > 0;
          if (!sms) smsSkippedReason = "SMS delivery failed";
        }
      } catch (err) {
        console.error("[notifyOwner] SMS failed:", failureText(err));
        smsSkippedReason = "SMS delivery failed";
      }
    }
  }

  let email = false;
  let emailSkippedReason: string | null = null;
  const needsEmail = ownerAlertNeedsEmail(ctx.operatorIosTokens, office.push);
  if (!needsEmail) {
    emailSkippedReason = "Push delivered";
  } else if (!emailAllowed) {
    emailSkippedReason = "Owner email is off for this event";
  } else if (!ctx.emailTo) {
    emailSkippedReason = "No alert email configured";
  } else {
    try {
      const mail = ownerAlertMail(alert.title, alert.body, link);
      const sent = await io.sendEmail({
        organizationId: org.organizationId,
        to: ctx.emailTo,
        subject: alert.title,
        text: mail.text,
        html: mail.html,
        messageId: dedupeKey,
      });
      email = sent.success;
      if (!email) emailSkippedReason = "Email delivery failed";
    } catch (err) {
      console.error("[notifyOwner] email failed:", failureText(err));
      emailSkippedReason = "Email delivery failed";
    }
  }

  return {
    deduped: false,
    bell: bellOn && office.bell,
    push: office.push,
    sms,
    email,
    smsSkippedReason,
    emailSkippedReason,
  };
}
