import { useState, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Sparkles, Loader2, MapPin, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/SEOHead";
import { toast } from "@/hooks/use-toast";

// Extract city + 2-letter state from a Places "formatted_address". Google
// returns strings like "123 Main St, Pompano Beach, FL 33442, USA". We
// take the second-to-last comma-segment for "<state> <zip>" and the one
// before it for the city. Defensive against missing segments.
function parseAddressParts(formatted: string | null | undefined): {
  city: string;
  state: string;
  zip: string;
} {
  if (!formatted) return { city: "", state: "", zip: "" };
  const parts = formatted.split(",").map((s) => s.trim()).filter(Boolean);
  // Drop trailing country if present
  const tail = parts[parts.length - 1]?.toUpperCase();
  const trimmed = tail === "USA" || tail === "US" ? parts.slice(0, -1) : parts;
  const stateChunk = trimmed[trimmed.length - 1] ?? "";
  const cityChunk = trimmed[trimmed.length - 2] ?? "";
  const m = stateChunk.match(/\b([A-Z]{2})\b(?:\s+(\d{5}))?/);
  return {
    city: cityChunk,
    state: m?.[1] ?? "",
    zip: m?.[2] ?? "",
  };
}

// Pull a state code out of the user's "location" search param if they
// typed something like "Pompano Beach, FL" or just "FL".
function extractStateCode(loc: string): string {
  const m = loc.match(/\b([A-Z]{2})\b/i);
  return m ? m[1].toUpperCase() : "";
}

function extractCity(loc: string): string {
  // "Pompano Beach, FL" → "Pompano Beach"; "33442" → ""; "FL" → ""
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[0];
  if (/^\d{5}$/.test(loc.trim())) return "";
  if (/^[A-Z]{2}$/i.test(loc.trim())) return "";
  return parts[0] ?? "";
}

export default function ScoreGeneratePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const prefName = params.get("name") ?? "";
  const prefLocation = params.get("location") ?? "";

  const initialCity = useMemo(() => extractCity(prefLocation), [prefLocation]);
  const initialState = useMemo(() => extractStateCode(prefLocation), [prefLocation]);
  const initialZip = useMemo(
    () => (/^\d{5}$/.test(prefLocation.trim()) ? prefLocation.trim() : ""),
    [prefLocation]
  );

  const [mapsUrl, setMapsUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [manualEntryHint, setManualEntryHint] = useState<string | null>(null);
  const [name, setName] = useState(prefName);
  const [city, setCity] = useState(initialCity);
  const [state, setState] = useState(initialState);
  const [zip, setZip] = useState(initialZip);
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Allow submission with either city+state OR a 5-digit ZIP — score-create
  // can reverse-geocode the ZIP server-side. Prevents the button from
  // looking permanently disabled when the user landed here from a search
  // that only carried a ZIP (e.g. /score/generate?location=33442).
  const hasLocation =
    (city.trim() && state.trim()) || /^\d{5}$/.test(zip.trim());
  const canSubmit = !!name.trim() && !!hasLocation && !submitting;

  // Resolve a Google Maps link → Place ID and autofill the rest of the
  // form from the canonical Places record. Idempotent; safe to call on
  // every blur. Failures are surfaced as toasts so the user can fall
  // back to manual entry without the form looking broken.
  const handleResolveMaps = async (rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url) {
      setPlaceId(null);
      setResolvedName(null);
      setManualEntryHint(null);
      return;
    }
    setResolving(true);
    try {
      const { data, error } = await supabase.functions.invoke("place-id-resolve", {
        body: { url },
      });
      if (data?.requiresManualInput) {
        setPlaceId(null);
        setResolvedName(null);
        setManualEntryHint(data.error ?? null);
        if (data.name && !name.trim()) setName(data.name);
        return;
      }
      if (error || !data?.place_id) {
        setManualEntryHint(null);
        toast({
          title: "Couldn't read that link",
          description:
            data?.error ??
            error?.message ??
            "Paste a Google Maps link that points at your business profile, or fill out the fields below manually.",
          variant: "destructive",
        });
        setPlaceId(null);
        setResolvedName(null);
        return;
      }
      setPlaceId(data.place_id);
      setResolvedName(data.name ?? null);
      setManualEntryHint(null);
      if (data.name && !name.trim()) setName(data.name);
      const parts = parseAddressParts(data.formatted_address);
      if (parts.city && !city.trim()) setCity(parts.city);
      if (parts.state && !state.trim()) setState(parts.state);
      if (parts.zip && !zip.trim()) setZip(parts.zip);
    } catch (e) {
      toast({
        title: "Lookup failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("score-create", {
      body: {
        name: name.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim() || null,
        website: website.trim() || null,
        phone: phone.trim() || null,
        // Sending the resolved Place ID lets score-compute skip its
        // name-based Places lookup, which is brittle for businesses
        // that aren't indexed under the submitted name.
        google_place_id: placeId,
      },
    });
    if (error || !data?.slug) {
      toast({ title: "Couldn't generate score", description: error?.message ?? "Please try again.", variant: "destructive" });
      setSubmitting(false);
      return;
    }
    navigate(`/score/c/${data.slug}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Generate your TidyWise Score"
        description="Generate a free TidyWise Score for your cleaning business — no signup required."
        noIndex
      />
      <div className="max-w-xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to TidyWise
        </Link>

        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">TidyWise Score</p>
        <h1 className="font-serif text-4xl text-foreground mb-2">Generate your score</h1>
        <p className="text-muted-foreground mb-8">
          Free, no signup needed. We'll analyze public signals about your business and grade it on reviews, reputation, and online presence.
        </p>

        <Card variant="elevated" className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="biz-maps" className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Google Maps link <span className="text-muted-foreground font-normal">(recommended)</span>
              </Label>
              <div className="relative">
                <Input
                  id="biz-maps"
                  value={mapsUrl}
                  onChange={(e) => {
                    setMapsUrl(e.target.value);
                    if (placeId) {
                      setPlaceId(null);
                      setResolvedName(null);
                    }
                    if (manualEntryHint) setManualEntryHint(null);
                  }}
                  onBlur={(e) => handleResolveMaps(e.target.value)}
                  placeholder="https://maps.app.goo.gl/…  or  https://share.google/…"
                  inputMode="url"
                  disabled={resolving}
                />
                {resolving && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {placeId && resolvedName ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Matched: {resolvedName}
                </p>
              ) : manualEntryHint ? (
                <p className="text-xs text-muted-foreground">{manualEntryHint}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Most accurate. We use your Google profile to grade reviews against the right business.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="biz-name">Business name *</Label>
              <Input
                id="biz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. TidyWise Cleaning"
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="biz-city">City *</Label>
                <Input
                  id="biz-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Pompano Beach"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="biz-state">State *</Label>
                <Input
                  id="biz-state"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="FL"
                  maxLength={2}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="biz-zip">ZIP code</Label>
              <Input
                id="biz-zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="33442"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="biz-web">
                Website <span className="text-muted-foreground">(boosts your score)</span>
              </Label>
              <Input
                id="biz-web"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="tidywise.com"
                inputMode="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="biz-phone">
                Phone <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="biz-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                inputMode="tel"
              />
            </div>

            <Button type="submit" variant="premium" size="lg" className="w-full gap-2" disabled={!canSubmit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {submitting ? "Generating…" : "Generate my score"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              No account required. We'll score your business and show you the result.
            </p>
          </form>
        </Card>

        {/* Always-rendered context so the page has real substance for crawlers and visitors. */}
        <section className="mt-12 space-y-6">
          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">What is the TidyWise Score?</h2>
            <p className="text-muted-foreground leading-relaxed">
              The TidyWise Score is a free, public 0–100 grade for cleaning businesses in
              the United States. It blends signals homeowners already use when picking a
              cleaner — Google reviews, review recency, AI sentiment across reliability,
              communication, quality, and value, plus website signals like HTTPS, mobile
              friendliness, and whether the business offers online booking.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">Why generate yours</h2>
            <p className="text-muted-foreground leading-relaxed">
              Getting a TidyWise Score takes under a minute and creates a public profile
              for your business that ranks against competitors in your city. A high score
              becomes a trust signal you can link to from your website, share on social,
              and use in proposals. A low score points out exactly which signals to
              improve first — usually review recency or a missing online booking flow.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">How it works</h2>
            <ol className="space-y-2 text-muted-foreground list-decimal pl-5">
              <li>Paste your Google Maps link (most accurate) or type your business name and city/state.</li>
              <li>We pull your public Google Places listing and recent reviews.</li>
              <li>Our AI grades sentiment across reliability, communication, quality, and value.</li>
              <li>We probe your website for HTTPS, mobile viewport, load time, and online booking.</li>
              <li>Everything weights into a single 0–100 score and a letter grade (A–F).</li>
              <li>Your profile goes live at a clean URL you can share or claim.</li>
            </ol>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-foreground mb-3">Privacy &amp; data</h2>
            <p className="text-muted-foreground leading-relaxed">
              We only use publicly available information about your business — nothing
              behind a login. You can request edits or take-down at any time by claiming
              your profile after it's generated, or by emailing us.  No
              forced signup. No data sale.
            </p>
          </div>

          <div className="border-t pt-6">
            <h2 className="font-serif text-2xl text-foreground mb-3">Explore TidyWise</h2>
            <ul className="grid sm:grid-cols-2 gap-2 text-sm">
              <li><Link to="/score/search" className="text-primary hover:underline">Search any cleaning company →</Link></li>
              <li><Link to="/cleaning-business-software" className="text-primary hover:underline">Cleaning software by state →</Link></li>
              <li><Link to="/pricing" className="text-primary hover:underline">TidyWise pricing →</Link></li>
              <li><Link to="/demo" className="text-primary hover:underline">Book a product demo →</Link></li>
              <li><Link to="/blog" className="text-primary hover:underline">Cleaning business blog →</Link></li>
              <li><Link to="/contact" className="text-primary hover:underline">Contact our team →</Link></li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
