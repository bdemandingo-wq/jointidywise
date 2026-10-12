/** Person names. Long enough for "Mary Anne Van Der Berg", short enough that a
 * pasted paragraph cannot blow out the sidebar, invoices, and the portal header. */
export const PERSON_NAME_MAX = 80;

/** Business names run longer than personal names, but a 300-character paste
 * still breaks the same three screens. */
export const BUSINESS_NAME_MAX = 120;

/**
 * A name is plain text. React will not execute a `<script>` in `{name}`, but
 * it will show the tags, which is what the portal greeting was doing.
 * Strip tags and leftover brackets, then collapse whitespace.
 */
export function sanitizeDisplayName(raw: string | null | undefined, fallback = ''): string {
  if (!raw) return fallback;
  const stripped = raw
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || fallback;
}
