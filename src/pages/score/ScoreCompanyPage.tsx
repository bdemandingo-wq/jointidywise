import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Sparkles, Loader2, Lock, CheckCircle2, Globe, Smartphone, Calendar, Star, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/SEOHead";
import { toast } from "@/hooks/use-toast";

type Company = any;
type Metrics = any;

export default function ScoreCompanyPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [company, setCompany] = useState<Company | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [claim, setClaim] = useState({ name: "", email: "", phone: "", message: "" });
  const [claiming, setClaiming] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<"low" | "high" | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: c } = await supabase
        .from("score_companies")
        .select("*")
        .eq("slug", slug!)
        .maybeSingle();
      if (cancelled) return;
      setCompany(c);
      if (c) {
        const { data: m } = await supabase
          .from("score_company_metrics")
          .select("*")
          .eq("company_id", c.id)
          .maybeSingle();
        if (!cancelled) setMetrics(m);
        if (!c.score) {
          // Auto-trigger compute on first visit
          setComputing(true);
          const { data, error } = await supabase.functions.invoke("score-compute", {
            body: { company_id: c.id },
          });
          if (!cancelled) {
            if (!error && data) {
              setCompany(data.company);
              setMetrics(data.metrics);
              setAiConfidence(data.aiConfidence ?? null);
            }
            setComputing(false);
          }
        }

        // Post-signup auto-claim: if redirected back with ?claim=1 and user is signed in,
        // attempt self-serve claim now.
        const params = new URLSearchParams(window.location.search);
        if (params.get("claim") === "1" && !c.claimed) {
          const { data: sessionRes } = await supabase.auth.getSession();
          if (sessionRes?.session) {
            const { data: claimRes, error: claimErr } = await supabase.functions.invoke(
              "score-claim-self",
              { body: { slug: c.slug } }
            );
            if (!cancelled) {
              if (claimErr || (claimRes as any)?.error) {
                const reason = (claimRes as any)?.error ?? "";
                if (reason === "already_claimed") {
                  toast({
                    title: "This profile has already been claimed",
                    description: "Contact support if you believe this is a mistake.",
                    variant: "destructive",
                  });
                } else {
                  toast({ title: "Couldn't claim this profile", variant: "destructive" });
                }
              } else {
                toast({ title: "Profile claimed", description: "Welcome — your full breakdown is unlocked." });
                // Refresh company row to reflect claimed state.
                const { data: c2 } = await supabase
                  .from("score_companies")
                  .select("*")
                  .eq("id", c.id)
                  .maybeSingle();
                if (c2 && !cancelled) setCompany(c2);
              }
              // Strip the ?claim=1 query param.
              const url = new URL(window.location.href);
              url.searchParams.delete("claim");
              window.history.replaceState({}, "", url.toString());
            }
          }
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [slug]);


  const handleRefresh = async () => {
    if (!company) return;
    setComputing(true);
    const { data, error } = await supabase.functions.invoke("score-compute", {
      body: { company_id: company.id, force: true },
    });
    if (!error && data) {
      setCompany(data.company);
      setMetrics(data.metrics);
      setAiConfidence(data.aiConfidence ?? null);
      toast({ title: "Score refreshed" });
    } else {
      toast({ title: "Couldn't refresh score", variant: "destructive" });
    }
    setComputing(false);
  };
  const startClaim = async () => {
    if (!company) return;
    const { data: sessionRes } = await supabase.auth.getSession();
    if (sessionRes?.session) {
      // Already signed in — claim directly.
      const { data: claimRes, error: claimErr } = await supabase.functions.invoke(
        "score-claim-self",
        { body: { slug: company.slug } }
      );
      if (claimErr || (claimRes as any)?.error) {
        const reason = (claimRes as any)?.error ?? "";
        if (reason === "already_claimed") {
          toast({
            title: "This profile has already been claimed",
            description: "Contact support if you believe this is a mistake.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Couldn't claim this profile", variant: "destructive" });
        }
        return;
      }
      toast({ title: "Profile claimed", description: "Your full breakdown is unlocked." });
      const { data: c2 } = await supabase
        .from("score_companies")
        .select("*")
        .eq("id", company.id)
        .maybeSingle();
      if (c2) setCompany(c2);
      return;
    }
    // Not signed in — send through free signup, then auto-claim on return.
    navigate(`/signup?claim=${encodeURIComponent(company.slug)}`);
  };


  const submitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company || !claim.name.trim() || !claim.email.trim()) return;
    setClaiming(true);
    const { error } = await supabase.functions.invoke("score-claim", {
      body: { company_id: company.id, ...claim },
    });
    setClaiming(false);
    if (error) {
      toast({ title: "Could not submit claim", variant: "destructive" });
      return;
    }
    toast({ title: "Claim submitted", description: "We'll be in touch shortly." });
    setShowClaim(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!company) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <h1 className="font-serif text-3xl text-foreground mb-2">Company not found</h1>
        <p className="text-muted-foreground mb-6">This profile doesn't exist yet.</p>
        <Button onClick={() => navigate("/")}>Back home</Button>
      </div>
    );
  }

  const tips: any[] = metrics?.ai_tips ?? [];
  const themes: any[] = metrics?.review_themes ?? [];
  const visibleTips = tips;
  const gatedTips: any[] = [];
  const grade = company.score_grade ?? "—";
  const score = company.score ?? null;

  const locationLabel = [company.city, company.state].filter(Boolean).join(", ");
  const seoTitle = `${company.name} — Reputation Score & Review Analysis | TidyWise`;
  const seoDescription = score != null
    ? `See ${company.name}'s reputation score (${score}/100)${locationLabel ? ` in ${locationLabel}` : ""} — analyzed from ${company.google_review_count ?? 0} Google reviews across reliability, communication, quality, and value.`
    : `See ${company.name}'s reputation analysis${locationLabel ? ` in ${locationLabel}` : ""} — TidyWise scores reliability, communication, quality, and value from Google reviews.`;

  // JSON-LD (LocalBusiness + aggregateRating) is injected by the prerender
  // system at build time via scoreCompanyRouteMeta(). Emitting it again here
  // via Helmet would produce TWO <script type="application/ld+json"> blocks
  // in the DOM — the prerendered one plus Helmet's — triggering Google's
  // "Review has multiple aggregate ratings" error. Let the prerendered
  // version be the single source.

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={seoTitle}
        description={seoDescription}
        canonical={`/score/c/${company.slug}`}
        noIndex
      />
      <div className="max-w-4xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to TidyWise
        </Link>

        {!company.claimed && (
          <Card variant="glass" className="p-4 mb-6 flex items-center justify-between gap-4">
            <p className="text-sm text-foreground">
              <span className="font-medium">Is this your business?</span> Claim this page to unlock your full score report — free.
            </p>
            <Button size="sm" variant="outline" onClick={startClaim}>
              Claim
            </Button>
          </Card>
        )}

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-10">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">TidyWise Score</p>
            <h1 className="font-serif text-4xl sm:text-5xl text-foreground mb-2">{company.name}</h1>
            <p className="text-muted-foreground">
              {[company.city, company.state].filter(Boolean).join(", ") || "Location unknown"}
              {company.city_rank && company.city_total && (
                <> · Ranked <strong className="text-foreground">#{company.city_rank}</strong> of {company.city_total} in {company.city}</>
              )}
            </p>
          </div>
          <Card variant="elevated" className="p-6 text-center min-w-[180px]">
            {computing && score == null ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">Computing…</span>
              </div>
            ) : (
              <>
                <div className="font-serif text-6xl text-foreground tabular-nums leading-none">{score ?? "—"}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mt-2">Grade {grade}</div>
              </>
            )}
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-10">
          <SignalCard
            title="Google Reviews"
            value={metrics?.reviews_score ?? null}
            sub={company.google_rating != null ? `${company.google_rating}★ · ${company.google_review_count} reviews` : "Not listed on Google Maps yet"}
            icon={<Star className="h-4 w-4" />}
          />
          <SignalCard
            title="AI Sentiment"
            value={metrics ? Math.round(((metrics.sentiment_reliability ?? 0) + (metrics.sentiment_communication ?? 0) + (metrics.sentiment_quality ?? 0) + (metrics.sentiment_value ?? 0)) / 4) : null}
            sub="Reliability, communication, quality, value"
            icon={<Sparkles className="h-4 w-4" />}
            lowConfidence={aiConfidence === "low"}
            lowConfidenceCaption="Based on under 5 reviews with text"
          />
          <SignalCard
            title="Website Quality"
            value={metrics?.website_score}
            sub={company.website ? new URL(company.website).hostname : "No website found"}
            icon={<Globe className="h-4 w-4" />}
          />
        </div>

        {metrics && (
          <Card variant="elevated" className="p-6 mb-10">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h2 className="font-serif text-2xl text-foreground">Sentiment breakdown</h2>
              {aiConfidence === "low" && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-muted text-muted-foreground">Low confidence</span>
              )}
              <button
                type="button"
                onClick={() => setShowMethodology((v) => !v)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {showMethodology ? "Hide" : "How is this calculated?"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              AI-analyzed from {company.google_review_count ?? 0} Google reviews across reliability, communication, quality, and value. Scores are review-derived, not self-reported.
            </p>
            {showMethodology && (
              <div className="mb-5 p-4 rounded-lg bg-muted/40 text-sm text-muted-foreground leading-relaxed">
                We pull your public Google reviews and use AI to score four dimensions on a 0–100 scale. Each review is scored individually, then averaged, with more recent reviews weighted slightly higher. The sentiment score makes up 30% of the overall TidyWise Score.
              </div>
            )}
            <div className={`grid grid-cols-2 sm:grid-cols-4 gap-4 ${aiConfidence === "low" ? "opacity-50" : ""}`}>
              {[
                ["Reliability", metrics.sentiment_reliability],
                ["Communication", metrics.sentiment_communication],
                ["Quality", metrics.sentiment_quality],
                ["Value", metrics.sentiment_value],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <div className="font-serif text-2xl text-foreground tabular-nums">{val ?? "—"}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${val ?? 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {themes.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {themes.map((t, i) => (
                  <span
                    key={i}
                    className={`px-3 py-1 rounded-full text-xs ${
                      t.sentiment === "positive"
                        ? "bg-success/15 text-success"
                        : t.sentiment === "negative"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            {!company.claimed ? (
              <div className="mt-6 relative rounded-lg border border-border bg-muted/30 p-5 overflow-hidden">
                <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  <span>Per-dimension breakdown & supporting review quotes</span>
                </div>
                <div className="space-y-2 blur-sm select-none pointer-events-none" aria-hidden>
                  <div className="h-3 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-2/3 bg-muted rounded" />
                  <div className="h-3 w-5/6 bg-muted rounded" />
                </div>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <p className="text-sm text-foreground">
                    Claim this profile to see which reviews drove each score — free.
                  </p>
                  <div className="flex flex-col items-start sm:items-end gap-2">
                    <Button size="sm" variant="premium" onClick={startClaim}>
                      Claim & unlock
                    </Button>
                    {!user && (
                      <Link
                        to={`/login?claim=${encodeURIComponent(slug!)}`}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                        rel="nofollow"
                      >
                        Already have an account? Log in to claim
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-8">
                <h3 className="font-serif text-lg text-foreground mb-3">Why these scores</h3>
                <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  {([
                    ["reliability", "Reliability"],
                    ["communication", "Communication"],
                    ["quality", "Quality"],
                    ["value", "Value"],
                  ] as const).map(([key, label]) => {
                    const evidence: Array<{ snippet: string; author: string; date: string }> =
                      (metrics.sentiment_evidence?.[key] as any[]) ?? [];
                    const open = expandedDim === key;
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() => setExpandedDim(open ? null : key)}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            <span className="text-sm font-medium text-foreground">{label}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {evidence.length > 0 ? `${evidence.length} quote${evidence.length === 1 ? "" : "s"}` : "—"}
                          </span>
                        </button>
                        {open && (
                          <div className="px-4 pb-4 pt-1 bg-muted/20">
                            {evidence.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">Not enough review signal yet</p>
                            ) : (
                              <ul className="space-y-3">
                                {evidence.map((e, i) => (
                                  <li key={i} className="text-sm text-foreground">
                                    <span className="italic">"{e.snippet}"</span>
                                    <div className="text-xs text-muted-foreground mt-1">
                                      — {e.author}{e.date ? `, ${e.date}` : ""}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        )}

        {metrics?.website_score != null && (
          <Card variant="elevated" className="p-6 mb-10">
            <h2 className="font-serif text-2xl text-foreground mb-4">Website signals</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <SignalRow label="HTTPS" ok={metrics.website_has_https} />
              <SignalRow label="Mobile-friendly" ok={metrics.website_mobile_friendly} icon={<Smartphone className="h-4 w-4" />} />
              <SignalRow label="Online booking" ok={metrics.website_has_booking} icon={<Calendar className="h-4 w-4" />} />
              <div className="text-muted-foreground">
                <div className="text-xs uppercase tracking-wider mb-1">Load time</div>
                <div className="text-foreground font-medium">{metrics.website_load_ms ? `${metrics.website_load_ms} ms` : "—"}</div>
              </div>
            </div>
          </Card>
        )}

        {tips.length > 0 && (
          <Card variant="elevated" className="p-6 mb-10">
            <h2 className="font-serif text-2xl text-foreground mb-1">How to improve your score</h2>
            <p className="text-sm text-muted-foreground mb-6">AI-generated tips based on your actual weak signals.</p>
            <div className="space-y-4">
              {visibleTips.map((tip, i) => (
                <TipCard key={i} tip={tip} />
              ))}
            </div>
            {gatedTips.length > 0 && (
              <div className="relative mt-6">
                <div className="space-y-4 blur-sm select-none pointer-events-none" aria-hidden>
                  {gatedTips.map((tip, i) => (
                    <TipCard key={i} tip={tip} />
                  ))}
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-background/40 via-background/80 to-background rounded-xl p-6 text-center">
                  <Lock className="h-6 w-6 text-primary mb-3" />
                  <p className="font-medium text-foreground mb-1">You have {gatedTips.length} more insights waiting</p>
                  <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                    Plus full sentiment breakdown, competitor comparison, and a score improvement checklist.
                  </p>
                  <Button variant="premium" onClick={() => navigate("/signup")}>
                    <Sparkles className="h-4 w-4 mr-2" /> Claim your free profile to unlock all insights →
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        <div className="flex items-center justify-between gap-4 mb-10">
          <p className="text-xs text-muted-foreground">
            {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */}
            {company.last_scored_at && <>Score last updated {new Date(company.last_scored_at).toLocaleDateString()} · </>}
            Powered by TidyWise AI
          </p>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={computing}>
            {computing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Recompute
          </Button>
        </div>

        {showClaim && (
          <Card variant="elevated" className="p-6 mb-10">
            <h3 className="font-serif text-2xl text-foreground mb-4">Claim {company.name}</h3>
            <form onSubmit={submitClaim} className="grid gap-3">
              <Input placeholder="Your name" value={claim.name} onChange={(e) => setClaim({ ...claim, name: e.target.value })} required />
              <Input type="email" placeholder="Work email" value={claim.email} onChange={(e) => setClaim({ ...claim, email: e.target.value })} required />
              <Input placeholder="Phone (optional)" value={claim.phone} onChange={(e) => setClaim({ ...claim, phone: e.target.value })} />
              <Textarea placeholder="Anything we should know? (optional)" value={claim.message} onChange={(e) => setClaim({ ...claim, message: e.target.value })} />
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="ghost" onClick={() => setShowClaim(false)}>Cancel</Button>
                <Button type="submit" variant="premium" disabled={claiming}>
                  {claiming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Submit claim
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

function SignalCard({ title, value, sub, icon, lowConfidence, lowConfidenceCaption }: { title: string; value: number | null | undefined; sub: string; icon: React.ReactNode; lowConfidence?: boolean; lowConfidenceCaption?: string }) {
  return (
    <Card variant="elevated" className="p-5">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground mb-3">
        {icon} {title}
      </div>
      {lowConfidence ? (
        <>
          <div className="font-serif text-3xl text-muted-foreground tabular-nums">Low confidence</div>
          {lowConfidenceCaption && <p className="text-[11px] text-muted-foreground mt-1 truncate">{lowConfidenceCaption}</p>}
          <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>
        </>
      ) : (
        <>
          <div className="font-serif text-3xl text-foreground tabular-nums">{value ?? "—"}</div>
          <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>
        </>
      )}
    </Card>
  );
}

function SignalRow({ label, ok, icon }: { label: string; ok: boolean | null; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={`text-sm font-medium ${ok ? "text-success" : "text-destructive"}`}>
        {ok ? <CheckCircle2 className="h-4 w-4 inline mr-1" /> : null}
        {ok ? "Yes" : "No"}
      </div>
    </div>
  );
}

function TipCard({ tip }: { tip: any }) {
  const impactColors: Record<string, string> = {
    high: "bg-destructive/15 text-destructive",
    medium: "bg-warning/15 text-warning",
    low: "bg-muted text-muted-foreground",
  };
  return (
    <div className="border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h4 className="font-medium text-foreground">{tip.title}</h4>
        {tip.impact && (
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${impactColors[tip.impact] ?? ""}`}>
            {tip.impact} impact
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{tip.body}</p>
    </div>
  );
}
