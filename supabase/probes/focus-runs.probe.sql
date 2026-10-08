-- Probe for supabase/migrations/20261009120000_focus_runs.sql (TV-F2,
-- specs/tasks-v2.md block 11). Run it on a throwaway Postgres 17 database that
-- holds nothing else, on top of the TV-D3 probe chain:
--
--   createdb -h /tmp -p 54371 -U postgres f2_probe
--   P="-h /tmp -p 54371 -U postgres -d f2_probe -v ON_ERROR_STOP=1 -q"
--   psql $P -f supabase/probes/tasks-assignee.stub.sql \
--     -f supabase/migrations/20261008150000_tasks_assignee_creator.sql \
--     -f supabase/probes/tasks-queue.stub.sql \
--     -f supabase/probes/tasks-queue.seed.sql \
--     -f supabase/migrations/20261008171500_tasks_personal_queue.sql \
--     -f supabase/probes/tasks-time.seed.sql \
--     -f supabase/probes/tasks-time.stub.sql
--   psql $P -1 -f supabase/migrations/20261008225500_tasks_time_entries.sql
--   psql $P -f supabase/probes/focus-runs.stub.sql -f supabase/probes/focus-runs.seed.sql
--   psql $P -1 -f supabase/migrations/20261009120000_focus_runs.sql
--   psql $P -f supabase/probes/focus-runs.probe.sql
--
-- Every check stops the run with the failing check's message. A clean run
-- prints one PASS line per check and ends with "PASS: all".

SET timezone = 'UTC';

-- One op call as a person; the row it answered (or the error text).
CREATE FUNCTION probe.run_start(p_who text, p_mode text, p_state jsonb DEFAULT '{}', p_device text DEFAULT 'device-one',
                                p_ws text DEFAULT 'W')
RETURNS public.focus_runs LANGUAGE plpgsql AS $$
DECLARE r public.focus_runs;
BEGIN
  PERFORM probe.as_user(p_who);
  r := public.focus_op_run_start(probe.id(p_ws), p_device, p_mode, p_state);
  PERFORM probe.as_system();
  RETURN r;
END;
$$;
CREATE FUNCTION probe.run_save(p_who text, p_run uuid, p_device text, p_take boolean, p_state jsonb)
RETURNS public.focus_runs LANGUAGE plpgsql AS $$
DECLARE r public.focus_runs;
BEGIN
  PERFORM probe.as_user(p_who);
  r := public.focus_op_run_save(p_run, p_device, p_take, p_state);
  PERFORM probe.as_system();
  RETURN r;
END;
$$;
CREATE FUNCTION probe.run_end(p_who text, p_run uuid, p_device text, p_state jsonb DEFAULT '{}')
RETURNS public.focus_runs LANGUAGE plpgsql AS $$
DECLARE r public.focus_runs;
BEGIN
  PERFORM probe.as_user(p_who);
  r := public.focus_op_run_end(p_run, p_device, p_state);
  PERFORM probe.as_system();
  RETURN r;
END;
$$;
CREATE FUNCTION probe.claims(p_who text, p_ws text DEFAULT 'W')
RETURNS TABLE (who uuid, task uuid) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM probe.as_user(p_who);
  RETURN QUERY SELECT c.user_id, c.task_id FROM public.focus_claims(probe.id(p_ws)) c;
  PERFORM probe.as_system();
END;
$$;
CREATE FUNCTION probe.error_of_as(p_who text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM probe.as_user(p_who);
  EXECUTE p_sql;
  PERFORM probe.as_system();
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM probe.as_system();
  RETURN SQLERRM;
END;
$$;
CREATE FUNCTION probe.open_runs(p_who text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.focus_runs WHERE user_id = probe.id(p_who) AND status <> 'ended'
$$;
GRANT USAGE ON SCHEMA probe TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION probe.id(text), probe.as_user(text), probe.as_system() TO anon, authenticated, service_role;

-- ── 1. Start: one open run per person (F2-1) ─────────────────────────────────

DO $$
DECLARE
  r public.focus_runs;
  r2 public.focus_runs;
BEGIN
  r := probe.run_start('A', 'pomodoro', jsonb_build_object(
    'now_task_id', probe.id('R1 shared'), 'phase_seconds', 1800,
    'phase_started_at', now() - interval '1 minute'));
  ASSERT r.status = 'running' AND r.mode = 'pomodoro' AND r.phase = 'work' AND r.phase_seconds = 1800
     AND r.now_task_id = probe.id('R1 shared') AND r.device_id = 'device-one' AND r.user_id = probe.id('A')
     AND r.workspace_id = probe.id('W') AND r.paused_at IS NULL AND r.ended_at IS NULL,
    format('start: %s', row_to_json(r));
  ASSERT (SELECT count(*) FROM public.focus_runs WHERE id = r.id) = 1, 'start: no row';

  -- A second start ends the first.
  r2 := probe.run_start('A', 'stopwatch', jsonb_build_object('now_task_id', probe.id('R2 shared')));
  ASSERT r2.mode = 'stopwatch' AND r2.phase_seconds IS NULL AND r2.id <> r.id, format('second start: %s', row_to_json(r2));
  ASSERT (SELECT status FROM public.focus_runs WHERE id = r.id) = 'ended'
     AND (SELECT ended_at FROM public.focus_runs WHERE id = r.id) IS NOT NULL, 'start: the first run is still open';
  ASSERT probe.open_runs('A') = 1, 'start: two open runs';

  -- A pomodoro without its length gets the default; a stopwatch can't be on a break.
  ASSERT probe.error_of_as('A', format($q$SELECT public.focus_op_run_start(%L, 'device-one', 'stopwatch', '{"phase":"break"}')$q$,
                                     probe.id('W'))) LIKE '%focus_runs_phase_shape%', 'start: a stopwatch on a break';
  ASSERT probe.error_of_as('A', format($q$SELECT public.focus_op_run_start(%L, 'device-one', 'sprint', '{}')$q$,
                                     probe.id('W'))) = 'A run is a pomodoro or a stopwatch.', 'start: a made-up mode';
  ASSERT probe.error_of_as('A', format($q$SELECT public.focus_op_run_start(%L, 'no', 'pomodoro', '{}')$q$,
                                     probe.id('W'))) = 'That device id isn''t valid.', 'start: a bad device id';
  ASSERT probe.open_runs('A') = 1, 'start: a refused start ended the open run';
  RAISE NOTICE 'PASS start: a run starts on the Now task; a new one ends the old; bad input refused';
END;
$$;

-- ── 2. Who may run (permissions) ─────────────────────────────────────────────

DO $$
BEGIN
  ASSERT probe.error_of_as('V', format($q$SELECT public.focus_op_run_start(%L, 'device-vera', 'pomodoro', '{}')$q$,
                                     probe.id('W'))) = 'You don''t have edit access to Tasks in this workspace.',
    'perm: a viewer started a run';
  ASSERT probe.error_of_as('N', format($q$SELECT public.focus_op_run_start(%L, 'device-nell', 'pomodoro', '{}')$q$,
                                     probe.id('W'))) = 'You don''t have edit access to Tasks in this workspace.',
    'perm: an outsider started a run';
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.focus_op_run_start(probe.id('W'), 'device-none', 'pomodoro', '{}');
    ASSERT false, 'perm: a run started with nobody signed in';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- A key is not a person in the app: no runs.
  PERFORM probe.as_key('K');
  BEGIN
    PERFORM public.focus_op_run_start(probe.id('W'), 'device-key1', 'pomodoro', '{}');
    ASSERT false, 'perm: a key started a run';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM probe.as_system();
  RAISE NOTICE 'PASS perm: viewers, outsiders, nobody and keys can''t run';
END;
$$;

-- ── 3. Saving: the device in control, taking over (F2-4) ─────────────────────

DO $$
DECLARE
  run uuid := (SELECT id FROM public.focus_runs WHERE user_id = probe.id('A') AND status <> 'ended');
  r public.focus_runs;
  seen timestamptz;
BEGIN
  UPDATE public.focus_runs SET seen_at = now() - interval '10 seconds' WHERE id = run;
  r := probe.run_save('A', run, 'device-one', false, jsonb_build_object(
    'status', 'paused', 'paused_at', now(), 'focused_seconds', 120, 'now_task_id', probe.id('R1 shared')));
  ASSERT r.status = 'paused' AND r.paused_at IS NOT NULL AND r.focused_seconds = 120
     AND r.now_task_id = probe.id('R1 shared') AND r.seen_at > now() - interval '1 second',
    format('save: pause %s', row_to_json(r));
  seen := r.seen_at;

  -- Another device, not taking over: the row comes back unchanged.
  r := probe.run_save('A', run, 'device-two', false, '{"status":"running","focused_seconds":999}');
  ASSERT r.status = 'paused' AND r.focused_seconds = 120 AND r.device_id = 'device-one',
    format('save: a device not in control wrote %s', row_to_json(r));
  ASSERT (SELECT focused_seconds FROM public.focus_runs WHERE id = run) = 120, 'save: stored a stranger''s snapshot';

  -- Acting on the other device takes control, from now.
  UPDATE public.focus_runs SET control_at = now() - interval '1 hour' WHERE id = run;
  r := probe.run_save('A', run, 'device-two', true, '{"status":"running","focused_seconds":130}');
  ASSERT r.status = 'running' AND r.paused_at IS NULL AND r.device_id = 'device-two' AND r.focused_seconds = 130
     AND r.control_at > now() - interval '1 second',
    format('save: take over %s', row_to_json(r));
  -- Saving again from the device in control keeps when it took it.
  UPDATE public.focus_runs SET control_at = now() - interval '5 seconds' WHERE id = run;
  r := probe.run_save('A', run, 'device-two', true, '{"focused_seconds":131}');
  ASSERT r.control_at < now() - interval '4 seconds', 'save: a save by the device in control moved control_at';
  -- And the first device now only reads.
  r := probe.run_save('A', run, 'device-one', false, '{"focused_seconds":1}');
  ASSERT r.device_id = 'device-two' AND r.focused_seconds = 131, 'save: the old device still writes';

  -- Someone else's run: nothing.
  r := probe.run_save('B', run, 'device-bea', true, '{"focused_seconds":5}');
  ASSERT r IS NULL OR r.id IS NULL, 'save: Bea saved Ada''s run';
  ASSERT (SELECT focused_seconds FROM public.focus_runs WHERE id = run) = 131, 'save: Bea changed Ada''s run';

  -- Now on a task Ada can't see, or in another workspace: on nothing.
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object('now_task_id', probe.id('R4 Bea private')));
  ASSERT r.now_task_id IS NULL, 'save: Now is a task Ada can''t see';
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object('now_task_id', probe.id('R5 Nell''s')));
  ASSERT r.now_task_id IS NULL, 'save: Now is another workspace''s task';
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object('now_task_id', probe.id('R3 Ada private')));
  ASSERT r.now_task_id = probe.id('R3 Ada private'), 'save: Now on Ada''s own private task';

  -- Done this run: each task once, in order.
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object('done_task_ids',
    jsonb_build_array(probe.id('R2 shared'), probe.id('R1 shared'), probe.id('R2 shared'))));
  ASSERT r.done_task_ids = ARRAY[probe.id('R2 shared'), probe.id('R1 shared')],
    format('save: done list %s', r.done_task_ids);

  -- A clock in the future is clamped to the server's.
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object('phase_started_at', now() + interval '2 hours'));
  ASSERT r.phase_started_at <= now(), 'save: phase starts in the future';

  -- Garbage is refused, and changes nothing.
  ASSERT probe.error_of_as('A', format($q$SELECT public.focus_op_run_save(%L, 'device-two', false, '{"done_task_ids":["nope"]}')$q$, run))
         = 'That run state isn''t valid.', 'save: a bad done list';
  ASSERT probe.error_of_as('A', format($q$SELECT public.focus_op_run_save(%L, 'device-two', false, '{"status":"ended"}')$q$, run))
         = 'A run is running or paused.', 'save: ended through save';
  ASSERT probe.error_of_as('A', format($q$SELECT public.focus_op_run_save(%L, 'device-two', false, '{"focused_seconds":-5}')$q$, run))
         LIKE '%focus_runs_counts%', 'save: negative focus';
  ASSERT (SELECT status FROM public.focus_runs WHERE id = run) = 'running', 'save: a refused save changed the run';
  RAISE NOTICE 'PASS save: only the device in control writes; acting elsewhere takes over; Now must be visible';
END;
$$;

-- ── 4. Claims: "<name> is on this" (F2-6) ────────────────────────────────────

DO $$
DECLARE
  run uuid := (SELECT id FROM public.focus_runs WHERE user_id = probe.id('A') AND status <> 'ended');
  r public.focus_runs;
BEGIN
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object('now_task_id', probe.id('R1 shared')));
  ASSERT (SELECT count(*) FROM probe.claims('B') c WHERE c.who = probe.id('A') AND c.task = probe.id('R1 shared')) = 1,
    'claims: Bea doesn''t see Ada on R1';
  ASSERT (SELECT count(*) FROM probe.claims('V')) = 1, 'claims: a viewer doesn''t see who is on what';
  ASSERT (SELECT count(*) FROM probe.claims('A')) = 0, 'claims: Ada sees her own run as a claim';
  ASSERT (SELECT count(*) FROM probe.claims('N')) = 0, 'claims: an outsider sees the workspace''s runs';
  ASSERT (SELECT count(*) FROM probe.claims('N', 'WN')) = 0, 'claims: Ada''s run shows in another workspace';

  -- What the claim says, and nothing more.
  ASSERT (SELECT string_agg(a, ',') FROM unnest((SELECT proargnames FROM pg_proc WHERE proname = 'focus_claims')) a)
         = 'p_workspace_id,user_id,task_id', 'claims: answers more than who and which task';

  -- On a task Bea can't see: no claim for her.
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object('now_task_id', probe.id('R3 Ada private')));
  ASSERT (SELECT count(*) FROM probe.claims('B')) = 0, 'claims: Bea sees Ada on a private task';

  -- Paused: no claim.
  r := probe.run_save('A', run, 'device-two', false, jsonb_build_object(
    'now_task_id', probe.id('R1 shared'), 'status', 'paused'));
  ASSERT (SELECT count(*) FROM probe.claims('B')) = 0, 'claims: a paused run claims';
  r := probe.run_save('A', run, 'device-two', false, '{"status":"running"}');
  ASSERT (SELECT count(*) FROM probe.claims('B')) = 1, 'claims: resumed run doesn''t claim';

  -- A device that stopped writing (closed laptop): the claim lapses.
  UPDATE public.focus_runs SET seen_at = now() - interval '4 minutes' WHERE id = run;
  ASSERT (SELECT count(*) FROM probe.claims('B')) = 0, 'claims: a stale run claims';
  UPDATE public.focus_runs SET seen_at = now() WHERE id = run;

  -- Bea's own run shows to Ada.
  PERFORM probe.run_start('B', 'stopwatch', jsonb_build_object('now_task_id', probe.id('R2 shared')), 'device-bea');
  ASSERT (SELECT count(*) FROM probe.claims('A') c WHERE c.who = probe.id('B') AND c.task = probe.id('R2 shared')) = 1,
    'claims: Ada doesn''t see Bea on R2';
  RAISE NOTICE 'PASS claims: teammates see who is on which visible task, only while the run is live';
END;
$$;

-- ── 5. Reading runs: own rows only ───────────────────────────────────────────

BEGIN;
DO $$ BEGIN PERFORM probe.as_user('B'); END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.focus_runs) = (SELECT count(*) FROM public.focus_runs WHERE user_id = probe.id('B')),
    'rls: Bea reads someone else''s run';
  ASSERT (SELECT count(*) FROM public.focus_runs) >= 1, 'rls: Bea can''t read her own run';
  BEGIN
    UPDATE public.focus_runs SET focused_seconds = 1;
    ASSERT false, 'rls: Bea updated a run directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.focus_runs (workspace_id, user_id, mode, device_id)
    VALUES (probe.id('W'), probe.id('B'), 'stopwatch', 'device-bea');
    ASSERT false, 'rls: Bea inserted a run directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
COMMIT;

DO $$ BEGIN RAISE NOTICE 'PASS rls: each person reads their own runs; no direct writes'; END $$;

-- ── 6. Ending (F2-1) ─────────────────────────────────────────────────────────

DO $$
DECLARE
  run uuid := (SELECT id FROM public.focus_runs WHERE user_id = probe.id('A') AND status <> 'ended');
  r public.focus_runs;
BEGIN
  -- Any of Ada's devices can end it, with the final numbers.
  r := probe.run_end('A', run, 'device-one', '{"focused_seconds":600,"blocks_completed":1,"status":"running"}');
  ASSERT r.status = 'ended' AND r.ended_at IS NOT NULL AND r.paused_at IS NULL AND r.focused_seconds = 600
     AND r.blocks_completed = 1 AND r.device_id = 'device-one', format('end: %s', row_to_json(r));
  ASSERT probe.open_runs('A') = 0, 'end: still open';
  ASSERT NOT EXISTS (SELECT 1 FROM probe.claims('B') c WHERE c.who = probe.id('A')), 'end: an ended run claims';
  -- Ended stays ended.
  r := probe.run_save('A', run, 'device-one', true, '{"status":"running","focused_seconds":1}');
  ASSERT r.status = 'ended' AND r.focused_seconds = 600, 'end: a save reopened the run';
  r := probe.run_end('A', run, 'device-two', '{"focused_seconds":1}');
  ASSERT r.focused_seconds = 600 AND r.device_id = 'device-one', 'end: ending twice changed it';
  -- Someone else can't end it.
  r := probe.run_end('B', (SELECT id FROM public.focus_runs WHERE user_id = probe.id('A') ORDER BY started_at DESC LIMIT 1), 'device-bea');
  ASSERT r IS NULL OR r.id IS NULL, 'end: Bea ended Ada''s run';
  RAISE NOTICE 'PASS end: any of your devices ends your run, once; nobody else can';
END;
$$;

-- ── 7. The stale line-up: Keep all ───────────────────────────────────────────

DO $$
DECLARE
  n integer;
  activity bigint := (SELECT count(*) FROM public.module_activity);
BEGIN
  PERFORM probe.as_user('A');
  SELECT count(*) INTO n FROM public.tasks_op_queue_keep(probe.id('W'));
  PERFORM probe.as_system();
  ASSERT n = (SELECT count(*) FROM public.task_queue WHERE user_id = probe.id('A') AND workspace_id = probe.id('W'))
     AND n >= 2, format('keep: answered %s rows, expected Ada''s queue', n);
  ASSERT (SELECT min(updated_at) FROM public.task_queue WHERE user_id = probe.id('A')) > now() - interval '1 minute',
    'keep: Ada''s line-up still looks old';
  ASSERT (SELECT max(updated_at) FROM public.task_queue WHERE user_id = probe.id('B')) < now() - interval '3 days',
    'keep: touched Bea''s line-up';
  ASSERT (SELECT count(*) FROM public.module_activity) = activity, 'keep: logged';
  ASSERT probe.error_of_as('V', format('SELECT * FROM public.tasks_op_queue_keep(%L)', probe.id('W')))
         = 'You don''t have edit access to Tasks in this workspace.', 'keep: a viewer kept a line-up';
  RAISE NOTICE 'PASS keep: Keep all marks only your line-up as looked at';
END;
$$;

-- ── 8. Leaving the workspace, deleting the account, time entries ─────────────

DO $$
DECLARE
  xr public.focus_runs;
  e uuid;
BEGIN
  xr := probe.run_start('X', 'pomodoro', jsonb_build_object('now_task_id', probe.id('R6 Xavier''s'), 'phase_seconds', 1500),
                        'device-xavier');
  INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, started_at, ended_at, seconds, run_id)
  VALUES (probe.id('W'), probe.id('R6 Xavier''s'), probe.id('X'), 'focus', now() - interval '1 minute', now(), 60, xr.id)
  RETURNING id INTO e;
  ASSERT probe.error_of_as('X', format($q$INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds, run_id)
                                         VALUES (%L, %L, %L, 'adjustment', 1, %L)$q$,
                                      probe.id('W'), probe.id('R6 Xavier''s'), probe.id('X'), gen_random_uuid()))
         LIKE '%task_time_entries_run_id_fkey%', 'entries: a run id that isn''t a run';

  DELETE FROM public.workspace_members WHERE workspace_id = probe.id('W') AND user_id = probe.id('X');
  ASSERT NOT EXISTS (SELECT 1 FROM public.focus_runs WHERE user_id = probe.id('X')), 'leave: the run stayed';
  ASSERT (SELECT run_id FROM public.task_time_entries WHERE id = e) IS NULL
     AND (SELECT seconds FROM public.task_time_entries WHERE id = e) = 60, 'leave: the time entry went or kept a dead run';

  -- Deleting an account deletes its runs.
  PERFORM probe.run_start('B', 'stopwatch', '{}', 'device-bea');
  ASSERT EXISTS (SELECT 1 FROM public.focus_runs WHERE user_id = probe.id('B')), 'erase: no run to erase';
  DELETE FROM public.workspace_members WHERE user_id = probe.id('B');
  DELETE FROM public.task_queue WHERE user_id = probe.id('B');
  DELETE FROM public.task_time_entries WHERE user_id = probe.id('B');
  UPDATE public.tasks SET assignee_id = NULL WHERE assignee_id = probe.id('B');
  DELETE FROM public.profiles WHERE id = probe.id('B');
  ASSERT NOT EXISTS (SELECT 1 FROM public.focus_runs WHERE user_id = probe.id('B')), 'erase: a deleted account''s run stayed';
  RAISE NOTICE 'PASS leave: leaving or deleting the account takes the runs; time entries keep their seconds';
END;
$$;

-- ── 9. Grants ────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.focus_runs;
    ASSERT false, 'anon: read runs';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
COMMIT;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'focus_op_run_start(uuid, text, text, jsonb)', 'focus_op_run_save(uuid, text, boolean, jsonb)',
    'focus_op_run_end(uuid, text, jsonb)', 'focus_claims(uuid)', 'tasks_op_queue_keep(uuid)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), 'grants: anon can call ' || fn;
    ASSERT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), 'grants: authenticated can''t call ' || fn;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'focus_runs__runner(uuid)', 'focus_runs__lock(uuid)', 'focus_runs__clamp(timestamptz)',
    'focus_runs__apply(public.focus_runs, jsonb)', 'focus_runs_member_removed()'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), 'grants: anon can call ' || fn;
    ASSERT NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), 'grants: authenticated can call ' || fn;
  END LOOP;
  ASSERT NOT has_table_privilege('anon', 'public.focus_runs', 'SELECT'), 'grants: anon reads runs';
  ASSERT NOT has_table_privilege('anon', 'public.focus_runs', 'TRUNCATE'), 'grants: anon truncates runs';
  ASSERT NOT has_table_privilege('authenticated', 'public.focus_runs', 'INSERT'), 'grants: authenticated inserts';
  ASSERT NOT has_table_privilege('authenticated', 'public.focus_runs', 'UPDATE'), 'grants: authenticated updates';
  ASSERT NOT has_table_privilege('authenticated', 'public.focus_runs', 'DELETE'), 'grants: authenticated deletes';
  ASSERT NOT has_table_privilege('authenticated', 'public.focus_runs', 'TRUNCATE'), 'grants: authenticated truncates';
  ASSERT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'focus_runs'),
    'realtime: focus_runs isn''t published';
  RAISE NOTICE 'PASS grants: ops and claims for signed-in users; helpers closed; no direct writes; published';
END;
$$;

DO $$ BEGIN RAISE NOTICE 'PASS: all'; END $$;
