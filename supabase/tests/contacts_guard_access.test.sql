-- MOD-572 · Every contact op checks that the caller can edit that contact,
-- including paths that return without writing
-- (supabase/migrations/20261024132000_contacts_guard_item_access.sql).
--
-- Cast: O owns workspace W; M is a member with the Contacts edit lane. PC is
-- O's private contact. SC is O's contact shared with M at Edit. MC is M's own.
-- K is an API key M made, with contacts=edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('M'), 'member');
INSERT INTO public.contacts (id, workspace_id, owner_id, name, status) VALUES
  (test.id('PC'), test.id('W'), test.id('O'), 'Private Investor', 'lead'),
  (test.id('SC'), test.id('W'), test.id('O'), 'Shared Partner', 'lead'),
  (test.id('MC'), test.id('W'), test.id('M'), 'My Client', 'lead');
DELETE FROM public.resource_grants WHERE resource_type = 'contact'
  AND resource_id IN (test.id('PC'), test.id('SC'), test.id('MC'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'contact', test.id('SC'), 'member', test.id('M'), 'edit', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-mod572'),
        '{"contacts": "edit"}'::jsonb, test.id('M'));

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(NOT public.can_access('contact', test.id('PC'), 'view', test.id('M')),
    'control: M can''t see O''s private contact');

  -- The finding: the no-op path handed the row back.
  r := test.as_user('M', format($q$SELECT public.contacts_op_set_status(%L, %L, 'lead')$q$,
    test.id('W'), test.id('PC')));
  PERFORM test.ok(r LIKE '42501%', 'guessing a private contact''s status returns nothing', r);
  r := test.as_user('M', format($q$SELECT public.contacts_op_set_status(%L, %L, 'won')$q$,
    test.id('W'), test.id('PC')));
  PERFORM test.ok(r LIKE '42501%', 'and a wrong guess is refused the same way', r);
  r := test.as_key('K', format($q$SELECT public.contacts_op_set_status(%L, %L, 'lead')$q$,
    test.id('W'), test.id('PC')));
  PERFORM test.ok(r LIKE '42501%', 'an API key gets the same refusal', r);
  r := test.as_user('M', format('SELECT public.contacts_op_set_favorite(%L, %L, true)', test.id('W'), test.id('PC')));
  PERFORM test.ok(r LIKE '42501%', 'every op through the guard refuses: favourite', r);
  r := test.as_user('M', format('SELECT public.contacts_op_delete(%L, %L)', test.id('W'), test.id('PC')));
  PERFORM test.ok(r LIKE '42501%', 'every op through the guard refuses: delete', r);
  PERFORM test.ok((SELECT status = 'lead' AND NOT coalesce(is_favorite, false) AND deleted_at IS NULL
                   FROM public.contacts WHERE id = test.id('PC')),
    'the private contact is unchanged');

  -- Contacts M can edit still work, the no-op path included.
  r := test.as_user('M', format($q$SELECT public.contacts_op_set_status(%L, %L, 'lead')$q$,
    test.id('W'), test.id('SC')));
  PERFORM test.ok(r = 'ok 1', 'a contact shared at Edit: the unchanged status comes back', r);
  r := test.as_user('M', format($q$SELECT public.contacts_op_set_status(%L, %L, 'won')$q$,
    test.id('W'), test.id('SC')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT status FROM public.contacts WHERE id = test.id('SC')) = 'won',
    'and a new status is saved', r);
  r := test.as_key('K', format($q$SELECT public.contacts_op_set_status(%L, %L, 'won')$q$,
    test.id('W'), test.id('MC')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT status FROM public.contacts WHERE id = test.id('MC')) = 'won',
    'M''s key changes M''s own contact', r);

  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.contacts_op__guard_contact(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.contacts_op__guard_contact(uuid, uuid)', 'EXECUTE'),
    'the guard itself is not an RPC');
END;
$$;
