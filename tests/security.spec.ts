import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OWNER, STAFF, SUPABASE_URL, SUPABASE_ANON_KEY, getAccessToken } from "./fixtures";

// Verified live 2026-07-14 after Lovable redeployed commit a8fc511f: all 4
// SUSPECTED_GAPS entries below that were locked down that day now
// correctly reject an anonymous request (16/16 passed, including these 4).

const FN = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;

test.describe("13.2 — No unauthenticated edge functions", () => {
  // Confirmed-legitimate public functions (rate-limited or token/signature
  // gated by design) — excluded from the "must reject" assertion below.
  // Source: full audit of supabase/functions/, 2026-07-14.
  const KNOWN_PUBLIC = new Set([
    "check-availability", "public-booking-data", "score-lookup", "score-create", "score-claim",
    "address-autocomplete", "geocode-address", "get-driving-eta", "place-id-resolve",
    "get-lifetime-spots", "gmail-oauth-callback", "handle-email-unsubscribe",
    "confirm-deposit-payment", "confirm-tip-payment", "get-deposit-details", "get-tip-details",
    "process-deposit", "process-tip", "booking-chatbot", "sitemap", "portal-session-refresh",
    "send-staff-password-reset", "external-booking-webhook", "client-portal-login",
    // Triaged 2026-07-14 (13.2 follow-up): legitimately public by design,
    // now rate-limited rather than locked behind auth — locking either of
    // these would break a pre-session/logged-out flow (staff-email check
    // during signup; the public /delete-account page for locked-out
    // users). See the SECURITY comment at the top of each function.
    "check-email-staff", "send-deletion-request-email",
    // Aggregate counters and a state-level activity feed. Rate limited.
    // Returns no names, cities, addresses, or ids.
    "public-growth",
    // Fills a thin city leaderboard from Google Places. Rate limited.
    // Inserts only house-cleaning listings the API actually returned.
    "score-seed-house-cleaners",
  ]);

  // Found via source audit to have ZERO caller-identity check of any kind
  // (no JWT/service-role/cron-secret/webhook-signature/portal-session/
  // opaque-token gate). Each is expected to reject an anonymous request;
  // this test currently documents them as FAILING findings, not silent
  // passes — that's the correct signal until they're fixed.
  //
  // 2026-07-14 follow-up: notify-platform-admin-signup, recache-blog-post,
  // send-subscription-receipt, and weekly-blog-digest were locked down
  // (JWT, JWT+platform-admin, service-role, and cron-secret respectively —
  // see each function's SECURITY comment) and should now correctly return
  // >=400 here once Lovable redeploys them; left in this list rather than
  // moved to KNOWN_PUBLIC since the assertion itself (expect >=400) is
  // exactly what proves the fix holds, same pattern as the 8 spoofed-value
  // regression checks below.
  // `body` is a THUNK, not an object. OWNER.orgId is a lazy getter that throws
  // until the setup project has derived it, and this array is built at
  // collection time — an eager read here would fail the whole file to load.
  const SUSPECTED_GAPS: Array<{ name: string; body: () => Record<string, unknown> }> = [
    { name: "send-deposit-request", body: () => ({ bookingId: "00000000-0000-0000-0000-000000000000", organizationId: OWNER.orgId, amount: 1}) },
    { name: "send-tip-request", body: () => ({ bookingId: "00000000-0000-0000-0000-000000000000", organizationId: OWNER.orgId}) },
    { name: "send-arrival-sms", body: () => ({ bookingId: "00000000-0000-0000-0000-000000000000", staffId: "00000000-0000-0000-0000-000000000000"}) },
    { name: "notify-platform-admin-signup", body: () => ({ phone: "5555550100", signupMethod: "qa-regression"}) },
    { name: "recache-blog-post", body: () => ({ slug: "qa-regression-probe"}) },
    { name: "send-subscription-receipt", body: () => ({ email: "bdemandingo+qaprobe@gmail.com", amount_cents: 1, invoice_id: "qa-probe", hosted_invoice_url: "https://example.com"}) },
    { name: "weekly-blog-digest", body: () => ({}) },
    { name: "refresh-benchmark-snapshots", body: () => ({}) },
    { name: "send-referral-invite", body: () => ({ referralId: "00000000-0000-0000-0000-000000000000"}) },
    { name: "notify-invoice-paid", body: () => ({ invoice_id: "00000000-0000-0000-0000-000000000000"}) },
  ];

  for (const { name, body } of SUSPECTED_GAPS) {
    test(`${name}: rejects a fully unauthenticated request`, async ({ request }) => {
      const resp = await request.post(FN(name), {
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        data: body(),
        failOnStatusCode: false,
      });
      // "Reject" = anything that isn't a 2xx success. A well-formed 400
      // for a garbage/placeholder ID is fine (still means SOME validation
      // ran); a 2xx means it did privileged work for an anonymous caller.
      expect(
        resp.status(),
        `${name} returned ${resp.status()} for an anonymous caller with no auth/secret/signature — expected it to be rejected. Body: ${await resp.text().catch(() => "")}`,
      ).toBeGreaterThanOrEqual(400);
    });
  }

  test("KNOWN_PUBLIC list is documented, not silently assumed", async () => {
    // No live assertion here on purpose — these are intentionally open by
    // design (rate-limited, token-gated, or signature-verified). Listed so
    // a reviewer can see the full public surface in one place.
    expect(KNOWN_PUBLIC.size).toBeGreaterThan(0);
  });

  test.describe("Non-privileged (authenticated but insufficient) callers are also rejected", () => {
    // "Anonymous" alone doesn't fully prove the fix for functions gated on
    // something narrower than "any session" — a valid-but-wrong-tier JWT
    // needs its own check. notify-platform-admin-signup is intentionally
    // NOT included here: it only requires ANY authenticated session (it
    // derives identity from that session, there's no narrower tier to
    // bypass), so the anonymous-rejection test above already covers its
    // full auth boundary.

    test("recache-blog-post: an authenticated non-platform-admin (owner, org A) is rejected", async ({ request }) => {
      const ownerToken = await getAccessToken(request, OWNER.email, OWNER.password);
      const resp = await request.post(FN("recache-blog-post"), {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        data: { slug: "qa-regression-probe" },
        failOnStatusCode: false,
      });
      expect(resp.status(), `owner (not a platform admin) should be Forbidden, got ${resp.status()}: ${await resp.text().catch(() => "")}`).toBe(403);
    });

    test("send-subscription-receipt: a real user JWT (not service-role) is rejected", async ({ request }) => {
      const ownerToken = await getAccessToken(request, OWNER.email, OWNER.password);
      const resp = await request.post(FN("send-subscription-receipt"), {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        data: { email: "bdemandingo+qaprobe@gmail.com", amount_cents: 1, invoice_id: "qa-probe" },
        failOnStatusCode: false,
      });
      expect(resp.status(), `a real (non-service-role) user JWT should be Unauthorized, got ${resp.status()}`).toBe(401);
    });

    test("weekly-blog-digest: a real user JWT without x-cron-secret is rejected", async ({ request }) => {
      const ownerToken = await getAccessToken(request, OWNER.email, OWNER.password);
      const resp = await request.post(FN("weekly-blog-digest"), {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
        data: {},
        failOnStatusCode: false,
      });
      expect(resp.status(), `a user JWT with no x-cron-secret header should be Unauthorized, got ${resp.status()}`).toBe(401);
    });
  });

  test.describe("Intentionally-public functions stay reachable (rate-limited, not auth-gated)", () => {
    // These two are NOT expected to reject an unauthenticated caller — that
    // would be the wrong assertion for a by-design-public endpoint. What
    // matters instead: (a) they still respond and do real work (not
    // silently broken/mis-deployed), and (b) they're never treated as an
    // auth failure (401/403) for a plain anonymous call, since that would
    // mean someone accidentally locked down a flow real logged-out users
    // depend on. Rate limiting itself is verified via source guard below
    // rather than live-exhausted here — repeatedly tripping a 1/day or
    // 20/hour limit on every regression run would burn the real quota
    // meant for actual users and, for send-deletion-request-email, risks
    // spamming an org's real support inbox if it ever resolves to one.

    test("check-email-staff: reachable and returns a real is_staff boolean, not an auth rejection", async ({ request }) => {
      const resp = await request.post(FN("check-email-staff"), {
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        data: { email: "bdemandingo+qaprobe@gmail.com" },
        failOnStatusCode: false,
      });
      expect([401, 403]).not.toContain(resp.status());
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(typeof body.is_staff).toBe("boolean");

      const src = readFileSync(join(process.cwd(), "supabase/functions/check-email-staff/index.ts"), "utf8");
      expect(src).toMatch(/checkAndRecord\(supabase, "check_email_staff"/);
    });

    test("send-deletion-request-email: reachable and processes the request, not an auth rejection", async ({ request }) => {
      // A probe email with no matching org resolves to a clean 400
      // ("Could not determine organization") BEFORE any email is sent —
      // proves the function runs past its (now-absent) auth gate without
      // triggering a real send. If the per-email rate limit was already
      // tripped by an earlier run today, the generic 200 fallback is
      // returned instead — both outcomes are "reachable, not auth-gated".
      const resp = await request.post(FN("send-deletion-request-email"), {
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        data: { name: "QA-TEST-DELETE Regression Probe", email: "bdemandingo+qaprobe@gmail.com", reason: "13.2 regression probe — no matching org, no email sent" },
        failOnStatusCode: false,
      });
      expect([401, 403], `unexpected auth-style rejection: ${resp.status()} ${await resp.text().catch(() => "")}`).not.toContain(resp.status());
      expect([200, 400]).toContain(resp.status());

      const src = readFileSync(join(process.cwd(), "supabase/functions/send-deletion-request-email/index.ts"), "utf8");
      expect(src).toMatch(/checkAndRecord\(supabase, "deletion_request"/);
    });
  });
});

test.describe("13.5 — Secrets never exposed to client bundle", () => {
  test("dist/ contains no service-role keys, Stripe secret keys, or other server-only secrets", async () => {
    const distDir = join(process.cwd(), "dist", "assets");
    test.skip(!existsSync(distDir), "dist/ not built in this environment — run `npm run build` first, then re-run this test");

    const { readdirSync } = await import("node:fs");
    const jsFiles = readdirSync(distDir).filter((f) => f.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);

    // Real secret patterns only — deliberately excludes the bare
    // "sk_live_"/"sk_test_" substring, which false-positives on
    // PaymentIntegrationPage's own placeholder/validation copy for the
    // org-admin "paste your Stripe key" form field.
    const SECRET_PATTERNS: Array<[string, RegExp]> = [
      ["Supabase service role marker", /SUPABASE_SERVICE_ROLE/],
      ["service_role JWT claim", /"role"\s*:\s*"service_role"/],
      ["Stripe secret key (live)", /sk_live_[A-Za-z0-9]{20,}/],
      ["Stripe secret key (test)", /sk_test_[A-Za-z0-9]{20,}/],
      ["Resend API key", /RESEND_API_KEY/],
      ["Cron secret", /CRON_SECRET/],
      ["Portal session secret", /PORTAL_SESSION_SECRET/],
      ["Anthropic key", /sk-ant-[A-Za-z0-9-]{10,}/],
      ["OpenAI key", /sk-proj-[A-Za-z0-9-]{10,}/],
    ];

    const offenders: string[] = [];
    for (const file of jsFiles) {
      const content = readFileSync(join(distDir, file), "utf8");
      for (const [label, re] of SECRET_PATTERNS) {
        if (re.test(content)) offenders.push(`${file}: matched "${label}"`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("only expected VITE_* public env vars are referenced in the built bundle", async () => {
    // Confirms nothing beyond the known-public set sneaks into
    // import.meta.env usage — informational guard against a future
    // accidental `VITE_SOME_SECRET` addition. Source-level, not a live
    // bundle scan (Vite inlines these at build time so they're not
    // greppable as `import.meta.env.X` post-build).
    const srcDir = join(process.cwd(), "src");
    const { execSync } = await import("node:child_process");
    const grep = execSync(
      `grep -rhoE "import\\.meta\\.env\\.[A-Z_]+" "${srcDir}" | sort -u`,
      { encoding: "utf8" },
    );
    const found = new Set(grep.split("\n").filter(Boolean).map((l) => l.replace("import.meta.env.", "")));
    const EXPECTED = new Set([
      "VITE_APP_URL", "VITE_APP_VERSION", "VITE_PRICING_ENABLED",
      "VITE_SENTRY_DSN", "VITE_SENTRY_ENVIRONMENT",
      "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL",
      "VITE_TIDYWISE_META_PIXEL_ID", "VITE_TIDYWISE_GA4_ID",
      "VITE_TIDYWISE_GOOGLE_ADS_ID", "VITE_TIDYWISE_TAG_TEST_HOSTS",
      "DEV", "PROD",
    ]);
    const unexpected = [...found].filter((v) => !EXPECTED.has(v));
    expect(unexpected, `unexpected env var(s) referenced in src/: ${unexpected.join(", ")} — verify these are meant to be public before allowing`).toEqual([]);
  });
});

test.describe("Security regression — 8 spoofed-value checks hardened 2026-07-10/13", () => {
  test("1. send-staff-password-reset: a spoofed phone field has zero effect vs. omitting it", async ({ request }) => {
    const withSpoofedPhone = await request.post(FN("send-staff-password-reset"), {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: {
        email: STAFF.email,
        phone: "5555550100", // attacker-controlled — must be ignored
        redirectUrl: "https://www.jointidywise.com/staff/reset-password",
      },
      failOnStatusCode: false,
    });
    await new Promise((r) => setTimeout(r, 1500)); // stay under the 3/10min rate limit
    const withoutPhone = await request.post(FN("send-staff-password-reset"), {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { email: STAFF.email, redirectUrl: "https://www.jointidywise.com/staff/reset-password" },
      failOnStatusCode: false,
    });
    expect(withSpoofedPhone.status()).toBe(withoutPhone.status());
    expect(await withSpoofedPhone.json()).toEqual(await withoutPhone.json());
  });

  // Slot 2 previously held two spoofed-value checks against redeem-loyalty-points.
  // That function was deleted 2026-07-29 when loyalty became tiers-only, so both
  // were removed — one called the endpoint, the other readFileSync'd its source.
  //
  // What replaces them is a DIFFERENT kind of check: not input spoofing, but
  // deployment state. In this project a git push deploys nothing, so "the
  // directory is gone" and "the endpoint stops responding" are independent
  // facts, and the gap between them has cost real time repeatedly. A removed
  // function that is still deployed is still callable — and this one moved
  // money (it deducted loyalty points and wrote store credit).
  test("2. redeem-loyalty-points is UNDEPLOYED, not merely deleted from the repo", async ({ request }) => {
    const resp = await request.post(FN("redeem-loyalty-points"), {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: {},
      failOnStatusCode: false,
    });

    // 404 = gateway has no such function. Anything else means it is still live:
    // 401/400 in particular mean it is deployed and merely rejecting this call.
    expect(
      resp.status(),
      `expected 404 (undeployed) but got ${resp.status()}. The directory was ` +
        `deleted from the repo, but a deleted directory does not undeploy a ` +
        `function — ask Lovable to undeploy redeem-loyalty-points.`,
    ).toBe(404);
  });

  test("2c. no client code references the removed redemption endpoint", async () => {
    // Source-level guard: if src/ still invokes it, deleting the function
    // turned a working button into a silent 404 for customers.
    const srcDir = join(process.cwd(), "src");
    const { execSync } = await import("node:child_process");
    // grep exits 1 when there are no matches, which is the passing case here.
    const hits = execSync(
      `grep -rl "redeem-loyalty-points" "${srcDir}" || true`,
      { encoding: "utf8" },
    ).split("\n").filter(Boolean);
    expect(hits, `src/ still references redeem-loyalty-points:\n${hits.join("\n")}`).toEqual([]);
  });

  test("3. post-booking-upsell: requires auth, and its org-mismatch guard exists in source", async ({ request }) => {
    const resp = await request.post(FN("post-booking-upsell"), {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { bookingId: "16dfc220-21cf-4696-abaa-7d5f8c846e8d" },
      failOnStatusCode: false,
    });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe("Unauthorized");

    const src = readFileSync(join(process.cwd(), "supabase/functions/post-booking-upsell/index.ts"), "utf8");
    expect(src).toMatch(/resolveCallerOrg\(req\)/);
    expect(src).toMatch(/booking\.organization_id !== organizationId/);
  });

  test("4. send-push-notification: rejects any non-service-role caller", async ({ request }) => {
    const ownerToken = await getAccessToken(request, OWNER.email, OWNER.password);
    const resp = await request.post(FN("send-push-notification"), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      data: { organization_id: STAFF.orgId, title: "QA-TEST", body: "regression probe" },
      failOnStatusCode: false,
    });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe("Unauthorized");
  });

  test("5. check-staff-payout-status: staff cannot spoof another org's id for their own staffId", async ({
    request,
  }) => {
    const staffToken = await getAccessToken(request, STAFF.email, STAFF.password);
    const resp = await request.post(FN("check-staff-payout-status"), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" },
      data: { staffId: STAFF.staffId, organizationId: OWNER.orgId }, // real staffId, WRONG org
      failOnStatusCode: false,
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).error).toBe("Forbidden");

    // Control: the same staffId with the CORRECT org succeeds.
    const control = await request.post(FN("check-staff-payout-status"), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" },
      data: { staffId: STAFF.staffId, organizationId: STAFF.orgId },
      failOnStatusCode: false,
    });
    expect(control.status()).toBe(200);
  });

  test("6. send-booking-email: requires auth (org is resolved server-side, never trusted from body)", async ({
    request,
  }) => {
    const resp = await request.post(FN("send-booking-email"), {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { customerEmail: "bdemandingo+qaprobe@gmail.com", organizationId: STAFF.orgId },
      failOnStatusCode: false,
    });
    expect(resp.status()).toBe(401);

    const src = readFileSync(join(process.cwd(), "supabase/functions/send-booking-email/index.ts"), "utf8");
    expect(src).toMatch(/resolveCallerOrg\(\s*req/);
    expect(src).toMatch(/booking\.organizationId = callerOrg\.ctx\.organizationId;/);
  });

  test("7. notify-quote-accepted: a spoofed organization_id in the body is overwritten by the caller's real org", async ({
    request,
  }) => {
    const ownerToken = await getAccessToken(request, OWNER.email, OWNER.password);
    // No customer_email/customer_phone — nothing sends; exercises only the
    // auth + org-resolution path safely.
    const resp = await request.post(FN("notify-quote-accepted"), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      data: { quote_id: "qa-test-delete-regression-nonexistent", organization_id: STAFF.orgId },
      failOnStatusCode: false,
    });
    expect(resp.status()).toBe(200);
    expect((await resp.json()).success).toBe(true);

    const unauth = await request.post(FN("notify-quote-accepted"), {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { quote_id: "qa-test-delete-regression-nonexistent" },
      failOnStatusCode: false,
    });
    expect(unauth.status()).toBe(401);

    const src = readFileSync(join(process.cwd(), "supabase/functions/notify-quote-accepted/index.ts"), "utf8");
    expect(src).toMatch(/resolveCallerOrg\(req\)/);
    expect(src).toMatch(/body\.organization_id = callerOrg\.ctx\.organizationId;/);
  });

  test("8. org_memberships: source guard — last-owner removal/demotion trigger exists and covers DELETE + UPDATE", async () => {
    // NOT exercised live: a real behavioral test requires creating a
    // disposable org + inviting a manager (the pattern used when this was
    // first verified on 2026-07-10) — too heavy/risky for a routine
    // regression run against production. This asserts the guard is still
    // present in source; see tests/README.md for the one-off live-verify
    // script if a deeper check is ever needed again.
    const files = [
      "supabase/migrations/20260710102000_owner_membership_protection.sql",
    ];
    const migrationsDir = join(process.cwd(), "supabase/migrations");
    const { readdirSync } = await import("node:fs");
    const all = readdirSync(migrationsDir);
    for (const f of files) {
      expect(all, `expected migration file ${f} to exist`).toContain(f.split("/").pop());
    }
    const src = readFileSync(join(process.cwd(), files[0]), "utf8");
    expect(src).toMatch(/CREATE OR REPLACE FUNCTION public\.prevent_last_owner_removal/);
    expect(src).toMatch(/RAISE EXCEPTION 'cannot_remove_last_owner'/);
    expect(src).toMatch(/BEFORE DELETE OR UPDATE ON public\.org_memberships/);
    expect(src).toMatch(/IF auth\.role\(\) = 'service_role' THEN/); // service-role carve-out for account/org deletion
  });
});
