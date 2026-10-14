import { safeJsonLd } from "@/lib/safeJsonLd";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, 
  FileText, 
  Clock, 
  DollarSign, 
  Zap,
  CheckCircle2,
  Send,
  Calculator,
  Sparkles,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const benefits = [
  {
    icon: Calculator,
    title: "Instant Price Calculation",
    description: "Auto-calculate quotes based on square footage, bedrooms, bathrooms, and add-on services."
  },
  {
    icon: FileText,
    title: "Professional Templates",
    description: "Beautiful, branded quote templates that make your business look established and trustworthy."
  },
  {
    icon: Send,
    title: "One-Click Sending",
    description: "Send quotes via email or SMS instantly. Customers can accept and pay in one click."
  },
  {
    icon: Clock,
    title: "Automated Follow-ups",
    description: "Never lose a lead. Automatic reminders for quotes that haven't been accepted yet."
  },
  {
    icon: DollarSign,
    title: "Deposit Collection",
    description: "Collect deposits when quotes are accepted. Secure payment with Stripe integration."
  },
  {
    icon: Sparkles,
    title: "AI-Powered Suggestions",
    description: "AI suggests upsells and add-ons based on the service type and customer history."
  },
];

const features = [
  "Custom pricing rules",
  "Square footage calculator",
  "Add-on service bundles",
  "Discount code support",
  "Quote expiration dates",
  "PDF quote generation",
  "E-signature capture",
  "Quote-to-booking conversion"
];

export default function QuoteSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Cleaning Quote Software | Instant Estimates | TIDYWISE"
        description="Professional quote software for cleaning businesses. Auto-calculate prices, send branded estimates, and convert leads to bookings. Get started trial."
        canonical="/features/quote-software"
        ogImage="/images/og/og-quotes.png"
        schemaJson={featurePageSchemas({ featureName: 'Quote & Estimate Software', description: 'Send branded estimates with one-click acceptance and convert quotes to confirmed jobs.', path: '/features/quote-software', crumbLabel: 'Quotes' })}
      />

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
            <FileText className="h-4 w-4" />
            Quote Software
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Cleaning Quote Software<br/>
            <span className="text-primary">That Closes Deals</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Create and send professional quotes in under 60 seconds. Auto-calculate prices, track quote status, and <strong>convert 40% more leads to bookings</strong>.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="h-12 px-8" onClick={handleStartFreeTrial}>
              Get started <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8" onClick={() => document.getElementById('benefits')?.scrollIntoView({ behavior: 'smooth' })}>
              See How It Works
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">60 Sec</div>
              <p className="text-sm text-muted-foreground">Quote Creation</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">40%</div>
              <p className="text-sm text-muted-foreground">Higher Conversion</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">Auto</div>
              <p className="text-sm text-muted-foreground">Follow-ups</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">1-Click</div>
              <p className="text-sm text-muted-foreground">Accept & Pay</p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-4">
            Quote Software Built for Cleaning Businesses
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            From lead to booked job in minutes. Everything you need to win more cleaning contracts.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="bg-card rounded-xl p-6 border border-border">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <benefit.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{benefit.title}</h3>
                <p className="text-muted-foreground">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature List */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            Every Feature You Need to Close More Deals
          </h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3 bg-card rounded-lg p-4 border border-border">
                <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                <span className="text-foreground">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
            Start Winning More Cleaning Contracts
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Professional quotes in 60 seconds. See pricing today.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Related Articles */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="/features/quote-software" />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">© 2026 TIDYWISE. Quote software for cleaning businesses.</p>
          <div className="flex justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
      </footer>

      {/* Schema */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{
        __html: safeJsonLd({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "TIDYWISE Quote Software",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, iOS, Android",
          "offers": { "@type": "Offer", "price": "50", "priceCurrency": "USD" },
          "description": "Professional quote software for cleaning businesses with instant pricing and automated follow-ups."
        })
      }} />
    </div>
  );
}
