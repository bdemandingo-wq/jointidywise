// Ping the prerender cache already used by recache-blog-post.
// Encited first, then prerender.io. No other provider is called.
// A missing token is a skip, matching recache-blog-post.

const SITE_HOSTS = new Set(["www.jointidywise.com", "jointidywise.com"]);
const DEFAULT_ENCITED_ENDPOINT = "https://encited.com/api/prerender/cache/invalidate-page-cache";

export type BlogRecacheResult = {
  ok: boolean;
  skipped?: boolean;
  provider?: string;
  status?: number;
  response?: string;
};

export function publishedBlogUrl(slug: string): string | null {
  const trimmed = slug.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (/[\s/?#\\]/.test(trimmed) || trimmed.includes("..")) return null;
  return `https://www.jointidywise.com/blog/post/${encodeURIComponent(trimmed)}`;
}

export async function pingBlogRecache(targetUrl: string): Promise<BlogRecacheResult> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { ok: false, response: "invalid url" };
  }
  if (!SITE_HOSTS.has(parsed.hostname)) {
    return { ok: false, response: "url must be on jointidywise.com" };
  }

  const encitedToken = Deno.env.get("ENCITED_API_TOKEN");
  const prerenderToken = Deno.env.get("PRERENDER_TOKEN");
  if (!encitedToken && !prerenderToken) {
    console.warn("[pingBlogRecache] No recache provider configured — skipping for", targetUrl);
    return { ok: true, skipped: true };
  }

  if (encitedToken) {
    const endpoint = Deno.env.get("ENCITED_RECACHE_ENDPOINT") || DEFAULT_ENCITED_ENDPOINT;
    const domain = Deno.env.get("ENCITED_DOMAIN") || parsed.host;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-lovablehtml-api-key": encitedToken },
      body: JSON.stringify({ domain, path: parsed.pathname, prewarm: true }),
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, provider: "encited", status: res.status, response: text.slice(0, 500) };
  }

  const res = await fetch("https://api.prerender.io/recache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prerenderToken, url: targetUrl }),
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, provider: "prerender", status: res.status, response: text.slice(0, 500) };
}
