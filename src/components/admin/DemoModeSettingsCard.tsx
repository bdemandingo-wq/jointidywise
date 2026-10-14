import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTestMode } from '@/contexts/TestModeContext';
import { useOrgDemoToggle } from '@/lib/demo/useOrgDemoToggle';

/**
 * Demo mode shows an in-memory cleaning business. Masking is the older
 * screen-share switch and still only hides names and amounts.
 */
export function DemoModeSettingsCard() {
  const { isTestMode, toggleTestMode } = useTestMode();
  const { on, publicDemo, toggle } = useOrgDemoToggle();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Demo mode</CardTitle>
        <CardDescription>
          Shows a sample cleaning business in this browser. Nothing is saved.
          Texts, email, payments, and edits stay off, including sends from the server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 min-h-[44px]">
          <Label htmlFor="demo-mode" className="text-sm font-medium">
            Enable demo mode
          </Label>
          <Switch
            id="demo-mode"
            checked={on}
            disabled={publicDemo}
            onCheckedChange={() => { void toggle(); }}
          />
        </div>
        <div className="flex items-center justify-between gap-4 min-h-[44px]">
          <div>
            <Label htmlFor="mask-mode" className="text-sm font-medium">
              Mask names and amounts
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Hides real names, emails, phones, and dollar amounts on screen.
              Your records stay as they are.
            </p>
          </div>
          <Switch
            id="mask-mode"
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
