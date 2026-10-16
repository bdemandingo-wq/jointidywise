-- One-time "how did you hear about us?" write for an org owner.
--
-- authenticated cannot UPDATE organizations in general (table UPDATE was
-- revoked; only a few columns were re-granted). This function is the late
-- answer path: the caller must own the org, the value must be on the list,
-- and an existing howHeard answer is never overwritten.
--
-- Run after 20260814011951 (onboarding_answers column).
-- Does not send email, SMS, or push. Does not touch Stripe.
--
-- Verification (as the org owner, not the SQL editor superuser):
--   1. select public.save_how_heard('tiktok', null);
--      select onboarding_answers -> 'howHeard', onboarding_answers ->> 'howHeardAskedAt'
--      from public.organizations where owner_id = auth.uid();
--      -- howHeard is ["tiktok"], howHeardAskedAt is set
--   2. select public.save_how_heard('reddit', null);
--      -- howHeard is still ["tiktok"]
--   3. select public.save_how_heard('billboard', null);  -- 22023
--   4. select public.save_how_heard('other', '   ');     -- 22023
--   5. On an org whose howHeard is empty:
--      select public.save_how_heard('not_sure', null);
--      -- howHeard stays empty, howHeardAskedAt is set
--   6. As a non-owner member: the same call changes zero rows.

CREATE OR REPLACE FUNCTION public.how_heard_is_present(p_answers jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_answers IS NULL THEN false
    WHEN jsonb_typeof(p_answers -> 'howHeard') = 'string'
      THEN btrim(p_answers ->> 'howHeard') <> ''
    WHEN jsonb_typeof(p_answers -> 'howHeard') = 'array' THEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(p_answers -> 'howHeard') AS heard(value)
      WHERE btrim(value) <> ''
    )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.how_heard_is_present(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_how_heard(
  p_value text,
  p_other text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_value text := lower(btrim(COALESCE(p_value, '')));
  v_other text := left(btrim(COALESCE(p_other, '')), 200);
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF v_value NOT IN (
    'tiktok', 'instagram', 'facebook', 'reddit', 'google', 'referral', 'other', 'not_sure'
  ) THEN
    RAISE EXCEPTION 'how heard value is not allowed'
      USING ERRCODE = '22023';
  END IF;

  IF v_value = 'other' AND v_other = '' THEN
    RAISE EXCEPTION 'how heard other text is required'
      USING ERRCODE = '22023';
  END IF;

  -- Owner only. Writes the source only while howHeard is empty, and always
  -- records that we asked so Not sure does not come back on the next device.
  UPDATE public.organizations AS org
  SET onboarding_answers =
    COALESCE(org.onboarding_answers, '{}'::jsonb)
    || CASE
      WHEN v_value = 'not_sure' THEN '{}'::jsonb
      ELSE jsonb_build_object('howHeard', jsonb_build_array(v_value))
    END
    || CASE
      WHEN v_value = 'other' THEN jsonb_build_object('howHeardOther', v_other)
      WHEN v_value = 'not_sure' THEN '{}'::jsonb
      ELSE jsonb_build_object('howHeardOther', ''::text)
    END
    || jsonb_build_object('howHeardAskedAt', to_jsonb(now()))
  WHERE org.owner_id = v_uid
    AND NOT public.how_heard_is_present(org.onboarding_answers);
END;
$$;

REVOKE ALL ON FUNCTION public.save_how_heard(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_how_heard(text, text) TO authenticated;

COMMENT ON FUNCTION public.save_how_heard(text, text) IS
  'Owner-only. Saves a single howHeard slug (or Not sure) onto organizations the caller owns, and only when howHeard is still empty. Sets howHeardAskedAt. Other requires non-blank text, capped at 200 characters. Does not grant a general organizations update.';
