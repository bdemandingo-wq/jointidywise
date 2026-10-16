import { useMemo, useState } from 'react';
import {
  Bell,
  Clock,
  Globe,
  LayoutGrid,
  Mail,
  MessageSquare,
  MoreVertical,
  RotateCcw,
  Settings2,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  CHANNELS,
  CATEGORIES,
  isChannelEnabled,
  isMasterChannelOn,
  type NotificationChannel,
  type NotificationTypeDef,
} from '@/lib/notificationCatalog';
import type { ChannelMatrix, PrefFlags, SnoozeMap } from '@/hooks/useNotificationPreferences';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { NotificationPreset } from '@/lib/notificationGroups';

const CHANNEL_ICON: Record<NotificationChannel, typeof Bell> = {
  sidebar: LayoutGrid,
  bell: Bell,
  browser_push: Globe,
  native_push: Smartphone,
  email: Mail,
  sms: MessageSquare,
};

const PRESETS: { key: NotificationPreset; label: string; description: string }[] = [
  { key: 'action', label: 'Action required', description: 'Sidebar and bell only, and only for items that need a response.' },
  { key: 'balanced', label: 'Recommended', description: 'The default mix for each event.' },
  { key: 'everything', label: 'Everything', description: 'Every event, on every channel except Also text me.' },
];

interface NotificationAdvancedPanelProps {
  types: NotificationTypeDef[];
  matrix: ChannelMatrix;
  channels: PrefFlags;
  snoozed: SnoozeMap;
  onChannel: (typeKey: string, channel: NotificationChannel, value: boolean) => void;
  onType: (type: NotificationTypeDef, value: boolean) => void;
  onCategory: (types: NotificationTypeDef[], value: boolean) => void;
  onMaster: (channel: NotificationChannel, value: boolean) => void;
  onPreset: (preset: NotificationPreset) => void;
  onSnooze: (typeKey: string, hours: number) => void;
  onUnsnooze: (typeKey: string) => void;
  onReset: () => void;
  resetting?: boolean;
}

function typeIsOn(type: NotificationTypeDef, matrix: ChannelMatrix, channels: PrefFlags) {
  return CHANNELS.some((channel) => isChannelEnabled(type.key, channel.key, matrix, {}, channels));
}

function ChannelEditor({
  type,
  matrix,
  channels,
  snoozed,
  onChannel,
}: {
  type: NotificationTypeDef;
  matrix: ChannelMatrix;
  channels: PrefFlags;
  snoozed: SnoozeMap;
  onChannel: NotificationAdvancedPanelProps['onChannel'];
}) {
  return (
    <div className="space-y-1">
      {CHANNELS.map((channel) => {
        const Icon = CHANNEL_ICON[channel.key];
        const masterOn = isMasterChannelOn(channel.key, channels);
        const on = isChannelEnabled(type.key, channel.key, matrix, snoozed, channels);
        const label = channel.key === 'sms' ? 'Also text me' : channel.label;
        return (
          <label
            key={channel.key}
            className={cn(
              'flex items-center justify-between gap-3 rounded-md px-2 py-3 min-h-[48px]',
              !masterOn && 'opacity-60',
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 text-primary shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm">{label}</span>
                {!masterOn && (
                  <span className="block text-[11px] text-muted-foreground">Turned off for everything</span>
                )}
              </span>
            </span>
            <Switch
              checked={on}
              disabled={!masterOn}
              onCheckedChange={(value) => onChannel(type.key, channel.key, value)}
              aria-label={`${type.label} — ${label}`}
              className="shrink-0"
            />
          </label>
        );
      })}
    </div>
  );
}

export function NotificationAdvancedPanel({
  types,
  matrix,
  channels,
  snoozed,
  onChannel,
  onType,
  onCategory,
  onMaster,
  onPreset,
  onSnooze,
  onUnsnooze,
  onReset,
  resetting,
}: NotificationAdvancedPanelProps) {
  const isMobile = useIsMobile();
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [editing, setEditing] = useState<NotificationTypeDef | null>(null);

  const grouped = useMemo(() => {
    return CATEGORIES.map((category) => ({
      category,
      types: types.filter((type) => type.category === category),
    })).filter((group) => group.types.length > 0);
  }, [types]);

  const snoozeActive = (typeKey: string) => {
    const iso = snoozed?.[typeKey];
    return !!iso && new Date(iso).getTime() > Date.now();
  };

  return (
    <div className="space-y-4" data-testid="notification-advanced">
      <div className="grid grid-cols-1 gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onPreset(preset.key)}
            className="rounded-md border px-3 py-2 text-left min-h-[44px] hover:bg-muted/40"
          >
            <span className="block text-sm font-medium">{preset.label}</span>
            <span className="block text-xs text-muted-foreground">{preset.description}</span>
          </button>
        ))}
      </div>

      <div className="rounded-lg border divide-y">
        {CHANNELS.map((channel) => {
          const Icon = CHANNEL_ICON[channel.key];
          const on = isMasterChannelOn(channel.key, channels);
          return (
            <label key={channel.key} className="flex items-center justify-between gap-3 px-3 py-3 min-h-[48px]">
              <span className="flex items-center gap-2 text-sm">
                <Icon className="h-4 w-4 text-primary shrink-0" />
                {channel.key === 'sms' ? 'Also text me' : channel.label} for every event
              </span>
              <Switch
                checked={on}
                onCheckedChange={(value) => onMaster(channel.key, value)}
                aria-label={`${channel.key === 'sms' ? 'Also text me' : channel.label} for every event`}
                className="shrink-0"
              />
            </label>
          );
        })}
      </div>

      <div className="space-y-2">
        {grouped.map(({ category, types: categoryTypes }) => {
          const open = openCategories.includes(category);
          const onCount = categoryTypes.filter((type) => typeIsOn(type, matrix, channels)).length;
          const allOn = onCount === categoryTypes.length;
          return (
            <div key={category} className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 px-2">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenCategories((prev) => (
                    prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
                  ))}
                  className="flex min-w-0 flex-1 items-center gap-2 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{category}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{onCount} of {categoryTypes.length} on</span>
                  </span>
                </button>
                <Switch
                  checked={allOn}
                  onCheckedChange={(value) => onCategory(categoryTypes, value)}
                  aria-label={`${allOn ? 'Turn off' : 'Turn on'} ${category}`}
                  className="shrink-0"
                />
              </div>
              {open && (
                <div className="border-t divide-y">
                  {categoryTypes.map((type) => {
                    const snoozedNow = snoozeActive(type.key);
                    const on = typeIsOn(type, matrix, channels);
                    const count = CHANNELS.filter((channel) =>
                      isChannelEnabled(type.key, channel.key, matrix, {}, channels),
                    ).length;
                    return (
                      <div key={type.key} className="flex items-center gap-2 px-3 py-3 min-h-[56px]">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm truncate">{type.label}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {snoozedNow ? 'Snoozed' : count === 0 ? 'Off' : `${count} channel${count === 1 ? '' : 's'}`}
                          </div>
                        </div>
                        <Switch
                          checked={on}
                          disabled={snoozedNow}
                          onCheckedChange={(value) => onType(type, value)}
                          aria-label={type.label}
                          className="shrink-0"
                        />
                        {isMobile ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 shrink-0"
                            disabled={!on}
                            onClick={() => setEditing(type)}
                            aria-label={`Channels for ${type.label}`}
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={!on}>
                                <Settings2 className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72" align="end">
                              <ChannelEditor
                                type={type}
                                matrix={matrix}
                                channels={channels}
                                snoozed={snoozed}
                                onChannel={onChannel}
                              />
                            </PopoverContent>
                          </Popover>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={`More for ${type.label}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {snoozedNow ? (
                              <DropdownMenuItem onClick={() => onUnsnooze(type.key)}>Un-snooze</DropdownMenuItem>
                            ) : (
                              <>
                                <DropdownMenuItem onClick={() => onSnooze(type.key, 1)}>
                                  <Clock className="h-3.5 w-3.5 mr-2" /> Snooze 1 hour
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onSnooze(type.key, 24)}>Snooze 24 hours</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onSnooze(type.key, 24 * 7)}>Snooze 1 week</DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={resetting} className="gap-2">
        <RotateCcw className="h-4 w-4" />
        Reset to recommended
      </Button>
      {snoozed && Object.keys(snoozed).length > 0 ? (
        <Badge variant="secondary" className="ml-2 align-middle">Snoozes saved</Badge>
      ) : null}

      <Sheet open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="bottom" className="pb-[calc(env(safe-area-inset-bottom)+16px)] max-h-[85vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle>{editing?.label}</SheetTitle>
            <SheetDescription>Choose where you’re notified.</SheetDescription>
          </SheetHeader>
          {editing && (
            <div className="mt-4">
              <ChannelEditor
                type={editing}
                matrix={matrix}
                channels={channels}
                snoozed={snoozed}
                onChannel={onChannel}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
