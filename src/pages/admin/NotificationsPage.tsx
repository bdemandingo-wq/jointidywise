import { AdminLayout } from '@/components/admin/AdminLayout';
import { SEOHead } from '@/components/SEOHead';
import { NotificationPreferencesCard } from '@/components/admin/NotificationPreferencesCard';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/admin/PullToRefreshIndicator';
import { requestAdminNotificationRefresh } from '@/lib/adminNotificationRefresh';

export default function NotificationsPage() {
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;
  const queryClient = useQueryClient();

  const handlePullRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['org-notification-prefs'] }),
      queryClient.invalidateQueries({ queryKey: ['notification-settings-delivery', orgId] }),
    ]);
    requestAdminNotificationRefresh();
  }, [orgId, queryClient]);
  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh(handlePullRefresh);

  return (
    <AdminLayout title="Notifications" subtitle="Choose what you and your customers hear about">
      <div className="portal-v2 portal-v2-scroll" {...pullHandlers}>
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        <SEOHead title="Notifications | TidyWise" description="Configure notification preferences" noIndex />
        <NotificationPreferencesCard />
      </div>
    </AdminLayout>
  );
}
