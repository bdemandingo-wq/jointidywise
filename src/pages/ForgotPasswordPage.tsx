import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { z } from 'zod';
import { SUPPORT_EMAIL } from '@/lib/supportEmail';

const schema = z.object({
  email: z.string().trim().email('Please enter a valid email address').max(255),
});

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.errors[0].message);
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      // Send an email OTP code (not a magic link). This avoids email-scanner
      // pre-fetch consuming a single-use recovery link.
      // shouldCreateUser:false ensures we never silently create accounts here.
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: { shouldCreateUser: false },
      });

      // Always treat as success to avoid leaking whether an account exists.
      if (otpError) {
        console.error('OTP send failed:', otpError);
      }

      toast.success('If an account exists for that email, a reset code is on its way.');
      // Skip the auto-navigation for headless / prerender browsers — otherwise
      // Lovable's prerender for /reset-password ends up capturing this page's
      // HTML at that URL, leaving /reset-password with ForgotPasswordPage tags.
      const isHeadless =
        typeof navigator !== 'undefined' &&
        (navigator.webdriver === true || /HeadlessChrome|Prerender/i.test(navigator.userAgent));
      if (!isHeadless) {
        navigate('/reset-password', {
          state: { email: parsed.data.email },
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background flex flex-col">
      <SEOHead
        title="Reset Your TidyWise Password | Account Recovery"
        description="Forgot your TidyWise password? Enter your email and we'll send a one-time reset code so you can get back into your cleaning business dashboard in minutes."
        canonical="/forgot-password"
        noIndex
      />
      <div className="flex-1 flex items-center justify-center p-4 w-full">
        <div className="w-full max-w-md">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>

          <Card className="border-border/50 shadow-lg">
            <CardHeader className="text-center pb-4">
              <h1 className="text-2xl font-bold leading-none tracking-tight">Reset your TidyWise password</h1>
              <CardDescription className="mt-2">
                Enter your email and we'll send you a reset code to change your password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(undefined);
                    }}
                    className={error ? 'border-destructive' : ''}
                    required
                    autoComplete="email"
                  />
                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send reset code
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <section aria-labelledby="forgot-info-heading" className="bg-muted/30 border-t border-border py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 id="forgot-info-heading" className="text-2xl font-bold text-foreground">
            How TidyWise password reset works
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Forgetting a password happens — what matters is getting you back into your
            cleaning business dashboard quickly and securely. Submit your email above and
            we'll send a one-time reset code to your inbox. The code is short-lived and
            single-use, so even if someone else gains access to an old email, they can't
            replay it. We never display whether an email is registered with TidyWise to
            avoid leaking customer data to attackers.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              What happens after you submit
            </h3>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>Check your inbox for an email from TidyWise with a 6-digit reset code</li>
              <li>If you don't see it within a minute, check your spam or promotions folder</li>
              <li>Enter the code on the next screen and choose a new password (8+ characters)</li>
              <li>You'll be signed back in and dropped into your dashboard automatically</li>
              <li>All other active sessions on other devices stay signed in unless you sign them out from settings</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Common questions
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Didn't get the code?</strong> Wait 60
              seconds and try again — make sure you're checking the same email address
              your TidyWise account is registered under. If you've recently changed your
              email, the code goes to the address on file. Still nothing? Reach out to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>{" "}
              and we'll help verify your identity manually.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              <strong className="text-foreground">Signed in via Google or Apple?</strong>{" "}
              You don't have a TidyWise password to reset. Just go back to the{" "}
              <Link to="/login" className="text-primary hover:underline">sign-in page</Link>{" "}
              and use the same provider you used originally.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              <strong className="text-foreground">Are you a cleaner or office team member?</strong>{" "}
              Use the <Link to="/staff/login" className="text-primary hover:underline">Staff Portal</Link>{" "}
              instead — your password reset is requested through your business's admin.
              Clients booking a recurring service should head to the{" "}
              <Link to="/portal/login" className="text-primary hover:underline">Client Portal</Link>.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              New to TidyWise?
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              TidyWise is the all-in-one platform for cleaning business owners — online
              booking, scheduling, invoicing, payroll, GPS tracking, and CRM in one
              dashboard. If you don't have an account yet,{" "}
              <Link to="/signup" className="text-primary hover:underline">see pricing</Link>{" "}
              (), browse our{" "}
              <Link to="/blog" className="text-primary hover:underline">guides for cleaning businesses</Link>,
              or compare{" "}
              <Link to="/pricing" className="text-primary hover:underline">pricing plans</Link>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
