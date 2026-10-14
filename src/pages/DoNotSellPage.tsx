import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { SiteFooter } from '@/components/SiteFooter';
import { Button } from '@/components/ui/button';
import { loadPrivacyChoice, persistPrivacyChoice } from '@/lib/tidywisePrivacyStore';
import { readGlobalPrivacyControl, type PrivacyChoice } from '@/lib/tidywiseSitePrivacy';
import { revokeTidyWiseTags } from '@/lib/tidywiseTags';
import { SUPPORT_EMAIL } from '@/lib/supportEmail';

function browserGpc(): boolean {
  if (typeof navigator === 'undefined') return false;
  return readGlobalPrivacyControl(navigator as Navigator & { globalPrivacyControl?: boolean });
}

function focusHeading(heading: HTMLElement | null): void {
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * Opt-out page for TidyWise's own Google and Meta tags.
 * A cleaning company's pixel on their booking page is unchanged.
 *
 * Copy pending owner approval.
 */
export default function DoNotSellPage() {
  const [choice, setChoice] = useState<PrivacyChoice | null>(() => loadPrivacyChoice());
  const gpc = browserGpc();
  const optedOut = choice === 'opted_out' || gpc;

  useEffect(() => {
    focusHeading(document.querySelector('main h1'));
  }, []);

  const optOut = () => {
    const stored = persistPrivacyChoice('opted_out');
    setChoice('opted_out');
    revokeTidyWiseTags();
    if (stored) window.location.reload();
  };

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead
        title="Do Not Sell or Share My Personal Information | TidyWise"
        description="Opt out of TidyWise using Google and Meta advertising tools on our marketing pages."
        canonical="/do-not-sell"
      />
      <header
        className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-foreground">TIDYWISE</span>
            <span className="text-sm text-muted-foreground">Privacy choices</span>
          </div>
          <Button variant="outline" className="gap-2" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <article className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Do Not Sell or Share My Personal Information.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            TidyWise doesn't sell your personal data for money. On our marketing pages we use Google and Meta advertising tools, which some state laws treat as 'sharing.'
            {optedOut ? " You've opted out on this browser, so those tools won't load here." : null}
            {' '}If you use another browser or device, or clear your cookies, opt out again there. We also honor Global Privacy Control signals automatically. You can email{' '}
            <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            {' '}to opt out by email, or with any questions.{' '}
            <Link to="/privacy-policy" className="underline">Privacy Policy</Link>
          </p>

          <div className="mt-8" role="status">
            {optedOut ? (
              <p className="text-sm font-semibold text-foreground">You're opted out</p>
            ) : (
              <button type="button" className="tw-cookie-notice__ok" onClick={optOut}>
                Opt out now
              </button>
            )}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
