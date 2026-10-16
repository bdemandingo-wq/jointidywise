import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the migration accepts the OS permission decisions and deletes rows after 30 days', () => {
  const sql = read('../../supabase/migrations/20261016050000_location_share_window.sql');
  assert.match(sql, /'os_permission_granted'/);
  assert.match(sql, /'os_permission'/);
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

test('photos and clock-in record a device location, and On My Way is the only consent grant', () => {
  const upload = read('./bookingMediaUpload.ts');
  const checkin = read('../components/staff/GpsCheckin.tsx');
  const tracking = read('../hooks/useCleanerTracking.ts');
  const permission = read('../hooks/useLocationPermission.ts');
  const prompt = read('../components/staff/StaffLocationPrompt.tsx');
  const photos = read('../pages/admin/BookingPhotosPage.tsx');
  assert.match(upload, /getCurrentPosition/);
  assert.match(upload, /chooseStampGps/);
  assert.match(checkin, /getPositionWithFallback/);
  assert.match(tracking, /recordOsPermissionGrant/);
  assert.match(tracking, /Promise\.all\(\[/);
  assert.equal(permission.includes('recordOsPermissionGrant'), false);
  assert.equal(prompt.includes('recordOsPermissionGrant'), false);
  assert.match(permission, /recordOsPermissionRevoke/);
  const cancelAt = photos.indexOf('await queryClient.cancelQueries');
  const optimisticAt = photos.indexOf('withoutMediaId(current');
  assert.ok(cancelAt !== -1 && optimisticAt !== -1 && cancelAt < optimisticAt);
  assert.equal(tracking.includes('if (statusError) return'), false);
  assert.match(tracking, /send-arrival-sms/);
});

test('arrival stops the live watch', () => {
  const hook = read('../hooks/useCleanerTracking.ts');
  const attempt = read('./arrivalAttempt.ts');
  assert.match(hook, /haltWatchRef\.current\(markArrivedAt\)/);
  assert.match(attempt, /stopWatch\(false\)/);
  assert.match(attempt, /stopWatch\(true\)/);
  assert.match(hook, /if \(arrivedRef\.current\) return/);
});

test('the privacy manifest stays non-tracking', () => {
  const privacy = read('../../ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(privacy, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  assert.match(privacy, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
});
