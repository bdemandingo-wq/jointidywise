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
  Calendar,
  CreditCard,
  Users,
  Smartphone,
  BarChart3,
  Zap,
  Shield,
  Clock,
  DollarSign,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const comparisonData = [
  { feature: "Monthly Pricing", tidywise: "$49/month", jobber: "$69-$349/month", winner: "tidywise" },
  { feature: "Online Booking", tidywise: true, jobber: true, winner: "tie" },
  { feature: "Smart Scheduling", tidywise: true, jobber: true, winner: "tie" },
  { feature: "GPS Check-ins", tidywise: true, jobber: true, winner: "tie" },
  { feature: "Automated Payroll", tidywise: true, jobber: false, winner: "tidywise" },
  { feature: "P&L Reports", tidywise: true, jobber: false, winner: "tidywise" },
  { feature: "Demo/Test Mode", tidywise: true, jobber: false, winner: "tidywise" },
  { feature: "In-App SMS Inbox", tidywise: true, jobber: "Add-on", winner: "tidywise" },
  { feature: "AI Revenue Tools", tidywise: true, jobber: false, winner: "tidywise" },
  { feature: "Photo Documentation", tidywise: true, jobber: true, winner: "tie" },
  { feature: "Review Requests", tidywise: true, jobber: "Add-on", winner: "tidywise" },
  { feature: "Loyalty Programs", tidywise: true, jobber: false, winner: "tidywise" },
  { feature: "Multi-location", tidywise: true, jobber: "Higher tiers", winner: "tidywise" },
  { feature: "Inventory Tracking", tidywise: true, jobber: false, winner: "tidywise" },
];

const testimonials = [
  {
    quote: "Switched from Jobber and saved $200/month. TIDYWISE has everything we needed plus automated payroll.",
    author: "Marcus T.",
    role: "CleanPro Services",
    rating: 5
  },
  {
    quote: "Jobber's pricing kept going up. TIDYWISE is half the cost with more features for cleaning businesses.",
    author: "Lisa K.",
    role: "Sparkle Queens Cleaning",
    rating: 5
  },
  {
    quote: "The P&L reports alone made the switch worth it. Jobber never had that level of financial insight.",
    author: "David R.",
    role: "Fresh Start Maids",
    rating: 5
  },
];

export default function CompareJobber() {
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
        title="TidyWise vs Jobber 2026: Best Cleaning Business Software?"
        description="Compare TIDYWISE vs Jobber for cleaning businesses. Automated payroll, P&L reports, and $49/mo pricing vs Jobber's $69–$349/mo."
        canonical="/compare/jobber"
        ogImage="/images/tidywise-og.png"
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Compare", path: "/#compare" }, { name: 'TidyWise vs Jobber 2026: Best Cleaning Business Software?', path: '/compare/jobber' }]} />
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
            TIDYWISE vs Jobber:<br/>
            <span className="text-primary">The Best Jobber Alternative</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Tired of Jobber's rising prices and limited cleaning features? TIDYWISE offers <strong>automated payroll, P&L reports, and loyalty programs</strong>—all for a flat $49/month. Compare the features and see why cleaning businesses are switching.
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
              <div className="text-3xl font-bold text-primary">50%</div>
              <p className="text-sm text-muted-foreground">Lower Cost</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">14 Days</div>
              <p className="text-sm text-muted-foreground">Free trial</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">10+</div>
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
            See exactly what you get with TIDYWISE vs Jobber. Green checkmarks mean included, red X means not available.
          </p>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-secondary/50">
                    <th className="text-left p-4 font-semibold text-foreground">Feature</th>
                    <th className="text-center p-4 font-semibold text-primary">TIDYWISE</th>
                    <th className="text-center p-4 font-semibold text-muted-foreground">Jobber</th>
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
                        {renderValue(row.jobber)}
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
            Why Cleaning Businesses Switch from Jobber
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card rounded-xl p-6 border border-border">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Save $200+/Month</h3>
              <p className="text-muted-foreground">
                Jobber's Grow plan costs $349/month. TIDYWISE gives you more features for just $49/month.
              </p>
            </div>

            <div className="bg-card rounded-xl p-6 border border-border">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Real P&L Reports</h3>
              <p className="text-muted-foreground">
                Jobber doesn't offer profit & loss tracking. TIDYWISE shows you exactly where your money goes.
              </p>
            </div>

            <div className="bg-card rounded-xl p-6 border border-border">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Automated Payroll</h3>
              <p className="text-muted-foreground">
                Stop calculating pay manually. TIDYWISE auto-calculates cleaner wages from GPS check-ins.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            What Jobber Switchers Say
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
            Ready to Switch from Jobber?
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Start free — 30 days of Pro, no card. Cancel any time. Import your Jobber data in minutes.
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
            currentSlug="/compare/jobber" 
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">
            © 2026 TIDYWISE. A Jobber alternative for cleaning businesses.
          </p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/compare/booking-koala" className="text-muted-foreground hover:text-foreground">vs Booking Koala</Link>
            <Link to="/compare/housecall-pro" className="text-muted-foreground hover:text-foreground">vs Housecall Pro</Link>
            <Link to="/features/scheduling-software" className="text-muted-foreground hover:text-foreground">Scheduling</Link>
            <Link to="/features/invoicing-software" className="text-muted-foreground hover:text-foreground">Invoicing</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
      </footer>

      {/* Schema Markup */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{
        __html: JSON.stringify({
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
          "description": "The best Jobber alternative for cleaning businesses. Automated payroll, P&L reports, and flat $49/month pricing."
        })
      }} />
    </div>
  );
}
