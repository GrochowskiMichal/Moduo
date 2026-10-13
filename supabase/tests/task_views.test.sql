-- TV-U8 · Saved views (supabase/migrations/20261013250000_task_views.sql).
-- specs/tasks-v3.md block 21, AC11.1: views are personal until shared; a
-- shared view stores a filter, never results, and never shows a project (or
-- its own name and filter) to someone who can't see that project; writes go
-- through the ops; a view you can't see answers like one that isn't there.
--
-- Cast: O owns workspace W. E and M are members who work on tasks, A an
-- admin, V a viewer, X owns another workspace W2 (the outsider). P is a
-- project the workspace sees; PB is O's private project; PE is E's private
-- project. K is an API key in W.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'A', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('A'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-views'),
        '{"tasks": "edit"}'::jsonb, test.id('E')),
       (test.id('KV'), test.id('W'), 'Read-only agent', 'mdo_tsv', md5('db-test-key-views-ro'),
        '{"tasks": "view"}'::jsonb, test.id('E'));
-- A tag of each workspace, and a team of each.
INSERT INTO public.tags (id, workspace_id, owner_id, name) VALUES
  (test.id('TG'), test.id('W'), test.id('O'), 'legal'),
  (test.id('TG2'), test.id('W2'), test.id('X'), 'elsewhere');
INSERT INTO public.teams (id, workspace_id, name, mark, created_by) VALUES
  (test.id('TM'), test.id('W'), 'Design', 'DE', test.id('O')),
  (test.id('TM2'), test.id('W2'), 'Their team', 'TT', test.id('X'));

-- An op's answer, run as a signed-in person.
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
-- How many of these views someone reads through the policy.
CREATE FUNCTION test.sees(p_who text, p_ids uuid[]) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format('SELECT count(*) FROM public.task_views WHERE id = ANY (%L::uuid[])', p_ids))::integer
$$;
CREATE FUNCTION test.create_sql(p_fields jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$SELECT public.task_views_op_create(%L, %L::jsonb)$q$, test.id('W'), p_fields)
$$;
CREATE FUNCTION test.update_sql(p_ws text, p_view text, p_patch jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$SELECT public.task_views_op_update(%L, %L, %L::jsonb)$q$, test.id(p_ws), test.id(p_view), p_patch)
$$;

DO $$
DECLARE
  r text;
  v jsonb;
  v_missing text;
BEGIN
  -- ── Projects ──────────────────────────────────────────────────────────────
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P'), 'name', 'Season 1')));
  PERFORM test.ok(r = 'ok 1', 'the shared project is made', r);
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PB'), 'name', 'Acquisition plans')));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
  r := test.as_user('E', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PE'), 'name', 'E''s side project')));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PE');
  PERFORM test.ok(public.projects__visible_to(test.id('PB'), test.id('O'))
              AND NOT public.projects__visible_to(test.id('PB'), test.id('M'))
              AND NOT public.projects__visible_to(test.id('PB'), test.id('E'))
              AND NOT public.projects__visible_to(test.id('PE'), test.id('M')),
    'PB is O''s alone and PE is E''s alone');

  -- ── A personal view ───────────────────────────────────────────────────────
  v := test.op('E', test.create_sql(jsonb_build_object(
    'id', test.id('V1'), 'name', 'Due this week', 'scope', 'all',
    'filters', '[{"dimension": "due", "operator": "is", "values": ["week"]}]'::jsonb,
    'display', '{"layout": "board", "rows": "detailed", "properties": ["date", "assignee"]}'::jsonb)));
  PERFORM test.ok(v ->> 'owner_id' = test.id('E')::text AND NOT (v ->> 'shared')::boolean
              AND v -> 'filters' -> 0 ->> 'dimension' = 'due' AND v -> 'display' ->> 'layout' = 'board',
    'E saves a view: personal, with its filter and Display', v::text);
  PERFORM test.ok(test.sees('E', ARRAY[test.id('V1')]) = 1, 'E reads their own view');
  PERFORM test.ok(test.sees('M', ARRAY[test.id('V1')]) = 0
              AND test.sees('O', ARRAY[test.id('V1')]) = 0
              AND test.sees('A', ARRAY[test.id('V1')]) = 0
              AND test.sees('X', ARRAY[test.id('V1')]) = 0,
    'nobody else reads a personal view: not a teammate, the owner, an admin or an outsider');
  PERFORM test.ok(NOT has_table_privilege('anon', 'public.task_views', 'SELECT'),
    'anon can''t read the table at all');

  -- A resend answers with what the first one made.
  v := test.op('E', test.create_sql(jsonb_build_object('id', test.id('V1'), 'name', 'Something else')));
  PERFORM test.ok(v ->> 'name' = 'Due this week'
              AND (SELECT count(*) FROM public.task_views WHERE owner_id = test.id('E')) = 1,
    'a resend makes nothing new', v::text);
  -- Someone else's id can't be taken over.
  r := test.try('M', test.create_sql(jsonb_build_object('id', test.id('V1'), 'name', 'Mine now')));
  PERFORM test.ok(r LIKE '%can''t be saved%', 'another person''s view id isn''t yours to reuse', r);

  -- ── Sharing ───────────────────────────────────────────────────────────────
  v := test.op('E', test.update_sql('W', 'V1', '{"shared": true}'));
  PERFORM test.ok((v ->> 'shared')::boolean, 'E shares the view with the workspace', v::text);
  PERFORM test.ok(test.sees('M', ARRAY[test.id('V1')]) = 1
              AND test.sees('V', ARRAY[test.id('V1')]) = 1
              AND test.sees('O', ARRAY[test.id('V1')]) = 1,
    'teammates, the owner and a viewer read a shared view');
  PERFORM test.ok(test.sees('X', ARRAY[test.id('V1')]) = 0, 'an outsider still reads nothing');

  -- Only the maker changes it.
  r := test.try('M', test.update_sql('W', 'V1', '{"name": "Mine"}'));
  PERFORM test.ok(r LIKE '42501%Only the person who made a view%', 'a teammate can''t rename a shared view', r);
  r := test.try('M', test.update_sql('W', 'V1', '{"filters": []}'));
  PERFORM test.ok(r LIKE '42501%', 'or change its filter', r);
  r := test.try('M', test.update_sql('W', 'V1', '{"deleted": true}'));
  PERFORM test.ok(r LIKE '42501%', 'or delete it', r);
  r := test.try('A', test.update_sql('W', 'V1', '{"name": "Admin''s now"}'));
  PERFORM test.ok(r LIKE '42501%', 'an admin can''t rename it either', r);
  r := test.try('M', format($q$SELECT public.task_views_op_move(%L, %L, 'up')$q$, test.id('W'), test.id('V1')));
  PERFORM test.ok(r LIKE '42501%', 'or move it', r);

  -- An admin can unshare it; then it's E's alone again.
  v := test.op('A', test.update_sql('W', 'V1', '{"shared": false}'));
  PERFORM test.ok(NOT (v ->> 'shared')::boolean AND test.sees('M', ARRAY[test.id('V1')]) = 0,
    'an admin unshares a shared view; teammates no longer read it', v::text);
  -- Once unshared, it's out of the admin's reach too, like one that isn't there.
  v_missing := test.try('A', test.update_sql('W', 'nothing', '{"deleted": true}'));
  r := test.try('A', test.update_sql('W', 'V1', '{"deleted": true}'));
  PERFORM test.ok(r LIKE '%isn''t here any more%' AND r = v_missing,
    'a view you can''t see answers like one that doesn''t exist', r);

  -- ── A shared view over a project the reader can't see ─────────────────────
  v := test.op('O', test.create_sql(jsonb_build_object(
    'id', test.id('VB'), 'name', 'Acquisition: waiting on lawyers', 'scope', 'project',
    'project_id', test.id('PB'), 'shared', true,
    'filters', jsonb_build_array(jsonb_build_object('dimension', 'tag', 'operator', 'is',
                                                    'values', jsonb_build_array(test.id('TG')))))));
  PERFORM test.ok(v ->> 'project_id' = test.id('PB')::text AND (v ->> 'shared')::boolean,
    'O shares a view of their private project', v::text);
  PERFORM test.ok(test.sees('O', ARRAY[test.id('VB')]) = 1
              AND test.sees('M', ARRAY[test.id('VB')]) = 0
              AND test.sees('E', ARRAY[test.id('VB')]) = 0
              AND test.sees('V', ARRAY[test.id('VB')]) = 0,
    'its name and filter reach nobody who can''t see the project');
  r := test.try('M', test.update_sql('W', 'VB', '{"name": "x"}'));
  PERFORM test.ok(r LIKE '%isn''t here any more%' AND r = test.try('M', test.update_sql('W', 'nothing', '{"name": "x"}')),
    'touching it answers like a view that doesn''t exist', r);
  r := test.try('M', format($q$SELECT public.task_views_op_move(%L, %L, 'up')$q$, test.id('W'), test.id('VB')));
  PERFORM test.ok(r LIKE '%isn''t here any more%'
              AND r = test.try('M', format($q$SELECT public.task_views_op_move(%L, %L, 'up')$q$, test.id('W'), test.id('nothing'))),
    'moving it answers the same', r);
  -- Sharing the project shows the view; taking it back hides it again.
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('PB'), 'member', test.id('M'), 'view', test.id('O'));
  PERFORM test.ok(test.sees('M', ARRAY[test.id('VB')]) = 1 AND test.sees('E', ARRAY[test.id('VB')]) = 0,
    'once M may see the project, M reads the view; E still doesn''t');
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
  PERFORM test.ok(test.sees('M', ARRAY[test.id('VB')]) = 0, 'taking the project back hides the view');

  -- Nobody makes a view of a project they can't see, and the answer is the
  -- same as for a project that doesn't exist.
  v_missing := test.try('M', test.create_sql(jsonb_build_object(
    'name', 'Peek', 'scope', 'project', 'project_id', test.id('no project'))));
  r := test.try('M', test.create_sql(jsonb_build_object('name', 'Peek', 'scope', 'project', 'project_id', test.id('PB'))));
  PERFORM test.ok(r LIKE '%That project isn''t here any more%' AND r = v_missing,
    'a hidden project answers like a missing one', r);
  r := test.try('X', test.create_sql(jsonb_build_object('name', 'Peek', 'scope', 'project', 'project_id', test.id('P'))));
  PERFORM test.ok(r LIKE '%isn''t here any more%', 'an outsider makes no view in W', r);
  -- Someone's Inbox isn't a project to view.
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Peek', 'scope', 'project',
    'project_id', public.tasks__inbox(test.id('W'), test.id('E')))));
  PERFORM test.ok(r LIKE '%That project isn''t here any more%', 'not even your own Inbox is a view''s project', r);

  -- A personal view of your own private project stays yours, and shares
  -- only to people who can see the project.
  v := test.op('E', test.create_sql(jsonb_build_object(
    'id', test.id('VE'), 'name', 'Side project, mine', 'scope', 'project', 'project_id', test.id('PE'))));
  v := test.op('E', test.update_sql('W', 'VE', '{"shared": true}'));
  PERFORM test.ok((v ->> 'shared')::boolean AND test.sees('M', ARRAY[test.id('VE')]) = 0
              AND test.sees('O', ARRAY[test.id('VE')]) = 0,
    'a shared view of E''s private project still reaches nobody else', v::text);

  -- ── A shared view of a visible project, and the reader's own scopes ──────
  v := test.op('M', test.create_sql(jsonb_build_object(
    'id', test.id('VP'), 'name', 'Season 1 board', 'scope', 'project', 'project_id', test.id('P'), 'shared', true)));
  PERFORM test.ok(test.sees('E', ARRAY[test.id('VP')]) = 1 AND test.sees('V', ARRAY[test.id('VP')]) = 1
              AND test.sees('X', ARRAY[test.id('VP')]) = 0,
    'a shared view of a project everyone sees reaches everyone in W, and no outsider');
  -- Making the project private takes the view out of everyone else's reach.
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('P')
    AND subject_type = 'workspace';
  PERFORM test.ok(test.sees('E', ARRAY[test.id('VP')]) = 0 AND test.sees('O', ARRAY[test.id('VP')]) = 1,
    'when the project turns private, only people who still see it read the view');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('P'), 'workspace', 'edit', test.id('O'));

  -- ── Who may keep and share views ──────────────────────────────────────────
  v := test.op('V', test.create_sql(jsonb_build_object('id', test.id('VV'), 'name', 'What I watch', 'scope', 'mine')));
  PERFORM test.ok(v ->> 'scope' = 'mine', 'a viewer keeps their own views', v::text);
  r := test.try('V', test.update_sql('W', 'VV', '{"shared": true}'));
  PERFORM test.ok(r LIKE '42501%', 'but sharing one needs edit access', r);
  r := test.try('V', test.create_sql(jsonb_build_object('name', 'Shared by a viewer', 'shared', true)));
  PERFORM test.ok(r LIKE '42501%', 'also when saving it shared', r);
  r := test.as_key('K', test.create_sql(jsonb_build_object('name', 'From an agent')));
  PERFORM test.ok(r LIKE '42501%Views are changed in the app%', 'an API key can''t save a view', r);
  r := test.as_key('K', test.update_sql('W', 'V1', '{"name": "From an agent"}'));
  PERFORM test.ok(r LIKE '42501%', 'or change one', r);
  r := test.try('X', test.update_sql('W', 'V1', '{"name": "x"}'));
  PERFORM test.ok(r LIKE '%isn''t here any more%' AND r = test.try('X', test.update_sql('W', 'nothing', '{"name": "x"}')),
    'an outsider touching a view in W gets the not-here answer', r);
  r := test.try('X', test.update_sql('W2', 'V1', '{"name": "x"}'));
  PERFORM test.ok(r LIKE '%isn''t here any more%', 'or through their own workspace', r);

  -- Raw writes are refused: the ops are the only way in.
  r := test.try('E', format($q$INSERT INTO public.task_views (workspace_id, owner_id, name, scope)
                              VALUES (%L, %L, 'Raw', 'all')$q$, test.id('W'), test.id('E')));
  PERFORM test.ok(r LIKE '42501%', 'a raw insert is refused', r);
  r := test.try('E', format($q$UPDATE public.task_views SET shared = true WHERE id = %L$q$, test.id('VV')));
  PERFORM test.ok(r LIKE '42501%', 'a raw update is refused', r);
  r := test.try('E', format($q$DELETE FROM public.task_views WHERE id = %L$q$, test.id('V1')));
  PERFORM test.ok(r LIKE '42501%', 'a raw delete is refused', r);
  PERFORM test.ok(NOT has_table_privilege('authenticated', 'public.task_views', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.task_views', 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.task_views', 'DELETE')
              AND NOT has_table_privilege('authenticated', 'public.task_views', 'TRUNCATE')
              AND NOT has_table_privilege('anon', 'public.task_views', 'TRUNCATE'),
    'no client role writes or truncates the table');
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.task_views_op_create(uuid, jsonb)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.task_views_op_update(uuid, uuid, jsonb)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.task_views_op_move(uuid, uuid, text)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.task_views_op_create(uuid, jsonb)', 'EXECUTE'),
    'anon runs no op; signed-in people do');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.task_views__sees(uuid, boolean, uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.task_views__actor(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.task_views__check_filters(uuid, jsonb)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.task_views__check_display(jsonb)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.task_views__sees(uuid, boolean, uuid, uuid)', 'EXECUTE'),
    'the helpers are service only');
  r := test.try('M', format($q$SELECT public.task_views__sees(%L, true, %L, %L)$q$, test.id('O'), test.id('PB'), test.id('M')));
  PERFORM test.ok(r LIKE '42501%', 'nobody asks the visibility helper about someone else', r);

  -- ── Shapes ────────────────────────────────────────────────────────────────
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Bad',
    'filters', '[{"dimension": "due", "operator": "is_maybe", "values": ["week"]}]'::jsonb)));
  PERFORM test.ok(r LIKE '22023%', 'an unknown operator is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Bad',
    'filters', '[{"dimension": "due", "operator": "is", "values": [], "extra": 1}]'::jsonb)));
  PERFORM test.ok(r LIKE '22023%', 'a malformed condition is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Bad',
    'filters', jsonb_build_array(jsonb_build_object('dimension', 'tag', 'operator', 'any_of',
      'values', (SELECT jsonb_agg(g::text) FROM generate_series(1, 101) g))))));
  PERFORM test.ok(r LIKE '22023%', 'a condition with too many values is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Bad', 'display', '{"layout": {"nested": true}}'::jsonb)));
  PERFORM test.ok(r LIKE '22023%', 'a Display that isn''t one level of words is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Bad', 'scope', 'today')));
  PERFORM test.ok(r LIKE '22023%', 'Focus isn''t a view''s scope', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Bad', 'scope', 'all', 'project_id', test.id('P'))));
  PERFORM test.ok(r LIKE '22023%', 'only a project view keeps a project', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', '   ')));
  PERFORM test.ok(r LIKE '22023%needs a name%', 'a view needs a name', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Bad', 'owner_id', test.id('M'))));
  PERFORM test.ok(r LIKE '22023%', 'nobody names a view''s owner', r);

  -- A view keeps only this workspace's people, teams and tags, and the
  -- app's own words: nothing from elsewhere, nothing it can't read back.
  v := test.op('E', test.create_sql(jsonb_build_object('name', 'Legal, Design, me',
    'filters', jsonb_build_array(
      jsonb_build_object('dimension', 'tag', 'operator', 'is', 'values', jsonb_build_array(test.id('TG'))),
      jsonb_build_object('dimension', 'team', 'operator', 'any_of', 'values', jsonb_build_array(test.id('TM'), 'none')),
      jsonb_build_object('dimension', 'assignee', 'operator', 'is', 'values', jsonb_build_array(test.id('E'))),
      jsonb_build_object('dimension', 'creator', 'operator', 'is', 'values', jsonb_build_array(test.id('O'))),
      jsonb_build_object('dimension', 'waiting', 'operator', 'is', 'values', jsonb_build_array('any'))))));
  PERFORM test.ok(jsonb_array_length(v -> 'filters') = 5, 'this workspace''s tag, team and people save', v::text);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Leak',
    'filters', jsonb_build_array(jsonb_build_object('dimension', 'tag', 'operator', 'is',
      'values', jsonb_build_array(test.id('TG2')))))));
  PERFORM test.ok(r LIKE '22023%tag that isn''t in this workspace%', 'another workspace''s tag is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Leak',
    'filters', jsonb_build_array(jsonb_build_object('dimension', 'team', 'operator', 'is',
      'values', jsonb_build_array(test.id('TM2')))))));
  PERFORM test.ok(r LIKE '22023%team that isn''t in this workspace%', 'another workspace''s team is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Leak',
    'filters', jsonb_build_array(jsonb_build_object('dimension', 'assignee', 'operator', 'is',
      'values', jsonb_build_array(test.id('X')))))));
  PERFORM test.ok(r LIKE '22023%someone who isn''t in this workspace%', 'someone from outside is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Leak',
    'filters', jsonb_build_array(jsonb_build_object('dimension', 'project', 'operator', 'is',
      'values', jsonb_build_array(test.id('PB')))))));
  PERFORM test.ok(r LIKE '22023%', 'a dimension the app doesn''t have (a project id) is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Leak',
    'filters', jsonb_build_array(jsonb_build_object('dimension', 'status', 'operator', 'is',
      'values', jsonb_build_array(test.id('PB')))))));
  PERFORM test.ok(r LIKE '22023%', 'an id where a word belongs is refused', r);
  r := test.try('E', test.create_sql(jsonb_build_object('name', 'Leak', 'display',
    jsonb_build_object('group', test.id('PB')))));
  PERFORM test.ok(r LIKE '22023%', 'an id in Display is refused', r);
  r := test.try('E', test.update_sql('W', 'V1', jsonb_build_object('filters', jsonb_build_array(
    jsonb_build_object('dimension', 'tag', 'operator', 'is', 'values', jsonb_build_array(test.id('TG2')))))));
  PERFORM test.ok(r LIKE '22023%', 'and the same when saving changes', r);

  -- Sharing a view of a project you no longer see is refused, like a
  -- project that isn't there.
  v := test.op('M', test.create_sql(jsonb_build_object(
    'id', test.id('VM'), 'name', 'Season 1, mine', 'scope', 'project', 'project_id', test.id('P'))));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('P')
    AND subject_type = 'workspace';
  r := test.try('M', test.update_sql('W', 'VM', '{"shared": true}'));
  PERFORM test.ok(r LIKE '%That project isn''t here any more%', 'nobody shares a view of a project they can''t see', r);
  PERFORM test.ok(test.sees('M', ARRAY[test.id('VM')]) = 1, 'their own view of it stays theirs');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('P'), 'workspace', 'edit', test.id('O'));

  -- A key that may only read Tasks writes nothing either.
  r := test.as_key('KV', test.create_sql(jsonb_build_object('name', 'From a reader')));
  PERFORM test.ok(r LIKE '42501%', 'a view-only key can''t save a view', r);
  r := test.as_key('KV', format($q$SELECT public.task_views_op_move(%L, %L, 'up')$q$, test.id('W'), test.id('V1')));
  PERFORM test.ok(r LIKE '42501%', 'or move one', r);

  -- ── Seeds: once per person, workspace and seed ────────────────────────────
  v := test.op('E', test.create_sql(jsonb_build_object('name', 'Done last week', 'seed', 'done_last_week',
    'filters', '[{"dimension": "completed", "operator": "is", "values": ["last_week"]}]'::jsonb)));
  r := v ->> 'id';
  v := test.op('E', test.create_sql(jsonb_build_object('name', 'Done last week', 'seed', 'done_last_week')));
  PERFORM test.ok(v ->> 'id' = r AND (SELECT count(*) FROM public.task_views
                                      WHERE owner_id = test.id('E') AND seed = 'done_last_week') = 1,
    'a seed made twice is one view', v::text);
  PERFORM test.op('E', format($q$SELECT public.task_views_op_update(%L, %L, '{"deleted": true}'::jsonb)$q$, test.id('W'), r));
  v := test.op('E', test.create_sql(jsonb_build_object('name', 'Done last week', 'seed', 'done_last_week')));
  PERFORM test.ok(v ->> 'deleted_at' IS NOT NULL
              AND (SELECT count(*) FROM public.task_views
                   WHERE owner_id = test.id('E') AND seed = 'done_last_week' AND deleted_at IS NULL) = 0,
    'a deleted seed never comes back', v::text);
  v := test.op('M', test.create_sql(jsonb_build_object('name', 'Done last week', 'seed', 'done_last_week')));
  PERFORM test.ok(v ->> 'owner_id' = test.id('M')::text, 'each person gets their own seeded view', v::text);

  -- ── Delete and Undo, and order ────────────────────────────────────────────
  v := test.op('E', test.update_sql('W', 'V1', '{"deleted": true}'));
  PERFORM test.ok(v ->> 'deleted_at' IS NOT NULL AND test.sees('E', ARRAY[test.id('V1')]) = 0,
    'E deletes their view; it''s gone from reads', v::text);
  v := test.op('E', test.update_sql('W', 'V1', '{"deleted": false}'));
  PERFORM test.ok(v ->> 'deleted_at' IS NULL AND test.sees('E', ARRAY[test.id('V1')]) = 1,
    'and Undo brings it back', v::text);
  PERFORM test.op('E', test.create_sql(jsonb_build_object('id', test.id('V2'), 'name', 'Second')));
  PERFORM test.op('E', test.create_sql(jsonb_build_object('id', test.id('V3'), 'name', 'Third')));
  v := test.op('E', format($q$SELECT public.task_views_op_move(%L, %L, 'up')$q$, test.id('W'), test.id('V3')));
  PERFORM test.ok((SELECT string_agg(e ->> 'name', ' · ' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY AS t(e, ord))
                  = 'Due this week · Side project, mine · Legal, Design, me · Third · Second',
    'moving a view up swaps it with the one above', v::text);
  v := test.op('E', format($q$SELECT public.task_views_op_move(%L, %L, 'up')$q$, test.id('W'), test.id('V1')));
  PERFORM test.ok((SELECT e ->> 'name' FROM jsonb_array_elements(v) WITH ORDINALITY AS t(e, ord) WHERE ord = 1)
                  = 'Due this week',
    'the first view going up stays first', v::text);

  -- An admin deletes a shared view (and can undo it); the maker still can't
  -- be overruled on its name.
  v := test.op('A', test.update_sql('W', 'VP', '{"deleted": true}'));
  PERFORM test.ok(v ->> 'deleted_at' IS NOT NULL AND test.sees('E', ARRAY[test.id('VP')]) = 0,
    'an admin deletes a shared view', v::text);
  v := test.op('A', test.update_sql('W', 'VP', '{"deleted": false}'));
  PERFORM test.ok(v ->> 'deleted_at' IS NULL, 'and can undo it', v::text);

  -- ── Erasure takes a person's views (shared ones too), nobody else's ──────
  v := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v ->> 'views_deleted')::int = (SELECT count(*) FROM public.task_views WHERE owner_id = test.id('E'))
              AND (v ->> 'views_deleted')::int >= 4,
    'erasure counts E''s views', v ->> 'views_deleted');
  PERFORM test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('E')), false);
  PERFORM set_config('share.bypass', '', true);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.task_views WHERE owner_id = test.id('E'))
              AND EXISTS (SELECT 1 FROM public.task_views WHERE owner_id = test.id('M'))
              AND EXISTS (SELECT 1 FROM public.task_views WHERE owner_id = test.id('O')),
    'and removes them, and nobody else''s');
END;
$$;
