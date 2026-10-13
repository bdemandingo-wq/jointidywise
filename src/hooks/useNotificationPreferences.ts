import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export type PrefFlags = Record<string, boolean>;
export type ChannelMatrix = Record<string, Record<string, boolean>>;
export type SnoozeMap = Record<string, string>; // typeKey -> ISO datetime

export interface NotificationPreferences {
  sidebar_badges: PrefFlags;
  bell_notifications: PrefFlags;
  channels: PrefFlags;
  notification_matrix: ChannelMatrix;
  snoozed_until: SnoozeMap;
}

// Canonical keys and recommended defaults. Anything not present in these maps
// falls back to `true` at read time — new features are surfaced by default.
export const SIDEBAR_DEFAULTS: PrefFlags = {
  'staff.time_off': true,
  'staff.documents': true,
  'staff.payout': true,
  'bookings.unassigned': true,
  'bookings.pending': true,
  'bookings.payment': true,
  'scheduler.time_off_conflicts': true,
  'scheduler.overlaps': true,
  'client_portal.requests': true,
  'client_portal.reschedule': true,
  'messages.unread': true,
  'tasks.open': false,
  'tasks.overdue': true,
  'leads.new': true,
  'leads.stale': false,
  'inventory.low': true,
  'automation.failed': true,
  'automation.stuck': true,
  'payments.stripe_requirements': true,
  'payments.failed_charges': true,
  'feedback.low_rating': true,
  'feedback.complaint': true,
};

export const BELL_DEFAULTS: PrefFlags = {
  'bell.new_booking_request': true,
  'bell.new_booking': false,
  'bell.time_off': true,
  'bell.staff_document': true,
  'bell.failed_payment': true,
  'bell.unread_message': true,
  'bell.new_lead': true,
  'bell.low_feedback': true,
  'bell.automation_failure': true,
  'bell.inventory_low': false,
  'bell.payroll': true,
  'bell.stripe_requirement': true,
};

export const CHANNEL_DEFAULTS: PrefFlags = {
  'channel.in_app_bell': true,
  'channel.sidebar_badge': true,
  'channel.browser_push': false,
  'channel.email_summary': false,
  'channel.sms_urgent': false,
};

export function mergedFlags(saved: PrefFlags | undefined | null, defaults: PrefFlags): PrefFlags {
  const out: PrefFlags = { ...defaults };
  if (saved) {
    for (const k of Object.keys(saved)) out[k] = !!saved[k];
  }
  return out;
}

/**
 * Read notification preferences for the current org. Returns merged values
 * (saved overrides defaults). Consumers should call `.sidebar_badges['staff.time_off']`
 * etc; unknown keys default to `true`.
 */
export function useNotificationPreferences() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: ['org-notification-prefs', orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<NotificationPreferences> => {
      if (!orgId) {
        return {
          sidebar_badges: { ...SIDEBAR_DEFAULTS },
          bell_notifications: { ...BELL_DEFAULTS },
          channels: { ...CHANNEL_DEFAULTS },
          notification_matrix: {},
          snoozed_until: {},
        };
      }
      const { data } = await (supabase as any)
        .from('organization_notification_preferences')
        .select('sidebar_badges, bell_notifications, channels, notification_matrix, snoozed_until')
        .eq('organization_id', orgId)
        .maybeSingle();
      return {
        sidebar_badges: mergedFlags(data?.sidebar_badges, SIDEBAR_DEFAULTS),
        bell_notifications: mergedFlags(data?.bell_notifications, BELL_DEFAULTS),
        channels: mergedFlags(data?.channels, CHANNEL_DEFAULTS),
        notification_matrix: (data?.notification_matrix || {}) as ChannelMatrix,
        snoozed_until: (data?.snoozed_until || {}) as SnoozeMap,
      };
    },
    staleTime: 60_000,
  });

  const data = query.data ?? {
    sidebar_badges: { ...SIDEBAR_DEFAULTS },
    bell_notifications: { ...BELL_DEFAULTS },
    channels: { ...CHANNEL_DEFAULTS },
    notification_matrix: {},
    snoozed_until: {},
  };
  // `loaded` is not a stored column. Callers must not write this object back.
  return { ...data, loaded: !!orgId && query.isFetched };
}

export function useUpdateNotificationPreferences() {
  const { organization } = useOrganization();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (
      patch: Partial<NotificationPreferences>,
      opts?: { replace?: Array<'notification_matrix' | 'snoozed_until' | 'channels'> },
    ) => {
      if (!orgId) return { error: 'No organization' } as const;
      setSaving(true);
      try {
        // Merge with existing to preserve keys the caller did not include.
        // `replace` swaps a column outright. Reset needs that: merging {} into
        // the matrix used to leave every saved override in place.
        const { data: existing } = await (supabase as any)
          .from('organization_notification_preferences')
          .select('sidebar_badges, bell_notifications, channels, notification_matrix, snoozed_until')
          .eq('organization_id', orgId)
          .maybeSingle();
        const replace = new Set(opts?.replace ?? []);
        const mergeMatrix = (base: ChannelMatrix | null | undefined, incoming: ChannelMatrix | undefined) => {
          const out: ChannelMatrix = { ...(base || {}) };
          for (const k of Object.keys(incoming || {})) {
            out[k] = { ...(base?.[k] || {}), ...(incoming?.[k] || {}) };
          }
          return out;
        };
        const payload = {
          organization_id: orgId,
          sidebar_badges: { ...(existing?.sidebar_badges || {}), ...(patch.sidebar_badges || {}) },
          bell_notifications: { ...(existing?.bell_notifications || {}), ...(patch.bell_notifications || {}) },
          channels: replace.has('channels')
            ? { ...(patch.channels || {}) }
            : { ...(existing?.channels || {}), ...(patch.channels || {}) },
          notification_matrix: replace.has('notification_matrix')
            ? { ...(patch.notification_matrix || {}) }
            : mergeMatrix(existing?.notification_matrix, patch.notification_matrix),
          snoozed_until: replace.has('snoozed_until')
            ? { ...(patch.snoozed_until || {}) }
            : { ...(existing?.snoozed_until || {}), ...(patch.snoozed_until || {}) },
          updated_at: new Date().toISOString(),
        };
        const { error } = await (supabase as any)
          .from('organization_notification_preferences')
          .upsert(payload, { onConflict: 'organization_id' });
        if (error) return { error: error.message } as const;
        await qc.invalidateQueries({ queryKey: ['org-notification-prefs', orgId] });
        return { error: null } as const;
      } finally {
        setSaving(false);
      }
    },
    [orgId, qc]
  );

  const setChannel = useCallback(
    async (typeKey: string, channel: string, value: boolean) => {
      return save({ notification_matrix: { [typeKey]: { [channel]: value } } });
    },
    [save]
  );

  const snoozeType = useCallback(
    async (typeKey: string, hours: number) => {
      const iso = new Date(Date.now() + hours * 3600_000).toISOString();
      return save({ snoozed_until: { [typeKey]: iso } });
    },
    [save]
  );

  const clearSnooze = useCallback(
    async (typeKey: string) => {
      return save({ snoozed_until: { [typeKey]: new Date(0).toISOString() } });
    },
    [save]
  );

  const resetToDefaults = useCallback(async () => {
    return save({
      sidebar_badges: { ...SIDEBAR_DEFAULTS },
      bell_notifications: { ...BELL_DEFAULTS },
      channels: { ...CHANNEL_DEFAULTS },
      notification_matrix: {},
      snoozed_until: {},
    }, { replace: ['notification_matrix', 'snoozed_until', 'channels'] });
  }, [save]);

  return { save, setChannel, snoozeType, clearSnooze, resetToDefaults, saving };
}
