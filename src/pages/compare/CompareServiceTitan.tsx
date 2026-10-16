import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import {
  CheckCircle2,
  XCircle,
  Star,
  DollarSign,
  Zap,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const comparisonData = [
  { feature: "Setup Time", tidywise: "Hours", servicetitan: "Weeks to months", winner: "tidywise" },
  { feature: "Cleaning-Specific Features", tidywise: true, servicetitan: false, winner: "tidywise" },
  { feature: "Online Booking", tidywise: true, servicetitan: true, winner: "tie" },
  { feature: "Smart Scheduling", tidywise: true, servicetitan: true, winner: "tie" },
  { feature: "GPS Tracking", tidywise: true, servicetitan: true, winner: "tie" },
  { feature: "Automated Payroll", tidywise: true, servicetitan: "Add-on cost", winner: "tidywise" },
  { feature: "P&L Reports", tidywise: true, servicetitan: true, winner: "tie" },
  { feature: "Square Footage Pricing", tidywise: true, servicetitan: false, winner: "tidywise" },
  { feature: "Small Business Friendly", tidywise: true, servicetitan: false, winner: "tidywise" },
  { feature: "No Per-User Fees", tidywise: true, servicetitan: false, winner: "tidywise" },
  { feature: "Inventory Tracking", tidywise: true, servicetitan: true, winner: "tie" },
  { feature: "Loyalty Programs", tidywise: true, servicetitan: false, winner: "tidywise" },
];

const testimonials = [
  {
    quote: "TidyWise Basic is $49/month for my whole team. Payroll and GPS are on Pro at $97/month.",
    author: "Kevin T.",
    role: "Clean & Bright Services",
    rating: 5
  },
  {
    quote: "ServiceTitan took 6 weeks to implement. TidyWise was running the same day. They're in different categories — one is for enterprise HVAC companies, the other is built for cleaning.",
    author: "Sandra M.",
    role: "Maid to Perfection",
    rating: 5
  },
  {
    quote: "ServiceTitan is overkill for a cleaning business. You pay for features you'll never use and spend months getting it set up. TidyWise got us operational in an afternoon.",
    author: "David W.",
    role: "Sparkle Home Cleaning",
    rating: 5
  },
];

export default function CompareServiceTitan() {
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
        title="TIDYWISE vs ServiceTitan for Cleaning Businesses (2026)"
        description="ServiceTitan targets large home-service companies. See where TidyWise fits cleaning businesses better at a fraction of the cost."
        canonical="/compare/servicetitan"
        ogImage="/images/tidywise-og.png"
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Compare", path: "/#compare" }, { name: 'TIDYWISE vs ServiceTitan for Cleaning Businesses', path: '/compare/servicetitan' }]} />
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="font-bold text-xl text-foreground">TIDYWISE</a>
            <div className="hidden md:flex items-center gap-8">
              <a href="/blog" className="text-muted-foreground hover:text-foreground">Blog</a>
              <a href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</a>
              <Button variant="ghost" onClick={() => navigate("/login")}>Log In</Button>
              <Button onClick={handleStartFreeTrial}>Get started</Button>
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
                <Button variant="ghost" onClick={() => navigate("/login")} className="flex-1">Log In</Button>
                <Button onClick={handleStartFreeTrial} className="flex-1">Get started</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="pt-28 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">

          {/* Hero */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-6">
              Comparison · Updated April 2026
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              TIDYWISE vs ServiceTitan for Cleaning Businesses
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              ServiceTitan is enterprise software built for HVAC and plumbing companies. TIDYWISE is built specifically for cleaning businesses. The difference matters more than any feature list.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
              <Button size="lg" onClick={handleStartFreeTrial}>
                Get started with TIDYWISE <Zap className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/pricing">See Pricing</Link>
              </Button>
            </div>
          </div>

          {/* Quick Summary */}
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                  <span className="text-primary-foreground text-sm font-bold">T</span>
                </div>
                <span className="font-bold text-foreground text-lg">TIDYWISE</span>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {["Basic is $49/mo — all users included", "Built specifically for cleaning businesses", "Operational in hours, not weeks", "30 days of Pro, no card", "Square footage and room-based pricing", "Automated payroll on Pro at $97/mo"].map(p => (
                  <li key={p} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-muted/30 border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                  <span className="text-foreground text-sm font-bold">S</span>
                </div>
                <span className="font-bold text-foreground text-lg">ServiceTitan</span>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {["Built for HVAC, plumbing, and electrical", "Implementation takes weeks to months", "No self-serve trial — demo only", "No cleaning-specific pricing features", "Payroll is a separate product"].map(p => (
                  <li key={p} className="flex items-start gap-2">
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Pricing Comparison */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
              <DollarSign className="h-6 w-6 text-primary" /> Pricing Comparison
            </h2>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-5 py-3 font-semibold text-foreground"></th>
                    <th className="text-center px-5 py-3 font-semibold text-primary">TIDYWISE</th>
                    <th className="text-center px-5 py-3 font-semibold text-foreground">ServiceTitan</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Starting price", tw: "$49/mo", st: "—" },
                    { label: "5-user team", tw: "$49/mo", st: "—" },
                    { label: "10-user team", tw: "$49/mo", st: "—" },
                    { label: "Setup cost", tw: "$0", st: "Implementation fee" },
                    { label: "Annual contract required", tw: "No", st: "Typically yes" },
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-5 py-3 text-muted-foreground">{row.label}</td>
                      <td className="px-5 py-3 text-center font-semibold text-primary">{row.tw}</td>
                      <td className="px-5 py-3 text-center text-muted-foreground">{row.st}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground mt-3">ServiceTitan pricing requires a sales call and varies by contract. The figures above reflect typical small business rates.</p>
          </div>

          {/* Feature Comparison */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">Feature Comparison</h2>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-5 py-3 font-semibold text-foreground">Feature</th>
                    <th className="text-center px-5 py-3 font-semibold text-primary">TIDYWISE</th>
                    <th className="text-center px-5 py-3 font-semibold text-foreground">ServiceTitan</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-5 py-3 text-muted-foreground">{row.feature}</td>
                      <td className="px-5 py-3 text-center">{renderValue(row.tidywise)}</td>
                      <td className="px-5 py-3 text-center">{renderValue(row.servicetitan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* The Core Difference */}
          <div className="mb-12 bg-muted/30 rounded-xl border border-border p-6">
            <h2 className="text-xl font-bold text-foreground mb-3">The Core Difference: Built For vs. Adapted For</h2>
            <p className="text-muted-foreground text-sm mb-3">
              ServiceTitan is one of the most powerful field service platforms in existence. It's also designed for companies running HVAC, plumbing, and electrical operations — businesses where a single job might run $5,000 and requires complex parts, permits, and multi-day scheduling.
            </p>
            <p className="text-muted-foreground text-sm mb-3">
              Cleaning businesses have fundamentally different needs: high-volume recurring jobs, square footage pricing, cleaner payroll calculations, and maid-specific booking flows. These are not what ServiceTitan optimizes for.
            </p>
            <p className="text-muted-foreground text-sm">
              A cleaning business using ServiceTitan pays enterprise pricing for a tool that requires workarounds for core cleaning workflows. TIDYWISE handles those workflows natively, at a fraction of the cost.
            </p>
          </div>

          {/* Testimonials */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">What Cleaning Business Owners Say</h2>
            <div className="grid md:grid-cols-3 gap-4">
              {testimonials.map((t, i) => (
                <div key={i} className="bg-card rounded-xl border border-border p-5">
                  <div className="flex gap-1 mb-3">
                    {[...Array(t.rating)].map((_, j) => <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />)}
                  </div>
                  <p className="text-muted-foreground text-sm mb-4">"{t.quote}"</p>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{t.author}</p>
                    <p className="text-muted-foreground text-xs">{t.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-3">TIDYWISE — Built for Cleaning Businesses</h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">Plans start at $49/mo. Cancel any time, no implementation fee, no per-user pricing. Running in hours, not weeks.</p>
            <Button size="lg" onClick={handleStartFreeTrial}>Get started →</Button>
          </div>

          <div className="mt-16">
            <RelatedArticles currentSlug="/compare/servicetitan" articles={allArticles} />
          </div>
        </div>
      </div>
    </div>
  );
}
