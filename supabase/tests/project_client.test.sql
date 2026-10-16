-- MOD-155 · A project's client is a contact or a company, never both
-- (supabase/migrations/20261016135941_project_client_company.sql; decision in
-- docs/decisions/tasks.md "MOD-155").
--
-- Cast: O owns workspace W. E is a member, V a viewer, X belongs to another
-- workspace W2. P is a shared project, PB O's private one, I the Inbox. CO is
-- a company the workspace sees, CP O's private company, CD a deleted one, CX
-- one in W2. C1 is a contact.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('I'), test.id('W'), test.id('O'), 'Inbox', true, '0000'),
  (test.id('P'), test.id('W'), test.id('O'), 'Acme rebrand', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES
  (test.id('C1'), test.id('W'), test.id('O'), 'Anna Kowalski');
INSERT INTO public.companies (id, workspace_id, owner_id, name, deleted_at) VALUES
  (test.id('CO'), test.id('W'), test.id('O'), 'Acme Inc.', NULL),
  (test.id('CP'), test.id('W'), test.id('O'), 'O''s secret client', NULL),
  (test.id('CD'), test.id('W'), test.id('O'), 'Gone Ltd', now()),
  (test.id('CX'), test.id('W2'), test.id('X'), 'Not ours', NULL);
-- Anna is the workspace's and works at Acme, so the workspace sees Acme too (a
-- company shows to whoever sees one of its people); CP stays O's alone.
UPDATE public.contacts SET company_id = test.id('CO') WHERE id = test.id('C1');
DELETE FROM public.resource_grants WHERE resource_type = 'contact' AND resource_id = test.id('C1');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level, created_by)
VALUES (test.id('W'), 'contact', test.id('C1'), 'workspace', 'view', test.id('O'));

CREATE FUNCTION test.bucket(p_name text) RETURNS public.buckets LANGUAGE sql STABLE AS $$
  SELECT * FROM public.buckets WHERE id = test.id(p_name)
$$;
-- The project op, as a person, with a patch.
CREATE FUNCTION test.set_client(p_who text, p_project text, p_patch jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.try(p_who, format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id(p_project), p_patch))
$$;

DO $$
DECLARE
  r text;
  v_ref text;
BEGIN
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.companies WHERE id = %L$q$, test.id('CO'))) = '1'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.companies WHERE id = %L$q$, test.id('CP'))) = '0',
    'the cast: E sees Acme, not O''s private company');

  -- ── The ops: one or the other ────────────────────────────────────────────
  r := test.as_user('E', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('NEW'), 'name', 'Acme site', 'client_company_id', test.id('CO'))));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('NEW')).client_company_id = test.id('CO')
              AND (test.bucket('NEW')).client_contact_id IS NULL,
    'a project is made with a company as its client', r);

  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_contact_id', test.id('C1'))));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).client_contact_id = test.id('C1'), 'a person as the client saves', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_company_id', test.id('CO'))));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).client_company_id = test.id('CO')
              AND (test.bucket('P')).client_contact_id IS NULL,
    'setting a company clears the person', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_contact_id', test.id('C1'))));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).client_contact_id = test.id('C1')
              AND (test.bucket('P')).client_company_id IS NULL,
    'and setting a person clears the company', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_company_id', NULL)));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).client_contact_id = test.id('C1'),
    'clearing the company (none set) leaves the person', r);

  r := test.set_client('E', 'P', jsonb_build_object('client_contact_id', test.id('C1'), 'client_company_id', test.id('CO')));
  PERFORM test.ok(r LIKE '22023%person or a company, not both%', 'naming both in one patch is refused', r);
  PERFORM test.ok((test.bucket('P')).client_contact_id = test.id('C1') AND (test.bucket('P')).client_company_id IS NULL,
    'and changes nothing');
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_contact_id', NULL, 'client_company_id', test.id('CO'))));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).client_company_id = test.id('CO')
              AND (test.bucket('P')).client_contact_id IS NULL,
    'a patch that clears the person and names a company is one move', r);
  r := test.as_user('E', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_company_id', NULL)));
  PERFORM test.ok(r = 'ok 1' AND (test.bucket('P')).client_company_id IS NULL AND (test.bucket('P')).client_contact_id IS NULL,
    'clearing the company leaves no client', r);

  -- ── Which companies can be a client ──────────────────────────────────────
  FOREACH v_ref IN ARRAY ARRAY['CX', 'CD', 'CP'] LOOP
    r := test.set_client('E', 'P', jsonb_build_object('client_company_id', test.id(v_ref)));
    PERFORM test.ok(r = '22023 That company isn''t in this workspace.',
      format('a company from another workspace, a deleted one and a private one all read the same (%s)', v_ref), r);
  END LOOP;
  r := test.set_client('E', 'P', '{"client_company_id": "not-a-uuid"}'::jsonb);
  PERFORM test.ok(r = '22023 That company isn''t in this workspace.', 'so does an id that isn''t one', r);
  r := test.try('E', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('name', 'Sneaky', 'client_company_id', test.id('CP'))));
  PERFORM test.ok(r = '22023 That company isn''t in this workspace.', 'creating a project checks it too', r);
  r := test.set_client('O', 'P', jsonb_build_object('client_company_id', test.id('CP')));
  PERFORM test.ok(r = 'ok 1', 'the private company''s owner can name it', r);

  -- ── Raw writes ───────────────────────────────────────────────────────────
  r := test.try('E', format($q$UPDATE public.buckets SET client_company_id = %L WHERE id = %L$q$, test.id('CX'), test.id('P')));
  PERFORM test.ok(r = '22023 That company isn''t in this workspace.', 'a raw write is checked the same way', r);
  r := test.try('V', format($q$UPDATE public.buckets SET client_company_id = %L WHERE id = %L$q$, test.id('CO'), test.id('P')));
  PERFORM test.ok(r NOT LIKE 'ok 1%' AND (test.bucket('P')).client_company_id IS NULL,
    'a viewer can''t set a company client by a raw write', r);
  r := test.try('V', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_company_id', test.id('CO'))));
  PERFORM test.ok(r LIKE '%don''t have edit access%', 'nor through the op', r);
  UPDATE public.buckets SET client_contact_id = test.id('C1') WHERE id = test.id('P');
  r := test.try('E', format($q$UPDATE public.buckets SET client_company_id = %L WHERE id = %L$q$, test.id('CO'), test.id('P')));
  PERFORM test.ok(r LIKE '23514%buckets_client_one_kind%', 'a raw write that leaves both set is refused', r);
  r := test.try('E', format($q$UPDATE public.buckets SET client_contact_id = NULL, client_company_id = %L WHERE id = %L$q$,
    test.id('CO'), test.id('P')));
  PERFORM test.ok(r = 'ok 1', 'a raw write that swaps one for the other passes', r);
  r := test.try('O', format($q$UPDATE public.buckets SET client_company_id = %L WHERE id = %L$q$, test.id('CO'), test.id('I')));
  PERFORM test.ok(r LIKE '%Inbox isn''t a project%', 'the Inbox has no client', r);

  -- ── Who reads it ─────────────────────────────────────────────────────────
  PERFORM test.as_user('O', format($q$SELECT public.projects_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('P'),
    jsonb_build_object('client_company_id', test.id('CP'))));
  PERFORM test.ok(test.value_as('V', format($q$SELECT count(*)::text FROM public.buckets WHERE id = %L AND client_company_id IS NOT NULL$q$, test.id('P'))) = '1'
              AND test.value_as('V', format($q$SELECT count(*)::text FROM public.companies co JOIN public.buckets b ON b.client_company_id = co.id WHERE b.id = %L$q$, test.id('P'))) = '0',
    'a viewer who sees the project can''t read its private client company');
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM public.buckets WHERE client_company_id = %L$q$, test.id('CP'))) = '0',
    'someone outside the workspace reads nothing by filtering on it');
END;
$$;

-- ── A write another trigger makes: only a foreign key's clear skips the gate ─
-- As in sessions_access.test.sql: a throwaway trigger on tasks reaches the
-- project gate at depth 2; PERM-W's own bucket check is off so the project
-- gate is what answers. E can't edit PB.
CREATE TABLE test.nested (what text NOT NULL);
CREATE FUNCTION test.nested_bucket_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_what text := (SELECT what FROM test.nested LIMIT 1);
BEGIN
  IF v_what = 'company' THEN
    UPDATE public.buckets SET client_company_id = test.id('CO') WHERE id = test.id('PB');
  ELSIF v_what = 'clear company' THEN
    UPDATE public.buckets SET client_company_id = NULL WHERE id = test.id('PB');
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER zz_test_nested AFTER UPDATE OF title ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION test.nested_bucket_write();
UPDATE public.buckets SET client_company_id = test.id('CP') WHERE id = test.id('PB');
INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title, position)
VALUES (test.id('T1'), test.id('W'), test.id('E'), test.id('P'), 'Brief', '0001');

DO $$
DECLARE
  r text;
BEGIN
  ALTER TABLE public.buckets DISABLE TRIGGER perm_enforce_write;
  DELETE FROM test.nested;
  INSERT INTO test.nested VALUES ('company');
  r := test.try('E', format($q$UPDATE public.tasks SET title = 'Renamed' WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(r LIKE '42501%don''t have edit access to this project%',
    'nested write: E (no access to PB) can''t set its company client through another trigger', r);
  DELETE FROM test.nested;
  INSERT INTO test.nested VALUES ('clear company');
  r := test.try('E', format($q$UPDATE public.tasks SET title = 'Renamed' WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok(r = 'ok 1', 'nested write: a foreign key''s SET NULL of the company still goes through', r);
  ALTER TABLE public.buckets ENABLE TRIGGER perm_enforce_write;
END;
$$;
DROP TRIGGER zz_test_nested ON public.tasks;

-- ── Erasure ──────────────────────────────────────────────────────────────────
-- E's private company is P's client; deleting E's account removes it, and
-- the foreign key clears the client.
INSERT INTO public.companies (id, workspace_id, owner_id, name) VALUES
  (test.id('CE'), test.id('W'), test.id('E'), 'E''s client');
DELETE FROM public.resource_grants WHERE resource_type = 'company' AND resource_id = test.id('CE');
UPDATE public.buckets SET client_contact_id = NULL, client_company_id = test.id('CE') WHERE id = test.id('P');

DO $$
DECLARE
  r text;
BEGIN
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('E')), false);
  PERFORM test.ok(r = 'ok 1' AND (SELECT client_company_id FROM public.buckets WHERE id = test.id('P')) IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.companies WHERE id = test.id('CE')),
    'erasure takes someone''s private company, and with it the project''s client', r);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.buckets WHERE id = test.id('P') AND deleted_at IS NULL),
    'the project itself stays');
END;
$$;

-- ── The shape ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_trigger
                          WHERE tgname = 'buckets_project_check' AND tgrelid = 'public.buckets'::regclass
                            AND pg_get_triggerdef(oid) LIKE '%client_company_id%'),
    'the guard trigger watches client_company_id');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.buckets__project_check()', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.projects__apply_fields(public.buckets, jsonb)', 'EXECUTE'),
    'the internal helpers stay server-only');
END;
$$;
