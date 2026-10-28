-- NS-4 · Restore past 30 days (specs/notes-schema-hardening.md, PQ3;
-- supabase/migrations/20261030130000_notes_purge_expired.sql). The validator's
-- case: a sub-note C trashed on its own 31 days ago, then its parent P trashed
-- 10 days ago. Restoring P succeeds; C stays in the trash for the purge. P's
-- other sub-note D, trashed with it, comes back.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'P', 'P', NULL);
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, parent_id) VALUES
  (test.id('C'), test.id('W'), test.id('O'), 'C', 'C', test.id('P')),
  (test.id('D'), test.id('W'), test.id('O'), 'D', 'D', test.id('P'));
UPDATE public.notes SET deleted_at = now() - interval '31 days' WHERE id = test.id('C');
UPDATE public.notes SET deleted_at = now() - interval '10 days' WHERE id IN (test.id('P'), test.id('D'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_op('O', format('SELECT public.notes_op_restore(%L, %L)', test.id('W'), test.id('P')));
  PERFORM test.ok(r LIKE 'ok%', 'a parent trashed 10 days ago restores despite an expired sub-note', r);
  PERFORM test.ok((SELECT deleted_at IS NULL FROM public.notes WHERE id = test.id('P'))
              AND (SELECT deleted_at IS NULL FROM public.notes WHERE id = test.id('D')),
    'the parent and its sub-note trashed with it are back');
  PERFORM test.ok((SELECT deleted_at IS NOT NULL AND parent_id = test.id('P')
                     FROM public.notes WHERE id = test.id('C')),
    'the expired sub-note stays in the trash, under its parent');

  r := test.as_op('O', format('SELECT public.notes_op_restore(%L, %L)', test.id('W'), test.id('C')));
  PERFORM test.ok(r LIKE '%This note was deleted more than 30 days ago%',
    'the expired sub-note itself is still refused', r);
END;
$$;
