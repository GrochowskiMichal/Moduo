-- notes__purge_ids locks the notes it collects.
--
-- 20261008013906 deletes a note's editing history (note_updates) in one
-- statement and the note itself in a later one, re-checking `deleted_at IS NOT
-- NULL` so a note restored meanwhile is kept. But the note rows weren't locked
-- in between. A Restore of a sub-note (allowed while its parent is still in the
-- trash) that committed between those two statements left the note alive with
-- its history already gone, i.e. without its edits since the last snapshot.
-- Found by the security review of PR #248. The ids are now collected with
-- SELECT … FOR UPDATE, in id order, so a concurrent Restore either waits for the
-- purge and then finds no note, or commits first and the note isn't collected
-- (FOR UPDATE re-checks `deleted_at` on the row it waited for).
--
-- Only the collecting SELECT changes; the rest is 20261008013906's body. Same
-- signature and return type, so CREATE OR REPLACE keeps the grants (postgres and
-- service_role only; asserted below).

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
  -- Lock what we're about to delete: a Restore of one of these notes now waits
  -- for this purge (then finds no note), or wins first and the note isn't
  -- collected. Without the lock a Restore could land between the history
  -- delete and the note delete, and the note would survive without its history.
  -- Id order keeps two overlapping purges from locking in opposite orders.
  SELECT array_agg(s.id) INTO v_ids FROM (
    SELECT nn.id FROM public.notes nn
      WHERE nn.workspace_id = p_workspace_id
        AND nn.id = ANY (coalesce(p_ids, '{}'::uuid[]))
        AND nn.deleted_at IS NOT NULL
      ORDER BY nn.id
      FOR UPDATE
  ) s;
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
