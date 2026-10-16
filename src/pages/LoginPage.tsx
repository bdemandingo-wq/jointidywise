/**
 * LOGIN PAGE - Email/Password + Apple/Google OAuth on native
 */

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SEOHead } from '@/components/SEOHead';
import { useNavigate, Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthNoSession, supabaseNoSession } from '@/hooks/useAuthNoSession';
import { useOrganization } from '@/contexts/OrganizationContext';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { openEmbeddedCheckout, readCheckoutSession } from '@/lib/embeddedCheckout';
import { safeOnboardingNext } from '@/lib/onboardingWinback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { TermsOfServiceDialog } from '@/components/legal/TermsOfServiceDialog';
import { SplashScreen } from '@/components/SplashScreen';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, ArrowLeft, Mail, Lock, HardHat, Users } from 'lucide-react';
import { z } from 'zod';
import { Capacitor } from '@capacitor/core';
import { APPLE_OAUTH_ENABLED, GOOGLE_OAUTH_ENABLED } from '@/lib/oauthFlags';
import { clearCachedStartupOrg } from '@/lib/startupCache';

// Validation schema
const loginSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address'),
  password: z.string().min(1, 'Please enter your password'),
});

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const claimSlug = searchParams.get('claim');
  const isNative = Capacitor.isNativePlatform();
  // In-app signup is now supported (trial-first, no payment).
  const SHOW_NATIVE_SIGNUP_LINK = true;
  const { user, loading: authLoading, initialCleanupDone, provisioning, signIn, signInWithApple, signInWithGoogle } = useAuthNoSession();
  const { organization, refetch: refetchOrganization } = useOrganization();
  const queryClient = useQueryClient();
  const [oauthLoading, setOauthLoading] = useState<'apple' | 'google' | null>(null);
  // Hard stop: break the login → dashboard → onboarding → login cycle after
  // 2 bounces. The counter persists across remounts via sessionStorage.
  const bounceKey = 'tw_login_bounce_count';
  const [orgRefetched, setOrgRefetched] = useState(false);

  // /auth and /login both render this component. Emit unique SEO meta per URL while
  // keeping the canonical pointed at /login so search engines consolidate ranking.
  const isAuthPath = location.pathname === '/auth';
  const seoTitle = isAuthPath
    ? 'Sign In or Create Your TidyWise Account'
    : 'Log In to TidyWise | Cleaning Business Software';
  const seoDescription = isAuthPath
    ? 'Access your TidyWise account to run your cleaning business — bookings, scheduling, invoicing, payroll, GPS, and team dispatch from one dashboard.'
    : 'Sign in to TidyWise to manage cleaning jobs, schedules, invoices, payroll, and your team from one dashboard.';

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [formData, setFormData] = useState({
    email: searchParams.get('email') ?? '',
    password: '',
  });
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  // After provisioning completes, refetch the org so OrganizationProvider
  // picks up the freshly created org. Without this, the provider resolved
  // to null before provisioning ran and never re-fetched.
  useEffect(() => {
    if (provisioning !== 'done' || orgRefetched) return;
    setOrgRefetched(true);
    // A false empty org from the sign-in race must not stay in the startup
    // snapshot. The refetch below reads the workspace again.
    clearCachedStartupOrg((filters) => {
      queryClient.removeQueries(filters);
    });
    refetchOrganization();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once when provisioning reaches done
  }, [provisioning, orgRefetched]);

  // Redirect if authenticated, provisioning resolved, AND org is present.
  // Gate on the org value, not just provisioning state — provisioning "done"
  // does not mean OrganizationProvider has the org yet.
  useEffect(() => {
    if (authLoading || !initialCleanupDone) return;
    if (!user) return;
    if (provisioning === 'pending') return;
    // For existing users (provisioning === 'idle' or 'done' with org already loaded),
    // org will be present. For new OAuth users, wait for the refetch to load it.
    if (provisioning === 'done' && !organization) return; // refetch in flight
    if (provisioning === 'failed') {
      // Check bounce count — break the cycle if we've been here too many times
      const bounces = parseInt(sessionStorage.getItem(bounceKey) || '0', 10);
      if (bounces >= 2) {
        sessionStorage.removeItem(bounceKey);
        toast.error('Could not set up your account. Please contact support.');
        return; // stay on login, don't loop
      }
      sessionStorage.setItem(bounceKey, String(bounces + 1));
    }
    // Clear bounce counter on successful path
    try { sessionStorage.removeItem(bounceKey); } catch { /* ignore */ }
    setShowSplash(true);
  }, [user, authLoading, initialCleanupDone, provisioning, organization]);

  const validateForm = (): boolean => {
    try {
      loginSchema.parse(formData);
      setErrors({});
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: { email?: string; password?: string } = {};
        err.errors.forEach(e => {
          if (e.path[0] === 'email') fieldErrors.email = e.message;
          if (e.path[0] === 'password') fieldErrors.password = e.message;
        });
        setErrors(fieldErrors);
        const first = err.errors[0]?.message;
        if (first) toast.error(first);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!validateForm()) return;

    setLoading(true);

    try {
      const { error } = await signIn(formData.email, formData.password);

      if (error) {
        // Generic message — never leak whether the email exists
        // or whether confirmation is pending. Both cases collapse here.
        const msg = String(error.message || '');
        const benign = msg.includes('Invalid login credentials') || msg.includes('Email not confirmed');
        toast.error(benign ? 'Invalid email or password.' : 'Could not sign you in. Please try again.');
        setLoading(false);
        return;
      }

      toast.success('Welcome back!');
      clearCachedStartupOrg((filters) => {
        queryClient.removeQueries(filters);
      });
      setShowSplash(true);
    } catch (error: any) {
      toast.error('Could not sign you in. Please try again.');
      setLoading(false);
    }
  };

  // Handle splash screen completion - navigate based on context.
  //
  // Lifetime can resume into checkout after email confirmation, via
  // ?plan=lifetime or a stored tw_pending_plan. Basic, Pro, and Custom
  // do not: those signups are the card-free 30-day Pro trial, and a
  // stored plan must not open Stripe from this page.
  const handleSplashComplete = async () => {
    if (claimSlug) {
      navigate(`/score/c/${encodeURIComponent(claimSlug)}?claim=1`, { replace: true });
      return;
    }

    const resumeOnboarding = safeOnboardingNext(searchParams.get('next'));
    if (resumeOnboarding) {
      navigate(resumeOnboarding, { replace: true });
      return;
    }

    // Pull pending-plan intent from either the URL or sessionStorage.
    // Only lifetime resumes into checkout. Interval is ignored here.
    let pendingPlan = searchParams.get('plan');
    if (!pendingPlan) {
      try {
        const raw = sessionStorage.getItem('tw_pending_plan');
        if (raw) {
          const parsed = JSON.parse(raw) as { plan?: string };
          pendingPlan = parsed?.plan ?? null;
        }
      } catch {
        // ignore parse / storage errors
      }
    }
    try {
      sessionStorage.removeItem('tw_pending_plan');
    } catch {
      // ignore
    }

    if (pendingPlan === 'lifetime') {
      try {
        const { data, error } = await supabaseNoSession.functions.invoke('buy-lifetime', { body: {} });
        // The catch below prefixes this with "Couldn't open checkout:", so the
        // function's own reason — sold out, already subscribed, price not
        // configured — completes the sentence instead of "non-2xx status code".
        if (error) throw new Error(await readEdgeFunctionError(error, 'please try again'));
        const session = readCheckoutSession(data);
        openEmbeddedCheckout({
          ...session,
          plan: 'lifetime',
          cancelPath: '/pricing?plan=lifetime&canceled=1',
        });
        return;
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

    if (provisioning === 'failed') {
      toast.error('Could not set up your account. Please try signing in again.');
      navigate('/login', { replace: true });
      return;
    }

    navigate('/dashboard');
  };

  // Show splash screen after successful login
  if (showSplash) {
    return (
      <SplashScreen
        onComplete={handleSplashComplete}
        minDuration={1500}
      />
    );
  }

  // Show loading spinner only during initial auth check
  if (authLoading || !initialCleanupDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      className="portal-v2 portal-v2-scroll min-h-screen bg-background flex flex-col overflow-x-hidden"
      // #16: on the native app the title was clipped under the iPhone notch —
      // respect the top safe-area inset.
      style={{ touchAction: 'manipulation', paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Both /auth and /login render this same page; canonical consolidates to /login as the preferred URL. */}
      <SEOHead title={seoTitle} description={seoDescription} canonical="/login" noIndex />
      <div className="flex-1 flex items-center justify-center p-4 w-full">
      <div className="w-full max-w-md">
        {/* Back to home link - only on web */}
        {!isNative && (
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        )}
        
        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center pb-4">
            <h1 className="pv-display text-3xl leading-none tracking-tight">Sign in to your TidyWise account</h1>
            <CardDescription>
              Welcome back
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* OAuth buttons — native only, Apple first (Guideline 4.8) */}
            {isNative && (APPLE_OAUTH_ENABLED || GOOGLE_OAUTH_ENABLED) && (
              <>
                <div className="space-y-3 mb-5">
                  {APPLE_OAUTH_ENABLED && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-12 text-base font-medium"
                      disabled={!!oauthLoading || loading}
                      onClick={async () => {
                        setOauthLoading('apple');
                        const { error } = await signInWithApple();
                        if (error) {
                          toast.error('Apple sign-in failed. Please try again.');
                          setOauthLoading(null);
                        }
                      }}
                    >
                      {oauthLoading === 'apple' ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                        </svg>
                      )}
                      Continue with Apple
                    </Button>
                  )}
                  {GOOGLE_OAUTH_ENABLED && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-12 text-base font-medium"
                      disabled={!!oauthLoading || loading}
                      onClick={async () => {
                        setOauthLoading('google');
                        const { error } = await signInWithGoogle();
                        if (error) {
                          toast.error('Google sign-in failed. Please try again.');
                          setOauthLoading(null);
                        }
                      }}
                    >
                      {oauthLoading === 'google' ? (
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      ) : (
                        <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                      )}
                      Continue with Google
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-5">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs tracking-widest text-muted-foreground">OR</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Email field */}
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
                    if (errors.email) setErrors({ ...errors, email: undefined });
                  }}
                  className={errors.email ? 'border-destructive' : ''}
                  required
                  autoComplete="email"
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email}</p>
                )}
              </div>

              {/* Password field */}
              <div className="space-y-2">
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={formData.password}
                    onChange={(e) => {
                      setFormData({ ...formData, password: e.target.value });
                      if (errors.password) setErrors({ ...errors, password: undefined });
                    }}
                    className={errors.password ? 'border-destructive' : ''}
                    required
                    autoComplete="current-password"
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
                <div className="text-right">
                  <Link
                    to="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
              </div>

              {/* Submit button */}
              <Button
                type="submit"
                variant="premium"
                disabled={loading}
                className="w-full bg-[hsl(230_84%_56%)] text-white shadow-md hover:bg-[hsl(224_72%_42%)] hover:text-white"
                style={{ touchAction: 'manipulation' }}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>

            </form>

            {/* Sign up: web shows the normal route; native opens the website
                in the system browser. Apple's US external-link rules (post
                Epic injunction, guideline 3.1.1(a)) permit this — if review
                ever objects, set SHOW_NATIVE_SIGNUP_LINK = false. */}
            {!isNative ? (
              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">Don't have an account? </span>
                <Link
                  to={claimSlug ? `/signup?claim=${encodeURIComponent(claimSlug)}` : '/signup'}
                  className="text-primary hover:underline font-medium"
                  {...(claimSlug ? { rel: "nofollow" } : {})}
                >
                  Create account
                </Link>
              </div>
            ) : SHOW_NATIVE_SIGNUP_LINK && (
              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">Don't have an account? </span>
                <Link
                  to="/signup"
                  className="text-primary hover:underline font-medium"
                >
                  Create account
                </Link>
              </div>
            )}

            {/* Staff & Client Portal links */}
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs tracking-widest text-muted-foreground">OTHER LOGINS</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Link
                to="/staff/login"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-secondary/50 transition-colors"
              >
                <HardHat className="w-4 h-4" />
                Staff Portal Login
              </Link>
              <Link
                to="/portal/login"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-secondary/50 transition-colors"
              >
                <Users className="w-4 h-4" />
                Client Portal Login
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

      {!isNative && (
      <section aria-labelledby="login-info-heading" className="bg-muted/30 border-t border-border py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 id="login-info-heading" className="text-2xl font-bold text-foreground">
            Welcome back to your TidyWise dashboard
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Sign in above to pick up right where you left off — review today's jobs,
            dispatch your team, send invoices, and stay on top of every booking. The
            TidyWise dashboard gives cleaning business owners a complete real-time view
            of operations from any device.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              After you sign in, you'll be able to
            </h3>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>View your live job board with cleaner locations, ETAs, and status updates</li>
              <li>Send branded quotes, invoices, and payment receipts in seconds</li>
              <li>Manage clients, contracts, and recurring jobs with a built-in CRM</li>
              <li>Track revenue, expenses, payroll, tips, and deposits at a glance</li>
              <li>Trigger automated SMS and email reminders to reduce no-shows</li>
              <li>Open the staff portal, client portal, and admin tools in one click</li>
            </ul>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            TidyWise was built specifically for the cleaning industry — residential maid
            services, commercial janitorial, post-construction cleanup, Airbnb turnover,
            and multi-location franchises all run their day-to-day on the platform. Unlike
            generic field-service tools, every workflow is tuned for the unique needs of
            cleaning operators: square-footage pricing, walkthrough notes, supply tracking,
            recurring contracts, before/after photos, and tip routing to the right cleaner.
          </p>

          <p className="text-muted-foreground leading-relaxed">
            Forgot your password? Use the reset option above to receive a secure email
            link. If you're a cleaner or office team member, sign in through the Staff
            Portal instead. Clients booking a recurring service should use the Client
            Portal. Need help? Our support team is one chat away inside the dashboard once
            you sign in.
          </p>

          <p className="text-muted-foreground leading-relaxed">
            New to TidyWise? Create your account in under a minute
            required and you can cancel anytime. Import your existing client list,
            configure services and pricing, set up online booking, and take your first
            job the same day you sign up.
          </p>
        </div>
      </section>
      )}
    </div>
  );
}