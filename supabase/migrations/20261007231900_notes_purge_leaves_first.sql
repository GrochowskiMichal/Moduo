-- "Delete forever" on a note with sub-notes: delete the sub-notes first.
--
-- Since PERM-1 (20261006200000) every write to `notes` passes
-- `perm_enforce_write`, which for a DELETE needs `can_access('note', id,
-- 'full')`. For a sub-note (share_mode 'inherit') can_access reads access
-- through its parent. `notes__purge_ids` deleted the whole trashed subtree in
-- ONE statement, and a row-level BEFORE trigger sees the rows already deleted
-- earlier in that statement. So when the parent went first, the child's
-- walk-up found no parent; `SELECT … INTO` then set every target to NULL,
-- including the workspace already read, and can_access returned false. Result:
-- "You don't have access to this note." for the note's own creator, whenever
-- the DELETE reached a parent before its child (that depends on scan order; it
-- did in both probes). The 30-day sweep (`notes_op_purge_expired`) goes through
-- the same function, so one such subtree would have failed a workspace's whole
-- sweep. Reproduced on prod 2026-10-07 in a rolled-back transaction, with and
-- without the client grants that 20261007223443 revoked. No user hit it: no
-- trashed note had trashed sub-notes at the time.
--
-- Fix: delete one depth level per statement, leaves first, so each row's
-- parent still exists while its access is checked. Rows still left after that
-- can only sit in a parent cycle (corrupt legacy data; prod had none). Break the
-- cycle by clearing parent_id, then delete them.
--
-- Same signature and return type, so CREATE OR REPLACE keeps the grants:
-- EXECUTE stays with postgres and service_role only (asserted below).
-- Supersedes the body in 20260703120000_notes_module.sql.

CREATE OR REPLACE FUNCTION public.notes__purge_ids(
  p_workspace_id uuid,
  p_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_count integer := 0;
  v_step integer;
BEGIN
  SELECT array_agg(nn.id) INTO v_ids FROM public.notes nn
    WHERE nn.workspace_id = p_workspace_id
      AND nn.id = ANY (coalesce(p_ids, '{}'::uuid[]))
      AND nn.deleted_at IS NOT NULL;
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- Re-root live survivors so the hard delete can't strand or cascade them.
  UPDATE public.notes
    SET parent_id = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND parent_id = ANY (v_ids);

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'note' AND source_id = ANY (v_ids))
        OR (target_type = 'note' AND target_id = ANY (v_ids)));

  -- Registry tombstones inline (see notes_op_trash for why not
  -- entities_op_tombstone).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id AND entity_type = 'note'
      AND entity_id = ANY (v_ids) AND deleted_at IS NULL;

  -- Leaves first: perm_enforce_write's access check reads a sub-note's access
  -- through its parent, which must still be there.
  LOOP
    DELETE FROM public.notes nn
      WHERE nn.workspace_id = p_workspace_id
        AND nn.id = ANY (v_ids)
        AND NOT EXISTS (
          SELECT 1 FROM public.notes ch
          WHERE ch.parent_id = nn.id AND ch.id = ANY (v_ids));
    GET DIAGNOSTICS v_step = ROW_COUNT;
    EXIT WHEN v_step = 0;
    v_count := v_count + v_step;
  END LOOP;

  -- No leaf left but rows remain: a parent cycle. Break it, then delete.
  IF EXISTS (SELECT 1 FROM public.notes
             WHERE workspace_id = p_workspace_id AND id = ANY (v_ids)) THEN
    UPDATE public.notes
      SET parent_id = NULL, updated_at = now()
      WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);
    DELETE FROM public.notes
      WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);
    GET DIAGNOSTICS v_step = ROW_COUNT;
    v_count := v_count + v_step;
  END IF;

  RETURN v_count;
END;
$$;

-- CREATE OR REPLACE keeps the ACL; prove it rather than trust it (gotchas
-- §Supabase: DROP + CREATE would have re-opened EXECUTE to PUBLIC).
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.notes__purge_ids(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notes__purge_ids(uuid, uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.notes__purge_ids(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'notes__purge_ids grants drifted: client roles must not have EXECUTE, service_role must.';
  END IF;
END;
$$;
