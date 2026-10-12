/**
 * SIGNUP PAGE - Email/Password only
 */

import { useState, useEffect } from 'react';
import { SEOHead } from '@/components/SEOHead';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuthNoSession, supabaseNoSession } from '@/hooks/useAuthNoSession';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TOS_VERSION } from '@/components/legal/termsContent';
import { TermsOfServiceDialog } from '@/components/legal/TermsOfServiceDialog';
import { SplashScreen } from '@/components/SplashScreen';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, ArrowLeft, Mail, Lock, User, Phone, Crown, Sparkles, Zap, Settings as SettingsIcon } from 'lucide-react';
import { z } from 'zod';
import { PERSON_NAME_MAX } from '@/lib/displayName';

// Plan metadata for the "you're signing up to start X" banner. Kept
// inline so the signup page doesn't have to import the full features.ts
// machinery — labels and prices only.
const PLAN_META: Record<string, { label: string; price: string; Icon: React.ComponentType<{ className?: string }>; ctaLabel: string }> = {
  basic: { label: 'Basic', price: '$49/mo', Icon: Sparkles, ctaLabel: 'Sign up & continue to checkout' },
  pro: { label: 'Pro', price: '$97/mo', Icon: Zap, ctaLabel: 'Sign up & continue to checkout' },
  custom: { label: 'Custom', price: '$197/mo', Icon: SettingsIcon, ctaLabel: 'Sign up & continue to checkout' },
  lifetime: { label: 'Lifetime', price: '$300 one-time', Icon: Crown, ctaLabel: 'Sign up & claim my lifetime spot' },
};

// Validation schema
const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Name must be at least 2 characters').max(PERSON_NAME_MAX, `Name must be ${PERSON_NAME_MAX} characters or fewer`),
  email: z.string().trim().email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must include a letter')
    .regex(/[0-9]/, 'Password must include a number'),
  confirmPassword: z.string(),
  phone: z.string().optional(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export default function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const claimSlug = searchParams.get('claim');
  // Plan-pre-selection: when the visitor came from /pricing they have
  // ?plan=basic|pro|custom|lifetime and (for subscriptions)
  // ?interval=monthly|yearly. The form shows context up top so they
  // know what they're signing up for, and post-signup we route them
  // straight into Stripe Checkout for that plan instead of dropping
  // them on the dashboard.
  const rawPlan = searchParams.get('plan');
  const selectedPlan: keyof typeof PLAN_META | null =
    rawPlan && rawPlan in PLAN_META ? (rawPlan as keyof typeof PLAN_META) : null;
  const rawInterval = searchParams.get('interval');
  const selectedInterval: 'monthly' | 'yearly' =
    rawInterval === 'yearly' ? 'yearly' : 'monthly';
  const planMeta = selectedPlan ? PLAN_META[selectedPlan] : null;

  const {
    user,
    loading: authLoading,
    initialCleanupDone,
    signUp,
    signOut
  } = useAuthNoSession();

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // /signup?plan=… is the OLD signup-first checkout path. The new
  // pricing flow goes /pricing → Stripe directly (anonymous checkout)
  // → webhook creates the account → email link sets password. Any
  // visitor still landing here from a cached link or stale bookmark
  // gets redirected back to /pricing with their plan choice so they
  // re-enter the canonical flow instead of falling through this
  // deprecated path.
  useEffect(() => {
    if (selectedPlan) {
      const params = new URLSearchParams();
      params.set('plan', selectedPlan);
      params.set('interval', selectedInterval);
      navigate(`/pricing?${params.toString()}`, { replace: true });
    }
  }, [selectedPlan, selectedInterval, navigate]);

  // Standard "already authenticated" redirect.
  useEffect(() => {
    if (authLoading || !initialCleanupDone) return;
    if (user && !selectedPlan) {
      setShowSplash(true);
    }
  }, [user, authLoading, initialCleanupDone, selectedPlan]);


  const validateForm = (): boolean => {
    try {
      signupSchema.parse(formData);
      setErrors({});
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.errors.forEach(e => {
          const field = e.path[0] as string;
          fieldErrors[field] = e.message;
        });
        setErrors(fieldErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    if (!tosAccepted) {
      toast.error('You must agree to the Terms of Service and refund policy to continue.');
      return;
    }
    
    setLoading(true);

    try {
      // Block self-signup for emails already attached as staff on an org —
      // staff must use the staff portal invite, not the public pricing signup.
      try {
        const { data: staffCheck } = await supabaseNoSession.functions.invoke('check-email-staff', {
          body: { email: formData.email },
        });
        if (staffCheck?.is_staff) {
          toast.error("This email is registered as staff. Ask your manager to invite you through the staff portal.");
          setLoading(false);
          return;
        }
      } catch (err) {
        console.log('staff check failed (non-blocking):', err);
      }

      const { data, error } = await signUp(
        formData.email,
        formData.password,
        { full_name: formData.fullName, phone: formData.phone }
      );

      
      if (error) {
        if (error.message.includes('already registered')) {
          if (claimSlug) {
            toast.error('You already have an account — log in to claim this profile.');
            navigate(`/login?claim=${encodeURIComponent(claimSlug)}`);
          } else {
            toast.error('An account with this email already exists. Please log in instead.');
          }
        } else {
          toast.error(error.message);
        }
        setLoading(false);
        return;
      }
      
      if (data?.user) {
        // Create profile
        const { error: profileError } = await supabaseNoSession
          .from('profiles')
          .insert({
            id: data.user.id,
            email: formData.email,
            full_name: formData.fullName,
            phone: formData.phone || null,
          });
        
        if (profileError && !profileError.message.includes('duplicate key')) {
          console.error('Error creating profile:', profileError);
        }

        // Log TOS acceptance via a server-side edge function. The
        // function captures IP and user-agent from request headers
        // instead of having the browser hit ipify.org — ipify leaked
        // every signup to a third party and was blocked by a meaningful
        // share of users (Nord Threat Protection, uBlock, Brave Shields)
        // which left ip_address NULL on the resulting tos_acceptances
        // row, degrading its value as Visa CE 3.0 evidence.
        try {
          await supabaseNoSession.functions.invoke('record-tos-acceptance', {
            body: { tos_version: TOS_VERSION },
          });
        } catch (tosErr) {
          console.error('TOS acceptance logging failed (non-critical):', tosErr);
        }
        
        // Admin notification deferred to onboarding completion, where the
        // real business name is available. Don't alert at signup — the user
        // hasn't entered their business details yet.
        
        toast.success('Account created! Welcome aboard.');

        // Fire-and-forget welcome email via our own send-welcome-email
        // edge function (Resend under the hood). Previously this was a
        // Make.com webhook — if Make ever broke or the subscription
        // lapsed, no welcome email went out and we'd never know. Owning
        // the call removes that single point of failure.
        supabaseNoSession.functions.invoke('send-welcome-email', {
          body: {
            email: formData.email,
            fullName: formData.fullName,
          },
        }).catch(err => console.log('Welcome email failed (non-critical):', err));
        setLoading(false);
        setShowSplash(true);
      }
    } catch (error: any) {
      toast.error(error.message || 'An error occurred. Please try again.');
      setLoading(false);
    }
  };

  // Handle splash screen completion - navigate based on context
  const handleSplashComplete = async () => {
    if (claimSlug) {
      // Send back to score page with ?claim=1 — page will auto-claim using fresh session.
      navigate(`/score/c/${encodeURIComponent(claimSlug)}?claim=1`, { replace: true });
      return;
    }

    // No plan picked → straight to dashboard. Drop any stale persisted
    // plan since they're not continuing into checkout.
    if (!selectedPlan) {
      try { sessionStorage.removeItem('tw_pending_plan'); } catch { /* no-op */ }
      navigate('/dashboard');
      return;
    }


    // Plan-pre-selection flow: hand off to Stripe Checkout. The
    // Bearer token has to be live for the edge function to authorize
    // the caller. After signUp, the session may or may not be ready:
    //   - Supabase auto-signs-in when email confirmation is OFF
    //   - When email confirmation is ON, getSession() returns null
    //     until the user clicks the email link
    // Confirm the session before invoking — otherwise the edge call
    // 401s and the error surfaces as a confusing "edge function error".
    const { data: sessionData } = await supabaseNoSession.auth.getSession();
    if (!sessionData?.session) {
      // No session yet — most likely Supabase requires email confirmation.
      // Persist the plan choice so the user can resume checkout after
      // they confirm and log in.
      try {
        sessionStorage.setItem(
          'tw_pending_plan',
          JSON.stringify({ plan: selectedPlan, interval: selectedInterval }),
        );
      } catch {
        // sessionStorage unavailable (private mode, storage full) — fall
        // through. We'll just send them to login without resume context.
      }
      toast.info(
        "Check your email to confirm your account, then sign in to finish checkout.",
      );
      navigate(`/login?plan=${selectedPlan}&interval=${selectedInterval}`);
      return;
    }

    // Helper: navigate to Stripe Checkout. Use top window so we break
    // out of the Lovable preview iframe (Stripe Checkout sends
    // X-Frame-Options: DENY, which would otherwise blank the iframe).
    const goToCheckout = (url: string) => {
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = url;
          return;
        }
      } catch {
        // Cross-origin top access blocked — fall through to _top open.
      }
      window.open(url, '_top');
    };

    if (selectedPlan === 'lifetime') {
      try {
        const { data, error } = await supabaseNoSession.functions.invoke('buy-lifetime', { body: {} });
        // The catch below prefixes this with "Couldn't open checkout:", so the
        // function's own reason — sold out, already subscribed, price not
        // configured — completes the sentence instead of "non-2xx status code".
        if (error) throw new Error(await readEdgeFunctionError(error, 'please try again'));
        const url = (data as { url?: string })?.url;
        if (url) {
          goToCheckout(url);
          return;
        }
        throw new Error('Checkout URL missing');
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `Couldn't open lifetime checkout: ${err.message}`
            : "Couldn't open lifetime checkout — try again from /pricing.",
        );
        navigate('/dashboard');
        return;
      }
    }

    if (selectedPlan === 'basic' || selectedPlan === 'pro' || selectedPlan === 'custom') {
      try {
        const { data, error } = await supabaseNoSession.functions.invoke('create-subscription', {
          body: { plan: selectedPlan, interval: selectedInterval },
        });
        // The catch below prefixes this with "Couldn't open checkout:", so the
        // function's own reason — sold out, already subscribed, price not
        // configured — completes the sentence instead of "non-2xx status code".
        if (error) throw new Error(await readEdgeFunctionError(error, 'please try again'));
        const url = (data as { url?: string })?.url;
        if (url) {
          goToCheckout(url);
          return;
        }
        throw new Error('Checkout URL missing');
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `Couldn't open checkout: ${err.message}`
            : "Couldn't open checkout — try again from /dashboard/subscription.",
        );
        navigate('/dashboard');
        return;
      }
    }


    navigate('/dashboard');
  };

  // Show splash screen after successful signup
  if (showSplash) {
    return (
      <SplashScreen 
        onComplete={handleSplashComplete} 
        minDuration={1500}
      />
    );
  }

  // Show loading spinner during initial auth check
  if (authLoading || !initialCleanupDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background flex flex-col">
      <SEOHead title="Sign Up | TidyWise – Cleaning Business Software" description="Create your TidyWise account. Pick a plan from $49/mo (Basic), $97/mo (Pro), $197/mo (Custom), or grab one of 100 lifetime spots at $300." canonical="/signup" noIndex />
      <div className="flex-1 flex items-center justify-center p-4 w-full">
      <div className="w-full max-w-md">
        
        {/* Back link — when a plan is pre-selected, point back to /pricing
            so users can swap plans without losing context. Otherwise back
            to home. */}
        <Link
          to={planMeta ? '/pricing' : '/'}
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          {planMeta ? 'Back to plans' : 'Back to home'}
        </Link>

        {/* Plan-pre-selection banner. Visible only when the visitor
            came from /pricing with a chosen plan — confirms what they're
            buying so they don't lose context inside the signup form. */}
        {planMeta && (
          <div className="mb-4 rounded-lg border-2 border-primary/40 bg-primary/5 p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <planMeta.Icon className="h-5 w-5 text-primary" />

            </div>
            <div className="flex-1 min-w-0">
              <Badge variant="secondary" className="mb-1 text-[10px] uppercase tracking-wider">
                Next: payment
              </Badge>
              <p className="text-sm">
                Signing up to start{' '}
                <span className="font-semibold">{planMeta.label}</span>{' '}
                <span className="text-muted-foreground">
                  ({selectedPlan !== 'lifetime' && selectedInterval === 'yearly'
                    ? planMeta.price.replace('/mo', '/mo billed yearly · 2 months free')
                    : planMeta.price})
                </span>
              </p>
            </div>
          </div>
        )}

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center pb-4">
            <h1 className="pv-display text-3xl leading-none tracking-tight">
              {planMeta ? 'Almost there — create your account' : 'Create your TidyWise account'}
            </h1>
            <CardDescription>
              {planMeta
                ? `One quick step before checkout for ${planMeta.label}.`
                : 'Pick a plan after signup, or start with our Basic plan.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Full Name */}
              <div className="space-y-2">
                <Label htmlFor="fullName" className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Full Name
                </Label>
                <Input
                  id="fullName"
                  maxLength={PERSON_NAME_MAX}
                  type="text"
                  placeholder="John Doe"
                  value={formData.fullName}
                  onChange={(e) => {
                    setFormData({ ...formData, fullName: e.target.value });
                    if (errors.fullName) setErrors({ ...errors, fullName: '' });
                  }}
                  className={errors.fullName ? 'border-destructive' : ''}
                  required
                  autoComplete="name"
                />
                {errors.fullName && (
                  <p className="text-xs text-destructive">{errors.fullName}</p>
                )}
              </div>

              {/* Phone (optional) */}
              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  Phone Number
                  <span className="text-muted-foreground text-xs">(optional)</span>
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  autoComplete="tel"
                />
                <p className="text-xs text-muted-foreground">We'll send you a welcome text!</p>
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData({ ...formData, email: e.target.value });
                    if (errors.email) setErrors({ ...errors, email: '' });
                  }}
                  className={errors.email ? 'border-destructive' : ''}
                  required
                  autoComplete="email"
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email}</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => {
                      setFormData({ ...formData, password: e.target.value });
                      if (errors.password) setErrors({ ...errors, password: '' });
                    }}
                    className={errors.password ? 'border-destructive' : ''}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Use at least 8 characters with a mix of letters and numbers.
                </p>
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Confirm Password
                </Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={formData.confirmPassword}
                    onChange={(e) => {
                      setFormData({ ...formData, confirmPassword: e.target.value });
                      if (errors.confirmPassword) setErrors({ ...errors, confirmPassword: '' });
                    }}
                    className={errors.confirmPassword ? 'border-destructive' : ''}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-xs text-destructive">{errors.confirmPassword}</p>
                )}
              </div>

              {/* TOS & Refund Policy Checkbox */}
              <div className="flex items-start gap-3 pt-2">
                <Checkbox
                  id="tos"
                  checked={tosAccepted}
                  onCheckedChange={(checked) => setTosAccepted(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor="tos" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                  I agree to the TidyWise{' '}
                  <TermsOfServiceDialog>
                    <button type="button" className="underline underline-offset-2 hover:text-foreground transition-colors">
                      Terms of Service
                    </button>
                  </TermsOfServiceDialog>
                  . All payments are non-refundable. Subscriptions can be cancelled anytime but no refunds are issued for time already paid.
                </label>
              </div>

              {/* Submit button. CTA copy reflects post-signup intent
                  when a plan is pre-selected so the user knows checkout
                  is next, not a generic landing on the dashboard. */}
              <Button type="submit" className="w-full" disabled={loading || !tosAccepted}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {planMeta ? planMeta.ctaLabel : 'Create Account'}
              </Button>
            </form>

            {/* Login link */}
            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">Already have an account? </span>
              <Link
                to={claimSlug ? `/login?claim=${encodeURIComponent(claimSlug)}` : '/login'}
                className="text-primary hover:underline font-medium"
                {...(claimSlug ? { rel: "nofollow" } : {})}
              >
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Legal links */}
        <div className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to our{' '}
          <TermsOfServiceDialog>
            <button type="button" className="underline underline-offset-4 hover:text-foreground transition-colors">
              Terms
            </button>
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
      </div>

      <section aria-labelledby="signup-info-heading" className="bg-muted/30 border-t border-border py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 id="signup-info-heading" className="text-2xl font-bold text-foreground">
            Everything you need to run your cleaning business
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            TidyWise is the operating system for modern cleaning businesses. Create your
            plan above and you'll have access to the same software that thousands
            of independent cleaners, maid services, commercial janitorial teams, and
            franchise operators use to win more jobs and run leaner operations.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Your plan includes
            </h3>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>A branded online booking page where clients can book and pay 24/7</li>
              <li>Automated scheduling, dispatch, and route optimization for your team</li>
              <li>Instant quotes, invoicing, and secure payments with low processing fees</li>
              <li>A complete CRM with client history, notes, photos, and recurring contracts</li>
              <li>Built-in payroll, tip distribution, and deposit handling</li>
              <li>SMS and email automations for confirmations, reminders, and reviews</li>
              <li>Native iOS and Android apps for owners, staff, and clients</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Why cleaning business owners choose TidyWise
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              We built TidyWise because every other tool on the market was either too
              generic (built for plumbers and electricians) or too rigid (forces you into
              a single business model). Whether you charge by the hour, by the room, by
              square footage, by job, or with a recurring contract, TidyWise adapts to
              how you already work. Our users typically cut their admin time in half,
              fill more calendar slots, reduce no-shows by 60% or more, and grow recurring
              revenue without hiring more office staff.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              What happens after you sign up?
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              You'll go through a short guided onboarding to set up your services,
              pricing, service area, and team. You can import existing clients from a
              spreadsheet, sync your calendar, configure online booking, and connect a
              payment processor. Most owners are taking online bookings within the first
              day. Your data is encrypted, backed up daily, and never shared with anyone.
            </p>
          </div>

          <p className="text-muted-foreground leading-relaxed font-medium">
            Cancel any time. No long-term contracts.
          </p>
        </div>
      </section>
    </div>
  );
}