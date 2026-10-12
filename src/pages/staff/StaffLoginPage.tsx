import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Capacitor } from "@capacitor/core";

import { useAuth } from "@/hooks/useAuth";
import { useBiometricAuth } from "@/hooks/useBiometricAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Eye, EyeOff, HardHat, Loader2, Fingerprint } from "lucide-react";

import { SEOHead } from '@/components/SEOHead';
import { hasStaffOrAdminRole, requestStaffPasswordReset, signInStaff } from "@/features/staff-auth/staffAuth";
import { TermsOfServiceDialog } from "@/components/legal/TermsOfServiceDialog";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginValues = z.infer<typeof loginSchema>;

const resetSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
});

type ResetValues = z.infer<typeof resetSchema>;

export default function StaffLoginPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { 
    isAvailable: biometricAvailable, 
    hasStoredCredentials, 
    getBiometryTypeName,
    storeCredentials,
    authenticateAndGetCredentials 
  } = useBiometricAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  const isSubmitting = loginForm.formState.isSubmitting;
  const isSendingReset = resetForm.formState.isSubmitting;

  const redirectUrl = useMemo(
    () => `${window.location.origin}/staff/reset-password`,
    []
  );

  // If already logged in, send staff/admin directly to portal.
  useEffect(() => {
    const run = async () => {
      if (!user) return;
      try {
        const allowed = await hasStaffOrAdminRole(user.id);
        if (allowed) navigate("/staff", { replace: true });
      } catch {
        // ignore
      }
    };

    if (!authLoading && user) run();
  }, [authLoading, user, navigate]);

  const onSubmitLogin = async (values: LoginValues) => {
    try {
      await signInStaff(values.email, values.password);
      
      // Offer to save credentials for biometric login on native platforms
      if (biometricAvailable && !hasStoredCredentials && Capacitor.isNativePlatform()) {
        const saved = await storeCredentials(values.email, values.password);
        if (saved) {
          toast.success(`${getBiometryTypeName()} enabled for quick login!`);
        }
      }
      
      toast.success("Welcome back!");
      navigate("/staff", { replace: true });
    } catch (err: any) {
      toast.error(err?.message || "Login failed");
    }
  };

  const handleBiometricLogin = async () => {
    if (!biometricAvailable || !hasStoredCredentials) return;
    
    setBiometricLoading(true);
    try {
      const credentials = await authenticateAndGetCredentials();
      if (credentials) {
        await signInStaff(credentials.email, credentials.password);
        toast.success("Welcome back!");
        navigate("/staff", { replace: true });
      }
    } catch (err: any) {
      toast.error("Biometric login failed. Please use your password.");
    } finally {
      setBiometricLoading(false);
    }
  };

  const onSubmitReset = async (values: ResetValues) => {
    try {
      await requestStaffPasswordReset(values.email, redirectUrl);
      toast.success("If your email is invited as staff/admin, you'll receive a reset link shortly.");
      setResetOpen(false);
      resetForm.reset();
    } catch (err: any) {
      toast.error(err?.message || "Failed to send reset email");
    }
  };

  if (authLoading) {
    return (
      <main className="portal-v2 portal-v2-scroll min-h-screen flex items-center justify-center bg-background">
        <SEOHead title="Staff Portal Sign In | TidyWise" description="Sign in to the TidyWise staff portal to view your jobs, log start and finish times, capture before-and-after photos, and track your earnings." canonical="/staff/login" noIndex />
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="portal-v2 portal-v2-scroll min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex flex-col">
      <SEOHead
        title="Staff Portal Sign In | TidyWise"
        description="Sign in to the TidyWise staff portal to view your jobs, log start and finish times, capture before-and-after photos, and track your earnings."
        canonical="/staff/login"
        noIndex
      />

      <div className="flex-1 flex items-center justify-center p-4 w-full">
      <section className="w-full max-w-md">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Card className="shadow-xl border-primary/10">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <HardHat className="w-8 h-8 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-none tracking-tight">TidyWise Staff Portal Login</h1>
              <CardDescription className="mt-2">
                Sign in to access your jobs and schedule
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={loginForm.handleSubmit(onSubmitLogin)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="your.email@example.com"
                  {...loginForm.register("email")}
                />
                {loginForm.formState.errors.email?.message && (
                  <p className="text-sm text-destructive">{loginForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Button
                    type="button"
                    variant="link"
                    className="p-0 h-auto text-xs text-muted-foreground hover:text-primary"
                    onClick={() => setResetOpen(true)}
                  >
                    Forgot password?
                  </Button>
                </div>

                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    {...loginForm.register("password")}
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
                {loginForm.formState.errors.password?.message && (
                  <p className="text-sm text-destructive">{loginForm.formState.errors.password.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" variant="premium" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In to Portal
              </Button>

              {/* Biometric Login Button - only show on native with stored credentials */}
              {biometricAvailable && hasStoredCredentials && Capacitor.isNativePlatform() && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={handleBiometricLogin}
                  disabled={biometricLoading}
                >
                  {biometricLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Fingerprint className="h-4 w-4" />
                  )}
                  Sign in with {getBiometryTypeName()}
                </Button>
              )}
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Need access? Contact your administrator to get invited.
            </p>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              By continuing you agree to our{" "}
              <TermsOfServiceDialog>
                <button type="button" className="underline underline-offset-4 hover:text-foreground transition-colors">Terms</button>
              </TermsOfServiceDialog>
              {" "}and acknowledge our{" "}
              <Link
                to="/privacy-policy"
                className="underline underline-offset-4 hover:text-foreground transition-colors"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </section>
      </div>

      {!Capacitor.isNativePlatform() && (
      <section aria-labelledby="staff-info-heading" className="bg-background/60 backdrop-blur-sm border-t border-border py-12 px-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <h2 id="staff-info-heading" className="text-2xl font-bold text-foreground">
            Your shift, your schedule, your earnings
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            The TidyWise staff portal gives you everything you need to do great work and
            get paid on time. Sign in above to see your assigned jobs, navigate to your
            next stop, log start and finish times, capture before-and-after photos, and
            keep your weekly earnings in clear view.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              What's inside the staff portal
            </h3>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li>Today's job schedule with addresses, times, and client notes</li>
              <li>One-tap navigation, check-in, and check-out for every visit</li>
              <li>Photo and checklist capture so the office knows the work is done right</li>
              <li>Real-time messaging with your manager and the client when needed</li>
              <li>Tips, hours worked, and pay periods updated automatically</li>
              <li>Availability and time-off requests submitted directly from your phone</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Built for cleaning crews, not generic field workers
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              TidyWise is designed around how cleaning teams actually operate. You'll see
              the square footage, supplies needed, key codes, parking instructions, and
              any special requests for each job before you arrive — no more phone tag
              with the office or showing up unprepared. Mark a room complete, snap a
              quick photo, and the client gets an automatic update without you having to
              do anything extra.
            </p>
          </div>

          <p className="text-muted-foreground leading-relaxed">
            Need to reset your password? Use the "Forgot password" link above and we'll
            email a secure reset link to the address your administrator invited you with.
            If you don't see the email, check spam, then reach out to your supervisor or
            office admin — they can resend the invite or update your contact info from
            the admin dashboard.
          </p>

          <p className="text-muted-foreground leading-relaxed">
            Don't have a staff account yet? Staff accounts are created by your employer.
            Ask your office manager or business owner to send you an invitation through
            their TidyWise dashboard, and you'll receive a secure setup link by email or
            SMS. Setup takes under a minute, and biometric sign-in (Face ID, Touch ID, or
            fingerprint) is supported on iOS and Android for fast, secure access.
          </p>

          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">
              Looking for a different sign-in?
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              If you're a business owner, sign in to your{" "}
              <Link to="/login" className="text-primary hover:underline">owner dashboard</Link>{" "}
              instead, or visit the <Link to="/portal/login" className="text-primary hover:underline">Client Portal</Link> if you're a client.
              New to TidyWise? Learn about our{" "}
              <Link to="/cleaning-business-software" className="text-primary hover:underline">cleaning business software</Link>,{" "}
              <Link to="/features/scheduling-software" className="text-primary hover:underline">scheduling tools</Link>,{" "}
              <Link to="/features/payroll-software" className="text-primary hover:underline">payroll software</Link>,
              and <Link to="/pricing" className="text-primary hover:underline">pricing</Link>, or{" "}
              <Link to="/signup" className="text-primary hover:underline">see pricing</Link>.
            </p>
          </div>
        </div>
      </section>
      )}

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Enter the email your administrator invited you with.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={resetForm.handleSubmit(onSubmitReset)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="resetEmail">Email</Label>
              <Input
                id="resetEmail"
                type="email"
                autoComplete="email"
                placeholder="your.email@example.com"
                {...resetForm.register("email")}
              />
              {resetForm.formState.errors.email?.message && (
                <p className="text-sm text-destructive">{resetForm.formState.errors.email.message}</p>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSendingReset}>
                {isSendingReset && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Reset Link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
