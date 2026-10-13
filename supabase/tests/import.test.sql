-- TV-D16 · "Imported from", re-run, Undo this import; tags by name
-- (supabase/migrations/20261013220000_agents_imports_mcp.sql §4–§5).
-- specs/tasks-v3.md §12, §15, "An AI import run twice", §Assumptions #20;
-- AC2.6, AC3.6; REPLAN 35, 74.
--
-- Cast: O owns workspace W. E and F are members who work on tasks, V is a
-- viewer, X owns W2. SB is shared; PB is O's private project; PV is O's
-- project F can only view. K is E's key ("Claude Desktop", Tasks edit), KV
-- E's view-only key, KX X's key in W2.
--
-- The whole file is one transaction, so now() never moves: where a test needs
-- "later", it moves the run's own stamps back an hour first.

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
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002'),
  (test.id('PV'), test.id('W'), test.id('O'), 'O view-only', false, '0003');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PV'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('F'), 'view', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_k', md5('db-test-k'), '{"tasks": "edit"}'::jsonb, test.id('E')),
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_kv', md5('db-test-kv'), '{"tasks": "view"}'::jsonb, test.id('E')),
  (test.id('KX'), test.id('W2'), 'Outsider', 'mdo_kx', md5('db-test-kx'), '{"tasks": "edit"}'::jsonb, test.id('X'));

-- A run, as key K; its id read back by label.
CREATE FUNCTION test.begin_import(p_label text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test.as_key('K', format($q$SELECT public.imports_op_begin(%L, 'todoist', %L)$q$, test.id('W'), p_label));
  RETURN (SELECT id FROM public.imports WHERE label = p_label);
END;
$$;
CREATE FUNCTION test.create_with(p_who_key text, p_task jsonb, p_with jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_key(p_who_key, format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$,
    test.id('W'), p_task, p_with))
$$;
CREATE FUNCTION test.tags_of(p_task text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(g.name, ',' ORDER BY lower(g.name)), '')
  FROM public.tag_links l JOIN public.tags g ON g.id = l.tag_id
  WHERE l.entity_type = 'task' AND l.entity_id = test.id(p_task)
$$;
CREATE FUNCTION test.live(p_task text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.tasks WHERE id = test.id(p_task) AND deleted_at IS NULL)
$$;
-- Move a run's stamps (its tasks' trail, its projects' and sections' last
-- change) back an hour: "later" afterwards. updated_at is stamped by a
-- trigger, so those move with triggers off.
CREATE FUNCTION test.age_run(p_import uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.module_activity a SET created_at = a.created_at - interval '1 hour'
  WHERE a.entity_id IN (SELECT entity_id FROM public.import_rows WHERE import_id = p_import);
  UPDATE public.import_rows SET logged_at = logged_at - interval '1 hour' WHERE import_id = p_import;
  SET LOCAL session_replication_role = replica;
  UPDATE public.sections SET updated_at = updated_at - interval '1 hour'
  WHERE id IN (SELECT entity_id FROM public.import_rows WHERE import_id = p_import AND entity_type = 'section');
  UPDATE public.buckets SET updated_at = updated_at - interval '1 hour'
  WHERE id IN (SELECT entity_id FROM public.import_rows WHERE import_id = p_import AND entity_type = 'bucket');
  SET LOCAL session_replication_role = origin;
END;
$$;
CREATE FUNCTION test.search_as(p_who text, p_query text, p_key boolean DEFAULT false) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN p_key THEN test.as_key(p_who, format($q$SELECT * FROM public.tasks_search(%L, %L, 50)$q$, test.id('W'), p_query))
              ELSE test.as_user(p_who, format($q$SELECT * FROM public.tasks_search(%L, %L, 50)$q$, test.id('W'), p_query)) END
$$;

DO $$
DECLARE
  r text;
  v jsonb;
  i1 uuid;
  i2 uuid;
  i3 uuid;
  i4 uuid;
  i5 uuid;
  i6 uuid;
BEGIN
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TP'), 'title', 'O private', 'bucket_id', test.id('PB'))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TV'), 'title', 'View only', 'bucket_id', test.id('PV'))));

  -- ── A run: projects, sections, tasks with tags, reminders, sessions ─────
  i1 := test.begin_import('Run 1');
  PERFORM test.ok(i1 IS NOT NULL AND (SELECT user_id = test.id('E') AND key_id = test.id('K') FROM public.imports WHERE id = i1),
    'a key begins an import run, its person''s');
  r := test.as_key('K', format($q$SELECT public.imports_op_project_create(%L, %L, %L::jsonb)$q$, test.id('W'), i1,
    jsonb_build_object('id', test.id('P1'), 'name', 'Biology')));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (SELECT 1 FROM public.import_rows WHERE import_id = i1 AND entity_id = test.id('P1')),
    'the run makes its project and records it, in one go', r);
  r := test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, %L::jsonb)$q$, test.id('W'), i1,
    test.id('P1'), jsonb_build_object('id', test.id('S1'), 'name', 'Week 1')));
  PERFORM test.ok(r LIKE 'ok%' AND EXISTS (SELECT 1 FROM public.import_rows WHERE import_id = i1 AND entity_id = test.id('S1')),
    'and the section', r);
  r := test.as_key('K', format($q$SELECT public.imports_op_project_create(%L, %L, %L::jsonb)$q$, test.id('W'), i1,
    jsonb_build_object('id', test.id('SB'), 'name', 'Shared')));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.import_rows WHERE entity_id = test.id('SB')),
    'a project that was already there is never the run''s', r);
  r := test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, %L::jsonb)$q$, test.id('W'), i1,
    test.id('PB'), jsonb_build_object('id', test.id('S-PB'), 'name', 'Not mine')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%' AND NOT EXISTS (SELECT 1 FROM public.sections WHERE id = test.id('S-PB'))
              AND NOT EXISTS (SELECT 1 FROM public.import_rows WHERE entity_id = test.id('S-PB')),
    'nor add sections to a project its person can''t see; nothing is recorded', r);

  r := test.create_with('K',
    jsonb_build_object('id', test.id('A'), 'title', 'Read ch. 1', 'bucket_id', test.id('P1'), 'section_id', test.id('S1'),
      'due_on', '2030-01-07', 'imported_from', jsonb_build_object('source', 'todoist', 'key', '101')),
    jsonb_build_object('import_id', i1, 'tags', jsonb_build_array('reading', 'Week1'),
      'reminders', jsonb_build_array(jsonb_build_object('kind', 'at', 'at', '2030-01-06T09:00:00Z')),
      'sessions', jsonb_build_array(jsonb_build_object('starts_at', '2030-01-05T10:00:00Z', 'ends_at', '2030-01-05T11:00:00Z'))));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT bucket_id = test.id('P1') AND section_id = test.id('S1') AND owner_id = test.id('E')
                          AND imported_from ->> 'key' = '101' FROM public.tasks WHERE id = test.id('A'))
              AND test.tags_of('A') = 'reading,Week1'
              AND (SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('A') AND user_id = test.id('E')) = 1
              AND (SELECT count(*) FROM public.task_sessions WHERE task_id = test.id('A') AND deleted_at IS NULL) = 1
              AND (SELECT action FROM public.import_rows WHERE import_id = i1 AND entity_id = test.id('A')) = 'created',
    'one call makes the task, filed, dated, tagged, reminded and scheduled, recorded for Undo', r);
  PERFORM test.ok((SELECT actor_label FROM public.module_activity WHERE entity_id = test.id('A') AND op = 'tasks.create')
                  = 'E · via Claude Desktop'
              AND (SELECT payload -> 'added' FROM public.module_activity WHERE entity_id = test.id('A') AND op = 'tasks.tag')
                  = '["reading", "Week1"]'::jsonb,
    'every write is attributed "E · via Claude Desktop", the tags included');
  r := test.create_with('K',
    jsonb_build_object('id', test.id('B'), 'title', 'Lab report', 'bucket_id', test.id('P1'),
      'recurrence', jsonb_build_object('rrule', 'FREQ=WEEKLY;BYDAY=TU'),
      'imported_from', jsonb_build_object('source', 'todoist', 'key', '102')),
    jsonb_build_object('import_id', i1));
  PERFORM test.ok(r = 'ok 1' AND (SELECT recurrence ->> 'rrule' FROM public.tasks WHERE id = test.id('B')) = 'FREQ=WEEKLY;BYDAY=TU',
    'a repeat imports', r);
  r := test.create_with('K',
    jsonb_build_object('id', test.id('C'), 'title', 'Buy a lab coat', 'imported_from', jsonb_build_object('source', 'todoist', 'key', '103')),
    jsonb_build_object('import_id', i1));
  PERFORM test.ok(r = 'ok 1' AND (SELECT b.is_system AND b.owner_id = test.id('E') FROM public.tasks t
                                  JOIN public.buckets b ON b.id = t.bucket_id WHERE t.id = test.id('C')),
    'with no project it lands in its person''s Inbox', r);

  -- Nothing partial: a refused part refuses the whole call.
  r := test.create_with('K', jsonb_build_object('id', test.id('N1'), 'title', 'Half'),
    jsonb_build_object('import_id', i1, 'reminders', jsonb_build_array(jsonb_build_object('kind', 'never'))));
  PERFORM test.ok(r LIKE '22023%' AND NOT test.live('N1') AND NOT EXISTS (SELECT 1 FROM public.import_rows WHERE entity_id = test.id('N1')),
    'a bad reminder refuses the whole create; nothing is written', r);

  -- ── "Imported from" is per person ───────────────────────────────────────
  r := test.as_key('K', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'Again', 'imported_from', jsonb_build_object('source', 'todoist', 'key', '101'))));
  PERFORM test.ok(r LIKE '23505%already imported%', 'a plain create with a key you used is refused', r);
  r := test.as_user('F', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, '{}'::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('FA'), 'title', 'F''s own', 'imported_from', jsonb_build_object('source', 'todoist', 'key', '101'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT owner_id FROM public.tasks WHERE id = test.id('FA')) = test.id('F')
              AND (SELECT title FROM public.tasks WHERE id = test.id('A')) = 'Read ch. 1',
    'someone else''s import with the same key makes their own task and never learns of E''s', r);

  -- ── "ENG-123" is findable after import (AC3.6) ──────────────────────────
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TK'), 'title', 'Board prep', 'bucket_id', test.id('PB'),
      'imported_from', jsonb_build_object('source', 'linear', 'key', 'PRIV-9'))));
  PERFORM test.ok(test.search_as('K', '101', true) = 'ok 1' AND test.search_as('E', 'PRIV-9') = 'ok 0'
              AND test.search_as('K', 'priv-9', true) = 'ok 0' AND test.search_as('O', 'PRIV-9') = 'ok 1',
    'search finds a task by its import key, only for whoever can see it (E''s 101, not F''s; O''s private PRIV-9 for O alone)');

  -- ── Finish; a re-run updates ────────────────────────────────────────────
  r := test.as_key('K', format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W'), i1));
  v := public.imports__summary((SELECT x FROM public.imports x WHERE x.id = i1));
  PERFORM test.ok(r = 'ok 1' AND (v ->> 'tasks_created')::int = 3 AND (v ->> 'projects_created')::int = 1
              AND (v ->> 'sections_created')::int = 1 AND v ->> 'finished_at' IS NOT NULL,
    'finishing answers what the run made', v::text);
  r := test.create_with('K', jsonb_build_object('title', 'Late'), jsonb_build_object('import_id', i1));
  PERFORM test.ok(r LIKE '22023%finished%', 'a finished run takes no more rows', r);

  PERFORM test.age_run(i1);
  i2 := test.begin_import('Run 2');
  r := test.create_with('K',
    jsonb_build_object('title', 'Read chapter 1', 'bucket_id', test.id('P1'),
      'imported_from', jsonb_build_object('source', 'todoist', 'key', '101')),
    jsonb_build_object('import_id', i2, 'tags', jsonb_build_array('exam')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT count(*) FROM public.tasks WHERE imported_from ->> 'key' = '101' AND owner_id = test.id('E') AND deleted_at IS NULL) = 1
              AND (SELECT title FROM public.tasks WHERE id = test.id('A')) = 'Read chapter 1'
              AND test.tags_of('A') = 'exam,reading,Week1'
              AND (SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('A')) = 1
              AND (SELECT action FROM public.import_rows WHERE import_id = i2 AND entity_id = test.id('A')) = 'updated',
    'a second run updates by key and creates nothing new (reminders aren''t added twice)', r);
  PERFORM test.as_key('K', format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W'), i2));

  -- ── Undo this import ────────────────────────────────────────────────────
  r := test.as_key('K', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), i1));
  PERFORM test.ok(r = 'ok 1' AND test.live('A') AND NOT test.live('B') AND NOT test.live('C')
              AND EXISTS (SELECT 1 FROM public.sections WHERE id = test.id('S1') AND deleted_at IS NULL)
              AND EXISTS (SELECT 1 FROM public.buckets WHERE id = test.id('P1') AND deleted_at IS NULL)
              AND (SELECT undone_at IS NOT NULL FROM public.imports WHERE id = i1),
    'Undo removes the first run''s rows nobody touched since; the one the re-run updated stays, with its section and project', r);
  r := test.as_key('K', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), i1));
  PERFORM test.ok(r LIKE '22023%already undone%', 'a run is undone once', r);

  i3 := test.begin_import('Run 3');
  PERFORM test.as_key('K', format($q$SELECT public.imports_op_project_create(%L, %L, %L::jsonb)$q$, test.id('W'), i3,
    jsonb_build_object('id', test.id('P3'), 'name', 'Chemistry')));
  PERFORM test.create_with('K', jsonb_build_object('id', test.id('D'), 'title', 'Titration', 'bucket_id', test.id('P3')),
    jsonb_build_object('import_id', i3));
  r := test.as_key('K', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), i3));
  PERFORM test.ok(r = 'ok 1' AND NOT test.live('D')
              AND (SELECT deleted_at IS NOT NULL FROM public.buckets WHERE id = test.id('P3')),
    'a project the run made and left empty goes to Recently deleted too', r);

  i4 := test.begin_import('Run 4');
  PERFORM test.create_with('K', jsonb_build_object('id', test.id('G'), 'title', 'Ask about the exam', 'bucket_id', test.id('SB')),
    jsonb_build_object('import_id', i4));
  PERFORM test.age_run(i4);
  PERFORM test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'It''s on the 14th')$q$, test.id('W'), test.id('G')));
  r := test.as_user('E', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), i4));
  PERFORM test.ok(r = 'ok 1' AND test.live('G'), 'a task someone commented on since stays (Undo from the app works too)', r);

  -- Sections and projects keep no trail: one changed since the run stays, one
  -- left as the run made it goes, and a project with a section left stays.
  i5 := test.begin_import('Run 5');
  PERFORM test.as_key('K', format($q$SELECT public.imports_op_project_create(%L, %L, %L::jsonb)$q$, test.id('W'), i5,
    jsonb_build_object('id', test.id('P5'), 'name', 'Physics')));
  PERFORM test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, %L::jsonb)$q$, test.id('W'), i5,
    test.id('P5'), jsonb_build_object('id', test.id('S5a'), 'name', 'Optics')));
  PERFORM test.as_key('K', format($q$SELECT * FROM public.imports_op_section_create(%L, %L, %L, %L::jsonb)$q$, test.id('W'), i5,
    test.id('P5'), jsonb_build_object('id', test.id('S5b'), 'name', 'Waves')));
  PERFORM test.age_run(i5);
  PERFORM test.as_user('E', format($q$SELECT * FROM public.sections_op_update(%L, %L, '{"name": "Optics, part 1"}'::jsonb)$q$,
    test.id('W'), test.id('S5a')));
  r := test.as_key('K', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), i5));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT deleted_at IS NULL FROM public.sections WHERE id = test.id('S5a'))
              AND (SELECT deleted_at IS NOT NULL FROM public.sections WHERE id = test.id('S5b'))
              AND (SELECT deleted_at IS NULL FROM public.buckets WHERE id = test.id('P5')),
    'Undo keeps a section renamed since (and its project), and removes the one left as it was', r);
  i6 := test.begin_import('Run 6');
  PERFORM test.as_key('K', format($q$SELECT public.imports_op_project_create(%L, %L, %L::jsonb)$q$, test.id('W'), i6,
    jsonb_build_object('id', test.id('P6'), 'name', 'Maths')));
  PERFORM test.age_run(i6);
  PERFORM test.as_user('E', format($q$SELECT * FROM public.projects_op_update(%L, %L, '{"name": "Maths 2"}'::jsonb)$q$,
    test.id('W'), test.id('P6')));
  r := test.as_key('K', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), i6));
  PERFORM test.ok(r = 'ok 1' AND (SELECT deleted_at IS NULL FROM public.buckets WHERE id = test.id('P6')),
    'and a project renamed since, empty or not', r);

  -- A task Undo removed comes back from Recently deleted even after the run
  -- made its key again; the newer task keeps the key.
  r := test.create_with('K', jsonb_build_object('id', test.id('B2'), 'title', 'Lab report', 'bucket_id', test.id('P1'),
      'imported_from', jsonb_build_object('source', 'todoist', 'key', '102')), '{}'::jsonb);
  PERFORM test.ok(r = 'ok 1' AND NOT test.live('B'), 'importing B''s key again makes a new task', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": null}'::jsonb)$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(r LIKE 'ok%' AND test.live('B') AND (SELECT imported_from FROM public.tasks WHERE id = test.id('B')) IS NULL
              AND (SELECT imported_from ->> 'key' FROM public.tasks WHERE id = test.id('B2')) = '102',
    'restoring the old one works; it comes back unlinked from the source', r);

  -- ── Imports are their person's ──────────────────────────────────────────
  r := test.as_user('F', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), i2));
  v := to_jsonb(r);
  r := test.as_user('F', format($q$SELECT public.imports_op_undo(%L, %L)$q$, test.id('W'), test.id('no-such-import')));
  PERFORM test.ok(r LIKE '22023%No import with that id.%' AND to_jsonb(r) = v,
    'someone else''s import reads exactly like one that doesn''t exist', r);
  r := test.as_key('KX', format($q$SELECT public.imports_op_finish(%L, %L)$q$, test.id('W2'), i2));
  PERFORM test.ok(r LIKE '22023%No import with that id.%', 'a key from another workspace gets the same answer', r);
  r := test.as_user('F', format($q$SELECT public.imports_op_project_create(%L, %L, '{"name": "Sneaky"}'::jsonb)$q$,
    test.id('W'), i4));
  PERFORM test.ok(r LIKE '22023%No import with that id.%' AND NOT EXISTS (SELECT 1 FROM public.buckets WHERE name = 'Sneaky'),
    'nor can anyone else add to it; nothing is made', r);
  r := test.as_key('K', format($q$SELECT public.imports_op_project_create(%L, %L, '{"name": "Late project"}'::jsonb)$q$,
    test.id('W'), i2));
  PERFORM test.ok(r LIKE '22023%finished%' AND NOT EXISTS (SELECT 1 FROM public.buckets WHERE name = 'Late project'),
    'a finished run makes no project', r);

  -- A task handed into a teammate's Inbox stays its creator's to tag, remind
  -- and re-import (20a).
  r := test.create_with('K', jsonb_build_object('id', test.id('H'), 'title', 'For F', 'assignee_id', test.id('F'),
      'imported_from', jsonb_build_object('source', 'todoist', 'key', '777')),
    jsonb_build_object('tags', jsonb_build_array('handoff'),
      'reminders', jsonb_build_array(jsonb_build_object('kind', 'at', 'at', '2030-02-01T09:00:00Z'))));
  PERFORM test.ok(r = 'ok 1' AND test.tags_of('H') = 'handoff'
              AND (SELECT b.owner_id = test.id('F') AND b.is_system FROM public.tasks t JOIN public.buckets b ON b.id = t.bucket_id
                   WHERE t.id = test.id('H')),
    'a task made for a teammate lands in their Inbox with its tags and reminder', r);
  r := test.create_with('K', jsonb_build_object('title', 'For F again', 'imported_from', jsonb_build_object('source', 'todoist', 'key', '777')),
    '{}'::jsonb);
  PERFORM test.ok(r = 'ok 1' AND (SELECT title FROM public.tasks WHERE id = test.id('H')) = 'For F again',
    'and a re-run updates it there', r);
  PERFORM test.ok(test.value_as('F', 'SELECT count(*)::text FROM public.imports') = '0'
              AND test.value_as('F', 'SELECT count(*)::text FROM public.import_rows') = '0'
              AND test.value_as('O', 'SELECT count(*)::text FROM public.imports') = '0'
              AND test.value_as('E', 'SELECT count(*)::text FROM public.imports') = '6'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.import_rows WHERE import_id = %L$q$, i1)) = '5',
    'imports and their rows are readable by their person only (the workspace owner included)');

  -- ── Key scopes and gates on the new ops ─────────────────────────────────
  r := test.as_key('KV', format($q$SELECT public.imports_op_begin(%L, 'todoist')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'a view-only key can''t begin an import', r);
  r := test.as_key('KV', format($q$SELECT public.tasks_op_create_with(%L, %L::jsonb, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('NV'), 'title', 'Nope'), jsonb_build_object('tags', jsonb_build_array('nope'))));
  PERFORM test.ok(r LIKE '%edit access to Tasks%' AND NOT test.live('NV')
              AND NOT EXISTS (SELECT 1 FROM public.tags WHERE name = 'nope'),
    'nor create with tags; nothing is written', r);
  r := test.as_key('KV', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['x'], '{}')$q$, test.id('W'), test.id('A')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'nor tag', r);
  r := test.as_key('KV', format($q$SELECT * FROM public.tasks_op_update_with(%L, %L, '{"title": "Changed"}'::jsonb, '{}'::jsonb)$q$,
    test.id('W'), test.id('A')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%' AND (SELECT title FROM public.tasks WHERE id = test.id('A')) = 'Read chapter 1',
    'nor edit', r);
  r := test.as_key('KX', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['x'], '{}')$q$, test.id('W'), test.id('A')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'another workspace''s key can''t tag here', r);

  r := test.as_key('K', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['x'], '{}')$q$, test.id('W'), test.id('TP')));
  v := to_jsonb(r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['x'], '{}')$q$, test.id('W'), test.id('no-such-task')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace.%' AND to_jsonb(r) = v AND test.tags_of('TP') = '',
    'tagging a task its person can''t see reads like a missing one', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update_with(%L, %L, '{"title": "x"}'::jsonb, '{"tags_add": ["x"]}'::jsonb)$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace.%' AND (SELECT title FROM public.tasks WHERE id = test.id('TP')) = 'O private',
    'and so does editing one', r);
  r := test.as_user('F', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['x'], '{}')$q$, test.id('W'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%don''t have access to this task%' AND test.tags_of('TV') = '',
    'a task you can only view can''t be tagged', r);
  r := test.as_user('V', format($q$SELECT public.tasks_op_tag(%L, %L, ARRAY['x'], '{}')$q$, test.id('W'), test.id('A')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'nor by a workspace viewer', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_create_with(%L, %L::jsonb, '{}'::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'Into private', 'bucket_id', test.id('PB'))));
  PERFORM test.ok(r NOT LIKE 'ok%' AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE title = 'Into private'),
    'create_with can''t file into a project its person can''t see', r);

  -- Tags: add, remove, by name in any case.
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update_with(%L, %L, '{"title": "Read ch. 1 again"}'::jsonb,
    '{"tags_add": ["Exam", "revision"], "tags_remove": ["week1"]}'::jsonb)$q$, test.id('W'), test.id('A')));
  PERFORM test.ok(r = 'ok 1' AND test.tags_of('A') = 'exam,reading,revision'
              AND (SELECT count(*) FROM public.tags WHERE workspace_id = test.id('W') AND lower(name) = 'exam') = 1
              AND (SELECT title FROM public.tasks WHERE id = test.id('A')) = 'Read ch. 1 again',
    'update_with edits and tags in one call; an existing name is reused whatever its case', r);

  -- ── Erasure (§Assumptions #26) ──────────────────────────────────────────
  v := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v ->> 'imports_deleted')::integer = 6, 'erasure counts E''s import runs', v::text);
  PERFORM public.account_erase_workspace_data(test.id('E'), false);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.imports WHERE user_id = test.id('E'))
              AND NOT EXISTS (SELECT 1 FROM public.import_rows WHERE import_id IN (i1, i2, i3, i4, i5, i6)),
    'and removes them with their rows');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity WHERE actor_type = 'api_key'
                              AND actor_id IN (test.id('K'), test.id('KV')) AND actor_label IS NOT NULL)
              AND (SELECT actor_label FROM public.module_activity WHERE entity_id = test.id('A') AND op = 'tasks.create') IS NULL,
    'and their key''s trail rows no longer name them');
END;
$$;
