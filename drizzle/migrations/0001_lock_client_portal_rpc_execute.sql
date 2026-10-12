DO $$
DECLARE
  fn text;
  sig regprocedure;
  names text[] := ARRAY[
    'get_client_portal_bookings','get_client_portal_user_data','get_client_portal_requests',
    'get_client_portal_notifications','get_client_portal_locations','get_client_tax_report',
    'update_client_portal_profile','add_client_portal_location','create_client_portal_referral',
    'update_client_portal_last_login','change_client_portal_password','client_cancel_booking',
    'delete_client_portal_location','delete_client_portal_notification','delete_client_booking_request',
    'mark_client_notification_read','submit_client_booking_request','update_client_portal_location',
    'get_loyalty_tier_info'
  ];
BEGIN
  FOREACH fn IN ARRAY names LOOP
    FOR sig IN
      SELECT p.oid::regprocedure FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    END LOOP;
  END LOOP;
END $$;