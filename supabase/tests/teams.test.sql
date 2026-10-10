-- TV-D10 · Teams: routing basics, marks, members, the default project; the
-- import key (supabase/migrations/20261010182000_teams.sql).
-- specs/tasks-v3.md AC map: "routing, claims, defaults" (AC5.2 data side;
-- claims, mentions and check-backs are TV-D13's), the Edge cases "A task
-- routed to a team…" and "A member leaves a team…", REPLAN 54, 94, 95,
-- default t.
--
-- Cast: O owns workspace W. E and M are members who work on tasks, A is an
-- admin, V a viewer, X belongs to another workspace W2. SB is a shared
-- project, DR the Design team's requests project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'A', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('A'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('DR'), test.id('W'), test.id('O'), 'Design requests', false),
  (test.id('XB'), test.id('W2'), test.id('X'), 'Theirs', false);

CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.team(p_name text) RETURNS public.teams LANGUAGE sql STABLE AS $$
  SELECT * FROM public.teams WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.members(p_team text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(p.display_name, ', ' ORDER BY p.display_name)
  FROM public.team_members m JOIN public.profiles p ON p.id = m.user_id
  WHERE m.team_id = test.id(p_team) AND m.deleted_at IS NULL
$$;

DO $$
DECLARE
  r text;
  v_inbox uuid;
BEGIN
  -- ── Teams and their marks (54, 95) ───────────────────────────────────────
  r := test.as_user('E', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('DS'), 'name', 'Design', 'members', jsonb_build_array(test.id('E'), test.id('M')))));
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).mark = 'DS' AND (test.team('DS')).created_by = test.id('E')
              AND test.members('DS') = 'E, M',
    'any member who works on tasks makes a team; its mark is two letters from the name', r);
  PERFORM test.as_user('M', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('DV'), 'name', 'Development')));
  PERFORM test.ok((test.team('DV')).mark = 'DV', 'Design DS, Development DV: no "D" clash');
  PERFORM test.as_user('M', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('BD'), 'name', 'Board members', 'mark', 'bo', 'color', 'violet')));
  PERFORM test.ok(((test.team('BD')).mark, (test.team('BD')).color) = ('BO', 'violet'), 'the letters can be edited');
  r := test.try('E', format($q$SELECT public.teams_op_create(%L, '{"name": "design"}'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%already a team called "design"%', 'two teams can''t share a name', r);
  r := test.try('E', format($q$SELECT public.teams_op_update(%L, %L, '{"mark": "DSX"}'::jsonb)$q$, test.id('W'), test.id('DS')));
  PERFORM test.ok(r LIKE '%one or two letters%', 'a mark is one or two letters', r);
  r := test.try('V', format($q$SELECT public.teams_op_create(%L, '{"name": "Viewers"}'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a viewer can''t make teams', r);
  r := test.try('E', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('V')));
  PERFORM test.ok(r LIKE '%Viewers can''t be assigned%', 'a team''s members can work on tasks (a viewer can''t join)', r);
  r := test.try('E', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('X')));
  PERFORM test.ok(r LIKE '%isn''t a member of this workspace%', 'nor can someone outside the workspace', r);
  r := test.as_user('M', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('A')));
  PERFORM test.ok(r = 'ok 3' AND test.members('DS') = 'A, E, M', 'any member edits a team''s members', r);
  PERFORM test.ok(test.value_as('V', format($q$SELECT count(*)::text FROM public.teams WHERE workspace_id = %L$q$, test.id('W'))) = '3'
              AND test.value_as('X', format($q$SELECT count(*)::text FROM public.teams WHERE workspace_id = %L$q$, test.id('W'))) = '0',
    'teams hide nothing inside the workspace, and show nothing outside it');
  r := test.try('E', $q$INSERT INTO public.teams (workspace_id, name, mark) VALUES (md5('db-test:W')::uuid, 'Raw', 'RW')$q$);
  PERFORM test.ok(r LIKE '42501%', 'teams are written only through the ops', r);

  -- ── A task for a team needs a project (94) ───────────────────────────────
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'New logo', 'team_id', test.id('DS'))));
  PERFORM test.ok(r LIKE '%needs a project%', 'a task for a team with no project is refused while the team has no default', r);
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T1'), 'title', 'New logo', 'team_id', test.id('DS'), 'bucket_id', test.id('SB'), 'assignee_id', NULL)));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T1')).team_id = test.id('DS') AND (test.task('T1')).bucket_id = test.id('SB')
              AND (test.task('T1')).assignee_id IS NULL,
    'a task with a team and a project: routed, unclaimed (no assignee)', r);
  r := test.as_user('E', format($q$SELECT public.teams_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('DS'),
    jsonb_build_object('default_project_id', test.id('DR'))));
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).default_project_id = test.id('DR'), 'a team names a default project', r);
  r := test.as_user('M', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T2'), 'title', 'Icon set', 'team_id', test.id('DS'))));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T2')).bucket_id = test.id('DR'),
    'a task for the team with no project goes to its default project', r);
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Captured"}'::jsonb)$q$,
    test.id('W'), to_json(test.id('T3')::text)));
  SELECT b.id INTO v_inbox FROM public.buckets b WHERE b.workspace_id = test.id('W') AND b.owner_id = test.id('E') AND b.is_system;
  PERFORM test.ok((test.task('T3')).bucket_id = v_inbox, 'a capture lands in the Inbox');
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T3'),
    jsonb_build_object('team_id', test.id('DS'))));
  PERFORM test.ok((test.task('T3')).team_id = test.id('DS') AND (test.task('T3')).bucket_id = test.id('DR')
              AND EXISTS (SELECT 1 FROM public.module_activity a WHERE a.entity_id = test.id('T3') AND a.op = 'tasks.update'
                            AND a.payload -> 'fields' @> '["bucket_id", "team_id"]'::jsonb),
    'routing an Inbox task to the team files it into the default project, in the trail', r);
  -- A team task moved into an Inbox leaves its team (an Inbox is private), so
  -- a move or a project's delete never fails over it.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T5'), 'title', 'Moodboard', 'team_id', test.id('DS'))));
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T5'),
    jsonb_build_object('bucket_id', v_inbox)));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T5')).bucket_id = v_inbox AND (test.task('T5')).team_id IS NULL,
    'a team task moved into an Inbox leaves its team', r);
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T6'), 'title', 'Palette', 'team_id', test.id('DS'))));
  r := test.as_user('E', format($q$UPDATE public.tasks SET bucket_id = %L WHERE id = %L$q$, v_inbox, test.id('T6')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T6')).bucket_id = v_inbox AND (test.task('T6')).team_id IS NULL,
    'so does one an old build (or today''s project delete) moves there raw', r);
  r := test.try('E', format($q$UPDATE public.tasks SET team_id = %L WHERE id = %L$q$, test.id('DS'), test.id('T6')));
  PERFORM test.ok(r LIKE '%needs a project%', 'routing a task that sits in an Inbox, raw, is refused', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"team_id": null}'::jsonb)$q$, test.id('W'), test.id('T3')));
  PERFORM test.ok((test.task('T3')).team_id IS NULL AND (test.task('T3')).bucket_id = test.id('DR'),
    'taking the team off leaves the task where it is', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T3'),
    jsonb_build_object('team_id', test.id('DV'))));
  PERFORM test.ok((test.task('T3')).team_id = test.id('DV'), 'a filed task is routed to another team without moving', r);
  PERFORM test.as_user('X', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W2'),
    jsonb_build_object('id', test.id('XT'), 'name', 'Theirs')));
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T3'),
    jsonb_build_object('team_id', test.id('XT'))));
  PERFORM test.ok(r LIKE '%team isn''t in this workspace%', 'a team of another workspace is refused', r);
  r := test.try('E', format($q$SELECT public.teams_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('DS'),
    jsonb_build_object('default_project_id', test.id('XB'))));
  PERFORM test.ok(r LIKE '%project isn''t in this workspace%', 'a default project is one of this workspace', r);
  r := test.try('E', format($q$SELECT public.teams_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('DS'),
    jsonb_build_object('default_project_id', v_inbox)));
  PERFORM test.ok(r LIKE '%project isn''t in this workspace%', 'an Inbox is never a default project', r);

  -- A task routed to a team the creator isn't in is allowed.
  r := test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T4'), 'title', 'Review deck', 'team_id', test.id('DS'))));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T4')).team_id = test.id('DS') AND (test.task('T4')).owner_id = test.id('O'),
    'routing to a team you''re not in is allowed; you stay its creator', r);

  -- ── A member leaves a team: no task changes ──────────────────────────────
  PERFORM test.as_user('M', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('assignee_id', test.id('M'))));
  r := test.as_user('E', format($q$SELECT * FROM public.teams_op_remove_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('M')));
  PERFORM test.ok(r = 'ok 2' AND test.members('DS') = 'A, E'
              AND (test.task('T1')).assignee_id = test.id('M') AND (test.task('T1')).team_id = test.id('DS')
              AND (test.task('T2')).assignee_id IS NOT DISTINCT FROM (test.task('T2')).assignee_id
              AND (test.task('T4')).team_id = test.id('DS'),
    'what M took stays M''s; what''s unclaimed stays the team''s', r);
  PERFORM test.as_user('E', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('M')));
  PERFORM test.ok(test.members('DS') = 'A, E, M', 'and can join again');

  -- ── Deleting a team: its creator, the owner or an admin (default t) ──────
  r := test.try('M', format($q$SELECT public.teams_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$, test.id('W'), test.id('DS')));
  PERFORM test.ok(r LIKE '%Only the team''s creator, the workspace owner or an admin%', 'another member can''t delete a team', r);
  r := test.as_user('A', format($q$SELECT public.teams_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$, test.id('W'), test.id('BD')));
  PERFORM test.ok(r = 'ok 1' AND (test.team('BD')).deleted_at IS NOT NULL, 'an admin can', r);
  r := test.as_user('E', format($q$SELECT public.teams_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$, test.id('W'), test.id('DS')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T1')).team_id IS NULL AND (test.task('T1')).assignee_id = test.id('M')
              AND (test.task('T2')).team_id IS NULL AND (test.task('T2')).bucket_id = test.id('DR'),
    'its creator can; its tasks lose the team and keep everything else', r);
  r := test.as_user('O', format($q$SELECT public.teams_op_update(%L, %L, '{"deleted_at": null}'::jsonb)$q$, test.id('W'), test.id('DS')));
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).deleted_at IS NULL AND test.members('DS') = 'A, E, M',
    'the owner can restore it, with its members', r);

  -- ── Import keys (§Assumptions #20) ───────────────────────────────────────
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('I1'), 'title', 'Syllabus week 1', 'bucket_id', test.id('SB'),
                       'imported_from', jsonb_build_object('source', 'todoist', 'key', '8812'))));
  PERFORM test.ok(r = 'ok 1' AND (test.task('I1')).imported_from = '{"source": "todoist", "key": "8812"}'::jsonb,
    'a task remembers where it was imported from', r);
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'Again', 'bucket_id', test.id('SB'),
                       'imported_from', jsonb_build_object('source', 'todoist', 'key', '8812'))));
  PERFORM test.ok(r LIKE '%already imported from that%', 'one live task per import key in a workspace', r);
  r := test.try('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'Bad', 'bucket_id', test.id('SB'), 'imported_from', jsonb_build_object('source', 'todoist'))));
  PERFORM test.ok(r LIKE '%tasks_imported_from_check%', 'an import key has a source and a key', r);
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"deleted_at": "now"}'::jsonb)$q$, test.id('W'), test.id('I1')));
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('title', 'Re-imported', 'bucket_id', test.id('SB'),
                       'imported_from', jsonb_build_object('source', 'todoist', 'key', '8812'))));
  PERFORM test.ok(r = 'ok 1', 'once that task is deleted, the key is free', r);

  -- ── Erasure (§Assumptions #26) ───────────────────────────────────────────
  PERFORM test.ok((public.account_erase_workspace_data(test.id('E'), true) ->> 'team_memberships_deleted')::integer = 1,
    'the erasure preview counts someone''s team memberships');
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('E')), false);
  PERFORM test.ok(r = 'ok 1' AND test.members('DS') = 'A, M' AND (test.team('DS')).created_by IS NULL
              AND (test.team('DS')).deleted_at IS NULL,
    'erasure removes their memberships; the team they made stays, without their name', r);
END;
$$;
