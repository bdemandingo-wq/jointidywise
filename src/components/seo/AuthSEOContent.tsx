/**
 * AuthSEOContent
 * Reusable SEO body content for auth pages (login/signup/portal logins).
 * Provides a single H1, 300+ words of meaningful copy, internal links, and
 * a short FAQ — hidden on native Capacitor builds to avoid in-app bloat.
 */

import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { LIFETIME_SPOT_CAP } from '@/lib/publicPlans';

type Variant = 'login' | 'signup' | 'portal' | 'staff';

interface AuthSEOContentProps {
  variant?: Variant;
  /** Visible heading rendered above the form. */
  heading?: string;
  /** Use 'h2' on pages that already have an H1 (e.g., the landing page). Defaults to 'h1'. */
  headingLevel?: 'h1' | 'h2';
}

const COPY: Record<Variant, { heading: string; intro: string; role: string }> = {
  login: {
    heading: 'Sign in to TidyWise',
    intro:
      'Welcome back to TidyWise — the all-in-one cleaning business software built for independent cleaners and growing maid services. Sign in to manage your bookings, dispatch your team, send invoices, and keep your operations running smoothly from one dashboard.',
    role: 'business owner',
  },
  signup: {
    heading: 'Create your TidyWise account',
    intro:
      'Start running your cleaning business from one place. TidyWise gives you scheduling, dispatch, invoicing, payroll, and client communication tools built specifically for cleaning companies and maid services.',
    role: 'business owner',
  },
  portal: {
    heading: 'Client Portal Login',
    intro:
      'Welcome to the TidyWise Client Portal. Sign in to view your upcoming cleanings, request new appointments, update your address, manage your payment method, and message your cleaning company directly.',
    role: 'client',
  },
  staff: {
    heading: 'Staff Portal Login',
    intro:
      'Welcome to the TidyWise Staff Portal. Sign in to view your assigned jobs, check in to bookings, complete checklists, upload before-and-after photos, message the office, and track your earnings.',
    role: 'team member',
  },
};

export function AuthSEOContent({ variant = 'login', heading, headingLevel = 'h1' }: AuthSEOContentProps) {
  // Don't render extra SEO body content inside the iOS/Android app shell.
  if (Capacitor.isNativePlatform()) return null;

  const copy = COPY[variant];
  const h1 = heading ?? copy.heading;
  const HeadingTag = headingLevel;

  return (
    <section
      aria-labelledby="auth-seo-heading"
      className="mt-10 mx-auto w-full max-w-3xl text-left text-sm text-muted-foreground space-y-6 px-2"
    >
      <HeadingTag id="auth-seo-heading" className="text-2xl font-bold text-foreground">
        {h1}
      </HeadingTag>

      <p>{copy.intro}</p>

      <p>
        Once you're signed in, you'll have access to the full TidyWise toolkit. Build
        recurring weekly, biweekly, and monthly cleaning schedules; assign jobs to the
        right cleaner based on availability and location; send branded invoices and
        collect online payments; run payroll for your team without spreadsheets; and
        keep clients informed with automated confirmations, reminders, and on-the-way
        SMS alerts.
      </p>

      <h2 className="text-lg font-semibold text-foreground">
        What you can do inside TidyWise
      </h2>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          <Link to="/features/scheduling-software" className="text-primary hover:underline">
            Scheduling &amp; dispatch
          </Link>{' '}
          — drag-and-drop calendar, route-aware assignments, and recurring job templates.
        </li>
        <li>
          <Link to="/features/invoicing-software" className="text-primary hover:underline">
            Invoicing &amp; payments
          </Link>{' '}
          — send professional invoices, accept cards, and track outstanding balances.
        </li>
        <li>
          <Link to="/features/crm" className="text-primary hover:underline">
            Customer CRM
          </Link>{' '}
          — full client history, addresses, notes, and communication in one record.
        </li>
        <li>
          <Link to="/features/payroll-software" className="text-primary hover:underline">
            Payroll for cleaners
          </Link>{' '}
          — hours, tips, and per-job pay calculated automatically each pay period.
        </li>
        <li>
          <Link to="/features/route-optimization" className="text-primary hover:underline">
            Route optimization
          </Link>{' '}
          — cut drive time and fit more cleanings into every day.
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-foreground">Built for cleaning companies</h2>
      <p>
        TidyWise is built by operators who understand the realities of running a
        cleaning business — last-minute reschedules, no-shows, tip handling, and the
        constant balancing act between clients and cleaners. Your data is protected
        with enterprise-grade encryption, role-based access controls, and strict
        organization isolation, so your customers, your team, and your books stay
        private to you.
      </p>

      <h2 className="text-lg font-semibold text-foreground">Frequently asked questions</h2>
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-foreground">I forgot my password — what do I do?</h3>
          <p>
            Use the password reset link on the sign-in form. You'll receive a secure
            reset email within a minute. If it doesn't arrive, check your spam folder
            or contact support.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Do I need a separate account for my staff?</h3>
          <p>
            Yes — your cleaners use the{' '}
            <Link to="/staff/login" className="text-primary hover:underline">
              Staff Portal
            </Link>{' '}
            and your customers use the{' '}
            <Link to="/portal/login" className="text-primary hover:underline">
              Client Portal
            </Link>
            . Each portal has its own login and only shows the information relevant to
            that {copy.role}.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-foreground">How much does TidyWise cost?</h3>
          <p>
            Plans start at $49/mo (Basic), with Pro at $97/mo and Custom at $197/mo. A founding $300 one-time Lifetime spot is available for the first {LIFETIME_SPOT_CAP} customers. Yearly billing includes 2 months free. See{' '}
            <Link to="/pricing" className="text-primary hover:underline">
              pricing
            </Link>{' '}
            for full details.
          </p>
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Where can I learn more?</h3>
          <p>
            Visit our{' '}
            <Link to="/blog" className="text-primary hover:underline">
              blog
            </Link>{' '}
            for guides on running a cleaning business, or head back to the{' '}
            <Link to="/" className="text-primary hover:underline">
              homepage
            </Link>{' '}
            for a full product tour.
          </p>
        </div>
      </div>

      <nav aria-label="More from TidyWise" className="pt-2 border-t border-border">
        <p className="text-xs">
          More from TidyWise:{' '}
          <Link to="/" className="text-primary hover:underline">Home</Link>
          {' · '}
          <Link to="/pricing" className="text-primary hover:underline">Pricing</Link>
          {' · '}
          <Link to="/features/scheduling-software" className="text-primary hover:underline">
            Scheduling
          </Link>
          {' · '}
          <Link to="/features/invoicing-software" className="text-primary hover:underline">
            Invoicing
          </Link>
          {' · '}
          <Link to="/features/crm" className="text-primary hover:underline">CRM</Link>
          {' · '}
          <Link to="/blog" className="text-primary hover:underline">Blog</Link>
          {' · '}
          <Link to="/signup" className="text-primary hover:underline">Create account</Link>
        </p>
      </nav>
    </section>
  );
}

export default AuthSEOContent;
