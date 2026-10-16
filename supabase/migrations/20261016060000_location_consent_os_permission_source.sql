-- Allow the On My Way OS-permission consent source.
--
-- Run this file in the Supabase SQL editor. A git push does not apply it.
-- Safe if 20261016050000_location_share_window.sql already ran, and safe to
-- run again. The consent log stays append-only. first_run_sheet and settings
-- remain valid for older rows. New On My Way grants use os_permission.

ALTER TABLE public.cleaner_location_consents
  DROP CONSTRAINT IF EXISTS cleaner_location_consents_source_chk;

ALTER TABLE public.cleaner_location_consents
  ADD CONSTRAINT cleaner_location_consents_source_chk
  CHECK (source IN ('first_run_sheet', 'settings', 'os_permission'));
