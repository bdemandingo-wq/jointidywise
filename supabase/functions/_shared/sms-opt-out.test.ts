import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeSms } from "../../../src/lib/smsSegments.ts";
import {
  GSM_7_BASIC,
  GSM_7_SINGLE_SEGMENT,
  cancelOptOutTagVisible,
  classifySmsOptOut,
  isExactResubscribe,
  nextSmsConsent,
  optOutReplyAddress,
  renderOptOutConfirmation,
  type SmsConsentState,
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
  { text: "quit job early", optOut: true, needsReview: false },
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

test("short STOP-family messages opt out; CANCEL and END stay whole-message only", () => {
  for (const text of [
    "please stop",
    "stop please",
    "STOP STOP",
    "stop now",
    "stop it",
    "please unsubscribe",
    "stop sending me texts",
    "stop contacting me",
    "quit texting me",
    "stop receiving these",
    "unsubscribe messaging",
  ]) {
    const result = classifySmsOptOut(text);
    assert.equal(result.optOut, true, text);
    assert.equal(result.needsReview, false, text);
  }
  for (const text of ["please cancel", "please end", "end now", "Cancel my Friday cleaning"]) {
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

function activeCustomer(): SmsConsentState {
  return {
    marketing_status: "active",
    opted_out_at: null,
    opted_out_method: null,
    opted_out_campaign_id: null,
    marketing_status_before_sms_stop: null,
  };
}

test("START and UNSTOP match the whole message only", () => {
  for (const text of ["START", "start", " Start ", "START!", "UNSTOP", "unstop.", "  Unstop  "]) {
    assert.equal(isExactResubscribe(text), true, text);
    assert.equal(classifySmsOptOut(text).optOut, false, text);
  }
  for (const text of ["start my service", "please start", "UNSTOP texting", "STOP", "Cancel"]) {
    assert.equal(isExactResubscribe(text), false, text);
  }
});

test("START restores sms_stop consent and leaves a manual opt-out alone", () => {
  const smsStop: SmsConsentState = {
    marketing_status: "opted_out",
    opted_out_at: "2026-10-01T00:00:00.000Z",
    opted_out_method: "sms_stop",
    opted_out_campaign_id: "camp-1",
    marketing_status_before_sms_stop: "active",
  };
  const started = nextSmsConsent(smsStop, "START", "2026-10-02T00:00:00.000Z", null);
  assert.equal(started.smsResubscribed, true);
  assert.equal(started.sendConfirmation, false);
  assert.equal(started.persist, true);
  assert.deepEqual(started.state, activeCustomer());

  const unstopped = nextSmsConsent(smsStop, "UNSTOP!", "2026-10-02T00:00:00.000Z", null);
  assert.deepEqual(unstopped.state, activeCustomer());
  assert.equal(unstopped.sendConfirmation, false);

  const manual: SmsConsentState = {
    marketing_status: "opted_out",
    opted_out_at: "2026-09-01T00:00:00.000Z",
    opted_out_method: "manual",
    opted_out_campaign_id: null,
    marketing_status_before_sms_stop: null,
  };
  const blocked = nextSmsConsent(manual, " start ", "2026-10-02T00:00:00.000Z", null);
  assert.equal(blocked.smsResubscribed, false);
  assert.equal(blocked.optOutReview, true);
  assert.equal(blocked.persist, false);
  assert.equal(blocked.sendConfirmation, false);
  assert.deepEqual(blocked.state, manual);

  const emailOptOut: SmsConsentState = { ...manual, opted_out_method: "email" };
  assert.deepEqual(nextSmsConsent(emailOptOut, "UNSTOP", "2026-10-02T00:00:00.000Z", null).state, emailOptOut);

  const notOptedOut = nextSmsConsent(activeCustomer(), "START", "2026-10-02T00:00:00.000Z", null);
  assert.deepEqual(notOptedOut.state, activeCustomer());
  assert.equal(notOptedOut.optOutReview, false);
  assert.equal(notOptedOut.smsResubscribed, false);
  assert.equal(notOptedOut.persist, false);
});

test("START does not invent opted-in consent when the prior status was not saved", () => {
  const legacy: SmsConsentState = {
    marketing_status: "opted_out",
    opted_out_at: "2026-08-01T00:00:00.000Z",
    opted_out_method: "sms_stop",
    opted_out_campaign_id: "camp-9",
    marketing_status_before_sms_stop: null,
  };
  const step = nextSmsConsent(legacy, "START", "2026-10-02T00:00:00.000Z", null);
  assert.equal(step.state.marketing_status, "opted_out");
  assert.equal(step.state.opted_out_at, null);
  assert.equal(step.state.opted_out_method, null);
  assert.equal(step.state.opted_out_campaign_id, null);
  assert.equal(step.state.marketing_status_before_sms_stop, null);
  assert.notEqual(step.state.marketing_status, "active");
});

test("a manual opt-out is not rewritten when they text STOP", () => {
  const manual: SmsConsentState = {
    marketing_status: "opted_out",
    opted_out_at: "2026-09-01T00:00:00.000Z",
    opted_out_method: "manual",
    opted_out_campaign_id: null,
    marketing_status_before_sms_stop: null,
  };
  const step = nextSmsConsent(manual, "STOP", "2026-10-02T00:00:00.000Z", "camp-new");
  assert.equal(step.optOut, true);
  assert.equal(step.sendConfirmation, true);
  assert.equal(step.persist, false);
  assert.deepEqual(step.state, manual);
});

test("STOP, START, STOP, then one-word CANCEL keeps the saved consent", () => {
  const steps: Array<{ text: string; at: string }> = [
    { text: "STOP", at: "2026-10-01T00:00:00.000Z" },
    { text: "START", at: "2026-10-02T00:00:00.000Z" },
    { text: "STOP", at: "2026-10-03T00:00:00.000Z" },
    { text: "CANCEL", at: "2026-10-04T00:00:00.000Z" },
  ];
  let state = activeCustomer();
  const seen: SmsConsentState[] = [];
  for (const step of steps) {
    const next = nextSmsConsent(state, step.text, step.at, null);
    state = next.state;
    seen.push(state);
  }

  assert.deepEqual(seen[0], {
    marketing_status: "opted_out",
    opted_out_at: "2026-10-01T00:00:00.000Z",
    opted_out_method: "sms_stop",
    opted_out_campaign_id: null,
    marketing_status_before_sms_stop: "active",
  });
  assert.deepEqual(seen[1], activeCustomer());
  assert.deepEqual(seen[2], {
    marketing_status: "opted_out",
    opted_out_at: "2026-10-03T00:00:00.000Z",
    opted_out_method: "sms_stop",
    opted_out_campaign_id: null,
    marketing_status_before_sms_stop: "active",
  });
  assert.deepEqual(seen[3], {
    marketing_status: "opted_out",
    opted_out_at: "2026-10-04T00:00:00.000Z",
    opted_out_method: "sms_stop",
    opted_out_campaign_id: null,
    marketing_status_before_sms_stop: "active",
  });
  assert.equal(seen[3].marketing_status, "opted_out");
  assert.notEqual(seen[3].marketing_status_before_sms_stop, "opted_out");
});

test("short STOP phrases persist an opt-out and ask for a confirmation only with the save", () => {
  const step = nextSmsConsent(activeCustomer(), "please stop", "2026-10-05T00:00:00.000Z", null);
  assert.equal(step.optOut, true);
  assert.equal(step.persist, true);
  assert.equal(step.sendConfirmation, true);
  assert.equal(step.state.marketing_status, "opted_out");
  assert.equal(step.state.opted_out_method, "sms_stop");
  assert.equal(step.state.marketing_status_before_sms_stop, "active");

  const sending = nextSmsConsent(activeCustomer(), "stop sending me texts", "2026-10-05T00:00:00.000Z", null);
  assert.equal(sending.optOut, true);
  assert.equal(sending.persist, true);
  assert.equal(sending.state.marketing_status_before_sms_stop, "active");

  const manual = nextSmsConsent(
    {
      marketing_status: "opted_out",
      opted_out_at: "2026-09-01T00:00:00.000Z",
      opted_out_method: "manual",
      opted_out_campaign_id: null,
      marketing_status_before_sms_stop: null,
    },
    "please stop",
    "2026-10-05T00:00:00.000Z",
    null,
  );
  assert.equal(manual.persist, false);
  assert.equal(manual.sendConfirmation, true);
  assert.equal(manual.state.opted_out_method, "manual");
});

test("appointment tag hides after a later resubscribe and returns on the next CANCEL", () => {
  const thread = [
    { content: "CANCEL", smsResubscribed: false },
    { content: "START", smsResubscribed: true },
    { content: "END!", smsResubscribed: false },
  ];
  assert.equal(cancelOptOutTagVisible(thread, 0), false);
  assert.equal(cancelOptOutTagVisible(thread, 2), true);
  assert.equal(cancelOptOutTagVisible([{ content: "END" }], 0), true);
  assert.equal(cancelOptOutTagVisible([{ content: "Cancel my Friday cleaning" }], 0), false);
});

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
