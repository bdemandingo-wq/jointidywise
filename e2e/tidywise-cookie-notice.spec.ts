import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TidyWise marketing tags. Fake ids are injected in the page. Every Google
 * and Meta request is intercepted and recorded, so the suite never calls
 * the live networks. Production hosts are not involved: the dev server
 * allowlists localhost, and 127.0.0.1 is the non-allowlisted control.
 */

const ARTIFACT_DIR = join(process.cwd(), 'e2e/artifacts');
const DNS = 'Do Not Sell or Share My Personal Information';

interface Hit {
  test: string;
  url: string;
  method: string;
  postData: string | null;
}

const HITS: Hit[] = [];

const TAG_URL = /google-analytics\.com|googletagmanager\.com|googleadservices\.com|googlesyndication\.com|doubleclick\.net|analytics\.google\.com|facebook\.com|facebook\.net|google\.com\/pagead/;

function tagHits(testName: string): Hit[] {
  return HITS.filter((hit) => hit.test === testName && TAG_URL.test(hit.url));
}

async function injectFakeIds(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __TW_TIDYWISE_TEST_IDS?: unknown }).__TW_TIDYWISE_TEST_IDS = {
      metaId: '1234567890123',
      ga4Id: 'G-TEST1234',
      adsId: 'AW-123456789',
    };
  });
}

async function interceptTags(page: Page, testName: string): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (TAG_URL.test(url) || url.includes('/~oauth/')) {
      HITS.push({
        test: testName,
        url,
        method: route.request().method(),
        postData: route.request().postData(),
      });
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.continue();
  });
}

async function arm(page: Page, testName: string): Promise<void> {
  await injectFakeIds(page);
  await interceptTags(page, testName);
}

/** Proves this host can load tags before an opt-out, GPC, or exclusion assertion. */
async function assertControlLoaded(page: Page, testName: string): Promise<void> {
  const before = tagHits(testName).length;
  await page.goto('/');
  await expect.poll(() => tagHits(testName).length, { timeout: 15_000 }).toBeGreaterThan(before);
}

test.afterAll(() => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, 'tidywise-cookie-notice-network.json'), JSON.stringify(HITS, null, 2));
});

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
    const link = banner.getByRole('link', { name: DNS });
    const privacy = banner.getByRole('link', { name: 'Privacy Policy' });
    const okBox = await ok.boundingBox();
    const linkBox = await link.boundingBox();
    const privacyBox = await privacy.boundingBox();
    const bannerBox = await banner.boundingBox();
    expect(okBox && linkBox && privacyBox && bannerBox).toBeTruthy();
    expect(okBox!.height).toBeGreaterThanOrEqual(44);
    expect(linkBox!.height).toBeGreaterThanOrEqual(44);
    expect(privacyBox!.height).toBeGreaterThanOrEqual(44);
    expect(okBox!.width).toBeGreaterThan(bannerBox!.width * 0.75);
    expect(okBox!.y).toBeGreaterThan((await banner.locator('.tw-cookie-notice__copy').boundingBox())!.y);

    const submit = page.locator('[data-signup-submit]');
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    const barBox = await banner.boundingBox();
    expect(submitBox && barBox).toBeTruthy();
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
    expect(ok && copy).toBeTruthy();
    expect(ok!.x).toBeGreaterThan(copy!.x + copy!.width - 8);
    expect(Math.abs(ok!.y - copy!.y)).toBeLessThan(40);
    await expect(page.getByRole('link', { name: DNS }).last()).toBeVisible();
  });

  test('OK stores acknowledged, unmounts the bar, and moves focus to the heading', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('region', { name: 'Cookie notice' }).getByRole('button', { name: 'OK' }).click();
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
    await expect(page.locator('h1').first()).toBeFocused();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('acknowledged');
    await page.reload();
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
  });

  test('a modified click saves opted_out without taking over the current tab', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('region', { name: 'Cookie notice' }).getByRole('link', { name: DNS });
    await link.click({ modifiers: ['Control'] });
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('opted_out');
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
  });

  test('OK still loads tags, then a footer opt-out revokes them', async ({ page }) => {
    await arm(page, 'opt-out');
    await assertControlLoaded(page, 'opt-out');
    await page.getByRole('button', { name: 'OK' }).click();
    await page.reload();
    const afterOk = tagHits('opt-out').length;
    expect(afterOk).toBeGreaterThan(0);

    await page.getByRole('link', { name: DNS }).first().click();
    await expect(page).toHaveURL(/\/do-not-sell$/);
    await page.getByRole('button', { name: 'Opt out now' }).click();
    await expect(page.getByRole('status')).toContainText("You're opted out");
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tw-site-privacy-choice'))).toBe('opted_out');

    const beforeHome = tagHits('opt-out').length;
    await page.goto('/');
    await page.waitForTimeout(800);
    expect(tagHits('opt-out').length).toBe(beforeHome);
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
  });

  test('Global Privacy Control blocks tags after a control hit on the same host', async ({ browser }) => {
    const control = await browser.newContext({ baseURL: 'http://localhost:8080' });
    const controlPage = await control.newPage();
    await arm(controlPage, 'gpc-control');
    await assertControlLoaded(controlPage, 'gpc-control');
    await control.close();

    const blocked = await browser.newContext({ baseURL: 'http://localhost:8080' });
    const page = await blocked.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
        configurable: true,
        get: () => true,
      });
    });
    await arm(page, 'gpc');
    await page.goto('/');
    await page.getByRole('button', { name: 'OK' }).click();
    await page.waitForTimeout(800);
    expect(tagHits('gpc')).toEqual([]);
    await page.goto('/do-not-sell');
    await expect(page.getByRole('status')).toContainText("You're opted out");
    await expect(page.getByText("You've opted out on this browser")).toBeVisible();
    await blocked.close();
  });

  test('excluded pages and a non-allowlisted host load nothing after a control hit', async ({ browser }) => {
    const control = await browser.newContext({ baseURL: 'http://localhost:8080' });
    const controlPage = await control.newPage();
    await arm(controlPage, 'excluded-control');
    await assertControlLoaded(controlPage, 'excluded-control');
    await control.close();

    const blocked = await browser.newContext({ baseURL: 'http://localhost:8080' });
    const page = await blocked.newPage();
    await arm(page, 'excluded');
    for (const path of ['/terms', '/privacy-policy', '/feedback']) {
      const before = tagHits('excluded').length;
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: DNS })).toBeVisible();
      await page.waitForTimeout(500);
      expect(tagHits('excluded').length).toBe(before);
    }

    const offHost = await blocked.newPage();
    await arm(offHost, 'off-host');
    await offHost.goto('http://127.0.0.1:8080/');
    await offHost.waitForTimeout(800);
    expect(tagHits('off-host')).toEqual([]);
    await expect(offHost.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
    await blocked.close();
  });

  test('a blocked privacy write keeps the choice in memory and unmounts the bar', async ({ page }) => {
    await page.addInitScript(() => {
      const proto = Storage.prototype;
      const setItem = proto.setItem;
      const getItem = proto.getItem;
      proto.setItem = function (key: string, value: string) {
        if (key === 'tw-site-privacy-choice') throw new Error('storage blocked');
        return setItem.call(this, key, value);
      };
      proto.getItem = function (key: string) {
        if (key === 'tw-site-privacy-choice') throw new Error('storage blocked');
        return getItem.call(this, key);
      };
    });
    await arm(page, 'storage');
    await assertControlLoaded(page, 'storage');
    await page.getByRole('region', { name: 'Cookie notice' }).getByRole('link', { name: DNS }).click();
    await expect(page).toHaveURL(/\/do-not-sell$/);
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText("You're opted out");
    const before = tagHits('storage').length;
    await page.getByRole('banner').getByRole('link', { name: 'Home' }).click();
    await page.waitForTimeout(800);
    expect(tagHits('storage').length).toBe(before);
    await expect(page.locator('.tw-cookie-notice')).toHaveCount(0);
  });

  test('email signup and mocked Google signup each send signup_completed once', async ({ page }) => {
    await arm(page, 'signup');
    await page.route('**/*supabase.co/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/v1/signup')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: '33333333-3333-4333-8333-333333333333',
            aud: 'authenticated',
            email: 'bdemandingo+cookie-e2e@gmail.com',
            app_metadata: { provider: 'email' },
            user_metadata: {},
            identities: [],
            created_at: new Date().toISOString(),
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/signup');
    await page.locator('#fullName').fill('Cookie E2E');
    await page.locator('#email').fill('bdemandingo+cookie-e2e@gmail.com');
    await page.locator('#password').fill('QaTestDelete2026!');
    await page.locator('#confirmPassword').fill('QaTestDelete2026!');
    await page.locator('#tos').click();
    await page.locator('[data-signup-submit]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.twConversion)).toBe('signup_completed');
    const emailEvents = await page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
      return layer.filter((entry) => JSON.stringify(entry).includes('sign_up')).length;
    });
    expect(emailEvents).toBeGreaterThan(0);

    await page.addInitScript(() => {
      (window as unknown as { __TW_MOCK_GOOGLE_SIGNUP?: { userId: string } }).__TW_MOCK_GOOGLE_SIGNUP = {
        userId: 'google-oauth-user-1',
      };
    });
    await page.goto('/signup');
    await page.locator('#tos').click();
    await page.locator('[data-google-signup]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.twConversion)).toBe('signup_completed');
    const googleEvents = await page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
      return JSON.stringify(layer).includes('sign_up');
    });
    expect(googleEvents).toBe(true);
  });

  test('trial_started fires once on onboarding', async ({ page }) => {
    const userId = '44444444-4444-4444-8444-444444444444';
    const orgId = '55555555-5555-4555-8555-555555555555';
    const user = {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'bdemandingo+cookie-trial@gmail.com',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [{ provider: 'email', identity_id: 'id-1', id: userId, identity_data: {}, created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      created_at: new Date().toISOString(),
    };
    const org = {
      id: orgId,
      name: 'Cookie Trial',
      slug: 'cookie-trial',
      logo_url: null,
      owner_id: userId,
      needs_onboarding: true,
    };
    const session = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    };

    await page.addInitScript((stored) => {
      localStorage.setItem('sb-slwfkaqczvwvvvavkgpr-auth-token', JSON.stringify(stored));
    }, session);
    await arm(page, 'trial');
    await page.route('**/*supabase.co/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/v1/user') || url.includes('/auth/v1/token')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.includes('/token') ? session : user) });
        return;
      }
      if (url.includes('org_memberships')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ organization_id: orgId, role: 'owner', organizations: org }]),
        });
        return;
      }
      if (url.includes('/organizations')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(org) });
        return;
      }
      if (url.includes('check-subscription')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ subscribed: false, trial_active: true, trial_end: null }),
        });
        return;
      }
      if (url.includes('/profiles')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: userId, phone: null }]) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/onboarding');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.twConversion), { timeout: 20_000 }).toBe('trial_started');
    const first = await page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
      return layer.filter((entry) => JSON.stringify(entry).includes('trial_started')).length;
    });
    expect(first).toBeGreaterThan(0);
    await page.reload();
    await page.waitForTimeout(1500);
    const second = await page.evaluate(() => {
      const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
      return layer.filter((entry) => JSON.stringify(entry).includes('trial_started')).length;
    });
    expect(second).toBe(0);
  });
});

test.describe('cookie notice screenshots', () => {
  const shots: Array<{ name: string; width: number; height: number }> = [
    { name: 'iphone-se', width: 375, height: 667 },
    { name: 'iphone-390', width: 390, height: 844 },
    { name: 'iphone-pro-max', width: 430, height: 932 },
  ];

  for (const shot of shots) {
    test(`signup banner ${shot.name}`, async ({ page }) => {
      mkdirSync(ARTIFACT_DIR, { recursive: true });
      await page.setViewportSize({ width: shot.width, height: shot.height });
      await page.goto('/signup');
      const banner = page.getByRole('region', { name: 'Cookie notice' });
      await expect(banner).toBeVisible();
      const submit = page.locator('[data-signup-submit]');
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeVisible();
      await page.screenshot({ path: join(ARTIFACT_DIR, `cookie-notice-${shot.name}.png`), fullPage: true });
    });
  }

  test('do not sell page, both states', async ({ page }) => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/do-not-sell');
    await expect(page.getByRole('button', { name: 'Opt out now' })).toBeVisible();
    await expect(page.getByRole('heading', { name: DNS })).toBeVisible();
    await page.screenshot({ path: join(ARTIFACT_DIR, 'do-not-sell-opt-out-now.png'), fullPage: true });
    await page.getByRole('button', { name: 'Opt out now' }).click();
    await expect(page.getByRole('status')).toContainText("You're opted out");
    await expect(page.getByText("You've opted out on this browser")).toBeVisible();
    await page.screenshot({ path: join(ARTIFACT_DIR, 'do-not-sell-opted-out.png'), fullPage: true });
  });
});
