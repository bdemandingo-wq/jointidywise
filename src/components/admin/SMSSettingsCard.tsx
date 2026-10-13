import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MessageSquare, ExternalLink, CheckCircle2, Save, Loader2, Eye, EyeOff, Send, Clock, ArrowRight } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface SMSSettings {
  id?: string;
  openphone_api_key: string;
  openphone_phone_number_id: string;
  sms_enabled: boolean;
  sms_booking_confirmation: boolean;
  sms_appointment_reminder: boolean;
  sms_post_booking_upsell: boolean;
  reminder_hours_before: number;
}

const defaultSettings: SMSSettings = {
  openphone_api_key: '',
  openphone_phone_number_id: '',
  sms_enabled: false,
  sms_booking_confirmation: true,
  sms_appointment_reminder: true,
  sms_post_booking_upsell: false,
  reminder_hours_before: 24,
};

export function SMSSettingsCard() {
  const { organization } = useOrganization();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SMSSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasExistingApiKey, setHasExistingApiKey] = useState(false);

  useEffect(() => {
    if (organization?.id) {
      fetchSettings();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSettings is recreated each render; runs once per org
  }, [organization?.id]);

  const fetchSettings = async () => {
    try {
      // Note: openphone_api_key is intentionally NOT selected — column access is
      // revoked from the Data API. We only fetch a boolean indicator via RPC.
      const { data, error } = await supabase
        .from('organization_sms_settings')
        .select('id, openphone_phone_number_id, sms_enabled, sms_booking_confirmation, sms_appointment_reminder, sms_post_booking_upsell, reminder_hours_before')
        .eq('organization_id', organization!.id)
        .maybeSingle();

      if (error) throw error;

      const { data: hasKey } = await supabase.rpc('has_openphone_api_key', {
        _org_id: organization!.id,
      });
      setHasExistingApiKey(hasKey === true);

      if (data) {
        setSettings({
          id: data.id,
          openphone_api_key: '',
          openphone_phone_number_id: data.openphone_phone_number_id || '',
          sms_enabled: data.sms_enabled || false,
          sms_booking_confirmation: data.sms_booking_confirmation ?? true,
          sms_appointment_reminder: data.sms_appointment_reminder ?? true,
          sms_post_booking_upsell: (data as any).sms_post_booking_upsell ?? false,
          reminder_hours_before: data.reminder_hours_before || 24,
        });
      }
    } catch (error) {
      console.error('Error fetching SMS settings:', error);
    } finally {
      setLoading(false);
    }
  };

  // Extract phone number ID from full URL if pasted
  const extractPhoneNumberId = (input: string): string => {
    const trimmed = input.trim();
    
    // Try to extract PN... pattern from anywhere in the string (handles any URL format)
    const pnMatch = trimmed.match(/(PN[a-zA-Z0-9]+)/);
    if (pnMatch) return pnMatch[1];
    
    // If it's a path like /inbox/xxx or /phone-numbers/xxx without PN prefix
    const pathMatch = trimmed.match(/(?:phone-numbers|inbox)\/([A-Za-z0-9]+)$/);
    if (pathMatch) return pathMatch[1];
    
    // Otherwise return trimmed input
    return trimmed;
  };

  const saveSettings = async () => {
    if (!organization?.id) return;

    setSaving(true);
    try {
      // Extract/normalize values in case user pasted full URL or included prefix/whitespace
      const cleanPhoneNumberId = extractPhoneNumberId(settings.openphone_phone_number_id);
      const typedApiKey = settings.openphone_api_key.trim().replace(/^Bearer\s+/i, '');

      // Only include the api key if the user actually typed a new value — we never
      // read it back from the DB, so empty means "leave existing value alone".
      const baseData: Record<string, unknown> = {
        organization_id: organization.id,
        openphone_phone_number_id: cleanPhoneNumberId,
        sms_enabled: settings.sms_enabled,
        sms_booking_confirmation: settings.sms_booking_confirmation,
        sms_appointment_reminder: settings.sms_appointment_reminder,
        sms_post_booking_upsell: settings.sms_post_booking_upsell,
        reminder_hours_before: settings.reminder_hours_before,
      };
      if (typedApiKey) baseData.openphone_api_key = typedApiKey;

      if (settings.id) {
        const { error } = await supabase
          .from('organization_sms_settings')
          .update(baseData as any)
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('organization_sms_settings')
          .insert(baseData as any)
          .select('id')
          .single();
        if (error) throw error;
        setSettings(prev => ({ ...prev, id: data.id }));
      }

      // Clear the API key field after save and mark key as on file
      if (typedApiKey) setHasExistingApiKey(true);
      setSettings(prev => ({
        ...prev,
        openphone_phone_number_id: cleanPhoneNumberId,
        openphone_api_key: '',
      }));
      toast.success('SMS settings saved successfully');
    } catch (error) {
      console.error('Error saving SMS settings:', error);
      toast.error('Failed to save SMS settings');
    } finally {
      setSaving(false);
    }
  };

  const testSMS = async () => {
    if (!testPhone) {
      toast.error('Please enter a phone number to test');
      return;
    }

    if ((!settings.openphone_api_key && !hasExistingApiKey) || !settings.openphone_phone_number_id) {
      toast.error('Please configure your OpenPhone API Key and Phone Number ID first');
      return;
    }

    if (!settings.sms_enabled) {
      toast.error('Please enable SMS notifications and save settings first');
      return;
    }

    // Save settings first to ensure the database is up to date
    if (!settings.id) {
      toast.error('Please save your settings before testing');
      return;
    }

    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-openphone-sms', {
        body: {
          to: testPhone,
          message: `Test SMS from ${organization?.name || 'your business'}. Your SMS integration is working correctly!`,
          organizationId: organization?.id,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Test SMS sent successfully!');
      } else {
        throw new Error(data?.error || 'Failed to send test SMS');
      }
    } catch (error: any) {
      console.error('Error sending test SMS:', error);
      toast.error(error.message || 'Failed to send test SMS');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            SMS Notifications (OpenPhone)
            {settings.sms_enabled ? (
              <Badge variant="default" className="ml-2 bg-green-500">Active</Badge>
            ) : (
              <Badge variant="secondary" className="ml-2">Disabled</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Send automatic SMS notifications to customers for booking confirmations and reminders
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable SMS */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Enable SMS Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Turn on SMS notifications for your customers
              </p>
            </div>
            <Switch
              checked={settings.sms_enabled}
              onCheckedChange={(checked) => setSettings(prev => ({ ...prev, sms_enabled: checked }))}
            />
          </div>

          {/* API Configuration */}
          <div className="space-y-4">
            <h4 className="font-semibold">OpenPhone API Configuration</h4>
            
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showApiKey ? 'text' : 'password'}
                  value={settings.openphone_api_key}
                  onChange={(e) => setSettings(prev => ({ ...prev, openphone_api_key: e.target.value }))}
                  placeholder={hasExistingApiKey ? '•••••••• (key on file, leave blank to keep)' : 'Enter your OpenPhone API key'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {hasExistingApiKey && (
                <p className="text-xs text-muted-foreground">
                  For security, the saved API key is never displayed. Enter a new key only if you want to replace it.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumberId">Phone Number ID</Label>
              <Input
                id="phoneNumberId"
                value={settings.openphone_phone_number_id}
                onChange={(e) => setSettings(prev => ({ ...prev, openphone_phone_number_id: e.target.value }))}
                placeholder="e.g., PNr7XukuaV (not the full URL)"
              />
              <p className="text-xs text-muted-foreground">
                Just the ID (starts with PN...), not the full URL
              </p>
            </div>
          </div>

          {/* Post-booking upsell (opt-in) */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-0.5 pr-4">
              <Label className="text-base font-medium">Post-Booking Upsell SMS</Label>
              <p className="text-sm text-muted-foreground">
                After a booking is confirmed, automatically text the customer suggesting add-ons
                (Inside Oven, Inside Fridge, etc.). Off by default.
              </p>
            </div>
            <Switch
              checked={settings.sms_post_booking_upsell}
              onCheckedChange={(checked) => setSettings(prev => ({ ...prev, sms_post_booking_upsell: checked }))}
            />
          </div>

          {/* Reminder schedule moved notice */}
          <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Notification & Reminder Settings</p>
              <p className="text-xs text-muted-foreground">
                Reminder schedules have moved to Automation Center → Automations
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => navigate('/dashboard/automation-center')}
            >
              Go to Automations
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <Button onClick={saveSettings} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Test SMS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Test SMS
          </CardTitle>
          <CardDescription>
            Send a test message to verify your integration is working
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="testPhone">Phone Number</Label>
              <Input
                id="testPhone"
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="flex items-end">
              <Button 
                onClick={testSMS} 
                disabled={testing || (!settings.openphone_api_key && !hasExistingApiKey) || !settings.sms_enabled || !settings.id} 
                className="gap-2"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send Test
              </Button>
              {(!settings.sms_enabled || !settings.id) && (settings.openphone_api_key || hasExistingApiKey) && (
                <p className="text-sm text-muted-foreground">
                  Enable SMS and save settings first
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Setup Guide */}
      <Card>
        <CardHeader>
          <CardTitle>How to Get Your OpenPhone Credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                1
              </div>
              <div className="space-y-1">
                <p className="font-medium">Create an OpenPhone Account</p>
                <p className="text-sm text-muted-foreground">
                  Go to <a href="https://www.openphone.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    openphone.com <ExternalLink className="w-3 h-3" />
                  </a> and sign up for an account.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                2
              </div>
              <div className="space-y-1">
                <p className="font-medium">Get Your API Key</p>
                <p className="text-sm text-muted-foreground">
                  Go to <strong>Settings → API</strong> and create a new API key.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                3
              </div>
              <div className="space-y-1">
                <p className="font-medium">Find Your Phone Number ID</p>
                <p className="text-sm text-muted-foreground">
                  In OpenPhone, go to <strong>Phone Numbers</strong>, click your number, and find the ID in the URL or settings.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t pt-4 mt-4">
            <h4 className="font-semibold mb-3">SMS Notifications Include:</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Booking confirmation texts to customers
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Appointment reminders before cleanings
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Schedule change notifications
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
