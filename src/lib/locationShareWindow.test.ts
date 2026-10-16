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

test('the privacy manifest declares precise location and stays non-tracking', () => {
  const privacy = read('../../ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(privacy, /NSPrivacyCollectedDataTypePreciseLocation/);
  assert.equal(/NSPrivacyCollectedDataTypePurposeAdvertising/.test(privacy), false);
  assert.match(privacy, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  assert.equal(privacy.includes('<key>NSPrivacyCollectedDataTypes</key>\n\t<array/>'), false);
  for (const type of [
    'NSPrivacyCollectedDataTypePreciseLocation',
    'NSPrivacyCollectedDataTypeName',
    'NSPrivacyCollectedDataTypeEmailAddress',
    'NSPrivacyCollectedDataTypePhoneNumber',
    'NSPrivacyCollectedDataTypePhotosorVideos',
    'NSPrivacyCollectedDataTypeCrashData',
  ]) {
    assert.match(privacy, new RegExp(type));
  }
  assert.equal(privacy.includes('NSPrivacyCollectedDataTypePurposeAppFunctionality'), true);
  assert.equal(privacy.includes('NSPrivacyCollectedDataTypeTracking</key>\n\t\t\t<true/>'), false);
});

test('stale On My Way rows are closed by pg_cron, and the customer point goes stale', () => {
  const reaper = read('../../supabase/migrations/20261016180000_deactivate_stale_cleaner_locations.sql');
  const freshness = read('../../supabase/migrations/20261016180100_tracking_freshness_and_org.sql');
  assert.match(reaper, /deactivate_stale_cleaner_locations/);
  assert.match(reaper, /is_active = false/);
  assert.match(reaper, /created_at < now\(\) - interval '3 hours'/);
  assert.match(reaper, /recorded_at < now\(\) - interval '15 minutes'/);
  assert.match(reaper, /'\*\/5 \* \* \* \*'/);
  assert.match(reaper, /cron\.schedule/);
  assert.equal(reaper.includes('GRANT EXECUTE'), false);
  assert.match(freshness, /recorded_at >= now\(\) - interval '10 minutes'/);
  assert.match(freshness, /created_at >= now\(\) - interval '3 hours'/);
  assert.match(freshness, /NEW\.organization_id IS DISTINCT FROM booking_org/);
  assert.match(freshness, /tracking organization must match the booking/);
  assert.match(freshness, /REVOKE ALL ON FUNCTION public\.enforce_cleaner_location_tracking_organization\(\) FROM PUBLIC, anon, authenticated/);
  assert.equal(freshness.includes('GRANT EXECUTE ON FUNCTION public.enforce_cleaner_location_tracking_organization'), false);
  assert.match(freshness, /GRANT EXECUTE ON FUNCTION public\.customer_on_my_way_location\(text\) TO anon, authenticated/);

  const narrowed = read('../../supabase/migrations/20261016220000_stale_location_reaper_native_heartbeat_only.sql');
  assert.match(narrowed, /native_background boolean NOT NULL DEFAULT false/);
  assert.match(narrowed, /native_background = true/);
  assert.match(narrowed, /recorded_at < now\(\) - interval '15 minutes'/);
  assert.match(narrowed, /created_at < now\(\) - interval '3 hours'/);
  assert.equal(narrowed.includes("OR recorded_at < now() - interval '15 minutes'"), false);
  assert.equal(narrowed.includes('GRANT EXECUTE'), false);
  assert.match(narrowed, /REVOKE ALL ON FUNCTION public\.deactivate_stale_cleaner_locations\(\) FROM authenticated/);

  const claim = read('../../supabase/migrations/20261016220100_booking_reminder_log_arrival_unique.sql');
  assert.match(claim, /UNIQUE \(booking_id, reminder_type\)/);
  assert.match(claim, /booking_reminder_log_booking_id_reminder_type_key/);
  assert.equal(claim.includes('GRANT '), false);

  const arrival = read('../../supabase/functions/send-arrival-sms/index.ts');
  const claimAt = arrival.indexOf('claimArrivalSend(');
  const openPhoneAt = arrival.indexOf('api.openphone.com');
  assert.ok(claimAt !== -1 && openPhoneAt > claimAt);
  assert.match(arrival, /nextArrivalClaimAction/);
  assert.match(arrival, /status: 'pending'/);
  assert.match(arrival, /error\.code === '23505'/);
  assert.equal(arrival.includes('SMS sent but booking_reminder_log insert failed'), false);
  const decisionAt = arrival.indexOf('arrivalOpenPhoneClaim(openPhoneSends)');
  const markSentAt = arrival.indexOf("status: 'sent'");
  assert.ok(decisionAt !== -1 && markSentAt > decisionAt);
  const failureSlice = arrival.slice(decisionAt, markSentAt);
  assert.match(failureSlice, /success: false/);
  assert.match(failureSlice, /Arrival text failed/);
  assert.match(failureSlice, /releaseArrivalClaim/);
  assert.equal(failureSlice.includes("status: 'sent'"), false);
});
