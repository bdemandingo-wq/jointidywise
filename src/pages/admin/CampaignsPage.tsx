import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PlanFeatureGate } from "@/components/admin/PlanFeatureGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgId } from "@/hooks/useOrgId";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  MessageSquare, Send, Loader2, BarChart3, Plus, TrendingUp, UserX,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { SEOHead } from '@/components/SEOHead';
import { ReferralDashboard } from '@/components/admin/ReferralDashboard';
import { describeCampaignDispatch, type CampaignDispatchResult } from '@/components/admin/campaigns/campaignDispatch';
import { StatCard } from '@/components/admin/campaigns/StatCard';
import { OptedOutPanel } from '@/components/admin/campaigns/OptedOutPanel';
import { CampaignTrackingDialog } from '@/components/admin/campaigns/CampaignTrackingDialog';
import { CampaignEditDialog } from '@/components/admin/campaigns/CampaignEditDialog';
import { CampaignWizard } from '@/components/admin/campaigns/CampaignWizard';
import { CampaignList } from '@/components/admin/campaigns/CampaignList';
import { campaignLibraryStatus } from '@/components/admin/campaigns/campaignLibraryStatus';
import { useOptedOutCount } from '@/hooks/useOptOuts';
import { useCampaignRuns } from '@/hooks/useCampaignRuns';
import {
  useBusinessSettings,
  useCampaignList,
  useCampaignConversionStats,
  useCampaignTrackingStats,
} from '@/hooks/useCampaigns';

/**
 * Channel is stored on automated_campaigns.channel (sms, email, or both).
 * SMS still sends through run-inactive-campaign / the campaign_sms queue.
 * Email sends through send-followup-campaign when the owner chooses Send now.
 *
 * The "SMS" and "Email" tabs were therefore unfilterable and were never wired
 * into the predicate — they rendered the identical unfiltered list. An Email tab
 * that can only ever be empty is worse than no tab, because it implies email
 * campaigns exist. Removed rather than implemented.
 */
type ChannelFilter = "all" | "opted_out";
type StatusFilter = "all" | "draft" | "scheduled" | "sent" | "active";

export default function CampaignsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { organizationId: orgId } = useOrgId();
  const isMobile = useIsMobile();

  // Filters
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Campaign creation
  const [createOpen, setCreateOpen] = useState(false);

  // Deep link from Smart Suggestions: /dashboard/campaigns?audience=...&days=...&create=1
  const [searchParams] = useSearchParams();
  const [nameQuery, setNameQuery] = useState(() => searchParams.get('q') || '');
  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true);
    const q = searchParams.get('q');
    if (q) setNameQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Automations expand

  // Campaign detail dialog
  const [detailCampaignId, setDetailCampaignId] = useState<string | null>(null);

  // Campaign edit dialog
  const [editCampaign, setEditCampaign] = useState<any | null>(null);


  // Business settings
  const { data: businessSettings } = useBusinessSettings(orgId);
  const { data: campaignRuns = {} } = useCampaignRuns(orgId);
  const orgTimezone = businessSettings?.timezone ?? null;

  const { data: campaigns = [], isLoading } = useCampaignList(orgId);


  const { data: conversionStats } = useCampaignConversionStats(orgId);

  const { data: optedOutCount = 0 } = useOptedOutCount(orgId);

  // Map of campaign id -> name for opt-out attribution
  const campaignNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    campaigns.forEach((c: any) => { m[c.id] = c.name; });
    return m;
  }, [campaigns]);


  const { data: campaignTrackingStats = {} } = useCampaignTrackingStats(orgId);


  // Filtered campaigns
  const filteredCampaigns = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    return campaigns.filter(c => {
      if (statusFilter !== "all" && campaignLibraryStatus(c) !== statusFilter) return false;
      if (q && !String(c.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
    // channelFilter is deliberately absent: it selects a VIEW (the opted-out
    // panel), not a subset of campaigns, so it must not be a dependency here.
  }, [campaigns, statusFilter, nameQuery]);

  // Mutations




  if (isLoading) {
    return (
      <AdminLayout title="Campaigns" subtitle="Loading...">
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Campaigns | TidyWise" description="Create and manage marketing campaigns" noIndex />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 min-h-[44px] animate-spin text-primary" />
        </div>
      </div>
</AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Campaigns"
      subtitle="Manage marketing campaigns and automations"
      actions={
        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Campaign</span>
        </Button>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <PlanFeatureGate feature="campaigns">
        <div className="space-y-6">
          {/* Campaigns vs the opted-out roster. Not a channel toggle — see
              ChannelFilter above for why the SMS/Email tabs were removed. */}
          <Tabs value={channelFilter} onValueChange={(v) => setChannelFilter(v as ChannelFilter)}>
            <TabsList>
              <TabsTrigger value="all">Campaigns</TabsTrigger>
              <TabsTrigger value="opted_out" className="gap-1.5">
                <UserX className="w-3.5 h-3.5" /> Opted Out
                {optedOutCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{optedOutCount}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard icon={Send} label="Campaigns Sent" value={campaigns.filter(c => c.last_run_at).length} />
            <StatCard icon={MessageSquare} label="Messages Delivered" value={conversionStats?.total || 0} />
            <StatCard icon={BarChart3} label="Conversion Rate" value={`${conversionStats?.rate || 0}%`} trend={conversionStats && conversionStats.rate > 5 ? "up" : undefined} />
            <StatCard icon={TrendingUp} label="Converted" value={conversionStats?.converted || 0} trend={conversionStats && conversionStats.converted > 0 ? "up" : undefined} />
            <StatCard icon={UserX} label="Opted Out" value={optedOutCount} />
          </div>

          {channelFilter === "opted_out" ? (
            <OptedOutPanel orgId={orgId} campaignNameMap={campaignNameMap} />
          ) : (
            <>
            <div className="mb-3">
              <Input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="Search campaigns by name"
                aria-label="Search campaigns"
                className="max-w-sm"
              />
            </div>
            <CampaignList
              campaigns={filteredCampaigns}
              orgId={orgId}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              trackingStats={campaignTrackingStats}
              conversionStats={conversionStats}
              runs={campaignRuns}
              orgTimezone={orgTimezone}
              onOpenTracking={setDetailCampaignId}
              onEditCampaign={setEditCampaign}
              onNewCampaign={() => setCreateOpen(true)}
            />
            </>
          )}
        </div>
      </PlanFeatureGate>

      {/* Referral Dashboard */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Referral Program</h2>
        <ReferralDashboard />
      </div>

      <CampaignWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        businessSettings={businessSettings}
        optedOutCount={optedOutCount}
      />

      <CampaignTrackingDialog
        campaignId={detailCampaignId}
        campaignName={campaigns.find(c => c.id === detailCampaignId)?.name || ""}
        orgId={orgId}
        trackingStats={campaignTrackingStats}
        run={detailCampaignId ? campaignRuns[detailCampaignId] : null}
        orgTimezone={orgTimezone}
        onClose={() => setDetailCampaignId(null)}
      />

      <CampaignEditDialog
        campaign={editCampaign}
        orgId={orgId}
        onClose={() => setEditCampaign(null)}
      />
    </div>
</AdminLayout>
  );
}

