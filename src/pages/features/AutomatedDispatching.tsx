import { safeJsonLd } from "@/lib/safeJsonLd";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, 
  MapPin, 
  Clock, 
  Users, 
  Zap,
  CheckCircle2,
  Calendar,
  Route,
  Bell,
  Smartphone,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const benefits = [
  {
    icon: MapPin,
    title: "GPS-Based Assignment",
    description: "Automatically assign cleaners based on their proximity to job locations. Reduce travel time by 30%."
  },
  {
    icon: Clock,
    title: "Smart Time Slots",
    description: "AI analyzes travel time between jobs and schedules optimal routes for your team."
  },
  {
    icon: Users,
    title: "Skill-Based Matching",
    description: "Match cleaners to jobs based on their skills, certifications, and customer preferences."
  },
  {
    icon: Bell,
    title: "Instant Notifications",
    description: "Cleaners get push notifications for new jobs. Accept or decline with one tap."
  },
  {
    icon: Route,
    title: "Route Optimization",
    description: "Minimize drive time with optimized daily routes. Fit more jobs into each day."
  },
  {
    icon: Smartphone,
    title: "Mobile Check-ins",
    description: "Staff check in/out with GPS verification. Automatic time tracking and payroll."
  },
];

const features = [
  "Drag-and-drop scheduling",
  "Cleaner availability calendar",
  "Automatic conflict detection",
  "Customer preference matching",
  "Real-time job status updates",
  "On-my-way SMS notifications",
  "Job reassignment in 2 clicks",
  "Recurring job automation"
];

export default function AutomatedDispatching() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Automated Dispatching for Cleaning Businesses | TIDYWISE"
        description="Smart dispatching software for cleaning companies. GPS-based cleaner assignment, route optimization, and real-time job tracking. See pricing."
        canonical="/features/automated-dispatching"
        ogImage="/images/og/og-dispatch.png"
        schemaJson={featurePageSchemas({ featureName: 'Automated Job Dispatching', description: 'Auto-assign jobs to the right cleaner using availability, skills, location, and route.', path: '/features/automated-dispatching', crumbLabel: 'Automated Dispatching' })}
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
            <Zap className="h-4 w-4" />
            Smart Dispatching
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Automated Dispatching<br/>
            <span className="text-primary">for Cleaning Businesses</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Stop manually assigning jobs. TIDYWISE automatically dispatches cleaners based on location, skills, and availability. <strong>Save 5+ hours per week</strong> on scheduling.
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
              <div className="text-3xl font-bold text-primary">30%</div>
              <p className="text-sm text-muted-foreground">Less Travel Time</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">5+ Hours</div>
              <p className="text-sm text-muted-foreground">Saved Weekly</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">2 Clicks</div>
              <p className="text-sm text-muted-foreground">To Reassign Jobs</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">Real-time</div>
              <p className="text-sm text-muted-foreground">Job Tracking</p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-4">
            How Smart Dispatching Works
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            TIDYWISE uses AI to assign the right cleaner to every job automatically.
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
            Everything You Need for Effortless Dispatching
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
            Stop Wasting Time on Manual Scheduling
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Try automated dispatching for your cleaning business. See pricing today.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Related Articles */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="/features/automated-dispatching" />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">© 2026 TIDYWISE. Smart dispatching for cleaning businesses.</p>
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
          "name": "TIDYWISE Automated Dispatching",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, iOS, Android",
          "offers": { "@type": "Offer", "price": "50", "priceCurrency": "USD" },
          "description": "Automated dispatching software for cleaning businesses with GPS-based assignment and route optimization."
        })
      }} />
    </div>
  );
}
