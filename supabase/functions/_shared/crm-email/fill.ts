/**
 * Fill a branded CRM email shell.
 *
 * Templates are the generated HTML designs. This module substitutes
 * {{double}} tokens, {single} automation tokens, owner-content slots,
 * and repeating rows. It does not import Deno or node so both edge
 * functions and the node:test suite can load it.
 *
 * Values are escaped unless listed in rawKeys or passed as a slot
 * (slots are caller-rendered HTML: owner bodies, already-escaped alert
 * text, sanitized sections).
 */

export const UNSUBSCRIBE_URL_SENTINEL = "__TW_UNSUBSCRIBE_URL__";

export const TIDYWISE_LOGO_URL = "https://jointidywise.com/email-logo.png";

export const DEFAULT_ORG_PRIMARY = "#1e5bb0";
export const DEFAULT_ORG_ACCENT = "#14b8a6";

const DOUBLE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
const SINGLE = /(?<![{.\w])\{([a-z_]+)\}(?!\})/g;
const SLOT = /<!-- CONTENT SLOT START:[\s\S]*?-->([\s\S]*?)<!-- CONTENT SLOT END -->/g;
const CONDITIONAL_COMMENT = /<!--(?!\[if)(?!<!\[endif)[\s\S]*?-->/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeColor(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.test(v)) {
    return v;
  }
  return fallback;
}

export interface RepeatSpec {
  /** Token prefix that marks the sample row, e.g. "job." or "section.". */
  prefix: string;
  rows: Array<Record<string, string>>;
}

export interface FillInput {
  vars?: Record<string, string | number | null | undefined>;
  /**
   * HTML dropped into each <!-- CONTENT SLOT --> in document order.
   * Null keeps the design's default copy (then token-filled).
   */
  slots?: Array<string | null | undefined>;
  repeats?: RepeatSpec[];
  /** When false, the <!-- OPTIONAL --> block (weekly AI insight) is removed. */
  includeOptional?: boolean;
  /** Variable names inserted without escaping (pre-sanitized HTML). */
  rawKeys?: string[];
}

function stringify(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function applyTokens(html: string, vars: Record<string, string>, raw: Set<string>): string {
  const replacer = (rawKey: boolean) => (_m: string, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return _m;
    const val = vars[key];
    return rawKey || raw.has(key) ? val : escapeHtml(val);
  };
  return html
    .replace(DOUBLE, (m, key) => replacer(false)(m, key))
    .replace(SINGLE, (m, key) => replacer(false)(m, key));
}

function replaceSlots(html: string, slots: Array<string | null | undefined> | undefined): string {
  if (!slots || slots.length === 0) return html;
  let i = 0;
  return html.replace(SLOT, (full) => {
    const next = slots[i++];
    if (next === null || next === undefined) return full;
    return next;
  });
}

function rowRegex(prefix: string): RegExp {
  const token = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<tr\\b(?:(?!<tr\\b)[\\s\\S])*?\\{\\{${token}[\\s\\S]*?<\\/tr>`, "i");
}

function sectionCardRegex(): RegExp {
  return /<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 0 10px 0;">[\s\S]*?\{\{section\.title\}\}[\s\S]*?\{\{section\.body\}\}[\s\S]*?<\/table><\/td><\/tr><\/table><\/td><\/tr><\/table>/;
}

function expandRepeat(html: string, spec: RepeatSpec, raw: Set<string>): string {
  const re = spec.prefix === "section." ? sectionCardRegex() : rowRegex(spec.prefix);
  const match = re.exec(html);
  if (!match) return html;
  const sample = match[0];
  if (spec.rows.length === 0) {
    return html.slice(0, match.index) + html.slice(match.index + sample.length);
  }
  const filled = spec.rows.map((row) => {
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) vars[k] = stringify(v);
    return applyTokens(sample, vars, raw);
  }).join("");
  return html.slice(0, match.index) + filled + html.slice(match.index + sample.length);
}

function logoFallback(html: string, name: string): string {
  if (html.includes("{{ORG_LOGO_URL}}") && !html.includes('src="{{ORG_LOGO_URL}}"')) {
    return html;
  }
  const safe = escapeHtml(name || "Your business");
  return html.replace(
    /<img src="\{\{ORG_LOGO_URL\}\}"[^>]*>/g,
    `<span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:800;color:#111827;">${safe}</span>`,
  );
}

export function findLeftoverTokens(html: string): string[] {
  const visible = html.replace(CONDITIONAL_COMMENT, "");
  const found = new Set<string>();
  for (const m of visible.matchAll(/\{\{[^}]+\}\}/g)) found.add(m[0]);
  for (const m of visible.matchAll(/(?<![{.\w])\{[a-z_]+\}(?!\})/g)) found.add(m[0]);
  return [...found];
}

export function fillTemplate(html: string, input: FillInput = {}): string {
  const raw = new Set(input.rawKeys ?? []);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.vars ?? {})) vars[k] = stringify(v);

  let out = replaceSlots(html, input.slots);

  if (input.includeOptional === false) {
    out = out.replace(/<!-- OPTIONAL:[\s\S]*?<\/table>/, "");
  }

  for (const spec of input.repeats ?? []) {
    out = expandRepeat(out, spec, raw);
  }

  const logo = vars.ORG_LOGO_URL ?? "";
  if (!logo) {
    const name = vars.company_name || vars.companyName || vars.orgName || vars.biz || vars.businessName || "";
    out = logoFallback(out, name);
    delete vars.ORG_LOGO_URL;
  }

  out = applyTokens(out, vars, raw);
  out = out.replace(CONDITIONAL_COMMENT, "");
  return out;
}

export function htmlToText(html: string): string {
  let s = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
    const label = String(text).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const url = String(href);
    if (!url || url === "#" || url.startsWith("mailto:") && label.includes("@")) return label || url;
    if (!label || label === url) return url;
    return `${label} (${url})`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|h1|h2|h3|div|tr|table)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&#\d+;/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}
