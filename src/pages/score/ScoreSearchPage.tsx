import { useEffect, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/SEOHead";

type Result = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  score: number | null;
  score_grade: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  source: string;
};

type LeaderboardRow = Omit<Result, "source">;

export default function ScoreSearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const name = params.get("name") ?? "";
  const location = params.get("location") ?? "";
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Result[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [locationLabel, setLocationLabel] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLeaderboard([]);
      const { data, error } = await supabase.functions.invoke("score-lookup", {
        body: { name, location },
      });
      const rs: Result[] = error ? [] : (data?.results ?? []);

      // If the named lookup matched nothing, show the local leaderboard instead
      // of forcing the user to claim a profile to see anything.
      if (!cancelled && rs.length === 0 && location) {
        const loc = location.trim();
        const isZip = /^\d{5}$/.test(loc);
        let q = supabase
          .from("score_companies")
          .select("id, slug, name, city, state, score, score_grade, google_rating, google_review_count")
          .order("score", { ascending: false, nullsFirst: false })
          .limit(10);
        q = isZip
          ? q.eq("zip", loc)
          : q.or(`city.ilike.%${loc}%,state.ilike.%${loc}%`);
        const { data: top } = await q;
        if (!cancelled) {
          setLeaderboard((top ?? []) as LeaderboardRow[]);
          const first = (top ?? [])[0];
          setLocationLabel(
            first?.city && first?.state
              ? `${first.city}, ${first.state}`
              : loc
          );
        }
      }

      if (!cancelled) {
        setResults(rs);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name, location]);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`TidyWise Score — search "${name}"`}
        description={`Find the TidyWise Score for ${name} and other cleaning businesses${location ? ` in ${location}` : ""}.`}
        noIndex
      />
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to TidyWise
        </Link>

        <h1 className="font-serif text-4xl text-foreground mb-2">Search results</h1>
        <p className="text-muted-foreground mb-8">
          {name ? <>Results for <span className="font-medium text-foreground">"{name}"</span>{location && <> in {location}</>}.</> : "Enter a business name."}
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Searching cleaning companies…
          </div>
        ) : results.length === 0 && leaderboard.length > 0 ? (
          <>
            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                We haven't scored <span className="font-medium text-foreground">"{name}"</span> yet. Here's how cleaning companies in {locationLabel} rank today.
              </p>
            </div>
            <Card variant="elevated" className="overflow-hidden">
              <ol>
                {leaderboard.map((c, i) => (
                  <li key={c.id} className="border-b border-border/50 last:border-0">
                    <Link to={`/score/c/${c.slug}`} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors">
                      <span className="font-serif text-2xl text-muted-foreground w-10 tabular-nums">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[c.city, c.state].filter(Boolean).join(", ") || "Location unknown"}
                          {c.google_rating != null && ` · ${c.google_rating}★ (${c.google_review_count})`}
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
            <div className="mt-6 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const qs = new URLSearchParams();
                  if (name) qs.set("name", name);
                  if (location) qs.set("location", location);
                  navigate(`/score/generate?${qs.toString()}`);
                }}
              >
                <Sparkles className="h-4 w-4 mr-2" /> Generate a score for your business
              </Button>
            </div>
          </>
        ) : results.length === 0 ? (
          <Card variant="elevated" className="p-10 text-center">
            <p className="text-foreground font-medium mb-2">No cleaning companies scored in this area yet.</p>
            <p className="text-sm text-muted-foreground mb-6">Be the first — generate your free TidyWise Score.</p>
            <Button
              variant="premium"
              onClick={() => {
                const qs = new URLSearchParams();
                if (name) qs.set("name", name);
                if (location) qs.set("location", location);
                navigate(`/score/generate?${qs.toString()}`);
              }}
            >
              <Sparkles className="h-4 w-4 mr-2" /> Generate your score
            </Button>
          </Card>
        ) : (
          <Card variant="elevated" className="overflow-hidden">
            <ol>
              {results.map((r) => (
                <li key={r.id} className="border-b border-border/50 last:border-0">
                  <Link
                    to={`/score/c/${r.slug}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[r.city, r.state].filter(Boolean).join(", ") || "Location unknown"}
                        {r.google_rating != null && ` · ${r.google_rating}★ (${r.google_review_count})`}
                      </p>
                    </div>
                    <div className="text-right">
                      {r.score != null ? (
                        <>
                          <div className="font-serif text-2xl text-foreground tabular-nums leading-none">{r.score}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Grade {r.score_grade}</div>
                        </>
                      ) : (
                        <span className="text-xs text-primary">Generate score →</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {/* Always-rendered context so empty searches still give visitors useful info
            and the page meets minimum word/internal-link thresholds for crawlers. */}
        <section className="mt-12 space-y-6">
          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">About the TidyWise Score directory</h2>
            <p className="text-muted-foreground leading-relaxed">
              The TidyWise Score is a free, public grade (0–100) for cleaning businesses
              in every US city. Search any business name and ZIP above and we'll show
              what we have on file — Google reviews, AI sentiment, website quality, and
              an overall score. If we don't have a profile yet, you can generate one in
              under a minute, no signup required.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">What we measure</h2>
            <ul className="space-y-2 text-muted-foreground list-disc pl-5">
              <li><strong className="text-foreground">Reviews:</strong> average rating, total volume, and how recently reviews are coming in.</li>
              <li><strong className="text-foreground">AI sentiment:</strong> we grade the text of recent reviews across reliability, communication, quality, and value.</li>
              <li><strong className="text-foreground">Website signals:</strong> HTTPS, mobile-friendly viewport, online booking presence, and load time.</li>
              <li><strong className="text-foreground">Local rank:</strong> where the business sits among scored cleaners in the same city.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">Who this is for</h2>
            <p className="text-muted-foreground leading-relaxed">
              Homeowners use the directory to vet cleaners before hiring — a high
              TidyWise Score means the cleaner answers their phone, shows up on time,
              and has a real online presence. Cleaning business owners use it to see how
              they stack up against the competition, find quick wins to improve, and
              earn a public badge they can put on their website.
            </p>
          </div>

          <div className="border-t pt-6">
            <h2 className="font-serif text-2xl text-foreground mb-3">Explore more</h2>
            <ul className="grid sm:grid-cols-2 gap-2 text-sm">
              <li><Link to="/score/generate" className="text-primary hover:underline">Generate your own free score →</Link></li>
              <li><Link to="/cleaning-business-software" className="text-primary hover:underline">Cleaning software by state →</Link></li>
              <li><Link to="/blog" className="text-primary hover:underline">Cleaning business blog →</Link></li>
              <li><Link to="/pricing" className="text-primary hover:underline">TidyWise pricing →</Link></li>
              <li><Link to="/demo" className="text-primary hover:underline">Book a demo →</Link></li>
              <li><Link to="/contact" className="text-primary hover:underline">Contact our team →</Link></li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
