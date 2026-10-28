-- NS-3 · A DELETE that reaches a parent before its child (supabase/migrations/
-- 20261030121000_notes_reroot_access.sql). notes_freeze_children copies grants
-- onto the child without writing the child's row (share_sync_note_flag is held
-- by notes.freezing), so the same statement can still delete the child; the
-- child that survives gets workspace_shared from notes_orphan_custom.
-- notes_reroot_access.test.sql's deletes run child first (index order); this
-- one forces a sequential scan over rows stored parent first.
--
-- Cast: O owns W; T is a member. P is shared with the workspace; M follows P
-- and is deleted with it; L (live) and Z (trashed) follow M and survive.

SELECT test.person(n) FROM unnest(ARRAY['O', 'T']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('T'), 'member');

INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_md) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'Handbook', 'p');
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('M'), test.id('W'), test.id('O'), 'Hiring', 'm', test.id('P'));
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('L'), test.id('W'), test.id('T'), 'Interview loop', 'l', test.id('M')),
  (test.id('Z'), test.id('W'), test.id('T'), 'Old loop', 'z', test.id('M'));
UPDATE public.notes SET share_mode = 'custom' WHERE id = test.id('P');
UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false
  WHERE id IN (test.id('M'), test.id('L'), test.id('Z'));
UPDATE public.notes SET deleted_at = now() WHERE id = test.id('Z');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('P'), test.id('M'), test.id('L'), test.id('Z'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('P'), 'workspace', NULL, 'edit', test.id('O'));
-- Each update writes a new row version at the end: touch M last so P is stored first.
UPDATE public.notes SET title = 'Hiring loop' WHERE id = test.id('M');

DO $$
DECLARE
  r text;
  v_first uuid;
BEGIN
  SET LOCAL enable_indexscan = off;
  SET LOCAL enable_bitmapscan = off;
  SET LOCAL enable_indexonlyscan = off;
  SELECT id INTO v_first FROM public.notes WHERE id IN (test.id('P'), test.id('M')) LIMIT 1;
  PERFORM test.ok(v_first = test.id('P'), 'control: the sequential scan reaches the parent first');

  r := test.run(NULL, format('DELETE FROM public.notes WHERE id IN (%L, %L)', test.id('P'), test.id('M')), false);
  PERFORM test.ok(r = 'ok 2', 'deleting a parent and its child in one statement, parent first, succeeds', r);
  SET LOCAL enable_indexscan = on;
  SET LOCAL enable_bitmapscan = on;
  SET LOCAL enable_indexonlyscan = on;
END;
$$;

DO $$
BEGIN
  PERFORM test.ok((SELECT parent_id IS NULL AND share_mode = 'custom' AND workspace_shared
                     FROM public.notes WHERE id = test.id('L')),
    'the live grandchild is top-level, custom and shared with the workspace');
  PERFORM test.ok((SELECT parent_id IS NULL AND share_mode = 'custom' AND workspace_shared
                     FROM public.notes WHERE id = test.id('Z')),
    'so is the trashed one');
  PERFORM test.ok(public.can_access('note', test.id('L'), 'edit', test.id('T')),
    'T still edits L through the copied workspace grant');
  PERFORM test.ok(coalesce(current_setting('notes.freezing', true), '') = '',
    'the hold is released after the delete');
  PERFORM test.ok(test.as_user('T', format('SELECT public.share_op_follow_parent(%L)', test.id('L')))
                  = '22023 A top-level note has no parent to follow.',
    'a top-level note can''t be set to follow a parent, and the refusal says why');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.notes__copy_chain_access(uuid, uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.notes__copy_chain_access(uuid, uuid, uuid)', 'EXECUTE')
              AND has_function_privilege('service_role', 'public.notes__copy_chain_access(uuid, uuid, uuid)', 'EXECUTE'),
    'grants: the grant copy is the service role''s only');
END;
$$;
