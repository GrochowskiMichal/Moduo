-- TV-D16 follow-up · the sibling ops refuse what their plain ops refuse
-- (supabase/migrations/20261013220000_agents_imports_mcp.sql and
-- 20261013268000_agents_privacy_fix.sql). tasks_op_create_with and
-- tasks_op_update_with make their core write through tasks_op_create and
-- tasks_op_update; imports_op_project_create / _section_create through
-- projects_op_create / sections_op_create; tasks_op_tag mirrors the app's tag
-- writes (tag_links under RLS). For each refusal the plain path makes, the
-- sibling makes the same one, and writes nothing (no tag, no reminder, no
-- work session, no import row).
--
-- Cast: O owns workspace W; E and F are members; X owns W2. E edits PA and
-- PB (F edits PA too), views PV, edits PZ (archived); PE is E's own project;
-- PP is O's private project. K is E's key (Tasks edit), KV E's view-only
-- key. SB1 is a section of PB; TW2 a team of W2; W2TAG a tag of W2.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('PA'), test.id('W'), test.id('O'), 'A', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'B', false, '0002'),
  (test.id('PV'), test.id('W'), test.id('O'), 'View only', false, '0003'),
  (test.id('PZ'), test.id('W'), test.id('O'), 'Archived', false, '0004'),
  (test.id('PE'), test.id('W'), test.id('E'), 'E alone', false, '0005'),
  (test.id('PP'), test.id('W'), test.id('O'), 'O private', false, '0006'),
  (test.id('P2'), test.id('W2'), test.id('X'), 'Elsewhere', false, '0001');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket'
  AND resource_id IN (test.id('PA'), test.id('PB'), test.id('PV'), test.id('PZ'), test.id('PE'), test.id('PP'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'bucket', test.id('PA'), 'member', test.id('E'), 'edit', test.id('O')),
  (test.id('W'), 'bucket', test.id('PA'), 'member', test.id('F'), 'edit', test.id('O')),
  (test.id('W'), 'bucket', test.id('PB'), 'member', test.id('E'), 'edit', test.id('O')),
  (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('E'), 'view', test.id('O')),
  (test.id('W'), 'bucket', test.id('PZ'), 'member', test.id('E'), 'edit', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_k', md5('db-test-k'), '{"tasks": "edit"}'::jsonb, test.id('E')),
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_kv', md5('db-test-kv'), '{"tasks": "view"}'::jsonb, test.id('E'));
INSERT INTO public.teams (id, workspace_id, name, mark) VALUES (test.id('TW2'), test.id('W2'), 'Theirs', 'TH');
INSERT INTO public.tags (id, workspace_id, owner_id, name) VALUES
  (test.id('W2TAG'), test.id('W2'), test.id('X'), 'Outsider tag'),
  (test.id('WTAG'), test.id('W'), test.id('O'), 'ours');

-- Nothing the sibling's extras would write.
CREATE FUNCTION test.extras_written() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.tags WHERE name LIKE 'parity-%')
      OR EXISTS (SELECT 1 FROM public.task_reminders r JOIN public.tasks t ON t.id = r.task_id WHERE t.title LIKE 'Parity %')
      OR EXISTS (SELECT 1 FROM public.import_rows)
$$;
-- A create refused alike: the plain op and the sibling (with tags, a
-- reminder and an import run), as the same key.
CREATE FUNCTION test.create_parity(p_key text, p_task jsonb, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plain text;
  v_sibling text;
  v_run uuid := (SELECT id FROM public.imports WHERE label = 'Parity run');
  v_before public.tasks := (SELECT x FROM public.tasks x WHERE x.id = public.tasks__try_uuid(p_task ->> 'id'));
BEGIN
  v_plain := test.as_key(p_key, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), p_task));
  v_sibling := test.as_key(p_key, format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'), p_task,
    jsonb_build_object('import_id', v_run, 'tags', jsonb_build_array('parity-tag'),
      'reminders', jsonb_build_array(jsonb_build_object('kind', 'at', 'at', '2030-01-01T09:00:00Z')))));
  PERFORM test.ok(v_plain NOT LIKE 'ok%' AND v_sibling = v_plain
              AND (SELECT x FROM public.tasks x WHERE x.id = public.tasks__try_uuid(p_task ->> 'id')) IS NOT DISTINCT FROM v_before
              AND NOT test.extras_written(),
    'create refused alike: ' || p_label, v_plain || ' | ' || v_sibling);
END;
$$;
CREATE FUNCTION test.update_parity(p_key text, p_task text, p_patch jsonb, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plain text;
  v_sibling text;
  v_before public.tasks := (SELECT x FROM public.tasks x WHERE x.id = test.id(p_task));
BEGIN
  v_plain := test.as_key(p_key, format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id(p_task), p_patch));
  v_sibling := test.as_key(p_key, format($q$SELECT * FROM public.tasks_op_update_with(%L, %L, %L::jsonb, %L::jsonb)$q$,
    test.id('W'), test.id(p_task), p_patch, '{"tags_add": ["parity-tag"]}'));
  PERFORM test.ok(v_plain NOT LIKE 'ok%' AND v_sibling = v_plain
              AND (SELECT x FROM public.tasks x WHERE x.id = test.id(p_task)) IS NOT DISTINCT FROM v_before
              AND NOT test.extras_written(),
    'update refused alike: ' || p_label, v_plain || ' | ' || v_sibling);
END;
$$;
CREATE FUNCTION test.make(p_who text, p_name text, p_project text) RETURNS void LANGUAGE sql AS $$
  SELECT test.ok(test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project)))) = 'ok 1',
    format('%s makes %s', p_who, p_name))
$$;

DO $$
DECLARE
  r text;
  r2 text;
  v jsonb;
  v_status uuid;
  v_run uuid;
BEGIN
  PERFORM test.make('E', 'TA', 'PA');
  PERFORM test.make('F', 'TF', 'PA');
  PERFORM test.make('O', 'TV', 'PV');
  PERFORM test.make('O', 'TP', 'PP');
  PERFORM test.as_user('O', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "B1"}'::jsonb)$q$,
    test.id('W'), test.id('PB')));
  UPDATE public.sections SET id = test.id('SB1') WHERE project_id = test.id('PB');
  v_status := (SELECT id FROM public.project_statuses WHERE project_id = test.id('PB') AND deleted_at IS NULL
               ORDER BY position LIMIT 1);
  UPDATE public.buckets SET archived_at = now() WHERE id = test.id('PZ');
  PERFORM test.as_key('K', format($q$SELECT public.imports_op_begin(%L, 'todoist', 'Parity run')$q$, test.id('W')));
  v_run := (SELECT id FROM public.imports WHERE label = 'Parity run');
  PERFORM test.ok(v_run IS NOT NULL AND v_status IS NOT NULL
              AND EXISTS (SELECT 1 FROM public.sections WHERE id = test.id('SB1'))
              AND (SELECT archived_at IS NOT NULL FROM public.buckets WHERE id = test.id('PZ')),
    'the cast is set');

  -- ── Create: tasks_op_create vs tasks_op_create_with ─────────────────────
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C1'), 'title', 'Parity 1', 'bucket_id', test.id('PV')),
    'a project its person can only view');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C2'), 'title', 'Parity 2', 'bucket_id', test.id('PA'),
    'section_id', test.id('SB1')), 'a section of another project');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C3'), 'title', 'Parity 3', 'bucket_id', test.id('PA'),
    'status_id', v_status), 'a status of another project''s set');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C4'), 'title', 'Parity 4', 'bucket_id', test.id('PA'),
    'team_id', test.id('TW2')), 'a team of another workspace');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C5'), 'title', 'Parity 5', 'bucket_id', test.id('PA'),
    'assignee_id', test.id('X')), 'an assignee who isn''t in the workspace');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C7'), 'title', 'Parity 7', 'bucket_id', test.id('PA'),
    'recurrence', jsonb_build_object('rrule', 'FREQ=DAILY;COUNT=5000')), 'a repeat out of bounds');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C8'), 'title', 'Parity 8', 'bucket_id', test.id('PP')),
    'a project its person can''t see');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C9'), 'title', 'Parity 9',
    'bucket_id', public.tasks__inbox(test.id('W'), test.id('F'))), 'someone else''s Inbox');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('C10'), 'title', 'Parity 10', 'bucket_id', test.id('P2')),
    'another workspace''s project');
  PERFORM test.create_parity('KV', jsonb_build_object('id', test.id('C11'), 'title', 'Parity 11', 'bucket_id', test.id('PA')),
    'a view-only key');
  PERFORM test.create_parity('K', jsonb_build_object('id', test.id('TP'), 'title', 'Parity 12'),
    'an id of a task its person can''t see');

  -- ── Update: tasks_op_update vs tasks_op_update_with ─────────────────────
  PERFORM test.update_parity('K', 'TV', '{"title": "Parity x"}', 'a task its person can only view');
  PERFORM test.update_parity('K', 'TA', jsonb_build_object('section_id', test.id('SB1')), 'a section of another project');
  PERFORM test.update_parity('K', 'TA', jsonb_build_object('status_id', v_status), 'a status of another project''s set');
  PERFORM test.update_parity('K', 'TA', jsonb_build_object('team_id', test.id('TW2')), 'a team of another workspace');
  PERFORM test.update_parity('K', 'TA', jsonb_build_object('assignee_id', test.id('X')), 'an assignee who isn''t in the workspace');
  PERFORM test.update_parity('K', 'TA', jsonb_build_object('bucket_id', test.id('PV')), 'a move into a project its person can only view');
  PERFORM test.update_parity('K', 'TA', jsonb_build_object('recurrence', jsonb_build_object('rrule', 'FREQ=DAILY;COUNT=5000')),
    'a repeat out of bounds');
  PERFORM test.update_parity('K', 'TP', '{"title": "Parity x"}', 'a task its person can''t see');
  PERFORM test.update_parity('KV', 'TA', '{"title": "Parity x"}', 'a view-only key');

  -- ── Tags: tasks_op_tag vs the app's tag writes (tag_links under RLS) ────
  r := test.as_user('E', format($q$INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id) VALUES (%L, %L, 'task', %L)$q$,
    test.id('W'), test.id('WTAG'), test.id('TV')));
  r2 := test.as_user('E', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['ours'], '{}')$q$, test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%' AND r2 LIKE '42501%'
              AND NOT EXISTS (SELECT 1 FROM public.tag_links WHERE entity_id = test.id('TV')),
    'tagging a task its person can only view is refused both ways', r || ' | ' || r2);
  r := test.as_user('E', format($q$INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id) VALUES (%L, %L, 'task', %L)$q$,
    test.id('W'), test.id('WTAG'), test.id('TP')));
  r2 := test.as_user('E', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['ours'], '{}')$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r NOT LIKE 'ok%' AND r2 LIKE '%Task not found in this workspace.%'
              AND NOT EXISTS (SELECT 1 FROM public.tag_links WHERE entity_id = test.id('TP')),
    'and a task its person can''t see, both ways', r || ' | ' || r2);
  r := test.as_user('E', format($q$INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id) VALUES (%L, %L, 'task', %L)$q$,
    test.id('W'), test.id('W2TAG'), test.id('TA')));
  r2 := test.as_key('K', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['Outsider tag'], '{}')$q$, test.id('W'), test.id('TA')));
  PERFORM test.ok(r LIKE '42501%' AND NOT EXISTS (SELECT 1 FROM public.tag_links WHERE tag_id = test.id('W2TAG')),
    'a tag of another workspace is never linked, either way (the op makes the name in this workspace instead)', r || ' | ' || r2);
  r := test.as_key('KV', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['parity-tag'], '{}')$q$, test.id('W'), test.id('TA')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%' AND NOT test.extras_written(), 'a view-only key can''t tag', r);

  -- ── A run's projects and sections: the plain ops vs the run's ───────────
  r := test.as_key('KV', format($q$SELECT public.projects_op_create(%L, '{"name": "Parity P"}'::jsonb)$q$, test.id('W')));
  r2 := test.as_key('KV', format($q$SELECT public.imports_op_project_create(%L, %L, '{"name": "Parity P"}'::jsonb)$q$, test.id('W'), v_run));
  PERFORM test.ok(r NOT LIKE 'ok%' AND r2 = r AND NOT EXISTS (SELECT 1 FROM public.buckets WHERE name = 'Parity P'),
    'a project: a view-only key is refused alike', r || ' | ' || r2);
  r := test.as_key('K', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P2'), 'name', 'Parity P')));
  r2 := test.as_key('K', format($q$SELECT public.imports_op_project_create(%L, %L, %L::jsonb)$q$, test.id('W'), v_run,
    jsonb_build_object('id', test.id('P2'), 'name', 'Parity P')));
  PERFORM test.ok(r NOT LIKE 'ok%' AND r2 = r AND NOT test.extras_written(),
    'a project: another workspace''s id is refused alike', r || ' | ' || r2);
  r := test.as_key('K', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Parity S"}'::jsonb)$q$, test.id('W'), test.id('PV')));
  r2 := test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, '{"name": "Parity S"}'::jsonb)$q$,
    test.id('W'), v_run, test.id('PV')));
  PERFORM test.ok(r NOT LIKE 'ok%' AND r2 = r AND NOT EXISTS (SELECT 1 FROM public.sections WHERE name = 'Parity S'),
    'a section: a project its person can only view is refused alike', r || ' | ' || r2);
  r := test.as_key('K', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Parity S"}'::jsonb)$q$, test.id('W'), test.id('PP')));
  r2 := test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, '{"name": "Parity S"}'::jsonb)$q$,
    test.id('W'), v_run, test.id('PP')));
  PERFORM test.ok(r NOT LIKE 'ok%' AND r2 = r AND NOT EXISTS (SELECT 1 FROM public.sections WHERE name = 'Parity S'),
    'a section: a project its person can''t see is refused alike', r || ' | ' || r2);
  r := test.as_key('K', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Parity S"}'::jsonb)$q$,
    test.id('W'), public.tasks__inbox(test.id('W'), test.id('E'))));
  r2 := test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, '{"name": "Parity S"}'::jsonb)$q$,
    test.id('W'), v_run, public.tasks__inbox(test.id('W'), test.id('E'))));
  PERFORM test.ok(r NOT LIKE 'ok%' AND r2 = r AND NOT EXISTS (SELECT 1 FROM public.sections WHERE name = 'Parity S'),
    'a section: the Inbox is refused alike', r || ' | ' || r2);
  r := test.as_key('K', format($q$SELECT * FROM public.sections_op_create(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('PA'),
    jsonb_build_object('id', test.id('SB1'), 'name', 'Parity S')));
  r2 := test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, %L::jsonb)$q$,
    test.id('W'), v_run, test.id('PA'), jsonb_build_object('id', test.id('SB1'), 'name', 'Parity S')));
  PERFORM test.ok(r NOT LIKE 'ok%' AND r2 = r AND NOT test.extras_written(),
    'a section: another project''s section id is refused alike', r || ' | ' || r2);

  -- ── A create with an id that's already there writes nothing more ────────
  r := test.as_key('K', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TF'), 'title', 'Parity resend')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT title FROM public.tasks WHERE id = test.id('TF')) = 'TF',
    'the plain op answers an id that''s there with that task, unchanged', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TF'), 'title', 'Parity resend'),
    jsonb_build_object('import_id', v_run, 'tags', jsonb_build_array('parity-tag'),
      'reminders', jsonb_build_array(jsonb_build_object('kind', 'at', 'at', '2030-01-01T09:00:00Z')),
      'sessions', jsonb_build_array(jsonb_build_object('starts_at', '2030-01-05T10:00:00Z', 'ends_at', '2030-01-05T11:00:00Z')))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT title FROM public.tasks WHERE id = test.id('TF')) = 'TF'
              AND NOT test.extras_written()
              AND NOT EXISTS (SELECT 1 FROM public.task_reminders WHERE task_id = test.id('TF'))
              AND NOT EXISTS (SELECT 1 FROM public.task_sessions WHERE task_id = test.id('TF') AND deleted_at IS NULL)
              AND NOT EXISTS (SELECT 1 FROM public.import_rows WHERE entity_id = test.id('TF')),
    'the sibling does the same: no tags, reminder or work session, and a teammate''s task never becomes the run''s (Undo can''t touch it)', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TN'), 'title', 'Run made', 'bucket_id', test.id('PA')),
    jsonb_build_object('import_id', v_run, 'reminders', jsonb_build_array(jsonb_build_object('kind', 'at', 'at', '2030-01-01T09:00:00Z')))));
  r2 := test.as_key('K', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TN'), 'title', 'Run made', 'bucket_id', test.id('PA')),
    jsonb_build_object('import_id', v_run, 'reminders', jsonb_build_array(jsonb_build_object('kind', 'at', 'at', '2030-01-01T09:00:00Z')))));
  PERFORM test.ok(r = 'ok 1' AND r2 = 'ok 1'
              AND (SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('TN')) = 1
              AND (SELECT count(*) FROM public.import_rows WHERE entity_id = test.id('TN')) = 1,
    'a resend of the run''s own create stays the run''s, with nothing added twice', r || ' | ' || r2);

  -- ── Allowed alike: an archived project takes new and moved tasks ────────
  r := test.as_key('K', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('C6a'), 'title', 'Into archived', 'bucket_id', test.id('PZ'))));
  r2 := test.as_key('K', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, '{}'::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('C6b'), 'title', 'Into archived', 'bucket_id', test.id('PZ'))));
  PERFORM test.ok(r = 'ok 1' AND r2 = r
              AND (SELECT count(*) FROM public.tasks WHERE id IN (test.id('C6a'), test.id('C6b')) AND bucket_id = test.id('PZ')) = 2,
    'the plain op files a new task into an archived project, and so does the sibling', r || ' | ' || r2);
  PERFORM test.make('E', 'TB', 'PA');
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TA'),
    jsonb_build_object('bucket_id', test.id('PZ'))));
  r2 := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update_with(%L, %L, %L::jsonb, '{}'::jsonb)$q$, test.id('W'), test.id('TB'),
    jsonb_build_object('bucket_id', test.id('PZ'))));
  PERFORM test.ok(r = 'ok 1' AND r2 = r
              AND (SELECT count(*) FROM public.tasks WHERE id IN (test.id('TA'), test.id('TB')) AND bucket_id = test.id('PZ')) = 2,
    'and a move into one, alike', r || ' | ' || r2);
END;
$$;
