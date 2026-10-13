/**
 * Which device rows receive one push.
 *
 * A phone is one row per (user_id, token), not one row per company. Operator
 * pushes look the token up by user_id, so an owner of TIDYWISE and Clean
 * Collective gets each company's operator push from that single row.
 * Duplicating the row per organization would deliver the same alert twice.
 *
 * Keep this file free of Deno imports so node:test can import it.
 */

export interface DevicePushTokenRow {
  token: string;
  user_id: string;
  organization_id?: string | null;
}

export function dedupeDeviceTokens<T extends { token: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row.token || seen.has(row.token)) continue;
    seen.add(row.token);
    out.push(row);
  }
  return out;
}

export function tokensForPush<T extends DevicePushTokenRow>(args: {
  rows: T[];
  organizationId: string;
  /** "operators" matches user_id. "org" matches the company stored on the row. */
  audience: "org" | "operators";
  operatorUserIds: readonly string[];
  /** Set when the push is for one staff user's devices, not the whole company. */
  staffUserId?: string | null;
}): T[] {
  if (args.staffUserId) {
    return dedupeDeviceTokens(args.rows.filter((row) => row.user_id === args.staffUserId));
  }
  if (args.audience === "operators") {
    const operators = new Set(args.operatorUserIds);
    return dedupeDeviceTokens(args.rows.filter((row) => operators.has(row.user_id)));
  }
  return dedupeDeviceTokens(
    args.rows.filter((row) => row.organization_id === args.organizationId),
  );
}
