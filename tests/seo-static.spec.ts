import { test, expect } from "@playwright/test";

/**
 * 12. SEO & Crawlability — 12.1, 12.4
 *
 * Uses Playwright's `request` fixture only — raw HTTP fetch + string/regex
 * parsing, NO browser/JS execution. This deliberately mirrors what a
 * non-JS crawler sees. Verified live on 2026-07-14: prerendering here is
 * real build-time static HTML per route (Vite plugin in vite.config.ts →
 * src/lib/prerender-routes.ts writes dist/<route>/index.html), not
 * UA-conditional — a plain curl and a Googlebot-UA curl get identical
 * bytes, so there's no need to spoof a crawler User-Agent in these tests.
 */

const BASE = "https://www.jointidywise.com";

function extract(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

test.describe("12.1 — Prerendered meta tags present per route", () => {
  const CORE_ROUTES: Array<{ path: string; titleContains: string }> = [
    { path: "/", titleContains: "TidyWise" },
    { path: "/pricing", titleContains: "Pricing" },
  ];

  for (const { path, titleContains } of CORE_ROUTES) {
    test(`${path} serves a real <title>, meta description, and canonical in raw HTML`, async ({ request }) => {
      const resp = await request.get(`${BASE}${path}`);
      expect(resp.status()).toBe(200);
      const html = await resp.text();

      const title = extract(html, /<title>([^<]*)<\/title>/);
      expect(title, `${path} has no <title> in static HTML`).not.toBeNull();
      expect(title).toContain(titleContains);

      const description = extract(html, /<meta name="description" content="([^"]*)"/);
      expect(description, `${path} has no meta description in static HTML`).not.toBeNull();
      expect(description!.length).toBeGreaterThan(20);

      const canonical = extract(html, /<link rel="canonical" href="([^"]*)"/);
      expect(canonical, `${path} has no canonical link in static HTML`).not.toBeNull();
      expect(canonical).toContain("www.jointidywise.com");
    });
  }
});

test.describe("12.4 — New /compare/*/for/* pages render for crawlers", () => {
  const COMPETITORS = ["jobber", "housecall-pro", "zenmaid", "booking-koala", "launch27", "servicetitan"];
  const NICHES = ["airbnb-cleaners", "solo-cleaners", "commercial-cleaning", "move-out-cleaning", "maid-services", "carpet-cleaning"];

  test("representative niche pages have correct, distinct titles and canonical URLs in static HTML", async ({ request }) => {
    const samples: Array<[string, string]> = [
      ["servicetitan", "airbnb-cleaners"],
      ["jobber", "commercial-cleaning"],
    ];
    for (const [competitor, niche] of samples) {
      const path = `/compare/${competitor}/for/${niche}`;
      const resp = await request.get(`${BASE}${path}`);
      expect(resp.status(), `${path} did not return 200`).toBe(200);
      const html = await resp.text();

      const title = extract(html, /<title>([^<]*)<\/title>/);
      expect(title, `${path} has no <title>`).not.toBeNull();
      expect(title!.toLowerCase()).toContain("tidywise");

      const canonical = extract(html, /<link rel="canonical" href="([^"]*)"/);
      expect(canonical).toContain(path);
    }
  });

  test("all 36 competitor x niche combinations are genuinely prerendered (not a silent fallback to the homepage)", async ({
    request,
  }) => {
    test.slow(); // 36 sequential-safe but slower-than-default requests
    // Checking title-non-empty alone isn't enough: a route that isn't
    // prerendered falls through to the SPA shell, which STILL has a
    // non-empty <title> — just the homepage's. The canonical tag is the
    // reliable signal (it's route-specific), so require it to contain
    // this route's own path.
    const paths = COMPETITORS.flatMap((c) => NICHES.map((n) => `/compare/${c}/for/${n}`));
    const results = await Promise.all(
      paths.map(async (path) => {
        const resp = await request.get(`${BASE}${path}`);
        if (resp.status() !== 200) return `${path}: HTTP ${resp.status()}`;
        const html = await resp.text();
        const title = extract(html, /<title>([^<]*)<\/title>/);
        const canonical = extract(html, /<link rel="canonical" href="([^"]*)"/);
        if (!title || title.trim().length === 0) return `${path}: empty/missing <title>`;
        if (!canonical || !canonical.includes(path)) {
          return `${path}: canonical is "${canonical}" — falls back to the homepage instead of its own prerendered page`;
        }
        return null;
      }),
    );
    const failures = results.filter((r): r is string => r !== null);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("niche pages are listed in the dynamic sitemap edge function", async ({ request }) => {
    // www.jointidywise.com/functions/v1/* is NOT proxied to Supabase — it
    // falls through to the SPA shell (verified live). The sitemap edge
    // function is only reachable at the Supabase project URL directly.
    const SUPABASE_URL = "https://slwfkaqczvwvvvavkgpr.supabase.co";
    const ANON_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsd2ZrYXFjenZ3dnZ2YXZrZ3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNjk4OTQsImV4cCI6MjA4MTY0NTg5NH0.M0OhzHsrqA0oYh6Ykx_4gVK_SrdSi1V_CiFxU-n4Lec";
    const resp = await request.get(`${SUPABASE_URL}/functions/v1/sitemap`, {
      headers: { apikey: ANON_KEY },
    });
    expect(resp.status()).toBe(200);
    const xml = await resp.text();
    expect(xml).toContain("/compare/servicetitan/for/airbnb-cleaners");
  });

  test("all 36 niche pages are listed in the static /sitemap.xml on the main domain", async ({ request }) => {
    // robots.txt lists the live sitemap function first and this static file
    // as a fallback. The static file still has to contain the 36 niche URLs
    // on its own, because Lovable cannot proxy /sitemap.xml at the function.
    const resp = await request.get(`${BASE}/sitemap.xml`);
    expect(resp.status()).toBe(200);
    const xml = await resp.text();
    const COMPETITORS_LOCAL = ["jobber", "housecall-pro", "zenmaid", "booking-koala", "launch27", "servicetitan"];
    const NICHES_LOCAL = ["airbnb-cleaners", "solo-cleaners", "commercial-cleaning", "move-out-cleaning", "maid-services", "carpet-cleaning"];
    const missing = COMPETITORS_LOCAL.flatMap((c) =>
      NICHES_LOCAL.filter((n) => !xml.includes(`/compare/${c}/for/${n}`)).map((n) => `/compare/${c}/for/${n}`),
    );
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
