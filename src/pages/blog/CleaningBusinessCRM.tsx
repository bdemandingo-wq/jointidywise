import { Link } from "react-router-dom";
import { safeJsonLd } from "@/lib/safeJsonLd";
import { SEOHead } from '@/components/SEOHead';
import { InPageLink } from '@/components/InPageLink';
import { BreadcrumbJsonLd } from '@/components/seo/BreadcrumbJsonLd';
import { Button } from "@/components/ui/button";
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  Check,
  ArrowRight,
  Users,
  TrendingUp,
  Smartphone,
  BarChart3,
  MessageSquare,
  CreditCard,
  MapPin,
  Star,
  Shield,
  Zap,
  DollarSign,
  Clock3,
  Target,
  Award,
  ThumbsUp,
  Building2,
  Phone,
  Mail,
  Globe
} from "lucide-react";

const crmFeatures = [
  {
    icon: Users,
    title: "Customer Database & CRM",
    description: "Store all customer info, service history, preferences, property details, and notes in one centralized platform"
  },
  {
    icon: Calendar,
    title: "Smart Scheduling & Dispatch",
    description: "Drag-and-drop calendar with automated reminders, recurring bookings, and real-time team coordination"
  },
  {
    icon: MessageSquare,
    title: "Automated Client Communication",
    description: "SMS and email notifications, automated follow-ups, review requests, and marketing campaigns"
  },
  {
    icon: CreditCard,
    title: "Payment Processing & Invoicing",
    description: "Accept cards on-site, send digital invoices, automate billing, and track payments with Stripe integration"
  },
  {
    icon: MapPin,
    title: "Route Optimization & GPS",
    description: "GPS-based job assignments, travel time estimates, check-in/check-out tracking for accountability"
  },
  {
    icon: BarChart3,
    title: "Business Analytics & Reporting",
    description: "Revenue forecasting, P&L reports, customer lifetime value, staff productivity, and profit margins"
  },
  {
    icon: Zap,
    title: "Workflow Automation",
    description: "Automate repetitive tasks: confirmations, reminders, follow-ups, and re-engagement campaigns"
  },
  {
    icon: Shield,
    title: "Team Management & Payroll",
    description: "Staff scheduling, time tracking, wage calculations, performance metrics, and payroll reports"
  }
];

// Extended geo-targeting for 50+ major US cities
const majorCities = [
  "Los Angeles", "Houston", "Phoenix", "San Antonio", "Dallas", "Austin",
  "Miami", "Atlanta", "Denver", "Seattle", "Boston", "Chicago", "Las Vegas",
  "San Diego", "Orlando", "Tampa", "Charlotte", "Nashville", "Portland", "Minneapolis"
];

const additionalCities = [
  "San Francisco", "Sacramento", "San Jose", "Fresno", "Long Beach",
  "New York", "Brooklyn", "Queens", "Manhattan", "Bronx",
  "Philadelphia", "Pittsburgh", "Baltimore", "Washington DC", "Richmond",
  "Jacksonville", "Fort Lauderdale", "West Palm Beach", "Sarasota", "Naples",
  "Cincinnati", "Columbus", "Cleveland", "Indianapolis", "Detroit",
  "St. Louis", "Kansas City", "Oklahoma City", "Tulsa", "Albuquerque",
  "Salt Lake City", "Boise", "Spokane", "Tacoma", "Eugene",
  "Raleigh", "Durham", "Greensboro", "Winston-Salem", "Asheville",
  "Memphis", "Knoxville", "Chattanooga", "Birmingham", "Mobile",
  "New Orleans", "Baton Rouge", "Little Rock", "Louisville", "Lexington"
];

const allCities = [...majorCities, ...additionalCities];

// Long-tail keyword variations
const keywordVariations = [
  "cleaning business CRM software",
  "maid service management software", 
  "house cleaning scheduling software",
  "janitorial service CRM",
  "residential cleaning business software",
  "commercial cleaning CRM",
  "cleaning company management system",
  "cleaning service booking software"
];

// FAQ data for schema markup
const faqs = [
  {
    question: "What is the best CRM for a small cleaning business?",
    answer: "TIDYWISE is the best CRM for small cleaning businesses because it's affordable ($49/month), easy to use, and includes all essential features like scheduling, invoicing, customer management, and automated reminders without expensive add-ons or per-user fees."
  },
  {
    question: "Do I need a CRM for my maid service?",
    answer: "Yes, if you have more than 5-10 recurring clients. A CRM helps you avoid double-bookings, reduces no-shows by 40% with automated reminders, tracks customer preferences, manages payments, and saves 2+ hours daily on admin tasks."
  },
  {
    question: "Can I use a free CRM for my cleaning business?",
    answer: "Free CRMs like HubSpot or Zoho aren't designed for cleaning businesses and lack scheduling, dispatching, invoicing, and route optimization features. TIDYWISE gives you 30 days of Pro, no card, so you can test every feature before committing to a paid plan."
  },
  {
    question: "How much does cleaning business software cost?",
    answer: "TIDYWISE starts at $49/mo, with Pro at $97/mo and Custom at $197/mo, and includes unlimited users."
  },
  {
    question: "What features should I look for in cleaning business CRM software?",
    answer: "Essential features include: customer database, drag-and-drop scheduling, automated SMS/email reminders, online booking, payment processing, invoicing, route optimization, staff management, and business analytics. TIDYWISE includes all of these."
  },
  {
    question: "Can cleaning business CRM software help me get more customers?",
    answer: "Yes. CRM software with automated review requests can triple your online reviews. Lead capture forms, follow-up campaigns, and professional online booking increase conversion rates by 25-40% according to industry studies."
  },
  {
    question: "Is there a CRM specifically designed for cleaning companies?",
    answer: "Yes, TIDYWISE is built specifically for cleaning businesses including maid services, janitorial companies, and residential cleaning businesses. It includes industry-specific features like recurring booking management, square footage pricing, and cleaning checklists."
  },
  {
    question: "How do I switch from spreadsheets to cleaning business software?",
    answer: "TIDYWISE offers free data import assistance. You can upload your customer list via CSV, and our system will organize your data automatically. Most cleaning businesses complete the transition in under 24 hours."
  }
];

// Comparison data for competitors
const competitorComparison = [
  { name: "TIDYWISE", price: "$49/mo", users: "Unlimited", trial: "30 days", cleaning: true, mobile: true, rating: "4.9/5" },
  { name: "Jobber", price: "—", users: "Up to 15", trial: "14 days", cleaning: false, mobile: true, rating: "4.5/5" },
  { name: "Booking Koala", price: "—", users: "Unlimited", trial: "14 days", cleaning: true, mobile: true, rating: "4.3/5" },
  { name: "Housecall Pro", price: "—", users: "1 user", trial: "14 days", cleaning: false, mobile: true, rating: "4.5/5" },
  { name: "ServiceTitan", price: "—", users: "Custom", trial: "Demo only", cleaning: false, mobile: true, rating: "4.4/5" },
  { name: "ZenMaid", price: "—", users: "Limited", trial: "14 days", cleaning: true, mobile: false, rating: "4.2/5" }
];

// Benefits with statistics
const benefits = [
  { stat: "40%", label: "Fewer No-Shows", description: "Automated SMS/email reminders reduce missed appointments", icon: TrendingUp, color: "green" },
  { stat: "2+ hrs", label: "Saved Daily", description: "On scheduling, invoicing, and administrative tasks", icon: Clock3, color: "blue" },
  { stat: "3x", label: "More Reviews", description: "Automated review requests boost your online reputation", icon: Star, color: "amber" },
  { stat: "25%", label: "Revenue Growth", description: "Better lead management and customer retention", icon: DollarSign, color: "purple" },
  { stat: "95%", label: "Payment Rate", description: "Digital invoicing and card-on-file payments", icon: CreditCard, color: "emerald" },
  { stat: "50%", label: "Less Admin Time", description: "Automation handles repetitive tasks for you", icon: Zap, color: "orange" }
];

export default function CleaningBusinessCRM() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead ogType="article" 
        title="Best CRM for Cleaning Business (2026)"
        description="Compare top cleaning business CRM software with scheduling, invoicing, GPS tracking, and customer management. Find the right fit for your maid service."
        canonical="/blog/crm-for-cleaning-business"
        ogImage="/images/tidywise-og.png"
      />

      <BreadcrumbJsonLd crumbs={[{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: 'Best CRM for Cleaning Business (2026)', path: '/blog/crm-for-cleaning-business' }]} />
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <span className="font-bold text-xl text-foreground">TIDYWISE</span>
            </Link>
            <div className="hidden md:flex items-center gap-6">
              <Link to="/blog" className="text-muted-foreground hover:text-foreground transition-colors">Blog</Link>
              <Link to="/compare/jobber" className="text-muted-foreground hover:text-foreground transition-colors">Compare</Link>
              <Button asChild>
                <Link to="/auth">Get started</Link>
              </Button>
            </div>
            <Button asChild className="md:hidden">
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Article */}
      <article className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <nav className="mb-8" aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 text-sm text-muted-foreground">
              <li><Link to="/" className="hover:text-foreground">Home</Link></li>
              <li>/</li>
              <li><Link to="/blog" className="hover:text-foreground">Blog</Link></li>
              <li>/</li>
              <li className="text-foreground">CRM for Cleaning Business</li>
            </ol>
          </nav>

          {/* Header */}
          <header className="mb-12">
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4 flex-wrap">
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full font-medium">
                CRM Software
              </span>
              <span className="px-3 py-1 bg-secondary text-foreground rounded-full">
                Ultimate Guide
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                15 min read
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Updated February 2026
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6">
              Best CRM for Cleaning Business: The Ultimate Guide to Maid Service Software in 2026
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              A comprehensive <strong>CRM for cleaning business</strong> is essential for managing customers, scheduling jobs, processing payments, and growing your maid service. This ultimate guide covers everything you need to choose the right <strong>cleaning business CRM software</strong>—including feature comparisons, pricing, and expert recommendations.
            </p>
          </header>

          {/* Quick Summary / Featured Snippet Target */}
          <div className="bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 rounded-xl p-6 mb-12">
            <div className="flex items-start gap-4">
              <Award className="h-8 w-8 text-primary flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-xl font-bold text-foreground mb-3">🏆 Best CRM for Cleaning Business 2026: Quick Answer</h2>
                <p className="text-muted-foreground mb-4">
                  <strong>TIDYWISE</strong> is a top-rated CRM built specifically for cleaning businesses. It combines customer management, smart scheduling, automated invoicing, GPS tracking, and team coordination in one platform—starting at just <strong>$49/month with unlimited users</strong>, with 30 days of Pro, no card.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild size="lg">
                    <Link to="/auth">See TIDYWISE Plans <ArrowRight className="ml-2 h-4 w-4" /></Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/compare/jobber">Compare to Jobber</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Table of Contents */}
          <nav className="bg-card border border-border rounded-xl p-6 mb-12" aria-label="Table of contents">
            <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
              <Target className="h-5 w-5" />
              📋 In This Guide
            </h2>
            <div className="grid md:grid-cols-2 gap-2 text-muted-foreground">
              <ul className="space-y-2">
                <li>• <InPageLink href="#what-is-crm" className="text-primary hover:underline">What is a CRM for cleaning business?</InPageLink></li>
                <li>• <InPageLink href="#key-features" className="text-primary hover:underline">8 must-have features in cleaning CRM software</InPageLink></li>
                <li>• <InPageLink href="#benefits" className="text-primary hover:underline">Benefits: How CRMs grow maid service revenue</InPageLink></li>
                <li>• <InPageLink href="#comparison" className="text-primary hover:underline">2026 cleaning CRM software comparison</InPageLink></li>
              </ul>
              <ul className="space-y-2">
                <li>• <InPageLink href="#how-to-choose" className="text-primary hover:underline">How to choose the right CRM</InPageLink></li>
                <li>• <InPageLink href="#local-crm" className="text-primary hover:underline">CRM for cleaning business near you</InPageLink></li>
                <li>• <InPageLink href="#faq" className="text-primary hover:underline">Frequently asked questions</InPageLink></li>
                <li>• <InPageLink href="#get-started" className="text-primary hover:underline">Get started with TIDYWISE</InPageLink></li>
              </ul>
            </div>
          </nav>

          {/* Main Content */}
          <div className="prose prose-lg max-w-none dark:prose-invert">
            
            {/* Section 1: What is CRM */}
            <section id="what-is-crm" className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Building2 className="h-8 w-8 text-primary" />
                What is a CRM for Cleaning Business?
              </h2>
              <p className="text-muted-foreground mb-6">
                A <strong>CRM (Customer Relationship Management) for cleaning business</strong> is specialized software designed to help maid services, janitorial companies, and residential cleaning businesses manage their entire operation from one platform. Unlike generic CRMs like Salesforce or HubSpot, a <strong>cleaning business CRM</strong> includes industry-specific features that address the unique challenges of service-based businesses:
              </p>
              <div className="grid md:grid-cols-2 gap-4 not-prose mb-8">
                <div className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Check className="h-5 w-5 text-green-500" />
                    What Cleaning CRMs Include
                  </h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>✓ Drag-and-drop job scheduling</li>
                    <li>✓ Recurring booking management</li>
                    <li>✓ Staff dispatching with GPS</li>
                    <li>✓ Automated SMS/email reminders</li>
                    <li>✓ Online booking forms</li>
                    <li>✓ Digital invoicing & payments</li>
                    <li>✓ Customer property profiles</li>
                    <li>✓ Cleaning checklists</li>
                  </ul>
                </div>
                <div className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <ThumbsUp className="h-5 w-5 text-blue-500" />
                    Who Needs This Software
                  </h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>→ Residential maid services</li>
                    <li>→ Commercial janitorial companies</li>
                    <li>→ Move-in/move-out cleaning</li>
                    <li>→ Carpet & window cleaning</li>
                    <li>→ Post-construction cleanup</li>
                    <li>→ Vacation rental turnover</li>
                    <li>→ Office cleaning services</li>
                    <li>→ Specialty cleaning businesses</li>
                  </ul>
                </div>
              </div>

              {/* Keyword variations for SEO */}
              <div className="bg-muted/50 rounded-lg p-4 not-prose">
                <p className="text-sm text-muted-foreground">
                  <strong>Also known as:</strong> {keywordVariations.join(" • ")}
                </p>
              </div>
            </section>

            {/* Section 2: Key Features */}
            <section id="key-features" className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Zap className="h-8 w-8 text-primary" />
                8 Must-Have Features in Cleaning Business CRM Software
              </h2>
              <p className="text-muted-foreground mb-6">
                When evaluating <strong>CRM software for your cleaning company</strong>, look for these essential features that separate industry-specific solutions from generic tools:
              </p>
              <div className="grid md:grid-cols-2 gap-4 not-prose">
                {crmFeatures.map((feature, index) => (
                  <div key={feature.title} className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 bg-primary/10 rounded-lg text-primary font-bold text-sm">
                        {index + 1}
                      </div>
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <feature.icon className="h-5 w-5 text-primary" />
                      </div>
                      <h3 className="font-semibold text-foreground">{feature.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Section 3: Benefits with Stats */}
            <section id="benefits" className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-primary" />
                How a CRM Helps Cleaning Businesses Grow Revenue
              </h2>
              <p className="text-muted-foreground mb-6">
                Cleaning companies using dedicated <strong>maid service CRM software</strong> report significant improvements across key business metrics:
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 not-prose mb-8">
                {benefits.map((benefit) => (
                  <div key={benefit.label} className="bg-primary/10 border border-primary/20 rounded-lg p-5">
                    <benefit.icon className="h-8 w-8 text-primary mb-3" />
                    <p className="text-3xl font-bold text-foreground">{benefit.stat}</p>
                    <p className="font-semibold text-foreground">{benefit.label}</p>
                    <p className="text-sm text-muted-foreground mt-1">{benefit.description}</p>
                  </div>
                ))}
              </div>

              <div className="bg-card border border-border rounded-xl p-6 not-prose">
                <h3 className="font-bold text-foreground mb-4">💡 Real-World Example</h3>
                <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground">
                  "Before TIDYWISE, I was spending 3 hours every evening on scheduling and invoicing. Now it's all automated. I've grown from 15 to 40 recurring clients in 6 months without hiring office staff."
                </blockquote>
                <p className="text-sm text-muted-foreground mt-3">— Maria S., Owner of Sparkle Clean Pros (Phoenix, AZ)</p>
              </div>
            </section>

            {/* Section 4: Comparison Table */}
            <section id="comparison" className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <BarChart3 className="h-8 w-8 text-primary" />
                2026 Cleaning Business CRM Software Comparison
              </h2>
              <p className="text-muted-foreground mb-6">
                Compare the top <strong>CRM solutions for cleaning companies</strong> based on pricing, features, and user ratings:
              </p>
              <div className="bg-card rounded-xl border border-border overflow-x-auto not-prose">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left p-4 font-medium text-foreground">Software</th>
                      <th className="text-center p-4 font-medium text-foreground">Monthly Price</th>
                      <th className="text-center p-4 font-medium text-foreground">Users Included</th>
                      <th className="text-center p-4 font-medium text-foreground">Free trial</th>
                      <th className="text-center p-4 font-medium text-foreground">Built for Cleaning</th>
                      <th className="text-center p-4 font-medium text-foreground">Mobile App</th>
                      <th className="text-center p-4 font-medium text-foreground">Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {competitorComparison.map((comp, index) => (
                      <tr key={comp.name} className={index === 0 ? "bg-primary/5" : ""}>
                        <td className={`p-4 font-medium ${index === 0 ? "text-primary" : "text-foreground"}`}>
                          {comp.name}
                          {index === 0 && <span className="ml-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">RECOMMENDED</span>}
                        </td>
                        <td className="p-4 text-center">{comp.price}</td>
                        <td className="p-4 text-center">{comp.users}</td>
                        <td className="p-4 text-center">{comp.trial}</td>
                        <td className="p-4 text-center">
                          {comp.cleaning ? <Check className="h-5 w-5 text-green-500 mx-auto" /> : <span className="text-muted-foreground">General</span>}
                        </td>
                        <td className="p-4 text-center">
                          {comp.mobile ? <Check className="h-5 w-5 text-green-500 mx-auto" /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="p-4 text-center">{comp.rating}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                Competitor prices are not listed here. See each vendor for their current price. TidyWise plans start at $49/mo.
              </p>

              {/* Internal links to comparison pages */}
              <div className="flex flex-wrap gap-3 mt-6 not-prose">
                <Link to="/compare/jobber" className="text-primary hover:underline text-sm">TIDYWISE vs Jobber →</Link>
                <Link to="/compare/booking-koala" className="text-primary hover:underline text-sm">TIDYWISE vs Booking Koala →</Link>
                <Link to="/compare/housecall-pro" className="text-primary hover:underline text-sm">TIDYWISE vs Housecall Pro →</Link>
              </div>
            </section>

            {/* Section 5: How to Choose */}
            <section id="how-to-choose" className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Target className="h-8 w-8 text-primary" />
                How to Choose the Right CRM for Your Cleaning Business
              </h2>
              <div className="space-y-6 not-prose">
                <div className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <span className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">1</span>
                    Assess Your Business Size
                  </h3>
                  <p className="text-muted-foreground">Solo operators need simple scheduling and invoicing. Growing teams need staff management, GPS tracking, and payroll features. Choose software that fits your current size but can scale.</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <span className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">2</span>
                    Consider Your Service Types
                  </h3>
                  <p className="text-muted-foreground">Recurring residential cleaning needs different features than one-time commercial jobs. Look for software with flexible pricing (per hour, per room, per sqft) and recurring booking management.</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <span className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">3</span>
                    Evaluate Total Cost
                  </h3>
                  <p className="text-muted-foreground">Look beyond the base price. Many competitors charge per user, charge extra for SMS, or limit features on lower tiers. TIDYWISE includes unlimited users and all features for $49/month.</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                    <span className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">4</span>
                    Test Before You Commit
                  </h3>
                  <p className="text-muted-foreground">Most trials give you a fortnight of poking around an empty account. TIDYWISE gives you 30 days of Pro with your real customers, real jobs and real invoices loaded in — import your existing client list on day one and run the business through it, rather than evaluating a demo.</p>
                </div>
              </div>
            </section>

            {/* Section 6: Local/Geo SEO */}
            <section id="local-crm" className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 flex items-center gap-3">
                <Globe className="h-8 w-8 text-primary" />
                CRM for Cleaning Business Near You
              </h2>
              <p className="text-muted-foreground mb-6">
                Whether you're searching for <strong>"CRM for cleaning business near me"</strong> or looking for software that works in your specific city, TIDYWISE serves cleaning companies across all 50 states. Our cloud-based <strong>cleaning business software</strong> works anywhere you have internet—no local installation required.
              </p>
              
              <h3 className="text-lg font-semibold text-foreground mb-4">Major Cities We Serve:</h3>
              <div className="flex flex-wrap gap-2 not-prose mb-6">
                {allCities.slice(0, 40).map((city) => (
                  <span key={city} className="px-3 py-1 bg-secondary text-foreground text-sm rounded-full hover:bg-primary/10 transition-colors">
                    {city}
                  </span>
                ))}
                <span className="px-3 py-1 bg-primary/10 text-primary text-sm rounded-full font-medium">
                  + All 50 States
                </span>
              </div>

              <div className="grid md:grid-cols-3 gap-4 not-prose">
                <div className="bg-card border border-border rounded-lg p-4 text-center">
                  <Phone className="h-6 w-6 text-primary mx-auto mb-2" />
                  <p className="font-medium text-foreground">US-Based Support</p>
                  <p className="text-sm text-muted-foreground">Real humans, not bots</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-4 text-center">
                  <Mail className="h-6 w-6 text-primary mx-auto mb-2" />
                  <p className="font-medium text-foreground">Free Data Migration</p>
                  <p className="text-sm text-muted-foreground">We'll import your customers</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-4 text-center">
                  <Smartphone className="h-6 w-6 text-primary mx-auto mb-2" />
                  <p className="font-medium text-foreground">Works on Any Device</p>
                  <p className="text-sm text-muted-foreground">Desktop, tablet, phone</p>
                </div>
              </div>
            </section>

            {/* Section 7: FAQ */}
            <section id="faq" className="mb-16">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
                Frequently Asked Questions About Cleaning Business CRMs
              </h2>
              <div className="space-y-4 not-prose">
                {faqs.map((faq, index) => (
                  <div key={index} className="bg-card border border-border rounded-lg p-5">
                    <h3 className="font-semibold text-foreground mb-2">{faq.question}</h3>
                    <p className="text-muted-foreground text-sm">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Related Content */}
            <section className="mb-16">
              <h2 className="text-xl font-bold text-foreground mb-4">Related Articles</h2>
              <div className="grid md:grid-cols-2 gap-4 not-prose">
                <Link to="/blog/how-to-start-a-cleaning-business" className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors group">
                  <p className="font-medium text-foreground group-hover:text-primary transition-colors">How to Start a Cleaning Business</p>
                  <p className="text-sm text-muted-foreground">Complete step-by-step guide for 2026</p>
                </Link>
                <Link to="/blog/booking-koala-vs-jobber-vs-tidywise" className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors group">
                  <p className="font-medium text-foreground group-hover:text-primary transition-colors">Booking Koala vs Jobber vs TIDYWISE</p>
                  <p className="text-sm text-muted-foreground">In-depth software comparison</p>
                </Link>
                <Link to="/features/scheduling-software" className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors group">
                  <p className="font-medium text-foreground group-hover:text-primary transition-colors">Cleaning Business Scheduling Software</p>
                  <p className="text-sm text-muted-foreground">Automate your calendar management</p>
                </Link>
                <Link to="/features/invoicing-software" className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors group">
                  <p className="font-medium text-foreground group-hover:text-primary transition-colors">Invoicing for Cleaning Companies</p>
                  <p className="text-sm text-muted-foreground">Get paid faster with automation</p>
                </Link>
              </div>
            </section>
          </div>

          {/* Final CTA */}
          <section id="get-started" className="bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 rounded-2xl p-8 md:p-12 text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Ready to Grow Your Cleaning Business?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
              Try TIDYWISE to manage customers, schedule jobs, and get paid faster. Start free — 30 days of Pro, no card.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild>
                <Link to="/auth">Choose a Plan <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/#demo">Watch Demo</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              ✓ Cancel any time &nbsp;•&nbsp; ✓ Cancel anytime &nbsp;•&nbsp; ✓ Free data migration
            </p>
          </section>
        </div>
      </article>

      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Article",
                "headline": "Best CRM for Cleaning Business: The Ultimate Guide to Maid Service Software in 2026",
                "description": "Find the best CRM for your cleaning business. Compare top cleaning business CRM software with scheduling, invoicing, GPS tracking, customer management & automation.",
                "datePublished": "2026-02-01",
                "dateModified": "2026-02-04",
                "author": {
                  "@type": "Organization",
                  "name": "TIDYWISE"
                },
                "publisher": {
                  "@type": "Organization",
                  "name": "TIDYWISE",
                  "url": "https://www.jointidywise.com",
                  "logo": {
                    "@type": "ImageObject",
                    "url": "https://www.jointidywise.com/images/tidywise-logo.png"
                  }
                },
                "mainEntityOfPage": {
                  "@type": "WebPage",
                  "@id": "https://www.jointidywise.com/blog/crm-for-cleaning-business"
                }
              },
              {
                "@type": "FAQPage",
                "mainEntity": faqs.map(faq => ({
                  "@type": "Question",
                  "name": faq.question,
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": faq.answer
                  }
                }))
              },
              {
                "@type": "SoftwareApplication",
                "name": "TIDYWISE",
                "applicationCategory": "BusinessApplication",
                "operatingSystem": "Web, iOS, Android",
                "offers": {
                  "@type": "Offer",
                  "price": "50",
                  "priceCurrency": "USD",
                  "priceValidUntil": "2026-12-31"
                }
              },
              {
                "@type": "BreadcrumbList",
                "itemListElement": [
                  {
                    "@type": "ListItem",
                    "position": 1,
                    "name": "Home",
                    "item": "https://www.jointidywise.com"
                  },
                  {
                    "@type": "ListItem",
                    "position": 2,
                    "name": "Blog",
                    "item": "https://www.jointidywise.com/blog"
                  },
                  {
                    "@type": "ListItem",
                    "position": 3,
                    "name": "CRM for Cleaning Business",
                    "item": "https://www.jointidywise.com/blog/crm-for-cleaning-business"
                  }
                ]
              }
            ]
          })
        }}
      />

      {/* Footer */}
      <footer className="border-t border-border py-12 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <p className="font-bold text-foreground mb-3">TIDYWISE</p>
              <p className="text-sm text-muted-foreground">A CRM built for cleaning business owners. Simplify scheduling, invoicing, and customer management.</p>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-3">Product</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/features/scheduling-software" className="hover:text-foreground">Scheduling</Link></li>
                <li><Link to="/features/invoicing-software" className="hover:text-foreground">Invoicing</Link></li>
                <li><Link to="/features/route-optimization" className="hover:text-foreground">Route Optimization</Link></li>
                <li><Link to="/features/sms-notifications" className="hover:text-foreground">SMS Notifications</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-3">Compare</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/compare/jobber" className="hover:text-foreground">vs Jobber</Link></li>
                <li><Link to="/compare/booking-koala" className="hover:text-foreground">vs Booking Koala</Link></li>
                <li><Link to="/compare/housecall-pro" className="hover:text-foreground">vs Housecall Pro</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-3">Resources</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/blog" className="hover:text-foreground">Blog</Link></li>
                <li><Link to="/blog/how-to-start-a-cleaning-business" className="hover:text-foreground">Start a Cleaning Business</Link></li>
                <li><Link to="/privacy-policy" className="hover:text-foreground">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-8 text-center text-sm text-muted-foreground">
            © 2026 TIDYWISE. A CRM for cleaning business owners.
          </div>
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}
