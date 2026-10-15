-- TV-D15 · Templates and "Duplicate project…"
-- (supabase/migrations/20261013160000_templates.sql).
-- specs/tasks-v3.md AC map: "task and project templates, duplicate" (AC4.4,
-- AC7.2): a template keeps the work and drops the run; a project duplicate
-- shifts dates and copies statuses, not done tasks; a template from a private
-- project stays private until shared. Plus: the body applies in another
-- workspace, a resend makes nothing twice, and erasure takes the templates.
--
-- Cast: O owns workspace W. E and M are members who work on tasks, A an
-- admin, V a viewer, X owns another workspace W2. P is a shared project with
-- its own statuses, sections and tasks; PB is O's private project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'A', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('A'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES
  (test.id('C1'), test.id('W'), test.id('E'), 'Acme Corp'),
  (test.id('C2'), test.id('W'), test.id('E'), 'E''s private lead');
-- Acme is the workspace's; the lead is E's alone.
DELETE FROM public.resource_grants WHERE resource_type = 'contact' AND resource_id IN (test.id('C1'), test.id('C2'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
VALUES (test.id('W'), 'contact', test.id('C1'), 'workspace', 'view', test.id('E'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit"}'::jsonb, test.id('E'));

CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
-- The live tasks of a project, by title.
CREATE FUNCTION test.ptask(p_project uuid, p_title text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE bucket_id = p_project AND title = p_title AND deleted_at IS NULL
  ORDER BY created_at, id LIMIT 1
$$;
CREATE FUNCTION test.titles(p_project uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(title, ' · ' ORDER BY title) FROM public.tasks
  WHERE bucket_id = p_project AND deleted_at IS NULL
$$;
CREATE FUNCTION test.statuses(p_project uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(category || ':' || name || CASE WHEN hidden THEN '(hidden)' ELSE '' END, ' · '
                    ORDER BY public.tasks__category_rank(category), position, created_at)
  FROM public.project_statuses WHERE project_id = p_project AND deleted_at IS NULL
$$;
CREATE FUNCTION test.sections(p_project uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(name || ' ' || coalesce(starts_on::text, '-') || '..' || coalesce(ends_on::text, '-'),
                    ' · ' ORDER BY position)
  FROM public.sections WHERE project_id = p_project AND deleted_at IS NULL
$$;
CREATE FUNCTION test.tags_of(p_task uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(g.name, ', ' ORDER BY g.name) FROM public.tag_links l
  JOIN public.tags g ON g.id = l.tag_id WHERE l.entity_type = 'task' AND l.entity_id = p_task
$$;
CREATE FUNCTION test.workspace_grant(p_project uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.resource_grants WHERE resource_type = 'bucket'
                 AND resource_id = p_project AND subject_type = 'workspace')
$$;
CREATE FUNCTION test.op(p_who text, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test.id(p_who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
END;
$$;

-- ── The source project, built through the ops as E and O ───────────────────
DO $$
DECLARE
  r text;
  v_drafting uuid;
  v_editing uuid;
BEGIN
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P'), 'name', 'Season 1', 'starts_on', '2026-11-02', 'target_on', '2026-11-30',
                       'color', 'blue')));
  PERFORM test.ok(r = 'ok 1', 'the source project is made', r);
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PB'), 'name', 'Private plans')));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');

  -- Its own statuses: Drafting (To do) and Editing (In progress, renamed).
  PERFORM test.as_user('O', format($q$SELECT public.project_statuses_op_create(%L, %L, 'todo', 'Drafting')$q$,
    test.id('W'), test.id('P')));
  SELECT id INTO v_editing FROM public.project_statuses
  WHERE project_id = test.id('P') AND category = 'in_progress' AND deleted_at IS NULL;
  PERFORM test.as_user('O', format($q$SELECT public.project_statuses_op_update(%L, %L, '{"name": "Editing"}'::jsonb)$q$,
    test.id('W'), v_editing));
  SELECT id INTO v_drafting FROM public.project_statuses
  WHERE project_id = test.id('P') AND name = 'Drafting' AND deleted_at IS NULL;

  -- Sections: a milestone (an end only) and a phase (a start and an end).
  PERFORM test.as_user('O', format($q$SELECT public.sections_op_create(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('S1'), 'name', 'Kick-off', 'ends_on', '2026-11-04')));
  PERFORM test.as_user('O', format($q$SELECT public.sections_op_create(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('S2'), 'name', 'Build', 'starts_on', '2026-11-09', 'ends_on', '2026-11-20')));

  -- Tasks: open ones in each open category, a done one, a won't-do one.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('T1'), 'title', 'Brief', 'description', 'Write the brief', 'bucket_id', test.id('P'),
    'section_id', test.id('S1'), 'due_on', '2026-11-04', 'due_time', '14:00', 'priority', 'high',
    'estimate_minutes', 60, 'assignee_id', test.id('E'), 'status_id', v_drafting, 'position', '0001')));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('T1a'), 'title', 'Brief: outline', 'bucket_id', test.id('P'), 'parent_id', test.id('T1'),
    'due_on', '2026-11-03', 'assignee_id', test.id('M'), 'position', '0001')));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('T1b'), 'title', 'Brief: research', 'bucket_id', test.id('P'), 'parent_id', test.id('T1'),
    'status', 'done', 'position', '0002')));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('T2'), 'title', 'Build it', 'bucket_id', test.id('P'), 'section_id', test.id('S2'),
    'due_on', '2026-11-12', 'status_id', v_editing, 'assignee_id', test.id('E'), 'position', '0002',
    'recurrence', jsonb_build_object('rrule', 'FREQ=WEEKLY'))));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('T3'), 'title', 'Shipped', 'bucket_id', test.id('P'), 'status', 'done', 'position', '0003')));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('T4'), 'title', 'Someday', 'bucket_id', test.id('P'), 'status', 'backlog', 'position', '0004')));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('T5'), 'title', 'Dropped', 'bucket_id', test.id('P'), 'status', 'archived', 'position', '0005')));
  PERFORM test.ok((test.task('T1')).status_id = v_drafting AND (test.task('T5')).status_category = 'wont_do'
              AND (test.task('T4')).status_category = 'backlog',
    'the source tasks sit in their statuses');

  -- A tag, a dependency, a link to a contact, a comment, a reminder.
  INSERT INTO public.tags (id, workspace_id, owner_id, name, color)
  VALUES (test.id('G1'), test.id('W'), test.id('O'), 'Deliverable', 'red');
  INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id)
  VALUES (test.id('W'), test.id('G1'), 'task', test.id('T1'));
  r := test.as_user('E', format($q$INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id)
    VALUES (%L, %L, %L)$q$, test.id('W'), test.id('T1'), test.id('T2')));
  PERFORM test.ok(r = 'ok 1', 'Brief blocks Build it', r);
  r := test.as_user('E', format($q$SELECT public.links_op_create(%L, 'task', %L, 'contact', %L)$q$,
    test.id('W'), test.id('T1'), test.id('C1')));
  PERFORM test.ok(r = 'ok 1', 'Brief links to the client', r);
  r := test.as_user('E', format($q$SELECT public.links_op_create(%L, 'task', %L, 'contact', %L)$q$,
    test.id('W'), test.id('T1'), test.id('C2')));
  PERFORM test.ok(r = 'ok 1', 'and to E''s private lead', r);
  INSERT INTO public.comments (workspace_id, entity_type, entity_id, body, created_by)
  VALUES (test.id('W'), 'task', test.id('T1'), 'First thoughts', test.id('E'));
  -- The run: a work session, a reminder, a queue place; a share with M.
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_session_add(%L, %L, '{"starts_at": "2026-11-03T09:00:00Z", "ends_at": "2026-11-03T10:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE 'ok%', 'Brief has a work session', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', '2026-11-04T08:00:00Z')$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE 'ok%', 'and a reminder', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_queue_add(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE 'ok%', 'and a place in E''s queue', r);
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('P'), 'member', test.id('M'), 'full', test.id('O'));
END;
$$;

-- ── Duplicate project… ──────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v jsonb;
  v_np uuid := test.id('NP');
  c public.tasks;
  ca public.tasks;
  c2 public.tasks;
  v_count integer;
  v_ms numeric;
  v_t timestamptz;
BEGIN
  v := test.op('E', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', v_np, 'name', 'Season 2', 'starts_on', '2027-01-04')));
  PERFORM test.ok((SELECT name FROM public.buckets WHERE id = v_np) = 'Season 2'
              AND (SELECT owner_id FROM public.buckets WHERE id = v_np) = test.id('E'),
    'the copy is a new project of the person who made it');
  PERFORM test.ok((SELECT (starts_on, target_on, color) FROM public.buckets WHERE id = v_np)
                  = ('2027-01-04'::date, '2027-02-01'::date, 'blue'::text),
    'its start is the date picked and its target moves with it (4 weeks later)');
  PERFORM test.ok(test.statuses(v_np) = test.statuses(test.id('P')),
    'the copy has the source''s statuses (names, categories, order)', test.statuses(v_np));
  PERFORM test.ok(test.sections(v_np) = 'Kick-off -..2027-01-06 · Build 2027-01-11..2027-01-22',
    'sections keep their names and shift their dates', test.sections(v_np));
  PERFORM test.ok(test.titles(v_np) = 'Brief · Brief: outline · Build it · Someday',
    'open tasks (Backlog, To do, In progress) and open subtasks are copied; done and won''t-do ones aren''t',
    test.titles(v_np));
  c := test.ptask(v_np, 'Brief');
  ca := test.ptask(v_np, 'Brief: outline');
  c2 := test.ptask(v_np, 'Build it');
  PERFORM test.ok(c.due_on = '2027-01-06' AND c.due_time = '14:00' AND ca.due_on = '2027-01-05'
              AND c2.due_on = '2027-01-14',
    'every due date shifts by the same number of days', c.due_on::text);
  PERFORM test.ok(c.description = 'Write the brief' AND c.priority = 'high' AND c.estimate_minutes = 60,
    'descriptions, priority and estimate come along');
  PERFORM test.ok(c.assignee_id = test.id('E') AND ca.assignee_id = test.id('M'),
    'people stay assigned by default');
  PERFORM test.ok(ca.parent_id = c.id, 'a subtask stays under its copied parent');
  PERFORM test.ok((SELECT name FROM public.sections WHERE id = c.section_id) = 'Kick-off'
              AND (SELECT project_id FROM public.sections WHERE id = c.section_id) = v_np,
    'a task lands in its section''s copy');
  PERFORM test.ok((SELECT name FROM public.project_statuses WHERE id = c.status_id) = 'Drafting'
              AND (SELECT project_id FROM public.project_statuses WHERE id = c.status_id) = v_np,
    'a task keeps its status name, in the copy''s own set');
  PERFORM test.ok(c2.status_category = 'todo'
              AND (SELECT name FROM public.project_statuses WHERE id = c2.status_id) = 'To do',
    'an In progress task starts again at the first To do status');
  PERFORM test.ok((test.ptask(v_np, 'Someday')).status_category = 'backlog', 'Backlog stays Backlog');
  PERFORM test.ok(c2.recurrence IS NULL, 'a repeat isn''t copied (it never fires for anyone from the copy)');
  PERFORM test.ok(test.tags_of(c.id) = 'Deliverable', 'tags come along');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.task_relations WHERE blocker_task_id = c.id AND blocked_task_id = c2.id),
    'the dependency between copied tasks comes along');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.entity_links WHERE deleted_at IS NULL
                           AND ((source_id = c.id AND target_id = test.id('C1'))
                             OR (target_id = c.id AND source_id = test.id('C1')))),
    'a link to a contact the workspace can see (a lasting thing) comes along');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.entity_links WHERE deleted_at IS NULL
                               AND test.id('C2') IN (source_id, target_id) AND c.id IN (source_id, target_id)),
    'a link to a contact only its owner sees never comes along');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.comments WHERE entity_id IN (c.id, ca.id, c2.id)),
    'comments don''t come along');
  PERFORM test.ok(c.number IS NOT NULL AND c.number <> (test.task('T1')).number
              AND EXISTS (SELECT 1 FROM public.entities WHERE entity_type = 'task' AND entity_id = c.id),
    'each copy is a real task: its own handle, in the registry');
  PERFORM test.ok(c.time_spent_seconds = 0 AND c.completed_at IS NULL,
    'nothing tracked or done comes along');
  PERFORM test.ok(jsonb_array_length(v -> 'tasks') = 4 AND (v -> 'buckets' -> 0 ->> 'id')::uuid = v_np
              AND jsonb_array_length(v -> 'statuses') = 6 AND jsonb_array_length(v -> 'sections') = 2
              AND jsonb_array_length(v -> 'relations') = 1 AND jsonb_array_length(v -> 'tagLinks') = 1,
    'the answer carries everything made, for the store', v::text);
  PERFORM test.ok(test.workspace_grant(v_np), 'a copy of a shared project is shared like any new project');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.resource_grants
                              WHERE resource_type = 'bucket' AND resource_id = v_np AND subject_type <> 'workspace'),
    'a share with a person isn''t copied (copies grant nothing)');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.task_sessions WHERE task_id IN (c.id, ca.id, c2.id))
              AND NOT EXISTS (SELECT 1 FROM public.task_reminders WHERE task_id IN (c.id, ca.id, c2.id))
              AND NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id IN (c.id, ca.id, c2.id))
              AND NOT EXISTS (SELECT 1 FROM public.task_time_entries WHERE task_id IN (c.id, ca.id, c2.id))
              AND NOT EXISTS (SELECT 1 FROM public.task_completions WHERE task_id IN (c.id, ca.id, c2.id))
              AND c.scheduled_at IS NULL,
    'no work sessions, reminders, queue places, time or completions come along');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks WHERE bucket_id = v_np AND NOT public.tasks__visible_to(id, test.id('E'))),
    'everything a duplicate makes is visible to whoever made it');

  -- A resend (the answer was lost) makes nothing twice.
  v := test.op('E', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', v_np, 'name', 'Season 2', 'starts_on', '2027-01-04')));
  SELECT count(*) INTO v_count FROM public.tasks WHERE bucket_id = v_np;
  PERFORM test.ok(v_count = 4 AND jsonb_array_length(v -> 'tasks') = 4
              AND (SELECT count(*) FROM public.buckets WHERE name = 'Season 2') = 1,
    'a resent duplicate answers with the copy it made');

  -- Without people; without dates.
  v := test.op('E', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('NP2'), 'name', 'For a team', 'keep_people', false)));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks WHERE bucket_id = test.id('NP2') AND assignee_id IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM public.resource_grants g JOIN public.tasks t ON t.id = g.resource_id
                              WHERE g.resource_type = 'task' AND t.bucket_id = test.id('NP2')),
    'without people, every copy is unassigned (never the copier) and nobody is granted a task');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks WHERE bucket_id = test.id('NP2') AND due_on IS NOT NULL)
              AND test.sections(test.id('NP2')) = 'Kick-off -..- · Build -..-'
              AND (SELECT starts_on FROM public.buckets WHERE id = test.id('NP2')) IS NULL,
    'without a start date, nothing is dated');

  -- Who may.
  r := test.try('V', format($q$SELECT public.projects_op_duplicate(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a viewer can''t duplicate', r);
  r := test.try('E', format($q$SELECT public.projects_op_duplicate(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('PB')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%', 'nobody duplicates a project they can''t see', r);
  r := test.try('X', format($q$SELECT public.projects_op_duplicate(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '%edit access%' OR r LIKE '%isn''t in this workspace%', 'nor from another workspace', r);
  r := test.try('E', format($q$SELECT public.projects_op_duplicate(%L, %L, '{}'::jsonb)$q$, test.id('W'),
    (SELECT id FROM public.buckets WHERE workspace_id = test.id('W') AND owner_id = test.id('O') AND is_system)));
  PERFORM test.ok(r LIKE '%Inbox%' OR r LIKE '%isn''t in this workspace%', 'an Inbox isn''t duplicated', r);
  r := test.try('E', format($q$SELECT public.projects_op_duplicate(%L, %L, '{"owner_id": "x"}'::jsonb)$q$,
    test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '%no field "owner_id"%', 'unknown fields are refused', r);

  -- O's private project: the copy stays private.
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('TB'), 'title', 'Secret plan', 'bucket_id', test.id('PB'))));
  v := test.op('O', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('PB'),
    jsonb_build_object('id', test.id('NPB'), 'name', 'Private plans 2')));
  PERFORM test.ok(NOT test.workspace_grant(test.id('NPB'))
              AND test.value_as('E', format($q$SELECT count(*) FROM public.buckets WHERE id = %L$q$, test.id('NPB'))) = '0',
    'a copy of a private project stays private');

  -- Bigger: 200 open tasks with subtasks copy in one go.
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
  VALUES (test.id('BIG'), test.id('W'), test.id('O'), 'Big', false);
  PERFORM public.project_statuses__seed(test.id('W'), test.id('BIG'));
  FOR i IN 1 .. 200 LOOP
    PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
      'id', test.id('big' || i), 'title', 'Deliverable ' || i, 'bucket_id', test.id('BIG'),
      'parent_id', CASE WHEN i % 4 = 0 THEN test.id('big' || (i - 1)) END,
      'due_on', '2026-12-01'::date + i, 'assignee_id', NULL)));
  END LOOP;
  v_t := clock_timestamp();
  v := test.op('O', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('BIG'),
    jsonb_build_object('id', test.id('BIG2'), 'name', 'Big 2', 'starts_on', '2027-06-01')));
  v_ms := extract(epoch FROM clock_timestamp() - v_t) * 1000;
  RAISE NOTICE 'duplicate of 200 tasks: % ms', round(v_ms);
  PERFORM test.ok((SELECT count(*) FROM public.tasks WHERE bucket_id = test.id('BIG2')) = 200
              AND (SELECT count(*) FROM public.tasks WHERE bucket_id = test.id('BIG2') AND parent_id IS NOT NULL) = 50,
    '200 tasks (50 of them subtasks) copy in one op', round(v_ms)::text || ' ms');
  PERFORM test.ok(v_ms < 6000, 'a 200-task duplicate stays well inside the statement timeout', round(v_ms)::text || ' ms');
END;
$$;

-- ── Project templates ──────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v jsonb;
  v_tp uuid := test.id('TP');
  v_np uuid := test.id('FP');
BEGIN
  -- Saving needs only to see the project; sharing needs Full access to it.
  r := test.as_user('E', format($q$SELECT public.project_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('TPE'), 'name', 'My kit')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT (owner_id, shared, shareable) FROM public.project_templates WHERE id = test.id('TPE'))
                  = (test.id('E'), false, false),
    'a member who can edit (not Full) saves a template for themselves', r);
  r := test.try('E', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), test.id('TPE')));
  PERFORM test.ok(r LIKE '%Only someone with full access to what this template was saved from can share it%',
    'and can''t share it: sharing a template shares what it copied', r);
  r := test.as_user('O', format($q$SELECT public.project_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', v_tp, 'name', 'Season kit')));
  PERFORM test.ok(r = 'ok 1', 'the project''s owner saves it as a template', r);
  PERFORM test.ok((SELECT (owner_id, shared, private_source, shareable) FROM public.project_templates WHERE id = v_tp)
                  = (test.id('O'), false, false, true),
    'it''s theirs, not shared yet, from a project the workspace can see, and they may share it');
  PERFORM test.ok((SELECT (summary ->> 'tasks')::int FROM public.project_templates WHERE id = v_tp) = 4
              AND (SELECT (summary ->> 'dated')::boolean FROM public.project_templates WHERE id = v_tp),
    'its summary counts the open tasks and says it has dates');
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.project_templates WHERE id = %L$q$, v_tp)) = '1'
              AND test.value_as('M', format($q$SELECT count(*) FROM public.project_templates WHERE id = %L$q$, v_tp)) = '0'
              AND test.value_as('X', format($q$SELECT count(*) FROM public.project_templates WHERE id = %L$q$, v_tp)) = '0',
    'nobody else sees a template until it''s shared');
  r := test.as_user('E', format($q$INSERT INTO public.project_templates (workspace_id, owner_id, name, body)
    VALUES (%L, %L, 'raw', '{}')$q$, test.id('W'), test.id('E')));
  PERFORM test.ok(r LIKE '42501%', 'templates are written through the ops only', r);
  r := test.try('M', format($q$SELECT public.project_templates_op_apply(%L, %L, '{}'::jsonb)$q$, test.id('W'), v_tp));
  PERFORM test.ok(r LIKE '%isn''t here any more%'
              AND r = test.try('M', format($q$SELECT public.project_templates_op_apply(%L, %L, '{}'::jsonb)$q$,
                                           test.id('W'), test.id('nothing'))),
    'someone else can''t use a template that isn''t shared: the same answer as one that doesn''t exist', r);

  -- Shared: M sees it and makes a project from it.
  r := test.as_user('O', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), v_tp));
  PERFORM test.ok(r = 'ok 1' AND test.value_as('M', format($q$SELECT count(*) FROM public.project_templates WHERE id = %L$q$, v_tp)) = '1',
    'once shared, the workspace sees it', r);
  v := test.op('M', format($q$SELECT public.project_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tp,
    jsonb_build_object('id', v_np, 'name', 'Season 3', 'starts_on', '2027-03-01')));
  PERFORM test.ok(test.titles(v_np) = 'Brief · Brief: outline · Build it · Someday'
              AND (test.ptask(v_np, 'Brief')).due_on = '2027-03-03'
              AND test.sections(v_np) = 'Kick-off -..2027-03-03 · Build 2027-03-08..2027-03-19'
              AND test.statuses(v_np) = test.statuses(test.id('P'))
              AND (SELECT owner_id FROM public.buckets WHERE id = v_np) = test.id('M'),
    '"New project → From template…" makes the project with its dates from the start picked');
  PERFORM test.ok(NOT ((SELECT body FROM public.project_templates WHERE id = v_tp)::text LIKE '%' || test.id('C2') || '%'),
    'a template never names a contact only its owner sees');
  -- Editing the template never changes projects made from it.
  r := test.as_user('O', format($q$SELECT public.templates_op_update(%L, 'project', %L, %L::jsonb)$q$, test.id('W'), v_tp,
    jsonb_build_object('name', 'Season kit v2', 'body',
      jsonb_set((SELECT body FROM public.project_templates WHERE id = v_tp), '{tasks,0,title}', '"Brief v2"'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT body -> 'tasks' -> 0 ->> 'title' FROM public.project_templates WHERE id = v_tp) = 'Brief v2'
              AND (test.ptask(v_np, 'Brief')).id IS NOT NULL,
    'the owner edits the template; what was made from it stays as it was', r);
  r := test.try('O', format($q$SELECT public.templates_op_update(%L, 'project', %L, %L::jsonb)$q$, test.id('W'), v_tp,
    jsonb_build_object('body',
      jsonb_set((SELECT body FROM public.project_templates WHERE id = v_tp), '{tasks,1,parent}', '7'))));
  PERFORM test.ok(r LIKE '%no parent before it%', 'a body that doesn''t hold together is refused', r);
  r := test.try('O', format($q$SELECT public.templates_op_update(%L, 'project', %L, %L::jsonb)$q$, test.id('W'), v_tp,
    jsonb_build_object('body', '{"v": 1, "kind": "task", "anchor": "due", "tasks": [{"title": "x"}]}'::jsonb)));
  PERFORM test.ok(r LIKE '%isn''t a project template%', 'a body can''t change kind', r);
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"name": "Mine now"}'::jsonb)$q$,
    test.id('W'), v_tp));
  PERFORM test.ok(r LIKE '%Only the person who made a template%', 'only its owner edits a shared template', r);
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"deleted": true}'::jsonb)$q$,
    test.id('W'), v_tp));
  PERFORM test.ok(r LIKE '%Only the person who made a template%', 'a member can''t delete someone else''s template', r);
  r := test.as_user('A', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"deleted": true}'::jsonb)$q$,
    test.id('W'), v_tp));
  PERFORM test.ok(r = 'ok 1' AND (SELECT deleted_at IS NOT NULL FROM public.project_templates WHERE id = v_tp)
              AND test.value_as('E', format($q$SELECT count(*) FROM public.project_templates WHERE id = %L$q$, v_tp)) = '0',
    'an admin can delete a shared template; it leaves every list', r);
  r := test.as_user('A', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"deleted": false}'::jsonb)$q$,
    test.id('W'), v_tp));
  PERFORM test.ok(r = 'ok 1' AND (SELECT deleted_at IS NULL FROM public.project_templates WHERE id = v_tp),
    'and undo it', r);

  -- From a private project: stays private, and a project made from it is private.
  r := test.as_user('O', format($q$SELECT public.project_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('PB'),
    jsonb_build_object('id', test.id('TPB'))));
  PERFORM test.ok((SELECT (name, shared, private_source, shareable) FROM public.project_templates WHERE id = test.id('TPB'))
                  = ('Private plans'::text, false, true, true),
    'a template from a private project stays yours and says where it came from (its owner may still share it)', r);
  v := test.op('O', format($q$SELECT public.project_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TPB'),
    jsonb_build_object('id', test.id('FPB'))));
  PERFORM test.ok(NOT test.workspace_grant(test.id('FPB')) AND test.titles(test.id('FPB')) = 'Secret plan',
    'a project made from it stays private');

  -- The body applies in another workspace: people, teams, notes and
  -- contacts that aren't there are left out; tags are matched or made by name.
  r := test.as_op('X', format($q$SELECT public.project_templates__apply_body(%L, %L::jsonb, %L::jsonb, false)$q$,
    test.id('W2'), (SELECT body FROM public.project_templates WHERE id = v_tp),
    jsonb_build_object('id', test.id('XP'), 'name', 'Team copy', 'starts_on', '2027-04-05', 'keep_people', true)));
  PERFORM test.ok(r = 'ok 1' AND (SELECT workspace_id FROM public.buckets WHERE id = test.id('XP')) = test.id('W2')
              AND test.titles(test.id('XP')) = 'Brief v2 · Brief: outline · Build it · Someday'
              AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE bucket_id = test.id('XP') AND assignee_id IS NOT NULL)
              AND test.tags_of((test.ptask(test.id('XP'), 'Brief v2')).id) = 'Deliverable'
              AND (SELECT g.workspace_id FROM public.tags g JOIN public.tag_links l ON l.tag_id = g.id
                   WHERE l.entity_id = (test.ptask(test.id('XP'), 'Brief v2')).id) = test.id('W2')
              AND NOT EXISTS (SELECT 1 FROM public.entity_links WHERE workspace_id = test.id('W2') AND relation_kind = 'references'),
    'a template''s body applies in another workspace (the "copy into N workspaces" seam)', r);
  r := test.try('E', format($q$SELECT public.project_templates__apply_body(%L, '{}'::jsonb, '{}'::jsonb, false)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '42501%', 'the raw apply is the server''s alone', r);
END;
$$;

-- ── Outsiders: what a template or a copy must never carry or show ─────────
DO $$
DECLARE
  r text;
  v jsonb;
  v_statuses text;
BEGIN
  -- A subtask of Brief that only O can see (filed in O's private project).
  r := test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('TH'), 'title', 'Secret subtask', 'description', 'top secret', 'bucket_id', test.id('PB'),
    'parent_id', test.id('T1'))));
  PERFORM test.ok(r = 'ok 1' AND test.value_as('E', format($q$SELECT count(*) FROM public.tasks WHERE id = %L$q$, test.id('TH'))) = '0',
    'Brief has a subtask E can''t see', r);
  r := test.as_user('E', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('id', test.id('TTH'))));
  PERFORM test.ok(r = 'ok 1'
              AND jsonb_array_length((SELECT body -> 'tasks' FROM public.task_templates WHERE id = test.id('TTH'))) = 3
              AND (SELECT body::text NOT LIKE '%Secret subtask%' AND body::text NOT LIKE '%top secret%'
                   FROM public.task_templates WHERE id = test.id('TTH'))
              AND NOT EXISTS (SELECT 1 FROM public.task_templates
                              WHERE id = test.id('TTH') AND test.id('TH') = ANY (source_ids)),
    'saving a task never copies a subtask the saver can''t see (title, description or id)', r);
  v := test.op('E', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('NPH'), 'name', 'Season 2b')));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks WHERE workspace_id = test.id('W')
                              AND title = 'Secret subtask' AND id <> test.id('TH'))
              AND v::text NOT LIKE '%Secret subtask%',
    'a duplicate never copies or answers with a task the copier can''t see');

  -- A resend can't point at someone else's project.
  v_statuses := test.statuses(test.id('P'));
  r := test.try('E', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('P'), 'name', 'Overwrite')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%' AND test.statuses(test.id('P')) = v_statuses
              AND (SELECT name FROM public.buckets WHERE id = test.id('P')) = 'Season 1',
    'a duplicate''s id can''t name a project that''s there (nothing changes, nothing is answered)', r);
  r := test.try('E', format($q$SELECT public.project_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TP'),
    jsonb_build_object('id', test.id('P'))));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%', 'nor an apply''s', r);
  r := test.try('E', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TTH'),
    jsonb_build_object('id', test.id('TH'))));
  PERFORM test.ok(r LIKE '%Task not found%', 'nor a task apply''s (only a task you made)', r);

  -- Full taken away: sharing, and changing a shared template, ask again.
  r := test.as_user('M', format($q$SELECT public.project_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('TPM'))));
  r := test.as_user('M', format($q$SELECT public.project_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('id', test.id('TPM2'))));
  r := test.as_user('M', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), test.id('TPM2')));
  PERFORM test.ok(r = 'ok 1', 'with Full access a member shares a template of the project', r);
  UPDATE public.resource_grants SET level = 'edit'
  WHERE resource_type = 'bucket' AND resource_id = test.id('P') AND subject_id = test.id('M');
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), test.id('TPM')));
  PERFORM test.ok(r LIKE '%Only someone with full access%', 'Full taken away: sharing asks again and says no', r);
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'project', %L, %L::jsonb)$q$, test.id('W'), test.id('TPM2'),
    jsonb_build_object('body', (SELECT body FROM public.project_templates WHERE id = test.id('TPM2')))));
  PERFORM test.ok(r LIKE '%Only someone with full access%', 'and so does changing a shared template', r);
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": false}'::jsonb)$q$,
    test.id('W'), test.id('TPM2')));
  PERFORM test.ok(r LIKE 'ok%', 'stopping sharing always works', r);
  UPDATE public.resource_grants SET level = 'full'
  WHERE resource_type = 'bucket' AND resource_id = test.id('P') AND subject_id = test.id('M');

  -- Another workspace sees nothing and changes nothing.
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*) FROM public.project_templates WHERE workspace_id = %L$q$, test.id('W'))) = '0'
              AND test.value_as('X', format($q$SELECT count(*) FROM public.task_templates WHERE workspace_id = %L$q$, test.id('W'))) = '0',
    'nobody outside the workspace reads its templates');
  r := test.try('X', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"name": "x"}'::jsonb)$q$,
    test.id('W2'), test.id('TP')));
  PERFORM test.ok(r LIKE '%isn''t here any more%', 'nor changes them from their own workspace', r);
  r := test.try('X', format($q$SELECT public.project_templates_op_apply(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%edit access%', 'nor makes projects in it', r);
  r := test.as_op('X', format($q$SELECT public.project_templates__apply_body(%L, %L::jsonb, '{"name": "In"}'::jsonb, false)$q$,
    test.id('W'), (SELECT body FROM public.project_templates WHERE id = test.id('TP'))));
  PERFORM test.ok(r LIKE '%edit access%', 'even the server''s apply checks the person may write there', r);
  r := test.as_op(NULL, format($q$SELECT public.project_templates__apply_body(%L, %L::jsonb, '{"name": "In"}'::jsonb, false)$q$,
    test.id('W'), (SELECT body FROM public.project_templates WHERE id = test.id('TP'))));
  PERFORM test.ok(r LIKE '42501%', 'and needs a person', r);

  -- Where a template came from is never readable; the helpers are the server's.
  PERFORM test.ok(test.value_as('O', 'SELECT count(source_ids) FROM public.project_templates') LIKE 'ERROR%',
    'a template''s sources aren''t readable');
  r := test.try('E', $q$SELECT public.templates__summary('{}'::jsonb)$q$);
  PERFORM test.ok(r LIKE '42501%', 'the helpers answer only the server', r);
  r := test.try('E', format($q$SELECT public.templates__workspace_sees(%L)$q$, test.id('PB')));
  PERFORM test.ok(r LIKE '42501%', 'not even about whether a project is shared', r);
END;
$$;

-- ── Task templates ─────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v jsonb;
  v_tt uuid := test.id('TT');
  v_body jsonb;
  c public.tasks;
  v_inbox uuid;
BEGIN
  r := test.as_user('E', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('id', v_tt)));
  SELECT body INTO v_body FROM public.task_templates WHERE id = v_tt;
  PERFORM test.ok(r = 'ok 1' AND (SELECT name FROM public.task_templates WHERE id = v_tt) = 'Brief'
              AND v_body ->> 'anchor' = 'due' AND jsonb_array_length(v_body -> 'tasks') = 3,
    '"Save as template" keeps the task and every subtask (a done one too)', r);
  PERFORM test.ok((v_body -> 'tasks' -> 0 ->> 'due')::int = 0 AND (v_body -> 'tasks' -> 1 ->> 'due')::int = -1
              AND v_body -> 'tasks' -> 0 ->> 'due_time' = '14:00'
              AND (v_body ->> 'project')::uuid = test.id('P') AND (v_body ->> 'section')::uuid = test.id('S1'),
    'dates are kept as offsets from its due date; its project and section are the default');
  PERFORM test.ok(NOT (v_body -> 'tasks' -> 0 ? 'status') AND NOT (v_body::text LIKE '%First thoughts%')
              AND NOT (v_body -> 'tasks' -> 0 ? 'recurrence'),
    'no done states, comments or repeats are kept');

  r := test.try('M', format($q$SELECT public.task_templates_op_apply(%L, %L, '{}'::jsonb)$q$, test.id('W'), v_tt));
  PERFORM test.ok(r LIKE '%isn''t here any more%', 'someone else can''t use a task template that isn''t shared', r);
END;
$$;

DO $$
DECLARE
  v jsonb;
  r text;
  v_tt uuid := test.id('TT');
  c public.tasks;
  v_inbox uuid;
BEGIN
  v := test.op('E', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tt,
    jsonb_build_object('id', test.id('A1'), 'date', '2027-05-10')));
  c := test.task('A1');
  PERFORM test.ok(c.title = 'Brief' AND c.bucket_id = test.id('P') AND c.section_id = test.id('S1')
              AND c.due_on = '2027-05-10' AND c.due_time = '14:00' AND c.priority = 'high'
              AND c.status_category = 'todo' AND c.assignee_id = test.id('E'),
    '"From template…" makes the task in its default project, due on the date given');
  PERFORM test.ok((SELECT string_agg(title || ' ' || due_on::text || ' ' || status_category, ' · ' ORDER BY position)
                   FROM public.tasks WHERE parent_id = c.id AND due_on IS NOT NULL) = 'Brief: outline 2027-05-09 todo'
              AND (SELECT count(*) FROM public.tasks WHERE parent_id = c.id AND status_category = 'todo') = 2,
    'its subtasks come with it, dates by offset, every one open');
  PERFORM test.ok(test.tags_of(c.id) = 'Deliverable'
              AND jsonb_array_length(v -> 'tasks') = 3 AND jsonb_array_length(v -> 'buckets') = 0,
    'tags come along; the answer carries the three tasks');
  -- A resend answers with the same tasks.
  v := test.op('E', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tt,
    jsonb_build_object('id', test.id('A1'), 'date', '2027-05-10')));
  PERFORM test.ok(jsonb_array_length(v -> 'tasks') = 3
              AND (SELECT count(*) FROM public.tasks WHERE id = test.id('A1') OR parent_id = test.id('A1')) = 3,
    'a resent apply makes nothing twice');
  -- Capture's /template: the title typed, the destination picked, no date.
  v := test.op('E', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tt,
    jsonb_build_object('id', test.id('A2'), 'title', 'Brief for Acme', 'project_id', NULL, 'assignee_id', NULL)));
  c := test.task('A2');
  SELECT id INTO v_inbox FROM public.buckets WHERE workspace_id = test.id('W') AND owner_id = test.id('E') AND is_system;
  PERFORM test.ok(c.title = 'Brief for Acme' AND c.bucket_id = v_inbox AND c.due_on IS NULL AND c.assignee_id IS NULL
              AND c.section_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE parent_id = c.id AND (due_on IS NOT NULL OR bucket_id <> v_inbox)),
    'with no project it lands in your Inbox, and with no date nothing is dated');
  r := test.try('V', format($q$SELECT public.task_templates_op_apply(%L, %L, '{}'::jsonb)$q$, test.id('W'), v_tt));
  PERFORM test.ok(r LIKE '%edit access%', 'a viewer can''t make tasks from a template', r);
  r := test.try('E', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tt,
    jsonb_build_object('project_id', test.id('PB'))));
  PERFORM test.ok(r LIKE '%can''t add tasks to that project%', 'nobody applies a template into a project they can''t edit', r);
  r := test.try('E', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tt,
    jsonb_build_object('project_id', public.tasks__inbox(test.id('W'), test.id('O')))));
  PERFORM test.ok(r LIKE '%can''t add tasks to that project%', 'nor into someone else''s Inbox', r);

  -- Through an API key (it acts as E).
  r := test.as_key('K', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tt,
    jsonb_build_object('project_id', test.id('PB'))));
  PERFORM test.ok(r LIKE '42501%can''t add tasks to that project%', 'an API key can''t apply a template into a project it can''t edit', r);
  r := test.as_key('K', format($q$SELECT public.task_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tt,
    jsonb_build_object('id', test.id('AK'), 'project_id', test.id('P'), 'date', '2027-06-01')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('AK')).bucket_id = test.id('P'), 'and can into one it can', r);
  r := test.as_key('K', format($q$SELECT public.templates_op_update(%L, 'task', %L, '{"shared": true}'::jsonb)$q$, test.id('W'), v_tt));
  PERFORM test.ok(r LIKE '%changed in the app%', 'an API key never shares or edits a template', r);

  -- Sharing a task template needs Full access to every task it copied.
  r := test.as_user('O', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('id', test.id('TTO'))));
  PERFORM test.ok((SELECT shareable FROM public.task_templates WHERE id = test.id('TTO')),
    'the project''s owner may share a task template saved from it', r);
  r := test.as_user('M', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T4'),
    jsonb_build_object('id', test.id('TTM'))));
  UPDATE public.resource_grants SET level = 'edit'
  WHERE resource_type = 'bucket' AND resource_id = test.id('P') AND subject_id = test.id('M');
  r := test.as_user('M', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T4'),
    jsonb_build_object('id', test.id('TTM2'))));
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'task', %L, '{"shared": true}'::jsonb)$q$, test.id('W'), test.id('TTM2')));
  PERFORM test.ok((SELECT shareable FROM public.task_templates WHERE id = test.id('TTM'))
              AND NOT (SELECT shareable FROM public.task_templates WHERE id = test.id('TTM2'))
              AND r LIKE '%Only someone with full access%',
    'with Full access to the project a member may share it; with edit access they can''t', r);
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'task', %L, '{"name": "x"}'::jsonb)$q$, test.id('W'), v_tt));
  PERFORM test.ok(r LIKE '%isn''t here any more%'
              AND r = test.try('M', format($q$SELECT public.templates_op_update(%L, 'task', %L, '{"name": "x"}'::jsonb)$q$,
                                           test.id('W'), test.id('nothing'))),
    'someone else''s private template answers like one that doesn''t exist', r);

  -- A task with no due date counts from the day it's saved.
  PERFORM test.as_user('E', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T4'),
    jsonb_build_object('id', test.id('TT4'), 'name', 'Someday kit')));
  PERFORM test.ok((SELECT body ->> 'anchor' FROM public.task_templates WHERE id = test.id('TT4')) = 'start'
              AND (SELECT name FROM public.task_templates WHERE id = test.id('TT4')) = 'Someday kit',
    'an undated task counts from the start');

  -- From O's private project: stays O's.
  r := test.as_user('O', format($q$SELECT public.task_templates_op_save(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TB'),
    jsonb_build_object('id', test.id('TTB'))));
  PERFORM test.ok((SELECT (shared, private_source) FROM public.task_templates WHERE id = test.id('TTB')) = (false, true),
    'a task template from a private project stays private and says so', r);
  r := test.try('E', format($q$SELECT public.task_templates_op_save(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('TB')));
  PERFORM test.ok(r LIKE '%Task not found%', 'nobody saves a task they can''t see', r);

  -- Erasure takes a person's templates (their own workspace's go with it).
  v := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v ->> 'templates_deleted')::int = 4, 'erasure counts E''s templates', v ->> 'templates_deleted');
  PERFORM test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('E')), false);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.task_templates WHERE owner_id = test.id('E'))
              AND NOT EXISTS (SELECT 1 FROM public.project_templates WHERE owner_id = test.id('E'))
              AND EXISTS (SELECT 1 FROM public.task_templates WHERE owner_id = test.id('O')),
    'and removes them, and nobody else''s');
END;
$$;
