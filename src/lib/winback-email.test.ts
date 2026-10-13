// Winback copy and the Gmail footer.
//
//   node --experimental-strip-types --test src/lib/winback-email.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WINBACK_MAILING_ADDRESS,
  buildWinbackEmail,
  winbackMailingAddressText,
  winbackPageUnsubscribeUrl,
  type WinbackSegment,
} from "../../supabase/functions/_shared/winback-email.ts";
import {
  listUnsubscribeHeaders,
  oneClickUnsubscribeUrl,
  unsubscribeTokenFromParts,
} from "../../supabase/functions/_shared/unsubscribe-links.ts";

const PAGE = "https://jointidywise.com/unsubscribe?token=abc123";
const ZWJ = "\u200D";

function recipient(segment: WinbackSegment, isLifetime: boolean) {
  return {
    first_name: "Sam",
    business_name: "Sample Cleaning Co",
    segment,
    is_lifetime: isLifetime,
  };
}

test("the visible link is the word Unsubscribe on the short app URL", () => {
  const { text, html } = buildWinbackEmail(recipient("S1_no_onboarding", false), 1, PAGE);
  assert.equal(html.split(PAGE).length - 1, 1);
  assert.ok(html.includes(`<a href="${PAGE}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>`));
  assert.equal(html.includes(">https://"), false);
  assert.equal(html.includes("supabase.co"), false);
  assert.ok(text.includes(`Unsubscribe: ${PAGE}`));
  assert.equal(winbackPageUnsubscribeUrl("abc 123"), "https://jointidywise.com/unsubscribe?token=abc%20123");
});

test("the postal address is gray text with zero-width joiners, not a link", () => {
  const { text, html } = buildWinbackEmail(recipient("S5_cancelled_paid", false), 1, PAGE);
  const address = winbackMailingAddressText();
  assert.equal(address.replaceAll(ZWJ, ""), WINBACK_MAILING_ADDRESS);
  assert.match(address, new RegExp(`65${ZWJ} SW 12th Ave`));
  assert.match(address, new RegExp(`FL${ZWJ} 33442`));
  assert.match(text, new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /<span style="color:#6b7280;text-decoration:none">/);
  assert.match(html, new RegExp(`65${ZWJ} SW 12th Ave`));
  assert.doesNotMatch(html, /<a[^>]*>[^<]*33442/);
  assert.match(html, /format-detection" content="address=no"/);
});

test("one-click headers point at the function, not the app page", () => {
  const url = oneClickUnsubscribeUrl("https://slwfkaqczvwvvvavkgpr.supabase.co/", "tok");
  assert.equal(
    url,
    "https://slwfkaqczvwvvvavkgpr.supabase.co/functions/v1/handle-email-unsubscribe?token=tok",
  );
  assert.deepEqual(listUnsubscribeHeaders(url), {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  assert.equal(
    unsubscribeTokenFromParts("from-query", "application/x-www-form-urlencoded", { token: "ignored" }),
    "from-query",
  );
  assert.equal(
    unsubscribeTokenFromParts("from-query", "application/json", { token: " from-body " }),
    "from-body",
  );
  assert.equal(unsubscribeTokenFromParts("from-query", "application/json", {}), "from-query");
});

test("S1 lifetime does not claim the spot is already paid for", () => {
  for (const step of [1, 2] as const) {
    const email = buildWinbackEmail(recipient("S1_no_onboarding", true), step, PAGE);
    assert.doesNotMatch(email.text, /already paid/i, `step ${step}`);
    assert.doesNotMatch(email.text, /14-day trial/);
    assert.doesNotMatch(email.text, /\$49/);
    assert.match(email.text, /lifetime spot/);
    assert.match(email.text, /nothing to buy/);
    assert.match(email.text, /15-minute call/);
  }
  const plain = buildWinbackEmail(recipient("S1_no_onboarding", false), 1, PAGE);
  assert.match(plain.text, /14-day trial, no card needed/);
  assert.doesNotMatch(plain.text, /lifetime/i);
  assert.doesNotMatch(plain.text, /paid for/i);
});

test("every lifetime variant stays accurate for that segment", () => {
  const s2 = buildWinbackEmail(recipient("S2_no_bookings", true), 1, PAGE);
  assert.match(s2.text, /You bought a lifetime spot/);
  assert.match(s2.text, /You've already paid, so this isn't a sales email/);
  assert.match(s2.text, /set up Sample Cleaning Co/);
  assert.doesNotMatch(s2.text, /14-day trial/);
  assert.doesNotMatch(s2.text, /\$49/);
  const s2follow = buildWinbackEmail(recipient("S2_no_bookings", true), 2, PAGE);
  assert.match(s2follow.text, /Reply "set me up"/);
  assert.doesNotMatch(s2follow.text, /14-day trial/);

  const s3 = buildWinbackEmail(recipient("S3_went_quiet", true), 1, PAGE);
  assert.match(s3.text, /You already own a lifetime spot, so there's nothing to buy/);
  assert.match(s3.text, /for free/);
  assert.doesNotMatch(s3.text, /already paid/i);
  assert.doesNotMatch(s3.text, /free month/);
  const s3plain = buildWinbackEmail(recipient("S3_went_quiet", false), 1, PAGE);
  assert.match(s3plain.text, /a free month/);
  assert.doesNotMatch(s3plain.text, /lifetime/i);

  const s2plain = buildWinbackEmail(recipient("S2_no_bookings", false), 1, PAGE);
  assert.match(s2plain.text, /14-day trial/);
  assert.doesNotMatch(s2plain.text, /lifetime/i);
  assert.doesNotMatch(s2plain.text, /already paid/i);

  // S4 and S5 are not lifetime segments. The audience query excludes them,
  // and the copy stays the trial / cancelled-plan offer.
  const s4 = buildWinbackEmail(recipient("S4_trial_no_pay", true), 1, PAGE);
  assert.match(s4.text, /you didn't pay/);
  assert.match(s4.text, /14-day trial/);
  assert.doesNotMatch(s4.text, /lifetime/i);
  const s5 = buildWinbackEmail(recipient("S5_cancelled_paid", true), 2, PAGE);
  assert.match(s5.text, /\$49\/mo/);
  assert.doesNotMatch(s5.text, /lifetime/i);
});

test("the sender wires the page link and the one-click headers", () => {
  const source = readFileSync(
    new URL("../../supabase/functions/send-winback-campaign/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /winbackPageUnsubscribeUrl\(token\)/);
  assert.match(source, /oneClickUnsubscribeUrl\(supabaseUrl, token\)/);
  assert.match(source, /listUnsubscribeHeaders\(oneClickUrl\)/);
  assert.doesNotMatch(source, /Unsubscribe in one click: \$\{/);
  assert.doesNotMatch(source, /functions\/v1\/handle-email-unsubscribe\?token=\$\{/);
});
