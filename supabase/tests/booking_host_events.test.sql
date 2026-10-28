-- A booking link host's events for the guest page (booking-public): repeats
-- are expanded over the booking window on the server, in the host's own zone,
-- so a weekly 1:1 that started weeks ago blocks this week's slot. An exdated
-- week is free, a moved occurrence blocks its new time and frees its original,
-- an ended or deleted series blocks nothing, focus time comes back with its
-- kind (the link decides whether it is busy), and a teammate's repeat never
-- counts. The read is the server's alone.
--
--   calendar__booking_host_events(ws, host, from, to, fallback zone)
--     → (start_time, end_time, source_account_id, calendar_id, kind)
--
-- Cast: H owns workspace W and lives in Europe/Warsaw (clocks went back on
-- Sun 25 Oct 2026, so a 09:00 repeat is 07:00 UTC before and 08:00 UTC after).
-- K is a teammate in W.

SELECT test.person(n) FROM unnest(ARRAY['H', 'K']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('H'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('K'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_preferences (user_id, time_zone) VALUES (test.id('H'), 'Europe/Warsaw'), (test.id('K'), 'Europe/Warsaw')
ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CH'), test.id('W'), test.id('H'), 'Work', 'custom'),
  (test.id('CK'), test.id('W'), test.id('K'), 'Kai', 'custom');

-- The host's week, as the app's ops write it.
CREATE FUNCTION pg_temp.make(p_who text, p_cal text, p_title text, p_start text, p_end text,
  p_rrule text DEFAULT NULL, p_kind text DEFAULT 'event') RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => %L, p_starts_at => %L, p_ends_at => %L, p_rrule => %L, p_calendar_id => %L, p_kind => %L)$q$,
    test.id('W'), p_title, p_start, p_end, p_rrule, test.id(p_cal), p_kind))
$$;
CREATE FUNCTION pg_temp.event_id(p_title text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid
    AND title = p_title AND series_id IS NULL
$$;
-- H's busy rows in the window, as "start → end kind" lines.
CREATE FUNCTION pg_temp.busy(p_from text, p_to text, p_title_like text DEFAULT NULL, p_zone text DEFAULT 'UTC')
RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(to_char(b.start_time AT TIME ZONE 'UTC', 'MM-DD HH24:MI') || '→'
      || to_char(b.end_time AT TIME ZONE 'UTC', 'HH24:MI') || ' ' || b.kind, ', ' ORDER BY b.start_time), '')
  FROM public.calendar__booking_host_events(md5('db-test:W')::uuid, md5('db-test:H')::uuid,
    p_from::timestamptz, p_to::timestamptz, p_zone) b
$$;

DO $$
DECLARE
  r text;
  v_series uuid;
BEGIN
  -- Wednesdays 09:00 Warsaw since 7 Oct (summer time).
  r := pg_temp.make('H', 'CH', '1:1 with Mei', '2026-10-07 07:00+00', '2026-10-07 07:30+00', 'FREQ=WEEKLY');
  PERFORM test.ok(r = 'ok 1', 'H: a weekly 1:1 since three weeks ago', r);
  v_series := pg_temp.event_id('1:1 with Mei');
  -- 4 Nov is skipped; 11 Nov moves from 09:00 to 15:00 Warsaw.
  r := test.as_user('H', format($q$SELECT public.calendar_op_event_occurrence_delete(%L, %L, '2026-11-04 08:00+00')$q$,
    test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'H skips the 4 Nov 1:1', r);
  r := test.as_user('H', format($q$SELECT public.calendar_op_event_occurrence_update(%L, %L, '2026-11-11 08:00+00',
    '{"startsAt": "2026-11-11 14:00+00", "endsAt": "2026-11-11 14:30+00"}'::jsonb)$q$, test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'and moves the 11 Nov one to the afternoon', r);

  -- Mondays 13:00–15:00 Warsaw focus time since 5 Oct.
  r := pg_temp.make('H', 'CH', 'Deep work', '2026-10-05 11:00+00', '2026-10-05 13:00+00', 'FREQ=WEEKLY', 'focus');
  PERFORM test.ok(r = 'ok 1', 'H: weekly focus time', r);
  -- Thursdays, twice, starting 8 Oct: over before the window.
  r := pg_temp.make('H', 'CH', 'Onboarding', '2026-10-08 08:00+00', '2026-10-08 09:00+00', 'FREQ=WEEKLY;COUNT=2');
  PERFORM test.ok(r = 'ok 1', 'H: a two-week series that has ended', r);
  -- Fridays since 9 Oct, deleted.
  r := pg_temp.make('H', 'CH', 'Old retro', '2026-10-09 08:00+00', '2026-10-09 09:00+00', 'FREQ=WEEKLY');
  PERFORM test.ok(r = 'ok 1', 'H: a weekly retro', r);
  r := test.as_user('H', format($q$SELECT public.calendar_op_event_delete(%L, %L)$q$, test.id('W'), pg_temp.event_id('Old retro')));
  PERFORM test.ok(r LIKE 'ok %', 'which H deletes', r);
  -- A one-off on Tue 27 Oct, and one long before the window.
  r := pg_temp.make('H', 'CH', 'Dentist', '2026-10-27 10:00+00', '2026-10-27 11:00+00');
  PERFORM test.ok(r = 'ok 1', 'H: a one-off this week', r);
  r := pg_temp.make('H', 'CH', 'Kickoff', '2026-09-01 10:00+00', '2026-09-01 11:00+00');
  PERFORM test.ok(r = 'ok 1', 'and one in September', r);
  -- K's own weekly, Tuesdays: not H's time.
  r := pg_temp.make('K', 'CK', 'Kai gym', '2026-10-06 16:00+00', '2026-10-06 17:00+00', 'FREQ=WEEKLY');
  PERFORM test.ok(r = 'ok 1', 'K: a weekly gym session', r);
END;
$$;

DO $$
DECLARE
  r text;
BEGIN
  -- Mon 26 Oct to Mon 16 Nov, read with a UTC fallback zone: H's own zone wins.
  r := pg_temp.busy('2026-10-26 00:00+00', '2026-11-16 00:00+00');
  PERFORM test.ok(r = '10-26 12:00→14:00 focus, 10-27 10:00→11:00 event, 10-28 08:00→08:30 event, '
      || '11-02 12:00→14:00 focus, 11-09 12:00→14:00 focus, 11-11 14:00→14:30 event',
    'three weeks of H''s busy time: the repeats at 09:00 / 13:00 Warsaw after the clock change, the skipped week gone, the moved 1:1 at its new time only; no ended, deleted, past or teammate rows', r);

  r := pg_temp.busy('2026-10-28 00:00+00', '2026-10-29 00:00+00');
  PERFORM test.ok(r = '10-28 08:00→08:30 event', 'this Wednesday''s 1:1 blocks its slot, three weeks after the series began', r);

  r := pg_temp.busy('2026-11-04 00:00+00', '2026-11-05 00:00+00');
  PERFORM test.ok(r = '', 'the skipped Wednesday is free', r);

  r := pg_temp.busy('2026-11-11 07:00+00', '2026-11-11 09:00+00');
  PERFORM test.ok(r = '', 'the moved 1:1''s original time is free', r);

  -- A window that starts inside an occurrence still sees it.
  r := pg_temp.busy('2026-10-28 08:15+00', '2026-10-28 09:00+00');
  PERFORM test.ok(r = '10-28 08:00→08:30 event', 'an occurrence already under way at the window''s start counts', r);

  -- The host's zone stands in only when H has none.
  UPDATE public.user_preferences SET time_zone = NULL WHERE user_id = test.id('H');
  r := pg_temp.busy('2026-10-28 00:00+00', '2026-10-29 00:00+00', NULL, 'Europe/Warsaw');
  PERFORM test.ok(r = '10-28 08:00→08:30 event', 'without a saved zone the link''s zone keeps 09:00 Warsaw', r);
END;
$$;

-- What each row carries for the link's busy list: the stored calendar_id and
-- account (never calendar_ref), and only workspace W's rows.
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W2'), test.id('H'), 'Side project');
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CH2'), test.id('W2'), test.id('H'), 'Side', 'custom');
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('H'), 'google', 'h@example.com', 'h@example.com');
INSERT INTO public.calendar_events (workspace_id, owner_id, calendar_id, source_account_id, title, start_time, end_time)
VALUES (test.id('W'), test.id('H'), 'google:h@example.com:h@example.com', test.id('A'), 'Board call',
        '2026-10-29 09:00+00', '2026-10-29 10:00+00');

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('H', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Side standup', p_starts_at => '2026-10-07 06:00+00', p_ends_at => '2026-10-07 06:30+00',
    p_rrule => 'FREQ=WEEKLY', p_calendar_id => %L)$q$, test.id('W2'), test.id('CH2')));
  PERFORM test.ok(r = 'ok 1', 'H: a weekly standup in another workspace', r);

  SELECT string_agg(coalesce(b.calendar_id, 'null') || ' ' || coalesce(b.source_account_id::text, 'none'), ', ' ORDER BY b.start_time)
  INTO r
  FROM public.calendar__booking_host_events(test.id('W'), test.id('H'), '2026-10-28 00:00+00', '2026-10-30 00:00+00', 'UTC') b;
  PERFORM test.ok(r = (SELECT e.calendar_id FROM public.calendar_events e WHERE e.id = pg_temp.event_id('1:1 with Mei'))
      || ' none, google:h@example.com:h@example.com ' || test.id('A'),
    'the 1:1 comes back with its stored calendar_id, the mirrored call with its account; the other workspace''s standup stays out', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar__booking_host_events(uuid, uuid, timestamptz, timestamptz, text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.calendar__booking_host_events(uuid, uuid, timestamptz, timestamptz, text)', 'EXECUTE')
              AND has_function_privilege('service_role', 'public.calendar__booking_host_events(uuid, uuid, timestamptz, timestamptz, text)', 'EXECUTE'),
    'only the server reads a host''s busy time');
  PERFORM test.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.calendar__booking_host_events(uuid, uuid, timestamptz, timestamptz, text)'::regprocedure),
    'and it reads past RLS as a definer');
END;
$$;
