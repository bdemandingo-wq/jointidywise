import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * check-subscription must never 504 when Stripe is slow.
 *
 * Rule (2026-10-14): every stripe.customers.list / stripe.subscriptions.list
 * call races an 8-second deadline. If Stripe loses the race the function still
 * answers 200 with subscribed:false and error:"stripe_timeout". A gateway 504
 * gives src/hooks/useAuth.tsx fetchSubscription() no body to read, so the
 * difference between "Stripe timed out" and "the platform died" used to be
 * invisible to the app.
 *
 * These assertions read the deployed source, the same way tests/security.spec.ts
 * does — the helper cannot be imported directly because index.ts calls serve()
 * at module load and pulls in the Stripe SDK.
 *
 * The helper's runtime behaviour was verified separately by executing the
 * extracted code under deno: a fast call passes its value through, a call that
 * misses the deadline rejects with StripeTimeoutError naming the label, a
 * genuine failure before the deadline keeps its own message, and a rejection
 * that arrives after the deadline raises no unhandled rejection.
 */

const SRC = readFileSync(
  join(process.cwd(), "supabase/functions/check-subscription/index.ts"),
  "utf8",
);

test.describe("check-subscription — Stripe timeout guard", () => {
  test("the deadline is 8 seconds", () => {
    expect(SRC).toMatch(/const STRIPE_TIMEOUT_MS = 8000;/);
  });

  test("both Stripe calls are wrapped in the deadline", () => {
    expect(SRC).toMatch(
      /await withTimeout<Stripe\.List<Stripe\.Customer>>\(\s*stripe\.customers\.list\(\{ email: user\.email, limit: 1 \}\),\s*STRIPE_TIMEOUT_MS,\s*"stripe\.customers\.list"\s*\)/,
    );
    expect(SRC).toMatch(
      /await withTimeout<Stripe\.List<Stripe\.Subscription>>\(\s*stripe\.subscriptions\.list\(\{\s*customer: customerId,\s*limit: 10,\s*\}\),\s*STRIPE_TIMEOUT_MS,\s*"stripe\.subscriptions\.list"\s*\)/,
    );
  });

  test("a lost race answers 200 with subscribed:false and a machine-readable reason", () => {
    const start = SRC.indexOf("if (error instanceof StripeTimeoutError) {");
    expect(start, "timeout branch missing from the catch block").toBeGreaterThan(-1);
    const end = SRC.indexOf("\n    }", start);
    expect(end).toBeGreaterThan(start);
    const branch = SRC.slice(start, end);

    expect(branch).toContain("subscribed: false");
    expect(branch).toContain('error: "stripe_timeout"');
    expect(branch).toContain("trial_active: false");
    expect(branch).toContain("status: 200");
    expect(branch).not.toContain("status: 500");
    expect(SRC).not.toMatch(/status: 504/);
  });

  test("a Stripe call that fails after the deadline cannot surface as an unhandled rejection", () => {
    expect(SRC).toMatch(/call\.catch\(\(\) => \{\}\)/);
  });
});
