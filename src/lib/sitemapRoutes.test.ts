import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { COMPETITORS, NICHES } from "../data/compareNicheData.ts";
import { locationData } from "../data/locationData.ts";
import { SUPABASE_PUBLIC_URL } from "./supabasePublicEnv.ts";
import { extractRoutePaths } from "./generate-sitemap.ts";
import {
  INDEXABLE_STATIC_PATHS,
  LIVE_SITEMAP_URL,
  STATIC_SITEMAP_URL,
  compareSitemapPaths,
  diffStaticPaths,
  fetchPublishedBlogPosts,
  handleSitemapRequest,
  isIndexableSitemapPath,
  locationSitemapPaths,
  renderSitemap,
} from "./sitemapRoutes.ts";

const NOW = new Date("2026-10-17T15:00:00.000Z");

function assertValidXml(xml: string): void {
  const dir = mkdtempSync(join(tmpdir(), "sitemap-"));
  const file = join(dir, "sitemap.xml");
  writeFileSync(file, xml);
  const result = spawnSync(
    "python3",
    ["-c", "import xml.etree.ElementTree as ET,sys; ET.parse(sys.argv[1])", file],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function urlBlock(xml: string, path: string): string {
  const loc = `<loc>https://www.jointidywise.com${path}</loc>`;
  const found = xml.split("<url>").slice(1).find((block) => block.includes(loc));
  assert.ok(found, `missing ${path}`);
  return found ?? "";
}

test("XML includes a newly published post, excludes drafts and /score, and is valid", async () => {
  const response = await handleSitemapRequest(new Request("https://example.com/functions/v1/sitemap"), {
    now: NOW,
    fetchPosts: async () => [
      {
        slug: "brand-new-live-post",
        status: "published",
        updated_at: "2026-10-17T18:30:00.000Z",
        published_at: "2026-09-01T00:00:00.000Z",
      },
      {
        slug: "published-without-update",
        status: "published",
        updated_at: null,
        published_at: "2026-08-02T12:00:00.000Z",
      },
      {
        slug: "still-a-draft",
        status: "draft",
        updated_at: "1999-01-01T00:00:00.000Z",
        published_at: "1999-01-01T00:00:00.000Z",
      },
      {
        slug: "needs-review",
        status: "review",
        updated_at: "1998-05-05T00:00:00.000Z",
      },
      {
        slug: "best-scheduling-software-cleaning-business",
        status: "published",
        updated_at: "2026-10-16T00:00:00.000Z",
      },
      {
        slug: "a&b-rates",
        status: "published",
        published_at: "2026-07-04T00:00:00.000Z",
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/xml\b/);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600");

  const xml = await response.text();
  assertValidXml(xml);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

  const published = urlBlock(xml, "/blog/post/brand-new-live-post");
  assert.match(published, /<lastmod>2026-10-17<\/lastmod>/);
  const older = urlBlock(xml, "/blog/post/published-without-update");
  assert.match(older, /<lastmod>2026-08-02<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/www\.jointidywise\.com\/blog\/post\/a&amp;b-rates<\/loc>/);

  assert.doesNotMatch(xml, /still-a-draft/);
  assert.doesNotMatch(xml, /needs-review/);
  assert.doesNotMatch(xml, /1999-01-01/);
  assert.doesNotMatch(xml, /1998-05-05/);
  assert.doesNotMatch(xml, /best-scheduling-software-cleaning-business/);
  assert.doesNotMatch(xml, /\/score\//);
  assert.doesNotMatch(xml, /<loc>[^<]*\/features\/scheduling-software<\/loc>/);
  assert.doesNotMatch(xml, /<loc>[^<]*\/features\/invoicing-software<\/loc>/);
  assert.doesNotMatch(xml, /<loc>[^<]*\/login<\/loc>/);

  assert.match(urlBlock(xml, "/"), /<priority>1\.0<\/priority>/);
  urlBlock(xml, "/pricing");
  urlBlock(xml, "/compare/servicetitan/for/airbnb-cleaners");
  urlBlock(xml, "/cleaning-business-software/california");
});

test("a failed blog read is an error, not an empty sitemap", async () => {
  const response = await handleSitemapRequest(new Request("https://example.com/sitemap"), {
    fetchPosts: async () => {
      throw new Error("db down");
    },
  });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.doesNotMatch(body, /<urlset/);
  assert.doesNotMatch(body, /<loc>/);
});

test("location and compare routes come from the same data as the build", () => {
  assert.equal(locationSitemapPaths().length, Object.keys(locationData).length);
  assert.equal(compareSitemapPaths().length, Object.keys(COMPETITORS).length * Object.keys(NICHES).length);
  assert.ok(compareSitemapPaths().includes("/compare/jobber/for/commercial-cleaning"));
  assert.equal(isIndexableSitemapPath("/score/c/acme"), false);
  assert.equal(isIndexableSitemapPath("/score/city/austin-tx"), false);
  assert.equal(isIndexableSitemapPath("/score/generate"), false);
  for (const path of INDEXABLE_STATIC_PATHS) {
    assert.equal(isIndexableSitemapPath(path), true, path);
  }
});

test("shared static paths match the routes extracted from App.tsx", () => {
  const source = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const drift = diffStaticPaths(extractRoutePaths(source));
  assert.deepEqual(drift.missingFromShared, []);
  assert.deepEqual(drift.extraInShared, []);
});

test("published blog read is a GET with the anon key, ordered by id, and pages", async () => {
  const calls: Array<{ url: string; method: string; apikey: string | null; authorization: string | null; body: unknown }> = [];
  const pages = [
    [
      { id: "a", slug: "one", status: "published", updated_at: "2026-10-01T00:00:00Z", published_at: "2026-10-01T00:00:00Z" },
      { id: "b", slug: "two", status: "published", updated_at: "2026-10-02T00:00:00Z", published_at: "2026-10-02T00:00:00Z" },
    ],
    [
      { id: "c", slug: "three", status: "published", updated_at: "2026-10-03T00:00:00Z", published_at: "2026-10-03T00:00:00Z" },
    ],
  ];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      apikey: headers.get("apikey"),
      authorization: headers.get("authorization"),
      body: init?.body,
    });
    const offset = Number(url.searchParams.get("offset"));
    const page = offset === 0 ? pages[0] : pages[1];
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  };

  const posts = await fetchPublishedBlogPosts("https://example.supabase.co", "anon-test-key", fetchImpl, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(call.method, "GET");
    assert.equal(call.body, undefined);
    assert.equal(call.apikey, "anon-test-key");
    assert.equal(call.authorization, "Bearer anon-test-key");
    assert.equal(url.pathname, "/rest/v1/blog_posts");
    assert.equal(url.searchParams.get("status"), "eq.published");
    assert.equal(url.searchParams.get("order"), "id.asc");
    assert.equal(url.searchParams.get("select"), "id,slug,status,updated_at,published_at");
    assert.doesNotMatch(call.authorization ?? "", /service_role/i);
  }
  assert.equal(new URL(calls[1].url).searchParams.get("offset"), "2");

  const xml = renderSitemap(posts, NOW);
  assert.match(xml, /\/blog\/post\/three/);
  // status draft is dropped even if a page returned it
  const dropped = renderSitemap(
    posts.map((post, index) => (index === 2 ? { ...post, status: "draft" } : post)),
    NOW,
  );
  assert.doesNotMatch(dropped, /\/blog\/post\/three/);
});

test("a repeated blog page refuses to emit a partial sitemap", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify([{ id: "same", slug: "loop", status: "published" }]), { status: 200 });
  await assert.rejects(
    () => fetchPublishedBlogPosts("https://example.supabase.co", "anon-test-key", fetchImpl, 1),
    /repeated a row/,
  );
});

test("robots.txt points at the live function and keeps the static file", () => {
  const robots = readFileSync(new URL("../../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, new RegExp(`Sitemap: ${LIVE_SITEMAP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(robots, new RegExp(`Sitemap: ${STATIC_SITEMAP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(LIVE_SITEMAP_URL, `${SUPABASE_PUBLIC_URL}/functions/v1/sitemap`);
});

test("the edge function stays on the anon key and the shared route module", () => {
  const source = readFileSync(new URL("../../supabase/functions/sitemap/index.ts", import.meta.url), "utf8");
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /sitemapRoutes\.ts/);
  assert.doesNotMatch(source, /SERVICE_ROLE/);
  assert.doesNotMatch(source, /createClient/);
  const config = readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.sitemap\]\s+verify_jwt = false/);
});
