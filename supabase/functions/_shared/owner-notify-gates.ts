/**
 * Owner-only send gates for notification preferences.
 *
 * Zero imports and no Deno globals so node:test can load this file.
 * Customer SMS and email do not use these helpers.
 *
 * A missing preference row, a missing master key, or a non-boolean value
 * leaves that master ON. That matches isMasterChannelOn in
 * src/lib/notificationCatalog.ts. Only an explicit false turns a master off.
 * notify_new_booking blocks only when the column is exactly false; null
 * (no business_settings row) keeps the historical default of sending.
 */

export type OwnerChannelMaster = "email" | "sms" | "native_push";

export type OwnerSendBlock = "notify_new_booking" | "master.email" | "master.sms";

export function ownerChannelMasterOn(channels: unknown, channel: OwnerChannelMaster): boolean {
  if (!isPlainObject(channels)) return true;
  const value = channels[`master.${channel}`];
  return typeof value === "boolean" ? value : true;
}

export function ownerNewBookingEmailAllowed(args: {
  notifyNewBooking: boolean | null | undefined;
  channels: unknown;
}): { allowed: boolean; reason?: OwnerSendBlock } {
  if (args.notifyNewBooking === false) return { allowed: false, reason: "notify_new_booking" };
  if (!ownerChannelMasterOn(args.channels, "email")) return { allowed: false, reason: "master.email" };
  return { allowed: true };
}

export function ownerNewBookingSmsAllowed(args: {
  notifyNewBooking: boolean | null | undefined;
  channels: unknown;
}): { allowed: boolean; reason?: OwnerSendBlock } {
  if (args.notifyNewBooking === false) return { allowed: false, reason: "notify_new_booking" };
  if (!ownerChannelMasterOn(args.channels, "sms")) return { allowed: false, reason: "master.sms" };
  return { allowed: true };
}

export function ownerNativePushAllowed(channels: unknown): boolean {
  return ownerChannelMasterOn(channels, "native_push");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
