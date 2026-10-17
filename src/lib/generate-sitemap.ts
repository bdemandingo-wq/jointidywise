/**
 * Auto-sitemap generator (build-time, static fallback).
 *
 * Parses `src/App.tsx` using @babel/parser, walks the AST with @babel/traverse,
 * and checks those routes against INDEXABLE_STATIC_PATHS. The URL list itself
 * — static pages, locations, compare niches, and published posts — is built by
 * src/lib/sitemapRoutes.ts, which the live `sitemap` edge function imports too.
 *
 * Crawlers are pointed at the live function (see public/robots.txt). This file
 * is the fallback at https://www.jointidywise.com/sitemap.xml. Lovable does
 * not proxy that path to the function.
 *
 * Invoked from vite.config.ts via `sitemapPlugin()` on `buildEnd`.
 */

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STATIC_ROUTE_META } from "./routeMeta";
import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from "./supabasePublicEnv";
import {
  SITEMAP_STATIC_PATH_DRIFT,
  diffStaticPaths,
  fetchPublishedBlogPosts,
  renderSitemap,
  staticPathsFromAppRoutes,
  type SitemapBlogPost,
} from "./sitemapRoutes";

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

export function extractRoutePaths(source: string): string[] {
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

export async function generateSitemap(): Promise<{ count: number; outputPath: string }> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = resolve(__dirname, "..", "..");

  const appTsxPath = resolve(projectRoot, "src", "App.tsx");
  const outputPath = resolve(projectRoot, "public", "sitemap.xml");

  const source = readFileSync(appTsxPath, "utf8");
  const rawPaths = extractRoutePaths(source);
  const drift = diffStaticPaths(rawPaths);
  if (drift.missingFromShared.length > 0 || drift.extraInShared.length > 0) {
    console.error(
      `${SITEMAP_STATIC_PATH_DRIFT}: INDEXABLE_STATIC_PATHS in src/lib/sitemapRoutes.ts ` +
        `does not match the public routes in src/App.tsx.\n` +
        `Missing from the shared list:\n` +
        (drift.missingFromShared.map((p) => `  ${p}`).join("\n") || "  (none)") +
        `\nExtra in the shared list:\n` +
        (drift.extraInShared.map((p) => `  ${p}`).join("\n") || "  (none)") +
        `\n\nUpdate INDEXABLE_STATIC_PATHS, or exclude the route in src/lib/sitemapRoutes.ts ` +
        `if it should not be public. The live sitemap function imports that same list.`,
    );
    process.exit(1);
  }
  const includedPaths = staticPathsFromAppRoutes(rawPaths);

  /*
    GUARD: every static route this file advertises must also be prerenderable.

    prerender-routes.ts takes its static routes from STATIC_ROUTE_META, which
    is hand-maintained. A new public page has to be added to
    INDEXABLE_STATIC_PATHS (the drift check above fails the build until it is)
    and to STATIC_ROUTE_META. If only the sitemap list is updated, the page is
    advertised to Google and prerendered never, and crawlers fetch the SPA
    shell carrying the homepage's title and description.

    That is not hypothetical: /get-the-app shipped in exactly that state and was
    caught only because someone looked at the build output.

    Failing here makes the two agree by construction rather than by memory. The
    fix when it fires is to add the route to STATIC_ROUTE_META, or to the
    exclusion lists in src/lib/sitemapRoutes.ts if it should not be public.

    Dynamic routes are exempt by design — blog posts, locations, and
    competitor pages are expanded separately by BOTH systems and never appear in
    STATIC_ROUTE_META. Score pages are prerendered and noindexed, and are not
    listed here. Only the static list extracted from App.tsx is checked.
  */
  const missingMeta = includedPaths.filter((p) => !(p in STATIC_ROUTE_META));
  if (missingMeta.length > 0) {
    console.error(
      `${ROUTE_META_GUARD_MARKER}: ${missingMeta.length} route(s) are in the sitemap ` +
        `but have no STATIC_ROUTE_META entry, so they will NOT be prerendered and ` +
        `will serve the homepage's title and description to crawlers:\n` +
        missingMeta.map((p) => `  ${p}`).join("\n") +
        `\n\nAdd them to STATIC_ROUTE_META in src/lib/routeMeta.ts, or exclude them ` +
        `in src/lib/sitemapRoutes.ts if they should not be public.`,
    );
    process.exit(1);
  }

  // A transient blog read must not fail the build or replace the previous
  // fallback with a copy that has zero posts. Leave the file alone and warn.
  // The live function returns 500 instead, so Google keeps its cached copy.
  let posts: SitemapBlogPost[] | null = null;
  try {
    posts = await fetchPublishedBlogPosts(SUPABASE_PUBLIC_URL, SUPABASE_PUBLIC_ANON_KEY);
  } catch (err) {
    console.warn(`[sitemap] blog fetch error:`, err);
  }
  if (!posts) {
    console.warn(`[sitemap] left ${outputPath} unchanged`);
    return { count: 0, outputPath };
  }

  const xml = renderSitemap(posts);
  writeFileSync(outputPath, xml, "utf8");

  const count = xml.split("<url>").length - 1;
  return { count, outputPath };
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
