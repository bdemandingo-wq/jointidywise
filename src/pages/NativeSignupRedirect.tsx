/**
 * Native Signup Page — iOS App Store Compliant
 *
 * Three sign-up methods on one screen:
 *   1. Continue with Apple  (required by Guideline 4.8 when Google is present)
 *   2. Continue with Google
 *   3. Email + password
 *
 * Apple & Google are stubbed (disabled) until the OAuth providers are
 * configured in Supabase. The email/password path works immediately.
 *
 * After signup the component calls the `provision-trial-org` edge function
 * to create a trial org + owner membership, then lands the user on /dashboard.
 *
 * No payment is collected here — Apple rejects in-app purchase prompts
 * during signup. Payment comes at trial end, on the web.
 */

import { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthNoSession, supabaseNoSession } from '@/hooks/useAuthNoSession';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { TermsOfServiceDialog } from '@/components/legal/TermsOfServiceDialog';
import { TOS_VERSION } from '@/components/legal/termsContent';
import { SplashScreen } from '@/components/SplashScreen';
import { SEOHead } from '@/components/SEOHead';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Mail, Lock, User } from 'lucide-react';
import { z } from 'zod';
import { PERSON_NAME_MAX } from '@/lib/displayName';
import { readCapturedReferral } from '@/lib/referralAttribution';
import { persistSignupAttribution } from '@/lib/persistSignupAttribution';
import { ReferredSignupBanner } from '@/components/ReferredSignupBanner';

// ── Validation ──────────────────────────────────────────────────────
const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Name must be at least 2 characters').max(PERSON_NAME_MAX, `Name must be ${PERSON_NAME_MAX} characters or fewer`),
  email: z.string().trim().email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must include a letter')
    .regex(/[0-9]/, 'Password must include a number'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

import { APPLE_OAUTH_ENABLED, GOOGLE_OAUTH_ENABLED } from '@/lib/oauthFlags';

export default function NativeSignupPage() {
  const navigate = useNavigate();
  const {
    signUp,
    signInWithApple,
    signInWithGoogle,
    loading: authLoading,
    initialCleanupDone,
  } = useAuthNoSession();
  const { refetch: refetchOrganization } = useOrganization();

  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'apple' | 'google' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Provision trial org ───────────────────────────────────────────
  const provisionTrialOrg = async (): Promise<string | null> => {
    try {
      const { data, error } = await supabaseNoSession.functions.invoke('provision-trial-org', {
        body: { referral_code: readCapturedReferral() },
      });
      if (error) {
        console.error('Trial org provisioning failed:', error);
        return null;
      }
      return (data as { organization_id?: string })?.organization_id ?? null;
    } catch (err) {
      console.error('Trial org provisioning failed:', err);
      return null;
    }
  };

  // ── Email/password submit ─────────────────────────────────────────
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
        const first = err.errors[0]?.message;
        if (first) toast.error(first);
      }
      return false;
    }
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    if (!tosAccepted) {
      toast.error('You must agree to the Terms of Service to continue.');
      return;
    }

    setLoading(true);

    try {
      // Block staff self-signup
      try {
        const { data: staffCheck } = await supabaseNoSession.functions.invoke('check-email-staff', {
          body: { email: formData.email },
        });
        if (staffCheck?.is_staff) {
          toast.error('This email is registered as staff. Ask your manager to invite you through the staff portal.');
          setLoading(false);
          return;
        }
      } catch {
        // Non-blocking
      }

      const { data, error } = await signUp(
        formData.email,
        formData.password,
        { full_name: formData.fullName },
      );

      if (error) {
        if (error.message.includes('already registered')) {
          toast.error('An account with this email already exists. Please sign in instead.');
        } else {
          toast.error(error.message);
        }
        setLoading(false);
        return;
      }

      if (data?.user) {
        // Save first-touch UTM before the trial org is created so the insert
        // trigger can attach organization_id. Failure must not block signup.
        await persistSignupAttribution();

        // Create profile (the handle_new_user trigger may have already
        // done this, so ignore duplicate-key errors)
        const { error: profileError } = await supabaseNoSession
          .from('profiles')
          .insert({
            id: data.user.id,
            email: formData.email,
            full_name: formData.fullName,
          });

        if (profileError && !profileError.message.includes('duplicate key')) {
          console.error('Error creating profile:', profileError);
        }

        // Log TOS acceptance
        try {
          await supabaseNoSession.functions.invoke('record-tos-acceptance', {
            body: { tos_version: TOS_VERSION },
          });
        } catch {
          // Non-critical
        }

        // Admin notification deferred to onboarding completion, where the
        // real business name is available. Don't alert at provisioning —
        // the data is placeholder until the user finishes the wizard.

        // Welcome email (fire-and-forget)
        supabaseNoSession.functions.invoke('send-welcome-email', {
          body: {
            email: formData.email,
            fullName: formData.fullName,
          },
        }).catch(() => {});

        // Provision the trial org, then imperatively refetch.
        // refetch() reads the user from supabase.auth.getSession()
        // instead of from the React closure, so it works even though
        // React hasn't re-rendered with the auth state yet.
        const orgId = await provisionTrialOrg();
        if (orgId) {
          try { localStorage.setItem('tidywise_active_org', orgId); } catch { /* ignore */ }
        }
        await refetchOrganization();
        toast.success('Account created! Welcome aboard.');
        setLoading(false);
        setShowSplash(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'An error occurred. Please try again.');
      setLoading(false);
    }
  };

  // ── OAuth handlers ────────────────────────────────────────────────
  const handleAppleSignup = async () => {
    if (!APPLE_OAUTH_ENABLED) return;
    if (!tosAccepted) {
      toast.error('You must agree to the Terms of Service to continue.');
      return;
    }
    setOauthLoading('apple');
    const { error } = await signInWithApple();
    if (error) {
      toast.error('Apple sign-in failed. Please try again.');
      setOauthLoading(null);
    }
    // On success the deep-link listener in nativeOAuth.ts sets the
    // session, which triggers the auth state change → splash → dashboard.
    // provisionTrialOrg will be called from the auth callback handler.
  };

  const handleGoogleSignup = async () => {
    if (!GOOGLE_OAUTH_ENABLED) return;
    if (!tosAccepted) {
      toast.error('You must agree to the Terms of Service to continue.');
      return;
    }
    setOauthLoading('google');
    const { error } = await signInWithGoogle();
    if (error) {
      toast.error('Google sign-in failed. Please try again.');
      setOauthLoading(null);
      return;
    }
    try {
      sessionStorage.setItem('tw-oauth-signup', 'google');
    } catch {
      // Native tags do not load. The web return path reads this flag.
    }
  };

  // ── Splash complete → dashboard ───────────────────────────────────
  // Memoized: SplashScreen's useEffect depends on [onComplete]. Without
  // useCallback, every context re-render (auth, org, subscription) creates
  // a new function reference → resets the 1500ms timer → splash hangs.
  const handleSplashComplete = useCallback(() => {
    navigate('/dashboard', { replace: true });
  }, [navigate]);

  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} minDuration={1500} />;
  }

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
      style={{ touchAction: 'manipulation', paddingTop: 'env(safe-area-inset-top)' }}
    >
      <SEOHead title="Sign Up | TidyWise" description="Create your TidyWise account." noIndex />
      <div className="flex-1 flex items-center justify-center p-4 w-full">
        <div className="w-full max-w-md">
          <Card className="border-border/50 shadow-lg">
            <CardHeader className="text-center pb-4">
              <h1 className="pv-display text-3xl leading-none tracking-tight">
                Create your account
              </h1>
              <CardDescription>
                Start free — 30 days of Pro, no card. No payment required.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <ReferredSignupBanner />
              {/* ── OAuth buttons ─────────────────────────────────── */}
              <div className="space-y-3">
                {/* Continue with Apple — Guideline 4.8 requires this
                    when Google is present */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 text-base font-medium"
                  disabled={!APPLE_OAUTH_ENABLED || !!oauthLoading || loading}
                  onClick={handleAppleSignup}
                >
                  {oauthLoading === 'apple' ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                  )}
                  {APPLE_OAUTH_ENABLED ? 'Continue with Apple' : 'Continue with Apple (coming soon)'}
                </Button>

                {/* Continue with Google */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 text-base font-medium"
                  disabled={!GOOGLE_OAUTH_ENABLED || !!oauthLoading || loading}
                  onClick={handleGoogleSignup}
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
                  {GOOGLE_OAUTH_ENABLED ? 'Continue with Google' : 'Continue with Google (coming soon)'}
                </Button>
              </div>

              {/* ── Divider ──────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs tracking-widest text-muted-foreground">OR</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* ── Email / Password form ────────────────────────── */}
              <form onSubmit={handleEmailSignup} className="space-y-4" noValidate>
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
                    placeholder="Jane Doe"
                    value={formData.fullName}
                    onChange={e => {
                      setFormData({ ...formData, fullName: e.target.value });
                      if (errors.fullName) setErrors({ ...errors, fullName: '' });
                    }}
                    className={errors.fullName ? 'border-destructive' : ''}
                    required
                    autoComplete="name"
                  />
                  {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
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
                    onChange={e => {
                      setFormData({ ...formData, email: e.target.value });
                      if (errors.email) setErrors({ ...errors, email: '' });
                    }}
                    className={errors.email ? 'border-destructive' : ''}
                    required
                    autoComplete="email"
                  />
                  {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
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
                      placeholder="8+ characters"
                      value={formData.password}
                      onChange={e => {
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
                      {showPassword
                        ? <EyeOff className="h-4 w-4 text-muted-foreground" />
                        : <Eye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                  {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters with a letter and a number.
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
                      placeholder="Re-enter password"
                      value={formData.confirmPassword}
                      onChange={e => {
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
                      {showConfirmPassword
                        ? <EyeOff className="h-4 w-4 text-muted-foreground" />
                        : <Eye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                  {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword}</p>}
                </div>

                {/* TOS Checkbox */}
                <div className="flex items-start gap-3 pt-2">
                  <Checkbox
                    id="tos"
                    checked={tosAccepted}
                    onCheckedChange={checked => setTosAccepted(checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor="tos" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                    I agree to the TidyWise{' '}
                    <TermsOfServiceDialog>
                      <button type="button" className="underline underline-offset-2 hover:text-foreground transition-colors">
                        Terms of Service
                      </button>
                    </TermsOfServiceDialog>
                    .
                  </label>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  variant="premium"
                  disabled={loading}
                  style={{ touchAction: 'manipulation' }}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Account
                </Button>
              </form>

              {/* Sign-in link */}
              <div className="text-center text-sm">
                <span className="text-muted-foreground">Already have an account? </span>
                <Link to="/login" className="text-primary hover:underline font-medium">
                  Sign in
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Legal */}
          <div className="mt-6 text-center text-xs text-muted-foreground">
            By continuing you agree to our{' '}
            <TermsOfServiceDialog>
              <button type="button" className="underline underline-offset-4 hover:text-foreground transition-colors">
                Terms
              </button>
            </TermsOfServiceDialog>
            .
          </div>
        </div>
      </div>
    </div>
  );
}
