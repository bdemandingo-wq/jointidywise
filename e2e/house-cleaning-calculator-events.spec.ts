import { expect, test, type Page } from '@playwright/test';

const TAG_URL = /google-analytics\.com|googletagmanager\.com|googleadservices\.com|googlesyndication\.com|doubleclick\.net|analytics\.google\.com|facebook\.com|facebook\.net|google\.com\/pagead/;

interface Captured {
  google: Array<{ name: string; params: Record<string, unknown> }>;
  meta: unknown[][];
  fired: string[];
}

async function arm(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __TW_TIDYWISE_TEST_IDS?: unknown }).__TW_TIDYWISE_TEST_IDS = {
      metaId: '1234567890123',
      ga4Id: 'G-TEST1234',
      adsId: 'AW-123456789',
    };
  });
  await page.route('**/*', async (route) => {
    if (TAG_URL.test(route.request().url())) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.continue();
  });
}

async function captured(page: Page): Promise<Captured> {
  return page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
    const google: Array<{ name: string; params: Record<string, unknown> }> = [];
    for (const entry of layer) {
      const args = Array.from(entry as ArrayLike<unknown>);
      const name = args[1];
      if (args[0] === 'event' && (name === 'calc_completed' || name === 'trial_click') && args[2] && typeof args[2] === 'object') {
        google.push({ name: String(name), params: args[2] as Record<string, unknown> });
      }
    }
    const fbq = (window as unknown as { fbq?: { queue?: unknown[] } }).fbq;
    const meta = (fbq?.queue ?? [])
      .map((item) => Array.from(item as ArrayLike<unknown>))
      .filter((args) => args[2] === 'calc_completed' || args[2] === 'trial_click');
    const raw = sessionStorage.getItem('tw-tidywise-conversion-fired');
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const fired = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    return { google, meta, fired };
  });
}

function named(events: Captured['google'], name: string): Captured['google'] {
  return events.filter((event) => event.name === name);
}

test('a settled quote sends calc_completed once, and the trial link sends trial_click', async ({ page }) => {
  await arm(page);
  await page.goto('/tools/house-cleaning-price-calculator');
  const ok = page.getByRole('button', { name: 'OK' });
  if (await ok.isVisible()) await ok.click();

  await page.locator('#square-feet').pressSequentially('1500', { delay: 30 });
  await page.waitForTimeout(200);
  expect((await captured(page)).fired.filter((key) => key.startsWith('calc_completed'))).toEqual([]);

  await expect.poll(async () => (await captured(page)).fired.filter((key) => key.startsWith('calc_completed')).length, {
    timeout: 3_000,
  }).toBe(1);
  await expect(page.getByTestId('quote-price')).toBeVisible();

  const first = await captured(page);
  const calcKeys = first.fired.filter((key) => key.startsWith('calc_completed'));
  expect(calcKeys).toHaveLength(1);
  expect(calcKeys[0]).toContain('sqft:1500|');
  expect(calcKeys[0]).not.toContain('sqft:1|');
  expect(calcKeys[0]).not.toContain('sqft:15|');
  expect(calcKeys[0]).not.toContain('sqft:150|');
  expect(named(first.google, 'calc_completed')).toHaveLength(2);
  expect(first.meta.filter((args) => args[2] === 'calc_completed')).toHaveLength(1);

  await page.getByRole('radio', { name: 'Deep' }).click();
  await page.waitForTimeout(200);
  expect((await captured(page)).fired.filter((key) => key.startsWith('calc_completed'))).toHaveLength(1);
  await expect.poll(async () => (await captured(page)).fired.filter((key) => key.startsWith('calc_completed')).length, {
    timeout: 3_000,
  }).toBe(2);

  const second = await captured(page);
  expect(second.fired.filter((key) => key.includes('|deep|'))).toHaveLength(1);
  expect(named(second.google, 'calc_completed')).toHaveLength(4);
  expect(second.meta.filter((args) => args[2] === 'calc_completed')).toHaveLength(2);

  await page.getByRole('radio', { name: 'Standard recurring' }).click();
  await page.waitForTimeout(900);
  const repeat = await captured(page);
  expect(repeat.fired.filter((key) => key.startsWith('calc_completed'))).toHaveLength(2);
  expect(named(repeat.google, 'calc_completed')).toHaveLength(4);

  for (const event of repeat.google) {
    expect(Object.keys(event.params)).toEqual(['send_to']);
    expect(JSON.stringify(event.params)).not.toMatch(/@|1500|wage/i);
  }
  for (const args of repeat.meta) {
    expect(args.slice(0, 3)).toEqual(['trackSingleCustom', '1234567890123', args[2]]);
    expect(args).toHaveLength(3);
  }

  await page.getByRole('link', { name: 'See plans' }).nth(1).click();
  await expect(page).toHaveURL(/\/pricing$/);
  expect((await captured(page)).fired).not.toContain('trial_click');

  await page.goto('/tools/house-cleaning-price-calculator');
  await page.getByRole('link', { name: 'Start your 30-day free Pro trial, no card' }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  const trial = await captured(page);
  expect(trial.fired).toContain('trial_click');
  expect(trial.fired.filter((key) => key === 'trial_click')).toHaveLength(1);
  const trialGoogle = named(trial.google, 'trial_click');
  expect(trialGoogle).toHaveLength(2);
  for (const event of trialGoogle) {
    expect(Object.keys(event.params)).toEqual(['send_to']);
  }
  expect(trial.meta.filter((args) => args[2] === 'trial_click')).toEqual([
    ['trackSingleCustom', '1234567890123', 'trial_click'],
  ]);
});
