import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSms } from "../../../src/lib/smsSegments.ts";
import {
  GSM_7_BASIC,
  GSM_7_SINGLE_SEGMENT,
  classifySmsOptOut,
  optOutReplyAddress,
  renderOptOutConfirmation,
} from "./sms-opt-out.ts";

/**
 * Same GSM 03.38 basic set as src/lib/smsSegments.ts. Duplicated here so a
 * helper that quietly widens its own alphabet cannot grade its own homework.
 */
const APP_GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

test("GSM-7 basic set matches the app segment counter", () => {
  assert.equal(GSM_7_BASIC, APP_GSM_BASIC);
});

const cases: Array<{ text: string; optOut: boolean; needsReview: boolean }> = [
  { text: "STOP", optOut: true, needsReview: false },
  { text: "stop.", optOut: true, needsReview: false },
  { text: " Stop ", optOut: true, needsReview: false },
  { text: "STOPALL", optOut: true, needsReview: false },
  { text: "Cancel", optOut: true, needsReview: false },
  { text: "END!", optOut: true, needsReview: false },
  { text: "Stop texting me", optOut: true, needsReview: false },
  { text: "please don't text me anymore", optOut: true, needsReview: false },
  { text: "remove me from this list", optOut: true, needsReview: false },
  { text: "Cancel my Friday cleaning", optOut: false, needsReview: true },
  { text: "End time is 3?", optOut: false, needsReview: true },
  { text: "what time do you stop", optOut: false, needsReview: true },
  { text: "can you stop by at 2", optOut: false, needsReview: true },
  { text: "quit job early", optOut: false, needsReview: true },
];

test("opt-out classification", () => {
  for (const entry of cases) {
    const result = classifySmsOptOut(entry.text);
    assert.equal(result.optOut, entry.optOut, entry.text);
    assert.equal(result.needsReview, entry.needsReview, entry.text);
  }
});

test("other exact keywords and clear phrases opt out", () => {
  for (const text of [
    "UNSUBSCRIBE",
    "quit",
    "revoke",
    "OPTOUT",
    "opt-out",
    "stop all",
    "stop messaging please",
    "unsubscribe me",
    "dont text",
    "do not text me",
    "please take me off your list",
    "Please don\u2019t text me",
  ]) {
    const result = classifySmsOptOut(text);
    assert.equal(result.optOut, true, text);
    assert.equal(result.needsReview, false, text);
  }
});

test("a keyword that is not the whole message is flagged, not an opt-out", () => {
  for (const text of ["please stop", "stop please", "Cancel my Friday cleaning"]) {
    const result = classifySmsOptOut(text);
    assert.equal(result.optOut, false, text);
    assert.equal(result.needsReview, true, text);
  }
});

test("ordinary sentences that merely contain a keyword stem are not flagged", () => {
  for (const text of ["See you Friday", "weekend plans", "nonstop service", "cancellation policy"]) {
    assert.deepEqual(classifySmsOptOut(text), {
      optOut: false,
      needsReview: false,
      matched: null,
    });
  }
});

test("confirmation replies to the inbound number and does not invent one", () => {
  assert.equal(optOutReplyAddress("+1 (813) 555-1234"), "+18135551234");
  assert.equal(optOutReplyAddress("+15550100000"), "+15550100000");
  assert.equal(optOutReplyAddress("00000000000"), null);
  assert.equal(optOutReplyAddress(""), null);
  assert.equal(optOutReplyAddress(null), null);
});

test("blank messages are not opt-outs", () => {
  assert.equal(classifySmsOptOut("").optOut, false);
  assert.equal(classifySmsOptOut("   ").needsReview, false);
  assert.equal(classifySmsOptOut(null).optOut, false);
  assert.equal(classifySmsOptOut(undefined).needsReview, false);
});

function assertGsm7BasicConfirmation(rendered: string): void {
  assert.equal(rendered.includes("\u2026"), false, "unicode ellipsis");
  assert.equal(rendered.includes("\u2019"), false, "curly apostrophe");
  assert.ok(rendered.length <= GSM_7_SINGLE_SEGMENT, `length ${rendered.length}`);
  for (const ch of rendered) {
    assert.ok(
      GSM_7_BASIC.includes(ch),
      `character ${JSON.stringify(ch)} (U+${ch.codePointAt(0)?.toString(16)}) is outside GSM-7 basic`,
    );
  }
  const info = analyzeSms(rendered);
  assert.equal(info.encoding, "GSM-7");
  assert.equal(info.culprit, null);
  assert.equal(info.segments, 1);
}

test("confirmation copy, phone sentence, and a straight apostrophe", () => {
  const withPhone = renderOptOutConfirmation("Sparkle", "(813) 555-0100");
  assert.equal(
    withPhone,
    "You're unsubscribed from Sparkle texts. To change an appointment, call (813) 555-0100. Reply START to resubscribe.",
  );
  assert.equal(withPhone[3], "\u0027");

  const noPhone = renderOptOutConfirmation("Sparkle", null);
  assert.equal(
    noPhone,
    "You're unsubscribed from Sparkle texts. Reply START to resubscribe.",
  );
  assert.equal(renderOptOutConfirmation("Sparkle", "   "), noPhone);
  assert.equal(renderOptOutConfirmation("Sparkle", "call us"), noPhone);
  assertGsm7BasicConfirmation(withPhone);
  assertGsm7BasicConfirmation(noPhone);
});

test("confirmation stays in GSM-7 basic for long, punctuated, and accented names", () => {
  const samples: Array<{ name: string; phone: string | null }> = [
    { name: "A".repeat(180), phone: "(813) 555-0100" },
    { name: "O\u2019Brien\u2019s Cleaning", phone: "813-555-0100" },
    { name: "Jos\u00e9's Caf\u00e9 \u00cdntimo \u{1F9FD}", phone: null },
    { name: "Sparkle\u2026 Home", phone: "call \u2728 555-0100" },
    { name: "Ni\u00f1o \u20AC Clean {Fast}", phone: "555-0100" },
  ];

  for (const sample of samples) {
    const rendered = renderOptOutConfirmation(sample.name, sample.phone);
    assertGsm7BasicConfirmation(rendered);
  }

  const long = renderOptOutConfirmation("A".repeat(400), "813-555-0100");
  assert.equal(long.length, GSM_7_SINGLE_SEGMENT);
  const name = long.match(/^You're unsubscribed from (.*) texts\./)?.[1] ?? "";
  assert.ok(name.endsWith("..."), name);
  assert.equal(name.includes("\u2026"), false);

  const curly = renderOptOutConfirmation("O\u2019Brien\u2019s Cleaning", null);
  assert.ok(curly.includes("O'Brien's Cleaning"));
  assert.equal(curly.includes("\u2019"), false);

  const accented = renderOptOutConfirmation("Jos\u00e9's Caf\u00e9 \u00cdntimo \u{1F9FD}", null);
  assert.match(accented, /Intimo/);
  assert.equal(accented.includes("\u00CD"), false);
  assert.equal(accented.includes("\u{1F9FD}"), false);
  assert.ok(accented.includes("Caf\u00e9"));

  const ellipsisName = renderOptOutConfirmation("Sparkle\u2026 Home", null);
  assert.ok(ellipsisName.includes("Sparkle... Home"));
  assert.equal(ellipsisName.includes("\u2026"), false);

  assert.equal(
    renderOptOutConfirmation("\u{1F9FD}", null),
    "You're unsubscribed from our team texts. Reply START to resubscribe.",
  );
});
