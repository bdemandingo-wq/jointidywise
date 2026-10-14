import { useState, lazy, Suspense, useEffect } from "react";
import emmanuelPhoto from "@/assets/emmanuel-headshot.webp";

const DemoBookingFormLazy = lazy(() => import("@/components/landing/DemoBookingForm").then(m => ({ default: m.DemoBookingForm })));
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Calendar,
  Users,
  CreditCard,
  BarChart3,
  Smartphone,
  Bell,
  Shield,
  Zap,
  CheckCircle2,
  ArrowRight,
  Star,
  Sparkles,
  Menu,
  X,
  Play,
  ChevronRight,
  Crown
} from "lucide-react";
import { SEOHead } from '@/components/SEOHead';
import { localBusinessSchema, softwareApplicationSchema, faqSchema, HOME_FAQS, organizationSchema } from '@/lib/seo/schemas';
import { AuthSEOContent } from '@/components/seo/AuthSEOContent';
import { SiteFooter } from "@/components/SiteFooter";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLifetimeCounter } from "@/hooks/useLifetimeCounter";
import { usePublicGrowth } from "@/hooks/usePublicGrowth";
import { ActivityTicker } from "@/components/growth/ActivityTicker";
import { GrowthCounters } from "@/components/growth/GrowthCounters";
import { lifetimeSpotsLabel } from "@/lib/publicActivity";
import { TRIAL_CTA } from "@/lib/trialOffer";

// Lazy load below-the-fold heavy components for better LCP
const AIBusinessTools = lazy(() => import("@/components/landing/AIBusinessTools").then(m => ({ default: m.AIBusinessTools })));
const CompetitorComparison = lazy(() => import("@/components/landing/CompetitorComparison").then(m => ({ default: m.CompetitorComparison })));
const BlogSection = lazy(() => import("@/components/landing/BlogSection").then(m => ({ default: m.BlogSection })));
const InteractiveDemo = lazy(() => import("@/components/landing/InteractiveDemo").then(m => ({ default: m.InteractiveDemo })));
const TidyWiseScoreSection = lazy(() => import("@/components/landing/TidyWiseScoreSection").then(m => ({ default: m.TidyWiseScoreSection })));

// Lightweight skeleton for lazy sections
const SectionSkeleton = () => (
  <div className="py-16 px-4 animate-pulse">
    <div className="max-w-7xl mx-auto">
      <div className="h-8 w-64 bg-muted rounded-lg mx-auto mb-4" />
      <div className="h-4 w-96 bg-muted rounded mx-auto mb-12" />
      <div className="grid md:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-48 bg-muted rounded-2xl" />
        ))}
      </div>
    </div>
  </div>
);

const cleaningConfig = {
  jobLabel: "Cleans",
  staffLabel: "Cleaners",
  serviceExamples: ["Deep Clean", "Standard Clean", "Move In/Out"],
  dashboardStats: {
    bookings: 12,
    revenue: "$2,450",
    staff: 8
  },
  testimonials: [
    {
      quote: "This platform transformed how we run our cleaning business. Bookings increased 40% in the first month!",
      author: "Sarah M.",
      role: "Owner, Sparkle Clean Co.",
      rating: 5,
      avatar: "SM"
    },
    {
      quote: "The staff portal is amazing. My team can manage their own schedules and I can track everything in real-time.",
      author: "Michael R.",
      role: "Founder, Fresh Start Services",
      rating: 5,
      avatar: "MR"
    },
    {
      quote: "Finally, a platform that understands cleaning businesses. The automated invoicing alone saves me hours every week.",
      author: "Jennifer L.",
      role: "CEO, Elite Home Care",
      rating: 5,
      avatar: "JL"
    },
  ],
  features: [
    "Online booking form",
    "Recurring bookings",
    "Staff portal & app",
    "Client portal",
    "GPS check-ins",
    "Quote generator",
    "Lead management",
    "Photo documentation",
    "Review requests",
    "Loyalty tiers & rewards",
    "P&L reports",
    "Revenue forecasting",
    "Multi-location",
    "Demo/Test Mode",
    "In-App SMS inbox",
    "Inventory tracking",
    "Client self-cancellation",
    "Activity analytics",
    "AI intelligence"
  ]
};

const baseFeatures = [
  {
    icon: Calendar,
    title: "Smart Scheduling & Online Booking",
    description: "Cleaning business scheduling software that auto-assigns cleaners by location, skills, and availability. Let customers book online 24/7."
  },
  {
    icon: Users,
    title: "Client Portal & Self-Service",
    description: "Give clients their own portal to view bookings, request new appointments, cancel with tier-based policies, and track loyalty rewards."
  },
  {
    icon: CreditCard,
    title: "Automated Payments & Invoicing",
    description: "Accept payments online with Stripe. Auto-generate invoices, handle deposits, tips, and send professional quotes in seconds."
  },
  {
    icon: BarChart3,
    title: "Platform Analytics & AI Intelligence",
    description: "Track admin and client portal activity, user engagement, churn predictions, and revenue forecasting with AI-powered insights."
  },
  {
    icon: Smartphone,
    title: "Mobile App with GPS Tracking",
    description: "Staff app with GPS check-ins, on-my-way texts, photo documentation, and real-time job updates."
  },
  {
    icon: Bell,
    title: "Loyalty Tiers & Automated Campaigns",
    description: "Reward loyal customers with tiered benefits like free cancellations. Auto-send review requests and win-back campaigns."
  },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const lifetime = useLifetimeCounter();
  const growth = usePublicGrowth();

  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isMobile && mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }, [isMobile, mobileMenuOpen]);

  // Prevent the page behind the mobile menu from scrolling
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // The primary button starts the 30-day Pro trial. See plans stays beside
  // it so Basic, Pro, and Lifetime stay one click away.
  const handleGetStarted = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/signup");
  };

  const handleStartFree = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/signup");
  };

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background overflow-x-hidden pb-20">
      <SEOHead 
        title="Cleaning Business CRM & Scheduling Software | TidyWise"
        description="Smart scheduling, automated payroll, CRM, GPS tracking and online booking for cleaning businesses. Start free — 30 days of Pro, no card. Plans from $49/mo."
        canonical="/"
        ogImage="https://www.jointidywise.com/images/og/og-home.png"
        schemaJson={[
          organizationSchema(),
          localBusinessSchema(),
          softwareApplicationSchema(),
          faqSchema(HOME_FAQS),
        ]}
      />

      {/* Navigation - Premium glassmorphism (iOS safe-area aware) */}
      <nav className={`fixed top-0 left-0 right-0 z-50 pt-[env(safe-area-inset-top)] transition-all duration-300 ${
        isScrolled 
          ? 'bg-background/80 backdrop-blur-xl border-b border-border/50 shadow-sm' 
          : 'bg-transparent'
      }`}>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-14 md:h-18 gap-6">
            <div className="flex items-center gap-2 pl-1 md:pl-2 mr-4 md:mr-8">
              <span className="font-bold text-xl md:text-2xl text-foreground tracking-tight">TIDYWISE</span>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-6 lg:gap-8">
              <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Features</a>
              <a href="#blog" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Blog</a>
              <a href="#testimonials" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Testimonials</a>
              <Button variant="ghost" asChild className="text-sm"><Link to="/pricing">Pricing</Link></Button>
              <Button variant="ghost" asChild className="text-sm"><Link to="/contact">Contact</Link></Button>
              <Button variant="ghost" asChild className="text-sm"><Link to="/portal/login">Client Portal</Link></Button>
              <Button variant="ghost" asChild className="text-sm"><Link to="/staff/login">Staff Portal</Link></Button>
              <Button variant="ghost" asChild className="text-sm font-medium text-primary"><Link to="/demo">Schedule Demo</Link></Button>
              <Button variant="ghost" asChild className="text-sm"><Link to="/login">Log In</Link></Button>
              <Button variant="ghost" asChild className="text-sm"><Link to="/signup">Sign Up</Link></Button>
              <Button variant="outline" asChild className="text-sm">
                <Link to="/demo?screen=dashboard">Try the demo</Link>
              </Button>
              <Button variant="premium" asChild className="text-sm">
                <Link to="/signup">
                  Start free
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>

            {/* Mobile menu button */}
            <button 
              className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>

           {/* Mobile Navigation: fixed overlay to avoid colliding with the hero */}
           {mobileMenuOpen ? (
             <div
               className="md:hidden fixed inset-0 z-[60]"
               role="dialog"
               aria-modal="true"
               aria-label="Mobile menu"
             >
               {/* Backdrop */}
               <button
                 type="button"
                 className="absolute inset-0 bg-background/60 backdrop-blur-sm"
                 aria-label="Close menu"
                 onClick={closeMobileMenu}
               />

               {/* Panel */}
               <div className="absolute left-3 right-3 top-[calc(4.25rem+env(safe-area-inset-top))]">
                 <div className="rounded-2xl border border-border bg-background shadow-lg">
                   <div className="flex flex-col gap-1 p-2">
                     <a
                       href="#features"
                       onClick={closeMobileMenu}
                       className="px-4 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all"
                     >
                       Features
                     </a>
                     <a
                       href="#blog"
                       onClick={closeMobileMenu}
                       className="px-4 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all"
                     >
                       Blog
                     </a>
                      <a
                        href="#testimonials"
                        onClick={closeMobileMenu}
                        className="px-4 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all"
                      >
                        Testimonials
                       </a>
                       <Button variant="ghost" asChild className="justify-start text-primary font-medium" onClick={closeMobileMenu}>
                         <Link to="/demo">Schedule Demo</Link>
                       </Button>
                       <Button variant="ghost" asChild className="justify-start" onClick={closeMobileMenu}>
                         <Link to="/pricing">Pricing</Link>
                       </Button>
                       <Button variant="ghost" asChild className="justify-start" onClick={closeMobileMenu}>
                         <Link to="/contact">Contact</Link>
                       </Button>
                       <Button variant="ghost" asChild className="justify-start" onClick={closeMobileMenu}>
                         <Link to="/portal/login">Client Portal</Link>
                       </Button>
                       <Button variant="ghost" asChild className="justify-start" onClick={closeMobileMenu}>
                         <Link to="/staff/login">Staff Portal</Link>
                       </Button>
                        <Button variant="ghost" asChild className="justify-start" onClick={closeMobileMenu}>
                          <Link to="/login">Log In</Link>
                        </Button>
                        <Button variant="ghost" asChild className="justify-start" onClick={closeMobileMenu}>
                          <Link to="/signup">Sign Up</Link>
                        </Button>
                        <Button variant="outline" asChild className="justify-start" onClick={closeMobileMenu}>
                          <Link to="/demo?screen=dashboard">Try the demo</Link>
                        </Button>
                       <Button variant="premium" asChild className="mt-1" onClick={closeMobileMenu}>
                         <Link to="/signup">
                           Start free
                           <ArrowRight className="ml-1 h-4 w-4" />
                         </Link>
                       </Button>
                   </div>
                 </div>
               </div>
             </div>
           ) : null}
        </div>
      </nav>

      <main>
      {/* Hero Section - Editorial redesign */}
      <section className="relative pt-[calc(7rem+env(safe-area-inset-top))] md:pt-[calc(10rem+env(safe-area-inset-top))] pb-20 md:pb-32 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Warm radial wash */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ background: 'var(--gradient-hero)' }} />

        <div className="max-w-5xl mx-auto relative text-center">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 mb-8 text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
            <span className="h-px w-8 bg-foreground/30" />
            <span>Cleaning Business Software</span>
            <span className="h-px w-8 bg-foreground/30" />
          </div>

          {/* Editorial headline */}
          <h1 className="pv-display text-[2.75rem] sm:text-6xl md:text-7xl lg:text-[5.5rem] mb-8 text-foreground">
            Run your cleaning<br />
            business like a{" "}
            <span className="italic text-primary">work of art</span>.
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Online booking, smart scheduling, automated payroll, and CRM —
            all in one quietly powerful platform. No fluff. Built for operators who care about the craft.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 max-w-3xl mx-auto justify-center">
            <Button
              size="xl"
              variant="premium"
              onClick={handleGetStarted}
              className="group h-auto whitespace-normal py-3 text-center"
            >
              {TRIAL_CTA}
              <ArrowRight className="ml-1 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              size="xl"
              variant="outline"
              onClick={() => navigate("/pricing")}
              className="gap-2"
            >
              See plans
            </Button>
            <Button
              size="xl"
              variant="outline"
              onClick={() => navigate("/demo?screen=dashboard")}
            >
              Try the demo
            </Button>
          </div>
          <div className="mt-4">
            <GrowthCounters lifetime={lifetime} counters={growth.counters} />
          </div>

          {/* Trust line */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-foreground" />
              Plans from $49/mo
            </span>
            <span className="hidden sm:inline text-foreground/30">·</span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-foreground" />
              Cancel any time
            </span>
            <span className="hidden sm:inline text-foreground/30">·</span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-foreground" />
              Yearly = 2 months free
            </span>
          </div>

          {/* Lifetime founding offer hook — only renders while spots remain
              so it never shows a stale "X of 100 left" once sold out. */}
          {!lifetime.loading && !lifetime.soldOut && (
            <button
              type="button"
              onClick={() => navigate('/pricing')}
              className="group mt-8 inline-flex items-center gap-4 rounded-full border-2 border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/20 px-5 py-3 hover:border-amber-500 hover:bg-amber-50/60 dark:hover:bg-amber-950/30 transition-all"
            >
              <span className="inline-flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <Crown className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider font-semibold">
                  Founding offer
                </span>
              </span>
              <span className="hidden sm:inline text-amber-500/40">·</span>
              <span className="text-sm sm:text-base text-foreground font-medium">
                Lifetime access for{' '}
                <span className="font-bold">$300 one-time</span>
              </span>
              {!lifetime.unavailable && (
                <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  {lifetimeSpotsLabel(lifetime.spotsLeft, lifetime.total)}
                </span>
              )}
              <ArrowRight className="h-4 w-4 text-amber-600 group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}
          {!lifetime.loading && lifetime.soldOut && (
            <button
              type="button"
              onClick={() => navigate('/pricing')}
              className="group mt-8 inline-flex items-center gap-3 rounded-full border-2 border-muted bg-muted/30 px-5 py-3 hover:border-muted-foreground/50 transition-all"
            >
              <Crown className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                Lifetime
              </span>
              <span className="text-sm text-foreground">
                <span className="font-bold">SOLD OUT</span> — join the waitlist
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}

          {/* Stats strip — editorial proof */}
          <div className="mt-20 grid grid-cols-3 gap-px bg-border rounded-md overflow-hidden border-[1.5px] border-border max-w-3xl mx-auto">
            {[
              { value: '12k+', label: 'Bookings managed' },
              { value: '$4M', label: 'Revenue processed' },
              { value: '99.9%', label: 'Uptime' },
            ].map((stat, i) => (
              <div key={i} className="bg-card px-4 py-6 sm:py-8">
                <div className="pv-display text-3xl sm:text-5xl text-foreground tabular-nums">{stat.value}</div>
                <div className="mt-2 text-xs sm:text-sm text-muted-foreground uppercase tracking-wider">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TidyWise Score - lead-gen ranking section */}
      <Suspense fallback={<SectionSkeleton />}>
        <TidyWiseScoreSection />
      </Suspense>

      {/* Features Section - Enhanced with scroll reveal */}
      <section 
        id="features" 
        className="py-16 md:py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30"
      >
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            {/* --accent is a SURFACE inside .portal-v2 (it resolves to --pv-sunken),
                so accent-on-accent rendered this pill at 1.06:1 — invisible on a
                live public page. --primary is the brand token and is text-safe. */}
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-4">
              <Zap className="h-4 w-4" />
              Powerful Features
            </div>
            <h2 className="pv-display text-3xl sm:text-4xl lg:text-5xl text-foreground mb-4">
              Everything you need to{" "}
              <span className="text-gradient-hero">run your business</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              More than just software. TIDYWISE is the all-in-one platform—from automated booking to GPS route optimization.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {baseFeatures.map((feature, index) => (
              <Card 
                key={feature.title}
                variant="feature"
                className="p-6 animate-stagger-in"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                  <feature.icon className="h-7 w-7 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
              </Card>
            ))}
          </div>

          {/* Features checklist */}
          <Card variant="glass" className="mt-12 p-8">
            <h3 className="text-xl font-semibold text-foreground mb-6 text-center">
              Built specifically for cleaning businesses...
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {cleaningConfig.features.map((item, i) => (
                <div 
                  key={item} 
                  className="flex items-center gap-2 group animate-stagger-in"
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="text-foreground text-sm">{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* Schedule Demo Section */}
      <section id="schedule-demo" className="py-16 md:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left — Value Props */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6">
                <Calendar className="h-4 w-4" />
                Free 30-Minute Demo
              </div>
              <h2 className="pv-display text-3xl sm:text-4xl text-foreground leading-tight mb-4">
                See TidyWise{" "}
                <span className="text-gradient-hero">in Action</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Book a free 30-minute call with Emmanuel. We'll walk through the entire platform live and answer every question you have.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  "Free demo call — no commitment",
                  "Live walkthrough of your workflow",
                  "See how to automate your bookings",
                  "Get set up same day if you're ready",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                    <span className="text-foreground">{item}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50 border border-border">
                <img src={emmanuelPhoto} alt="Emmanuel Forkuoh" className="w-16 h-16 rounded-full object-cover" width={64} height={64} loading="lazy" />
                <div>
                  <p className="font-semibold text-foreground">Emmanuel Forkuoh</p>
                  <p className="text-sm text-muted-foreground">Founder of TidyWise</p>
                  <p className="text-xs text-muted-foreground mt-0.5">You'll meet with Emmanuel personally</p>
                </div>
              </div>
            </div>
            {/* Right — Form */}
            <div>
              <Suspense fallback={<div className="h-96 animate-pulse bg-muted rounded-xl" />}>
                <DemoBookingFormLazy />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Demo Section - Lazy loaded */}
      <Suspense fallback={<SectionSkeleton />}>
        <InteractiveDemo />
      </Suspense>

      {/* Competitor Comparison Section - Lazy loaded */}
      <Suspense fallback={<SectionSkeleton />}>
        <CompetitorComparison />
      </Suspense>

      {/* AI Business Tools Section - Lazy loaded */}
      <Suspense fallback={<SectionSkeleton />}>
        <AIBusinessTools />
      </Suspense>

      {/* Stats Section - Enhanced with animations */}
      <section className="py-16 md:py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-4">
                <Shield className="h-4 w-4" />
                Trusted worldwide
              </div>
              <h2 className="pv-display text-3xl sm:text-4xl lg:text-5xl text-foreground mb-4">
                Scale from startup to{" "}
                <span className="text-gradient-hero">$1M+ revenue</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Whether you're just starting or ready to scale, TIDYWISE gives you the same tools multi-million dollar cleaning services use.
              </p>
              <div className="space-y-4">
                {[
                  "Set it and forget it online booking",
                  "GPS route optimization saves 30% travel time",
                  "Automated review requests for Google Guaranteed",
                  "Professional quotes & invoices in seconds"
                ].map((item, i) => (
                  <div 
                    key={item} 
                    className="flex items-center gap-3 animate-stagger-in"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-success/20 to-success/10 flex items-center justify-center">
                      <Zap className="h-4 w-4 text-success" />
                    </div>
                    <span className="text-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10 rounded-3xl blur-xl" />
              <div className="relative grid grid-cols-2 gap-4">
                 {[
                   { value: '24/7', label: 'Online booking', delay: '0s' },
                   { value: '$49', label: 'Starting price', delay: '0.1s' },
                   { value: '∞', label: 'Unlimited bookings', delay: '0.2s' },
                   { value: '5 min', label: 'Setup time', delay: '0.3s' },
                 ].map((stat, i) => (
                  <Card 
                    key={i}
                    variant="glass" 
                    className="p-6 text-center hover:scale-105 transition-transform animate-stagger-in"
                    style={{ animationDelay: stat.delay }}
                  >
                    <p className="text-4xl lg:text-5xl font-bold text-gradient-hero mb-1">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials - Premium cards */}
      <section 
        id="testimonials" 
        className="py-16 md:py-24 px-4 sm:px-6 lg:px-8 bg-secondary/30"
      >
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-warning/10 rounded-full text-warning text-sm font-medium mb-4">
              <Star className="h-4 w-4 fill-current" />
              Customer Stories
            </div>
            <h2 className="pv-display text-3xl sm:text-4xl lg:text-5xl text-foreground mb-4">
              Loved by cleaning businesses{" "}
              <span className="text-gradient-hero">everywhere</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              Join cleaning companies that trust TIDYWISE to manage their operations.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {cleaningConfig.testimonials.map((testimonial, index) => (
              <Card 
                key={index}
                variant="elevated"
                className="p-6 animate-stagger-in"
                style={{ animationDelay: `${index * 0.15}s` }}
              >
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: testimonial.rating }).map((_, i) => (
                    <Star key={i} className="h-5 w-5 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-foreground mb-6 leading-relaxed">"{testimonial.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-semibold">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{testimonial.author}</p>
                    <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Blog Section - Lazy loaded */}
      <Suspense fallback={<SectionSkeleton />}>
        <BlogSection />
      </Suspense>

      {/* FAQ Section */}
      <section className="py-16 md:py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="pv-display text-3xl sm:text-4xl text-foreground mb-4">Frequently Asked Questions</h2>
            <p className="text-lg text-muted-foreground">Everything you need to know before getting started.</p>
          </div>
          <div className="space-y-4">
            {[
              {
                q: "How much does TidyWise cost?",
                a: "Two plans. Basic ($49/month, unlimited users) covers online booking, scheduling, invoicing, payments, the cleaner mobile app, GPS check-ins, SMS reminders, and the client portal. Pro ($97/month) adds automated payroll, P&L reporting, AI pricing tools, inventory, route optimization, loyalty programs, the in-app SMS inbox, and priority support."
              },
              {
                q: "How does TidyWise compare to Jobber?",
                a: "TidyWise starts at $49/mo vs Jobber's $69/month starter. Both handle scheduling, invoicing, and client management. TidyWise Pro at $97/mo adds built-in payroll, GPS reporting, AI Intelligence, automations, and route optimization — features that cost extra or require Jobber's higher tiers."
              },
              {
                q: "Does TidyWise work for small cleaning businesses?",
                a: "Yes. Basic is built for solo operators and growing teams alike — unlimited bookings, unlimited users, no seat caps. Upgrade to Pro ($97/mo) when you want payroll, AI pricing, and advanced reporting. Setup takes about 5 minutes."
              },
              {
                q: "Does TidyWise have GPS tracking for cleaners?",
                a: "Yes — included with the Pro plan and up. See where every cleaner is, verify job arrival times, give customers accurate ETAs, and generate automatic mileage reports."
              },
              {
                q: "Can I run payroll through TidyWise?",
                a: "Yes. TidyWise automatically calculates wages from completed jobs — flat per-job rates, hourly, or a percentage of the service price. Tips, mileage reimbursements, and pay period summaries are all handled inside the platform."
              },
              {
                q: "Can I use TidyWise on my phone?",
                a: "Yes — TidyWise is mobile-friendly and works on any phone or tablet through the browser. Staff see schedules, document jobs with photos, and send updates from their phone. Native iOS and Android apps are on the roadmap."
              },
            ].map((item, i) => (
              <details key={i} className="group bg-card border border-border rounded-xl">
                <summary className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer list-none">
                  <span className="font-semibold text-foreground">{item.q}</span>
                  <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 group-open:rotate-90 transition-transform" />
                </summary>
                <div className="px-6 pb-5 text-muted-foreground leading-relaxed">{item.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* SEO long-form content with internal links + FAQ (moved from /login) */}
      <section className="py-12 md:py-16 px-4 sm:px-6 lg:px-8 bg-background">
        <AuthSEOContent variant="login" headingLevel="h2" />
      </section>

      {/* Final CTA - Premium gradient */}
      <section className="py-16 md:py-24 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-accent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,hsl(var(--primary-glow)/0.3)_0%,transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,hsl(var(--accent-glow)/0.2)_0%,transparent_50%)]" />
        
        <div className="max-w-4xl mx-auto text-center relative">
          <h2 className="pv-display text-3xl sm:text-4xl lg:text-5xl text-primary-foreground mb-6">
            Ready to grow your cleaning business?
          </h2>
          <p className="text-lg sm:text-xl text-primary-foreground/80 mb-10 max-w-2xl mx-auto">
            Join cleaning companies that trust TIDYWISE to manage their operations.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="xl" 
              variant="secondary"
              onClick={handleStartFree}
              className="group h-auto whitespace-normal py-3 shadow-2xl"
            >
              {TRIAL_CTA}
              <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Button>
            <div className="flex items-center gap-3 text-primary-foreground/90">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-lg font-medium">Plans from $49/mo · Cancel any time</span>
            </div>
          </div>
        </div>
      </section>
      </main>

      <SiteFooter />
      <ActivityTicker events={growth.events} />
    </div>
  );
}