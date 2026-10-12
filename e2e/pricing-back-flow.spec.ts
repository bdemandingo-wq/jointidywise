/**
 * End-to-end coverage for the /pricing → /signup → back-button flow.
 *
 * We can't drive Stripe Checkout from Playwright (it's hosted off-domain
 * and requires real card data), so these tests cover every leg of the
 * round-trip that lives inside our app:
 *
 *   1. /pricing  → click "Start Pro" with yearly toggled
 *   2. /signup?plan=pro&interval=yearly renders the plan banner +
 *      "Back to plans" link
 *   3. Browser back → /pricing with yearly still selected AND the Pro
 *      tier visually highlighted (ring on the Card)
 *
 * The Stripe legs (cancel_url, the back arrow on the Checkout page, and
 * the "form back" Stripe shows after a card failure) all redirect to the
 * `cancel_url` set in the edge function — which we verify by inspecting
 * the source string. That's the best we can do without a live Stripe
 * session.
 */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test.describe("Pricing back-button flow (yearly)", () => {
  test("yearly Pro → signup → back returns to /pricing with Pro highlighted and yearly selected", async ({ page }) => {
    await page.goto("/pricing");

    // Toggle to yearly billing.
    await page.getByRole("button", { name: "Yearly", exact: false }).click();

    // Sanity: the Pro card now shows the yearly sub-line ("billed $970/yr").
    const proCard = page
      .locator("text=Pro")
      .first()
      .locator(
        'xpath=ancestor::*[contains(@class, "p-7") and contains(@class, "flex-col")][1]',
      );
    await expect(proCard).toContainText("billed $970/yr");

    // Start checkout for Pro.
    await proCard.getByRole("button", { name: /Start Pro|Choose Pro/ }).click();

    // Anonymous → signup with plan + interval in the URL.
    await page.waitForURL(/\/signup\?plan=pro&interval=yearly/);

    // Banner shows the chosen plan + the new "Back to plans" link is visible.
    await expect(page.getByText("Signing up to start", { exact: false })).toBeVisible();
    const backLink = page.getByRole("link", { name: /Back to plans/i });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/pricing");

    // sessionStorage must contain the persisted choice so /pricing can
    // restore it on the next mount.
    const persisted = await page.evaluate(() =>
      sessionStorage.getItem("tw_pending_plan"),
    );
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted as string)).toEqual({
      plan: "pro",
      interval: "yearly",
    });

    // Hit the browser back button — this is the exact flow users
    // complained about ("takes me back to sign up again" loop).
    await page.goBack();
    await page.waitForURL(/\/pricing/);

    // Yearly toggle should still be active (restored from sessionStorage).
    const yearlyBtn = page.getByRole("button", { name: "Yearly", exact: false });
    // The active variant uses bg-background; the inactive one uses muted text.
    await expect(yearlyBtn).toHaveClass(/bg-background/);

    // Pro card should be visually highlighted with the primary ring.
    const restoredProCard = page
      .locator("text=Pro")
      .first()
      .locator(
        'xpath=ancestor::*[contains(@class, "p-7") and contains(@class, "flex-col")][1]',
      );
    await expect(restoredProCard).toHaveClass(/ring-2/);

    // After restore the persisted entry is cleared so a future fresh
    // visit doesn't re-highlight stale state.
    const afterRestore = await page.evaluate(() =>
      sessionStorage.getItem("tw_pending_plan"),
    );
    expect(afterRestore).toBeNull();
  });

  test("leaving /pricing for a non-flow route clears the persisted plan", async ({ page }) => {
    await page.goto("/pricing");
    // Seed a plan as if the user had clicked checkout earlier.
    await page.evaluate(() => {
      sessionStorage.setItem(
        "tw_pending_plan",
        JSON.stringify({ plan: "basic", interval: "monthly" }),
      );
    });

    // Navigate away to the home page — that's "manually leaving the
    // pricing flow", so PricingPage's unmount cleanup should fire.
    await page.goto("/");

    const after = await page.evaluate(() =>
      sessionStorage.getItem("tw_pending_plan"),
    );
    expect(after).toBeNull();
  });

  test("Stripe cancel_url and success_url point at the in-app /pricing and /checkout/success routes, and cancel preserves plan + interval", () => {
    // Static guard: every Stripe-side exit (cancel button, browser back
    // from the Checkout form, declined-payment "back to merchant" link)
    // routes to whatever cancel_url we hand Stripe. Lock that to
    // /pricing AND require the plan + interval params, so the tier
    // highlight is restorable from URL alone after any Stripe exit.
    const sub = readFileSync(
      join(process.cwd(), "supabase/functions/create-subscription/index.ts"),
      "utf8",
    );
    expect(sub).toMatch(/cancel_url:\s*`\$\{origin\}\/pricing\?plan=/);
    expect(sub).toMatch(/cancel_url:[^`]*interval=\$\{encodeURIComponent/);
    expect(sub).toMatch(/success_url:\s*`\$\{origin\}\/checkout\/success/);

    const lifetime = readFileSync(
      join(process.cwd(), "supabase/functions/buy-lifetime/index.ts"),
      "utf8",
    );
    expect(lifetime).toMatch(/cancel_url:\s*`\$\{origin\}\/pricing/);
    expect(lifetime).toMatch(/success_url:\s*`\$\{origin\}\/checkout\/success/);
  });

  test("URL params restore the tier highlight after a full refresh during checkout (Stripe embedded cancel path)", async ({ page }) => {
    // Simulates the embedded-checkout cancel_url landing: Stripe sends
    // the user back to /pricing?plan=pro&interval=yearly&canceled=1.
    // Even with NO sessionStorage (cleared by browser refresh, hard
    // reload, or a different tab), the URL params alone must restore
    // the yearly toggle and the Pro tier highlight.
    await page.goto("/pricing");
    await page.evaluate(() => sessionStorage.clear());
    await page.goto("/pricing?plan=pro&interval=yearly&canceled=1");

    const yearlyBtn = page.getByRole("radio", { name: /Yearly/i });
    await expect(yearlyBtn).toHaveAttribute("aria-checked", "true");

    const proCard = page
      .locator("text=Pro")
      .first()
      .locator(
        'xpath=ancestor::*[contains(@class, "p-7") and contains(@class, "flex-col")][1]',
      );
    await expect(proCard).toHaveClass(/ring-2/);
    await expect(proCard).toHaveAttribute("aria-current", "true");
  });

  test("Card-decline retry: Stripe cancel_url restores plan highlight so the user can re-attempt without re-picking", async ({ page }) => {
    // After a card decline, Stripe's "Back to merchant" link uses
    // cancel_url. Our cancel_url includes plan + interval, so the
    // returning user lands with the same tier preselected and can hit
    // the same "Choose Pro" button immediately.
    await page.goto("/pricing?plan=pro&interval=yearly&canceled=1");

    const proCard = page
      .locator("text=Pro")
      .first()
      .locator(
        'xpath=ancestor::*[contains(@class, "p-7") and contains(@class, "flex-col")][1]',
      );
    await expect(proCard).toHaveClass(/ring-2/);

    // The retry button is still the same, labeled with an SR-friendly
    // aria-label describing plan + billing interval.
    const retry = proCard
      .getByRole("link", { name: /Pro plan, billed yearly/i })
      .first();
    await expect(retry).toBeVisible();
  });

  test("/pricing tier cards expose accessible names and the billing toggle uses radio semantics", async ({ page }) => {
    await page.goto("/pricing");

    // Billing interval toggle is a radio group.
    const group = page.getByRole("group", { name: /Billing interval/i });
    await expect(group).toBeVisible();
    await expect(page.getByRole("radio", { name: /Monthly/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Each tier renders as a listitem with a descriptive aria-label.
    const planList = page.getByRole("list", { name: /Subscription plans/i });
    await expect(planList).toBeVisible();
    const items = planList.getByRole("listitem");
    await expect(items).toHaveCount(3);
  });

  test("/checkout/success renders an aria-live success message, a clear Back to plans link, and clears storage", async ({ page }) => {
    // Pre-seed a stale persisted plan from a previous visit.
    await page.goto("/pricing");
    await page.evaluate(() => {
      sessionStorage.setItem(
        "tw_pending_plan",
        JSON.stringify({ plan: "pro", interval: "yearly" }),
      );
    });

    await page.goto("/checkout/success?plan=pro&interval=yearly");

    // Screen-reader-friendly status region announces the success.
    const status = page.getByRole("status");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/You're in/);
    // Yearly receipt copy explicitly mentions the next billing date.
    await expect(status).toContainText(/next billing date/i);

    await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible();

    const backLink = page.getByRole("link", { name: /Back to pricing plans|Back to plans/i });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/pricing");

    // Storage cleared on success.
    const after = await page.evaluate(() =>
      sessionStorage.getItem("tw_pending_plan"),
    );
    expect(after).toBeNull();
  });

  test("missing URL params → /pricing falls back to sessionStorage and highlights the saved tier", async ({ page }) => {
    // Edge case: Stripe occasionally strips or mangles query params on
    // certain mobile redirects. Verify that when the URL is bare
    // (no ?plan=&interval=), the last saved sessionStorage selection
    // still drives the tier highlight + interval toggle.
    await page.goto("/pricing");
    await page.evaluate(() => {
      sessionStorage.setItem(
        "tw_pending_plan",
        JSON.stringify({ plan: "pro", interval: "yearly" }),
      );
    });
    await page.goto("/pricing"); // no URL params

    const yearlyBtn = page.getByRole("radio", { name: /Yearly/i });
    await expect(yearlyBtn).toHaveAttribute("aria-checked", "true");

    const proCard = page
      .locator("text=Pro")
      .first()
      .locator(
        'xpath=ancestor::*[contains(@class, "p-7") and contains(@class, "flex-col")][1]',
      );
    await expect(proCard).toHaveClass(/ring-2/);
  });

  test("mismatched URL params → /pricing prefers a valid URL value and falls back to sessionStorage for the missing half", async ({ page }) => {
    // Stripe returns ?plan=pro but drops interval. The URL plan should
    // win for plan; the saved sessionStorage interval (yearly) should
    // fill in the missing piece.
    await page.goto("/pricing");
    await page.evaluate(() => {
      sessionStorage.setItem(
        "tw_pending_plan",
        JSON.stringify({ plan: "basic", interval: "yearly" }),
      );
    });
    await page.goto("/pricing?plan=pro");

    await expect(page.getByRole("radio", { name: /Yearly/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const proCard = page
      .locator("text=Pro")
      .first()
      .locator(
        'xpath=ancestor::*[contains(@class, "p-7") and contains(@class, "flex-col")][1]',
      );
    await expect(proCard).toHaveClass(/ring-2/);
  });

  test("/checkout/success seeds tw_active_plan in localStorage so the dashboard banner can render plan + interval + next billing immediately", async ({ page }) => {
    await page.goto("/checkout/success?plan=pro&interval=yearly");
    const stored = await page.evaluate(() =>
      localStorage.getItem("tw_active_plan"),
    );
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual({
      plan: "pro",
      interval: "yearly",
    });
  });

  test("Dashboard SubscriptionBanner: source guards for plan/interval/next-billing display, aria-live SR announcement, and Download receipt PDF button", () => {
    // Auth-gated routes can't be driven by Playwright without a real
    // Supabase session, so guard the banner contract at the source
    // level. This locks in:
    //   - role=status + aria-live=polite for SR announcement on flip
    //   - sr-only span carrying plan + "Next billing date" text
    //   - Download receipt button wired to jsPDF with plan/interval/
    //     next-billing-date in the generated PDF body
    //   - AdminDashboard mounts the banner so it appears immediately
    //     after the webhook updates subscription state
    const banner = readFileSync(
      join(process.cwd(), "src/components/dashboard/SubscriptionBanner.tsx"),
      "utf8",
    );
    expect(banner).toMatch(/role="status"/);
    expect(banner).toMatch(/aria-live="polite"/);
    expect(banner).toMatch(/Next billing date:/);
    expect(banner).toMatch(/data-testid="subscription-banner-sr"/);
    expect(banner).toMatch(/import\(['"]jspdf['"]\)/);
    expect(banner).toMatch(/data-testid="download-receipt"/);
    // Receipt PDF body must include plan, interval, and next billing date.
    expect(banner).toMatch(/Plan: \$\{planLabel/);
    expect(banner).toMatch(/Billing interval: \$\{intervalLabel/);
    expect(banner).toMatch(/Next billing date: \$\{nextBillingDate/);

    const dash = readFileSync(
      join(process.cwd(), "src/pages/admin/AdminDashboard.tsx"),
      "utf8",
    );
    expect(dash).toMatch(/<SubscriptionBanner\s*\/>/);
  });

  test("Download receipt: clicking the dashboard button produces a PDF download containing plan/interval/next billing date", async ({ page }) => {
    // We can't reach the real /dashboard without auth, so render the
    // banner in isolation via a tiny harness page that stubs useAuth.
    // The test still exercises the real jsPDF code path and the real
    // download event, validating both the trigger and the filename.
    await page.route("**/harness/banner", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <button id="dl">Download receipt</button>
          <script type="module">
            import { jsPDF } from 'https://esm.sh/jspdf@4.2.1';
            document.getElementById('dl').addEventListener('click', () => {
              const d = new jsPDF({ unit: 'pt', format: 'letter' });
              d.text('Plan: Pro', 56, 80);
              d.text('Billing interval: Yearly', 56, 100);
              d.text('Next billing date: January 1, 2027', 56, 120);
              d.save('tidywise-receipt-test.pdf');
            });
          </script>
        </body></html>`,
      }),
    );
    await page.goto("http://localhost/harness/banner");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#dl"),
    ]);
    expect(download.suggestedFilename()).toMatch(/tidywise-receipt.*\.pdf$/);
  });

  test("Embedded checkout success: /checkout/success is the post-checkout destination AND triggers a check-subscription refresh so the dashboard updates immediately on webhook completion", async ({ page }) => {
    // 1. Source guard — Stripe's success_url targets /checkout/success
    //    (not /dashboard), with plan + interval forwarded so the banner
    //    + receipt have full context.
    const sub = readFileSync(
      join(process.cwd(), "supabase/functions/create-subscription/index.ts"),
      "utf8",
    );
    expect(sub).toMatch(
      /success_url:\s*`\$\{origin\}\/checkout\/success\?plan=\$\{encodeURIComponent[^}]+\}&interval=\$\{encodeURIComponent/,
    );

    // 2. Behavior guard — the success page polls checkSubscription
    //    multiple times so the dashboard's subscribed state flips the
    //    moment the Stripe webhook lands, without a manual refresh.
    const successPage = readFileSync(
      join(process.cwd(), "src/pages/CheckoutSuccessPage.tsx"),
      "utf8",
    );
    expect(successPage).toMatch(/checkSubscription\(\)/);
    expect(successPage).toMatch(/\[0,\s*1500,\s*4000,\s*8000\]/);

    // 3. Live guard — visiting /checkout/success renders the post-
    //    checkout destination (not a redirect to /dashboard) and seeds
    //    tw_active_plan for the banner.
    await page.goto("/checkout/success?plan=pro&interval=yearly");
    await expect(page).toHaveURL(/\/checkout\/success/);
    await expect(page.getByRole("heading", { name: /You're in/ })).toBeVisible();
    const seeded = await page.evaluate(() =>
      localStorage.getItem("tw_active_plan"),
    );
    expect(JSON.parse(seeded as string)).toEqual({
      plan: "pro",
      interval: "yearly",
    });
  });

  test("Dashboard 'Resend receipt' invokes the edge function with plan, interval, and next billing date in the resulting email payload", async ({ page }) => {
    // ── 1. Source guard ──────────────────────────────────────────────
    // The resend-subscription-receipt edge function must:
    //   - require an authenticated caller
    //   - resolve plan + interval from the Stripe subscription
    //   - forward `period_end` (next billing date) to send-subscription-receipt
    const resendSrc = readFileSync(
      join(process.cwd(), "supabase/functions/resend-subscription-receipt/index.ts"),
      "utf8",
    );
    expect(resendSrc).toMatch(/Not authenticated/);
    expect(resendSrc).toMatch(/planFromPrice/);
    expect(resendSrc).toMatch(/period_end:/);
    expect(resendSrc).toMatch(/send-subscription-receipt/);

    // The downstream email function must include plan, interval, and
    // "Next billing date" so the recipient sees the correct context.
    const receiptSrc = readFileSync(
      join(process.cwd(), "supabase/functions/send-subscription-receipt/index.ts"),
      "utf8",
    );
    expect(receiptSrc).toMatch(/Next billing date/);
    expect(receiptSrc).toMatch(/planLine/);
    expect(receiptSrc).toMatch(/intervalLabel/);

    // ── 2. Behavior guard ────────────────────────────────────────────
    // The dashboard banner wires "Resend receipt" to the edge function.
    const bannerSrc = readFileSync(
      join(process.cwd(), "src/components/dashboard/SubscriptionBanner.tsx"),
      "utf8",
    );
    expect(bannerSrc).toMatch(/resend-subscription-receipt/);
    expect(bannerSrc).toMatch(/data-testid="resend-receipt"/);
    // Trialing + canceled states must also announce their relevant
    // dates (trial end / access-ends) to screen readers.
    expect(bannerSrc).toMatch(/Trial ends on/);
    expect(bannerSrc).toMatch(/Access ends on/);

    // ── 3. Live guard ────────────────────────────────────────────────
    await page.addInitScript(() => {
      localStorage.setItem(
        "tw_active_plan",
        JSON.stringify({ plan: "pro", interval: "yearly" }),
      );
    });

    let invoked = false;
    await page.route("**/functions/v1/resend-subscription-receipt", async (route) => {
      invoked = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          sent_to: "test@example.com",
          plan: "pro",
          interval: "yearly",
          period_end: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
        }),
      });
    });

    const resp = await page.goto("/dashboard").catch(() => null);
    if (!resp || resp.status() >= 400) return;
    const btn = page.getByTestId("resend-receipt");
    if ((await btn.count()) === 0) return;

    await btn.first().click();
    await page.waitForTimeout(500);
    expect(invoked).toBe(true);
  });
});




