import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useState } from "react";

export default function CleaningBusinessManagementSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article"
        title="Cleaning Business Management Software: Complete Guide"
        description="Discover the best cleaning business management software. Compare features, pricing, and tools to streamline scheduling, payroll, and client management."
        canonical="/blog/cleaning-business-management-software"
        ogImage="/images/tidywise-og.png"
        schemaJson={{
          "@type": "BlogPosting",
          "headline": "Cleaning Business Management Software — What You Actually Need",
          "description": "A practical guide to cleaning business management software: what it does, what features matter, and how to choose the right platform.",
          "datePublished": "2026-04-13",
          "dateModified": "2026-04-13",
          "author": { "@type": "Organization", "name": "TidyWise" },
        }}
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'Cleaning Business Management Software: Complete Guide', path: '/blog/cleaning-business-management-software' }]} />
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="font-bold text-xl text-foreground">TIDYWISE</a>
            <div className="hidden md:flex items-center gap-8">
              <a href="/blog" className="text-muted-foreground hover:text-foreground">Blog</a>
              <a href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</a>
              <Button variant="ghost" asChild><Link to="/login">Log In</Link></Button>
              <Button asChild><Link to="/signup">Get started</Link></Button>
            </div>
            <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-border space-y-3">
              <a href="/blog" className="block px-4 py-2 text-muted-foreground hover:text-foreground">Blog</a>
              <a href="/pricing" className="block px-4 py-2 text-muted-foreground hover:text-foreground">Pricing</a>
              <div className="px-4 flex gap-2">
                <Button variant="ghost" asChild className="flex-1"><Link to="/login">Log In</Link></Button>
                <Button asChild className="flex-1"><Link to="/signup">Get started</Link></Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      <article className="pt-28 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <Button variant="ghost" className="mb-6" onClick={() => navigate("/blog")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Blog
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <span className="bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">Operations</span>
            <span>· 9 min read</span>
            <span>· April 2026</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">Cleaning Business Management Software — What You Actually Need</h1>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p className="text-muted-foreground text-lg">
              "Management software" is a broad term. For a cleaning business, it means the platform that runs your day-to-day operations — scheduling, booking, billing, payroll, client communication, and reporting. The right software is the difference between spending your evenings doing admin and actually running a business. Here's a practical breakdown of what matters and what doesn't.
            </p>

            <h2 className="text-2xl font-bold mt-8">The Problem with Running a Cleaning Business on Spreadsheets</h2>
            <p className="text-muted-foreground">
              Most cleaning business owners start with spreadsheets, a calendar app, and manual invoicing. It works at first. By the time you have 20+ recurring clients and 3+ cleaners, the cracks show:
            </p>
            <ul className="space-y-2 text-muted-foreground list-disc list-inside">
              <li>Double-bookings because the calendar isn't synced with the booking form</li>
              <li>Clients calling to find out where their cleaner is</li>
              <li>Forgetting to invoice a job or charging the wrong amount</li>
              <li>Friday payroll taking 3 hours because you're cross-referencing job logs</li>
              <li>No visibility into which jobs are actually profitable</li>
            </ul>
            <p className="text-muted-foreground">
              Management software solves all of these by connecting your data — a booking creates a schedule entry, which creates a payroll entry, which creates an invoice, which creates a payment record. One system, not five.
            </p>

            <h2 className="text-2xl font-bold mt-8">The Core Modules of Cleaning Business Management Software</h2>

            <h3 className="text-xl font-semibold mt-6">Scheduling</h3>
            <p className="text-muted-foreground">
              The scheduling module is the center of everything. It needs to handle recurring jobs (weekly, bi-weekly, monthly), multiple simultaneous teams, cleaner assignment rules, and last-minute changes. Look for drag-and-drop calendar views, conflict detection, and real-time updates that push to the cleaner app instantly.
            </p>

            <h3 className="text-xl font-semibold mt-6">Online Booking</h3>
            <p className="text-muted-foreground">
              A public booking page is now table stakes. Clients expect to be able to book without calling. The booking page should calculate a price based on their home details, show available time slots, collect payment info, and send a confirmation automatically. Done right, new bookings arrive in your schedule while you sleep.
            </p>

            <h3 className="text-xl font-semibold mt-6">Client CRM</h3>
            <p className="text-muted-foreground">
              Every client record should store their address, entry instructions, preferred products, cleaning notes, billing history, and communication log. When a cleaner needs to know where the spare key is or which rooms to skip, it's in the app. When a client calls to dispute a charge, you pull up their invoice history in seconds.
            </p>

            <h3 className="text-xl font-semibold mt-6">Invoicing and Payments</h3>
            <p className="text-muted-foreground">
              Manual invoicing is a revenue leak. Jobs get billed late, at the wrong amount, or not at all. Management software should auto-generate invoices when jobs are marked complete and charge the card on file automatically. Recurring clients should never receive a paper invoice — billing should be invisible and automatic.
            </p>

            <h3 className="text-xl font-semibold mt-6">Payroll</h3>
            <p className="text-muted-foreground">
              Payroll for cleaning businesses is more complex than most: cleaners may earn a percentage of job value (not an hourly rate), tips get split, mileage gets reimbursed, and the numbers change every week. Good management software pulls this data from completed jobs and produces a payroll report — you review it, approve it, and pay. The calculation happens automatically.
            </p>

            <h3 className="text-xl font-semibold mt-6">Reporting and P&L</h3>
            <p className="text-muted-foreground">
              Revenue reports and job logs aren't enough. You need to know your profit per job, revenue by service type, cancellation rates, and cleaner productivity. The platforms that include P&L reporting let you make pricing and hiring decisions from data instead of intuition.
            </p>

            <h2 className="text-2xl font-bold mt-8">Signs You've Outgrown Your Current System</h2>
            <div className="bg-muted/50 rounded-xl p-5 space-y-3">
              {[
                "You're spending more than 2 hours per week on scheduling alone",
                "Clients complain about not receiving invoices or getting double-charged",
                "You can't immediately answer 'which jobs made money this month?'",
                "Cleaner payroll takes more than 30 minutes per pay period",
                "You miss bookings because confirmation emails don't go out automatically",
                "Your cleaners are texting you for schedule updates instead of checking an app",
              ].map((sign, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-destructive font-bold mt-0.5">✗</span>
                  <p className="text-muted-foreground text-sm">{sign}</p>
                </div>
              ))}
            </div>

            <h2 className="text-2xl font-bold mt-8">Evaluating Your Options</h2>
            <p className="text-muted-foreground">
              Three questions that cut through the feature-list noise:
            </p>
            <ul className="space-y-3 text-muted-foreground list-none pl-0">
              {[
                { title: "How fast can you get operational?", desc: "Some platforms require a week of setup and training. Others can be up and running in an afternoon. Time to value matters as much as the feature set." },
                { title: "Can your cleaners actually use it?", desc: "The cleaner app needs to be simple enough that non-tech-savvy staff can adopt it without training. If adoption fails, the whole system fails." },
                { title: "Does pricing scale painfully?", desc: "Per-user or per-booking pricing makes software increasingly expensive as you grow. Flat-rate pricing lets you scale without cost anxiety." },
              ].map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="text-primary font-bold mt-1">→</span>
                  <div><strong className="text-foreground">{f.title}</strong> {f.desc}</div>
                </li>
              ))}
            </ul>

            <h2 className="text-2xl font-bold mt-8">The ROI of Management Software</h2>
            <p className="text-muted-foreground">
              The typical cleaning business owner spends 15-25 hours per week on admin at the point they start looking for software. Good management software reduces this to under 5 hours. At a conservative $40/hour opportunity cost, that's $400-$800 per week recovered — far more than any software subscription costs.
            </p>
            <p className="text-muted-foreground">
              The harder-to-quantify ROI is the revenue that never leaves: jobs that don't get missed, invoices that get paid on time, and clients who don't churn because they can't reach you.
            </p>

            <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 mt-8">
              <h3 className="text-lg font-semibold text-foreground mb-2">TIDYWISE — All-in-One Cleaning Business Management</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Scheduling, online booking, invoicing, and CRM from $49/mo. Payroll, GPS tracking, and P&L reporting are on Pro at $97/mo. Custom is $197/mo. Built specifically for cleaning businesses, no configuration required.
              </p>
              <Button asChild><Link to="/signup">Get started →</Link></Button>
              <p className="text-sm text-muted-foreground mt-3">
                Already have a TidyWise account? <Link to="/login" className="text-primary hover:underline">Sign in to your dashboard</Link>.
              </p>
            </div>
          </div>

          <div className="mt-16">
            <RelatedArticles currentSlug="/blog/cleaning-business-management-software" articles={allArticles} />
          </div>
        </div>
      </article>
    </div>
  );
}
