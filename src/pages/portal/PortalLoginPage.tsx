import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowLeft, Eye, EyeOff, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { SEOHead } from '@/components/SEOHead';
import { useClientPortal } from "@/contexts/ClientPortalContext";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function PortalLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, signIn, loading: contextLoading } = useClientPortal();
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('reason') === 'session_expired') {
      toast.error('Your session expired. Please sign in again.');
    }
  }, [searchParams]);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  const isSubmitting = form.formState.isSubmitting;

  // Redirect if already logged in
  if (user && !contextLoading) {
    navigate("/portal/dashboard", { replace: true });
    return null;
  }

  const onSubmit = async (values: LoginValues) => {
    setLoginError(null);
    const result = await signIn(values.email, values.password);
    
    if (result.error) {
      setLoginError(result.error);
      toast.error(result.error);
      return;
    }

    toast.success("Welcome back!");
    navigate("/portal/dashboard", { replace: true });
  };

  if (contextLoading) {
    return (
      <main className="portal-v2 portal-v2-scroll min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="portal-v2 portal-v2-scroll min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex flex-col relative">
      <SEOHead
        title="Client Portal Sign In | TidyWise"
        description="Sign in to your TidyWise client portal to view upcoming cleanings, request new appointments, leave tips, and manage your service preferences."
        canonical="https://www.jointidywise.com/portal/login"
        noIndex
      />

      <div className="flex-1 flex items-center justify-center p-4 w-full">
      <section className="w-full max-w-md">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Card className="shadow-xl border-primary/10">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Users className="w-8 h-8 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-none tracking-tight">TidyWise Client Portal Login</h1>
              <CardDescription className="mt-2">
                Sign in to view your bookings and schedule appointments
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...form.register("email")}
                />
                {form.formState.errors.email?.message && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    {...form.register("password")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                {form.formState.errors.password?.message && (
                  <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                )}
              </div>

              {loginError && (
                <p className="text-sm text-destructive" role="alert">{loginError}</p>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link to="/portal/reset-password" className="text-primary underline-offset-2 hover:underline">
                Forgot your password?
              </Link>
            </p>

            <p className="mt-2 text-center text-sm text-muted-foreground">
              Need access? Contact the business to get your portal login.
            </p>
          </CardContent>
        </Card>
      </section>
      </div>

      {!Capacitor.isNativePlatform() && (
      <section aria-labelledby="portal-info-heading" className="bg-background/60 backdrop-blur-sm border-t border-border py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 id="portal-info-heading" className="text-2xl font-bold text-foreground">
            Welcome to your client portal
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Sign in above to access your dedicated client portal. Your portal is the
            easiest way to stay on top of your cleaning service — book new appointments,
            view upcoming visits, message your cleaner, leave tips, update payment
            methods, and see your full service history without ever needing to pick up
            the phone.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              What you can do inside the portal
            </h3>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>Request and reschedule cleaning appointments around your calendar</li>
              <li>View past invoices, receipts, and recurring service plans</li>
              <li>Update your address, gate codes, parking notes, and pet info securely</li>
              <li>Leave tips and reviews directly for the cleaner who served you</li>
              <li>Save your preferred cleaning supplies, areas of focus, and skip-rooms</li>
              <li>Receive SMS and email confirmations and arrival ETAs on cleaning day</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Your privacy and security come first
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Your address, payment details, and home access information are encrypted
              and visible only to your cleaning provider — never to other clients,
              third-party advertisers, or unrelated cleaners. Payment processing runs
              through PCI-compliant infrastructure, and you can remove a saved card or
              revoke portal access at any time from your account page.
            </p>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            Don't have a portal account yet? Your cleaning business can invite you in a
            few seconds. If you've recently booked a service, check your email and SMS
            inbox for an invitation link from your provider. If you can't find it or your
            link has expired, reach out directly to the business — they can resend an
            invite or reset your password from their dashboard.
          </p>

          <p className="text-muted-foreground leading-relaxed">
            The client portal is included free for clients of any TidyWise-powered
            cleaning business. There's nothing to download — it works in any modern
            browser on desktop, tablet, or mobile, and there are dedicated iOS and
            Android apps if you prefer a native experience.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Are you a cleaning business owner?
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              The TidyWise client portal is part of a complete platform that powers
              the cleaning service running this site. If you run a cleaning business
              and want a portal like this for your own clients, learn more about our{" "}
              <Link to="/cleaning-business-software" className="text-primary hover:underline">cleaning business software</Link>,{" "}
              <Link to="/features/booking" className="text-primary hover:underline">online booking</Link>,{" "}
              <Link to="/features/scheduling-software" className="text-primary hover:underline">scheduling</Link>, and{" "}
              <Link to="/pricing" className="text-primary hover:underline">pricing plans</Link>. You can{" "}
              <Link to="/signup" className="text-primary hover:underline">see pricing</Link> or{" "}
              <Link to="/login" className="text-primary hover:underline">sign in to your owner dashboard</Link>.
              Already on the team? Use the <Link to="/staff/login" className="text-primary hover:underline">Staff Portal</Link> instead.
            </p>
          </div>
        </div>
      </section>
      )}
    </main>
  );
}
