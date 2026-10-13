// Copy and markup for the churned-owner winback. Plain data in, strings
// out, so the lifetime lines and the Gmail footer can be checked without
// sending mail.
import { unsubscribePageUrl } from "./unsubscribe-links.ts";

export const WINBACK_SEGMENTS = [
  "S5_cancelled_paid",
  "S3_went_quiet",
  "S4_trial_no_pay",
  "S1_no_onboarding",
  "S2_no_bookings",
] as const;

export type WinbackSegment = (typeof WINBACK_SEGMENTS)[number];

export type WinbackEmailRecipient = {
  first_name: string;
  business_name: string;
  segment: WinbackSegment;
  is_lifetime: boolean;
};

const SUBJECTS: Record<WinbackSegment, string> = {
  S5_cancelled_paid: "why did you cancel?",
  S3_went_quiet: "did something break?",
  S4_trial_no_pay: "your trial ended. fair enough.",
  S2_no_bookings: "you set it up but never booked a job",
  S1_no_onboarding: "you didn't finish setting up TidyWise",
};

const SIGNATURE = "Emmanuel, founder of TidyWise";

// CAN-SPAM postal address. Apt 110 is on the shared platform footer; this
// campaign's approved line does not include it.
export const WINBACK_MAILING_ADDRESS = "TidyWise, 65 SW 12th Ave, Deerfield Beach, FL 33442";

// Gmail autolinks "65 SW 12th Ave, Deerfield Beach, FL 33442" in both the
// HTML and the text part. A zero-width joiner is invisible and breaks the
// street/ZIP pattern the autolinker matches.
const ZWJ = "\u200D";

export function winbackMailingAddressText(): string {
  return `TidyWise, 65${ZWJ} SW 12th Ave, Deerfield Beach, FL${ZWJ} 33442`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mailingAddressHtml(): string {
  return `<span style="color:#6b7280;text-decoration:none">${escapeHtml(winbackMailingAddressText())}</span>`;
}

function footerText(unsubscribeUrl: string): string {
  return [
    "--",
    "You're getting this because you signed up for TidyWise at jointidywise.com.",
    `Don't want these? Unsubscribe: ${unsubscribeUrl}`,
    winbackMailingAddressText(),
  ].join("\n");
}

function footerHtml(unsubscribeUrl: string): string {
  return [
    "--",
    "You're getting this because you signed up for TidyWise at jointidywise.com.",
    `Don't want these? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>`,
    mailingAddressHtml(),
  ].join("\n");
}

function offerLine(segment: WinbackSegment, isLifetime: boolean): string {
  switch (segment) {
    case "S5_cancelled_paid":
      // Audience SQL excludes lifetime (NOT is_lifetime). This is a cancelled
      // monthly plan, so the offer is a free month back on a monthly price.
      return "The offer: if you come back, your first month is on me. Basic is $49/mo, Pro is $97/mo (unlimited users, no per-booking fees), cancel anytime.";
    case "S3_went_quiet":
      return isLifetime
        ? "You already own a lifetime spot, so there's nothing to buy. Reply and I'll get you set back up myself, for free."
        : "The offer: a free month, plus a 15-minute call where I fix whatever got in your way.";
    case "S4_trial_no_pay":
      // Audience SQL excludes lifetime. They finished a trial and did not pay.
      return "The offer: a fresh 30-day trial, no card needed. If you keep going after that, Basic is $49/mo and Pro is $97/mo with unlimited users and no per-booking fees. Cancel anytime.";
    case "S2_no_bookings":
      return isLifetime
        ? "Reply \"set me up\" and I'll import your clients and set up your booking form."
        : "The offer: a fresh 30-day trial, no card needed, and I'll import your clients for you. Reply \"set me up\" and send me your list.";
    case "S1_no_onboarding":
      // They stopped during setup. Lifetime means they have a spot
      // (purchased or grandfathered), not that this email can say they paid.
      // "Already paid for" is the finished-setup story in S2.
      return isLifetime
        ? "The offer: reply and I'll do the setup with you on a 15-minute call, or do it for you. You already have a lifetime spot, so there's nothing to buy."
        : "The offer: reply and I'll do the setup with you on a 15-minute call, or do it for you. A fresh 30-day trial, no card needed.";
  }
}

function step1Body(recipient: WinbackEmailRecipient): string {
  const name = recipient.first_name;
  const business = recipient.business_name;
  switch (recipient.segment) {
    case "S5_cancelled_paid":
      return [
        `Hi ${name},`,
        "",
        "I'm Emmanuel, I built TidyWise. You paid for it, then cancelled. I'd like to know why, even if the answer stings.",
        "",
        "Reply to this email and tell me what happened. A sentence is enough. I read every reply.",
        "",
        offerLine(recipient.segment, recipient.is_lifetime),
        "If you'd rather talk, just reply and I'll call you.",
      ].join("\n");
    case "S3_went_quiet":
      return [
        `Hi ${name},`,
        "",
        `${business} was booking jobs in TidyWise, then it stopped about a month ago. Either something broke, something was missing, or you went back to another tool. I want to know which.`,
        "",
        "Reply to this email and tell me which.",
        "",
        offerLine(recipient.segment, recipient.is_lifetime),
        "",
        "Or just reply with what went wrong.",
      ].join("\n");
    case "S4_trial_no_pay":
      return [
        `Hi ${name},`,
        "",
        "Your TidyWise trial ended and you didn't pay. That means it didn't earn it. I'd like to know what was missing.",
        "",
        "Reply to this email and tell me what was missing. A sentence is enough. I read them all.",
        "",
        offerLine(recipient.segment, recipient.is_lifetime),
      ].join("\n");
    case "S2_no_bookings":
      return recipient.is_lifetime
        ? [
            `Hi ${name},`,
            "",
            `You bought a lifetime spot in TidyWise and set up ${business}, but you never booked a job in it. You've already paid, so this isn't a sales email. You're just not getting what you paid for yet.`,
            "",
            "Come back and finish setting it up. I'll help: send me your client list (spreadsheet, screenshot, or an export from your old tool) and I'll import it and set up your booking form myself. Just reply \"set me up\".",
            "",
            "And tell me what stopped you. Reply to this email.",
          ].join("\n")
        : [
            `Hi ${name},`,
            "",
            `You set up ${business} in TidyWise but never booked a job in it. Something stopped you, and I want to know what.`,
            "",
            "Reply to this email and tell me what stopped you.",
            "",
            offerLine(recipient.segment, false),
          ].join("\n");
    case "S1_no_onboarding":
      return [
        `Hi ${name},`,
        "",
        "You signed up for TidyWise and stopped partway through setup. That usually means setup was too long or confusing. That's my fault.",
        "",
        "What happened? Reply to this email and tell me. A sentence is enough.",
        "",
        offerLine(recipient.segment, recipient.is_lifetime),
      ].join("\n");
  }
}

function step2Body(recipient: WinbackEmailRecipient): string {
  return [
    `Hi ${recipient.first_name},`,
    "",
    "Last nudge from me. Even a one-word reply helps: PRICE, FEATURE, SWITCHED, SETUP, or PAUSED.",
    "",
    offerLine(recipient.segment, recipient.is_lifetime),
    "",
    "If TidyWise isn't for you, that's fine. I won't keep emailing.",
  ].join("\n");
}

export function buildWinbackEmail(
  recipient: WinbackEmailRecipient,
  step: 1 | 2,
  unsubscribeUrl: string,
): { subject: string; text: string; html: string } {
  const subject = step === 1
    ? SUBJECTS[recipient.segment]
    : `re: ${SUBJECTS[recipient.segment]}`;
  const body = step === 1 ? step1Body(recipient) : step2Body(recipient);
  const text = [body, "", SIGNATURE, footerText(unsubscribeUrl)].join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="format-detection" content="address=no"></head><body><div style="font-family:ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap;color:#111827;font-size:15px;line-height:1.5">${escapeHtml(body)}\n\n${escapeHtml(SIGNATURE)}\n${footerHtml(unsubscribeUrl)}</div></body></html>`;
  return { subject, text, html };
}

export function winbackPageUnsubscribeUrl(token: string): string {
  return unsubscribePageUrl(token);
}
