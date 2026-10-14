import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { ArrowRight, ArrowLeft, TrendingUp, Menu, X } from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

export default function GrowCleaningBusiness2025() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article"
        title="How to Grow Your Cleaning Business in 2025"
        description="Proven strategies to grow your cleaning business in 2025. From marketing tips to software automation, learn how to scale your maid service profitably."
        canonical="/blog/how-to-grow-cleaning-business-2025"
        ogImage="/images/tidywise-og.png"
        schemaJson={{
          "@type": "BlogPosting",
          "headline": "How to Grow Your Cleaning Business in 2025",
          "description": "Proven strategies to grow your cleaning business in 2025.",
          "datePublished": "2025-12-15",
          "author": { "@type": "Organization", "name": "TidyWise" },
        }}
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'How to Grow Your Cleaning Business in 2025', path: '/blog/how-to-grow-cleaning-business-2025' }]} />
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
            <span className="bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">Business Growth</span>
            <span>· 10 min read</span>
            <span>· December 2025</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">How to Grow Your Cleaning Business in 2025</h1>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p className="text-muted-foreground text-lg">Growing a cleaning business takes more than word-of-mouth referrals. In 2025, the most successful cleaning companies combine great service with smart technology and targeted marketing. Here's your complete growth playbook.</p>

            <h2 className="text-2xl font-bold mt-8">1. Invest in Online Booking Software</h2>
            <p className="text-muted-foreground">Clients expect to book online. If you're still taking bookings over the phone, you're losing customers to competitors with 24/7 online booking. A tool like <strong>TidyWise</strong> lets clients book, reschedule, and manage appointments without calling you.</p>

            <h2 className="text-2xl font-bold mt-8">2. Automate Your Follow-Ups</h2>
            <p className="text-muted-foreground">Most cleaning businesses lose 30-40% of leads because they don't follow up fast enough. Set up automated email and SMS sequences that reach out within minutes of an inquiry. Cleaning business CRM software handles this automatically.</p>

            <h2 className="text-2xl font-bold mt-8">3. Build a Referral Program</h2>
            <p className="text-muted-foreground">Your happiest clients are your best marketing channel. Create a structured referral program that rewards clients for sending friends your way. Even a simple $25 credit for each referral can double your organic growth.</p>

            <h2 className="text-2xl font-bold mt-8">4. Optimize for Local SEO</h2>
            <p className="text-muted-foreground">Claim and optimize your Google Business Profile. Collect reviews after every job (automate this with your scheduling software). Target keywords like "cleaning service near me" and "house cleaning [your city]."</p>

            <h2 className="text-2xl font-bold mt-8">5. Systemize Your Operations</h2>
            <p className="text-muted-foreground">Growth stalls when you can't delegate. Document your cleaning checklists, pricing, and communication templates. Use cleaning business scheduling software to assign jobs, track team performance, and manage payroll without micromanaging.</p>

            <h2 className="text-2xl font-bold mt-8">6. Offer Recurring Service Plans</h2>
            <p className="text-muted-foreground">One-time cleanings are feast or famine. Push clients toward weekly, biweekly, or monthly plans with a small discount. Recurring revenue creates predictability and makes your business more valuable.</p>

            <h2 className="text-2xl font-bold mt-8">7. Track Your Numbers</h2>
            <p className="text-muted-foreground">You can't grow what you don't measure. Track revenue per client, average job value, customer retention rate, and profit margins. The right cleaning business software gives you a dashboard with these metrics built in.</p>

            <div className="bg-primary/5 rounded-xl p-6 mt-8 border border-primary/20">
              <h3 className="text-xl font-bold text-foreground mb-2">Ready to Grow Your Cleaning Business?</h3>
              <p className="text-muted-foreground mb-4">TidyWise gives you booking, scheduling, CRM, invoicing, and automation in one platform. Plans start at $49/mo.</p>
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
          <RelatedArticles currentSlug="how-to-grow-cleaning-business-2025" articles={allArticles} />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
