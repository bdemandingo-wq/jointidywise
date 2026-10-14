import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { SiteFooter } from '@/components/SiteFooter';
import { Button } from '@/components/ui/button';
import { loadPrivacyChoice, persistPrivacyChoice } from '@/lib/tidywisePrivacyStore';
import { readGlobalPrivacyControl, type PrivacyChoice } from '@/lib/tidywiseSitePrivacy';
import { SUPPORT_EMAIL } from '@/lib/supportEmail';

function browserGpc(): boolean {
  if (typeof navigator === 'undefined') return false;
  return readGlobalPrivacyControl(navigator as Navigator & { globalPrivacyControl?: boolean });
}

/**
 * Opt-out page for TidyWise's own Google and Meta tags.
 * A cleaning company's pixel on their booking page is unchanged.
 */
export default function DoNotSellPage() {
  const [choice, setChoice] = useState<PrivacyChoice | null>(() => loadPrivacyChoice());
  const gpc = browserGpc();
  const optedOut = choice === 'opted_out';

  const optOut = () => {
    persistPrivacyChoice('opted_out');
    setChoice('opted_out');
  };

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead
        title="Do Not Sell or Share My Personal Information | TidyWise"
        description="Opt out of TidyWise using Google and Meta cookies to measure our marketing site and show ads."
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
            Do Not Sell or Share My Personal Information
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            On TidyWise marketing and signup pages we use cookies and similar tools from Google and Meta
            to measure our site and show relevant ads. This page turns those TidyWise tags off in this
            browser. It does not change a cleaning company's own pixel on their public booking page.
          </p>

          <div className="mt-8 rounded-xl border border-border bg-background p-4" role="status">
            <h2 className="text-base font-semibold text-foreground">Status in this browser</h2>
            {optedOut ? (
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                Opted out. TidyWise will not load its Meta Pixel or Google tag here.
              </p>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                {choice === 'acknowledged'
                  ? 'Allowed. You dismissed the notice, so TidyWise tags may load on our marketing and signup pages.'
                  : 'No choice saved yet. TidyWise tags may load on our marketing and signup pages until you opt out.'}
              </p>
            )}
            {gpc ? (
              <p className="mt-2 text-sm leading-relaxed text-foreground">
                Your browser is sending Global Privacy Control, so these tags stay off even without a saved opt-out.
              </p>
            ) : null}
          </div>

          <div className="mt-6">
            <button
              type="button"
              className="tw-cookie-notice__ok"
              onClick={optOut}
              disabled={optedOut}
            >
              {optedOut ? 'You are opted out' : 'Opt out of sale or sharing'}
            </button>
          </div>

          <p className="mt-8 text-sm text-muted-foreground">
            Questions: <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            {' · '}
            <Link to="/privacy-policy" className="underline">Privacy Policy</Link>
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
