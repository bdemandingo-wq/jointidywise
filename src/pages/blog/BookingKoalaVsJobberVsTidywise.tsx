import { Link } from "react-router-dom";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { Button } from "@/components/ui/button";
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  Check,
  X,
  ArrowRight,
  DollarSign
} from "lucide-react";

const features = [
  { name: "Online Booking Form", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Smart Scheduling & Auto-Assignment", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Staff Mobile App", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Client Portal (Self-Service)", tidywise: true, bookingKoala: false, jobber: "Add-on" },
  { name: "GPS Check-ins & Route Optimization", tidywise: true, bookingKoala: true, jobber: "Add-on $$$" },
  { name: "SMS Notifications", tidywise: true, bookingKoala: "Add-on", jobber: "Add-on" },
  { name: "Invoicing & Auto-Reminders", tidywise: true, bookingKoala: true, jobber: true },
  { name: "Drag & Drop Scheduler", tidywise: true, bookingKoala: false, jobber: true },
  { name: "Payroll Management", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Expense Tracking", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Task Management", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Automated Email Campaigns", tidywise: true, bookingKoala: "Premium", jobber: false },
  { name: "Client Feedback Collection", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Automation Center (Workflows)", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Tip & Deposit Collection", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Referral Program", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Automated Quote Follow-ups", tidywise: true, bookingKoala: "Premium", jobber: true },
  { name: "P&L Reports & Revenue Forecasting", tidywise: true, bookingKoala: false, jobber: false },
  { name: "AI Business Intelligence", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Inventory Tracking", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Operations Tracker", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Demo/Test Mode", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Offline Mode", tidywise: true, bookingKoala: false, jobber: false },
  { name: "In-App SMS Inbox", tidywise: true, bookingKoala: false, jobber: false },
  { name: "Home Condition Pricing", tidywise: true, bookingKoala: false, jobber: false },
];

export default function BookingKoalaVsJobberVsTidywise() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article" 
        title="Booking Koala vs Jobber vs TIDYWISE (2026)"
        description="Side-by-side comparison of Booking Koala, Jobber, and TIDYWISE. Pricing, features, and support for cleaning businesses."
        canonical="/blog/booking-koala-vs-jobber-vs-tidywise"
        ogImage="/images/tidywise-og.png"
        schemaJson={{
          "@type": "Article",
          "headline": "Booking Koala vs Jobber vs TIDYWISE: 2026 Comparison",
          "datePublished": "2026-01-10",
          "dateModified": "2026-03-01",
          "author": { "@type": "Organization", "name": "TIDYWISE" },
          "publisher": { "@type": "Organization", "name": "TIDYWISE", "url": "https://www.jointidywise.com", "logo": { "@type": "ImageObject", "url": "https://www.jointidywise.com/images/tidywise-logo.png" } },
          "mainEntityOfPage": { "@type": "WebPage", "@id": "https://www.jointidywise.com/blog/booking-koala-vs-jobber-vs-tidywise" }
        }}
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'Booking Koala vs Jobber vs TIDYWISE (2026)', path: '/blog/booking-koala-vs-jobber-vs-tidywise' }]} />
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
            to="/blog" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Blog
          </Link>

          {/* Header */}
          <header className="mb-12">
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full font-medium">
                Software Comparison
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                10 min read
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                January 2026
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6">
              Booking Koala vs Jobber vs TIDYWISE: Which Cleaning Business Software Is Best in 2026?
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Choosing the right <strong>cleaning business software</strong> can make or break your maid service. We compare Booking Koala, Jobber, and TIDYWISE on price, features, and ease of use to help you decide.
            </p>
          </header>

          {/* Quick Verdict */}
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-6 mb-12">
            <h2 className="text-xl font-bold text-foreground mb-3">🏆 Quick Verdict</h2>
            <p className="text-muted-foreground mb-4">
              <strong>TIDYWISE wins</strong> for cleaning businesses looking for the best value. At $49/month (vs $197-$349 for competitors), you get more features including P&L reports, inventory tracking, and offline mode—features neither Booking Koala nor Jobber offer.
            </p>
            <Button asChild>
              <Link to="/auth">See TIDYWISE Plans <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>

          {/* Pricing Comparison */}
          <section className="mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-primary" />
              Pricing Comparison: Who Offers the Best Value?
            </h2>
            
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="bg-primary text-primary-foreground rounded-xl p-6">
                <h3 className="text-xl font-bold mb-2">TIDYWISE</h3>
                <p className="text-4xl font-bold mb-2">$49<span className="text-lg">/mo</span></p>
                <p className="text-primary-foreground/80 text-sm">from $49/mo trial</p>
                <p className="text-primary-foreground/80 text-sm mt-2">All features included</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="text-xl font-bold text-foreground mb-2">Booking Koala</h3>
                <p className="text-4xl font-bold text-foreground mb-2">$197<span className="text-lg">/mo</span></p>
                <p className="text-muted-foreground text-sm">14-day trial</p>
                <p className="text-destructive text-sm mt-2">SMS & some features extra</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="text-xl font-bold text-foreground mb-2">Jobber</h3>
                <p className="text-4xl font-bold text-foreground mb-2">$349<span className="text-lg">/mo</span></p>
                <p className="text-muted-foreground text-sm">14-day trial</p>
                <p className="text-destructive text-sm mt-2">GPS, SMS are add-ons</p>
              </div>
            </div>

            <p className="text-muted-foreground">
              <strong>Annual savings with TIDYWISE:</strong> Compared to Booking Koala, you save $1,764/year. Compared to Jobber, you save $3,588/year—enough to hire another part-time cleaner.
            </p>
          </section>

          {/* Feature Comparison Table */}
          <section className="mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
              Feature-by-Feature Comparison
            </h2>
            
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-4 font-medium text-foreground">Feature</th>
                    <th className="text-center p-4 font-medium text-primary">TIDYWISE</th>
                    <th className="text-center p-4 font-medium text-foreground">Booking Koala</th>
                    <th className="text-center p-4 font-medium text-foreground">Jobber</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {features.map((feature, index) => (
                    <tr key={feature.name} className={index % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="p-4 text-sm text-foreground">{feature.name}</td>
                      <td className="p-4 text-center">
                        {feature.tidywise === true ? (
                          <Check className="h-5 w-5 text-success mx-auto" />
                        ) : (
                          <X className="h-5 w-5 text-destructive/60 mx-auto" />
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {feature.bookingKoala === true ? (
                          <Check className="h-5 w-5 text-success mx-auto" />
                        ) : feature.bookingKoala === false ? (
                          <X className="h-5 w-5 text-destructive/60 mx-auto" />
                        ) : (
                          <span className="text-xs text-warning font-medium">{feature.bookingKoala}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {feature.jobber === true ? (
                          <Check className="h-5 w-5 text-success mx-auto" />
                        ) : feature.jobber === false ? (
                          <X className="h-5 w-5 text-destructive/60 mx-auto" />
                        ) : (
                          <span className="text-xs text-warning font-medium">{feature.jobber}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detailed Analysis */}
          <section className="mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
              Who Should Use Each Platform?
            </h2>
            
            <div className="space-y-6">
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">Choose TIDYWISE if...</h3>
                <ul className="space-y-2 text-muted-foreground">
                  <li>• You want the <strong>best value</strong> with all features included</li>
                  <li>• You need <strong>P&L reports and revenue forecasting</strong></li>
                  <li>• Your cleaners work in <strong>areas with poor cell coverage</strong> (offline mode)</li>
                  <li>• You're a <strong>cleaning business owner</strong> looking for software built specifically for your industry</li>
                </ul>
              </div>
              
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">Choose Booking Koala if...</h3>
                <ul className="space-y-2 text-muted-foreground">
                  <li>• You have budget for $197+/month</li>
                  <li>• You need extensive white-label website options</li>
                  <li>• You run multiple service businesses (not just cleaning)</li>
                </ul>
              </div>
              
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">Choose Jobber if...</h3>
                <ul className="space-y-2 text-muted-foreground">
                  <li>• You're a large field service company (HVAC, plumbing, etc.)</li>
                  <li>• Enterprise-level features matter more than price</li>
                  <li>• You already use Jobber ecosystem tools</li>
                </ul>
              </div>
            </div>
          </section>

          {/* CTA */}
          <div className="bg-gradient-to-r from-primary/20 to-accent/20 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Ready to try the best cleaning business software?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              Try TIDYWISE for your cleaning business. Start free — 30 days of Pro, no card.
            </p>
            <Button size="lg" asChild>
              <Link to="/auth">Get started <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </article>

      {/* Related Articles */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-4xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="/blog/booking-koala-vs-jobber-vs-tidywise" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-4xl mx-auto text-center text-sm text-muted-foreground">
          © 2026 TIDYWISE. A cleaning business software alternative to Booking Koala & Jobber.
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
