import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrgRole } from '@/hooks/useOrgRole';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type ChannelMatrix,
  type PrefFlags,
  type SnoozeMap,
} from '@/hooks/useNotificationPreferences';
import { useLegacyNotificationMigration } from '@/hooks/useLegacyNotificationMigration';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { NOTIFICATION_TYPES, CHANNELS, masterChannelKey, type NotificationChannel, type NotificationTypeDef } from '@/lib/notificationCatalog';
import {
  CUSTOMER_NOTIFICATION_TOGGLES,
  OWNER_NOTIFICATION_GROUPS,
  briefsVisual,
  groupCountsAsOn,
  groupVisual,
  matrixPatchForGroupToggle,
  ownerDeliveryEnabled,
  ownerDeliveryPatch,
  ownerSmsColumnUpdates,
  presetMatrix,
  type NotificationPreset,
  type OwnerDelivery,
} from '@/lib/notificationGroups';
import { NotificationSettingsScreen, type SettingsToggle } from '@/components/admin/NotificationSettingsScreen';
import { NotificationAdvancedPanel } from '@/components/admin/NotificationAdvancedPanel';

type BusinessFlagPatch = {
  notify_morning_brief?: boolean;
  notify_evening_brief?: boolean;
  notify_new_booking?: boolean;
  notify_cancellations?: boolean;
  notify_reminders?: boolean;
};

type SmsFlagPatch = {
  notify_admin_on_the_way?: boolean;
  notify_admin_arrived?: boolean;
  notify_client_on_the_way?: boolean;
  notify_client_arrived?: boolean;
  notify_client_distance_eta?: boolean;
  sms_booking_confirmation?: boolean;
  sms_appointment_reminder?: boolean;
};

function rowFor(type: NotificationTypeDef, on: boolean): Record<string, boolean> {
  const row: Record<string, boolean> = {};
  for (const channel of CHANNELS) {
    row[channel.key] = on ? !!type.defaults?.[channel.key] : false;
  }
  return row;
}

function customerSmsPatch(id: string, value: boolean): SmsFlagPatch {
  switch (id) {
    case 'notify_client_on_the_way':
      return { notify_client_on_the_way: value };
    case 'notify_client_arrived':
      return { notify_client_arrived: value };
    case 'notify_client_distance_eta':
      return { notify_client_distance_eta: value };
    case 'sms_booking_confirmation':
      return { sms_booking_confirmation: value };
    case 'sms_appointment_reminder':
      return { sms_appointment_reminder: value };
    default:
      return {};
  }
}

export function NotificationPreferencesCard() {
  const prefs = useNotificationPreferences();
  const { save, snoozeType, clearSnooze, resetToDefaults } = useUpdateNotificationPreferences();
  const { hasFinancialAccess } = useOrgRole();
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;
  const queryClient = useQueryClient();
  const push = usePushNotifications();
  useLegacyNotificationMigration();

  const delivery = useQuery({
    queryKey: ['notification-settings-delivery', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      if (!orgId) return { business: null, sms: null };
      const [business, sms] = await Promise.all([
        supabase
          .from('business_settings')
          .select('notify_morning_brief, notify_evening_brief, notify_reminders, notify_new_booking, notify_cancellations')
          .eq('organization_id', orgId)
          .maybeSingle(),
        supabase
          .from('organization_sms_settings')
          .select('id, notify_client_on_the_way, notify_client_arrived, notify_client_distance_eta, sms_booking_confirmation, sms_appointment_reminder, notify_admin_on_the_way, notify_admin_arrived')
          .eq('organization_id', orgId)
          .maybeSingle(),
      ]);
      if (business.error) throw new Error(business.error.message);
      if (sms.error) throw new Error(sms.error.message);
      return { business: business.data, sms: sms.data };
    },
  });

  const [matrix, setMatrix] = useState<ChannelMatrix>(prefs.notification_matrix);
  const [channels, setChannels] = useState<PrefFlags>(prefs.channels);
  const [snoozed, setSnoozed] = useState<SnoozeMap>(prefs.snoozed_until);
  const [briefs, setBriefs] = useState({ morning: true, evening: true });
  const [customerFlags, setCustomerFlags] = useState<Record<string, boolean>>({});
  const [smsReady, setSmsReady] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [sendingBrief, setSendingBrief] = useState<'morning' | 'evening' | null>(null);

  const pending = useRef(0);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    if (pending.current > 0) return;
    setMatrix(prefs.notification_matrix);
    setChannels(prefs.channels);
    setSnoozed(prefs.snoozed_until);
  }, [prefs.notification_matrix, prefs.channels, prefs.snoozed_until]);

  useEffect(() => {
    if (pending.current > 0 || !delivery.data) return;
    const business = delivery.data.business;
    const sms = delivery.data.sms;
    setBriefs({
      morning: business?.notify_morning_brief ?? true,
      evening: business?.notify_evening_brief ?? true,
    });
    setSmsReady(!!sms);
    const next: Record<string, boolean> = {
      notify_reminders: business?.notify_reminders !== false,
    };
    if (sms) {
      next.notify_client_on_the_way = sms.notify_client_on_the_way !== false;
      next.notify_client_arrived = sms.notify_client_arrived !== false;
      next.notify_client_distance_eta = sms.notify_client_distance_eta !== false;
      next.sms_booking_confirmation = sms.sms_booking_confirmation !== false;
      next.sms_appointment_reminder = sms.sms_appointment_reminder !== false;
    }
    setCustomerFlags(next);
  }, [delivery.data]);

  const run = (task: () => Promise<void>) => {
    pending.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        await task();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save');
      } finally {
        pending.current -= 1;
      }
    });
  };

  const report = (error: string | null | undefined) => {
    if (error) toast.error(error);
    else toast.success('Saved', { id: 'notification-prefs-saved' });
  };

  const writeBusiness = async (patch: BusinessFlagPatch) => {
    if (!orgId) return 'No organization';
    const { error } = await supabase.from('business_settings').update(patch).eq('organization_id', orgId);
    return error?.message ?? null;
  };

  const writeSms = async (patch: SmsFlagPatch) => {
    if (!orgId) return 'No organization';
    if (!smsReady) return null;
    const { error } = await supabase.from('organization_sms_settings').update(patch).eq('organization_id', orgId);
    return error?.message ?? null;
  };

  const lockOpts = { includeManagerLocked: hasFinancialAccess };
  const visibleTypes = useMemo(
    () => NOTIFICATION_TYPES.filter((type) => !type.managerLocked || hasFinancialAccess),
    [hasFinancialAccess],
  );

  const handleMaster = (deliveryId: OwnerDelivery, on: boolean) => {
    const patch = ownerDeliveryPatch(deliveryId, on);
    const nextChannels = { ...channels, ...patch };
    setChannels(nextChannels);
    const bookingsOn = groupCountsAsOn(groupVisual('bookings', matrix, lockOpts));
    const cleanerOn = groupCountsAsOn(groupVisual('cleaner', matrix, lockOpts));
    run(async () => {
      const res = await save({ channels: patch });
      let extra: string | null = null;
      if (!res?.error && deliveryId === 'sms') {
        const updates = ownerSmsColumnUpdates({ smsMasterOn: on, bookingsOn, cleanerOn });
        extra = (await writeBusiness({
          notify_new_booking: updates.business.notify_new_booking,
          notify_cancellations: updates.business.notify_cancellations,
        })) || (await writeSms({
          notify_admin_on_the_way: updates.sms.notify_admin_on_the_way,
          notify_admin_arrived: updates.sms.notify_admin_arrived,
        }));
      }
      report(res?.error || extra);
    });
  };

  const handleGroup = (id: string, on: boolean) => {
    if (id === 'daily') {
      setBriefs({ morning: on, evening: on });
      run(async () => {
        const err = await writeBusiness({ notify_morning_brief: on, notify_evening_brief: on });
        if (!err) {
          await queryClient.invalidateQueries({ queryKey: ['notification-settings-delivery', orgId] });
        }
        report(err);
      });
      return;
    }
    const patch = matrixPatchForGroupToggle(id, on, matrix, lockOpts);
    const nextMatrix = { ...matrix, ...patch };
    setMatrix(nextMatrix);
    const bookingsOn = id === 'bookings'
      ? on
      : groupCountsAsOn(groupVisual('bookings', nextMatrix, lockOpts));
    const cleanerOn = id === 'cleaner'
      ? on
      : groupCountsAsOn(groupVisual('cleaner', nextMatrix, lockOpts));
    const smsOn = ownerDeliveryEnabled('sms', channels);
    run(async () => {
      const res = await save({ notification_matrix: patch });
      let extra: string | null = null;
      if (!res?.error && (id === 'bookings' || id === 'cleaner')) {
        const updates = ownerSmsColumnUpdates({ smsMasterOn: smsOn, bookingsOn, cleanerOn });
        if (id === 'bookings') {
          extra = await writeBusiness({
            notify_new_booking: updates.business.notify_new_booking,
            notify_cancellations: updates.business.notify_cancellations,
          });
        }
        if (id === 'cleaner') {
          extra = await writeSms({
            notify_admin_on_the_way: updates.sms.notify_admin_on_the_way,
            notify_admin_arrived: updates.sms.notify_admin_arrived,
          });
        }
      }
      report(res?.error || extra);
    });
  };

  const handleCustomer = (id: string, value: boolean) => {
    setCustomerFlags((prev) => ({ ...prev, [id]: value }));
    const toggle = CUSTOMER_NOTIFICATION_TOGGLES.find((item) => item.id === id);
    if (!toggle) return;
    run(async () => {
      const err = toggle.table === 'business_settings'
        ? await writeBusiness({ notify_reminders: value })
        : await writeSms(customerSmsPatch(id, value));
      if (!err) {
        await queryClient.invalidateQueries({ queryKey: ['notification-settings-delivery', orgId] });
      }
      report(err);
    });
  };

  const handleChannel = (typeKey: string, channel: NotificationChannel, value: boolean) => {
    setMatrix((prev) => ({ ...prev, [typeKey]: { ...(prev[typeKey] || {}), [channel]: value } }));
    run(async () => {
      const res = await save({ notification_matrix: { [typeKey]: { [channel]: value } } });
      report(res?.error);
    });
  };

  const handleType = (type: NotificationTypeDef, on: boolean) => {
    const row = rowFor(type, on);
    setMatrix((prev) => ({ ...prev, [type.key]: row }));
    run(async () => {
      const res = await save({ notification_matrix: { [type.key]: row } });
      report(res?.error);
    });
  };

  const handleCategory = (categoryTypes: NotificationTypeDef[], on: boolean) => {
    const patch: ChannelMatrix = {};
    for (const type of categoryTypes) patch[type.key] = rowFor(type, on);
    setMatrix((prev) => ({ ...prev, ...patch }));
    run(async () => {
      const res = await save({ notification_matrix: patch });
      report(res?.error);
    });
  };

  const handleAdvancedMaster = (channel: NotificationChannel, value: boolean) => {
    const key = masterChannelKey(channel);
    setChannels((prev) => ({ ...prev, [key]: value }));
    const bookingsOn = groupCountsAsOn(groupVisual('bookings', matrix, lockOpts));
    const cleanerOn = groupCountsAsOn(groupVisual('cleaner', matrix, lockOpts));
    run(async () => {
      const res = await save({ channels: { [key]: value } });
      let extra: string | null = null;
      if (!res?.error && channel === 'sms') {
        const updates = ownerSmsColumnUpdates({ smsMasterOn: value, bookingsOn, cleanerOn });
        extra = (await writeBusiness({
          notify_new_booking: updates.business.notify_new_booking,
          notify_cancellations: updates.business.notify_cancellations,
        })) || (await writeSms({
          notify_admin_on_the_way: updates.sms.notify_admin_on_the_way,
          notify_admin_arrived: updates.sms.notify_admin_arrived,
        }));
      }
      report(res?.error || extra);
    });
  };

  const handlePreset = (preset: NotificationPreset) => {
    const built = presetMatrix(preset, visibleTypes);
    const channelPatch = {
      ...ownerDeliveryPatch('push', true),
      ...ownerDeliveryPatch('email', true),
      ...ownerDeliveryPatch('sms', true),
    };
    const nextMatrix = { ...matrix, ...built };
    setMatrix(nextMatrix);
    setChannels((prev) => ({ ...prev, ...channelPatch }));
    const bookingsOn = groupCountsAsOn(groupVisual('bookings', nextMatrix, lockOpts));
    const cleanerOn = groupCountsAsOn(groupVisual('cleaner', nextMatrix, lockOpts));
    run(async () => {
      const res = await save({ notification_matrix: built, channels: channelPatch });
      let extra: string | null = null;
      if (!res?.error) {
        const updates = ownerSmsColumnUpdates({ smsMasterOn: true, bookingsOn, cleanerOn });
        extra = (await writeBusiness({
          notify_new_booking: updates.business.notify_new_booking,
          notify_cancellations: updates.business.notify_cancellations,
        })) || (await writeSms({
          notify_admin_on_the_way: updates.sms.notify_admin_on_the_way,
          notify_admin_arrived: updates.sms.notify_admin_arrived,
        }));
      }
      report(res?.error || extra);
    });
  };

  const handleSnooze = (typeKey: string, hours: number) => {
    const iso = new Date(Date.now() + hours * 3600_000).toISOString();
    setSnoozed((prev) => ({ ...prev, [typeKey]: iso }));
    run(async () => {
      const res = await snoozeType(typeKey, hours);
      if (!res?.error) toast.success(hours === 1 ? 'Snoozed for 1 hour' : `Snoozed for ${hours} hours`, { id: 'notification-prefs-saved' });
      else toast.error(res.error);
    });
  };

  const handleUnsnooze = (typeKey: string) => {
    setSnoozed((prev) => ({ ...prev, [typeKey]: new Date(0).toISOString() }));
    run(async () => {
      const res = await clearSnooze(typeKey);
      report(res?.error);
    });
  };

  const handleReset = () => {
    setResetting(true);
    run(async () => {
      const res = await resetToDefaults();
      const businessErr = await writeBusiness({
        notify_morning_brief: true,
        notify_evening_brief: true,
        notify_new_booking: true,
        notify_cancellations: true,
      });
      const smsErr = await writeSms({
        notify_admin_on_the_way: true,
        notify_admin_arrived: true,
      });
      await queryClient.invalidateQueries({ queryKey: ['notification-settings-delivery', orgId] });
      setResetting(false);
      report(res?.error || businessErr || smsErr);
    });
  };

  const sendBrief = async (which: 'morning' | 'evening') => {
    if (!orgId) return;
    setSendingBrief(which);
    const fn = which === 'morning' ? 'morning-brief' : 'evening-brief';
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { org_id: orgId } });
      if (error) throw new Error(error.message);
      if (data?.skipped) toast.warning(`Skipped: ${data.reason || 'not eligible'}`);
      else toast.success(which === 'morning' ? 'Morning brief sent' : 'End-of-day report sent');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send';
      toast.error(message);
    } finally {
      setSendingBrief(null);
    }
  };

  const groups: SettingsToggle[] = OWNER_NOTIFICATION_GROUPS.map((group) => {
    if (group.id === 'daily') {
      const visual = briefsVisual(briefs.morning, briefs.evening);
      return {
        id: group.id,
        label: group.label,
        description: visual === 'mixed'
          ? `${group.description} Right now only the ${briefs.morning ? 'morning brief' : 'end-of-day report'} is on.`
          : group.description,
        checked: visual !== 'off',
        mixed: visual === 'mixed',
      };
    }
    const visual = groupVisual(group.id, matrix, lockOpts);
    return {
      id: group.id,
      label: group.label,
      description: visual === 'mixed'
        ? `${group.description} Some of these are customized in Advanced.`
        : group.description,
      checked: visual !== 'off',
      mixed: visual === 'mixed',
    };
  });

  const customers: SettingsToggle[] = CUSTOMER_NOTIFICATION_TOGGLES.map((toggle) => ({
    id: toggle.id,
    label: toggle.label,
    description: toggle.description,
    checked: customerFlags[toggle.id] ?? true,
    disabled: !delivery.isFetched || (toggle.table === 'organization_sms_settings' && !smsReady),
  }));

  const customerNote = delivery.isFetched && !smsReady
    ? 'Texting is not set up yet, so those switches are off. Connect it in Settings → SMS. The reminder email still works.'
    : null;

  const pushDetail = (
    <div className="space-y-1">
      {push.isRegistered ? (
        <p className="text-xs text-muted-foreground">This phone is registered for push.</p>
      ) : push.status.phase === 'failed' && push.isSupported ? (
        <>
          {push.status.message ? (
            <p className="text-xs text-destructive">{push.status.message}</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={push.isRegistering}
            onClick={() => { void push.registerDevice({ organizationId: orgId }); }}
          >
            {push.isRegistering ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Try again'}
          </Button>
        </>
      ) : push.isSupported ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={push.isRegistering}
          onClick={() => { void push.registerDevice({ organizationId: orgId }); }}
        >
          {push.isRegistering ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enable on this phone'}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Push is not available in this browser.</p>
      )}
    </div>
  );

  const error = delivery.error instanceof Error ? delivery.error.message : null;

  return (
    <NotificationSettingsScreen
      masters={{
        push: ownerDeliveryEnabled('push', channels),
        email: ownerDeliveryEnabled('email', channels),
        sms: ownerDeliveryEnabled('sms', channels),
      }}
      onMaster={handleMaster}
      pushDetail={pushDetail}
      groups={groups}
      onGroup={handleGroup}
      groupDetail={{
        daily: (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={sendingBrief !== null} onClick={() => { void sendBrief('morning'); }}>
              {sendingBrief === 'morning' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Send morning brief
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={sendingBrief !== null} onClick={() => { void sendBrief('evening'); }}>
              {sendingBrief === 'evening' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Send end-of-day report
            </Button>
          </div>
        ),
      }}
      customers={customers}
      onCustomer={handleCustomer}
      customerNote={customerNote}
      advancedOpen={advancedOpen}
      onAdvancedOpenChange={setAdvancedOpen}
      error={error}
      advanced={(
        <NotificationAdvancedPanel
          types={visibleTypes}
          matrix={matrix}
          channels={channels}
          snoozed={snoozed}
          onChannel={handleChannel}
          onType={handleType}
          onCategory={handleCategory}
          onMaster={handleAdvancedMaster}
          onPreset={handlePreset}
          onSnooze={handleSnooze}
          onUnsnooze={handleUnsnooze}
          onReset={handleReset}
          resetting={resetting}
        />
      )}
    />
  );
}
