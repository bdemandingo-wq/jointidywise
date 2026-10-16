// node --experimental-strip-types --test src/lib/onboardingInsertGuard.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { blockOnboardingInsert, createSubmitGuard } from './onboardingInsertGuard.ts';

test('an existing membership or owned org blocks a new onboarding insert', () => {
  assert.equal(blockOnboardingInsert({
    allowAdditionalBusiness: false,
    probe: { membershipOrgId: 'org-1', ownedOrgId: null },
  }), true);
  assert.equal(blockOnboardingInsert({
    allowAdditionalBusiness: false,
    probe: { membershipOrgId: null, ownedOrgId: 'org-2' },
  }), true);
  assert.equal(blockOnboardingInsert({
    allowAdditionalBusiness: false,
    probe: { membershipOrgId: null, ownedOrgId: null },
  }), false);
});

test('an explicit additional business may still be created', () => {
  assert.equal(blockOnboardingInsert({
    allowAdditionalBusiness: true,
    probe: { membershipOrgId: 'org-1', ownedOrgId: 'org-1' },
  }), false);
});

test('a second submit while the first is in flight does not enter', () => {
  const guard = createSubmitGuard();
  assert.equal(guard.enter(), true);
  assert.equal(guard.enter(), false);
  guard.leave();
  assert.equal(guard.enter(), true);
});

test('submit reuses the oldest placeholder instead of maybeSingle', () => {
  const source = readFileSync(new URL('../pages/OnboardingPage.tsx', import.meta.url), 'utf8');
  const start = source.indexOf(".eq('needs_onboarding', true)");
  assert.ok(start > 0);
  const lookup = source.slice(start, start + 280);
  assert.match(lookup, /\.order\('created_at', \{ ascending: true \}\)/);
  assert.match(lookup, /\.order\('id', \{ ascending: true \}\)/);
  assert.match(lookup, /\.limit\(1\)/);
  assert.equal(lookup.includes('maybeSingle'), false);
  assert.match(source, /orgLookupResult\.data\?\.\[0\]/);
});
