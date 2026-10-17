/**
 * Route list shared by the build-time sitemap writer and the live `sitemap`
 * edge function. Static, location, and compare URLs are defined here so the
 * two outputs cannot drift. Published blog posts are supplied by the caller.
 *
 * `/score/*` is prerendered with noindex and is not listed. Keyword
 * duplicates in KEYWORD_CANONICALS are noindex and are not listed. Drafts
 * are not listed.
 */

import { COMPETITORS, NICHES } from "../data/compareNicheData.ts";
import { locationData } from "../data/locationData.ts";
import { KEYWORD_CANONICALS } from "./keywordCanonicals.ts";

export const SITEMAP_SITE_ORIGIN = "https://www.jointidywise.com";

/** Public function URL. Listed from robots.txt. Not a Search Console submission. */
export const LIVE_SITEMAP_URL =
  "https://slwfkaqczvwvvvavkgpr.supabase.co/functions/v1/sitemap";

/** Build-time file. Kept as a second Sitemap line because Lovable does not proxy it. */
export const STATIC_SITEMAP_URL = "https://www.jointidywise.com/sitemap.xml";

export const SITEMAP_CACHE_CONTROL = "public, max-age=3600";
export const SITEMAP_CONTENT_TYPE = "application/xml; charset=utf-8";

/** Printed by generate-sitemap.ts. vite.config.ts fails the build when it sees this. */
export const SITEMAP_STATIC_PATH_DRIFT = "SITEMAP_STATIC_PATH_DRIFT";

export const BLOG_PAGE_SIZE = 1000;
const MAX_BLOG_PAGES = 50;

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
  "/unsubscribe",
  "/forgot-password",
  "/reset-password",
  "/choose-plan",
  "/set-password",
  "/accept-invite",
  "/refer",
  "/affiliate",
  "/feedback",
  "*",
]);

// `/score` pages are noindex. `/.lovable` is an OAuth consent step. `/dev` is
// a local preview. The rest are signed-in product surfaces.
const EXCLUDED_PREFIXES = [
  "/dashboard",
  "/staff",
  "/portal",
  "/admin",
  "/auth",
  "/checkout",
  "/billing",
  "/.lovable",
  "/dev",
  "/score",
];

export function shouldExclude(path: string): boolean {
  if (EXCLUDED_PATHS.has(path)) return true;
  if (path.includes(":")) return true;
  if (path.includes("*")) return true;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export function isNoindexDuplicate(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEYWORD_CANONICALS, path);
}

export function isIndexableSitemapPath(path: string): boolean {
  return !shouldExclude(path) && !isNoindexDuplicate(path);
}

/**
 * Public static routes from App.tsx. generate-sitemap.ts exits if an AST
 * walk of App.tsx disagrees with this list.
 */
export const INDEXABLE_STATIC_PATHS: readonly string[] = [
  "/",
  "/blog",
  "/blog/best-software-for-cleaning-business",
  "/blog/booking-koala-vs-jobber-vs-tidywise",
  "/blog/cleaning-business-management-software",
  "/blog/crm-for-cleaning-business",
  "/blog/gps-tracking-cleaning-business",
  "/blog/how-to-automate-cleaning-company",
  "/blog/how-to-grow-cleaning-business-2025",
  "/blog/how-to-start-a-cleaning-business",
  "/blog/invoicing-software-for-cleaning-business",
  "/blog/maid-service-software",
  "/blog/payroll-software-for-cleaning-businesses",
  "/cleaning-business-software",
  "/compare/booking-koala",
  "/compare/housecall-pro",
  "/compare/jobber",
  "/compare/launch27",
  "/compare/servicetitan",
  "/compare/zenmaid",
  "/contact",
  "/demo",
  "/do-not-sell",
  "/features/automated-dispatching",
  "/features/booking",
  "/features/crm",
  "/features/payment-processing",
  "/features/payroll-software",
  "/features/quote-software",
  "/features/route-optimization",
  "/features/sms-notifications",
  "/get-the-app",
  "/pricing",
  "/privacy-policy",
  "/referral",
  "/terms",
];

export function staticPathsFromAppRoutes(rawPaths: readonly string[]): string[] {
  return [...new Set(rawPaths.filter((path) => isIndexableSitemapPath(path)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function diffStaticPaths(rawPaths: readonly string[]): {
  missingFromShared: string[];
  extraInShared: string[];
} {
  const fromApp = new Set(staticPathsFromAppRoutes(rawPaths));
  const shared = new Set(INDEXABLE_STATIC_PATHS);
  return {
    missingFromShared: [...fromApp].filter((path) => !shared.has(path)).sort(),
    extraInShared: [...shared].filter((path) => !fromApp.has(path)).sort(),
  };
}

export function locationSitemapPaths(): string[] {
  return Object.keys(locationData)
    .map((slug) => `/cleaning-business-software/${slug}`)
    .filter((path) => isIndexableSitemapPath(path));
}

export function compareSitemapPaths(): string[] {
  const paths: string[] = [];
  for (const compSlug of Object.keys(COMPETITORS)) {
    for (const nicheSlug of Object.keys(NICHES)) {
      const path = `/compare/${compSlug}/for/${nicheSlug}`;
      if (isIndexableSitemapPath(path)) paths.push(path);
    }
  }
  return paths;
}

export type SitemapBlogPost = {
  slug?: string | null;
  status?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
};

export type SitemapEntry = { path: string; lastmod?: string };

/**
 * Sitemap lastmod is a UTC calendar date (sitemaps.org). That is the spec's
 * date, not an organisation business day, so slicing the UTC instant is
 * intentional.
 */
export function sitemapLastmod(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const prefixed = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(trimmed);
  if (prefixed) return prefixed[1];
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  /* eslint-disable-next-line local/no-device-local-dates -- W3C sitemap lastmod is a UTC date, not an organisation business day */
  return new Date(parsed).toISOString().slice(0, 10);
}

export function sitemapToday(now: Date = new Date()): string {
  /* eslint-disable-next-line local/no-device-local-dates -- W3C sitemap lastmod is a UTC date, not an organisation business day */
  return now.toISOString().slice(0, 10);
}

function blogLastmod(post: SitemapBlogPost): string | undefined {
  return sitemapLastmod(post.updated_at) ?? sitemapLastmod(post.published_at);
}

function safeBlogSlug(slug: string): boolean {
  if (!slug || slug.length > 200) return false;
  if (slug.includes("..") || /[\s/?#<>\\]/.test(slug)) return false;
  return true;
}

/** Published posts only. A missing status counts as published (the read already filtered). */
export function blogEntryFromPost(post: SitemapBlogPost): SitemapEntry | null {
  const status = (post.status ?? "published").trim().toLowerCase();
  if (status !== "published") return null;
  const slug = (post.slug ?? "").trim();
  if (!safeBlogSlug(slug)) return null;
  const path = `/blog/post/${slug}`;
  if (!isIndexableSitemapPath(path)) return null;
  const lastmod = blogLastmod(post);
  return lastmod ? { path, lastmod } : { path };
}

export function assembleSitemapEntries(posts: readonly SitemapBlogPost[]): SitemapEntry[] {
  const map = new Map<string, SitemapEntry>();
  const add = (entry: SitemapEntry) => {
    if (!isIndexableSitemapPath(entry.path)) return;
    const prev = map.get(entry.path);
    if (!prev || (!prev.lastmod && entry.lastmod)) map.set(entry.path, entry);
  };

  for (const path of INDEXABLE_STATIC_PATHS) add({ path });
  for (const path of locationSitemapPaths()) add({ path });
  for (const path of compareSitemapPaths()) add({ path });
  for (const post of posts) {
    const entry = blogEntryFromPost(post);
    if (entry) add(entry);
  }
  return [...map.values()];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSitemapXml(entries: readonly SitemapEntry[], today: string): string {
  const sorted = [...entries].sort((a, b) => {
    if (a.path === "/") return -1;
    if (b.path === "/") return 1;
    return a.path.localeCompare(b.path);
  });

  const urls = sorted
    .map((entry) => {
      const loc = `${SITEMAP_SITE_ORIGIN}${entry.path}`;
      const priority = entry.path === "/" ? "1.0" : "0.8";
      const changefreq = entry.path === "/" ? "weekly" : "monthly";
      const lastmod = entry.lastmod ?? today;
      return `  <url>
    <loc>${escapeXml(loc)}</loc>
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

export function renderSitemap(posts: readonly SitemapBlogPost[], now: Date = new Date()): string {
  return buildSitemapXml(assembleSitemapEntries(posts), sitemapToday(now));
}

type BlogRow = SitemapBlogPost & { id?: string };

function asBlogRow(value: unknown): BlogRow {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const str = (key: string): string | null => (typeof row[key] === "string" ? (row[key] as string) : null);
  return {
    id: str("id") ?? undefined,
    slug: str("slug"),
    status: str("status"),
    updated_at: str("updated_at"),
    published_at: str("published_at"),
  };
}

/**
 * Read-only GET of published blog_posts. Uses the anon key so RLS applies
 * (public select is status = published). Never sends a service-role key.
 */
export async function fetchPublishedBlogPosts(
  supabaseUrl: string,
  anonKey: string,
  fetchImpl: typeof fetch = fetch,
  pageSize: number = BLOG_PAGE_SIZE,
): Promise<SitemapBlogPost[]> {
  if (!supabaseUrl || !anonKey) {
    throw new Error("sitemap is missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  const posts: SitemapBlogPost[] = [];
  const seenIds = new Set<string>();

  for (let page = 0; page < MAX_BLOG_PAGES; page++) {
    const endpoint = new URL("/rest/v1/blog_posts", supabaseUrl);
    endpoint.searchParams.set("select", "id,slug,status,updated_at,published_at");
    endpoint.searchParams.set("status", "eq.published");
    endpoint.searchParams.set("order", "id.asc");
    endpoint.searchParams.set("limit", String(pageSize));
    endpoint.searchParams.set("offset", String(page * pageSize));

    const res = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`blog_posts read failed: HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      throw new Error("blog_posts read returned a non-array");
    }
    if (body.length === 0) break;

    for (const value of body) {
      const row = asBlogRow(value);
      if (row.id) {
        if (seenIds.has(row.id)) {
          throw new Error("blog_posts page repeated a row; refusing a partial sitemap");
        }
        seenIds.add(row.id);
      }
      posts.push(row);
    }
    if (body.length < pageSize) break;
    if (page === MAX_BLOG_PAGES - 1) {
      throw new Error("blog_posts page limit reached before the last page");
    }
  }

  return posts;
}

const SITEMAP_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

export type SitemapHandlerDeps = {
  fetchPosts: () => Promise<readonly SitemapBlogPost[]>;
  now?: Date;
};

export async function handleSitemapRequest(req: Request, deps: SitemapHandlerDeps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: SITEMAP_CORS });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...SITEMAP_CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  try {
    const posts = await deps.fetchPosts();
    const xml = renderSitemap(posts, deps.now);
    return new Response(req.method === "HEAD" ? null : xml, {
      status: 200,
      headers: {
        ...SITEMAP_CORS,
        "Content-Type": SITEMAP_CONTENT_TYPE,
        "Cache-Control": SITEMAP_CACHE_CONTROL,
      },
    });
  } catch (err) {
    console.error("[sitemap]", err instanceof Error ? err.message : err);
    return new Response("Sitemap unavailable", {
      status: 500,
      headers: {
        ...SITEMAP_CORS,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
