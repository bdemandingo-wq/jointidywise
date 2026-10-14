import { Link, Navigate } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { REFERRAL_OFFER } from "@/lib/referralProgram";
import { DoNotSellShareLink } from "@/components/DoNotSellShareLink";

export function ReferralAlias() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background" />;
  if (user) return <Navigate to="/dashboard/settings?tab=refer" replace />;
  return (
    <main className="min-h-screen bg-background">
      <SEOHead
        title="Refer a cleaning business | TidyWise"
        description="Share TidyWise with another cleaning business. Two paying customers earn you a free month."
        canonical="/referral"
      />
      <header className="border-b border-border/60">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link to="/" className="font-semibold tracking-tight">TIDYWISE</Link>
        </div>
      </header>
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-semibold tracking-tight mb-4">Refer another cleaning business</h1>
        <ul className="space-y-3 text-muted-foreground mb-8">
          {REFERRAL_OFFER.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Button asChild size="lg">
          <Link to="/signup">Create your referral link</Link>
        </Button>
      </section>
      <footer className="border-t border-border py-8 px-4 text-center">
        <DoNotSellShareLink />
      </footer>
    </main>
  );
}

export function FeedbackAlias() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background" />;
  if (user) return <Navigate to="/dashboard/settings?tab=feedback" replace />;
  return <Navigate to="/contact" replace />;
}
