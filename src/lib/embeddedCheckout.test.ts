import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handoffFromHash,
  readCheckoutSession,
  readStagedCheckout,
  safeCancelPath,
  stageEmbeddedCheckout,
} from './embeddedCheckout.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}

const session = {
  clientSecret: 'cs_test_secret_abc',
  publishableKey: 'pk_test_abc',
};

test('a checkout payload must include a client secret and a publishable key', () => {
  assert.deepEqual(readCheckoutSession(session), session);
  assert.throws(() => readCheckoutSession({ url: 'https://checkout.stripe.com/x' }), /Nothing was charged/);
  assert.throws(() => readCheckoutSession({ ...session, publishableKey: 'sk_live_nope' }), /not configured/);
  assert.throws(() => readCheckoutSession({ error: 'Lifetime offer is sold out.' }), /sold out/);
});

test('cancel paths stay on this site', () => {
  assert.equal(safeCancelPath('/pricing?plan=pro&interval=yearly&canceled=1'), '/pricing?plan=pro&interval=yearly&canceled=1');
  assert.equal(safeCancelPath('https://evil.example/pricing'), '/pricing');
  assert.equal(safeCancelPath('//evil.example'), '/pricing');
  assert.equal(safeCancelPath(null), '/pricing');
});

test('a staged checkout expires and a bad payload is dropped', () => {
  const storage = memoryStorage();
  const now = 1_000_000;
  stageEmbeddedCheckout({ ...session, plan: 'pro', interval: 'yearly', cancelPath: '/choose-plan?upgrade=1' }, storage, now);
  assert.equal(readStagedCheckout(storage, now + 60_000)?.plan, 'pro');
  assert.equal(readStagedCheckout(storage, now + 60_000)?.cancelPath, '/choose-plan?upgrade=1');
  assert.equal(readStagedCheckout(storage, now + 31 * 60 * 1000), null);
  assert.equal(storage.getItem('tw-embedded-checkout'), null);

  storage.setItem('tw-embedded-checkout', '{not json');
  assert.equal(readStagedCheckout(storage, now), null);
  assert.equal(storage.getItem('tw-embedded-checkout'), null);
});

test('an iframe breakout hash round-trips the secret without a query string', () => {
  const hash = new URLSearchParams({
    client_secret: session.clientSecret,
    pk: session.publishableKey,
    plan: 'lifetime',
    cancel: '/pricing?plan=lifetime&canceled=1',
  }).toString();
  const handoff = handoffFromHash(`#${hash}`);
  assert.equal(handoff?.clientSecret, session.clientSecret);
  assert.equal(handoff?.plan, 'lifetime');
  assert.equal(handoff?.cancelPath, '/pricing?plan=lifetime&canceled=1');
  assert.equal(handoffFromHash('#client_secret=nope&pk=pk_test_x'), null);
});
