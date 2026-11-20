-- The connector's two new calendar reads (CALR-21, specs/calendar-rethink.md
-- AC46 and §Assumptions "MCP tools"), both key-aware (calendar_module_permission
-- and perm_actor_id() through calendar__viewer), so an assistant reads exactly
-- what its person would:
--
--   * calendar_who_sees(ws, p_event_id): who sees what of your calendars, one
--     row per calendar and teammate: 'all', 'busy', 'focus_time' or 'nothing'.
--     With an event, that event's calendar only, through the event's own
--     masking (private reads Busy to everyone, focus time "Focus time"). Only
--     your own events on your own calendars; nothing for a key without Calendar.
--   * calendar_event_occurrences(ws, from, to): every occurrence in the window
--     of the events the masked read returns (repeats expanded in the owner's
--     zone, exdates skipped), as (event_id, starts_at, ends_at). Busy only
--     calendars stay out (they are busy blocks), and a window past a year is
--     refused.
--
-- Cast: O owns workspace W (zone Europe/Warsaw). O's Work (CW): K All details,
-- B Busy only, N nothing, X All details but without the Calendar module.
-- O's Family (CF): Busy only for everyone. K owns Kai work (CK). KO is O's
-- Calendar key, KB is B's, KT is O's Tasks-only key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'K', 'B', 'N', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('N'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role, overrides) VALUES
  (test.id('W'), test.id('X'), 'member', '{"calendar.view": false}'::jsonb);
INSERT INTO public.user_preferences (user_id, time_zone) VALUES (test.id('O'), 'Europe/Warsaw')
ON CONFLICT (user_id) DO UPDATE SET time_zone = EXCLUDED.time_zone;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom'),
  (test.id('CF'), test.id('W'), test.id('O'), 'Family', 'custom'),
  (test.id('CK'), test.id('W'), test.id('K'), 'Kai work', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), test.id('CF'), test.id('CK'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('K'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('B'), 'freebusy', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('X'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CF'), 'workspace', NULL, 'freebusy', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KO'), test.id('W'), 'O agent', 'mdo_ko21', md5('db-test-ko21'), '{"calendar": "view"}'::jsonb, test.id('O')),
  (test.id('KB'), test.id('W'), 'B agent', 'mdo_kb21', md5('db-test-kb21'), '{"calendar": "view"}'::jsonb, test.id('B')),
  (test.id('KT'), test.id('W'), 'O tasks', 'mdo_kt21', md5('db-test-kt21'), '{"tasks": "view"}'::jsonb, test.id('O'));

CREATE FUNCTION pg_temp.make(p_who text, p_title text, p_start text, p_end text, p_cal text,
  p_rrule text DEFAULT NULL, p_private boolean DEFAULT false, p_kind text DEFAULT 'event') RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => %L, p_starts_at => %L, p_ends_at => %L, p_rrule => %L, p_calendar_id => %L,
    p_is_private => %L, p_kind => %L)$q$,
    md5('db-test:W')::uuid, p_title, p_start, p_end, p_rrule, md5('db-test:' || p_cal)::uuid, p_private, p_kind))
$$;
CREATE FUNCTION pg_temp.event(p_title text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid AND title = p_title
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.make('O', 'Board review', '2026-11-04 10:00+00', '2026-11-04 11:00+00', 'CW') = 'ok 1', 'O: Board review on Work');
  PERFORM test.ok(pg_temp.make('O', 'Therapy', '2026-11-03 17:00+00', '2026-11-03 18:00+00', 'CW', NULL, true) = 'ok 1', 'Therapy, private');
  PERFORM test.ok(pg_temp.make('O', 'Deep work', '2026-11-05 08:00+00', '2026-11-05 10:00+00', 'CW', NULL, false, 'focus') = 'ok 1', 'Deep work, focus time');
  -- Tuesdays at 11:00 Warsaw: 09:00 UTC before the clocks go back on 25 Oct, 10:00 UTC after.
  PERFORM test.ok(pg_temp.make('O', '1:1 with Priya', '2026-10-06 09:00+00', '2026-10-06 09:30+00', 'CW', 'FREQ=WEEKLY') = 'ok 1', 'a weekly 1:1 since October');
  PERFORM test.ok(pg_temp.make('O', 'School run', '2026-11-03 07:00+00', '2026-11-03 07:30+00', 'CF') = 'ok 1', 'School run on Family');
  PERFORM test.ok(pg_temp.make('K', 'Kai planning', '2026-11-04 15:00+00', '2026-11-04 16:00+00', 'CK') = 'ok 1', 'K''s own event on K''s calendar');
  -- The 10 Nov occurrence is skipped.
  UPDATE public.calendar_events SET exdates = ARRAY['2026-11-10 10:00+00'::timestamptz]
   WHERE id = pg_temp.event('1:1 with Priya');
END;
$$;

-- who_sees as one line: "calendar:person:sees,…" for the named people.
CREATE FUNCTION pg_temp.sees(p_key text, p_event text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
  r text;
BEGIN
  r := test.as_key(p_key, format($q$CREATE TEMP TABLE IF NOT EXISTS who_out AS SELECT * FROM public.calendar_who_sees(%L, %L) LIMIT 0;
    INSERT INTO who_out SELECT * FROM public.calendar_who_sees(%L, %L)$q$,
    md5('db-test:W')::uuid, pg_temp.event(p_event), md5('db-test:W')::uuid, pg_temp.event(p_event)));
  IF r NOT LIKE 'ok %' THEN
    RETURN r;
  END IF;
  SELECT string_agg(c.name || ':' || p.display_name || ':' || w.sees, ',' ORDER BY c.name, p.display_name) INTO v
    FROM who_out w
    JOIN public.calendars c ON c.id = w.calendar_id
    JOIN public.profiles p ON p.id = w.user_id
   WHERE p.display_name IN ('K', 'B', 'N', 'X');
  DELETE FROM who_out;
  RETURN coalesce(v, '');
END;
$$;

DO $$
DECLARE
  r text;
BEGIN
  -- Without an event: every calendar O owns, at each teammate's level.
  r := pg_temp.sees('KO', NULL);
  PERFORM test.ok(r LIKE '%Work:K:all%' AND r LIKE '%Work:B:busy%' AND r LIKE '%Work:N:nothing%',
    'who_sees: All details is all, Busy only busy, no grant nothing', r);
  PERFORM test.ok(r LIKE '%Work:X:nothing%', 'a teammate without the Calendar module sees nothing, whatever the grant', r);
  PERFORM test.ok(r LIKE '%Family:K:busy%' AND r LIKE '%Family:N:busy%' AND r LIKE '%Family:X:nothing%',
    'Busy only for everyone reaches every teammate with Calendar', r);
  PERFORM test.ok(r NOT LIKE '%Kai work%', 'only O''s own calendars', r);
  PERFORM test.ok(r NOT LIKE '%:O:%', 'and never O itself', r);

  -- With an event: that calendar, through the event's own mask.
  r := pg_temp.sees('KO', 'Board review');
  PERFORM test.ok(r = 'Work:B:busy,Work:K:all,Work:N:nothing,Work:X:nothing', 'a public event: each level as it is', r);
  r := pg_temp.sees('KO', 'Therapy');
  PERFORM test.ok(r = 'Work:B:busy,Work:K:busy,Work:N:nothing,Work:X:nothing', 'a private event reads Busy even at All details', r);
  r := pg_temp.sees('KO', 'Deep work');
  PERFORM test.ok(r = 'Work:B:focus_time,Work:K:focus_time,Work:N:nothing,Work:X:nothing', 'focus time reads "Focus time"', r);

  -- Not O's: refused with one answer.
  r := pg_temp.sees('KO', 'Kai planning');
  PERFORM test.ok(r LIKE '%Event not found in this workspace.%', 'a teammate''s event says nothing about its sharing', r);
  -- A key without Calendar: nothing at all.
  r := test.as_key('KT', format($q$SELECT * FROM public.calendar_who_sees(%L, NULL)$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 0', 'a key without Calendar reads no sharing', r);
  -- The signed-in person reads the same as their key.
  r := test.as_user('O', format($q$SELECT * FROM public.calendar_who_sees(%L, %L) WHERE sees = 'all'$q$,
    test.id('W'), pg_temp.event('Board review')));
  PERFORM test.ok(r = 'ok 1', 'O signed in: one teammate sees Board review in full', r);
END;
$$;

-- Occurrences as one line: "title@start,…" for a key's read.
CREATE FUNCTION pg_temp.occ(p_key text, p_from text, p_to text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
  r text;
BEGIN
  r := test.as_key(p_key, format($q$CREATE TEMP TABLE IF NOT EXISTS occ_out AS SELECT * FROM public.calendar_event_occurrences(%L, %L, %L) LIMIT 0;
    INSERT INTO occ_out SELECT * FROM public.calendar_event_occurrences(%L, %L, %L)$q$,
    md5('db-test:W')::uuid, p_from, p_to, md5('db-test:W')::uuid, p_from, p_to));
  IF r NOT LIKE 'ok %' THEN
    RETURN r;
  END IF;
  SELECT string_agg(e.title || '@' || to_char(o.starts_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI') || '-'
                    || to_char(o.ends_at AT TIME ZONE 'UTC', 'HH24:MI'), ',' ORDER BY o.starts_at, e.title) INTO v
    FROM occ_out o JOIN public.calendar_events e ON e.id = o.event_id;
  DELETE FROM occ_out;
  RETURN coalesce(v, '');
END;
$$;

DO $$
DECLARE
  r text;
BEGIN
  r := pg_temp.occ('KO', '2026-11-02 00:00+00', '2026-11-16 00:00+00');
  PERFORM test.ok(r LIKE '%1:1 with Priya@11-03 10:00-10:30%',
    'occurrences: a weekly series from October lands on 3 Nov at 11:00 Warsaw (10:00 UTC after the change)', r);
  PERFORM test.ok(r NOT LIKE '%1:1 with Priya@11-10%', 'an exdate is skipped', r);
  PERFORM test.ok(r NOT LIKE '%1:1 with Priya@10-%', 'nothing before the window', r);
  PERFORM test.ok(r LIKE '%Board review@11-04 10:00-11:00%' AND r LIKE '%Therapy@11-03 17:00-18:00%',
    'one-offs in the window come once each', r);
  PERFORM test.ok(r LIKE '%School run@11-03 07:00-07:30%', 'O''s own Family events too', r);
  PERFORM test.ok(r NOT LIKE '%Kai planning%', 'a calendar O can''t see stays out', r);

  -- B has Work at Busy only: those are busy blocks, not events.
  r := pg_temp.occ('KB', '2026-11-02 00:00+00', '2026-11-16 00:00+00');
  PERFORM test.ok(r NOT LIKE '%Board review%' AND r NOT LIKE '%1:1 with Priya%', 'a Busy only calendar''s events stay out', r);

  r := test.as_key('KT', format($q$SELECT * FROM public.calendar_event_occurrences(%L, '2026-11-02 00:00+00', '2026-11-16 00:00+00')$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 0', 'a key without Calendar reads no occurrences', r);
  r := test.as_key('KO', format($q$SELECT * FROM public.calendar_event_occurrences(%L, '2026-01-01 00:00+00', '2027-06-01 00:00+00')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%at most a year%', 'a window longer than a year is refused', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar_who_sees(uuid, uuid)', 'EXECUTE'), 'anon can''t call calendar_who_sees');
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar_event_occurrences(uuid, timestamptz, timestamptz)', 'EXECUTE'), 'anon can''t call calendar_event_occurrences');
  PERFORM test.ok(has_function_privilege('authenticated', 'public.calendar_who_sees(uuid, uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.calendar_event_occurrences(uuid, timestamptz, timestamptz)', 'EXECUTE'),
    'the app and the connector can');
END;
$$;
