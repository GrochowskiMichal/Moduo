-- TV-U6 · People and projects going away: deleting a project, Restore,
-- Delete forever, archiving, colours
-- (supabase/migrations/20261011100000_projects_archive_trash.sql).
-- specs/tasks-v3.md AC map: "people and projects going away" (AC5.5; AC5.6's
-- member-removal side is PRIV-2's, live, and TV-U16's hand-offs), the Edge
-- cases "Structure moves" (deleting a project), REPLAN 78.
--
-- Cast: O owns workspace W (and the project P). E and A are members who work
-- on tasks, D a member who loses that right, V a viewer, X belongs to another
-- workspace. P is shared with the workspace; P2 is another shared project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'A', 'D', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('D'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');

CREATE FUNCTION test.bucket(p_name text) RETURNS public.buckets LANGUAGE sql STABLE AS $$
  SELECT * FROM public.buckets WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.inbox(p_who text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT b.id FROM public.buckets b
  WHERE b.workspace_id = test.id('W') AND b.owner_id = test.id(p_who) AND b.is_system AND b.deleted_at IS NULL
  LIMIT 1
$$;
-- The tasks in a person's Inbox, by their test names.
CREATE FUNCTION test.in_inbox(p_who text, p_names text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT bool_and((test.task(n)).bucket_id IS NOT DISTINCT FROM test.inbox(p_who)) FROM unnest(p_names) AS n
$$;
CREATE FUNCTION test.notices(p_who text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.module_activity a
  WHERE a.workspace_id = test.id('W') AND a.op = 'tasks.project_deleted'
    AND a.payload -> 'mentioned_user_ids' ? test.id(p_who)::text
$$;
-- A task as O made it (system insert with O as the actor).
CREATE FUNCTION test.mk(p_name text, p_project text, p_status text, p_assignee text DEFAULT NULL,
                        p_parent text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test.as_op('O', format(
    $q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title, status, assignee_id, parent_id)
       VALUES (%L, %L, %L, %L, %L, %L, %L)$q$,
    test.id(p_name), test.id('W'), test.id(p_project), p_name, p_status,
    CASE WHEN p_assignee IS NULL THEN NULL ELSE test.id(p_assignee) END,
    CASE WHEN p_parent IS NULL THEN NULL ELSE test.id(p_parent) END));
END;
$$;

DO $$
DECLARE
  r text;
  v_batch uuid;
  v_backlog uuid;
BEGIN
  -- ── The cast's projects and tasks ──────────────────────────────────────────
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P'), 'name', 'Acme rebrand')));
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P2'), 'name', 'Website')));
  PERFORM test.ok((test.bucket('P')).id IS NOT NULL AND public.can_access('bucket', test.id('P'), 'edit', test.id('E'))
              AND NOT public.can_access('bucket', test.id('P'), 'full', test.id('E')),
    'setup: P is shared with the workspace; E can edit it, only O has full access');
  PERFORM test.as_user('O', format($q$SELECT * FROM public.sections_op_create(%L, %L, '{"name": "Discovery"}'::jsonb)$q$,
    test.id('W'), test.id('P')));

  PERFORM test.mk('T1', 'P', 'todo', 'A');                 -- open, A's
  PERFORM test.mk('T1a', 'P', 'done', 'E', 'T1');          -- a finished step of an open task
  PERFORM test.mk('T2', 'P', 'in_progress', 'E');          -- open, E's, in a section
  PERFORM test.mk('T3', 'P', 'todo');                      -- open, unassigned
  PERFORM test.mk('T4', 'P', 'todo', 'A');                 -- parked in Backlog below
  PERFORM test.mk('T5', 'P', 'done', 'A');                 -- finished
  PERFORM test.mk('T6', 'P', 'archived', 'E');             -- Won't do
  PERFORM test.mk('T7', 'P', 'done', 'A');                 -- finished, with an open step
  PERFORM test.mk('T7a', 'P', 'todo', 'E', 'T7');
  PERFORM test.mk('T8', 'P', 'todo', 'D');                 -- D won't be able to work on tasks
  PERFORM test.mk('T9', 'P', 'todo', 'E');                 -- a team task
  UPDATE public.tasks SET section_id = (SELECT s.id FROM public.sections s WHERE s.project_id = test.id('P') AND s.name = 'Discovery')
  WHERE id = test.id('T2');
  SELECT s.id INTO v_backlog FROM public.project_statuses s
  WHERE s.project_id = test.id('P') AND s.category = 'backlog' AND s.deleted_at IS NULL LIMIT 1;
  UPDATE public.tasks SET status_id = v_backlog WHERE id = test.id('T4');
  PERFORM test.ok((test.task('T4')).status_category = 'backlog', 'setup: T4 sits in Backlog');
  PERFORM test.as_user('E', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TM'), 'name', 'Design', 'members', jsonb_build_array(test.id('E')))));
  UPDATE public.tasks SET team_id = test.id('TM') WHERE id = test.id('T9');
  -- D becomes a viewer (the role decides the perms).
  UPDATE public.workspace_members SET role = 'viewer'
  WHERE workspace_id = test.id('W') AND user_id = test.id('D');
  PERFORM test.ok(NOT public.perm_user_has(test.id('W'), test.id('D'), 'tasks.edit'),
    'setup: D can no longer work on tasks here');
  INSERT INTO public.task_queue (workspace_id, user_id, task_id, position)
  VALUES (test.id('W'), test.id('A'), test.id('T5'), 'a0');

  -- ── Who may delete ─────────────────────────────────────────────────────────
  r := test.try('E', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '42501%full access%', 'someone who can only edit the project can''t delete it', r);
  r := test.try('V', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '42501%', 'a viewer can''t delete a project', r);
  r := test.try('X', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '42501%' OR r LIKE 'P0002%', 'someone from another workspace can''t', r);
  r := test.try('O', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.inbox('O')));
  PERFORM test.ok(r LIKE '%isn''t in this workspace%' OR r LIKE '%Inbox can''t be deleted%',
    'an Inbox can''t be deleted', r);

  -- ── Deleting a project (REPLAN 78, AC5.5) ──────────────────────────────────
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok((test.bucket('P')).deleted_at IS NOT NULL AND (test.bucket('P')).deleted_batch_id IS NOT NULL,
    'the project goes to Recently deleted, with a batch');
  v_batch := (test.bucket('P')).deleted_batch_id;
  PERFORM test.ok(test.in_inbox('A', ARRAY['T1', 'T1a', 'T4', 'T7', 'T7a']),
    'open work goes to its assignee''s Inbox, with its steps (done steps of an open task too; a finished task with an open step counts as open; Backlog counts as open)');
  PERFORM test.ok(test.in_inbox('E', ARRAY['T2', 'T9']), 'E''s open tasks go to E''s Inbox');
  PERFORM test.ok(test.in_inbox('O', ARRAY['T3', 'T8']),
    'unassigned work, and work of someone who can''t work on tasks any more, goes to the deleter''s Inbox');
  PERFORM test.ok((test.task('T9')).team_id IS NULL, 'a team task moved into an Inbox leaves its team');
  PERFORM test.ok((test.task('T1')).deleted_at IS NULL AND (test.task('T2')).section_id IS NULL,
    'moved tasks stay live and leave the project''s sections');
  PERFORM test.ok((test.task('T5')).deleted_batch_id = v_batch AND (test.task('T6')).deleted_batch_id = v_batch
              AND (test.task('T5')).deleted_at IS NOT NULL AND (test.task('T6')).deleted_at IS NOT NULL,
    'finished and Won''t do work goes with the project, in its batch');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.task_queue q WHERE q.task_id = test.id('T5')),
    'deleted tasks leave every queue');
  PERFORM test.ok(cardinality((test.bucket('P')).trash_moved_task_ids) = 9,
    'the project remembers the 9 tasks it moved', cardinality((test.bucket('P')).trash_moved_task_ids)::text);
  PERFORM test.ok((SELECT count(*) FROM public.module_activity a
                   WHERE a.workspace_id = test.id('W') AND a.op = 'tasks.update'
                     AND a.payload ->> 'reason' = 'project_deleted') = 7
              AND (SELECT (a.payload ->> 'subtasks_moved')::int FROM public.module_activity a
                   WHERE a.entity_id = test.id('T1') AND a.payload ->> 'reason' = 'project_deleted') = 1
              AND (SELECT a.payload -> 'bucket_id' ->> 'to' FROM public.module_activity a
                   WHERE a.entity_id = test.id('T2') AND a.payload ->> 'reason' = 'project_deleted') = test.inbox('E')::text,
    'each moved top task''s trail says its project was deleted and where it went (its steps ride along)');
  PERFORM test.ok(test.notices('A') = 1 AND test.notices('E') = 1 AND test.notices('O') = 0 AND test.notices('D') = 0,
    'one quiet notice per person whose Inbox received work, never the deleter',
    format('A %s E %s O %s', test.notices('A'), test.notices('E'), test.notices('O')));
  PERFORM test.ok((SELECT (a.payload ->> 'count')::int FROM public.module_activity a
                   WHERE a.op = 'tasks.project_deleted' AND a.payload -> 'mentioned_user_ids' ? test.id('A')::text) = 3
              AND (SELECT a.payload ->> 'title' FROM public.module_activity a
                   WHERE a.op = 'tasks.project_deleted' AND a.payload -> 'mentioned_user_ids' ? test.id('A')::text) = 'Acme rebrand',
    'A''s notice counts A''s three tasks and names the project A could see');
  PERFORM test.ok(test.value_as('A', format($q$SELECT count(*)::text FROM public.module_activity
                    WHERE workspace_id = %L AND op = 'tasks.project_deleted'$q$, test.id('W'))) = '1',
    'A reads the notice (it hangs on A''s own Inbox), and only A''s');
  r := test.as_user('O', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok((test.bucket('P')).deleted_batch_id = v_batch AND test.notices('A') = 1,
    'deleting it again changes nothing', r);

  -- ── Recently deleted reads ─────────────────────────────────────────────────
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*)::text FROM public.buckets WHERE id = %L AND deleted_at IS NOT NULL$q$, test.id('P'))) = '1'
              AND test.value_as('O', format($q$SELECT count(*)::text FROM public.tasks WHERE deleted_batch_id = %L$q$, v_batch)) = '2',
    'the deleter reads the project and its batch in the trash');

  -- ── Restore (Undo, Recently deleted) ───────────────────────────────────────
  -- A edits T4 after the delete, E files T9 into another project: both stay.
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_update(%L, %L, '{"title": "T4 renamed"}'::jsonb)$q$,
    test.id('W'), test.id('T4')));
  PERFORM test.as_user('E', format($q$UPDATE public.tasks SET bucket_id = %L WHERE id = %L$q$,
    test.id('P2'), test.id('T9')));
  r := test.try('E', format($q$SELECT public.tasks_op_trash_restore(%L, 'bucket', %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '42501%full access%', 'someone who can only edit it can''t restore a project', r);
  r := test.as_user('O', format($q$SELECT public.tasks_op_trash_restore(%L, 'project', %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).deleted_at IS NULL AND (test.bucket('P')).deleted_batch_id IS NULL
              AND (test.bucket('P')).trash_moved_task_ids IS NULL,
    'Restore brings the project back and clears its batch', r);
  PERFORM test.ok((test.task('T5')).deleted_at IS NULL AND (test.task('T6')).deleted_at IS NULL
              AND (test.task('T5')).deleted_batch_id IS NULL,
    'the finished tasks come back with it');
  PERFORM test.ok((SELECT bool_and((test.task(n)).bucket_id = test.id('P'))
                   FROM unnest(ARRAY['T1', 'T1a', 'T2', 'T3', 'T7', 'T7a', 'T8']) AS n),
    'moved tasks nobody touched come back from every Inbox');
  PERFORM test.ok((test.task('T4')).bucket_id = test.inbox('A') AND (test.task('T9')).bucket_id = test.id('P2'),
    'a moved task edited since stays where it is, and so does one filed elsewhere');
  PERFORM test.ok((test.task('T2')).section_id = (SELECT s.id FROM public.sections s WHERE s.project_id = test.id('P') AND s.name = 'Discovery'),
    'a returned task goes back into its section');
  PERFORM test.ok((test.task('T2')).status_category = 'in_progress' AND (test.task('T7a')).status_category = 'todo',
    'returned tasks keep their status');
  r := test.as_user('O', format($q$SELECT public.tasks_op_trash_restore(%L, 'bucket', %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r = 'ok 1', 'restoring what isn''t in the trash changes nothing', r);

  -- Past 30 days nothing comes back.
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.id('P2')));
  ALTER TABLE public.buckets DISABLE TRIGGER trash_stamp_deleted_at;
  UPDATE public.buckets SET deleted_at = now() - interval '31 days' WHERE id = test.id('P2');
  ALTER TABLE public.buckets ENABLE TRIGGER trash_stamp_deleted_at;
  r := test.try('O', format($q$SELECT public.tasks_op_trash_restore(%L, 'bucket', %L)$q$, test.id('W'), test.id('P2')));
  PERFORM test.ok(r LIKE '%more than 30 days ago%', 'a project deleted more than 30 days ago can''t be restored', r);

  -- ── The trash bookkeeping is the server's ──────────────────────────────────
  -- A Restore runs as system work over what these columns name; a client
  -- that could write them could pull other people's tasks out of their Inbox.
  r := test.try('O', format($q$UPDATE public.buckets SET trash_moved_task_ids = ARRAY[%L]::uuid[], trash_moved_at = '2100-01-01' WHERE id = %L$q$,
    test.id('T4'), test.id('P2')));
  PERFORM test.ok(r LIKE '42501%Recently deleted is kept by Moduo%', 'a client can''t rewrite what a deleted project''s Restore takes back', r);
  r := test.try('O', format($q$INSERT INTO public.buckets (workspace_id, owner_id, name, deleted_at, trash_moved_task_ids, trash_moved_at) VALUES (%L, %L, 'Bait', now(), ARRAY[%L]::uuid[], '2100-01-01')$q$,
    test.id('W'), test.id('O'), test.id('T4')));
  PERFORM test.ok(r LIKE '42501%Recently deleted is kept by Moduo%', '…nor plant a deleted project that would take tasks on Restore', r);
  r := test.try('E', format($q$UPDATE public.tasks SET deleted_batch_id = gen_random_uuid() WHERE id = %L$q$, test.id('T2')));
  PERFORM test.ok(r LIKE '42501%', '…nor put a task into a batch', r);
  r := test.try('E', format($q$UPDATE public.tasks SET deleted_at = now() WHERE id = %L$q$, test.id('T2')));
  PERFORM test.ok(r LIKE 'ok%', 'deleting and restoring a task the plain way still works', r);

  -- ── Delete forever ─────────────────────────────────────────────────────────
  r := test.try('O', format($q$SELECT public.tasks_op_trash_purge(%L, 'bucket', %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '%Only something in Recently deleted%', 'a live project can''t be deleted forever', r);
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_delete(%L, %L)$q$, test.id('W'), test.id('P')));
  v_batch := (test.bucket('P')).deleted_batch_id;
  r := test.try('E', format($q$SELECT public.tasks_op_trash_purge(%L, 'bucket', %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE '42501%', 'someone without full access can''t delete it forever', r);
  r := test.as_user('O', format($q$SELECT public.tasks_op_trash_purge(%L, 'bucket', %L)$q$, test.id('W'), test.id('P')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).id IS NULL AND (test.task('T5')).id IS NULL
              AND (test.task('T1')).bucket_id = test.inbox('A'),
    'Delete forever removes the project and its batch; the work it handed out stays with people', r);

  -- ── A task on its own ──────────────────────────────────────────────────────
  PERFORM test.mk('S1', 'P2', 'todo', 'E');
  PERFORM test.as_user('E', format($q$UPDATE public.tasks SET deleted_at = now() WHERE id = %L$q$, test.id('S1')));
  r := test.as_user('E', format($q$SELECT public.tasks_op_trash_restore(%L, 'task', %L)$q$, test.id('W'), test.id('S1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('S1')).deleted_at IS NULL AND (test.task('S1')).bucket_id = test.inbox('E'),
    'a task whose project is gone comes back into the restorer''s Inbox', r);

  -- ── Archiving (REPLAN 16, 78) ──────────────────────────────────────────────
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P3'), 'name', 'Launch', 'color', 'blue')));
  PERFORM test.ok((test.bucket('P3')).color = 'blue', 'a project is made with a colour');
  PERFORM test.mk('U1', 'P3', 'todo', 'A');
  INSERT INTO public.task_queue (workspace_id, user_id, task_id, position)
  VALUES (test.id('W'), test.id('A'), test.id('U1'), 'a1');
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, '{"archived_at": "now"}'::jsonb)$q$, test.id('W'), test.id('P3')));
  PERFORM test.ok(r LIKE '42501%full access%', 'someone who can only edit a project can''t archive it', r);
  r := test.try('E', format($q$UPDATE public.buckets SET archived_at = now() WHERE id = %L$q$, test.id('P3')));
  PERFORM test.ok(r LIKE '42501%full access%', '…not through a raw write either', r);
  r := test.as_user('O', format($q$SELECT public.projects_op_update(%L, %L, '{"archived_at": "now"}'::jsonb)$q$, test.id('W'), test.id('P3')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P3')).archived_at IS NOT NULL, 'the owner archives it', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.task_queue q WHERE q.task_id = test.id('U1')),
    'an archived project''s tasks leave every queue');
  PERFORM test.ok(test.value_as('A', format($q$SELECT count(*)::text FROM public.tasks WHERE id = %L AND deleted_at IS NULL$q$, test.id('U1'))) = '1',
    'an archived project''s tasks stay readable (search finds them)');
  r := test.as_user('O', format($q$SELECT public.projects_op_update(%L, %L, '{"archived_at": null}'::jsonb)$q$, test.id('W'), test.id('P3')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P3')).archived_at IS NULL, 'and unarchives it', r);
  r := test.try('O', format($q$SELECT public.projects_op_update(%L, %L, '{"archived_at": "now"}'::jsonb)$q$, test.id('W'), test.inbox('O')));
  PERFORM test.ok(r LIKE '%Inbox isn''t a project%', 'an Inbox can''t be archived', r);

  -- ── Colours ────────────────────────────────────────────────────────────────
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, '{"color": "teal"}'::jsonb)$q$, test.id('W'), test.id('P3')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P3')).color = 'teal', 'anyone who can edit a project colours it', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, '{"color": null}'::jsonb)$q$, test.id('W'), test.id('P3')));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P3')).color IS NULL, 'null makes it neutral', r);
  r := test.try('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P3'),
    jsonb_build_object('color', repeat('x', 40))));
  PERFORM test.ok(r LIKE '22023%', 'a colour is a short name', r);
  r := test.try('V', format($q$SELECT public.projects_op_update(%L, %L, '{"color": "red"}'::jsonb)$q$, test.id('W'), test.id('P3')));
  PERFORM test.ok(r LIKE '42501%', 'a viewer can''t colour a project', r);
END;
$$;
