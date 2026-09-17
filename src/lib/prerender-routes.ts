/**
 * Build-time per-route static HTML generator.
 *
 * Reads dist/index.html, enumerates all known marketing routes, and emits
 * dist/<route>/index.html for each one with proper title / description /
 * canonical / og:* / twitter:* tags and an injected <h1> inside #root.
 *
 * Non-JS crawlers (Encited, Googlebot's initial fetch, ChatGPT crawler) see
 * the correct per-page tags instead of the homepage placeholder. React still
 * mounts normally over `#root` and replaces the <h1> on hydration.
 *
 * No headless browser or runtime required — just templated string emission.
 * Invoked from vite.config.ts via prerenderPlugin() on closeBundle.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATIC_ROUTE_META,
  locationRouteMeta,
  scoreCompanyRouteMeta,
  blogPostRouteMeta,
  scoreCityRouteMeta,
  compareNicheRouteMeta,
  type RouteMeta,
  type ScoreCompanyForMeta,
  type BlogPostForMeta,
  type ScoreCityForMeta,
} from "./routeMeta";
import { locationData, type LocationData } from "../data/locationData";
import { COMPETITORS, NICHES, TIDYWISE_FEATURE_MAP } from "../data/compareNicheData";

const SUPABASE_URL = "https://slwfkaqczvwvvvavkgpr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsd2ZrYXFjenZ3dnZ2YXZrZ3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNjk4OTQsImV4cCI6MjA4MTY0NTg5NH0.M0OhzHsrqA0oYh6Ykx_4gVK_SrdSi1V_CiFxU-n4Lec";

async function fetchScoreCompanies(): Promise<ScoreCompanyForMeta[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/score_companies?select=slug,name,city,state,zip,formatted_address,latitude,longitude,website,phone,score,google_rating,google_review_count&limit=5000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) {
      console.warn(`[prerender] score_companies fetch failed: ${res.status}`);
      return [];
    }
    return (await res.json()) as ScoreCompanyForMeta[];
  } catch (err) {
    console.warn(`[prerender] score_companies fetch error:`, err);
    return [];
  }
}

async function fetchBlogPosts(): Promise<BlogPostForMeta[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/blog_posts?select=slug,title,meta_title,meta_description,excerpt,author,published_at,updated_at,content&status=eq.published&limit=5000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) {
      console.warn(`[prerender] blog_posts fetch failed: ${res.status}`);
      return [];
    }
    return (await res.json()) as BlogPostForMeta[];
  } catch (err) {
    console.warn(`[prerender] blog_posts fetch error:`, err);
    return [];
  }
}

async function fetchScoreCities(): Promise<ScoreCityForMeta[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/score_top_cities?select=city_slug,city,state&limit=5000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) {
      console.warn(`[prerender] score_top_cities fetch failed: ${res.status}`);
      return [];
    }
    return (await res.json()) as ScoreCityForMeta[];
  } catch (err) {
    console.warn(`[prerender] score_top_cities fetch error:`, err);
    return [];
  }
}

const BASE_URL = "https://www.jointidywise.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replace tags by attribute selector. Targets the *existing* tag in
 * index.html so the order in <head> is preserved (Encited cares about order).
 */
function buildStateGridNoscript(): string {
  const items = Object.entries(locationData)
    .filter(([, loc]) => loc.type === "state")
    .map(
      ([slug, loc]) =>
        `<li><a href="/cleaning-business-software/${slug}">Cleaning business software in ${loc.name}</a></li>`
    )
    .join("");
  return `<nav aria-label="Cleaning business software by state"><ul>${items}</ul></nav>`;
}

function noscriptBodyFor(route: string, meta: RouteMeta): string | undefined {
  if (route === "/cleaning-business-software") return buildStateGridNoscript();
  return meta.noscriptBody;
}

// ─── Prerender body content builders ──────────────────────────────────────────
// These produce visible HTML injected inside #root. React's createRoot replaces
// #root children on mount, so users see this for <1s before JS loads. Crawlers
// reading the static HTML see real content instead of a blank page.

function buildScoreCompanyBody(c: ScoreCompanyForMeta): string {
  const location = [c.city, c.state].filter(Boolean).join(", ");
  const parts: string[] = [];
  if (c.score != null) {
    parts.push(`<p><strong>TidyWise Score:</strong> ${c.score}/100</p>`);
  }
  if (location) {
    parts.push(`<p><strong>Location:</strong> ${escapeHtml(location)}</p>`);
  }
  if (c.formatted_address) {
    parts.push(`<p><strong>Address:</strong> ${escapeHtml(c.formatted_address)}</p>`);
  }
  if (c.google_rating && c.google_review_count) {
    parts.push(
      `<p><strong>Google Rating:</strong> ${c.google_rating}/5 based on ${c.google_review_count} reviews</p>`
    );
  }
  if (c.phone) {
    parts.push(`<p><strong>Phone:</strong> ${escapeHtml(c.phone)}</p>`);
  }
  if (c.website) {
    parts.push(`<p><strong>Website:</strong> ${escapeHtml(c.website)}</p>`);
  }
  parts.push(
    `<p>The TidyWise Score analyzes online reviews, reputation signals, and business presence to rate cleaning companies on a 0–100 scale.</p>`
  );
  const citySlug = c.city && c.state
    ? `${c.city.toLowerCase().replace(/\s+/g, "-")}-${c.state.toLowerCase()}`
    : null;
  parts.push(`<nav aria-label="Related"><ul>`);
  if (citySlug) {
    parts.push(`<li><a href="/score/city/${citySlug}">More cleaning companies in ${escapeHtml(c.city!)}</a></li>`);
  }
  parts.push(`<li><a href="/score/search">Search all cleaning companies</a></li>`);
  parts.push(`<li><a href="/pricing">TidyWise pricing</a></li>`);
  parts.push(`</ul></nav>`);
  return parts.join("");
}

function buildScoreCityBody(
  city: ScoreCityForMeta,
  allCompanies: ScoreCompanyForMeta[]
): string {
  const label = `${city.city}, ${city.state}`;
  const cityCompanies = allCompanies
    .filter((c) => c.city === city.city && c.state === city.state && c.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 25);

  const parts: string[] = [];
  parts.push(`<p>Rankings of cleaning companies in ${escapeHtml(label)} by TidyWise Score — an AI analysis of reviews, reputation, and online presence.</p>`);

  if (cityCompanies.length > 0) {
    parts.push(`<ol>`);
    for (const c of cityCompanies) {
      parts.push(
        `<li><a href="/score/c/${c.slug}">${escapeHtml(c.name)}</a> — Score: ${c.score}/100`
        + (c.google_rating ? ` · ${c.google_rating}/5 Google rating` : "")
        + `</li>`
      );
    }
    parts.push(`</ol>`);
  } else {
    parts.push(`<p>No scored cleaning companies found in ${escapeHtml(label)} yet.</p>`);
  }

  parts.push(`<nav aria-label="Related"><ul>`);
  parts.push(`<li><a href="/score/search">Search all cleaning companies</a></li>`);
  parts.push(`<li><a href="/cleaning-business-software">Cleaning software by state</a></li>`);
  parts.push(`<li><a href="/pricing">TidyWise pricing — plans from $49/mo</a></li>`);
  parts.push(`</ul></nav>`);
  return parts.join("");
}

function buildStatePageBody(slug: string, loc: LocationData): string {
  const parts: string[] = [];
  parts.push(`<p>${escapeHtml(loc.intro)}</p>`);
  parts.push(`<p>${escapeHtml(loc.marketContext)}</p>`);

  if (loc.topCities && loc.topCities.length > 0) {
    parts.push(`<h2>Major cities in ${escapeHtml(loc.name)}</h2><ul>`);
    for (const city of loc.topCities) {
      parts.push(`<li>${escapeHtml(city)}</li>`);
    }
    parts.push(`</ul>`);
  }

  if (loc.faqs.length > 0) {
    parts.push(`<h2>Frequently Asked Questions</h2><dl>`);
    for (const faq of loc.faqs) {
      parts.push(`<dt>${escapeHtml(faq.question)}</dt><dd>${escapeHtml(faq.answer)}</dd>`);
    }
    parts.push(`</dl>`);
  }

  parts.push(`<nav aria-label="Related"><ul>`);
  parts.push(`<li><a href="/cleaning-business-software">All states</a></li>`);
  parts.push(`<li><a href="/pricing">TidyWise pricing — plans from $49/mo</a></li>`);
  parts.push(`<li><a href="/blog">Cleaning business blog</a></li>`);
  parts.push(`</ul></nav>`);
  return parts.join("");
}

function buildBlogPostBody(post: BlogPostForMeta): string {
  const parts: string[] = [];
  const byline: string[] = [];
  if (post.author) byline.push(`By ${escapeHtml(post.author)}`);
  if (post.published_at) {
    const d = new Date(post.published_at);
    byline.push(d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }));
  }
  if (byline.length > 0) parts.push(`<p>${byline.join(" · ")}</p>`);
  if (post.excerpt) parts.push(`<p>${escapeHtml(post.excerpt)}</p>`);

  // Inject full article HTML if available. The content is sanitised HTML from
  // the CMS — safe to inline. Escape </script> sequences just in case.
  if (post.content) {
    parts.push(post.content.replace(/<\/script/gi, "&lt;/script"));
  }

  parts.push(`<nav aria-label="Related"><ul>`);
  parts.push(`<li><a href="/blog">Back to blog</a></li>`);
  parts.push(`<li><a href="/pricing">TidyWise pricing</a></li>`);
  parts.push(`<li><a href="/demo">Book a demo</a></li>`);
  parts.push(`</ul></nav>`);
  return parts.join("");
}

function buildCompareNicheBody(
  comp: { name: string; pricing: string; positioning: string; weaknesses: string[]; features: Record<string, boolean | string> },
  compSlug: string,
  niche: { name: string; inline: string; intro: string; painPoints: string[]; tidywiseFeatures: { title: string; description: string }[]; tableRows: string[]; faqs: { question: string; answer: string }[] }
): string {
  const parts: string[] = [];
  parts.push(`<p>${escapeHtml(niche.intro)}</p>`);
  parts.push(`<p>${escapeHtml(comp.positioning)}</p>`);

  parts.push(`<h2>Challenges for ${escapeHtml(niche.name)}</h2><ul>`);
  for (const p of niche.painPoints) {
    parts.push(`<li>${escapeHtml(p)}</li>`);
  }
  parts.push(`</ul>`);

  parts.push(`<h2>How TidyWise Helps ${escapeHtml(niche.name)}</h2><ul>`);
  for (const f of niche.tidywiseFeatures) {
    parts.push(`<li><strong>${escapeHtml(f.title)}:</strong> ${escapeHtml(f.description)}</li>`);
  }
  parts.push(`</ul>`);

  // Feature comparison table
  parts.push(`<h2>Feature Comparison: TidyWise vs ${escapeHtml(comp.name)}</h2>`);
  parts.push(`<table><thead><tr><th>Feature</th><th>TidyWise</th><th>${escapeHtml(comp.name)}</th></tr></thead><tbody>`);
  for (const row of niche.tableRows) {
    const tw = TIDYWISE_FEATURE_MAP[row];
    const them = comp.features[row];
    const fmtVal = (v: boolean | string | undefined) =>
      v === true ? "Yes" : v === false ? "No" : typeof v === "string" ? escapeHtml(v) : "—";
    parts.push(`<tr><td>${escapeHtml(row)}</td><td>${fmtVal(tw)}</td><td>${fmtVal(them)}</td></tr>`);
  }
  parts.push(`</tbody></table>`);

  if (niche.faqs.length > 0) {
    parts.push(`<h2>Frequently Asked Questions</h2><dl>`);
    for (const faq of niche.faqs) {
      const q = faq.question.replace(/\{competitor\}/g, comp.name);
      const a = faq.answer.replace(/\{competitor\}/g, comp.name);
      parts.push(`<dt>${escapeHtml(q)}</dt><dd>${escapeHtml(a)}</dd>`);
    }
    parts.push(`</dl>`);
  }

  parts.push(`<nav aria-label="Related"><ul>`);
  parts.push(`<li><a href="/compare/${compSlug}">Full TidyWise vs ${escapeHtml(comp.name)} comparison</a></li>`);
  parts.push(`<li><a href="/pricing">TidyWise pricing — $49/mo flat</a></li>`);
  parts.push(`<li><a href="/demo">Book a demo</a></li>`);
  parts.push(`</ul></nav>`);
  return parts.join("");
}

/**
 * Build the prerender body for a given route using all available build-time data.
 * Returns empty string for routes where no content can be generated.
 */
function buildPrerenderBody(
  route: string,
  _meta: RouteMeta,
  scoreBySlug: Map<string, ScoreCompanyForMeta>,
  blogBySlug: Map<string, BlogPostForMeta>,
  cityBySlug: Map<string, ScoreCityForMeta>,
  scoreCompanies: ScoreCompanyForMeta[]
): string {
  const scoreMatch = route.match(/^\/score\/c\/([a-z0-9-]+)$/i);
  if (scoreMatch) {
    const c = scoreBySlug.get(scoreMatch[1]);
    if (c) return buildScoreCompanyBody(c);
  }

  const cityMatch = route.match(/^\/score\/city\/([a-z0-9-]+)$/i);
  if (cityMatch) {
    const city = cityBySlug.get(cityMatch[1]);
    if (city) return buildScoreCityBody(city, scoreCompanies);
  }

  const locMatch = route.match(/^\/cleaning-business-software\/([a-z0-9-]+)$/);
  if (locMatch) {
    const loc = locationData[locMatch[1]];
    if (loc) return buildStatePageBody(locMatch[1], loc);
  }

  const blogMatch = route.match(/^\/blog\/post\/([a-z0-9-]+)$/i);
  if (blogMatch) {
    const p = blogBySlug.get(blogMatch[1]);
    if (p) return buildBlogPostBody(p);
  }

  const nicheMatch = route.match(/^\/compare\/([a-z0-9-]+)\/for\/([a-z0-9-]+)$/i);
  if (nicheMatch) {
    const comp = COMPETITORS[nicheMatch[1]];
    const niche = NICHES[nicheMatch[2]];
    if (comp && niche) return buildCompareNicheBody(comp, nicheMatch[1], niche);
  }

  return "";
}

function patchHead(html: string, route: string, meta: RouteMeta): string {
  const canonicalRoute = meta.canonicalPath ?? (route === "/" ? "/" : route);
  const canonical = `${BASE_URL}${canonicalRoute}`;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const ogImage = `${BASE_URL}/images/tidywise-og.png`;

  let out = html;

  // <title>
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);

  // <meta name="description">
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta name="description" content="${description}" />`
  );

  // og:title / og:description / og:url
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta property="og:title" content="${title}" />`
  );
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta property="og:description" content="${description}" />`
  );
  out = out.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta property="og:url" content="${canonical}" />`
  );
  out = out.replace(
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta property="og:image" content="${ogImage}" />`
  );

  // twitter:title / twitter:description
  out = out.replace(
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta name="twitter:title" content="${title}" />`
  );
  out = out.replace(
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta name="twitter:description" content="${description}" />`
  );
  out = out.replace(
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?\s*>/i,
    `<meta name="twitter:image" content="${ogImage}" />`
  );

  // <link rel="canonical">
  out = out.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?\s*>/i,
    `<link rel="canonical" href="${canonical}" />`
  );

  // Inject crawler-readable content inside #root.
  //
  // It used to render as plain, unstyled text filling the viewport for the
  // fraction of a second before React mounted — every visitor to
  // jointidywise.com saw a wall of raw copy flash before the real homepage.
  // The markup is still in the DOM (same text, same <h1>, same order, so
  // crawlers that don't run JS are unaffected); it is just taken out of the
  // visual flow with the standard clip technique instead of being painted.
  const srOnly =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0";
  const h1 = `<h1>${escapeHtml(meta.h1)}</h1>`;
  const body = meta.prerenderBody ?? "";
  const inner = body
    ? `${h1}<p>${description}</p>${body}`
    : `${h1}<p>${description}</p>`;
  const article = `<article style="${srOnly}">${inner}</article>`;

  // Optional <noscript> body content (internal-link grids etc). Non-JS
  // crawlers see it; users with JS never do.
  const extraBody = noscriptBodyFor(route, meta);
  const noscriptBlock = extraBody ? `<noscript>${extraBody}</noscript>` : "";

  out = out.replace(
    /<div\s+id="root"\s*>\s*<\/div>/i,
    `<div id="root">${article}</div>${noscriptBlock}`
  );

  // Optional JSON-LD structured data, inserted before </head>.
  if (meta.jsonLd) {
    const payload = Array.isArray(meta.jsonLd)
      ? { "@context": "https://schema.org", "@graph": meta.jsonLd }
      : { "@context": "https://schema.org", ...meta.jsonLd };
    // Escape </script> sequences to avoid breaking out of the script tag.
    const json = JSON.stringify(payload).replace(/<\/script/gi, "<\\/script");
    const tag = `<script type="application/ld+json">${json}</script>`;
    out = out.replace(/<\/head>/i, `${tag}</head>`);
  }

  return out;
}

function allRoutes(
  scoreCompanies: ScoreCompanyForMeta[],
  blogPosts: BlogPostForMeta[],
  scoreCities: ScoreCityForMeta[]
): string[] {
  const routes = new Set<string>(Object.keys(STATIC_ROUTE_META));
  for (const slug of Object.keys(locationData)) {
    routes.add(`/cleaning-business-software/${slug}`);
  }
  for (const c of scoreCompanies) {
    if (c.slug) routes.add(`/score/c/${c.slug}`);
  }
  for (const p of blogPosts) {
    if (p.slug) routes.add(`/blog/post/${p.slug}`);
  }
  for (const c of scoreCities) {
    if (c.city_slug) routes.add(`/score/city/${c.city_slug}`);
  }
  for (const compSlug of Object.keys(COMPETITORS)) {
    for (const nicheSlug of Object.keys(NICHES)) {
      routes.add(`/compare/${compSlug}/for/${nicheSlug}`);
    }
  }
  return [...routes];
}

function metaFor(
  route: string,
  scoreBySlug: Map<string, ScoreCompanyForMeta>,
  blogBySlug: Map<string, BlogPostForMeta>,
  cityBySlug: Map<string, ScoreCityForMeta>
): RouteMeta {
  if (STATIC_ROUTE_META[route]) return STATIC_ROUTE_META[route];
  const locMatch = route.match(/^\/cleaning-business-software\/([a-z0-9-]+)$/);
  if (locMatch) {
    const slug = locMatch[1];
    const loc = locationData[slug];
    if (loc) return locationRouteMeta(slug, loc);
  }
  const scoreMatch = route.match(/^\/score\/c\/([a-z0-9-]+)$/i);
  if (scoreMatch) {
    const c = scoreBySlug.get(scoreMatch[1]);
    if (c) return scoreCompanyRouteMeta(c);
  }
  const blogMatch = route.match(/^\/blog\/post\/([a-z0-9-]+)$/i);
  if (blogMatch) {
    const p = blogBySlug.get(blogMatch[1]);
    if (p) return blogPostRouteMeta(p);
  }
  const cityMatch = route.match(/^\/score\/city\/([a-z0-9-]+)$/i);
  if (cityMatch) {
    const c = cityBySlug.get(cityMatch[1]);
    if (c) return scoreCityRouteMeta(c);
  }
  const nicheMatch = route.match(/^\/compare\/([a-z0-9-]+)\/for\/([a-z0-9-]+)$/i);
  if (nicheMatch) {
    const comp = COMPETITORS[nicheMatch[1]];
    const niche = NICHES[nicheMatch[2]];
    if (comp && niche) return compareNicheRouteMeta(comp, niche);
  }
  return STATIC_ROUTE_META["/"];
}

function routeToFile(distDir: string, route: string): string {
  if (route === "/") return join(distDir, "index.html");
  // Strip leading slash and emit <route>/index.html
  const rel = route.replace(/^\//, "");
  return join(distDir, rel, "index.html");
}

export async function prerenderRoutes(
  distDir: string
): Promise<{ written: number; skipped: number }> {
  const sourceHtmlPath = join(distDir, "index.html");
  if (!existsSync(sourceHtmlPath)) {
    throw new Error(`prerender: ${sourceHtmlPath} not found — has vite build run?`);
  }
  const sourceHtml = readFileSync(sourceHtmlPath, "utf8");

  const [scoreCompanies, blogPosts, scoreCities] = await Promise.all([
    fetchScoreCompanies(),
    fetchBlogPosts(),
    fetchScoreCities(),
  ]);
  const scoreBySlug = new Map(scoreCompanies.map((c) => [c.slug, c]));
  const blogBySlug = new Map(blogPosts.map((p) => [p.slug, p]));
  const cityBySlug = new Map(scoreCities.map((c) => [c.city_slug, c]));

  let written = 0;
  let skipped = 0;
  for (const route of allRoutes(scoreCompanies, blogPosts, scoreCities)) {
    try {
      const meta = metaFor(route, scoreBySlug, blogBySlug, cityBySlug);
      meta.prerenderBody = buildPrerenderBody(
        route, meta, scoreBySlug, blogBySlug, cityBySlug, scoreCompanies
      );
      const patched = patchHead(sourceHtml, route, meta);
      const dest = routeToFile(distDir, route);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, patched);
      written++;
    } catch (e) {
      console.warn(`[prerender] skipped ${route}: ${e instanceof Error ? e.message : e}`);
      skipped++;
    }
  }
  return { written, skipped };
}

// Allow running standalone: `npx tsx src/lib/prerender-routes.ts`
const isDirectInvocation =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectInvocation) {
  const distDir = resolve(process.cwd(), "dist");
  prerenderRoutes(distDir)
    .then(({ written, skipped }) => {
      console.log(`[prerender] wrote ${written} routes, skipped ${skipped}`);
    })
    .catch((err) => {
      console.error(`[prerender] failed:`, err);
      process.exit(1);
    });
}
