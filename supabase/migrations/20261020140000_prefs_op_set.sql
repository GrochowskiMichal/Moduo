-- Preferences: last write wins on the server, not on whichever device saves last.
--
-- The app saved a preference domain with a plain upsert on user_id, so a
-- device that comes back online with an older copy overwrote a newer one
-- saved from another device. prefs_op_set(domain, value, updated_at) writes a
-- domain only when the incoming stamp is newer than the stored one (or the
-- stored value is still the empty {} a fresh row starts with), in one
-- statement, and answers the row as it stands afterwards, so the caller sees
-- which copy won. A stamp from the future (a device clock running ahead) is
-- stored as the server's now, so that device can't win every write after it.
--
-- Runs as the caller (RLS: user_preferences_own), for the signed-in user only.
-- Verified on the local stack by supabase/tests/prefs_op_set.test.sql.

CREATE OR REPLACE FUNCTION public.prefs_op_set(p_domain text, p_value jsonb, p_updated_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_row jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to save preferences.' USING ERRCODE = '42501';
  END IF;
  IF p_domain IS NULL OR p_domain NOT IN ('appearance', 'focus', 'calendar', 'email', 'preferences') THEN
    RAISE EXCEPTION 'Unknown preference domain: %', coalesce(p_domain, 'nothing') USING ERRCODE = '22023';
  END IF;
  IF p_updated_at IS NULL THEN
    RAISE EXCEPTION 'A preference write needs its time.' USING ERRCODE = '22023';
  END IF;

  -- The domain name is checked against the list above; %I quotes it anyway.
  EXECUTE format(
    'INSERT INTO public.user_preferences AS up (user_id, %1$I, %2$I)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET %1$I = excluded.%1$I, %2$I = excluded.%2$I
       WHERE up.%2$I < excluded.%2$I OR up.%1$I = ''{}''::jsonb',
    p_domain, p_domain || '_updated_at')
  USING v_user, coalesce(p_value, '{}'::jsonb), least(p_updated_at, now());

  SELECT jsonb_build_object(
    'appearance', up.appearance, 'appearance_updated_at', up.appearance_updated_at,
    'focus', up.focus, 'focus_updated_at', up.focus_updated_at,
    'calendar', up.calendar, 'calendar_updated_at', up.calendar_updated_at,
    'email', up.email, 'email_updated_at', up.email_updated_at,
    'preferences', up.preferences, 'preferences_updated_at', up.preferences_updated_at)
  INTO v_row
  FROM public.user_preferences up
  WHERE up.user_id = v_user;
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.prefs_op_set(text, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prefs_op_set(text, jsonb, timestamptz) TO authenticated, service_role;
