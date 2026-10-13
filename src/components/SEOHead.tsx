import { useLayoutEffect, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { safeJsonLd } from "@/lib/safeJsonLd";

// useLayoutEffect runs synchronously after DOM mutations but before paint, so
// the per-route head tags are set before any prerender snapshot captures the
// page. Falls back to useEffect during SSR (where useLayoutEffect warns).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const PRODUCTION_DOMAIN = "https://www.jointidywise.com";
const DEFAULT_OG_IMAGE = `${PRODUCTION_DOMAIN}/images/tidywise-og.png`;

/**
 * Normalizes any path or URL to the canonical form:
 * - forces the www production domain
 * - strips query strings and hash fragments
 * - strips trailing slashes (except root)
 * - lowercases the path
 */
export function normalizeCanonical(input: string): string {
  let path: string;
  if (input.startsWith("http")) {
    try {
      path = new URL(input).pathname;
    } catch {
      path = "/";
    }
  } else {
    path = input.startsWith("/") ? input : `/${input}`;
  }
  // strip query/hash if present in a raw path string
  path = path.split("?")[0].split("#")[0].toLowerCase();
  // strip trailing slash except for root
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${PRODUCTION_DOMAIN}${path}`;
}

type SEOHeadProps = {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  ogType?: "website" | "article";
  noIndex?: boolean;
  schemaJson?: Record<string, unknown> | Record<string, unknown>[];
};

export function SEOHead({
  title,
  description,
  canonical,
  ogImage,
  ogType = "website",
  noIndex = false,
  schemaJson,
}: SEOHeadProps) {
  // Derive canonical: explicit prop wins; otherwise use the current pathname
  // so every page emits a self-referencing canonical on the preferred (www) domain.
  // IMPORTANT: query strings (utm_*, ref, fbclid, gclid, ...) are intentionally
  // stripped — canonicals must always point at the clean URL, otherwise GSC
  // reports canonical mismatches for every tracked visit.
  const pathFromBrowser =
    typeof window !== "undefined" ? window.location.pathname : "/";
  const canonicalSource = canonical ?? pathFromBrowser;
  const canonicalUrl = normalizeCanonical(canonicalSource);

  const imageUrl = ogImage
    ? ogImage.startsWith("http")
      ? ogImage
      : `${PRODUCTION_DOMAIN}${ogImage}`
    : DEFAULT_OG_IMAGE;

  // Keep the static canonical and OG/Twitter tags from index.html in sync so there's
  // exactly one of each in <head>, even before Helmet hydrates / for non-JS crawlers.
  // Using a layout effect so the update happens before paint — important for
  // prerender snapshots that capture the DOM at first paint.
  useIsoLayoutEffect(() => {
    const setLinkHref = (selector: string, href: string) => {
      const tag = document.querySelector<HTMLLinkElement>(selector);
      if (tag) tag.href = href;
    };
    const setMetaContent = (selector: string, content: string) => {
      const tag = document.querySelector<HTMLMetaElement>(selector);
      if (tag) tag.content = content;
    };

    setLinkHref('link[rel="canonical"]', canonicalUrl);

    // Update the static <title> in index.html (also updates the browser tab).
    if (typeof document !== "undefined") {
      document.title = title;
    }

    // Sync the static description meta in index.html so non-JS crawlers and
    // SEO scorers that read the initial HTML see the correct, per-route copy.
    setMetaContent('meta[name="description"]', description);

    setMetaContent(
      'meta[name="robots"]',
      noIndex ? "noindex, nofollow" : "index, follow"
    );

    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[property="og:image"]', imageUrl);
    setMetaContent('meta[property="og:url"]', canonicalUrl);
    setMetaContent('meta[property="og:type"]', ogType);

    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', description);
    setMetaContent('meta[name="twitter:image"]', imageUrl);
  }, [canonicalUrl, title, description, imageUrl, noIndex, ogType]);

  const jsonLdPayload = schemaJson
    ? Array.isArray(schemaJson)
      ? safeJsonLd({ "@context": "https://schema.org", "@graph": schemaJson })
      : safeJsonLd({ "@context": "https://schema.org", ...schemaJson })
    : undefined;

  // All conventional head tags (title, description, robots, canonical, OG,
  // Twitter) are managed by the useEffect above — it mutates the existing
  // static tags from index.html in place. Helmet is used only for JSON-LD
  // because there's no static schema tag to update.
  return (
    <Helmet>
      {jsonLdPayload && (
        <script type="application/ld+json">{jsonLdPayload}</script>
      )}
    </Helmet>
  );
}
