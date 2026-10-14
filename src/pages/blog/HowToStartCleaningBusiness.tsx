import { Link } from "react-router-dom";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { Button } from "@/components/ui/button";
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  DollarSign, 
  Target,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  MessageSquare,
  Package
} from "lucide-react";

export default function HowToStartCleaningBusiness() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article" 
        title="How to Start a Cleaning Business (2026)"
        description="Step-by-step guide to starting a cleaning business. Covers payroll, scheduling, inventory management, pricing, and lead generation for maid services."
        canonical="/blog/how-to-start-a-cleaning-business"
        ogImage="/images/tidywise-og.png"
        schemaJson={{
          "@type": "Article",
          "headline": "How to Start a Cleaning Business in 2026",
          "datePublished": "2026-01-15",
          "dateModified": "2026-03-01",
          "author": { "@type": "Organization", "name": "TIDYWISE" },
          "publisher": { "@type": "Organization", "name": "TIDYWISE", "url": "https://www.jointidywise.com", "logo": { "@type": "ImageObject", "url": "https://www.jointidywise.com/images/tidywise-logo.png" } },
          "mainEntityOfPage": { "@type": "WebPage", "@id": "https://www.jointidywise.com/blog/how-to-start-a-cleaning-business" }
        }}
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'How to Start a Cleaning Business (2026)', path: '/blog/how-to-start-a-cleaning-business' }]} />
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <span className="font-bold text-xl text-foreground">TIDYWISE</span>
            </Link>
            <Button asChild>
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Article */}
      <article className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Breadcrumb */}
          <Link 
            to="/#blog" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Resources
          </Link>

          {/* Header */}
          <header className="mb-12">
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full font-medium">
                Business Guide
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                15 min read
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                January 2026
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6">
              The Ultimate Guide on How to Start a Cleaning Business in 2026
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Starting a cleaning business has never been more accessible. With the right tools—like <strong>automated payroll software for maid services</strong>, a <strong>cleaning business inventory management tool</strong>, and <strong>real-time messenger for cleaning teams</strong>—you can compete with established companies from day one.
            </p>
          </header>

          {/* Table of Contents */}
          <nav className="bg-secondary/50 rounded-xl p-6 mb-12 border border-border">
            <h2 className="text-lg font-semibold text-foreground mb-4">In This Guide</h2>
            <ul className="space-y-2">
              <li>
                <a href="#getting-started" className="text-primary hover:underline flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Getting Started: Business Fundamentals
                </a>
              </li>
              <li>
                <a href="#scheduling" className="text-primary hover:underline flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  How to Manage a Cleaning Schedule
                </a>
              </li>
              <li>
                <a href="#payroll" className="text-primary hover:underline flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  How to Handle Staff Payroll
                </a>
              </li>
              <li>
                <a href="#leads" className="text-primary hover:underline flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  How to Track Client Leads
                </a>
              </li>
              <li>
                <a href="#inventory" className="text-primary hover:underline flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Cleaning Business Inventory Management
                </a>
              </li>
              <li>
                <a href="#communication" className="text-primary hover:underline flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Real-Time Team Communication
                </a>
              </li>
            </ul>
          </nav>

          {/* Content */}
          <div className="prose prose-lg max-w-none dark:prose-invert">
            
            {/* Section: Getting Started */}
            <section id="getting-started" className="mb-16 scroll-mt-24">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Sparkles className="h-8 w-8 text-primary" />
                Getting Started: Business Fundamentals
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                The cleaning industry is booming, with the residential cleaning market expected to reach $40 billion by 2027. Whether you're starting a solo operation or building a team, success comes down to three things: <strong>efficient operations</strong>, <strong>happy customers</strong>, and <strong>motivated staff</strong>.
              </p>
              <div className="bg-card border border-border rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">Essential Steps to Launch</h3>
                <ul className="space-y-3">
                  {[
                    "Register your business and obtain necessary licenses",
                    "Set up liability insurance (typically $1-2M coverage)",
                    "Define your services and pricing structure",
                    "Create a professional online presence",
                    "Invest in management software from day one"
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                      <span className="text-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Many new cleaning business owners make the mistake of waiting until they're "big enough" to invest in professional tools. But using the right software from the start—rather than spreadsheets and paper—sets you up for scalable growth.
              </p>
            </section>

            {/* Section: Scheduling */}
            <section id="scheduling" className="mb-16 scroll-mt-24">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Calendar className="h-8 w-8 text-primary" />
                How to Manage a Cleaning Schedule
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Efficient scheduling is the backbone of any successful cleaning business. Poor scheduling leads to missed appointments, overworked staff, and unhappy customers. Here's how the pros do it:
              </p>
              
              <div className="grid md:grid-cols-2 gap-6 mb-8">
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">❌ Common Mistakes</h3>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Using paper calendars or basic spreadsheets</li>
                    <li>• Overbooking during peak times</li>
                    <li>• No buffer time between appointments</li>
                    <li>• Ignoring travel time between locations</li>
                  </ul>
                </div>
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">✅ Best Practices</h3>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Use smart scheduling software</li>
                    <li>• Group jobs by geographic area</li>
                    <li>• Allow 15-30 minute buffers</li>
                    <li>• Enable online booking for customers</li>
                  </ul>
                </div>
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">💡 Pro Tip</h3>
                <p className="text-muted-foreground mb-4">
                  TIDYWISE's <strong>Smart Scheduler</strong> automatically assigns cleaners based on location, skills, and availability—reducing travel time by up to 30%.
                </p>
                <Button asChild variant="outline">
                  <Link to="/auth">
                    Try the Scheduler <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </section>

            {/* Section: Payroll */}
            <section id="payroll" className="mb-16 scroll-mt-24">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <DollarSign className="h-8 w-8 text-primary" />
                How to Handle Staff Payroll
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Managing payroll for cleaning staff can be complex. Between hourly rates, per-job payments, tips, and contractor vs. employee classifications, there's a lot to track. That's where <strong>automated payroll software for maid services</strong> becomes essential.
              </p>

              <h3 className="text-xl font-semibold text-foreground mb-4">Payment Structure Options</h3>
              <div className="space-y-4 mb-8">
                {[
                  { type: "Hourly Rate", desc: "Best for training periods and variable-length jobs. Typical range: $15-25/hour" },
                  { type: "Per-Job Rate", desc: "Motivates efficiency. Usually 40-50% of the job price goes to the cleaner" },
                  { type: "Hybrid Model", desc: "Base hourly rate plus bonuses for completing jobs under estimated time" }
                ].map((item, i) => (
                  <div key={i} className="bg-card border border-border rounded-lg p-4">
                    <h4 className="font-semibold text-foreground">{item.type}</h4>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                ))}
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">💡 Pro Tip</h3>
                <p className="text-muted-foreground mb-4">
                  TIDYWISE's <strong>Payroll Tab</strong> automatically calculates wages based on check-in times, job rates, and tip distributions—saving hours of manual work each week.
                </p>
                <Button asChild variant="outline">
                  <Link to="/auth">
                    Explore Payroll Features <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="bg-warning/10 border border-warning/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">⚠️ Important: 1099 Contractors</h3>
                <p className="text-muted-foreground">
                  If you pay contractors more than $600/year, you'll need to issue 1099 forms. TIDYWISE tracks contractor earnings year-to-date and alerts you when filing is required.
                </p>
              </div>
            </section>

            {/* Section: Leads */}
            <section id="leads" className="mb-16 scroll-mt-24">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Target className="h-8 w-8 text-primary" />
                How to Track Client Leads
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Every inquiry is a potential customer. But without a system to track leads, follow-ups fall through the cracks. Studies show that responding to leads within 5 minutes makes you <strong>9x more likely</strong> to convert them.
              </p>

              <h3 className="text-xl font-semibold text-foreground mb-4">Lead Tracking Best Practices</h3>
              <ul className="space-y-3 mb-8">
                {[
                  "Capture leads from multiple sources (website, phone, referrals)",
                  "Assign leads to staff for immediate follow-up",
                  "Track lead status: New → Contacted → Quote Sent → Won/Lost",
                  "Analyze conversion rates by source to optimize marketing spend",
                  "Set up automated follow-up reminders"
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 mt-0.5" />
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">💡 Pro Tip</h3>
                <p className="text-muted-foreground mb-4">
                  TIDYWISE's <strong>Leads Section</strong> captures inquiries automatically from your booking form and tracks the entire customer journey—from first contact to first clean.
                </p>
                <Button asChild variant="outline">
                  <Link to="/auth">
                    See Lead Management <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </section>

            {/* Section: Inventory */}
            <section id="inventory" className="mb-16 scroll-mt-24">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Package className="h-8 w-8 text-primary" />
                Cleaning Business Inventory Management
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Running out of supplies mid-job is embarrassing and costly. A <strong>cleaning business inventory management tool</strong> helps you track stock levels, reorder at the right time, and understand your true supply costs.
              </p>

              <div className="bg-card border border-border rounded-xl p-6 mb-6">
                <h3 className="text-lg font-semibold text-foreground mb-4">What to Track</h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  {[
                    { category: "Cleaning Supplies", items: "Multi-surface cleaners, glass cleaner, disinfectants" },
                    { category: "Equipment", items: "Vacuums, mops, buckets, caddies" },
                    { category: "Disposables", items: "Gloves, trash bags, paper towels, rags" },
                    { category: "Specialty Items", items: "Floor polish, stain removers, upholstery cleaner" }
                  ].map((item, i) => (
                    <div key={i}>
                      <h4 className="font-semibold text-foreground text-sm">{item.category}</h4>
                      <p className="text-sm text-muted-foreground">{item.items}</p>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-muted-foreground leading-relaxed">
                Set minimum quantity alerts so you never run out. Track cost-per-unit to see which suppliers offer the best value. TIDYWISE's inventory system integrates with your job tracking, so you can see actual supply usage patterns.
              </p>
            </section>

            {/* Section: Communication */}
            <section id="communication" className="mb-16 scroll-mt-24">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <MessageSquare className="h-8 w-8 text-primary" />
                Real-Time Team Communication
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Miscommunication leads to missed appointments, wrong addresses, and frustrated customers. A <strong>real-time messenger for cleaning teams</strong> keeps everyone on the same page.
              </p>

              <div className="grid md:grid-cols-2 gap-6 mb-8">
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Key Features to Look For</h3>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Instant messaging between office and field staff</li>
                    <li>• Job-specific message threads</li>
                    <li>• Photo sharing for documentation</li>
                    <li>• Read receipts to confirm messages seen</li>
                    <li>• Push notifications for urgent updates</li>
                  </ul>
                </div>
                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">Benefits</h3>
                  <ul className="space-y-2 text-muted-foreground">
                    <li>• Reduce no-shows by 40%</li>
                    <li>• Faster response to customer requests</li>
                    <li>• Better team coordination</li>
                    <li>• Document proof of communication</li>
                    <li>• Happier, more informed staff</li>
                  </ul>
                </div>
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">💡 Pro Tip</h3>
                <p className="text-muted-foreground mb-4">
                  TIDYWISE includes an <strong>In-App SMS Inbox</strong> that syncs with OpenPhone, so all customer and team communications are in one place.
                </p>
                <Button asChild variant="outline">
                  <Link to="/auth">
                    Try Team Messaging <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </section>

            {/* Conclusion */}
            <section className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
                Ready to Start Your Cleaning Business?
              </h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Starting a cleaning business in 2026 is easier than ever—if you have the right tools. With TIDYWISE, you get everything you need in one platform: smart scheduling, <strong>automated payroll software for maid services</strong>, a <strong>cleaning business inventory management tool</strong>, lead tracking, and <strong>real-time messenger for cleaning teams</strong>.
              </p>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Stop piecing together multiple tools. Start with a platform built specifically for cleaning businesses.
              </p>
            </section>
          </div>

          {/* CTA */}
          <div className="bg-primary rounded-2xl p-8 sm:p-12 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-primary-foreground mb-4">
              Launch your cleaning business today
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-2xl mx-auto">
              Try TIDYWISE to manage bookings, staff, and customers—all in one place.
            </p>
            <Button size="lg" variant="secondary" asChild>
              <Link to="/auth">
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </article>

      {/* Related Articles */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-4xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="/blog/how-to-start-a-cleaning-business" />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto text-center text-sm text-muted-foreground">
          © <CopyrightYear /> TIDYWISE. All rights reserved.
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
