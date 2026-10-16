// generate-daily-blogs
// Phase 3: queue-driven, single-post-per-invocation, draft-only with quality scoring.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireCronSecret } from "../_shared/requireCronSecret.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { anthropicChat, MODEL_SONNET } from "../_shared/anthropic.ts";
import {
  assertGeneratedBlog,
  blogOutputLooksTruncated,
  parseModelJson,
  type GeneratedBlog,
} from "../_shared/blogJson.ts";
import { tidywiseSupportEmail } from "../_shared/email-footer.ts";
import { LIFETIME_SPOT_CAP } from "../_shared/lifetime-cap.ts";
import { escapeHtml } from "../_shared/escapeHtml.ts";
import { hasInternalBrandLink } from "../_shared/blogLinks.ts";
import {
  MAX_KEYWORD_ATTEMPTS,
  attemptsAfterClaim,
  canRetryKeyword,
} from "../_shared/keywordAttempts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_WORD_COUNT = 1500;
// A 1,500-word HTML post plus FAQ is several thousand tokens. 8,000 cut
// responses off mid-JSON ("Expected ',' or '}' after property value").
const GENERATION_MAX_TOKENS = 20000;
const LOW_QUEUE_THRESHOLD = 7;
const MODEL = "openai/gpt-5";
const TITLE_SIMILARITY_THRESHOLD = 0.85;
const COMPETITORS = ["Jobber", "Housecall Pro", "ZenMaid", "Launch27", "ServiceM8", "BookingKoala", "HubSpot"];
const FAILURE_ALERT_EMAIL = tidywiseSupportEmail();
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&q=80";

function generateSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
function titleSimilarity(a: string, b: string): number {
  const ta = tokenize(a); const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const intersection = new Set([...ta].filter((w) => tb.has(w)));
  const union = new Set([...ta, ...tb]);
  return intersection.size / union.size;
}
function countWords(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.split(" ").length : 0;
}
function countCompetitorMentions(html: string): number {
  const lower = html.toLowerCase();
  return COMPETITORS.filter((c) => lower.includes(c.toLowerCase())).length;
}
function countBrandMentions(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
  return (text.match(/tidywise/g) || []).length;
}
function countCompetitorOccurrences(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").toLowerCase();
  let n = 0;
  for (const c of COMPETITORS) {
    const escaped = c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    n += (text.match(new RegExp(escaped, "g")) || []).length;
  }
  return n;
}
function brandInClosing(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text) return false;
  return text.slice(Math.floor(text.length * 0.8)).includes("tidywise");
}
function countNumericSentences(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => /\d/.test(s)).length;
}
function keywordNeedsCompetitors(keyword: string): boolean {
  const k = keyword.toLowerCase();
  return /\b(software|vs\.?|alternative|alternatives|app|apps|tool|tools)\b/.test(k);
}
function calcQualityScore(o: { wordCount: number; hasFaq: boolean; competitorCount: number; hasH2: boolean; hasH3: boolean; hasMeta: boolean; targetKeyword: string; numericSentenceCount: number; brandCount: number; hasBrandLink: boolean; brandClosing: boolean; competitorOccurrences: number }): { score: number; notes: string[] } {
  const notes: string[] = []; let score = 0;
  if (o.wordCount >= 2500) { score += 25; notes.push("Words 25/25"); }
  else if (o.wordCount >= 1500) { score += 18; notes.push("Words 18/25"); }
  else if (o.wordCount >= 1000) { score += 10; notes.push(`Words low ${o.wordCount} 10/25`); }
  else notes.push(`Words too low ${o.wordCount} 0/25`);
  if (o.hasFaq) { score += 15; notes.push("FAQ 15/15"); } else notes.push("FAQ missing 0/15");

  // 20pt slot: competitors ONLY for software/comparison topics; otherwise
  // reward specific numbers/prices in the body (operator-detail signal).
  if (keywordNeedsCompetitors(o.targetKeyword)) {
    if (o.competitorCount >= 5) { score += 20; notes.push(`Competitors ${o.competitorCount} 20/20`); }
    else if (o.competitorCount >= 3) { score += 15; notes.push(`Competitors ${o.competitorCount} 15/20`); }
    else if (o.competitorCount >= 1) { score += 6; notes.push(`Competitors ${o.competitorCount} 6/20`); }
    else notes.push("Competitors 0/20");
  } else {
    if (o.numericSentenceCount >= 8) { score += 20; notes.push(`Specifics ${o.numericSentenceCount} 20/20`); }
    else if (o.numericSentenceCount >= 5) { score += 15; notes.push(`Specifics ${o.numericSentenceCount} 15/20`); }
    else if (o.numericSentenceCount >= 2) { score += 6; notes.push(`Specifics ${o.numericSentenceCount} 6/20`); }
    else notes.push(`Specifics ${o.numericSentenceCount} 0/20`);
  }

  if (o.hasH2 && o.hasH3) { score += 15; notes.push("Structure 15/15"); }
  else if (o.hasH2) { score += 8; notes.push("Structure 8/15"); }
  else notes.push("Structure 0/15");
  if (o.hasMeta) { score += 10; notes.push("Meta 10/10"); } else notes.push("Meta 0/10");

  // Positioning: 15 points, awarded additively so partial credit is possible.
  let pos = 0;
  if (o.brandCount >= 3) { pos += 4; notes.push(`Brand x${o.brandCount} 4/4`); }
  else if (o.brandCount >= 1) { pos += 2; notes.push(`Brand x${o.brandCount} 2/4`); }
  else notes.push("Brand absent 0/4");

  if (o.hasBrandLink) { pos += 5; notes.push("Brand link 5/5"); }
  else notes.push("No internal TidyWise link 0/5");

  if (o.brandClosing) { pos += 3; notes.push("Closing CTA 3/3"); }
  else notes.push("No brand in closing 0/3");

  if (o.competitorOccurrences === 0) { pos += 3; notes.push("SoV n/a 3/3"); }
  else if (o.brandCount >= o.competitorOccurrences) { pos += 3; notes.push(`SoV ${o.brandCount}:${o.competitorOccurrences} 3/3`); }
  else if (o.brandCount * 2 >= o.competitorOccurrences) { pos += 1; notes.push(`SoV ${o.brandCount}:${o.competitorOccurrences} 1/3`); }
  else notes.push(`SoV ${o.brandCount}:${o.competitorOccurrences} 0/3 — competitor-dominant`);

  score += pos;
  return { score: Math.min(100, score), notes };
}

const VERIFIED_FACTS = `TidyWise Cleaning is a 4.9-star rated residential and commercial cleaning company (138+ reviews) operating in Broward and Palm Beach counties, South Florida. Services include residential, Airbnb turnover, commercial, post-construction, and carpet/upholstery cleaning. Founded and run by the author.`;

const SYSTEM_PROMPT = `You are a senior SEO content strategist writing for cleaning business OWNERS on TidyWise (an all-in-one cleaning business platform).

Audience: people running cleaning companies (1-50 employees) — NOT homeowners.
Voice: founder-to-founder, B2B, direct, value-first. Short paragraphs, real numbers.

VERIFIED_FACTS: ${VERIFIED_FACTS}

When writing in first person about the author's business, use ONLY the verified facts above. NEVER invent specific first-person metrics (revenue figures, van counts, utilization percentages, route names, crew counts). Industry statistics and typical price ranges are fine, but present them as industry knowledge ("most cleaning companies see...", "a typical 3-person crew..."), not as personal claims. Realistic illustrative scenarios are fine if framed as examples, not as the author's own numbers.

Depth over length. Never pad. Cut any sentence that doesn't teach something.

FACTS YOU MUST NOT INVENT. These are the only correct values. If a fact you want to state is not on this list, leave it out rather than guessing:
  - Free trial: 30 days of Pro, no card. Never any other number for new signups. Existing trials keep the end date already on the account.
  - Plans: Basic $49/mo, Pro $97/mo, Custom $197/mo. Yearly billing includes 2 months free.
  - Lifetime: one-time $300, limited to the first ${LIFETIME_SPOT_CAP} customers.
  - There is NO $50 tier, NO free-forever tier, and NO money-back guarantee. All payments are final and non-refundable per our Terms of Service.
  - Never state a price, trial length, discount or guarantee for TidyWise that does not appear above.
You MAY state competitors' pricing where you are confident, but attribute it and prefer ranges over precise figures you cannot verify.

Every post MUST:
- Be at least ${MIN_WORD_COUNT} words of body content
- Reference TidyWise at least 3 times across the post, worked into the argument rather than repeated as a slogan
- Include at least one internal link to /pricing, /features/*, or /compare/*
- When competitors are named, give TidyWise at least equal weight — do not write a roundup that never makes our case
- Keep the closing CTA mentioning TidyWise
- Use proper HTML: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <a>
- Open with an H2 intro (no H1 — title is rendered separately)
- Include 4 to 7 H2 sections; use H3s only where the content genuinely needs subdivision. Vary structure between posts.
- Include an FAQ section near the end (use <h2>Frequently Asked Questions</h2>) with 3 to 6 Q&As answering questions real owners actually ask
- End with a conclusion that includes a soft CTA mentioning TidyWise naturally
- Include 2-4 internal links in the body as <a href> tags to relevant TidyWise pages (/pricing, /features/*, /compare/*, /blog/*) with natural anchor text
- Mention competitors ONLY when the topic is about software selection or comparisons (available names: ${COMPETITORS.join(", ")}). For operational topics (pricing, hiring, cleaning techniques, client management), do not force competitor mentions.
- Position TidyWise honestly — never spammy. Acknowledge competitor strengths when they do appear.
- meta_title under 60 chars, meta_description under 155 chars
- Be unique — do not reuse phrasing

CRITICAL: Submit the finished post by calling the submit_blog_post tool exactly once. Do not wrap it in markdown or add commentary. Every field must be complete — do not stop mid-sentence or mid-tag.`;

function buildUserPrompt(targetKeyword: string, intent: string | null): string {
  const note = intent === "bottom_funnel" ? "High-commercial intent. Lean into product comparison and decision criteria."
    : intent === "middle_funnel" ? "Middle-funnel research. Focus on actionable how-to with software/tool recommendations."
    : "Top-funnel awareness. Educate first, mention tools naturally.";
  return `Write a comprehensive SEO blog post targeting: "${targetKeyword}"
Intent: ${intent || "general"}. ${note}

Call submit_blog_post with:
- title (max 70 chars), slug (lowercase-hyphenated), excerpt (max 200 chars)
- content: HTML body of at least ${MIN_WORD_COUNT} words
- meta_title (max 60), meta_description (max 155)
- secondary_keywords: array of strings
- faq: 3 to 6 objects with question and answer`;
}

type ChatTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

const BLOG_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "submit_blog_post",
    description: "Submit one finished blog post. HTML in content must be complete.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "slug", "excerpt", "content", "meta_title", "meta_description", "secondary_keywords", "faq"],
      properties: {
        title: { type: "string" },
        slug: { type: "string" },
        excerpt: { type: "string" },
        content: { type: "string" },
        meta_title: { type: "string" },
        meta_description: { type: "string" },
        secondary_keywords: { type: "array", items: { type: "string" } },
        faq: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["question", "answer"],
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
            },
          },
        },
      },
    },
  },
};

interface ModelCompletion {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
  }>;
}

function clipError(message: string): string {
  const max = 500;
  return message.length <= max ? message : `${message.slice(0, max)}…`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRetryableBlogError(err: unknown): boolean {
  const msg = errorText(err);
  if (/ANTHROPIC_API_KEY not configured/i.test(msg)) return false;
  if (/rate limit/i.test(msg)) return false;
  if (/Anthropic (401|403|429)\b/.test(msg)) return false;
  return true;
}

function blogFromCompletion(data: ModelCompletion): GeneratedBlog {
  const choice = data.choices?.[0];
  const finish = choice?.finish_reason ?? null;
  const toolCall = choice?.message?.tool_calls?.find((call) => call.function?.name === "submit_blog_post")
    ?? choice?.message?.tool_calls?.[0];
  const args = toolCall?.function?.arguments;
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";

  let parsed: unknown;
  if (typeof args === "string" && args.trim()) {
    parsed = parseModelJson(args);
    if (typeof parsed === "string") parsed = parseModelJson(parsed);
  } else if (text.trim()) {
    parsed = parseModelJson(text);
  } else {
    throw new Error(`Empty response from AI (finish_reason=${finish ?? "none"})`);
  }

  const blog = assertGeneratedBlog(parsed);
  const truncated = blogOutputLooksTruncated(blog, finish, GENERATION_MAX_TOKENS);
  if (truncated) throw new Error(truncated);
  return blog;
}

async function requestBlog(systemPrompt: string, userPrompt: string): Promise<GeneratedBlog> {
  const res = await anthropicChat({
    model: MODEL_SONNET,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    tools: [BLOG_TOOL],
    tool_choice: { type: "function", function: { name: "submit_blog_post" } },
    max_tokens: GENERATION_MAX_TOKENS,
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("AI is temporarily rate limited");
    throw new Error(`Anthropic ${res.status}: ${text.substring(0, 300)}`);
  }
  let data: ModelCompletion;
  try {
    data = await res.json() as ModelCompletion;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Blog JSON parse failed reading the model response: ${err.message}`);
    }
    throw err;
  }
  return blogFromCompletion(data);
}

async function callLovableAI(systemPrompt: string, userPrompt: string): Promise<GeneratedBlog> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY not configured");
  try {
    return await requestBlog(systemPrompt, userPrompt);
  } catch (first) {
    if (!isRetryableBlogError(first)) throw first;
    const firstMsg = errorText(first);
    console.warn(`[generate] blog JSON failed, retrying once: ${firstMsg}`);
    try {
      return await requestBlog(
        systemPrompt,
        `${userPrompt}\n\nThe previous attempt failed: ${firstMsg}\nCall submit_blog_post exactly once with a complete HTML body. Escape quotes inside strings. Do not stop mid-tag.`,
      );
    } catch (second) {
      throw new Error(clipError(
        `Blog generation failed after retry. ${errorText(second)} First attempt: ${firstMsg}`,
      ));
    }
  }
}

// Second-pass "humanizer." Rewrites the HTML body to remove AI tells —
// uniform sentence rhythm, hedging, formulaic transitions ("Moreover,
// furthermore..."), and the over-cleaned prose that AI detectors flag.
// Returns the rewritten HTML; falls back to the original if the rewrite
// fails so a humanizer outage doesn't block publishing.
const HUMANIZER_SYSTEM = `You are a senior B2B editor who rewrites AI-generated drafts so they read like a person wrote them.

Task: Rewrite the HTML body. Keep ALL <h2>, <h3>, <ul>, <ol>, <li>, <strong>, and <script type="application/ld+json"> tags exactly. Keep the structure, headings, facts, and length (do not shorten). Preserve all FAQ Q&As verbatim if they exist.

What to change:
- Vary sentence length — mix short punchy sentences with longer ones.
- Cut formulaic transitions ("Moreover," "Furthermore," "In conclusion," "It is important to note that," "delve into," "navigate the complexities").
- Replace passive voice with active where natural.
- Add one or two specific real-world details where a section feels generic (e.g., "after 200+ jobs," "a 3-cleaner crew," "a $1,500 weekly route").
- Use contractions ("it's," "don't," "you'll").
- Remove em-dashes used purely for flair — replace with comma or period.
- Sound like a founder writing for other founders. No filler.

What to keep:
- Every heading and structural HTML tag, exactly.
- Every fact, claim, and competitor mention.
- The overall word count (±10%).
- The soft CTA mentioning TidyWise.

Submit the rewrite by calling submit_rewritten_html once. The content string must be the full HTML, complete through the closing tag.`;

const HUMANIZER_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "submit_rewritten_html",
    description: "Submit the rewritten HTML body.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["content"],
      properties: { content: { type: "string" } },
    },
  },
};

async function humanizePass(html: string): Promise<string> {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return html;
  try {
    const res = await anthropicChat({
      model: MODEL_SONNET,
      messages: [
        { role: "system", content: HUMANIZER_SYSTEM },
        { role: "user", content: `Rewrite this HTML body:\n\n${html}` },
      ],
      tools: [HUMANIZER_TOOL],
      tool_choice: { type: "function", function: { name: "submit_rewritten_html" } },
      max_tokens: GENERATION_MAX_TOKENS,
    });
    if (!res.ok) {
      console.warn(`[humanizer] returned ${res.status} — keeping original draft`);
      return html;
    }
    const data = await res.json() as ModelCompletion;
    const choice = data.choices?.[0];
    const args = choice?.message?.tool_calls?.[0]?.function?.arguments;
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const raw = typeof args === "string" && args.trim() ? args : text;
    if (!raw.trim()) return html;
    const parsed = parseModelJson(raw);
    const content = parsed && typeof parsed === "object" && typeof (parsed as { content?: unknown }).content === "string"
      ? (parsed as { content: string }).content.trim()
      : "";
    const closed = /<\/(p|ul|ol|li|h2|h3)>\s*$/i.test(content);
    if (!content || content.length < html.length * 0.5 || (choice?.finish_reason === "length" && !closed)) {
      console.warn(
        `[humanizer] rewrite unusable (${content.length} chars, finish=${choice?.finish_reason ?? "none"}) — keeping original draft`,
      );
      return html;
    }
    return content;
  } catch (e) {
    console.warn(`[humanizer] failed — keeping original draft: ${errorText(e)}`);
    return html;
  }
}

async function fetchUnsplashImage(keyword: string): Promise<string> {
  const accessKey = Deno.env.get("UNSPLASH_ACCESS_KEY");
  if (!accessKey) { console.log("UNSPLASH_ACCESS_KEY not set — using fallback"); return FALLBACK_IMAGE; }
  const query = keyword.toLowerCase().replace(/\b(what|is|the|best|how|do|i|for|a|an|my|to)\b/g, "").replace(/\s+/g, " ").trim() || "cleaning business";
  try {
    const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${accessKey}` } });
    if (!res.ok) return FALLBACK_IMAGE;
    const data = await res.json();
    return data?.results?.[0]?.urls?.regular || FALLBACK_IMAGE;
  } catch (e) { console.error("Unsplash failed:", e); return FALLBACK_IMAGE; }
}

async function sendFailureAlert(errors: string[]) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) { console.warn("RESEND_API_KEY not set — cannot send alert"); return; }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "TidyWise Blog Bot <noreply@jointidywise.com>",
        to: [FAILURE_ALERT_EMAIL],
        subject: "🚨 Blog generation — 3 consecutive failures",
        html: `<h2>Blog generation needs attention</h2><p>3 consecutive failures detected.</p><h3>Recent errors:</h3><ul>${errors.map((e) => `<li><code>${escapeHtml(e)}</code></li>`).join("")}</ul><p>Review at <a href="https://jointidywise.com/admin/blog/keywords">/admin/blog/keywords</a>.</p>`,
      }),
    });
  } catch (e) { console.error("Alert failed:", e); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Cron auth gate
  const cronGate = requireCronSecret(req);
  if (cronGate) return cronGate;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // AI rate limiting (global 200/hr — this is a platform-wide cron worker, no per-org scope).
  const { enforceAiRateLimit } = await import("../_shared/ai-rate-limit.ts");
  const GLOBAL_BLOG_SCOPE = "00000000-0000-0000-0000-0000000dab10"; // sentinel org id for blog gen
  const limited = await enforceAiRateLimit(supabase, { orgId: GLOBAL_BLOG_SCOPE, corsHeaders });
  if (limited) return limited;

  // Body opt-in: auto-publish? Cron passes auto_publish true (the daily
  // 10:00 UTC job). Manual admin generate sends {auto_publish:false} to
  // keep posts in draft for review.
  let autoPublish = true;
  try {
    const body = await req.clone().json().catch(() => ({} as any));
    if (typeof body?.auto_publish === "boolean") autoPublish = body.auto_publish;
  } catch { /* no body — keep default */ }

  try {
    // Safety: a row stuck in_progress for >30min was a timeout or crash.
    // Requeue it only while it still has attempts left. At the cap, leave
    // it failed so a keyword that never finishes does not retry forever.
    const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase.from("blog_keyword_queue")
      .update({ status: "failed", error_message: "stopped after 5 attempts" })
      .eq("status", "in_progress")
      .lt("last_attempted_at", staleCutoff)
      .gte("attempts", MAX_KEYWORD_ATTEMPTS);
    await supabase.from("blog_keyword_queue")
      .update({ status: "queued", error_message: "auto-reset from stuck in_progress" })
      .eq("status", "in_progress")
      .lt("last_attempted_at", staleCutoff)
      .lt("attempts", MAX_KEYWORD_ATTEMPTS);

    const { count: queuedCount, error: countErr } = await supabase
      .from("blog_keyword_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .lt("attempts", MAX_KEYWORD_ATTEMPTS);
    const queued = countErr ? null : (queuedCount ?? 0);
    if (countErr) {
      console.error(`[blog-queue] could not count queued keywords: ${countErr.message}`);
    } else if (queued != null && queued < LOW_QUEUE_THRESHOLD) {
      console.warn(
        `[blog-queue] low keyword queue: ${queued} queued (threshold ${LOW_QUEUE_THRESHOLD}). Add keywords at /admin/blog/keywords before the daily publisher runs dry.`,
      );
    }

    const { data: nextKeywords, error: qErr } = await supabase
      .from("blog_keyword_queue").select("*").eq("status", "queued")
      .lt("attempts", MAX_KEYWORD_ATTEMPTS)
      .order("priority", { ascending: true }).order("created_at", { ascending: true }).limit(1);
    if (qErr) throw qErr;
    if (!nextKeywords || nextKeywords.length === 0) {
      if (queued == null) {
        console.warn(
          `[blog-queue] low keyword queue: 0 queued (threshold ${LOW_QUEUE_THRESHOLD}). Add keywords at /admin/blog/keywords before the daily publisher runs dry.`,
        );
      }
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: "Queue empty",
        queued: 0,
        low_queue: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const queueRow = nextKeywords[0];
    if (!canRetryKeyword(queueRow.attempts)) {
      await supabase.from("blog_keyword_queue")
        .update({ status: "failed", error_message: "stopped after 5 attempts" })
        .eq("id", queueRow.id);
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: "Keyword exhausted its attempts",
        queued: queued ?? 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // Count this try at claim time. A crash before the catch used to leave
    // attempts unchanged, and the 30-minute reset queued the same row forever.
    const attemptsNow = attemptsAfterClaim(queueRow.attempts);

    await supabase.from("blog_keyword_queue")
      .update({
        status: "in_progress",
        last_attempted_at: new Date().toISOString(),
        attempts: attemptsNow,
      })
      .eq("id", queueRow.id);

    // Background task: generation can take 60-120s (AI + humanizer). Return 202
    // immediately and let EdgeRuntime.waitUntil keep the worker alive.
    const work = (async () => {
      try {
        console.log(`[bg] starting generation for "${queueRow.keyword}"`);
        const post = await callLovableAI(SYSTEM_PROMPT, buildUserPrompt(queueRow.keyword, queueRow.intent));

        post.content = await humanizePass(post.content);

        const wordCount = countWords(post.content);
        const competitorCount = countCompetitorMentions(post.content);
        const numericSentenceCount = countNumericSentences(post.content);
        const brandCount = countBrandMentions(post.content);
        const hasBrandLink = hasInternalBrandLink(post.content);
        const brandClosing = brandInClosing(post.content);
        const competitorOccurrences = countCompetitorOccurrences(post.content);
        const hasFaq = /frequently asked|<h2[^>]*>\s*faq/i.test(post.content);
        const hasH2 = /<h2/i.test(post.content);
        const hasH3 = /<h3/i.test(post.content);
        const hasMeta = !!(post.meta_title && post.meta_description);

        const { data: existing } = await supabase.from("blog_posts")
          .select("title, slug").in("status", ["published", "draft"]).limit(500);
        const similar = (existing || []).find((p) => titleSimilarity(p.title, post.title) >= TITLE_SIMILARITY_THRESHOLD);
        let slug = post.slug ? generateSlug(post.slug) : generateSlug(post.title);
        const { data: slugClash } = await supabase.from("blog_posts").select("id").eq("slug", slug).maybeSingle();
        if (slugClash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

        const { score, notes } = calcQualityScore({ wordCount, hasFaq, competitorCount, hasH2, hasH3, hasMeta, targetKeyword: queueRow.keyword, numericSentenceCount, brandCount, hasBrandLink, brandClosing, competitorOccurrences });
        const validationNotes: string[] = [...notes];
        if (similar) validationNotes.push(`⚠️ Similar to: "${similar.title}"`);

        const featured_image_url = await fetchUnsplashImage(queueRow.keyword);

        let finalContent = post.content;
        if (post.faq && post.faq.length > 0 && !/itemtype="https:\/\/schema\.org\/FAQPage"/.test(finalContent)) {
          const faqJsonLd = {
            "@context": "https://schema.org", "@type": "FAQPage",
            mainEntity: post.faq.map((q) => ({
              "@type": "Question", name: q.question,
              acceptedAnswer: { "@type": "Answer", text: q.answer },
            })),
          };
          finalContent += `\n<script type="application/ld+json">${JSON.stringify(faqJsonLd).replace(/</g, "\\u003c")}</script>`;
        }

        const tooLowQuality = score < 60;
        // Hard publish floor, independent of score: a post that never names
        // TidyWise or offers no conversion path is never auto-published.
        const noPositioning = brandCount === 0 || !hasBrandLink;
        if (noPositioning) validationNotes.push("⚠️ Held as draft: no TidyWise positioning (brand mention and/or internal link missing)");
        const shouldPublish = autoPublish && !similar && !tooLowQuality && !noPositioning;
        const nowIso = new Date().toISOString();

        const { data: inserted, error: insErr } = await supabase.from("blog_posts").insert({
          title: post.title, slug, excerpt: post.excerpt, content: finalContent,
          meta_title: post.meta_title, meta_description: post.meta_description,
          target_keyword: queueRow.keyword, secondary_keywords: post.secondary_keywords || [],
          word_count: wordCount, ai_model_used: MODEL, featured_image_url,
          category: "Cleaning Business", author: "TidyWise Team",
          status: shouldPublish ? "published" : "draft",
          is_published: shouldPublish,
          published_at: shouldPublish ? nowIso : null,
          quality_score: score, quality_notes: validationNotes.join(" • "),
        }).select("id, slug, title").single();

        if (insErr) throw insErr;

        await supabase.from("blog_keyword_queue")
          .update({ status: "completed", generated_post_id: inserted.id, error_message: null })
          .eq("id", queueRow.id);
        console.log(`[bg] completed "${queueRow.keyword}" → ${inserted.slug} (score ${score})`);
      } catch (e) {
        const msg = clipError(errorText(e));
        console.error(`[bg] failed "${queueRow.keyword}":`, msg);
        await supabase.from("blog_keyword_queue")
          .update({ status: "failed", error_message: msg, attempts: attemptsNow })
          .eq("id", queueRow.id);
        const { data: recentFailures } = await supabase.from("blog_keyword_queue")
          .select("error_message").eq("status", "failed")
          .order("last_attempted_at", { ascending: false }).limit(3);
        if (recentFailures && recentFailures.length >= 3) {
          await sendFailureAlert(recentFailures.map((r) => r.error_message || "Unknown"));
        }
      }
    })();

    const acceptedBody = {
      accepted: true,
      keyword: queueRow.keyword,
      queue_id: queueRow.id,
      queued: queued ?? null,
      low_queue: queued != null && queued < LOW_QUEUE_THRESHOLD,
    };
    // Supabase keeps the isolate alive for waitUntil. Without it, returning
    // 202 drops the generation when the request ends, and the keyword stays
    // in_progress until the 30-minute reset.
    const edgeWaitUntil = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
    if (edgeWaitUntil) {
      edgeWaitUntil(work);
      return new Response(JSON.stringify(acceptedBody), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await work;
    return new Response(JSON.stringify({ ...acceptedBody, completed: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-daily-blogs error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
