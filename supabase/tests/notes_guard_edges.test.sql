-- NS-6 · One guard, the edges the matrix leaves out (validator pass on
-- supabase/migrations/20261030150000_notes_one_guard.sql): a duplicate's
-- parent rule, a key's hidden-equals-missing, notes__require_parent's grants.
--
-- Cast: O owns W, E is a member. PV is O's page E can only view, with SV under
-- it (custom, E can view). PH is hidden from E, with SH under it (custom, E
-- can view). H is hidden from E. KE is O's Notes: Edit key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('E'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KE'), test.id('W'), 'Writer', 'mdo_ns6x', md5('db-test-ns6-edges-ke'), '{"notes": "edit"}', test.id('O'));

INSERT INTO public.notes (id, workspace_id, created_by, title, position) VALUES
  (test.id('PV'), test.id('W'), test.id('O'), 'Plans', 'a'),
  (test.id('PH'), test.id('W'), test.id('O'), 'Board', 'b');
INSERT INTO public.notes (id, workspace_id, created_by, title, position, parent_id) VALUES
  (test.id('SV'), test.id('W'), test.id('O'), 'Q1', 'a', test.id('PV')),
  (test.id('SH'), test.id('W'), test.id('O'), 'Q2', 'a', test.id('PH'));
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('PV'), test.id('PH'), test.id('SV'), test.id('SH'));
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('PV'), test.id('PH'), test.id('SV'), test.id('SH'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'note', test.id(r), 'member', test.id('E'), 'view', test.id('O')
  FROM unnest(ARRAY['PV', 'SV', 'SH']) r;

-- Duplicating lands the copy under the source's parent: edit there, and a
-- parent you can't open answers as not found.
SELECT test.ok(r LIKE '42501 You can''t add pages inside that note%', 'duplicate under a view-only parent is refused', r)
  FROM test.try('E', format('SELECT public.notes_op_duplicate(%L, %L)', test.id('W'), test.id('SV'))) r;
SELECT test.ok(r LIKE 'P0002 Parent note not found%', 'duplicate under a hidden parent answers not found', r)
  FROM test.try('E', format('SELECT public.notes_op_duplicate(%L, %L)', test.id('W'), test.id('SH'))) r;

-- A key's hidden note: O sees everything, so a note in another workspace is
-- the key's "hidden" one; it answers like a missing one.
SELECT test.person('O2');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W2'), test.id('O2'), 'Elsewhere');
INSERT INTO public.notes (id, workspace_id, created_by, title, position) VALUES
  (test.id('X2'), test.id('W2'), test.id('O2'), 'Not yours', 'a');
SELECT test.ok(a = b AND a LIKE 'P0002 Note not found%', 'a key: another workspace''s note answers like a missing one', a || ' | ' || b)
  FROM test.as_key('KE', format('SELECT public.notes_op_rename(%L, %L, ''x'')', test.id('W'), test.id('X2'))) a,
       test.as_key('KE', format('SELECT public.notes_op_rename(%L, %L, ''x'')', test.id('W'), test.id('MISSING'))) b;

SELECT test.ok(NOT has_function_privilege(r, 'public.notes__require_parent(uuid, uuid, boolean)', 'EXECUTE'),
  format('%s can''t call notes__require_parent', r))
  FROM unnest(ARRAY['anon', 'authenticated']) r;
SELECT test.ok(has_function_privilege('service_role', 'public.notes__require_parent(uuid, uuid, boolean)', 'EXECUTE'),
  'service_role calls notes__require_parent');
