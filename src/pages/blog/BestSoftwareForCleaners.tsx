import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { ArrowRight, ArrowLeft, Menu, X } from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';

export default function BestSoftwareForCleaners() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article"
        title="Best Software for Cleaning Business Owners (2025)"
        description="Compare the best cleaning business software in 2025. Scheduling, CRM, invoicing, and automation tools reviewed for maid services and janitorial companies."
        canonical="/blog/best-software-for-cleaning-business"
        ogImage="/images/tidywise-og.png"
        schemaJson={{
          "@type": "BlogPosting",
          "headline": "Best Software for Cleaning Business Owners",
          "description": "Compare the best cleaning business software in 2025.",
          "datePublished": "2025-11-20",
          "author": { "@type": "Organization", "name": "TidyWise" },
        }}
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'Best Software for Cleaning Business Owners (2025)', path: '/blog/best-software-for-cleaning-business' }]} />
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
            <span className="bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">Software Reviews</span>
            <span>· 12 min read</span>
            <span>· November 2025</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">Best Software for Cleaning Business Owners</h1>

          <div className="prose prose-lg max-w-none text-foreground space-y-6">
            <p className="text-muted-foreground text-lg">Choosing the right software can make or break your cleaning business. The best tools handle scheduling, client management, invoicing, and team coordination — so you can focus on cleaning, not paperwork. Here's our 2025 breakdown.</p>

            <h2 className="text-2xl font-bold mt-8">What to Look For in Cleaning Business Software</h2>
            <p className="text-muted-foreground">The ideal cleaning business software should offer: online booking, client CRM, team scheduling, automated notifications, invoicing, and reporting. Bonus points for mobile apps, payment processing, and a client portal.</p>

            <h2 className="text-2xl font-bold mt-8">1. TidyWise — Best All-in-One Platform</h2>
            <p className="text-muted-foreground">TidyWise is purpose-built for cleaning businesses with booking, scheduling, CRM, invoicing, SMS/email automation, a staff portal, client portal, and AI-powered business intelligence. Pricing starts at $49/month, and every new account begins with 30 days of Pro, no card.</p>
            <p className="text-muted-foreground"><strong>Best for:</strong> Growing cleaning businesses that want everything in one place without juggling multiple tools.</p>

            <h2 className="text-2xl font-bold mt-8">2. Jobber — Best for Field Service Variety</h2>
            <p className="text-muted-foreground">Jobber serves many home service industries. It has solid scheduling and invoicing but lacks cleaning-specific features like checklist management and cleaner portals. Starting at $69/month.</p>

            <h2 className="text-2xl font-bold mt-8">3. Booking Koala — Budget-Friendly Option</h2>
            <p className="text-muted-foreground">Good for solo cleaners just starting out. Offers basic booking and client management. However, it lacks team management, automation, and advanced reporting.</p>

            <h2 className="text-2xl font-bold mt-8">4. Housecall Pro — Best for Larger Teams</h2>
            <p className="text-muted-foreground">Strong dispatching and GPS tracking for larger operations. Higher price point ($65+/month) and less tailored to residential cleaning workflows.</p>

            <h2 className="text-2xl font-bold mt-8">How to Choose the Right Tool</h2>
            <p className="text-muted-foreground">Consider your team size, budget, and growth plans. Solo operators may start with simpler tools, but if you plan to scale, choose software that grows with you. Features like automated reminders, recurring booking, and a client portal will save you hours every week.</p>

            <div className="bg-primary/5 rounded-xl p-6 mt-8 border border-primary/20">
              <h3 className="text-xl font-bold text-foreground mb-2">Try TidyWise — Plans from $49/mo</h3>
              <p className="text-muted-foreground mb-4">All-in-one cleaning business software with booking, CRM, scheduling, invoicing, and automation. Cancel any time.</p>
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
          <RelatedArticles currentSlug="best-software-for-cleaning-business" articles={allArticles} />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
      </footer>
    </div>
  );
}
