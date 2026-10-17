import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, Calendar, Clock, Users, CheckCircle2,
  Bell, Repeat, CalendarCheck, MousePointer, Menu, X
} from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const benefits = [
  { icon: MousePointer, title: "Drag-and-Drop Scheduling", description: "See your entire week at a glance. Drag jobs to reschedule. Assign cleaners with a click." },
  { icon: Users, title: "Assign Jobs to Specific Cleaners", description: "Match the right cleaner to the right job based on skills, location, and availability." },
  { icon: Bell, title: "Automatic Reminders", description: "Your team and clients get SMS/email reminders before appointments. Reduce no-shows dramatically." },
  { icon: CalendarCheck, title: "Handle Changes in Seconds", description: "Reschedules and cancellations handled instantly. No more frantic phone calls." },
  { icon: Calendar, title: "Full Week or Month View", description: "View your full week or month at a glance. Know exactly what's happening across your business." },
  { icon: Repeat, title: "Recurring Job Automation", description: "Set up weekly, bi-weekly, or monthly recurring cleans. They're scheduled automatically forever." },
];

const results = [
  "Less no-shows",
  "Fewer mix-ups",
  "A cleaning operation that runs like clockwork",
];

export default function SchedulingSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Cleaning Business Scheduling Software | TidyWise"
        description="Schedule your cleaning team in minutes with TidyWise. Drag-and-drop scheduling, automatic reminders, and real-time updates for your whole team."
        canonical="/blog/post/cleaning-business-scheduling-software"
        noIndex
        ogImage="/images/og/og-scheduling.png"
        schemaJson={featurePageSchemas({ featureName: 'Scheduling Software', description: 'Drag-and-drop scheduling with recurring jobs, staff availability, and conflict checks.', path: '/features/scheduling-software', crumbLabel: 'Scheduling' })}
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
            <Calendar className="h-4 w-4" />
            Scheduling Software
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Scheduling Software That Runs<br/>
            <span className="text-primary">Your Cleaning Operation</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Juggling cleaners, clients, and jobs manually is costing you time and money. TidyWise makes scheduling effortless — assign jobs, manage your team, and handle last-minute changes without the headache.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
              Get Started <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8 h-14" onClick={() => navigate("/pricing")}>
              See Pricing
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">Features That Keep Your Team on Track</h2>
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

      {/* The Result */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
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
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-primary/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">Take Control of Your Schedule</h2>
          <p className="text-lg text-muted-foreground mb-8">Stop wasting time on manual scheduling. See pricing today.</p>
          <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
            Get Started <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="scheduling" />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <div className="max-w-5xl mx-auto">
          <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/features/booking" className="text-muted-foreground hover:text-foreground">Booking</Link>
            <Link to="/features/crm" className="text-muted-foreground hover:text-foreground">CRM</Link>
            <Link to="/features/invoicing-software" className="text-muted-foreground hover:text-foreground">Invoicing</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
