/**
 * Auto-sitemap generator (build-time, static).
 *
 * Parses `src/App.tsx` using @babel/parser, walks the AST with @babel/traverse,
 * extracts every static `<Route path="...">` value, applies exclusion rules,
 * deduplicates, fetches all PUBLISHED blog post slugs from Supabase at build
 * time, and writes `public/sitemap.xml`.
 *
 * Production source of truth: this static file is what robots.txt points at
 * (https://jointidywise.lovable.app/sitemap.xml). The /functions/v1/sitemap
 * edge function exposes the same data dynamically and is useful for ad-hoc
 * verification, but production crawlers consume this static build output.
 *
 * Invoked from vite.config.ts via `sitemapPlugin()` on `buildEnd`.
 */

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPETITORS, NICHES } from "../data/compareNicheData";
import { STATIC_ROUTE_META } from "./routeMeta";
import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from "./supabasePublicEnv";

/**
 * Marker the build plugin greps for to tell a route-meta mismatch — which must
 * fail the build — apart from a transient failure like the blog-slug fetch,
 * which should only warn. Keep in sync with vite.config.ts.
 */
export const ROUTE_META_GUARD_MARKER = "SITEMAP_ROUTE_META_MISMATCH";

// @babel/traverse ships as CJS; under ESM the default export lives on `.default`.
const traverse =
  ((_traverse as unknown as { default?: typeof _traverse }).default as typeof _traverse) ??
  _traverse;

const BASE_URL = "https://www.jointidywise.com";

// Exact path exclusions.
const EXCLUDED_PATHS = new Set<string>([
  "/login",
  "/signup",
  "/logout",
  "/auth",
  "/auth/callback",
  "/auth/confirm",
  "/onboarding",
  "/card-saved",
  "/delete-account",
  // Token link from marketing email. Nothing to index, and the page noindexes.
  "/unsubscribe",
  "/forgot-password",
  "/reset-password",
  // The hard paywall between onboarding and the dashboard. Reachable only with
  // a session, redirects to /login on native, and has nothing to offer a
  // crawler — it was being advertised purely because it is a top-level route.
  "/choose-plan",
  // Both only function with a one-time token in the URL. A crawler arriving
  // without one gets an error state, and indexing either invites people to a
  // page that cannot work for them.
  "/set-password",
  "/accept-invite",
  "*",
]);

// Prefix exclusions — any route whose path starts with one of these is skipped.
// `/.lovable` holds the OAuth 2.1 consent screen for MCP clients. It is a step
// inside an authorization handshake — it only functions with a live
// authorization_id in the query string — so a crawler reaching it finds a
// broken page at best, and listing it invites exactly that.
const EXCLUDED_PREFIXES = ["/dashboard", "/staff", "/portal", "/admin", "/auth", "/checkout", "/billing", "/.lovable"];

function shouldExclude(path: string): boolean {
  if (EXCLUDED_PATHS.has(path)) return true;
  if (path.includes(":")) return true; // dynamic segments
  if (path.includes("*")) return true; // wildcard / splat routes
  for (const prefix of EXCLUDED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

async function fetchPublishedBlogSlugs(): Promise<string[]> {
  const SUPABASE_URL = SUPABASE_PUBLIC_URL;
  const ANON_KEY = SUPABASE_PUBLIC_ANON_KEY;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/blog_posts?select=slug&status=eq.published&limit=5000`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
      }
    );
    if (!res.ok) {
      console.warn(`[sitemap] blog fetch failed: ${res.status}`);
      return [];
    }
    const rows = (await res.json()) as Array<{ slug: string }>;
    return rows.map((r) => r.slug).filter(Boolean);
  } catch (err) {
    console.warn(`[sitemap] blog fetch error:`, err);
    return [];
  }
}

async function fetchScoreCompanies(): Promise<Array<{ slug: string; lastmod?: string }>> {
  const SUPABASE_URL = SUPABASE_PUBLIC_URL;
  const ANON_KEY = SUPABASE_PUBLIC_ANON_KEY;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/score_companies?select=slug,last_scored_at,updated_at&limit=5000`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
    );
    if (!res.ok) {
      console.warn(`[sitemap] score_companies fetch failed: ${res.status}`);
      return [];
    }
    const rows = (await res.json()) as Array<{
      slug: string;
      last_scored_at: string | null;
      updated_at: string | null;
    }>;
    return rows
      .filter((r) => r.slug)
      .map((r) => ({
        slug: r.slug,
        lastmod: (r.last_scored_at ?? r.updated_at ?? undefined)?.slice(0, 10),
      }));
  } catch (err) {
    console.warn(`[sitemap] score_companies fetch error:`, err);
    return [];
  }
}

async function fetchScoreCitySlugs(): Promise<string[]> {
  const SUPABASE_URL = SUPABASE_PUBLIC_URL;
  const ANON_KEY = SUPABASE_PUBLIC_ANON_KEY;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/score_top_cities?select=city_slug&limit=5000`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
    );
    if (!res.ok) {
      console.warn(`[sitemap] score_top_cities fetch failed: ${res.status}`);
      return [];
    }
    const rows = (await res.json()) as Array<{ city_slug: string }>;
    return rows.map((r) => r.city_slug).filter(Boolean);
  } catch (err) {
    console.warn(`[sitemap] score_top_cities fetch error:`, err);
    return [];
  }
}

function extractRoutePaths(source: string): string[] {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });

  const paths = new Set<string>();

  traverse(ast, {
    JSXOpeningElement(nodePath) {
      const name = nodePath.node.name;
      if (!t.isJSXIdentifier(name) || name.name !== "Route") return;

      for (const attr of nodePath.node.attributes) {
        if (!t.isJSXAttribute(attr)) continue;
        if (!t.isJSXIdentifier(attr.name) || attr.name.name !== "path") continue;

        const value = attr.value;
        if (t.isStringLiteral(value)) {
          paths.add(value.value);
        } else if (
          t.isJSXExpressionContainer(value) &&
          t.isStringLiteral(value.expression)
        ) {
          paths.add(value.expression.value);
        }
      }
    },
  });

  return [...paths];
}

type SitemapEntry = { path: string; lastmod?: string };

function buildSitemap(entries: SitemapEntry[]): string {
  // <lastmod> is specified as a UTC date; this is the one place where slicing
  // toISOString() is exactly what the format asks for.
  /* eslint-disable-next-line local/no-device-local-dates */
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...entries].sort((a, b) => {
    if (a.path === "/") return -1;
    if (b.path === "/") return 1;
    return a.path.localeCompare(b.path);
  });

  const urls = sorted
    .map((e) => {
      const p = e.path;
      const loc = p === "/" ? `${BASE_URL}/` : `${BASE_URL}${p}`;
      const priority = p === "/" ? "1.0" : "0.8";
      const changefreq = p === "/" ? "weekly" : "monthly";
      const lastmod = e.lastmod ?? today;
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export async function generateSitemap(): Promise<{ count: number; outputPath: string }> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = resolve(__dirname, "..", "..");

  const appTsxPath = resolve(projectRoot, "src", "App.tsx");
  const outputPath = resolve(projectRoot, "public", "sitemap.xml");

  const source = readFileSync(appTsxPath, "utf8");
  const rawPaths = extractRoutePaths(source);
  const includedPaths = rawPaths.filter((p) => !shouldExclude(p));

  /*
    GUARD: every static route this file advertises must also be prerenderable.

    These two systems take their routes from different places, and only one is
    automatic. This file AST-extracts them from App.tsx, so a new public page
    lands in sitemap.xml the moment it is added. prerender-routes.ts takes its
    static routes from STATIC_ROUTE_META, which is hand-maintained — so a new
    page is advertised to Google immediately and prerendered never, and crawlers
    fetch the SPA shell carrying THE HOMEPAGE'S title and description.

    That is not hypothetical: /get-the-app shipped in exactly that state and was
    caught only because someone looked at the build output.

    Failing here makes the two agree by construction rather than by memory. The
    fix when it fires is to add the route to STATIC_ROUTE_META, or to
    EXCLUDED_PATHS/EXCLUDED_PREFIXES above if it should not be public at all.

    Dynamic routes are exempt by design — blog posts, locations, score and
    competitor pages are expanded separately by BOTH systems and never appear in
    STATIC_ROUTE_META. Only the static list extracted from App.tsx is checked.
  */
  const missingMeta = includedPaths.filter((p) => !(p in STATIC_ROUTE_META));
  if (missingMeta.length > 0) {
    console.error(
      `${ROUTE_META_GUARD_MARKER}: ${missingMeta.length} route(s) are in the sitemap ` +
        `but have no STATIC_ROUTE_META entry, so they will NOT be prerendered and ` +
        `will serve the homepage's title and description to crawlers:\n` +
        missingMeta.map((p) => `  ${p}`).join("\n") +
        `\n\nAdd them to STATIC_ROUTE_META in src/lib/routeMeta.ts, or exclude them ` +
        `in src/lib/generate-sitemap.ts if they should not be public.`,
    );
    process.exit(1);
  }

  // Dedupe (HashRouter + BrowserRouter branches in App.tsx share most routes).
  const entryMap = new Map<string, SitemapEntry>();
  for (const p of includedPaths) entryMap.set(p, { path: p });

  // Add dynamic published blog post URLs from the database.
  const blogSlugs = await fetchPublishedBlogSlugs();
  for (const slug of blogSlugs) {
    const p = `/blog/post/${slug}`;
    entryMap.set(p, { path: p });
  }

  // Add concrete location pages (states + cities).
  try {
    const { locationData } = await import("../data/locationData");
    for (const slug of Object.keys(locationData)) {
      const p = `/cleaning-business-software/${slug}`;
      entryMap.set(p, { path: p });
    }
  } catch (err) {
    console.warn(`[sitemap] could not load locationData:`, err);
  }

  // Add /score/c/{slug} pages with per-row lastmod from last_scored_at.
  const scoreCompanies = await fetchScoreCompanies();
  for (const c of scoreCompanies) {
    const p = `/score/c/${c.slug}`;
    entryMap.set(p, { path: p, lastmod: c.lastmod });
  }

  // Add /score/city/{citySlug} ranking pages.
  const scoreCitySlugs = await fetchScoreCitySlugs();
  for (const slug of scoreCitySlugs) {
    const p = `/score/city/${slug}`;
    entryMap.set(p, { path: p });
  }

  // Add the 36 /compare/:competitorSlug/for/:nicheSlug pages. This route is
  // registered dynamically in App.tsx (a single `:competitorSlug/:nicheSlug`
  // Route), so extractRoutePaths()'s AST walk correctly excludes it as a
  // template (shouldExclude() drops any path containing ":") — same as
  // /blog/post/:slug or /score/c/:slug. Unlike those, though, nothing was
  // ever expanding it into its concrete URLs the way blog/score entries
  // are added above, so all 36 pages were silently absent from the sitemap
  // even though they render correctly (see src/lib/prerender-routes.ts,
  // which does enumerate these from the same COMPETITORS x NICHES data).
  for (const compSlug of Object.keys(COMPETITORS)) {
    for (const nicheSlug of Object.keys(NICHES)) {
      const p = `/compare/${compSlug}/for/${nicheSlug}`;
      entryMap.set(p, { path: p });
    }
  }

  const xml = buildSitemap([...entryMap.values()]);
  writeFileSync(outputPath, xml, "utf8");

  return { count: entryMap.size, outputPath };
}

// Allow direct execution: `tsx src/lib/generate-sitemap.ts`
const isDirectRun = (() => {
  try {
    return (
      process.argv[1] &&
      fileURLToPath(import.meta.url) === resolve(process.argv[1])
    );
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  generateSitemap()
    .then(({ count, outputPath }) => {
      console.log(`[sitemap] wrote ${count} urls to ${outputPath}`);
    })
    .catch((err) => {
      console.error(`[sitemap] failed:`, err);
      process.exit(1);
    });
}
