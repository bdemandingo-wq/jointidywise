import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import { 
import { formatTimestampWithZone } from '@/lib/timezoneUtils';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
  Phone, 
  Send, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2,
  Bug,
  Settings,
  MessageSquare
} from 'lucide-react';

interface TestResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

export function OpenPhoneDebugTools() {
  const { organization } = useOrganization();
  const { timezone } = useOrgTimezone(organization?.id);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('This is a test message from TidyWise. If you received this, OpenPhone is working! 🎉');
  const [isTesting, setIsTesting] = useState(false);
  const [isCheckingConfig, setIsCheckingConfig] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [configStatus, setConfigStatus] = useState<{
    smsEnabled: boolean | null;
    hasApiKey: boolean | null;
    hasPhoneNumberId: boolean | null;
    apiKeyPreview: string | null;
    phoneNumberIdPreview: string | null;
  } | null>(null);

  const addResult = (result: Omit<TestResult, 'timestamp'>) => {
    setTestResults(prev => [{
      ...result,
      timestamp: new Date()
    }, ...prev].slice(0, 10)); // Keep last 10 results
  };

  const checkConfiguration = async () => {
    if (!organization?.id) {
      toast.error('No organization found');
      return;
    }

    setIsCheckingConfig(true);
    try {
      const [{ data: settings, error }, { data: hasKey }] = await Promise.all([
        supabase
          .from('organization_sms_settings')
          .select('sms_enabled, openphone_phone_number_id')
          .eq('organization_id', organization.id)
          .maybeSingle(),
        supabase.rpc('has_openphone_api_key', { _org_id: organization.id }),
      ]);

      if (error) throw error;

      if (!settings) {
        setConfigStatus({
          smsEnabled: false,
          hasApiKey: false,
          hasPhoneNumberId: false,
          apiKeyPreview: null,
          phoneNumberIdPreview: null,
        });
        addResult({
          success: false,
          message: 'No SMS settings found for this organization',
          details: { organizationId: organization.id }
        });
        return;
      }

      const hasApiKey = hasKey === true;
      const phoneNumberId = settings.openphone_phone_number_id || '';

      setConfigStatus({
        smsEnabled: settings.sms_enabled ?? false,
        hasApiKey,
        hasPhoneNumberId: Boolean(phoneNumberId),
        apiKeyPreview: hasApiKey ? '•••• configured (hidden for security)' : null,
        phoneNumberIdPreview: phoneNumberId ? (phoneNumberId.length > 20 ? `${phoneNumberId.substring(0, 20)}...` : phoneNumberId) : null,
      });

      addResult({
        success: Boolean(settings.sms_enabled) && hasApiKey && Boolean(phoneNumberId),
        message: 'Configuration check complete',
        details: {
          smsEnabled: settings.sms_enabled,
          hasApiKey,
          hasPhoneNumberId: Boolean(phoneNumberId),
        }
      });

    } catch (error) {
      console.error('Error checking config:', error);
      addResult({
        success: false,
        message: `Configuration check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsCheckingConfig(false);
    }
  };

  const sendTestSMS = async () => {
    if (!organization?.id) {
      toast.error('No organization found');
      return;
    }

    if (!testPhone) {
      toast.error('Please enter a phone number');
      return;
    }

    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-openphone-sms', {
        body: {
          to: testPhone,
          message: testMessage,
          organizationId: organization.id,
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Test SMS sent successfully!');
        addResult({
          success: true,
          message: `SMS sent to ${testPhone}`,
          details: { messageId: data.messageId }
        });
      } else {
        toast.error(data?.error || 'Failed to send SMS');
        addResult({
          success: false,
          message: data?.error || 'Failed to send SMS',
          details: data
        });
      }
    } catch (error) {
      console.error('Error sending test SMS:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed: ${errorMessage}`);
      addResult({
        success: false,
        message: `Error: ${errorMessage}`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            OpenPhone Debug Tools
          </CardTitle>
          <CardDescription>
            Test and troubleshoot your OpenPhone SMS integration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Configuration Check */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Configuration Status
              </Label>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={checkConfiguration}
                disabled={isCheckingConfig}
              >
                {isCheckingConfig ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                Check Config
              </Button>
            </div>

            {configStatus && (
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    {configStatus.smsEnabled ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-xs font-medium">SMS Enabled</span>
                  </div>
                  <Badge variant={configStatus.smsEnabled ? "default" : "destructive"}>
                    {configStatus.smsEnabled ? 'Yes' : 'No'}
                  </Badge>
                </div>
                
                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    {configStatus.hasApiKey ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-xs font-medium">API Key</span>
                  </div>
                  {configStatus.apiKeyPreview ? (
                    <code className="text-xs bg-background px-1 py-0.5 rounded">
                      {configStatus.apiKeyPreview}
                    </code>
                  ) : (
                    <Badge variant="destructive">Missing</Badge>
                  )}
                </div>
                
                <div className="p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    {configStatus.hasPhoneNumberId ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-xs font-medium">Phone Number ID</span>
                  </div>
                  {configStatus.phoneNumberIdPreview ? (
                    <code className="text-xs bg-background px-1 py-0.5 rounded break-all">
                      {configStatus.phoneNumberIdPreview}
                    </code>
                  ) : (
                    <Badge variant="destructive">Missing</Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Test SMS */}
          <div className="space-y-4 pt-4 border-t">
            <Label className="text-sm font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Send Test SMS
            </Label>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="testPhone" className="text-xs text-muted-foreground">
                  Phone Number
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="testPhone"
                    type="tel"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="pl-10"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="testMessage" className="text-xs text-muted-foreground">
                  Message
                </Label>
                <Textarea
                  id="testMessage"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  rows={3}
                />
              </div>
              
              <Button 
                onClick={sendTestSMS} 
                disabled={isTesting || !testPhone}
                className="w-full"
              >
                {isTesting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Send Test SMS
              </Button>
            </div>
          </div>

          {/* Test Results Log */}
          {testResults.length > 0 && (
            <div className="space-y-3 pt-4 border-t">
              <Label className="text-sm font-medium">Test Results</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {testResults.map((result, i) => (
                  <Alert 
                    key={i} 
                    variant={result.success ? "default" : "destructive"}
                    className="py-2"
                  >
                    <div className="flex items-start gap-2">
                      {result.success ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                      ) : (
                        <AlertCircle className="h-4 w-4 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <AlertDescription className="text-sm">
                          {result.message}
                        </AlertDescription>
                        <span className="text-xs text-muted-foreground">
                          {/* eslint-disable-next-line local/no-device-local-dates -- debug console: when the request ran on THIS machine */}
                          {formatTimestampWithZone(result.timestamp, timezone)}
                        </span>
                        {result.details && (
                          <details className="mt-1">
                            <summary className="text-xs text-muted-foreground cursor-pointer">
                              Details
                            </summary>
                            <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-x-auto">
                              {JSON.stringify(result.details, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </Alert>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Troubleshooting Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Troubleshooting Tips</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-2">
            <span className="font-medium">1.</span>
            <span>Ensure your OpenPhone API key is valid and has SMS permissions.</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium">2.</span>
            <span>The Phone Number ID should be the raw ID (e.g., "PNxxxxxxx"), not a URL.</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium">3.</span>
            <span>Check your OpenPhone billing - 402 errors indicate payment issues.</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium">4.</span>
            <span>Phone numbers should be US format: (555) 123-4567 or +15551234567</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium">5.</span>
            <span>Enable SMS in Settings → SMS before testing.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
