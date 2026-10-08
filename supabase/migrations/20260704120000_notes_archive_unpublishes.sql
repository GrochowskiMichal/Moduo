-- Notes NO-9 follow-up: archiving takes a note offline.
--
-- Product call (designer, 2026-07-04): archiving a published note must revoke
-- its public link — archive and publish were orthogonal (a published-then-
-- archived note kept a live public page). Archiving hides the note (with its
-- subtree) from the tree, so any published note ANYWHERE in that subtree should
-- go offline too.
--
-- ⚠ DEPLOY ORDER: apply AFTER 20260703120000_notes_module.sql (this CREATE OR
-- REPLACEs notes_op_archive and calls notes__subtree_ids, both defined there).
-- Additive + idempotent; no schema change, so src/types/supabase.ts is unchanged.

CREATE OR REPLACE FUNCTION public.notes_op_archive(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_unpublished integer := 0;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);

  -- The archive flag lives on the gesture ROOT (descendants follow by ancestry).
  UPDATE public.notes SET is_archived = true, updated_at = now()
    WHERE id = n.id RETURNING * INTO n;

  -- Take offline every published note in the archived subtree (root included).
  -- Clearing publish_token makes the notes-public edge function 404 instantly
  -- (it resolves by token), matching Unpublish.
  UPDATE public.notes
    SET published_at = NULL, publish_token = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND id IN (SELECT public.notes__subtree_ids(p_workspace_id, p_note_id))
      AND published_at IS NOT NULL;
  GET DIAGNOSTICS v_unpublished = ROW_COUNT;

  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.archive',
    jsonb_build_object('title', n.title, 'unpublished', v_unpublished));
  RETURN n;
END;
$$;
