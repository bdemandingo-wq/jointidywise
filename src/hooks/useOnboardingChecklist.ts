import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useOrgId } from './useOrgId';
import {
  checklistMilestones,
  openPhoneLiveConnected,
  setupStepState,
  stripeLiveConnected,
  type ActivationMilestoneKey,
  type SetupStepState,
} from '@/lib/activationMilestones';

export interface OnboardingItem {
  key: ActivationMilestoneKey;
  label: string;
  description: string;
  /** True only when the live check passes. A recorded milestone is not enough. */
  completed: boolean;
  /**
   * never_done: no milestone and not currently set up.
   * done: live check passes (connected, or the row exists now).
   * needs_attention: the milestone was recorded and the live check is false
   * (disconnected OpenPhone or Stripe, or the service/staff/job was removed).
   */
  state: SetupStepState;
  attention: string;
  link: string;
  icon: string;
}

async function hasAnyRow(
  table: 'bookings',
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

async function hasActiveStaff(organizationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('staff')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

function missingActivationTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || /schema cache|does not exist|organization_activation_events/i.test(message);
}

export function useOnboardingChecklist(enabled = true) {
  const { organizationId } = useOrgId();

  return useQuery({
    queryKey: ['onboarding-checklist', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      // A head/count request was returning a null count while the Services
      // page (a normal select) showed the six services onboarding just
      // inserted, so "Add your first service" stayed unticked forever.
      //
      // Completion is the live row, not the milestone. Orgs disconnect
      // Stripe and OpenPhone and deactivate services. The milestone only
      // answers "did this ever happen", which turns a failed live check
      // into needs_attention.
      const [hasServices, hasStaff, sms, stripe, hasBookings, phoneRow, events] = await Promise.all([
        hasActiveService(organizationId),
        hasActiveStaff(organizationId),
        supabase.rpc('has_openphone_api_key', { _org_id: organizationId }),
        supabase.rpc('get_org_stripe_settings_safe', { p_organization_id: organizationId }),
        hasAnyRow('bookings', organizationId),
        supabase
          .from('organization_sms_settings')
          .select('openphone_phone_number_id')
          .eq('organization_id', organizationId)
          .maybeSingle(),
        supabase
          .from('organization_activation_events')
          .select('milestone')
          .eq('organization_id', organizationId),
      ]);

      if (sms.error) throw sms.error;
      if (stripe.error) throw stripe.error;
      if (phoneRow.error) throw phoneRow.error;
      // The ledger ships in a migration the owner runs by hand. Until that
      // table exists, the checklist still shows live status. needs_attention
      // stays unavailable, which is the same as never having a milestone.
      if (events.error && !missingActivationTable(events.error)) throw events.error;

      const recorded = new Set(
        (events.data ?? []).map((row) => row.milestone).filter((key): key is string => typeof key === 'string'),
      );
      const stripeRow = (stripe.data as { is_connected?: boolean | null; stripe_account_id?: string | null }[] | null)?.[0] ?? null;
      const live: Record<string, boolean> = {
        service_added: hasServices,
        staff_added: hasStaff,
        openphone_connected: openPhoneLiveConnected(sms.data === true, phoneRow.data?.openphone_phone_number_id),
        stripe_connected: stripeLiveConnected(stripeRow),
        first_job_booked: hasBookings,
      };

      const items: OnboardingItem[] = checklistMilestones().map((milestone) => {
        const state = setupStepState(live[milestone.key] === true, recorded.has(milestone.key));
        return {
          key: milestone.key,
          label: milestone.label,
          description: milestone.description,
          completed: state === 'done',
          state,
          attention: milestone.attention ?? milestone.label,
          link: milestone.link ?? '/dashboard',
          icon: milestone.icon ?? '',
        };
      });

      return items;
    },
    enabled: !!organizationId && enabled,
    // The checklist is the first thing a new owner sees. A persisted
    // "0 services" from the second before the insert committed must not
    // stick for the default 5 minute stale time.
    staleTime: 0,
  });
}
