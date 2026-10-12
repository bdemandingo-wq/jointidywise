// In-app bell + push for owner/admin/manager devices.
// SMS is deliberately not in here: a missing OpenPhone setup must not
// skip these two channels.

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
    pushTitle: string;
    pushBody: string;
    pushData?: Record<string, string>;
  },
): Promise<{ bell: boolean; push: boolean }> {
  let bell = false;
  const { error } = await supabase.from("admin_system_notifications").insert({
    organization_id: args.organizationId,
    type: "staff_activity",
    title: args.title,
    message: args.message,
    link: args.link ?? "/dashboard/bookings",
    metadata: args.metadata ?? {},
  });
  if (error) console.warn("[notifyOffice] bell insert failed:", error);
  else bell = true;

  const push = await sendPushToOrg(
    args.organizationId,
    args.pushTitle,
    args.pushBody,
    args.pushData,
    { audience: "operators" },
  );

  return { bell, push: push.sent > 0 };
}
