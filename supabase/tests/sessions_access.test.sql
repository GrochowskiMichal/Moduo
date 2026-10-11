-- TV-D10-fix · Work sessions, reminders and Waiting on… behind the task's gate
-- on every path (supabase/migrations/20261011110000_task_sessions_access.sql).
-- specs/tasks-v3.md §1–2, §Assumptions #4, #24; decisions "TV-D10-fix".
--
-- Cast: O owns workspace W. E works on tasks, A is the assignee of E's task,
-- V a viewer, M a member without access to O's private project PB, N a member
-- who can only view O's project PV, X someone in another workspace. SB is a
-- shared project; PM is O's project shared with M alone.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'A', 'V', 'M', 'N', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('N'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002'),
  (test.id('PV'), test.id('W'), test.id('O'), 'O view-only', false, '0003'),
  (test.id('PM'), test.id('W'), test.id('O'), 'O and M', false, '0004');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PV'), test.id('PM'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('N'), 'view', test.id('O')),
       (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('M'), 'edit', test.id('O'));

CREATE FUNCTION test.new_task(p_who text, p_name text, p_project text, p_fields jsonb DEFAULT '{}') RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project)) || p_fields))
$$;
-- How many rows of a table on a task this person reads (through RLS).
CREATE FUNCTION test.reads(p_who text, p_table text, p_task text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.%I WHERE task_id = %L$q$,
    p_table, test.id(p_task)))
$$;
CREATE FUNCTION test.session_of(p_task text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.task_sessions s
  WHERE s.task_id = test.id(p_task) AND s.deleted_at IS NULL ORDER BY s.starts_at LIMIT 1
$$;
CREATE FUNCTION test.people(p_task text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(p.display_name, ',' ORDER BY s.starts_at)
  FROM public.task_sessions s JOIN public.profiles p ON p.id = s.user_id
  WHERE s.task_id = test.id(p_task) AND s.deleted_at IS NULL
$$;

-- ── The gate: grants, policies, the Realtime publication ─────────────────────
DO $$
DECLARE
  v_fn text;
  v_table text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.tasks__visible_to(uuid, uuid)', 'public.tasks__editable_to(uuid, uuid)',
    'public.tasks__guard_edit(uuid, uuid)', 'public.tasks__check_session_person(public.tasks, uuid)',
    'public.tasks__can_hold_session(uuid, uuid, uuid)',
    'public.tasks__busy_sessions(uuid, uuid, timestamptz, timestamptz)',
    'public.tasks__fire_reminders(timestamptz, integer)', 'public.tasks__session_legacy()',
    'public.buckets__area_sync()', 'public.buckets__project_check()'] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND has_function_privilege('service_role', v_fn, 'EXECUTE'),
      format('grants: %s is the server''s only', v_fn));
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.tasks__visible(uuid)', 'public.tasks__editable(uuid)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', v_fn, 'EXECUTE')
                AND has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('grants: the policies'' %s (answers only for the caller)', v_fn));
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['task_sessions', 'task_reminders', 'task_waiting'] LOOP
    PERFORM test.ok(has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
                AND NOT has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
                AND NOT has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
                AND NOT has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
                AND NOT has_table_privilege('anon', 'public.' || v_table, 'SELECT'),
      format('grants: %s is read-only for the app (every write is an op)', v_table));
    PERFORM test.ok((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || v_table)::regclass)
                AND (SELECT string_agg(p.qual, ' ') FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = v_table) LIKE '%tasks__visible(task_id)%'
                AND (SELECT count(*) FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = v_table) = 1,
      format('path: RLS — %s is read through tasks__visible, its only policy', v_table));
    PERFORM test.ok(EXISTS (SELECT 1 FROM pg_publication_tables
                            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table),
      format('path: Realtime — %s streams under that policy (RLS on, so a subscriber gets only what it reads)', v_table));
  END LOOP;
  PERFORM test.ok((SELECT p.qual FROM pg_policies p WHERE p.tablename = 'task_reminders') LIKE '%user_id = ( SELECT %uid()%tasks__visible(task_id)%',
    'path: RLS — a reminder is read only by its own person');
END;
$$;

-- ── Reads: every path, for people who can't see the task ─────────────────────
DO $$
DECLARE
  r text;
  v_session uuid;
  v_entry uuid;
  v_reminder uuid;
BEGIN
  PERFORM test.new_task('O', 'TP', 'PB', '{"scheduled_at": "2030-03-04T09:00:00Z", "duration_minutes": 60, "due_on": "2030-03-10"}');
  PERFORM test.as_user('O', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "Lawyer"}'::jsonb)$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'day_before')$q$, test.id('W'), test.id('TP')));
  v_session := test.session_of('TP');
  SELECT w.id INTO v_entry FROM public.task_waiting w WHERE w.task_id = test.id('TP');
  SELECT x.id INTO v_reminder FROM public.task_reminders x WHERE x.task_id = test.id('TP');
  PERFORM test.ok(v_session IS NOT NULL AND v_entry IS NOT NULL AND v_reminder IS NOT NULL, 'O''s private task has a session, an entry, a reminder');

  -- RLS (and so Realtime).
  PERFORM test.ok(test.reads('O', 'task_sessions', 'TP') = '1' AND test.reads('O', 'task_waiting', 'TP') = '1'
              AND test.reads('O', 'task_reminders', 'TP') = '1',
    'read: O reads their own task''s session, entry and reminder');
  PERFORM test.ok(test.reads('M', 'task_sessions', 'TP') = '0' AND test.reads('M', 'task_waiting', 'TP') = '0'
              AND test.reads('M', 'task_reminders', 'TP') = '0',
    'read: a member without access reads none of them');
  PERFORM test.ok(test.reads('V', 'task_sessions', 'TP') = '0' AND test.reads('V', 'task_waiting', 'TP') = '0'
              AND test.reads('V', 'task_reminders', 'TP') = '0',
    'read: a viewer reads none of them');
  PERFORM test.ok(test.reads('X', 'task_sessions', 'TP') = '0' AND test.reads('X', 'task_waiting', 'TP') = '0',
    'read: someone outside the workspace reads none');

  -- The ops never answer about a row of a task the caller can't see.
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_session_update(%L, %L, '{"starts_at": "2030-03-05T09:00:00Z", "ends_at": "2030-03-05T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), v_session));
  PERFORM test.ok(r LIKE '%Session not found%', 'path: tasks_op_session_update — M''s answer is "not found"', r);
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_session_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r LIKE '%Session not found%', 'path: tasks_op_session_remove — "not found"', r);
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-03-05T09:00:00Z", "ends_at": "2030-03-05T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'path: tasks_op_session_add — the task reads as missing', r);
  r := test.try('M', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'path: tasks_op_unschedule — missing', r);
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "x"}'::jsonb)$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'path: tasks_op_waiting_add — missing', r);
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_waiting_remove(%L, %L)$q$, test.id('W'), v_entry));
  PERFORM test.ok(r LIKE '%Waiting entry not found%', 'path: tasks_op_waiting_remove — "not found"', r);
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'hour_before')$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'path: tasks_op_reminder_add — missing', r);
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_reminder_remove(%L, %L)$q$, test.id('W'), v_reminder));
  PERFORM test.ok(r LIKE '%Reminder not found%', 'path: tasks_op_reminder_remove — someone else''s reads as missing', r);
  PERFORM test.ok(test.reads('O', 'task_sessions', 'TP') = '1' AND test.reads('O', 'task_waiting', 'TP') = '1'
              AND test.reads('O', 'task_reminders', 'TP') = '1'
              AND (SELECT starts_at FROM public.task_sessions WHERE id = v_session) = '2030-03-04T09:00:00Z',
    'and nothing of O''s changed');

  -- The helpers themselves, called directly, answer only for the caller.
  PERFORM test.ok(test.value_as('M', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TP'))) = 'false'
              AND test.value_as('O', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TP'))) = 'true',
    'path: tasks__visible answers for the caller');
  r := test.try('M', format($q$SELECT public.tasks__visible_to(%L, %L)$q$, test.id('TP'), test.id('O')));
  PERFORM test.ok(r LIKE '42501%', 'path: tasks__visible_to (about someone else) isn''t the app''s to call', r);
END;
$$;

-- ── Writes: each needs edit on the task ──────────────────────────────────────
DO $$
DECLARE
  r text;
  v_session uuid;
  v_entry uuid;
  v_before text;
BEGIN
  PERFORM test.new_task('O', 'TV', 'PV', '{"scheduled_at": "2030-03-04T09:00:00Z"}');
  PERFORM test.as_user('O', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "Quote"}'::jsonb)$q$,
    test.id('W'), test.id('TV')));
  v_session := test.session_of('TV');
  SELECT w.id INTO v_entry FROM public.task_waiting w WHERE w.task_id = test.id('TV');
  PERFORM test.ok(test.reads('N', 'task_sessions', 'TV') = '1' AND test.reads('N', 'task_waiting', 'TV') = '1',
    'N can view the task, its session and what it waits on');
  v_before := test.people('TV') || (SELECT starts_at::text FROM public.task_sessions WHERE id = v_session);

  -- N sees the task but can't edit it: every write path refuses.
  r := test.try('N', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-03-05T09:00:00Z", "ends_at": "2030-03-05T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'write: view access can''t add a session', r);
  r := test.try('N', format($q$SELECT * FROM public.tasks_op_session_update(%L, %L, '{"starts_at": "2030-03-05T09:00:00Z", "ends_at": "2030-03-05T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), v_session));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'write: view access can''t move one', r);
  r := test.try('N', format($q$SELECT * FROM public.tasks_op_session_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'write: view access can''t remove one', r);
  r := test.try('N', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'write: view access can''t unschedule', r);
  r := test.try('N', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "x"}'::jsonb)$q$,
    test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'write: view access can''t add to Waiting on', r);
  r := test.try('N', format($q$SELECT * FROM public.tasks_op_waiting_remove(%L, %L)$q$, test.id('W'), v_entry));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'write: view access can''t clear an entry', r);
  r := test.try('N', format($q$UPDATE public.tasks SET scheduled_at = '2030-03-06T09:00:00Z' WHERE id = %L$q$, test.id('TV')));
  PERFORM test.ok(r LIKE '42501%', 'write: view access can''t move it as an old build either', r);
  -- The schedule trigger holds the gate itself, not only PERM-W's write check.
  ALTER TABLE public.tasks DISABLE TRIGGER perm_enforce_write;
  r := test.try('N', format($q$UPDATE public.tasks SET scheduled_at = '2030-03-06T09:00:00Z', duration_minutes = 90 WHERE id = %L$q$, test.id('TV')));
  ALTER TABLE public.tasks ENABLE TRIGGER perm_enforce_write;
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%',
    'write: the scheduled_at / duration_minutes trigger refuses view access on its own', r);
  -- Raw writes to the tables are refused outright.
  r := test.try('N', format($q$INSERT INTO public.task_sessions (workspace_id, task_id, user_id, starts_at, ends_at) VALUES (%L, %L, %L, now(), now() + interval '1 hour')$q$,
    test.id('W'), test.id('TV'), test.id('N')));
  PERFORM test.ok(r LIKE '42501%', 'write: no raw session insert', r);
  r := test.try('O', format($q$UPDATE public.task_sessions SET user_id = %L WHERE id = %L$q$, test.id('N'), v_session));
  PERFORM test.ok(r LIKE '42501%', 'write: no raw session update, even by the owner', r);
  r := test.try('N', format($q$INSERT INTO public.task_waiting (workspace_id, task_id, kind, label) VALUES (%L, %L, 'text', 'x')$q$,
    test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%', 'write: no raw Waiting on insert', r);
  r := test.try('N', format($q$INSERT INTO public.task_reminders (workspace_id, task_id, user_id, kind, at) VALUES (%L, %L, %L, 'at', now())$q$,
    test.id('W'), test.id('TV'), test.id('O')));
  PERFORM test.ok(r LIKE '42501%', 'write: no raw reminder insert', r);
  PERFORM test.ok(test.people('TV') || (SELECT starts_at::text FROM public.task_sessions WHERE id = v_session) = v_before
              AND test.reads('O', 'task_waiting', 'TV') = '1',
    'and the session and entry are as they were');

  -- M can't see it: a raw write finds no row.
  r := test.try('M', format($q$UPDATE public.tasks SET scheduled_at = '2030-03-06T09:00:00Z' WHERE id = %L$q$, test.id('TV')));
  PERFORM test.ok(r = 'ok 0', 'write: a member without access moves nothing (the row isn''t there for them)', r);

  -- A viewer (the role): no session, entry or unschedule anywhere.
  PERFORM test.new_task('E', 'TS', 'SB');
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-03-05T09:00:00Z", "ends_at": "2030-03-05T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TS')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'write: a viewer can''t add a session', r);
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "x"}'::jsonb)$q$,
    test.id('W'), test.id('TS')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'write: a viewer can''t add to Waiting on', r);
  r := test.try('V', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('TS')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'write: a viewer can''t unschedule', r);

  -- Reminders are each person's own: seeing the task is enough (D10-10).
  r := test.as_user('N', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', '2030-03-04T08:00:00Z')$q$,
    test.id('W'), test.id('TV')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT user_id FROM public.task_reminders WHERE task_id = test.id('TV')) = test.id('N'),
    'write: view access sets a reminder, always for the caller', r);
  PERFORM test.ok(test.reads('O', 'task_reminders', 'TV') = '0', 'and O never reads N''s reminder');
END;
$$;

-- ── Realtime: who a change streams to ────────────────────────────────────────
-- realtime.apply_rls is what the Realtime server runs for each change: it
-- checks every subscriber's SELECT on the row under their own claims.
CREATE FUNCTION test.wal(p_table text, p_id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id = %L', p_table, p_id) INTO v;
  RETURN jsonb_build_object('action', 'U', 'schema', 'public', 'table', p_table,
    'pk', jsonb_build_array(jsonb_build_object('name', 'id', 'type', 'uuid')),
    'columns', (SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, NULL),
                                                    'value', v -> a.attname) ORDER BY a.attnum)
                FROM pg_attribute a
                WHERE a.attrelid = ('public.' || p_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped));
END;
$$;
-- Who of O, M, N and V gets the change to this row.
CREATE FUNCTION test.streams_to(p_table text, p_id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_who text;
BEGIN
  DELETE FROM realtime.subscription WHERE subscription_id IN (test.id('sub:O'), test.id('sub:M'), test.id('sub:N'), test.id('sub:V'));
  INSERT INTO realtime.subscription (subscription_id, entity, claims)
  SELECT test.id('sub:' || n), ('public.' || p_table)::regclass,
         jsonb_build_object('sub', test.id(n), 'role', 'authenticated')
  FROM unnest(ARRAY['O', 'M', 'N', 'V']) AS n;
  SELECT coalesce(string_agg(n, ',' ORDER BY n), '') INTO v_who
  FROM unnest(ARRAY['O', 'M', 'N', 'V']) AS n
  WHERE test.id('sub:' || n) IN (SELECT unnest(r.subscription_ids) FROM realtime.apply_rls(test.wal(p_table, p_id)) r);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v_who;
END;
$$;

DO $$
DECLARE
  v_who text;
BEGIN
  v_who := test.streams_to('task_sessions', test.session_of('TP'));
  PERFORM test.ok(v_who = 'O', 'path: Realtime — a session on O''s private task streams to O only', v_who);
  v_who := test.streams_to('task_waiting', (SELECT id FROM public.task_waiting WHERE task_id = test.id('TP')));
  PERFORM test.ok(v_who = 'O', 'path: Realtime — its Waiting on entry streams to O only', v_who);
  v_who := test.streams_to('task_reminders', (SELECT id FROM public.task_reminders WHERE task_id = test.id('TP')));
  PERFORM test.ok(v_who = 'O', 'path: Realtime — O''s reminder streams to O only', v_who);
  v_who := test.streams_to('task_sessions', test.session_of('TV'));
  PERFORM test.ok(v_who = 'N,O', 'path: Realtime — a session on a task N can view streams to N too, never to M or V', v_who);
  v_who := test.streams_to('task_reminders', (SELECT id FROM public.task_reminders WHERE task_id = test.id('TV') AND user_id = test.id('N')));
  PERFORM test.ok(v_who = 'N', 'path: Realtime — N''s own reminder streams to N alone (not even to the owner)', v_who);
  DELETE FROM realtime.subscription WHERE subscription_id IN (test.id('sub:O'), test.id('sub:M'), test.id('sub:N'), test.id('sub:V'));
END;
$$;

-- ── Whose calendar a session goes in ─────────────────────────────────────────
DO $$
DECLARE
  r text;
  v_session uuid;
BEGIN
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TS'),
    jsonb_build_object('assignee_id', test.id('A'))));
  -- Through the op.
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-04-01T09:00:00Z", "ends_at": "2030-04-01T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TS')));
  PERFORM test.ok(r = 'ok 1' AND test.people('TS') = 'E', 'person: your own calendar by default', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TS'),
    jsonb_build_object('starts_at', '2030-04-02T09:00:00Z', 'ends_at', '2030-04-02T10:00:00Z', 'user_id', test.id('A'))));
  PERFORM test.ok(r = 'ok 2' AND test.people('TS') = 'E,A', 'person: the assignee''s, to schedule their work', r);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TS'),
    jsonb_build_object('starts_at', '2030-04-03T09:00:00Z', 'ends_at', '2030-04-03T10:00:00Z', 'user_id', test.id('M'))));
  PERFORM test.ok(r LIKE '42501%your own calendar or the assignee''s%', 'person: never a teammate who isn''t the assignee', r);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TS'),
    jsonb_build_object('starts_at', '2030-04-03T09:00:00Z', 'ends_at', '2030-04-03T10:00:00Z', 'user_id', test.id('O'))));
  PERFORM test.ok(r LIKE '42501%your own calendar or the assignee''s%', 'person: nor the workspace owner', r);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TS'),
    jsonb_build_object('starts_at', '2030-04-03T09:00:00Z', 'ends_at', '2030-04-03T10:00:00Z', 'user_id', test.id('X'))));
  PERFORM test.ok(r LIKE '42501%your own calendar or the assignee''s%', 'person: nor someone from another workspace', r);
  v_session := test.session_of('TS');
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_session_update(%L, %L, %L::jsonb)$q$, test.id('W'), v_session,
    jsonb_build_object('user_id', test.id('M'))));
  PERFORM test.ok(r LIKE '42501%your own calendar or the assignee''s%', 'person: a session can''t be handed to a non-assignee', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_update(%L, %L, %L::jsonb)$q$, test.id('W'), v_session,
    jsonb_build_object('user_id', test.id('A'))));
  PERFORM test.ok(r = 'ok 2' AND test.people('TS') = 'A,A', 'person: handed to the assignee', r);
  -- Moving someone's session on a task you can edit keeps its person.
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_update(%L, %L, '{"starts_at": "2030-04-01T11:00:00Z", "ends_at": "2030-04-01T12:00:00Z"}'::jsonb)$q$,
    test.id('W'), v_session));
  PERFORM test.ok(r = 'ok 2' AND test.people('TS') = 'A,A', 'person: moving a session keeps whose it is', r);

  -- An assignee who can no longer see the task: not theirs to fill.
  PERFORM test.new_task('O', 'TQ', 'PM', jsonb_build_object('assignee_id', test.id('M')));
  DELETE FROM public.resource_grants WHERE resource_type IN ('bucket', 'task') AND subject_id = test.id('M')
    AND resource_id IN (test.id('PM'), test.id('TQ'));
  PERFORM test.ok(NOT public.tasks__visible_to(test.id('TQ'), test.id('M')), 'M lost access to TQ (assigned to them)');
  r := test.try('O', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TQ'),
    jsonb_build_object('starts_at', '2030-04-03T09:00:00Z', 'ends_at', '2030-04-03T10:00:00Z', 'user_id', test.id('M'))));
  PERFORM test.ok(r LIKE '42501%your own calendar or the assignee''s%', 'person: an assignee who can''t see the task gets no session', r);

  -- Through a write of scheduled_at (an old build, the app's picker, the
  -- repeat engine): a new session is the assignee's when they see the task,
  -- else the writer's.
  PERFORM test.new_task('E', 'TL', 'SB', jsonb_build_object('assignee_id', test.id('A')));
  r := test.as_user('E', format($q$UPDATE public.tasks SET scheduled_at = '2030-05-01T09:00:00Z' WHERE id = %L$q$, test.id('TL')));
  PERFORM test.ok(r = 'ok 1' AND test.people('TL') = 'A', 'path: an old build''s schedule — the assignee''s session', r);
  r := test.as_user('O', format($q$UPDATE public.tasks SET scheduled_at = '2030-05-01T09:00:00Z' WHERE id = %L$q$, test.id('TQ')));
  PERFORM test.ok(r = 'ok 1' AND test.people('TQ') = 'O',
    'path: an old build''s schedule — the writer''s when the assignee can''t see the task', r);
  PERFORM test.new_task('O', 'TC', 'PM', jsonb_build_object('assignee_id', test.id('M'), 'scheduled_at', '2030-05-02T09:00:00Z'));
  PERFORM test.ok(test.people('TC') = 'M', 'path: a task made with a schedule and an assignee who sees it — theirs');
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"scheduled_at": "2030-05-03T09:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TS')));
  PERFORM test.ok(test.people('TS') = 'A,A', 'path: the edit op''s schedule moves the shown session, keeping its person', r);

  -- A viewer (the role) sees TS's sessions and entries but changes none.
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "Specs"}'::jsonb)$q$,
    test.id('W'), test.id('TS')));
  PERFORM test.ok(test.reads('V', 'task_sessions', 'TS') = '2' AND test.reads('V', 'task_waiting', 'TS') = '1',
    'read: a viewer sees the sessions and entries of a task they can see');
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_session_update(%L, %L, '{"starts_at": "2030-06-01T09:00:00Z", "ends_at": "2030-06-01T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), v_session));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'write: a viewer can''t move a session', r);
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_session_remove(%L, %L)$q$, test.id('W'), v_session));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'write: a viewer can''t remove one', r);
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_waiting_remove(%L, %L)$q$, test.id('W'),
    (SELECT id FROM public.task_waiting WHERE task_id = test.id('TS'))));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'write: a viewer can''t clear an entry', r);

  -- An assignee who can no longer work on tasks here (made a viewer): no
  -- new session is theirs, through the op or a write of scheduled_at.
  PERFORM test.new_task('E', 'TD', 'SB', jsonb_build_object('assignee_id', test.id('A')));
  UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = test.id('W') AND user_id = test.id('A');
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TD'),
    jsonb_build_object('starts_at', '2030-06-02T09:00:00Z', 'ends_at', '2030-06-02T10:00:00Z', 'user_id', test.id('A'))));
  PERFORM test.ok(r LIKE '42501%Viewers can''t be assigned%', 'person: an assignee made a viewer gets no session (op)', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET scheduled_at = '2030-06-02T09:00:00Z' WHERE id = %L$q$, test.id('TD')));
  PERFORM test.ok(r = 'ok 1' AND test.people('TD') = 'E',
    'person: nor through a write of scheduled_at (the writer''s instead)', r);
  UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = test.id('W') AND user_id = test.id('A');
END;
$$;

-- ── System work never fills the caller's calendar ───────────────────────────
-- The repeat engine's catch-up runs as system work from whichever app calls
-- it: a repeat with no time yet gets today's occurrence, and its session is
-- the creator's (who may hold it), never the caller's.
DO $$
DECLARE
  r text;
  v_rule jsonb := jsonb_build_object('rrule', 'FREQ=DAILY', 'dtstart', public.tasks__iso(now() - interval '10 days'));
BEGIN
  PERFORM test.as_op('O', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, assignee_id, title, status, recurrence)
      VALUES (%L, %L, %L, %L, NULL, 'Daily private', 'todo', %L::jsonb), (%L, %L, %L, %L, NULL, 'Daily shared', 'todo', %L::jsonb)$q$,
    test.id('CU1'), test.id('W'), test.id('PB'), test.id('O'), v_rule,
    test.id('CU2'), test.id('W'), test.id('SB'), test.id('O'), v_rule));
  -- A third, made by A, who is then made a viewer: nobody may hold its session.
  PERFORM test.as_op('A', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, assignee_id, title, status, recurrence)
      VALUES (%L, %L, %L, %L, NULL, 'Daily of A', 'todo', %L::jsonb)$q$,
    test.id('CU3'), test.id('W'), test.id('SB'), test.id('A'), v_rule));
  UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = test.id('W') AND user_id = test.id('A');
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_catch_up(%L, '[]'::jsonb)$q$, test.id('W')));
  UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = test.id('W') AND user_id = test.id('A');
  PERFORM test.ok((SELECT scheduled_at FROM public.tasks WHERE id = test.id('CU3')) IS NOT NULL
              AND (SELECT count(*) FROM public.task_sessions WHERE task_id = test.id('CU3') AND deleted_at IS NULL AND user_id IS NULL) = 1
              AND NOT EXISTS (SELECT 1 FROM public.task_sessions WHERE task_id = test.id('CU3') AND user_id IS NOT NULL),
    'path: the repeat engine — with no one who may hold it, the session is nobody''s (never the caller''s)');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks__busy_sessions(test.id('W'), test.id('E'), now() - interval '2 days', now() + interval '2 days') b
                              JOIN public.task_sessions s ON s.starts_at = b.starts_at AND s.task_id = test.id('CU3')),
    'and it blocks no one''s booking links');
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT scheduled_at FROM public.tasks WHERE id = test.id('CU1')) IS NOT NULL
              AND (SELECT scheduled_at FROM public.tasks WHERE id = test.id('CU2')) IS NOT NULL,
    'the catch-up from E''s app gave both repeats today''s occurrence', r);
  PERFORM test.ok((SELECT count(*) FROM public.tasks WHERE id IN (test.id('CU1'), test.id('CU2')) AND assignee_id IS NULL) = 2
              AND test.people('CU1') = 'O' AND test.people('CU2') = 'O',
    'path: the repeat engine — the session is the creator''s, never the caller''s',
    coalesce(test.people('CU1'), '-') || ' / ' || coalesce(test.people('CU2'), '-'));
END;
$$;

-- ── An agent (API key) acts as its person, through the same gate ────────────
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KN'), test.id('W'), 'N agent', 'mdo_kn', md5('db-test-kn'), '{"tasks": "edit"}'::jsonb, test.id('N')),
  (test.id('KM'), test.id('W'), 'M agent', 'mdo_km', md5('db-test-km'), '{"tasks": "edit"}'::jsonb, test.id('M'));
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_key('KN', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'path: an agent of a view-only person can''t unschedule', r);
  r := test.as_key('KN', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-06-03T09:00:00Z", "ends_at": "2030-06-03T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%', 'path: nor add a session', r);
  r := test.as_key('KM', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'path: an agent of a member without access finds no task', r);
  PERFORM test.ok((SELECT scheduled_at FROM public.tasks WHERE id = test.id('TV')) IS NOT NULL
              AND (SELECT scheduled_at FROM public.tasks WHERE id = test.id('TP')) IS NOT NULL,
    'and both stay scheduled');
END;
$$;

-- ── The reminder sender: never for someone who can't see the task ───────────
DO $$
DECLARE
  r text;
  v_n integer;
BEGIN
  PERFORM test.new_task('O', 'TM', 'PM', '{"due_on": "2030-06-10"}');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('M'), 'edit', test.id('O'))
  ON CONFLICT DO NOTHING;
  r := test.as_user('M', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', '2030-06-01T09:00:00Z')$q$, test.id('W'), test.id('TM')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', '2030-06-01T09:00:00Z')$q$, test.id('W'), test.id('TM')));
  PERFORM test.ok(r = 'ok 1' AND test.reads('M', 'task_reminders', 'TM') = '1', 'M set a reminder while sharing the project', r);
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PM') AND subject_id = test.id('M');
  PERFORM test.ok(test.reads('M', 'task_reminders', 'TM') = '0', 'read: once M loses the project, M reads the reminder no more');
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_reminder_remove(%L, %L)$q$, test.id('W'),
    (SELECT id FROM public.task_reminders WHERE task_id = test.id('TM') AND user_id = test.id('M'))));
  PERFORM test.ok(r LIKE '%Reminder not found%', 'path: tasks_op_reminder_remove — it reads as missing too', r);
  -- Whatever else is due before (other tasks here, rows already on this
  -- database) goes first, so the next run sees only TM's two.
  PERFORM public.tasks__fire_reminders('2030-06-01T08:59:00Z', 1000000);
  v_n := public.tasks__fire_reminders('2030-06-01T09:05:00Z', 500);
  PERFORM test.ok(v_n = 1, 'path: the sender claims only O''s for delivery', v_n::text);
  PERFORM test.ok((SELECT fired_at FROM public.task_reminders WHERE task_id = test.id('TM') AND user_id = test.id('M')) IS NOT NULL
              AND public.tasks__fire_reminders('2030-06-01T09:10:00Z', 500) = 0,
    'path: M''s is retired at its time, unsent, and never comes up again');
END;
$$;

-- ── The booking busy read: times only, of tasks the host can see ─────────────
DO $$
DECLARE
  v_busy text;
  v_cols text;
BEGIN
  PERFORM test.new_task('E', 'B1', 'SB');
  PERFORM test.new_task('E', 'B2', 'SB', '{"status": "done"}');
  PERFORM test.new_task('E', 'B3', 'SB');
  -- Sessions in E's calendar as rows from before this migration could have
  -- left them: one on O's private task (E can't see it).
  INSERT INTO public.task_sessions (workspace_id, task_id, user_id, starts_at, ends_at) VALUES
    (test.id('W'), test.id('B1'), test.id('E'), '2030-07-01T09:00:00Z', '2030-07-01T10:00:00Z'),
    (test.id('W'), test.id('B2'), test.id('E'), '2030-07-01T11:00:00Z', '2030-07-01T12:00:00Z'),
    (test.id('W'), test.id('B3'), test.id('E'), '2030-07-01T13:00:00Z', '2030-07-01T14:00:00Z'),
    (test.id('W'), test.id('TP'), test.id('E'), '2030-07-01T15:00:00Z', '2030-07-01T16:00:00Z'),
    (test.id('W'), test.id('B1'), test.id('A'), '2030-07-01T17:00:00Z', '2030-07-01T18:00:00Z');
  UPDATE public.tasks SET deleted_at = now() WHERE id = test.id('B3');
  SELECT string_agg(to_char(b.starts_at AT TIME ZONE 'UTC', 'HH24:MI'), ',' ORDER BY b.starts_at) INTO v_busy
  FROM public.tasks__busy_sessions(test.id('W'), test.id('E'), '2030-07-01T00:00:00Z', '2030-07-02T00:00:00Z') b;
  PERFORM test.ok(v_busy = '09:00',
    'path: booking busy — the host''s live sessions on open tasks they can see (not done, deleted, hidden or a teammate''s)', v_busy);
  SELECT string_agg(a.n, ',' ORDER BY a.i) INTO v_cols
  FROM pg_proc p, unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(n, m, i)
  WHERE p.oid = 'public.tasks__busy_sessions(uuid, uuid, timestamptz, timestamptz)'::regprocedure AND a.m = 't';
  PERFORM test.ok(v_cols = 'starts_at,ends_at', 'path: booking busy — returns busy times only, never what the work is', v_cols);
  PERFORM test.ok(test.try('E', format($q$SELECT * FROM public.tasks__busy_sessions(%L, %L, now(), now() + interval '1 day')$q$,
    test.id('W'), test.id('O'))) LIKE '42501%', 'path: booking busy — the app can''t ask about anyone''s time');
END;
$$;

-- ── A write another trigger makes: only a foreign key's clear skips the gate ─
-- A throwaway trigger on tasks reaches the project gate at depth 2 the way any
-- trigger-made write would; PERM-W's own bucket check is switched off so the
-- project gate is what answers.
CREATE TABLE test.nested (what text NOT NULL);
CREATE FUNCTION test.nested_bucket_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_what text := (SELECT what FROM test.nested LIMIT 1);
BEGIN
  IF v_what = 'status' THEN
    UPDATE public.buckets SET status = 'done' WHERE id = test.id('PB');
  ELSIF v_what = 'lead' THEN
    UPDATE public.buckets SET lead_id = test.id('E') WHERE id = test.id('PB');
  ELSIF v_what = 'clear lead' THEN
    UPDATE public.buckets SET lead_id = NULL WHERE id = test.id('PB');
  ELSIF v_what = 'area' THEN
    UPDATE public.buckets SET area_id = test.id('AR2') WHERE id = test.id('PB');
  ELSIF v_what = 'clear area' THEN
    UPDATE public.buckets SET area_id = NULL WHERE id = test.id('PB');
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER zz_test_nested AFTER UPDATE OF title ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION test.nested_bucket_write();
INSERT INTO public.areas (id, workspace_id, name, position, shared, created_by) VALUES
  (test.id('AR'), test.id('W'), 'Everyone', 1, true, test.id('O')),
  (test.id('AR2'), test.id('W'), 'Elsewhere', 2, true, test.id('O'));
UPDATE public.buckets SET lead_id = test.id('O'), area_id = test.id('AR') WHERE id = test.id('PB');

DO $$
DECLARE
  r text;
  v_what text;
BEGIN
  ALTER TABLE public.buckets DISABLE TRIGGER perm_enforce_write;
  FOREACH v_what IN ARRAY ARRAY['status', 'lead', 'area'] LOOP
    DELETE FROM test.nested;
    INSERT INTO test.nested VALUES (v_what);
    r := test.try('E', format($q$UPDATE public.tasks SET title = 'Renamed' WHERE id = %L$q$, test.id('B1')));
    PERFORM test.ok(r LIKE '42501%don''t have edit access to this project%',
      format('nested write: E (no access to PB) can''t set its %s through another trigger', v_what), r);
  END LOOP;
  FOREACH v_what IN ARRAY ARRAY['clear lead', 'clear area'] LOOP
    DELETE FROM test.nested;
    INSERT INTO test.nested VALUES (v_what);
    r := test.try('E', format($q$UPDATE public.tasks SET title = 'Renamed' WHERE id = %L$q$, test.id('B1')));
    PERFORM test.ok(r = 'ok 1', format('nested write: what a foreign key''s SET NULL does still goes through (%s)', v_what), r);
  END LOOP;
  -- A plain write of the same by E is refused as before.
  r := test.try('E', format($q$UPDATE public.buckets SET lead_id = NULL WHERE id = %L$q$, test.id('PB')));
  PERFORM test.ok(r = 'ok 0', 'a direct write: PB isn''t there for E', r);
  ALTER TABLE public.buckets ENABLE TRIGGER perm_enforce_write;
END;
$$;
DROP TRIGGER zz_test_nested ON public.tasks;
