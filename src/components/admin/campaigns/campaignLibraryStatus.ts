export type CampaignLibraryStatus = "draft" | "scheduled" | "sent" | "active";

export function campaignLibraryStatus(campaign: {
  is_active?: boolean | null;
  last_run_at?: string | null;
  scheduled_at?: string | null;
}): CampaignLibraryStatus {
  if (campaign.is_active) return "active";
  if (campaign.scheduled_at && !campaign.last_run_at && new Date(campaign.scheduled_at).getTime() > Date.now()) return "scheduled";
  if (campaign.last_run_at) return "sent";
  return "draft";
}

export function channelLabel(channel: string | null | undefined): string {
  if (channel === "email") return "Email";
  if (channel === "both") return "Email + SMS";
  return "SMS";
}
