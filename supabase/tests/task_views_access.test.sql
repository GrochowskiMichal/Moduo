-- TV-U8 follow-up · Who may change a saved view
-- (supabase/migrations/20261013271000_task_views_access_fix.sql, on top of
-- 20261013250000_task_views.sql). Someone else's view: only the workspace's
-- owner or an admin, only to take a shared, live view they can see off the
-- workspace; never a delete, a restore, a re-share or an edit. The maker:
-- putting a view in front of the workspace, or changing what a shared one
-- shows, needs Tasks edit. Seeds are only ever the caller's. Reads stay
-- behind the one read rule, never in a Realtime publication.
--
-- Cast: O owns workspace W. E and M are members who work on tasks, A an
-- admin, V a viewer, X owns another workspace W2. P is a project the
-- workspace sees, PB is O's private project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'A', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('A'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W2'), test.id('E'), 'member');

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
CREATE FUNCTION test.sees(p_who text, p_ids uuid[]) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format('SELECT count(*) FROM public.task_views WHERE id = ANY (%L::uuid[])', p_ids))::integer
$$;
CREATE FUNCTION test.create_sql(p_ws text, p_fields jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$SELECT public.task_views_op_create(%L, %L::jsonb)$q$, test.id(p_ws), p_fields)
$$;
CREATE FUNCTION test.update_sql(p_view text, p_patch jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$SELECT public.task_views_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id(p_view), p_patch)
$$;

DO $$
DECLARE
  r text;
  v jsonb;
  v_missing text;
  v_missing_change text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P'), 'name', 'Season 1')));
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PB'), 'name', 'Acquisition plans')));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');

  -- E's shared view of All, M's shared view, O's shared view of PB.
  PERFORM test.op('E', test.create_sql('W', jsonb_build_object('id', test.id('VE'), 'name', 'E''s board', 'shared', true)));
  PERFORM test.op('M', test.create_sql('W', jsonb_build_object('id', test.id('VM'), 'name', 'M''s list', 'shared', true)));
  PERFORM test.op('O', test.create_sql('W', jsonb_build_object('id', test.id('VB'), 'name', 'Acquisition',
    'scope', 'project', 'project_id', test.id('PB'), 'shared', true)));
  PERFORM test.ok(test.sees('A', ARRAY[test.id('VE'), test.id('VM')]) = 2 AND test.sees('A', ARRAY[test.id('VB')]) = 0,
    'the admin sees the two shared views of All, not the private project''s');
  v_missing := test.try('A', test.update_sql('nothing', '{"shared": false}'));
  v_missing_change := test.try('A', test.update_sql('nothing', '{"name": "x"}'));

  -- ── An admin's one power: take a shared, live view they can see down ────
  r := test.try('A', test.update_sql('VE', '{}'));
  PERFORM test.ok(r LIKE '42501%', 'an empty change to someone else''s view is refused (it answers no row)', r);
  r := test.try('A', test.update_sql('VE', '{"deleted": true}'));
  PERFORM test.ok(r LIKE '42501%', 'an admin can''t delete someone else''s view', r);
  r := test.try('A', test.update_sql('VE', '{"shared": false, "name": "Admin''s"}'));
  PERFORM test.ok(r LIKE '42501%', 'nor take it down and rename it at once', r);
  r := test.try('A', test.update_sql('VE', '{"shared": true}'));
  PERFORM test.ok(r LIKE '42501%', 'nor share it', r);
  r := test.try('M', test.update_sql('VE', '{"shared": false}'));
  PERFORM test.ok(r LIKE '42501%', 'a member can''t take someone else''s view down', r);
  r := test.try('V', test.update_sql('VE', '{"shared": false}'));
  PERFORM test.ok(r LIKE '42501%', 'nor can a viewer', r);
  r := test.try('A', test.update_sql('VB', '{"shared": false}'));
  PERFORM test.ok(r = v_missing, 'an admin can''t take down a view they can''t see; it answers like a missing one', r);
  r := test.try('X', test.update_sql('VE', '{"shared": false}'));
  PERFORM test.ok(r LIKE '%isn''t here any more%', 'an outsider gets the not-here answer', r);
  v := test.op('A', test.update_sql('VE', '{"shared": false}'));
  PERFORM test.ok(NOT (v ->> 'shared')::boolean AND test.sees('M', ARRAY[test.id('VE')]) = 0
              AND test.sees('E', ARRAY[test.id('VE')]) = 1,
    'the admin takes it down: it''s E''s alone again', v::text);
  r := test.try('A', test.update_sql('VE', '{"shared": false}'));
  PERFORM test.ok(r = v_missing, 'once down, it''s out of the admin''s reach', r);

  -- ── A view its maker deleted stays deleted ───────────────────────────────
  PERFORM test.op('M', test.update_sql('VM', '{"deleted": true}'));
  PERFORM test.ok(test.sees('A', ARRAY[test.id('VM')]) = 0, 'M deletes their shared view');
  r := test.try('A', test.update_sql('VM', '{"deleted": false}'));
  PERFORM test.ok(r = v_missing_change, 'an admin can''t bring it back; it answers like a missing one', r);
  r := test.try('A', test.update_sql('VM', '{"shared": false}'));
  PERFORM test.ok(r = v_missing, 'nor touch it any other way', r);
  r := test.try('E', test.update_sql('VM', '{"deleted": false}'));
  PERFORM test.ok(r LIKE '%isn''t here any more%', 'nor can anyone else', r);
  PERFORM test.ok(test.sees('A', ARRAY[test.id('VM')]) = 0 AND test.sees('E', ARRAY[test.id('VM')]) = 0,
    'and nobody reads it');

  -- ── The maker: publishing needs Tasks edit ───────────────────────────────
  v := test.op('M', test.update_sql('VM', '{"deleted": false}'));
  PERFORM test.ok(v ->> 'deleted_at' IS NULL AND (v ->> 'shared')::boolean, 'M can restore their own shared view', v::text);
  UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = test.id('W') AND user_id = test.id('M');
  r := test.try('M', test.update_sql('VM', '{"filters": [{"dimension": "due", "operator": "is", "values": ["week"]}]}'));
  PERFORM test.ok(r LIKE '42501%', 'without Tasks edit, M can''t change what their shared view shows', r);
  r := test.try('M', test.update_sql('VM', '{"name": "Renamed"}'));
  PERFORM test.ok(r LIKE '42501%', 'or rename it', r);
  v := test.op('M', test.update_sql('VM', '{"deleted": true}'));
  PERFORM test.ok(v ->> 'deleted_at' IS NOT NULL, 'but can still delete it', v::text);
  r := test.try('M', test.update_sql('VM', '{"deleted": false}'));
  PERFORM test.ok(r LIKE '42501%', 'and can''t bring a shared one back without edit', r);
  v := test.op('M', test.update_sql('VM', '{"deleted": false, "shared": false}'));
  PERFORM test.ok(v ->> 'deleted_at' IS NULL AND NOT (v ->> 'shared')::boolean,
    'they can bring it back as their own', v::text);
  v := test.op('M', test.update_sql('VM', '{"name": "Mine now"}'));
  PERFORM test.ok(v ->> 'name' = 'Mine now', 'and change a view only they see', v::text);
  r := test.try('M', test.update_sql('VM', '{"shared": true}'));
  PERFORM test.ok(r LIKE '42501%', 'but not share it again', r);
  UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = test.id('W') AND user_id = test.id('M');

  -- A maker who no longer sees the project can't publish its view again.
  PERFORM test.op('E', test.create_sql('W', jsonb_build_object('id', test.id('VP'), 'name', 'Season 1 board',
    'scope', 'project', 'project_id', test.id('P'), 'shared', true)));
  PERFORM test.op('E', test.update_sql('VP', '{"deleted": true}'));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('P')
    AND subject_type = 'workspace';
  r := test.try('E', test.update_sql('VP', '{"deleted": false}'));
  PERFORM test.ok(r LIKE '%That project isn''t here any more%', 'restoring a shared view of a project you no longer see is refused', r);
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('P'), 'workspace', 'edit', test.id('O'));

  -- ── Seeds are only ever the caller's ─────────────────────────────────────
  v := test.op('M', test.create_sql('W', '{"name": "Done last week", "seed": "done_last_week"}'));
  PERFORM test.ok(v ->> 'owner_id' = test.id('M')::text, 'M''s seed is M''s', v::text);
  v := test.op('E', test.create_sql('W', '{"name": "Done last week", "seed": "done_last_week"}'));
  PERFORM test.ok(v ->> 'owner_id' = test.id('E')::text AND v ->> 'id' <> (SELECT id::text FROM public.task_views
                                                                         WHERE owner_id = test.id('M') AND seed = 'done_last_week'),
    'E''s same seed makes E''s own view, never answers with M''s', v::text);
  v := test.op('E', test.create_sql('W2', '{"name": "Done last week", "seed": "done_last_week"}'));
  PERFORM test.ok(v ->> 'workspace_id' = test.id('W2')::text,
    'a seed in another workspace is its own view there', v::text);
  r := test.try('E', test.create_sql('W', jsonb_build_object('name', 'x', 'seed', 'done_last_week',
    'owner_id', test.id('M'))));
  PERFORM test.ok(r LIKE '22023%', 'nobody names whose seed it is', r);
  PERFORM test.ok((SELECT count(*) FROM public.task_views WHERE seed = 'done_last_week'
                   AND owner_id IN (test.id('M'), test.id('E'))) = 3,
    'one seeded view per person and workspace');

  -- ── Reads: one rule, no live feed, nothing across workspaces ─────────────
  PERFORM test.ok(test.sees('X', ARRAY[test.id('VE'), test.id('VM'), test.id('VB'), test.id('VP')]) = 0,
    'an outsider reads none of W''s views');
  PERFORM test.ok(test.value_as('X', format('SELECT public.task_views__readable(%L)', test.id('VE'))) = 'false'
              AND test.value_as('X', format('SELECT public.task_views__readable(%L)', test.id('nothing'))) = 'false',
    'the read helper says the same for a view elsewhere and a missing one');
  PERFORM test.ok(test.value_as('E', format('SELECT count(*) FROM public.task_views WHERE workspace_id = %L', test.id('W2'))) = '1'
              AND test.value_as('M', format('SELECT count(*) FROM public.task_views WHERE workspace_id = %L', test.id('W2'))) = '0',
    'a member of two workspaces reads their own view in each; others read nothing of W2');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE tablename = 'task_views'),
    'views are in no Realtime publication');
  PERFORM test.ok(has_function_privilege('authenticated', 'public.task_views_op_update(uuid, uuid, jsonb)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.task_views_op_update(uuid, uuid, jsonb)', 'EXECUTE'),
    'the op keeps its grants');
END;
$$;
