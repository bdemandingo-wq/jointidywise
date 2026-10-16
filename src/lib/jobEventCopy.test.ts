import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { jobEventCopy as appCopy, shouldSendArrival as appShould } from './jobEventCopy.ts';
import { jobEventCopy as edgeCopy, shouldSendArrival as edgeShould } from '../../supabase/functions/_shared/job-event-copy.ts';

const input = {
  staffName: 'Ana',
  bookingNumber: 2288,
  customerLabel: 'Sam Lee',
  companyName: 'Bright Clean',
  address: '65 Southwest 12th Avenue',
  amountSuffix: '\nTotal: $120.00',
};

test('the app and edge copy modules stay identical', () => {
  assert.deepEqual(appCopy('completed', input), edgeCopy('completed', input));
  assert.deepEqual(appCopy('arrived', input), edgeCopy('arrived', input));
  for (const status of ['completed', 'cancelled', 'no_show', 'confirmed', 'in_progress', null, undefined]) {
    assert.equal(appShould(status), edgeShould(status));
  }
});

test('completion copy says completed and does not text the customer', () => {
  const copy = appCopy('completed', input);
  const blob = JSON.stringify(copy);
  assert.equal(/arriv/i.test(blob), false);
  assert.match(copy.bellTitle, /completed/i);
  assert.match(copy.bellMessage, /completed/);
  assert.match(copy.pushTitle, /completed/);
  assert.match(copy.adminSms, /completed/);
  assert.equal(copy.customerSms, null);
  assert.equal(copy.kind, 'job_complete');
});

test('arrival copy says arrived and is not a completion notice', () => {
  const copy = appCopy('arrived', input);
  const blob = JSON.stringify(copy);
  assert.equal(/complet/i.test(blob), false);
  assert.match(copy.bellMessage, /arrived/);
  assert.match(copy.adminSms, /arrived/);
  assert.match(copy.customerSms ?? '', /arrived/);
  assert.equal(copy.kind, 'arrived');
});

test('a finished job does not send the arrival template', () => {
  assert.equal(appShould('completed'), false);
  assert.equal(appShould('cancelled'), false);
  assert.equal(appShould('no_show'), false);
  assert.equal(appShould('confirmed'), true);
  assert.equal(appShould('in_progress'), true);
});

test('completion invokes the completed event, and arrival refuses a finished job', () => {
  const complete = readFileSync(new URL('../../supabase/functions/send-job-complete-sms/index.ts', import.meta.url), 'utf8');
  const arrival = readFileSync(new URL('../../supabase/functions/send-arrival-sms/index.ts', import.meta.url), 'utf8');
  const tracking = readFileSync(new URL('../hooks/useCleanerTracking.ts', import.meta.url), 'utf8');
  assert.match(complete, /jobEventCopy\('completed'/);
  assert.equal(complete.includes("jobEventCopy('arrived'"), false);
  assert.match(arrival, /jobEventCopy\('arrived'/);
  assert.match(arrival, /shouldSendArrival/);
  assert.match(tracking, /shouldSendArrival/);
});
