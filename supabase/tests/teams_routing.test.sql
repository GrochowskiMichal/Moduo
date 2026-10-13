-- TV-D13 · Teams: who sees a routed task, taking it, the team's notices,
-- check-backs, @Team in comments, an unfiled task given to someone, and
-- someone leaving the workspace
-- (supabase/migrations/20261013150000_teams_routing.sql).
-- specs/tasks-v3.md AC map: "routing, claims, defaults" (AC5.2, AC5.7),
-- AC5.1 (call 20/20a's server half), AC5.6 (member removal, the server
-- half); §13's team rows; REPLAN 20, 20a, 54, 94, defaults s and t.
--
-- Cast: O owns workspace W. E, M, A and N are members who work on tasks, V a
-- viewer, X belongs to another workspace. SB is a shared project, PP one only
-- O can open. Design (DS) is E, M and A; Development (DV) is N.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'A', 'N', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('PP'), test.id('W'), test.id('O'), 'Board only', false),
  (test.id('AR'), test.id('W'), test.id('O'), 'Old campaign', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PP');
INSERT INTO public.user_preferences (user_id, time_zone) VALUES (test.id('E'), 'UTC')
ON CONFLICT (user_id) DO UPDATE SET time_zone = EXCLUDED.time_zone;

CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.inbox(p_who text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT b.id FROM public.buckets b
  WHERE b.workspace_id = test.id('W') AND b.owner_id = test.id(p_who) AND b.is_system AND b.deleted_at IS NULL
$$;
-- The app's gate, for a person and a task.
CREATE FUNCTION test.can(p_who text, p_task text, p_level text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.can_access('task', test.id(p_task), p_level, test.id(p_who))
$$;
-- Whether the person reads the task's row (RLS, as the app does).
CREATE FUNCTION test.sees(p_who text, p_task text) RETURNS boolean LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format('SELECT count(*)::text FROM public.tasks WHERE id = %L', test.id(p_task))) = '1'
$$;
CREATE FUNCTION test.make(p_who text, p_task jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format('SELECT public.tasks_op_create(%L, %L::jsonb)', test.id('W'), p_task))
$$;
CREATE FUNCTION test.patch(p_who text, p_task text, p_patch jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format('SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)',
                                    test.id('W'), test.id(p_task), p_patch))
$$;
CREATE FUNCTION test.ids(VARIADIC p_names text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_agg(test.id(n)::text) FROM unnest(p_names) AS n
$$;
CREATE FUNCTION test.same(p_a jsonb, p_b jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_a, '[]'::jsonb) @> coalesce(p_b, '[]'::jsonb) AND coalesce(p_b, '[]'::jsonb) @> coalesce(p_a, '[]'::jsonb)
$$;
-- The routed notices someone made about a team, newest first.
CREATE FUNCTION test.routed(p_actor text, p_team text) RETURNS SETOF public.module_activity LANGUAGE sql STABLE AS $$
  SELECT * FROM public.module_activity ma
  WHERE ma.workspace_id = test.id('W') AND ma.op = 'tasks.routed'
    AND ma.actor_id = test.id(p_actor) AND ma.payload ->> 'team_id' = test.id(p_team)::text
  ORDER BY ma.created_at DESC, ma.id DESC
$$;

DO $$
DECLARE
  r text;
  v_notice uuid;
  v_count integer;
  v_member uuid;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  PERFORM test.as_user('E', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('DS'), 'name', 'Design',
                       'members', jsonb_build_array(test.id('E'), test.id('M'), test.id('A')))));
  PERFORM test.as_user('N', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('DV'), 'name', 'Development', 'members', jsonb_build_array(test.id('N')))));

  -- ── 1. A team works on what's routed to it (can_access, 54) ─────────────
  PERFORM test.make('O', jsonb_build_object('id', test.id('PT1'), 'title', 'Board deck art', 'bucket_id', test.id('PP'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.make('O', jsonb_build_object('id', test.id('PT2'), 'title', 'Salaries', 'bucket_id', test.id('PP')));
  PERFORM test.make('O', jsonb_build_object('id', test.id('PT3'), 'title', 'Board site', 'bucket_id', test.id('PP'),
                                            'team_id', test.id('DV'), 'assignee_id', NULL));
  PERFORM test.ok(test.can('M', 'PT1', 'edit') AND test.sees('M', 'PT1') AND test.sees('A', 'PT1'),
    'a member of the team sees and edits a task routed to it, in a project they can''t open');
  PERFORM test.ok(NOT test.can('M', 'PT1', 'full'),
    'the team works on it (Edit), it doesn''t own it');
  PERFORM test.ok(NOT public.can_access('bucket', test.id('PP'), 'view', test.id('M')),
    'routing never opens the project');
  PERFORM test.ok(NOT test.can('M', 'PT2', 'view') AND NOT test.sees('M', 'PT2'),
    'the project''s other tasks stay out of sight');
  PERFORM test.ok(NOT test.can('M', 'PT3', 'view') AND test.can('N', 'PT3', 'edit') AND NOT test.can('N', 'PT1', 'view'),
    'only the team it''s routed to: Development sees its task, not Design''s');
  PERFORM test.ok(NOT test.can('X', 'PT1', 'view') AND NOT test.can('V', 'PT1', 'view'),
    'nobody outside the team (another workspace, a viewer not in it)');
  r := test.as_user('E', format($q$SELECT * FROM public.teams_op_remove_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('M')));
  PERFORM test.ok(NOT test.can('M', 'PT1', 'view') AND NOT test.sees('M', 'PT1'),
    'leaving the team takes the task out of sight at once', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.access_changes c
                          WHERE c.workspace_id = test.id('W') AND c.user_id = test.id('M') AND c.resource_type = 'workspace'),
    'and tells their device to check what it holds');
  DELETE FROM public.access_changes WHERE workspace_id = test.id('W');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('M')));
  PERFORM test.ok(test.can('M', 'PT1', 'edit')
              AND EXISTS (SELECT 1 FROM public.access_changes c WHERE c.user_id = test.id('M') AND c.resource_type = 'workspace'),
    'joining again brings it back, and says so');
  UPDATE public.teams SET deleted_at = now() WHERE id = test.id('DS');
  PERFORM test.ok(NOT test.can('M', 'PT1', 'view'), 'a deleted team gives nothing, even before its tasks are cleared');
  UPDATE public.teams SET deleted_at = NULL WHERE id = test.id('DS');
  UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = test.id('W') AND user_id = test.id('M');
  PERFORM test.ok(test.can('M', 'PT1', 'view') AND NOT test.can('M', 'PT1', 'edit'),
    'a member whose role drops to viewer only reads it (the role still caps everything)');
  UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = test.id('W') AND user_id = test.id('M');
  DELETE FROM public.access_changes WHERE workspace_id = test.id('W');
  r := test.patch('O', 'PT3', jsonb_build_object('team_id', test.id('DS')));
  PERFORM test.ok(test.can('M', 'PT3', 'edit') AND NOT test.can('N', 'PT3', 'view')
              AND EXISTS (SELECT 1 FROM public.access_changes c
                          WHERE c.resource_type = 'task' AND c.resource_id = test.id('PT3') AND c.user_id IS NULL),
    'routing a task to another team moves who sees it, and the grant feed hears', r);
  r := test.patch('O', 'PT3', '{"team_id": null}'::jsonb);
  PERFORM test.ok(NOT test.can('M', 'PT3', 'view'), 'taking the team off takes the team''s sight with it', r);
  -- No other kind of item changed: a note, a project, a contact read as before.
  PERFORM test.ok(public.can_access('bucket', test.id('SB'), 'view', test.id('M'))
              AND NOT public.can_access('bucket', test.id('PP'), 'view', test.id('A'))
              AND public.can_access('bucket', test.id('PP'), 'full', test.id('O')),
    'projects read the same as before');

  -- ── 2. Taking a team's task (AC5.2) ──────────────────────────────────────
  r := test.as_user('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('PT1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('PT1')).assignee_id = test.id('M') AND (test.task('PT1')).team_id = test.id('DS'),
    'a member takes it: it''s theirs, the team stays on it', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.entity_id = test.id('PT1') AND a.op = 'tasks.assigned'
                            AND (a.payload ->> 'self')::boolean AND NOT a.payload ? 'mentioned_user_ids'),
    'the trail says they took it; nobody''s bell rings');
  r := test.try('A', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('PT1')));
  PERFORM test.ok(r LIKE '%Someone already took this task%', 'the second to take it is told someone already did', r);
  r := test.as_user('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('PT1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('PT1')).assignee_id = test.id('M'), 'taking it again changes nothing', r);
  PERFORM test.make('O', jsonb_build_object('id', test.id('T4'), 'title', 'Logo', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  r := test.try('N', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T4')));
  PERFORM test.ok(r LIKE '%Only people in Design can take its tasks%', 'someone outside the team can''t take it', r);
  r := test.try('O', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('PT2')));
  PERFORM test.ok(r LIKE '%isn''t for a team%', 'a task with no team isn''t taken this way', r);
  r := test.try('V', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T4')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a viewer can''t take one', r);
  r := test.try('X', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T4')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'nor someone from another workspace', r);
  PERFORM test.make('O', jsonb_build_object('id', test.id('T5'), 'title', 'Old banner', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL, 'status', 'done'));
  r := test.try('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T5')));
  PERFORM test.ok(r LIKE '%already closed%', 'a finished task isn''t taken', r);

  -- ── 3. "Routed to your team": once, gathered by the hour (§13, s) ────────
  DELETE FROM public.module_activity WHERE workspace_id = test.id('W') AND op = 'tasks.routed';
  PERFORM test.make('E', jsonb_build_object('id', test.id('T10'), 'title', 'Hero image', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 1
              AND test.same((SELECT payload -> 'mentioned_user_ids' FROM test.routed('E', 'DS') LIMIT 1), test.ids('M', 'A')),
    'a task routed with nobody on it tells the team''s other members (never the router)');
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.notifications_list(%L) WHERE op = 'tasks.routed'$q$,
                                            test.id('W'))) = '1'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.notifications_list(%L) WHERE op = 'tasks.routed'$q$,
                                            test.id('W'))) = '0',
    'it''s in their bell, not the router''s');
  PERFORM test.make('E', jsonb_build_object('id', test.id('T11'), 'title', 'Icons', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  SELECT id INTO v_notice FROM test.routed('E', 'DS') LIMIT 1;
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 1
              AND (SELECT (payload ->> 'count')::integer FROM public.module_activity WHERE id = v_notice) = 2
              AND test.same((SELECT payload -> 'task_ids' FROM public.module_activity WHERE id = v_notice), test.ids('T10', 'T11')),
    'a second one within the hour joins the same notice ("routed 2 tasks to Design")');
  PERFORM test.as_user('A', format($q$SELECT public.notifications_op_mark_read(%L, %L)$q$, test.id('W'), v_notice));
  PERFORM test.make('E', jsonb_build_object('id', test.id('T12'), 'title', 'Fonts', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 2,
    'once someone has read it, the next one is a new notice');
  PERFORM test.make('E', jsonb_build_object('id', test.id('T13'), 'title', 'Photos', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', test.id('A')));
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 2
              AND (SELECT (payload ->> 'count')::integer FROM test.routed('E', 'DS') LIMIT 1) = 1,
    'a routed task someone already has calls nobody');
  PERFORM test.make('O', jsonb_build_object('id', test.id('T14'), 'title', 'Brochure', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.ok((SELECT count(*) FROM test.routed('O', 'DS')) = 1
              AND test.same((SELECT payload -> 'mentioned_user_ids' FROM test.routed('O', 'DS') LIMIT 1), test.ids('E', 'M', 'A')),
    'someone outside the team routing to it tells every member');
  PERFORM test.as_user('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T14')));
  r := test.patch('M', 'T14', '{"assignee_id": null}'::jsonb);
  PERFORM test.ok((SELECT count(*) FROM test.routed('M', 'DS')) = 1
              AND test.same((SELECT payload -> 'mentioned_user_ids' FROM test.routed('M', 'DS') LIMIT 1), test.ids('E', 'A'))
              AND (SELECT (payload ->> 'returned')::boolean FROM test.routed('M', 'DS') LIMIT 1),
    'giving a task back tells the rest of the team it''s free again', r);
  PERFORM test.ok((test.task('T14')).team_routed_at IS NOT NULL AND (test.task('T14')).team_check_back_at IS NULL,
    'and starts its clock again');

  -- ── 4. Check-backs: 3 days unclaimed, or the day before it's due (s) ─────
  PERFORM test.make('E', jsonb_build_object('id', test.id('C1'), 'title', 'Banner', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.make('E', jsonb_build_object('id', test.id('C2'), 'title', 'Poster', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL, 'due_on', v_today + 1));
  PERFORM test.make('E', jsonb_build_object('id', test.id('C3'), 'title', 'Taken', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', test.id('M')));
  PERFORM test.make('O', jsonb_build_object('id', test.id('C4'), 'title', 'Archived', 'bucket_id', test.id('AR'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  -- Everything else in the workspace is out of the way of this check.
  UPDATE public.tasks SET team_check_back_at = now()
  WHERE workspace_id = test.id('W') AND team_id IS NOT NULL AND id NOT IN (test.id('C1'), test.id('C2'), test.id('C3'), test.id('C4'));
  UPDATE public.buckets SET archived_at = now() WHERE id = test.id('AR');
  UPDATE public.tasks SET team_routed_at = now() - interval '4 days'
  WHERE id IN (test.id('C1'), test.id('C3'), test.id('C4'));
  UPDATE public.tasks SET team_routed_at = (v_today::timestamp + time '06:00') AT TIME ZONE 'UTC' WHERE id = test.id('C2');
  v_count := public.tasks__team_check_backs((v_today::timestamp + time '08:00') AT TIME ZONE 'UTC', 500);
  PERFORM test.ok(v_count = 1
              AND EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.entity_id = test.id('C1') AND a.op = 'tasks.team_check_back'
                            AND a.actor_label = 'Moduo' AND a.payload ->> 'reason' = 'unclaimed'
                            AND a.payload -> 'notify_user_ids' = test.ids('E')),
    'still unclaimed after 3 days: its creator gets one check-back (from Moduo)', v_count::text);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity a
                              WHERE a.entity_id IN (test.id('C3'), test.id('C4')) AND a.op = 'tasks.team_check_back'),
    'not for a task someone took, nor in an archived project');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity a WHERE a.entity_id = test.id('C2') AND a.op = 'tasks.team_check_back'),
    'a task due tomorrow waits for 9:00 on the day before (its creator''s clock)');
  v_count := public.tasks__team_check_backs((v_today::timestamp + time '09:30') AT TIME ZONE 'UTC', 500);
  PERFORM test.ok(v_count = 1
              AND EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.entity_id = test.id('C2') AND a.op = 'tasks.team_check_back' AND a.payload ->> 'reason' = 'due'),
    'from 9:00 the day before it''s due, it checks back', v_count::text);
  v_count := public.tasks__team_check_backs(now() + interval '1 day', 500);
  PERFORM test.ok(v_count = 0
              AND (SELECT count(*) FROM public.module_activity a
                   WHERE a.entity_id IN (test.id('C1'), test.id('C2')) AND a.op = 'tasks.team_check_back') = 2,
    'once each: a later run sends nothing new', v_count::text);
  r := test.patch('E', 'C1', jsonb_build_object('team_id', test.id('DV')));
  PERFORM test.ok((test.task('C1')).team_check_back_at IS NULL AND (test.task('C1')).team_routed_at > now() - interval '1 minute',
    'routing it to another team starts a new stretch, with its own check-back', r);
  -- Filed where its creator can't look (and E isn't in Development).
  UPDATE public.tasks SET bucket_id = test.id('PP'), team_routed_at = now() - interval '4 days' WHERE id = test.id('C1');
  v_count := public.tasks__team_check_backs(now(), 500);
  PERFORM test.ok(v_count = 0 AND (test.task('C1')).team_check_back_at IS NOT NULL,
    'a creator who can''t see the task any more gets nothing, and the task is settled', v_count::text);
  r := test.as_user('M', format($q$UPDATE public.tasks SET team_routed_at = now() - interval '9 days', team_check_back_at = NULL WHERE id = %L$q$,
                               test.id('C1')));
  PERFORM test.ok((test.task('C1')).team_routed_at > now() - interval '5 days' AND (test.task('C1')).team_check_back_at IS NOT NULL,
    'people can''t rewrite the clock or the check-back (the values are put back)', r);

  -- ── 5. @Team in a comment (§13, 54) ──────────────────────────────────────
  r := test.as_user('E', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Ideas for this? @M', %L::uuid[], 'Hero image', 'task')$q$,
    test.id('W'), test.id('T10'), ARRAY[test.id('M')]));
  SELECT c.id INTO v_notice FROM public.comments c WHERE c.entity_id = test.id('T10') ORDER BY c.created_at DESC LIMIT 1;
  r := test.as_user('E', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice, ARRAY[test.id('DS')]));
  PERFORM test.ok(r = 'ok 1'
              AND EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'comments.team_mention' AND a.payload ->> 'comment_id' = v_notice::text
                            AND a.payload -> 'mentioned_user_ids' = test.ids('A')
                            AND a.payload -> 'team_names' = '["Design"]'::jsonb),
    'naming Design tells its members once: never the author, nor M (already named)', r);
  r := test.as_user('E', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice, ARRAY[test.id('DS')]));
  PERFORM test.ok((SELECT count(*) FROM public.module_activity a
                   WHERE a.op = 'comments.team_mention' AND a.payload ->> 'comment_id' = v_notice::text) = 1,
    'naming it again (an edit) tells nobody twice', r);
  r := test.as_user('E', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice,
    ARRAY[test.id('DS'), test.id('DV')]));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'comments.team_mention' AND a.payload ->> 'comment_id' = v_notice::text
                            AND a.payload -> 'team_ids' = jsonb_build_array(test.id('DV')::text)
                            AND a.payload -> 'mentioned_user_ids' = test.ids('N')),
    'a team newly named tells only its own members', r);
  r := test.try('M', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice, ARRAY[test.id('DS')]));
  PERFORM test.ok(r LIKE '%Only its author%', 'only the comment''s author names teams in it', r);
  r := test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Fine as is @Design', '{}'::uuid[], 'Salaries', 'task')$q$,
    test.id('W'), test.id('PT2')));
  SELECT c.id INTO v_notice FROM public.comments c WHERE c.entity_id = test.id('PT2') ORDER BY c.created_at DESC LIMIT 1;
  r := test.as_user('O', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice, ARRAY[test.id('DS')]));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'comments.team_mention' AND a.payload ->> 'comment_id' = v_notice::text
                            AND a.payload -> 'mentioned_user_ids' = '[]'::jsonb),
    'members who can''t see the item hear nothing (a task the team can''t open)', r);

  -- ── 6. An unfiled task given to someone (20, 20a) ────────────────────────
  PERFORM test.make('E', jsonb_build_object('id', test.id('H1'), 'title', 'Call the printer'));
  PERFORM test.make('E', jsonb_build_object('id', test.id('H1s'), 'title', 'Find the number', 'parent_id', test.id('H1')));
  PERFORM test.make('M', jsonb_build_object('id', test.id('HM'), 'title', 'M''s own note'));
  PERFORM test.ok((test.task('H1')).bucket_id = test.inbox('E'), 'a capture lands in its maker''s Inbox');
  r := test.patch('E', 'H1', jsonb_build_object('assignee_id', test.id('M')));
  PERFORM test.ok((test.task('H1')).bucket_id = test.inbox('M') AND (test.task('H1s')).bucket_id = test.inbox('M')
              AND (test.task('H1')).assignee_id = test.id('M'),
    'assigning it to M ("Keep unfiled") moves it, with its subtasks, into M''s Inbox', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'tasks.assigned' AND a.payload -> 'mentioned_user_ids' = test.ids('M')
                            AND a.payload -> 'task_ids' @> test.ids('H1')),
    'M hears "assigned to you" (gathered with E''s other assignments to M this hour)');
  PERFORM test.ok(test.sees('E', 'H1') AND test.can('E', 'H1', 'edit') AND test.sees('M', 'H1'),
    'its creator keeps sight of it (Created by me), and so does M');
  PERFORM test.ok(NOT test.sees('E', 'HM') AND NOT test.can('E', 'HM', 'view'),
    'the creator''s sight is that task only: nothing else of M''s Inbox');
  PERFORM test.ok(NOT test.sees('A', 'H1') AND NOT test.can('A', 'H1', 'view'), 'and nobody else sees it');
  r := test.patch('E', 'H1', '{"title": "Call the printer today"}'::jsonb);
  PERFORM test.ok(r = 'ok 1' AND (test.task('H1')).title = 'Call the printer today', 'its creator can still edit it', r);
  r := test.patch('M', 'H1', jsonb_build_object('assignee_id', test.id('E')));
  PERFORM test.ok((test.task('H1')).bucket_id = test.inbox('E') AND (test.task('H1s')).bucket_id = test.inbox('E'),
    'given back, it goes back into E''s Inbox', r);
  r := test.make('E', jsonb_build_object('id', test.id('H2'), 'title', 'Book the room', 'assignee_id', test.id('M')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('H2')).bucket_id = test.inbox('M'),
    'a task made for M with no project lands in M''s Inbox', r);
  r := test.make('E', jsonb_build_object('id', test.id('H3'), 'title', 'Filed', 'assignee_id', test.id('M'), 'bucket_id', test.id('SB')));
  PERFORM test.ok((test.task('H3')).bucket_id = test.id('SB'), 'one with a project stays in it', r);
  PERFORM test.make('E', jsonb_build_object('id', test.id('H4'), 'title', 'Trip'));
  PERFORM test.make('E', jsonb_build_object('id', test.id('H4s'), 'title', 'Tickets', 'parent_id', test.id('H4')));
  r := test.patch('E', 'H4s', jsonb_build_object('assignee_id', test.id('M')));
  PERFORM test.ok((test.task('H4s')).bucket_id = test.inbox('E') AND test.sees('M', 'H4s'),
    'a subtask stays with its task (its assignee gets it, not the Inbox)', r);
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
    (test.id('MP'), test.id('W'), test.id('M'), 'M''s own', false);
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('MP');
  r := test.patch('M', 'H2', jsonb_build_object('bucket_id', test.id('MP')));
  PERFORM test.ok((test.task('H2')).bucket_id = test.id('MP') AND NOT test.sees('E', 'H2'),
    'filed into a project its creator can''t open, the creator''s sight ends', r);

  -- ── 7. Someone leaves the workspace (AC5.6) ──────────────────────────────
  r := test.patch('E', 'H1', jsonb_build_object('assignee_id', test.id('M')));
  PERFORM test.make('M', jsonb_build_object('id', test.id('HMs'), 'title', 'A step of M''s', 'parent_id', test.id('HM')));
  UPDATE public.buckets SET lead_id = test.id('M') WHERE id = test.id('SB');
  PERFORM test.as_user('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T11')));
  DELETE FROM public.module_activity WHERE workspace_id = test.id('W') AND op = 'tasks.handed_back';
  SELECT m.id INTO v_member FROM public.workspace_members m WHERE m.workspace_id = test.id('W') AND m.user_id = test.id('M');
  r := test.as_user('O', format($q$SELECT public.workspace_op_remove_member(%L)$q$, v_member));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.team_members m
                                             WHERE m.user_id = test.id('M') AND m.deleted_at IS NULL),
    'their team memberships end', r);
  PERFORM test.ok((SELECT lead_id FROM public.buckets WHERE id = test.id('SB')) IS NULL, 'projects they led have no lead');
  PERFORM test.ok((test.task('H1')).bucket_id = test.inbox('E') AND (test.task('H1s')).bucket_id = test.inbox('E')
              AND (test.task('H1')).assignee_id IS NULL,
    'a task someone else made goes back to that person''s Inbox, with its steps');
  PERFORM test.ok((test.task('HM')).bucket_id = test.inbox('O') AND (test.task('HMs')).bucket_id = test.inbox('O'),
    'the rest of their Inbox goes to whoever removed them');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'tasks.handed_back' AND a.entity_id = test.inbox('E')
                            AND a.payload -> 'mentioned_user_ids' = test.ids('E') AND a.payload ->> 'name' = 'M'
                            AND (a.payload ->> 'count')::integer = 1)
              AND NOT EXISTS (SELECT 1 FROM public.module_activity a
                              WHERE a.op = 'tasks.handed_back' AND a.payload -> 'mentioned_user_ids' = test.ids('O')),
    'one quiet notice to each person who received something (never the remover)');
  PERFORM test.ok((test.task('T11')).assignee_id IS NULL AND (test.task('T11')).team_id = test.id('DS'),
    'what they''d taken from a team goes back to the team');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks t
                              JOIN public.buckets b ON b.id = t.bucket_id
                              WHERE b.owner_id = test.id('M') AND b.is_system AND b.workspace_id = test.id('W')
                                AND t.deleted_at IS NULL),
    'nothing is left in an Inbox nobody can open');
END;
$$;
