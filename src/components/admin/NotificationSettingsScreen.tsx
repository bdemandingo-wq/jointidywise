import type { ReactNode } from 'react';
import { Bell, ChevronDown, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { GroupVisual, OwnerDelivery } from '@/lib/notificationGroups';

export interface SettingsToggle {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
}

interface NotificationSettingsScreenProps {
  masters: { push: boolean; email: boolean; sms: boolean };
  onMaster: (delivery: OwnerDelivery, value: boolean) => void;
  pushDetail?: ReactNode;
  groups: SettingsToggle[];
  onGroup: (id: string, value: boolean) => void;
  groupDetail?: Partial<Record<string, ReactNode>>;
  customers: SettingsToggle[];
  onCustomer: (id: string, value: boolean) => void;
  customerNote?: string | null;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  advanced: ReactNode;
  error?: string | null;
}

const MASTERS: Array<{ id: OwnerDelivery; label: string; description: string; icon: typeof Bell }> = [
  {
    id: 'push',
    label: 'Push notifications',
    description: 'Alerts on this phone and in the browser.',
    icon: Smartphone,
  },
  {
    id: 'email',
    label: 'Email',
    description: 'Emails to you. The daily summary has its own switch.',
    icon: Mail,
  },
  {
    id: 'sms',
    label: 'Text messages',
    description: 'Texts to your phone about bookings and cleaners.',
    icon: MessageSquare,
  },
];

function ToggleRow({
  item,
  onChange,
  testId,
}: {
  item: SettingsToggle;
  onChange: (value: boolean) => void;
  testId: string;
}) {
  return (
    <label
      data-testid={testId}
      className={cn(
        'flex items-center gap-3 px-3 py-3 min-h-[56px] cursor-pointer',
        item.disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{item.label}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{item.description}</span>
      </span>
      <Switch
        checked={item.checked}
        disabled={item.disabled}
        onCheckedChange={onChange}
        aria-label={item.mixed ? `${item.label}, some on` : item.label}
        className="shrink-0"
      />
    </label>
  );
}

export function NotificationSettingsScreen({
  masters,
  onMaster,
  pushDetail,
  groups,
  onGroup,
  groupDetail,
  customers,
  onCustomer,
  customerNote,
  advancedOpen,
  onAdvancedOpenChange,
  advanced,
  error,
}: NotificationSettingsScreenProps) {
  return (
    <div data-testid="notification-settings" className="space-y-8 pb-36 md:pb-24">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">For you and your team</h2>
          <p className="text-sm text-muted-foreground mt-1">
            These alerts come to you. They do not text or email your customers.
          </p>
        </div>
        <div className="rounded-lg border bg-card divide-y">
          {MASTERS.map((master) => {
            const Icon = master.icon;
            return (
              <div key={master.id}>
                <ToggleRow
                  testId={`master-${master.id}`}
                  item={{
                    id: master.id,
                    label: master.label,
                    description: master.description,
                    checked: masters[master.id],
                  }}
                  onChange={(value) => onMaster(master.id, value)}
                />
                {master.id === 'push' && pushDetail ? (
                  <div className="px-3 pb-3 -mt-1">{pushDetail}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">What to tell you about</h2>
          <p className="text-sm text-muted-foreground mt-1">
            One switch per kind of update. Each one uses the delivery methods you turned on above.
          </p>
        </div>
        <div className="rounded-lg border bg-card divide-y">
          {groups.map((group) => (
            <div key={group.id}>
              <ToggleRow
                testId={`group-${group.id}`}
                item={group}
                onChange={(value) => onGroup(group.id, value)}
              />
              {groupDetail?.[group.id] ? (
                <div className="px-3 pb-3 -mt-1">{groupDetail[group.id]}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="rounded-lg border bg-card">
          <button
            type="button"
            data-testid="advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => onAdvancedOpenChange(!advancedOpen)}
            className="flex w-full items-center gap-3 px-3 py-3 min-h-[56px] text-left"
          >
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', advancedOpen && 'rotate-180')} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Advanced</span>
              <span className="block text-xs text-muted-foreground">Choose each event and where it goes.</span>
            </span>
          </button>
          {advancedOpen ? <div className="border-t px-3 py-3">{advanced}</div> : null}
        </div>
      </section>

      <section className="space-y-3" data-testid="customer-notifications">
        <div className="flex items-start gap-2">
          <Bell className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-foreground">Messages to your customers</h2>
            <p className="text-sm text-muted-foreground mt-1">
              These texts and emails go to the people you clean for. Turning them off does not change the alerts you get.
            </p>
          </div>
        </div>
        {customerNote ? (
          <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">{customerNote}</p>
        ) : null}
        <div className="rounded-lg border bg-card divide-y">
          {customers.map((item) => (
            <ToggleRow
              key={item.id}
              testId={`customer-${item.id}`}
              item={item}
              onChange={(value) => onCustomer(item.id, value)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
