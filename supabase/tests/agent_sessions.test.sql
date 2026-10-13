-- TV-D16 · Agent sessions: status, not conversation; private by default
-- (supabase/migrations/20261013220000_agents_imports_mcp.sql §2–§5b).
-- specs/tasks-v3.md §12, §13's agent row, the "Agents" edge cases,
-- §Assumptions #15; AC3.4; REPLAN 6, 51, 52.
--
-- Cast: O owns workspace W. E and F are members who work on tasks, V is a
-- viewer, X owns another workspace W2. SB is shared with the workspace, PB is
-- O's private project. K is E's key with Tasks edit ("Claude Desktop"), KV is
-- E's view-only key, KO is O's key, KX is X's key in W2.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_k', md5('db-test-k'), '{"tasks": "edit", "links": "edit"}'::jsonb, test.id('E')),
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_kv', md5('db-test-kv'), '{"tasks": "view"}'::jsonb, test.id('E')),
  (test.id('KO'), test.id('W'), 'O agent', 'mdo_ko', md5('db-test-ko'), '{"tasks": "edit"}'::jsonb, test.id('O')),
  (test.id('KX'), test.id('W2'), 'Outsider', 'mdo_kx', md5('db-test-kx'), '{"tasks": "edit"}'::jsonb, test.id('X'));

CREATE FUNCTION test.new_task(p_who text, p_name text, p_project text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project))))
$$;
CREATE FUNCTION test.report(p_key text, p_task text, p_report jsonb, p_ws text DEFAULT 'W') RETURNS text LANGUAGE sql AS $$
  SELECT test.as_key(p_key, format($q$SELECT public.tasks_op_agent_report(%L, %L, %L::jsonb)$q$,
    test.id(p_ws), test.id(p_task), p_report))
$$;
-- How many of the task's sessions this person reads (through RLS).
CREATE FUNCTION test.seen(p_who text, p_task text) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.agent_sessions WHERE task_id = %L$q$,
    test.id(p_task)))::integer
$$;
CREATE FUNCTION test.session(p_task text, p_key text) RETURNS public.agent_sessions LANGUAGE sql STABLE AS $$
  SELECT * FROM public.agent_sessions WHERE task_id = test.id(p_task) AND key_id = test.id(p_key) AND deleted_at IS NULL
$$;
CREATE FUNCTION test.agent_notices(p_who text) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.notifications_list(%L, 200)
    WHERE op = 'tasks.agent_status'$q$, test.id('W')))::integer
$$;

DO $$
DECLARE
  r text;
  s public.agent_sessions;
  v_id uuid;
  v jsonb;
BEGIN
  PERFORM test.new_task('E', 'T1', 'SB');
  PERFORM test.new_task('E', 'T2', 'SB');
  PERFORM test.new_task('O', 'TP', 'PB');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.tasks WHERE id = %L$q$, test.id('TP'))) = '0',
    'E can''t see O''s private task');

  -- ── Who may report ──────────────────────────────────────────────────────
  r := test.try('E', format($q$SELECT public.tasks_op_agent_report(%L, %L, '{"state": "working"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '42501%Only an agent%', 'a person can''t post an agent''s status', r);
  r := test.report('KV', 'T1', '{"state": "working"}');
  PERFORM test.ok(r LIKE '%edit access to Tasks%' AND NOT EXISTS (SELECT 1 FROM public.agent_sessions WHERE key_id = test.id('KV')),
    'a view-only key can''t either', r);
  r := test.report('K', 'TP', '{"state": "working"}');
  PERFORM test.ok(r LIKE '%Task not found in this workspace.%', 'a task its person can''t see reads as missing', r);
  v := to_jsonb(r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_agent_report(%L, %L, '{"state": "working"}'::jsonb)$q$,
    test.id('W'), test.id('nothing-here')));
  PERFORM test.ok(to_jsonb(r) = v, 'with the same answer as a task that isn''t there', r);
  r := test.report('KX', 'T1', '{"state": "working"}');
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'another workspace''s key gets nothing here', r);
  r := test.report('KX', 'T1', '{"state": "working"}', 'W2');
  PERFORM test.ok(r LIKE '%Task not found%', 'nor through its own workspace', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.agent_sessions), 'none of those wrote anything');

  -- ── The five fields ─────────────────────────────────────────────────────
  r := test.report('K', 'T1', jsonb_build_object('state', 'working', 'note', 'Writing tests', 'step', 3, 'steps', 5,
    'links', jsonb_build_array(jsonb_build_object('url', 'https://github.com/x/y/pull/42', 'label', 'PR #42'))));
  s := test.session('T1', 'K');
  PERFORM test.ok(r = 'ok 1' AND s.user_id = test.id('E') AND s.agent = 'Claude Desktop' AND s.state = 'working'
              AND s.note = 'Writing tests' AND s.step = 3 AND s.steps = 5
              AND s.links = '[{"url": "https://github.com/x/y/pull/42", "label": "PR #42"}]'::jsonb,
    'a key posts state, note, step n of m and links; the session is its person''s', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.id('T1') AND op LIKE 'tasks.agent%'),
    'a status report writes no trail row (sessions are private)');
  r := test.report('K', 'T1', '{"state": "working", "note": "Running them", "step": 4, "steps": 5, "agent": "Claude"}');
  s := test.session('T1', 'K');
  PERFORM test.ok(s.agent = 'Claude' AND s.note = 'Running them' AND jsonb_array_length(s.earlier) = 1
              AND s.earlier -> 0 ->> 'note' = 'Writing tests' AND jsonb_array_length(s.links) = 1
              AND (SELECT count(*) FROM public.agent_sessions WHERE task_id = test.id('T1')) = 1,
    'the next report updates the one session; the earlier line folds; links stay', r);

  r := test.report('K', 'T1', '{"state": "sleeping"}');
  PERFORM test.ok(r LIKE '22023%working, needs_you, ready or failed%', 'an unknown state is refused', r);
  r := test.report('K', 'T1', '{"state": "working", "step": 6, "steps": 5}');
  PERFORM test.ok(r LIKE '22023%step n of m%', 'a step past the count is refused', r);
  r := test.report('K', 'T1', '{"state": "working", "links": ["javascript:alert(1)"]}');
  PERFORM test.ok(r LIKE '22023%http(s) address%', 'a link that isn''t http(s) is refused', r);
  r := test.report('K', 'T1', '{"state": "working", "owner": "someone"}');
  PERFORM test.ok(r LIKE '22023%no field%', 'an unknown field is refused', r);
  PERFORM test.ok((test.session('T1', 'K')).note = 'Running them', 'a refused report changes nothing');

  -- ── Private by default; the share setting ──────────────────────────────
  PERFORM test.ok(test.seen('E', 'T1') = 1 AND test.seen('F', 'T1') = 0 AND test.seen('O', 'T1') = 0
              AND test.seen('V', 'T1') = 0,
    'only whoever started it sees the session');
  r := test.as_user('E', 'SELECT public.user_op_set_agent_work(true)');
  PERFORM test.ok(r = 'ok 1' AND test.seen('F', 'T1') = 1 AND test.seen('O', 'T1') = 1 AND test.seen('V', 'T1') = 1,
    '"Show my agent work to teammates" opens it to whoever sees the task', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.access_changes WHERE workspace_id = test.id('W') AND user_id IS NULL
                          AND resource_type = 'workspace'),
    'the switch tells teammates'' copies to check again');
  r := test.report('KO', 'TP', '{"state": "working", "note": "O private work"}');
  r := test.as_user('O', 'SELECT public.user_op_set_agent_work(true)');
  PERFORM test.ok(test.seen('O', 'TP') = 1 AND test.seen('E', 'TP') = 0 AND test.seen('F', 'TP') = 0,
    'a shown session stays hidden from people who can''t see its task');
  r := test.as_user('E', 'SELECT public.user_op_set_agent_work(false)');
  PERFORM test.ok(test.seen('F', 'T1') = 0 AND test.seen('E', 'T1') = 1,
    'switched off, teammates stop seeing it at once', r);
  r := test.as_key('K', 'SELECT public.user_op_set_agent_work(true)');
  PERFORM test.ok(r LIKE '42501%' AND test.seen('F', 'T1') = 0, 'a key can''t switch it', r);

  -- The read the panel and MCP use follows the same rule.
  v := test.value_as('F', format($q$SELECT public.tasks_agent_sessions(%L, %L)::text$q$, test.id('W'), test.id('T1')))::jsonb;
  PERFORM test.ok(v = '[]'::jsonb, 'tasks_agent_sessions shows F nothing while it''s private', v::text);
  r := test.value_as('F', format($q$SELECT public.tasks_agent_sessions(%L, %L)::text$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE 'ERROR Task not found in this workspace.%', 'and reads a hidden task as missing', r);

  -- ── The loud states: one notice, to its person ─────────────────────────
  PERFORM test.as_user('E', 'SELECT public.user_op_set_agent_work(true)');
  -- F waits on E's agent here; on T2, E waits on it too.
  PERFORM test.as_user('F', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id('T1'), jsonb_build_object('kind', 'agent', 'ref', test.id('K'))));
  PERFORM test.report('K', 'T2', '{"state": "working"}');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id('T2'), jsonb_build_object('kind', 'agent', 'ref', test.id('K'))));
  r := test.report('K', 'T1', '{"state": "ready", "note": "PR is up", "summary": "Added 12 tests; all green."}');
  PERFORM test.ok(r = 'ok 1' AND test.agent_notices('E') = 1 AND test.agent_notices('F') = 0 AND test.agent_notices('O') = 0,
    'ready for review notifies whoever started it, and nobody else', r);
  PERFORM test.ok((SELECT count(*) FROM public.notice_deliveries WHERE user_id = test.id('E') AND kind = 'agent') = 1
              AND (SELECT title FROM public.notice_deliveries WHERE user_id = test.id('E') AND kind = 'agent') = 'Claude is ready for review',
    'with one OS / browser notice');
  PERFORM test.ok((SELECT count(*) FROM public.task_waiting WHERE task_id = test.id('T1') AND kind = 'agent' AND deleted_at IS NULL) = 0
              AND test.value_as('F', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 200)
                    WHERE op = 'tasks.waiting_resolved'$q$, test.id('W'))) = '1',
    'waiting on the agent clears, and a teammate who waited hears it came back');
  r := test.report('K', 'T1', '{"state": "ready", "note": "Still up"}');
  PERFORM test.ok(test.agent_notices('E') = 1, 'the same state again is quiet', r);
  r := test.report('K', 'T1', '{"state": "needs_you", "note": "Which branch?"}');
  PERFORM test.ok(test.agent_notices('E') = 2, 'a change into needs you is one more', r);
  -- "That key's notifications": the Agents switch also mutes the OS notice.
  INSERT INTO public.user_preferences (user_id) VALUES (test.id('E')) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_preferences SET preferences = jsonb_set(preferences, '{notifications}',
    coalesce(preferences -> 'notifications', '{}'::jsonb) || '{"agents": false}'::jsonb)
  WHERE user_id = test.id('E');
  r := test.report('K', 'T1', '{"state": "failed", "note": "CI is down"}');
  PERFORM test.ok((SELECT count(*) FROM public.notice_deliveries WHERE user_id = test.id('E') AND kind = 'agent') = 2,
    'with Agents muted, no OS / browser notice (the bell hides its own row)', r);

  -- The summary stays its person's, even while the session is shown.
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.agent_session_summaries WHERE session_id = %L$q$,
                    (test.session('T1', 'K')).id)) = '1'
              AND test.value_as('F', format($q$SELECT count(*)::text FROM public.agent_session_summaries WHERE session_id = %L$q$,
                    (test.session('T1', 'K')).id)) = '0',
    'the hand-back summary is readable only by whoever started the session');
  v := test.value_as('E', format($q$SELECT public.tasks_agent_sessions(%L, %L)::text$q$, test.id('W'), test.id('T1')))::jsonb;
  PERFORM test.ok(v -> 0 ->> 'summary' = 'Added 12 tests; all green.' AND (v -> 0 ->> 'mine')::boolean
              AND NOT (v -> 0 ? 'key_id'),
    'its person reads the summary through tasks_agent_sessions', v::text);
  v := test.value_as('F', format($q$SELECT public.tasks_agent_sessions(%L, %L)::text$q$, test.id('W'), test.id('T1')))::jsonb;
  PERFORM test.ok(jsonb_array_length(v) = 1 AND NOT (v -> 0 ? 'summary') AND NOT (v -> 0 ->> 'mine')::boolean,
    'a teammate gets the line without the summary', v::text);

  -- "Post as comment": only its person, once.
  v_id := (test.session('T1', 'K')).id;
  r := test.as_user('F', format($q$SELECT public.tasks_op_agent_session_post(%L, %L)$q$, test.id('W'), v_id));
  PERFORM test.ok(r LIKE '22023%Session not found%', 'a teammate can''t post someone else''s summary', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_agent_session_post(%L, %L)$q$, test.id('W'), v_id));
  PERFORM test.ok(r LIKE '42501%', 'nor can the agent', r);
  r := test.as_user('E', format($q$SELECT public.tasks_op_agent_session_post(%L, %L)$q$, test.id('W'), v_id));
  r := test.as_user('E', format($q$SELECT public.tasks_op_agent_session_post(%L, %L)$q$, test.id('W'), v_id));
  PERFORM test.ok((SELECT count(*) FROM public.comments WHERE entity_id = test.id('T1') AND body = 'Added 12 tests; all green.'
                   AND created_by = test.id('E') AND author_kind = 'user') = 1
              AND (test.session('T1', 'K')).summary_posted_at IS NOT NULL,
    'its person posts it as their own comment, once', r);

  -- A new run starts clean.
  r := test.report('K', 'T1', '{"state": "working", "note": "Round two"}');
  s := test.session('T1', 'K');
  PERFORM test.ok(s.earlier = '[]'::jsonb AND s.links = '[]'::jsonb AND s.summary_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.agent_session_summaries WHERE session_id = s.id),
    'working after ready starts a new run', r);

  -- ── The notice gate ─────────────────────────────────────────────────────
  -- A notice naming a task never reaches someone who can't see that task,
  -- even hung on their own Inbox.
  INSERT INTO public.module_activity (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (test.id('W'), 'tasks', 'bucket', public.tasks__inbox(test.id('W'), test.id('F')), 'tasks.agent_status', 'api_key',
          test.id('KO'), 'O agent',
          jsonb_build_object('notify_user_ids', jsonb_build_array(test.id('F')::text), 'task_id', test.id('TP'), 'title', 'TP'))
  RETURNING id INTO v_id;
  PERFORM test.ok((SELECT payload -> 'notify_user_ids' FROM public.module_activity WHERE id = v_id) = '[]'::jsonb
              AND test.agent_notices('F') = 0,
    'an agent notice naming a task its reader can''t see reaches nobody');
  INSERT INTO public.module_activity (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (test.id('W'), 'tasks', 'bucket', public.tasks__inbox(test.id('W'), test.id('F')), 'tasks.agent_status', 'api_key',
          test.id('K'), 'Claude',
          jsonb_build_object('notify_user_ids', jsonb_build_array(test.id('F')::text), 'task_id', test.id('T1'), 'title', 'T1'))
  RETURNING id INTO v_id;
  PERFORM test.ok((SELECT payload -> 'notify_user_ids' FROM public.module_activity WHERE id = v_id)
                  = jsonb_build_array(test.id('F')::text),
    'one naming a task they see still does');

  -- Its person waited on it too: the entry clears, and they hear only the agent.
  r := test.report('K', 'T2', '{"state": "ready"}');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.task_waiting WHERE task_id = test.id('T2') AND deleted_at IS NULL)
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 200)
                    WHERE op = 'tasks.waiting_resolved'$q$, test.id('W'))) = '0',
    'its person''s own waiting clears quietly (the agent''s notice says it)', r);

  -- ── A revoked key ───────────────────────────────────────────────────────
  PERFORM test.as_key('K', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T3'), 'title', 'T3', 'bucket_id', test.id('SB'))));
  PERFORM test.report('K', 'T3', '{"state": "working", "note": "On it"}');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id('T3'), jsonb_build_object('kind', 'agent', 'ref', test.id('K'))));
  UPDATE public.workspace_api_keys SET revoked_at = now() WHERE id = test.id('K');
  s := test.session('T3', 'K');
  PERFORM test.ok(s.stopped_at IS NOT NULL AND s.state = 'working'
              AND (test.session('T1', 'K')).stopped_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.task_waiting WHERE task_id = test.id('T3') AND kind = 'agent' AND deleted_at IS NULL),
    'revoking the key stops its sessions ("Stopped (key revoked)") and ends waiting on it');
  r := test.report('K', 'T3', '{"state": "ready"}');
  PERFORM test.ok(r LIKE '42501%' AND (test.session('T3', 'K')).state = 'working', 'a revoked key can''t report again', r);
  PERFORM test.ok((SELECT actor_type || ':' || actor_label FROM public.module_activity
                   WHERE entity_id = test.id('T3') AND op = 'tasks.create') = 'api_key:E · via Claude Desktop',
    'the trail keeps "E · via Claude Desktop"');

  -- ── Dismiss ─────────────────────────────────────────────────────────────
  v_id := (test.session('T3', 'K')).id;
  r := test.as_user('F', format($q$SELECT public.tasks_op_agent_session_dismiss(%L, %L)$q$, test.id('W'), v_id));
  PERFORM test.ok(r LIKE '22023%Session not found%', 'a teammate can''t clear someone''s session', r);
  r := test.as_user('E', format($q$SELECT public.tasks_op_agent_session_dismiss(%L, %L)$q$, test.id('W'), v_id));
  PERFORM test.ok(r = 'ok 1' AND (SELECT deleted_at FROM public.agent_sessions WHERE id = v_id) IS NOT NULL,
    'its person clears the line', r);

  -- ── Erasure (§Assumptions #26) ──────────────────────────────────────────
  v := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v ->> 'agent_sessions_deleted')::integer = 3, 'erasure counts E''s agent sessions', v::text);
  PERFORM public.account_erase_workspace_data(test.id('E'), false);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.agent_sessions WHERE user_id = test.id('E'))
              AND NOT EXISTS (SELECT 1 FROM public.agent_session_summaries WHERE user_id = test.id('E'))
              AND EXISTS (SELECT 1 FROM public.agent_sessions WHERE user_id = test.id('O')),
    'and removes them (and their summaries), nobody else''s');
END;
$$;
