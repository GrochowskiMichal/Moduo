-- share_op_follow_parent switches the note to 'inherit' before dropping its
-- grants, so anyone with Full can make a note follow its parent.
--
-- It deleted the note's resource_grants first. Each delete fires
-- share_sync_note_flag, which UPDATEs the note, and perm_enforce_write then
-- asked can_access('note', id, 'edit') of a note still in custom mode whose
-- grants were already gone. Only the creator passed: a member with Full, and
-- the workspace owner, got "You don't have access to this note.", in the
-- Share dialog and in notes_op_move(..., p_follow_parent => true).
--
-- Now the share_mode UPDATE comes first, while the grants are still there, so
-- perm_enforce_write and notes_guard_reparent (PR #641: Full and ws.publish
-- when the note starts following a published tree) check the caller's real
-- access. The grant clean-up then runs with share.bypass on: the caller has
-- already passed every check, and once the note inherits, the flag sync's
-- UPDATE would otherwise be checked against the parent, where a member with
-- Full on the note may only have View. The caller's share.bypass is saved and
-- put back (docs/gotchas/supabase.md).
--
-- The body is the live one (20261006210000_perm_sharing.sql) with only that
-- change. CREATE OR REPLACE keeps the owner and grants.
-- Test: supabase/tests/share_follow_parent_access.test.sql.

CREATE OR REPLACE FUNCTION public.share_op_follow_parent(p_note_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass text;
BEGIN
  IF NOT public.can_access('note', p_note_id, 'full') THEN
    RAISE EXCEPTION 'You can''t change who has access to this.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false WHERE id = p_note_id;

  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = p_note_id;
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
END;
$function$;
