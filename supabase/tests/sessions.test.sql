-- TV-D10 · Work sessions, reminders, Waiting on…
-- (supabase/migrations/20261010181000_task_sessions_reminders_waiting.sql).
-- specs/tasks-v3.md §2 (sessions, reminders), §1 (Waiting on…), default d
-- (sessions are busy for booking links), §Assumptions #4 and #26.
--
-- Cast: O owns workspace W. E is a member who works on tasks, V a viewer, X
-- belongs to another workspace. SB is a shared project. K is an API key E
-- made; M is an email thread of E's.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false);
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit"}'::jsonb, test.id('E'));
INSERT INTO public.email_refs (id, workspace_id, owner_id, thread_key, subject) VALUES
  (test.id('M'), test.id('W'), test.id('E'), 'thread-1', 'Contract draft');

CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.new_task(p_who text, p_name text, p_fields jsonb DEFAULT '{}') RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id('SB')) || p_fields))
$$;
-- A task's live sessions as "start→end" (UTC, HH24:MI on the day), in order.
CREATE FUNCTION test.sessions(p_name text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(to_char(s.starts_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI') || '→'
                    || to_char(s.ends_at AT TIME ZONE 'UTC', 'HH24:MI'), ', ' ORDER BY s.starts_at)
  FROM public.task_sessions s WHERE s.task_id = test.id(p_name) AND s.deleted_at IS NULL
$$;
CREATE FUNCTION test.shown(p_name text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(to_char(t.scheduled_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'), 'none') || ' / '
         || coalesce(t.duration_minutes::text, '-')
  FROM public.tasks t WHERE t.id = test.id(p_name)
$$;

DO $$
DECLARE
  r text;
  v_session uuid;
  v_n integer;
BEGIN
  -- ── Several work sessions per task (REPLAN 25) ───────────────────────────
  r := test.new_task('E', 'T1', '{"scheduled_at": "2030-03-04T09:00:00Z", "duration_minutes": 60}');
  PERFORM test.ok(r = 'ok 1' AND test.sessions('T1') = '03-04 09:00→10:00'
              AND (SELECT user_id FROM public.task_sessions WHERE task_id = test.id('T1')) = test.id('E'),
    'scheduling a task makes its first session, the scheduler''s', test.sessions('T1'));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-03-06T14:00:00Z", "ends_at": "2030-03-06T16:30:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 2' AND test.sessions('T1') = '03-04 09:00→10:00, 03-06 14:00→16:30'
              AND test.shown('T1') = '03-04 09:00 / 60',
    'a second session; scheduled_at and duration_minutes still mirror the next one', test.shown('T1'));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-03-02T08:00:00Z", "ends_at": "2030-03-02T08:45:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(test.shown('T1') = '03-02 08:00 / 45', 'an earlier session becomes the one shown', test.shown('T1'));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a WHERE a.entity_id = test.id('T1') AND a.op = 'tasks.session_add'),
    'adding a session is in the trail');
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-03-02T08:00:00Z", "ends_at": "2030-03-02T07:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '%end after it starts%', 'a session ends after it starts', r);
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-03-02T10:00:00Z", "ends_at": "2030-03-02T11:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '%don''t have edit access%', 'a viewer can''t schedule', r);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('starts_at', '2030-03-02T10:00:00Z', 'ends_at', '2030-03-02T11:00:00Z', 'user_id', test.id('V'))));
  PERFORM test.ok(r LIKE '%your own calendar or the assignee''s%',
    'a session goes in your own calendar or the assignee''s (never a viewer''s; TV-D10-fix)', r);
  PERFORM test.ok(test.value_as('V', format($q$SELECT count(*)::text FROM public.task_sessions WHERE task_id = %L$q$, test.id('T1'))) = '3'
              AND test.value_as('X', format($q$SELECT count(*)::text FROM public.task_sessions WHERE task_id = %L$q$, test.id('T1'))) = '0',
    'whoever sees the task sees its sessions; nobody else does');

  -- Moves through the op and through an old build.
  SELECT s.id INTO v_session FROM public.task_sessions s
  WHERE s.task_id = test.id('T1') AND s.starts_at = '2030-03-06T14:00:00Z';
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_update(%L, %L, '{"starts_at": "2030-03-07T14:00:00Z", "ends_at": "2030-03-07T15:00:00Z"}'::jsonb)$q$,
    test.id('W'), v_session));
  PERFORM test.ok(test.sessions('T1') = '03-02 08:00→08:45, 03-04 09:00→10:00, 03-07 14:00→15:00',
    'a session moves and resizes', test.sessions('T1'));
  r := test.as_user('E', format($q$UPDATE public.tasks SET scheduled_at = '2030-03-03T08:00:00Z' WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(test.sessions('T1') = '03-03 08:00→08:45, 03-04 09:00→10:00, 03-07 14:00→15:00'
              AND test.shown('T1') = '03-03 08:00 / 45',
    'an old build''s move of scheduled_at moves the session it showed, keeping its length', test.sessions('T1'));
  r := test.as_user('E', format($q$UPDATE public.tasks SET scheduled_at = '2030-03-05T08:00:00Z' WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(test.sessions('T1') = '03-04 09:00→10:00, 03-05 08:00→08:45, 03-07 14:00→15:00'
              AND test.shown('T1') = '03-04 09:00 / 60',
    'moved past another session, the earlier one shows next', test.shown('T1'));
  r := test.as_user('E', format($q$UPDATE public.tasks SET duration_minutes = 90 WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(test.sessions('T1') = '03-04 09:00→10:30, 03-05 08:00→08:45, 03-07 14:00→15:00',
    'an old build''s resize resizes the session it showed', test.sessions('T1'));

  -- Clearing: a raw clear never deletes; the ops do.
  r := test.as_user('E', format($q$UPDATE public.tasks SET scheduled_at = NULL WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND test.shown('T1') = '03-04 09:00 / 90'
              AND test.sessions('T1') = '03-04 09:00→10:30, 03-05 08:00→08:45, 03-07 14:00→15:00',
    'a raw clear (maybe a stale whole-row save) keeps the session and puts the time back', test.shown('T1'));
  r := test.as_user('E', format($q$SELECT scheduled_at FROM public.tasks_op_update(%L, %L, '{"scheduled_at": null}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(test.sessions('T1') = '03-05 08:00→08:45, 03-07 14:00→15:00' AND test.shown('T1') = '03-05 08:00 / 45',
    'clearing through the edit op removes the session it showed; the next one shows', test.shown('T1'));
  PERFORM test.ok(test.value_as('E', format($q$SELECT to_char(scheduled_at AT TIME ZONE 'UTC', 'MM-DD HH24:MI') FROM public.tasks_op_update(%L, %L, '{"title": "T1"}'::jsonb)$q$,
    test.id('W'), test.id('T1'))) = '03-05 08:00', 'the op answers with the row after the mirror');
  r := test.as_user('E', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(test.sessions('T1') = '03-07 14:00→15:00' AND test.shown('T1') = '03-07 14:00 / 60',
    'Unschedule removes the shown session too', r);
  -- (One transaction: rows share created_at, so read them as a set.)
  PERFORM test.ok((SELECT count(*) FROM public.module_activity a
                   WHERE a.entity_id = test.id('T1') AND a.op = 'tasks.session_remove') = 1
              AND NOT EXISTS (SELECT 1 FROM public.module_activity a
                              WHERE a.entity_id = test.id('T1') AND a.op = 'tasks.unschedule'),
    'with another session left, the trail says a session was removed (not "cleared the scheduled time")');
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(test.sessions('T1') IS NULL AND test.shown('T1') = 'none / 60',
    'with no session left the task is unscheduled; duration_minutes is left as the estimate', test.shown('T1'));

  -- The next session: the earliest that hasn't ended, else the latest.
  PERFORM test.new_task('E', 'T2');
  ALTER TABLE public.task_sessions DISABLE TRIGGER task_sessions_mirror;
  INSERT INTO public.task_sessions (workspace_id, task_id, user_id, starts_at, ends_at) VALUES
    (test.id('W'), test.id('T2'), test.id('E'), now() - interval '3 hours', now() - interval '2 hours'),
    (test.id('W'), test.id('T2'), test.id('E'), now() + interval '1 day', now() + interval '1 day 1 hour');
  ALTER TABLE public.task_sessions ENABLE TRIGGER task_sessions_mirror;
  v_n := public.tasks__session_mirror_refresh(1000);
  PERFORM test.ok(v_n >= 1 AND (test.task('T2')).scheduled_at = (SELECT max(starts_at) FROM public.task_sessions WHERE task_id = test.id('T2')),
    'the 15-minute job moves the mirror on to the next session once one has ended', v_n::text);
  PERFORM test.ok(public.tasks__session_mirror_refresh(1000) = 0, 'and has nothing to do the second time');
  UPDATE public.task_sessions SET deleted_at = now()
  WHERE task_id = test.id('T2') AND starts_at > now();
  PERFORM test.ok((test.task('T2')).scheduled_at = (SELECT starts_at FROM public.task_sessions
                                                    WHERE task_id = test.id('T2') AND deleted_at IS NULL),
    'with every session past, the latest one shows (still drifted)');

  -- Scheduling a backlog task moves it to To do (TV-D9's rule holds for sessions).
  PERFORM test.new_task('E', 'T3', '{"status": "backlog"}');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-04-01T09:00:00Z", "ends_at": "2030-04-01T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('T3')));
  PERFORM test.ok((test.task('T3')).status_category = 'todo', 'a session on a backlog task moves it to To do');
  -- The mirror moving to another session isn't scheduling: Backlog stays.
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-04-03T09:00:00Z", "ends_at": "2030-04-03T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('T3')));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status": "backlog"}'::jsonb)$q$,
    test.id('W'), test.id('T3')));
  SELECT s.id INTO v_session FROM public.task_sessions s
  WHERE s.task_id = test.id('T3') AND s.deleted_at IS NULL ORDER BY s.starts_at LIMIT 1;
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok((test.task('T3')).status_category = 'backlog'
              AND (test.task('T3')).scheduled_at = '2030-04-03T09:00:00Z',
    'removing a session of a backlog task shows the next one and leaves it in Backlog');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status": "todo"}'::jsonb)$q$,
    test.id('W'), test.id('T3')));
  SELECT s.id INTO v_session FROM public.task_sessions s WHERE s.task_id = test.id('T3');
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r = 'ok 0' AND (test.task('T3')).scheduled_at IS NULL, 'removing the only session unschedules', r);

  -- ── Sessions are busy for booking links, switchable per link (default d) ──
  PERFORM test.ok((SELECT column_default FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'exposed_slot_links' AND column_name = 'busy_calendar_ids')
                  LIKE '%tasks%',
    'a new booking link counts work sessions as busy');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.exposed_slot_links
                              WHERE jsonb_typeof(busy_calendar_ids) = 'array' AND NOT busy_calendar_ids ? 'tasks'),
    'so does every existing link');

  -- ── Reminders (REPLAN 24) ────────────────────────────────────────────────
  PERFORM test.new_task('E', 'R1', '{"due_on": "2030-05-10"}');
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'day_before')$q$, test.id('W'), test.id('R1')));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'hour_before')$q$, test.id('W'), test.id('R1')));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'day_before')$q$, test.id('W'), test.id('R1')));
  PERFORM test.ok(r = 'ok 2'
      AND (SELECT string_agg(kind || ' ' || to_char(at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'), ', ' ORDER BY at)
           FROM public.task_reminders WHERE task_id = test.id('R1')) = 'day_before 05-09 09:00, hour_before 05-10 08:00',
    'a day / an hour before a date-only due: 09:00 the day before, 08:00 on the day (one of each)', r);
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_on": "2030-05-12", "due_time": "15:30"}'::jsonb)$q$,
    test.id('W'), test.id('R1')));
  PERFORM test.ok((SELECT string_agg(to_char(at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'), ', ' ORDER BY at)
                   FROM public.task_reminders WHERE task_id = test.id('R1')) = '05-11 15:30, 05-12 14:30',
    'relative reminders follow a new due date and time');
  PERFORM test.as_user('E', format($q$UPDATE public.tasks SET due_date = '2030-05-20T12:00:00Z' WHERE id = %L$q$, test.id('R1')));
  PERFORM test.ok((SELECT string_agg(to_char(at AT TIME ZONE 'UTC', 'MM-DD HH24:MI'), ', ' ORDER BY at)
                   FROM public.task_reminders WHERE task_id = test.id('R1') AND kind <> 'at') = '05-19 15:30, 05-20 14:30',
    'they follow an old build''s due_date write too');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_on": "2030-05-12", "due_time": "15:30"}'::jsonb)$q$,
    test.id('W'), test.id('R1')));
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at')$q$, test.id('W'), test.id('R1')));
  PERFORM test.ok(r LIKE '%needs the time%', 'a reminder at a time needs the time', r);
  r := test.as_user('V', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', '2030-05-01T07:00:00Z')$q$, test.id('W'), test.id('R1')));
  PERFORM test.ok(r = 'ok 1', 'a viewer can set a reminder for themselves (it''s theirs alone)', r);
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.task_reminders WHERE task_id = %L$q$, test.id('R1'))) = '2'
              AND test.value_as('O', format($q$SELECT count(*)::text FROM public.task_reminders WHERE task_id = %L$q$, test.id('R1'))) = '0',
    'each person reads only their own reminders');
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'weekly')$q$, test.id('W'), test.id('R1')));
  PERFORM test.ok(r LIKE '%at a time, a day before due or an hour before due%', 'unknown reminder kinds are refused', r);
  -- The sender stub claims due reminders on open tasks only.
  PERFORM test.new_task('E', 'R2', '{"due_on": "2030-05-10", "status": "backlog"}');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'day_before')$q$, test.id('W'), test.id('R2')));
  v_n := public.tasks__fire_reminders('2030-05-11T16:00:00Z', 500);
  PERFORM test.ok(v_n = 2 AND (SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('R1') AND fired_at IS NOT NULL) = 2
              AND (SELECT fired_at FROM public.task_reminders WHERE task_id = test.id('R2')) IS NULL,
    'the sender claims what''s due (E''s day-before, V''s at-time) and skips a backlog task''s', v_n::text);
  PERFORM test.ok(public.tasks__fire_reminders('2030-05-11T16:00:00Z', 500) = 0, 'a claimed reminder fires once');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_on": "2030-06-12"}'::jsonb)$q$,
    test.id('W'), test.id('R1')));
  PERFORM test.ok((SELECT count(*) FROM public.task_reminders
                   WHERE task_id = test.id('R1') AND kind <> 'at' AND fired_at IS NULL) = 2,
    'a due date moved into the future arms its reminders again');
  SELECT x.id INTO v_session FROM public.task_reminders x WHERE x.task_id = test.id('R1') AND x.user_id = test.id('V');
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_reminder_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r LIKE '%Reminder not found%', 'nobody removes someone else''s reminder', r);
  r := test.as_user('V', format($q$SELECT * FROM public.tasks_op_reminder_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r = 'ok 0', 'you remove your own', r);

  -- ── Waiting on… is a list (default q) ────────────────────────────────────
  PERFORM test.new_task('E', 'WT');
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT'),
    jsonb_build_object('kind', 'person', 'ref', test.id('O'), 'since', '2030-01-02T10:00:00Z')));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT'),
    jsonb_build_object('kind', 'email', 'ref', test.id('M'))));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT'),
    jsonb_build_object('kind', 'agent', 'ref', test.id('K'))));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "Client feedback"}'::jsonb)$q$,
    test.id('W'), test.id('WT')));
  PERFORM test.ok(r = 'ok 4', 'waiting on a person, an email, an agent and a note, each with a since', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT'),
    jsonb_build_object('kind', 'person', 'ref', test.id('O'))));
  PERFORM test.ok(r = 'ok 4', 'the same person twice is one entry', r);
  SELECT w.id INTO v_session FROM public.task_waiting w WHERE w.task_id = test.id('WT') AND w.kind = 'person';
  PERFORM test.new_task('E', 'WT2');
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT2'),
    jsonb_build_object('id', v_session, 'kind', 'text', 'label', 'x')));
  PERFORM test.ok(r LIKE '%belongs to another task%', 'an entry''s id from another task is refused, not answered as done', r);
  PERFORM test.ok((SELECT since FROM public.task_waiting WHERE task_id = test.id('WT') AND kind = 'person') = '2030-01-02T10:00:00Z',
    '"since" keeps the time it was given');
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT'),
    jsonb_build_object('kind', 'person', 'ref', test.id('X'))));
  PERFORM test.ok(r LIKE '%isn''t a member of this workspace%', 'waiting on someone outside the workspace is refused', r);
  r := test.try('O', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT'),
    jsonb_build_object('kind', 'email', 'ref', test.id('M'))));
  PERFORM test.ok(r LIKE '%email isn''t in this workspace%', 'an email you can''t open can''t be added', r);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text"}'::jsonb)$q$, test.id('W'), test.id('WT')));
  PERFORM test.ok(r LIKE '%Say what this waits on%', 'a note needs its words', r);
  PERFORM test.ok((SELECT label FROM public.task_waiting WHERE task_id = test.id('WT') AND kind = 'email') IS NULL,
    'an email entry stores no subject (readers who can''t open it see "Private item")');
  PERFORM test.ok(test.value_as('V', format($q$SELECT count(*)::text FROM public.task_waiting WHERE task_id = %L$q$, test.id('WT'))) = '4',
    'whoever sees the task sees what it waits on');
  SELECT w.id INTO v_session FROM public.task_waiting w WHERE w.task_id = test.id('WT') AND w.kind = 'text';
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r = 'ok 3' AND EXISTS (SELECT 1 FROM public.module_activity a
                                         WHERE a.entity_id = test.id('WT') AND a.op = 'tasks.waiting_remove'),
    'an entry clears, with a trail line', r);
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_waiting_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r LIKE '%don''t have edit access%', 'a viewer can''t change Waiting on', r);

  -- ── Erasure (§Assumptions #26) ───────────────────────────────────────────
  PERFORM test.as_user('O', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('WT'),
    jsonb_build_object('kind', 'person', 'ref', test.id('E'))));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-07-01T09:00:00Z", "ends_at": "2030-07-01T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('WT')));
  r := (public.account_erase_workspace_data(test.id('E'), true))::text;
  PERFORM test.ok((r::jsonb ->> 'task_sessions_deleted')::integer >= 1
              AND (r::jsonb ->> 'task_reminders_deleted')::integer = 3
              AND (r::jsonb ->> 'waiting_entries_deleted')::integer = 1,
    'the erasure preview counts someone''s sessions, reminders and the entries waiting on them', r);
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('E')), false);
  PERFORM test.ok(r = 'ok 1'
      AND NOT EXISTS (SELECT 1 FROM public.task_sessions WHERE user_id = test.id('E'))
      AND NOT EXISTS (SELECT 1 FROM public.task_reminders WHERE user_id = test.id('E'))
      AND NOT EXISTS (SELECT 1 FROM public.task_waiting WHERE kind = 'person' AND ref = test.id('E'))
      AND NOT EXISTS (SELECT 1 FROM public.task_waiting WHERE created_by = test.id('E')),
    'erasure removes them, and their name from the entries they added', r);
  PERFORM test.ok((SELECT count(*) FROM public.task_reminders WHERE user_id = test.id('V')) = 1,
    'a teammate''s reminders stay');
END;
$$;
