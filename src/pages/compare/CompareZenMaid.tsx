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
  Clock,
  Zap,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const comparisonData = [
  { feature: "Monthly Pricing", tidywise: "$49/month", zenmaid: "$23–$100/month", winner: "tie" },
  { feature: "Online Booking", tidywise: true, zenmaid: true, winner: "tie" },
  { feature: "Smart Scheduling", tidywise: true, zenmaid: true, winner: "tie" },
  { feature: "GPS Check-ins", tidywise: true, zenmaid: true, winner: "tie" },
  { feature: "Automated Payroll", tidywise: true, zenmaid: false, winner: "tidywise" },
  { feature: "P&L Reports", tidywise: true, zenmaid: false, winner: "tidywise" },
  { feature: "Demo/Test Mode", tidywise: true, zenmaid: false, winner: "tidywise" },
  { feature: "AI Revenue Tools", tidywise: true, zenmaid: false, winner: "tidywise" },
  { feature: "Inventory Tracking", tidywise: true, zenmaid: false, winner: "tidywise" },
  { feature: "In-App SMS Inbox", tidywise: true, zenmaid: false, winner: "tidywise" },
  { feature: "Loyalty Programs", tidywise: true, zenmaid: false, winner: "tidywise" },
  { feature: "Review Requests", tidywise: true, zenmaid: true, winner: "tie" },
  { feature: "Square Footage Pricing", tidywise: true, zenmaid: true, winner: "tie" },
  { feature: "Unlimited Bookings", tidywise: true, zenmaid: "Volume-based pricing", winner: "tidywise" },
];

const testimonials = [
  {
    quote: "ZenMaid is fine for basic scheduling but we outgrew it fast. TidyWise handles payroll automatically — that alone saves us 4 hours every Friday.",
    author: "Michelle D.",
    role: "Diamond Clean Services",
    rating: 5
  },
  {
    quote: "Switched from ZenMaid after 2 years. TidyWise's P&L reports finally showed me which jobs were actually profitable.",
    author: "Carlos R.",
    role: "ProClean Miami",
    rating: 5
  },
  {
    quote: "ZenMaid gets more expensive as you grow. TidyWise is flat rate — our cost didn't change when we added 3 more cleaners.",
    author: "Patricia L.",
    role: "Spotless Homes",
    rating: 5
  },
];

export default function CompareZenMaid() {
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
        title="TidyWise vs ZenMaid 2026: Better Cleaning Software?"
        description="Compare TidyWise and ZenMaid on pricing, scheduling, CRM, payroll, and mobile app polish. See which one your team will actually use daily."
        canonical="/compare/zenmaid"
        ogImage="/images/tidywise-og.png"
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Compare", path: "/#compare" }, { name: 'TidyWise vs ZenMaid 2026: Better Cleaning Software?', path: '/compare/zenmaid' }]} />
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
              TIDYWISE vs ZenMaid
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Both are cleaning-specific platforms. TIDYWISE adds automated payroll, P&L reporting, AI tools, and inventory tracking — at a flat rate that doesn't scale with booking volume.
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
                {["$49/month — doesn't increase with bookings", "Automated payroll built-in", "P&L reporting and profit per job", "AI revenue and pricing tools", "Inventory tracking", "30 days of Pro, no card"].map(p => (
                  <li key={p} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-muted/30 border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                  <span className="text-foreground text-sm font-bold">Z</span>
                </div>
                <span className="font-bold text-foreground text-lg">ZenMaid</span>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {["$23–$100/month, scales with booking volume", "No automated payroll", "Basic reporting (no P&L)", "No AI tools", "No inventory tracking", "30-day money-back guarantee"].map(p => (
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
                    <th className="text-left px-5 py-3 font-semibold text-foreground">Plan</th>
                    <th className="text-center px-5 py-3 font-semibold text-primary">TIDYWISE</th>
                    <th className="text-center px-5 py-3 font-semibold text-foreground">ZenMaid</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { plan: "Starter", tw: "Plans from $49/mo", zm: "$23/month" },
                    { plan: "Growing business", tw: "$49/month", zm: "$49/month (up to 75 bookings)" },
                    { plan: "Scaling business", tw: "$49/month", zm: "$100/month (up to 200 bookings)" },
                    { plan: "Payroll included", tw: "Yes", zm: "No" },
                    { plan: "P&L reporting", tw: "Yes", zm: "No" },
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-5 py-3 text-muted-foreground">{row.plan}</td>
                      <td className="px-5 py-3 text-center font-semibold text-primary">{row.tw}</td>
                      <td className="px-5 py-3 text-center text-muted-foreground">{row.zm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground mt-3">ZenMaid's volume-based pricing means costs increase as your business grows. TIDYWISE stays flat.</p>
          </div>

          {/* Feature Comparison */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">Feature-by-Feature Comparison</h2>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-5 py-3 font-semibold text-foreground">Feature</th>
                    <th className="text-center px-5 py-3 font-semibold text-primary">TIDYWISE</th>
                    <th className="text-center px-5 py-3 font-semibold text-foreground">ZenMaid</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-5 py-3 text-muted-foreground">{row.feature}</td>
                      <td className="px-5 py-3 text-center">{renderValue(row.tidywise)}</td>
                      <td className="px-5 py-3 text-center">{renderValue(row.zenmaid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Key Differences */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">Where TIDYWISE Wins</h2>
            <div className="space-y-4">
              {[
                { icon: <Clock className="h-5 w-5 text-primary" />, title: "Automated payroll — ZenMaid doesn't have it", body: "TIDYWISE calculates cleaner wages from completed jobs automatically. ZenMaid requires you to calculate and run payroll manually or export to a third-party tool. For a business with 5+ cleaners, this is 3-4 hours saved every pay period." },
                { icon: <DollarSign className="h-5 w-5 text-primary" />, title: "P&L reporting — know which jobs make money", body: "ZenMaid provides basic revenue reports. TIDYWISE generates profit-and-loss statements by service type, showing which jobs and which clients are actually profitable — not just how much you billed." },
                { icon: <Zap className="h-5 w-5 text-primary" />, title: "Pricing that doesn't punish growth", body: "ZenMaid charges by booking volume, so your software costs increase as you grow. TIDYWISE is flat-rate — adding more bookings and more cleaners costs the same." },
              ].map((item, i) => (
                <div key={i} className="flex gap-4 p-5 bg-card rounded-xl border border-border">
                  <div className="flex-shrink-0 mt-0.5">{item.icon}</div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">{item.title}</h3>
                    <p className="text-muted-foreground text-sm">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Testimonials */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">What Owners Who Switched Say</h2>
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

          {/* When to choose which */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">When to Choose Each</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
                <h3 className="font-bold text-foreground mb-3">Choose TIDYWISE if:</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {["You want payroll handled automatically", "You need P&L reports to manage profitability", "You're scaling beyond 50 bookings/month", "You want AI tools for pricing and revenue", "You want flat-rate pricing as you grow"].map(p => (
                    <li key={p} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />{p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-muted/30 border border-border rounded-xl p-6">
                <h3 className="font-bold text-foreground mb-3">ZenMaid may work if:</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {["You're just starting out with very low volume", "You only need scheduling and basic invoicing", "You handle payroll separately outside the software", "You have under 25 bookings/month"].map(p => (
                    <li key={p} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />{p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-8 text-center">
            <h2 className="text-2xl font-bold text-foreground mb-3">See TIDYWISE Plans</h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">Cancel any time. Full access to scheduling, payroll, invoicing, GPS tracking, and P&L reports from day one.</p>
            <Button size="lg" onClick={handleStartFreeTrial}>Get started →</Button>
          </div>

          <div className="mt-16">
            <RelatedArticles currentSlug="/compare/zenmaid" articles={allArticles} />
          </div>
        </div>
      </div>
    </div>
  );
}
