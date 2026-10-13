-- TV-D16 · The agent delegate round-trip, as the MCP connector calls it
-- (service_role + the key header; supabase/functions/moduo-mcp/modules/tasks*.ts).
-- specs/tasks-v3.md §12, §Assumptions #14; AC3.4, AC12.1. The connector's own
-- shaping is tested in moduo-mcp/tasks-v3.test.ts.
--
-- Cast: O owns workspace W. E and F are members who work on tasks. SB is a
-- shared project with an "In review" status; PB is O's private project. K is
-- E's key ("Claude Desktop", Tasks + Links edit), KF is F's key, KV E's view-only
-- key. Team D (Design) has F in it.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_k', md5('db-test-k'), '{"tasks": "edit", "links": "edit"}'::jsonb, test.id('E')),
  (test.id('KF'), test.id('W'), 'F agent', 'mdo_kf', md5('db-test-kf'), '{"tasks": "edit"}'::jsonb, test.id('F')),
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_kv', md5('db-test-kv'), '{"tasks": "view"}'::jsonb, test.id('E'));

CREATE FUNCTION test.trail(p_task text, p_op text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT actor_type || ':' || actor_label FROM public.module_activity
  WHERE entity_id = test.id(p_task) AND op = p_op ORDER BY created_at DESC LIMIT 1
$$;

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'in_progress', 'In review')$q$,
    test.id('W'), test.id('SB')));
  PERFORM test.as_user('O', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('D'), 'name', 'Design', 'members', jsonb_build_array(test.id('F')))));

  -- create · file · status by name · assign · team · session
  r := test.as_key('K', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T1'), 'title', 'Ship the importer', 'bucket_id', test.id('SB'), 'status', 'In review',
      'priority', 'high', 'estimate_minutes', 90),
    jsonb_build_object('tags', jsonb_build_array('agents'))));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT s.name FROM public.tasks t JOIN public.project_statuses s ON s.id = t.status_id WHERE t.id = test.id('T1')) = 'In review'
              AND test.trail('T1', 'tasks.create') = 'api_key:E · via Claude Desktop',
    'a key creates and files a task with a project''s own status name, attributed "via" the key', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done')$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT status_category FROM public.tasks WHERE id = test.id('T1')) = 'done'
              AND test.trail('T1', 'tasks.set_status') = 'api_key:E · via Claude Desktop',
    'a category word completes it', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_set_status(%L, %L, 'in review')$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT status_category FROM public.tasks WHERE id = test.id('T1')) = 'in_progress',
    'a status name, in any case, reopens it there', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_set_status(%L, %L, 'Shipped')$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '22023%This project''s statuses:%In review%', 'an unknown name is refused with the project''s list', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('T1'), test.id('F')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT assignee_id FROM public.tasks WHERE id = test.id('T1')) = test.id('F')
              AND test.value_as('F', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 200)
                    WHERE op = 'tasks.assigned'$q$, test.id('W'))) = '1',
    'assigning through a key notifies the assignee', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('team_id', test.id('D'), 'assignee_id', NULL)));
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT team_id FROM public.tasks WHERE id = test.id('T1')) = test.id('D')
              AND test.trail('T1', 'tasks.update') = 'api_key:E · via Claude Desktop',
    'routing it to a team', r);
  r := test.as_key('KF', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT assignee_id FROM public.tasks WHERE id = test.id('T1')) = test.id('F'),
    'a team member''s key takes it', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_agent_report(%L, %L, '{"state": "working", "note": "Wiring the tools"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1', 'and posts its session status', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', '2030-01-01T09:00:00Z')$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT user_id FROM public.task_reminders WHERE task_id = test.id('T1')) = test.id('E'),
    'a reminder set through a key is its person''s own', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2030-01-02T09:00:00Z", "ends_at": "2030-01-02T10:00:00Z", "user_id": "%s"}'::jsonb)$q$,
    test.id('W'), test.id('T1'), test.id('O')));
  PERFORM test.ok(r LIKE '%own calendar or the assignee%', 'a work session goes to its person or the assignee only (the op''s gate)', r);
  r := test.as_key('K', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Done, see PR #42')$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT author_kind || ':' || author_label FROM public.comments WHERE entity_id = test.id('T1'))
                  = 'api_key:Claude Desktop',
    'a comment when asked reads as the app that wrote it', r);

  -- A disallowed write is refused whole.
  r := test.as_key('K', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T2'), 'title', 'Two'),
    jsonb_build_object('tags', jsonb_build_array(repeat('x', 51)))));
  PERFORM test.ok(r LIKE '22023%at most 50%' AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = test.id('T2')),
    'a create whose tag is refused leaves no task behind', r);
  r := test.as_key('KV', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, '{}'::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T3'), 'title', 'Three')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%' AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = test.id('T3')),
    'a view-only key writes nothing', r);
  r := test.as_key('KV', format($q$SELECT public.tasks_agent_sessions(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1', 'but reads its person''s sessions', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": "2030-01-01T00:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TP-none')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace.%', 'a task that isn''t there reads as missing', r);
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TP'), 'title', 'O private', 'bucket_id', test.id('PB'))));
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": "2030-01-01T00:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace.%' AND (SELECT deleted_at FROM public.tasks WHERE id = test.id('TP')) IS NULL,
    'and so does one its person can''t see', r);
END;
$$;
