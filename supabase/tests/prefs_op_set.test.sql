-- A preference domain keeps the newest copy, whichever device saves last
-- (supabase/migrations/20261020140000_prefs_op_set.sql).
--
-- Cast: U saves from two devices; V is someone else.

SELECT test.person(n) FROM unnest(ARRAY['U', 'V']) AS n;

CREATE FUNCTION test.set_pref(p_who text, p_domain text, p_value jsonb, p_at timestamptz) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT public.prefs_op_set(%L, %L::jsonb, %L::timestamptz)::text$q$,
    p_domain, p_value, p_at))::jsonb
$$;

DO $$
DECLARE
  v jsonb;
  r text;
BEGIN
  v := test.set_pref('U', 'appearance', '{"theme": "dark"}', '2026-10-01T10:00:00Z');
  PERFORM test.ok(v -> 'appearance' = '{"theme": "dark"}'::jsonb
              AND (v ->> 'appearance_updated_at')::timestamptz = '2026-10-01T10:00:00Z',
    'the first save makes the row and answers it', v::text);

  -- An older copy (a laptop back online) doesn't replace the newer one.
  v := test.set_pref('U', 'appearance', '{"theme": "light"}', '2026-10-01T09:00:00Z');
  PERFORM test.ok(v -> 'appearance' = '{"theme": "dark"}'::jsonb
              AND (v ->> 'appearance_updated_at')::timestamptz = '2026-10-01T10:00:00Z',
    'an older copy is refused and the answer is the newer one', v::text);
  PERFORM test.ok((SELECT appearance FROM public.user_preferences WHERE user_id = test.id('U'))
                  = '{"theme": "dark"}'::jsonb, 'the stored copy is still the newer one');

  v := test.set_pref('U', 'appearance', '{"theme": "light"}', '2026-10-01T11:00:00Z');
  PERFORM test.ok(v -> 'appearance' = '{"theme": "light"}'::jsonb
              AND (v ->> 'appearance_updated_at')::timestamptz = '2026-10-01T11:00:00Z',
    'a newer copy replaces it', v::text);

  -- Another domain on the same row starts as {} stamped with the row's
  -- creation; a first save with an earlier stamp (offline edits) still lands.
  v := test.set_pref('U', 'focus', '{"minutes": 50}', '2026-01-01T00:00:00Z');
  PERFORM test.ok(v -> 'focus' = '{"minutes": 50}'::jsonb
              AND v -> 'appearance' = '{"theme": "light"}'::jsonb,
    'a never-saved domain takes any stamp, and other domains are untouched', v::text);
  v := test.set_pref('U', 'focus', '{"minutes": 25}', '2025-12-31T00:00:00Z');
  PERFORM test.ok(v -> 'focus' = '{"minutes": 50}'::jsonb, 'once saved, the rule holds for it too', v::text);

  v := test.set_pref('V', 'appearance', '{"theme": "sepia"}', '2026-10-02T00:00:00Z');
  PERFORM test.ok(v -> 'appearance' = '{"theme": "sepia"}'::jsonb
              AND (SELECT appearance FROM public.user_preferences WHERE user_id = test.id('U'))
                  = '{"theme": "light"}'::jsonb,
    'each person writes only their own row');

  -- A device whose clock runs a day ahead is stored at the server's now, so
  -- the next real save from another device still wins.
  v := test.set_pref('U', 'calendar', '{"week": "mon"}', now() + interval '1 day');
  PERFORM test.ok((v ->> 'calendar_updated_at')::timestamptz <= now(),
    'a stamp from the future is stored as now', v::text);

  r := test.try('U', $q$SELECT public.prefs_op_set('user_id', '{}'::jsonb, now())$q$);
  PERFORM test.ok(r LIKE '22023%Unknown preference domain%', 'an unknown domain is refused', r);
  r := test.try('U', $q$SELECT public.prefs_op_set('focus', '{}'::jsonb, NULL)$q$);
  PERFORM test.ok(r LIKE '22023%', 'a write without its time is refused', r);
  r := test.try(NULL, $q$SELECT public.prefs_op_set('focus', '{}'::jsonb, now())$q$);
  PERFORM test.ok(r LIKE '42501%', 'signed out, nothing is saved', r);
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.prefs_op_set(text, jsonb, timestamptz)', 'EXECUTE'),
    'anon cannot call it');
END;
$$;
