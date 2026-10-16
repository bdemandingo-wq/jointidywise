import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the migration accepts the OS permission decisions and deletes rows after 30 days', () => {
  const sql = read('../../supabase/migrations/20261016050000_location_share_window.sql');
  assert.match(sql, /'os_permission_granted'/);
  assert.match(sql, /'revoked'/);
  assert.match(sql, /DELETE FROM public\.cleaner_location_tracking/);
  assert.match(sql, /recorded_at < now\(\) - interval '30 days'/);
  assert.match(sql, /location sharing has ended/);
  assert.match(sql, /OLD\.arrived_at IS NOT NULL/);
  assert.match(sql, /'in_progress', 'completed', 'cancelled', 'no_show'/);
  assert.match(sql, /customer_on_my_way_location/);
  assert.match(sql, /t\.is_active = true/);
  assert.match(sql, /t\.arrived_at IS NULL/);
  assert.equal(sql.includes('GRANT UPDATE'), false);
  assert.equal(sql.includes('GRANT DELETE'), false);
});

test('photos and clock-in do not read a device location', () => {
  const upload = read('./bookingMediaUpload.ts');
  const checkin = read('../components/staff/GpsCheckin.tsx');
  assert.match(upload, /return Promise\.resolve\(null\)/);
  assert.equal(upload.includes('chooseStampGps'), false);
  assert.match(upload, /capture_latitude: null/);
  assert.equal(upload.includes('getCurrentPosition'), false);
  assert.equal(checkin.includes('getCurrentPosition'), false);
  assert.equal(checkin.includes('getPositionWithFallback'), false);
  assert.match(checkin, /latitude: null/);
});

test('arrival stops the live watch', () => {
  const hook = read('../hooks/useCleanerTracking.ts');
  assert.match(hook, /haltWatchRef\.current\(true\)/);
  assert.match(hook, /if \(arrivedRef\.current\) return/);
});

test('the privacy manifest stays non-tracking', () => {
  const privacy = read('../../ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(privacy, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  assert.match(privacy, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
});
