-- TV-D13 · Teams: routing shares nothing, taking a team's task, the team's
-- notices, check-backs, @Team in comments, an unfiled task given to someone,
-- and someone leaving the workspace
-- (supabase/migrations/20261013150000_teams_routing.sql).
-- specs/tasks-v3.md AC map: "routing, claims, defaults" (AC5.2, AC5.7),
-- AC5.1 (call 20/20a's server half), AC5.6 (member removal, the server
-- half); §13's team rows; REPLAN 20, 20a, 54, 94, defaults s and t.
--
-- Cast: O owns workspace W. E, M, A, N and S are members who work on tasks,
-- V a viewer, X belongs to another workspace. SB is a shared project, PP one
-- only O can open (A may read it, N may edit it). Design (DS) is E, M and A;
-- Development (DV) is N. Keys act for O (KO edit, KV view only), A (KA) and
-- E (KE).

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'A', 'N', 'S', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('S'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('PP'), test.id('W'), test.id('O'), 'Board only', false),
  (test.id('AR'), test.id('W'), test.id('O'), 'Old campaign', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PP');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PP'), 'member', test.id('A'), 'view', test.id('O')),
       (test.id('W'), 'bucket', test.id('PP'), 'member', test.id('N'), 'edit', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KO'), test.id('W'), 'O''s agent', 'mdo_ko', md5('db-test-ko'), '{"tasks": "edit"}'::jsonb, test.id('O')),
  (test.id('KV'), test.id('W'), 'O''s reader', 'mdo_kv', md5('db-test-kv'), '{"tasks": "view"}'::jsonb, test.id('O')),
  (test.id('KA'), test.id('W'), 'A''s agent', 'mdo_ka', md5('db-test-ka'), '{"tasks": "edit"}'::jsonb, test.id('A')),
  (test.id('KE'), test.id('W'), 'E''s agent', 'mdo_ke', md5('db-test-ke'), '{"tasks": "edit"}'::jsonb, test.id('E'));
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

  -- ── 1. Routing shares nothing (54: routing now, access later) ───────────
  PERFORM test.make('O', jsonb_build_object('id', test.id('PT1'), 'title', 'Board deck art', 'bucket_id', test.id('PP'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.make('O', jsonb_build_object('id', test.id('PT2'), 'title', 'Salaries', 'bucket_id', test.id('PP'),
                                            'assignee_id', NULL));
  PERFORM test.ok(NOT test.can('M', 'PT1', 'view') AND NOT test.sees('M', 'PT1')
              AND NOT test.can('E', 'PT1', 'view') AND NOT test.sees('E', 'PT1'),
    'a task routed to Design in a project its members can''t open stays out of their sight');
  PERFORM test.ok(test.can('A', 'PT1', 'view') AND NOT test.can('A', 'PT1', 'edit'),
    'a member who may read the project reads it, no more: the team adds nothing');
  r := test.patch('N', 'PT2', jsonb_build_object('team_id', test.id('DS')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('PT2')).team_id = test.id('DS')
              AND NOT test.can('M', 'PT2', 'view') AND NOT test.can('E', 'PT2', 'view'),
    'routing with Edit (not Full) on a private project is allowed and shares nothing', r);
  PERFORM test.make('O', jsonb_build_object('id', test.id('PT3'), 'title', 'Board site', 'bucket_id', test.id('PP')));
  r := test.as_key('KO', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('PT3'),
    jsonb_build_object('team_id', test.id('DS'))));
  PERFORM test.ok(r = 'ok 1' AND (test.task('PT3')).team_id = test.id('DS') AND NOT test.can('M', 'PT3', 'view'),
    'an API key routing shares nothing either', r);
  r := test.as_user('S', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('S')));
  PERFORM test.ok(r LIKE 'ok %' AND NOT test.can('S', 'PT1', 'view') AND NOT test.sees('S', 'PT1'),
    'joining a team yourself (any member may, default t) gives nothing of its tasks', r);
  r := test.try('V', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('V')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a viewer can''t join or add anyone', r);
  r := test.try('X', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('X')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'nor someone from another workspace', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('access_changes_task_team', 'access_changes_team_member')),
    'a team changes nobody''s access, so the grant feed hears nothing from it');
  PERFORM test.ok(public.can_access('bucket', test.id('SB'), 'view', test.id('M'))
              AND NOT public.can_access('bucket', test.id('PP'), 'view', test.id('M'))
              AND public.can_access('bucket', test.id('PP'), 'edit', test.id('N'))
              AND public.can_access('bucket', test.id('PP'), 'full', test.id('O')),
    'projects read the same as before');

  -- ── 2. Taking a team's task (AC5.2) ──────────────────────────────────────
  PERFORM test.make('O', jsonb_build_object('id', test.id('T1'), 'title', 'Logo sketches', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL, 'priority', 'high'));
  r := test.as_user('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T1')).assignee_id = test.id('M') AND (test.task('T1')).team_id = test.id('DS')
              AND (test.task('T1')).bucket_id = test.id('SB') AND (test.task('T1')).priority = 'high'
              AND (test.task('T1')).title = 'Logo sketches',
    'a member takes it: it''s theirs, the team stays on it, nothing else changes', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.entity_id = test.id('T1') AND a.op = 'tasks.assigned'
                            AND (a.payload ->> 'self')::boolean AND NOT a.payload ? 'mentioned_user_ids'),
    'the trail says they took it; nobody''s bell rings');
  r := test.try('A', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '%Someone already took this task%', 'the second to take it is told someone already did', r);
  r := test.as_user('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T1')).assignee_id = test.id('M'), 'taking it again changes nothing', r);
  PERFORM test.make('O', jsonb_build_object('id', test.id('T4'), 'title', 'Logo', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  r := test.try('N', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T4')));
  PERFORM test.ok(r LIKE '%Only people in Design can take its tasks%', 'someone outside the team can''t take it', r);
  PERFORM test.as_user('O', format($q$SELECT * FROM public.teams_op_remove_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('E')));
  r := test.try('E', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T4')));
  PERFORM test.ok(r LIKE '%Only people in Design can take its tasks%', 'nor someone who has left the team', r);
  PERFORM test.as_user('O', format($q$SELECT * FROM public.teams_op_add_member(%L, %L, %L)$q$, test.id('W'), test.id('DS'), test.id('E')));
  r := test.try('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('PT1')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace%', 'a team task its member can''t see reads as missing', r);
  r := test.try('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('nothing')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace%', 'the same as one that doesn''t exist', r);
  r := test.try('A', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('PT1')));
  PERFORM test.ok(r LIKE '%can''t edit this task, so you can''t take it%' AND (test.task('PT1')).assignee_id IS NULL,
    'a member who may only read it can''t take it', r);
  PERFORM test.make('O', jsonb_build_object('id', test.id('T6'), 'title', 'No team', 'bucket_id', test.id('SB')));
  r := test.try('O', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T6')));
  PERFORM test.ok(r LIKE '%isn''t for a team%', 'a task with no team isn''t taken this way', r);
  r := test.try('V', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T4')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a viewer can''t take one', r);
  r := test.try('X', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T4')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'nor someone from another workspace', r);
  PERFORM test.make('O', jsonb_build_object('id', test.id('T5'), 'title', 'Old banner', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL, 'status', 'done'));
  r := test.try('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T5')));
  PERFORM test.ok(r LIKE '%already closed%', 'a finished task isn''t taken', r);

  -- ── 2b. Assigning still hands one task over exactly as PERM-1 does ──────
  r := test.try('V', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('PT2'), test.id('S')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a viewer can''t assign', r);
  r := test.try('A', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('PT2'), test.id('S')));
  PERFORM test.ok(r LIKE '%don''t have access to this task%', 'someone who may only read the task can''t assign it', r);
  r := test.try('M', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('PT2'), test.id('S')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace%', 'someone who can''t see it is told it isn''t there', r);
  r := test.as_key('KV', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('PT2'), test.id('S')));
  PERFORM test.ok(r LIKE '%don''t have edit access to Tasks%', 'a key that may only read can''t assign', r);
  r := test.as_key('KA', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('PT2'), test.id('S')));
  PERFORM test.ok(r LIKE '%don''t have access to this task%', 'nor a key acting for someone who can''t edit the task', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.resource_grants g
                              WHERE g.resource_type = 'task' AND g.resource_id = test.id('PT2') AND g.subject_id = test.id('S'))
              AND NOT test.can('S', 'PT2', 'view'),
    'none of them handed the task to anyone');
  r := test.as_user('N', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('PT2'), test.id('S')));
  PERFORM test.ok(r = 'ok 1' AND test.can('S', 'PT2', 'edit') AND NOT public.can_access('bucket', test.id('PP'), 'view', test.id('S'))
              AND (test.task('PT2')).bucket_id = test.id('PP')
              AND EXISTS (SELECT 1 FROM public.resource_grants g
                          WHERE g.resource_type = 'task' AND g.resource_id = test.id('PT2') AND g.subject_id = test.id('S')
                            AND g.origin = 'assign' AND g.level = 'edit'),
    'someone who can edit it assigns it: the assignee gets that task, not its project (PERM-1, unchanged)', r);

  -- ── 3. "Routed to your team": once, gathered by the hour (§13, s) ────────
  -- Each member's notice is their own row, on their own Inbox.
  PERFORM test.ok((SELECT count(*) FROM test.routed('N', 'DS')) = 1
              AND (SELECT payload -> 'mentioned_user_ids' FROM test.routed('N', 'DS') LIMIT 1) = test.ids('A')
              AND (SELECT entity_id FROM test.routed('N', 'DS') LIMIT 1) = test.inbox('A'),
    'routing a task in a private project tells only the members who can see it (here A, who may read it)');
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.module_activity
                                              WHERE op = 'tasks.routed'
                                                AND (payload ->> 'task_id' = %L OR payload -> 'task_ids' ? %L)$q$,
                                            test.id('PT2'), test.id('PT2'))) = '0'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.module_activity
                                              WHERE op = 'tasks.routed' AND payload -> 'task_ids' ? %L$q$, test.id('PT2'))) = '0',
    'an outsider reads no notice that names it (not its title, not that it exists)');
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.tasks
                                              WHERE id = %L AND team_routed_at IS NOT NULL$q$, test.id('PT1'))) = '0',
    'nor its routing clock (that is the task''s own row)');
  DELETE FROM public.module_activity WHERE workspace_id = test.id('W') AND op = 'tasks.routed';
  PERFORM test.make('E', jsonb_build_object('id', test.id('T10'), 'title', 'Hero image', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 3
              AND test.same((SELECT jsonb_agg(x.payload -> 'mentioned_user_ids' -> 0) FROM test.routed('E', 'DS') x),
                            test.ids('M', 'A', 'S'))
              AND NOT EXISTS (SELECT 1 FROM test.routed('E', 'DS') x
                              WHERE x.entity_id IS DISTINCT FROM test.inbox(
                                CASE x.payload -> 'mentioned_user_ids' ->> 0
                                  WHEN test.id('M')::text THEN 'M' WHEN test.id('A')::text THEN 'A' ELSE 'S' END)),
    'a task routed with nobody on it tells each other member of the team (never the router), on their own Inbox');
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.notifications_list(%L) WHERE op = 'tasks.routed'$q$,
                                            test.id('W'))) = '1'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.notifications_list(%L) WHERE op = 'tasks.routed'$q$,
                                            test.id('W'))) = '0'
              AND test.value_as('M', $q$SELECT count(*)::text FROM public.module_activity WHERE op = 'tasks.routed'$q$) = '1',
    'it''s in their bell, not the router''s, and nobody reads another member''s');
  PERFORM test.make('E', jsonb_build_object('id', test.id('T11'), 'title', 'Icons', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 3
              AND NOT EXISTS (SELECT 1 FROM test.routed('E', 'DS') x
                              WHERE (x.payload ->> 'count')::integer <> 2
                                 OR NOT test.same(x.payload -> 'task_ids', test.ids('T10', 'T11'))),
    'a second one within the hour joins each member''s notice ("routed 2 tasks to Design")');
  SELECT x.id INTO v_notice FROM test.routed('E', 'DS') x WHERE x.payload -> 'mentioned_user_ids' = test.ids('A');
  PERFORM test.as_user('A', format($q$SELECT public.notifications_op_mark_read(%L, %L)$q$, test.id('W'), v_notice));
  PERFORM test.make('E', jsonb_build_object('id', test.id('T12'), 'title', 'Fonts', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 4
              AND (SELECT count(*) FROM test.routed('E', 'DS') x WHERE (x.payload ->> 'count')::integer = 3) = 2,
    'once a member has read theirs, their next one is a new notice; the others keep gathering');
  PERFORM test.make('E', jsonb_build_object('id', test.id('T13'), 'title', 'Photos', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', test.id('A')));
  PERFORM test.ok((SELECT count(*) FROM test.routed('E', 'DS')) = 4
              AND NOT EXISTS (SELECT 1 FROM test.routed('E', 'DS') x WHERE x.payload -> 'task_ids' @> test.ids('T13')),
    'a routed task someone already has calls nobody');
  PERFORM test.make('O', jsonb_build_object('id', test.id('T14'), 'title', 'Brochure', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  PERFORM test.ok((SELECT count(*) FROM test.routed('O', 'DS')) = 4
              AND test.same((SELECT jsonb_agg(x.payload -> 'mentioned_user_ids' -> 0) FROM test.routed('O', 'DS') x),
                            test.ids('E', 'M', 'A', 'S')),
    'someone outside the team routing to it tells every member');
  PERFORM test.as_user('M', format($q$SELECT public.tasks_op_claim(%L, %L)$q$, test.id('W'), test.id('T14')));
  r := test.patch('M', 'T14', '{"assignee_id": null}'::jsonb);
  PERFORM test.ok((SELECT count(*) FROM test.routed('M', 'DS')) = 3
              AND test.same((SELECT jsonb_agg(x.payload -> 'mentioned_user_ids' -> 0) FROM test.routed('M', 'DS') x),
                            test.ids('E', 'A', 'S'))
              AND NOT EXISTS (SELECT 1 FROM test.routed('M', 'DS') x WHERE NOT coalesce((x.payload ->> 'returned')::boolean, false)),
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
  -- Everything else is out of the way of this check: the tasks above in this
  -- workspace, and any routed task already on the stack in another one (the
  -- sweep reads every workspace, and a real task left unclaimed for 3 days
  -- would otherwise be picked up here, depending on the day the test runs).
  UPDATE public.tasks SET team_check_back_at = now()
  WHERE team_id IS NOT NULL AND team_check_back_at IS NULL
    AND id NOT IN (test.id('C1'), test.id('C2'), test.id('C3'), test.id('C4'));
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
  v_count := public.tasks__team_check_backs(((v_today + 1)::timestamp + time '08:00') AT TIME ZONE 'UTC', 500);
  PERFORM test.ok(v_count = 0
              AND (SELECT count(*) FROM public.module_activity a
                   WHERE a.entity_id IN (test.id('C1'), test.id('C2')) AND a.op = 'tasks.team_check_back') = 2,
    'once each: a later run sends nothing new', v_count::text);
  r := test.patch('E', 'C1', jsonb_build_object('team_id', test.id('DV')));
  PERFORM test.ok((test.task('C1')).team_check_back_at IS NULL AND (test.task('C1')).team_routed_at > now() - interval '1 minute',
    'routing it to another team starts a new stretch, with its own check-back', r);
  -- Filed where its creator can't look (and E isn't in Development); and a
  -- task whose creator has since left the workspace.
  UPDATE public.tasks SET bucket_id = test.id('PP'), team_routed_at = now() - interval '4 days' WHERE id = test.id('C1');
  PERFORM test.make('S', jsonb_build_object('id', test.id('C5'), 'title', 'Flyer', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  UPDATE public.tasks SET team_routed_at = now() - interval '4 days' WHERE id = test.id('C5');
  PERFORM test.make('O', jsonb_build_object('id', test.id('PC'), 'title', 'Board pack', 'bucket_id', test.id('PP'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL));
  UPDATE public.tasks SET team_routed_at = now() - interval '4 days' WHERE id = test.id('PC');
  SELECT m.id INTO v_member FROM public.workspace_members m WHERE m.workspace_id = test.id('W') AND m.user_id = test.id('S');
  PERFORM test.as_user('O', format($q$SELECT public.workspace_op_remove_member(%L)$q$, v_member));
  -- A removal sets share.bypass for the rest of its transaction (it is its
  -- own request in the app); this test runs on in the same one.
  PERFORM set_config('share.bypass', '', true);
  v_count := public.tasks__team_check_backs(now(), 500);
  PERFORM test.ok(v_count = 1 AND (test.task('C1')).team_check_back_at IS NOT NULL AND (test.task('C5')).team_check_back_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.module_activity a
                              WHERE a.entity_id = test.id('C5') AND a.op = 'tasks.team_check_back')
              AND (SELECT count(*) FROM public.module_activity a
                   WHERE a.entity_id = test.id('C1') AND a.op = 'tasks.team_check_back') = 1,
    'a creator who can''t see the task any more, or has left, gets nothing, and the task is settled', v_count::text);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.entity_id = test.id('PC') AND a.op = 'tasks.team_check_back'
                            AND a.payload -> 'notify_user_ids' = test.ids('O'))
              AND test.value_as('M', format($q$SELECT count(*)::text FROM public.module_activity
                                              WHERE op = 'tasks.team_check_back' AND entity_id = %L$q$, test.id('PC'))) = '0',
    'a check-back on a private task reaches its creator; an outsider can''t read it');
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
  -- A comments on E's task naming Design: E, its creator, already hears
  -- "commented on" for this comment, so the team notice is M's alone.
  r := test.as_user('A', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Can Design take it?', '{}'::uuid[], 'Hero image', 'task')$q$,
    test.id('W'), test.id('T10')));
  SELECT c.id INTO v_notice FROM public.comments c
  WHERE c.entity_id = test.id('T10') AND c.created_by = test.id('A') ORDER BY c.created_at DESC LIMIT 1;
  r := test.as_user('A', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice, ARRAY[test.id('DS')]));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'comments.add' AND a.payload ->> 'comment_id' = v_notice::text
                            AND a.payload -> 'notify_user_ids' @> test.ids('E'))
              AND EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'comments.team_mention' AND a.payload ->> 'comment_id' = v_notice::text
                            AND a.payload -> 'mentioned_user_ids' = test.ids('M')),
    'someone the comment already told (its task''s creator) hears it once, not again through the team', r);
  r := test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Fine as is @Design', '{}'::uuid[], 'Salaries', 'task')$q$,
    test.id('W'), test.id('PT2')));
  SELECT c.id INTO v_notice FROM public.comments c WHERE c.entity_id = test.id('PT2') ORDER BY c.created_at DESC LIMIT 1;
  r := test.as_user('O', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice, ARRAY[test.id('DS')]));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'comments.team_mention' AND a.payload ->> 'comment_id' = v_notice::text
                            AND a.payload -> 'mentioned_user_ids' = test.ids('A')),
    'only members who can see the item hear (A may read it; E and M can''t open it)', r);
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.module_activity
                                              WHERE op = 'comments.team_mention' AND entity_id = %L$q$, test.id('PT2'))) = '0',
    'and nobody who can''t see it reads the excerpt');

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
  r := test.patch('E', 'H1', jsonb_build_object('assignee_id', test.id('A')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('H1')).bucket_id = test.inbox('M') AND (test.task('H1')).assignee_id = test.id('A'),
    'only your own unfiled tasks move: one in someone else''s Inbox stays there, whoever assigns it', r);
  r := test.patch('E', 'H1', '{"title": "Call the printer today"}'::jsonb);
  PERFORM test.ok(r = 'ok 1' AND (test.task('H1')).title = 'Call the printer today', 'its creator can still edit it', r);
  r := test.patch('M', 'H1', jsonb_build_object('assignee_id', test.id('E')));
  PERFORM test.ok((test.task('H1')).bucket_id = test.inbox('E') AND (test.task('H1s')).bucket_id = test.inbox('E'),
    'given back, it goes back into E''s Inbox', r);
  PERFORM test.make('E', jsonb_build_object('id', test.id('H5'), 'title', 'Order paper'));
  r := test.as_key('KE', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('H5'), test.id('M')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('H5')).bucket_id = test.inbox('M'),
    'a key acting for E hands over E''s own unfiled task', r);
  PERFORM test.make('E', jsonb_build_object('id', test.id('H6'), 'title', 'Private thought'));
  r := test.as_key('KA', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('H6'), test.id('A')));
  PERFORM test.ok(r LIKE '%Task not found in this workspace%' AND (test.task('H6')).bucket_id = test.inbox('E')
              AND (test.task('H6')).assignee_id = test.id('E'),
    'a key acting for someone else can''t touch it (it reads as missing)', r);
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
              AND (test.task('H5')).bucket_id = test.inbox('E') AND (test.task('H1')).assignee_id IS NULL,
    'a task someone else made goes back to that person''s Inbox, with its steps');
  PERFORM test.ok((test.task('HM')).bucket_id = test.inbox('O') AND (test.task('HMs')).bucket_id = test.inbox('O'),
    'the rest of their Inbox goes to whoever removed them');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'tasks.handed_back' AND a.entity_id = test.inbox('E')
                            AND a.payload -> 'mentioned_user_ids' = test.ids('E') AND a.payload ->> 'name' = 'M'
                            AND (a.payload ->> 'count')::integer = 2)
              AND NOT EXISTS (SELECT 1 FROM public.module_activity a
                              WHERE a.op = 'tasks.handed_back' AND a.payload -> 'mentioned_user_ids' = test.ids('O')),
    'one quiet notice to each person who received something (never the remover)');
  PERFORM test.ok(test.value_as('A', $q$SELECT count(*)::text FROM public.module_activity WHERE op = 'tasks.handed_back'$q$) = '0',
    'and nobody else reads it');
  PERFORM test.ok((test.task('T11')).assignee_id IS NULL AND (test.task('T11')).team_id = test.id('DS'),
    'what they''d taken from a team goes back to the team');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.tasks t
                              JOIN public.buckets b ON b.id = t.bucket_id
                              WHERE b.owner_id = test.id('M') AND b.is_system AND b.workspace_id = test.id('W')
                                AND t.deleted_at IS NULL),
    'nothing is left in an Inbox nobody can open');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                          WHERE a.op = 'tasks.handed_back' AND a.entity_id = test.inbox('E')
                            AND (a.payload ->> 'left')::boolean IS FALSE),
    'removed by someone else, the notice doesn''t say they left on their own');
  -- The removal's bypass stays on in this transaction (gotchas/supabase.md).
  PERFORM set_config('share.bypass', '', true);

  -- ── 8. Review fixes (20261013180000) ─────────────────────────────────────
  -- A finished task routed to a team, or given back to it, calls nobody.
  DELETE FROM public.module_activity WHERE workspace_id = test.id('W') AND op = 'tasks.routed';
  PERFORM test.make('E', jsonb_build_object('id', test.id('F1'), 'title', 'Already shipped', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', NULL, 'status', 'done'));
  PERFORM test.make('E', jsonb_build_object('id', test.id('F2'), 'title', 'Done by A', 'bucket_id', test.id('SB'),
                                            'team_id', test.id('DS'), 'assignee_id', test.id('A'), 'status', 'done'));
  r := test.patch('A', 'F2', '{"assignee_id": null}'::jsonb);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity a WHERE a.workspace_id = test.id('W') AND a.op = 'tasks.routed'),
    'a finished task routed to the team, or given back, tells nobody', r);

  -- Assigning and changing the status in one edit hands the task over after
  -- the status is set (the caller doesn't lose it half-way).
  PERFORM test.make('O', jsonb_build_object('id', test.id('G1'), 'title', 'For E', 'assignee_id', test.id('E')));
  PERFORM test.ok((test.task('G1')).bucket_id = test.inbox('E'), 'O''s task made for E sits in E''s Inbox');
  r := test.patch('E', 'G1', jsonb_build_object('assignee_id', test.id('A'), 'status', 'in_progress'));
  PERFORM test.ok(r = 'ok 1' AND (test.task('G1')).bucket_id = test.inbox('A')
              AND (test.task('G1')).status_category = 'in_progress' AND (test.task('G1')).assignee_id = test.id('A'),
    'assign + status in one edit both land, then it moves to A''s Inbox', r);
  PERFORM test.make('E', jsonb_build_object('id', test.id('G2'), 'title', 'Plan'));
  PERFORM test.make('E', jsonb_build_object('id', test.id('G2s'), 'title', 'Step', 'parent_id', test.id('G2')));
  PERFORM test.ok(test.as_user('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$,
                    test.id('W'), test.id('G2'), jsonb_build_object('assignee_id', test.id('A')))) = 'ok 2',
    'a hand-over answers with the subtasks it moved too');

  -- Account erasure: a task someone else made, sitting in the leaving
  -- person's Inbox with nobody's grant on it, goes back to its creator.
  PERFORM test.make('E', jsonb_build_object('id', test.id('R1'), 'title', 'Proofread', 'assignee_id', test.id('N')));
  r := test.patch('N', 'R1', '{"assignee_id": null}'::jsonb);
  PERFORM test.ok((test.task('R1')).bucket_id = test.inbox('N') AND (test.task('R1')).assignee_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.resource_grants g WHERE g.resource_type = 'task' AND g.resource_id = test.id('R1'))
              AND test.can('E', 'R1', 'view'),
    'set-up: E''s task in N''s Inbox, unassigned, no grant, E still sees it', r);
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('N')), false);
  PERFORM test.ok(r = 'ok 1' AND (test.task('R1')).id IS NOT NULL AND (test.task('R1')).bucket_id = test.inbox('E'),
    'erasing N''s account hands it back to E instead of deleting it (as a plain removal does)', r);

  -- A team mention needs its author to still see the item.
  r := test.as_user('A', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Noted', '{}'::uuid[], 'Salaries', 'task')$q$,
    test.id('W'), test.id('PT2')));
  SELECT c.id INTO v_notice FROM public.comments c
  WHERE c.entity_id = test.id('PT2') AND c.created_by = test.id('A') ORDER BY c.created_at DESC LIMIT 1;
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PP') AND subject_id = test.id('A');
  DELETE FROM public.resource_grants WHERE resource_type = 'task' AND resource_id = test.id('PT2') AND subject_id = test.id('A');
  r := test.try('A', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$, v_notice, ARRAY[test.id('DS')]));
  PERFORM test.ok(r LIKE '%isn''t there any more%', 'someone who lost sight of the item can''t name a team on it', r);
END;
$$;
