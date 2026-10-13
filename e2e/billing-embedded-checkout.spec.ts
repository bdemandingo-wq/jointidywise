/**
 * Embedded Checkout shell at a phone width. Stripe is live, so these tests
 * never create a session and never let a request reach api.stripe.com.
 * The return page is confirmed with a mocked reconcile response.
 */

import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.route(/stripe\.com|stripe\.network|stripecdn\.com/, (route) =>
    route.abort(),
  );
});

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test("checkout without a session stays on site at mobile width", async ({ page }) => {
  await page.goto("/billing/checkout");
  await expect(page.getByRole("heading", { name: "This checkout isn't open" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to plans" })).toBeVisible();
  await expect(page).toHaveURL(/\/billing\/checkout$/);
  await noHorizontalOverflow(page);
});

test("a staged checkout renders the in-app frame without leaving the origin", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "tw-embedded-checkout",
      JSON.stringify({
        clientSecret: "cs_test_layout_only",
        publishableKey: "pk_test_layout_only",
        plan: "pro",
        interval: "monthly",
        cancelPath: "/pricing?plan=pro&interval=monthly&canceled=1",
        stagedAt: Date.now(),
      }),
    );
  });
  await page.goto("/billing/checkout");
  await expect(page.getByRole("heading", { name: /Checkout — Pro/ })).toBeVisible();
  const back = page.getByRole("link", { name: "Back" });
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("href", "/pricing?plan=pro&interval=monthly&canceled=1");
  const box = await back.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page).toHaveURL(/\/billing\/checkout$/);
  await noHorizontalOverflow(page);
});

test("return page confirms an unpaid session and does not claim success", async ({ page }) => {
  await page.route("**/functions/v1/reconcile-checkout-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provisioned: false, reason: "not_paid" }),
    }),
  );
  await page.goto("/billing/return?session_id=cs_test_layout_only");
  await expect(page.getByRole("heading", { name: "Checkout wasn't completed" })).toBeVisible();
  await expect(page.getByText("Nothing was charged.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /You're in|Payment confirmed/ })).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test("return page confirms a paid session before continuing", async ({ page }) => {
  await page.route("**/functions/v1/reconcile-checkout-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provisioned: true, plan: "lifetime" }),
    }),
  );
  await page.goto("/billing/return?session_id=cs_test_layout_only");
  await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible();
  await expect(page.getByText("Lifetime is confirmed.")).toBeVisible();
  await noHorizontalOverflow(page);
});
