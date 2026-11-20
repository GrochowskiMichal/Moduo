-- Moving a shared note under a private one and making it follow that parent's
-- sharing is one operation (supabase/migrations/20261020141000_notes_op_move_follow_parent.sql).
--
-- Cast: O owns workspace W; E is a member. P is O's private note. S1, S2 are
-- shared with the workspace. ES is shared with E at Edit (not Full), and E has
-- Edit on the private note PE.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('E'), 'member');

INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'Salaries'),
  (test.id('PE'), test.id('W'), test.id('O'), 'Hiring'),
  (test.id('S1'), test.id('W'), test.id('O'), 'Team handbook'),
  (test.id('S2'), test.id('W'), test.id('O'), 'Roadmap'),
  (test.id('ES'), test.id('W'), test.id('O'), 'Interview notes');
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('P'), test.id('PE'));
UPDATE public.notes SET share_mode = 'custom', workspace_shared = true
  WHERE id IN (test.id('S1'), test.id('S2'));
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false WHERE id = test.id('ES');
DELETE FROM public.resource_grants
  WHERE resource_type = 'note' AND resource_id IN (test.id('P'), test.id('PE'), test.id('ES'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('ES'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'note', test.id('PE'), 'member', test.id('E'), 'edit', test.id('O'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.notes_op_move(%L, %L, %L, 'a', true)$q$,
    test.id('W'), test.id('S1'), test.id('P')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT parent_id FROM public.notes WHERE id = test.id('S1')) = test.id('P')
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('S1')) = 'inherit'
              AND NOT (SELECT workspace_shared FROM public.notes WHERE id = test.id('S1')),
    'moved with "match the new parent": it sits under the parent and follows its sharing', r);
  PERFORM test.ok(NOT public.can_access('note', test.id('S1'), 'view', test.id('E')),
    'so a member who could see it before no longer can');

  r := test.as_user('O', format($q$SELECT public.notes_op_move(%L, %L, %L, 'b', false)$q$,
    test.id('W'), test.id('S2'), test.id('P')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT parent_id FROM public.notes WHERE id = test.id('S2')) = test.id('P')
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('S2')) = 'custom'
              AND (SELECT workspace_shared FROM public.notes WHERE id = test.id('S2')),
    '"keep current access" moves it and leaves its sharing alone', r);

  -- E may move ES (Edit) but not change who can see it (that needs Full):
  -- the whole operation is refused, and the note stays where it was.
  r := test.as_user('E', format($q$SELECT public.notes_op_move(%L, %L, %L, 'c', true)$q$,
    test.id('W'), test.id('ES'), test.id('PE')));
  PERFORM test.ok(r LIKE '42501%'
              AND (SELECT parent_id FROM public.notes WHERE id = test.id('ES')) IS NULL
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('ES')) = 'custom',
    'when following the parent is refused, the move is undone too', r);

  -- Existing callers (MCP, older builds, the offline queue) send four arguments.
  r := test.as_user('E', format($q$SELECT public.notes_op_move(p_workspace_id => %L, p_note_id => %L,
    p_parent_id => %L, p_position => 'd')$q$, test.id('W'), test.id('ES'), test.id('PE')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT parent_id FROM public.notes WHERE id = test.id('ES')) = test.id('PE')
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('ES')) = 'custom',
    'a move without the new argument works as before and keeps the note''s sharing', r);

  r := test.as_user('O', format($q$SELECT public.notes_op_move(%L, %L, NULL, 'e', true)$q$,
    test.id('W'), test.id('S2')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT parent_id FROM public.notes WHERE id = test.id('S2')) IS NULL
              AND (SELECT share_mode FROM public.notes WHERE id = test.id('S2')) = 'custom',
    'to the top level there is no parent to follow, so sharing is left alone', r);

  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.notes_op_move(uuid, uuid, uuid, text, boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.notes_op_move(uuid, uuid, uuid, text, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.notes_op_move(uuid, uuid, uuid, text, boolean)', 'EXECUTE'),
    'grants: signed-in people and the service role, not anon');
  PERFORM test.ok((SELECT count(*) FROM pg_proc WHERE proname = 'notes_op_move'
                   AND pronamespace = 'public'::regnamespace) = 1,
    'one notes_op_move, no overload left behind');
END;
$$;
