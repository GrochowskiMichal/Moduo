-- NOTE-FIX-1 — durable materialization for imported notes.
--
-- NO-8's import wrote `body_md`/`body_text` and left `doc_state` EMPTY: the
-- editor's CRDT was seeded from a session-scoped in-memory map, so a note
-- imported yesterday — or opened on another device — rendered BLANK. The
-- content was never lost (it stayed in `body_md`, searchable and exportable),
-- but the app looked like it ate the user's notes.
--
-- The client can now build the Yjs doc headlessly (`editor/materialize.ts`), so
-- new imports pass `docStateB64` straight to `notes_op_import`. This migration
-- adds the two server pieces the REPAIR of already-imported notes needs:
--
--   notes_op_seed_doc          — a ONCE-ONLY guarded write of `doc_state`
--   notes_list_unmaterialized  — find the notes still needing it
--
-- Once-only is the whole point. Two devices opening the same blank note would
-- otherwise each seed it, and merging two independently-built CRDT docs
-- DUPLICATES the content rather than deduping it. The guard makes the first
-- writer win permanently; every later caller is told to pull instead.

-- notes.seed_doc — materialize a never-materialized note's CRDT doc.
-- Refuses (without error) once the doc exists in ANY form, so it is safe to
-- call optimistically from every client that opens a blank imported note.
CREATE OR REPLACE FUNCTION public.notes_op_seed_doc(
  p_workspace_id uuid,
  p_note_id uuid,
  p_doc_state_b64 text,
  p_body_text text DEFAULT NULL,
  p_body_md text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
BEGIN
  -- Takes the note's row lock (FOR UPDATE), so concurrent seeders serialize
  -- here and exactly one of them can pass the emptiness check below.
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);

  IF p_doc_state_b64 IS NULL OR btrim(p_doc_state_b64) = '' THEN
    RAISE EXCEPTION 'A doc state is required.';
  END IF;

  -- Already has a snapshot → someone materialized it first.
  IF n.doc_state IS NOT NULL AND n.doc_state <> '' THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'already_materialized');
  END IF;

  -- A note with NO snapshot can still hold content: `doc_state` is only
  -- written by compaction, so a normally-created note that has been edited
  -- lives entirely in `note_updates` until it folds. Seeding over THAT would
  -- duplicate every block. This check is what makes the op safe to call on
  -- any note, not just an imported one.
  IF EXISTS (SELECT 1 FROM public.note_updates u WHERE u.note_id = n.id) THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'has_updates');
  END IF;

  -- NOTE: `updated_at` is deliberately NOT touched. This is a repair, not an
  -- edit — the user changed nothing. Bumping it would reorder Recents and the
  -- Home notes widget (both sort by updated_at DESC) so that the first load
  -- after deploy showed nothing but backfilled notes, from a pass the user
  -- never saw. Callers pass NULL bodies too, so `body_md` (the faithful
  -- imported markdown) survives untouched via the coalesce.
  UPDATE public.notes SET
    doc_state = p_doc_state_b64,
    doc_version = doc_version + 1,
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md)
    WHERE id = n.id;

  RETURN jsonb_build_object('seeded', true, 'reason', NULL,
                            'doc_version', n.doc_version + 1);
END;
$$;

-- notes.list_unmaterialized — the backfill's work list: notes that carry a
-- body but have no CRDT doc at all, so they render blank in the editor.
-- Trashed notes are excluded (restoring one re-lists it); ARCHIVED ones are
-- included on purpose — an archived note still opens, and still opens blank.
-- Ordered oldest-first so a resumed sweep makes monotonic progress.
CREATE OR REPLACE FUNCTION public.notes_list_unmaterialized(
  p_workspace_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (o_id uuid, o_body_md text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  RETURN QUERY
    SELECT n.id, n.body_md
      FROM public.notes n
     WHERE n.workspace_id = p_workspace_id
       AND n.deleted_at IS NULL
       AND (n.doc_state IS NULL OR n.doc_state = '')
       AND coalesce(btrim(n.body_md), '') <> ''
       -- doc_state is only written by compaction, so "no snapshot" does NOT
       -- mean "empty" — a normally-edited note lives in note_updates until it
       -- folds. Seeding one of those would duplicate every block.
       AND NOT EXISTS (SELECT 1 FROM public.note_updates u WHERE u.note_id = n.id)
     ORDER BY n.created_at ASC
     LIMIT greatest(1, least(coalesce(p_limit, 200), 1000));
END;
$$;

-- Grants. A fresh CREATE FUNCTION defaults EXECUTE to PUBLIC, so every new op
-- must re-apply the lockdown explicitly (the recorded DROP+CREATE footgun).
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'notes_op_seed_doc(uuid, uuid, text, text, text)',
    'notes_list_unmaterialized(uuid, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    -- service_role for parity with every other notes op: the MCP connector
    -- runs as service_role and its body-only writes (notes_create/append/
    -- update) leave exactly the un-materialized notes this repairs, so it is
    -- the natural next caller. Nothing calls these as service_role today.
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;
