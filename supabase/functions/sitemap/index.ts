// Live sitemap.xml.
//
// Public (verify_jwt = false) and read-only. Blog rows are loaded with the
// anon key via GET, so RLS restricts the read to status = published. The
// service-role key is intentionally unused. Static, location, and compare
// URLs come from src/lib/sitemapRoutes.ts, the same module the build-time
// writer uses.
//
// Content-Type is application/xml. Checked 2026-10-17 against the deployed
// function: HEAD returns that type, but GET (what a crawler sends, including
// Googlebot and Accept: application/xml) is rewritten to text/plain with a
// sandbox CSP and X-Content-Type-Options: nosniff. The body is still the XML.
// The header stays application/xml because that is what the function controls.
// Nothing in this repo can stop the gateway rewrite or proxy /sitemap.xml
// onto the www host. robots.txt is how crawlers find this URL.

import { fetchPublishedBlogPosts, handleSitemapRequest } from "../../../src/lib/sitemapRoutes.ts";

Deno.serve((req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  return handleSitemapRequest(req, {
    fetchPosts: () => fetchPublishedBlogPosts(supabaseUrl, anonKey),
  });
});
