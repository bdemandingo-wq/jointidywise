import { useState } from 'react';
import { toast } from 'sonner';
import { Home, Calendar, CalendarDays, BarChart3, Plus, Sparkles } from 'lucide-react';
import { NOTIFICATION_TYPES } from '@/lib/notificationCatalog';
import {
  CUSTOMER_NOTIFICATION_TOGGLES,
  OWNER_NOTIFICATION_GROUPS,
  OWNER_TEXT_EVENTS,
  ownerTextMeEnabled,
  briefsVisual,
  groupVisual,
  matrixPatchForGroupToggle,
  ownerDeliveryEnabled,
  ownerDeliveryPatch,
  presetMatrix,
  type ChannelMatrix,
  type FlagMap,
  type OwnerDelivery,
  type SnoozeMap,
} from '@/lib/notificationGroups';
import { NotificationSettingsScreen, type SettingsToggle } from '@/components/admin/NotificationSettingsScreen';
import { NotificationAdvancedPanel } from '@/components/admin/NotificationAdvancedPanel';

/**
 * Dev-only render of the notification settings screen with fixture preferences.
 * Nothing here calls Supabase, email, SMS, or push.
 */
export default function NotificationSettingsPreview() {
  const [matrix, setMatrix] = useState<ChannelMatrix>({});
  const [channels, setChannels] = useState<FlagMap>({});
  const [snoozed, setSnoozed] = useState<SnoozeMap>({});
  const [briefs, setBriefs] = useState({ morning: true, evening: true });
  const [customer, setCustomer] = useState<Record<string, boolean>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const groups: SettingsToggle[] = OWNER_NOTIFICATION_GROUPS.map((group) => {
    if (group.id === 'daily') {
      const visual = briefsVisual(briefs.morning, briefs.evening);
      return {
        id: group.id,
        label: group.label,
        description: group.description,
        checked: visual !== 'off',
        mixed: visual === 'mixed',
      };
    }
    const visual = groupVisual(group.id, matrix);
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

  const onMaster = (delivery: OwnerDelivery, on: boolean) => {
    setChannels((prev) => ({ ...prev, ...ownerDeliveryPatch(delivery, on) }));
    toast.success('Saved', { id: 'notification-prefs-saved' });
  };

  const onGroup = (id: string, on: boolean) => {
    if (id === 'daily') {
      setBriefs({ morning: on, evening: on });
    } else {
      const patch = matrixPatchForGroupToggle(id, on, matrix);
      setMatrix((prev) => ({ ...prev, ...patch }));
    }
    toast.success('Saved', { id: 'notification-prefs-saved' });
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="portal-v2 mx-auto min-h-screen max-w-[430px] bg-background">
        <header className="px-3 pt-[max(12px,env(safe-area-inset-top))] pb-2">
          <h1 className="text-lg font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">Choose what you and your customers hear about</p>
        </header>
        <main className="px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))]">
          <NotificationSettingsScreen
            masters={{
              push: ownerDeliveryEnabled('push', channels),
              email: ownerDeliveryEnabled('email', channels),
              sms: ownerDeliveryEnabled('sms', channels),
            }}
            onMaster={onMaster}
            pushDetail={<p className="text-xs text-muted-foreground">This phone is registered for push.</p>}
            installBanner="Install the TidyWise iPhone app to get alerts as push notifications. Until then, we'll email them."
            ownerTexts={OWNER_TEXT_EVENTS.map((event) => ({
              id: event.key,
              label: `Also text me — ${event.label}`,
              description: 'A text to your alert numbers, in addition to the push and the bell.',
              checked: ownerTextMeEnabled(event.key, matrix, channels),
            }))}
            onOwnerText={(id, value) => {
              setMatrix((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), sms: value } }));
              if (value) setChannels((prev) => ({ ...prev, ...ownerDeliveryPatch('sms', true) }));
              toast.success('Saved', { id: 'notification-prefs-saved' });
            }}
            groups={groups}
            onGroup={onGroup}
            customers={CUSTOMER_NOTIFICATION_TOGGLES.map((toggle) => ({
              id: toggle.id,
              label: toggle.label,
              description: toggle.description,
              checked: customer[toggle.id] ?? true,
            }))}
            onCustomer={(id, value) => {
              setCustomer((prev) => ({ ...prev, [id]: value }));
              toast.success('Saved', { id: 'notification-prefs-saved' });
            }}
            advancedOpen={advancedOpen}
            onAdvancedOpenChange={setAdvancedOpen}
            advanced={(
              <NotificationAdvancedPanel
                types={NOTIFICATION_TYPES}
                matrix={matrix}
                channels={channels}
                snoozed={snoozed}
                onChannel={(typeKey, channel, value) => {
                  setMatrix((prev) => ({ ...prev, [typeKey]: { ...(prev[typeKey] || {}), [channel]: value } }));
                  toast.success('Saved', { id: 'notification-prefs-saved' });
                }}
                onType={() => toast.success('Saved', { id: 'notification-prefs-saved' })}
                onCategory={() => toast.success('Saved', { id: 'notification-prefs-saved' })}
                onMaster={(channel, value) => {
                  setChannels((prev) => ({ ...prev, [`master.${channel}`]: value }));
                  toast.success('Saved', { id: 'notification-prefs-saved' });
                }}
                onPreset={(preset) => {
                  setMatrix(presetMatrix(preset, NOTIFICATION_TYPES));
                  toast.success('Saved', { id: 'notification-prefs-saved' });
                }}
                onSnooze={(typeKey, hours) => {
                  setSnoozed((prev) => ({ ...prev, [typeKey]: new Date(Date.now() + hours * 3600_000).toISOString() }));
                  toast.success('Saved', { id: 'notification-prefs-saved' });
                }}
                onUnsnooze={(typeKey) => {
                  setSnoozed((prev) => ({ ...prev, [typeKey]: new Date(0).toISOString() }));
                }}
                onReset={() => {
                  setMatrix({});
                  setChannels({});
                  setSnoozed({});
                  setBriefs({ morning: true, evening: true });
                  toast.success('Saved', { id: 'notification-prefs-saved' });
                }}
              />
            )}
          />
        </main>
        <nav
          className="fixed bottom-0 left-1/2 z-50 w-full max-w-[430px] -translate-x-1/2 border-t bg-background/95 pb-[env(safe-area-inset-bottom)]"
          aria-label="Primary"
        >
          <div className="grid grid-cols-5 items-end">
            <NavIcon icon={Home} label="Dashboard" />
            <NavIcon icon={Calendar} label="Calendar" />
            <div className="flex items-center justify-center relative">
              <span className="absolute -top-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-6 w-6" />
              </span>
              <div className="h-12" />
            </div>
            <NavIcon icon={CalendarDays} label="Bookings" />
            <NavIcon icon={BarChart3} label="Reports" />
          </div>
        </nav>
        <button
          type="button"
          aria-label="Open Tidy"
          className="fixed bottom-[calc(7rem+env(safe-area-inset-bottom))] right-[max(1rem,calc(50vw-215px+1rem))] z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}

function NavIcon({ icon: Icon, label }: { icon: typeof Home; label: string }) {
  return (
    <div className="flex h-12 flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
      <Icon className="h-[18px] w-[18px]" />
      <span>{label}</span>
    </div>
  );
}
