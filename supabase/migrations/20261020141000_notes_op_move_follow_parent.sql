-- Moving a shared note under a private one: the move and "match the new
-- parent" happen together or not at all.
--
-- The app moved the note (notes_op_move) and then, in a second call it did not
-- wait for or check, asked share_op_follow_parent to drop the note's own
-- sharing. Either half could land without the other, and the second could run
-- before the first. notes_op_move now takes p_follow_parent: when true and the
-- note gets a parent, the same transaction makes it follow that parent's
-- sharing (share_op_follow_parent's checks and effect, unchanged). If that is
-- refused, the move is rolled back too.
--
-- The new argument defaults to false, so every existing caller (the MCP
-- connector, older app builds, the offline replay queue) keeps working.
-- Dropping the old signature resets grants: they are stated again below.
-- Verified on the local stack by supabase/tests/notes_move_follow_parent.test.sql.

DROP FUNCTION IF EXISTS public.notes_op_move(uuid, uuid, uuid, text);

CREATE FUNCTION public.notes_op_move(
  p_workspace_id uuid,
  p_note_id uuid,
  p_parent_id uuid DEFAULT NULL::uuid,
  p_position text DEFAULT ''::text,
  p_follow_parent boolean DEFAULT false)
 RETURNS notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_old_parent uuid;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  v_old_parent := n.parent_id;

  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notes
      WHERE id = p_parent_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Target parent not found in this workspace.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.notes__subtree_ids(p_workspace_id, p_note_id) s
      WHERE s = p_parent_id
    ) THEN
      RAISE EXCEPTION 'A note cannot be moved into its own subtree.';
    END IF;
  END IF;

  IF p_parent_id IS NULL AND v_old_parent IS NOT NULL
     AND coalesce(n.share_mode, 'custom') = 'inherit' THEN
    PERFORM public.notes__keep_access_on_reroot(p_workspace_id, n.id);
  END IF;

  UPDATE public.notes
    SET parent_id = p_parent_id,
        position = coalesce(p_position, ''),
        updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;

  -- New here: follow the new parent's sharing in the same transaction.
  IF coalesce(p_follow_parent, false) AND p_parent_id IS NOT NULL THEN
    PERFORM public.share_op_follow_parent(n.id);
    SELECT * INTO n FROM public.notes WHERE id = n.id;
  END IF;

  IF v_old_parent IS DISTINCT FROM p_parent_id THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.move',
      jsonb_build_object('from_parent', v_old_parent, 'to_parent', p_parent_id));
  END IF;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.notes_op_move(uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_move(uuid, uuid, uuid, text, boolean) TO authenticated, service_role;
