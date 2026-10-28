-- Busy blocks name their owner (CALR-16, specs/calendar-rethink.md AC30,
-- AC19, §Sharing "Shared with you"). calendar_busy_blocks(ws, from, to) is
-- the Busy only stream: one row per occurrence on a calendar the reader can
-- see as busy but not in full, now with the calendar's owner (whose lane it
-- is), the item's kind (focus and holds), and all-day, and with repeats
-- expanded on the server in the owner's zone: every occurrence in the window,
-- none on an exdate (a deleted occurrence, or one an override replaced), and
-- the override at its own time. calendar_shared_with_me(ws) lists the
-- teammates' calendars the reader can see, at their level.
--
-- Cast: O owns workspace W and lives in Europe/Warsaw (clocks went back on
-- 25 Oct). O's calendars: Work (CW) — K at All details (view), B at Busy only
-- (freebusy), E can edit; Family (CF) is Busy only for everyone; Holidays (CH)
-- isn't shared. N is a member nothing is shared with. KB is B's API key with
-- Calendar, KX B's key without it.

SELECT test.person(n) FROM unnest(ARRAY['O', 'K', 'B', 'E', 'N']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('N'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_preferences (user_id, time_zone) VALUES (test.id('O'), 'Europe/Warsaw')
ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom'),
  (test.id('CF'), test.id('W'), test.id('O'), 'Family', 'custom'),
  (test.id('CH'), test.id('W'), test.id('O'), 'Holidays', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), test.id('CF'), test.id('CH'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('K'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('B'), 'freebusy', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'calendar', test.id('CF'), 'workspace', NULL, 'freebusy', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KB'), test.id('W'), 'B agent', 'mdo_kb', md5('db-test-kb'), '{"calendar": "view"}'::jsonb, test.id('B')),
  (test.id('KX'), test.id('W'), 'B tasks', 'mdo_kx', md5('db-test-kx'), '{"tasks": "view"}'::jsonb, test.id('B'));

CREATE FUNCTION pg_temp.make(p_who text, p_title text, p_start text, p_end text, p_cal text,
  p_rrule text DEFAULT NULL, p_private boolean DEFAULT false, p_kind text DEFAULT 'event',
  p_all_day boolean DEFAULT false) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => %L, p_starts_at => %L, p_ends_at => %L, p_all_day => %L, p_rrule => %L,
    p_calendar_id => %L, p_is_private => %L, p_kind => %L)$q$,
    md5('db-test:W')::uuid, p_title, p_start, p_end, p_all_day, p_rrule, md5('db-test:' || p_cal)::uuid,
    p_private, p_kind))
$$;
CREATE FUNCTION pg_temp.ev(p_title text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid AND title = p_title
    AND series_id IS NULL
$$;

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(pg_temp.make('O', 'Investor prep', '2026-11-03 10:00+00', '2026-11-03 11:00+00', 'CW') = 'ok 1',
    'O: a one-off on Work');
  -- 09:00 in Warsaw, set up in October's summer time (07:00 UTC). After the
  -- clocks went back it is still 09:00 in Warsaw, which is 08:00 UTC.
  PERFORM test.ok(pg_temp.make('O', 'Standup', '2026-10-06 07:00+00', '2026-10-06 07:15+00', 'CW', 'FREQ=WEEKLY') = 'ok 1',
    'a weekly Standup that started weeks ago, in summer time');
  PERFORM test.ok(pg_temp.make('O', 'Daily sync', '2026-11-02 12:00+00', '2026-11-02 12:30+00', 'CW', 'FREQ=DAILY') = 'ok 1',
    'a daily sync from Monday');
  PERFORM test.ok(pg_temp.make('O', 'Kickoff', '2026-10-01 10:00+00', '2026-10-01 11:00+00', 'CW', 'FREQ=DAILY;COUNT=2') = 'ok 1',
    'a repeat that ended in October');
  PERFORM test.ok(pg_temp.make('O', 'Therapy', '2026-11-03 17:00+00', '2026-11-03 18:00+00', 'CW', NULL, true) = 'ok 1',
    'a private event on Work');
  PERFORM test.ok(pg_temp.make('O', 'Deep work', '2026-11-04 14:00+00', '2026-11-04 16:00+00', 'CW', NULL, false, 'focus') = 'ok 1',
    'focus time on Work');
  PERFORM test.ok(pg_temp.make('O', 'Offsite', '2026-11-06 00:00+00', '2026-11-07 00:00+00', 'CW', NULL, false, 'event', true) = 'ok 1',
    'an all-day offsite on Work');
  PERFORM test.ok(pg_temp.make('O', 'Gone', '2026-11-03 13:00+00', '2026-11-03 14:00+00', 'CW') = 'ok 1',
    'an event O will delete');
  PERFORM test.ok(pg_temp.make('O', 'School run', '2026-11-03 08:00+00', '2026-11-03 08:30+00', 'CF') = 'ok 1',
    'one on Family');
  PERFORM test.ok(pg_temp.make('O', 'Ski trip', '2026-11-04 08:00+00', '2026-11-04 09:00+00', 'CH') = 'ok 1',
    'one on Holidays');
  PERFORM test.ok(pg_temp.make('E', 'Vendor call', '2026-11-05 09:00+00', '2026-11-05 09:30+00', 'CW') = 'ok 1',
    'E, who can edit Work, puts a call on it');

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_delete(%L, %L)$q$, test.id('W'), pg_temp.ev('Gone')));
  PERFORM test.ok(r = 'ok 1', 'O deletes Gone', r);
  -- Daily sync: Wednesday's occurrence deleted, Thursday's moved to 15:00.
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_occurrence_delete(%L, %L, '2026-11-04 12:00+00')$q$,
    test.id('W'), pg_temp.ev('Daily sync')));
  PERFORM test.ok(r = 'ok 1', 'O deletes Wednesday''s Daily sync, This event', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_occurrence_update(%L, %L, '2026-11-05 12:00+00',
    '{"startsAt": "2026-11-05T15:00:00Z", "endsAt": "2026-11-05T15:30:00Z"}'::jsonb)$q$,
    test.id('W'), pg_temp.ev('Daily sync')));
  PERFORM test.ok(r = 'ok 1', 'and moves Thursday''s to 15:00, This event', r);
END;
$$;

-- A reader's busy blocks over the test week, as SQL text.
CREATE FUNCTION pg_temp.blocks(p_select text, p_where text DEFAULT 'true') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT %s FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') b WHERE %s$q$,
    p_select, md5('db-test:W')::uuid, p_where)
$$;
CREATE FUNCTION pg_temp.starts(p_who text, p_where text DEFAULT 'true') RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, pg_temp.blocks(
    $s$string_agg(to_char(b.start_time AT TIME ZONE 'UTC', 'Dy DD HH24:MI'), ',' ORDER BY b.start_time)$s$, p_where)), '')
$$;

-- Busy only on Work: every occurrence, at the right instant, with its owner.
DO $$
DECLARE
  r text;
BEGIN
  r := pg_temp.starts('B', format('b.calendar_id = %L AND NOT b.all_day', test.id('CW')));
  PERFORM test.ok(r = 'Mon 02 12:00,Tue 03 08:00,Tue 03 10:00,Tue 03 12:00,Tue 03 17:00,Wed 04 14:00,Thu 05 09:00,Thu 05 15:00,Fri 06 12:00,Sat 07 12:00,Sun 08 12:00',
    'B (Busy only on Work) gets every timed block of the week: repeats expanded, the deleted occurrence and the moved one''s old time gone, the override at 15:00, nothing deleted, nothing from an ended repeat', r);
  r := pg_temp.starts('B', format('b.calendar_id = %L AND b.start_time = %L', test.id('CW'), '2026-11-03 08:00+00'));
  PERFORM test.ok(r = 'Tue 03 08:00',
    'the weekly Standup lands at 09:00 Warsaw time (08:00 UTC after the clock change), not at its summer 07:00 UTC', r);
  PERFORM test.ok(test.value_as('B', pg_temp.blocks('count(*)', $w$b.start_time = '2026-11-03 07:00+00'$w$)) = '0',
    'and never at the unshifted 07:00 UTC');
  r := test.value_as('B', pg_temp.blocks('count(DISTINCT b.owner_id)::text || '':'' || min(b.owner_id::text)', format('b.calendar_id = %L', test.id('CW'))));
  PERFORM test.ok(r = '1:' || test.id('O')::text,
    'every Work block names O, the calendar''s owner, as whose lane it is (E''s call on it too)', r);
  r := test.value_as('B', pg_temp.blocks('b.end_time::text', $w$b.start_time = '2026-11-05 15:00+00'$w$));
  PERFORM test.ok(r::timestamptz = '2026-11-05 15:30+00', 'the override keeps its own end', r);
  r := test.value_as('B', pg_temp.blocks('b.end_time::text', format('b.calendar_id = %L AND b.start_time = %L', test.id('CW'), '2026-11-03 08:00+00')));
  PERFORM test.ok(r::timestamptz = '2026-11-03 08:15+00', 'an occurrence keeps the series'' length', r);
  r := test.value_as('B', pg_temp.blocks('b.kind', $w$b.start_time = '2026-11-04 14:00+00'$w$));
  PERFORM test.ok(r = 'focus', 'focus time says it is focus time (the composer''s "in focus time")', coalesce(r, 'null'));
  r := test.value_as('B', pg_temp.blocks('string_agg(DISTINCT b.kind, '','')', format('b.calendar_id = %L AND b.start_time <> %L', test.id('CW'), '2026-11-04 14:00+00')));
  PERFORM test.ok(r = 'event', 'everything else on Work is an event', r);
  r := test.value_as('B', pg_temp.blocks($s$count(*)::text || ':' || bool_and(b.all_day)::text$s$, format('b.calendar_id = %L AND b.all_day', test.id('CW'))));
  PERFORM test.ok(r = '1:true', 'the all-day offsite is one block marked all-day', r);
  PERFORM test.ok(test.value_as('B', pg_temp.blocks('count(*)', $w$b.start_time = '2026-11-03 17:00+00'$w$)) = '1',
    'a private event is still busy time');
END;
$$;

-- Who gets which blocks.
DO $$
DECLARE
  r text;
BEGIN
  r := pg_temp.starts('K', format('b.calendar_id = %L', test.id('CW')));
  PERFORM test.ok(r = '', 'K sees Work in full (the masked read), so no Work busy blocks', r);
  r := pg_temp.starts('K', format('b.calendar_id = %L', test.id('CF')));
  PERFORM test.ok(r = 'Tue 03 08:00', 'but Family, Busy only for everyone, as a block', r);
  r := test.value_as('K', pg_temp.blocks('b.owner_id::text', format('b.calendar_id = %L', test.id('CF'))));
  PERFORM test.ok(r = test.id('O')::text, 'owned by O', r);
  PERFORM test.ok(pg_temp.starts('B', format('b.calendar_id = %L', test.id('CH'))) = ''
              AND pg_temp.starts('K', format('b.calendar_id = %L', test.id('CH'))) = '',
    'Holidays isn''t shared: no blocks for anyone');
  r := pg_temp.starts('N');
  PERFORM test.ok(r = 'Tue 03 08:00', 'N, with nothing of their own, gets only Everyone else''s Family block', r);
  PERFORM test.ok(pg_temp.starts('O') = '', 'O reads no busy blocks of their own calendars');
  PERFORM test.ok(pg_temp.starts('E', format('b.calendar_id = %L', test.id('CW'))) = '',
    'E, who can edit Work, reads it in full, not as blocks');
END;
$$;

-- An assistant reads blocks only with Calendar, through its person's eyes.
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_key('KB', format($q$SELECT 1 FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') b
    WHERE b.calendar_id = %L$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 12', 'B''s key with Calendar reads B''s twelve Work blocks (eleven timed, one all-day)', r);
  r := test.as_key('KX', format($q$SELECT 1 FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') b$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 0', 'a key without Calendar reads no busy blocks at all', r);
END;
$$;

-- Shared with you: the teammates' calendars a reader can see, at their level.
CREATE FUNCTION pg_temp.shared(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format(
    $q$SELECT string_agg(c.name || ':' || s.level || ':' || (s.owner_id = %L)::text, ',' ORDER BY c.name)
       FROM public.calendar_shared_with_me(%L) s JOIN public.calendars c ON c.id = s.calendar_id
       WHERE c.id IN (%L, %L, %L)$q$,
    md5('db-test:O')::uuid, md5('db-test:W')::uuid, md5('db-test:CW')::uuid, md5('db-test:CF')::uuid, md5('db-test:CH')::uuid)), '')
$$;

DO $$
DECLARE
  r text;
BEGIN
  r := pg_temp.shared('K');
  PERFORM test.ok(r = 'Family:freebusy:true,Work:view:true', 'K: Work at All details, Family Busy only, both O''s', r);
  r := pg_temp.shared('B');
  PERFORM test.ok(r = 'Family:freebusy:true,Work:freebusy:true', 'B: both Busy only', r);
  r := pg_temp.shared('E');
  PERFORM test.ok(r = 'Family:freebusy:true,Work:view:true', 'E (can edit Work) reads it as All details', r);
  r := pg_temp.shared('N');
  PERFORM test.ok(r = 'Family:freebusy:true', 'N: only Everyone else''s Family', r);
  PERFORM test.ok(pg_temp.shared('O') = '', 'O''s own calendars are never "shared with you"');
  r := test.as_key('KX', format($q$SELECT 1 FROM public.calendar_shared_with_me(%L)$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 0', 'a key without Calendar lists nothing', r);
  r := test.as_key('KB', format($q$SELECT 1 FROM public.calendar_shared_with_me(%L) WHERE calendar_id IN (%L, %L)$q$, test.id('W'), test.id('CW'), test.id('CF')));
  PERFORM test.ok(r = 'ok 2', 'B''s key with Calendar lists what B sees', r);
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.calendar_shared_with_me(%L)$q$, md5('db-test:nowhere')::uuid)) = '0',
    'another workspace lists nothing');
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar_busy_blocks(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.calendar_busy_blocks(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE')
              AND has_function_privilege('service_role', 'public.calendar_busy_blocks(uuid, timestamptz, timestamptz, uuid)', 'EXECUTE'),
    'busy blocks are for signed-in people and the connector, never anon');
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar_shared_with_me(uuid)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.calendar_shared_with_me(uuid)', 'EXECUTE'),
    'and so is Shared with you');
  PERFORM test.ok(to_regprocedure('public.calendar_busy_blocks(uuid, timestamptz, timestamptz)') IS NULL,
    'the old three-argument busy blocks is gone (no overloads): three-argument calls reach the new one');
END;
$$;
