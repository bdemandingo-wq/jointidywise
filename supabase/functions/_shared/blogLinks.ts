/**
 * A conversion link counts whether the model wrote a root-relative path
 * (`/pricing`) or the public origin (`https://jointidywise.com/pricing`).
 * Absolute links were failing the draft gate, so daily posts stayed unpublished.
 */
const BRAND_PATH = "(?:pricing|features|compare|blog)(?:/[^\"']*)?";

export function hasInternalBrandLink(html: string): boolean {
  const relative = new RegExp(
    `<a\\b[^>]*\\bhref\\s*=\\s*["']/${BRAND_PATH}["']`,
    "i",
  );
  const absolute = new RegExp(
    `<a\\b[^>]*\\bhref\\s*=\\s*["']https?://(?:www\\.)?jointidywise\\.com/${BRAND_PATH}["']`,
    "i",
  );
  return relative.test(html) || absolute.test(html);
}
