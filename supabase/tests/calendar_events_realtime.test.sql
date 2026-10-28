-- Live events (CALR-7, specs/calendar-rethink.md AC42): calendar_events streams
-- through Supabase Realtime, and the database stamps updated_at so open apps
-- compare versions on one clock
-- (supabase/migrations/20261028090000_calendar_events_realtime.sql).
--
-- Cast: O owns workspace W.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');

DO $$
DECLARE
  v_before timestamptz;
  v_after timestamptz;
BEGIN
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_publication_tables
                          WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                            AND tablename = 'calendar_events'),
    'calendar_events is in the supabase_realtime publication');
  PERFORM test.ok((SELECT count(*) FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename IN ('tasks', 'buckets', 'task_queue', 'tags', 'tag_links', 'comments')) = 6,
    'the Tasks tables stay published');
  PERFORM test.ok((SELECT relreplident FROM pg_class WHERE oid = 'public.calendar_events'::regclass) = 'd',
    'the default replica identity: a delete carries only the id');

  PERFORM test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Standup', p_starts_at => '2026-11-03 10:00+00', p_ends_at => '2026-11-03 11:00+00')$q$, test.id('W')));
  SELECT updated_at INTO v_before FROM public.calendar_events WHERE workspace_id = test.id('W') AND title = 'Standup';
  PERFORM test.ok(v_before > now(), 'an insert is stamped with the database clock, not the transaction start', v_before::text);

  PERFORM test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L,
    (SELECT id FROM public.calendar_events WHERE workspace_id = %L AND title = 'Standup'), '{"title": "Daily standup"}'::jsonb)$q$,
    test.id('W'), test.id('W')));
  SELECT updated_at INTO v_after FROM public.calendar_events WHERE workspace_id = test.id('W') AND title = 'Daily standup';
  PERFORM test.ok(v_after > v_before, 'a later write in the same transaction gets a later stamp', v_after::text);

  UPDATE public.calendar_events SET updated_at = '2001-01-01' WHERE workspace_id = test.id('W');
  PERFORM test.ok((SELECT updated_at FROM public.calendar_events WHERE workspace_id = test.id('W')) > now(),
    'a stamp a writer sends is replaced by the database clock');

  PERFORM test.ok(NOT has_function_privilege('anon', 'public.tasks_stamp_updated_at()', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.tasks_stamp_updated_at()', 'EXECUTE'),
    'the stamp function stays internal');
END;
$$;

-- A sync that sends an event unchanged doesn't rewrite it (no re-stamp, so no
-- broadcast to every open calendar); a real change still lands.
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('O'), 'google', 'o@example.com', 'o@example.com');

DO $$
DECLARE
  r text;
  v_batch jsonb := jsonb_build_array(jsonb_build_object('externalEventId', 'g1', 'title', 'Board',
    'startsAt', '2026-11-05T10:00:00Z', 'endsAt', '2026-11-05T11:00:00Z', 'location', 'Room 4',
    'conferenceUrl', 'https://meet.google.com/aaa-bbbb-ccc'));
  v_first timestamptz;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
         test.id('W'), test.id('A'), v_batch));
  SELECT updated_at INTO v_first FROM public.calendar_events
    WHERE source_account_id = test.id('A') AND external_event_id = 'g1';
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
         test.id('W'), test.id('A'), v_batch));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT updated_at FROM public.calendar_events
                    WHERE source_account_id = test.id('A') AND external_event_id = 'g1') = v_first
              AND (SELECT count(*) FROM public.calendar_events
                    WHERE source_account_id = test.id('A') AND external_event_id = 'g1') = 1,
    'an unchanged event is not rewritten, and not inserted twice', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
         test.id('W'), test.id('A'), jsonb_set(v_batch, '{0,title}', '"Board (moved)"')));
  PERFORM test.ok((SELECT title = 'Board (moved)' AND updated_at > v_first FROM public.calendar_events
                    WHERE source_account_id = test.id('A') AND external_event_id = 'g1'),
    'a changed event is rewritten and re-stamped', r);
END;
$$;
