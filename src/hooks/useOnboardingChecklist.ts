import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrgId } from './useOrgId';

export interface OnboardingItem {
  key: string;
  label: string;
  description: string;
  completed: boolean;
  link: string;
  icon: string;
}

async function hasAnyRow(
  table: 'services' | 'staff' | 'bookings',
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function hasActiveService(organizationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('services')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export function useOnboardingChecklist() {
  const { organizationId } = useOrgId();

  return useQuery({
    queryKey: ['onboarding-checklist', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      // A head/count request was returning a null count while the Services
      // page (a normal select) showed the six services onboarding just
      // inserted, so "Add your first service" stayed unticked forever.
      const [hasServices, hasStaff, sms, stripe, hasBookings] = await Promise.all([
        hasActiveService(organizationId),
        hasAnyRow('staff', organizationId),
        supabase.rpc('has_openphone_api_key', { _org_id: organizationId }),
        supabase.rpc('get_org_stripe_settings_safe', { p_organization_id: organizationId }),
        hasAnyRow('bookings', organizationId),
      ]);

      if (sms.error) throw sms.error;
      if (stripe.error) throw stripe.error;
      const hasOpenPhone = sms.data === true;
      const stripeRow = (stripe.data as any)?.[0] ?? null;
      const hasStripe = !!(stripeRow?.stripe_account_id);

      const items: OnboardingItem[] = [
        {
          key: 'services',
          label: 'Add your first service',
          description: 'Define the cleaning services you offer with pricing',
          completed: hasServices,
          link: '/dashboard/services',
          icon: '🧹',
        },
        {
          key: 'staff',
          label: 'Add your first staff member',
          description: 'Invite cleaners to start assigning jobs',
          completed: hasStaff,
          link: '/dashboard/staff',
          icon: '👥',
        },
        {
          key: 'openphone',
          label: 'Connect OpenPhone',
          description: 'Unlock SMS, calls, AI assistant, and daily reports',
          completed: hasOpenPhone,
          link: '/dashboard/settings?tab=sms',
          icon: '📱',
        },
        {
          key: 'stripe',
          label: 'Connect Stripe',
          description: 'Accept payments and set up cleaner payouts',
          completed: hasStripe,
          link: '/dashboard/payment-integration',
          icon: '💳',
        },
        {
          key: 'bookings',
          label: 'Create your first booking',
          description: 'Schedule your first cleaning job',
          completed: hasBookings,
          link: '/dashboard/bookings',
          icon: '📅',
        },
      ];

      return items;
    },
    enabled: !!organizationId,
    // The checklist is the first thing a new owner sees. A persisted
    // "0 services" from the second before the insert committed must not
    // stick for the default 5 minute stale time.
    staleTime: 0,
  });
}
