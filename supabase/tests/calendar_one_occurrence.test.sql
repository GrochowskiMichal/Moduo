-- One occurrence (CALR-11, specs/calendar-rethink.md AC44, K15). Changing one
-- occurrence of a repeating event changes only that occurrence: an override row
-- (series_id + original_start) for an edit, an exdate on the series for a delete,
-- and every override's original start is an exdate too, so the series never
-- draws that occurrence again even when the override sits outside the window
-- the app read. "All events" edits the series and carries its overrides along.
--
--   calendar_op_event_occurrence_update(ws, series, original_start, patch) → the override
--   calendar_op_event_occurrence_delete(ws, series, original_start)
--   calendar_op_event_occurrence_restore(ws, series, original_start)   (the delete's Undo)
--
-- Cast: O owns workspace W, with custom calendars Work (CW) and Home (CH). K is a
-- member with All details (view) on Work and Home; N is a member with nothing.
-- O has a daily "Standup" on Work from Mon 2 Nov 09:00 UTC (30 min) and a one-off
-- "Lunch". O also has a Google account (A) that mirrors instances of a repeat.

SELECT test.person(n) FROM unnest(ARRAY['O', 'K', 'N']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member'),
  (test.id('W'), test.id('N'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom'),
  (test.id('CH'), test.id('W'), test.id('O'), 'Home', 'custom');
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('O'), 'google', 'o@example.com', 'o@example.com');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), test.id('CH'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('K'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CH'), 'member', test.id('K'), 'view', test.id('O'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Standup', p_starts_at => '2026-11-02 09:00+00', p_ends_at => '2026-11-02 09:30+00',
    p_rrule => 'FREQ=DAILY', p_description => 'Daily sync', p_location => 'Room 1',
    p_calendar_id => %L)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'O creates a daily Standup on Work', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Lunch', p_starts_at => '2026-11-03 12:00+00', p_ends_at => '2026-11-03 13:00+00',
    p_calendar_id => %L)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'and a one-off Lunch', r);
END;
$$;

CREATE FUNCTION pg_temp.series() RETURNS public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid
    AND title IN ('Standup', 'Daily standup') AND series_id IS NULL AND source_account_id IS NULL
$$;
CREATE FUNCTION pg_temp.overrides() RETURNS SETOF public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events WHERE series_id = (SELECT id FROM pg_temp.series())
$$;
-- An occurrence op as SQL text, run as someone.
CREATE FUNCTION pg_temp.occ(p_op text, p_at text, p_patch jsonb DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN p_patch IS NULL
    THEN format('SELECT public.calendar_op_event_occurrence_%s(%L, %L, %L::timestamptz)',
                p_op, md5('db-test:W')::uuid, (SELECT id FROM pg_temp.series()), p_at)
    ELSE format('SELECT public.calendar_op_event_occurrence_%s(%L, %L, %L::timestamptz, %L::jsonb)',
                p_op, md5('db-test:W')::uuid, (SELECT id FROM pg_temp.series()), p_at, p_patch) END
$$;

-- This event: the first edit of an occurrence makes an override; the series stays.
DO $$
DECLARE
  r text;
  o public.calendar_events;
  s public.calendar_events;
BEGIN
  r := test.as_user('O', pg_temp.occ('update', '2026-11-04 09:00+00',
    '{"startsAt": "2026-11-04T10:00:00Z", "endsAt": "2026-11-04T10:30:00Z", "title": "Standup (late)"}'));
  PERFORM test.ok(r = 'ok 1', 'O moves Wednesday''s Standup to 10:00, This event', r);
  PERFORM test.ok((SELECT count(*) FROM pg_temp.overrides() WHERE deleted_at IS NULL) = 1,
    'one override row now points at the series');
  SELECT * INTO o FROM pg_temp.overrides();
  PERFORM test.ok(o.original_start = '2026-11-04 09:00+00' AND o.start_time = '2026-11-04 10:00+00'
      AND o.end_time = '2026-11-04 10:30+00' AND o.title = 'Standup (late)',
    'the override keeps the occurrence it replaces and carries the new time and title',
    format('%s %s %s %s', o.original_start, o.start_time, o.end_time, o.title));
  PERFORM test.ok(o.recurrence_rule IS NULL AND NOT o.recurring,
    'the override itself does not repeat');
  PERFORM test.ok(o.calendar_ref = test.id('CW') AND o.owner_id = test.id('O')
      AND o.location = 'Room 1' AND o.description = 'Daily sync' AND o.source_account_id IS NULL,
    'and takes the series'' calendar, owner, place and notes',
    format('%s %s %s %s', o.calendar_ref, o.owner_id, o.location, o.description));
  s := pg_temp.series();
  PERFORM test.ok(s.title = 'Standup' AND s.start_time = '2026-11-02 09:00+00'
      AND s.recurrence_rule = 'FREQ=DAILY' AND s.deleted_at IS NULL,
    'the series is untouched: same title, anchor and repeat');
  PERFORM test.ok(s.exdates = ARRAY['2026-11-04 09:00+00'::timestamptz],
    'the replaced occurrence is an exdate on the series, so it is never drawn twice',
    s.exdates::text);
END;
$$;

-- This event again, on the same occurrence: the same override changes.
DO $$
DECLARE
  r text;
  o public.calendar_events;
BEGIN
  r := test.as_user('O', pg_temp.occ('update', '2026-11-04 09:00+00', '{"title": "Standup (moved)"}'));
  PERFORM test.ok(r = 'ok 1', 'O renames that occurrence, This event', r);
  PERFORM test.ok((SELECT count(*) FROM pg_temp.overrides()) = 1,
    'still one override for that occurrence');
  SELECT * INTO o FROM pg_temp.overrides();
  PERFORM test.ok(o.title = 'Standup (moved)' AND o.start_time = '2026-11-04 10:00+00',
    'the override takes the new title and keeps its moved time', o.title);
  PERFORM test.ok((pg_temp.series()).exdates = ARRAY['2026-11-04 09:00+00'::timestamptz],
    'and the series still has that one exdate, not two', (pg_temp.series()).exdates::text);
END;
$$;

-- This event, deleted.
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', pg_temp.occ('delete', '2026-11-05 09:00+00'));
  PERFORM test.ok(r = 'ok 1', 'O deletes Thursday''s Standup, This event', r);
  PERFORM test.ok((pg_temp.series()).exdates @> ARRAY['2026-11-05 09:00+00'::timestamptz]
      AND (pg_temp.series()).deleted_at IS NULL,
    'Thursday is an exdate and the series lives on', (pg_temp.series()).exdates::text);
  PERFORM test.ok((SELECT count(*) FROM pg_temp.overrides()) = 1,
    'a delete makes no override');

  r := test.as_user('O', pg_temp.occ('delete', '2026-11-04 09:00+00'));
  PERFORM test.ok(r = 'ok 1', 'O deletes the moved Wednesday occurrence, This event', r);
  PERFORM test.ok((SELECT deleted_at IS NOT NULL FROM pg_temp.overrides()),
    'its override is deleted');
  PERFORM test.ok((pg_temp.series()).exdates @> ARRAY['2026-11-04 09:00+00'::timestamptz],
    'and Wednesday stays an exdate, so the series doesn''t draw it back', (pg_temp.series()).exdates::text);
END;
$$;

-- Undo of each delete.
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', pg_temp.occ('restore', '2026-11-04 09:00+00'));
  PERFORM test.ok(r = 'ok 1', 'O undoes the Wednesday delete', r);
  PERFORM test.ok((SELECT deleted_at IS NULL AND title = 'Standup (moved)' FROM pg_temp.overrides()),
    'the override comes back as it was');
  PERFORM test.ok((pg_temp.series()).exdates @> ARRAY['2026-11-04 09:00+00'::timestamptz],
    'and the series still skips Wednesday''s original time');

  r := test.as_user('O', pg_temp.occ('restore', '2026-11-05 09:00+00'));
  PERFORM test.ok(r = 'ok 1', 'O undoes the Thursday delete', r);
  PERFORM test.ok((pg_temp.series()).exdates = ARRAY['2026-11-04 09:00+00'::timestamptz],
    'Thursday is no longer an exdate, so the series draws it again', (pg_temp.series()).exdates::text);
END;
$$;

-- Refusals.
DO $$
DECLARE
  v_lunch uuid := (SELECT id FROM public.calendar_events WHERE title = 'Lunch' AND workspace_id = test.id('W'));
  v_override uuid := (SELECT id FROM pg_temp.overrides());
  r text;
BEGIN
  r := test.try('O', format($q$SELECT public.calendar_op_event_occurrence_update(%L, %L, '2026-11-03 12:00+00', '{"title": "x"}'::jsonb)$q$,
    test.id('W'), v_lunch));
  PERFORM test.ok(r NOT LIKE 'ok%', 'an event that doesn''t repeat has no occurrences to change', r);
  r := test.try('O', format($q$SELECT public.calendar_op_event_occurrence_delete(%L, %L, '2026-11-03 12:00+00')$q$,
    test.id('W'), v_lunch));
  PERFORM test.ok(r NOT LIKE 'ok%', 'nor to delete', r);
  r := test.try('O', format($q$SELECT public.calendar_op_event_occurrence_update(%L, %L, '2026-11-04 10:00+00', '{"title": "x"}'::jsonb)$q$,
    test.id('W'), v_override));
  PERFORM test.ok(r NOT LIKE 'ok%', 'an override is not a series of its own', r);
  r := test.try('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"rrule": "FREQ=DAILY"}'::jsonb)$q$,
    test.id('W'), v_override));
  PERFORM test.ok(r NOT LIKE 'ok%', 'an override can''t be made to repeat', r);

  r := test.try('K', pg_temp.occ('update', '2026-11-06 09:00+00', '{"title": "Hijacked"}'));
  PERFORM test.ok(r NOT LIKE 'ok%', 'K, who only views Work, can''t change an occurrence', r);
  r := test.try('K', pg_temp.occ('delete', '2026-11-06 09:00+00'));
  PERFORM test.ok(r NOT LIKE 'ok%', 'nor delete one', r);
  r := test.try('N', pg_temp.occ('update', '2026-11-06 09:00+00', '{"title": "Hijacked"}'));
  PERFORM test.ok(r NOT LIKE 'ok%', 'N, with nothing on Work, can''t either', r);
  PERFORM test.ok((pg_temp.series()).exdates = ARRAY['2026-11-04 09:00+00'::timestamptz]
      AND (SELECT count(*) FROM pg_temp.overrides()) = 1,
    'and nothing they tried was stored');
END;
$$;

-- The masked read hands the override and the exdates to K.
CREATE FUNCTION pg_temp.visible(p_select text, p_where text DEFAULT 'true') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT %s FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') e WHERE %s$q$,
    p_select, md5('db-test:W')::uuid, p_where)
$$;
DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
  r text;
BEGIN
  r := test.value_as('K', pg_temp.visible($s$title || '|' || original_start$s$, format('series_id = %L', v_series)));
  PERFORM test.ok(r = 'Standup (moved)|' || '2026-11-04 09:00+00'::timestamptz,
    'K''s masked read carries the override with the occurrence it replaces', r);
  r := test.value_as('K', pg_temp.visible('exdates::text', format('id = %L', v_series)));
  PERFORM test.ok(r = ARRAY['2026-11-04 09:00+00'::timestamptz]::text,
    'and the series with its exdates, so K''s week skips the replaced time too', r);
END;
$$;

-- All events: the series changes and its overrides come along.
DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
  r text;
  o public.calendar_events;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"title": "Daily standup", "location": "Room 2"}'::jsonb)$q$,
    test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'O renames the series and moves its room, All events', r);
  SELECT * INTO o FROM pg_temp.overrides();
  PERFORM test.ok(o.title = 'Daily standup' AND o.location = 'Room 2',
    'the changed occurrence takes the new title and room too', format('%s %s', o.title, o.location));
  PERFORM test.ok(o.start_time = '2026-11-04 10:00+00',
    'but keeps its own time');

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, jsonb_build_object('calendarId', %L::text))$q$,
    test.id('W'), v_series, test.id('CH')));
  PERFORM test.ok(r = 'ok 1', 'O moves the series to Home, All events', r);
  PERFORM test.ok((SELECT calendar_ref FROM pg_temp.overrides()) = test.id('CH'),
    'the override moves to Home with it');

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"isPrivate": true}'::jsonb)$q$,
    test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'O makes the series private, All events', r);
  PERFORM test.ok((SELECT is_private FROM pg_temp.overrides()),
    'the override is private too');
END;
$$;

-- A private series stays private on its changed occurrence, everywhere K reads.
DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
  v_override uuid := (SELECT id FROM pg_temp.overrides());
  r text;
BEGIN
  r := test.value_as('K', pg_temp.visible($s$title || '|' || coalesce(location, '-') || '|' || original_start$s$, format('id = %L', v_override)));
  PERFORM test.ok(r = 'Busy|-|' || '2026-11-04 09:00+00'::timestamptz,
    'K gets the override as "Busy" with no room, still pointing at its occurrence', r);
  r := test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events WHERE id IN (%L, %L)$q$, v_series, v_override));
  PERFORM test.ok(r = '0', 'and neither row streams to K from the table', r);
  r := test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events WHERE title ILIKE '%%standup%%'$q$));
  PERFORM test.ok(r = '0', 'no Standup title is readable by K at all', r);
  -- This event can make one occurrence public again without the rest.
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"isPrivate": false}'::jsonb)$q$,
    test.id('W'), v_override));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.series()).is_private,
    'O makes only the changed occurrence public: the series stays private', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"isPrivate": false}'::jsonb)$q$,
    test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'then the whole series public again', r);
END;
$$;

-- All events, moved in time: the exdates and the overrides' original starts move
-- with the anchor, so the same occurrences stay replaced.
DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
  r text;
  o public.calendar_events;
BEGIN
  r := test.as_user('O', pg_temp.occ('delete', '2026-11-06 09:00+00'));
  PERFORM test.ok(r = 'ok 1', 'O deletes Friday''s occurrence, This event', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"startsAt": "2026-11-02T08:00:00Z", "endsAt": "2026-11-02T08:30:00Z"}'::jsonb)$q$,
    test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'O moves the whole series an hour earlier, All events', r);
  PERFORM test.ok((pg_temp.series()).exdates = ARRAY['2026-11-04 08:00+00'::timestamptz, '2026-11-06 08:00+00'::timestamptz],
    'both exdates move an hour earlier with it', (pg_temp.series()).exdates::text);
  SELECT * INTO o FROM pg_temp.overrides();
  PERFORM test.ok(o.original_start = '2026-11-04 08:00+00',
    'the override now replaces the 08:00 occurrence', o.original_start::text);
  PERFORM test.ok(o.start_time = '2026-11-04 10:00+00' AND o.end_time = '2026-11-04 10:30+00',
    'and keeps the time it was moved to');
END;
$$;

-- All events, deleted: the overrides go with the series, and Undo brings them back.
DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_delete(%L, %L)$q$, test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'O deletes the series, All events', r);
  PERFORM test.ok((SELECT bool_and(deleted_at IS NOT NULL) FROM pg_temp.overrides()),
    'its override is deleted with it');
  PERFORM test.ok(test.value_as('O', pg_temp.visible('count(*)', format('id = %L OR series_id = %L', v_series, v_series))) = '0',
    'and neither shows in O''s week');
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_restore(%L, %L)$q$, test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'O undoes it', r);
  PERFORM test.ok((SELECT bool_and(deleted_at IS NULL) FROM pg_temp.overrides()),
    'the override comes back with the series');
END;
$$;

-- An override deleted on its own before the series stays deleted after the
-- series' Undo: only what the series delete took comes back.
DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
  r text;
BEGIN
  r := test.as_user('O', pg_temp.occ('delete', '2026-11-04 08:00+00'));
  PERFORM test.ok(r = 'ok 1', 'O deletes the changed occurrence, This event', r);
  -- A later moment for the series delete (one transaction: now() never moves),
  -- so that delete is backdated by hand, past the write triggers.
  SET LOCAL session_replication_role = replica;
  UPDATE public.calendar_events SET deleted_at = deleted_at - interval '1 minute'
    WHERE series_id = v_series AND deleted_at IS NOT NULL;
  SET LOCAL session_replication_role = origin;
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_delete(%L, %L)$q$, test.id('W'), v_series));
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_restore(%L, %L)$q$, test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'O deletes the series and undoes it', r);
  PERFORM test.ok((SELECT bool_and(deleted_at IS NOT NULL) FROM pg_temp.overrides()),
    'the occurrence deleted on its own stays deleted');
END;
$$;

-- Google: the mirror keeps which series an instance belongs to.
DO $$
DECLARE
  r text;
  e public.calendar_events;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id('A'), jsonb_build_array(jsonb_build_object('externalEventId', 'g-weekly_20261103T080000Z',
      'title', 'Design review', 'startsAt', '2026-11-03T08:00:00Z', 'endsAt', '2026-11-03T09:00:00Z',
      'externalSeriesId', 'g-weekly', 'originalStart', '2026-11-03T08:00:00Z'))));
  PERFORM test.ok(r = 'ok 1', 'O''s sync mirrors one instance of a Google repeat', r);
  SELECT * INTO e FROM public.calendar_events WHERE external_event_id = 'g-weekly_20261103T080000Z';
  PERFORM test.ok(e.external_series_id = 'g-weekly' AND e.original_start = '2026-11-03 08:00+00',
    'the instance keeps Google''s series id and its original start',
    format('%s %s', e.external_series_id, e.original_start));
  PERFORM test.ok(e.series_id IS NULL AND e.recurrence_rule IS NULL,
    'and stays a row of its own, not a Moduo override');

  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id('A'), jsonb_build_array(jsonb_build_object('externalEventId', 'g-weekly_20261103T080000Z',
      'title', 'Design review (moved)', 'startsAt', '2026-11-03T09:00:00Z', 'endsAt', '2026-11-03T10:00:00Z'))));
  SELECT * INTO e FROM public.calendar_events WHERE external_event_id = 'g-weekly_20261103T080000Z';
  PERFORM test.ok(e.title = 'Design review (moved)' AND e.external_series_id = 'g-weekly'
      AND e.original_start = '2026-11-03 08:00+00',
    'a sync without the keys keeps them', format('%s %s %s', e.title, e.external_series_id, e.original_start));
END;
$$;
