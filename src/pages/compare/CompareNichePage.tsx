import { useParams, Link, Navigate, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SEOHead } from "@/components/SEOHead";
import { BreadcrumbJsonLd } from "@/components/seo/BreadcrumbJsonLd";
import { RelatedArticles, allArticles } from "@/components/blog/RelatedArticles";
import { COMPETITORS, NICHES, TIDYWISE_FEATURE_MAP } from "@/data/compareNicheData";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";

/**
 * Programmatic SEO page: /compare/:competitorSlug/for/:nicheSlug
 * e.g. /compare/jobber/for/airbnb-cleaners
 *
 * One template, data-driven from compareNicheData.ts. Metadata for
 * crawlers is baked at build time by prerender-routes.ts; SEOHead
 * keeps the hydrated DOM in sync.
 */
export default function CompareNichePage() {
  const { competitorSlug = "", nicheSlug = "" } = useParams();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const competitor = COMPETITORS[competitorSlug];
  const niche = NICHES[nicheSlug];

  // Unknown combo → send to the closest handcrafted page or home.
  if (!competitor || !niche) {
    return <Navigate to={competitor ? `/compare/${competitorSlug}` : "/"} replace />;
  }

  const path = `/compare/${competitor.slug}/for/${niche.slug}`;
  const pageTitle = `TidyWise vs ${competitor.name} for ${niche.name}`.slice(0, 60);
  const description =
    `${competitor.name} vs TidyWise for ${niche.inline}: pricing, ${niche.tableRows[1]?.toLowerCase() ?? "features"}, payroll, and what each is best at. Flat $49/mo vs ${competitor.pricing}.`.slice(
      0,
      160
    );

  const handleStartFreeTrial = () => {
    sessionStorage.setItem("selectedIndustry", "Home Cleaning");
    navigate("/auth", { state: { mode: "signup" } });
  };

  const renderValue = (value: boolean | string | undefined) => {
    if (value === true) return <CheckCircle2 className="h-5 w-5 text-success mx-auto" />;
    if (value === false || value === undefined)
      return <XCircle className="h-5 w-5 text-destructive mx-auto" />;
    return <span className="text-muted-foreground text-sm">{value}</span>;
  };

  const interpolate = (text: string) => text.replace(/\{competitor\}/g, competitor.name);

  const faqJsonLd = {
    "@type": "FAQPage",
    mainEntity: niche.faqs.map((f) => ({
      "@type": "Question",
      name: interpolate(f.question),
      acceptedAnswer: { "@type": "Answer", text: interpolate(f.answer) },
    })),
  };

  // Sibling links for internal linking: same niche across competitors,
  // and same competitor across niches.
  const siblingCompetitors = Object.values(COMPETITORS).filter((c) => c.slug !== competitor.slug).slice(0, 3);
  const siblingNiches = Object.values(NICHES).filter((n) => n.slug !== niche.slug).slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={pageTitle}
        description={description}
        canonical={path}
        ogImage="/images/tidywise-og.png"
        schemaJson={faqJsonLd}
      />
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: `TidyWise vs ${competitor.name}`, path: `/compare/${competitor.slug}` },
          { name: pageTitle, path },
        ]}
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
            <button className="md:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
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

      {/* Hero */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-6">
            TidyWise vs {competitor.name} for {niche.name}
          </h1>
          <p className="text-lg text-muted-foreground mb-4">{niche.intro}</p>
          <p className="text-lg text-muted-foreground mb-8">{competitor.positioning}</p>
          <Button size="lg" className="h-12 px-8" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <p className="text-sm text-muted-foreground mt-4">
            Plans from $49/mo · 30 days of Pro, no card · Cancel any time
          </p>
        </div>
      </section>

      {/* Pain points */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground mb-8 text-center">
            What {niche.name} Actually Need from Software
          </h2>
          <ul className="grid sm:grid-cols-2 gap-4">
            {niche.painPoints.map((p) => (
              <li key={p} className="flex items-start gap-3 bg-background rounded-lg border border-border p-4">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground mb-8 text-center">
            TidyWise vs {competitor.name}: The Features That Matter for {niche.name}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="p-4 font-semibold text-foreground">Feature</th>
                  <th className="p-4 font-semibold text-foreground text-center">TidyWise</th>
                  <th className="p-4 font-semibold text-foreground text-center">{competitor.name}</th>
                </tr>
              </thead>
              <tbody>
                {niche.tableRows.map((row) => (
                  <tr key={row} className="border-b border-border last:border-0">
                    <td className="p-4 text-muted-foreground">{row}</td>
                    <td className="p-4 text-center">{renderValue(TIDYWISE_FEATURE_MAP[row])}</td>
                    <td className="p-4 text-center">{renderValue(competitor.features[row])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 grid sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
            <div className="rounded-lg border border-border p-4">
              <p className="font-semibold text-foreground mb-2">Where {competitor.name} falls short:</p>
              <ul className="space-y-1">
                {competitor.weaknesses.map((w) => (
                  <li key={w} className="flex items-start gap-2">
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="font-semibold text-foreground mb-2">TidyWise pricing:</p>
              <p>
                Flat $49/month (Basic) with every feature above included. Pro at $97/mo adds unlimited
                users. No per-booking fees, no per-user seats, no add-on charges.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Niche features */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground mb-10 text-center">
            Built for {niche.name}
          </h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {niche.tidywiseFeatures.map((f) => (
              <div key={f.title} className="bg-background rounded-lg border border-border p-6">
                <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-muted-foreground text-sm">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {niche.faqs.map((f, i) => (
              <div key={f.question} className="rounded-lg border border-border">
                <button
                  className="w-full flex items-center justify-between p-4 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="font-medium text-foreground">{interpolate(f.question)}</span>
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform ${openFaq === i ? "rotate-180" : ""}`}
                  />
                </button>
                {openFaq === i && (
                  <p className="px-4 pb-4 text-muted-foreground">{interpolate(f.answer)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
            Ready to Switch from {competitor.name}?
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Built for {niche.inline}. Import your {competitor.name} data in minutes with our free
            done-for-you migration.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8" onClick={handleStartFreeTrial}>
            Get started <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Internal links: sibling pages */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 bg-secondary/30">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold text-foreground mb-3">More for {niche.name}</h3>
            <ul className="space-y-2">
              {siblingCompetitors.map((c) => (
                <li key={c.slug}>
                  <Link
                    to={`/compare/${c.slug}/for/${niche.slug}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    TidyWise vs {c.name} for {niche.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-3">
              TidyWise vs {competitor.name} for other niches
            </h3>
            <ul className="space-y-2">
              {siblingNiches.map((n) => (
                <li key={n.slug}>
                  <Link
                    to={`/compare/${competitor.slug}/for/${n.slug}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    TidyWise vs {competitor.name} for {n.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Related Articles for Internal Linking */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <RelatedArticles articles={allArticles} currentSlug={path} />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-muted-foreground">
            © 2026 TIDYWISE. A {competitor.name} alternative for {niche.inline}.
          </p>
          <div className="flex flex-wrap justify-center gap-6 mt-4">
            <Link to="/" className="text-muted-foreground hover:text-foreground">Home</Link>
            <Link to={`/compare/${competitor.slug}`} className="text-muted-foreground hover:text-foreground">
              vs {competitor.name}
            </Link>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
