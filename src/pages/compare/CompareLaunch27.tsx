import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import {
  CheckCircle2,
  XCircle,
  DollarSign,
  Clock,
  Zap,
  Smartphone,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const comparisonData = [
  { feature: "Monthly Pricing", tidywise: "$49/month", launch27: "$75–$299/month", winner: "tidywise" },
  { feature: "Online Booking", tidywise: true, launch27: true, winner: "tie" },
  { feature: "Smart Scheduling", tidywise: true, launch27: true, winner: "tie" },
  { feature: "GPS Check-ins", tidywise: true, launch27: false, winner: "tidywise" },
  { feature: "Automated Payroll", tidywise: true, launch27: "Pro plan only ($150/mo)", winner: "tidywise" },
  { feature: "P&L Reports", tidywise: true, launch27: false, winner: "tidywise" },
  { feature: "Mobile App", tidywise: true, launch27: "Plus plan only ($299/mo)", winner: "tidywise" },
  { feature: "AI Revenue Tools", tidywise: true, launch27: false, winner: "tidywise" },
  { feature: "Inventory Tracking", tidywise: true, launch27: false, winner: "tidywise" },
  { feature: "In-App SMS Inbox", tidywise: true, launch27: false, winner: "tidywise" },
  { feature: "Loyalty Programs", tidywise: true, launch27: false, winner: "tidywise" },
  { feature: "Review Requests", tidywise: true, launch27: "Pro plan only", winner: "tidywise" },
  { feature: "Gift Cards", tidywise: false, launch27: "Pro plan only", winner: "launch27" },
  { feature: "QuickBooks Integration", tidywise: false, launch27: "Pro plan only", winner: "launch27" },
  { feature: "Custom Booking Form Branding", tidywise: true, launch27: "Pro plan only", winner: "tidywise" },
];

export default function CompareLaunch27() {
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
        title="TidyWise vs Launch27 2026: Pricing & Feature Comparison"
        description="Launch27 starts at $75/mo and locks payroll behind $150/mo and its mobile app behind $299/mo. See how TidyWise compares at a flat $49/month."
        canonical="/compare/launch27"
        ogImage="/images/tidywise-og.png"
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Compare", path: "/#compare" }, { name: 'TidyWise vs Launch27 2026: Pricing & Feature Comparison', path: '/compare/launch27' }]} />
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
              Comparison · Updated July 2026
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              TIDYWISE vs Launch27
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Launch27 is an established booking platform for maid services, but its best features sit behind expensive tiers: payroll at $150/month, the mobile app at $299/month. TIDYWISE includes payroll, P&L reporting, a mobile app, and AI tools at one flat rate.
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
                {["$49/month — every feature included", "Automated payroll built-in", "Mobile app included at every tier", "P&L reporting and profit per job", "AI revenue and pricing tools", "30 days of Pro, no card"].map(p => (
                  <li key={p} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-muted/30 border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                  <span className="text-foreground text-sm font-bold">L</span>
                </div>
                <span className="font-bold text-foreground text-lg">Launch27</span>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {["$75–$299/month across three tiers", "Payroll only on Pro ($150/mo)", "Mobile app only on Plus ($299/mo)", "No P&L reporting", "No AI tools", "14-day trial"].map(p => (
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
                    <th className="text-center px-5 py-3 font-semibold text-foreground">Launch27</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { plan: "Entry plan", tw: "$49/month", l27: "Base — $75/month" },
                    { plan: "With payroll", tw: "$49/month (included)", l27: "Pro — $150/month" },
                    { plan: "With mobile app", tw: "$49/month (included)", l27: "Plus — $299/month" },
                    { plan: "Annual cost (full features)", tw: "$588/year", l27: "$3,049/year (Plus)" },
                    { plan: "P&L reporting", tw: "Yes", l27: "No" },
                  ].map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-5 py-3 text-muted-foreground">{row.plan}</td>
                      <td className="px-5 py-3 text-center font-semibold text-primary">{row.tw}</td>
                      <td className="px-5 py-3 text-center text-muted-foreground">{row.l27}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground mt-3">To match what TIDYWISE includes at $49/month, you'd need Launch27's Plus plan at $299/month — a difference of over $2,400 per year.</p>
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
                    <th className="text-center px-5 py-3 font-semibold text-foreground">Launch27</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                      <td className="px-5 py-3 text-muted-foreground">{row.feature}</td>
                      <td className="px-5 py-3 text-center">{renderValue(row.tidywise)}</td>
                      <td className="px-5 py-3 text-center">{renderValue(row.launch27)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground mt-3">Launch27 does offer gift cards and QuickBooks integration on its Pro plan — genuinely useful if those are must-haves for your business.</p>
          </div>

          {/* Key Differences */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">Where TIDYWISE Wins</h2>
            <div className="space-y-4">
              {[
                { icon: <DollarSign className="h-5 w-5 text-primary" />, title: "One price, everything included", body: "Launch27 splits its features across Base ($75), Pro ($150), and Plus ($299). Payroll requires Pro. The mobile app requires Plus. TIDYWISE includes payroll, mobile app, GPS check-ins, and P&L reports at $49/month — no tier ladder to climb as your needs grow." },
                { icon: <Clock className="h-5 w-5 text-primary" />, title: "P&L reporting Launch27 doesn't offer at any price", body: "Launch27's analytics track bookings and revenue. TIDYWISE generates profit-and-loss statements by service type and per job, so you know which clients and job types actually make money — not just how much you billed." },
                { icon: <Smartphone className="h-5 w-5 text-primary" />, title: "Mobile app without the $299/month toll", body: "Field teams live on their phones. Launch27 reserves its mobile app for the Plus tier at $299/month, and user reviews have flagged app reliability issues. TIDYWISE ships its app to every customer, with GPS check-ins included." },
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

          {/* When to choose which */}
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-6">When to Choose Each</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
                <h3 className="font-bold text-foreground mb-3">Choose TIDYWISE if:</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {["You want payroll and a mobile app without paying tier upgrades", "You need P&L reports to manage profitability", "Your cleaners need GPS check-ins in the field", "You want AI tools for pricing and revenue", "You want one flat price as you grow"].map(p => (
                    <li key={p} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />{p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-muted/30 border border-border rounded-xl p-6">
                <h3 className="font-bold text-foreground mb-3">Launch27 may work if:</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {["You only need online booking and scheduling", "QuickBooks integration is a hard requirement", "You sell gift cards as a core revenue stream", "You've already built your website around its booking widget"].map(p => (
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
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">Cancel any time. Full access to scheduling, payroll, invoicing, GPS tracking, and P&L reports from day one — no tier upgrades required.</p>
            <Button size="lg" onClick={handleStartFreeTrial}>Get started →</Button>
          </div>

          <div className="mt-16">
            <RelatedArticles currentSlug="/compare/launch27" articles={allArticles} />
          </div>
        </div>
      </div>
    </div>
  );
}
