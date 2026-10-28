-- Busy blocks over a long window, all-day repeats and the helpers' grants
-- (CALR-16 review). A daily repeat started a year and a half ago still shows
-- this week's occurrence through a three-year window (the expansion limit
-- follows the window, never a fixed count from its start); a weekly all-day
-- item, stored at the owner's local midnight, repeats midnight to midnight in
-- the owner's zone across the clock change and skips its exdate; the internal
-- helpers are the server's alone.
--
-- Cast: O owns workspace W, lives in Europe/Warsaw, and shares Work (CW) with
-- B as Busy only.

SELECT test.person(n) FROM unnest(ARRAY['O', 'B']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('B'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_preferences (user_id, time_zone) VALUES (test.id('O'), 'Europe/Warsaw')
ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar' AND resource_id = test.id('CW');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('B'), 'freebusy', test.id('O'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Morning sync', p_starts_at => '2025-05-05 07:00+00', p_ends_at => '2025-05-05 07:15+00',
    p_rrule => 'FREQ=DAILY', p_calendar_id => %L)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'O: a daily sync since May 2025', r);
  -- Mondays, all day in Warsaw: from Mon 19 Oct (summer time, 22:00 UTC the night before).
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Planning day', p_starts_at => '2026-10-18 22:00+00', p_ends_at => '2026-10-19 22:00+00',
    p_all_day => true, p_rrule => 'FREQ=WEEKLY', p_calendar_id => %L)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'and a weekly all-day planning day', r);
  UPDATE public.calendar_events SET exdates = ARRAY['2026-11-01 23:00+00'::timestamptz]
  WHERE workspace_id = test.id('W') AND title = 'Planning day';
END;
$$;

DO $$
DECLARE
  r text;
BEGIN
  r := test.value_as('B', format($q$SELECT count(*) FROM public.calendar_busy_blocks(%L, '2025-11-01 00:00+00', '2028-11-01 00:00+00')
    WHERE start_time >= '2026-11-02 00:00+00' AND start_time < '2026-11-03 00:00+00' AND NOT all_day$q$, test.id('W')));
  PERFORM test.ok(r = '1', 'through a three-year window the daily sync still has this Monday''s block', r);
  r := test.value_as('B', format($q$SELECT to_char(max(start_time) AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM public.calendar_busy_blocks(%L, '2025-11-01 00:00+00', '2028-11-01 00:00+00')
    WHERE NOT all_day$q$, test.id('W')));
  PERFORM test.ok(r >= '2028-10-30', 'and every block to the end of the window', r);

  r := test.value_as('B', format($q$SELECT string_agg(start_time::text || ' → ' || end_time::text, ', ' ORDER BY start_time)
    FROM public.calendar_busy_blocks(%L, '2026-10-26 00:00+00', '2026-11-15 00:00+00') WHERE all_day$q$, test.id('W')));
  PERFORM test.ok(r = format('%s → %s, %s → %s',
      '2026-10-25 23:00+00'::timestamptz, '2026-10-26 23:00+00'::timestamptz,
      '2026-11-08 23:00+00'::timestamptz, '2026-11-09 23:00+00'::timestamptz),
    'the all-day repeat runs Warsaw midnight to midnight after the clock change, and the exdated Monday is gone', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar__viewer(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.calendar__viewer(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.calendar__events_visible_for(uuid, uuid, timestamptz, timestamptz)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.calendar__events_visible_for(uuid, uuid, timestamptz, timestamptz)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.calendar__occurrences(timestamptz, timestamptz, text, timestamptz[], text, timestamptz, timestamptz)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.calendar__occurrences(timestamptz, timestamptz, text, timestamptz[], text, timestamptz, timestamptz)', 'EXECUTE'),
    'the internal helpers can''t be called by anon or a signed-in person directly');
END;
$$;
