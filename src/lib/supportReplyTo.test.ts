// Public TidyWise support mail is support@jointidywise.com.
// Platform emails that invite a support reply set reply_to to that inbox
// and leave the Resend From address alone. The owner login stays put.
//
//   node --experimental-strip-types --test src/lib/supportReplyTo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLATFORM_OWNER_EMAIL } from "./platformOwner.ts";
import { SUPPORT_EMAIL } from "./supportEmail.ts";

const SUPPORT = "support@jointidywise.com";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("public support inbox is support@jointidywise.com and is not the owner login", () => {
  assert.equal(SUPPORT_EMAIL, SUPPORT);
  assert.equal(PLATFORM_OWNER_EMAIL, "support@tidywisecleaning.com");
  assert.notEqual(PLATFORM_OWNER_EMAIL, SUPPORT_EMAIL);
});

test("billing mail keeps its from domain and replies to the support inbox", () => {
  for (const path of [
    "../../supabase/functions/send-subscription-receipt/index.ts",
    "../../supabase/functions/send-subscription-renewal-reminder/index.ts",
  ]) {
    const text = source(path);
    assert.match(text, /from: "TidyWise <billing@jointidywise\.com>"/);
    assert.match(text, /reply_to: SUPPORT_EMAIL/);
    assert.equal(text.includes("support@tidywisecleaning.com"), false);
  }
});

test("welcome mail replies to the support sender without changing from", () => {
  const text = source("../../supabase/functions/send-welcome-email/index.ts");
  assert.match(text, /from: `\$\{companyName\} <\$\{senderEmail\}>`/);
  assert.match(text, /reply_to: senderEmail/);
  assert.match(text, /tidywiseSupportEmail\(\)/);
});

test("payout help mail names the support inbox as reply-to", () => {
  for (const path of [
    "../../supabase/functions/stripe-connect-webhook/index.ts",
    "../../supabase/functions/check-stripe-requirements/index.ts",
  ]) {
    const text = source(path);
    assert.match(text, /reply_to: tidywiseSupportEmail\(\)/);
    assert.match(text, /mailto:\$\{tidywiseSupportEmail\(\)\}/);
  }
});

test("public contact surfaces name the support inbox", () => {
  const footer = source("../components/SiteFooter.tsx");
  assert.match(footer, /mailto:\$\{SUPPORT_EMAIL\}/);
  assert.match(source("../../public/llms.txt"), new RegExp(SUPPORT));
  assert.match(source("../../public/pricing.md"), new RegExp(SUPPORT));
  const authFooter = source("../../supabase/functions/_shared/email-templates/_footer.tsx");
  const emailChange = source("../../supabase/functions/_shared/email-templates/email-change.tsx");
  assert.match(authFooter, /TIDYWISE_SUPPORT_EMAIL/);
  assert.match(emailChange, /TIDYWISE_SUPPORT_EMAIL/);
});
