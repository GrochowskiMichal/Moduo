-- TV-U18 · Native importers: the app's run through the import engine.
-- What the importer relies on (src/features/tasks/importers/run.ts):
--   - a parent and its subtask made in one run both go with "Undo this
--     import";
--   - a task that got its source's comments, then was sent again by key in
--     the same run (with its teammate, assigned only then so the comments
--     notify nobody), still goes with Undo (the comments are the run's own);
--   - a status the run added to a project it made is there for the tasks;
--   - after an Undo, the same import makes its tasks anew.
-- Cast: O owns workspace W; E is a member who imports; F is a teammate.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member');

CREATE FUNCTION test.e(p_sql text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user('E', p_sql)
$$;
CREATE FUNCTION test.live(p_task text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.tasks WHERE id = test.id(p_task) AND deleted_at IS NULL)
$$;
-- Run 1: a project, a section, a status, a parent with a subtask and a comment.
SELECT test.ok(test.e(format($q$SELECT public.imports_op_begin(%L, 'trello', 'Launch board')$q$, test.id('W'))) = 'ok 1',
  'E begins a run');
CREATE TEMP TABLE run1 AS SELECT id FROM public.imports WHERE label = 'Launch board';
GRANT SELECT ON run1 TO authenticated;

SELECT test.ok(test.e(format($q$SELECT public.imports_op_project_create(%L, %L, %L::jsonb)$q$,
  test.id('W'), (SELECT id FROM run1), jsonb_build_object('id', test.id('P'), 'name', 'Launch'))) = 'ok 1',
  'the run makes a project');
SELECT test.ok(test.e(format($q$SELECT public.imports_op_section_create(%L, %L, %L, %L::jsonb)$q$,
  test.id('W'), (SELECT id FROM run1), test.id('P'), jsonb_build_object('id', test.id('S'), 'name', 'Week 1')))
  LIKE 'ok %', 'the run makes a section');
SELECT test.ok(test.e(format($q$SELECT public.project_statuses_op_create(%L, %L, 'in_progress', 'Review')$q$,
  test.id('W'), test.id('P'))) LIKE 'ok %', 'a list becomes a status of the run''s project');

SELECT test.ok(test.e(format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$,
  test.id('W'),
  jsonb_build_object('id', test.id('T1'), 'title', 'Ship the page', 'bucket_id', test.id('P'),
    'section_id', test.id('S'), 'status', 'Review', 'assignee_id', null, 'position', 'a0',
    'imported_from', jsonb_build_object('source', 'trello', 'key', 'card-1')),
  jsonb_build_object('import_id', (SELECT id FROM run1), 'tags', jsonb_build_array('launch'))))
  = 'ok 1', 'a card becomes a task in the list''s status');
SELECT test.ok(
  (SELECT s.name FROM public.tasks t JOIN public.project_statuses s ON s.id = t.status_id WHERE t.id = test.id('T1'))
    = 'Review', 'the task sits in the list''s status');
SELECT test.ok(test.e(format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$,
  test.id('W'),
  jsonb_build_object('id', test.id('T2'), 'title', 'Write copy', 'bucket_id', test.id('P'),
    'section_id', test.id('S'), 'parent_id', test.id('T1'), 'assignee_id', null, 'status', 'done',
    'imported_from', jsonb_build_object('source', 'trello', 'key', 'card-1/check-1')),
  jsonb_build_object('import_id', (SELECT id FROM run1)))) = 'ok 1', 'a checklist item becomes a subtask');
SELECT test.ok(test.e(format($q$SELECT public.comments_op_add(%L, 'task', %L, %L)$q$,
  test.id('W'), test.id('T1'), 'Anna · 3 Oct: looks good')) = 'ok 1', 'the card''s comment is added');
-- The app adds it in its own transaction, after the task's: stamp it so.
UPDATE public.module_activity SET created_at = clock_timestamp()
WHERE entity_id = test.id('T1') AND op = 'comments.add';
SELECT test.ok(
  (SELECT max(created_at) FROM public.module_activity WHERE entity_id = test.id('T1'))
    > (SELECT logged_at FROM public.import_rows WHERE entity_id = test.id('T1')),
  'the comment reads as a change after the run wrote the task');
SELECT test.ok(
  NOT EXISTS (SELECT 1 FROM public.module_activity a
              WHERE a.entity_id = test.id('T1') AND a.op = 'comments.add'
                AND a.payload -> 'notify_user_ids' ? test.id('F')::text),
  'the comment, added while nobody is on the task, notifies no teammate');
-- Sent again by key (no id), with the teammate the importer picked: the
-- run's row moves past the comment, and F is assigned once.
SELECT test.ok(test.e(format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$,
  test.id('W'),
  jsonb_build_object('title', 'Ship the page', 'assignee_id', test.id('F'),
    'imported_from', jsonb_build_object('source', 'trello', 'key', 'card-1')),
  jsonb_build_object('import_id', (SELECT id FROM run1)))) = 'ok 1', 'the task is sent again by key');
SELECT test.ok((SELECT assignee_id FROM public.tasks WHERE id = test.id('T1')) = test.id('F'),
  'the re-send assigns the teammate');
SELECT test.ok(
  (SELECT logged_at FROM public.import_rows WHERE entity_id = test.id('T1'))
    > (SELECT max(created_at) FROM public.module_activity WHERE entity_id = test.id('T1')),
  'sent again, the run''s row is stamped after the comment');
SELECT test.ok(
  (SELECT action FROM public.import_rows WHERE entity_id = test.id('T1')) = 'created'
  AND (SELECT count(*) FROM public.import_rows WHERE import_id = (SELECT id FROM run1)) = 4,
  'it stays the run''s own creation (project, section, two tasks)');
SELECT test.ok(test.e(format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W'), (SELECT id FROM run1))) = 'ok 1',
  'E finishes the run');

-- Undo: the commented parent, its subtask, the section and the project go.
SELECT test.ok(test.e(format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), (SELECT id FROM run1))) = 'ok 1',
  'E undoes the first run');
SELECT test.ok(NOT test.live('T1') AND NOT test.live('T2'),
  'the commented parent and its subtask are in Recently deleted');
SELECT test.ok(
  (SELECT deleted_at IS NOT NULL FROM public.sections WHERE id = test.id('S'))
  AND (SELECT deleted_at IS NOT NULL FROM public.buckets WHERE id = test.id('P')),
  'the run''s section and project go too');

-- Imported again after the Undo: the key is free, so it's a new task.
SELECT test.ok(test.e(format($q$SELECT public.imports_op_begin(%L, 'trello', 'Launch board again')$q$, test.id('W'))) = 'ok 1',
  'E begins the same import again');
CREATE TEMP TABLE run2 AS SELECT id FROM public.imports WHERE label = 'Launch board again';
SELECT test.ok(test.e(format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$,
  test.id('W'),
  jsonb_build_object('id', test.id('T1b'), 'title', 'Ship the landing page', 'due_on', '2026-11-02',
    'imported_from', jsonb_build_object('source', 'trello', 'key', 'card-1')),
  jsonb_build_object('import_id', (SELECT id FROM run2)))) = 'ok 1', 'the card is sent again');
SELECT test.ok(
  test.live('T1b')
  AND (SELECT count(*) FROM public.tasks WHERE imported_from ->> 'key' = 'card-1' AND deleted_at IS NULL) = 1,
  'after an Undo, importing again makes the task anew, once');
