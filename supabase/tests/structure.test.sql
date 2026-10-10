-- TV-D10 · Areas, projects, sections, the estimate, time blocks
-- (supabase/migrations/20261010180000_areas_projects_sections.sql, and the
-- task ops' fields in 20261010182000_teams.sql).
-- specs/tasks-v3.md AC map: "areas, projects, sections" (AC2.1, AC4.1,
-- AC12.5) and the Edge cases "Structure moves".
--
-- Cast: O owns workspace W. E is a member who works on tasks, V a viewer, X
-- belongs to another workspace W2. P1–P4 are shared projects (rail sections
-- from before TV-D10 on P1–P3), PB is O's private one.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');

-- Projects as a build from before TV-D10 left them: rail sections in
-- group_label, no areas yet.
ALTER TABLE public.buckets DISABLE TRIGGER buckets_area_sync;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position, group_label) VALUES
  (test.id('P1'), test.id('W'), test.id('O'), 'Website', false, '0001', 'Product'),
  (test.id('P2'), test.id('W'), test.id('O'), 'Acme', false, '0002', 'Clients'),
  (test.id('P3'), test.id('W'), test.id('O'), 'App', false, '0003', 'Product'),
  (test.id('P4'), test.id('W'), test.id('O'), 'Loose', false, '0004', NULL),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0005', NULL),
  (test.id('XB'), test.id('W2'), test.id('X'), 'Theirs', false, '0001', NULL);
ALTER TABLE public.buckets ENABLE TRIGGER buckets_area_sync;
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES
  (test.id('C1'), test.id('W'), test.id('E'), 'Acme Corp'),
  (test.id('CX'), test.id('W2'), test.id('X'), 'Not ours');

CREATE FUNCTION test.bucket(p_name text) RETURNS public.buckets LANGUAGE sql STABLE AS $$
  SELECT * FROM public.buckets WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.area(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT a.id FROM public.areas a
  WHERE a.workspace_id = test.id('W') AND a.name = p_name AND a.deleted_at IS NULL
$$;
CREATE FUNCTION test.section(p_project text, p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM public.sections s
  WHERE s.project_id = test.id(p_project) AND s.name = p_name AND s.deleted_at IS NULL
$$;
CREATE FUNCTION test.areas() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(a.name, ' · ' ORDER BY a.position)
  FROM public.areas a WHERE a.workspace_id = test.id('W') AND a.deleted_at IS NULL
$$;

DO $$
DECLARE
  r text;
  v_t public.tasks;
  v_inbox uuid;
  v_week1 uuid;
BEGIN
  -- ── Today's rail sections become areas, in sidebar order ─────────────────
  PERFORM public.tasks__backfill_areas(test.id('W'));
  PERFORM test.ok(test.areas() = 'Product · Clients',
    'rail sections become areas in sidebar order (first project''s position)', test.areas());
  PERFORM test.ok((test.bucket('P1')).area_id = test.area('Product') AND (test.bucket('P3')).area_id = test.area('Product')
              AND (test.bucket('P2')).area_id = test.area('Clients') AND (test.bucket('P4')).area_id IS NULL,
    'each project lands in the area of its old label; an unlabelled one has none');
  PERFORM test.ok((test.bucket('P1')).group_label = 'Product',
    'group_label stays, mirroring the area''s name, for builds from before TV-D10');
  PERFORM test.ok(public.tasks__backfill_areas(test.id('W')) = 0 AND test.areas() = 'Product · Clients',
    'the backfill runs once: a second run makes nothing');

  -- An old build's rail "Section" menu writes group_label.
  r := test.as_user('E', format($q$UPDATE public.buckets SET group_label = 'Clients' WHERE id = %L$q$, test.id('P4')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P4')).area_id = test.area('Clients'),
    'an old build''s label write lands the project in the area of that name', r);
  r := test.as_user('E', format($q$UPDATE public.buckets SET group_label = 'School' WHERE id = %L$q$, test.id('P4')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P4')).area_id = test.area('School') AND test.areas() = 'Product · Clients · School',
    'a new label makes its area at the end of the sidebar', test.areas());
  r := test.as_user('E', format($q$UPDATE public.buckets SET group_label = NULL WHERE id = %L$q$, test.id('P4')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P4')).area_id IS NULL, 'clearing the label leaves the area', r);

  -- ── Area ops ─────────────────────────────────────────────────────────────
  r := test.as_user('E', format($q$SELECT * FROM public.areas_op_update(%L, %L, '{"name": "Customers"}'::jsonb)$q$,
    test.id('W'), test.area('Clients')));
  PERFORM test.ok(r = 'ok 3' AND (test.bucket('P2')).group_label = 'Customers',
    'renaming an area relabels its projects (group_label mirrors the name)', r);
  r := test.as_user('E', format($q$SELECT * FROM public.areas_op_move(%L, %L, NULL)$q$,
    test.id('W'), test.area('Customers')));
  PERFORM test.ok(test.areas() = 'Customers · Product · School', 'an area moves first', test.areas());
  r := test.as_user('E', format($q$SELECT * FROM public.areas_op_move(%L, %L, %L)$q$,
    test.id('W'), test.area('Customers'), test.area('School')));
  PERFORM test.ok(test.areas() = 'Product · School · Customers', 'an area moves after another', test.areas());
  r := test.try('E', format($q$SELECT * FROM public.areas_op_create(%L, 'product')$q$, test.id('W')));
  PERFORM test.ok(r LIKE 'ok%', 'names are as typed: "product" is not "Product" (the old rail told them apart)', r);
  r := test.try('E', format($q$SELECT * FROM public.areas_op_create(%L, ' Product ')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%already an area called "Product"%', 'two live areas can''t share a name', r);
  r := test.try('V', format($q$SELECT * FROM public.areas_op_create(%L, 'Viewers')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a viewer can''t make areas', r);
  PERFORM test.ok(test.value_as('V', format($q$SELECT string_agg(name, ',' ORDER BY name) FROM public.areas WHERE workspace_id = %L$q$, test.id('W'))) = 'Customers,Product',
    'a viewer reads the areas of projects they can see (areas carry no permissions of their own)');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.areas WHERE id = %L$q$, test.area('School'))) = '1'
              AND test.value_as('V', format($q$SELECT count(*)::text FROM public.areas WHERE id = %L$q$, test.area('School'))) = '0',
    'an area made from a label with no project left is its maker''s alone');
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM public.areas WHERE workspace_id = %L$q$, test.id('W'))) = '0',
    'someone outside the workspace reads none');
  r := test.try('E', $q$INSERT INTO public.areas (workspace_id, name) VALUES (md5('db-test:W')::uuid, 'Raw')$q$);
  PERFORM test.ok(r LIKE '42501%', 'areas are written only through the ops', r);

  -- Structure moves: deleting an area makes its projects area-less.
  r := test.as_user('E', format($q$SELECT * FROM public.areas_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$,
    test.id('W'), test.area('Product')));
  PERFORM test.ok(r = 'ok 2' AND (test.bucket('P1')).area_id IS NULL AND (test.bucket('P1')).group_label IS NULL
              AND (test.bucket('P3')).area_id IS NULL AND (test.bucket('P1')).deleted_at IS NULL
              AND test.areas() = 'School · Customers',
    'deleting an area: its projects become area-less, nothing else changes', r);

  -- ── Projects carry status, start/target, lead, client (AC4.1) ────────────
  r := test.as_user('E', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('AC'), 'name', 'Acme rebrand', 'status', 'on_hold',
      'starts_on', '2026-11-02', 'target_on', '2026-12-18', 'lead_id', test.id('O'),
      'client_contact_id', test.id('C1'), 'area_id', test.area('Customers'))));
  PERFORM test.ok(r = 'ok 1'
      AND row((test.bucket('AC')).status, (test.bucket('AC')).starts_on, (test.bucket('AC')).target_on,
              (test.bucket('AC')).lead_id, (test.bucket('AC')).client_contact_id, (test.bucket('AC')).owner_id)
          = row('on_hold'::text, '2026-11-02'::date, '2026-12-18'::date, test.id('O'), test.id('C1'), test.id('E'))
      AND (test.bucket('AC')).group_label = 'Customers',
    'a PM''s project saves status, start/target, lead, client and area; the creator owns it', r);
  PERFORM test.ok((SELECT count(*) FROM public.project_statuses WHERE project_id = test.id('AC')) = 5,
    'a project made by the op gets its own copy of the default statuses (TV-D9''s seed)');
  r := test.as_user('E', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('AC'), 'name', 'Twice')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('AC')).name = 'Acme rebrand', 'a resent create answers with the project it made', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, '{"status": "done", "lead_id": null}'::jsonb)$q$,
    test.id('W'), test.id('AC')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('AC')).status = 'done' AND (test.bucket('AC')).lead_id IS NULL,
    'status Done and a cleared lead save', r);
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, '{"status": "at_risk"}'::jsonb)$q$, test.id('W'), test.id('AC')));
  PERFORM test.ok(r LIKE '%Active, On hold or Done%', 'a project is Active, On hold or Done (no health field)', r);
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, '{"target_on": "2026-10-01"}'::jsonb)$q$, test.id('W'), test.id('AC')));
  PERFORM test.ok(r LIKE '%target date can''t be before its start%', 'a target before the start is refused', r);
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('AC'),
    jsonb_build_object('lead_id', test.id('X'))));
  PERFORM test.ok(r LIKE '%lead has to be in this workspace%', 'a lead from outside the workspace is refused', r);
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('AC'),
    jsonb_build_object('client_contact_id', test.id('CX'))));
  PERFORM test.ok(r LIKE '%contact isn''t in this workspace%', 'a client from another workspace is refused', r);
  r := test.try('E', format($q$UPDATE public.buckets SET lead_id = %L WHERE id = %L$q$, test.id('X'), test.id('P1')));
  PERFORM test.ok(r LIKE '%lead has to be in this workspace%', 'the same check holds for a raw write', r);
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, '{"health": "red"}'::jsonb)$q$, test.id('W'), test.id('AC')));
  PERFORM test.ok(r LIKE '%no field "health"%', 'unknown project fields are refused', r);
  r := test.try('V', format($q$SELECT public.projects_op_update(%L, %L, '{"status": "active"}'::jsonb)$q$, test.id('W'), test.id('AC')));
  PERFORM test.ok(r LIKE '%don''t have edit access%', 'a viewer can''t change a project', r);
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, '{"status": "on_hold"}'::jsonb)$q$, test.id('W'), test.id('PB')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%', 'a private project you can''t see reads as missing', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_move(%L, %L, %L, 'zz')$q$,
    test.id('W'), test.id('P1'), test.area('School')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P1')).area_id = test.area('School') AND (test.bucket('P1')).position = 'zz'
              AND (test.bucket('P1')).group_label = 'School',
    'a project moves into an area and to a new place', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_move(%L, %L, NULL)$q$, test.id('W'), test.id('P1')));
  PERFORM test.ok((test.bucket('P1')).area_id IS NULL AND (test.bucket('P1')).position = 'zz',
    'moving out of an area keeps the place when none is given', r);
  -- The Inbox is nobody's project.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Captured"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('IN1')::text)));
  SELECT b.id INTO v_inbox FROM public.buckets b WHERE b.workspace_id = test.id('W') AND b.owner_id = test.id('E') AND b.is_system;
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, '{"status": "on_hold"}'::jsonb)$q$, test.id('W'), v_inbox));
  PERFORM test.ok(r LIKE '%Inbox isn''t a project%', 'the Inbox has no project fields', r);
  r := test.try('E', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Week 1"}'::jsonb)$q$, test.id('W'), v_inbox));
  PERFORM test.ok(r LIKE '%Inbox isn''t a project%', 'the Inbox has no sections', r);

  -- ── A course is a project with weekly sections (AC2.1) ───────────────────
  PERFORM test.as_user('E', format($q$SELECT public.projects_op_create(%L, '{"id": %s, "name": "CS 201"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('CS')::text)));
  r := test.as_user('E', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Week 1", "starts_on": "2026-09-07", "ends_on": "2026-09-13"}'::jsonb)$q$,
    test.id('W'), test.id('CS')));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Week 2", "starts_on": "2026-09-14", "ends_on": "2026-09-20"}'::jsonb)$q$,
    test.id('W'), test.id('CS')));
  r := test.as_user('E', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Final exam", "ends_on": "2026-12-15"}'::jsonb)$q$,
    test.id('W'), test.id('CS')));
  PERFORM test.ok(r = 'ok 3', 'sections carry a range or an end date only; the answer is the project''s list', r);
  PERFORM test.ok((SELECT string_agg(s.name || coalesce(' ' || s.starts_on, '') || ' → ' || s.ends_on, ' | ' ORDER BY s.position)
                   FROM public.sections s WHERE s.project_id = test.id('CS'))
                  = 'Week 1 2026-09-07 → 2026-09-13 | Week 2 2026-09-14 → 2026-09-20 | Final exam → 2026-12-15',
    'a course''s weekly sections, in order');
  r := test.try('E', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Open", "starts_on": "2026-09-21"}'::jsonb)$q$,
    test.id('W'), test.id('CS')));
  PERFORM test.ok(r LIKE '%end date, or a start and an end%', 'a start without an end is refused', r);
  r := test.try('E', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Back", "starts_on": "2026-09-21", "ends_on": "2026-09-01"}'::jsonb)$q$,
    test.id('W'), test.id('CS')));
  PERFORM test.ok(r LIKE '%can''t end before it starts%', 'a section can''t end before it starts', r);
  r := test.as_user('E', format($q$SELECT * FROM public.sections_op_move(%L, %L, NULL)$q$, test.id('W'), test.section('CS', 'Final exam')));
  PERFORM test.ok((SELECT string_agg(s.name, ' · ' ORDER BY s.position) FROM public.sections s
                   WHERE s.project_id = test.id('CS') AND s.deleted_at IS NULL) = 'Final exam · Week 1 · Week 2',
    'a section moves first', r);
  PERFORM test.as_user('E', format($q$SELECT * FROM public.sections_op_move(%L, %L, %L)$q$,
    test.id('W'), test.section('CS', 'Final exam'), test.section('CS', 'Week 2')));
  r := test.as_user('E', format($q$SELECT * FROM public.sections_op_update(%L, %L, '{"name": "Week 2 · Recursion", "ends_on": "2026-09-19"}'::jsonb)$q$,
    test.id('W'), test.section('CS', 'Week 2')));
  PERFORM test.ok(test.section('CS', 'Week 2 · Recursion') IS NOT NULL
              AND (SELECT ends_on FROM public.sections WHERE id = test.section('CS', 'Week 2 · Recursion')) = '2026-09-19',
    'a section renames and re-dates', r);
  r := test.try('V', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Week 9"}'::jsonb)$q$, test.id('W'), test.id('CS')));
  PERFORM test.ok(r LIKE '%don''t have edit access%', 'a viewer can''t add sections', r);
  PERFORM test.ok(test.value_as('V', format($q$SELECT count(*)::text FROM public.sections WHERE project_id = %L$q$, test.id('CS'))) = '3',
    'a viewer of the project reads its sections');
  PERFORM test.as_user('O', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Secret"}'::jsonb)$q$, test.id('W'), test.id('PB')));
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.sections WHERE project_id = %L$q$, test.id('PB'))) = '0',
    'sections inherit the project''s privacy');

  -- Tasks in sections.
  v_week1 := test.section('CS', 'Week 1');
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('HW1'), 'title', 'Problem set 1', 'bucket_id', test.id('CS'), 'section_id', v_week1)));
  PERFORM test.ok(r = 'ok 1' AND (test.task('HW1')).section_id = v_week1, 'a task is created in a section', r);
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'Wrong', 'bucket_id', test.id('P2'), 'section_id', v_week1)));
  PERFORM test.ok(r LIKE '%section isn''t in this task''s project%', 'a section never spans projects', r);
  r := test.try('E', format($q$UPDATE public.tasks SET section_id = %L WHERE id = %L$q$,
    test.section('PB', 'Secret'), test.id('HW1')));
  PERFORM test.ok(r LIKE '%section isn''t in this task''s project%', 'the same holds for a raw write', r);
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('HW2'), 'title', 'Reading', 'bucket_id', test.id('CS'))));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('HW2'),
    jsonb_build_object('section_id', v_week1)));
  PERFORM test.ok(r = 'ok 1' AND (test.task('HW2')).section_id = v_week1
              AND EXISTS (SELECT 1 FROM public.module_activity a WHERE a.entity_id = test.id('HW2')
                            AND a.op = 'tasks.update' AND a.payload -> 'fields' = '["section_id"]'::jsonb),
    'moving a task into a section is an edit with its trail line', r);
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('HW3'), 'title', 'Old reading', 'bucket_id', test.id('CS'), 'section_id', v_week1)));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$,
    test.id('W'), test.id('HW3')));

  -- Structure moves: a task moved to another project goes to "No section".
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('HW2'),
    jsonb_build_object('bucket_id', test.id('P2'))));
  PERFORM test.ok((test.task('HW2')).bucket_id = test.id('P2') AND (test.task('HW2')).section_id IS NULL,
    'a task moved to another project lands in "No section" there', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET bucket_id = %L WHERE id = %L$q$, test.id('P2'), test.id('HW1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('HW1')).section_id IS NULL,
    'so does an old build''s raw move (it doesn''t know sections)', r);
  PERFORM test.as_user('E', format($q$UPDATE public.tasks SET bucket_id = %L, section_id = %L WHERE id = %L$q$,
    test.id('CS'), v_week1, test.id('HW1')));

  -- Structure moves: deleting a section sends its tasks to "No section".
  r := test.as_user('E', format($q$SELECT * FROM public.sections_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$,
    test.id('W'), v_week1));
  v_t := test.task('HW1');
  PERFORM test.ok(r = 'ok 2' AND v_t.section_id IS NULL AND v_t.bucket_id = test.id('CS') AND v_t.deleted_at IS NULL
              AND (test.task('HW3')).section_id IS NULL,
    'deleting a section: its tasks (deleted ones too) go to "No section" in the same project; nothing is deleted', r);
  r := test.as_user('E', format($q$SELECT * FROM public.sections_op_update(%L, %L, '{"deleted_at": null}'::jsonb)$q$,
    test.id('W'), v_week1));
  PERFORM test.ok(r = 'ok 3', 'a deleted section can be restored', r);

  -- ── The estimate has its own column; duration_minutes is the block ───────
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('ES'), 'title', 'Estimate me', 'bucket_id', test.id('P2'), 'duration_minutes', 90)));
  PERFORM test.ok((test.task('ES')).estimate_minutes = 90, 'a create with duration_minutes (an old build''s estimate) sets the estimate');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"estimate_minutes": 240}'::jsonb)$q$,
    test.id('W'), test.id('ES')));
  PERFORM test.ok(((test.task('ES')).estimate_minutes, (test.task('ES')).duration_minutes) = (240, 240),
    'an estimate on an unscheduled task reaches duration_minutes, which builds before TV-D10 read');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a WHERE a.entity_id = test.id('ES')
                            AND a.op = 'tasks.update' AND a.payload -> 'fields' = '["estimate_minutes"]'::jsonb),
    'the trail names the estimate, not its mirror');
  PERFORM test.as_user('E', format($q$UPDATE public.tasks SET duration_minutes = 45 WHERE id = %L$q$, test.id('ES')));
  PERFORM test.ok((test.task('ES')).estimate_minutes = 45, 'an old build''s duration_minutes write is the estimate too');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"scheduled_at": "2030-01-07T09:00:00Z", "duration_minutes": 60}'::jsonb)$q$,
    test.id('W'), test.id('ES')));
  PERFORM test.ok(((test.task('ES')).estimate_minutes, (test.task('ES')).duration_minutes) = (45, 60),
    'scheduling a block (a calendar drop or resize) leaves the estimate alone');
  PERFORM test.as_user('E', format($q$UPDATE public.tasks SET duration_minutes = 120 WHERE id = %L$q$, test.id('ES')));
  PERFORM test.ok(((test.task('ES')).estimate_minutes, (test.task('ES')).duration_minutes) = (45, 120),
    'so does resizing it');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"estimate_minutes": 300}'::jsonb)$q$,
    test.id('W'), test.id('ES')));
  PERFORM test.ok(((test.task('ES')).estimate_minutes, (test.task('ES')).duration_minutes) = (300, 120),
    'on a scheduled task the estimate no longer doubles as the block''s length (REPLAN 25)');
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_unschedule(%L, %L)$q$, test.id('W'), test.id('ES')));
  PERFORM test.ok(((test.task('ES')).estimate_minutes, (test.task('ES')).duration_minutes) = (300, 300)
                  AND (test.task('ES')).scheduled_at IS NULL,
    'unscheduled again, duration_minutes is the estimate (what old builds and a calendar drop read)');

  -- ── Time blocks are each person's own ────────────────────────────────────
  r := test.as_user('E', format($q$SELECT public.tasks_op_set_time_blocks(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('morning', test.id('P2'), 'evening', 'not-a-project', 'noon', test.id('P3'),
                       'afternoon', test.id('XB'))));
  PERFORM test.ok((SELECT task_time_blocks -> test.id('W')::text FROM public.user_preferences WHERE user_id = test.id('E'))
                  = jsonb_build_object('morning', test.id('P2')),
    'time blocks save per person and workspace, keeping only slots that name a project here', r);
  PERFORM test.ok(coalesce((SELECT task_time_blocks ? test.id('W')::text FROM public.user_preferences WHERE user_id = test.id('O')), false) = false,
    'one person''s time blocks are not a teammate''s');
  r := test.as_user('O', format($q$INSERT INTO public.task_time_blocks (workspace_id, blocks) VALUES (%L, %L::jsonb)$q$,
    test.id('W'), jsonb_build_object('evening', test.id('P3'))));
  PERFORM test.ok((SELECT task_time_blocks -> test.id('W')::text FROM public.user_preferences WHERE user_id = test.id('O'))
                  = jsonb_build_object('evening', test.id('P3')),
    'an old build''s write to the workspace table lands in the writer''s own preferences', r);

  -- ── Erasure: a lead is cleared, the project stays (§15) ──────────────────
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P3'),
    jsonb_build_object('lead_id', test.id('E'))));
  PERFORM test.ok((public.account_erase_workspace_data(test.id('E'), true) ->> 'project_leads_cleared')::integer = 1,
    'the erasure preview counts the projects someone leads');
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('E')), false);
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P3')).lead_id IS NULL AND (test.bucket('P3')).deleted_at IS NULL,
    'erasure clears the lead; the project stays', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.user_preferences p
                              WHERE p.task_time_blocks::text LIKE '%' || test.id('AC')::text || '%'),
    'no time block keeps a project that went with the person');
END;
$$;

-- ── Privacy: nothing about a project you can't see comes through ───────────
-- PB is O's private project. M is a member, V a viewer of shared projects.
SELECT test.person(n) FROM unnest(ARRAY['M', 'N']) AS n;
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('N'), 'member');
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES
  (test.id('C2'), test.id('W'), test.id('M'), 'Private client');
DELETE FROM public.resource_grants WHERE resource_type = 'contact' AND resource_id = test.id('C2');

DO $$
DECLARE
  r text;
  v_secret uuid;
BEGIN
  -- An old build's label typed only on a private project.
  r := test.as_user('O', format($q$UPDATE public.buckets SET group_label = 'Job hunt' WHERE id = %L$q$, test.id('PB')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('PB')).area_id = test.area('Job hunt'), 'the label made its area', r);
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*)::text FROM public.areas WHERE id = %L$q$, test.area('Job hunt'))) = '1'
              AND test.value_as('M', format($q$SELECT count(*)::text FROM public.areas WHERE id = %L$q$, test.area('Job hunt'))) = '0'
              AND test.value_as('V', format($q$SELECT count(*)::text FROM public.areas WHERE id = %L$q$, test.area('Job hunt'))) = '0',
    'an area that holds only projects you can''t see is hidden from you (its name was never yours to read)');
  r := test.value_as('M', format($q$SELECT string_agg(name, ',' ORDER BY name) FROM public.areas_op_create(%L, 'Ops')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%Ops%' AND r NOT LIKE '%Job hunt%', 'the ops answer only with areas you can see', r);
  PERFORM test.ok(test.value_as('M', format($q$SELECT string_agg(name, ',' ORDER BY name) FROM public.areas_op_move(%L, %L, NULL)$q$,
                    test.id('W'), test.area('Ops'))) NOT LIKE '%Job hunt%',
    'a move answers without the hidden area too');
  r := test.try('M', format($q$SELECT * FROM public.areas_op_update(%L, %L, '{"name": "Mine"}'::jsonb)$q$, test.id('W'), test.area('Job hunt')));
  PERFORM test.ok(r LIKE '%Area not found%', 'a hidden area can''t be renamed by someone who can''t see it', r);
  r := test.try('M', format($q$SELECT * FROM public.areas_op_move(%L, %L, %L)$q$, test.id('W'), test.area('Ops'), test.area('Job hunt')));
  PERFORM test.ok(r LIKE '%moves only among%', 'nor used as a place to move to', r);
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_move(%L, %L, %L)$q$, test.id('W'), test.id('P4'), test.area('Job hunt')));
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.areas WHERE id = %L$q$, test.area('Job hunt'))) = '1',
    'once it holds a project you can see, the area shows');

  -- A private project's fields and sections.
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('PB'),
    jsonb_build_object('status', 'on_hold', 'target_on', '2027-01-01', 'lead_id', test.id('O'))));
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.buckets WHERE id = %L$q$, test.id('PB'))) = '0'
              AND test.value_as('M', format($q$SELECT count(*)::text FROM public.buckets WHERE lead_id = %L AND status = 'on_hold'$q$, test.id('O'))) = '0',
    'a member reads none of a private project''s fields, not even by filtering on them');
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.sections WHERE project_id = %L$q$, test.id('PB'))) = '0'
              AND test.value_as('M', format($q$SELECT count(*)::text FROM public.sections WHERE workspace_id = %L AND name = 'Secret'$q$, test.id('W'))) = '0',
    'nor its sections, nor a count of them');
  SELECT s.id INTO v_secret FROM public.sections s WHERE s.project_id = test.id('PB') AND s.name = 'Secret';
  r := test.try('M', format($q$SELECT * FROM public.sections_op_update(%L, %L, '{"name": "x"}'::jsonb)$q$, test.id('W'), v_secret));
  PERFORM test.ok(r LIKE '%Section not found%', 'a private project''s section reads as missing to the ops', r);
  r := test.try('M', format($q$SELECT * FROM public.sections_op_move(%L, %L, NULL)$q$, test.id('W'), v_secret));
  PERFORM test.ok(r LIKE '%Section not found%', 'to every op', r);
  r := test.try('M', format($q$SELECT public.projects_op_update(%L, %L, '{"name": "x"}'::jsonb)$q$, test.id('W'), test.id('PB')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%', 'and so does the project', r);

  -- A client the reader can't see stays unseen through the project.
  r := test.as_user('M', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('CL'), 'name', 'Client work', 'client_contact_id', test.id('C2'))));
  PERFORM test.ok(r = 'ok 1'
      AND test.value_as('V', format($q$SELECT count(*)::text FROM public.buckets WHERE id = %L$q$, test.id('CL'))) = '1'
      AND test.value_as('V', format($q$SELECT count(*)::text FROM public.contacts WHERE id = %L$q$, test.id('C2'))) = '0'
      AND test.value_as('V', format($q$SELECT count(*)::text FROM public.contacts c JOIN public.buckets b ON b.client_contact_id = c.id WHERE b.id = %L$q$, test.id('CL'))) = '0',
    'a viewer who sees the project can''t read its private client contact', r);
  r := test.try('N', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P2'),
    jsonb_build_object('client_contact_id', test.id('C2'))));
  PERFORM test.ok(r LIKE '%contact isn''t in this workspace%', 'nobody can name a contact they can''t see as a client', r);

  -- Time blocks keep only projects you can see.
  r := test.as_user('M', format($q$SELECT public.tasks_op_set_time_blocks(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('morning', test.id('PB'), 'evening', test.id('CL'))));
  PERFORM test.ok((SELECT task_time_blocks -> test.id('W')::text FROM public.user_preferences WHERE user_id = test.id('M'))
                  = jsonb_build_object('evening', test.id('CL')),
    'a time block can''t name a project you can''t see', r);
END;
$$;

-- ── Every path to the same data uses the same gate ──────────────────────────
-- M can't see O's private projects PB3 and PB4; each path below is checked
-- for M: area reads, area ops, filing by name, a raw label or area write,
-- sections (read, ops, a task's section), project ops, team defaults and
-- routing, sessions and Waiting on of a task in a private project.
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('PB3'), test.id('W'), test.id('O'), 'O side gig', false, '0006'),
  (test.id('PB4'), test.id('W'), test.id('O'), 'O vault', false, '0007');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB3'), test.id('PB4'));

CREATE FUNCTION test.areas_named(p_who text, p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.areas WHERE workspace_id = %L AND name = %L$q$,
    test.id('W'), p_name))
$$;

DO $$
DECLARE
  r text;
  v_o_vault uuid;
  v_section uuid;
BEGIN
  -- Areas from labels on private projects stay private, also once the
  -- projects are gone (deleted, or moved out).
  PERFORM test.as_user('O', format($q$UPDATE public.buckets SET group_label = 'Side gig' WHERE id = %L$q$, test.id('PB3')));
  PERFORM test.as_user('O', format($q$UPDATE public.buckets SET group_label = 'Vault' WHERE id = %L$q$, test.id('PB4')));
  v_o_vault := (test.bucket('PB4')).area_id;
  PERFORM test.ok(test.areas_named('M', 'Side gig') = '0' AND test.areas_named('O', 'Side gig') = '1',
    'path: area read — a label on a private project makes an area only its viewers see');
  PERFORM test.as_user('O', format($q$UPDATE public.buckets SET deleted_at = now() WHERE id = %L$q$, test.id('PB3')));
  PERFORM test.ok(test.areas_named('M', 'Side gig') = '0' AND test.areas_named('V', 'Side gig') = '0'
              AND test.areas_named('O', 'Side gig') = '1',
    'path: area read — deleting the private project doesn''t publish its area (its maker still sees it)');
  PERFORM test.as_user('O', format($q$UPDATE public.buckets SET deleted_at = NULL WHERE id = %L$q$, test.id('PB3')));
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_move(%L, %L, NULL)$q$, test.id('W'), test.id('PB3')));
  PERFORM test.ok(test.areas_named('M', 'Side gig') = '0',
    'path: area read — nor does moving it out of the area');

  -- Area ops: a name M can't see neither blocks M nor is joined by M.
  r := test.as_user('M', format($q$SELECT * FROM public.areas_op_create(%L, 'Side gig')$q$, test.id('W')));
  PERFORM test.ok(r LIKE 'ok%' AND test.areas_named('M', 'Side gig') = '1' AND test.areas_named('O', 'Side gig') = '2',
    'path: areas_op_create — a hidden area''s name isn''t "taken" (M gets a workspace area of its own)', r);
  r := test.as_user('M', format($q$SELECT public.projects_op_file(%L, %L, 'Vault')$q$, test.id('W'), test.id('P2')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P2')).area_id IS DISTINCT FROM v_o_vault
              AND (test.bucket('P2')).group_label = 'Vault'
              AND test.value_as('M', format($q$SELECT count(*)::text FROM public.areas WHERE id = %L$q$, v_o_vault)) = '0',
    'path: projects_op_file — filing under a hidden area''s name makes M''s own, never joins O''s', r);
  r := test.as_user('M', format($q$UPDATE public.buckets SET group_label = 'Vault' WHERE id = %L$q$, test.id('P1')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P1')).area_id = (test.bucket('P2')).area_id,
    'path: an old build''s label write — lands in the area M can see', r);
  r := test.try('M', format($q$UPDATE public.buckets SET area_id = %L WHERE id = %L$q$, v_o_vault, test.id('P1')));
  PERFORM test.ok(r LIKE '%area isn''t in this workspace%', 'path: a raw area_id write — a hidden area reads as missing', r);
  r := test.try('M', format($q$SELECT public.projects_op_move(%L, %L, %L)$q$, test.id('W'), test.id('P1'), v_o_vault));
  PERFORM test.ok(r LIKE '%area isn''t in this workspace%', 'path: projects_op_move — the same', r);

  -- Project ops on a private project.
  r := test.try('M', format($q$SELECT public.projects_op_move(%L, %L, NULL)$q$, test.id('W'), test.id('PB4')));
  PERFORM test.ok(r LIKE '%project isn''t in this workspace%', 'path: projects_op_move on a private project — missing', r);
  r := test.try('M', format($q$SELECT public.projects_op_file(%L, %L, 'Mine')$q$, test.id('W'), test.id('PB4')));
  PERFORM test.ok(r LIKE '%project isn''t in this workspace%', 'path: projects_op_file on a private project — missing', r);

  -- Sections: the ops and a task's section.
  PERFORM test.as_user('O', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Plans"}'::jsonb)$q$,
    test.id('W'), test.id('PB4')));
  SELECT s.id INTO v_section FROM public.sections s WHERE s.project_id = test.id('PB4');
  r := test.try('M', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Mine"}'::jsonb)$q$, test.id('W'), test.id('PB4')));
  PERFORM test.ok(r LIKE '%project isn''t in this workspace%', 'path: sections_op_create on a private project — missing', r);
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.sections WHERE id = %L$q$, v_section)) = '0',
    'path: section read — none');
  -- A task in the private project assigned to M: M edits the task, not the project.
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TP'), 'title', 'For M', 'bucket_id', test.id('PB4'), 'assignee_id', test.id('M'))));
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.tasks WHERE id = %L$q$, test.id('TP'))) = '1',
    'M can open the task assigned to them');
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TP'),
    jsonb_build_object('section_id', v_section)));
  PERFORM test.ok(r LIKE '%section isn''t in this task''s project%',
    'path: tasks_op_update section_id — a section of a project M can''t see reads as missing', r);
  r := test.try('M', format($q$UPDATE public.tasks SET section_id = %L WHERE id = %L$q$, v_section, test.id('TP')));
  PERFORM test.ok(r LIKE '%section isn''t in this task''s project%', 'path: a raw section_id write — the same', r);

  -- Team defaults and routing.
  r := test.try('M', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('name', 'Mine', 'default_project_id', test.id('PB4'))));
  PERFORM test.ok(r LIKE '%project isn''t in this workspace%', 'path: a team''s default project — must be one you can see', r);
  PERFORM test.as_user('O', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('OPS'), 'name', 'Ops', 'default_project_id', test.id('PB4'))));
  r := test.try('M', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'Ship it', 'team_id', test.id('OPS'))));
  PERFORM test.ok(r LIKE '%needs a project%' AND r NOT LIKE '%bucket%',
    'path: routing — a default project M can''t use reads as no default (no word about it)', r);

  -- Sessions and Waiting on of a task in the private project, not M's.
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TQ'), 'title', 'Secret', 'bucket_id', test.id('PB4'),
                       'scheduled_at', '2030-06-01T09:00:00Z', 'duration_minutes', 45)));
  PERFORM test.as_user('O', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, '{"kind": "text", "label": "Lawyer"}'::jsonb)$q$,
    test.id('W'), test.id('TQ')));
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.task_sessions WHERE task_id = %L$q$, test.id('TQ'))) = '0'
              AND test.value_as('M', format($q$SELECT count(*)::text FROM public.task_waiting WHERE task_id = %L$q$, test.id('TQ'))) = '0'
              AND (SELECT count(*) FROM public.task_sessions WHERE task_id = test.id('TQ')) = 1,
    'path: sessions and Waiting on — none of a task M can''t see');
END;
$$;
