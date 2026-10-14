import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { featurePageSchemas } from '@/lib/seo/schemas';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { 
  ArrowRight, Calendar, Globe, CheckCircle2,
  Clock, Smartphone, Bell, Menu, X
} from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const features = [
  "Instant online booking available 24/7",
  "Automated confirmation emails and reminders",
  "Custom service types and pricing",
  "Real-time calendar sync",
  "Mobile-friendly booking page for your clients",
];

export default function BookingSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Online Booking Software for Cleaning Businesses | TidyWise"
        description="Let clients book cleaning services online 24/7. TidyWise automates your booking process so you never miss a job. See pricing."
        canonical="/features/booking"
        ogImage="/images/og/og-booking.png"
        schemaJson={featurePageSchemas({ featureName: 'Online Booking Software', description: '24/7 online booking with custom services, real-time calendar, and automated confirmations.', path: '/features/booking', crumbLabel: 'Online Booking' })}
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
            Booking Software
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Online Booking Software<br/>
            <span className="text-primary">Built for Cleaning Businesses</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Stop playing phone tag with clients. TidyWise gives your cleaning business a professional online booking system that works around the clock — even while you're on the job.
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

      {/* How it works */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-foreground mb-6">How It Works</h2>
          <p className="text-lg text-muted-foreground text-center max-w-2xl mx-auto mb-12">
            Clients visit your booking page, select their service, pick a date and time, and confirm instantly. No back-and-forth. No missed calls. Just confirmed bookings straight to your calendar.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: "1", icon: Globe, label: "Client visits your booking page" },
              { step: "2", icon: Calendar, label: "Selects service, date & time" },
              { step: "3", icon: Bell, label: "Gets instant confirmation" },
              { step: "4", icon: Clock, label: "Job appears on your calendar" },
            ].map((item) => (
              <div key={item.step} className="bg-card rounded-xl p-6 border border-border text-center">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3 text-primary font-bold">
                  {item.step}
                </div>
                <item.icon className="h-6 w-6 text-primary mx-auto mb-2" />
                <p className="text-foreground font-medium">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-8">What You Get</h2>
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                <span className="text-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-primary/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">Start Accepting Bookings Today</h2>
          <p className="text-lg text-muted-foreground mb-8">Join hundreds of cleaning businesses using TidyWise to fill their calendar. Get started.</p>
          <Button size="lg" className="text-lg px-8 h-14" onClick={handleStartFreeTrial}>
            Get Started <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Related Articles */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <RelatedArticles currentSlug="booking" articles={allArticles} />
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
