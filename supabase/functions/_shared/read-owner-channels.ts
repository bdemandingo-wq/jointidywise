/**
 * Read organization_notification_preferences.channels for an owner send gate.
 * A missing row is not an error: masters default to on.
 */

export type OwnerChannelReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data: { channels?: unknown } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export async function readOwnerChannels(
  supabase: OwnerChannelReader,
  organizationId: string,
): Promise<{ channels: unknown; error: string | null }> {
  const { data, error } = await supabase
    .from("organization_notification_preferences")
    .select("channels")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { channels: null, error: error.message ?? "prefs read failed" };
  return { channels: data?.channels ?? null, error: null };
}
