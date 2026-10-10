-- TV-D8 · Server ops, registry, handles, one dependency store
-- (supabase/migrations/20261010160000_tasks_ops_registry_handles.sql).
-- specs/tasks-v3.md AC map: "create registers, numbers and logs" (AC12.1,
-- AC1.1, AC3.1) and "a blocks link blocks" (AC1.14).
--
-- Cast: O owns workspace W ("Moduo Labs" → key ML). E is a member who works on
-- tasks, V a viewer. SB is a shared project, PB O's private one. K is an API
-- key E made with Tasks and Links at Edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('SB2'), test.id('W'), test.id('O'), 'Shared two', false),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit", "links": "edit"}'::jsonb, test.id('E'));

DO $$
DECLARE
  r text;
  v_t1 public.tasks;
  v_ws public.workspaces;
  v_n bigint;
  v_e public.entities;
BEGIN
  -- ── The workspace gets a key and a counter ────────────────────────────────
  SELECT * INTO v_ws FROM public.workspaces WHERE id = test.id('W');
  PERFORM test.ok(v_ws.task_key = 'ML' AND v_ws.task_number_last = 0,
    'a new workspace gets its key from its name and an empty counter', v_ws.task_key);

  -- ── Create registers, numbers and logs (AC12.1, AC1.1, AC3.1) ─────────────
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Logo concepts", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('T1')::text), to_json(test.id('SB')::text)));
  SELECT * INTO v_t1 FROM public.tasks WHERE id = test.id('T1');
  PERFORM test.ok(r = 'ok 1' AND v_t1.number = 1, 'create gives the first task number 1', r);
  PERFORM test.ok(v_t1.owner_id = test.id('E') AND v_t1.assignee_id = test.id('E'),
    'the creator is the caller, and an unchosen assignee is the creator');
  SELECT * INTO v_e FROM public.entities
  WHERE workspace_id = test.id('W') AND entity_type = 'task' AND entity_id = test.id('T1');
  PERFORM test.ok(v_e.label = 'Logo concepts' AND v_e.handle = 'ML-1' AND v_e.deleted_at IS NULL,
    'create registers the task for search and @ at once, with its handle', coalesce(v_e.label, '∅') || ' ' || coalesce(v_e.handle, '∅'));
  PERFORM test.ok(test.value_as('E', format(
      $q$SELECT count(*) FROM public.entities WHERE workspace_id = %L AND deleted_at IS NULL AND label ILIKE '%%logo%%'$q$,
      test.id('W'))) = '1',
    'search (the registry, as the member reads it) finds the new task by its title');
  PERFORM test.ok(test.value_as('E', format(
      $q$SELECT entity_id::text FROM public.entities WHERE workspace_id = %L AND deleted_at IS NULL AND handle ILIKE 'ml-1'$q$,
      test.id('W'))) = test.id('T1')::text,
    'search finds a task by its handle (AC3.1)');
  PERFORM test.ok((SELECT count(*) FROM public.module_activity
                   WHERE entity_id = test.id('T1') AND op = 'tasks.create') = 1
              AND (SELECT count(*) FROM public.module_activity WHERE entity_id = test.id('T1')) = 1,
    'create writes exactly one activity row');
  PERFORM test.ok((SELECT position FROM public.tasks WHERE id = test.id('T1')) = '000000mh34',
    'a create without a position goes to the end of the project');

  -- A resend of the same create answers with the task and burns nothing.
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Logo concepts", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('T1')::text), to_json(test.id('SB')::text)));
  PERFORM test.ok(r = 'ok 1' AND (SELECT task_number_last FROM public.workspaces WHERE id = test.id('W')) = 1,
    'a resent create returns the same task and burns no number', r);

  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"title": "Unassigned", "bucket_id": %s, "assignee_id": null}'::jsonb)$q$,
    test.id('W'), to_json(test.id('SB')::text)));
  PERFORM test.ok(r = 'ok 1' AND (SELECT assignee_id FROM public.tasks WHERE title = 'Unassigned' AND workspace_id = test.id('W')) IS NULL,
    'assignee null creates an unassigned task', r);

  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"title": "Captured"}'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (
      SELECT 1 FROM public.tasks t JOIN public.buckets b ON b.id = t.bucket_id
      WHERE t.title = 'Captured' AND b.is_system AND b.owner_id = test.id('E')),
    'a create with no project lands in the creator''s Inbox', r);

  r := test.try('V', format($q$SELECT public.tasks_op_create(%L, '{"title": "Nope", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('SB')::text)));
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'a viewer can''t create', r);
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, '{"title": "x", "titel": "typo"}'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%no field "titel"%', 'an unknown field is refused, not dropped', r);
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, '{"title": "x", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('PB')::text)));
  PERFORM test.ok(r LIKE '42501%', 'a member can''t create in a private project they can''t edit', r);
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, '{"title": "x", "status": "someday"}'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%Unknown task status%', 'an unknown status is refused', r);

  -- ── Rename re-registers ───────────────────────────────────────────────────
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"title": "Logo concepts v2"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT label FROM public.entities WHERE entity_id = test.id('T1')) = 'Logo concepts v2',
    'a rename through the op updates the registry', r);
  PERFORM test.ok((SELECT payload -> 'fields' FROM public.module_activity
                   WHERE entity_id = test.id('T1') AND op = 'tasks.update') = '["title"]'::jsonb,
    'the rename is one trail row naming the field');

  -- Description edits in one stretch make one trail row.
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"description": "a"}'::jsonb)$q$, test.id('W'), test.id('T1')));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"description": "ab"}'::jsonb)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok((SELECT count(*) FROM public.module_activity
                   WHERE entity_id = test.id('T1') AND op = 'tasks.update'
                     AND payload -> 'fields' = '["description"]'::jsonb) = 1
              AND (SELECT description FROM public.tasks WHERE id = test.id('T1')) = 'ab',
    'typing in the description logs one line per stretch');

  r := test.try('V', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"title": "x"}'::jsonb)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'a viewer can''t edit', r);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"number": 99}'::jsonb)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '%no field "number"%', 'the number is not an editable field', r);

  -- Status through the field op goes through the status path.
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status": "in_progress", "priority": "high"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT status || '/' || priority FROM public.tasks WHERE id = test.id('T1')) = 'in_progress/high'
              AND EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.id('T1') AND op = 'tasks.set_status'),
    'a status in a field patch goes through the status op and its trail', r);

  -- ── Old builds' raw writes are numbered and registered ───────────────────
  r := test.as_user('E', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title, number) VALUES (%L, %L, %L, 'Old build task', 1)$q$,
    test.id('TR'), test.id('W'), test.id('SB')));
  SELECT number INTO v_n FROM public.tasks WHERE id = test.id('TR');
  PERFORM test.ok(r = 'ok 1' AND v_n = 4,
    'a raw insert from an old build gets the next number, whatever it sent', r || ' n=' || coalesce(v_n::text, '∅'));
  PERFORM test.ok((SELECT handle FROM public.entities WHERE entity_id = test.id('TR')) = 'ML-4',
    'a raw insert is registered too');
  -- An old build saves whole rows with upsert: an existing row keeps its number.
  r := test.as_user('E', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title) VALUES (%L, %L, %L, 'Old build rename')
                                  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title$q$,
    test.id('TR'), test.id('W'), test.id('SB')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT number FROM public.tasks WHERE id = test.id('TR')) = 4
              AND (SELECT task_number_last FROM public.workspaces WHERE id = test.id('W')) = 4,
    'an old build''s whole-row upsert of an existing task burns no number', r);
  PERFORM test.ok((SELECT label FROM public.entities WHERE entity_id = test.id('TR')) = 'Old build rename',
    'an old build''s rename re-registers the task');
  r := test.as_user('E', format($q$UPDATE public.tasks SET number = 42 WHERE id = %L$q$, test.id('TR')));
  PERFORM test.ok((SELECT number FROM public.tasks WHERE id = test.id('TR')) = 4, 'a number never changes', r);

  -- The counter only moves through the ops, even for the owner.
  PERFORM test.as_user('O', format($q$UPDATE public.workspaces SET task_number_last = 0 WHERE id = %L$q$, test.id('W')));
  PERFORM test.ok((SELECT task_number_last FROM public.workspaces WHERE id = test.id('W')) = 4,
    'nobody can wind the counter back');

  -- ── Delete, restore, never reused ─────────────────────────────────────────
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Sub A", "bucket_id": %s, "parent_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('S1')::text), to_json(test.id('SB')::text), to_json(test.id('T1')::text)));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Sub B", "bucket_id": %s, "parent_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('S2')::text), to_json(test.id('SB')::text), to_json(test.id('T1')::text)));

  -- Moving a parent takes its subtasks, in one op (TV-P0's note).
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"bucket_id": %s}'::jsonb)$q$,
    test.id('W'), test.id('T1'), to_json(test.id('SB2')::text)));
  PERFORM test.ok(r = 'ok 3' AND (SELECT count(*) FROM public.tasks WHERE parent_id = test.id('T1') AND bucket_id = test.id('SB2')) = 2,
    'moving a task moves its subtasks in the same op and answers with all three rows', r);

  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 3'
              AND (SELECT deleted_at IS NOT NULL FROM public.tasks WHERE id = test.id('T1'))
              AND (SELECT count(*) FROM public.tasks WHERE id IN (test.id('S1'), test.id('S2')) AND parent_id IS NULL) = 2,
    'delete through the op promotes the subtasks', r);
  PERFORM test.ok((SELECT deleted_at IS NOT NULL FROM public.entities WHERE entity_id = test.id('T1')),
    'a deleted task leaves search (tombstoned)');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*) FROM public.entities WHERE workspace_id = %L AND deleted_at IS NULL AND handle = 'ML-1'$q$,
    test.id('W'))) = '0', 'a deleted task''s handle no longer finds it');

  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": null}'::jsonb)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT deleted_at IS NULL AND number = 1 FROM public.tasks WHERE id = test.id('T1'))
              AND (SELECT deleted_at IS NULL FROM public.entities WHERE entity_id = test.id('T1')),
    'restore brings the task and its registry entry back, with its number', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.id('T1') AND op = 'tasks.delete')
              AND EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.id('T1') AND op = 'tasks.restore'),
    'delete and restore are in the trail');

  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$, test.id('W'), test.id('S2')));
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "After a delete", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('T9')::text), to_json(test.id('SB')::text)));
  PERFORM test.ok((SELECT number FROM public.tasks WHERE id = test.id('T9')) = 7,
    'numbers are never reused after a delete', (SELECT number::text FROM public.tasks WHERE id = test.id('T9')));
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"title": "x"}'::jsonb)$q$, test.id('W'), test.id('S2')));
  PERFORM test.ok(r LIKE '%not found%', 'a deleted task can only be restored, not edited', r);

  -- ── The task key ──────────────────────────────────────────────────────────
  r := test.try('E', format($q$SELECT public.workspace_op_set_task_key(%L, 'PLAN')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '42501%Only the workspace owner%', 'only the owner changes the key', r);
  r := test.try('O', format($q$SELECT public.workspace_op_set_task_key(%L, 'P1')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%2 to 5 letters%', 'a key is 2 to 5 letters', r);
  r := test.as_user('O', format($q$SELECT public.workspace_op_set_task_key(%L, 'plan')$q$, test.id('W')));
  SELECT * INTO v_ws FROM public.workspaces WHERE id = test.id('W');
  PERFORM test.ok(r = 'ok 1' AND v_ws.task_key = 'PLAN' AND v_ws.task_key_aliases = ARRAY['ML'],
    'the owner changes the key; the old one stays an alias', r || ' ' || v_ws.task_key || ' ' || v_ws.task_key_aliases::text);
  PERFORM test.ok((SELECT handle FROM public.entities WHERE entity_id = test.id('T1')) = 'PLAN-1',
    'every handle follows the new key');
  PERFORM test.as_user('O', format($q$UPDATE public.workspaces SET task_key_aliases = '{}' WHERE id = %L$q$, test.id('W')));
  PERFORM test.ok((SELECT task_key_aliases FROM public.workspaces WHERE id = test.id('W')) = ARRAY['ML'],
    'aliases can''t be edited directly');

  -- ── An API key (the MCP connector) creates as its creator ─────────────────
  r := test.as_key('K', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "From the agent", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('TK')::text), to_json(test.id('SB')::text)));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT owner_id FROM public.tasks WHERE id = test.id('TK')) = test.id('E')
              AND (SELECT actor_type || ':' || actor_label FROM public.module_activity
                   WHERE entity_id = test.id('TK') AND op = 'tasks.create') = 'api_key:Claude Desktop',
    'a key creates through the op, as its creator, attributed "via" the key', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"title": "Renamed by the agent"}'::jsonb)$q$,
    test.id('W'), test.id('TK')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT label FROM public.entities WHERE entity_id = test.id('TK')) = 'Renamed by the agent',
    'a key edits through the op', r);

  -- ── One dependency store: a "blocks" link blocks (AC1.14) ─────────────────
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Blocker", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('BA')::text), to_json(test.id('SB')::text)));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Waits", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('BB')::text), to_json(test.id('SB')::text)));
  r := test.as_user('E', format($q$SELECT public.links_op_create(%L, 'task', %L, 'task', %L, 'blocks')$q$,
    test.id('W'), test.id('BA'), test.id('BB')));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (SELECT 1 FROM public.task_relations
      WHERE blocker_task_id = test.id('BA') AND blocked_task_id = test.id('BB')),
    'a "blocks" link made from the hub is a dependency', r);
  PERFORM test.ok((SELECT count(*) FROM public.entity_links
                   WHERE pair_key = public.spine_pair_key('task', test.id('BA'), 'task', test.id('BB'))
                     AND deleted_at IS NULL) = 1,
    'and there is still one link (the two mirrors don''t ping-pong)');
  r := test.try('E', format($q$SELECT public.links_op_create(%L, 'task', %L, 'task', %L, 'blocks')$q$,
    test.id('W'), test.id('BB'), test.id('BA')));
  PERFORM test.ok((r LIKE '%cycle%' OR r LIKE '%already%' OR r = 'ok 1') AND NOT EXISTS (
      SELECT 1 FROM public.task_relations WHERE blocker_task_id = test.id('BB') AND blocked_task_id = test.id('BA')),
    'a loop is never stored', r);
  r := test.as_key('K', format($q$SELECT public.links_op_set_kind(%L, (SELECT id FROM public.entity_links
      WHERE pair_key = public.spine_pair_key('task', %L, 'task', %L) AND deleted_at IS NULL), 'references')$q$,
    test.id('W'), test.id('BA'), test.id('BB')));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.task_relations
      WHERE blocker_task_id = test.id('BA') AND blocked_task_id = test.id('BB')),
    'changing the link''s kind (here by an agent) ends the dependency', r);
  r := test.as_key('K', format($q$SELECT public.links_op_set_kind(%L, (SELECT id FROM public.entity_links
      WHERE pair_key = public.spine_pair_key('task', %L, 'task', %L) AND deleted_at IS NULL), 'blocks')$q$,
    test.id('W'), test.id('BA'), test.id('BB')));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (SELECT 1 FROM public.task_relations
      WHERE blocker_task_id = test.id('BA') AND blocked_task_id = test.id('BB')),
    'an agent''s "blocks" link (MCP) is a dependency too', r);
  r := test.as_user('E', format($q$SELECT public.links_op_delete(%L, (SELECT id FROM public.entity_links
      WHERE pair_key = public.spine_pair_key('task', %L, 'task', %L) AND deleted_at IS NULL))$q$,
    test.id('W'), test.id('BA'), test.id('BB')));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.task_relations
      WHERE blocker_task_id = test.id('BA') AND blocked_task_id = test.id('BB')),
    'deleting the link ends the dependency', r);
  -- From the other side: a dependency made in Tasks still shows as a link.
  r := test.as_user('E', format($q$INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES (%L, %L, %L)$q$,
    test.id('W'), test.id('BA'), test.id('BB')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT count(*) FROM public.entity_links
      WHERE pair_key = public.spine_pair_key('task', test.id('BA'), 'task', test.id('BB'))
        AND relation_kind = 'blocks' AND deleted_at IS NULL) = 1,
    'a dependency made in Tasks is one "blocks" link', r);
  r := test.as_user('E', format($q$DELETE FROM public.task_relations WHERE blocker_task_id = %L AND blocked_task_id = %L$q$,
    test.id('BA'), test.id('BB')));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.entity_links
      WHERE pair_key = public.spine_pair_key('task', test.id('BA'), 'task', test.id('BB'))
        AND relation_kind = 'blocks' AND deleted_at IS NULL),
    'removing it in Tasks removes the link', r);
  -- The blocked task is in O's private project: E can't make it wait.
  PERFORM test.as_op('O', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title) VALUES (%L, %L, %L, 'Private')$q$,
    test.id('TP'), test.id('W'), test.id('PB')));
  r := test.try('E', format($q$SELECT public.links_op_create(%L, 'task', %L, 'task', %L, 'blocks')$q$,
    test.id('W'), test.id('BA'), test.id('TP')));
  PERFORM test.ok(r NOT LIKE 'ok%' AND NOT EXISTS (SELECT 1 FROM public.task_relations WHERE blocked_task_id = test.id('TP')),
    'a "blocks" link needs edit on the task that waits', r);

  -- ── A task you can't see is never answered with ───────────────────────────
  -- TP is in O's private project: whatever E sends, it reads as missing.
  r := test.try('E', format($q$SELECT title FROM public.tasks_op_update(%L, %L, '{}'::jsonb)$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'an empty patch to a hidden task reads as missing', r);
  r := test.try('E', format($q$SELECT title FROM public.tasks_op_update(%L, %L, '{"deleted_at": null}'::jsonb)$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'a "restore" of a live hidden task reads as missing', r);
  r := test.try('E', format($q$SELECT title FROM public.tasks_op_update(%L, %L, '{"status": "todo"}'::jsonb)$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'a status it already has reads as missing', r);
  r := test.try('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'todo')).title$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'set_status to the status it has reads as missing', r);
  r := test.try('E', format($q$SELECT (public.tasks_op_uncommit(%L, %L)).title$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'uncommitting a hidden task that isn''t committed reads as missing', r);
  r := test.try('E', format($q$SELECT (public.tasks_op_skip_today(%L, %L)).title$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'skip-today on a hidden task reads as missing', r);
  r := test.try('E', format($q$SELECT (public.tasks_op_unschedule(%L, %L)).title$q$, test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE '%Task not found%', 'unscheduling a hidden unscheduled task reads as missing', r);
  -- …and can't be a parent (which would also tell whether it exists).
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, '{"title": "Sneaky", "bucket_id": %s, "parent_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('SB')::text), to_json(test.id('TP')::text)));
  PERFORM test.ok(r LIKE '22023%parent task%', 'a create under a hidden parent is refused', r);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"parent_id": %s}'::jsonb)$q$,
    test.id('W'), test.id('T9'), to_json(test.id('TP')::text)));
  PERFORM test.ok(r LIKE '22023%parent task%' AND (SELECT parent_id FROM public.tasks WHERE id = test.id('T9')) IS NULL,
    'moving a task under a hidden parent is refused, with the same words as a missing one', r);

  -- Deleting a parent promotes even a subtask the deleter can't edit (the
  -- server's own consequence), and doesn't answer with it.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Parent", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('PA')::text), to_json(test.id('SB')::text)));
  PERFORM test.as_op('O', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, parent_id, title) VALUES (%L, %L, %L, %L, 'O''s private step')$q$,
    test.id('PS'), test.id('W'), test.id('PB'), test.id('PA')));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$,
    test.id('W'), test.id('PA')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT parent_id IS NULL AND deleted_at IS NULL FROM public.tasks WHERE id = test.id('PS')),
    'a delete promotes a subtask the deleter can''t edit, and answers without it', r);

  -- A task created done (an import) has its completion.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Done already", "bucket_id": %s, "status": "done"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('TD')::text), to_json(test.id('SB')::text)));
  PERFORM test.ok((SELECT count(*) FROM public.task_completions WHERE task_id = test.id('TD') AND user_id = test.id('E')) = 1,
    'a task created done records its completion');
END;
$$;
