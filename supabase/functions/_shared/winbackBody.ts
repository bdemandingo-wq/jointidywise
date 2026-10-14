import { escapeHtml } from "./escapeHtml.ts";

/**
 * The shipped win-back steps are plain sentences. The Book Now link lives
 * in the HTML shell, not in the template. An owner template that does
 * contain a tag or an href keeps that markup; only the token values are
 * escaped in that case.
 */
export function winbackTemplateHasMarkup(template: string): boolean {
  return /<[a-z][^>]*>/i.test(template) || /\bhref\s*=/i.test(template);
}

export function winbackParagraphHtml(template: string, resolvedText: string): string {
  if (winbackTemplateHasMarkup(template)) return resolvedText;
  return escapeHtml(resolvedText);
}
