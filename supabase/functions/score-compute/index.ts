// TidyWise Score: compute or refresh a company's score
// Pulls Google reviews via Places, runs AI sentiment on review text,
// pings the website for basic quality signals, and writes everything to DB.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { generateObject } from "npm:ai@5";
import { createAnthropic } from "npm:@ai-sdk/anthropic@1";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "";

const anthropic = createAnthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "",
});
const MODEL_HAIKU = "claude-haiku-4-5";
const MODEL_SONNET = "claude-sonnet-4-6";

function letterGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function reviewsScore(rating: number | null, count: number, mostRecentDays: number | null) {
  if (!rating || !count) return 30;
  const ratingPart = Math.min(50, ((rating - 3) / 2) * 50); // 3.0=0, 5.0=50
  const volumePart = Math.min(30, Math.log10(count + 1) * 18);
  const recencyPart =
    mostRecentDays === null ? 10 : Math.max(0, 20 - mostRecentDays / 9); // ~180d → 0
  return Math.round(Math.max(0, Math.min(100, ratingPart + volumePart + recencyPart)));
}

function extractPlaceIdFromWebsite(html: string): string | null {
  const patterns = [
    /search\.google\.com\/local\/reviews\?placeid=([A-Za-z0-9_-]+)/i,
    /[?&]placeid=([A-Za-z0-9_-]{10,})/i,
    /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function extractAggregateRatingFromWebsite(html: string): {
  rating: number | null;
  count: number;
} {
  const aggregateJson = html.match(/"aggregateRating"\s*:\s*\{[\s\S]{0,400}?"ratingValue"\s*:\s*"?([0-9.]+)"?[\s\S]{0,200}?"reviewCount"\s*:\s*"?(\d+)"?/i);
  if (aggregateJson?.[1] && aggregateJson?.[2]) {
    return {
      rating: Number(aggregateJson[1]) || null,
      count: Number(aggregateJson[2]) || 0,
    };
  }

  const plainText = html.match(/([0-9](?:\.[0-9])?)\s*(?:stars?|★)[^\n<]{0,40}?(\d{1,5})\+?\s+reviews?/i);
  if (plainText?.[1] && plainText?.[2]) {
    return {
      rating: Number(plainText[1]) || null,
      count: Number(plainText[2]) || 0,
    };
  }

  return { rating: null, count: 0 };
}

async function checkWebsite(url: string | null) {
  if (!url) {
    return {
      website_score: 20,
      website_has_https: false,
      website_mobile_friendly: false,
      website_has_booking: false,
      website_load_ms: null as number | null,
      inferred_place_id: null as string | null,
      inferred_google_rating: null as number | null,
      inferred_google_review_count: 0,
    };
  }
  let score = 0;
  const has_https = url.startsWith("https://");
  if (has_https) score += 25;
  let mobile = false;
  let booking = false;
  let loadMs: number | null = null;
  let inferredPlaceId: string | null = null;
  let inferredGoogleRating: number | null = null;
  let inferredGoogleReviewCount = 0;
  try {
    const start = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TidyWiseScoreBot/1.0; +https://lovable.dev)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(t);
    loadMs = Date.now() - start;
    if (res.ok) {
      score += 20;
      const html = await res.text();
      mobile = /viewport[^>]*width=device-width/i.test(html);
      if (mobile) score += 25;
      inferredPlaceId = extractPlaceIdFromWebsite(html);
      const aggregate = extractAggregateRatingFromWebsite(html);
      inferredGoogleRating = aggregate.rating;
      inferredGoogleReviewCount = aggregate.count;
      booking = /(book\s+now|book\s+online|online\s+booking|book\s+today|booking\s+available|get\s+my\s+instant\s+quote|get\s+a\s+quote|instant\s+quote|start\s+my\s+booking|href=["']#booking["'])/i.test(html);
      if (booking) score += 20;
      if (loadMs < 1500) score += 10;
      else if (loadMs < 3500) score += 5;
    }
  } catch (_e) {
    // unreachable
  }
  return {
    website_score: Math.min(100, score),
    website_has_https: has_https,
    website_mobile_friendly: mobile,
    website_has_booking: booking,
    website_load_ms: loadMs,
    inferred_place_id: inferredPlaceId,
    inferred_google_rating: inferredGoogleRating,
    inferred_google_review_count: inferredGoogleReviewCount,
  };
}

type RichReview = { text: string; rating: number | null; publishTime: string | null; author: string | null };

async function fetchPlaceSignals(
  placeId: string,
  current: {
    rating: number | null;
    count: number;
    resolvedWebsite: string | null;
    resolvedPhone: string | null;
  }
) {
  const r = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": PLACES_KEY,
      "X-Goog-FieldMask":
        "id,displayName,rating,userRatingCount,reviews.text,reviews.originalText,reviews.rating,reviews.publishTime,reviews.authorAttribution,websiteUri,nationalPhoneNumber",
    },
  });
  if (!r.ok) return null;

  const j = await r.json();
  const rs = j.reviews ?? [];
  const newest = rs[0]?.publishTime;

  const richReviews: RichReview[] = rs
    .map((x: any) => ({
      text: x.text?.text ?? x.originalText?.text ?? "",
      rating: typeof x.rating === "number" ? x.rating : null,
      publishTime: x.publishTime ?? null,
      author: x.authorAttribution?.displayName ?? null,
    }))
    .filter((r: RichReview) => r.text.length > 0);


  return {
    rating: j.rating ?? current.rating,
    count: j.userRatingCount ?? current.count,
    resolvedWebsite: current.resolvedWebsite ?? j.websiteUri ?? null,
    resolvedPhone: current.resolvedPhone ?? j.nationalPhoneNumber ?? null,
    reviews: richReviews.map((r) => r.text),
    richReviews,
    mostRecentDays: newest
      ? Math.floor((Date.now() - new Date(newest).getTime()) / (24 * 3600 * 1000))
      : null,
  };
}

const InsightsSchema = z.object({
  themes: z.array(z.object({ label: z.string(), sentiment: z.enum(["positive", "neutral", "negative"]) })).max(8),
  tips: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
        impact: z.enum(["high", "medium", "low"]),
      })
    )
    .min(3)
    .max(8),
});

const PerReviewSentimentSchema = z.object({
  reliability: z.number().min(0).max(100),
  communication: z.number().min(0).max(100),
  quality: z.number().min(0).max(100),
  value: z.number().min(0).max(100),
  topDimension: z.enum(["reliability", "communication", "quality", "value"]),
  topReason: z.string().max(200),
});

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`${label} attempt 1 failed, retrying:`, e instanceof Error ? e.message : e);
    return await fn();
  }
}

async function scoreReviewSentiment(review: RichReview) {
  const prompt = `Score this single review of a US cleaning company on 4 dimensions, each 0-100.
Definitions:
- reliability: showed up on time, did what was promised, no cancellations
- communication: responsive, clear, professional updates
- quality: cleanliness, thoroughness, attention to detail
- value: fair price for the work performed

Rules:
- If a dimension isn't mentioned, score it as a neutral 60 (do NOT default 0).
- A glowing review without complaints should score 85+ on mentioned dimensions.
- A 1-star angry review should score under 30 on mentioned dimensions.
- Reviewer's star rating (if any): ${review.rating ?? "n/a"}.

Also return:
- topDimension: the single dimension this review most supports
- topReason: a one-line (max ~140 chars) justification grounded in the review text

Return only the JSON object.

Review text:
"""${review.text.slice(0, 2000)}"""`;

  const { object } = await generateObject({
    model: anthropic(MODEL_HAIKU),
    prompt,
    schema: PerReviewSentimentSchema,
  });
  return object;
}


async function aiAnalyzeInsights(opts: {
  name: string;
  rating: number | null;
  count: number;
  reviews: string[];
  website: { website_score: number; website_has_https: boolean; website_mobile_friendly: boolean; website_has_booking: boolean };
  reviewsScore: number;
}) {
  const reviewBlock = opts.reviews.slice(0, 25).map((r, i) => `${i + 1}. ${r}`).join("\n").slice(0, 8000);
  const prompt = `You are analyzing a US cleaning company's online reputation to produce a "TidyWise Score" report.

Company: ${opts.name}
Google rating: ${opts.rating ?? "n/a"} (${opts.count} reviews)
Reviews score (0-100): ${opts.reviewsScore}
Website signals: https=${opts.website.website_has_https}, mobile=${opts.website.website_mobile_friendly}, booking=${opts.website.website_has_booking}, score=${opts.website.website_score}

Recent reviews:
${reviewBlock || "(no review text available)"}

Tasks:
1. Extract up to 6 review themes (short labels, 1-3 words each) with sentiment.
2. Generate 5-8 *specific*, *actionable* improvement tips this owner could do this week. Reference their actual weak signals (low recency, missing booking flow, value complaints, etc.). Keep each tip body under 240 chars. Tips should never be generic.`;

  const { object } = await generateObject({
    model: anthropic(MODEL_SONNET),
    prompt,
    schema: InsightsSchema,
  });
  return object;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { company_id, force = false } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Abuse guard: force=true triggers ~25 LLM calls + Places API hits
    // per invocation. The function is verify_jwt=false so anonymous
    // callers can hit it; without this guard a single attacker could
    // iterate the public score_companies table and burn the entire AI
    // budget. Two layers:
    //   1. force=true requires an authenticated caller (any valid
    //      Supabase user — the score-claim-self flow already supplies
    //      one when claiming; logged-in admins always do).
    //   2. Even authenticated callers can't refresh a company more than
    //      once per 60s — guards against accidentally-recursive UI
    //      retries and intentional cost abuse from one logged-in user.
    let forceAllowed = !force;
    if (force) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const { data: udata } = await createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        ).auth.getUser(authHeader.replace("Bearer ", ""));
        forceAllowed = !!udata?.user;
      }
      if (!forceAllowed) {
        return new Response(
          JSON.stringify({ error: "force refresh requires authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const { data: company, error: cErr } = await supabase
      .from("score_companies")
      .select("*")
      .eq("id", company_id)
      .single();
    if (cErr || !company) throw new Error(cErr?.message ?? "company not found");

    // Per-company cooldown on force refreshes (60s). Even an authenticated
    // user can't drive AI cost from a single company by clicking refresh
    // repeatedly. Natural (non-force) re-scoring is still gated by the
    // 7-day cache below.
    if (
      force &&
      company.last_scored_at &&
      Date.now() - new Date(company.last_scored_at).getTime() < 60 * 1000
    ) {
      return new Response(
        JSON.stringify({ error: "refresh rate-limited; try again in a minute" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cached recently (< 7 days)?
    if (
      !force &&
      company.last_scored_at &&
      Date.now() - new Date(company.last_scored_at).getTime() < 7 * 24 * 3600 * 1000
    ) {
      const { data: m } = await supabase
        .from("score_company_metrics")
        .select("*")
        .eq("company_id", company_id)
        .maybeSingle();
      return new Response(JSON.stringify({ company, metrics: m, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch fresh Google details + reviews
    let rating = company.google_rating;
    let count = company.google_review_count ?? 0;
    let reviews: string[] = [];
    let richReviews: RichReview[] = [];
    let mostRecentDays: number | null = null;
    let placeId: string | null = company.google_place_id ?? null;
    let resolvedWebsite: string | null = company.website ?? null;
    let resolvedPhone: string | null = company.phone ?? null;

    // For user-submitted businesses we may not have a google_place_id yet —
    // do a one-shot Places Text Search to find one before pulling details.
    if (PLACES_KEY && !placeId) {
      const text = [company.name, company.city, company.state].filter(Boolean).join(" ");
      try {
        const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": PLACES_KEY,
            "X-Goog-FieldMask": "places.id",
          },
          body: JSON.stringify({
            textQuery: text,
            maxResultCount: 1,
            includePureServiceAreaBusinesses: true,
          }),
        });
        if (r.ok) {
          const j = await r.json();
          placeId = j.places?.[0]?.id ?? null;
        }
      } catch (e) {
        console.warn("places text search failed", e);
      }
    }

    if (PLACES_KEY && placeId) {
      const fresh = await fetchPlaceSignals(placeId, {
        rating,
        count,
        resolvedWebsite,
        resolvedPhone,
      });
      if (fresh) {
        rating = fresh.rating;
        count = fresh.count;
        resolvedWebsite = fresh.resolvedWebsite;
        resolvedPhone = fresh.resolvedPhone;
        reviews = fresh.reviews;
        richReviews = fresh.richReviews;
        mostRecentDays = fresh.mostRecentDays;
      }
    }

    const web = await checkWebsite(resolvedWebsite);
    if (!placeId && web.inferred_place_id) {
      placeId = web.inferred_place_id;
      const fresh = await fetchPlaceSignals(placeId, {
        rating,
        count,
        resolvedWebsite,
        resolvedPhone,
      });
      if (fresh) {
        rating = fresh.rating;
        count = fresh.count;
        resolvedWebsite = fresh.resolvedWebsite;
        resolvedPhone = fresh.resolvedPhone;
        reviews = fresh.reviews;
        richReviews = fresh.richReviews;
        mostRecentDays = fresh.mostRecentDays;
      }
    }

    if ((!rating || !count) && web.inferred_google_rating && web.inferred_google_review_count) {
      rating = web.inferred_google_rating;
      count = web.inferred_google_review_count;
    }

    const hasReviewData = !!(rating && count);
    const reviewsScoreVal = hasReviewData ? reviewsScore(rating, count, mostRecentDays) : null;

    // ---- AI Sentiment: per-review scoring with recency weighting ----
    const ai: {
      reliability: number;
      communication: number;
      quality: number;
      value: number;
      themes: { label: string; sentiment: "positive" | "neutral" | "negative" }[];
      tips: { title: string; body: string; impact: "high" | "medium" | "low" }[];
    } = {
      reliability: 60,
      communication: 60,
      quality: 60,
      value: 60,
      themes: [],
      tips: [],
    };
    let aiFailed = false;
    const reviewsWithText = richReviews.filter((r) => r.text.trim().length > 0);
    const aiConfidence: "low" | "high" = reviewsWithText.length < 5 ? "low" : "high";

    type ScoredReview = {
      review: RichReview;
      scores: { reliability: number; communication: number; quality: number; value: number };
      topDimension: "reliability" | "communication" | "quality" | "value";
      topReason: string;
    };
    let scoredReviews: ScoredReview[] = [];

    // 1) Per-review sentiment with retry, weighted by recency
    if (reviewsWithText.length > 0) {
      const slice = reviewsWithText.slice(0, 25);
      const results = await Promise.allSettled(
        slice.map((rev) =>
          withRetry(() => scoreReviewSentiment(rev), "scoreReviewSentiment").then((s) => ({
            review: rev,
            scores: { reliability: s.reliability, communication: s.communication, quality: s.quality, value: s.value },
            topDimension: s.topDimension,
            topReason: s.topReason,
          }))
        )
      );
      scoredReviews = results
        .filter((r) => r.status === "fulfilled")
        .map((r: any) => r.value as ScoredReview);

      if (scoredReviews.length === 0) {
        aiFailed = true;
        const r = rating ?? 3;
        const fallbackScore = Math.max(0, Math.min(100, Math.round(40 + (r - 3) * 30)));
        console.error("All per-review sentiment calls failed, using rating-based fallback", fallbackScore);
        ai.reliability = ai.communication = ai.quality = ai.value = fallbackScore;
      } else {
        const now = Date.now();
        let wSum = 0;
        const dims = { reliability: 0, communication: 0, quality: 0, value: 0 };
        for (const entry of scoredReviews) {
          const ageDays = entry.review.publishTime
            ? Math.max(0, (now - new Date(entry.review.publishTime).getTime()) / (24 * 3600 * 1000))
            : 365;
          // Recency weight: review from today = 1.0, ~1 year ago ≈ 0.5, 2+ years ≈ 0.33
          const w = 1 / (1 + ageDays / 365);
          wSum += w;
          dims.reliability += entry.scores.reliability * w;
          dims.communication += entry.scores.communication * w;
          dims.quality += entry.scores.quality * w;
          dims.value += entry.scores.value * w;
        }
        ai.reliability = Math.round(dims.reliability / wSum);
        ai.communication = Math.round(dims.communication / wSum);
        ai.quality = Math.round(dims.quality / wSum);
        ai.value = Math.round(dims.value / wSum);
      }
    } else if (rating) {
      // No review text but we know the star rating — derive a fallback so we don't show flat 60.
      const fallbackScore = Math.max(0, Math.min(100, Math.round(40 + (rating - 3) * 30)));
      ai.reliability = ai.communication = ai.quality = ai.value = fallbackScore;
    }

    // Build per-dimension supporting evidence (max 2 snippets per dim, ~120 chars each).
    const truncate = (s: string, n = 120) => {
      const t = s.replace(/\s+/g, " ").trim();
      return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
    };
    const firstName = (full: string | null) => {
      if (!full) return "Anonymous";
      const first = full.trim().split(/\s+/)[0];
      return first || "Anonymous";
    };
    const relativeDate = (iso: string | null) => {
      if (!iso) return "";
      const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000)));
      if (days < 7) return days <= 1 ? "1 day ago" : `${days} days ago`;
      if (days < 30) {
        const w = Math.floor(days / 7);
        return w === 1 ? "1 week ago" : `${w} weeks ago`;
      }
      if (days < 365) {
        const m = Math.floor(days / 30);
        return m === 1 ? "1 month ago" : `${m} months ago`;
      }
      const y = Math.floor(days / 365);
      return y === 1 ? "1 year ago" : `${y} years ago`;
    };
    const dimensions: Array<"reliability" | "communication" | "quality" | "value"> = [
      "reliability",
      "communication",
      "quality",
      "value",
    ];
    const sentimentEvidence: Record<string, Array<{ snippet: string; author: string; date: string }>> = {
      reliability: [], communication: [], quality: [], value: [],
    };
    const usedTexts = new Set<string>();
    for (const dim of dimensions) {
      const candidates = scoredReviews
        .filter((r) => r.scores[dim] >= 70)
        .sort((a, b) => {
          // Prefer reviews whose topDimension matches this dim, then by score desc.
          const aBoost = a.topDimension === dim ? 5 : 0;
          const bBoost = b.topDimension === dim ? 5 : 0;
          return (b.scores[dim] + bBoost) - (a.scores[dim] + aBoost);
        });
      for (const c of candidates) {
        if (sentimentEvidence[dim].length >= 2) break;
        const key = c.review.text.slice(0, 40);
        if (usedTexts.has(key)) continue;
        // Prefer the model's topReason if it points at this dim, else snippet from review text.
        const raw = c.topDimension === dim && c.topReason ? c.topReason : c.review.text;
        sentimentEvidence[dim].push({
          snippet: truncate(raw, 120),
          author: firstName(c.review.author),
          date: relativeDate(c.review.publishTime),
        });
        usedTexts.add(key);
      }
    }


    // 2) Themes + tips (separate call, also with one retry + smart fallback)
    try {
      const insights = await withRetry(
        () =>
          aiAnalyzeInsights({
            name: company.name,
            rating,
            count,
            reviews,
            website: web,
            reviewsScore: reviewsScoreVal ?? 0,
          }),
        "aiAnalyzeInsights"
      );
      ai.themes = insights.themes;
      ai.tips = insights.tips;
    } catch (e) {
      console.error("aiAnalyzeInsights failed after retry", e);
      aiFailed = true;
    }

    const sentimentAvg = (ai.reliability + ai.communication + ai.quality + ai.value) / 4;
    // When Google Places returns no listing for this business, don't punish them
    // with a fabricated reviews score — re-weight using only sentiment + website.
    const total = hasReviewData
      ? Math.round(
          (reviewsScoreVal ?? 0) * 0.45 + sentimentAvg * 0.3 + web.website_score * 0.25
        )
      : Math.round(sentimentAvg * 0.45 + web.website_score * 0.55);
    const grade = letterGrade(total);

    const companyUpdate: Record<string, any> = {
      google_rating: rating,
      google_review_count: count,
      score: total,
      score_grade: grade,
      last_scored_at: new Date().toISOString(),
    };
    if (placeId && placeId !== company.google_place_id) companyUpdate.google_place_id = placeId;
    if (resolvedWebsite && resolvedWebsite !== company.website) companyUpdate.website = resolvedWebsite;
    if (resolvedPhone && resolvedPhone !== company.phone) companyUpdate.phone = resolvedPhone;

    await supabase
      .from("score_companies")
      .update(companyUpdate)
      .eq("id", company_id);

    await supabase.from("score_company_metrics").upsert(
      {
        company_id,
        reviews_score: reviewsScoreVal,
        sentiment_reliability: ai.reliability,
        sentiment_communication: ai.communication,
        sentiment_quality: ai.quality,
        sentiment_value: ai.value,
        website_score: web.website_score,
        website_has_https: web.website_has_https,
        website_mobile_friendly: web.website_mobile_friendly,
        website_has_booking: web.website_has_booking,
        website_load_ms: web.website_load_ms,
        review_themes: ai.themes,
        ai_tips: ai.tips,
        sentiment_evidence: sentimentEvidence,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "company_id" }
    );

    // Recompute city rank
    if (company.city_slug) {
      const { data: peers } = await supabase
        .from("score_companies")
        .select("id, score")
        .eq("city_slug", company.city_slug)
        .not("score", "is", null)
        .order("score", { ascending: false });
      const rank = (peers ?? []).findIndex((p: any) => p.id === company_id) + 1;
      await supabase
        .from("score_companies")
        .update({ city_rank: rank || null, city_total: peers?.length ?? null })
        .eq("id", company_id);
    }

    const { data: refreshed } = await supabase
      .from("score_companies")
      .select("*")
      .eq("id", company_id)
      .single();
    const { data: metrics } = await supabase
      .from("score_company_metrics")
      .select("*")
      .eq("company_id", company_id)
      .maybeSingle();

    return new Response(
      JSON.stringify({ company: refreshed, metrics, cached: false, aiConfidence, aiFailed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("score-compute error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
