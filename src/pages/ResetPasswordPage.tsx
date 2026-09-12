import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2, Lock, Mail } from 'lucide-react';
import { z } from 'zod';

// Accept 6–8 digit codes — Supabase's default OTP is 6 digits, but the
// project can be configured up to 8. Hardcoding 8 here previously
// rejected every valid 6-digit code with "Code must be 8 digits" on
// any project that wasn't explicitly set to 8.
const CODE_MIN = 6;
const CODE_MAX = 8;

const passwordSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(new RegExp(`^\\d{${CODE_MIN},${CODE_MAX}}$`), `Code must be ${CODE_MIN}–${CODE_MAX} digits`),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Za-z]/, 'Password must include a letter')
      .regex(/[0-9]/, 'Password must include a number'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ['confirm'],
  });

const RESEND_COOLDOWN_SECONDS = 30;
const INVITE_PASSWORD_CREATED_KEY = 'tidywise_invite_password_created';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Email comes from /forgot-password navigation state, or ?email= query param
  // as a fallback (e.g. user pasted/refreshed). If neither is present, we send
  // them back to /forgot-password.
  const emailFromState = (location.state as { email?: string } | null)?.email;
  const emailFromQuery = searchParams.get('email') ?? undefined;
  const email = (emailFromState || emailFromQuery || '').trim();
  const requestedNext = searchParams.get('next');
  const nextPath = requestedNext?.startsWith('/accept-invite?token=') ? requestedNext : null;

  // Keep the invite-in-flight flag alive across this detour. AcceptInvitePage
  // clears it when it unmounts, but the code screen signs the user in, and
  // without the flag the auth provisioning effect would create a stray empty
  // trial workspace before the invite is accepted.
  useEffect(() => {
    if (!nextPath) return;
    try { sessionStorage.setItem('tidywise_invite_pending', 'true'); } catch { /* ignore */ }
  }, [nextPath]);



  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const [errors, setErrors] = useState<{ code?: string; password?: string; confirm?: string }>({});
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  // Redirect to /forgot-password if we have no email at all — but skip for
  // headless / prerender browsers so the snapshot of /reset-password actually
  // captures THIS page (instead of redirecting and snapshotting
  // ForgotPasswordPage at the /reset-password URL).
  useEffect(() => {
    if (!email) {
      const isHeadless =
        typeof navigator !== 'undefined' &&
        (navigator.webdriver === true || /HeadlessChrome|Prerender/i.test(navigator.userAgent));
      if (!isHeadless) {
        navigate('/forgot-password', { replace: true });
      }
    }
  }, [email, navigate]);

  // Autofocus the code input on mount.
  useEffect(() => {
    codeInputRef.current?.focus();
  }, []);

  // Resend cooldown timer.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = passwordSchema.safeParse({ code, password, confirm });
    if (!parsed.success) {
      const fieldErrors: { code?: string; password?: string; confirm?: string } = {};
      parsed.error.errors.forEach((err) => {
        const key = err.path[0] as 'code' | 'password' | 'confirm';
        if (!fieldErrors[key]) fieldErrors[key] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      // Step 1: verify the OTP. type:'email' covers the OTP sent by signInWithOtp
      // (which is what /forgot-password calls). This creates a real session.
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: parsed.data.code,
        type: 'email',
      });

      if (verifyError) {
        const msg = verifyError.message?.toLowerCase() ?? '';
        if (msg.includes('expired')) {
          setErrors({ code: 'This code has expired. Request a new one.' });
        } else if (msg.includes('invalid') || msg.includes('token')) {
          setErrors({ code: 'Invalid code. Please check and try again.' });
        } else {
          setErrors({ code: verifyError.message || 'Could not verify code.' });
        }
        setLoading(false);
        return;
      }

      // Step 2: with the new session, update the password.
      const { error: updateError } = await supabase.auth.updateUser({
        password: parsed.data.password,
      });

      if (updateError) {
        const msg = updateError.message?.toLowerCase() ?? '';
        if (msg.includes('weak') || msg.includes('pwned') || msg.includes('breach')) {
          setErrors({ password: 'This password is too weak or has been seen in a data breach. Choose another.' });
        } else {
          setErrors({ password: updateError.message || 'Could not update password.' });
        }
        setLoading(false);
        return;
      }


      // Security notification — let the account holder know their password
      // was changed (so they can react if it wasn't them). Fire-and-forget.
      try {
        const { data: { user } } = await supabase.auth.getUser();
        supabase.functions.invoke('notify-password-changed', {
          body: {
            email,
            name: (user?.user_metadata as { full_name?: string } | null)?.full_name ?? null,
          },
        }).catch((e) => console.error('notify-password-changed failed:', e));
      } catch (e) {
        console.error('notify-password-changed lookup failed:', e);
      }

      toast.success(nextPath ? 'Password created. You can now accept the invitation.' : 'Password updated. Please sign in with your new password.');
      if (nextPath) {
        const inviteToken = new URLSearchParams(nextPath.split('?')[1] || '').get('token');
        if (inviteToken) {
          try { sessionStorage.setItem(INVITE_PASSWORD_CREATED_KEY, inviteToken); } catch { /* ignore */ }
        }
        navigate(nextPath, { replace: true });
        return;
      }
      // Force a clean session on THIS device — don't leave the user logged
      // in via the OTP session. scope: 'local' matches what this page's
      // own FAQ copy (ForgotPasswordPage.tsx) promises: "All other active
      // sessions on other devices stay signed in unless you sign them out
      // from settings" — the SDK default (global) would silently break
      // that promise by signing out every other device too.
      await supabase.auth.signOut({ scope: 'local' });
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('Reset password unexpected error:', err);
      toast.error('Unexpected error. Please try again.');
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resending || !email) return;
    setResending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        console.error('Resend OTP failed:', otpError);
      }
      toast.success('A new code has been sent if the account exists.');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setResending(false);
    }
  };

  if (!email) {
    return null; // redirect effect will fire
  }

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background flex flex-col">
      <SEOHead
        title="Enter Reset Code & New Password | TidyWise"
        description="Confirm your TidyWise reset code and choose a new password. Codes expire after a short window for account security on your cleaning business dashboard."
        canonical="/reset-password"
        noIndex
      />
      <div className="flex-1 flex items-center justify-center p-4 w-full">
      <div className="w-full max-w-md">
        <h1 className="pv-display text-3xl text-foreground text-center mb-2">
          Set a new password for your TidyWise account
        </h1>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to login
        </Link>

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold">Enter your code</CardTitle>
            <CardDescription className="space-y-1">
              <span className="block">
                 We sent a reset code to{' '}
                <span className="font-medium text-foreground inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  {email}
                </span>
              </span>
              <span className="block text-xs">
                Enter it below along with your new password.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  Reset code
                </Label>
                <Input
                  id="code"
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, '').slice(0, CODE_MAX);
                    setCode(next);
                    if (errors.code) setErrors({ ...errors, code: undefined });
                  }}
                  className={`tracking-widest text-center text-lg font-medium ${errors.code ? 'border-destructive' : ''}`}
                  maxLength={CODE_MAX}
                  required
                />
                {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  New password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) setErrors({ ...errors, password: undefined });
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
                    onClick={() => setShowPwd((s) => !s)}
                    tabIndex={-1}
                  >
                    {showPwd ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Confirm password
                </Label>
                <Input
                  id="confirm"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (errors.confirm) setErrors({ ...errors, confirm: undefined });
                  }}
                  className={errors.confirm ? 'border-destructive' : ''}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                {errors.confirm && <p className="text-xs text-destructive">{errors.confirm}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update password
              </Button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0 || resending}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resending
                    ? 'Sending…'
                    : resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : "Didn't get a code? Resend"}
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      </div>

      <section aria-labelledby="reset-info-heading" className="bg-muted/30 border-t border-border py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 id="reset-info-heading" className="text-2xl font-bold text-foreground">
            About setting a new TidyWise password
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            This page is the second step of the{" "}
            <Link to="/forgot-password" className="text-primary hover:underline">TidyWise password recovery flow</Link>.
            You should already have a numeric reset code in your inbox — it was sent the moment you
            submitted the email lookup form. Codes expire after 15 minutes and are single-
            use, so if you wait too long or try to reuse one, you'll need to request a
            fresh one from the previous step.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Password requirements
            </h3>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>At least 8 characters long</li>
              <li>Includes at least one letter</li>
              <li>Includes at least one number</li>
              <li>Different from any password you've used in the last 90 days</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              We recommend a password manager — TidyWise auto-fills cleanly on iOS,
              Android, and every major desktop browser. Avoid reusing the same password
              across multiple services; cleaning businesses handle sensitive customer
              addresses, payment data, and staff records, so a single leaked password
              elsewhere shouldn't compromise your operations here.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              After you set a new password
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              You'll be signed into your{" "}
              <Link to="/login" className="text-primary hover:underline">TidyWise dashboard</Link>{" "}
              automatically and your old password stops working everywhere. Other devices that were signed in stay
              signed in — they trust the existing session token. If you suspect another
              device shouldn't have access, head to{" "}
              <Link to="/login" className="text-primary hover:underline">login</Link>{" "}
              then Settings → Active Sessions to revoke them, or{" "}
              <Link to="/contact" className="text-primary hover:underline">contact support</Link>{" "}
              and we'll force-sign-out everything for you.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Didn't request a reset?
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              If a code arrived unexpectedly, no action is needed — codes expire on their
              own and an unused code does not change your password. If this happens
              repeatedly, someone may have your email address; consider rotating the
              password from inside your{" "}
              <Link to="/login" className="text-primary hover:underline">TidyWise dashboard</Link>{" "}
              once you're back in. Report suspicious activity to{" "}
              <Link to="/contact" className="text-primary hover:underline">contact support</Link>.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Why password security matters for cleaning businesses
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Your TidyWise account holds scheduling data, customer addresses, payment
              information, staff details, and proprietary pricing. A compromised
              password could expose client homes, interrupt daily routes, or allow
              unauthorized invoice changes. That is why we enforce strong passwords,
              single-use reset codes, and automatic security notifications every time
              credentials change. Treat your{" "}
              <Link to="/login" className="text-primary hover:underline">TidyWise login</Link>{" "}
              with the same care you give physical office keys — it protects your entire{" "}
              <Link to="/cleaning-business-software" className="text-primary hover:underline">cleaning business operation</Link>.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              What to do if the reset code never arrives
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Start by checking spam, junk, and promotions folders. Corporate email
              filters sometimes delay automated messages by a few minutes. If you still
              do not see the code after five minutes, click the resend button above —
              there is no penalty for requesting another. Make sure the email address
              you entered matches the one on your TidyWise account exactly; typos are
              the most common reason a code fails to deliver. If repeated attempts fail,
              reach out to{" "}
              <Link to="/contact" className="text-primary hover:underline">support</Link>{" "}
              or email{" "}
              <a href="mailto:Support@tidywisecleaning.com" className="text-primary hover:underline">Support@tidywisecleaning.com</a>{" "}
              with the email you believe is registered and we will verify it manually.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Team access and shared accounts
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              If multiple people in your company share one TidyWise login, a password
              reset locks everyone out until the new credentials are shared. We strongly
              recommend creating individual admin accounts through Settings → Staff
              instead of sharing passwords. Individual accounts let you assign roles,
              track who changed what, and revoke access instantly when someone leaves —
              without forcing a company-wide password reset. If you must share temporarily,
              reset the password during off-hours and distribute the new credentials
              through a secure channel, never in plain text messages or emails.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Protecting your account going forward
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              After you reset, enable any additional security features available in your
              dashboard, such as session monitoring and two-factor authentication if
              offered. Review active devices monthly and sign out anything unrecognized.
              Avoid accessing TidyWise from public computers or unsecured networks when
              possible. If you use a shared office computer, always sign out when finished
              rather than relying on the browser to remember the session. These habits take
              seconds but prevent hours of damage control if an unauthorized user ever
              gains access.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Related TidyWise pages
            </h3>
            <ul className="grid sm:grid-cols-2 gap-2 text-sm">
              <li><Link to="/login" className="text-primary hover:underline">Back to sign in →</Link></li>
              <li><Link to="/forgot-password" className="text-primary hover:underline">Request a new reset code →</Link></li>
              <li><Link to="/signup" className="text-primary hover:underline">Create a TidyWise account →</Link></li>
              <li><Link to="/staff/login" className="text-primary hover:underline">Staff portal login →</Link></li>
              <li><Link to="/portal/login" className="text-primary hover:underline">Client portal login →</Link></li>
              <li><Link to="/pricing" className="text-primary hover:underline">TidyWise pricing →</Link></li>
              <li><Link to="/demo" className="text-primary hover:underline">Book a demo →</Link></li>
              <li><Link to="/cleaning-business-software" className="text-primary hover:underline">Cleaning business software →</Link></li>
              <li><Link to="/contact" className="text-primary hover:underline">Contact support →</Link></li>
              <li><Link to="/privacy-policy" className="text-primary hover:underline">Privacy policy →</Link></li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
