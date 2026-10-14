import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, Users, Target, BarChart3, CheckCircle2,
  MessageSquare, Heart, FileText, Menu, X
} from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const capabilities = [
  { icon: FileText, title: "Full Job & Payment History", description: "View every client's complete job history and payment records in one place." },
  { icon: MessageSquare, title: "Notes & Special Instructions", description: "Add notes and special instructions per client so your team always knows what to expect." },
  { icon: Target, title: "Lead Tracking & Auto Follow-Up", description: "Track leads and follow up automatically. Never lose a potential customer again." },
  { icon: BarChart3, title: "Client Segmentation", description: "Segment clients by service type, frequency, or location. See your best clients at a glance." },
  { icon: Heart, title: "Retention Insights", description: "Identify at-risk customers before they churn. Build loyalty with data-driven decisions." },
  { icon: Users, title: "Scales With You", description: "Whether you have 10 clients or 500, TidyWise keeps everything organized so you can focus on delivering great cleans." },
];

export default function CRMSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="CRM Software for Cleaning Businesses"
        description="TidyWise CRM keeps all your cleaning clients, job history, and notes in one place. Stay organized and grow your cleaning business faster."
        canonical="/features/crm"
        ogImage="/images/og/og-crm.png"
        schemaJson={featurePageSchemas({ featureName: 'Cleaning CRM Software', description: 'Track every customer, job history, photos, payments, and messages in one place.', path: '/features/crm', crumbLabel: 'CRM' })}
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
            <Users className="h-4 w-4" />
            CRM Software
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            The CRM Built Specifically<br/>
            <span className="text-primary">for Cleaning Business Owners</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Spreadsheets can't scale your business. TidyWise gives you a simple, powerful CRM designed for cleaning companies — so you always know who your clients are, what they need, and when they last booked.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
              Get started <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 h-14" onClick={() => navigate("/pricing")}>
              See Pricing
            </Button>
          </div>
        </div>
      </section>

      {/* What you can do */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">What You Can Do With TidyWise CRM</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {capabilities.map((c, i) => (
              <div key={i} className="bg-card rounded-xl p-6 border border-border">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <c.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{c.title}</h3>
                <p className="text-muted-foreground">{c.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">Who It's For</h2>
          <p className="text-lg text-muted-foreground">
            Whether you have 10 clients or 500, TidyWise keeps everything organized so you can focus on delivering great cleans — not chasing down information.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-primary/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">See Your Business in One Place</h2>
          <p className="text-lg text-muted-foreground mb-8">Join hundreds of cleaning businesses using TidyWise CRM. Get started.</p>
          <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <RelatedArticles currentSlug="crm" articles={allArticles} />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
