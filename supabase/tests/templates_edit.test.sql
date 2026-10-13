-- TV-D15 follow-up · Copying needs Edit on the source
-- (supabase/migrations/20261013190000_templates_edit_to_copy.sql; D15-11).
--
-- Duplicate project… and Save as template (a project's or a task's, even one
-- kept for yourself) need Edit on what they copy; using a template that's
-- shared with you doesn't (it needs Tasks edit in the workspace, as any new
-- task does).
--
-- Cast: O owns workspace W. M is a member who works on tasks and can only
-- view PV (O's project, shared with M at view); PE is shared with the whole
-- workspace (edit). V is a workspace viewer. PH is O's private project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M', 'V']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PV'), 'name', 'Board pack', 'starts_on', '2026-11-02')));
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PE'), 'name', 'Launch')));
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PH'), 'name', 'Hidden')));
  DELETE FROM public.resource_grants
  WHERE resource_type = 'bucket' AND resource_id IN (test.id('PV'), test.id('PH'));
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('M'), 'view', test.id('O'));

  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('TV1'), 'title', 'Board slides', 'bucket_id', test.id('PV'), 'due_on', '2026-11-04', 'assignee_id', NULL)));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('TE'), 'title', 'Launch post', 'bucket_id', test.id('PE'), 'assignee_id', NULL)));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('TE1'), 'title', 'Draft the post', 'bucket_id', test.id('PE'), 'parent_id', test.id('TE'), 'assignee_id', NULL)));
  -- A subtask of the launch post that M can only view (it sits in PV).
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('TE2'), 'title', 'Board sign-off', 'description', 'Board only', 'bucket_id', test.id('PV'),
    'parent_id', test.id('TE'), 'assignee_id', NULL)));
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*) FROM public.tasks WHERE id IN (%L, %L)$q$,
                    test.id('TV1'), test.id('TE2'))) = '2'
              AND NOT public.tasks__editable_to(test.id('TV1'), test.id('M')),
    'M sees PV''s tasks but can''t edit them');

  -- ── Copying needs Edit ────────────────────────────────────────────────────
  r := test.try('M', format($q$SELECT public.projects_op_duplicate(%L, %L, '{"name": "Mine now"}'::jsonb)$q$,
    test.id('W'), test.id('PV')));
  PERFORM test.ok(r LIKE '42501%edit access to this project to copy it%'
              AND NOT EXISTS (SELECT 1 FROM public.buckets WHERE name = 'Mine now'),
    'a member who can only view a project can''t duplicate it', r);
  r := test.try('M', format($q$SELECT public.project_templates_op_save(%L, %L, '{"name": "For me"}'::jsonb)$q$,
    test.id('W'), test.id('PV')));
  PERFORM test.ok(r LIKE '42501%edit access to this project to copy it%'
              AND NOT EXISTS (SELECT 1 FROM public.project_templates WHERE name = 'For me'),
    'nor save it as a template, even one kept for themselves', r);
  r := test.try('M', format($q$SELECT public.task_templates_op_save(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('TV1')));
  PERFORM test.ok(r LIKE '42501%edit access to this task%', 'nor save one of its tasks as a template', r);
  r := test.try('M', format($q$SELECT public.projects_op_duplicate(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('PH')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%', 'a project M can''t see still reads as not there', r);
  r := test.try('V', format($q$SELECT public.projects_op_duplicate(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('PE')));
  PERFORM test.ok(r LIKE '%edit access%', 'a workspace viewer can''t duplicate', r);

  -- With Edit it works; a task template takes only the subtasks M can edit.
  r := test.as_user('M', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TE'),
    jsonb_build_object('id', test.id('TTM'))));
  PERFORM test.ok(r = 'ok 1'
              AND jsonb_array_length((SELECT body -> 'tasks' FROM public.task_templates WHERE id = test.id('TTM'))) = 2
              AND (SELECT body::text NOT LIKE '%Board sign-off%' AND body::text NOT LIKE '%Board only%'
                   FROM public.task_templates WHERE id = test.id('TTM')),
    'saving a task M can edit leaves out a subtask M can only view', r);
  r := test.as_user('M', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('PE'),
    jsonb_build_object('id', test.id('PE2'), 'name', 'Launch 2')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT owner_id FROM public.buckets WHERE id = test.id('PE2')) = test.id('M'),
    'a project M can edit duplicates', r);

  -- ── The app's question ────────────────────────────────────────────────────
  PERFORM test.ok(test.value_as('M', format($q$SELECT public.templates_can_copy('project', %L)$q$, test.id('PV'))) = 'false'
              AND test.value_as('M', format($q$SELECT public.templates_can_copy('project', %L)$q$, test.id('PE'))) = 'true'
              AND test.value_as('M', format($q$SELECT public.templates_can_copy('task', %L)$q$, test.id('TV1'))) = 'false'
              AND test.value_as('M', format($q$SELECT public.templates_can_copy('task', %L)$q$, test.id('TE'))) = 'true'
              AND test.value_as('M', format($q$SELECT public.templates_can_copy('project', %L)$q$, test.id('PH'))) = 'false'
              AND test.value_as('M', format($q$SELECT public.templates_can_copy('nope', %L)$q$, test.id('PE'))) = 'false'
              AND test.value_as('O', format($q$SELECT public.templates_can_copy('project', %L)$q$, test.id('PV'))) = 'true',
    'templates_can_copy answers for the caller: Edit yes, view-only, hidden or unknown no');

  -- ── Using a shared template is unchanged ──────────────────────────────────
  PERFORM test.as_user('O', format($q$SELECT public.project_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('PV'),
    jsonb_build_object('id', test.id('TPV'), 'name', 'Board pack kit')));
  r := test.as_user('O', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), test.id('TPV')));
  PERFORM test.ok(r = 'ok 1', 'O shares a template of the project M can only view', r);
  r := test.as_user('M', format($q$SELECT public.project_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TPV'),
    jsonb_build_object('id', test.id('FPV'), 'name', 'My board pack', 'starts_on', '2027-01-04')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT owner_id FROM public.buckets WHERE id = test.id('FPV')) = test.id('M')
              AND EXISTS (SELECT 1 FROM public.tasks WHERE bucket_id = test.id('FPV') AND title = 'Board slides'
                          AND due_on = '2027-01-06'),
    'a member with view-only access to the source still uses a template shared with them', r);
  PERFORM test.as_user('O', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TV1'),
    jsonb_build_object('id', test.id('TTV'))));
  PERFORM test.as_user('O', format($q$SELECT public.templates_op_update(%L, 'task', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), test.id('TTV')));
  r := test.as_user('M', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TTV'),
    jsonb_build_object('id', test.id('AV'), 'project_id', test.id('PE'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT title FROM public.tasks WHERE id = test.id('AV')) = 'Board slides',
    'and a shared task template, into a project M can edit', r);
  r := test.try('V', format($q$SELECT public.project_templates_op_apply(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('TPV')));
  PERFORM test.ok(r LIKE '%edit access%', 'a workspace viewer still can''t make projects from templates', r);
END;
$$;
