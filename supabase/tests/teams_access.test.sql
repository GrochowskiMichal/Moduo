-- TV-D13 follow-up · Who changes a team, its people and its default project;
-- routing through a default project; raw writes; who may call what
-- (supabase/migrations/20261013210000_teams_access_fix.sql, with TV-D10's
-- 20261010182000 and TV-D13's 20261013150000).
-- specs/tasks-v3.md "Members → Teams" (any member creates; creator/owner/admin
-- deletes), default t, REPLAN 94.
--
-- Cast: O owns workspace W. E, M and N are members who work on tasks, A is an
-- admin, V a viewer, X belongs to another workspace. E makes Design (DS) with
-- M in it. SB is a shared project; PE is one only E (and N, at Edit) can
-- change; PD one only E can change, later deleted.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'N', 'A', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('A'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('PE'), test.id('W'), test.id('O'), 'Brand vault', false),
  (test.id('PD'), test.id('W'), test.id('O'), 'Old site', false);
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PE'), test.id('PD'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PE'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'bucket', test.id('PE'), 'member', test.id('N'), 'edit', test.id('O')),
       (test.id('W'), 'bucket', test.id('PD'), 'member', test.id('E'), 'edit', test.id('O'));

CREATE FUNCTION test.team(p_name text) RETURNS public.teams LANGUAGE sql STABLE AS $$
  SELECT * FROM public.teams WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.members(p_team text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(p.display_name, ', ' ORDER BY p.display_name), '')
  FROM public.team_members m JOIN public.profiles p ON p.id = m.user_id
  WHERE m.team_id = test.id(p_team) AND m.deleted_at IS NULL
$$;
CREATE FUNCTION test.edit_team(p_who text, p_patch jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format('SELECT public.teams_op_update(%L, %L, %L::jsonb)',
                                    test.id('W'), test.id('DS'), p_patch))
$$;
CREATE FUNCTION test.try_team(p_who text, p_patch jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.try(p_who, format('SELECT public.teams_op_update(%L, %L, %L::jsonb)',
                                test.id('W'), test.id('DS'), p_patch))
$$;
CREATE FUNCTION test.take_out(p_who text, p_person text, p_try boolean) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN p_try
    THEN test.try(p_who, format('SELECT * FROM public.teams_op_remove_member(%L, %L, %L)',
                                test.id('W'), test.id('DS'), test.id(p_person)))
    ELSE test.as_user(p_who, format('SELECT * FROM public.teams_op_remove_member(%L, %L, %L)',
                                    test.id('W'), test.id('DS'), test.id(p_person))) END
$$;
CREATE FUNCTION test.add(p_who text, p_person text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format('SELECT * FROM public.teams_op_add_member(%L, %L, %L)',
                                    test.id('W'), test.id('DS'), test.id(p_person)))
$$;
CREATE FUNCTION test.inbox(p_who text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT b.id FROM public.buckets b
  WHERE b.workspace_id = test.id('W') AND b.owner_id = test.id(p_who) AND b.is_system AND b.deleted_at IS NULL
$$;
CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;

DO $$
DECLARE
  r text;
  v_fn text;
  v_ok boolean;
  v_bad text;
BEGIN
  r := test.as_user('E', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('DS'), 'name', 'Design', 'members', jsonb_build_array(test.id('E'), test.id('M')))));
  PERFORM test.ok(r = 'ok 1' AND test.members('DS') = 'E, M', 'E makes Design with M in it', r);

  -- ── A team's name, letters and colour: creator, owner or admin ───────────
  r := test.try_team('M', '{"name": "Brand"}');
  PERFORM test.ok(r LIKE '42501%Only the team''s creator, the workspace owner or an admin can change a team.%'
              AND (test.team('DS')).name = 'Design',
    'someone in the team can''t rename it', r);
  r := test.try_team('M', '{"mark": "BR"}');
  PERFORM test.ok(r LIKE '42501%' AND (test.team('DS')).mark = 'DS', 'nor change its letters', r);
  r := test.try_team('M', '{"color": "violet"}');
  PERFORM test.ok(r LIKE '42501%' AND (test.team('DS')).color IS NULL, 'nor its colour', r);
  r := test.try_team('N', '{"name": "Brand"}');
  PERFORM test.ok(r LIKE '42501%' AND (test.team('DS')).name = 'Design',
    'nor can a member who works on tasks but isn''t in it', r);
  r := test.try_team('V', '{"name": "Brand"}');
  PERFORM test.ok(r LIKE '42501%don''t have edit access to Tasks%', 'nor a viewer', r);
  r := test.try('X', format($q$SELECT public.teams_op_update(%L, %L, '{"name": "Brand"}'::jsonb)$q$,
    test.id('W'), test.id('DS')));
  PERFORM test.ok(r LIKE '42501%' AND (test.team('DS')).name = 'Design', 'nor someone outside the workspace', r);
  r := test.try('X', format($q$SELECT public.teams_op_update(%L, %L, '{"name": "Brand"}'::jsonb)$q$,
    test.id('W2'), test.id('DS')));
  PERFORM test.ok(r LIKE '%Team not found%' AND (test.team('DS')).name = 'Design',
    'naming the team under their own workspace finds nothing', r);
  r := test.edit_team('E', '{"name": "Brand design"}');
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).name = 'Brand design', 'its creator can rename it', r);
  r := test.edit_team('A', '{"color": "violet"}');
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).color = 'violet', 'an admin can recolour it', r);
  r := test.edit_team('O', '{"mark": "bd"}');
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).mark = 'BD', 'the owner can change its letters', r);

  -- ── Its people: anyone adds, anyone leaves, only those three take out ────
  r := test.add('M', 'N');
  PERFORM test.ok(r = 'ok 3' AND test.members('DS') = 'E, M, N', 'anyone who works on tasks adds people (default t)', r);
  r := test.take_out('M', 'N', true);
  PERFORM test.ok(r LIKE '42501%take someone else out of a team%' AND test.members('DS') = 'E, M, N',
    'someone in the team can''t take another person out', r);
  r := test.take_out('M', 'E', true);
  PERFORM test.ok(r LIKE '42501%' AND test.members('DS') = 'E, M, N', 'not even its creator', r);
  r := test.take_out('V', 'N', true);
  PERFORM test.ok(r LIKE '42501%' AND test.members('DS') = 'E, M, N', 'nor can a viewer', r);
  r := test.take_out('M', 'M', false);
  PERFORM test.ok(r = 'ok 2' AND test.members('DS') = 'E, N', 'anyone in the team can leave it', r);
  r := test.take_out('E', 'N', false);
  PERFORM test.ok(r = 'ok 1' AND test.members('DS') = 'E', 'its creator takes someone out', r);
  PERFORM test.add('M', 'M');
  r := test.take_out('A', 'M', false);
  PERFORM test.ok(r = 'ok 1' AND test.members('DS') = 'E', 'so does an admin', r);
  PERFORM test.add('E', 'M');
  PERFORM test.add('E', 'N');

  -- ── The default project ──────────────────────────────────────────────────
  r := test.try_team('M', jsonb_build_object('default_project_id', test.id('PE')));
  PERFORM test.ok(r LIKE '%project isn''t in this workspace%' AND r NOT LIKE '%Brand vault%'
              AND (test.team('DS')).default_project_id IS NULL,
    'nobody names a default project they can''t edit (and the refusal names no project)', r);
  r := test.edit_team('M', jsonb_build_object('default_project_id', test.id('SB')));
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).default_project_id = test.id('SB'),
    'with none set, anyone who can edit a project names it', r);
  r := test.edit_team('E', jsonb_build_object('default_project_id', test.id('PE')));
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).default_project_id = test.id('PE'),
    'its creator replaces it with one they can edit', r);
  r := test.try_team('M', jsonb_build_object('default_project_id', test.id('SB')));
  PERFORM test.ok(r LIKE '42501%change its default project%' AND r NOT LIKE '%Brand vault%'
              AND (test.team('DS')).default_project_id = test.id('PE'),
    'someone who can''t edit the current default can''t replace it', r);
  r := test.try_team('M', '{"default_project_id": null}');
  PERFORM test.ok(r LIKE '42501%' AND (test.team('DS')).default_project_id = test.id('PE'), 'nor clear it', r);
  r := test.try_team('V', '{"default_project_id": null}');
  PERFORM test.ok(r LIKE '42501%' AND (test.team('DS')).default_project_id = test.id('PE'), 'nor can a viewer', r);
  r := test.edit_team('N', jsonb_build_object('default_project_id', test.id('SB')));
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).default_project_id = test.id('SB'),
    'someone with Edit on the current default may replace it', r);
  r := test.edit_team('A', jsonb_build_object('default_project_id', test.id('SB')));
  PERFORM test.ok(r = 'ok 1', 'an admin may too', r);
  PERFORM test.edit_team('E', jsonb_build_object('default_project_id', test.id('PD')));
  UPDATE public.buckets SET deleted_at = now() WHERE id = test.id('PD');
  r := test.edit_team('M', jsonb_build_object('default_project_id', test.id('SB')));
  PERFORM test.ok(r = 'ok 1' AND (test.team('DS')).default_project_id = test.id('SB'),
    'a default whose project is gone counts as none', r);
  PERFORM test.edit_team('E', jsonb_build_object('default_project_id', test.id('PE')));

  -- ── Routing through a default the router can't edit (94) ─────────────────
  PERFORM test.as_user('M', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T1'), 'title', 'Poster')));
  r := test.try('M', format($q$SELECT * FROM public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('T1'),
    jsonb_build_object('team_id', test.id('DS'))));
  PERFORM test.ok(r LIKE '%needs a project%' AND r NOT LIKE '%Brand vault%'
              AND (test.task('T1')).bucket_id = test.inbox('M') AND (test.task('T1')).team_id IS NULL,
    'routing an Inbox task to a team whose default the router can''t edit is refused; it stays put', r);
  r := test.try('M', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T2'), 'title', 'Banner', 'team_id', test.id('DS'))));
  PERFORM test.ok(r LIKE '%needs a project%' AND test.task('T2') IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.bucket_id = test.id('PE')),
    'so is a new task for the team with no project; nothing lands in that project', r);
  r := test.try('M', format($q$UPDATE public.tasks SET team_id = %L, bucket_id = %L WHERE id = %L$q$,
    test.id('DS'), test.id('PE'), test.id('T1')));
  PERFORM test.ok(r LIKE '42501%' AND (test.task('T1')).bucket_id = test.inbox('M') AND (test.task('T1')).team_id IS NULL,
    'a raw write can''t route it into that project either', r);
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T3'), 'title', 'Logo', 'team_id', test.id('DS'))));
  PERFORM test.ok(r = 'ok 1' AND (test.task('T3')).bucket_id = test.id('PE'),
    'someone who can edit the default routes into it', r);

  -- ── Raw writes ───────────────────────────────────────────────────────────
  r := test.try('E', format($q$UPDATE public.teams SET name = 'Raw' WHERE id = %L$q$, test.id('DS')));
  PERFORM test.ok(r LIKE '42501%' AND (test.team('DS')).name = 'Brand design', 'teams can''t be changed raw', r);
  r := test.try('M', format($q$INSERT INTO public.team_members (workspace_id, team_id, user_id) VALUES (%L, %L, %L)$q$,
    test.id('W'), test.id('DS'), test.id('V')));
  PERFORM test.ok(r LIKE '42501%', 'nor their people added raw', r);
  r := test.try('M', format($q$UPDATE public.team_members SET deleted_at = now() WHERE team_id = %L$q$, test.id('DS')));
  PERFORM test.ok(r LIKE '42501%' AND test.members('DS') = 'E, M, N', 'nor taken out raw', r);
  r := test.try('M', format($q$DELETE FROM public.team_members WHERE team_id = %L$q$, test.id('DS')));
  PERFORM test.ok(r LIKE '42501%' AND test.members('DS') = 'E, M, N', 'nor deleted raw', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET team_routed_at = now() - interval '9 days',
                                  team_check_back_at = now() WHERE id = %L$q$, test.id('T3')));
  PERFORM test.ok((test.task('T3')).team_routed_at > now() - interval '1 minute' AND (test.task('T3')).team_check_back_at IS NULL,
    'a raw write can''t move a routing''s clock or its check-back', r);

  -- ── Who may call what ────────────────────────────────────────────────────
  v_bad := NULL;
  FOREACH v_fn IN ARRAY ARRAY[
    'teams__add_member(public.teams, uuid)', 'teams__check_name(uuid, text, uuid)',
    'teams__check_project(uuid, jsonb)', 'teams__members_of(uuid)', 'teams__route_project(uuid, uuid)',
    'tasks__hand_to_inbox(uuid)', 'tasks__team_check_backs(timestamptz, integer)',
    'tasks__wall_clock(timestamptz, text)', 'tasks__routing_columns_guard()', 'tasks__team_check()',
    'teams_member_removed()', 'tasks_notify_spine()', 'module_activity__gate_recipients()',
    'account_erase_workspace_data(uuid, boolean)'] LOOP
    IF has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE')
       OR has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE') THEN
      v_bad := concat_ws(', ', v_bad, v_fn);
    END IF;
  END LOOP;
  PERFORM test.ok(v_bad IS NULL, 'the helpers behind teams can''t be called by a signed-in person or a visitor', v_bad);
  v_bad := NULL;
  FOREACH v_fn IN ARRAY ARRAY[
    'teams_op_create(uuid, jsonb)', 'teams_op_update(uuid, uuid, jsonb)',
    'teams_op_add_member(uuid, uuid, uuid)', 'teams_op_remove_member(uuid, uuid, uuid)',
    'tasks_op_claim(uuid, uuid)', 'tasks_op_assign(uuid, uuid, uuid)', 'tasks_op_create(uuid, jsonb)',
    'tasks_op_update(uuid, uuid, jsonb)', 'comments_op_mention_teams(uuid, uuid[])'] LOOP
    v_ok := has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE');
    IF NOT v_ok THEN
      v_bad := concat_ws(', ', v_bad, v_fn);
    END IF;
  END LOOP;
  PERFORM test.ok(v_bad IS NULL, 'the team and routing ops are for signed-in people only, never a visitor', v_bad);
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND (p.proname LIKE 'teams%' OR p.proname LIKE 'tasks\_\_team%' OR p.proname = 'tasks__hand_to_inbox')
    AND p.proname LIKE '%\_\_%'
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  PERFORM test.ok(v_bad IS NULL, 'and no other definer-rights team helper is open to them', v_bad);
END;
$$;
