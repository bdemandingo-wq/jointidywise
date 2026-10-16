import { Link } from "react-router-dom";
import { ArticleBody } from "@/components/ArticleBody";
import { SUPPORT_EMAIL } from "@/lib/supportEmail";

/**
 * Canonical TidyWise Privacy Policy.
 *
 * Single source of truth for /privacy-policy and the signup dialog. Legal's
 * wording lives here so the two surfaces cannot drift. The page and the dialog
 * each supply their own title and effective-date line.
 *
 * Editorial notes from the draft are not part of the policy. The refund
 * section stays in the Terms of Service, which already has its own.
 */

export const PRIVACY_POLICY_EFFECTIVE_DATE = "October 16, 2026";

const linkClass = "text-primary hover:underline";

function PolicyLink({
  to,
  newTab,
  children,
}: {
  to: string;
  newTab?: boolean;
  children: React.ReactNode;
}) {
  // A mailto link opens the mail app. target="_blank" on it opens a blank tab as well.
  const openInNewTab = Boolean(newTab) && !to.startsWith("mailto:");
  const newTabProps = openInNewTab ? { target: "_blank" as const, rel: "noopener noreferrer" } : {};
  if (to.startsWith("mailto:") || to.startsWith("http")) {
    return (
      <a href={to} className={linkClass} {...newTabProps}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={linkClass} {...newTabProps}>
      {children}
    </Link>
  );
}

export function PrivacyPolicyBody({
  className,
  openLinksInNewTab = false,
}: {
  className?: string;
  /** Signup dialog only. The public page keeps links in the same tab. */
  openLinksInNewTab?: boolean;
}) {
  return (
    <ArticleBody size="sm" className={className}>
      <p>
        This Privacy Policy explains how TidyWise (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;) collects, uses, and shares
        information when you use our website at jointidywise.com and our web and mobile apps (the &quot;Services&quot;).
        TidyWise is software that cleaning businesses use to run their operations: bookings, scheduling, staff,
        invoicing, payments, and customer messaging.
      </p>

      <h2>Who this policy covers</h2>
      <ul>
        <li><strong>Business customers</strong> – cleaning business owners and admins who sign up for TidyWise.</li>
        <li><strong>Cleaners / staff</strong> – people a cleaning business invites to use the TidyWise staff app.</li>
        <li><strong>End customers</strong> – the clients of a cleaning business who book, pay, or get texts and emails through TidyWise.</li>
        <li><strong>Website visitors</strong> – anyone browsing our marketing and signup pages.</li>
      </ul>
      <p>
        <strong>Important:</strong> When a cleaning business uses TidyWise to manage its customers, staff, and jobs, that
        business controls those records. TidyWise processes that information on the business&apos;s behalf. If you are a
        customer or cleaner of a business that uses TidyWise, that business&apos;s own privacy policy also applies, and you
        may need to contact the business directly about your information.
      </p>
      <p>
        When a business imports leads from Facebook or other lead sources, that business is responsible for having the
        right to contact those people.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Contact and account details:</strong> name, email, phone number, physical/service address, business name, login credentials.</li>
        <li><strong>Booking and job information:</strong> appointments, services, notes, job photos, invoices, and messages.</li>
        <li><strong>Payment information:</strong> processed by our payment provider (Stripe). We do not store full payment card numbers on our servers.</li>
        <li><strong>Location information:</strong> described in detail in the &quot;Location&quot; section below.</li>
        <li><strong>Device and usage information:</strong> device type, app version, push-notification tokens, crash and error reports, and basic log data.</li>
        <li><strong>ipapi.co:</strong> On our home page we use ipapi.co to estimate your city from your IP address so we can show local information. We don&apos;t store the result with your identity.</li>
        <li><strong>Marketing attribution:</strong> when a business signs up, we store the UTM parameters and referral source from the link they used (for example, which ad or website sent them) so we can measure which marketing works.</li>
      </ul>
      <p>
        When you sign up, we record how you found us. That includes the ad or link you came from, its campaign tags, and
        any ad click identifiers (such as Google&apos;s gclid, Meta&apos;s fbclid or TikTok&apos;s ttclid). We use this to
        measure our own marketing. If your browser sends a Global Privacy Control signal, we don&apos;t save ad click
        identifiers from that visit.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>Provide and operate the Services (managing bookings, dispatching cleaners, processing payments, sending notifications).</li>
        <li>Communicate about accounts, bookings, receipts, and support requests.</li>
        <li>Improve, maintain, debug, and secure the Services.</li>
        <li>Measure our own marketing (see &quot;Analytics, advertising, and your California privacy rights&quot;).</li>
        <li>Comply with legal obligations and enforce our terms.</li>
      </ul>

      <h2>Location</h2>
      <p>
        <strong>(a) &quot;On My Way&quot; live location.</strong> When a cleaner taps <strong>On My Way</strong>, we share their
        live location with their cleaning business and with the customer they are traveling to. On iPhone, if the cleaner
        allows &quot;Always&quot; location access, sharing continues while the app is in the background or the phone is locked,
        and iOS shows a location indicator while it&apos;s active. On the web, sharing happens only while the page is open.
        Sharing stops when the cleaner arrives, when the job starts, or when the job ends, whichever comes first. We never
        collect live location outside an active On My Way trip. Admins may see the cleaner&apos;s last shared location until
        the job&apos;s start time. Live location data is deleted 30 days after the job&apos;s last location update.
      </p>
      <p>
        <strong>(b) Clock-in / clock-out and job photos.</strong> If location permission is turned on in the phone or
        browser settings, we record location when a cleaner clocks in, clocks out, or takes a job photo. If permission is
        off, we don&apos;t record it. These locations are kept as part of the job record until the business deletes the job or
        closes its account.
      </p>
      <p>
        <strong>(c) Who controls job records.</strong> The cleaning business controls its job records, and TidyWise
        processes them on the business&apos;s behalf. If a cleaner deletes their own TidyWise account, that does not delete
        records their employer holds. We forward those requests to the business.
      </p>
      <p>
        You can turn location access off at any time in your device settings. Some features may not work without it.
      </p>

      <h2>Text messages (SMS)</h2>
      <p>
        Cleaning businesses use TidyWise to send appointment-related texts (such as confirmations, reminders, and
        &quot;on the way&quot; notices) to their customers.
      </p>
      <ul>
        <li>The business sending the texts is responsible for getting its customers&apos; consent to receive them.</li>
        <li>Reply <strong>STOP</strong> to opt out of texts. Reply <strong>HELP</strong> for help.</li>
        <li>Message and data rates may apply. Message frequency varies.</li>
        <li>We do not share mobile numbers or SMS consent with third parties for their own marketing.</li>
      </ul>

      <h2>Analytics, advertising, and your California privacy rights (CCPA/CPRA)</h2>
      <p>
        We use Google Analytics, Google Ads and Meta Pixel on our website and signup pages, and to record one signup and trial event on onboarding and the dashboard.
      </p>
      <p>
        When you sign up and start your trial, Google and Meta may receive that event along with standard technical data
        such as your IP address, browser, cookies and the page URL. We don&apos;t send them your name, email, customers&apos;
        information or anything you enter in the app.
      </p>
      <p>
        Under California law, using these tools may count as &quot;selling&quot; or &quot;sharing&quot; personal information for
        cross-context behavioral advertising. You can opt out at any time:
      </p>
      <ul>
        <li>
          Use the <strong>&quot;Do Not Sell or Share My Personal Information&quot;</strong> link at{" "}
          <PolicyLink to="/do-not-sell" newTab={openLinksInNewTab}>jointidywise.com/do-not-sell</PolicyLink> or in our website footer.
        </li>
        <li>
          We honor <strong>Global Privacy Control (GPC)</strong> signals. If your browser sends a GPC signal, we treat it
          as an opt-out request.
        </li>
      </ul>
      <p>
        California residents also have the right to know what personal information we collect, to access it, to correct
        it, to delete it, and not to be discriminated against for exercising these rights. To make a request, contact us
        using the details below. We may need to verify your identity before acting on it.
      </p>
      <p>
        Separately, a cleaning business may add <strong>its own</strong> Meta Pixel or Google Analytics ID to its public
        booking, deposit, tip, or review pages hosted by TidyWise. Those tags are controlled by that business and covered
        by its own privacy policy.
      </p>

      <h2>Cookies</h2>
      <p>
        We use cookies to keep you signed in and remember your preferences. We use Google Analytics, Google Ads and Meta Pixel on our website and signup pages, and to record one signup and trial event on onboarding and the dashboard. You can opt out at
        any time with the &quot;Do Not Sell or Share My Personal Information&quot; link, and we honor Global Privacy
        Control signals automatically. You can also block cookies in your browser.
      </p>

      <h2>Service providers we use</h2>
      <p>We share information with these providers only so they can perform services for us:</p>
      <ul>
        <li><strong>Stripe</strong> – payment processing, subscriptions, and payouts.</li>
        <li><strong>Supabase</strong> – hosting, database, authentication, and file storage.</li>
        <li><strong>OpenPhone</strong> – business phone calls and SMS.</li>
        <li><strong>Resend</strong> – customer and staff email when a business is not sending through its own Gmail, including invoices, booking messages, review requests, and team invitations, plus messages we send directly such as subscription receipts and staff welcome mail. Resend receives the recipient&apos;s email address, the subject, and the message. A staff welcome message can include login details. Staff password-setup links and client portal reset links are sent through Resend.</li>
        <li><strong>Apple Push Notification service</strong> – push notifications on iPhone.</li>
        <li><strong>Google Maps Platform</strong> – address lookup, geocoding, and driving time estimates.</li>
        <li><strong>Sentry</strong> – error and performance monitoring, including a recording of the screen with text and inputs masked when an error happens, and timing data from a sample of page loads.</li>
        <li><strong>Anthropic</strong> – AI features (for example, message drafting, AI SMS replies, and business insights). Content you submit to AI features is sent to Anthropic to generate a response.</li>
        <li><strong>Google (Gmail)</strong> – only if a business chooses to connect its Gmail account to send email from TidyWise.</li>
        <li><strong>Google Analytics, Google Ads, Meta</strong> – We use Google Analytics, Google Ads and Meta Pixel on our website and signup pages, and to record one signup and trial event on onboarding and the dashboard.</li>
        <li><strong>Lovable</strong> – website hosting, Google and Apple sign-in on the web, and account email. Owner and admin signup, sign-in, and password-reset mail is sent through Lovable, which receives the recipient&apos;s email address, the message, and the confirmation, sign-in, or reset link.</li>
        <li><strong>SitePong</strong> – error reporting (error details, page URL and browser type).</li>
        <li><strong>Meta (Facebook Lead Ads)</strong> – if a business connects its Facebook lead forms, we receive the name, email, phone and any details the person submitted, and store them as a lead for that business.</li>
        <li><strong>Make.com</strong> – internal automation; we send a new subscriber&apos;s name, email, business name and subscription status to keep our own records and follow-ups.</li>
      </ul>
      <p>
        <strong>Integrations businesses turn on themselves:</strong> A business can connect <strong>Zapier</strong> or{" "}
        <strong>GoHighLevel</strong> by entering its own webhook or account details. When it does, TidyWise sends the
        business&apos;s chosen data (such as new bookings or customer details) to that tool. These integrations are off
        unless the business sets them up, and the business is responsible for how that tool uses the data.
      </p>

      <h2>Data sharing</h2>
      <p>
        Beyond the providers above, we may share information: with the cleaning business you work with or book through;
        if required by law or to protect rights and safety; or as part of a merger, acquisition, or sale of assets.
      </p>

      <h2>Security</h2>
      <p>
        We use reasonable administrative, technical, and physical safeguards to protect your information. No method of
        transmission or storage is 100% secure.
      </p>

      <h2>Data retention</h2>
      <p>
        We keep information as long as needed to provide the Services and for legitimate business purposes such as
        meeting legal obligations, resolving disputes, and enforcing agreements. Specific location retention periods are
        described in the &quot;Location&quot; section.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Update account information in the app.</li>
        <li>Control device permissions (location, camera, notifications) in your device settings.</li>
        <li>Opt out of texts by replying STOP.</li>
        <li>
          Opt out of &quot;selling/sharing&quot; via <PolicyLink to="/do-not-sell" newTab={openLinksInNewTab}>Do Not Sell or Share My Personal Information</PolicyLink>, the
          footer link, or GPC.
        </li>
      </ul>

      <h2>Account deletion</h2>
      <p>
        Account owners can delete their account in Settings. You can also request deletion on our{" "}
        <PolicyLink to="/delete-account" newTab={openLinksInNewTab}>Account Deletion page</PolicyLink>.
        Cleaners, team members and customers of a business can ask that business to delete their information, or email{" "}
        <PolicyLink to={`mailto:${SUPPORT_EMAIL}`} newTab={openLinksInNewTab}>{SUPPORT_EMAIL}</PolicyLink> and we will
        pass the request to the business. We process deletion requests within 7 business days.
      </p>
      <p>
        Copies of deleted information may remain in our encrypted backups for a limited period until those backups are
        overwritten on their regular schedule. We do not use backup copies for any other purpose.
      </p>

      <h2>Children&apos;s privacy</h2>
      <p>The Services are not directed to children under 13, and we do not knowingly collect their information.</p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. When we do, we&apos;ll update the effective date above and, for material
        changes, give notice through the Services or by email.
      </p>

      <h2>Contact us</h2>
      <p>
        TidyWise
        <br />
        65 SW 12th Ave, Deerfield Beach, FL 33442
        <br />
        Email: <PolicyLink to={`mailto:${SUPPORT_EMAIL}`} newTab={openLinksInNewTab}>{SUPPORT_EMAIL}</PolicyLink>
      </p>
    </ArticleBody>
  );
}
