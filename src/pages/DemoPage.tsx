import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SEOHead } from "@/components/SEOHead";
import { DemoBookingForm } from "@/components/landing/DemoBookingForm";
import {
  CheckCircle2, Star, ArrowRight, Menu, X, Calendar,
  ChevronDown, ChevronUp,
} from "lucide-react";
import emmanuelPhoto from "@/assets/emmanuel-headshot.webp";
import { CopyrightYear } from '@/components/CopyrightYear';

const testimonials = [
  {
    quote: "After seeing the demo I signed up the same day. Complete game changer for my business.",
    author: "Marcus T.",
    role: "Cleaning Business Owner",
    location: "Atlanta, GA",
  },
  {
    quote: "The walkthrough showed me features I didn't even know I needed. Worth every minute.",
    author: "Jasmine R.",
    role: "Business Owner",
    location: "Houston, TX",
  },
  {
    quote: "Emmanuel walked me through everything personally. Best 30 minutes I spent all year.",
    author: "Carlos M.",
    role: "Cleaning Company",
    location: "Miami, FL",
  },
];

const faqs = [
  { q: "How long is the demo?", a: "30 minutes — we respect your time." },
  { q: "Is there any obligation?", a: "Zero. It's a quick intro call with no obligation." },
  { q: "What will I see in the demo?", a: "Bookings, scheduling, payments, client management, automations, and how to set it all up for your specific business." },
  { q: "What if I'm not tech savvy?", a: "Perfect — TidyWise was built for cleaning business owners, not developers." },
];

export default function DemoPage() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead
        title="Book a Free TidyWise Demo | Live Walkthrough"
        description="Schedule a free 30-minute demo with Emmanuel. See the full TidyWise platform live and get your cleaning business automated same day."
        canonical="/demo"
        ogImage="/images/tidywise-og.png"
      />

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <a href="/" className="font-bold text-xl text-foreground">TIDYWISE</a>
            <div className="hidden md:flex items-center gap-6">
              <a href="/#features" className="text-muted-foreground hover:text-foreground text-sm">Features</a>
              <a href="/pricing" className="text-muted-foreground hover:text-foreground text-sm">Pricing</a>
              <a href="/blog" className="text-muted-foreground hover:text-foreground text-sm">Blog</a>
              <Button variant="ghost" onClick={() => navigate("/login")} className="text-sm">Log In</Button>
              <Button onClick={() => navigate("/signup")} className="text-sm">Get started</Button>
            </div>
            <button aria-label="Toggle menu" className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-border flex flex-col gap-3">
              <a href="/#features" className="px-4 py-2 text-muted-foreground">Features</a>
              <a href="/pricing" className="px-4 py-2 text-muted-foreground">Pricing</a>
              <a href="/blog" className="px-4 py-2 text-muted-foreground">Blog</a>
              <Button variant="ghost" className="justify-start" onClick={() => navigate("/login")}>Log In</Button>
              <Button onClick={() => navigate("/signup")}>Get started</Button>
            </div>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 md:pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* Left */}
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-6">
                <Calendar className="h-4 w-4" />
                Free 30-Minute Demo
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold text-foreground leading-tight mb-6">
                Book Your Free<br />
                <span className="text-primary">TidyWise Demo</span>
              </h1>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Book a free 30-minute call with Emmanuel. We'll walk through the entire platform live and answer every question you have.
              </p>

              <div className="space-y-3 mb-10">
                {[
                  "Quick intro call — no obligation",
                  "Live walkthrough of your workflow",
                  "See how to automate your bookings",
                  "Get set up same day if you're ready",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                    <span className="text-foreground">{item}</span>
                  </div>
                ))}
              </div>

              {/* Emmanuel */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-muted/50 border border-border">
                <img
                  src={emmanuelPhoto}
                  alt="Emmanuel Forkuoh"
                  className="w-16 h-16 rounded-full object-cover"
                  width={64}
                  height={64}
                  loading="lazy"
                />
                <div>
                  <p className="font-semibold text-foreground">Emmanuel Forkuoh</p>
                  <p className="text-sm text-muted-foreground">Founder of TidyWise</p>
                  <p className="text-xs text-muted-foreground mt-0.5">You'll meet with Emmanuel personally</p>
                </div>
              </div>
            </div>

            {/* Right — Form */}
            <div>
              <DemoBookingForm />
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground text-center mb-10">What Business Owners Say</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t, i) => (
              <Card key={i} className="p-6 border border-border">
                <div className="flex gap-0.5 mb-3">
                  {[...Array(5)].map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-foreground mb-4 leading-relaxed">"{t.quote}"</p>
                <p className="text-sm font-semibold text-foreground">— {t.author}</p>
                <p className="text-xs text-muted-foreground">{t.role}, {t.location}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground text-center mb-10">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between p-4 text-left text-foreground font-medium hover:bg-muted/50 transition-colors"
                >
                  {faq.q}
                  {openFaq === i ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {openFaq === i && (
                  <div className="px-4 pb-4 text-muted-foreground text-sm">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-primary/5">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">Ready to See TidyWise in Action?</h2>
          <p className="text-muted-foreground mb-6">Scroll up and book your free demo — it only takes 2 minutes.</p>
          <Button
            size="lg"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="h-14 px-8 text-lg"
          >
            <Calendar className="mr-2 h-5 w-5" /> Book My Free Demo <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Mobile Sticky CTA */}
      <div className="tw-above-cookie-notice fixed bottom-0 left-0 right-0 z-40 md:hidden bg-background border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button
          size="lg"
          className="w-full h-12 text-base font-semibold"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <Calendar className="mr-2 h-5 w-5" /> Book a Free Demo <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </div>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground pb-20 md:pb-8">
        <p>© <CopyrightYear /> TidyWise. All rights reserved.</p>
      </footer>
    </div>
  );
}
