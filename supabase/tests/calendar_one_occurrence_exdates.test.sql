-- One occurrence (CALR-11, AC44), the validator's cases: a series with deleted
-- occurrences and no override keeps them deleted when it moves; a second Undo
-- never draws an occurrence beside its override; a time before the series is
-- no occurrence of it; each occurrence op leaves an activity line.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Standup', p_starts_at => '2026-11-02 09:00+00', p_ends_at => '2026-11-02 09:30+00',
    p_rrule => 'FREQ=DAILY')$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 1', 'O creates a daily Standup', r);
END;
$$;

CREATE FUNCTION pg_temp.series() RETURNS public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid AND series_id IS NULL
$$;
CREATE FUNCTION pg_temp.occ(p_op text, p_at text, p_patch jsonb DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN p_patch IS NULL
    THEN format('SELECT public.calendar_op_event_occurrence_%s(%L, %L, %L::timestamptz)',
                p_op, md5('db-test:W')::uuid, (SELECT id FROM pg_temp.series()), p_at)
    ELSE format('SELECT public.calendar_op_event_occurrence_%s(%L, %L, %L::timestamptz, %L::jsonb)',
                p_op, md5('db-test:W')::uuid, (SELECT id FROM pg_temp.series()), p_at, p_patch) END
$$;

DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
  r text;
BEGIN
  r := test.as_user('O', pg_temp.occ('delete', '2026-11-05 09:00+00'));
  PERFORM test.ok(r = 'ok 1', 'O deletes Thursday, This event', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"startsAt": "2026-11-02T10:00:00Z", "endsAt": "2026-11-02T10:30:00Z"}'::jsonb)$q$,
    test.id('W'), v_series));
  PERFORM test.ok(r = 'ok 1', 'then moves the whole series an hour later, All events', r);
  PERFORM test.ok((pg_temp.series()).exdates = ARRAY['2026-11-05 10:00+00'::timestamptz],
    'with no override at all, Thursday''s exdate moves with it and Thursday stays deleted',
    (pg_temp.series()).exdates::text);
END;
$$;

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', pg_temp.occ('update', '2026-11-06 10:00+00', '{"title": "Standup (Fri)"}'));
  PERFORM test.ok(r = 'ok 1', 'O renames Friday, This event', r);
  r := test.as_user('O', pg_temp.occ('restore', '2026-11-06 10:00+00'));
  PERFORM test.ok(r = 'ok 1', 'an Undo with nothing deleted there answers', r);
  PERFORM test.ok((pg_temp.series()).exdates @> ARRAY['2026-11-06 10:00+00'::timestamptz],
    'but Friday keeps its exdate while its override lives, so it is never drawn twice',
    (pg_temp.series()).exdates::text);

  r := test.try('O', pg_temp.occ('update', '2026-11-01 10:00+00', '{"title": "Before"}'));
  PERFORM test.ok(r NOT LIKE 'ok%', 'a time before the series is no occurrence of it', r);
  r := test.try('O', pg_temp.occ('delete', '2026-11-01 10:00+00'));
  PERFORM test.ok(r NOT LIKE 'ok%', 'nor can it be deleted', r);
END;
$$;

DO $$
DECLARE
  v_series uuid := (SELECT id FROM pg_temp.series());
BEGIN
  PERFORM test.ok((SELECT count(*) FROM public.module_activity
                     WHERE entity_id = v_series
                       AND op IN ('calendar.occurrence_update', 'calendar.occurrence_delete',
                                      'calendar.occurrence_restore')) = 3,
    'the series'' history has the occurrence change, delete and Undo');
END;
$$;
