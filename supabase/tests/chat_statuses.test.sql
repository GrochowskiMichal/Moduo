-- Chat v2 statuses, saved statuses and chat_now (CV-17:
-- supabase/migrations/…_chat_v2_statuses.sql). "statuses, saved statuses,
-- chat_now" (AC11.1, AC11.3, AC11.4, AC6.6): one status for every workspace;
-- presets and saved ones; expiry clears it; chat_now shows "Focusing", "until"
-- only with a Pomodoro phase (never from a task), the task only with the opt-in and
-- visibility; a do-not-disturb status drops pings (CV-18). Erasure and grants too.
--
-- Cast: O owns W ("Acme", Duo); A, B and C are members. X owns W2, where A is
-- a member too; X shares no workspace with B or C. K is an API key in W. SB is
-- a project everyone in W sees; PM is seen by O, A and B only. TA is A's task
-- in PM; T2 is a task in W2.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Acme'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (test.id('W2'), test.id('A'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv17-statuses'),
        '{"chat": "view", "tasks": "view"}'::jsonb, test.id('A'));
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PM'), test.id('W'), test.id('O'), 'O, A and B', false, '0002'),
  (test.id('B2'), test.id('W2'), test.id('X'), 'Theirs', false, '0001');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PM');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('A'), 'edit', test.id('O')),
       (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('B'), 'edit', test.id('O'));
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TA'), 'title', 'Draft the pitch', 'bucket_id', test.id('PM'))));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes TA in PM', v);
  v := test.as_user('X', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W2'),
    jsonb_build_object('id', test.id('T2'), 'title', 'Their task', 'bucket_id', test.id('B2'))));
  PERFORM test.ok(v LIKE 'ok %', 'setup: X makes T2 in W2', v);
END;
$$;
UPDATE public.tasks SET estimate_minutes = 45 WHERE id = test.id('TA');

-- chat_now(ws) as someone: the entry about p_about ('' when none).
CREATE FUNCTION test.now_of(p_who text, p_ws text, p_about text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((
    SELECT e::text FROM jsonb_array_elements(
             (test.value_as(p_who, format($q$SELECT public.chat_now(%L)::text$q$, test.id(p_ws))))::jsonb) e
     WHERE e ->> 'user_id' = test.id(p_about)::text), '')
$$;
CREATE FUNCTION test.now_field(p_who text, p_ws text, p_about text, p_field text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT nullif(test.now_of(p_who, p_ws, p_about), '')::jsonb ->> p_field
$$;
CREATE FUNCTION test.set(p_who text, p_patch jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.user_op_set_status(%L::jsonb)$q$, p_patch))
$$;
-- A running Focus run for p_who.
CREATE FUNCTION test.focus(p_who text, p_ws text, p_mode text, p_phase text DEFAULT 'work',
                           p_seen interval DEFAULT interval '0', p_task text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  DELETE FROM public.focus_runs WHERE user_id = test.id(p_who);
  INSERT INTO public.focus_runs (workspace_id, user_id, status, mode, phase, phase_started_at, phase_seconds,
                                 now_task_id, device_id, seen_at)
  VALUES (test.id(p_ws), test.id(p_who), 'running', p_mode,
          CASE WHEN p_mode = 'pomodoro' THEN p_phase ELSE 'work' END,
          now() - interval '5 minutes', CASE WHEN p_mode = 'pomodoro' THEN 1500 END,
          CASE WHEN p_task IS NOT NULL THEN test.id(p_task) END, 'db-test-device', now() - p_seen);
$$;

-- ── Grants and shape ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  PERFORM test.ok(
    has_table_privilege('authenticated', 'public.user_statuses', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.user_statuses', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.user_statuses', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.user_statuses', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.user_statuses', 'SELECT')
    AND has_table_privilege('authenticated', 'public.user_saved_statuses', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.user_saved_statuses', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.user_saved_statuses', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.user_saved_statuses', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.user_saved_statuses', 'SELECT'),
    'grants: both tables are read under their rules and written only through the ops');

  SELECT string_agg(f, ', ') INTO v_bad FROM unnest(ARRAY[
    'public.user_op_set_status(jsonb)', 'public.user_op_clear_status()', 'public.user_op_save_status(jsonb, uuid)',
    'public.user_op_forget_status(uuid)', 'public.chat_now(uuid)',
    'public.chat_realtime_topic_allowed(text)', 'public.chat_realtime_topic_writable(text)']) f
   WHERE NOT has_function_privilege('authenticated', f, 'EXECUTE')
      OR has_function_privilege('anon', f, 'EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: the ops, chat_now and the rule checks are for signed-in people only', v_bad);

  SELECT string_agg(f, ', ') INTO v_bad FROM unnest(ARRAY[
    'public.user_statuses__parts(jsonb, boolean)', 'public.user_statuses__json(public.user_statuses, timestamptz)',
    'public.user_statuses__expire(timestamptz)', 'public.notice__gate(uuid, uuid, text, timestamptz)',
    'public.user_statuses__member(uuid)',
    'public.account_erase_workspace_data(uuid, boolean)']) f
   WHERE has_function_privilege('authenticated', f, 'EXECUTE')
      OR has_function_privilege('anon', f, 'EXECUTE')
      OR NOT has_function_privilege('service_role', f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: the helpers, the expiry, the gate and erasure are server-only', v_bad);
  PERFORM test.ok(to_regprocedure('public.user_statuses__shares_workspace(uuid)') IS NULL
              AND test.as_user('B', format($q$SELECT public.user_statuses__member(%L)$q$, test.id('W'))) LIKE '42501%',
    'grants: no status or presence helper answers a client directly (no probing who shares a workspace)');

  -- The only new functions a signed-in person can call are the ones above.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND (p.proname LIKE 'user_statuses%' OR p.proname LIKE 'user_op_%status%' OR p.proname = 'chat_now')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('user_op_set_status', 'user_op_clear_status', 'user_op_save_status',
                           'user_op_forget_status', 'chat_now');
  PERFORM test.ok(v_bad IS NULL, 'grants: no other statuses function is reachable', v_bad);

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.oid IN ('public.user_statuses__member(uuid)'::regprocedure, 'public.user_op_set_status(jsonb)'::regprocedure, 'public.user_op_clear_status()'::regprocedure,
                   'public.user_op_save_status(jsonb, uuid)'::regprocedure, 'public.user_op_forget_status(uuid)'::regprocedure,
                   'public.chat_now(uuid)'::regprocedure)
     AND (NOT p.prosecdef OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=""'));
  PERFORM test.ok(v_bad IS NULL, 'shape: every statuses function a person calls pins an empty search_path', v_bad);

  PERFORM test.ok(
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_statuses_preset_check')
      LIKE '%meeting%sick%vacation%commuting%'
    AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_saved_statuses_clear_after_check')
      LIKE '%30m%1h%today%this_week%date%never%',
    'shape: presets and "clear after" are closed lists');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_publication_tables
                           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_statuses')
              AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_saved_statuses'),
    'shape: statuses are published, saved statuses are not');
  PERFORM test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'user-statuses-expire' AND schedule = '*/5 * * * *'),
    'shape: the expiry job runs every 5 minutes');
END;
$$;

-- ── Setting a status, one for every workspace (AC11.4) ─────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.set('A', jsonb_build_object('emoji', '🌴', 'text', 'On vacation', 'preset', 'vacation',
                                         'clear_at', now() + interval '4 days'));
  PERFORM test.ok(v = 'ok 1', 'set: A sets the On vacation preset, clearing in 4 days', v);
  PERFORM test.ok(
    (SELECT s.emoji = '🌴' AND s.text = 'On vacation' AND s.preset = 'vacation' AND NOT s.dnd AND s.set_at IS NOT NULL
       FROM public.user_statuses s WHERE s.user_id = test.id('A')),
    'set: the row holds the emoji, words and preset');
  v := test.set('B', '{"emoji": "🚆", "text": "Commuting", "preset": "commuting"}');
  PERFORM test.ok(v = 'ok 1', 'set: B sets Commuting with no clear time (never)', v);

  -- Who reads it.
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.user_statuses WHERE user_id = %L$q$, test.id('A'))) = '1'
              AND test.value_as('X', format($q$SELECT count(*)::text FROM public.user_statuses WHERE user_id = %L$q$, test.id('A'))) = '1',
    'read: B (in W) and X (in W2) both read A''s one status');
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM public.user_statuses WHERE user_id = %L$q$, test.id('B'))) = '0',
    'read: X, who shares no workspace with B, can''t read B''s status');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'status')::jsonb ->> 'text' = 'On vacation'
              AND test.now_field('X', 'W2', 'A', 'status')::jsonb ->> 'text' = 'On vacation',
    'chat_now: the same status shows in W and in W2 (one for every workspace)');

  -- Only through the ops, only your own.
  v := test.as_user('A', format($q$UPDATE public.user_statuses SET text = 'hacked' WHERE user_id = %L$q$, test.id('B')));
  PERFORM test.ok(v LIKE '42501%', 'write: a direct update is refused', v);
  v := test.as_user('A', format($q$INSERT INTO public.user_statuses (user_id, text, set_at) VALUES (%L, 'x', now())$q$, test.id('C')));
  PERFORM test.ok(v LIKE '42501%', 'write: a direct insert is refused', v);
  PERFORM test.ok(
    (SELECT proargnames FROM pg_proc WHERE oid = 'public.user_op_set_status(jsonb)'::regprocedure) = ARRAY['p_patch']
    AND test.set('A', jsonb_build_object('user_id', test.id('B'), 'text', 'x')) LIKE '22023%',
    'write: the op takes no person; a user_id in the patch is refused');
  PERFORM test.ok(test.as_key('K', $q$SELECT public.user_op_set_status('{"text": "from a key"}')$q$) LIKE '42501%',
    'write: an API key can''t set a status');

  -- What a status may hold.
  PERFORM test.ok(test.set('C', '{"text": "x", "preset": "lunch"}') LIKE '22023%', 'check: an unknown preset is refused');
  PERFORM test.ok(test.set('C', '{"emoji": "abc"}') LIKE '22023%', 'check: an emoji is an emoji');
  PERFORM test.ok(test.set('C', jsonb_build_object('text', repeat('a', 101))) LIKE '22023%', 'check: words stop at 100');
  PERFORM test.ok(test.set('C', jsonb_build_object('text', 'x', 'clear_at', now() - interval '1 minute')) LIKE '22023%',
    'check: "clear after" is ahead');
  PERFORM test.ok(test.set('C', '{"text": "  "}') LIKE '22023%', 'check: an empty status is refused');
  v := test.set('C', '{"dnd": true}');
  PERFORM test.ok(v = 'ok 1' AND (SELECT s.dnd AND s.text IS NULL FROM public.user_statuses s WHERE s.user_id = test.id('C')),
    'set: do not disturb by hand is a status with dnd and no words', v);
END;
$$;

-- ── Expiry and clearing ─────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  -- A's vacation is over (as if 4 days passed).
  UPDATE public.user_statuses SET clear_at = now() - interval '1 second' WHERE user_id = test.id('A');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'status') IS NULL,
    'expiry: chat_now treats a status past its time as cleared, before the job runs');
  PERFORM test.ok(public.user_statuses__expire(now()) >= 1, 'expiry: the job clears it');
  PERFORM test.ok(
    (SELECT s.set_at IS NULL AND s.text IS NULL AND s.emoji IS NULL AND NOT s.dnd AND s.clear_at IS NULL
       FROM public.user_statuses s WHERE s.user_id = test.id('A')),
    'expiry: the row stays, empty (so the change passes the read rule live)');
  PERFORM test.ok(public.user_statuses__expire(now()) = 0, 'expiry: nothing left to clear');
  v := test.as_user('B', $q$SELECT public.user_op_clear_status()$q$);
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT s.set_at IS NULL FROM public.user_statuses s WHERE s.user_id = test.id('B')),
    'clear: B clears their status', v);
END;
$$;

-- ── Saved statuses ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
  v_id uuid;
  i int;
BEGIN
  v := test.as_user('A', $q$SELECT public.user_op_save_status('{"emoji": "😴", "text": "Sleeping until 6", "dnd": true, "clear_after": "today"}')$q$);
  PERFORM test.ok(v = 'ok 1', 'saved: A saves "Sleeping until 6"', v);
  SELECT id INTO v_id FROM public.user_saved_statuses WHERE user_id = test.id('A');
  PERFORM test.ok(test.value_as('A', $q$SELECT count(*)::text FROM public.user_saved_statuses$q$) = '1'
              AND test.value_as('B', $q$SELECT count(*)::text FROM public.user_saved_statuses$q$) = '0',
    'saved: only A reads A''s saved statuses');
  v := test.as_user('A', format($q$SELECT public.user_op_save_status('{"text": "Sleeping until 7", "clear_after": "never"}', %L)$q$, v_id));
  PERFORM test.ok(v = 'ok 1' AND (SELECT text = 'Sleeping until 7' AND clear_after = 'never' AND NOT dnd
                                    FROM public.user_saved_statuses WHERE id = v_id),
    'saved: A changes it in place', v);
  v := test.as_user('B', format($q$SELECT public.user_op_save_status('{"text": "mine now"}', %L)$q$, v_id));
  PERFORM test.ok(v LIKE 'P0002%', 'saved: B can''t change A''s', v);
  v := test.as_user('B', format($q$SELECT public.user_op_forget_status(%L)$q$, v_id));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.user_saved_statuses WHERE id = v_id), 'saved: B can''t forget A''s');
  PERFORM test.ok(test.as_user('A', $q$SELECT public.user_op_save_status('{"text": "x", "clear_after": "fortnight"}')$q$) LIKE '22023%',
    'saved: "clear after" is a closed list');
  PERFORM test.ok(test.as_user('A', $q$SELECT public.user_op_save_status('{"text": "x", "preset": "sick"}')$q$) LIKE '22023%',
    'saved: a saved status is your own, never a preset');
  FOR i IN 2..20 LOOP
    PERFORM test.as_user('A', format($q$SELECT public.user_op_save_status('{"text": "s%s"}')$q$, i));
  END LOOP;
  v := test.as_user('A', $q$SELECT public.user_op_save_status('{"text": "one too many"}')$q$);
  PERFORM test.ok(v LIKE '54000%' AND (SELECT count(*) FROM public.user_saved_statuses WHERE user_id = test.id('A')) = 20,
    'saved: twenty at most', v);
  v := test.as_user('A', format($q$SELECT public.user_op_forget_status(%L)$q$, v_id));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.user_saved_statuses WHERE id = v_id), 'saved: A forgets one', v);
  -- Positions only grow; near the cap a save closes the gaps instead of failing.
  UPDATE public.user_saved_statuses SET position = position + 980 WHERE user_id = test.id('A');
  v := test.as_user('A', $q$SELECT public.user_op_save_status('{"text": "after a long while"}')$q$);
  PERFORM test.ok(v = 'ok 1' AND (SELECT max(position) FROM public.user_saved_statuses WHERE user_id = test.id('A')) = 19,
    'saved: saving near the position cap renumbers and still saves', v);
  DELETE FROM public.user_saved_statuses WHERE user_id = test.id('A') AND text = 'after a long while';
END;
$$;

-- ── chat_now: Focusing, "until", the task (AC11.3) ──────────────────────────
DO $$
DECLARE
  v text;
  v_ws uuid;
BEGIN
  -- Pomodoro work phase: Focusing until the phase ends.
  PERFORM test.focus('A', 'W', 'pomodoro');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focusing') = 'true'
              AND (test.now_field('B', 'W', 'A', 'focus_until'))::timestamptz = now() - interval '5 minutes' + interval '1500 seconds',
    'focus: a Pomodoro work phase shows Focusing until its end');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focus_task_id') IS NULL
              AND NOT (test.now_of('B', 'W', 'A')::jsonb ? 'run_id') AND test.now_of('B', 'W', 'A') NOT LIKE '%phase%',
    'focus: no task, and nothing about the run itself');
  -- A break isn't focusing; a run not seen for 3 minutes isn't either.
  PERFORM test.focus('A', 'W', 'pomodoro', 'break');
  PERFORM test.ok(test.now_of('B', 'W', 'A') = '', 'focus: a Pomodoro break isn''t Focusing');
  PERFORM test.focus('A', 'W', 'pomodoro', 'work', interval '4 minutes');
  PERFORM test.ok(test.now_of('B', 'W', 'A') = '', 'focus: a run not seen for 3 minutes isn''t Focusing');
  -- Per task: no "until", even with an estimate (a task's numbers never show).
  PERFORM test.focus('A', 'W', 'per_task', 'work', interval '0', NULL);
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focusing') = 'true' AND test.now_field('B', 'W', 'A', 'focus_until') IS NULL,
    'focus: Focusing with no estimate has no "until"');
  PERFORM test.focus('A', 'W', 'per_task', 'work', interval '0', 'TA');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focusing') = 'true' AND test.now_field('B', 'W', 'A', 'focus_until') IS NULL
              AND test.now_field('C', 'W', 'A', 'focus_until') IS NULL,
    'focus: the Now task''s estimate never becomes an "until" (only the run''s own Pomodoro end does)');
  -- The task: never without the opt-in.
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focus_task_id') IS NULL, 'focus: no task without "Show what I''m focusing on"');
  v := test.as_user('A', $q$SELECT public.user_op_set_chat_prefs('{"show_focus_task": true}')$q$);
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focus_task_id') = test.id('TA')::text
              AND test.now_field('B', 'W', 'A', 'focus_task_title') = 'Draft the pitch',
    'focus: with the opt-in, B (who sees the task) sees which task', v);
  PERFORM test.ok(test.now_field('C', 'W', 'A', 'focusing') = 'true'
              AND test.now_field('C', 'W', 'A', 'focus_task_id') IS NULL
              AND test.now_field('C', 'W', 'A', 'focus_task_title') IS NULL,
    'focus: C, who can''t see the task, sees Focusing and no task');
  UPDATE public.tasks SET deleted_at = now() WHERE id = test.id('TA');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focusing') = 'true'
              AND test.now_field('B', 'W', 'A', 'focus_task_id') IS NULL
              AND test.now_field('B', 'W', 'A', 'focus_task_title') IS NULL,
    'focus: a trashed task is never shown');
  UPDATE public.tasks SET deleted_at = NULL WHERE id = test.id('TA');
  -- A run in another workspace: Focusing everywhere, the task nowhere else.
  PERFORM test.focus('A', 'W2', 'per_task', 'work', interval '0', 'T2');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'focusing') = 'true' AND test.now_field('B', 'W', 'A', 'focus_task_id') IS NULL,
    'focus: a run in W2 shows Focusing in W, never W2''s task');

  -- Who gets chat_now at all.
  PERFORM test.ok(test.value_as('X', format($q$SELECT public.chat_now(%L)::text$q$, test.id('W'))) = '[]',
    'chat_now: X, not a member of W, gets nothing');
  PERFORM test.ok(test.value_as('C', format($q$SELECT public.chat_now(%L)::text$q$, test.id('W2'))) = '[]',
    'chat_now: C gets nothing for W2');
  v_ws := test.id('W');
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  PERFORM set_config('request.headers', json_build_object('x-moduo-key-id', test.id('K'))::text, true);
  SET LOCAL ROLE service_role;
  v := public.chat_now(v_ws)::text;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
  PERFORM test.ok(v = '[]', 'chat_now: an API key gets nothing', v);
  -- Former members aren't listed.
  DELETE FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('C');
  PERFORM test.ok(test.now_of('B', 'W', 'C') = '' AND test.value_as('C', format($q$SELECT public.chat_now(%L)::text$q$, test.id('W'))) = '[]',
    'chat_now: a former member is neither listed nor answered');
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('C'), 'member');
END;
$$;

-- ── Do not disturb holds pings (AC6.6) ──────────────────────────────────────
DO $$
DECLARE
  v text;
  v_dm uuid;
BEGIN
  PERFORM test.focus('A', 'W', 'off');
  DELETE FROM public.focus_runs WHERE user_id = test.id('A');
  PERFORM test.ok(public.notice__gate(test.id('A'), test.id('W'), 'chat_message', now()) = 'send',
    'gate: with no status, pings are sent');
  v := test.set('A', jsonb_build_object('emoji', '🤒', 'text', 'Out sick', 'preset', 'sick', 'dnd', true,
                                         'clear_at', now() + interval '2 days'));
  PERFORM test.ok(public.notice__gate(test.id('A'), test.id('W'), 'chat_message', now()) = 'drop'
              AND public.notice__gate(test.id('A'), test.id('W2'), 'chat_mention', now()) = 'drop',
    'gate: Out sick with do not disturb drops pings, in every workspace (CV-18)', v);
  PERFORM test.ok(public.notice__gate(test.id('A'), test.id('W'), 'chat_message', now() + interval '3 days') = 'send',
    'gate: once the status has passed, pings are sent again');
  PERFORM test.ok(test.now_field('B', 'W', 'A', 'dnd') = 'true', 'chat_now: teammates see do not disturb');

  -- A real direct message: no notice; the item waits in Catch up, held.
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  v := test.as_user('B', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('A')));
  SELECT c.id INTO v_dm FROM public.chat_channels c WHERE c.workspace_id = test.id('W') AND c.kind = 'dm';
  v := test.as_user('B', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'are you around?', NULL::uuid)$q$,
                                 test.id('msg:sick'), v_dm));
  PERFORM test.ok(v LIKE 'ok %' AND NOT EXISTS (SELECT 1 FROM public.notice_deliveries d
                                                 WHERE d.user_id = test.id('A') AND d.message_id = test.id('msg:sick')),
    'gate: B''s message to A, who is out sick, pings nothing', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.chat_catchup x WHERE x.user_id = test.id('A')
                            AND x.message_id = test.id('msg:sick') AND x.held_at IS NOT NULL),
    'gate: the message waits in A''s Catch up, held (never emailed)');
  PERFORM test.as_user('A', $q$SELECT public.user_op_clear_status()$q$);
  PERFORM test.ok(public.notice__gate(test.id('A'), test.id('W'), 'chat_message', now()) = 'send',
    'gate: clearing the status sends pings again');
END;
$$;

-- ── Presence: membership, not the plan ──────────────────────────────────────
DO $$
BEGIN
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  PERFORM test.ok(test.value_as('B', format($q$SELECT public.chat_realtime_topic_allowed('chat:%s')::text$q$, test.id('W'))) = 'true'
              AND test.value_as('B', format($q$SELECT public.chat_realtime_topic_writable('chat:%s')::text$q$, test.id('W'))) = 'true',
    'presence: a paused workspace keeps presence for its members');
  PERFORM test.ok(test.value_as('X', format($q$SELECT public.chat_realtime_topic_allowed('chat:%s')::text$q$, test.id('W'))) = 'false'
              AND test.value_as('X', format($q$SELECT public.chat_realtime_topic_writable('chat:%s')::text$q$, test.id('W'))) = 'false',
    'presence: X, not a member, is refused');
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
END;
$$;

-- ── Leaving and a deleted workspace end it ──────────────────────────────────
DO $$
DECLARE
  v_read text := format($q$SELECT count(*)::text FROM public.user_statuses WHERE user_id = %L$q$, test.id('A'));
BEGIN
  PERFORM test.set('A', '{"text": "Heads down"}');
  PERFORM test.ok(test.value_as('C', v_read) = '1', 'leaving: C reads A''s status while they share W');
  DELETE FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('C');
  PERFORM test.ok(test.value_as('C', v_read) = '0'
              AND test.value_as('C', format($q$SELECT public.chat_now(%L)::text$q$, test.id('W'))) = '[]'
              AND test.value_as('C', format($q$SELECT public.chat_realtime_topic_allowed('chat:%s')::text$q$, test.id('W'))) = 'false',
    'leaving: removed from W, C reads no status, no "now" and no presence (and learns nothing about who has one)');
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('C'), 'member');
  PERFORM test.ok(test.value_as('X', v_read) = '1', 'deleted: X reads A''s status through W2');
  UPDATE public.workspaces SET deleted_at = now() WHERE id = test.id('W2');
  PERFORM test.ok(test.value_as('X', v_read) = '0'
              AND test.value_as('X', format($q$SELECT public.chat_now(%L)::text$q$, test.id('W2'))) = '[]'
              AND test.value_as('A', format($q$SELECT public.chat_realtime_topic_allowed('chat:%s')::text$q$, test.id('W2'))) = 'false',
    'deleted: once W2 is deleted, X no longer reads A''s status, its "now" or its presence');
  UPDATE public.workspaces SET deleted_at = NULL WHERE id = test.id('W2');
  -- The live feed reads under the same rule: the read policy names only the caller.
  PERFORM test.ok((SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_statuses'
                    AND policyname = 'user_statuses_read') LIKE '%uid()%workspace_members%'
              AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
                    AND tablename IN ('user_statuses', 'user_saved_statuses') AND cmd <> 'SELECT') = 0,
    'rules: one read rule each, about the caller; no write rules (the ops write)');
END;
$$;

-- ── Erasure ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v jsonb;
BEGIN
  PERFORM test.set('A', '{"text": "Leaving"}');
  v := public.account_erase_workspace_data(test.id('A'), true);
  PERFORM test.ok((v ->> 'user_statuses_deleted')::int = 1 AND (v ->> 'saved_statuses_deleted')::int = 19,
    'erasure: the preview counts the status and the saved statuses', v::text);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.user_statuses WHERE user_id = test.id('A')), 'erasure: a preview deletes nothing');
  v := public.account_erase_workspace_data(test.id('A'), false);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.user_statuses WHERE user_id = test.id('A'))
              AND NOT EXISTS (SELECT 1 FROM public.user_saved_statuses WHERE user_id = test.id('A'))
              AND EXISTS (SELECT 1 FROM public.user_statuses WHERE user_id = test.id('B')),
    'erasure: both go with the account, nobody else''s', v::text);
  PERFORM test.ok(
    (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.user_statuses'::regclass AND contype = 'f') = 'c'
    AND (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.user_saved_statuses'::regclass AND contype = 'f') = 'c',
    'erasure: both cascade from profiles');
END;
$$;
