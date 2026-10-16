import assert from 'node:assert/strict';
import test from 'node:test';
import { demoInvokeKind, demoRpcKind, isMutatingDemoRpc, isSilentDemoRpc } from './blocklist.ts';
import { buildDemoTables, getDemoTables, resetDemoTables } from './dataset.ts';
import { demoQuery } from './query.ts';
import { demoScreenPath, demoScreenTourId, isDemoScreen } from './screens.ts';
import { demoRoutePath, isSampleDemoOn, setDemoStorageScope, setSampleDemoEnabled, startPublicDemo, endPublicDemo } from './session.ts';

const NOW = Date.parse('2026-10-14T16:00:00.000Z');

test('sample company has customers, cleaners, invoices, leads, and a week of jobs', () => {
  const tables = buildDemoTables(NOW);
  assert.equal(tables.customers.length, 25);
  assert.equal(tables.staff.length, 5);
  assert.ok(tables.leads.length >= 6);
  assert.ok(tables.estimates.length >= 5);
  const statuses = new Set(tables.invoices.map((row) => row.status));
  assert.ok(statuses.has('paid'));
  assert.ok(statuses.has('sent'));
  assert.ok(statuses.has('overdue'));
  const past = tables.bookings.filter((row) => String(row.scheduled_at) < new Date(NOW).toISOString());
  const upcoming = tables.bookings.filter((row) => String(row.scheduled_at) > new Date(NOW).toISOString());
  assert.ok(past.length >= 7);
  assert.ok(upcoming.length >= 7);
});

test('demo reads filter and embed without writing', async () => {
  resetDemoTables(NOW);
  const before = getDemoTables().customers.length;
  const { data, error } = await demoQuery('bookings')
    .select('id, organization_id, status, customer:customers(first_name)')
    .eq('organization_id', 'org-real')
    .eq('status', 'completed')
    .or('is_draft.is.null,is_draft.eq.false')
    .limit(5);
  assert.equal(error, null);
  const rows = data as { organization_id?: string; customer: { first_name: string } | null }[];
  assert.ok(rows.length > 0);
  assert.equal(rows[0].organization_id, 'org-real');
  assert.equal(typeof rows[0].customer?.first_name, 'string');

  const blocked = await demoQuery('customers').insert({ first_name: 'Nope' });
  assert.equal(blocked.error?.message, 'Disabled in demo mode');
  assert.equal(getDemoTables().customers.length, before);
});

test('screen links open the matching demo target', () => {
  assert.equal(isDemoScreen('calendar'), true);
  assert.equal(isDemoScreen('nope'), false);
  assert.equal(demoScreenPath('calendar'), '/dashboard/scheduler#demo-calendar');
  assert.equal(demoScreenPath('booking'), '/book/harbor-pine-cleaning#demo-booking-form');
  assert.equal(demoScreenPath('scheduling'), '/dashboard/scheduler#demo-staff-scheduling');
  assert.equal(demoScreenPath('payments'), '/dashboard/invoices#demo-payments');
  assert.equal(demoScreenPath(null), null);
  assert.equal(demoScreenTourId('payments'), 'demo-payments');
});

test('side effects are blocked and booking reads stay in memory', () => {
  assert.equal(demoInvokeKind('public-booking-submit'), 'block');
  assert.equal(demoInvokeKind('create-setup-intent'), 'block');
  assert.equal(demoInvokeKind('send-openphone-sms'), 'block');
  assert.equal(demoInvokeKind('public-booking-data'), 'canned');
  assert.equal(demoInvokeKind('check-availability'), 'canned');
  assert.equal(demoInvokeKind('check-subscription'), 'block');
  assert.equal(demoInvokeKind('address-autocomplete'), 'allow');
  for (const name of [
    'buy-ai-credits',
    'buy-lifetime',
    'buy-ad-management',
    'process-refund',
    'process-tip',
    'remove-customer-card',
    'delete-platform-account',
    'not-a-listed-function',
  ]) {
    assert.equal(demoInvokeKind(name), 'block', name);
  }
  assert.equal(demoRpcKind('merge_customers'), 'block');
  assert.equal(demoRpcKind('increment_coupon_use'), 'block');
  assert.equal(demoRpcKind('unmerge_customers'), 'block');
  assert.equal(demoRpcKind('save_signup_attribution'), 'block');
  assert.equal(demoRpcKind('touch_my_last_login'), 'silent');
  assert.equal(isSilentDemoRpc('touch_my_last_login'), true);
  assert.equal(demoRpcKind('get_org_stripe_settings_safe'), 'allow');
  assert.equal(demoRpcKind('unknown_rpc'), 'block');
  assert.equal(isMutatingDemoRpc('mark_abandoned_booking_progress'), true);
  assert.equal(isSilentDemoRpc('mark_abandoned_booking_progress'), true);
  assert.equal(isMutatingDemoRpc('claim_trial_started_pixel'), true);
  assert.equal(isSilentDemoRpc('claim_trial_started_pixel'), true);
});

test('sample demo stays off outside the app and the public preview is separate', () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };
  const location = { pathname: '/signup', hash: '' };
  Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: { location } });
  setDemoStorageScope({ userId: 'user-1', orgId: 'org-1' });
  setSampleDemoEnabled(false);
  endPublicDemo();
  assert.equal(isSampleDemoOn(), false);
  setSampleDemoEnabled(true);
  assert.equal(isSampleDemoOn(), false);
  location.pathname = '/dashboard';
  assert.equal(isSampleDemoOn(), true);
  location.pathname = '/';
  location.hash = '#/dashboard?tab=jobs';
  assert.equal(demoRoutePath(), '/dashboard');
  assert.equal(isSampleDemoOn(), true);
  location.hash = '#demo-calendar';
  location.pathname = '/pricing';
  assert.equal(isSampleDemoOn(), false);
  location.pathname = '/dashboard';
  location.hash = '';
  startPublicDemo();
  location.pathname = '/signup';
  assert.equal(isSampleDemoOn(), true);
  endPublicDemo();
  setSampleDemoEnabled(false);
  assert.equal(isSampleDemoOn(), false);
});

test('functions.invoke stays gated when supabase-js returns a fresh client', async () => {
  const fetches: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size; },
  };
  const location = { pathname: '/dashboard', hash: '' };
  Object.assign(globalThis, { localStorage: storage, sessionStorage: storage, window: { location } });
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const { installDemoGate } = await import('./gate.ts');
    setDemoStorageScope({ userId: 'user-1', orgId: 'org-1' });
    setSampleDemoEnabled(true);
    const client = createClient('http://127.0.0.1:54321', 'public-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    installDemoGate(client);
    await client.functions.invoke('create-subscription', { body: {} });
    await client.functions.invoke('create-subscription', { body: {} });
    assert.equal(fetches.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    setSampleDemoEnabled(false);
  }
});
