// Server-side rendering + sanitization of user-authored email sections.
// Kept dependency-free so it works inside Deno edge functions.

export type EmailSectionKey =
  | 'intro' | 'reminders' | 'pricing' | 'cancellation'
  | 'payment' | 'satisfaction' | 'closing' | 'footer' | 'custom';

export interface EmailSection {
  id: string;
  key: EmailSectionKey;
  title: string;
  html: string;
  enabled: boolean;
  order: number;
}

export interface BookingEmailData {
  customer_name: string;
  booking_number: string;
  service_name: string;
  scheduled_date: string;
  scheduled_time: string;
  address: string;
  total_amount: string;
  company_name: string;
}

const ALLOWED_TAGS = new Set([
  'p','br','strong','b','em','i','u','s',
  'h2','h3','ul','ol','li','a','blockquote','span',
]);

/** Defense-in-depth sanitizer. Strips scripts, event handlers, unsafe URIs. */
export function sanitizeSectionHtml(html: string): string {
  if (!html) return '';
  let s = String(html);
  // Remove dangerous block tags entirely (open+content+close)
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  // Remove any remaining self-closing dangerous tags
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta|form|input)\b[^>]*\/?\s*>/gi, '');
  // Strip event handler attributes and inline style
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\sstyle\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\sstyle\s*=\s*'[^']*'/gi, '');
  // Neutralize javascript: / data: hrefs
  s = s.replace(/(href|src)\s*=\s*"(\s*javascript:|\s*data:)[^"]*"/gi, '$1="#"');
  s = s.replace(/(href|src)\s*=\s*'(\s*javascript:|\s*data:)[^']*'/gi, "$1='#'");
  // Drop any tag not in allowlist (keep inner text). Simple pass.
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag) => {
    return ALLOWED_TAGS.has(String(tag).toLowerCase()) ? match : '';
  });
  return s;
}

/** Booking confirmation total. The design prints the value with no currency sign. */
export function formatBookingTotal(amount: string): string {
  const v = String(amount ?? "").trim();
  if (!v) return "";
  if (v.startsWith("$")) return v;
  return `$${v}`;
}

export function replaceVariables(text: string, data: BookingEmailData): string {
  if (!text) return '';
  let out = text;
  for (const [k, v] of Object.entries(data)) {
    out = out.split(`{{${k}}}`).join(String(v ?? ''));
  }
  return out;
}

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function visibleSectionText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
}

/**
 * Enabled-but-empty sections use the branded default copy. A card with no
 * visible body (the empty custom default, or a blank owner section) is omitted.
 */
export function sectionCardContent(section: EmailSection): { title: string; html: string } | null {
  const hasHtml = !!section.html?.trim();
  const rawHtml = hasHtml ? section.html : (SECTION_DEFAULTS[section.key]?.html ?? "");
  const rawTitle = section.title?.trim()
    ? section.title
    : (hasHtml ? "" : (SECTION_DEFAULTS[section.key]?.title ?? ""));
  if (!visibleSectionText(rawHtml)) return null;
  return { title: rawTitle, html: rawHtml };
}

/** Server-side branded defaults, used when a section is enabled but empty. */
const SECTION_DEFAULTS: Record<EmailSectionKey, { title: string; html: string }> = {
  intro: { title: '', html: '<p>Hi <strong>{{customer_name}}</strong>,</p><p>Thanks for choosing <strong>{{company_name}}</strong>. Your appointment details are below.</p>' },
  reminders: { title: 'Before we arrive', html: '<ul><li>Someone 18+ should be available, or leave entry instructions.</li><li>Secure pets in a comfortable area away from the work zone.</li><li>Move small valuables you\'d like us to skip.</li></ul>' },
  pricing: { title: 'About your price', html: '<p>Your quoted total is <strong>${{total_amount}}</strong>. If we discover the home is significantly larger or dirtier than booked, we\'ll contact you before any adjustment.</p>' },
  cancellation: { title: 'Cancellation & rescheduling', html: '<p>Need to reschedule? Reply to this email at least <strong>24 hours</strong> before your appointment and we\'ll take care of it.</p>' },
  payment: { title: 'Payment', html: '<p>Your card on file will be charged after service is complete. You\'ll receive a receipt by email.</p>' },
  satisfaction: { title: 'Our satisfaction guarantee', html: '<p>If anything isn\'t up to your standards, let us know within 24 hours and we\'ll come back to make it right.</p>' },
  closing: { title: '', html: '<p>See you on <strong>{{scheduled_date}}</strong>!<br/>The {{company_name}} team</p>' },
  footer: { title: '', html: '<p>Booking reference: {{booking_number}}</p>' },
  custom: { title: 'Additional info', html: '<p></p>' },
};

/** Wrap each section's user HTML with inline email-safe styles for max client compat. */
export function renderSectionsToHtml(
  sections: EmailSection[],
  data: BookingEmailData,
  primaryColor: string,
): string {
  const active = [...sections]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);
  if (active.length === 0) return '';

  const blocks = active.map((section) => {
    const rawHtml = section.html?.trim() ? section.html : SECTION_DEFAULTS[section.key]?.html ?? '';
    const rawTitle = section.title?.trim()
      ? section.title
      : (section.html?.trim() ? '' : SECTION_DEFAULTS[section.key]?.title ?? '');
    if (!rawHtml && !rawTitle) return '';
    const cleanHtml = sanitizeSectionHtml(rawHtml);
    const bodyHtml = injectInlineStyles(replaceVariables(cleanHtml, data), primaryColor);
    const titleHtml = rawTitle
      ? `<h2 style="margin:20px 0 10px;font-size:17px;font-weight:700;color:${primaryColor};letter-spacing:.2px;">${escapeHtml(replaceVariables(rawTitle, data))}</h2>`
      : '';
    return `<div style="margin:0 0 8px;">${titleHtml}${bodyHtml}</div>`;
  });

  return blocks.join('');
}

/**
 * Post-process sanitized HTML to add inline styles so rich-text formatting looks
 * consistent across Gmail, Apple Mail, Outlook, and mobile clients.
 */
function injectInlineStyles(html: string, primary: string): string {
  return html
    .replace(/<p(\s|>)/gi, `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.65;color:#374151;"$1`)
    .replace(/<h2(\s|>)/gi, `<h2 style="margin:18px 0 10px;font-size:17px;font-weight:700;color:${primary};"$1`)
    .replace(/<h3(\s|>)/gi, `<h3 style="margin:14px 0 8px;font-size:15px;font-weight:700;color:#111827;"$1`)
    .replace(/<ul(\s|>)/gi, `<ul style="margin:0 0 14px 20px;padding:0;font-size:15px;line-height:1.65;color:#374151;"$1`)
    .replace(/<ol(\s|>)/gi, `<ol style="margin:0 0 14px 20px;padding:0;font-size:15px;line-height:1.65;color:#374151;"$1`)
    .replace(/<li(\s|>)/gi, `<li style="margin:0 0 6px 0;"$1`)
    .replace(/<a(\s|>)/gi, `<a style="color:${primary};text-decoration:underline;"$1`)
    .replace(/<blockquote(\s|>)/gi, `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid ${primary};background:#f9fafb;color:#374151;font-size:15px;line-height:1.6;"$1`)
    .replace(/<strong(\s|>)/gi, `<strong style="font-weight:700;color:#111827;"$1`);
}
