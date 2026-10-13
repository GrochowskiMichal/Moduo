-- TV-D14 · Logged time, the time report, sharing, Time & region
-- (supabase/migrations/20261013200000_user_preferences_time_region.sql and
-- 20261013201000_time_entries_add.sql). specs/tasks-v3.md block 29, AC6.1–6.3,
-- AC6.5, AC12.7, §Assumptions #17, #18, #26; decisions "TV-D14".
--
-- Cast: O owns workspace W. E and A are members; V a viewer; M a member who
-- sees only PM (shared with E and M); X someone in another workspace (W2).
-- SB is a project everyone sees; PB is O's private project; PE is E's own
-- private project; PC is O's private project for the client contact C.
-- TQ sits in PB but is shared with E directly (E sees the task, not PB).

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'A', 'V', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('M'), 'member');
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES
  (test.id('C'), test.id('W'), test.id('O'), 'Acme client');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position, client_contact_id) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001', NULL),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002', NULL),
  (test.id('PM'), test.id('W'), test.id('O'), 'O, E and M', false, '0003', NULL),
  (test.id('PE'), test.id('W'), test.id('E'), 'E private', false, '0004', NULL),
  (test.id('PC'), test.id('W'), test.id('O'), 'Acme work', false, '0005', test.id('C'));
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PM'), test.id('PE'), test.id('PC'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('M'), 'edit', test.id('O'));

CREATE FUNCTION test.new_task(p_who text, p_name text, p_project text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project))))
$$;
-- One field of tasks_op_track_time's answer, called as this person.
CREATE FUNCTION test.track(p_who text, p_task text, p_args text, p_field text DEFAULT 'status') RETURNS text
LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT public.tasks_op_track_time(%L, %L, %s) ->> %L$q$, test.id('W'), test.id(p_task), p_args, p_field))
$$;
-- The report as this person reads it: rows as jsonb (or the error text).
CREATE FUNCTION test.report(p_who text, p_scope text DEFAULT 'NULL, NULL', p_zone text DEFAULT 'UTC',
                            p_ws text DEFAULT 'W') RETURNS text
LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.entry_day, r.entry_id), '[]'::jsonb)::text
       FROM public.tasks_time_report(%L, current_date - 40, current_date + 1, %s, %L) r$q$,
    test.id(p_ws), p_scope, p_zone))
$$;
-- How many report rows, and their seconds, for one task; and every title read.
CREATE FUNCTION test.rows_on(p_report text, p_task text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*)::integer FROM jsonb_array_elements(p_report::jsonb) x WHERE x ->> 'task_id' = test.id(p_task)::text
$$;
CREATE FUNCTION test.secs_on(p_report text, p_task text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(sum((x ->> 'seconds')::integer), 0)::integer
  FROM jsonb_array_elements(p_report::jsonb) x WHERE x ->> 'task_id' = test.id(p_task)::text
$$;
CREATE FUNCTION test.people_in(p_report text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(DISTINCT p.display_name, ',' ORDER BY p.display_name), '')
  FROM jsonb_array_elements(p_report::jsonb) x JOIN public.profiles p ON p.id = (x ->> 'user_id')::uuid
$$;
CREATE FUNCTION test.titles_in(p_report text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(DISTINCT x ->> 'task_title', ',' ORDER BY x ->> 'task_title'), '')
  FROM jsonb_array_elements(p_report::jsonb) x
$$;
CREATE FUNCTION test.reads(p_who text, p_task text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.task_time_entries WHERE task_id = %L$q$,
    test.id(p_task)))
$$;

SELECT test.new_task('O', 'TS', 'SB');
SELECT test.new_task('O', 'TS2', 'SB');
SELECT test.new_task('O', 'TP', 'PB');
SELECT test.new_task('O', 'TQ', 'PB');
SELECT test.new_task('O', 'TM', 'PM');
SELECT test.new_task('E', 'TE', 'PE');
SELECT test.new_task('O', 'TC', 'PC');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'task', test.id('TQ'), 'member', test.id('E'), 'edit', test.id('O'));

-- ── The record: vocabulary, grants, the read policy ──────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.tasks_op_track_time(uuid, uuid, text, integer, timestamptz, text, uuid, date, text, uuid, text)',
    'public.tasks_time_report(uuid, date, date, uuid[], uuid, text, integer)',
    'public.tasks_time_totals(uuid, timestamptz)',
    'public.user_time_region()', 'public.user_op_set_time_region(jsonb)', 'public.user_op_set_time_zone(text)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', v_fn, 'EXECUTE')
                AND has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND has_function_privilege('service_role', v_fn, 'EXECUTE'),
      format('grants: %s is the signed-in person''s and the connector''s, never anon''s', v_fn));
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.time_region__zone_ok(text)', 'public.tasks_time__mine(uuid, uuid)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('grants: %s is internal', v_fn));
  END LOOP;
  PERFORM test.ok((SELECT count(*) FROM pg_proc WHERE proname = 'tasks_op_track_time') = 1,
    'one tasks_op_track_time (the old signature is gone, so PostgREST never has two to choose from)');
  PERFORM test.ok(has_table_privilege('authenticated', 'public.task_time_entries', 'SELECT')
              AND NOT has_table_privilege('authenticated', 'public.task_time_entries', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.task_time_entries', 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.task_time_entries', 'DELETE')
              AND NOT has_table_privilege('anon', 'public.task_time_entries', 'SELECT'),
    'grants: task_time_entries is read-only for the app (every write is the op)');
  PERFORM test.ok((SELECT string_agg(p.qual, ' ') FROM pg_policies p
                   WHERE p.schemaname = 'public' AND p.tablename = 'task_time_entries') LIKE '%uid()%tasks__visible(task_id)%'
              AND (SELECT count(*) FROM pg_policies p
                   WHERE p.schemaname = 'public' AND p.tablename = 'task_time_entries') = 1,
    'path: RLS — an entry is read by its own person, on a task they can see, and nothing else');
END;
$$;

-- ── "Add time…": a logged entry, edit, remove (AC6.1) ────────────────────────
DO $$
DECLARE
  r text;
  v_entry uuid;
  v_before integer;
BEGIN
  r := test.track('E', 'TS', format($q$'add', 7200, NULL, 'key-add-0001', NULL, current_date - 1, '  Call with Anna  '$q$));
  PERFORM test.ok(r = 'saved', '"Add time… 2h yesterday" logs an entry', r);
  SELECT x.id INTO v_entry FROM public.task_time_entries x WHERE x.task_id = test.id('TS') AND x.kind = 'manual';
  PERFORM test.ok((SELECT x.seconds = 7200 AND x.entry_on = current_date - 1 AND x.note = 'Call with Anna'
                          AND x.user_id = test.id('E') AND x.started_at IS NULL
                   FROM public.task_time_entries x WHERE x.id = v_entry),
    'it is one dated entry: E''s, 2 h, yesterday, the note trimmed');
  PERFORM test.ok((SELECT time_spent_seconds FROM public.tasks WHERE id = test.id('TS')) = 7200,
    'the task''s total counts it');
  r := test.track('E', 'TS', format($q$'add', 7200, NULL, 'key-add-0001', NULL, current_date - 1, 'again'$q$));
  PERFORM test.ok(r = 'duplicate' AND (SELECT count(*) FROM public.task_time_entries x
                                       WHERE x.task_id = test.id('TS') AND x.kind = 'manual') = 1,
    'a resend with the same key is recorded once', r);
  PERFORM test.ok(test.track('E', 'TS', $q$'add', 7200, NULL, NULL, NULL, current_date - 1$q$, 'my_seconds') = '14400',
    'the answer carries your share, logged time included');

  r := test.track('E', 'TS', $q$'add', 30, NULL, NULL, NULL, current_date$q$);
  PERFORM test.ok(r LIKE 'ERROR%minute and 24 hours%', 'less than a minute is refused', r);
  r := test.track('E', 'TS', $q$'add', 3600, NULL, NULL, NULL, current_date + 5$q$);
  PERFORM test.ok(r LIKE 'ERROR%up to today%', 'a day in the future is refused', r);
  r := test.track('E', 'TS', $q$'add', 3600, NULL, NULL, NULL, NULL$q$);
  PERFORM test.ok(r LIKE 'ERROR%needs a day%', 'a logged entry needs a day', r);
  r := test.track('E', 'TS', format($q$'add', 3600, NULL, NULL, NULL, current_date, %L$q$, repeat('x', 501)));
  PERFORM test.ok(r LIKE 'ERROR%500 characters%', 'a note over 500 characters is refused', r);
  r := test.track('E', 'TS', $q$'focus', 60, NULL, NULL, NULL, NULL, 'a note on a save'$q$);
  PERFORM test.ok(r LIKE 'ERROR%500 characters%', 'a Focus save carries no note', r);
  r := test.track('V', 'TS', $q$'add', 3600, NULL, NULL, NULL, current_date$q$);
  PERFORM test.ok(r LIKE 'ERROR%edit access%', 'a viewer can''t log time', r);
  r := test.track('M', 'TP', $q$'add', 3600, NULL, NULL, NULL, current_date$q$);
  PERFORM test.ok(r = 'gone', 'a task M can''t see answers "gone", as before (nothing about it leaks)', r);
  r := test.track('X', 'TS', $q$'add', 3600, NULL, NULL, NULL, current_date$q$);
  PERFORM test.ok(r LIKE 'ERROR%edit access%', 'someone outside the workspace is refused', r);

  -- Edit: your own logged entry only.
  r := test.track('E', 'TS', format($q$'edit', 3600, NULL, NULL, %L, current_date - 2, ''$q$, v_entry));
  PERFORM test.ok(r = 'saved' AND (SELECT x.seconds = 3600 AND x.entry_on = current_date - 2 AND x.note IS NULL
                                   FROM public.task_time_entries x WHERE x.id = v_entry),
    'E edits their entry: 1 h, two days ago, the note cleared', r);
  PERFORM test.ok((SELECT time_spent_seconds FROM public.tasks WHERE id = test.id('TS')) = 10800,
    'and the total follows');
  r := test.track('O', 'TS', format($q$'edit', 60, NULL, NULL, %L$q$, v_entry));
  PERFORM test.ok(r = 'noop' AND (SELECT seconds FROM public.task_time_entries WHERE id = v_entry) = 3600,
    'O (owner, full access) can''t edit E''s entry', r);
  r := test.track('O', 'TS', format($q$'remove', NULL, NULL, NULL, %L$q$, v_entry));
  PERFORM test.ok(r = 'noop' AND EXISTS (SELECT 1 FROM public.task_time_entries WHERE id = v_entry),
    'nor remove it', r);
  r := test.track('E', 'TS', format($q$'remove', NULL, NULL, NULL, %L$q$, v_entry));
  PERFORM test.ok(r = 'saved' AND NOT EXISTS (SELECT 1 FROM public.task_time_entries WHERE id = v_entry)
              AND (SELECT time_spent_seconds FROM public.tasks WHERE id = test.id('TS')) = 7200,
    'E removes their own entry; the total drops', r);

  -- A Focus stretch keeps its day; its run is kept only when it is yours.
  INSERT INTO public.focus_runs (id, workspace_id, user_id, device_id, status, ended_at)
  VALUES (test.id('RUN-E'), test.id('W'), test.id('E'), 'device-e-01', 'ended', now()),
         (test.id('RUN-O'), test.id('W'), test.id('O'), 'device-o-01', 'ended', now());
  r := test.track('E', 'TS', format($q$'focus', 600, NULL, 'key-focus-01', NULL, NULL, NULL, %L$q$, test.id('RUN-E')));
  PERFORM test.ok(r = 'saved' AND (SELECT run_id FROM public.task_time_entries WHERE client_key = 'key-focus-01') = test.id('RUN-E'),
    'a Focus save carries its run', r);
  r := test.track('E', 'TS', format($q$'focus', 600, NULL, 'key-focus-02', NULL, NULL, NULL, %L$q$, test.id('RUN-O')));
  PERFORM test.ok(r = 'saved' AND (SELECT run_id FROM public.task_time_entries WHERE client_key = 'key-focus-02') IS NULL,
    'someone else''s run is never stamped on your entry', r);
  SELECT x.id INTO v_entry FROM public.task_time_entries x WHERE x.client_key = 'key-focus-01';
  r := test.track('E', 'TS', format($q$'edit', NULL, NULL, NULL, %L, current_date - 3$q$, v_entry));
  PERFORM test.ok(r LIKE 'ERROR%stays on the day%', 'a Focus stretch can''t move to another day', r);
  r := test.track('E', 'TS', format($q$'edit', 300, NULL, NULL, %L, NULL, 'Review notes'$q$, v_entry));
  PERFORM test.ok(r = 'saved' AND (SELECT x.seconds = 300 AND x.note = 'Review notes'
                                          AND x.ended_at = x.started_at + interval '5 minutes'
                                   FROM public.task_time_entries x WHERE x.id = v_entry),
    'but its length and note can change (it keeps its end, never after now)', r);

  -- Give-backs (TV-F6): labelled, and never undone by hand.
  v_before := (SELECT time_spent_seconds FROM public.tasks WHERE id = test.id('TS'));
  r := test.track('E', 'TS', format($q$'adjust', -120, NULL, 'gb-run-e-1', NULL, NULL, NULL, %L, 'give_back'$q$, test.id('RUN-E')));
  SELECT x.id INTO v_entry FROM public.task_time_entries x WHERE x.client_key = 'gb-run-e-1';
  PERFORM test.ok(r = 'saved' AND (SELECT x.reason = 'give_back' AND x.run_id = test.id('RUN-E') AND x.seconds = -120
                                   FROM public.task_time_entries x WHERE x.id = v_entry)
              AND (SELECT time_spent_seconds FROM public.tasks WHERE id = test.id('TS')) = v_before - 120,
    'a give-back is a labelled adjustment from its run', r);
  r := test.track('E', 'TS', format($q$'undo', NULL, NULL, NULL, %L$q$, v_entry));
  PERFORM test.ok(r = 'noop' AND EXISTS (SELECT 1 FROM public.task_time_entries WHERE id = v_entry),
    'Undo never removes a give-back', r);
  r := test.track('E', 'TS', $q$'focus', 60, NULL, NULL, NULL, NULL, NULL, NULL, 'give_back'$q$);
  PERFORM test.ok(r LIKE 'ERROR%Unknown reason%', 'a reason only labels an adjustment', r);
END;
$$;

-- ── Reading entries: your own, on tasks you can still see ────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.track('O', 'TP', $q$'add', 3600, NULL, NULL, NULL, current_date - 1, 'Private planning'$q$);
  PERFORM test.track('M', 'TM', $q$'add', 1800, NULL, NULL, NULL, current_date - 1, 'M on the shared project'$q$);
  PERFORM test.ok(test.reads('O', 'TP') = '1', 'O reads their own entry');
  PERFORM test.ok(test.reads('M', 'TP') = '0' AND test.reads('E', 'TP') = '0' AND test.reads('X', 'TP') = '0'
              AND test.reads('V', 'TP') = '0',
    'nobody else reads it (M, E, the viewer, an outsider)');
  PERFORM test.ok(test.reads('O', 'TM') = '0', 'O, the owner, doesn''t read M''s entry either');
  PERFORM test.ok(test.reads('M', 'TM') = '1', 'M reads their own entry on the shared project');
  -- The project is taken away from M: their own entry goes with it.
  DELETE FROM public.resource_grants
  WHERE resource_type = 'bucket' AND resource_id = test.id('PM') AND subject_id = test.id('M');
  PERFORM test.ok(test.reads('M', 'TM') = '0', 'once M can''t see the task, M can''t read their entry on it');
  r := test.report('M');
  PERFORM test.ok(test.rows_on(r, 'TM') = 0, 'nor does M''s report list it', r);
  -- And the totals read never names a task you can't see.
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.tasks_time_totals(%L) x
                                              WHERE x.task_id IN (%L, %L)$q$, test.id('W'), test.id('TP'), test.id('TM'))) = '0',
    'tasks_time_totals: M gets no row for a task they can''t see');
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM public.tasks_time_totals(%L)$q$, test.id('W'))) = '0',
    'tasks_time_totals: an outsider gets nothing');
  PERFORM test.ok(test.value_as('E', format($q$SELECT x.my_seconds::text FROM public.tasks_time_totals(%L) x WHERE x.task_id = %L$q$,
                    test.id('W'), test.id('TS'))) = test.value_as('E', format($q$SELECT (public.tasks_op_track_time(%L, %L, 'adjust', 1) ->> 'my_seconds')::integer - 1 || ''$q$,
                    test.id('W'), test.id('TS'))),
    'tasks_time_totals: your share counts what you logged');
END;
$$;

-- ── The report: whose rows, which tasks, which days (AC6.2, AC6.3, AC6.5) ────
DO $$
DECLARE
  r text;
BEGIN
  -- Fixtures: E logs on the shared task, E's private task and the task shared
  -- with E alone; O logs on the shared task and the client's task; A logs on
  -- the shared task; E's waiting time and a legacy total are there too; a
  -- planned session on TS2 has no tracked time at all.
  PERFORM test.track('E', 'TS2', $q$'add', 3600, NULL, NULL, NULL, current_date - 1, 'E on shared'$q$);
  PERFORM test.track('E', 'TE', $q$'add', 5400, NULL, NULL, NULL, current_date - 1, 'E private work'$q$);
  PERFORM test.track('E', 'TQ', $q$'add', 900, NULL, NULL, NULL, current_date - 1, 'E on a shared task'$q$);
  PERFORM test.track('E', 'TS2', $q$'waiting', 4000$q$);
  PERFORM test.track('O', 'TS2', $q$'add', 1200, NULL, NULL, NULL, current_date - 1, 'O on shared'$q$);
  PERFORM test.track('O', 'TC', $q$'add', 2700, NULL, NULL, NULL, current_date - 2, 'Acme kickoff'$q$);
  PERFORM test.track('A', 'TS2', $q$'add', 600, NULL, NULL, NULL, current_date - 1, 'A on shared'$q$);
  INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds)
  VALUES (test.id('W'), test.id('TS2'), NULL, 'legacy', 99999);
  PERFORM test.as_user('O', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L,
    jsonb_build_object('starts_at', now() - interval '1 day', 'ends_at', now() - interval '1 day' + interval '2 hours'))$q$,
    test.id('W'), test.id('TS2')));

  -- Each person reads their own rows only.
  r := test.report('E');
  PERFORM test.ok(test.people_in(r) = 'E', 'E''s report holds E''s rows only', r);
  PERFORM test.ok(test.secs_on(r, 'TS2') = 3600, 'waiting time and the legacy total never count (AC6.5 too)', r);
  PERFORM test.ok(test.rows_on(r, 'TE') = 1 AND test.rows_on(r, 'TQ') = 1, 'E''s private task and the task shared with E are there');
  PERFORM test.ok((SELECT x ->> 'project_name' IS NULL AND x ->> 'project_is_inbox' IS NULL
                   FROM jsonb_array_elements(r::jsonb) x WHERE x ->> 'task_id' = test.id('TQ')::text),
    'TQ''s project (O''s private PB) has no name in E''s rows', r);
  PERFORM test.ok(position('O private' IN r) = 0 AND position('Private planning' IN r) = 0,
    'nothing of O''s private project or entries is in E''s report');
  r := test.report('A');
  PERFORM test.ok(test.people_in(r) = 'A', 'A''s report holds A''s rows only', r);

  -- The owner, before anyone shares: only O's own.
  r := test.report('O');
  PERFORM test.ok(test.people_in(r) = 'O', 'O (owner) sees only their own time while nobody shares', r);
  PERFORM test.ok(test.rows_on(r, 'TS2') = 1 AND test.secs_on(r, 'TS2') = 1200, 'O''s shared-task row is O''s alone', r);
  PERFORM test.ok(test.secs_on(r, 'TS2') <> 7200, 'a 2 h planned session is not worked time (AC6.5)');

  -- E shares: O sees E's rows, but only on tasks O can see.
  PERFORM test.as_user('E', $q$SELECT public.user_op_set_time_region('{"share_time_with_owner": true}'::jsonb)$q$);
  r := test.report('O');
  PERFORM test.ok(test.people_in(r) = 'E,O', 'once E shares, O''s report has E''s rows too (AC6.3)', r);
  PERFORM test.ok(test.secs_on(r, 'TS2') = 4800 AND test.secs_on(r, 'TQ') = 900,
    'E''s time on tasks O can see is there, A''s isn''t (A doesn''t share)', r);
  PERFORM test.ok(test.rows_on(r, 'TE') = 0 AND position('E private' IN r) = 0,
    'E''s time on E''s private task never reaches O: not its row, title, project or note', r);
  r := test.report('A');
  PERFORM test.ok(test.people_in(r) = 'A', 'sharing is with the owner only: A still sees only A''s rows', r);
  r := test.report('M');
  PERFORM test.ok(test.people_in(r) = '', 'M (no time here any more) reads nothing, E''s shared time included', r);
  r := test.report('X');
  PERFORM test.ok(r = '[]', 'an outsider''s report on W is empty', r);
  r := test.report('X', 'NULL, NULL', 'UTC', 'W2');
  PERFORM test.ok(r = '[]', 'and their own workspace holds none of W''s', r);
  -- E stops sharing: O loses E's rows at once.
  PERFORM test.as_user('E', $q$SELECT public.user_op_set_time_region('{"share_time_with_owner": false}'::jsonb)$q$);
  PERFORM test.ok(test.people_in(test.report('O')) = 'O', 'turning sharing off takes E''s rows away again');
  PERFORM test.as_user('E', $q$SELECT public.user_op_set_time_region('{"share_time_with_owner": true}'::jsonb)$q$);

  -- Scoped reports: only projects the reader can see.
  r := test.report('O', format('ARRAY[%L]::uuid[], NULL', test.id('SB')));
  PERFORM test.ok(test.titles_in(r) = 'TS,TS2', 'a project report holds that project''s tasks', r);
  r := test.report('E', format('ARRAY[%L]::uuid[], NULL', test.id('PB')));
  PERFORM test.ok(r = '[]', 'E asking for O''s private project gets nothing, even for TQ that E sees', r);
  r := test.report('M', format('ARRAY[%L, %L]::uuid[], NULL', test.id('PB'), test.id('PC')));
  PERFORM test.ok(r = '[]', 'M asking for O''s private projects gets nothing', r);
  r := test.report('O', format('NULL, %L', test.id('C')));
  PERFORM test.ok(test.titles_in(r) = 'TC' AND test.secs_on(r, 'TC') = 2700,
    'a client report holds the client''s projects only (AC6.2)', r);
  r := test.report('E', format('NULL, %L', test.id('C')));
  PERFORM test.ok(r = '[]', 'a client report never reaches into a project the reader can''t see', r);
  r := test.value_as('O', format($q$SELECT count(*)::text FROM public.tasks_time_report(%L, current_date - 400, current_date)$q$, test.id('W')));
  PERFORM test.ok(r LIKE 'ERROR%up to a year%', 'a report covers at most a year', r);

  -- A task O can't see any more leaves O's report, E's shared time on it too.
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('PE'), 'member', test.id('O'), 'view', test.id('E'));
  PERFORM test.ok(test.rows_on(test.report('O'), 'TE') = 1, 'shared with O, E''s private project''s time shows');
  DELETE FROM public.resource_grants
  WHERE resource_type = 'bucket' AND resource_id = test.id('PE') AND subject_id = test.id('O');
  PERFORM test.ok(test.rows_on(test.report('O'), 'TE') = 0, 'unshared again, it''s gone from O''s report');
  -- A deleted task's time leaves every report.
  UPDATE public.tasks SET deleted_at = now() WHERE id = test.id('TQ');
  PERFORM test.ok(test.rows_on(test.report('E'), 'TQ') = 0, 'a task in the trash is out of the report');
END;
$$;

-- ── Days are the reader's (p_zone) ───────────────────────────────────────────
DO $$
DECLARE
  v_at timestamptz := ((current_date - 5)::timestamp + interval '23 hours 30 minutes') AT TIME ZONE 'UTC';
  r text;
BEGIN
  INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, started_at, ended_at, seconds, client_key)
  VALUES (test.id('W'), test.id('TS'), test.id('A'), 'focus', v_at, v_at + interval '10 minutes', 600, 'key-zone-001');
  r := test.report('A', 'NULL, NULL', 'UTC');
  PERFORM test.ok((SELECT x ->> 'entry_day' FROM jsonb_array_elements(r::jsonb) x WHERE x ->> 'seconds' = '600'
                   AND x ->> 'task_id' = test.id('TS')::text) = (current_date - 5)::text,
    'a stretch started 23:30 UTC is that day in UTC', r);
  r := test.report('A', 'NULL, NULL', 'Asia/Tokyo');
  PERFORM test.ok((SELECT x ->> 'entry_day' FROM jsonb_array_elements(r::jsonb) x WHERE x ->> 'seconds' = '600'
                   AND x ->> 'task_id' = test.id('TS')::text) = (current_date - 4)::text,
    'and the next day in Tokyo', r);
  r := test.report('A', 'NULL, NULL', 'Not/AZone');
  PERFORM test.ok(r LIKE '[%', 'an unknown zone falls back instead of failing', r);
END;
$$;

-- ── Time & region: one personal setting ──────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"time_zone": "Asia/Tokyo", "week_start": 0, "hour_cycle": "h23", "date_order": "day_month"}'::jsonb)::text$q$);
  PERFORM test.ok((r::jsonb ->> 'time_zone') = 'Asia/Tokyo' AND (r::jsonb ->> 'time_zone_manual') = 'true'
              AND (r::jsonb ->> 'week_start') = '0' AND (r::jsonb ->> 'hour_cycle') = 'h23'
              AND (r::jsonb ->> 'date_order') = 'day_month' AND (r::jsonb ->> 'share_time_with_owner') = 'true',
    'E sets zone, week start, clock and date order; the answer is the whole setting', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_zone('Europe/Warsaw')$q$);
  PERFORM test.ok(r = 'Asia/Tokyo' AND (SELECT time_zone FROM public.user_preferences WHERE user_id = test.id('E')) = 'Asia/Tokyo',
    'an old build''s sign-in write no longer changes a zone E picked', r);
  r := test.value_as('A', $q$SELECT public.user_op_set_time_zone('Europe/Warsaw')$q$);
  PERFORM test.ok(r = 'Europe/Warsaw', 'while a zone nobody picked still follows the device', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"week_start": null, "hour_cycle": null}'::jsonb)::text$q$);
  PERFORM test.ok((r::jsonb -> 'week_start') = 'null'::jsonb AND (r::jsonb -> 'hour_cycle') = 'null'::jsonb
              AND (r::jsonb ->> 'time_zone') = 'Asia/Tokyo' AND (r::jsonb ->> 'date_order') = 'day_month',
    'null goes back to the device''s; what wasn''t sent stays', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"time_zone": "Mars/Olympus"}'::jsonb)::text$q$);
  PERFORM test.ok(r LIKE 'ERROR%Unknown time zone%', 'an unknown zone is refused', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"time_zone": "UTC+3"}'::jsonb)::text$q$);
  PERFORM test.ok(r LIKE 'ERROR%Unknown time zone%', 'a POSIX zone string is refused (the app can''t read it)', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"time_zone": "PST"}'::jsonb)::text$q$);
  PERFORM test.ok(r LIKE 'ERROR%Unknown time zone%', 'so is an abbreviation', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"week_start": 7}'::jsonb)::text$q$);
  PERFORM test.ok(r LIKE 'ERROR%0 (Sunday) to 6%', 'a week start out of range is refused', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"hour_cycle": "h24"}'::jsonb)::text$q$);
  PERFORM test.ok(r LIKE 'ERROR%12- or 24-hour%', 'an unknown clock is refused', r);
  r := test.value_as('E', $q$SELECT public.user_op_set_time_region('{"user_id": "x"}'::jsonb)::text$q$);
  PERFORM test.ok(r LIKE 'ERROR%Unknown setting%', 'an unknown key is refused (nobody writes another person''s row)', r);
  r := test.value_as('A', $q$SELECT public.user_time_region() ->> 'time_zone'$q$);
  PERFORM test.ok(r = 'Europe/Warsaw', 'user_time_region reads the caller''s own setting', r);
  r := test.try(NULL, $q$SELECT public.user_op_set_time_region('{"week_start": 1}'::jsonb)$q$);
  PERFORM test.ok(r LIKE '42501%', 'nobody signed in can''t write a setting', r);
  r := test.as_key('K-none', $q$SELECT public.user_op_set_time_region('{"week_start": 1}'::jsonb)$q$);
  PERFORM test.ok(r LIKE '42501%' OR r LIKE '%Sign in%', 'nor can an API key', r);
END;
$$;

-- ── Account erasure (§Assumptions #26) ───────────────────────────────────────
DO $$
DECLARE
  v_preview jsonb;
  v_total integer;
BEGIN
  PERFORM test.track('E', 'TS', $q$'add', 1800, NULL, NULL, NULL, current_date, 'Personal words'$q$);
  v_total := (SELECT time_spent_seconds FROM public.tasks WHERE id = test.id('TS'));
  v_preview := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v_preview ->> 'time_notes_cleared')::integer >= 2,
    'the erasure preview counts E''s notes on tracked time', v_preview::text);
  PERFORM public.account_erase_workspace_data(test.id('E'), false);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.task_time_entries x
                              WHERE x.user_id = test.id('E') AND x.note IS NOT NULL AND x.workspace_id = test.id('W')),
    'erasing E clears E''s notes in O''s workspace');
  PERFORM test.ok((SELECT time_spent_seconds FROM public.tasks WHERE id = test.id('TS')) = v_total,
    'and the task''s total keeps E''s seconds');
END;
$$;
