import { expect, test } from '@playwright/test';

/**
 * Marketing-site cookie notice. Tag IDs are unset in this environment, so
 * the suite checks that no TidyWise tag script is injected. With IDs set,
 * also confirm: a Global Privacy Control browser sends no request to
 * connect.facebook.net or googletagmanager.com from /, and opting out
 * stops a tag that already loaded.
 */

test.describe('TidyWise cookie notice', () => {
  test('small phone layout keeps the signup button above the bar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/signup');
    const banner = page.getByRole('region', { name: 'Cookie notice' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      'We use cookies and similar tools from Google and Meta to measure our site and show you relevant ads.',
    );
    const ok = banner.getByRole('button', { name: 'OK' });
    const link = banner.getByRole('link', { name: 'Do Not Sell or Share My Personal Information' });
    const privacy = banner.getByRole('link', { name: 'Privacy Policy' });
    const okBox = await ok.boundingBox();
    const linkBox = await link.boundingBox();
    const privacyBox = await privacy.boundingBox();
    const bannerBox = await banner.boundingBox();
    expect(okBox).not.toBeNull();
    expect(linkBox).not.toBeNull();
    expect(privacyBox).not.toBeNull();
    expect(bannerBox).not.toBeNull();
    expect(okBox!.height).toBeGreaterThanOrEqual(44);
    expect(linkBox!.height).toBeGreaterThanOrEqual(44);
    expect(privacyBox!.height).toBeGreaterThanOrEqual(44);
    expect(okBox!.width).toBeGreaterThan(bannerBox!.width * 0.75);
    expect(okBox!.y).toBeGreaterThan((await banner.locator('.tw-cookie-notice__copy').boundingBox())!.y);

    const submit = page.locator('[data-signup-submit]');
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    const barBox = await banner.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(barBox!.y + 1);

    const background = await banner.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toBe('rgb(255, 255, 255)');
    await expect(banner.getByRole('button', { name: 'Close' })).toHaveCount(0);
  });

  test('desktop keeps OK on the right of the copy', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const banner = page.getByRole('region', { name: 'Cookie notice' });
    await expect(banner).toBeVisible();
    const ok = await banner.getByRole('button', { name: 'OK' }).boundingBox();
    const copy = await banner.locator('.tw-cookie-notice__copy').boundingBox();
    expect(ok).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(ok!.x).toBeGreaterThan(copy!.x + copy!.width - 8);
    expect(Math.abs(ok!.y - copy!.y)).toBeLessThan(40);
    await expect(page.getByRole('link', { name: 'Do Not Sell or Share My Personal Information' }).last()).toBeVisible();
  });

  test('OK stores acknowledged and stays dismissed', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'OK' }).click();
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('acknowledged');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('acknowledged');
  });

  test('Do Not Sell stores opted_out and the page shows that status', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('region', { name: 'Cookie notice' }).getByRole('link', { name: 'Do Not Sell or Share My Personal Information' }).click();
    await expect(page).toHaveURL(/\/do-not-sell$/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('opted_out');
    await expect(page.getByRole('status')).toContainText('Opted out');
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('opted_out');
    await expect(page.getByRole('button', { name: 'You are opted out' })).toBeDisabled();
  });

  test('footer link can opt out after the bar is gone', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'OK' }).click();
    await page.getByRole('contentinfo').getByRole('link', { name: 'Do Not Sell or Share My Personal Information' }).click();
    await expect(page).toHaveURL(/\/do-not-sell$/);
    await page.getByRole('button', { name: 'Opt out of sale or sharing' }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('opted_out');
  });

  test('no notice and no TidyWise tag scripts on booking, login, or the cleaner portal', async ({ page }) => {
    for (const path of ['/book/sample-org', '/login', '/staff/login']) {
      await page.goto(path);
      await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
      await expect(page.locator('#tw-owned-meta, #tw-owned-ga, #tw-owned-ga-loader')).toHaveCount(0);
    }
  });

  test('unset tag ids add no Meta or Google tag on the marketing site', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tw-owned-meta, #tw-owned-ga, #tw-owned-ga-loader')).toHaveCount(0);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.reload();
    await page.getByRole('region', { name: 'Cookie notice' }).waitFor();
    expect(requests.some((url) => url.includes('connect.facebook.net') || url.includes('googletagmanager.com/gtag'))).toBe(false);
  });
});
