-- NS-3 · Deleting a parent keeps access (specs/notes-schema-hardening.md, AC4,
-- Assumption 3, PQ1).
--
-- A sub-note that follows its parent's sharing ('inherit') has nothing to
-- follow once its parent is hard-deleted: the key's ON DELETE SET NULL
-- (parent_id) makes it a parentless inherit note, which can_access reads as
-- "creator and direct grants only", so everyone who saw it through the parent
-- loses it. Move, file, restore and purge freeze the access first
-- (notes__keep_access_on_reroot); account erasure and any other hard delete
-- didn't. Now the database does it on every delete:
--
-- 1. notes__copy_chain_access: the helper's grant copy, on its own. It writes
--    only resource_grants, never the sub-note's row.
-- 2. notes__keep_access_on_reroot gains p_skip_creator (the old two-argument
--    form is dropped; existing callers pass two and get the default).
-- 3. BEFORE DELETE trigger notes_freeze_children: for each inherit child of
--    the deleted row, copy what the chain gave it, skipping the deleted row's
--    own creator (an erased person gets nothing back).
-- 4. BEFORE UPDATE OF parent_id trigger notes_orphan_custom: when the key's
--    SET NULL re-roots an inherit child (its parent row is gone), the child
--    becomes custom in the same write.
-- 5. CHECK notes_inherit_has_parent: an inherit note always has a parent.
--    Any future path that un-parents without freezing fails loudly.
-- 6. notes__purge_ids' parent-cycle branch freezes before it un-parents.
-- 7. share_op_follow_parent refuses a top-level note in words (22023).
--
-- Why the trigger never writes the child's row: one DELETE often removes a
-- parent and its child together (erasure deletes a person's nested private
-- pages in one statement). A BEFORE DELETE trigger that updates the child
-- makes the outer DELETE fail when it reaches that child ("tuple to be updated
-- was already modified by an operation triggered by the current command").
-- So the trigger copies grants only, share_sync_note_flag holds its
-- workspace_shared update while it does (notes.freezing), and the share_mode
-- flip rides on the key's own SET NULL write (4.), which runs after the
-- statement, once the children that were deleted too are gone.
--
-- Account erasure needs no change: its DELETE fires the trigger.

SET LOCAL lock_timeout = '5s';

-- Built on 20261013120000's bodies of the helper and notes__purge_ids.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notes__purge_ids'
                 AND pronamespace = 'public'::regnamespace
                 AND prosrc LIKE '%Trashed rows left with no leaf among them sit in a parent cycle%') THEN
    RAISE EXCEPTION 'NS-3: notes__purge_ids is not the 20261013120000 body this migration re-cuts';
  END IF;
END;
$do$;

-- ── 1. The grant copy ────────────────────────────────────────────────────────

-- Copy what a note's parent chain gives it: each walked ancestor's
-- member/workspace grants (highest level wins) and `full` for each walked
-- ancestor's creator (can_access ranks a creator at every level it walks),
-- except the note's own creator and p_skip_creator. Public links are not
-- copied: a published ancestor doesn't publish a filed-away child. Writes only
-- resource_grants.
CREATE OR REPLACE FUNCTION public.notes__copy_chain_access(
  p_workspace_id uuid,
  p_note_id uuid,
  p_skip_creator uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self_creator uuid;
  v_id uuid;
  v_parent uuid;
  v_mode text;
  v_creator uuid;
  v_guard int := 0;
BEGIN
  SELECT parent_id, created_by INTO v_id, v_self_creator
    FROM public.notes WHERE id = p_note_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN RETURN; END IF;

  WHILE v_id IS NOT NULL AND v_guard < 100 LOOP
    v_guard := v_guard + 1;
    SELECT parent_id, coalesce(share_mode, 'custom'), created_by
      INTO v_parent, v_mode, v_creator
      FROM public.notes WHERE id = v_id;
    EXIT WHEN NOT FOUND;

    INSERT INTO public.resource_grants
      (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
    SELECT p_workspace_id, 'note', p_note_id, g.subject_type, g.subject_id, g.level,
           public.perm_actor_id()
      FROM public.resource_grants g
     WHERE g.resource_type = 'note' AND g.resource_id = v_id
       AND g.subject_type IN ('member', 'workspace')
    ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO UPDATE
      SET level = CASE
        WHEN public.grant_level_rank(EXCLUDED.level) > public.grant_level_rank(public.resource_grants.level)
        THEN EXCLUDED.level ELSE public.resource_grants.level END;

    IF v_creator IS NOT NULL AND v_creator IS DISTINCT FROM v_self_creator
       AND v_creator IS DISTINCT FROM p_skip_creator THEN
      INSERT INTO public.resource_grants
        (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
      VALUES (p_workspace_id, 'note', p_note_id, 'member', v_creator, 'full', public.perm_actor_id())
      ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO UPDATE
        SET level = 'full';
    END IF;

    EXIT WHEN v_mode IS DISTINCT FROM 'inherit' OR v_parent IS NULL;
    v_id := v_parent;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.notes__copy_chain_access(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__copy_chain_access(uuid, uuid, uuid) TO service_role;

-- ── 2. The re-root helper ────────────────────────────────────────────────────

-- Before re-rooting a sub-note that follows its parent, freeze what the chain
-- gave it, then make it `custom` (see notes__copy_chain_access).
DROP FUNCTION IF EXISTS public.notes__keep_access_on_reroot(uuid, uuid);
CREATE OR REPLACE FUNCTION public.notes__keep_access_on_reroot(
  p_workspace_id uuid,
  p_note_id uuid,
  p_skip_creator uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.notes WHERE id = p_note_id AND workspace_id = p_workspace_id) THEN
    RETURN;
  END IF;
  PERFORM public.notes__copy_chain_access(p_workspace_id, p_note_id, p_skip_creator);
  UPDATE public.notes SET share_mode = 'custom' WHERE id = p_note_id;
END;
$$;
REVOKE ALL ON FUNCTION public.notes__keep_access_on_reroot(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__keep_access_on_reroot(uuid, uuid, uuid) TO service_role;

-- ── 3. Freeze on delete ──────────────────────────────────────────────────────

-- While notes__freeze_children copies grants onto a child that the same
-- DELETE may remove next, the child's row must not be written.
CREATE OR REPLACE FUNCTION public.share_sync_note_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text := CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_type ELSE NEW.resource_type END;
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_id ELSE NEW.resource_id END;
BEGIN
  -- notes_orphan_custom sets the flag in the re-rooting write.
  IF coalesce(current_setting('notes.freezing', true), '') = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF v_type = 'note' THEN
    UPDATE public.notes SET workspace_shared = EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = v_id AND g.subject_type = 'workspace'
    ) WHERE id = v_id;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.share_sync_note_flag() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_sync_note_flag() TO service_role;

-- Every inherit child (live or in the trash, which may come back) keeps what
-- the deleted row's chain gave it. The deleted row's creator gets nothing
-- from it: on erasure that creator is the person being erased. A workspace
-- being deleted takes every note with it, so there is nothing to keep.
CREATE OR REPLACE FUNCTION public.notes__freeze_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child uuid;
  v_freezing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  v_freezing := current_setting('notes.freezing', true);
  PERFORM set_config('notes.freezing', '1', true);
  FOR v_child IN
    SELECT n.id FROM public.notes n
     WHERE n.parent_id = OLD.id AND n.workspace_id = OLD.workspace_id
       AND coalesce(n.share_mode, 'custom') = 'inherit'
     ORDER BY n.id
  LOOP
    PERFORM public.notes__copy_chain_access(OLD.workspace_id, v_child, OLD.created_by);
  END LOOP;
  PERFORM set_config('notes.freezing', coalesce(v_freezing, ''), true);
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.notes__freeze_children() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__freeze_children() TO service_role;

DROP TRIGGER IF EXISTS notes_freeze_children ON public.notes;
CREATE TRIGGER notes_freeze_children
  BEFORE DELETE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes__freeze_children();

-- ── 4. The key's SET NULL makes the child custom ─────────────────────────────

-- Only when the parent row is gone, which only a delete does: an op that
-- re-roots a live parent's child must freeze it itself, or the CHECK refuses.
-- Definer: a caller who can't read the parent mustn't make it look gone.
CREATE OR REPLACE FUNCTION public.notes__orphan_custom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.parent_id IS NOT NULL AND NEW.parent_id IS NULL
     AND coalesce(NEW.share_mode, 'custom') = 'inherit'
     AND NOT EXISTS (SELECT 1 FROM public.notes p WHERE p.id = OLD.parent_id) THEN
    NEW.share_mode := 'custom';
    NEW.workspace_shared := EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = NEW.id AND g.subject_type = 'workspace');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notes__orphan_custom() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__orphan_custom() TO service_role;

DROP TRIGGER IF EXISTS notes_orphan_custom ON public.notes;
CREATE TRIGGER notes_orphan_custom
  BEFORE UPDATE OF parent_id ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes__orphan_custom();

-- ── 6. Purge's cycle branch freezes first ────────────────────────────────────

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
  v_survivor uuid;
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

  -- Live survivors that follow a parent being deleted keep their access first
  -- (NR-1): the parent's grants are about to disappear with it.
  FOR v_survivor IN
    SELECT nn.id FROM public.notes nn
     WHERE nn.workspace_id = p_workspace_id
       AND nn.deleted_at IS NULL
       AND nn.parent_id = ANY (v_ids)
       AND coalesce(nn.share_mode, 'custom') = 'inherit'
     ORDER BY nn.id
  LOOP
    PERFORM public.notes__keep_access_on_reroot(p_workspace_id, v_survivor);
  END LOOP;

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
  -- Anything that follows its parent keeps its access first (NS-3): an
  -- inherit note can't be top-level.
  IF EXISTS (SELECT 1 FROM public.notes
             WHERE workspace_id = p_workspace_id AND id = ANY (v_ids)
               AND deleted_at IS NOT NULL) THEN
    FOR v_survivor IN
      SELECT nn.id FROM public.notes nn
       WHERE nn.workspace_id = p_workspace_id
         AND nn.id = ANY (v_ids)
         AND nn.parent_id IS NOT NULL
         AND coalesce(nn.share_mode, 'custom') = 'inherit'
       ORDER BY nn.id
    LOOP
      PERFORM public.notes__keep_access_on_reroot(p_workspace_id, v_survivor);
    END LOOP;
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
REVOKE ALL ON FUNCTION public.notes__purge_ids(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__purge_ids(uuid, uuid[]) TO service_role;

-- ── 7. Following a parent needs a parent ─────────────────────────────────────

-- The CHECK below would refuse a top-level note with a raw constraint error;
-- say it in words first. Otherwise 20261024150000's body.
CREATE OR REPLACE FUNCTION public.share_op_follow_parent(p_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bypass text;
BEGIN
  IF NOT public.can_access('note', p_note_id, 'full') THEN
    RAISE EXCEPTION 'You can''t change who has access to this.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notes WHERE id = p_note_id AND parent_id IS NULL) THEN
    RAISE EXCEPTION 'A top-level note has no parent to follow.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false WHERE id = p_note_id;

  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = p_note_id;
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public.share_op_follow_parent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_follow_parent(uuid) TO authenticated, service_role;

-- ── 5. An inherit note always has a parent ───────────────────────────────────

ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_inherit_has_parent;
ALTER TABLE public.notes ADD CONSTRAINT notes_inherit_has_parent
  CHECK (share_mode = 'custom' OR parent_id IS NOT NULL);
