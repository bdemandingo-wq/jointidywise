import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, Sparkles, Star, Globe, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/SEOHead";
import { dedupeScoreListings } from "@/lib/scoreLeaderboard";

type Row = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  score: number | null;
  score_grade: string | null;
  google_rating: number | null;
  google_review_count: number | null;
};

function titleCase(slug: string) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ScoreCityPage() {
  const { citySlug } = useParams<{ citySlug: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cityMeta, setCityMeta] = useState<{ city: string; state: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      const [{ data: cityRow }, companiesResult] = await Promise.all([
        supabase.from("score_top_cities").select("city, state").eq("city_slug", citySlug!).maybeSingle(),
        supabase
          .from("score_companies")
          .select("id, slug, name, city, state, score, score_grade, google_rating, google_review_count")
          .eq("city_slug", citySlug!)
          .order("score", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .limit(100),
      ]);
      if (cancelled) return;
      if (companiesResult.error) {
        console.warn("[score] city rankings failed", companiesResult.error);
        setLoadError(true);
        setRows([]);
        setLoading(false);
        return;
      }
      const companies = companiesResult.data ?? [];
      setCityMeta(cityRow ?? (companies[0] ? { city: companies[0].city ?? "", state: companies[0].state ?? "" } : null));
      setRows(dedupeScoreListings(companies));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [citySlug]);

  const label = cityMeta ? `${cityMeta.city}, ${cityMeta.state}` : titleCase(citySlug ?? "");
  const shortTitle = `Cleaning Companies in ${label} | TidyWise Score`.slice(0, 60);
  const description = `See how cleaning companies in ${label} rank by the TidyWise Score — an AI analysis of reviews, reputation, and online presence.`.slice(0, 160);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title={shortTitle} description={description} noIndex />
      <div className="max-w-4xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to TidyWise
        </Link>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">TidyWise Score · City rankings</p>
        <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-2">Cleaning companies in {label}</h1>
        <p className="text-muted-foreground mb-10">
          Ranked by the TidyWise Score — an AI-driven analysis of public reviews, reputation, and online presence.
        </p>

        {loading ? (
          <p className="text-muted-foreground">Loading rankings…</p>
        ) : loadError ? (
          <Card variant="elevated" className="p-10 text-center">
            <p className="text-foreground font-medium">Rankings could not be loaded.</p>
          </Card>
        ) : rows.length === 0 ? (
          <Card variant="elevated" className="p-10 text-center">
            <p className="text-foreground font-medium mb-2">No companies scored in {label} yet.</p>
            <p className="text-sm text-muted-foreground mb-6">Be the first — generate a free TidyWise Score for your business in under a minute.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button asChild variant="premium" size="sm">
                <Link to="/score/generate"><Sparkles className="h-4 w-4 mr-2" /> Generate your score</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/score/search"><Search className="h-4 w-4 mr-2" /> Search the directory</Link>
              </Button>
            </div>
          </Card>
        ) : (
          <Card variant="elevated" className="overflow-hidden">
            <ol>
              {rows.map((c, i) => (
                <li key={c.id} className="border-b border-border/50 last:border-0">
                  <Link to={`/score/c/${c.slug}`} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors">
                    <span className="font-serif text-2xl text-muted-foreground w-10 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.google_rating != null ? `${c.google_rating}★ (${c.google_review_count} reviews)` : "Awaiting reviews"}
                      </p>
                    </div>
                    <div className="text-right">
                      {c.score != null ? (
                        <>
                          <div className="font-serif text-2xl text-foreground tabular-nums leading-none">{c.score}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Grade {c.score_grade}</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {/* Always-rendered context content — gives every city page enough
            substance to be indexable and useful even with no scored companies. */}
        <section className="mt-12 space-y-8">
          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">About the TidyWise Score</h2>
            <p className="text-muted-foreground leading-relaxed">
              The TidyWise Score is a free, AI-generated grade (0–100) for every cleaning company in the United
              States. We pull public signals — Google reviews, review recency, website quality, mobile-friendliness,
              and online booking availability — and weight them into a single score so homeowners and small business
              owners in {label} can compare cleaners at a glance.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <Card variant="elevated" className="p-4">
              <Star className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-medium text-foreground mb-1">Review signals</h3>
              <p className="text-sm text-muted-foreground">
                Average rating, total review count, and how recently the business has earned new reviews.
              </p>
            </Card>
            <Card variant="elevated" className="p-4">
              <Globe className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-medium text-foreground mb-1">Website quality</h3>
              <p className="text-sm text-muted-foreground">
                HTTPS, mobile-friendly viewport, online booking, and load time all factor into the website portion of the score.
              </p>
            </Card>
            <Card variant="elevated" className="p-4">
              <TrendingUp className="h-5 w-5 text-primary mb-2" />
              <h3 className="font-medium text-foreground mb-1">AI sentiment</h3>
              <p className="text-sm text-muted-foreground">
                We grade the text of recent reviews across reliability, communication, quality, and value.
              </p>
            </Card>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">Why this ranking matters</h2>
            <p className="text-muted-foreground leading-relaxed">
              Cleaning businesses live and die by reputation. A high TidyWise Score signals a cleaner who answers
              their phone, shows up on time, charges fair rates, and has a website you can book on. A low score
              usually means stale reviews, no online presence, or unhappy past customers. We update scores as new
              reviews come in, so the {label} leaderboard reflects real, current performance.
            </p>
          </div>

          <div className="border-t pt-6">
            <h2 className="font-serif text-2xl text-foreground mb-3">Explore more</h2>
            <ul className="grid sm:grid-cols-2 gap-2 text-sm">
              <li><Link to="/score/search" className="text-primary hover:underline">Search any cleaning company →</Link></li>
              <li><Link to="/score/generate" className="text-primary hover:underline">Generate your own free score →</Link></li>
              <li><Link to="/cleaning-business-software" className="text-primary hover:underline">Cleaning software by state →</Link></li>
              <li><Link to="/blog" className="text-primary hover:underline">Cleaning business growth guides →</Link></li>
              <li><Link to="/pricing" className="text-primary hover:underline">TidyWise pricing →</Link></li>
              <li><Link to="/contact" className="text-primary hover:underline">Contact the TidyWise team →</Link></li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
