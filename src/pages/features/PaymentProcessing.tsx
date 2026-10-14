import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, CreditCard, Shield, DollarSign, CheckCircle2,
  Receipt, RefreshCw, Bell, Menu, X
} from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const benefits = [
  { icon: Receipt, title: "Instant Professional Invoices", description: "Send professional invoices instantly after each job. No more manual billing." },
  { icon: CreditCard, title: "Accept Cards, ACH & Recurring", description: "Accept credit cards, ACH, and recurring payments. Clients pay online with one click." },
  { icon: RefreshCw, title: "Auto-Billing for Recurring Clients", description: "Set up weekly or monthly auto-billing for recurring clients. Set it and forget it." },
  { icon: Bell, title: "Automatic Payment Reminders", description: "Payment reminders sent automatically. Stop chasing payments manually." },
  { icon: DollarSign, title: "Full Payment History", description: "Complete payment history per client. Know exactly who paid what and when." },
  { icon: Shield, title: "PCI Compliant & Secure", description: "Bank-level security with Stripe. Your customers' data is always protected." },
];

export default function PaymentProcessing() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Automated Payments for Cleaning Businesses | TidyWise"
        description="Get paid faster with TidyWise. Send invoices, accept online payments, and set up recurring billing — all in one place."
        canonical="/features/payment-processing"
        ogImage="/images/og/og-payments.png"
        schemaJson={featurePageSchemas({ featureName: 'Payment Processing', description: 'Accept cards, ACH, and saved payment methods with Stripe Connect built in.', path: '/features/payment-processing', crumbLabel: 'Payments' })}
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
            <CreditCard className="h-4 w-4" />
            Payments & Invoicing
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Get Paid Faster With Automated<br/>
            <span className="text-primary">Cleaning Business Payments</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Chasing invoices is the worst part of running a cleaning business. TidyWise handles billing automatically so you get paid on time, every time — without lifting a finger.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
              Try TidyWise <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 h-14" onClick={() => navigate("/pricing")}>
              See Pricing
            </Button>
          </div>
        </div>
      </section>

      {/* What's Included */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">What's Included</h2>
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

      {/* Built for cleaning */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">Built for Cleaning Businesses</h2>
          <p className="text-lg text-muted-foreground">
            Whether you charge per job, weekly, or on a subscription basis, TidyWise flexes to match how you run your business.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-primary/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">Start Getting Paid on Time</h2>
          <p className="text-lg text-muted-foreground mb-8">Automatic charging and professional invoicing. See pricing today.</p>
          <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
            Try TidyWise <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="payments" />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <div className="max-w-5xl mx-auto">
          <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
          <div className="flex justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
