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

/**
 * First or last word of a message of at most 3 words. CANCEL and END are
 * deliberately absent: "End time is 3?" must not opt anyone out.
 */
const SHORT_MESSAGE_OPT_OUT = new Set<string>([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "QUIT",
  "OPTOUT",
  "REVOKE",
]);

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

/**
 * One token per word. A contraction (don't, can't) is one word. A number or
 * a clock time (3, 3:00, 3pm) is one word, so "stop by at 3" is four words.
 */
function messageTokens(raw: string): string[] {
  const normalized = raw.toLowerCase().replace(APOSTROPHE_LIKE, "'");
  return normalized.match(
    /[a-z]+(?:'[a-z]+)+|\d{1,2}:\d{2}\s*(?:am|pm)?|\d+\s*(?:am|pm)?|[a-z]+/g,
  ) ?? [];
}

function keywordKey(token: string): string {
  return token.toUpperCase().replace(/[^A-Z]/g, "");
}

/** "don't stop" / "can't stop" negate the keyword. They are not opt-outs. */
const NEGATION_WORDS = new Set([
  "DONT",
  "CANT",
  "WONT",
  "ISNT",
  "ARENT",
  "DIDNT",
  "WASNT",
  "WERENT",
  "HAVENT",
  "HASNT",
  "HADNT",
  "COULDNT",
  "SHOULDNT",
  "WOULDNT",
]);

const BOUNDED_OPT_OUT_PHRASES = [
  ["OPT", "ME", "OUT"],
  ["NO", "MORE", "TEXTS"],
] as const;

function phraseText(raw: string): string {
  return collapse(
    raw.toLowerCase().replace(APOSTROPHE_LIKE, "'").replace(/[^a-z']+/g, " "),
  );
}

function includesPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

/** "opt me out" or "no more texts" anywhere in the message. Length is decided by the caller. */
function boundedOptOutPhrase(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  const keys = tokens.map(keywordKey);
  for (const phrase of BOUNDED_OPT_OUT_PHRASES) {
    for (let i = 0; i <= keys.length - phrase.length; i++) {
      if (phrase.every((part, offset) => keys[i + offset] === part)) {
        return phrase.join(" ").toLowerCase();
      }
    }
  }
  return null;
}

/** "stop sending", "quit texting", "unsubscribe messaging", and the same shape. */
function channelOptOutPhrase(normalized: string): string | null {
  const parts = normalized.split(" ").filter((part) => part.length > 0);
  for (let i = 0; i < parts.length - 1; i++) {
    const lead = parts[i];
    const follow = parts[i + 1];
    const leadMatches = lead === "stop" || lead === "quit" || lead === "unsubscribe";
    const followMatches = follow === "sending"
      || follow === "contacting"
      || follow === "receiving"
      || follow.startsWith("messag")
      || follow.startsWith("text");
    if (leadMatches && followMatches) return `${lead} ${follow}`;
  }
  return null;
}

/** Whole-message resubscribe keywords. Same normalization as the STOP matcher. */
export const SMS_RESUBSCRIBE_KEYWORDS = ["START", "UNSTOP"] as const;

const RESUBSCRIBE_SET = new Set<string>(SMS_RESUBSCRIBE_KEYWORDS);

export function exactSmsToken(content: string | null | undefined): string | null {
  if (typeof content !== "string" || content.trim().length === 0) return null;
  const token = lettersOnly(content);
  return token || null;
}

export function isExactResubscribe(content: string | null | undefined): boolean {
  const token = exactSmsToken(content);
  return token !== null && RESUBSCRIBE_SET.has(token);
}

/** Whole-message HELP. The inbound webhook is the only sender of the reply. */
export function isExactHelp(content: string | null | undefined): boolean {
  return exactSmsToken(content) === "HELP";
}

/** One-word CANCEL or END. "Cancel my Friday cleaning" is not this. */
export function isExactCancelOrEnd(content: string | null | undefined): boolean {
  const token = exactSmsToken(content);
  return token === "CANCEL" || token === "END";
}

export function classifySmsOptOut(content: string | null | undefined): SmsOptOutResult {
  if (typeof content !== "string" || content.trim().length === 0) return NO_MATCH;

  const exact = lettersOnly(content);
  // START / UNSTOP are not opt-outs. They are handled by nextSmsConsent.
  if (exact && RESUBSCRIBE_SET.has(exact)) return NO_MATCH;
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

  const channelPhrase = channelOptOutPhrase(normalized);
  if (channelPhrase) {
    return { optOut: true, needsReview: false, matched: channelPhrase };
  }

  const tokens = messageTokens(content);
  const bounded = boundedOptOutPhrase(tokens);
  if (bounded && tokens.length <= 6) {
    return { optOut: true, needsReview: false, matched: bounded };
  }
  if (bounded) {
    return { optOut: false, needsReview: true, matched: bounded };
  }

  // "please stop", "STOP STOP", "stop now". Not "stop by", "don't stop",
  // "End time is 3?", or "please cancel".
  const keys = tokens.map(keywordKey);
  if (keys.length > 0 && keys.length <= 3) {
    const first = keys[0];
    const last = keys[keys.length - 1];
    const stopBy = first === "STOP" && keys[1] === "BY";
    if (!stopBy && SHORT_MESSAGE_OPT_OUT.has(first)) {
      return { optOut: true, needsReview: false, matched: first };
    }
    const precededByNegation = NEGATION_WORDS.has(keys[keys.length - 2] ?? "");
    if (SHORT_MESSAGE_OPT_OUT.has(last) && !precededByNegation) {
      return { optOut: true, needsReview: false, matched: last };
    }
  }

  for (const key of keys) {
    if (KEYWORD_SET.has(key)) {
      return { optOut: false, needsReview: true, matched: key };
    }
  }

  return NO_MATCH;
}

/**
 * Customer consent columns the webhook reads and writes.
 * marketing_status_before_sms_stop is the value to put back on START.
 * It is null for opt-outs recorded before that column existed.
 */
export interface SmsConsentState {
  marketing_status: string;
  opted_out_at: string | null;
  opted_out_method: string | null;
  opted_out_campaign_id: string | null;
  marketing_status_before_sms_stop: string | null;
}

export interface SmsConsentStep {
  state: SmsConsentState;
  /** Write `state` back to the customer row. */
  persist: boolean;
  /** Automatic opt-out. One confirmation text, and no AI reply. */
  optOut: boolean;
  sendConfirmation: boolean;
  /** Inbox flag: keyword in a sentence. */
  optOutReview: boolean;
  /** START/UNSTOP cleared a blocking opt-out. No second text. */
  smsResubscribed: boolean;
  /** Skip the AI auto-reply. */
  suppressAi: boolean;
}

const SMS_STOP_METHOD = "sms_stop";

function optedOutAnotherWay(state: SmsConsentState): boolean {
  if (state.opted_out_method === SMS_STOP_METHOD) return false;
  if (state.marketing_status === "opted_out") return true;
  return Boolean(state.opted_out_method);
}

function applySmsStop(state: SmsConsentState, now: string, campaignId: string | null): SmsConsentState {
  const alreadySmsStop = state.opted_out_method === SMS_STOP_METHOD;
  // A second STOP must not overwrite the saved consent with "opted_out".
  const snapshot = alreadySmsStop || state.marketing_status === "opted_out"
    ? state.marketing_status_before_sms_stop
    : state.marketing_status;
  return {
    marketing_status: "opted_out",
    opted_out_at: now,
    opted_out_method: SMS_STOP_METHOD,
    opted_out_campaign_id: campaignId,
    marketing_status_before_sms_stop: snapshot,
  };
}

function nonBlockingMarketingStatus(state: SmsConsentState): string {
  const saved = state.marketing_status_before_sms_stop;
  if (saved && saved !== "opted_out") return saved;
  if (state.marketing_status && state.marketing_status !== "opted_out") return state.marketing_status;
  return "subscribed";
}

function restoreSmsStop(state: SmsConsentState): SmsConsentState {
  return {
    marketing_status: nonBlockingMarketingStatus(state),
    opted_out_at: null,
    opted_out_method: null,
    opted_out_campaign_id: null,
    marketing_status_before_sms_stop: null,
  };
}

/**
 * One inbound message applied to one customer row. Pure: no database and no SMS.
 */
export function nextSmsConsent(
  state: SmsConsentState,
  content: string | null | undefined,
  now: string,
  campaignId: string | null,
): SmsConsentStep {
  const unchanged: SmsConsentStep = {
    state,
    persist: false,
    optOut: false,
    sendConfirmation: false,
    optOutReview: false,
    smsResubscribed: false,
    suppressAi: false,
  };

  if (isExactResubscribe(content)) {
    const blocked = state.marketing_status === "opted_out" || Boolean(state.opted_out_method);
    if (!blocked) return unchanged;
    // Previous status when it would not itself block the next text, otherwise
    // subscribed. START/UNSTOP must leave marketing_status non-blocking.
    return {
      state: restoreSmsStop(state),
      persist: true,
      optOut: false,
      sendConfirmation: false,
      optOutReview: false,
      smsResubscribed: true,
      suppressAi: false,
    };
  }

  const classified = classifySmsOptOut(content);
  if (classified.optOut) {
    if (optedOutAnotherWay(state)) {
      return {
        ...unchanged,
        optOut: true,
        sendConfirmation: true,
        suppressAi: true,
      };
    }
    return {
      state: applySmsStop(state, now, campaignId),
      persist: true,
      optOut: true,
      sendConfirmation: true,
      optOutReview: false,
      smsResubscribed: false,
      suppressAi: true,
    };
  }

  if (classified.needsReview) {
    return { ...unchanged, optOutReview: true };
  }

  return unchanged;
}

/**
 * The amber "they may want to cancel an appointment" tag stays up until a
 * later START/UNSTOP in the same thread actually resubscribes them.
 */
export function cancelOptOutTagVisible(
  messages: Array<{ content: string; smsResubscribed?: boolean | null }>,
  index: number,
): boolean {
  const message = messages[index];
  if (!message || !isExactCancelOrEnd(message.content)) return false;
  return !messages.slice(index + 1).some((later) => later.smsResubscribed === true);
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
/**
 * One HELP reply. No marketing. GSM-7 basic, one segment.
 */
export function renderHelpReply(
  businessName: string | null | undefined,
  businessPhone: string | null | undefined,
): string {
  const name = usableName(businessName);
  const phone = usablePhone(businessPhone);
  const text = phone
    ? `${name}: For help call ${phone}. Reply STOP to unsubscribe.`
    : `${name}: Reply STOP to unsubscribe. Reply START to resubscribe.`;
  return truncateWithAsciiEllipsis(text, GSM_7_SINGLE_SEGMENT);
}

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
