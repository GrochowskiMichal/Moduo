-- TV-D16 follow-up · agents and imports: every read follows the task
-- (supabase/migrations/20261013268000_agents_privacy_fix.sql, on top of
-- 20261013220000_agents_imports_mcp.sql). Outsider checks, each read path:
-- the shared session rows and their summaries, the session reads, the trail
-- label, the agent's notice and its delivery, Realtime, and import runs.
--
-- Cast: O owns workspace W; E, F and G are members; X owns W2. PS is O's
-- project E edits and F views (G has no access); PE is E's own project; PO
-- is O's project only E edits (until O takes that away). K is E's key
-- ("Private key name"), KF is F's key, KX is X's key in W2.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'G', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member'),
  (test.id('W'), test.id('G'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('PS'), test.id('W'), test.id('O'), 'Shared with E and F', false, '0001'),
  (test.id('PE'), test.id('W'), test.id('E'), 'E alone', false, '0002'),
  (test.id('PO'), test.id('W'), test.id('O'), 'O and E', false, '0003');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PS'), test.id('PE'), test.id('PO'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'bucket', test.id('PS'), 'member', test.id('E'), 'edit', test.id('O')),
  (test.id('W'), 'bucket', test.id('PS'), 'member', test.id('F'), 'view', test.id('O')),
  (test.id('W'), 'bucket', test.id('PO'), 'member', test.id('E'), 'edit', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Private key name', 'mdo_k', md5('db-test-k'), '{"tasks": "edit"}'::jsonb, test.id('E')),
  (test.id('KF'), test.id('W'), 'F agent', 'mdo_kf', md5('db-test-kf'), '{"tasks": "edit"}'::jsonb, test.id('F')),
  (test.id('KX'), test.id('W2'), 'Outsider', 'mdo_kx', md5('db-test-kx'), '{"tasks": "edit"}'::jsonb, test.id('X'));

CREATE FUNCTION test.report(p_task text, p_report jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_key('K', format($q$SELECT public.tasks_op_agent_report(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id(p_task), p_report))
$$;
CREATE FUNCTION test.session_id(p_task text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.agent_sessions WHERE task_id = test.id(p_task) AND key_id = test.id('K')
$$;
CREATE FUNCTION test.count_as(p_who text, p_sql text) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, p_sql)::integer
$$;
-- Realtime: a subscription per person, and whether the server would send
-- them a change to a row (realtime.apply_rls runs Realtime's own RLS check).
CREATE FUNCTION test.subscribe(p_who text, p_table text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO realtime.subscription (subscription_id, entity, claims)
  VALUES (test.id('sub:' || p_who || ':' || p_table), ('public.' || p_table)::regclass,
          jsonb_build_object('sub', test.id(p_who), 'role', 'authenticated'))
$$;
CREATE FUNCTION test.hears(p_who text, p_table text, p_id uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce(bool_or(test.id('sub:' || p_who || ':' || p_table) = ANY (w.subscription_ids)), false)
  FROM realtime.apply_rls(jsonb_build_object(
    'action', 'U', 'schema', 'public', 'table', p_table, 'timestamp', now()::text,
    'pk', jsonb_build_array(jsonb_build_object('name', 'id', 'type', 'uuid', 'typeoid', 2950)),
    'columns', jsonb_build_array(jsonb_build_object('name', 'id', 'type', 'uuid', 'typeoid', 2950, 'value', p_id)),
    'identity', '[]'::jsonb)) w
$$;

DO $$
DECLARE
  r text;
  v jsonb;
  v_missing text;
  v_run uuid;
BEGIN
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TS'), 'title', 'Shared plan', 'bucket_id', test.id('PS'))));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TP'), 'title', 'E alone plan', 'bucket_id', test.id('PE'))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TO'), 'title', 'Board secret', 'bucket_id', test.id('PO'))));
  PERFORM test.ok(test.value_as('F', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TS'))) = 'true'
              AND test.value_as('G', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TS'))) = 'false'
              AND test.value_as('F', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TP'))) = 'false'
              AND test.value_as('E', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TO'))) = 'true',
    'the cast: F sees TS, G doesn''t; only E sees TP; E sees TO');

  r := test.report('TS', '{"state": "working", "note": "Shared note"}');
  r := test.report('TS', '{"state": "ready", "note": "Up", "summary": "Shared summary"}');
  r := test.report('TP', '{"state": "working", "note": "E alone note"}');
  r := test.report('TO', '{"state": "needs_you", "note": "Board secret note"}');
  r := test.report('TO', '{"state": "ready", "summary": "Board secret summary"}');
  PERFORM test.ok(r = 'ok 1' AND test.session_id('TO') IS NOT NULL, 'E''s agent reports on three tasks', r);
  r := test.as_user('E', 'SELECT public.user_op_set_agent_work(true)');

  -- ── Shared sessions: rows and summaries follow the reader's tasks ───────
  PERFORM test.ok(test.count_as('F', 'SELECT count(*)::text FROM public.agent_sessions') = 1
              AND test.count_as('F', format($q$SELECT count(*)::text FROM public.agent_sessions WHERE task_id = %L$q$, test.id('TS'))) = 1
              AND test.count_as('G', 'SELECT count(*)::text FROM public.agent_sessions') = 0
              AND test.count_as('O', 'SELECT count(*)::text FROM public.agent_sessions') = 2,
    'shared sessions reach only people who see each task (F: TS; G: none; O: TS and TO, never E''s own project)');
  PERFORM test.ok(test.value_as('F', format($q$SELECT public.agent_sessions__shown(%L, %L)::text$q$, test.id('TP'), test.id('E'))) = 'false'
              AND test.value_as('G', format($q$SELECT public.agent_sessions__shown(%L, %L)::text$q$, test.id('TS'), test.id('E'))) = 'false'
              AND test.value_as('F', format($q$SELECT public.agent_sessions__shown(%L, %L)::text$q$, test.id('TS'), test.id('E'))) = 'true'
              AND test.value_as('E', format($q$SELECT public.agent_sessions__shown(%L, %L)::text$q$, test.id('nope'), test.id('E'))) = 'false',
    'the policy''s helper answers exactly like the rows: hidden and missing alike');
  PERFORM test.ok(test.count_as('F', 'SELECT count(*)::text FROM public.agent_session_summaries') = 0
              AND test.count_as('G', 'SELECT count(*)::text FROM public.agent_session_summaries') = 0
              AND test.count_as('O', 'SELECT count(*)::text FROM public.agent_session_summaries') = 0
              AND test.count_as('E', 'SELECT count(*)::text FROM public.agent_session_summaries') = 2,
    'a summary is its person''s alone, even while the session is shared');

  -- ── tasks_agent_sessions and user_agent_work answer only for the caller ─
  v := test.value_as('F', format($q$SELECT public.tasks_agent_sessions(%L, %L)::text$q$, test.id('W'), test.id('TS')))::jsonb;
  PERFORM test.ok(jsonb_array_length(v) = 1 AND NOT (v -> 0 ? 'summary') AND NOT (v -> 0 ? 'key_id')
              AND (v -> 0 ->> 'mine')::boolean = false AND v::text NOT LIKE '%Shared summary%',
    'a teammate reads the shared line without its summary or its key', v::text);
  v := test.value_as('E', format($q$SELECT public.tasks_agent_sessions(%L, %L)::text$q$, test.id('W'), test.id('TS')))::jsonb;
  PERFORM test.ok(v -> 0 ->> 'summary' = 'Shared summary', 'its person reads the summary', v::text);
  v_missing := test.as_user('F', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W'), test.id('no-such-task')));
  r := test.as_user('F', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r = v_missing AND r LIKE '%Task not found in this workspace.%',
    'a task the reader can''t see reads exactly like a missing one', r);
  r := test.as_user('G', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W'), test.id('TS')));
  PERFORM test.ok(r = v_missing, 'for every member who can''t see it', r);
  r := test.as_user('X', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W'), test.id('TS')));
  PERFORM test.ok(r LIKE '42501%', 'someone outside the workspace gets nothing', r);
  r := test.as_user('X', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W2'), test.id('TS')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace.%', 'nor by naming their own workspace', r);
  r := test.as_key('KX', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W'), test.id('TS')));
  PERFORM test.ok(r LIKE '42501%', 'nor does another workspace''s key', r);
  PERFORM test.ok(test.value_as('F', 'SELECT public.user_agent_work()::text') = 'false'
              AND test.value_as('E', 'SELECT public.user_agent_work()::text') = 'true'
              AND test.as_key('K', 'SELECT 1 WHERE public.user_agent_work()') = 'ok 0',
    'user_agent_work answers only the signed-in caller''s own switch (a key has none)');

  -- ── Realtime sends a session only to who may read it ────────────────────
  PERFORM test.subscribe('E', 'agent_sessions');
  PERFORM test.subscribe('F', 'agent_sessions');
  PERFORM test.subscribe('G', 'agent_sessions');
  PERFORM test.ok(test.hears('E', 'agent_sessions', test.session_id('TS'))
              AND test.hears('F', 'agent_sessions', test.session_id('TS'))
              AND NOT test.hears('G', 'agent_sessions', test.session_id('TS')),
    'a shared session''s change goes to its person and to teammates who see the task, not to others');
  PERFORM test.ok(test.hears('E', 'agent_sessions', test.session_id('TP'))
              AND NOT test.hears('F', 'agent_sessions', test.session_id('TP'))
              AND NOT test.hears('G', 'agent_sessions', test.session_id('TP')),
    'a session on a task only its person sees goes to its person alone');
  r := test.as_user('E', 'SELECT public.user_op_set_agent_work(false)');
  PERFORM test.ok(test.hears('E', 'agent_sessions', test.session_id('TS'))
              AND NOT test.hears('F', 'agent_sessions', test.session_id('TS')),
    'with sharing off, teammates stop hearing it');
  r := test.as_user('E', 'SELECT public.user_op_set_agent_work(true)');
  PERFORM test.ok((SELECT relreplident FROM pg_class WHERE oid = 'public.agent_sessions'::regclass) = 'd'
              AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                              AND tablename IN ('agent_session_summaries', 'imports', 'import_rows')),
    'a removed session tells subscribers only its id; summaries and imports are never published');

  -- ── The trail label: only where the task is seen; only this workspace''s key
  PERFORM test.as_key('K', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TK'), 'title', 'Made by the agent', 'bucket_id', test.id('PS'))));
  PERFORM test.ok(test.value_as('F', format($q$SELECT actor_label FROM public.module_activity
                    WHERE entity_id = %L AND op = 'tasks.create'$q$, test.id('TK'))) = 'E · via Private key name'
              AND test.count_as('G', $q$SELECT count(*)::text FROM public.module_activity WHERE actor_label LIKE '%Private key name%'$q$) = 0
              AND test.count_as('G', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 500)
                    WHERE actor_label LIKE '%%Private key name%%'$q$, test.id('W'))) = 0
              AND test.count_as('X', $q$SELECT count(*)::text FROM public.module_activity WHERE actor_label LIKE '%Private key name%'$q$) = 0,
    'the key''s name reaches people who see the task, nobody else');
  r := test.as_key('KX', format($q$SELECT public.module_activity_log(%L, 'tasks', 'task', %L, 'tasks.update', '{}'::jsonb)$q$,
    test.id('W'), test.id('TS')));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity WHERE actor_id = test.id('KX') AND actor_label IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM public.module_activity WHERE actor_label LIKE '%Outsider%'),
    'a key of another workspace is never named in this one''s trail', r);

  -- ── The agent's notice and its delivery carry no excerpt past the task ─
  PERFORM test.ok((SELECT count(*) FROM public.module_activity WHERE op = 'tasks.agent_status'
                    AND payload ->> 'task_id' = test.id('TO')::text) = 2
              AND NOT EXISTS (SELECT 1 FROM public.module_activity WHERE op = 'tasks.agent_status'
                              AND (payload ? 'title' OR payload ? 'note'
                                   OR payload::text LIKE '%Board secret%' OR payload::text LIKE '%Shared%')),
    'an agent''s notice names its task by id and state only: no title, no note');
  PERFORM test.subscribe('E', 'notice_deliveries');
  PERFORM test.ok(test.count_as('E', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE task_id = %L$q$, test.id('TO'))) = 2
              AND test.hears('E', 'notice_deliveries', (SELECT id FROM public.notice_deliveries WHERE task_id = test.id('TO') LIMIT 1)),
    'its person reads (and hears) the OS notice while they see the task');

  -- A reminder and a team notice about a task in PO, while E still sees it.
  PERFORM test.as_user('O', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TM'), 'name', 'Ops', 'members', jsonb_build_array(test.id('E')))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TR'), 'title', 'Board routed secret', 'bucket_id', test.id('PO'),
                       'team_id', test.id('TM'), 'assignee_id', NULL)));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', %L)$q$,
    test.id('W'), test.id('TR'), now() + interval '1 hour'));
  UPDATE public.task_reminders SET suspended_at = now()
  WHERE workspace_id <> test.id('W') AND fired_at IS NULL AND suspended_at IS NULL;
  PERFORM public.tasks__fire_reminders(now() + interval '2 hours', 500);
  PERFORM test.ok(test.count_as('E', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 500)
                    WHERE op IN ('tasks.reminder', 'tasks.routed') AND payload ->> 'task_id' = %L$q$, test.id('W'), test.id('TR'))) = 2
              AND NOT EXISTS (SELECT 1 FROM public.module_activity WHERE op IN ('tasks.reminder', 'tasks.routed')
                              AND (payload ? 'title' OR payload::text LIKE '%routed secret%')),
    'E''s reminder and team notice name the task by id only', r);
  PERFORM test.ok(test.count_as('E', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE task_id = %L$q$, test.id('TR'))) = 1,
    'and the reminder''s OS notice is theirs while they see the task');

  -- O takes PO away from E.
  DELETE FROM public.resource_grants
  WHERE resource_type = 'bucket' AND resource_id = test.id('PO') AND subject_id = test.id('E');
  PERFORM test.ok(test.value_as('E', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TO'))) = 'false',
    'E no longer sees TO');
  PERFORM test.ok(test.count_as('E', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE task_id = %L$q$, test.id('TO'))) = 0
              AND NOT test.hears('E', 'notice_deliveries', (SELECT id FROM public.notice_deliveries WHERE task_id = test.id('TO') LIMIT 1)),
    'then the OS notice (its title) is no longer theirs to read or hear');
  PERFORM test.ok(test.count_as('E', 'SELECT count(*)::text FROM public.agent_session_summaries') = 1
              AND test.count_as('E', format($q$SELECT count(*)::text FROM public.agent_sessions WHERE task_id = %L$q$, test.id('TO'))) = 0
              AND NOT test.hears('E', 'agent_sessions', test.session_id('TO')),
    'nor that task''s summary or session (their own)');
  r := test.as_user('E', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W'), test.id('TO')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace.%', 'and the session read says "not found"', r);
  PERFORM test.ok(test.count_as('E', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 500)
                    WHERE op = 'tasks.agent_status' AND payload ->> 'task_id' = %L
                      AND (payload ? 'title' OR payload ? 'note')$q$, test.id('W'), test.id('TO'))) = 0,
    'the bell keeps no title or note of it');
  PERFORM test.ok(test.count_as('E', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 500)
                    WHERE payload ->> 'task_id' = %L AND (payload ? 'title' OR payload::text LIKE '%%routed secret%%')$q$,
                    test.id('W'), test.id('TR'))) = 0
              AND test.count_as('E', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE task_id = %L$q$, test.id('TR'))) = 0,
    'nor of the reminder or team notice, and the reminder''s OS notice is gone for them');

  -- ── Import runs: their person's on every path ───────────────────────────
  PERFORM test.as_key('K', format($q$SELECT public.imports_op_begin(%L, 'todoist', 'E run')$q$, test.id('W')));
  v_run := (SELECT id FROM public.imports WHERE label = 'E run');
  PERFORM test.as_key('K', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TI'), 'title', 'Imported', 'bucket_id', test.id('PS')),
    jsonb_build_object('import_id', v_run)));
  PERFORM test.ok(test.count_as('F', 'SELECT count(*)::text FROM public.imports') = 0
              AND test.count_as('F', 'SELECT count(*)::text FROM public.import_rows') = 0
              AND test.count_as('O', 'SELECT count(*)::text FROM public.imports') = 0
              AND test.count_as('O', 'SELECT count(*)::text FROM public.import_rows') = 0
              AND test.count_as('E', 'SELECT count(*)::text FROM public.import_rows') = 1,
    'runs and their rows are readable by their person only (the workspace owner included)');
  r := test.as_user('F', format($q$SELECT public.imports__own(%L, %L)$q$, test.id('W'), v_run));
  PERFORM test.ok(r LIKE '42501%', 'the run helpers aren''t callable from the app', r);
  r := test.as_user('F', format($q$SELECT public.imports__summary(x) FROM public.imports x$q$));
  PERFORM test.ok(r LIKE '42501%', 'imports__summary included', r);
  r := test.as_key('KF', format($q$SELECT public.imports__summary(x) FROM public.imports x WHERE x.id = %L$q$, v_run));
  v_missing := test.as_key('KF', format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W'), test.id('no-such-run')));
  PERFORM test.ok(r LIKE '22023%No import with that id.%', 'and called with someone else''s run (a teammate''s key), it answers like a missing one', r);
  r := test.as_key('KF', format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W'), v_run));
  PERFORM test.ok(r = v_missing AND (SELECT finished_at FROM public.imports WHERE id = v_run) IS NULL,
    'a teammate''s key can''t finish it; it reads like a missing run', r);
  r := test.as_key('KX', format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W2'), v_run));
  PERFORM test.ok(r NOT LIKE 'ok%' AND (SELECT finished_at FROM public.imports WHERE id = v_run) IS NULL,
    'nor another workspace''s key', r);
  r := test.as_key('K', format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W'), v_run));
  PERFORM test.ok(r = 'ok 1' AND (SELECT finished_at FROM public.imports WHERE id = v_run) IS NOT NULL,
    'its person''s key finishes it', r);
END;
$$;
