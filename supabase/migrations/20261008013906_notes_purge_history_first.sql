-- "Delete forever" for notes with editing history, and never for a restored note.
--
-- 1. History first. Every edited note has `note_updates` rows (prod, 2026-10-08:
--    all 6 trashed notes, 59 of 90 live ones). They go by FK ON DELETE CASCADE,
--    which runs only after the note row is deleted. PERM-1 (20261006200000)
--    put `perm_enforce_write('notes', 'edit')` on note_updates, and its
--    `can_access('note', note_id, 'edit')` reads the note, which is gone by then,
--    so it returns false. Since 2026-10-06, Delete forever and the 30-day sweep
--    failed with "You don't have access to this note." for any note with
--    history, the note's own creator included. Reproduced on prod in a
--    rolled-back transaction: one note, one update, trash, purge → 42501. The
--    logs show no purge call since then, so no user hit it. The history is now
--    deleted explicitly while its notes still exist, under the same trigger
--    (the purger needs edit on each note; deleting the note needs full).
-- 2. Never a restored note. Restore is allowed on a sub-note whose parent is
--    still trashed (notes_op_restore moves it to the top level), so a Restore
--    committing after this function collected its ids left a live note in the
--    list, and the DELETE removed it for good. Every DELETE now also requires
--    `deleted_at IS NOT NULL`. A statement that starts after the restore no
--    longer matches the row, and one waiting on the restore's row lock
--    re-checks it (READ COMMITTED) and skips it. Present since 20260703120000,
--    found by the code review of PR #248.
-- 3. Tombstones for what was deleted. Links and registry rows are now marked
--    after the deletes, for the ids actually deleted (RETURNING), so a restored
--    note keeps them. Safe to reorder: no trigger on entity_links or entities,
--    and no FK from either to notes.
--
-- Unchanged from 20261007231900: live children are moved to the top level
-- first, the subtree goes leaves first, and a parent cycle is broken and then
-- deleted. Same signature and return type, so CREATE OR REPLACE keeps the grants
-- (postgres and service_role only; asserted below).

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
  v_gone uuid[] := '{}';
  v_batch uuid[];
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

  -- History before its notes: perm_enforce_write on note_updates checks access
  -- through the note, which the FK cascade would only reach once it's gone.
  DELETE FROM public.note_updates u
    WHERE u.workspace_id = p_workspace_id
      AND u.note_id IN (SELECT nn.id FROM public.notes nn
                        WHERE nn.id = ANY (v_ids) AND nn.deleted_at IS NOT NULL);

  -- Leaves first: perm_enforce_write's access check reads a sub-note's access
  -- through its parent, which must still be there. Only rows still in the trash.
  LOOP
    WITH d AS (
      DELETE FROM public.notes nn
        WHERE nn.workspace_id = p_workspace_id
          AND nn.id = ANY (v_ids)
          AND nn.deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.notes ch
            WHERE ch.parent_id = nn.id AND ch.id = ANY (v_ids))
        RETURNING nn.id
    )
    SELECT array_agg(d.id) INTO v_batch FROM d;
    EXIT WHEN v_batch IS NULL;
    v_gone := v_gone || v_batch;
  END LOOP;

  -- Trashed rows left with no leaf among them sit in a parent cycle. Break it
  -- (re-rooting anything restored meanwhile too), then delete the trashed ones.
  IF EXISTS (SELECT 1 FROM public.notes
             WHERE workspace_id = p_workspace_id AND id = ANY (v_ids)
               AND deleted_at IS NOT NULL) THEN
    UPDATE public.notes
      SET parent_id = NULL, updated_at = now()
      WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);
    WITH d AS (
      DELETE FROM public.notes
        WHERE workspace_id = p_workspace_id AND id = ANY (v_ids)
          AND deleted_at IS NOT NULL
        RETURNING id
    )
    SELECT v_gone || coalesce(array_agg(d.id), '{}'::uuid[]) INTO v_gone FROM d;
  END IF;

  IF cardinality(v_gone) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'note' AND source_id = ANY (v_gone))
        OR (target_type = 'note' AND target_id = ANY (v_gone)));

  -- Registry tombstones inline (see notes_op_trash for why not
  -- entities_op_tombstone).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id AND entity_type = 'note'
      AND entity_id = ANY (v_gone) AND deleted_at IS NULL;

  RETURN cardinality(v_gone);
END;
$$;

-- CREATE OR REPLACE keeps the ACL; prove it rather than trust it.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.notes__purge_ids(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notes__purge_ids(uuid, uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.notes__purge_ids(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'notes__purge_ids grants drifted: client roles must not have EXECUTE, service_role must.';
  END IF;
END;
$$;
