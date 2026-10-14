import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import {
  ArrowRight,
  DollarSign,
  Clock,
  Users,
  CheckCircle2,
  FileText,
  Smartphone,
  Calculator,
  CreditCard,
  TrendingUp,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const benefits = [
  {
    icon: Calculator,
    title: "Automatic Wage Calculation",
    description: "Set flat per-job rates, hourly rates, or a percentage of the job price per cleaner. Wages calculate automatically from completed bookings — no spreadsheets."
  },
  {
    icon: DollarSign,
    title: "Tip Tracking & Distribution",
    description: "Track customer tips and distribute them to the right cleaners automatically. Every dollar accounted for, no manual tallying."
  },
  {
    icon: TrendingUp,
    title: "Mileage Reimbursement",
    description: "Auto-calculate mileage from job to job using GPS data. Apply IRS rates or your custom rate — no more self-reported miles."
  },
  {
    icon: FileText,
    title: "Pay Period Reports",
    description: "View gross pay, deductions, and net pay per cleaner every pay period. Export or process in one click."
  },
  {
    icon: Smartphone,
    title: "Staff Pay Portal",
    description: "Cleaners see their own earnings, pay stubs, and mileage from their phone. No calls asking 'what did I make this week?'"
  },
  {
    icon: Users,
    title: "W-2 & 1099 Support",
    description: "Supports both employee and contractor pay structures. Generates the correct documentation for each worker type."
  },
];

const features = [
  "Per-job wage calculation",
  "Hourly & flat-rate pay",
  "Tip tracking",
  "Mileage reimbursement",
  "Pay period summaries",
  "Direct deposit ready",
  "W-2 & 1099 support",
  "Mobile staff portal"
];

const results = [
  "Hours saved every pay period",
  "Zero payroll math errors",
  "Cleaners paid on time, every time"
];

export default function PayrollSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Payroll Software for Cleaning Companies"
        description="Automate cleaner wages, tips, mileage & tax docs. Built for cleaning businesses — per-job pay, hourly, or % of service price. Included with the TIDYWISE Pro plan ($97/mo)."
        canonical="/features/payroll-software"
        ogImage="/images/og/og-payroll.png"
        schemaJson={featurePageSchemas({ featureName: 'Payroll Software', description: 'Automated payroll for cleaners with hourly, commission, and tipped wages.', path: '/features/payroll-software', crumbLabel: 'Payroll' })}
      />

      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="flex items-center gap-2">
              <span className="font-bold text-xl text-foreground">TIDYWISE</span>
            </a>
            <div className="hidden md:flex items-center gap-8">
              <a href="/#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
              <a href="/blog" className="text-muted-foreground hover:text-foreground transition-colors">Blog</a>
              <Button variant="ghost" onClick={() => navigate("/login")}>Log In</Button>
              <Button onClick={handleStartFreeTrial}>Get started</Button>
            </div>
            <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-border">
              <div className="flex flex-col gap-4">
                <a href="/#features" className="text-muted-foreground hover:text-foreground">Features</a>
                <a href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</a>
                <a href="/blog" className="text-muted-foreground hover:text-foreground">Blog</a>
                <Button variant="ghost" className="justify-start" onClick={() => navigate("/login")}>Log In</Button>
                <Button onClick={handleStartFreeTrial}>Get started</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6">
            <DollarSign className="h-4 w-4" />
            Payroll Software
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Payroll Software Built for<br />
            <span className="text-primary">Cleaning Businesses</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Stop spending hours on payroll every two weeks. TidyWise automatically calculates wages from completed jobs — flat rates, hourly, or percentage of service price. Tips, mileage, and deductions handled too. <strong>Included with the Pro plan ($97/mo).</strong>
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
              Get Started <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 h-14" onClick={() => navigate("/pricing")}>
              See All Features
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">$0</div>
              <p className="text-sm text-muted-foreground">Monthly cost</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">Auto</div>
              <p className="text-sm text-muted-foreground">Wage calculation</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">3 types</div>
              <p className="text-sm text-muted-foreground">Pay structures</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">W-2 & 1099</div>
              <p className="text-sm text-muted-foreground">Documentation</p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-foreground mb-4">Everything Payroll. Nothing Manual.</h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            Generic payroll tools weren't built for cleaning companies. TidyWise understands per-job wages, tip splits, and variable hours — because that's your reality.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {benefits.map((b, i) => (
              <div key={i} className="bg-card rounded-xl p-6 border border-border">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <b.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{b.title}</h3>
                <p className="text-muted-foreground">{b.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">How TidyWise Payroll Works</h2>
          <div className="space-y-6">
            {[
              { step: "1", title: "Set each cleaner's wage type", desc: "Choose flat per-job rate, hourly, or a percentage of the service price. Mix and match across your team." },
              { step: "2", title: "Complete bookings in the app", desc: "As cleaners mark jobs complete, wages calculate automatically. No manual data entry." },
              { step: "3", title: "Review your pay period summary", desc: "See gross pay, tips, mileage, deductions, and net pay for every cleaner in one view." },
              { step: "4", title: "Export or pay directly", desc: "Download the payroll report or process payment. Cleaners see their earnings in the staff portal." },
            ].map((item) => (
              <div key={item.step} className="flex gap-5 items-start">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold flex-shrink-0">
                  {item.step}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{item.title}</h3>
                  <p className="text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature List */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            Everything Included
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3 bg-card rounded-lg p-4 border border-border">
                <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                <span className="text-foreground">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Result */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-8">The Result</h2>
          <div className="flex flex-col sm:flex-row gap-6 justify-center">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                <span className="text-foreground font-medium">{r}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
            Stop Running Payroll in Spreadsheets
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            TidyWise handles payroll, scheduling, CRM, and invoicing — all in one platform for cleaning businesses, with plans from $49/mo.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="/features/payroll-software" />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <div className="max-w-5xl mx-auto">
          <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/features/scheduling-software" className="text-muted-foreground hover:text-foreground">Scheduling</Link>
            <Link to="/features/route-optimization" className="text-muted-foreground hover:text-foreground">Route Optimization</Link>
            <Link to="/blog/payroll-software-for-cleaning-businesses" className="text-muted-foreground hover:text-foreground">Payroll Guide</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
