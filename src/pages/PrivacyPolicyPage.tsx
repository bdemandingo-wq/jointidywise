import { Link, useNavigate } from "react-router-dom";
import { SEOHead } from '@/components/SEOHead';
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/SiteFooter";
import { ArrowLeft } from "lucide-react";
import { ArticleBody, READING_COLUMN_SM, READING_CARD_SM } from "@/components/ArticleBody";
import { SUPPORT_EMAIL } from "@/lib/supportEmail";

export default function PrivacyPolicyPage() {
  const navigate = useNavigate();
  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead
        title="Privacy Policy | TidyWise"
        description="Read TidyWise's Privacy Policy. Learn what information we collect and how we use it to provide app functionality."
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
            <p className="mt-2 text-sm text-muted-foreground">Effective date: February 1, 2025</p>

          <ArticleBody size="sm" className="mt-8">
            <p>
              This Privacy Policy explains how <strong>TidyWise</strong> ("we", "us", "our") collects, uses, and shares
              information when you use our website and app (the "Services").
            </p>

            <h2>Information We Collect</h2>
            <p>We collect the following categories of information, primarily to provide app functionality:</p>
            <ul>
              <li><strong>Name</strong></li>
              <li><strong>Email</strong></li>
              <li><strong>Phone Number</strong></li>
              <li><strong>Physical Address</strong></li>
              <li><strong>Precise Location</strong> (for features like GPS check-ins and location-aware workflows, when enabled)</li>
              <li><strong>Payment Information</strong> (processed for purchases and billing)</li>
            </ul>

            <p>
              Payment details may be processed by our payment service providers. We do not store full payment card numbers on
              our servers.
            </p>

            <h2>How We Use Information</h2>
            <p>We use the information we collect to:</p>
            <ul>
              <li>Provide and operate the Services (e.g., managing bookings and providing cleaning services).</li>
              <li>Communicate with you about your account, bookings, receipts, and support requests.</li>
              <li>Improve, maintain, and secure the Services.</li>
              <li>Comply with legal obligations and enforce our terms.</li>
            </ul>

            <h2>Third-Party Services & SDKs</h2>
            <p>We use the following third-party services that may collect or process data on our behalf:</p>
            <ul>
              <li><strong>Stripe</strong> — Payment processing. Stripe collects payment card details, billing address, and transaction information. See <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe's Privacy Policy</a>.</li>
              <li><strong>Supabase</strong> — Backend infrastructure including authentication, database, and file storage. See <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">Supabase's Privacy Policy</a>.</li>
              <li><strong>OpenPhone</strong> — Business phone and SMS messaging. See <a href="https://www.openphone.com/privacy" target="_blank" rel="noopener noreferrer">OpenPhone's Privacy Policy</a>.</li>
              <li><strong>Resend</strong> — Transactional email delivery. See <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">Resend's Privacy Policy</a>.</li>
              <li><strong>Apple Push Notification service (APNs)</strong> — Push notifications on iOS devices.</li>
            </ul>

            <h2>Data Sharing</h2>
            <p>
              We may share information with service providers that help us run the Services (for example, hosting, analytics,
              customer support, messaging, and payment processing). These providers are permitted to use information only to
              perform services for us.
            </p>
            <p>
              <strong>We do not sell your personal data to third parties for advertising.</strong>
            </p>

            <h2>Security</h2>
            <p>
              We use reasonable administrative, technical, and physical safeguards designed to protect your information.
              However, no method of transmission or storage is 100% secure.
            </p>

            <h2>Data Retention</h2>
            <p>
              We retain information for as long as needed to provide the Services and for legitimate business purposes, such
              as complying with legal obligations, resolving disputes, and enforcing agreements.
            </p>

            <h2>Your Choices</h2>
            <ul>
              <li>You may update certain account information within the app.</li>
              <li>
                You can control device permissions (like location access) through your device settings. Some features may not
                work if permissions are disabled.
              </li>
            </ul>

            <h2>Account Deletion</h2>
            <p>
              You may request deletion of your account and associated data at any time. Visit our <Link to="/delete-account" className="text-primary hover:underline">Account Deletion page</Link> to submit a request, or:
            </p>
            <ul>
              <li>Navigate to <strong>Settings → Security</strong> in the app and select <strong>"Delete My Account"</strong>.</li>
              <li>Alternatively, email us at <strong>{SUPPORT_EMAIL}</strong> with the subject line "Account Deletion Request".</li>
            </ul>
            <p>
              Upon receiving a deletion request, we will delete or anonymize your personal data within 30 days, unless we are required to retain it for legal or compliance purposes.
            </p>

            <h2>Refund Policy</h2>
            <p>
              All subscription payments are non-refundable. By subscribing to TidyWise, you acknowledge that you have had
              access to the full platform during your subscription period and that no refunds will be issued for any used or
              unused portion of your subscription. You may cancel your subscription at any time to prevent future charges.
              This policy was agreed to at the time of account creation.
            </p>

            <h2>Children's Privacy</h2>
            <p>The Services are not directed to children under 13, and we do not knowingly collect information from them.</p>

            <h2>Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. If we make changes, we will update the effective date
              above.
            </p>

            <h2>Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at <strong>{SUPPORT_EMAIL}</strong>.
            </p>
          </ArticleBody>
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
