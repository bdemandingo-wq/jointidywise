import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useState } from "react";

export default function MaidServiceSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article"
        title="Maid Service Software: Top Features & Benefits"
        description="Compare the best maid service software for scheduling, invoicing, payroll, and client management. Built for residential cleaning companies. "
        canonical="/blog/maid-service-software"
        ogImage="/images/tidywise-og.png"
        schemaJson={{
          "@type": "BlogPosting",
          "headline": "Best Maid Service Software in 2026 — Complete Buyer's Guide",
          "description": "Compare the best maid service software for scheduling, invoicing, payroll, and client management.",
          "datePublished": "2026-04-13",
          "dateModified": "2026-04-13",
          "author": { "@type": "Organization", "name": "TidyWise" },
        }}
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'Maid Service Software: Top Features & Benefits', path: '/blog/maid-service-software' }]} />
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
            <span className="bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">Software Reviews</span>
            <span>· 10 min read</span>
            <span>· April 2026</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">Best Maid Service Software in 2026 — Complete Buyer's Guide</h1>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p className="text-muted-foreground text-lg">
              Maid service software is the operational backbone of a residential cleaning company — handling scheduling, online booking, invoicing, payroll, client communication, and reporting in one place. The right platform saves 10-20 hours per week, reduces billing errors, and makes it possible to scale beyond what you can manually coordinate. This guide covers what to look for and how the top options compare.
            </p>

            <h2 className="text-2xl font-bold mt-8">What Maid Service Software Actually Does</h2>
            <p className="text-muted-foreground">
              The term covers a lot of ground. Here are the core capabilities that matter for a residential cleaning business:
            </p>
            <ul className="space-y-3 text-muted-foreground list-none pl-0">
              {[
                { title: "Online booking and instant quotes", desc: "A public booking page where clients enter home details (bedrooms, bathrooms, extras) and get an instant price — then book in minutes without calling you." },
                { title: "Scheduling and dispatch", desc: "Visual calendar for managing all jobs, assigning cleaners, handling recurring schedules, and rescheduling when plans change." },
                { title: "Client management (CRM)", desc: "Contact history, cleaning notes, preferred products, access instructions, and payment info stored per client. Never ask a repeat customer for their entry code again." },
                { title: "Invoicing and payment collection", desc: "Automatic invoices sent after job completion, online payment links, card-on-file charging, and deposit collection — reducing payment chasing to near zero." },
                { title: "Payroll and wage calculation", desc: "Automated wage calculations based on hours, job type, and tips. The best platforms generate a payroll report — you just review and approve." },
                { title: "Cleaner mobile app", desc: "A smartphone app where cleaners see their daily schedule, get job details, check in on arrival, mark jobs complete, and upload before/after photos." },
                { title: "Reporting and P&L", desc: "Revenue by service type, profit per job, cancellation rates, and cleaner productivity — the data you need to run the business, not just log jobs." },
              ].map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="text-primary font-bold mt-1">→</span>
                  <div><strong className="text-foreground">{f.title}.</strong> {f.desc}</div>
                </li>
              ))}
            </ul>

            <h2 className="text-2xl font-bold mt-8">Maid Service Software vs. General Field Service Software</h2>
            <p className="text-muted-foreground">
              There are two categories of software marketed to cleaning businesses:
            </p>
            <div className="bg-muted/50 rounded-xl p-5 space-y-4">
              <div>
                <p className="font-semibold text-foreground">Cleaning-specific platforms (TIDYWISE, ZenMaid, Launch27)</p>
                <p className="text-muted-foreground text-sm mt-1">Built from the ground up for residential cleaning. Features like square footage pricing, bedroom/bathroom-based quotes, cleaner checklists, and home entry notes are native. No workarounds required.</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">General field service platforms (Jobber, Housecall Pro, ServiceTitan)</p>
                <p className="text-muted-foreground text-sm mt-1">Built for any home services business (plumbing, HVAC, landscaping). Can work for cleaning, but require configuration to handle cleaning-specific needs, often cost more, and include features you'll never use.</p>
              </div>
            </div>
            <p className="text-muted-foreground">
              For most maid service owners, cleaning-specific software is the better starting point. You spend less time configuring the tool and more time running the business.
            </p>

            <h2 className="text-2xl font-bold mt-8">Features That Separate Good from Great</h2>

            <h3 className="text-xl font-semibold mt-6">Square footage and room-based pricing</h3>
            <p className="text-muted-foreground">
              The best maid service software calculates job prices automatically from home details — not from hours worked. You set your pricing rules once (X bedrooms + Y bathrooms + Z extras = $___), and the software does the math on every booking. This eliminates underpricing and makes quotes consistent.
            </p>

            <h3 className="text-xl font-semibold mt-6">Automated recurring billing</h3>
            <p className="text-muted-foreground">
              Most of your revenue is recurring. The software should handle bi-weekly billing automatically — charging the card on file after each completed job, sending a receipt, and logging the payment. No manual invoicing for recurring clients.
            </p>

            <h3 className="text-xl font-semibold mt-6">Payroll automation</h3>
            <p className="text-muted-foreground">
              Calculating cleaner wages from job records is one of the most time-consuming tasks in the business. Platforms with automated payroll pull completed jobs, apply the wage formula you set (percentage of job value, hourly rate, or flat per-job), add tips, deduct advances, and produce a payroll report. This turns a 3-hour Friday task into a 10-minute review.
            </p>

            <h3 className="text-xl font-semibold mt-6">Client self-service portal</h3>
            <p className="text-muted-foreground">
              A client portal reduces inbound calls dramatically. Clients can view upcoming appointments, request reschedules, update payment info, and see invoice history — without calling you. For a business with 50+ active clients, this recovers significant time.
            </p>

            <h2 className="text-2xl font-bold mt-8">Pricing: What to Expect</h2>
            <p className="text-muted-foreground">
              Maid service software pricing varies widely:
            </p>
            <ul className="space-y-2 text-muted-foreground list-disc list-inside">
              <li><strong className="text-foreground">TIDYWISE:</strong> Plans from $49/mo, with Pro at $97/mo and Custom at $197/mo. Unlimited bookings on every tier.</li>
            </ul>
            <p className="text-muted-foreground">
              The right platform isn't necessarily the cheapest — it's the one that costs you the least in wasted time. A $49/month platform that saves 15 hours per week is far more valuable than a free tool that requires manual workarounds.
            </p>

            <h2 className="text-2xl font-bold mt-8">What Most Owners Miss When Choosing</h2>
            <p className="text-muted-foreground">
              The most common mistake is evaluating software based on the feature list and ignoring implementation. The questions that actually matter:
            </p>
            <ul className="space-y-2 text-muted-foreground list-disc list-inside">
              <li>How long does setup take? (Some platforms require days of configuration.)</li>
              <li>Can cleaners use it without training? (If it's confusing, adoption fails.)</li>
              <li>What happens when something breaks? (Support quality varies enormously.)</li>
              <li>Does pricing go up as you grow? (Per-booking or per-user pricing gets expensive fast.)</li>
            </ul>

            <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 mt-8">
              <h3 className="text-lg font-semibold text-foreground mb-2">TIDYWISE — Built for Maid Services</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Online booking, scheduling, invoicing, and client management from $49/mo. Payroll and GPS tracking are on Pro at $97/mo. Custom is $197/mo. Built specifically for residential cleaning businesses, not adapted from a general tool.
              </p>
              <Button asChild><Link to="/signup">Get started →</Link></Button>
              <p className="text-sm text-muted-foreground mt-3">
                Already have a TidyWise account? <Link to="/login" className="text-primary hover:underline">Sign in to your dashboard</Link>.
              </p>
            </div>
          </div>

          <div className="mt-16">
            <RelatedArticles currentSlug="/blog/maid-service-software" articles={allArticles} />
          </div>
        </div>
      </article>
    </div>
  );
}
