-- Lock client-portal SECURITY DEFINER RPCs to service_role.
--
-- Do NOT apply 20260716140000_lockdown_client_portal_rpc_execute.sql on a
-- database that already has 20260727094415. That file's header says
-- "DO NOT APPLY until confirmed," and its REVOKE for
-- add_client_portal_location targets the old 8-argument signature.
-- 20260727094415 DROP+CREATE replaced that signature with one that also
-- takes latitude/longitude and GRANTed the new function to anon and
-- authenticated. Applying the old file fails (function does not exist)
-- and never revokes the live overload.
--
-- 20260715181351 already revoked nine of the original ten (not
-- create_client_portal_referral). 20260718090000 locked the referral RPC.
-- 20260729185927 then GRANTed several sibling portal RPCs back to anon;
-- 20260729190139 revoked those again. Migration history is not proof any
-- of that ran. This migration is the one to apply: it walks pg_proc by
-- name, so every live overload is locked, missing functions are skipped,
-- and re-running it is safe.
--
-- The only legitimate caller is the client-portal-api edge function, which
-- verifies the portal session and then calls these with the service-role
-- client. Confirm that function is deployed before applying this, or the
-- client portal stops loading.
--
-- create_client_portal_user is intentionally absent. The admin UI calls
-- that RPC with the signed-in user's JWT.

DO $$
DECLARE
  fn text;
  sig regprocedure;
  names text[] := ARRAY[
    'get_client_portal_bookings',
    'get_client_portal_user_data',
    'get_client_portal_requests',
    'get_client_portal_notifications',
    'get_client_portal_locations',
    'get_client_tax_report',
    'update_client_portal_profile',
    'add_client_portal_location',
    'create_client_portal_referral',
    'update_client_portal_last_login',
    'change_client_portal_password',
    'client_cancel_booking',
    'delete_client_portal_location',
    'delete_client_portal_notification',
    'delete_client_booking_request',
    'mark_client_notification_read',
    'submit_client_booking_request',
    'update_client_portal_location',
    'get_loyalty_tier_info'
  ];
BEGIN
  FOREACH fn IN ARRAY names LOOP
    FOR sig IN
      SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = fn
    LOOP
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        sig
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO service_role',
        sig
      );
    END LOOP;
  END LOOP;
END $$;
