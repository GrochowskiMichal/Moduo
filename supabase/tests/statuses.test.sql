-- TV-D9 · Statuses per project inside five fixed categories
-- (supabase/migrations/20261010170000_project_statuses.sql).
-- specs/tasks-v3.md AC map: "categories fixed, names per project" (AC3.2,
-- AC4.2, AC7.1) and "old builds see the category" (AC12.6).
--
-- Cast: O owns workspace W. E is a member who works on tasks, V a viewer. SB
-- and SB2 are shared projects, PB is O's private one, CP a creator's pipeline.
-- K is an API key E made with Tasks at Edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('SB2'), test.id('W'), test.id('O'), 'Shared two', false),
  (test.id('CP'), test.id('W'), test.id('O'), 'Podcast', false),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit"}'::jsonb, test.id('E'));

-- A status of a set by name (NULL project = the workspace default).
CREATE FUNCTION test.status(p_project text, p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT s.id FROM public.project_statuses s
  WHERE s.workspace_id = test.id('W') AND s.deleted_at IS NULL AND s.name = p_name
    AND CASE WHEN p_project IS NULL THEN s.project_id IS NULL ELSE s.project_id = test.id(p_project) END
$$;
-- A task's status as "category/legacy/name".
CREATE FUNCTION test.task_status(p_task text) RETURNS text LANGUAGE sql AS $$
  SELECT t.status_category || '/' || t.status || '/' || s.name
  FROM public.tasks t JOIN public.project_statuses s ON s.id = t.status_id
  WHERE t.id = test.id(p_task)
$$;

DO $$
DECLARE
  r text;
  v_names text;
  v_inbox uuid;
BEGIN
  -- ── Defaults and copies ──────────────────────────────────────────────────
  SELECT string_agg(s.category || ':' || s.name, ', ' ORDER BY public.tasks__category_rank(s.category))
    INTO v_names
  FROM public.project_statuses s WHERE s.workspace_id = test.id('W') AND s.project_id IS NULL;
  PERFORM test.ok(v_names = 'backlog:Backlog, todo:To do, in_progress:In progress, done:Done, wont_do:Won''t do',
    'a new workspace gets the five categories as its default statuses', v_names);
  PERFORM test.ok((SELECT count(*) FROM public.project_statuses WHERE project_id = test.id('SB')) = 5,
    'a new project starts from a copy of the workspace default');

  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Captured"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('IN1')::text)));
  SELECT b.id INTO v_inbox FROM public.buckets b WHERE b.workspace_id = test.id('W') AND b.owner_id = test.id('E') AND b.is_system;
  PERFORM test.ok(r = 'ok 1' AND (SELECT status_id FROM public.tasks WHERE id = test.id('IN1')) = test.status(NULL, 'To do'),
    'a task in the Inbox takes the workspace default statuses (#28)', r);
  r := test.try('E', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'in_progress', 'Review')$q$,
    test.id('W'), v_inbox));
  PERFORM test.ok(r LIKE '%Inbox uses the workspace''s default statuses%', 'the Inbox''s statuses can''t be edited', r);

  -- ── A project renames and adds statuses inside categories (AC3.2) ────────
  r := test.as_user('E', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'in_progress', 'In review')$q$,
    test.id('W'), test.id('SB')));
  PERFORM test.ok(r = 'ok 6', 'adding a status answers with the whole set', r);
  r := test.as_user('E', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"name": "Todo"}'::jsonb)$q$,
    test.id('W'), test.status('SB', 'To do')));
  SELECT string_agg(s.name, ' · ' ORDER BY public.tasks__category_rank(s.category), s.position)
    INTO v_names
  FROM public.project_statuses s WHERE s.project_id = test.id('SB') AND s.deleted_at IS NULL;
  PERFORM test.ok(v_names = 'Backlog · Todo · In progress · In review · Done · Won''t do',
    'a dev team''s statuses: Todo renamed, In review inside In progress', v_names);
  PERFORM test.ok((SELECT name FROM public.project_statuses WHERE id = test.status(NULL, 'To do')) = 'To do',
    'renaming a project''s status leaves the workspace default alone');
  r := test.try('E', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"name": "in review"}'::jsonb)$q$,
    test.id('W'), test.status('SB', 'Todo')));
  PERFORM test.ok(r LIKE '%already a status called%', 'two statuses in a project can''t share a name', r);
  r := test.try('E', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'blocked', 'Blocked')$q$,
    test.id('W'), test.id('SB')));
  PERFORM test.ok(r LIKE '%belongs to Backlog, To do, In progress, Done or Won''t do%', 'a status needs one of the five categories', r);
  r := test.as_user('E', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"after": null}'::jsonb)$q$,
    test.id('W'), test.status('SB', 'In review')));
  PERFORM test.ok((SELECT string_agg(s.name, ' · ' ORDER BY s.position) FROM public.project_statuses s
                   WHERE s.project_id = test.id('SB') AND s.category = 'in_progress' AND s.deleted_at IS NULL)
                  = 'In review · In progress',
    'reorder: a status moves first inside its category', r);
  r := test.try('E', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"after": %s}'::jsonb)$q$,
    test.id('W'), test.status('SB', 'In review'), to_json(test.status('SB', 'Done')::text)));
  PERFORM test.ok(r LIKE '%moves only among its category%', 'a status never moves into another category', r);
  r := test.try('E', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"after": %s}'::jsonb)$q$,
    test.id('W'), test.status('SB', 'In review'), to_json(test.status('SB', 'In review')::text)));
  PERFORM test.ok(r LIKE '%moves only among its category%', 'a status can''t move after itself', r);
  PERFORM test.as_user('E', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"after": %s}'::jsonb)$q$,
    test.id('W'), test.status('SB', 'In review'), to_json(test.status('SB', 'In progress')::text)));

  -- ── Writing a status by id, name or category word ────────────────────────
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Fix login", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('T1')::text), to_json(test.id('SB')::text)));
  PERFORM test.ok(test.task_status('T1') = 'todo/todo/Todo', 'a new task takes the project''s first To do status', test.task_status('T1'));
  r := test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'In review')).status$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(test.task_status('T1') = 'in_progress/in_progress/In review',
    'set by the project''s name: In review, in progress, mirrored as in_progress', test.task_status('T1'));
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'in_progress')).status$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(test.task_status('T1') = 'in_progress/in_progress/In review',
    'a category word keeps a status already in that category', test.task_status('T1'));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status": "Won''t do"}'::jsonb)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(test.task_status('T1') = 'wont_do/archived/Won''t do',
    'the words people write work ("Won''t do"), and old builds read archived', test.task_status('T1'));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status_id": %s}'::jsonb)$q$,
    test.id('W'), test.id('T1'), to_json(test.status('SB', 'In progress')::text)));
  PERFORM test.ok(test.task_status('T1') = 'in_progress/in_progress/In progress', 'set by status id', test.task_status('T1'));
  -- (One transaction: every row shares created_at, so read them as a set.)
  SELECT string_agg(payload ->> 'from_name' || ' → ' || (payload ->> 'to_name'), ', '
                    ORDER BY payload ->> 'from_name')
    INTO v_names
  FROM public.module_activity WHERE entity_id = test.id('T1') AND op = 'tasks.set_status';
  PERFORM test.ok(v_names = 'In review → Won''t do, Todo → In review, Won''t do → In progress',
    'every status change writes one trail line naming both statuses (none for a no-op)', v_names);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status_id": %s}'::jsonb)$q$,
    test.id('W'), test.id('T1'), to_json(test.status('SB2', 'Done')::text)));
  PERFORM test.ok(r LIKE '%isn''t in this project%', 'a status of another project is refused', r);
  r := test.try('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'Shipped')).status$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '%Unknown task status "Shipped"%' AND r LIKE '%Todo, In progress, In review, Done%',
    'an unknown name is refused with the project''s list', r);

  -- Agents (MCP keys) accept a category word or a project's name.
  r := test.as_key('K', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'in review')).status$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('T1') = 'in_progress/in_progress/In review',
    'an agent sets a status by the project''s name (any case)', r);
  r := test.as_key('K', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('T1') = 'done/done/Done', 'an agent''s "done" sets the project''s first Done', r);
  r := test.as_key('K', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'Shipped')).status$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '22023%Unknown task status "Shipped"%This project''s statuses:%', 'an agent''s unknown name is refused with the list', r);

  -- ── A creator's pipeline (AC7.1) ─────────────────────────────────────────
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"name": "Ideas"}'::jsonb)$q$,
    test.id('W'), test.status('CP', 'Backlog')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'in_progress', 'Drafting')$q$,
    test.id('W'), test.id('CP')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'in_progress', 'Editing')$q$,
    test.id('W'), test.id('CP')));
  PERFORM test.as_user('O', format($q$SELECT public.project_statuses_op_delete(%L, %L)$q$,
    test.id('W'), test.status('CP', 'In progress')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"name": "Published"}'::jsonb)$q$,
    test.id('W'), test.status('CP', 'Done')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"hidden": true}'::jsonb)$q$,
    test.id('W'), test.status('CP', 'To do')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"hidden": true}'::jsonb)$q$,
    test.id('W'), test.status('CP', 'Won''t do')));
  SELECT string_agg(s.name || '(' || s.category || ')', ' · ' ORDER BY public.tasks__category_rank(s.category), s.position)
    INTO v_names
  FROM public.project_statuses s WHERE s.project_id = test.id('CP') AND s.deleted_at IS NULL AND NOT s.hidden;
  PERFORM test.ok(v_names = 'Ideas(backlog) · Drafting(in_progress) · Editing(in_progress) · Published(done)',
    'a creator''s pipeline: Ideas · Drafting · Editing · Published', v_names);
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Episode 12", "bucket_id": %s, "status": "Ideas"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('EP')::text), to_json(test.id('CP')::text)));
  PERFORM test.ok(test.task_status('EP') = 'backlog/todo/Ideas', 'an episode starts in Ideas, a backlog status', test.task_status('EP'));
  PERFORM test.as_user('O', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'in_progress')).status$q$, test.id('W'), test.id('EP')));
  PERFORM test.ok(test.task_status('EP') = 'in_progress/in_progress/Drafting',
    'a category word lands on the category''s first status (Drafting)', test.task_status('EP'));

  -- ── Deleting a used status, and the last of a category ───────────────────
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_update(%L, %L, '{"hidden": true}'::jsonb)$q$,
    test.id('W'), test.status('CP', 'Editing')));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'in_progress', 'Recording')$q$,
    test.id('W'), test.id('CP')));
  r := test.value_as('O', format($q$SELECT public.project_statuses_op_delete(%L, %L)::text$q$,
    test.id('W'), test.status('CP', 'Drafting')));
  PERFORM test.ok((r::jsonb ->> 'moved')::integer = 1 AND r::jsonb ->> 'moved_to_name' = 'Recording'
              AND test.task_status('EP') = 'in_progress/in_progress/Recording',
    'deleting a used status moves its tasks to the category''s first visible status and says how many', r);
  r := test.try('O', format($q$SELECT public.project_statuses_op_delete(%L, %L)$q$,
    test.id('W'), test.status('CP', 'Published')));
  PERFORM test.ok(r LIKE '%category always keeps one status%', 'the last status of a category can''t be deleted', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.project_statuses WHERE project_id = test.id('CP') AND category = 'wont_do' AND deleted_at IS NULL),
    'hiding never empties a category: a hidden Won''t do is still there');

  -- ── Moving a task to another project ─────────────────────────────────────
  PERFORM test.as_user('E', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'in_progress', 'In review')$q$,
    test.id('W'), test.id('SB2')));
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'In review')).status$q$, test.id('W'), test.id('T1')));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"bucket_id": %s}'::jsonb)$q$,
    test.id('W'), test.id('T1'), to_json(test.id('SB2')::text)));
  PERFORM test.ok((SELECT status_id FROM public.tasks WHERE id = test.id('T1')) = test.status('SB2', 'In review'),
    'a move keeps the status name when the new project has it');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"bucket_id": %s}'::jsonb)$q$,
    test.id('W'), test.id('T1'), to_json(v_inbox::text)));
  PERFORM test.ok((SELECT status_id FROM public.tasks WHERE id = test.id('T1')) = test.status(NULL, 'In progress'),
    'else it takes the first status of the same category there');
  PERFORM test.ok((SELECT payload ->> 'from_name' || ' → ' || (payload ->> 'to_name') FROM public.module_activity
                   WHERE entity_id = test.id('T1') AND op = 'tasks.set_status' AND payload ->> 'reason' = 'moved'
                   ORDER BY created_at DESC, id DESC LIMIT 1) = 'In review → In progress'
              AND EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.id('T1') AND op = 'tasks.update'
                          AND payload ? 'bucket_id'),
    'the trail records both the project and the status change');

  -- ── Permissions ──────────────────────────────────────────────────────────
  r := test.try('V', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'todo', 'Next')$q$, test.id('W'), test.id('SB')));
  PERFORM test.ok(r LIKE '42501%', 'a viewer can''t change statuses', r);
  r := test.try('E', format($q$SELECT * FROM public.project_statuses_op_create(%L, %L, 'todo', 'Next')$q$, test.id('W'), test.id('PB')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%', 'a project you can''t see reads as missing', r);
  r := test.try('E', format($q$SELECT * FROM public.project_statuses_op_create(%L, NULL, 'todo', 'Next')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%owner or an admin%', 'a member can''t change the workspace default', r);
  r := test.as_user('O', format($q$SELECT * FROM public.project_statuses_op_create(%L, NULL, 'in_progress', 'In review')$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 6', 'the owner adds a workspace default status', r);
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
    (test.id('NB'), test.id('W'), test.id('O'), 'New project', false);
  PERFORM test.ok((SELECT count(*) FROM public.project_statuses WHERE project_id = test.id('NB') AND name = 'In review') = 1,
    'new projects start from the current workspace default');
  r := test.try('E', format($q$INSERT INTO public.project_statuses (workspace_id, project_id, category, name) VALUES (%L, %L, 'todo', 'Raw')$q$,
    test.id('W'), test.id('SB')));
  PERFORM test.ok(r LIKE '42501%', 'nobody writes a status row directly', r);
  PERFORM test.ok(test.value_as('V', format($q$SELECT count(*)::text FROM public.project_statuses WHERE project_id = %L$q$, test.id('SB'))) = '6',
    'a viewer reads a shared project''s statuses');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.project_statuses WHERE project_id = %L$q$, test.id('PB'))) = '0',
    'a project you can''t see hides its statuses');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.tasks__resolve_status(uuid, uuid, text, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.tasks__first_status(uuid, uuid, text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.project_statuses_op_create(uuid, uuid, text, text)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.project_statuses_op_delete(uuid, uuid)', 'EXECUTE'),
    'helpers stay internal; the three ops are for signed-in people');
END;
$$;

-- ── Old builds see the category (AC12.6) ────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Someday idea", "bucket_id": %s, "status": "backlog"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('BL')::text), to_json(test.id('SB')::text)));
  PERFORM test.ok(test.task_status('BL') = 'backlog/todo/Backlog',
    'a backlog task reads "todo" in the legacy column, so old builds keep it in view', test.task_status('BL'));

  -- An old build saves the whole row it read: nothing about the status changes.
  r := test.as_user('E', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title, status)
      VALUES (%L, %L, %L, 'Someday idea (edited)', 'todo')
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status$q$,
    test.id('BL'), test.id('W'), test.id('SB')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('BL') = 'backlog/todo/Backlog'
              AND (SELECT title FROM public.tasks WHERE id = test.id('BL')) = 'Someday idea (edited)',
    'an old build''s whole-row save of a backlog task leaves it in Backlog', r);
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'In review')).status$q$, test.id('W'), test.id('BL')));
  r := test.as_user('E', format($q$UPDATE public.tasks SET status = 'in_progress', title = 'Reviewed idea' WHERE id = %L$q$, test.id('BL')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('BL') = 'in_progress/in_progress/In review',
    'an old build writing back the value it read keeps a renamed status', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET status = 'done' WHERE id = %L$q$, test.id('BL')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('BL') = 'done/done/Done',
    'an old build''s status write lands on that category''s first status', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET status = 'archived' WHERE id = %L$q$, test.id('BL')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('BL') = 'wont_do/archived/Won''t do', 'archived lands on Won''t do', r);
  r := test.as_user('E', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title, status)
      VALUES (%L, %L, %L, 'Raw insert', 'in_progress')$q$, test.id('RAW'), test.id('W'), test.id('SB')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('RAW') = 'in_progress/in_progress/In progress',
    'an old build''s insert reads its legacy status (the category''s first status)', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET status_category = 'done' WHERE id = %L$q$, test.id('RAW')));
  PERFORM test.ok(test.task_status('RAW') = 'in_progress/in_progress/In progress',
    'the category column can''t be written on its own', r);
  r := test.try('E', format($q$UPDATE public.tasks SET status = 'someday' WHERE id = %L$q$, test.id('RAW')));
  PERFORM test.ok(r LIKE '%Unknown task status%', 'an unknown legacy value is refused', r);
END;
$$;

-- ── Backlog sits out: scheduling, queuing, the roll-over ────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Park me", "bucket_id": %s, "status": "backlog"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('B1')::text), to_json(test.id('SB')::text)));
  r := test.as_user('E', format($q$SELECT (public.tasks_op_reschedule(%L, %L, now() + interval '1 day')).status$q$, test.id('W'), test.id('B1')));
  PERFORM test.ok(r = 'ok 1' AND test.task_status('B1') = 'todo/todo/Todo', 'scheduling a backlog task moves it to To do', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.id('B1') AND op = 'tasks.set_status'
                          AND payload ->> 'reason' = 'scheduled'),
    'and the trail says why');

  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Park me too", "bucket_id": %s, "status": "backlog"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('B2')::text), to_json(test.id('SB')::text)));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_queue_add(%L, %L)$q$, test.id('W'), test.id('B2')));
  PERFORM test.ok(test.task_status('B2') = 'todo/todo/Todo'
              AND EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = test.id('B2') AND user_id = test.id('E')),
    'queuing a backlog task moves it to To do and queues it', r);
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'backlog')).status$q$, test.id('W'), test.id('B2')));
  PERFORM test.ok(test.task_status('B2') = 'backlog/todo/Backlog'
              AND NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = test.id('B2')),
    'moving a queued task to Backlog takes it out of every queue');

  -- A backlog repeat stays put; an open one rolls.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Weekly idea", "bucket_id": %s, "status": "backlog",
      "recurrence": {"rrule": "FREQ=DAILY", "dtstart": "2026-01-01T09:00:00.000Z", "nextOccurrence": null}}'::jsonb)$q$,
    test.id('W'), to_json(test.id('BR')::text), to_json(test.id('SB')::text)));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Daily standup", "bucket_id": %s,
      "recurrence": {"rrule": "FREQ=DAILY", "dtstart": "2026-01-01T09:00:00.000Z", "nextOccurrence": null}}'::jsonb)$q$,
    test.id('W'), to_json(test.id('OR')::text), to_json(test.id('SB')::text)));
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), now(), 100, interval '10 seconds');
  PERFORM test.ok((SELECT scheduled_at FROM public.tasks WHERE id = test.id('BR')) IS NULL
              AND test.task_status('BR') = 'backlog/todo/Backlog',
    'the roll-over leaves a backlog repeat alone');
  PERFORM test.ok((SELECT scheduled_at FROM public.tasks WHERE id = test.id('OR')) IS NOT NULL,
    'and still rolls an open one');

  -- A repeat finished comes back in the project's first To do status.
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('OR')));
  UPDATE public.tasks SET recurrence = recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(now() - interval '2 days'))
  WHERE id = test.id('OR');
  UPDATE public.task_completions SET completed_at = now() - interval '3 days' WHERE task_id = test.id('OR');
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), now(), 100, interval '10 seconds');
  PERFORM test.ok(test.task_status('OR') = 'todo/todo/Todo', 'a finished repeat comes back in the first To do status', test.task_status('OR'));
END;
$$;
