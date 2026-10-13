-- TV-SEC1 · The access check answers only for the caller unless called from
-- a server function (supabase/migrations/20261013260000_access_check_caller.sql).
--
-- Cast: O owns workspace W. E and M are members. X owns W2. SB is a shared
-- project; PE is O's project shared with E only (Edit); PV is O's project
-- shared with M at View. T1 sits in PE, T2 in SB. KE is E's API key, KM is M's.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('PE'), test.id('W'), test.id('O'), 'Brand vault', false),
  (test.id('PV'), test.id('W'), test.id('O'), 'Board notes', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id IN (test.id('PE'), test.id('PV'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PE'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('M'), 'view', test.id('O'));
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('T1'), test.id('W'), test.id('PE'), test.id('O'), 'Vault task', 'todo'),
  (test.id('T2'), test.id('W'), test.id('SB'), test.id('O'), 'Shared task', 'todo'),
  (test.id('T3'), test.id('W'), test.id('PV'), test.id('O'), 'Board task', 'todo');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KE'), test.id('W'), 'E agent', 'mdo_ke', md5('db-test-ke'), '{"tasks": "edit"}'::jsonb, test.id('E')),
  (test.id('KM'), test.id('W'), 'M agent', 'mdo_km', md5('db-test-km'), '{"tasks": "edit"}'::jsonb, test.id('M'));

-- The caller's form, asked by a signed-in client.
CREATE FUNCTION test.can(p_who text, p_type text, p_item text, p_min text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format('SELECT public.can_access(%L, %L, %L)', p_type, test.id(p_item), p_min))
$$;

-- The four-argument form, tried by a signed-in client naming p_about.
CREATE FUNCTION test.ask(p_who text, p_type text, p_item text, p_min text, p_about text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.try(p_who, format('SELECT public.can_access(%L, %L, %L, %L::uuid)', p_type, test.id(p_item), p_min,
                                CASE WHEN p_about IS NULL THEN NULL ELSE test.id(p_about)::text END))
$$;

-- A statement run as the service role, without a key (an Edge Function).
CREATE FUNCTION test.as_service(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  SET LOCAL ROLE service_role;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN 'ERROR ' || SQLERRM;
END;
$$;

-- A statement run as an anonymous visitor.
CREATE FUNCTION test.as_anon(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
  v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  SET LOCAL ROLE anon;
  EXECUTE p_sql;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v_state || ' ' || v_msg;
END;
$$;

DO $$
DECLARE
  r text;
  v_sql text;
  v_four regprocedure := 'public.can_access(text, uuid, text, uuid)'::regprocedure;
  v_three regprocedure := 'public.can_access(text, uuid, text)'::regprocedure;
BEGIN
  -- ── The shape a later re-cut must keep ───────────────────────────────────
  PERFORM test.ok((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE p.proname = 'can_access' AND n.nspname = 'public') = 2
                  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                  WHERE p.proname = 'can_access' AND n.nspname <> 'public'),
    'exactly two can_access: the rules (four arguments) and the caller''s form (three)');
  PERFORM test.ok((SELECT prosecdef AND pronargdefaults = 0 FROM pg_proc WHERE oid = v_four),
    'the four-argument form runs as its owner and has no default (a default makes three-argument calls ambiguous)');
  PERFORM test.ok(NOT has_function_privilege('authenticated', v_four, 'EXECUTE')
                  AND NOT has_function_privilege('anon', v_four, 'EXECUTE')
                  AND has_function_privilege('service_role', v_four, 'EXECUTE')
                  AND has_function_privilege('postgres', v_four, 'EXECUTE'),
    'the four-argument form: server code only');
  PERFORM test.ok((SELECT prosecdef FROM pg_proc WHERE oid = v_three)
                  AND has_function_privilege('authenticated', v_three, 'EXECUTE')
                  AND NOT has_function_privilege('anon', v_three, 'EXECUTE'),
    'the caller''s form: signed-in clients and policies');
  PERFORM test.ok(NOT has_schema_privilege('authenticated', 'private', 'USAGE')
                  AND NOT has_schema_privilege('anon', 'private', 'USAGE'),
    'clients have no use of the private schema');
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = v_four)
    AND (SELECT count(DISTINCT d.objid) FROM pg_depend d
         WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = v_three) >= 17,
    'every policy uses the caller''s form');

  -- ── A client asking about itself ─────────────────────────────────────────
  r := test.can('E', 'task', 'T1', 'view');
  PERFORM test.ok(r = 'true', 'E sees T1', r);
  r := test.can('E', 'task', 'T1', 'edit');
  PERFORM test.ok(r = 'true', 'E can edit T1', r);
  r := test.can('M', 'task', 'T1', 'view');
  PERFORM test.ok(r = 'false', 'M does not see T1', r);
  r := test.can('M', 'task', 'T2', 'view');
  PERFORM test.ok(r = 'true', 'M sees T2', r);
  r := test.can('O', 'bucket', 'PE', 'full');
  PERFORM test.ok(r = 'true', 'O holds PE in full', r);
  r := test.can('M', 'task', 'T9', 'view');
  PERFORM test.ok(r = 'false', 'an item that does not exist reads false', r);

  -- ── A client cannot name a person ────────────────────────────────────────
  r := test.ask('M', 'task', 'T1', 'view', 'E');
  PERFORM test.ok(r LIKE '42501 permission denied for function can_access%', 'M naming E is refused', r);
  r := test.ask('E', 'task', 'T2', 'view', 'M');
  PERFORM test.ok(r LIKE '42501 permission denied for function can_access%', 'E naming M is refused', r);
  r := test.ask('E', 'task', 'T1', 'view', 'E');
  PERFORM test.ok(r LIKE '42501 permission denied for function can_access%', 'naming yourself is refused too: the client form takes no person', r);
  r := test.ask('E', 'task', 'T1', 'view', NULL);
  PERFORM test.ok(r LIKE '42501 permission denied for function can_access%', 'so is the four-argument form with no one named', r);
  r := test.as_anon(format('SELECT public.can_access(%L, %L, %L)', 'task', test.id('T1'), 'view'));
  PERFORM test.ok(r LIKE '42501 permission denied for function can_access%', 'an anonymous visitor gets neither form', r);
  r := test.try('M', format('SELECT private.can_access(%L, %L, %L, %L)', 'task', test.id('T1'), 'view', test.id('E')));
  PERFORM test.ok(r LIKE '42501 permission denied for schema private%' OR r LIKE '42883%',
    'nothing in the private schema answers a client', r);

  -- ── Server functions still ask about others ──────────────────────────────
  PERFORM test.ok(public.can_access('task', test.id('T1'), 'view', test.id('E'))
                  AND NOT public.can_access('task', test.id('T1'), 'view', test.id('M')),
    'from the server, the check answers for E (yes) and M (no)');
  PERFORM test.ok(public.tasks__visible_to(test.id('T1'), test.id('E'))
                  AND public.tasks__editable_to(test.id('T1'), test.id('E'))
                  AND NOT public.tasks__visible_to(test.id('T1'), test.id('M'))
                  AND public.tasks__visible_to(test.id('T2'), test.id('M')),
    'tasks__visible_to / tasks__editable_to answer for others');
  r := test.as_service(format('SELECT public.can_access(%L, %L, %L, %L)', 'task', test.id('T1'), 'view', test.id('E')));
  PERFORM test.ok(r = 'true', 'the service role asks about E', r);
  r := test.as_service(format('SELECT public.can_access(%L, %L, %L, %L)', 'task', test.id('T1'), 'view', test.id('M')));
  PERFORM test.ok(r = 'false', 'the service role asks about M', r);

  -- Through a server function a client calls: the assign warning, to someone
  -- who can assign in the project, about someone who works here.
  r := test.value_as('O', format('SELECT public.share_assign_preview(%L, %L)', test.id('PE'), test.id('M')));
  PERFORM test.ok(r LIKE 'M can''t see "Brand vault"%', 'the assign warning names M, who cannot see PE', r);
  r := test.value_as('O', format('SELECT public.share_assign_preview(%L, %L)', test.id('PE'), test.id('E')));
  PERFORM test.ok(r IS NULL, 'no warning for E, who can', r);
  r := test.value_as('O', format('SELECT public.share_assign_preview(%L, %L)', test.id('PE'), test.id('X')));
  PERFORM test.ok(r IS NULL, 'no answer about someone outside the workspace', r);
  r := test.value_as('X', format('SELECT public.share_assign_preview(%L, %L)', test.id('PE'), test.id('M')));
  PERFORM test.ok(r IS NULL, 'no answer to someone who cannot see the project', r);
  r := test.value_as('M', format('SELECT public.share_assign_preview(%L, %L)', test.id('PV'), test.id('E')));
  PERFORM test.ok(r IS NULL, 'no answer to someone who sees the project but cannot assign in it', r);
  r := test.value_as('O', format('SELECT public.share_assign_preview(%L, %L)', test.id('PV'), test.id('E')));
  PERFORM test.ok(r LIKE 'E can''t see "Board notes"%', 'while its owner gets the warning', r);

  -- Mentions answer only to someone who can edit the task.
  r := test.try('M', format('SELECT public.tasks_op_mention(%L, %L, ARRAY[%L]::uuid[])', test.id('W'), test.id('T1'), test.id('E')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'M cannot mention people on T1', r);

  -- Assigning: the trigger asks whether the assignee can edit the project.
  PERFORM test.ok(public.can_access('bucket', test.id('SB'), 'edit', test.id('E')), 'E can edit SB (setup)');
  r := test.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', test.id('W'), test.id('T2'), test.id('E')));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'task' AND g.resource_id = test.id('T2') AND g.subject_id = test.id('E')),
    'assigning T2 to E adds no share: the trigger saw E can edit SB', r);
  r := test.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, %L)', test.id('W'), test.id('T1'), test.id('M')));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'task' AND g.resource_id = test.id('T1') AND g.subject_id = test.id('M')
        AND g.origin = 'assign'),
    'assigning T1 to M shares it with M: the trigger saw M cannot edit PE', r);
  r := test.can('M', 'task', 'T1', 'view');
  PERFORM test.ok(r = 'true', 'M now sees T1', r);
  r := test.as_user('O', format('SELECT public.tasks_op_assign(%L, %L, NULL)', test.id('W'), test.id('T1')));
  r := test.can('M', 'task', 'T1', 'view');
  PERFORM test.ok(r = 'false', 'unassigning M takes it away again', r);

  -- ── Row-level security reads and writes still work ───────────────────────
  r := test.value_as('E', format('SELECT count(*) FROM public.tasks WHERE workspace_id = %L', test.id('W')));
  PERFORM test.ok(r = '2', 'E reads T1 and T2', r);
  r := test.value_as('M', format('SELECT count(*) FROM public.tasks WHERE workspace_id = %L', test.id('W')));
  PERFORM test.ok(r = '2', 'M reads T2 and T3', r);
  r := test.value_as('X', format('SELECT count(*) FROM public.tasks WHERE workspace_id = %L', test.id('W')));
  PERFORM test.ok(r = '0', 'X reads none', r);
  r := test.value_as('M', format('SELECT count(*) FROM public.buckets WHERE id IN (%L, %L, %L)', test.id('SB'), test.id('PE'), test.id('PV')));
  PERFORM test.ok(r = '2', 'M reads SB and PV, not PE', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET title = 'Vault task, renamed' WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(r = 'ok 1', 'E edits T1 through RLS', r);
  r := test.as_user('M', format($q$UPDATE public.tasks SET title = 'Nope' WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(r = 'ok 0', 'M cannot touch T1', r);
  r := test.as_user('M', format($q$UPDATE public.tasks SET title = 'Nope' WHERE id = %L$q$, test.id('T3')));
  PERFORM test.ok(r = 'ok 0' OR r LIKE '42501%', 'nor T3, which M only views', r);

  -- ── An API key follows its person ────────────────────────────────────────
  v_sql := format('SELECT 1 WHERE public.can_access(%L, %L, %L)', 'task', test.id('T1'), 'view');
  r := test.as_key('KE', v_sql);
  PERFORM test.ok(r = 'ok 1', 'E''s key sees T1', r);
  r := test.as_key('KM', v_sql);
  PERFORM test.ok(r = 'ok 0', 'M''s key does not', r);
  r := test.as_key('KM', format('SELECT * FROM public.tasks_op_set_status(%L, %L, %L)', test.id('W'), test.id('T1'), 'done'));
  PERFORM test.ok(r NOT LIKE 'ok%', 'M''s key cannot act on T1', r);

  -- ── Helpers that answer about a given person: server only ────────────────
  FOREACH v_sql IN ARRAY ARRAY[
    format('SELECT public.share_direct_rank(%L, %L, %L)', 'bucket', test.id('PE'), test.id('E')),
    format('SELECT public.perm_ceiling_rank(%L, %L, %L)', test.id('W'), test.id('E'), 'tasks'),
    format('SELECT public.chat_is_workspace_member(%L, %L)', test.id('W'), test.id('E'))
  ] LOOP
    r := test.try('M', v_sql);
    PERFORM test.ok(r LIKE '42501 permission denied for function%', 'a client cannot call ' || split_part(split_part(v_sql, '(', 1), '.', 2), r);
    r := test.as_anon(v_sql);
    PERFORM test.ok(r LIKE '42501 permission denied for function%', 'nor an anonymous visitor: ' || split_part(split_part(v_sql, '(', 1), '.', 2), r);
  END LOOP;
  PERFORM test.ok(public.share_direct_rank('bucket', test.id('PE'), test.id('E')) = 3
                  AND public.perm_ceiling_rank(test.id('W'), test.id('E'), 'tasks') >= 3
                  AND public.chat_is_workspace_member(test.id('W'), test.id('E'))
                  AND NOT public.chat_is_workspace_member(test.id('W'), test.id('X')),
    'server functions still call them');
  r := test.as_service(format('SELECT public.chat_is_workspace_member(%L, %L)', test.id('W'), test.id('M')));
  PERFORM test.ok(r = 'true', 'so does the service role', r);
  -- Client-called server functions that use them keep working.
  r := test.value_as('E', format('SELECT public.chat_can_access_workspace(%L)', test.id('W')));
  PERFORM test.ok(r IS NOT NULL AND r NOT LIKE 'ERROR%', 'chat_can_access_workspace (calls chat_is_workspace_member) still answers', r);
  r := test.as_user('O', format($q$SELECT public.share_op_set('bucket', %L, 'member', %L, 'view')$q$, test.id('PE'), test.id('M')));
  PERFORM test.ok(r = 'ok 1', 'share_op_set (calls perm_ceiling_rank) still shares PE with M', r);
  r := test.can('M', 'bucket', 'PE', 'view');
  PERFORM test.ok(r = 'true', 'and M now sees PE', r);
END;
$$;
