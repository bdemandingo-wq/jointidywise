// In-app bell + push for owner/admin/manager devices.
// SMS is deliberately not in here: a missing OpenPhone setup must not
// skip these two channels. Customer texts sent by the callers are separate.
// master.native_push === false skips the push and still writes the bell row.

import { ownerNativePushAllowed } from "./owner-notify-gates.ts";
import { readOwnerChannels, type OwnerChannelReader } from "./read-owner-channels.ts";
import { sendPushToOrg } from "./send-push.ts";

type AdminClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
  };
};

export async function notifyOffice(
  supabase: AdminClient,
  args: {
    organizationId: string;
    title: string;
    message: string;
    link?: string;
    metadata?: Record<string, unknown>;
    /** Catalog key stored on the bell row. Defaults to the historical staff_activity type. */
    type?: string;
    /** One bell row per key. A repeat insert of the same key is treated as already sent. */
    dedupeKey?: string;
    pushTitle: string;
    pushBody: string;
    pushData?: Record<string, string>;
    /** False skips the bell row. A dedupe key can still be written by the caller. */
    writeBell?: boolean;
    /** False skips operator push. Defaults to sending when the push master is on. */
    sendPush?: boolean;
  },
): Promise<{ bell: boolean; push: boolean; duplicate: boolean }> {
  let bell = false;
  let duplicate = false;
  if (args.writeBell !== false) {
    const row: Record<string, unknown> = {
      organization_id: args.organizationId,
      type: args.type ?? "staff_activity",
      title: args.title,
      message: args.message,
      link: args.link ?? "/dashboard/bookings",
      metadata: args.metadata ?? {},
    };
    if (args.dedupeKey) row.dedupe_key = args.dedupeKey;
    const { error } = await supabase.from("admin_system_notifications").insert(row);
    duplicate = !!error && /duplicate key|23505/i.test(error.message ?? "");
    if (duplicate) return { bell: true, push: false, duplicate: true };
    if (error) console.warn("[notifyOffice] bell insert failed:", error);
    else bell = true;
  }

  if (args.sendPush === false) return { bell, push: false, duplicate: false };

  const prefs = await readOwnerChannels(
    supabase as unknown as OwnerChannelReader,
    args.organizationId,
  );
  if (prefs.error) {
    console.warn("[notifyOffice] prefs read failed, native push stays on:", prefs.error);
  }
  if (!ownerNativePushAllowed(prefs.channels)) {
    return { bell, push: false, duplicate: false };
  }

  try {
    const push = await sendPushToOrg(
      args.organizationId,
      args.pushTitle,
      args.pushBody,
      args.pushData,
      { audience: "operators" },
    );
    return { bell, push: push.sent > 0, duplicate: false };
  } catch (err) {
    console.error("[notifyOffice] push failed:", err);
    return { bell, push: false, duplicate: false };
  }
}
