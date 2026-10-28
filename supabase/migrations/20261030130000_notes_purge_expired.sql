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
--   3. purge__preview counts expired notes too.
-- notes_op_purge_expired stays as a harmless early sweep.

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
-- workspace for tomorrow instead of rolling back the night. System work:
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

  RETURN jsonb_build_object('notes', v_notes, 'viewers', v_viewers, 'failed', v_failed);
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

-- ── 3. The dry run counts notes ─────────────────────────────────────────────
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
