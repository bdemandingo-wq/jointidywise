import { Link, useNavigate } from "react-router-dom";
import { SEOHead } from '@/components/SEOHead';
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/SiteFooter";
import { ArrowLeft } from "lucide-react";
import { READING_COLUMN_SM, READING_CARD_SM } from "@/components/ArticleBody";
import { SUPPORT_EMAIL } from "@/lib/supportEmail";
import { PRIVACY_POLICY_EFFECTIVE_DATE, PrivacyPolicyBody } from "@/components/legal/privacyContent";

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead
        title="Privacy Policy | TidyWise"
        description="How TidyWise collects, uses, and shares information when cleaning businesses, their staff, and their customers use the website and apps."
        canonical="/privacy-policy"
      />

      {/* #17: sticky header + top safe-area so Back never hides under the
          iPhone status bar, and history-based back so it returns to the
          screen the user actually came from (sign-up, settings, etc.). */}
      <header
        className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-foreground">TIDYWISE</span>
            <span className="text-sm text-muted-foreground">Privacy Policy</span>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/');
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <article className={`rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10 ${READING_CARD_SM}`}>
          <div className={READING_COLUMN_SM}>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Privacy Policy</h1>
            <p className="mt-2 text-sm text-muted-foreground">Effective date: {PRIVACY_POLICY_EFFECTIVE_DATE}</p>

            <PrivacyPolicyBody className="mt-8" />
          </div>
        </article>

        <nav
          aria-label="Related links"
          // Matches the policy card's width. Narrowing that one left this
          // full-width card beneath it, so the page read as a narrow box stacked
          // on a wide box — a new inconsistency, not the original problem.
          className={`mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8 ${READING_CARD_SM}`}
        >
          <h2 className="text-lg font-semibold text-foreground">Related Links</h2>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <li>
              <Link to="/" className="text-primary hover:underline">Home</Link>
            </li>
            <li>
              <Link to="/pricing" className="text-primary hover:underline">Pricing</Link>
            </li>
            <li>
              <Link to="/#features" className="text-primary hover:underline">Features</Link>
            </li>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">Contact Us</a>
            </li>
          </ul>
        </nav>
      </main>

      <SiteFooter />
    </div>
  );
}
