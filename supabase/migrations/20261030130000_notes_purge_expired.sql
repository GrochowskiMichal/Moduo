-- NS-4 · Trash empties itself (specs/notes-schema-hardening.md, AC5,
-- Assumption 4, PQ2, PQ3).
--
-- Notes trash was only ever emptied by notes_op_purge_expired, which the app
-- runs when an editor opens Notes: it needs an actor and one refusal rolls the
-- whole workspace back. Now:
--   1. notes__purge_expired(p_limit): the nightly sweep purge-deleted runs as
--      the service role, with no actor, across every workspace. It goes
--      through notes__purge_ids, so live sub-notes keep their access (NS-3),
--      and it sweeps note_live_viewers rows older than 10 minutes.
--   2. notes_restore_window: past 30 days a note can't come back out of the
--      trash, by any path (PQ3), the same as tasks.
--   3. notes_op_restore leaves a sub-note trashed more than 30 days ago in the
--      trash, so restoring a younger parent isn't refused because of it.
--   4. purge__preview counts expired notes too.
-- notes_op_purge_expired stays as an early sweep when an editor opens Notes
-- (it purges whole expired subtrees; the nightly one only expired rows).

-- Builds on NS-3's notes__purge_ids (freeze trigger + re-root with access):
-- refuse on a database that doesn't have it yet.
DO $do$
BEGIN
  IF to_regprocedure('public.notes__freeze_children()') IS NULL
     OR to_regprocedure('public.notes__purge_ids(uuid, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'NS-4 needs NS-3 (20261030121000_notes_reroot_access.sql) applied first';
  END IF;
END;
$do$;

-- ── 1. The nightly sweep ────────────────────────────────────────────────────
-- Only the expired rows themselves: a sub-note trashed later than its expired
-- parent keeps its own 30 days (it is re-rooted, still in the trash). Each
-- workspace runs in its own subtransaction, so one refusal leaves that
-- workspace for tomorrow instead of rolling back the night. `picked` is what
-- this call took (purged or not): the caller stops once a call takes fewer
-- than p_limit. System work:
-- perm_enforce_write lets an actor-less delete through.
CREATE OR REPLACE FUNCTION public.notes__purge_expired(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws      uuid;
  v_ids     uuid[];
  v_notes   integer := 0;
  v_viewers integer := 0;
  v_failed  integer := 0;
  v_picked  integer := 0;
BEGIN
  FOR v_ws, v_ids IN
    SELECT s.workspace_id, array_agg(s.id ORDER BY s.id)
    FROM (
      SELECT n.id, n.workspace_id FROM public.notes n
      WHERE n.deleted_at < now() - interval '30 days'
      ORDER BY n.id
      LIMIT greatest(coalesce(p_limit, 500), 1)
      FOR UPDATE SKIP LOCKED
    ) s
    GROUP BY s.workspace_id
    ORDER BY s.workspace_id
  LOOP
    v_picked := v_picked + cardinality(v_ids);
    BEGIN
      v_notes := v_notes + public.notes__purge_ids(v_ws, v_ids);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'notes__purge_expired: workspace % skipped: % %', v_ws, SQLSTATE, SQLERRM;
    END;
  END LOOP;

  WITH d AS (
    DELETE FROM public.note_live_viewers v
    WHERE v.seen_at < now() - interval '10 minutes'
    RETURNING 1
  )
  SELECT count(*) INTO v_viewers FROM d;

  RETURN jsonb_build_object('notes', v_notes, 'viewers', v_viewers, 'failed', v_failed,
                            'picked', v_picked);
END;
$$;

REVOKE ALL ON FUNCTION public.notes__purge_expired(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__purge_expired(integer) TO service_role;

-- ── 2. No restore past 30 days ──────────────────────────────────────────────
-- Modelled on trash__stamp_deleted_at: past 30 days the note is the purge's.
-- Only clearing the stamp is refused; every other write is untouched.
CREATE OR REPLACE FUNCTION public.notes__restore_window()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND OLD.deleted_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'This note was deleted more than 30 days ago.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notes__restore_window() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__restore_window() TO service_role;

DROP TRIGGER IF EXISTS notes_restore_window ON public.notes;
CREATE TRIGGER notes_restore_window
  BEFORE UPDATE OF deleted_at ON public.notes
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.notes__restore_window();

-- ── 3. Restore skips expired sub-notes ──────────────────────────────────────
-- 20261013120000's body (as deployed) plus the 30-day filter on the subtree.
CREATE OR REPLACE FUNCTION public.notes_op_restore(p_workspace_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_ids uuid[];
  v_id uuid;
  v_reroot boolean := false;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id, true);
  IF n.deleted_at IS NULL THEN
    RAISE EXCEPTION 'This note is not in the trash.';
  END IF;

  SELECT array_agg(t.id) INTO v_ids FROM (
    SELECT nn.id FROM public.notes nn
    WHERE nn.id IN (SELECT public.notes__subtree_ids(p_workspace_id, p_note_id))
      AND nn.deleted_at IS NOT NULL
      -- A sub-note trashed on its own more than 30 days ago is the purge's: it
      -- stays in the trash. The note itself is always included, so an expired
      -- one is refused by notes_restore_window.
      AND (nn.id = p_note_id OR nn.deleted_at >= now() - interval '30 days')
  ) t;

  IF n.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.notes p
    WHERE p.id = n.parent_id AND p.workspace_id = p_workspace_id AND p.deleted_at IS NULL
  ) THEN
    v_reroot := true;
  END IF;

  UPDATE public.notes
    SET deleted_at = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);
  IF v_reroot THEN
    IF coalesce(n.share_mode, 'custom') = 'inherit' THEN
      PERFORM public.notes__keep_access_on_reroot(p_workspace_id, n.id);
    END IF;
    UPDATE public.notes SET parent_id = NULL
      WHERE workspace_id = p_workspace_id AND id = n.id;
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM public.entities_op_upsert(
      p_workspace_id, 'note', v_id,
      (SELECT coalesce(nullif(btrim(nn.title), ''), 'Untitled')
         FROM public.notes nn WHERE nn.id = v_id), 'note');
  END LOOP;

  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.restore',
    jsonb_build_object('title', n.title, 'count', coalesce(array_length(v_ids, 1), 0)));

  RETURN jsonb_build_object(
    'restored_ids', to_jsonb(coalesce(v_ids, '{}'::uuid[])),
    'count', coalesce(array_length(v_ids, 1), 0));
END;
$function$;

REVOKE ALL ON FUNCTION public.notes_op_restore(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_restore(uuid, uuid) TO authenticated, service_role;

-- ── 4. The dry run counts notes ─────────────────────────────────────────────
-- 20261008210500's body plus the notes count.
CREATE OR REPLACE FUNCTION public.purge__preview()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'attachments', (SELECT count(*) FROM public.attachments__purge_candidates(1000000)),
    'orphan_objects', (SELECT count(*) FROM public.attachments__orphan_objects(1000000)),
    'tasks', (SELECT count(*) FROM public.tasks t
              WHERE t.deleted_at < now() - interval '30 days'),
    'buckets', (SELECT count(*) FROM public.buckets b
                WHERE b.deleted_at < now() - interval '30 days' AND NOT b.is_system),
    'notes', (SELECT count(*) FROM public.notes n
              WHERE n.deleted_at < now() - interval '30 days'))
$$;

REVOKE ALL ON FUNCTION public.purge__preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge__preview() TO service_role;
