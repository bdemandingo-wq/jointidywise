import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { localBusinessSchema, breadcrumbSchema } from '@/lib/seo/schemas';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from 'sonner';
import { ArrowRight, Clock, Loader2, MessageCircle, Users } from 'lucide-react';
import { z } from 'zod';
import { SUPPORT_EMAIL } from '@/lib/supportEmail';

const schema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(100),
  email: z.string().trim().email('Please enter a valid email'),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(2000),
});

const expectations = [
  {
    icon: Clock,
    title: 'Quick response',
    body: 'We reply to every message within 24 business hours.',
  },
  {
    icon: Users,
    title: 'Real humans',
    body: "You'll talk to someone who actually knows the product.",
  },
  {
    icon: MessageCircle,
    title: 'No sales pressure',
    body: "We won't pitch you. Tell us what you need.",
  },
];

const faqs = [
  {
    q: 'How does billing work?',
    a: 'Pick a plan and get started in minutes. You get the full product: scheduling, customer management, invoicing, payments, and team coordination. At the end of the trial, pick a plan or your data stays read-only until you decide.',
  },
  {
    q: 'Can I import data from my current CRM?',
    a: 'Yes. You can import customers, recurring jobs, and service history from a CSV export of most cleaning CRMs (Jobber, Booking Koala, Housecall Pro, etc.). If your existing tool exports JSON or has an API, send us a sample and we can usually get your data in within a day.',
  },
  {
    q: 'Do you offer onboarding help?',
    a: "Every account gets a free onboarding call. We'll walk through importing your customers, setting up your services and pricing, and configuring your booking page. For larger teams we'll spend extra time on staff roles, payroll, and automations.",
  },
  {
    q: "What if I need a feature you don't have?",
    a: "Tell us. Most of what's in TidyWise today started as a customer ask. We ship updates weekly, and small requests often land within days. Larger features go on the roadmap with a realistic timeline — we'd rather under-promise than disappear.",
  },
  {
    q: 'How do I cancel?',
    a: 'From the Subscription page in your dashboard — one click, no email-us-to-cancel nonsense. Your data stays available for 30 days in case you change your mind, and you can export everything as CSV before you go.',
  },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.errors.forEach((err) => {
        const k = err.path[0] as string;
        fe[k] = err.message;
      });
      setErrors(fe);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      // Dedicated contact-form handler — sends admin alert + user
      // confirmation email. The previous code reused notify-demo-request
      // which required fullName/phone/businessName and silently 400'd,
      // so every contact submission "succeeded" without an email being sent.
      const { data, error } = await supabase.functions.invoke('notify-contact-form', {
        body: parsed.data,
      });
      if (error) throw error;
      if ((data as { success?: boolean; error?: string } | null)?.error) {
        throw new Error((data as { error: string }).error);
      }
      setSent(true);
      toast.success("Thanks — we'll be in touch within 24 hours.");
    } catch (err) {
      console.error('[contact-form] submit failed', err);
      toast.error(`Could not send your message. Please email ${SUPPORT_EMAIL}.`);
    } finally {
      setLoading(false);
    }
  };

  const contactSchema = {
    '@type': 'ContactPage',
    name: 'Contact TidyWise CRM',
    url: 'https://www.jointidywise.com/contact',
    description:
      `Get in touch with the TidyWise team. We help cleaning business owners every day. Email ${SUPPORT_EMAIL} or send a message — we reply within 24 hours.`,
    mainEntity: {
      '@type': 'Organization',
      name: 'TidyWise CRM',
      url: 'https://www.jointidywise.com',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: SUPPORT_EMAIL,
        availableLanguage: ['English'],
        areaServed: 'US',
      },
    },
  };

  return (
    <div className="portal-v2 portal-v2-scroll min-h-screen bg-background">
      <SEOHead
        title="Contact TidyWise CRM | Cleaning Business Software Support"
        description="Reach the TidyWise team for sales, support, or partnership questions. We reply to most messages within one business day."
        canonical="/contact"
        ogImage="/images/og/og-contact.png"
        schemaJson={[
          contactSchema,
          localBusinessSchema(),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: 'Contact', path: '/contact' },
          ]),
        ]}
      />

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-b from-muted/40 to-background">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12 sm:pt-20 sm:pb-16">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to home
          </Link>
          <h1 className="mt-6 text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
            Contact TidyWise CRM
          </h1>
          <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl">
            We're here to help cleaning business owners get the most out of TidyWise. Reach out and
            we'll get back within 24 hours.
          </p>
        </div>
      </section>

      {/* Form + email card */}
      <section className="py-12 sm:py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid gap-8 lg:grid-cols-[1fr_360px]">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl">Send us a message</CardTitle>
            </CardHeader>
            <CardContent>
              {sent ? (
                <div className="space-y-4 py-6 text-center">
                  <p className="text-base text-foreground font-medium">
                    Thanks — we'll be in touch within 24 hours.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    We sent a confirmation to{' '}
                    <span className="font-medium text-foreground">{form.email}</span>.
                  </p>
                  <Button asChild variant="outline">
                    <Link to="/">Back to home</Link>
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={errors.name ? 'border-destructive' : ''}
                      autoComplete="name"
                      required
                    />
                    {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className={errors.email ? 'border-destructive' : ''}
                      autoComplete="email"
                      required
                    />
                    {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      rows={6}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      className={errors.message ? 'border-destructive' : ''}
                      placeholder="Tell us a little about your business and how we can help."
                      required
                    />
                    {errors.message && <p className="text-xs text-destructive">{errors.message}</p>}
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send Message
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <aside className="space-y-6">
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Prefer email?</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-3">
                <p>Reach us directly — we read every note.</p>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="block font-medium text-foreground underline underline-offset-4 break-all"
                >
                  {SUPPORT_EMAIL}
                </a>
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>

      {/* What to expect */}
      <section className="py-12 sm:py-16 bg-muted/30 border-y border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">What to expect</h2>
          <p className="text-muted-foreground mb-8">
            What every message to TidyWise actually gets you.
          </p>
          <div className="grid gap-6 sm:grid-cols-3">
            {expectations.map(({ icon: Icon, title, body }) => (
              <Card key={title} className="border-border/60 shadow-sm">
                <CardContent className="pt-6 space-y-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-foreground">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">Common questions</h2>
          <p className="text-muted-foreground mb-8">
            Quick answers before you reach out — most people ask about these.
          </p>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((item, i) => (
              <AccordionItem key={item.q} value={`item-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 sm:py-20 bg-gradient-to-br from-primary/5 via-background to-secondary/5 border-t border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
            Not ready to talk? Try TidyWise — plans from $49/mo.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Full product. Decide if it's worth a conversation after you've tried it.
          </p>
          <div className="mt-6">
            <Button asChild size="lg" variant="premium">
              <Link to="/demo">
                See pricing
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="contact-related-heading" className="py-12 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 id="contact-related-heading" className="text-lg font-semibold text-foreground mb-4">
            More from TidyWise
          </h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-6 text-sm">
            <li><Link to="/" className="text-primary hover:underline">Home</Link></li>
            <li><Link to="/pricing" className="text-primary hover:underline">Pricing</Link></li>
            <li><Link to="/demo" className="text-primary hover:underline">Book a demo</Link></li>
            <li><Link to="/blog" className="text-primary hover:underline">Cleaning business blog</Link></li>
            <li><Link to="/cleaning-business-software" className="text-primary hover:underline">Software by state</Link></li>
            <li><Link to="/features/scheduling-software" className="text-primary hover:underline">Scheduling features</Link></li>
            <li><Link to="/features/payroll-software" className="text-primary hover:underline">Payroll features</Link></li>
            <li><Link to="/features/crm" className="text-primary hover:underline">CRM features</Link></li>
            <li><Link to="/features/route-optimization" className="text-primary hover:underline">GPS &amp; routing</Link></li>
            <li><Link to="/compare/jobber" className="text-primary hover:underline">TidyWise vs Jobber</Link></li>
            <li><Link to="/compare/housecall-pro" className="text-primary hover:underline">vs Housecall Pro</Link></li>
            <li><Link to="/compare/zenmaid" className="text-primary hover:underline">vs ZenMaid</Link></li>
            <li><Link to="/score/search" className="text-primary hover:underline">TidyWise Score directory</Link></li>
            <li><Link to="/score/generate" className="text-primary hover:underline">Generate your score</Link></li>
            <li><Link to="/privacy-policy" className="text-primary hover:underline">Privacy policy</Link></li>
          </ul>
        </div>
      </section>
    </div>
  );
}
