import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SEOHead } from '@/components/SEOHead';
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  Star,
  Calendar,
  CreditCard,
  Users,
  Smartphone,
  BarChart3,
  Zap,
  MapPin,
  DollarSign,
  Bell,
  Shield,
  ChevronRight,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';

const features = [
  {
    icon: Calendar,
    title: "Online Booking & Scheduling",
    description: "Let customers book online 24/7. Auto-assign cleaners by location and availability. Drag-and-drop calendar for quick changes."
  },
  {
    icon: Users,
    title: "Client CRM",
    description: "Full client profiles, booking history, notes, and communication log. Know your customers like the back of your hand."
  },
  {
    icon: DollarSign,
    title: "Automated Payroll",
    description: "Set flat, hourly, or percentage wages. Wages calculate automatically from completed jobs. No spreadsheets."
  },
  {
    icon: CreditCard,
    title: "Invoicing & Payments",
    description: "Auto-generate invoices, collect payment via Stripe, send professional quotes in seconds."
  },
  {
    icon: MapPin,
    title: "GPS Tracking & Route Optimization",
    description: "Real-time cleaner location. AI-optimized routes. Automatic mileage tracking for reimbursements."
  },
  {
    icon: Smartphone,
    title: "Mobile-Friendly Web App",
    description: "Cleaners use TIDYWISE from any phone browser. GPS check-ins, photo documentation, on-my-way texts, and job instructions — no app store needed."
  },
  {
    icon: Bell,
    title: "Automated SMS & Email",
    description: "Appointment reminders, booking confirmations, and review requests sent automatically. Reduce no-shows."
  },
  {
    icon: BarChart3,
    title: "Reports & AI Intelligence",
    description: "P&L reports, revenue forecasting, churn predictions, and business analytics built in — not bolted on."
  },
  {
    icon: Shield,
    title: "Client Portal",
    description: "Clients get their own login to view bookings, request new appointments, and manage their account."
  },
];

const competitorTable = [
  { feature: "Monthly Price",         tidywise: "$49–$197",      jobber: "—",             housecall: "—",              bookingKoala: "—" },
  { feature: "Online Booking",        tidywise: true,            jobber: true,            housecall: true,          bookingKoala: true       },
  { feature: "Scheduling",            tidywise: true,            jobber: true,            housecall: true,          bookingKoala: true       },
  { feature: "Automated Payroll",     tidywise: true,            jobber: false,           housecall: false,         bookingKoala: false      },
  { feature: "GPS Tracking",          tidywise: true,            jobber: true,            housecall: true,          bookingKoala: false      },
  { feature: "Route Optimization",    tidywise: true,            jobber: false,           housecall: true,          bookingKoala: false      },
  { feature: "P&L Reports",           tidywise: true,            jobber: false,           housecall: false,         bookingKoala: false      },
  { feature: "Loyalty Program",       tidywise: true,            jobber: false,           housecall: false,         bookingKoala: false      },
  { feature: "AI Business Tools",     tidywise: true,            jobber: false,           housecall: false,         bookingKoala: false      },
  { feature: "Client Portal",         tidywise: true,            jobber: true,            housecall: true,          bookingKoala: true       },
  { feature: "Inventory Tracking",    tidywise: true,            jobber: false,           housecall: false,         bookingKoala: false      },
  { feature: "In-App SMS Inbox",      tidywise: true,            jobber: "Add-on",        housecall: "Add-on",      bookingKoala: false      },
];

const testimonials = [
  {
    quote: "The payroll automation alone saves me 3 hours every two weeks. And the GPS tracking has eliminated all the 'where are they?' calls from clients.",
    author: "Sarah M.",
    role: "Owner, Sparkle Clean Co.",
    rating: 5
  },
  {
    quote: "I switched from Jobber and got the features I was missing. The P&L reports finally showed me where my business was actually making money.",
    author: "Marcus T.",
    role: "Founder, CleanPro Services",
    rating: 5
  },
  {
    quote: "Housecall Pro didn't have payroll. TidyWise does everything in one place — booking, invoicing, payroll, and the staff app. It's the only cleaning software I'd recommend.",
    author: "Jennifer L.",
    role: "CEO, Elite Home Care",
    rating: 5
  },
];

const faqs = [
  {
    q: "What is the best software for a cleaning business?",
    a: "The best cleaning business software handles scheduling, client management, and invoicing in one place. TidyWise Basic is $49/mo with unlimited users. Payroll and GPS tracking are on Pro at $97/mo, along with AI business intelligence."
  },
  {
    q: "How much does cleaning business software cost?",
    a: "TidyWise starts at $49/mo — unlimited users, unlimited bookings, no contracts. The Pro plan is $97/mo and Custom is $197/mo. Pro unlocks automated payroll, P&L reporting, AI pricing tools, route optimization, and the in-app SMS inbox."
  },
  {
    q: "What features should cleaning business software have?",
    a: "Basic at $49/mo includes online booking, team scheduling, client CRM, invoicing, payment collection, and the staff mobile app. Pro at $97/mo adds GPS tracking, automated reminders, payroll, P&L reports, and AI business intelligence."
  },
  {
    q: "Can cleaning business software handle payroll?",
    a: "Most cleaning software does not include payroll — you need a separate tool like Gusto or QuickBooks. TidyWise is the exception: payroll is built in. Set flat rates, hourly wages, or a percentage of each job price, and wages calculate automatically from completed bookings."
  },
  {
    q: "Does cleaning business software work for small operations?",
    a: "Yes. TidyWise works for solo cleaners and growing teams alike. There are no minimums, no seat limits, and no setup fees. Most owners are fully set up within 5 minutes."
  },
];

const locationStates = [
  { slug: "alabama",        name: "Alabama" },
  { slug: "alaska",         name: "Alaska" },
  { slug: "arizona",        name: "Arizona" },
  { slug: "arkansas",       name: "Arkansas" },
  { slug: "california",     name: "California" },
  { slug: "colorado",       name: "Colorado" },
  { slug: "connecticut",    name: "Connecticut" },
  { slug: "delaware",       name: "Delaware" },
  { slug: "florida",        name: "Florida" },
  { slug: "georgia",        name: "Georgia" },
  { slug: "hawaii",         name: "Hawaii" },
  { slug: "idaho",          name: "Idaho" },
  { slug: "illinois",       name: "Illinois" },
  { slug: "indiana",        name: "Indiana" },
  { slug: "iowa",           name: "Iowa" },
  { slug: "kansas",         name: "Kansas" },
  { slug: "kentucky",       name: "Kentucky" },
  { slug: "louisiana",      name: "Louisiana" },
  { slug: "maine",          name: "Maine" },
  { slug: "maryland",       name: "Maryland" },
  { slug: "massachusetts",  name: "Massachusetts" },
  { slug: "michigan",       name: "Michigan" },
  { slug: "minnesota",      name: "Minnesota" },
  { slug: "mississippi",    name: "Mississippi" },
  { slug: "missouri",       name: "Missouri" },
  { slug: "montana",        name: "Montana" },
  { slug: "nebraska",       name: "Nebraska" },
  { slug: "nevada",         name: "Nevada" },
  { slug: "new-hampshire",  name: "New Hampshire" },
  { slug: "new-jersey",     name: "New Jersey" },
  { slug: "new-mexico",     name: "New Mexico" },
  { slug: "new-york",       name: "New York" },
  { slug: "north-carolina", name: "North Carolina" },
  { slug: "north-dakota",   name: "North Dakota" },
  { slug: "ohio",           name: "Ohio" },
  { slug: "oklahoma",       name: "Oklahoma" },
  { slug: "oregon",         name: "Oregon" },
  { slug: "pennsylvania",   name: "Pennsylvania" },
  { slug: "rhode-island",   name: "Rhode Island" },
  { slug: "south-carolina", name: "South Carolina" },
  { slug: "south-dakota",   name: "South Dakota" },
  { slug: "tennessee",      name: "Tennessee" },
  { slug: "texas",          name: "Texas" },
  { slug: "utah",           name: "Utah" },
  { slug: "vermont",        name: "Vermont" },
  { slug: "virginia",       name: "Virginia" },
  { slug: "washington",     name: "Washington" },
  { slug: "west-virginia",  name: "West Virginia" },
  { slug: "wisconsin",      name: "Wisconsin" },
  { slug: "wyoming",        name: "Wyoming" },
];

const locationCities = [
  { slug: "los-angeles",    name: "Los Angeles, CA" },
  { slug: "new-york-city",  name: "New York City, NY" },
  { slug: "chicago",        name: "Chicago, IL" },
  { slug: "houston",        name: "Houston, TX" },
  { slug: "phoenix",        name: "Phoenix, AZ" },
  { slug: "san-antonio",    name: "San Antonio, TX" },
  { slug: "dallas",         name: "Dallas, TX" },
  { slug: "austin",         name: "Austin, TX" },
  { slug: "san-diego",      name: "San Diego, CA" },
  { slug: "charlotte",      name: "Charlotte, NC" },
  { slug: "seattle",        name: "Seattle, WA" },
  { slug: "denver",         name: "Denver, CO" },
  { slug: "nashville",      name: "Nashville, TN" },
  { slug: "atlanta",        name: "Atlanta, GA" },
  { slug: "las-vegas",      name: "Las Vegas, NV" },
  { slug: "miami",          name: "Miami, FL" },
  { slug: "philadelphia",   name: "Philadelphia, PA" },
  { slug: "portland",       name: "Portland, OR" },
  { slug: "minneapolis",    name: "Minneapolis, MN" },
  { slug: "salt-lake-city", name: "Salt Lake City, UT" },
  { slug: "tampa",          name: "Tampa, FL" },
  { slug: "raleigh",        name: "Raleigh, NC" },
  { slug: "kansas-city",    name: "Kansas City, MO" },
  { slug: "new-orleans",    name: "New Orleans, LA" },
  { slug: "charleston-sc",  name: "Charleston, SC" },
  { slug: "boise",          name: "Boise, ID" },
  { slug: "indianapolis",   name: "Indianapolis, IN" },
  { slug: "baltimore",      name: "Baltimore, MD" },
];

export default function CleaningBusinessSoftware() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleStartFree = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  const renderCell = (value: boolean | string) => {
    if (value === true) return <CheckCircle2 className="h-5 w-5 text-success mx-auto" />;
    if (value === false) return <XCircle className="h-5 w-5 text-destructive mx-auto" />;
    return <span className="text-muted-foreground text-xs">{value}</span>;
  };

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead
        title="Cleaning Business Software — Plans from $49/mo | TIDYWISE"
        description="Cleaning business software with scheduling, CRM, and invoicing from $49/mo. Payroll and GPS tracking are on Pro at $97/mo. Unlimited users. Built for cleaning companies."
        canonical="/cleaning-business-software"
        ogImage="/images/tidywise-og.png"
        schemaJson={[
          {
            "@type": "SoftwareApplication",
            "name": "TIDYWISE Cleaning Business Software",
            "applicationCategory": "BusinessApplication",
            "operatingSystem": "Web (mobile-friendly)",
            "offers": { "@type": "AggregateOffer", "lowPrice": "49", "highPrice": "300", "priceCurrency": "USD", "offerCount": "4" },
            "description": "Cleaning business software with scheduling, CRM, invoicing, and staff management from $49/mo. Automated payroll and GPS tracking are on Pro at $97/mo."
          },
          {
            "@type": "FAQPage",
            "mainEntity": faqs.map(f => ({
              "@type": "Question",
              "name": f.q,
              "acceptedAnswer": { "@type": "Answer", "text": f.a }
            }))
          }
        ]}
      />

      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="font-bold text-xl text-foreground">TIDYWISE</a>
            <div className="hidden md:flex items-center gap-8">
              <a href="/blog" className="text-muted-foreground hover:text-foreground">Blog</a>
              <a href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</a>
              <Button variant="ghost" onClick={() => navigate("/login")}>Log In</Button>
              <Button onClick={handleStartFree}>Get started</Button>
            </div>
            <button aria-label="Toggle menu" className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-border space-y-3">
              <a href="/blog" className="block px-4 py-2 text-muted-foreground hover:text-foreground">Blog</a>
              <a href="/pricing" className="block px-4 py-2 text-muted-foreground hover:text-foreground">Pricing</a>
              <div className="px-4 flex gap-2">
                <Button variant="ghost" onClick={() => navigate("/login")} className="flex-1">Log In</Button>
                <Button onClick={handleStartFree} className="flex-1">Get started</Button>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6">
            <Zap className="h-4 w-4" />
            Cleaning Business Software
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Cleaning Business Software<br />
            <span className="text-primary">That Runs Itself</span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Scheduling, CRM, invoicing, and a staff app from $49/mo. Payroll and GPS tracking are on Pro at $97/mo. Built specifically for cleaning businesses. Cancel any time. Yearly = 2 months free.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
            <Button size="lg" className="h-12 px-8" onClick={handleStartFree}>
              See Plans <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8" onClick={() => document.getElementById('compare')?.scrollIntoView({ behavior: 'smooth' })}>
              Compare to Competitors
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Plans from $49/mo · Unlimited users · Cancel anytime</p>
        </div>
      </section>

      {/* Quick proof bar */}
      <section className="py-10 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-3xl font-bold text-primary">$0</div>
              <p className="text-sm text-muted-foreground">Monthly cost</p>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">9+</div>
              <p className="text-sm text-muted-foreground">Built-in features</p>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">5 min</div>
              <p className="text-sm text-muted-foreground">Setup time</p>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">Web app</div>
              <p className="text-sm text-muted-foreground">Works on any phone</p>
            </div>
          </div>
        </div>
      </section>

      {/* What cleaning business software should do */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              Everything a Cleaning Business Needs — In One Place
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Most cleaning software forces you to stitch together 3–5 different tools. TidyWise replaces all of them.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-card rounded-xl p-6 border border-border">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-muted-foreground text-sm">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Competitor comparison */}
      <section id="compare" className="py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-4">
              How TidyWise Compares to Other Cleaning Business Software
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              TidyWise Basic is $49/mo, Pro is $97/mo, and Custom is $197/mo. Payroll and GPS are on Pro.
            </p>
          </div>

          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-secondary/50">
                    <th className="text-left p-4 font-semibold text-foreground min-w-[160px]">Feature</th>
                    <th className="text-center p-4 font-semibold text-primary min-w-[100px]">TIDYWISE</th>
                    <th className="text-center p-4 font-semibold text-muted-foreground min-w-[100px]">Jobber</th>
                    <th className="text-center p-4 font-semibold text-muted-foreground min-w-[100px]">Housecall Pro</th>
                    <th className="text-center p-4 font-semibold text-muted-foreground min-w-[110px]">Booking Koala</th>
                  </tr>
                </thead>
                <tbody>
                  {competitorTable.map((row, i) => (
                    <tr key={row.feature} className={i % 2 === 0 ? "bg-background" : "bg-secondary/20"}>
                      <td className="p-4 text-foreground font-medium text-sm">{row.feature}</td>
                      <td className="p-4 text-center">{renderCell(row.tidywise)}</td>
                      <td className="p-4 text-center">{renderCell(row.jobber)}</td>
                      <td className="p-4 text-center">{renderCell(row.housecall)}</td>
                      <td className="p-4 text-center">{renderCell(row.bookingKoala)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Button size="lg" onClick={handleStartFree}>
              Get started <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            Cleaning Businesses That Switched to TidyWise
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((t, i) => (
              <div key={i} className="bg-card rounded-xl p-6 border border-border flex flex-col">
                <div className="flex gap-1 mb-4">
                  {[...Array(t.rating)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-foreground mb-4 flex-1 leading-relaxed">"{t.quote}"</p>
                <div>
                  <p className="font-semibold text-foreground text-sm">{t.author}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-12">
            Cleaning Business Software — Common Questions
          </h2>
          <div className="space-y-4">
            {faqs.map((item, i) => (
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

      {/* Location Hub */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
              Cleaning Business Software Across the US
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              TidyWise works for cleaning businesses in every market. Find resources specific to your state or city.
            </p>
          </div>

          <div className="mb-8">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">By State</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {locationStates.map(({ slug, name }) => (
                <Link
                  key={slug}
                  to={`/cleaning-business-software/${slug}`}
                  className="flex items-center gap-1.5 px-3 py-2 bg-card rounded-lg border border-border hover:border-primary/50 hover:text-primary text-sm text-foreground transition-all"
                >
                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                  {name}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">By City</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {locationCities.map(({ slug, name }) => (
                <Link
                  key={slug}
                  to={`/cleaning-business-software/${slug}`}
                  className="flex items-center gap-1.5 px-3 py-2 bg-card rounded-lg border border-border hover:border-primary/50 hover:text-primary text-sm text-foreground transition-all"
                >
                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                  {name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
            The Last Cleaning Business Software You'll Need
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Basic is $49/mo for scheduling, CRM, and invoicing. Payroll and GPS are on Pro at $97/mo. Cancel any time.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8" onClick={handleStartFree}>
            See Plans <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Related content */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug="/cleaning-business-software" />
        </div>
      </section>

      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground text-sm">© <CopyrightYear /> TidyWise. Cleaning business software for maid services and cleaning companies — plans from $49/mo.</p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Home</Link>
            <Link to="/features/scheduling-software" className="text-sm text-muted-foreground hover:text-foreground">Scheduling</Link>
            <Link to="/features/payroll-software" className="text-sm text-muted-foreground hover:text-foreground">Payroll</Link>
            <Link to="/features/route-optimization" className="text-sm text-muted-foreground hover:text-foreground">GPS Tracking</Link>
            <Link to="/compare/jobber" className="text-sm text-muted-foreground hover:text-foreground">vs Jobber</Link>
            <Link to="/compare/housecall-pro" className="text-sm text-muted-foreground hover:text-foreground">vs Housecall Pro</Link>
            <Link to="/blog" className="text-sm text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
