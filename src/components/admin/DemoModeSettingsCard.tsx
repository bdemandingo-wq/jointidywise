import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTestMode } from '@/contexts/TestModeContext';

/**
 * Demo mode used to sit in every page header as an eye icon labelled
 * "Enable Demo Mode". The switch lives in Settings now. The header only
 * mentions it while it is already on, so a screen share can be turned off
 * without hunting.
 */
export function DemoModeSettingsCard() {
  const { isTestMode, toggleTestMode } = useTestMode();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demo mode</CardTitle>
        <CardDescription>
          Masks customer names, emails, phones, and dollar amounts on screen.
          Nothing in your account is changed. Turn it on before a screen share,
          then turn it off here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 min-h-[44px]">
          <Label htmlFor="demo-mode" className="text-sm font-medium">
            Enable demo mode
          </Label>
          <Switch
            id="demo-mode"
            checked={isTestMode}
            onCheckedChange={(checked) => {
              if (checked !== isTestMode) toggleTestMode();
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
