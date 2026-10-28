-- NS-10 · Compact what nobody opens (specs/notes-schema-hardening.md AC11,
-- Assumption 10).
--
-- Only an app client that opens a note folds its Yjs log (notes_op_save_snapshot
-- past 40 rows). The MCP connector writes one note_updates row per agent edit
-- and never folds, so a note only agents write grew forever. The nightly
-- purge-deleted run now folds it on the server:
--   1. notes__compact_candidates(p_limit): notes with more than 200 log rows,
--      none written in the last 10 minutes, not in the trash, and nobody in
--      note_live_viewers (rows older than 10 minutes were swept by the notes
--      trash step just before), the longest logs first.
--   2. notes__compact_source(p_note): its snapshot, version and log, for the
--      Edge Function to merge (compactFromLog in the notes-doc bundle).
--   3. notes__compact(p_note, p_snapshot_b64, p_upto_id, p_expected_version):
--      the fold, with notes_op_save_snapshot's CAS (20261016150000): a version
--      that moved since the load, or someone opening the note meanwhile,
--      changes nothing and answers {refused: true}. It never writes body_text
--      or body_md (the client stays the only markdown serialiser, NR-6), and
--      leaves updated_at alone: the content did not change.
-- All three are the service role's alone. With no actor, NS-8's statement-level
-- notes__updates_check lets the DELETE through as system work, and
-- notes__updates_live queues one notice for the note.

DO $do$
BEGIN
  IF to_regprocedure('public.notes__updates_check()') IS NULL THEN
    RAISE EXCEPTION 'NS-10 needs NS-8 (20261030170000_notes_writes_check_once.sql) applied first';
  END IF;
END;
$do$;

-- ── 1. The pick ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notes__compact_candidates(p_limit integer DEFAULT 50)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT u.note_id, count(*) AS rows
    FROM public.note_updates u
    JOIN public.notes n ON n.id = u.note_id AND n.deleted_at IS NULL
    WHERE NOT EXISTS (SELECT 1 FROM public.note_live_viewers v WHERE v.note_id = u.note_id)
    GROUP BY u.note_id
    HAVING count(*) > 200 AND max(u.created_at) < now() - interval '10 minutes'
    ORDER BY count(*) DESC, u.note_id
    LIMIT greatest(coalesce(p_limit, 50), 1)
  )
  SELECT coalesce(array_agg(c.note_id ORDER BY c.rows DESC, c.note_id), '{}') FROM c
$$;

REVOKE ALL ON FUNCTION public.notes__compact_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__compact_candidates(integer) TO service_role;

-- ── 2. The source ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notes__compact_source(p_note uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'doc_state', n.doc_state,
    'doc_version', n.doc_version,
    'updates', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', u.id, 'update_b64', u.update_b64) ORDER BY u.id)
      FROM public.note_updates u WHERE u.note_id = n.id
    ), '[]'::jsonb))
  FROM public.notes n
  WHERE n.id = p_note
$$;

REVOKE ALL ON FUNCTION public.notes__compact_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__compact_source(uuid) TO service_role;

-- ── 3. The fold ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notes__compact(
  p_note uuid,
  p_snapshot_b64 text,
  p_upto_id bigint,
  p_expected_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_folded integer;
BEGIN
  IF p_snapshot_b64 IS NULL OR p_snapshot_b64 = '' THEN
    RAISE EXCEPTION 'A snapshot is required.';
  END IF;
  IF p_upto_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'A fold needs the last row it merged and the version it loaded.';
  END IF;

  -- The row lock makes check-and-write atomic against a client's fold.
  SELECT * INTO n FROM public.notes WHERE id = p_note FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('folded', 0, 'refused', true, 'doc_version', NULL);
  END IF;

  IF n.doc_version IS DISTINCT FROM p_expected_version
     OR EXISTS (SELECT 1 FROM public.note_live_viewers v WHERE v.note_id = p_note) THEN
    RETURN jsonb_build_object('folded', 0, 'refused', true, 'doc_version', n.doc_version);
  END IF;

  DELETE FROM public.note_updates WHERE note_id = p_note AND id <= p_upto_id;
  GET DIAGNOSTICS v_folded = ROW_COUNT;

  UPDATE public.notes SET
    doc_state = p_snapshot_b64,
    doc_version = doc_version + 1
    WHERE id = p_note;

  RETURN jsonb_build_object('folded', v_folded, 'refused', false, 'doc_version', n.doc_version + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.notes__compact(uuid, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__compact(uuid, text, bigint, bigint) TO service_role;
