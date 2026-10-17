// Live sitemap.xml.
//
// Public (verify_jwt = false) and read-only. Blog rows are loaded with the
// anon key via GET, so RLS restricts the read to status = published. The
// service-role key is intentionally unused. Static, location, and compare
// URLs come from src/lib/sitemapRoutes.ts, the same module the build-time
// writer uses.
//
// Content-Type is application/xml. On 2026-10-17 the Supabase edge gateway
// rewrote this function's response to text/plain on the wire and sandboxed
// it. The header is still set so a gateway change or a same-host proxy
// serves the type Search Console expects. robots.txt also lists the static
// /sitemap.xml, which the site serves as application/xml.

import { fetchPublishedBlogPosts, handleSitemapRequest } from "../../../src/lib/sitemapRoutes.ts";

Deno.serve((req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  return handleSitemapRequest(req, {
    fetchPosts: () => fetchPublishedBlogPosts(supabaseUrl, anonKey),
  });
});
