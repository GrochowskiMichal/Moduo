-- Making a note follow its parent's sharing works for anyone with Full on it,
-- not only its creator (supabase/migrations/20261024150000_share_follow_parent_order.sql).
-- share_op_follow_parent used to delete the note's grants before switching it
-- to 'inherit', so the write checks in between saw a custom note with no
-- grants and refused everyone but the creator.
--
-- Cast: O owns workspace W; C, F and E are members. C made every note.
-- P is C's parent page: F and O may view it, F may edit P2. N1, N3, N4 are
-- C's notes at the top level; N1 and N3 are shared with F at Full, N2 with O
-- (the workspace owner, not the creator) at Full, N4 with E at Edit only.
-- PUB is C's page published to the web, and N5 under it is shared with F at
-- Full (the member role may publish): the case notes_guard_reparent (PR #641)
-- checks, which must see F's grants too. X is a member whose exception blocks
-- ws.publish, with Full on N6 under PUB. N7 under P is shared with the
-- workspace and with F at Full.

SELECT test.person(n) FROM unnest(ARRAY['O', 'C', 'F', 'E', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('C'), 'member'),
  (test.id('W'), test.id('F'), 'member'),
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('X'), 'member');
UPDATE public.workspace_members SET overrides = '{"ws.publish": false}'::jsonb
  WHERE workspace_id = test.id('W') AND user_id = test.id('X');

INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES
  (test.id('P'), test.id('W'), test.id('C'), 'Handbook'),
  (test.id('P2'), test.id('W'), test.id('C'), 'Projects'),
  (test.id('N1'), test.id('W'), test.id('C'), 'Onboarding'),
  (test.id('N2'), test.id('W'), test.id('C'), 'Benefits'),
  (test.id('N3'), test.id('W'), test.id('C'), 'Q4 plan'),
  (test.id('N4'), test.id('W'), test.id('C'), 'Offsite'),
  (test.id('PUB'), test.id('W'), test.id('C'), 'Press kit'),
  (test.id('N5'), test.id('W'), test.id('C'), 'Logos'),
  (test.id('N6'), test.id('W'), test.id('C'), 'Draft release'),
  (test.id('N7'), test.id('W'), test.id('C'), 'Holidays');
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('P'), test.id('P2'), test.id('N1'), test.id('N2'), test.id('N3'), test.id('N4'),
               test.id('PUB'), test.id('N5'), test.id('N6'), test.id('N7'));
UPDATE public.notes SET publish_token = 'db-test-follow-pub', published_at = now() WHERE id = test.id('PUB');
-- Set as system work, so share_note_before doesn't make them inherit.
UPDATE public.notes SET parent_id = test.id('P')
  WHERE id IN (test.id('N1'), test.id('N2'), test.id('N4'));
UPDATE public.notes SET parent_id = test.id('PUB') WHERE id IN (test.id('N5'), test.id('N6'));
UPDATE public.notes SET parent_id = test.id('P') WHERE id = test.id('N7');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('P'), test.id('P2'), test.id('N1'), test.id('N2'), test.id('N3'), test.id('N4'),
                      test.id('PUB'), test.id('N5'), test.id('N6'), test.id('N7'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('P'), 'member', test.id('F'), 'view', test.id('C')),
       (test.id('W'), 'note', test.id('P'), 'member', test.id('O'), 'view', test.id('C')),
       (test.id('W'), 'note', test.id('P2'), 'member', test.id('F'), 'edit', test.id('C')),
       (test.id('W'), 'note', test.id('N1'), 'member', test.id('F'), 'full', test.id('C')),
       (test.id('W'), 'note', test.id('N2'), 'member', test.id('O'), 'full', test.id('C')),
       (test.id('W'), 'note', test.id('N3'), 'member', test.id('F'), 'full', test.id('C')),
       (test.id('W'), 'note', test.id('N4'), 'member', test.id('E'), 'edit', test.id('C')),
       (test.id('W'), 'note', test.id('N5'), 'member', test.id('F'), 'full', test.id('C')),
       (test.id('W'), 'note', test.id('N6'), 'member', test.id('X'), 'full', test.id('C')),
       (test.id('W'), 'note', test.id('N7'), 'member', test.id('F'), 'full', test.id('C'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('N7'), 'workspace', NULL, 'view', test.id('C'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('F', format($q$SELECT public.share_op_follow_parent(%L)$q$, test.id('N1')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('N1')) = 'inherit'
              AND NOT EXISTS (SELECT 1 FROM public.resource_grants
                              WHERE resource_type = 'note' AND resource_id = test.id('N1')),
    'a member with Full (not the creator) makes a note follow its parent', r);
  PERFORM test.ok(public.can_access('note', test.id('N1'), 'view', test.id('F'))
              AND NOT public.can_access('note', test.id('N1'), 'edit', test.id('F')),
    'and from then on has what the parent gives them (View here)');
  PERFORM test.ok(coalesce(current_setting('share.bypass', true), '') = '',
    'the write checks are back on for the rest of the transaction');

  r := test.as_user('O', format($q$SELECT public.share_op_follow_parent(%L)$q$, test.id('N2')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('N2')) = 'inherit',
    'so does the workspace owner with Full on someone else''s note', r);

  r := test.as_user('F', format($q$SELECT public.notes_op_move(%L, %L, %L, 'a', true)$q$,
    test.id('W'), test.id('N3'), test.id('P2')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT parent_id FROM public.notes WHERE id = test.id('N3')) = test.id('P2')
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('N3')) = 'inherit'
              AND NOT EXISTS (SELECT 1 FROM public.resource_grants
                              WHERE resource_type = 'note' AND resource_id = test.id('N3')),
    '"match the new parent" on a move works for a member with Full', r);

  r := test.as_user('F', format($q$SELECT public.share_op_follow_parent(%L)$q$, test.id('N5')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('N5')) = 'inherit',
    'a member with Full may make a note follow a page published to the web', r);

  -- notes_guard_reparent arrives with PR #641; until then nothing checks ws.publish here.
  IF to_regprocedure('public.notes__guard_reparent()') IS NOT NULL THEN
    r := test.as_user('X', format($q$SELECT public.share_op_follow_parent(%L)$q$, test.id('N6')));
    PERFORM test.ok(r LIKE '42501%'
                AND (SELECT share_mode FROM public.notes WHERE id = test.id('N6')) = 'custom'
                AND EXISTS (SELECT 1 FROM public.resource_grants
                            WHERE resource_type = 'note' AND resource_id = test.id('N6')),
      'Full is not enough to follow a published page for a member who can''t publish', r);
  END IF;

  r := test.as_user('F', format($q$SELECT public.share_op_follow_parent(%L)$q$, test.id('N7')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('N7')) = 'inherit'
              AND NOT (SELECT workspace_shared FROM public.notes WHERE id = test.id('N7')),
    'a note shared with the workspace drops its workspace flag when it follows', r);

  r := test.as_user('E', format($q$SELECT public.share_op_follow_parent(%L)$q$, test.id('N4')));
  PERFORM test.ok(r LIKE '42501%'
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('N4')) = 'custom'
              AND EXISTS (SELECT 1 FROM public.resource_grants
                          WHERE resource_type = 'note' AND resource_id = test.id('N4')),
    'a member with only Edit is still refused, and the note keeps its sharing', r);

  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.share_op_follow_parent(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.share_op_follow_parent(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.share_op_follow_parent(uuid)', 'EXECUTE'),
    'grants: signed-in people and the service role, not anon');
END;
$$;
