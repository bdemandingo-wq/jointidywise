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
  Navigation,
  Zap,
  CheckCircle2,
  Fuel,
  TrendingUp,
  Map,
  Car,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const benefits = [
  {
    icon: Navigation,
    title: "AI-Powered Route Planning",
    description: "Our algorithm calculates the fastest routes between jobs, considering traffic, distance, and time windows."
  },
  {
    icon: Fuel,
    title: "Reduce Fuel Costs by 25%",
    description: "Optimized routes mean less driving. Save hundreds on gas every month across your cleaning team."
  },
  {
    icon: Clock,
    title: "Fit More Jobs Per Day",
    description: "Eliminate wasted drive time. Most cleaning businesses add 1-2 extra jobs per week with optimized routes."
  },
  {
    icon: MapPin,
    title: "Zone-Based Scheduling",
    description: "Group jobs by neighborhood. Assign cleaners to specific zones to minimize travel between appointments."
  },
  {
    icon: Car,
    title: "Real-Time GPS Tracking",
    description: "See where every cleaner is in real-time. Know exactly when they'll arrive at the next job."
  },
  {
    icon: Map,
    title: "One-Click Navigation",
    description: "Cleaners get turn-by-turn directions to every job. Integrates with Google Maps and Apple Maps."
  },
];

const features = [
  "Automatic route optimization",
  "Traffic-aware scheduling",
  "Multi-stop route planning",
  "Zone-based job assignment",
  "Real-time ETA updates",
  "GPS check-in verification",
  "Mileage tracking & reports",
  "Fuel cost analytics"
];

export default function RouteOptimization() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Route Optimization Software for Cleaning Businesses"
        description="AI-powered route optimization for cleaning businesses. Cut drive time 30%, reduce fuel costs 25%, and fit more jobs per day. Included with the TIDYWISE Pro plan."
        canonical="/features/route-optimization"
        ogImage="/images/og/og-routes.png"
        schemaJson={featurePageSchemas({ featureName: 'Route Optimization', description: 'Sequence jobs by driving time and reduce windshield time across your team.', path: '/features/route-optimization', crumbLabel: 'Route Optimization' })}
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
            <Navigation className="h-4 w-4" />
            Smart Routing
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Route Optimization<br/>
            <span className="text-primary">for Cleaning Businesses</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Stop wasting time and money on inefficient routes. TidyWise automatically plans the fastest routes for your cleaning team. <strong>Save 25% on fuel costs</strong> and fit more jobs into every day.
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
              <div className="text-3xl font-bold text-primary">25%</div>
              <p className="text-sm text-muted-foreground">Fuel Savings</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">30%</div>
              <p className="text-sm text-muted-foreground">Less Drive Time</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">1-2 Extra</div>
              <p className="text-sm text-muted-foreground">Jobs Per Week</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary">Real-time</div>
              <p className="text-sm text-muted-foreground">GPS Tracking</p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-4">
            How Route Optimization Works
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            TidyWise uses AI to plan the most efficient routes for your cleaning team automatically.
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
            Everything You Need for Smarter Routes
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
            Stop Wasting Money on Inefficient Routes
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Save time and fuel with smart route optimization for your cleaning business.
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
            currentSlug="/features/route-optimization" 
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">© 2026 TidyWise. Smart route optimization for cleaning businesses.</p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/features/automated-dispatching" className="text-muted-foreground hover:text-foreground">Dispatching</Link>
            <Link to="/features/scheduling-software" className="text-muted-foreground hover:text-foreground">Scheduling</Link>
            <Link to="/compare/booking-koala" className="text-muted-foreground hover:text-foreground">vs Booking Koala</Link>
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
          "name": "TidyWise Route Optimization",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, iOS, Android",
          "offers": { "@type": "Offer", "price": "50", "priceCurrency": "USD" },
          "description": "Route optimization software for cleaning businesses. AI-powered routing saves 25% on fuel and reduces drive time by 30%."
        })
      }} />
    </div>
  );
}
