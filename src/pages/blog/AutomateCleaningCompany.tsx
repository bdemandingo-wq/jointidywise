import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { ArrowRight, ArrowLeft, Menu, X } from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

export default function AutomateCleaningCompany() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article"
        title="How to Automate Your Cleaning Company (2025 Guide)"
        description="Learn how to automate booking, scheduling, invoicing, and client communication for your cleaning company. Save 15+ hours per week with the right tools."
        canonical="/blog/how-to-automate-cleaning-company"
        ogImage="/images/tidywise-og.png"
        schemaJson={{
          "@type": "BlogPosting",
          "headline": "How to Automate Your Cleaning Company",
          "description": "Learn how to automate your cleaning company and save 15+ hours per week.",
          "datePublished": "2025-10-10",
          "author": { "@type": "Organization", "name": "TidyWise" },
        }}
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'How to Automate Your Cleaning Company (2025 Guide)', path: '/blog/how-to-automate-cleaning-company' }]} />
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
        </div>
      </nav>

      <article className="pt-28 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <Button variant="ghost" className="mb-6" onClick={() => navigate("/blog")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Blog
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <span className="bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">Automation</span>
            <span>· 8 min read</span>
            <span>· October 2025</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">How to Automate Your Cleaning Company</h1>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p className="text-muted-foreground text-lg">If you're spending more time on admin than actual cleaning, it's time to automate. Modern cleaning business software can handle booking, scheduling, invoicing, reminders, and follow-ups — freeing you up to grow your business.</p>

            <h2 className="text-2xl font-bold mt-8">1. Automate Booking & Scheduling</h2>
            <p className="text-muted-foreground">Replace phone tag with online booking. Clients pick their service, date, and time. The system checks availability, assigns a cleaner, and sends confirmation — all without you touching anything. This alone saves 5-10 hours per week for most cleaning business owners.</p>

            <h2 className="text-2xl font-bold mt-8">2. Automate Client Communication</h2>
            <p className="text-muted-foreground">Set up automatic booking confirmations, appointment reminders (24 hours before), "on the way" notifications, and post-service review requests. SMS and email automation reduces no-shows by up to 40%.</p>

            <h2 className="text-2xl font-bold mt-8">3. Automate Invoicing & Payments</h2>
            <p className="text-muted-foreground">Generate invoices automatically after each job. Store cards on file and charge automatically. Send payment reminders for outstanding balances. Stop chasing payments manually.</p>

            <h2 className="text-2xl font-bold mt-8">4. Automate Team Management</h2>
            <p className="text-muted-foreground">Auto-assign cleaners based on availability, location, and skills. Let staff check in/out of jobs via the app. Calculate payroll automatically based on completed jobs.</p>

            <h2 className="text-2xl font-bold mt-8">5. Automate Follow-Up & Retention</h2>
            <p className="text-muted-foreground">Set up re-booking campaigns for one-time clients. Send loyalty rewards to regulars. Identify at-risk customers before they churn. A good cleaning business CRM handles all of this on autopilot.</p>

            <h2 className="text-2xl font-bold mt-8">6. Automate Reporting</h2>
            <p className="text-muted-foreground">Stop manually calculating revenue, expenses, and profit. Your cleaning business software should give you real-time dashboards showing daily revenue, team productivity, customer lifetime value, and profit margins.</p>

            <h2 className="text-2xl font-bold mt-8">How Much Time Can You Save?</h2>
            <p className="text-muted-foreground">Most cleaning business owners report saving <strong>15-20 hours per week</strong> after automating these six areas. That's essentially getting a half-time employee for free.</p>

            <div className="bg-primary/5 rounded-xl p-6 mt-8 border border-primary/20">
              <h3 className="text-xl font-bold text-foreground mb-2">Automate Your Cleaning Business Today</h3>
              <p className="text-muted-foreground mb-4">TidyWise handles booking, scheduling, and invoicing from $49/mo. Automated reminders and reporting are on Pro at $97/mo.</p>
              <Button asChild>
                <Link to="/signup">Get started <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <p className="text-sm text-muted-foreground mt-3">
                Already have a TidyWise account? <Link to="/login" className="text-primary hover:underline">Sign in to your dashboard</Link>.
              </p>
            </div>
          </div>
        </div>
      </article>

      <section className="py-16 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <RelatedArticles currentSlug="how-to-automate-cleaning-company" articles={allArticles} />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
