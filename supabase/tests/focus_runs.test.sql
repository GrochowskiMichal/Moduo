-- TV-F6 · Focus runs: the timer re-cut, one run per person, takeover,
-- idempotent saves, claims behind the task gate, erasure
-- (supabase/migrations/20261008235243_focus_runs.sql from #323, re-cut by
-- 20261013130000_focus_runs_v3.sql). specs/tasks-v3.md block 22, AC8.11,
-- AC2.8, §Assumptions #11, #26; decisions "TV-F6".
--
-- Cast: O owns workspace W. E and M are members who share O's project PM; N is
-- a member who doesn't; V a viewer; R a member who leaves; X someone in
-- another workspace. SB is a project everyone sees.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'N', 'V', 'R', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('R'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PM'), test.id('W'), test.id('O'), 'O, E and M', false, '0002'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0003');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PM'), test.id('PB'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('M'), 'edit', test.id('O'));

CREATE FUNCTION test.new_task(p_who text, p_name text, p_project text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project))))
$$;
-- A run op's answer, one column of it, as text (through the signed-in path).
CREATE FUNCTION test.run_field(p_who text, p_call text, p_field text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format('SELECT (%s).%I::text', p_call, p_field))
$$;
CREATE FUNCTION test.open_run(p_who text) RETURNS public.focus_runs LANGUAGE sql STABLE AS $$
  SELECT * FROM public.focus_runs f WHERE f.user_id = test.id(p_who) AND f.status <> 'ended'
$$;
-- Whom focus_claims names on a task, as this person asks.
CREATE FUNCTION test.claims(p_who text, p_task text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(p.display_name, ',' ORDER BY p.display_name), '')
       FROM public.focus_claims(%L) c JOIN public.profiles p ON p.id = c.user_id
       WHERE c.task_id = %L$q$, test.id('W'), test.id(p_task)))
$$;

SELECT test.new_task('O', 'T1', 'PM');
SELECT test.new_task('O', 'T2', 'SB');
SELECT test.new_task('O', 'TP', 'PB');

-- ── The record: vocabulary, grants, Realtime ─────────────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  PERFORM test.ok(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'focus_runs_mode_check'))
                  LIKE '%per_task%pomodoro%off%'
              AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'focus_runs_mode_check'))
                  NOT LIKE '%stopwatch%',
    'vocabulary: the timer is per_task, pomodoro or off (62a); stopwatch is gone');
  PERFORM test.ok(has_table_privilege('authenticated', 'public.focus_runs', 'SELECT')
              AND NOT has_table_privilege('authenticated', 'public.focus_runs', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.focus_runs', 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.focus_runs', 'DELETE')
              AND NOT has_table_privilege('anon', 'public.focus_runs', 'SELECT'),
    'grants: the app reads its own runs and writes only through the ops');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_publication_tables
                          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'focus_runs'),
    'Realtime: focus_runs streams to the runner''s other devices');
  FOREACH v_fn IN ARRAY ARRAY[
    'public.focus_op_run_start(uuid, text, text, jsonb)', 'public.focus_op_run_save(uuid, text, boolean, jsonb)',
    'public.focus_op_run_end(uuid, text, jsonb)', 'public.focus_claims(uuid)'] LOOP
    PERFORM test.ok(has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('grants: %s is for signed-in people', v_fn));
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.focus_runs__apply(public.focus_runs, jsonb)', 'public.focus_runs__runner(uuid)',
    'public.focus_runs__lock(uuid)', 'public.focus_runs__clamp(timestamptz)',
    'public.focus_runs_member_removed()', 'public.account_erase_workspace_data(uuid, boolean)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('grants: %s is the server''s only', v_fn));
  END LOOP;
END;
$$;

-- ── Starting: one open run per person, the timer it starts with ──────────────
DO $$
DECLARE
  r text;
  v_first uuid;
BEGIN
  PERFORM test.ok(test.run_field('E', format($q$public.focus_op_run_start(%L, 'device-aa', 'per_task', %L::jsonb)$q$,
      test.id('W'), json_build_object('now_task_id', test.id('T1'))), 'mode') = 'per_task',
    'start: a Per task run');
  v_first := (test.open_run('E')).id;
  PERFORM test.ok((test.open_run('E')).phase = 'work' AND (test.open_run('E')).phase_seconds IS NULL
              AND (test.open_run('E')).now_task_id = test.id('T1') AND (test.open_run('E')).device_id = 'device-aa',
    'start: Per task is one stretch of work on the Now task, run by the device that started it');

  r := test.try('E', format($q$SELECT public.focus_op_run_start(%L, 'device-aa', 'stopwatch')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '22023%per task, pomodoro or off%', 'start: the old Stopwatch is refused', r);
  r := test.try('V', format($q$SELECT public.focus_op_run_start(%L, 'device-vv', 'per_task')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '42501%', 'start: a viewer can''t run Focus', r);
  r := test.try(NULL, format($q$SELECT public.focus_op_run_start(%L, 'device-zz', 'per_task')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '42501%', 'start: nobody signed in can''t either', r);

  PERFORM test.ok(test.run_field('E', format($q$public.focus_op_run_start(%L, 'device-bb', 'pomodoro', '{"mode": "off"}'::jsonb)$q$,
      test.id('W')), 'phase_seconds') = '1500',
    'start: a Pomodoro run starts a 25-minute work phase (the snapshot can''t change the timer it starts with)');
  PERFORM test.ok((SELECT count(*) FROM public.focus_runs WHERE user_id = test.id('E') AND status <> 'ended') = 1
              AND (SELECT status FROM public.focus_runs WHERE id = v_first) = 'ended'
              AND (test.open_run('E')).mode = 'pomodoro',
    'one run per person: starting again ends the open one, on any device (AC8.11)');
END;
$$;

-- ── The timer changes mid-run (62a) ──────────────────────────────────────────
DO $$
DECLARE
  v_run uuid := (test.open_run('E')).id;
  r text;
BEGIN
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false, '{"mode": "per_task", "phase": "break"}'::jsonb)$q$, v_run));
  PERFORM test.ok((test.open_run('E')).mode = 'per_task' AND (test.open_run('E')).phase = 'work'
              AND (test.open_run('E')).phase_seconds IS NULL,
    'mode: Pomodoro → Per task drops the phases (a stray phase is ignored)');
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false, '{"mode": "off"}'::jsonb)$q$, v_run));
  PERFORM test.ok((test.open_run('E')).mode = 'off' AND (test.open_run('E')).status = 'running',
    'mode: Off keeps the run going, with no clock (AC2.8)');
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false, '{"mode": "pomodoro", "phase_seconds": 600, "blocks_completed": 2}'::jsonb)$q$, v_run));
  PERFORM test.ok((test.open_run('E')).mode = 'pomodoro' AND (test.open_run('E')).phase_seconds = 600
              AND (test.open_run('E')).blocks_completed = 2,
    'mode: back to Pomodoro with the device''s own phase length');
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false, '{"mode": "pomodoro"}'::jsonb)$q$, v_run));
  PERFORM test.ok((test.open_run('E')).phase_seconds = 600 AND (test.open_run('E')).blocks_completed = 2,
    'mode: the same timer again leaves the rhythm alone');
  r := test.try('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false, '{"mode": "stopwatch"}'::jsonb)$q$, v_run));
  PERFORM test.ok(r LIKE '22023%per task, pomodoro or off%', 'mode: anything else is refused', r);
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false, '{"phase_seconds": null}'::jsonb)$q$, v_run));
  PERFORM test.ok((test.open_run('E')).phase_seconds = 600, 'mode: a Pomodoro run never loses its phase length');
  BEGIN
    UPDATE public.focus_runs SET phase_seconds = NULL WHERE id = v_run;
    r := 'ok';
  EXCEPTION WHEN check_violation THEN
    r := '23514 ' || SQLERRM;
  END;
  PERFORM test.ok(r LIKE '23514%focus_runs_phase_shape%', 'mode: nor can a write around the ops take it (the shape check holds NULLs)', r);
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false,
    '{"mode": "per_task", "now_task_id": "%s"}'::jsonb)$q$, v_run, test.id('T1')));
END;
$$;

-- ── Cross-device takeover: only the device in control writes ─────────────────
-- (Each op runs as its own statement before the check reads the table: a
-- STABLE read in the same statement would see the row as it was before.)
DO $$
DECLARE
  v_run uuid := (test.open_run('E')).id;
  v text;
BEGIN
  v := test.run_field('E', format($q$public.focus_op_run_save(%L, 'device-cc', false, '{"status": "paused", "now_task_id": null}'::jsonb)$q$, v_run), 'device_id');
  PERFORM test.ok(v = 'device-bb' AND (test.open_run('E')).status = 'running'
              AND (test.open_run('E')).now_task_id = test.id('T1'),
    'takeover: a device not in control gets the run back unchanged (and so learns it isn''t in control)', v);
  v := test.run_field('E', format($q$public.focus_op_run_save(%L, 'device-cc', true, '{"status": "paused"}'::jsonb)$q$, v_run), 'device_id');
  PERFORM test.ok(v = 'device-cc' AND (test.open_run('E')).status = 'paused' AND (test.open_run('E')).paused_at IS NOT NULL,
    'takeover: acting on another device takes control there (p_take)', v);
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-bb', false, '{"status": "running"}'::jsonb)$q$, v_run));
  PERFORM test.ok((test.open_run('E')).device_id = 'device-cc' AND (test.open_run('E')).status = 'paused',
    'takeover: the old device''s next save changes nothing (AC8.11: two devices never both count)');
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-cc', false, '{"status": "running"}'::jsonb)$q$, v_run));
  v := test.run_field('M', format($q$public.focus_op_run_save(%L, 'device-mm', true, '{"status": "paused"}'::jsonb)$q$, v_run), 'id');
  PERFORM test.ok(v IS NULL AND (test.open_run('E')).status = 'running',
    'takeover: someone else''s run is nobody else''s to take', v);
END;
$$;

-- ── The Now task goes through the gate ───────────────────────────────────────
DO $$
DECLARE
  v_run uuid := (test.open_run('E')).id;
BEGIN
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-cc', false, '{"now_task_id": "%s"}'::jsonb)$q$,
    v_run, test.id('TP')));
  PERFORM test.ok((test.open_run('E')).now_task_id IS NULL,
    'gate: a task the runner can''t see is never a run''s Now task');
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-cc', false, '{"now_task_id": "%s"}'::jsonb)$q$,
    v_run, test.id('T1')));
  PERFORM test.ok((test.open_run('E')).now_task_id = test.id('T1'), 'gate: one they can see is');
END;
$$;

-- ── Claims: "<name> is on this", behind the task gate ────────────────────────
DO $$
DECLARE
  v_run uuid := (test.open_run('E')).id;
BEGIN
  PERFORM test.ok(test.claims('M', 'T1') = 'E', 'claims: M, who sees the task, reads "E is on this"');
  PERFORM test.ok(test.claims('E', 'T1') = '', 'claims: never your own');
  PERFORM test.ok(test.claims('N', 'T1') = '', 'claims: N, who can''t see the task, reads nothing');
  PERFORM test.ok(test.claims('X', 'T1') = '', 'claims: someone outside the workspace reads nothing');
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.focus_runs WHERE user_id = %L$q$, test.id('E'))) = '0',
    'claims: M reads nothing else of E''s run (RLS: own runs only)');

  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-cc', false, '{"mode": "off"}'::jsonb)$q$, v_run));
  PERFORM test.ok(test.claims('M', 'T1') = 'E', 'claims: Off still says who is on it (only the clock is off)');

  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-cc', false, '{"status": "paused"}'::jsonb)$q$, v_run));
  PERFORM test.ok(test.claims('M', 'T1') = '', 'claims: a paused run claims nothing');
  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_save(%L, 'device-cc', false, '{"status": "running"}'::jsonb)$q$, v_run));

  UPDATE public.focus_runs SET seen_at = now() - interval '4 minutes' WHERE id = v_run;
  PERFORM test.ok(test.claims('M', 'T1') = '', 'claims: a run not seen for 3 minutes (a closed laptop) claims nothing');
  UPDATE public.focus_runs SET seen_at = now() WHERE id = v_run;

  DELETE FROM public.resource_grants
  WHERE resource_type = 'bucket' AND resource_id = test.id('PM') AND subject_id = test.id('E');
  PERFORM test.ok(test.claims('M', 'T1') = '', 'claims: a runner who lost the task claims it no more');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('E'), 'edit', test.id('O'));
  PERFORM test.ok(test.claims('M', 'T1') = 'E', 'claims: and again once it''s shared back');
END;
$$;

-- ── Saves from the time engine: a resent save counts once (AC8.11) ───────────
DO $$
DECLARE
  v_first text;
  v_again text;
BEGIN
  v_first := test.value_as('E', format($q$SELECT public.tasks_op_track_time(%L, %L, 'focus', 90, now(), 'save-key-0001')->>'status'$q$,
    test.id('W'), test.id('T1')));
  v_again := test.value_as('E', format($q$SELECT public.tasks_op_track_time(%L, %L, 'focus', 90, now(), 'save-key-0001')->>'status'$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(v_first = 'saved' AND v_again = 'duplicate'
              AND (SELECT count(*) FROM public.task_time_entries WHERE task_id = test.id('T1')) = 1
              AND (SELECT sum(seconds) FROM public.task_time_entries WHERE task_id = test.id('T1')) = 90,
    'save: the same stretch sent twice (a reload mid-save, a lost answer) is one entry');
END;
$$;

-- ── Ending ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_run uuid := (test.open_run('E')).id;
  v text;
BEGIN
  v := test.run_field('E', format($q$public.focus_op_run_end(%L, 'device-bb', '{"focused_seconds": 1200, "status": "running"}'::jsonb)$q$, v_run), 'status');
  PERFORM test.ok(v = 'ended' AND (SELECT focused_seconds FROM public.focus_runs WHERE id = v_run) = 1200
              AND (test.open_run('E')).id IS NULL,
    'end: Stop from any of my devices ends the run with its final numbers', v);
  v := test.run_field('E', format($q$public.focus_op_run_save(%L, 'device-bb', true, '{"status": "running"}'::jsonb)$q$, v_run), 'status');
  PERFORM test.ok(v = 'ended' AND (SELECT status FROM public.focus_runs WHERE id = v_run) = 'ended',
    'end: an ended run stays ended', v);
  PERFORM test.ok(test.claims('M', 'T1') = '', 'end: and claims nothing');
END;
$$;

-- ── Leaving and erasure (§Assumptions #26) ───────────────────────────────────
DO $$
DECLARE
  v_counts jsonb;
BEGIN
  PERFORM test.as_user('R', format($q$SELECT public.focus_op_run_start(%L, 'device-rr', 'per_task', '{"now_task_id": "%s"}'::jsonb)$q$,
    test.id('W'), test.id('T2')));
  PERFORM test.ok((test.open_run('R')).id IS NOT NULL, 'R runs Focus in W');
  DELETE FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('R');
  PERFORM test.ok((SELECT count(*) FROM public.focus_runs WHERE user_id = test.id('R')) = 0,
    'leave: leaving a workspace takes your runs there');

  PERFORM test.as_user('E', format($q$SELECT public.focus_op_run_start(%L, 'device-bb', 'pomodoro')$q$, test.id('W')));
  PERFORM test.as_user('X', format($q$SELECT public.focus_op_run_start(%L, 'device-xx', 'per_task')$q$, test.id('W2')));
  v_counts := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v_counts->>'focus_runs_deleted')::int = (SELECT count(*) FROM public.focus_runs WHERE user_id = test.id('E'))
              AND (v_counts->>'focus_runs_deleted')::int = 3,
    'erasure: the preview counts every run of E''s in workspaces E doesn''t own', v_counts->>'focus_runs_deleted');
  v_counts := public.account_erase_workspace_data(test.id('X'), true);
  PERFORM test.ok((v_counts->>'focus_runs_deleted')::int = 0,
    'erasure: runs in a workspace you own go with the workspace, not here');
  PERFORM public.account_erase_workspace_data(test.id('E'), false);
  PERFORM test.ok((SELECT count(*) FROM public.focus_runs WHERE user_id = test.id('E')) = 0
              AND (SELECT count(*) FROM public.focus_runs WHERE user_id = test.id('X')) = 1,
    'erasure: E''s runs are gone; nobody else''s are touched');
END;
$$;
