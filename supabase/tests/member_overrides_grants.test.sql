-- MOD-573 · Member exceptions are checked as stored, and a role change that
-- would switch on what someone couldn't give is refused
-- (supabase/migrations/20261024133000_member_overrides_grant_checks.sql).
--
-- Cast: O owns workspace W. A is an Admin (manages members and roles, not the
-- owner). G is a "Coordinator": manages members, can't make API keys. RO and
-- RO2 are read-only roles O made. M1, M2, M3 hold RO; M4 holds RO2.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'G', 'M1', 'M2', 'M3', 'M4', 'N']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_roles (id, workspace_id, name, permissions, read_only) VALUES
  (test.id('RO'), test.id('W'), 'Readers', ARRAY['notes.view', 'tasks.view'], true),
  (test.id('RO2'), test.id('W'), 'Auditors', ARRAY['notes.view', 'tasks.view'], true),
  (test.id('CO'), test.id('W'), 'Coordinator',
   ARRAY['notes.view', 'notes.edit', 'tasks.view', 'tasks.edit', 'ws.invite', 'ws.manage_members'], false);
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'admin'),
  (test.id('W'), test.id('N'), 'member');
INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id) VALUES
  (test.id('W'), test.id('G'), 'member', test.id('CO')),
  (test.id('W'), test.id('M1'), 'viewer', test.id('RO')),
  (test.id('W'), test.id('M2'), 'viewer', test.id('RO')),
  (test.id('W'), test.id('M3'), 'viewer', test.id('RO')),
  (test.id('W'), test.id('M4'), 'viewer', test.id('RO2'));

CREATE FUNCTION test.member(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id(p_name)
$$;
CREATE FUNCTION test.perms(p_name text) RETURNS text[] LANGUAGE sql AS $$
  SELECT perms FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id(p_name)
$$;
CREATE FUNCTION test.overrides(p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT overrides FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id(p_name)
$$;

DO $$
DECLARE
  r text;
BEGIN
  -- The finding: parking owner-only keys behind a read-only role.
  r := test.as_user('A', format($q$SELECT public.workspace_op_set_member_access(%L, %L, '{"ws.manage_members": true}')$q$,
    test.member('M1'), test.id('RO')));
  PERFORM test.ok(r LIKE '42501%' AND test.overrides('M1') = '{}'::jsonb,
    'an Admin can''t park member management on someone behind a read-only role', r);
  r := test.as_user('G', format($q$SELECT public.workspace_op_set_member_access(%L, %L, '{"ws.api_keys": true}')$q$,
    test.member('M1'), test.id('RO')));
  PERFORM test.ok(r LIKE '42501%' AND test.overrides('M1') = '{}'::jsonb,
    'nor can a manager park a permission they don''t have', r);
  r := test.as_user('A', format($q$SELECT public.workspace_op_set_member_access(%L, %L, '{"tasks.edit": true, "notes.view": false}')$q$,
    test.member('M1'), test.id('RO')));
  PERFORM test.ok(r = 'ok 1' AND test.overrides('M1') = '{"tasks.edit": true, "notes.view": false}'::jsonb,
    'exceptions the manager could give outright are still stored', r);

  -- The owner may park anything; a role change by someone else may not
  -- switch it on.
  r := test.as_user('O', format($q$SELECT public.workspace_op_set_member_access(%L, %L, '{"ws.manage_roles": true}')$q$,
    test.member('M2'), test.id('RO')));
  PERFORM test.ok(r = 'ok 1' AND NOT 'ws.manage_roles' = ANY (test.perms('M2')),
    'control: the owner parks role management on M2; read-only keeps it off', r);
  r := test.as_user('A', format($q$SELECT public.workspace_op_role_upsert(%L, %L, 'Readers', '', ARRAY['notes.view', 'tasks.view'], false)$q$,
    test.id('W'), test.id('RO')));
  PERFORM test.ok(r LIKE '42501%' AND NOT 'ws.manage_roles' = ANY (test.perms('M2'))
              AND (SELECT read_only FROM public.workspace_roles WHERE id = test.id('RO')),
    'an Admin''s role edit that would switch it on is refused as a whole', r);

  r := test.as_user('O', format($q$SELECT public.workspace_op_set_member_access(%L, %L, '{"ws.manage_members": true}')$q$,
    test.member('M4'), test.id('RO2')));
  PERFORM test.ok(r = 'ok 1', 'control: the owner parks member management on M4 behind RO2', r);
  r := test.as_user('A', format('SELECT public.workspace_op_role_delete(%L, %L)', test.id('RO2'),
    (SELECT id FROM public.workspace_roles WHERE workspace_id = test.id('W') AND system_key = 'member')));
  PERFORM test.ok(r LIKE '42501%' AND NOT 'ws.manage_members' = ANY (test.perms('M4'))
              AND EXISTS (SELECT 1 FROM public.workspace_roles WHERE id = test.id('RO2')),
    'nor can an Admin delete the role and move M4 onto one that switches it on', r);

  -- What stays possible.
  r := test.as_user('A', format($q$SELECT public.workspace_op_role_upsert(%L, %L, 'Readers', '', ARRAY['notes.view', 'tasks.view', 'chat.view'], true)$q$,
    test.id('W'), test.id('RO')));
  PERFORM test.ok(r = 'ok 1' AND 'chat.view' = ANY (test.perms('M3')),
    'an Admin''s role edit that adds only what they can give goes through', r);
  r := test.as_user('O', format($q$SELECT public.workspace_op_role_upsert(%L, %L, 'Readers', '', ARRAY['notes.view', 'tasks.view'], false)$q$,
    test.id('W'), test.id('RO')));
  PERFORM test.ok(r = 'ok 1' AND 'ws.manage_roles' = ANY (test.perms('M2')),
    'the owner''s own role edit switches the parked key on', r);
  r := test.as_user('O', format('SELECT public.workspace_op_transfer_ownership(%L)', test.member('N')));
  PERFORM test.ok(r = 'ok 0' OR r = 'ok 1', 'transferring ownership still works', r);
  PERFORM test.ok((SELECT role FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('O')) = 'admin'
              AND (SELECT owner_id FROM public.workspaces WHERE id = test.id('W')) = test.id('N'),
    'the old owner is an Admin and N owns the workspace');
END;
$$;
