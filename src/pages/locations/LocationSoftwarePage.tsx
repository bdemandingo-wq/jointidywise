import { useParams, Link, Navigate } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { Button } from "@/components/ui/button";
import { locationData } from "@/data/locationData";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';
import {
  Calendar,
  CreditCard,
  Users,
  Smartphone,
  BarChart3,
  MapPin,
  DollarSign,
  Bell,
  Shield,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

const features = [
  {
    icon: Calendar,
    title: "Online Booking & Scheduling",
    description: "Let customers book online 24/7. Auto-assign cleaners by location and availability. Drag-and-drop calendar for quick changes.",
  },
  {
    icon: Users,
    title: "Client CRM",
    description: "Full client profiles, booking history, notes, and communication log. Know your customers like the back of your hand.",
  },
  {
    icon: DollarSign,
    title: "Automated Payroll",
    description: "Set flat, hourly, or percentage wages. Wages calculate automatically from completed jobs. No spreadsheets.",
  },
  {
    icon: CreditCard,
    title: "Invoicing & Payments",
    description: "Auto-generate invoices, collect payment via Stripe, send professional quotes in seconds.",
  },
  {
    icon: MapPin,
    title: "GPS Tracking & Route Optimization",
    description: "Real-time cleaner location. AI-optimized routes. Automatic mileage tracking for reimbursements.",
  },
  {
    icon: Smartphone,
    title: "Staff Mobile App",
    description: "iOS and Android app for cleaners. GPS check-ins, photo documentation, on-my-way texts, and job instructions.",
  },
  {
    icon: Bell,
    title: "Automated SMS & Email",
    description: "Appointment reminders, booking confirmations, and review requests sent automatically. Reduce no-shows.",
  },
  {
    icon: BarChart3,
    title: "Reports & Analytics",
    description: "P&L reports, revenue forecasting, churn predictions, and business analytics built in — not bolted on.",
  },
  {
    icon: Shield,
    title: "Client Portal",
    description: "Clients get their own login to view bookings, request new appointments, and manage their account.",
  },
];

export default function LocationSoftwarePage() {
  const { locationSlug } = useParams<{ locationSlug: string }>();
  const data = locationSlug ? locationData[locationSlug] : null;
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  if (!data) {
    return <Navigate to="/cleaning-business-software" replace />;
  }

  const isState = data.type === "state";
  const canonicalPath = `/cleaning-business-software/${locationSlug}`;

  const schemaJson = [
    {
      "@type": "SoftwareApplication",
      name: "TidyWise",
      description: `Cleaning business software for ${data.name} from $49/mo. Scheduling, invoicing, automated payroll, GPS tracking, and client management built specifically for cleaning companies.`,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, iOS, Android",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Plans from $49/mo — unlimited users",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: data.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://www.jointidywise.com/" },
        { "@type": "ListItem", position: 2, name: "Locations", item: "https://www.jointidywise.com/cleaning-business-software" },
        { "@type": "ListItem", position: 3, name: data.name, item: `https://www.jointidywise.com${canonicalPath}` },
      ],
    },
  ];

  const relatedForLocation = allArticles.filter(
    (a) =>
      a.slug !== canonicalPath &&
      (a.category === "Features" ||
        a.category === "Software" ||
        a.category === "Comparison" ||
        a.category === "Software Reviews" ||
        a.category === "Operations")
  );

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`Cleaning Business Software for ${data.name} | TidyWise`}
        description={data.seoDescription ?? `Cleaning business software for ${data.name} from $49/mo — booking, scheduling, payroll, GPS, and CRM. ${isState ? `Used by cleaning companies across ${data.name}.` : `Built for ${data.name}${data.stateAbbr ? ", " + data.stateAbbr : ""} cleaners.`}`}
        canonical={canonicalPath}
        schemaJson={schemaJson}
      />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="font-bold text-xl text-foreground">
              TIDYWISE
            </Link>
            <div className="flex items-center gap-3">
              <Link
                to="/cleaning-business-software"
                className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> All Markets
              </Link>
              <Button asChild size="sm">
                <Link to="/signup">Get started</Link>
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-16">
        {/* Breadcrumb */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <nav className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
            <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <Link to="/cleaning-business-software" className="hover:text-foreground transition-colors">
              Cleaning Business Software
            </Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            {!isState && data.stateSlug && (
              <>
                <Link
                  to={`/cleaning-business-software/${data.stateSlug}`}
                  className="hover:text-foreground transition-colors"
                >
                  {data.stateName}
                </Link>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </>
            )}
            <span className="text-foreground font-medium">{data.name}</span>
          </nav>
        </div>

        {/* Hero */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6">
              <MapPin className="h-4 w-4" />
              {isState ? `${data.name} Cleaning Businesses` : `${data.name}, ${data.stateAbbr}`}
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 leading-tight">
              Cleaning Business Software for{" "}
              <span className="text-primary">{data.name}</span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto leading-relaxed">
              {data.intro}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" asChild>
                <Link to="/signup">
                  Get started <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/demo">See a Demo</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              Plans from $49/mo · Unlimited users · Cancel anytime
            </p>
          </div>
        </section>

        {/* Market Context */}
        <section className="py-8 px-4 sm:px-6 lg:px-8 bg-secondary/30 border-y border-border">
          <div className="max-w-4xl mx-auto">
            <p className="text-base text-muted-foreground text-center leading-relaxed">
              {data.marketContext}
            </p>
          </div>
        </section>

        {/* For state pages: city grid */}
        {isState && data.topCities && data.topCities.length > 0 && (
          <section className="py-14 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
              <h2 className="text-2xl font-bold text-foreground mb-2 text-center">
                Serving cleaning businesses across {data.name}
              </h2>
              <p className="text-muted-foreground text-center mb-8">
                TidyWise works for cleaning businesses in every city — here are the major markets.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {data.topCities.map((city) => {
                  const citySlug = data.topCitySlugs?.find(
                    (s) =>
                      s
                        .split("-")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" ") === city ||
                      city.toLowerCase().replace(/\s+/g, "-") === s
                  );
                  if (citySlug) {
                    return (
                      <Link
                        key={city}
                        to={`/cleaning-business-software/${citySlug}`}
                        className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border hover:border-primary/50 hover:shadow-sm transition-all text-sm font-medium text-foreground group"
                      >
                        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="group-hover:text-primary transition-colors">{city}</span>
                        <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground group-hover:text-primary transition-colors" />
                      </Link>
                    );
                  }
                  return (
                    <div
                      key={city}
                      className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border text-sm text-muted-foreground"
                    >
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                      {city}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* For city pages: link to state */}
        {!isState && data.stateSlug && (
          <section className="py-6 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>Also serving all of</span>
                <Link
                  to={`/cleaning-business-software/${data.stateSlug}`}
                  className="text-primary font-medium hover:underline"
                >
                  {data.stateName}
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Features */}
        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
                Everything your {data.name} cleaning business needs
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                One platform to manage your entire operation — booking, scheduling, payroll, invoicing, and more.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="p-6 bg-card rounded-xl border border-border hover:border-primary/30 hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <feature.icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-foreground">{feature.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing highlight */}
        <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30 border-y border-border">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
              Get started. Upgrade when you&apos;re ready.
            </h2>
            <p className="text-muted-foreground mb-10 max-w-2xl mx-auto">
              Most {data.name} cleaning businesses run their entire operation on TidyWise Basic ($49/mo).
              No per-user fees, no per-booking fees, no contracts.
            </p>
            <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto text-left">
              <div className="p-6 bg-card rounded-xl border border-border">
                <div className="text-lg font-bold text-foreground mb-1">Basic</div>
                <div className="text-3xl font-bold text-foreground mb-4">$0<span className="text-base font-normal text-muted-foreground">/month</span></div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {[
                    "Online booking page",
                    "Scheduling calendar",
                    "Client invoicing",
                    "Stripe payment collection",
                    "Cleaner mobile app",
                    "GPS check-ins",
                    "SMS reminders",
                    "Client portal",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-6 bg-primary rounded-xl text-primary-foreground relative overflow-hidden">
                <div className="absolute top-3 right-3 text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">
                  Most Popular
                </div>
                <div className="text-lg font-bold mb-1">Premium</div>
                <div className="text-3xl font-bold mb-4">$49<span className="text-base font-normal opacity-80">/month</span></div>
                <ul className="space-y-2 text-sm opacity-90">
                  {[
                    "Everything in Basic",
                    "Automated payroll",
                    "P&L reporting",
                    "AI pricing tools",
                    "Inventory tracking",
                    "In-app SMS inbox",
                    "Route optimization",
                    "Priority support",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-6">
              30 days of Pro, no card. Cancel any time.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-8 text-center">
              Common questions from {data.name} cleaning businesses
            </h2>
            <div className="space-y-3">
              {data.faqs.map((faq, i) => (
                <div
                  key={i}
                  className="bg-card rounded-xl border border-border overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-start justify-between gap-4 p-5 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="font-semibold text-foreground text-sm sm:text-base">
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 text-muted-foreground shrink-0 mt-0.5 transition-transform ${
                        openFaq === i ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 px-4 sm:px-6 lg:px-8 bg-primary">
          <div className="max-w-3xl mx-auto text-center text-primary-foreground">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              Ready to run your {data.name} cleaning business on autopilot?
            </h2>
            <p className="opacity-90 mb-8 max-w-xl mx-auto">
              Join cleaning businesses {isState ? `across ${data.name}` : `in ${data.name}`} using TidyWise to
              save 10+ hours per week on scheduling, payroll, and invoicing.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" variant="secondary" asChild>
                <Link to="/signup">
                  Get started <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/40 text-white hover:bg-white/10"
                asChild
              >
                <Link to="/demo">Book a Demo</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Related Articles */}
        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <RelatedArticles articles={relatedForLocation} />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© <CopyrightYear /> TIDYWISE. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link to="/cleaning-business-software" className="hover:text-foreground transition-colors">
              All Markets
            </Link>
            <Link to="/pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link to="/blog" className="hover:text-foreground transition-colors">
              Blog
            </Link>
            <Link to="/privacy-policy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
          </div>
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
