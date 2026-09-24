import { useState, useEffect } from 'react';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { maybeAdoptOrgCountry } from '@/lib/orgCountry';
import { normalizeWebsiteUrl } from '@/lib/websiteUrl';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrgDataExportCard } from '@/components/admin/OrgDataExportCard';
import { AppUpdateCard } from '@/components/admin/AppUpdateCard';
import { FeedbackTab } from '@/components/admin/FeedbackTab';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Save, Globe, Bell, Lock, Palette, Loader2, Star, Upload, Eye, EyeOff, AlertCircle, MessageSquare, DollarSign, LayoutGrid, PanelLeft, RotateCcw, Share2, Copy, Code, ExternalLink, Trash2, AlertTriangle, Gift, TrendingUp } from 'lucide-react';
import { SurgePricingSettings } from '@/components/admin/SurgePricingSettings';
import { EmbedCodeCard } from '@/components/admin/EmbedCodeCard';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from '@/lib/supabase';
import { SignedImage } from '@/components/ui/signed-image';
import { toast } from 'sonner';
import { QueryError } from '@/components/QueryError';
import { validateTemplate } from '@/lib/automationTemplates';
import { SMSSettingsCard } from '@/components/admin/SMSSettingsCard';
import { OpenPhoneDebugTools } from '@/components/admin/OpenPhoneDebugTools';
import { QuietHoursCard } from '@/components/admin/settings/QuietHoursCard';
import { PricingSettingsCard } from '@/components/admin/PricingSettingsCard';
import { RecurringDiscountSettingsCard } from '@/components/admin/RecurringDiscountSettingsCard';
import { CustomFrequenciesManager } from '@/components/admin/CustomFrequenciesManager';
import { FormDisplaySettings } from '@/components/admin/FormDisplaySettings';
import { SchedulingModeCard } from '@/components/admin/SchedulingModeCard';
import { SidebarVisibilitySettings } from '@/components/admin/SidebarVisibilitySettings';
import { TeamMembersCard } from '@/components/admin/TeamMembersCard';
import { YourProfileCard } from '@/components/admin/YourProfileCard';
import { MobileBottomNavSettings } from '@/components/admin/MobileBottomNavSettings';
import { BookingFormShareCard } from '@/components/admin/BookingFormShareCard';
import { LoyaltyTierEditor } from '@/components/admin/LoyaltyTierEditor';
import { EmailSettingsCard } from '@/components/admin/EmailSettingsCard';
import { EmailDeliveryPanel } from '@/components/admin/EmailDeliveryPanel';
import { EmailTemplatesSettings } from '@/components/admin/EmailTemplatesSettings';
import { NotificationPreferencesCard } from '@/components/admin/NotificationPreferencesCard';
import { useLegacyNotificationMigration } from '@/hooks/useLegacyNotificationMigration';

import { CopilotSettingsCard } from '@/components/admin/CopilotSettingsCard';

import { StripeConnectHealthPanel } from '@/components/admin/StripeConnectHealthPanel';
import { ZapierWebhooksCard } from '@/components/admin/ZapierWebhooksCard';
import { ZapierSetupGuide } from '@/components/admin/ZapierSetupGuide';
import { ZapierEventTester } from '@/components/admin/ZapierEventTester';
import { ZapierDispatchLogCard } from '@/components/admin/ZapierDispatchLogCard';
import { ZapierAlertSettingsCard } from '@/components/admin/ZapierAlertSettingsCard';
import { ZapierWebhookHealthCard } from '@/components/admin/ZapierWebhookHealthCard';
import { GHLSettingsCard } from '@/components/admin/GHLSettingsCard';
import { GHLDispatchLogCard } from '@/components/admin/GHLDispatchLogCard';


import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { LocalePickers } from '@/components/admin/LocalePickers';

interface BusinessSettings {
  id?: string;
  company_name: string;
  company_email: string;
  company_phone: string;
  /* The owner's own mobile. Every admin text alert goes here. */
  notification_phone: string;
  /* The public-facing line (usually the OpenPhone number). Never alerted. */
  business_line_phone: string;
  company_address: string;
  website_url: string;
  company_city: string;
  company_state: string;
  company_zip: string;
  timezone: string;
  currency: string;
  campaign_quiet_hours_enabled: boolean;
  campaign_quiet_hours_start: number;
  campaign_quiet_hours_end: number;
  logo_url: string;
  booking_buffer_minutes: number;
  max_advance_booking_days: number;
  cancellation_policy: string;
  // Booking settings
  allow_online_booking: boolean;
  require_deposit: boolean;
  minimum_notice_hours: number;
  cancellation_window_hours: number;
  // (Legacy notify_* toggles removed; use organization_notification_preferences)
  // Branding settings
  primary_color: string;
  accent_color: string;
  // Email templates
  confirmation_email_subject: string;
  confirmation_email_body: string;
  reminder_email_subject: string;
  reminder_email_body: string;
  confirmation_email_sections: unknown[] | null;
  reminder_email_sections: unknown[] | null;
  // Reviews
  google_review_url: string;
  review_sms_template: string;
  // Email integration
  resend_api_key: string;
  // Marketing / analytics tracking
  meta_pixel_id: string;
  google_analytics_id: string;
  // Peer benchmarks
  benchmarks_opt_in: boolean;
  // Staff payouts
  require_cleaner_payout_setup: boolean;
}

const defaultSettings: BusinessSettings = {
  company_name: '',
  company_email: '',
  company_phone: '',
  notification_phone: '',
  business_line_phone: '',
  company_address: '',
  website_url: '',
  company_city: '',
  company_state: '',
  company_zip: '',
  timezone: 'America/New_York',
  currency: 'USD',
  campaign_quiet_hours_enabled: true,
  campaign_quiet_hours_start: 20,
  campaign_quiet_hours_end: 9,
  logo_url: '',
  booking_buffer_minutes: 15,
  max_advance_booking_days: 60,
  cancellation_policy: '',
  allow_online_booking: true,
  require_deposit: true,
  minimum_notice_hours: 24,
  cancellation_window_hours: 48,
  primary_color: '#3b82f6',
  accent_color: '#14b8a6',
  confirmation_email_subject: 'Your Booking Confirmation - {{booking_number}}',
  confirmation_email_body: 'Hi {{customer_name}},\n\nThank you for booking with us!\n\nYour booking details:\n- Booking #: {{booking_number}}\n- Service: {{service_name}}\n- Date: {{scheduled_date}}\n- Time: {{scheduled_time}}\n- Address: {{address}}\n- Total: ${{total_amount}}\n\nWe look forward to serving you!\n\nBest regards,\n{{company_name}}',
  reminder_email_subject: 'Reminder: Your Cleaning is Tomorrow - {{booking_number}}',
  reminder_email_body: 'Hi {{customer_name}},\n\nThis is a friendly reminder that your cleaning is scheduled for tomorrow.\n\nBooking Details:\n- Booking #: {{booking_number}}\n- Service: {{service_name}}\n- Date: {{scheduled_date}}\n- Time: {{scheduled_time}}\n- Address: {{address}}\n\nIf you need to reschedule or have any questions, please contact us.\n\nSee you soon!\n{{company_name}}',
  confirmation_email_sections: null,
  reminder_email_sections: null,
  google_review_url: '',
  review_sms_template: 'Hi {customer_name}, thank you for choosing {company_name}! We\'d love to hear about your experience. Please take a moment to leave us a review: {review_link}',
  resend_api_key: '',
  meta_pixel_id: '',
  google_analytics_id: '',
  benchmarks_opt_in: true,
  require_cleaner_payout_setup: true,
};

// Account Deletion Card Component - Required for App Store compliance (Guideline 5.1.1(v))
function AccountDeletionCard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleDeleteAccount = async () => {
    if (!user?.email) return;
    
    if (confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
      toast.error('Email does not match. Please enter your email correctly.');
      return;
    }

    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-my-account', {
        body: { confirmEmail }
      });

      if (error) throw error;

      toast.success('Your account has been permanently deleted.');
      await signOut();
      navigate('/');
    } catch (error: any) {
      console.error('Error deleting account:', error);
      toast.error(error.message || 'Failed to delete account. Please try again.');
    } finally {
      setDeleting(false);
      setDialogOpen(false);
    }
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Trash2 className="w-5 h-5" />
          Delete Account
        </CardTitle>
        <CardDescription>
          Permanently delete your account and all associated data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start gap-3 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-destructive mb-1">Warning: This action cannot be undone</p>
            <p className="text-muted-foreground">
              Deleting your account will permanently remove all your data including:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Your business and organization settings</li>
              <li>All customer records and booking history</li>
              <li>Staff members and team assignments</li>
              <li>Invoices, payments, and financial data</li>
              <li>All other associated data</li>
            </ul>
          </div>
        </div>

        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" className="gap-2">
              <Trash2 className="w-4 h-4" />
              Delete My Account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Confirm Account Deletion
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-4">
                  <p>
                    This will permanently delete your account and all data. This action cannot be reversed.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-email">
                      Type your email <span className="font-medium">{user?.email}</span> to confirm:
                    </Label>
                    <Input
                      id="confirm-email"
                      type="email"
                      placeholder="Enter your email"
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                      className="border-destructive/50"
                    />
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmEmail('')}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteAccount}
                disabled={deleting || confirmEmail.toLowerCase() !== user?.email?.toLowerCase()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Yes, Delete My Account
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { organization, refetch: refetchOrganization } = useOrganization();
  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const { settings: orgSettings, saveSettings: saveOrgSettings } = useOrganizationSettings();
  // One-time non-destructive migration of legacy notify_* flags into the
  // shared organization_notification_preferences matrix.
  useLegacyNotificationMigration();
  
  // Get active tab from URL query param, default to "general"
  const activeTab = searchParams.get('tab') || 'general';
  const setActiveTab = (tab: string) => {
    setSearchParams({ tab });
  };
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    if (!organization?.id) return;
    fetchSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSettings is recreated each render; runs once per org
  }, [organization?.id]);

  const fetchSettings = async () => {
    try {
      if (!organization?.id) return;

      const { data, error } = await supabase
        .from('business_settings')
        .select('*')
        .eq('organization_id', organization.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const typedData = data as any;
        setSettings({
          id: data.id,
          company_name: data.company_name || '',
          company_email: data.company_email || '',
          company_phone: data.company_phone || '',
          /* Legacy orgs saved one number. Until they split it, that number is
             the alert cell — the migration backfilled it the same way. */
          notification_phone: typedData.notification_phone || data.company_phone || '',
          business_line_phone: typedData.business_line_phone || '',
          company_address: data.company_address || '',
          website_url: data.website_url || '',
          company_city: data.company_city || '',
          company_state: data.company_state || '',
          company_zip: data.company_zip || '',
          timezone: data.timezone || 'America/New_York',
          currency: data.currency || 'USD',
          // ?? not || — hour 0 is midnight, a legitimate value that || would discard.
          campaign_quiet_hours_enabled: data.campaign_quiet_hours_enabled ?? true,
          campaign_quiet_hours_start: data.campaign_quiet_hours_start ?? 20,
          campaign_quiet_hours_end: data.campaign_quiet_hours_end ?? 9,
          logo_url: data.logo_url || '',
          booking_buffer_minutes: data.booking_buffer_minutes || 15,
          max_advance_booking_days: data.max_advance_booking_days || 60,
          cancellation_policy: data.cancellation_policy || '',
          allow_online_booking: data.allow_online_booking ?? true,
          require_deposit: data.require_deposit ?? true,
          minimum_notice_hours: data.minimum_notice_hours || 24,
          cancellation_window_hours: data.cancellation_window_hours || 48,
          primary_color: data.primary_color || '#3b82f6',
          accent_color: data.accent_color || '#14b8a6',
          confirmation_email_subject: typedData.confirmation_email_subject || defaultSettings.confirmation_email_subject,
          confirmation_email_body: typedData.confirmation_email_body || defaultSettings.confirmation_email_body,
          reminder_email_subject: typedData.reminder_email_subject || defaultSettings.reminder_email_subject,
          reminder_email_body: typedData.reminder_email_body || defaultSettings.reminder_email_body,
          confirmation_email_sections: Array.isArray(typedData.confirmation_email_sections) ? typedData.confirmation_email_sections : null,
          reminder_email_sections: Array.isArray(typedData.reminder_email_sections) ? typedData.reminder_email_sections : null,
          google_review_url: typedData.google_review_url || '',
          review_sms_template: typedData.review_sms_template || defaultSettings.review_sms_template,
          resend_api_key: typedData.resend_api_key || '',
          meta_pixel_id: typedData.meta_pixel_id || '',
          google_analytics_id: typedData.google_analytics_id || '',
          benchmarks_opt_in: typedData.benchmarks_opt_in ?? true,
          require_cleaner_payout_setup: typedData.require_cleaner_payout_setup ?? true,
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      setLoadError(error instanceof Error ? error : new Error('Failed to load settings'));
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    /*
      The review SMS was the one message editor on the platform with no
      validation at all — a bare textarea writing straight to state. It is also
      the more discoverable of the two editors, which is how both broken
      templates on the platform got saved: Regal Rest's {contact.first_name}
      from GoHighLevel and ADD Bhutan's raw review URL wrapped in braces.

      Reuses validateTemplate rather than adding a second validator, so the
      vocabulary and the error wording stay in one place. Empty is allowed and
      skipped — it means "use the default wording", the same rule
      AutomationEditorDialog applies. Without that, saving any unrelated setting
      on this page would be blocked for every org that never set a template.
    */
    if (settings.review_sms_template?.trim()) {
      const problem = validateTemplate('review_request', settings.review_sms_template);
      if (problem) {
        toast.error(`Review request message: ${problem}`);
        return;
      }
    }

    setSaving(true);
    try {
      const settingsData = {
        company_name: settings.company_name,
        company_email: settings.company_email,
        company_phone: settings.company_phone,
        notification_phone: settings.notification_phone,
        business_line_phone: settings.business_line_phone,
        company_address: settings.company_address,
        // Layer 1 of the website_url guard — never persist an unnormalised
        // value; it becomes an href on the public booking form.
        website_url: normalizeWebsiteUrl(settings.website_url),
        company_city: settings.company_city,
        company_state: settings.company_state,
        company_zip: settings.company_zip,
        timezone: settings.timezone,
        currency: settings.currency,
        campaign_quiet_hours_enabled: settings.campaign_quiet_hours_enabled,
        campaign_quiet_hours_start: settings.campaign_quiet_hours_start,
        campaign_quiet_hours_end: settings.campaign_quiet_hours_end,
        logo_url: settings.logo_url,
        booking_buffer_minutes: settings.booking_buffer_minutes,
        max_advance_booking_days: settings.max_advance_booking_days,
        cancellation_policy: settings.cancellation_policy,
        allow_online_booking: settings.allow_online_booking,
        require_deposit: settings.require_deposit,
        minimum_notice_hours: settings.minimum_notice_hours,
        cancellation_window_hours: settings.cancellation_window_hours,
        primary_color: settings.primary_color,
        accent_color: settings.accent_color,
        confirmation_email_subject: settings.confirmation_email_subject,
        confirmation_email_body: settings.confirmation_email_body,
        reminder_email_subject: settings.reminder_email_subject,
        reminder_email_body: settings.reminder_email_body,
        confirmation_email_sections: (settings as any).confirmation_email_sections ?? null,
        reminder_email_sections: (settings as any).reminder_email_sections ?? null,
        google_review_url: settings.google_review_url,
        review_sms_template: settings.review_sms_template,
        resend_api_key: settings.resend_api_key,
        meta_pixel_id: settings.meta_pixel_id,
        google_analytics_id: settings.google_analytics_id,
        benchmarks_opt_in: settings.benchmarks_opt_in,
        require_cleaner_payout_setup: settings.require_cleaner_payout_setup,
      } as any;

      if (!organization?.id) {
        throw new Error('No organization found');
      }

      // Upsert: try update first, then insert if no row exists
      if (settings.id) {
        const { error } = await supabase
          .from('business_settings')
          .update(settingsData)
          .eq('id', settings.id);

        if (error) throw error;
      } else {
        // Use upsert with unique organization_id constraint
        const { data, error } = await supabase
          .from('business_settings')
          .upsert(
            { ...settingsData, organization_id: organization.id },
            { onConflict: 'organization_id', ignoreDuplicates: false }
          )
          .select()
          .single();

        if (error) throw error;
        setSettings(prev => ({ ...prev, id: data.id }));
      }

      // If logo changed, update organization too
      if (settings.logo_url && organization?.id) {
        await supabase
          .from('organizations')
          .update({ logo_url: settings.logo_url })
          .eq('id', organization.id);
        refetchOrganization();
      }

      // Trigger branding re-apply across the CRM
      window.dispatchEvent(new Event('branding-updated'));

      toast.success('Settings saved successfully');
      // Refetch so children (e.g. EmailTemplatesSettings preview) reflect DB truth.
      await fetchSettings();
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof BusinessSettings, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be less than 2MB');
      return;
    }

    setUploadingLogo(true);
    try {
      const fileExt = (file.name.split('.').pop() || 'png').toLowerCase();
      const fileName = `logo-${Date.now()}.${fileExt}`;
      const filePath = `${organization?.id}/logos/${fileName}`;

      // Upload to the PUBLIC `business-assets` bucket so email clients can fetch it.
      // (The old `booking-photos` bucket is private and results in broken images in emails.)
      const { error: uploadError } = await supabase.storage
        .from('business-assets')
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('business-assets')
        .getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;

      // Verify the uploaded logo is actually reachable and is an image before saving.
      try {
        const head = await fetch(publicUrl, { method: 'HEAD' });
        const ct = head.headers.get('content-type') || '';
        if (!head.ok || !ct.startsWith('image/')) {
          throw new Error(`Uploaded logo could not be verified (status ${head.status}, type "${ct}")`);
        }
      } catch (verifyErr: any) {
        throw new Error(verifyErr?.message || 'Uploaded logo failed verification');
      }

      updateField('logo_url', publicUrl);
      toast.success('Logo uploaded and verified');
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      toast.error(error?.message || 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handlePasswordUpdate = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setUpdatingPassword(true);
    try {
      // Re-authenticate with current password before allowing change
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password: currentPassword,
      });

      if (signInError) {
        toast.error('Current password is incorrect');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast.success('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error updating password:', error);
      toast.error(error.message || 'Failed to update password');
    } finally {
      setUpdatingPassword(false);
    }
  };

  if (loadError) {
    return (
      <AdminLayout title="Settings" subtitle="Manage your business preferences">
        <SEOHead title="Settings | TidyWise" description="Configure your business settings" noIndex />
        <QueryError subject="business settings" onRetry={() => { setLoadError(null); setLoading(true); fetchSettings(); }} />
      </AdminLayout>
    );
  }

  if (loading) {
    return (
      <AdminLayout title="Settings" subtitle="Manage your business preferences">
      <SEOHead title="Settings | TidyWise" description="Configure your business settings" noIndex />
        <div className="portal-v2 flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Settings"
      subtitle="Manage your business preferences"
    >
      <div className="portal-v2">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        {/* Prominent Subscription / Billing entry — the Subscription tab
            below can scroll off the right edge when there are many tabs,
            making it easy to miss. This row keeps it always visible. */}
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">Subscription &amp; billing</p>
            <p className="text-sm text-muted-foreground truncate">
              Update your payment method, change plan, or view invoices.
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => navigate('/dashboard/subscription')}>
            Manage
          </Button>
        </div>
        {/*
          16 tabs do not fit on one line at any viewport, so this strip has two
          modes rather than one compromise.

          md and up — WRAP. Every tab is on screen with no interaction at all,
          which is the right trade when vertical space is cheap. Needs md:h-auto
          because the base TabsList is a fixed h-8/md:h-10 that would clip the
          second row, and md:overflow-visible because the mobile scroll
          container's overflow-y-hidden would clip it too.

          Below md — SCROLL horizontally. Wrapping 16 tabs on a phone costs five
          or six rows and pushes the actual settings off screen; a horizontal
          swipe is both cheaper and the native gesture.

          The scrollbar is deliberately NOT hidden any more. It used to carry
          [scrollbar-width:none] and a ::-webkit-scrollbar override, which is
          what made this unreachable rather than merely tight: the strip scrolled
          fine, but nothing said so, and a vertical mouse wheel does not scroll a
          horizontal container. iOS shows a transient bar only while scrolling,
          so the cost is a thin persistent bar on Android and narrow desktop —
          worth it to make the overflow discoverable.

          max-w-5xl was also removed. It appeared nowhere else on the page, so it
          was not a content-width convention, just a 1024px cap that clipped the
          strip even on a monitor with room to spare.

          Mobile Safari can aggressively shrink inline-flex children, which can
          cause tab labels to visually overlap — hence shrink-0 on every trigger.
        */}
        <div className="w-full overflow-x-auto overflow-y-hidden md:overflow-visible touch-pan-x md:touch-auto">
           <TabsList className="w-max min-w-full md:w-full flex flex-nowrap md:flex-wrap justify-start gap-1 md:h-auto">
            <TabsTrigger className="shrink-0" value="general">General</TabsTrigger>
            <TabsTrigger className="shrink-0" value="team">Team</TabsTrigger>
            <TabsTrigger className="shrink-0" value="booking-form">Booking Form</TabsTrigger>
            <TabsTrigger className="shrink-0" value="pricing">Pricing</TabsTrigger>
            <TabsTrigger className="shrink-0" value="loyalty">Loyalty</TabsTrigger>
            <TabsTrigger className="shrink-0" value="notifications">Notifications</TabsTrigger>
            <TabsTrigger className="shrink-0" value="sms">SMS</TabsTrigger>
            <TabsTrigger className="shrink-0" value="emails">Emails</TabsTrigger>
            <TabsTrigger className="shrink-0" value="integrations">Integrations</TabsTrigger>
            <TabsTrigger className="shrink-0" value="reviews">Reviews</TabsTrigger>
            <TabsTrigger className="shrink-0" value="branding">Branding</TabsTrigger>
            <TabsTrigger className="shrink-0" value="sidebar">Sidebar</TabsTrigger>
            <TabsTrigger className="shrink-0" value="mobile-nav">Mobile Nav</TabsTrigger>
            <TabsTrigger className="shrink-0" value="import">Import Data</TabsTrigger>
            <TabsTrigger className="shrink-0" value="security">Security</TabsTrigger>
            <TabsTrigger className="shrink-0" value="feedback">Feedback</TabsTrigger>
            <TabsTrigger
              className="shrink-0"
              value="subscription"
              onClick={(e) => { e.preventDefault(); navigate('/dashboard/subscription'); }}
            >
              Subscription
            </TabsTrigger>
          </TabsList>
        </div>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-6">
          {/* First on the tab, above the business details: it is about the person,
              and it is the setting people come to Settings looking for. */}
          <YourProfileCard />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Business Information
              </CardTitle>
              <CardDescription>
                Update your business details and contact information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business Name</Label>
                  <Input
                    id="businessName"
                    value={settings.company_name}
                    onChange={(e) => updateField('company_name', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Business Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={settings.company_email}
                    onChange={(e) => updateField('company_email', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={settings.company_phone}
                    onChange={(e) => updateField('company_phone', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={settings.company_city}
                    onChange={(e) => updateField('company_city', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Business Address</Label>
                <AddressAutocomplete
                  id="address"
                  value={settings.company_address}
                  onChange={(v) => updateField('company_address', v)}
                  onResolved={(r) => {
                    if (r.city) updateField('company_city', r.city);
                    if (r.state) updateField('company_state', r.state);
                    if (r.zip) updateField('company_zip', r.zip);
                    // The business's own address — the authoritative country
                    // signal. Staff home addresses are the weaker fallback.
                    void maybeAdoptOrgCountry(organization?.id ?? null, r.country);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website_url">Website</Label>
                <Input
                  id="website_url"
                  type="url"
                  inputMode="url"
                  placeholder="mysite.com"
                  value={settings.website_url}
                  onChange={(e) => updateField('website_url', e.target.value)}
                  onBlur={(e) => {
                    // Normalise on blur so the operator sees what will actually
                    // be saved — "mysite.com" visibly becomes a full https URL,
                    // and anything unusable is cleared rather than silently
                    // dropped at save time.
                    const raw = e.target.value.trim();
                    if (!raw) {
                      updateField('website_url', '');
                      return;
                    }
                    const normalized = normalizeWebsiteUrl(raw);
                    if (normalized) {
                      updateField('website_url', normalized);
                    } else {
                      updateField('website_url', '');
                      toast.error("That doesn't look like a website address. Try something like mysite.com");
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Shown as a link back to your site on your public booking form.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={settings.company_state}
                    onChange={(e) => updateField('company_state', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip">ZIP Code</Label>
                  <Input
                    id="zip"
                    value={settings.company_zip}
                    onChange={(e) => updateField('company_zip', e.target.value)}
                  />
                </div>
              </div>
              <LocalePickers
                currency={settings.currency}
                timezone={settings.timezone}
                onCurrencyChange={(value) => updateField('currency', value)}
                onTimezoneChange={(value) => updateField('timezone', value)}
              />
              <Button className="gap-2" onClick={saveSettings} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Peer Benchmarks
              </CardTitle>
              <CardDescription>
                Compare your business anonymously against other cleaning companies in your area, region, and nationally.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4 p-4 rounded-lg border bg-muted/30">
                <div className="space-y-1">
                  <Label htmlFor="benchmarks_opt_in" className="text-base">
                    Share anonymous metrics for benchmarking
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    When enabled, aggregated metrics (no customer names, addresses, or contact info) are pooled with other opted-in organizations so you can see how you stack up. Turning this off immediately stops both peer comparisons and AI insights for your account.
                  </p>
                </div>
                <Switch
                  id="benchmarks_opt_in"
                  checked={settings.benchmarks_opt_in}
                  onCheckedChange={(v) => updateField('benchmarks_opt_in', v)}
                />
              </div>
              <Button className="gap-2" onClick={saveSettings} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>

          <CopilotSettingsCard />

          {/* Owner-only; renders nothing for managers. */}
          <OrgDataExportCard />

          {/* Native only; renders nothing on web, where a refresh is the update. */}
          <AppUpdateCard />
        </TabsContent>

        {/* Booking Form Sharing */}
        <TabsContent value="booking-form" className="space-y-6">
          <BookingFormShareCard organizationSlug={organization?.slug} />
          {organization?.slug && <EmbedCodeCard orgSlug={organization.slug} />}
          <SchedulingModeCard />
          <FormDisplaySettings />
        </TabsContent>

        {/* Pricing Settings */}
        <TabsContent value="pricing" className="space-y-6">
          <PricingSettingsCard />
          <RecurringDiscountSettingsCard />
          <CustomFrequenciesManager />
          <SurgePricingSettings />
        </TabsContent>

        {/* Loyalty Settings */}
        <TabsContent value="loyalty" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5" />
                Loyalty Program
              </CardTitle>
              <CardDescription>
                Configure your customer loyalty tiers and benefits
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Enable Loyalty Program</p>
                  <p className="text-sm text-muted-foreground">
                    When disabled, customers won't earn points or receive tier-based discounts
                  </p>
                </div>
                <Switch
                  checked={orgSettings?.loyalty_program_enabled ?? true}
                  onCheckedChange={async (checked) => {
                    await saveOrgSettings({ loyalty_program_enabled: checked });
                    toast.success(checked ? 'Loyalty program enabled' : 'Loyalty program disabled');
                  }}
                />
              </div>
              <Separator />
              <p className="text-sm text-muted-foreground">
                Points are earned at $1 = 1 point after each completed booking. Tier
                level is set by lifetime spend — configure the thresholds and benefits below.
              </p>
            </CardContent>
          </Card>
          {/* No loyalty_program_enabled check here: LoyaltyTierEditor checks it
              itself, so this page and ClientPortalPage (which renders it via
              LoyaltyProgramSettings and had no check at all) now behave the same. */}
          <LoyaltyTierEditor />
        </TabsContent>

        {/* Notifications — shared with /dashboard/notifications */}
        <TabsContent value="notifications" className="space-y-6">
          <NotificationPreferencesCard />
        </TabsContent>


        {/* SMS Settings */}
        <TabsContent value="sms" className="space-y-6">
          <div data-tour-id="openphone-connect">
            <SMSSettingsCard />
          </div>
          <QuietHoursCard
            enabled={settings.campaign_quiet_hours_enabled}
            startHour={settings.campaign_quiet_hours_start}
            endHour={settings.campaign_quiet_hours_end}
            timezone={settings.timezone}
            onChange={(field, value) => updateField(field, value as never)}
          />
          <OpenPhoneDebugTools />
        </TabsContent>

        {/* Email & Domain Settings */}
        <TabsContent value="emails" className="space-y-6">
          <div data-tour-id="gmail-connect">
            <EmailSettingsCard />
          </div>
          <EmailDeliveryPanel />

          <EmailTemplatesSettings
            organizationId={organization?.id}
            confirmationEmailSubject={settings.confirmation_email_subject}
            confirmationEmailBody={settings.confirmation_email_body}
            reminderEmailSubject={settings.reminder_email_subject}
            reminderEmailBody={settings.reminder_email_body}
            confirmationEmailSections={settings.confirmation_email_sections as any}
            reminderEmailSections={settings.reminder_email_sections as any}
            onUpdate={(field, value) => setSettings(prev => ({ ...prev, [field]: value as any }))}
            onSave={saveSettings}
            saving={saving}
          />

        </TabsContent>

        {/* Reviews Settings */}
        <TabsContent value="reviews" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="w-5 h-5" />
                Review Settings
              </CardTitle>
              <CardDescription>
                Configure your Google review settings for customer feedback
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="googleReviewUrl">Google Review URL</Label>
                <Input
                  id="googleReviewUrl"
                  placeholder="https://g.page/r/your-business/review"
                  value={settings.google_review_url}
                  onChange={(e) => updateField('google_review_url', e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  When customers rate 4+ stars, they'll be prompted to leave a review on Google.
                  Get your link from Google Business Profile.
                </p>
              </div>

              <Separator />

              {/* SMS Template Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="reviewSmsTemplate">Review Request SMS Template</Label>
                </div>
                
                {/* Template Presets */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Quick Templates:</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => updateField('review_sms_template', 
                        `Hi {customer_name}, love to hear you had a 5-Star experience! Would you be opposed to $10 off your booking? Just click the link I'm sending now: {review_link} - Leave us a 5-Star review within 30 mins and send me a screenshot. I'll take $10 off your total! - {company_name}`
                      )}
                      className="p-3 text-left border rounded-lg hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">💰</span>
                        <span className="font-medium text-sm">$10 Off Method</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Offer $10 discount for a 5-star review with screenshot proof within 30 mins
                      </p>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => updateField('review_sms_template', 
                        `Hi {customer_name}, love to hear you had a 5-Star experience! We're having an office competition - {cleaner_name} is almost in 1st place! It would make their day if you left a 5-Star review: {review_link} - Please mention {cleaner_name} in your review and send us a screenshot! - {company_name}`
                      )}
                      className="p-3 text-left border rounded-lg hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">🏆</span>
                        <span className="font-medium text-sm">Office Competition Method</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Frame as team competition to encourage mentioning cleaner by name
                      </p>
                    </button>
                  </div>
                </div>

                <textarea
                  id="reviewSmsTemplate"
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Hi {customer_name}, thank you for choosing {company_name}!..."
                  value={settings.review_sms_template}
                  onChange={(e) => updateField('review_sms_template', e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  This message will be sent via SMS when you request a review. Available variables:
                </p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <code className="text-xs bg-muted px-2 py-1 rounded">{'{customer_name}'}</code>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{'{company_name}'}</code>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{'{cleaner_name}'}</code>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{'{service_name}'}</code>
                  <code className="text-xs bg-muted px-2 py-1 rounded">{'{review_link}'}</code>
                </div>
              </div>
              
              {/* Feedback note */}
              <div className="p-4 bg-info/10 border border-info/20 rounded-lg">
                <div className="flex gap-2">
                  <AlertCircle className="w-5 h-5 text-info flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-info">
                      What happens with ratings under 4 stars?
                    </p>
                    <p className="text-sm text-info mt-1">
                      Ratings of 3 stars or below will be sent to your <strong>Feedback</strong> tab instead of Google. 
                      This allows you to address customer concerns privately before they become public reviews.
                    </p>
                  </div>
                </div>
              </div>
              
              <Button className="gap-2" onClick={saveSettings} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Branding */}
        <TabsContent value="branding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" />
                Brand Customization
              </CardTitle>
              <CardDescription>
                Customize the look and feel of your booking page
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Logo Upload */}
              <div className="space-y-3">
                <Label>Company Logo</Label>
                <div className="flex items-center gap-4">
                  {settings.logo_url ? (
                    <div className="w-20 h-20 rounded-lg border bg-background overflow-hidden flex items-center justify-center">
                      <SignedImage
                        src={settings.logo_url}
                        alt={settings.company_name || 'Company logo'}
                        className="w-full h-full object-contain"
                        onError={(e: any) => {
                          // Remove the broken image and show the org name cleanly.
                          const parent = e.currentTarget?.parentElement;
                          if (parent) {
                            parent.innerHTML = `<span style="font-size:12px;font-weight:600;text-align:center;padding:4px;color:#374151;">${(settings.company_name || 'Logo').replace(/[<>&]/g, '')}</span>`;
                          }
                          setLogoLoadFailed(true);
                        }}
                        onLoad={() => setLogoLoadFailed(false)}
                      />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-lg border bg-muted flex items-center justify-center">
                      <Upload className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      id="logo-upload"
                    />
                    <Label htmlFor="logo-upload" className="cursor-pointer">
                      <Button variant="outline" className="gap-2" asChild disabled={uploadingLogo}>
                        <span>
                          {uploadingLogo ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4" />
                              {settings.logo_url && logoLoadFailed ? 'Re-upload Logo' : 'Upload Logo'}
                            </>
                          )}
                        </span>
                      </Button>
                    </Label>
                    <p className="text-sm text-muted-foreground mt-2">
                      PNG, JPG up to 2MB. Appears in your sidebar and in customer emails.
                    </p>
                  </div>
                </div>
                {settings.logo_url && logoLoadFailed && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    Your saved logo could not be loaded. Emails will show your company
                    name as text until you re-upload a working logo above.
                  </div>
                )}
              </div>
              
              <Separator />
              
              {/* Color Pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label>Primary Color</Label>
                  <div className="flex gap-3">
                    <Input
                      type="color"
                      value={settings.primary_color}
                      onChange={(e) => updateField('primary_color', e.target.value)}
                      className="w-14 h-10 p-1 cursor-pointer"
                    />
                    <Input
                      value={settings.primary_color}
                      onChange={(e) => updateField('primary_color', e.target.value)}
                      placeholder="#3b82f6"
                      className="flex-1"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Used for buttons and key actions</p>
                </div>
                <div className="space-y-3">
                  <Label>Accent Color</Label>
                  <div className="flex gap-3">
                    <Input
                      type="color"
                      value={settings.accent_color}
                      onChange={(e) => updateField('accent_color', e.target.value)}
                      className="w-14 h-10 p-1 cursor-pointer"
                    />
                    <Input
                      value={settings.accent_color}
                      onChange={(e) => updateField('accent_color', e.target.value)}
                      placeholder="#14b8a6"
                      className="flex-1"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Used for highlights and secondary elements</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button className="gap-2" onClick={saveSettings} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Changes
                </Button>
                <Button 
                  variant="outline" 
                  className="gap-2"
                  onClick={() => {
                    updateField('primary_color', '#3b82f6');
                    updateField('accent_color', '#14b8a6');
                    toast.info('Colors reset to defaults. Click Save to apply.');
                  }}
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset to Default
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="sidebar" className="space-y-6">
          <SidebarVisibilitySettings />
        </TabsContent>

        {/* Mobile Nav */}
        <TabsContent value="mobile-nav" className="space-y-6">
          <MobileBottomNavSettings />
        </TabsContent>

        {/* Import Data */}
        <TabsContent value="import" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Import Data from Another Platform
              </CardTitle>
              <CardDescription>
                Migrate your customers, staff, bookings, and services from BookingKoala or Jobber
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/dashboard/import')} className="gap-2">
                <Upload className="w-4 h-4" />
                Open Import Wizard
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Change Password
              </CardTitle>
              <CardDescription>
                Update your account password
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Current Password</Label>
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <div className="relative">
                    <Input 
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Confirm Password</Label>
                  <div className="relative">
                    <Input 
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <Button 
                className="gap-2" 
                onClick={handlePasswordUpdate}
                disabled={updatingPassword || !currentPassword || !newPassword || !confirmPassword}
              >
                {updatingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Update Password
              </Button>
            </CardContent>
          </Card>

          {/* Account Deletion - Required for App Store compliance */}
          <AccountDeletionCard />
        </TabsContent>

        {/* Feedback Tab */}
        <TabsContent value="feedback" className="space-y-6">
          <FeedbackTab />
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-6">
          <TeamMembersCard />
        </TabsContent>

        {/* Integrations Tab */}
        <TabsContent value="integrations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Staff payouts</CardTitle>
              <CardDescription>
                Control whether cleaners must connect a Stripe payout account before working jobs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="require_cleaner_payout_setup" className="text-sm font-medium">
                    Require cleaners to set up Stripe payouts
                  </Label>
                  <p className="text-xs text-muted-foreground max-w-md">
                    Turn off if you pay your team externally (cash, Zelle, Venmo, check).
                  </p>
                </div>
                <Switch
                  id="require_cleaner_payout_setup"
                  checked={settings.require_cleaner_payout_setup}
                  onCheckedChange={(v) => updateField('require_cleaner_payout_setup', v)}
                />
              </div>
              <Button onClick={saveSettings} disabled={saving} size="sm">
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </CardContent>
          </Card>

          <div data-tour-id="stripe-connect">
            <StripeConnectHealthPanel />
          </div>


          <ZapierSetupGuide />
          <ZapierWebhooksCard />
          <ZapierWebhookHealthCard />
          <ZapierAlertSettingsCard />
          <ZapierEventTester />
          <ZapierDispatchLogCard />

          <GHLSettingsCard />
          <GHLDispatchLogCard />





          <Card>
            <CardHeader>
              <CardTitle>Tracking & Analytics</CardTitle>
              <CardDescription>
                Add your Meta Pixel and Google Analytics IDs. They'll auto-inject on your public booking page so your ads manager can track conversions — no admin login required.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="meta_pixel_id">Meta Pixel ID</Label>
                <Input
                  id="meta_pixel_id"
                  placeholder="e.g. 1234567890123456"
                  value={settings.meta_pixel_id}
                  onChange={(e) => updateField('meta_pixel_id', e.target.value.trim())}
                />
                <p className="text-xs text-muted-foreground">
                  Find this in Meta Events Manager → Data Sources. 15–16 digit number.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="google_analytics_id">Google Analytics Measurement ID</Label>
                <Input
                  id="google_analytics_id"
                  placeholder="e.g. G-XXXXXXXXXX"
                  value={settings.google_analytics_id}
                  onChange={(e) => updateField('google_analytics_id', e.target.value.trim())}
                />
                <p className="text-xs text-muted-foreground">
                  Find this in Google Analytics → Admin → Data Streams.
                </p>
              </div>
              <Button onClick={saveSettings} disabled={saving}>
                {saving ? 'Saving…' : 'Save Tracking IDs'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
      </div>
    </AdminLayout>
  );
}
