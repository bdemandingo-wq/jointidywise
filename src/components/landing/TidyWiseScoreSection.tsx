import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Sparkles, Trophy, MapPin, ArrowRight } from "lucide-react";
import { useScoreLeaderboard, type LeaderboardCity } from "@/hooks/useScoreLeaderboard";
import type { ScoreListing } from "@/lib/scoreLeaderboard";

const DEFAULT_CITY: LeaderboardCity = { city: "Austin", state: "TX", city_slug: "austin-tx" };

function companyPath(slug: string): string | null {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug) ? `/score/c/${slug}` : null;
}

function ScoreFigure({ row }: { row: ScoreListing }) {
  if (row.score != null) {
    return (
      <>
        <div className="font-serif text-2xl text-foreground tabular-nums leading-none">{row.score}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
          Grade {row.score_grade ?? "—"}
        </div>
      </>
    );
  }
  if (row.google_rating != null) {
    return (
      <>
        <div className="font-serif text-2xl text-foreground tabular-nums leading-none">
          {row.google_rating.toFixed(1)}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
          Google rating
        </div>
      </>
    );
  }
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Not scored yet</div>
  );
}

export function TidyWiseScoreSection() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loc, setLoc] = useState("");
  const [searching, setSearching] = useState(false);
  const [city, setCity] = useState(DEFAULT_CITY);
  const [cityReady, setCityReady] = useState(false);
  const [located, setLocated] = useState(false);
  const leaderboard = useScoreLeaderboard(cityReady ? city : null, located);

  // Best-effort IP geo. The list stays on this city — never a national
  // fallback under a different city's heading and link. Seeding runs only
  // after a real geo hit, so a failed lookup does not spend a Places search
  // on the Austin placeholder.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    (async () => {
      try {
        const response = await fetch("https://ipapi.co/json/", { signal: controller.signal });
        const geo = response.ok ? await response.json() : null;
        if (!cancelled && geo?.city && geo?.region_code) {
          const slug = `${geo.city}-${geo.region_code}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          setCity({ city: geo.city, state: geo.region_code, city_slug: slug });
          setLocated(true);
        }
      } catch {
        // Keep the default city.
      }
      if (!cancelled) setCityReady(true);
    })();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSearching(true);
    const params = new URLSearchParams({ name: name.trim() });
    if (loc.trim()) params.set("location", loc.trim());
    navigate(`/score/search?${params.toString()}`);
    setSearching(false);
  };

  const board = leaderboard.data;
  const cityLabel = board?.label ?? `${city.city}, ${city.state}`;
  const title = board?.title ?? "Top cleaners this week";
  const loading = !cityReady || leaderboard.isLoading;

  return (
    <section
      id="tidywise-score"
      className="relative z-10 py-16 md:py-24 px-4 sm:px-6 lg:px-8 bg-secondary/40 border-t border-border/50"
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-xs font-medium mb-5 uppercase tracking-wider">
            <Trophy className="h-3.5 w-3.5" />
            The TidyWise Score
          </div>
          <h2 className="font-serif text-3xl sm:text-5xl md:text-6xl leading-[1.05] mb-4 text-foreground">
            See how your cleaning business{" "}
            <span className="italic text-primary">ranks</span> in your city
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            We grade every cleaning company on reviews, reputation, and online presence.
            Look yours up — it's free.
          </p>
        </div>

        <Card variant="elevated" className="p-5 sm:p-6 mb-10">
          <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Business name"
                className="pl-9 h-12"
                aria-label="Business name"
              />
            </div>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                placeholder="City or ZIP"
                className="pl-9 h-12"
                aria-label="City or ZIP"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              variant="premium"
              className="h-12 gap-2"
              disabled={searching || !name.trim()}
            >
              <Sparkles className="h-4 w-4" />
              Look up my score
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Free · No signup needed to see your score
          </p>
        </Card>

        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              {title}
            </p>
            <h3 className="font-serif text-2xl text-foreground">{cityLabel}</h3>
          </div>
          <Link
            to={`/score/city/${city.city_slug}`}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            {board && board.scope !== "city" ? `See ${city.city} rankings` : "See full rankings"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <Card variant="elevated" className="relative z-10 overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading rankings">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : leaderboard.isError ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Rankings could not be loaded. Look a business up above.
            </div>
          ) : !board || board.entries.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No house-cleaning companies scored in {cityLabel} yet. Look one up above.
            </div>
          ) : (
            <ol>
              {board.entries.map((c, i) => {
                const path = companyPath(c.slug);
                const place = [c.city, c.state].filter(Boolean).join(", ");
                return (
                <li
                  key={c.id}
                  className="flex items-center gap-4 px-5 py-3.5 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <span className="font-serif text-2xl text-muted-foreground w-8 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    {path ? (
                      <Link
                        to={path}
                        className="font-medium text-foreground hover:text-primary truncate block"
                      >
                        {c.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground truncate block">{c.name}</span>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {place}
                    </p>
                  </div>
                  <div className="text-right">
                    <ScoreFigure row={c} />
                  </div>
                </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </section>
  );
}

export default TidyWiseScoreSection;
