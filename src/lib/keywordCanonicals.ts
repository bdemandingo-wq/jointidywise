/**
 * One main URL per keyword. Every other entry is a duplicate: noindex, and
 * its canonical points at the main page.
 *
 * Chosen by title and target keyword (blog_posts.target_keyword where the
 * page is a database post), not by a passing mention of the word.
 */
export const SCHEDULING_MAIN = "/blog/post/cleaning-business-scheduling-software";
export const INVOICING_MAIN = "/blog/invoicing-software-for-cleaning-business";

export const KEYWORD_CANONICALS: Record<string, string> = {
  // "cleaning business scheduling software" / "scheduling software for a cleaning business"
  "/features/scheduling-software": SCHEDULING_MAIN,
  "/blog/scheduling-software-for-cleaning-business": SCHEDULING_MAIN,
  "/blog/post/best-scheduling-software-cleaning-business": SCHEDULING_MAIN,
  "/blog/post/best-cleaning-service-scheduling-software-2026-compared": SCHEDULING_MAIN,
  "/blog/post/cleaning-company-scheduling-tools": SCHEDULING_MAIN,

  // "invoicing software for cleaning businesses" — same title on the feature page.
  // Invoice-template and itemized-billing posts target different phrases.
  "/features/invoicing-software": INVOICING_MAIN,
};

export function keywordCanonical(path: string): string | undefined {
  return KEYWORD_CANONICALS[path];
}
