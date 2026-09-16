import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Rocket,
  Shield,
  CheckCircle2,
  ExternalLink,
  X,
  Infinity as InfinityIcon,
  Flame,
  Star,
  Zap,
  PhoneCall,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { usePlatform } from "@/hooks/usePlatform";
import { isAlreadyLifetimeError, ALREADY_LIFETIME_MESSAGE } from '@/lib/alreadyLifetime';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';

interface SubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubscriptionActive: () => void;
}

interface LifetimeSpots {
  total: number;
  used: number;
  remaining: number;
  available: boolean;
}

// Set VITE_PRICING_ENABLED=true in your .env to show the 3-plan pricing dialog.
// Leave unset (default) to show the original simple trial flow.
const PRICING_ENABLED = import.meta.env.VITE_PRICING_ENABLED === "true";

const ENTERPRISE_CONTACT_EMAIL = "support@jointidywise.com";

const STANDARD_FEATURES = [
  "Unlimited bookings & customers",
  "Team management & scheduling",
  "Invoices, payments & Stripe",
  "Email & SMS campaigns",
  "AI tools & analytics",
  "Client portal & referrals",
];

const ENTERPRISE_FEATURES = [
  "Everything in Standard",
  "Connect your ad accounts (Meta, Google)",
  "Custom integrations built for you",
  "White-glove onboarding & setup",
  "Dedicated support line",
  "Custom features on request",
];

export function SubscriptionDialog({
  open,
  onOpenChange,
  onSubscriptionActive,
}: SubscriptionDialogProps) {
  const [checkingOut, setCheckingOut] = useState<"standard" | "lifetime" | null>(null);
  const [checking, setChecking] = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [spots, setSpots] = useState<LifetimeSpots>({ total: 100, used: 0, remaining: 100, available: true });
  const { canShowPaymentFlows, billingUrl } = usePlatform();

  const checkSubscription = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("check-subscription");
      if (error) throw error;
      if (data?.subscribed) {
        setIsSubscribed(true);
        onSubscriptionActive();
      }
    } catch (error) {
      console.error("Error checking subscription:", error);
    } finally {
      setChecking(false);
    }
  };

  const fetchSpots = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("get-lifetime-spots");
      if (!error && data) setSpots(data as LifetimeSpots);
    } catch {
      // non-critical, keep defaults
    }
  };

  useEffect(() => {
    if (open) {
      checkSubscription();
      fetchSpots();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- checkSubscription is recreated each render; runs when dialog opens
  }, [open]);

  const handleStandard = async () => {
    setCheckingOut("standard");
    try {
      const { data, error } = await supabase.functions.invoke("create-subscription");
      if (error) {
        if (await isAlreadyLifetimeError(error)) {
          toast.success(ALREADY_LIFETIME_MESSAGE);
          return;
        }
        throw new Error(await readEdgeFunctionError(error, "Failed to start subscription"));
      }
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.location.href = data.url;
    } catch (error: any) {
      toast.error(error.message || "Failed to start subscription");
    } finally {
      setCheckingOut(null);
    }
  };

  const handleLifetime = async () => {
    if (!spots.available) {
      toast.error("All lifetime spots have been claimed.");
      return;
    }
    setCheckingOut("lifetime");
    try {
      const { data, error } = await supabase.functions.invoke("create-lifetime-checkout");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.location.href = data.url;
    } catch (error: any) {
      toast.error(error.message || "Failed to start checkout");
    } finally {
      setCheckingOut(null);
    }
  };

  const handleEnterprise = () => {
    window.open(
      `mailto:${ENTERPRISE_CONTACT_EMAIL}?subject=Enterprise%20Package%20Inquiry&body=Hi%2C%20I%27m%20interested%20in%20the%20enterprise%20package%20for%20TidyWise.`,
      "_blank"
    );
  };

  const handleContinueLimited = () => {
    onOpenChange(false);
  };

  if (checking) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Native iOS — can't show payment flows per App Store rules
  if (!canShowPaymentFlows) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              Subscription Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <p className="text-muted-foreground text-center">
              Manage your subscription at jointidywise.com to unlock all features.
            </p>
            <div className="space-y-3">
              <p className="text-sm text-center font-medium text-foreground">
                Visit <span className="text-primary">jointidywise.com</span> in your browser to manage your subscription.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={handleContinueLimited}
              >
                <X className="mr-2 h-4 w-4" />
                Continue in Limited Mode
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Simple trial flow (default until App Store approval) ─────────────────
  if (!PRICING_ENABLED) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-lg"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-2xl">
              Welcome to TidyWise! 🎉
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <p className="text-center text-muted-foreground">
              Choose how to get started:
            </p>

            <button
              onClick={handleStandard}
              disabled={!!checkingOut}
              className="w-full p-5 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <Rocket className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg text-foreground">See Pricing</h3>
                    {checkingOut === "standard" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Full access to all features for 30 days — no card required
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {["Unlimited bookings", "Team management", "AI tools", "Analytics"].map((f) => (
                      <span key={f} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                        <CheckCircle2 className="h-3 w-3" /> {f}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={handleContinueLimited}
              className="w-full p-5 rounded-xl border-2 border-border hover:border-muted-foreground/30 hover:bg-accent/50 transition-all text-left group"
            >
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-xl bg-muted text-muted-foreground group-hover:bg-muted/80 transition-colors">
                  <Shield className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-foreground">Continue in Limited Mode</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Basic features, no card required — upgrade anytime
                  </p>
                </div>
              </div>
            </button>

            <p className="text-xs text-center text-muted-foreground">
              You can change your plan anytime from Settings.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Full 3-plan pricing (enabled after App Store approval) ────────────────
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2 text-2xl">
            Choose Your Plan
          </DialogTitle>
          <p className="text-center text-muted-foreground text-sm">
            Get started today — cancel anytime on monthly, or lock in forever with lifetime.
          </p>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3 py-2">

          {/* ── Standard $97/mo ──────────────────────────────── */}
          <div className="relative flex flex-col rounded-xl border-2 border-primary/30 bg-primary/5 p-5 gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <Rocket className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Standard</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">
                  $97<span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
              </div>
            </div>

            <ul className="space-y-1.5 flex-1">
              {STANDARD_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button
              onClick={handleStandard}
              disabled={!!checkingOut}
              className="w-full"
            >
              {checkingOut === "standard" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              Start Monthly Plan
            </Button>
          </div>

          {/* ── Lifetime $200 ──────────────────────────────────── */}
          <div className="relative flex flex-col rounded-xl border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20 p-5 gap-4">
            {/* Badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                <Flame className="h-3 w-3" /> BEST VALUE
              </span>
            </div>

            <div className="flex items-start gap-3 pt-2">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 shrink-0">
                <InfinityIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Lifetime Access</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">
                  $200<span className="text-sm font-normal text-muted-foreground"> once</span>
                </p>
              </div>
            </div>

            {/* Spots counter */}
            <div className="rounded-lg bg-amber-100/80 dark:bg-amber-900/30 border border-amber-300/50 px-3 py-2 text-center">
              {spots.available ? (
                <>
                  <p className="text-amber-700 dark:text-amber-400 font-bold text-lg leading-tight">
                    {spots.remaining} of {spots.total} spots left
                  </p>
                  <p className="text-amber-600 dark:text-amber-500 text-xs mt-0.5">
                    Pay once, never pay again
                  </p>
                </>
              ) : (
                <p className="text-amber-700 dark:text-amber-400 font-bold text-sm">
                  All spots claimed — check back later
                </p>
              )}
            </div>

            <ul className="space-y-1.5 flex-1">
              {STANDARD_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
              <li className="flex items-start gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <Star className="h-4 w-4 mt-0.5 shrink-0" />
                All future updates included
              </li>
            </ul>

            <Button
              onClick={handleLifetime}
              disabled={!!checkingOut || !spots.available}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white border-0"
            >
              {checkingOut === "lifetime" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <InfinityIcon className="h-4 w-4 mr-2" />
              )}
              {spots.available ? "Claim Lifetime Access" : "Sold Out"}
            </Button>
          </div>

          {/* ── Enterprise / Custom ────────────────────────────── */}
          <div className="flex flex-col rounded-xl border-2 border-border bg-muted/20 p-5 gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-muted text-foreground shrink-0">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Enterprise</p>
                <p className="text-sm text-muted-foreground mt-0.5">Custom pricing</p>
              </div>
            </div>

            <ul className="space-y-1.5 flex-1">
              {ENTERPRISE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-foreground/60 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button
              onClick={handleEnterprise}
              variant="outline"
              className="w-full"
            >
              <PhoneCall className="h-4 w-4 mr-2" />
              Contact Us
            </Button>
          </div>
        </div>

        {/* Continue limited */}
        <div className="text-center pt-1 pb-2">
          <button
            onClick={handleContinueLimited}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 mx-auto"
          >
            <Shield className="h-3.5 w-3.5" />
            Continue in Limited Mode
          </button>
          <p className="text-xs text-muted-foreground mt-1.5">
            Change or cancel your plan anytime from Settings.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
