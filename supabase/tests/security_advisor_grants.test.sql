-- DB-SEC-1 · What the 2026-10-22 security advisor pass closes, and what it
-- leaves callable on purpose
-- (supabase/migrations/20261022130000_security_advisor_grants.sql).
--
-- Cast: O owns W; M is a member of W; X is signed in but not in W.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'founder' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (test.id('W'), test.id('M'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
VALUES (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false);
INSERT INTO public.workspace_share_defaults (workspace_id, notes)
VALUES (test.id('W'), 'view')
ON CONFLICT (workspace_id) DO UPDATE SET notes = 'view';

DO $$
DECLARE
  f text;
  r text;
  n int;
BEGIN
  -- 1 · No trigger function is callable by a client.
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  PERFORM test.ok(n = 0, 'no trigger function is executable by anon or authenticated', n::text);

  -- 2 · Server-only helpers: service_role yes, clients no.
  FOREACH f IN ARRAY ARRAY[
    'public.calendar_module_permission(uuid)', 'public.contacts_module_permission(uuid)',
    'public.spine_module_permission(uuid)', 'public.tasks_module_permission(uuid)',
    'public.projects__editable(uuid)', 'public.tasks__editable(uuid)',
    'public.perm_can_view_entity(uuid, text)', 'public.chat_is_workspace_admin(uuid)',
    'public.share_visible_ids(uuid, text)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', f, 'EXECUTE')
                AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
                AND has_function_privilege('service_role', f, 'EXECUTE'),
      format('%s is the server''s only', f));
  END LOOP;

  -- Their callers still work: tasks_op_create runs tasks_module_permission as
  -- its owner.
  r := test.as_user('M', format($q$SELECT public.tasks_op_create(%L, '{"title": "Logo concepts", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('SB'))));
  PERFORM test.ok(r = 'ok 1', 'a member still creates a task (its op reaches the revoked helper)', r);

  -- RLS helpers stay callable by signed-in people (policies run as the caller).
  FOREACH f IN ARRAY ARRAY[
    'public.can_access(text, uuid, text)', 'public.tasks__visible(uuid)',
    'public.tasks_module_can_access_workspace(uuid)', 'public.workspace_seats_used(uuid)',
    'public.workspace_seat_cap(uuid)'] LOOP
    PERFORM test.ok(has_function_privilege('authenticated', f, 'EXECUTE')
                AND NOT has_function_privilege('anon', f, 'EXECUTE'),
      format('%s stays callable by signed-in people only', f));
  END LOOP;

  -- 3 · Dead helpers are gone.
  PERFORM test.ok(to_regprocedure('public.perm_private_entity_visible(text, uuid)') IS NULL,
    'perm_private_entity_visible is dropped');
  PERFORM test.ok(to_regprocedure('public.user_can_manage_workspace_members(uuid)') IS NULL,
    'user_can_manage_workspace_members is dropped');

  -- 4 · Share defaults: members read them, outsiders don't.
  PERFORM test.ok(NOT (SELECT prosecdef FROM pg_proc
                        WHERE oid = 'public.share_defaults_get(uuid)'::regprocedure),
    'share_defaults_get runs as the caller');
  r := test.value_as('M', format('SELECT public.share_defaults_get(%L) ->> ''notes''', test.id('W')));
  PERFORM test.ok(r = 'view', 'a member reads the workspace''s share defaults', r);
  r := test.value_as('O', format('SELECT public.share_defaults_get(%L) ->> ''notes''', test.id('W')));
  PERFORM test.ok(r = 'view', 'the owner reads the workspace''s share defaults', r);
  r := test.value_as('X', format('SELECT public.share_defaults_get(%L) IS NULL', test.id('W')));
  PERFORM test.ok(r = 'true', 'an outsider reads no share defaults', r);

  -- 5 · Seat counts: the workspace's people and server code only.
  r := test.value_as('M', format('SELECT public.workspace_seats_used(%L)', test.id('W')));
  PERFORM test.ok(r = '2', 'a member counts the workspace''s seats', r);
  r := test.value_as('X', format('SELECT public.workspace_seats_used(%L) IS NULL', test.id('W')));
  PERFORM test.ok(r = 'true', 'an outsider gets no seat count', r);
  PERFORM test.ok(public.workspace_seats_used(test.id('W')) = 2, 'server code counts any workspace');
  -- The seat-cap policy still lets the owner invite, and refuses an outsider.
  r := test.as_user('O', format($q$INSERT INTO public.workspace_invites (workspace_id, created_by, email, role)
    VALUES (%L, %L, 'db-test-new@example.com', 'member')$q$, test.id('W'), test.id('O')));
  PERFORM test.ok(r = 'ok 1', 'the owner still invites someone', r);
  r := test.as_user('X', format($q$INSERT INTO public.workspace_invites (workspace_id, created_by, email, role)
    VALUES (%L, %L, 'db-test-other@example.com', 'member')$q$, test.id('W'), test.id('X')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'an outsider can''t invite into the workspace', r);

  -- 6 · Pinned search_path.
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_proc
                           WHERE oid = 'public.notes_live__fresh()'::regprocedure
                             AND proconfig::text LIKE '%search_path%'),
    'notes_live__fresh pins its search_path');

  -- 7 · The token table is server-only, TRUNCATE included.
  PERFORM test.ok(NOT has_table_privilege('anon', 'public.user_integrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
              AND NOT has_table_privilege('authenticated', 'public.user_integrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
              AND has_table_privilege('service_role', 'public.user_integrations', 'SELECT'),
    'user_integrations is the server''s only');
END;
$$;
