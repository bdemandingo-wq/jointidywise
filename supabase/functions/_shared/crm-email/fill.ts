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
// Keep the org-footer marker. send-org-email uses it to avoid a second footer.
const CONDITIONAL_COMMENT = /<!--(?!\[if)(?!<!\[endif])(?!\s*tw-org-footer\s*-->)[\s\S]*?-->/g;

/**
 * Turn braces into entities so a filled value can never look like a
 * template token. Applied to every inserted value, not to the template.
 * Already-encoded entities are left alone.
 */
export function neutralizeBraces(value: string): string {
  return value.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

export function escapeHtml(value: string): string {
  return neutralizeBraces(
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"),
  );
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
    // Raw HTML keeps its tags. Braces are still neutralized so a name,
    // address, or owner sentence cannot throw the leftover-token check.
    return rawKey || raw.has(key) ? neutralizeBraces(val) : escapeHtml(val);
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
    // Owner copy is already substituted. Unknown {tokens} stay literal.
    return neutralizeBraces(next);
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
  s = decodeEntities(s);
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  middot: "\u00b7",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  zwnj: "\u200c",
  zwj: "\u200d",
  rsaquo: "\u203a",
  lsaquo: "\u2039",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  bull: "\u2022",
  times: "\u00d7",
  divide: "\u00f7",
  shy: "\u00ad",
};

/** One pass. `&amp;nbsp;` stays `&nbsp;` because the replacement is not rescanned. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return entity;
      return String.fromCodePoint(cp);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? entity : named;
  });
}
