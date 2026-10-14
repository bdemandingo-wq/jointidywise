// node --experimental-strip-types --test src/lib/iosBackSwipe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IOS_BACK_SWIPE_SETTLE_MS, isIosBackSwipeRoot } from './iosBackSwipe.ts';

test('tab-bar destinations and the staff home do not edge-swipe', () => {
  const nav = readFileSync(new URL('../components/mobile/MobileBottomNav.tsx', import.meta.url), 'utf8');
  const destinations = [...nav.matchAll(/to: '([^']+)'/g)].map((match) => match[1]);
  assert.ok(destinations.includes('/dashboard'));
  for (const path of destinations) {
    assert.equal(isIosBackSwipeRoot(path), true, path);
  }
  assert.equal(isIosBackSwipeRoot('/staff'), true);
  assert.equal(isIosBackSwipeRoot('/staff/'), true);
});

test('a detail page and the login screens are not swipe roots', () => {
  assert.equal(isIosBackSwipeRoot('/dashboard/customers/abc'), false);
  assert.equal(isIosBackSwipeRoot('/staff/job/1'), false);
  assert.equal(isIosBackSwipeRoot('/staff/login'), false);
  assert.equal(isIosBackSwipeRoot('/login'), false);
});

test('the native back gesture is given time to move the route before JS pops', () => {
  assert.equal(IOS_BACK_SWIPE_SETTLE_MS, 300);
});
