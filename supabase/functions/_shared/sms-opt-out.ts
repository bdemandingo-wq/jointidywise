import { toE164 } from "./phone.ts";

/**
 * Inbound SMS opt-out classification and the one confirmation text.
 *
 * Exact keywords and clear phrases opt the customer out. A keyword buried in
 * an ordinary sentence ("Cancel my Friday cleaning", "End time is 3?") does
 * not. Those stay in the business inbox and are flagged for a person.
 *
 * The confirmation is one GSM-7 basic segment (160 characters). A character
 * outside that set would flip the whole text to UCS-2 and its 70-character
 * limit, so business names are sanitized before they are rendered.
 */

/** GSM 03.38 basic character set. Extension-table characters are excluded. */
export const GSM_7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** One GSM-7 segment. Past this, carriers concatenate and the org pays twice. */
export const GSM_7_SINGLE_SEGMENT = 160;

/**
 * Whole-message keywords. Case, whitespace, and punctuation are ignored, so
 * "stop.", " END! ", and "opt out" match. A longer sentence does not.
 */
export const SMS_OPT_OUT_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
] as const;

/**
 * Clear opt-out requests. Matched as whole words, so "stop texting me" and
 * "please don't text me anymore" count, and "remove meat" does not.
 */
export const SMS_OPT_OUT_PHRASES = [
  "stop texting",
  "stop messaging",
  "unsubscribe me",
  "don't text",
  "dont text",
  "do not text",
  "remove me",
  "take me off",
] as const;

const KEYWORD_SET = new Set<string>(SMS_OPT_OUT_KEYWORDS);

export interface SmsOptOutResult {
  /** Auto opt-out: exact keyword or a clear phrase. */
  optOut: boolean;
  /**
   * Not an auto opt-out, but an opt-out keyword appears as its own word.
   * The message still goes to the inbox; a person should read it.
   */
  needsReview: boolean;
  /** Keyword or phrase that decided the result, when there is one. */
  matched: string | null;
}

const NO_MATCH: SmsOptOutResult = { optOut: false, needsReview: false, matched: null };

/** Curly and modifier apostrophes, folded to ASCII 0x27. */
const APOSTROPHE_LIKE = /[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\uFF07]/g;

const CHAR_FOLD: Record<string, string> = {
  "\u00A0": " ",
  "\u2007": " ",
  "\u2009": " ",
  "\u200A": " ",
  "\u202F": " ",
  "\u2010": "-",
  "\u2011": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  // Three ASCII periods. Never the single ellipsis character.
  "\u2026": "...",
  "\u201C": "\"",
  "\u201D": "\"",
  "\u00AB": "\"",
  "\u00BB": "\"",
  "\u20AC": "EUR",
};

export function isGsm7Basic(text: string): boolean {
  for (const ch of text) {
    if (!GSM_7_BASIC.includes(ch)) return false;
  }
  return true;
}

/**
 * Replace or drop characters that are not in the GSM-7 basic set.
 * Accented letters whose base is basic (í -> i) are folded. Emoji are dropped.
 * An ellipsis character becomes three ASCII periods.
 */
export function sanitizeToGsm7Basic(input: string): string {
  let out = "";
  const source = input.normalize("NFC").replace(APOSTROPHE_LIKE, "'");
  for (const ch of source) {
    if (GSM_7_BASIC.includes(ch)) {
      out += ch;
      continue;
    }
    const folded = CHAR_FOLD[ch];
    if (folded) {
      out += folded;
      continue;
    }
    const base = ch.normalize("NFD")[0];
    if (base && base !== ch && GSM_7_BASIC.includes(base)) {
      out += base;
    }
  }
  return out;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Shorten `text` to `maxLen` characters. When it does not fit, the ending is
 * three ASCII periods (`...`), never the single ellipsis character.
 */
export function truncateWithAsciiEllipsis(text: string, maxLen: number): string {
  if (maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  if (maxLen <= 3) return ".".repeat(maxLen);
  const head = text.slice(0, maxLen - 3).trimEnd();
  return `${head}...`;
}

function lettersOnly(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}

function words(raw: string): string[] {
  return raw.toUpperCase().split(/[^A-Z]+/).filter((word) => word.length > 0);
}

function phraseText(raw: string): string {
  return collapse(
    raw.toLowerCase().replace(APOSTROPHE_LIKE, "'").replace(/[^a-z']+/g, " "),
  );
}

function includesPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function classifySmsOptOut(content: string | null | undefined): SmsOptOutResult {
  if (typeof content !== "string" || content.trim().length === 0) return NO_MATCH;

  const exact = lettersOnly(content);
  if (exact && KEYWORD_SET.has(exact)) {
    return { optOut: true, needsReview: false, matched: exact };
  }

  const normalized = phraseText(content);
  const phrases = [...SMS_OPT_OUT_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (includesPhrase(normalized, phrase)) {
      return { optOut: true, needsReview: false, matched: phrase };
    }
  }

  for (const word of words(content)) {
    if (KEYWORD_SET.has(word)) {
      return { optOut: false, needsReview: true, matched: word };
    }
  }

  return NO_MATCH;
}

const CONFIRM_PREFIX = "You're unsubscribed from ";
const CONFIRM_NO_PHONE_SUFFIX = " texts. Reply START to resubscribe.";
const CONFIRM_PHONE_MID = " texts. To change an appointment, call ";
const CONFIRM_PHONE_TAIL = ". Reply START to resubscribe.";
const NAME_FALLBACK = "our team";

/**
 * Address for the one confirmation text. Prefer a strict E.164 number. If the
 * inbound webhook already carried a +number that the strict check rejects
 * (some OpenPhone senders), reply to that same address instead of inventing one.
 */
export function optOutReplyAddress(raw: string | null | undefined): string | null {
  const strict = toE164(raw);
  if (strict) return strict;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0")) {
    return `+${digits}`;
  }
  return null;
}

function usablePhone(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  const cleaned = collapse(sanitizeToGsm7Basic(raw));
  return /\d/.test(cleaned) ? cleaned : "";
}

function usableName(raw: string | null | undefined): string {
  const cleaned = collapse(sanitizeToGsm7Basic(typeof raw === "string" ? raw : ""));
  return cleaned || NAME_FALLBACK;
}

/**
 * One opt-out confirmation. No marketing. The phone sentence is omitted when
 * there is no usable business phone. The result is always GSM-7 basic and
 * fits in a single 160-character segment.
 */
export function renderOptOutConfirmation(
  businessName: string | null | undefined,
  businessPhone: string | null | undefined,
): string {
  const name = usableName(businessName);
  const phone = usablePhone(businessPhone);

  if (phone) {
    const overhead = CONFIRM_PREFIX.length + CONFIRM_PHONE_MID.length + CONFIRM_PHONE_TAIL.length;
    let phoneShown = phone;
    let nameRoom = GSM_7_SINGLE_SEGMENT - overhead - phoneShown.length;
    if (nameRoom < 3) {
      phoneShown = truncateWithAsciiEllipsis(phone, Math.max(GSM_7_SINGLE_SEGMENT - overhead - 3, 3));
      nameRoom = GSM_7_SINGLE_SEGMENT - overhead - phoneShown.length;
    }
    const nameShown = truncateWithAsciiEllipsis(name, nameRoom);
    return `${CONFIRM_PREFIX}${nameShown}${CONFIRM_PHONE_MID}${phoneShown}${CONFIRM_PHONE_TAIL}`;
  }

  const overhead = CONFIRM_PREFIX.length + CONFIRM_NO_PHONE_SUFFIX.length;
  const nameShown = truncateWithAsciiEllipsis(name, GSM_7_SINGLE_SEGMENT - overhead);
  return `${CONFIRM_PREFIX}${nameShown}${CONFIRM_NO_PHONE_SUFFIX}`;
}
