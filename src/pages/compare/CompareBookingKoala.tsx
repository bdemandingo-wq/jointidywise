import { safeJsonLd } from "@/lib/safeJsonLd";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  Star,
  Zap,
  Clock,
  DollarSign,
  BarChart3,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const comparisonData = [
  { feature: "Monthly Pricing", tidywise: "$49/month", bookingkoala: "$79-$379/month", winner: "tidywise" },
  { feature: "Online Booking", tidywise: true, bookingkoala: true, winner: "tie" },
  { feature: "Smart Scheduling", tidywise: true, bookingkoala: true, winner: "tie" },
  { feature: "GPS Check-ins", tidywise: true, bookingkoala: true, winner: "tie" },
  { feature: "Automated Payroll", tidywise: true, bookingkoala: "Manual", winner: "tidywise" },
  { feature: "P&L Reports", tidywise: true, bookingkoala: false, winner: "tidywise" },
  { feature: "Demo/Test Mode", tidywise: true, bookingkoala: false, winner: "tidywise" },
  { feature: "In-App SMS Inbox", tidywise: true, bookingkoala: "Extra cost", winner: "tidywise" },
  { feature: "AI Revenue Tools", tidywise: true, bookingkoala: false, winner: "tidywise" },
  { feature: "Photo Documentation", tidywise: true, bookingkoala: true, winner: "tie" },
  { feature: "Review Requests", tidywise: true, bookingkoala: true, winner: "tie" },
  { feature: "Loyalty Programs", tidywise: true, bookingkoala: false, winner: "tidywise" },
  { feature: "Revenue Forecasting", tidywise: true, bookingkoala: false, winner: "tidywise" },
  { feature: "Inventory Tracking", tidywise: true, bookingkoala: false, winner: "tidywise" },
];

const testimonials = [
  {
    quote: "BookingKoala was overpriced for what you get. TIDYWISE has better payroll features at a third of the cost.",
    author: "Amanda S.",
    role: "Pristine Clean Co.",
    rating: 5
  },
  {
    quote: "The P&L reports were the dealbreaker. BookingKoala couldn't show me my profit margins by service.",
    author: "James W.",
    role: "Elite Maid Services",
    rating: 5
  },
  {
    quote: "Migrating from BookingKoala was seamless. TIDYWISE support helped me import everything in an hour.",
    author: "Nicole P.",
    role: "Green Clean Atlanta",
    rating: 5
  },
];

export default function CompareBookingKoala() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  const renderValue = (value: boolean | string) => {
    if (value === true) return <CheckCircle2 className="h-5 w-5 text-success mx-auto" />;
    if (value === false) return <XCircle className="h-5 w-5 text-destructive mx-auto" />;
    return <span className="text-muted-foreground text-sm">{value}</span>;
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="TidyWise vs BookingKoala 2026: Which Wins for Cleaners?"
        description="Compare TIDYWISE vs BookingKoala for cleaning businesses. Payroll, P&L reports, and AI tools for $49/mo vs BookingKoala's $79–$379/mo."
        canonical="/compare/booking-koala"
        ogImage="/images/tidywise-og.png"
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Compare", path: "/#compare" }, { name: 'TidyWise vs BookingKoala 2026: Which Wins for Cleaners?', path: '/compare/booking-koala' }]} />
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="flex items-center gap-2">
              <span className="font-bold text-xl text-foreground">TIDYWISE</span>
            </a>
            <div className="hidden md:flex items-center gap-8">
              <a href="/#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="/blog" className="text-muted-foreground hover:text-foreground transition-colors">Blog</a>
              <Button variant="ghost" onClick={() => navigate("/auth")}>Log In</Button>
              <Button onClick={handleStartFreeTrial}>Get started</Button>
            </div>
            <button 
              aria-label="Toggle menu"
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-border">
              <div className="flex flex-col gap-4">
                <a href="/#features" className="text-muted-foreground hover:text-foreground">Features</a>
                <a href="/blog" className="text-muted-foreground hover:text-foreground">Blog</a>
                <Button variant="ghost" className="justify-start" onClick={() => navigate("/auth")}>Log In</Button>
                <Button onClick={handleStartFreeTrial}>Get started</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6">
            <Zap className="h-4 w-4" />
            2026 Comparison
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            TIDYWISE vs BookingKoala:<br/>
            <span className="text-primary">The Better Alternative</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Looking for a BookingKoala alternative? TIDYWISE offers <strong>automated payroll, P&L reports, and AI revenue tools</strong>—all for a flat $49/month vs BookingKoala's $79-$379/month.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="h-12 px-8" onClick={handleStartFreeTrial}>
              Get started <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8" onClick={() => document.getElementById('comparison')?.scrollIntoView({ behavior: 'smooth' })}>
              See Full Comparison
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-4">Plans from $49/mo · Cancel any time</p>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">65%</div>
              <p className="text-sm text-muted-foreground">Lower Cost</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">14 Days</div>
              <p className="text-sm text-muted-foreground">Free trial</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">12+</div>
              <p className="text-sm text-muted-foreground">Extra Features</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">4.9★</div>
              <p className="text-sm text-muted-foreground">User Rating</p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section id="comparison" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-4">
            Feature-by-Feature Comparison
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            Compare TIDYWISE vs BookingKoala feature by feature. See what's included vs what costs extra.
          </p>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-secondary/50">
                    <th className="text-left p-4 font-semibold text-foreground">Feature</th>
                    <th className="text-center p-4 font-semibold text-primary">TIDYWISE</th>
                    <th className="text-center p-4 font-semibold text-muted-foreground">BookingKoala</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map((row, i) => (
                    <tr key={row.feature} className={i % 2 === 0 ? "bg-background" : "bg-secondary/20"}>
                      <td className="p-4 text-foreground font-medium">{row.feature}</td>
                      <td className="p-4 text-center">
                        {renderValue(row.tidywise)}
                      </td>
                      <td className="p-4 text-center">
                        {renderValue(row.bookingkoala)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Button size="lg" onClick={handleStartFreeTrial}>
              Switch to TIDYWISE Today <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Why Switch Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            Why Switch from BookingKoala to TIDYWISE?
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card rounded-xl p-6 border border-border">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Save $300+/Month</h3>
              <p className="text-muted-foreground">
                BookingKoala Pro costs $379/month. TIDYWISE includes everything for just $49/month.
              </p>
            </div>

            <div className="bg-card rounded-xl p-6 border border-border">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Real Financial Insights</h3>
              <p className="text-muted-foreground">
                P&L reports, revenue forecasting, and profit margin analysis. Know your numbers.
              </p>
            </div>

            <div className="bg-card rounded-xl p-6 border border-border">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">True Automation</h3>
              <p className="text-muted-foreground">
                Automated payroll from GPS check-ins. No more spreadsheets or manual calculations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            What BookingKoala Switchers Say
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, i) => (
              <div key={i} className="bg-card rounded-xl p-6 border border-border">
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-foreground mb-4">"{testimonial.quote}"</p>
                <div>
                  <p className="font-semibold text-foreground">{testimonial.author}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
            Ready to Switch from BookingKoala?
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Start free — 30 days of Pro, no card. Cancel any time. We'll help you migrate.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Related Articles for Internal Linking */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <RelatedArticles 
            articles={allArticles} 
            currentSlug="/compare/booking-koala" 
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">
            © 2026 TIDYWISE. A Booking Koala alternative for cleaning businesses.
          </p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/compare/jobber" className="text-muted-foreground hover:text-foreground">vs Jobber</Link>
            <Link to="/compare/housecall-pro" className="text-muted-foreground hover:text-foreground">vs Housecall Pro</Link>
            <Link to="/features/scheduling-software" className="text-muted-foreground hover:text-foreground">Scheduling</Link>
            <Link to="/features/route-optimization" className="text-muted-foreground hover:text-foreground">Route Optimization</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
      </footer>

      {/* Schema Markup */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{
        __html: safeJsonLd({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "TIDYWISE",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, iOS, Android",
          "offers": {
            "@type": "Offer",
            "price": "50",
            "priceCurrency": "USD",
            "priceValidUntil": "2026-12-31"
          },
          "description": "The best BookingKoala alternative for cleaning businesses. Automated payroll, P&L reports, and flat $49/month pricing."
        })
      }} />
    </div>
  );
}
