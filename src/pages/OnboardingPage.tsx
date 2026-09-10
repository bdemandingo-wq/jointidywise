import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TermsOfServiceDialog } from '@/components/legal/TermsOfServiceDialog';
import { toast } from 'sonner';
import {
  Loader2,
  Building2,
  ArrowRight,
  ArrowLeft,
  Plus,
  X,
  Check,
  CheckCircle2,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { getIndustryTemplate } from '@/data/industryTemplates';
import { cn } from '@/lib/utils';
import { SEOHead } from '@/components/SEOHead';
import { Capacitor } from '@capacitor/core';
import { logMetaEvent } from '@/lib/metaEvents';
import { LocalePickers } from '@/components/admin/LocalePickers';
import { detectBrowserCurrency } from '@/lib/currency';
import { detectBrowserTimezone } from '@/lib/timezones';
import {
  buildAnswersPayload,
  normalizeAnswers,
  primaryPain,
} from '@/lib/onboardingAnswers';
import {
  readCapturedReferral,
  clearCapturedReferral,
} from '@/lib/referralAttribution';

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function randomSuffix(length = 5) {
  return Math.random().toString(36).slice(2, 2 + length);
}

// Cleaning-only template
const cleaningTemplate = getIndustryTemplate("Home Cleaning")!;

// ── Qualifying questions (steps 2-5) ────────────────────────────────────
// Single-select cards that auto-advance. Answers are stored in
// sessionStorage (`tw_onboarding_answers`) and used by /choose-plan to
// personalize the recommended plan. Psychology: self-identification →
// pain surfacing → pain agitation → aspiration, so by the paywall the
// user has articulated WHY they need this.
interface QualifyingOption {
  value: string;
  label: string;
  sub?: string;
}
interface QualifyingQuestion {
  key: 'teamSize' | 'bookingMethod' | 'biggestPain' | 'revenueGoal' | 'howHeard';
  title: string;
  description: string;
  options: QualifyingOption[];
}

const QUALIFYING_QUESTIONS: QualifyingQuestion[] = [
  {
    key: 'teamSize',
    title: "Where's your business today?",
    description: 'This helps us set up the right tools for your size',
    options: [
      { value: 'solo', label: 'Just me', sub: 'Solo cleaner getting started' },
      { value: 'small', label: 'Me + 1-4 cleaners', sub: 'Small team, growing fast' },
      { value: 'mid', label: '5-15 cleaners', sub: 'Established team operation' },
      { value: 'large', label: '15+ cleaners', sub: 'Multi-team or multi-location' },
    ],
  },
  {
    key: 'bookingMethod',
    title: 'How do bookings come in right now?',
    description: 'Be honest — this is where most owners lose money',
    options: [
      { value: 'manual', label: 'Calls & texts I track myself', sub: 'Notes app, memory, paper' },
      { value: 'dms', label: 'Instagram / Facebook DMs', sub: 'Scattered across inboxes' },
      { value: 'referrals', label: 'Word of mouth & referrals', sub: 'Great clients, no system' },
      { value: 'software', label: 'Another software', sub: "It's not working for me" },
    ],
  },
  {
    key: 'biggestPain',
    title: "What's eating most of your week?",
    description: 'The #1 thing you wish would run itself',
    options: [
      { value: 'scheduling', label: 'Scheduling & dispatching chaos', sub: 'Who goes where, and when' },
      { value: 'payments', label: 'Chasing invoices & payments', sub: 'Getting paid late or not at all' },
      { value: 'noshows', label: 'No-shows & cancellations', sub: 'Empty slots, lost revenue' },
      { value: 'everything', label: 'Doing everything myself', sub: 'No time to actually grow' },
    ],
  },
  {
    key: 'revenueGoal',
    title: 'Where do you want to be in 12 months?',
    description: "Your answer shapes the growth plan we'll set up",
    options: [
      { value: '5k', label: 'First consistent $5k/mo', sub: 'Prove the business works' },
      { value: '10k', label: 'Steady $10k/mo', sub: 'Full-time income, reliable team' },
      { value: '25k', label: 'Scale past $25k/mo', sub: 'Systems running without me' },
      { value: '50k', label: '$50k+/mo operation', sub: 'Multi-team, serious growth' },
    ],
  },
  // Last on purpose. The four above run self-identification → pain → agitation →
  // aspiration, so the user has articulated WHY they need this by the time they
  // reach the paywall. This one is an attribution question that serves us, not
  // them — putting it mid-arc would interrupt the only part of onboarding doing
  // persuasive work. Its answer is deliberately ignored by recommendPlan.
  {
    key: 'howHeard',
    title: 'How did you hear about us?',
    description: 'Pick any that apply',
    options: [
      { value: 'fb_ad', label: 'Facebook ad' },
      { value: 'fb_group', label: 'Facebook group' },
      { value: 'tiktok', label: 'TikTok' },
      { value: 'google', label: 'Google search' },
      { value: 'referral', label: 'Friend or referral' },
      { value: 'other', label: 'Other' },
    ],
  },
];

// Maps biggestPain → the line shown while "building the dashboard"
const PAIN_BUILD_LINE: Record<string, string> = {
  scheduling: 'Configuring your smart scheduler',
  payments: 'Setting up automated invoicing & payments',
  noshows: 'Activating reminder & no-show protection',
  everything: 'Automating your admin workflows',
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();
  const { user, signOut } = useAuth();
  const { organization, loading: orgLoading, resolution: orgResolution, refetch, setOrganizationDirect } = useOrganization();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  // Qualifying answers (steps 2-5). Persisted to sessionStorage on
  // completion so /choose-plan can personalize the recommendation.
  // Multi-select: every question holds an ARRAY of chosen option values. Shape
  // handling lives in @/lib/onboardingAnswers, which is where it is tested.
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  // Post-creation "building your dashboard" overlay.
  const [building, setBuilding] = useState(false);
  const [buildStage, setBuildStage] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [needsPhoneCollection, setNeedsPhoneCollection] = useState(false);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [customServices, setCustomServices] = useState<{ name: string; description: string }[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [currency, setCurrency] = useState<string>(() => detectBrowserCurrency());
  const [timezone, setTimezone] = useState<string>(() => detectBrowserTimezone());
  const baseSlug = useMemo(() => slugify(businessName), [businessName]);
  const requestedNewBusiness = new URLSearchParams(window.location.search).get('new') === 'true';
  const mayCreateAdditionalBusiness = Boolean(
    requestedNewBusiness && organization && user && organization.owner_id === user.id,
  );

  const handleLogout = async () => {
    await signOut();
    if (!isNative) navigate('/login', { replace: true });
  };

  // Pre-select all cleaning services and check if user needs phone collection
  useEffect(() => {
    setSelectedServices(new Set(cleaningTemplate.services.map(s => s.name)));
    
    // Check if user signed up via Google OAuth and needs phone collection
    const checkPhoneNeeded = async () => {
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .maybeSingle();
      
      // If no phone number, user likely signed up with Google OAuth
      if (!profile?.phone) {
        setNeedsPhoneCollection(true);
      }
    };
    
    checkPhoneNeeded();
  }, [user]);

  // If the user already belongs to a completed business, redirect. Business
  // onboarding is only for a confirmed membership-free account or the actual
  // creator finishing their provisioned organization.
  useEffect(() => {
    // `building` guard: right after creation, refetch() sets `organization`
    // and this effect would yank the user to /dashboard mid-overlay (and
    // AdminRoute would bounce them again). Let the overlay own navigation.
    const ownsOrg = !!organization && !!user && organization.owner_id === user.id;
    if (!orgLoading && organization && !mayCreateAdditionalBusiness && !building && (!organization.needs_onboarding || !ownsOrg)) {

      // Native: land on Help tab (tutorial videos) after onboarding.
      // Web: land on dashboard (web goes through /choose-plan first anyway).
      navigate(isNative ? '/dashboard/help' : '/dashboard', { replace: true });
    }
  }, [orgLoading, organization, navigate, building, isNative, mayCreateAdditionalBusiness, user]);

  // If not logged in, send to login.
  useEffect(() => {
    if (!orgLoading && !user) {
      navigate('/login', { replace: true });
    }
  }, [orgLoading, user, navigate]);

  // Fail closed while workspace access is unresolved. An invited teammate may
  // briefly have `organization === null` while memberships load; rendering the
  // form in that window makes an existing workspace member look like a new
  // business signup. Only a confirmed zero-membership account may proceed.
  if (!user || orgLoading || orgResolution === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (organization && !mayCreateAdditionalBusiness && (!organization.needs_onboarding || organization.owner_id !== user.id)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!organization && orgResolution === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>We couldn't load your workspace</CardTitle>
            <CardDescription>
              We won't create another business while your workspace access is uncertain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => void refetch()}>Retry workspace</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const toggleService = (serviceName: string) => {
    const newSelected = new Set(selectedServices);
    if (newSelected.has(serviceName)) {
      newSelected.delete(serviceName);
    } else {
      newSelected.add(serviceName);
    }
    setSelectedServices(newSelected);
  };

  const selectAllServices = () => {
    setSelectedServices(new Set(cleaningTemplate.services.map(s => s.name)));
  };

  const deselectAllServices = () => {
    setSelectedServices(new Set());
  };

  const addCustomService = () => {
    if (!newServiceName.trim()) return;
    
    const newService = {
      name: newServiceName.trim(),
      description: newServiceDescription.trim() || 'Custom service',
    };
    
    setCustomServices([...customServices, newService]);
    setSelectedServices(new Set([...selectedServices, newService.name]));
    setNewServiceName('');
    setNewServiceDescription('');
    setShowAddForm(false);
  };

  const removeCustomService = (serviceName: string) => {
    setCustomServices(customServices.filter(s => s.name !== serviceName));
    const newSelected = new Set(selectedServices);
    newSelected.delete(serviceName);
    setSelectedServices(newSelected);
  };

  const allServices = [
    ...cleaningTemplate.services,
    ...customServices.map(s => ({ ...s, price: 0, duration: 60 }))
  ];

  const totalServicesCount = allServices.length;

  const handleSubmit = async () => {
    if (!user || !businessName.trim()) return;

    setLoading(true);
    try {
      const name = businessName.trim();
      const initialSlug = slugify(name);
      
      // If user provided phone during onboarding (Google OAuth users), save it and send welcome SMS
      if (needsPhoneCollection && phoneNumber.trim()) {
        await supabase
          .from('profiles')
          .update({ phone: phoneNumber.trim() })
          .eq('id', user.id);

        // Send welcome SMS for Google OAuth users
        supabase.functions.invoke('send-signup-welcome-sms', {
          body: {
            to: phoneNumber.trim(),
            fullName: user.user_metadata?.full_name || user.user_metadata?.name || '',
          },
        }).catch(err => console.log('Welcome SMS failed (non-critical):', err));
      }

      // Captured once, in the org-creation insert itself. Not a follow-up
      // update: migration 20260616202614 revoked table-wide UPDATE on
      // organizations from authenticated and re-granted only
      // (name, slug, logo_url, updated_at), so a later update of this column
      // would be silently denied. Built outside the retry loop — the payload
      // does not change between slug attempts.
      const onboardingAnswersPayload = buildAnswersPayload(normalizeAnswers(answers));

      let orgData: any = null;

      // Query the DB authoritatively at submit time rather than trusting
      // context — OrganizationProvider may not have loaded yet if the page
      // mounted while the async fetch was still in flight.
      const { data: existingOrg } = await supabase
        .from('organizations')
        .select('id, needs_onboarding')
        .eq('owner_id', user.id)
        .eq('needs_onboarding', true)
        .maybeSingle();

      console.log('[ONBOARDING-SUBMIT] context org:', organization?.id, 'needs_onboarding:', organization?.needs_onboarding);
      console.log('[ONBOARDING-SUBMIT] DB query org:', existingOrg?.id, 'needs_onboarding:', existingOrg?.needs_onboarding);

      if (existingOrg) {
        // Provisioned org exists — UPDATE it with onboarding data.
        console.log('[ONBOARDING-SUBMIT] Branch A: UPDATE existing org', existingOrg.id);
        const slug = initialSlug;
        const { data, error } = await supabase
          .from('organizations')
          .update({
            name,
            slug,
            onboarding_answers: onboardingAnswersPayload,
            needs_onboarding: false,
          })
          .eq('id', existingOrg.id)
          .select()
          .single();

        console.log('[ONBOARDING-SUBMIT] UPDATE result:', error ? 'ERROR: ' + error.message : 'OK, needs_onboarding=' + data?.needs_onboarding);
        if (error) throw error;
        orgData = data;
      } else {
        // No provisioned org — create a new one from scratch.
        console.log('[ONBOARDING-SUBMIT] Branch B: INSERT new org');
        for (let attempt = 0; attempt < 3; attempt++) {
          const slug = attempt === 0 ? initialSlug : `${initialSlug}-${randomSuffix()}`;

          const { data, error } = await supabase
            .from('organizations')
            .insert({
              name,
              owner_id: user.id,
              slug,
              onboarding_answers: onboardingAnswersPayload,
              needs_onboarding: false,
            })
            .select()
            .single();

          if (!error) {
            orgData = data;
            break;
          }

          if (error.code === '23505' && (error.message || '').includes('organizations_slug_key')) {
            continue;
          }

          throw error;
        }

        if (!orgData) {
          throw new Error('Business name is already taken. Please choose a different business name.');
        }

        // Create the membership for the owner (only for new orgs — provisioned
        // orgs already have the membership from provision-trial-org).
        const { error: memberError } = await supabase
          .from('org_memberships')
          .insert({
            organization_id: orgData.id,
            user_id: user.id,
            role: 'owner',
          });

        if (memberError) throw memberError;
      }

      // Notify platform admin with the REAL business data from onboarding,
      // not the placeholder values from provisioning. This is the single
      // alert for a new customer — provision-trial-org no longer sends one
      // (see Lovable prompt). Uses the business name they entered, their
      // email, and their phone if collected.
      supabase.functions.invoke('notify-platform-admin-signup', {
        body: {
          email: user.email || '',
          fullName: user.user_metadata?.full_name || user.user_metadata?.name || name,
          phone: phoneNumber.trim() || undefined,
          signupMethod: isNative ? 'native-onboarding' : 'web-onboarding',
          businessName: name,
        },
      }).catch(err => console.log('Admin notification failed (non-critical):', err));

      // Record the referral, if this signup arrived via someone's link.
      //
      // The client sends the ORG ID and the CODE and nothing else. It does not
      // name the referrer, set a status, or grant anything — claim-referral
      // resolves all of that on the service role. That split is deliberate:
      // organizations' INSERT policy is (auth.uid() = owner_id) with no column
      // enumeration, so any attribution a client could write, a client could
      // forge.
      //
      // Deliberately non-fatal. A failed claim must never cost someone their
      // signup, and org_referrals' UNIQUE(referred_org_id) means a retry can
      // never double-attribute.
      const capturedCode = readCapturedReferral();
      if (capturedCode) {
        try {
          const { error: refErr } = await supabase.functions.invoke('claim-referral', {
            body: { organization_id: orgData.id, referral_code: capturedCode },
          });
          // invoke() RESOLVES with an error object on non-2xx rather than
          // throwing, so this branch is the real failure path.
          if (refErr) {
            console.error('[referral] claim failed:', refErr);
          } else {
            // Clear only on success. Left in place, a second org created from
            // this browser would attribute to the same referrer again.
            clearCapturedReferral();
          }
        } catch (err) {
          console.error('[referral] claim threw:', err);
        }
      }

      // Create default business settings
      await supabase.from('business_settings').insert({
        organization_id: orgData.id,
        company_name: name,
        currency,
        timezone,
      });

      // Create service categories if defined
      if (cleaningTemplate.categories && cleaningTemplate.categories.length > 0) {
        const categoryInserts = cleaningTemplate.categories.map((cat, index) => ({
          organization_id: orgData.id,
          name: cat,
          color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index % 5],
        }));

        await supabase
          .from('service_categories')
          .insert(categoryInserts);
      }

      // Create selected services from template
      const templateServices = cleaningTemplate.services
        .filter(s => selectedServices.has(s.name))
        .map(service => ({
          organization_id: orgData.id,
          name: service.name,
          description: service.description,
          price: service.price,
          duration: service.duration,
          deposit_amount: service.depositAmount || 0,
          is_active: true,
        }));

      // Add custom services
      const customServiceInserts = customServices
        .filter(s => selectedServices.has(s.name))
        .map(service => ({
          organization_id: orgData.id,
          name: service.name,
          description: service.description,
          price: 0,
          duration: 60,
          deposit_amount: 0,
          is_active: true,
        }));

      const allServicesToCreate = [...templateServices, ...customServiceInserts];

      if (allServicesToCreate.length > 0) {
        const { error: servicesError } = await supabase
          .from('services')
          .insert(allServicesToCreate);

        if (servicesError) {
          console.error('Error creating services:', servicesError);
        }
      }

      // Get user's phone from profile for onboarding complete SMS
      const { data: profileData } = await supabase
        .from('profiles')
        .select('phone, full_name')
        .eq('id', user.id)
        .maybeSingle();

      // Send onboarding complete SMS (non-blocking) - uses org's SMS settings
      if (profileData?.phone) {
        supabase.functions.invoke('send-onboarding-complete-sms', {
          body: {
            to: profileData.phone,
            businessName: name,
            organizationId: orgData.id,
            ownerName: profileData.full_name?.split(' ')[0] || '',
          },
        }).catch(err => console.log('Onboarding SMS failed (non-critical):', err));
      }

      toast.success('Business created successfully with your services!');

      // Fire Meta CompleteRegistration standard event for ad attribution
      logMetaEvent('fb_mobile_complete_registration', { fb_registration_method: 'app' });

      // Persist qualifying answers for /choose-plan personalization.
      try {
        sessionStorage.setItem(
          'tw_onboarding_answers',
          JSON.stringify({ ...answers, businessName: name }),
        );
      } catch { /* no-op */ }

      // Set the org directly in context from the confirmed DB write.
      // This avoids the context-race: refetch() updates state async and
      // AdminRoute reads stale context on the first render after navigate.
      // setOrganizationDirect sets it synchronously so AdminRoute sees
      // needs_onboarding: false on the first render.
      console.log('[ONBOARDING-SUBMIT] setting org directly in context:', orgData.id, 'needs_onboarding:', orgData.needs_onboarding);
      try {
        setOrganizationDirect(orgData, 'owner');
      } catch (ctxErr) {
        console.error('[ONBOARDING-SUBMIT] setOrganizationDirect failed:', ctxErr);
        toast.error('Business created but failed to activate it. Please restart the app.');
        return;
      }

      if (isNative) {
        console.log('[ONBOARDING-SUBMIT] navigating to /dashboard/help');
        navigate('/dashboard/help', { replace: true });
      } else {
        // Web: "Building your dashboard" overlay, then paywall.
        setBuilding(true);
        [0, 1, 2, 3].forEach((stage) => {
          window.setTimeout(() => setBuildStage(stage + 1), 700 + stage * 800);
        });
        window.setTimeout(() => navigate('/choose-plan'), 4200);
      }
    } catch (error: any) {
      console.error('Error creating organization:', error);
      toast.error(error.message || 'Failed to create business');
    } finally {
      setLoading(false);
    }
  };

  // Phone is now optional for App Store compliance (Guideline 5.1.1)
  const canProceedStep1 = businessName.trim().length >= 2;
  const canProceedStep2 = selectedServices.size > 0;

  // 1 name · 2-6 the five qualifying questions · 7 services.
  const totalSteps = 7;
  const currentQuestion =
    step >= 2 && step <= 6 ? QUALIFYING_QUESTIONS[step - 2] : null;

  // Multi-select, so nothing auto-advances any more: the user has to be able to
  // tick a second option, which means an explicit Continue. The checked state is
  // its own acknowledgement, so the old 280ms flash-then-advance is gone.
  const toggleQualifyingOption = (key: string, value: string) => {
    setAnswers((prev) => {
      const current = prev[key] ?? [];
      return {
        ...prev,
        [key]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      };
    });
  };

  // Every question requires at least one answer. Auto-advance made that implicit
  // — a question could not be passed without answering it — and a Continue button
  // that accepted an empty selection would quietly make all five optional.
  const canProceedQuestion =
    !!currentQuestion && (answers[currentQuestion.key]?.length ?? 0) > 0;

  // Show loading spinner while checking organization status
  if (orgLoading) {
    return (
      <>
      <SEOHead
        title="Set Up Your Business | TidyWise"
        description="Loading your TidyWise business setup wizard. This takes a moment while we check your account — you'll be guided through the rest in two short steps."
        noIndex
      />
      <h1 className="sr-only">Setting up your TidyWise business</h1>
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
      </>
    );
  }

  return (
    <div
      className="portal-v2 portal-v2-scroll min-h-screen flex flex-col items-center justify-center bg-background p-4 pt-16"
      style={{ paddingTop: 'max(4rem, env(safe-area-inset-top, 0px))' }}
    >
      {/* "Building your dashboard" overlay — staged reveal after creation,
          referencing the user's own answers, then lands on /choose-plan. */}
      {building && (
        <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-6">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-2">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <h2 className="pv-display text-3xl">
                Building {businessName.trim() || 'your business'}'s dashboard
              </h2>
              <p className="text-muted-foreground text-sm">This takes just a moment…</p>
            </div>
            <div className="space-y-3">
              {[
                'Creating your online booking page',
                'Setting up your team scheduler & CRM',
                PAIN_BUILD_LINE[primaryPain(normalizeAnswers(answers)) ?? ''] ||
                  'Automating your admin workflows',
                'Preparing your growth plan',
              ].map((line, i) => (
                <div
                  key={line}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 transition-all duration-500',
                    buildStage > i ? 'opacity-100 border-primary/40' : 'opacity-30 border-border',
                  )}
                >
                  {buildStage > i ? (
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm font-medium">{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <SEOHead
        title="Set Up Your Cleaning Business | TidyWise"
        description="Tell TidyWise about your cleaning business and pick the services you offer in two quick steps. You'll be ready to take bookings right after."
        canonical="/onboarding"
        noIndex
      />
      <h1 className="sr-only">Set up your cleaning business in TidyWise</h1>
      {/* Logout button in top right — below the notch */}
      <div className="absolute right-4" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          className="text-primary border-primary hover:bg-primary hover:text-primary-foreground"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>

      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="pv-display text-3xl">
            {currentQuestion ? currentQuestion.title : 'Set Up Your Cleaning Business'}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Let's start with your business name"}
            {currentQuestion && currentQuestion.description}
            {step === 7 && "Choose which cleaning services you want to offer"}
          </CardDescription>
          
          {/* Progress indicator */}
          <div className="flex items-center justify-center gap-2 mt-4">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
              <div 
                key={s}
                className={cn(
                  "h-2 rounded-full transition-all",
                  s === step ? "w-8 bg-primary" : s < step ? "w-4 bg-primary/60" : "w-4 bg-muted"
                )}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Step {step} of {totalSteps}</p>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Step 1: Business Name & Phone */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business Name</Label>
                <Input
                  id="businessName"
                  type="text"
                  placeholder="My Awesome Business"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="text-lg h-12"
                  autoFocus
                />
                {businessName && (
                  <p className="text-sm text-muted-foreground">
                    Your booking URL will be: <span className="font-mono text-primary">{baseSlug || 'your-business'}</span>
                  </p>
                )}
              </div>
              
              {/* Phone number collection - always optional for App Store compliance */}
              <div className="space-y-2">
                <Label htmlFor="phoneNumber" className="flex items-center gap-2">
                  Phone Number
                  <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <Input
                  id="phoneNumber"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">We'll send you tips and updates to help grow your business!</p>
              </div>

              <div className="space-y-2 pt-2">
                <Label className="text-sm font-medium">Region</Label>
                <p className="text-xs text-muted-foreground -mt-1">
                  We auto-detected these — change them if needed.
                </p>
                <LocalePickers
                  currency={currency}
                  timezone={timezone}
                  onCurrencyChange={setCurrency}
                  onTimezoneChange={setTimezone}
                />
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={!canProceedStep1}
                onClick={() => setStep(2)}
              >
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Steps 2-6: Qualifying questions — multi-select, then Continue */}
          {currentQuestion && (
            <div className="space-y-3">
              {currentQuestion.options.map((opt) => {
                const selected =
                  answers[currentQuestion.key]?.includes(opt.value) ?? false;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleQualifyingOption(currentQuestion.key, opt.value)}
                    className={cn(
                      'w-full flex items-center justify-between rounded-lg border p-4 text-left transition-all',
                      'hover:border-primary hover:bg-primary/5',
                      selected ? 'border-primary bg-primary/10 shadow-sm' : 'border-border',
                    )}
                  >
                    <span>
                      <span className="block font-medium">{opt.label}</span>
                      {opt.sub && (
                        <span className="block text-sm text-muted-foreground mt-0.5">{opt.sub}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'ml-4 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                      )}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })}
              <Button
                className="w-full"
                size="lg"
                disabled={!canProceedQuestion}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            </div>
          )}

          {/* Step 7: Service Selection */}
          {step === 7 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedServices.size} of {totalServicesCount} services selected
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={selectAllServices}>
                    Select All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAllServices}>
                    Deselect All
                  </Button>
                </div>
              </div>
              
              <div className="max-h-[350px] overflow-y-auto space-y-2 pr-2">
                {/* Template services */}
                {cleaningTemplate.services.map((service) => {
                  const isSelected = selectedServices.has(service.name);
                  return (
                    <button
                      key={service.name}
                      onClick={() => toggleService(service.name)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                        isSelected 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
                        isSelected 
                          ? "border-primary bg-primary" 
                          : "border-muted-foreground"
                      )}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">{service.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{service.description}</p>
                      </div>
                    </button>
                  );
                })}

                {/* Custom services */}
                {customServices.map((service) => {
                  const isSelected = selectedServices.has(service.name);
                  return (
                    <div
                      key={service.name}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg border transition-all",
                        isSelected 
                          ? "border-primary bg-primary/5" 
                          : "border-border"
                      )}
                    >
                      <button
                        onClick={() => toggleService(service.name)}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        <div className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
                          isSelected 
                            ? "border-primary bg-primary" 
                            : "border-muted-foreground"
                        )}>
                          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground">{service.name}</p>
                          <p className="text-sm text-muted-foreground truncate">{service.description}</p>
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeCustomService(service.name)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Add custom service form */}
              {showAddForm ? (
                <div className="border border-border rounded-lg p-4 space-y-3 bg-secondary/30">
                  <div className="space-y-2">
                    <Label htmlFor="newServiceName">Service Name</Label>
                    <Input
                      id="newServiceName"
                      placeholder="e.g., Express Service"
                      value={newServiceName}
                      onChange={(e) => setNewServiceName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newServiceDescription">Description (optional)</Label>
                    <Input
                      id="newServiceDescription"
                      placeholder="Brief description of the service"
                      value={newServiceDescription}
                      onChange={(e) => setNewServiceDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddForm(false);
                        setNewServiceName('');
                        setNewServiceDescription('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={addCustomService}
                      disabled={!newServiceName.trim()}
                    >
                      Add Service
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus className="mr-2 h-4 w-4" /> Add Custom Service
                </Button>
              )}

              <p className="text-xs text-muted-foreground text-center">
                You can always add, edit, or remove services later from the Services page.
              </p>
              
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep(6)}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button 
                  className="flex-1" 
                  disabled={loading || orgLoading || !canProceedStep2}
                  onClick={handleSubmit}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      Create Business <CheckCircle2 className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 text-center text-xs text-muted-foreground max-w-2xl">
        By creating an account you agree to our{' '}
        <TermsOfServiceDialog>
          <button type="button" className="underline underline-offset-4 hover:text-foreground transition-colors">Terms</button>
        </TermsOfServiceDialog>
        {' '}and acknowledge our{' '}
        <Link
          to="/privacy-policy"
          className="underline underline-offset-4 hover:text-foreground transition-colors"
        >
          Privacy Policy
        </Link>
        .
      </div>
    </div>
  );
}
