// Which sender identity should an email use, and did it fall back?
//
// Runner: node:test, which runs here (Node v24 strips TypeScript natively and the
// module under test is import-free by design):
//
//   node --experimental-strip-types --test src/lib/emailSenderResolution.test.ts
//
// WHY A PURE MODULE. The bug this fixes is a set of untested branches welded to
// `fetch` and `createClient`: exactly one org of 30 ever received a payroll report
// and the other 29 failed three different ways, none of which any test could
// reach. Pulling the DECISION out of the I/O makes every branch addressable.
// See docs/superpowers/plans/2026-08-13-owner-email-platform-fallback.md
//
// The rule the whole file encodes: an internal report to an owner about their own
// business must not depend on that org having configured a customer-facing sender
// — but a customer-facing email must still fail closed, because silently sending a
// business's customer mail from TidyWise's address is worse than not sending.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_SENDER_EMAIL,
  PLATFORM_SENDER_FROM,
  resolveSender,
  type FallbackReason,
} from "../../supabase/functions/_shared/email-sender-resolution.ts";
import { TIDYWISE_SUPPORT_EMAIL } from "../../supabase/functions/_shared/email-footer.ts";
import { SUPPORT_EMAIL } from "./supportEmail.ts";

const PLATFORM_FROM = PLATFORM_SENDER_FROM;

test("the platform sender stays on the verified jointidywise.com domain", () => {
  assert.equal(PLATFORM_SENDER_EMAIL, "noreply@jointidywise.com");
  assert.equal(PLATFORM_SENDER_FROM, "TidyWise <noreply@jointidywise.com>");
});

test("public support inbox is one address on the verified domain", () => {
  assert.equal(SUPPORT_EMAIL, "support@jointidywise.com");
  assert.equal(TIDYWISE_SUPPORT_EMAIL, SUPPORT_EMAIL);
});

const ORG_OK = {
  from_name: "Clean Collective",
  from_email: "hello@cleancollective.com",
  resend_api_key: "re_org_key_123",
};

/** Owner-facing internal report: the case this work exists for. */
const owner = (over: Record<string, unknown> = {}) => ({
  settings: ORG_OK,
  platformFrom: PLATFORM_FROM,
  platformKeyPresent: true,
  allowPlatformFallback: true,
  ...over,
});

/** Customer-facing mail: behaviour must be unchanged by this work. */
const customer = (over: Record<string, unknown> = {}) =>
  owner({ allowPlatformFallback: false, ...over });

// ─── the happy path must not regress ────────────────────────────────────────
// Exactly one org (TIDYWISE) currently works. Whatever else changes, that org
// must keep sending from its own identity rather than being swept onto the
// platform sender.

test("a fully configured org keeps its own identity and its own key", () => {
  const r = resolveSender(owner());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sender.from, "Clean Collective <hello@cleancollective.com>");
  assert.equal(r.sender.keySource, "org");
  assert.equal(r.sender.usedFallback, false);
  assert.equal(r.sender.fallbackReason, null);
});

test("an org with no key of its own keeps its identity but borrows the platform key", () => {
  // Pre-existing behaviour at send-org-email.ts:163 — preserved deliberately.
  // Borrowing the key is not a fallback: the sender the recipient sees is
  // unchanged, so nothing is masked and nothing should be logged as degraded.
  const r = resolveSender(owner({ settings: { ...ORG_OK, resend_api_key: null } }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sender.from, "Clean Collective <hello@cleancollective.com>");
  assert.equal(r.sender.keySource, "platform");
  assert.equal(r.sender.usedFallback, false);
});

// ─── bucket 1: no settings row at all (22 orgs) ─────────────────────────────

test("owner-facing: a missing settings row falls back to the platform sender", () => {
  const r = resolveSender(owner({ settings: null }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sender.from, PLATFORM_FROM);
  assert.equal(r.sender.keySource, "platform");
  assert.equal(r.sender.usedFallback, true);
  assert.equal(r.sender.fallbackReason, "org_settings_missing" satisfies FallbackReason);
});

test("customer-facing: a missing settings row is still an error, not a fallback", () => {
  // The deliberate asymmetry. Falling back here would mean a business's customer
  // mail silently going out from TidyWise's address.
  const r = resolveSender(customer({ settings: null }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /settings/i);
});

test("owner-facing: a row missing from_email falls back, and says which reason", () => {
  // get-org-email-settings.ts:58-63 treats a row without from_name/from_email as
  // unusable. That is a different cause from "no row" and must stay
  // distinguishable in the log.
  const r = resolveSender(
    owner({ settings: { from_name: "Clean Collective", from_email: "", resend_api_key: null } }),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sender.usedFallback, true);
  assert.equal(r.sender.fallbackReason, "org_settings_incomplete" satisfies FallbackReason);
});

// ─── buckets 2 and 3: the org identity exists but does not work ─────────────

test("owner-facing: after the org identity fails, the retry uses the platform sender", () => {
  // Covers BOTH remaining buckets — 7 orgs with an invalid Resend key and 1 with
  // an unverified gmail.com domain. The domain case is why a platform KEY alone is
  // not enough: Resend rejects an unverified from-address whichever key sent it,
  // so the retry has to change the FROM too.
  const r = resolveSender(owner({ priorFailure: "The gmail.com domain is not verified" }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sender.from, PLATFORM_FROM, "retry must change the from, not just the key");
  assert.equal(r.sender.keySource, "platform");
  assert.equal(r.sender.usedFallback, true);
  assert.equal(r.sender.fallbackReason, "org_send_failed" satisfies FallbackReason);
});

test("owner-facing: an invalid org key escalates to the platform key on retry", () => {
  const r = resolveSender(owner({ priorFailure: "API key is invalid" }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sender.keySource, "platform");
  assert.equal(r.sender.fallbackReason, "org_send_failed");
});

test("customer-facing: a failed org send is NOT silently retried as the platform", () => {
  const r = resolveSender(customer({ priorFailure: "API key is invalid" }));
  assert.equal(r.ok, false);
});

// ─── never pretend ──────────────────────────────────────────────────────────

test("no platform key means an error, even when fallback is allowed", () => {
  // A fallback that cannot actually send is worse than no fallback: it converts a
  // legible failure into a claim of success.
  const r = resolveSender(owner({ settings: null, platformKeyPresent: false }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /platform/i);
});

test("no platform key does not break the org's own working send", () => {
  // The platform key is irrelevant when the org has its own and it works.
  const r = resolveSender(owner({ platformKeyPresent: false }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sender.keySource, "org");
});

test("an empty platformFrom is an error, not an empty From header", () => {
  const r = resolveSender(owner({ settings: null, platformFrom: "" }));
  assert.equal(r.ok, false);
});

// ─── the logging contract: a fallback must never be silent ──────────────────

test("fallbackReason is non-null EXACTLY when usedFallback is true", () => {
  // This is the "must not silently mask a broken org identity" requirement,
  // expressed as an invariant rather than as a comment. The reason is what gets
  // written to org_email_send_failures.fell_back_to and named in the warning, so
  // a fallback with no reason would be an untraceable one.
  const cases = [
    owner(),
    owner({ settings: { ...ORG_OK, resend_api_key: null } }),
    owner({ settings: null }),
    owner({ settings: { from_name: "X", from_email: "", resend_api_key: null } }),
    owner({ priorFailure: "boom" }),
  ];
  for (const input of cases) {
    const r = resolveSender(input);
    if (!r.ok) continue;
    assert.equal(
      r.sender.fallbackReason !== null,
      r.sender.usedFallback,
      `usedFallback=${r.sender.usedFallback} but fallbackReason=${r.sender.fallbackReason}`,
    );
  }
});

test("every distinct failure cause produces a distinct reason", () => {
  // If two causes collapsed to one reason, the log could not tell a
  // never-configured org from one whose key was revoked — and those need
  // different messages to their owner.
  const reasons = [
    resolveSender(owner({ settings: null })),
    resolveSender(owner({ settings: { from_name: "X", from_email: "", resend_api_key: null } })),
    resolveSender(owner({ priorFailure: "boom" })),
  ].map((r) => (r.ok ? r.sender.fallbackReason : "error"));
  assert.equal(new Set(reasons).size, 3, `reasons collapsed: ${JSON.stringify(reasons)}`);
});

// ─── determinism ────────────────────────────────────────────────────────────

test("resolution is pure — same input, same answer, no I/O", () => {
  const input = owner({ settings: null });
  assert.deepEqual(resolveSender(input), resolveSender(input));
});

test("resolution does not mutate its input", () => {
  const input = owner({ priorFailure: "boom" });
  const snapshot = JSON.parse(JSON.stringify(input));
  resolveSender(input);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot);
});
