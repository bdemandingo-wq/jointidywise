import { safeJsonLd } from "@/lib/safeJsonLd";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, 
  FileText, 
  CreditCard, 
  Send,
  Zap,
  CheckCircle2,
  Clock,
  DollarSign,
  Receipt,
  RefreshCw,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const benefits = [
  {
    icon: FileText,
    title: "Professional Invoice Templates",
    description: "Beautiful, branded invoices that look professional. Add your logo, colors, and payment terms automatically."
  },
  {
    icon: Send,
    title: "One-Click Invoice Sending",
    description: "Generate and send invoices instantly after a job is completed. No manual data entry required."
  },
  {
    icon: CreditCard,
    title: "Online Payment Processing",
    description: "Accept credit cards, ACH, and digital payments. Customers can pay directly from the invoice email."
  },
  {
    icon: Clock,
    title: "Automated Payment Reminders",
    description: "Stop chasing late payments. Automatic reminders go out on your schedule until the invoice is paid."
  },
  {
    icon: RefreshCw,
    title: "Recurring Invoice Automation",
    description: "Set up recurring invoices for repeat customers. They're generated and sent automatically."
  },
  {
    icon: DollarSign,
    title: "Real-Time Payment Tracking",
    description: "See which invoices are paid, pending, or overdue at a glance. Get notified when payments arrive."
  },
];

const features = [
  "Custom branded invoices",
  "Stripe payment integration",
  "Automatic late fee calculation",
  "Recurring billing automation",
  "PDF invoice generation",
  "Email & SMS reminders",
  "Partial payment support",
  "Tax calculation built-in"
];

export default function InvoicingSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Invoicing Software for Cleaning Businesses | TidyWise"
        description="Create branded invoices, accept online payments, and automate reminders. Get paid 2x faster with TidyWise invoicing for cleaning companies."
        canonical="/features/invoicing-software"
        ogImage="/images/og/og-invoicing.png"
        schemaJson={featurePageSchemas({ featureName: 'Invoicing Software', description: 'Create branded invoices, accept card payments, and auto-charge recurring clients.', path: '/features/invoicing-software', crumbLabel: 'Invoicing' })}
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
            <Receipt className="h-4 w-4" />
            Professional Invoicing
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Invoicing Software<br/>
            <span className="text-primary">for Cleaning Businesses</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Stop using spreadsheets and paper invoices. TidyWise creates professional invoices automatically after every cleaning. <strong>Get paid 2x faster</strong> with online payments and automated reminders.
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
              <div className="text-3xl font-bold text-primary">2x Faster</div>
              <p className="text-sm text-muted-foreground">Payment Collection</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">0 Late</div>
              <p className="text-sm text-muted-foreground">Payment Headaches</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">1-Click</div>
              <p className="text-sm text-muted-foreground">Invoice Sending</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">2.9%</div>
              <p className="text-sm text-muted-foreground">Processing Fee</p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-4">
            How TidyWise Invoicing Works
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            Create, send, and track invoices without lifting a finger. Get paid faster with online payments.
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
            Everything You Need to Get Paid
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
            Stop Chasing Late Payments
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Get paid faster with automated invoicing for your cleaning business.
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
            currentSlug="/features/invoicing-software" 
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">© 2026 TidyWise. Professional invoicing for cleaning businesses.</p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/features/payment-processing" className="text-muted-foreground hover:text-foreground">Payments</Link>
            <Link to="/features/quote-software" className="text-muted-foreground hover:text-foreground">Quotes</Link>
            <Link to="/compare/housecall-pro" className="text-muted-foreground hover:text-foreground">vs Housecall Pro</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
      </footer>

      {/* Schema */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{
        __html: safeJsonLd({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "TidyWise Invoicing Software",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, iOS, Android",
          "offers": { "@type": "Offer", "price": "50", "priceCurrency": "USD" },
          "description": "Invoicing software for cleaning businesses. Create professional invoices, accept online payments, and automate payment reminders."
        })
      }} />
    </div>
  );
}
