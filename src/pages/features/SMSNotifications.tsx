import { safeJsonLd } from "@/lib/safeJsonLd";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, 
  MessageSquare, 
  Bell, 
  Clock, 
  Zap,
  CheckCircle2,
  Send,
  Users,
  Star,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const benefits = [
  {
    icon: Bell,
    title: "Booking Confirmations",
    description: "Instant SMS when a booking is made. Customers know their clean is scheduled."
  },
  {
    icon: Clock,
    title: "Appointment Reminders",
    description: "Automatic reminders 24 hours and 1 hour before. Reduce no-shows by 80%."
  },
  {
    icon: Send,
    title: "On-My-Way Alerts",
    description: "Cleaners tap 'On My Way' and customers get a text. Professional and reassuring."
  },
  {
    icon: Star,
    title: "Review Requests",
    description: "Automatic review requests after completed jobs. Build your Google reviews."
  },
  {
    icon: MessageSquare,
    title: "Two-Way Messaging",
    description: "Full SMS inbox for conversations with customers. All messages in one place."
  },
  {
    icon: Users,
    title: "Team Notifications",
    description: "Alert cleaners about new jobs, schedule changes, and urgent updates via SMS."
  },
];

const features = [
  "Booking confirmation SMS",
  "24-hour reminders",
  "1-hour reminders",
  "On-my-way notifications",
  "Job completion alerts",
  "Review request automation",
  "Two-way SMS inbox",
  "Bulk SMS campaigns"
];

export default function SMSNotifications() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="SMS Notifications for Cleaning Businesses | TidyWise"
        description="Automated SMS notifications for cleaning companies. Booking confirmations, reminders, on-my-way alerts, and review requests. Reduce no-shows by 80%."
        canonical="/features/sms-notifications"
        ogImage="/images/og/og-sms.png"
        schemaJson={featurePageSchemas({ featureName: 'SMS Notifications', description: 'Two-way SMS via OpenPhone for booking confirmations, reminders, and on-the-way alerts.', path: '/features/sms-notifications', crumbLabel: 'SMS Notifications' })}
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
            <MessageSquare className="h-4 w-4" />
            SMS Notifications
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            SMS Client Notifications<br/>
            <span className="text-primary">That Keep Customers Informed</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Automated SMS for every touchpoint. Confirmations, reminders, on-my-way alerts, and review requests. <strong>Reduce no-shows by 80%</strong> and boost your reviews.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="h-12 px-8" onClick={handleStartFreeTrial}>
              Get started <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8" onClick={() => document.getElementById('benefits')?.scrollIntoView({ behavior: 'smooth' })}>
              See SMS Features
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">80%</div>
              <p className="text-sm text-muted-foreground">Fewer No-Shows</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">98%</div>
              <p className="text-sm text-muted-foreground">Open Rate</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">5x</div>
              <p className="text-sm text-muted-foreground">More Reviews</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">Auto</div>
              <p className="text-sm text-muted-foreground">Everything</p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-4">
            Complete SMS Automation
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            Every text message sent automatically. Keep customers informed without lifting a finger.
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
            Every SMS Feature Included
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
            Automate Your Customer Communication
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            SMS notifications that keep customers informed. See pricing today.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Related Articles */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="/features/sms-notifications" />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">© 2026 TIDYWISE. SMS notifications for cleaning businesses.</p>
          <div className="flex justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
              <DoNotSellShareLink />
      </footer>

      {/* Schema */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{
        __html: safeJsonLd({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "name": "TIDYWISE SMS Notifications",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, iOS, Android",
          "offers": { "@type": "Offer", "price": "50", "priceCurrency": "USD" },
          "description": "Automated SMS client notifications for cleaning businesses with reminders and review requests."
        })
      }} />
    </div>
  );
}
