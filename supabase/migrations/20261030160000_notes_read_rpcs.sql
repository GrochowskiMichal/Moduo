-- NS-7 · Read RPCs (specs/notes-schema-hardening.md, Assumption 7, AC8).
--
-- The app opened a note's document with ceil((n+1)/1000) + 1–2 requests:
-- the note_updates log through RLS (can_access per row, each call walking the
-- ancestor chain), then the notes row for the snapshot, log first so a
-- compaction between the two reads only made the snapshot newer. The notes
-- list ran can_access per row too. Both are now one definer read each, which
-- checks access once:
--
--   notes_pull(ws, note, after_id, known_version) → jsonb
--     {updates: [≤ 1000 rows after after_id, id order], has_more, doc_version,
--      snapshot?}. The snapshot key is there only when known_version isn't the
--     note's doc_version (null on a note never compacted). The module key
--     notes.view (a key: its creator's, capped by its Notes scope) and
--     can_access(view), once: NS-6's notes__require minus its row lock, which
--     a STABLE function can't take. Hidden and missing are one answer, P0002
--     (PQ7). A trashed note still reads, as RLS let it (the trash preview).
--     STABLE: every statement in it sees the calling query's snapshot, so the
--     log page and the snapshot are one MVCC snapshot and the log-first order
--     is no longer needed.
--
--   notes_list_meta(ws, trash_since) → SETOF notes_meta
--     The live notes plus those trashed after trash_since (NULL: live only),
--     filtered once by notes__visible_ids (the set form of can_access),
--     ordered position COLLATE "C", id, at most 5,000 rows. A role or key that
--     can't open notes gets nothing, as RLS gave it.
--
-- Both resolve the actor themselves (perm_actor_id, the key's scope); the
-- actor is never a parameter. The app falls back to the table reads while
-- these are missing; NS-11 revokes the table SELECTs once nothing reads them.

DO $$
BEGIN
  IF to_regprocedure('public.notes__require_module(uuid, text)') IS NULL
     OR to_regprocedure('public.notes__meta(public.notes)') IS NULL
     OR to_regprocedure('public.notes__visible_ids(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'NS-7 needs NS-5 (20261030140000) and NS-6 (20261030150000) applied first.';
  END IF;
END;
$$;

-- ── notes_pull ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes_pull(
  p_workspace_id uuid, p_note_id uuid, p_after_id bigint, p_known_version integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_doc_state text;
  v_doc_version integer;
  v_updates jsonb;
  v_has_more boolean;
  v_out jsonb;
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, 'view');
  IF NOT coalesce(public.can_access('note', p_note_id, 'view', public.perm_actor_id()), false) THEN
    RAISE EXCEPTION 'Note not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;
  SELECT n.doc_state, n.doc_version INTO v_doc_state, v_doc_version
    FROM public.notes n
   WHERE n.id = p_note_id AND n.workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;

  -- One row past the page says whether there is more.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'client_id', p.client_id, 'client_seq', p.client_seq,
           'update_b64', p.update_b64, 'origin', p.origin, 'actor_key_id', p.actor_key_id)
           ORDER BY p.id) FILTER (WHERE p.rn <= 1000), '[]'::jsonb),
         count(*) > 1000
    INTO v_updates, v_has_more
    FROM (SELECT u.id, u.client_id, u.client_seq, u.update_b64, u.origin, u.actor_key_id,
                 row_number() OVER (ORDER BY u.id) AS rn
            FROM public.note_updates u
           WHERE u.note_id = p_note_id
             AND u.workspace_id = p_workspace_id
             AND u.id > coalesce(p_after_id, 0)
           ORDER BY u.id
           LIMIT 1001) p;

  v_out := jsonb_build_object('updates', v_updates, 'has_more', v_has_more,
                              'doc_version', coalesce(v_doc_version, 0));
  IF p_known_version IS DISTINCT FROM coalesce(v_doc_version, 0) THEN
    v_out := v_out || jsonb_build_object('snapshot', v_doc_state);
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.notes_pull(uuid, uuid, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_pull(uuid, uuid, bigint, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.notes_pull(uuid, uuid, bigint, integer) IS
  'NS-7: a note''s log page (≤ 1000 rows after p_after_id) and, when p_known_version is stale, its snapshot, from one snapshot with access checked once. Hidden equals missing (P0002).';

-- ── notes_list_meta ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes_list_meta(p_workspace_id uuid, p_trash_since timestamptz)
RETURNS SETOF public.notes_meta
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_vis uuid[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to use notes.' USING ERRCODE = '42501';
  END IF;
  -- A role or key that can't open notes lists nothing (RLS's answer), not an error.
  BEGIN
    PERFORM public.notes__require_module(p_workspace_id, 'view');
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  v_vis := public.notes__visible_ids(p_workspace_id, v_actor);
  IF cardinality(v_vis) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT m.*
      FROM public.notes n
      JOIN (SELECT DISTINCT v.id FROM unnest(v_vis) AS v(id)) vis ON vis.id = n.id
      CROSS JOIN LATERAL public.notes__meta(n) m
     WHERE n.workspace_id = p_workspace_id
       AND (n.deleted_at IS NULL OR n.deleted_at > p_trash_since)
     ORDER BY n.position COLLATE "C", n.id
     LIMIT 5000;
END;
$$;

REVOKE ALL ON FUNCTION public.notes_list_meta(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_list_meta(uuid, timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.notes_list_meta(uuid, timestamptz) IS
  'NS-7: the notes list (live, plus trashed after p_trash_since) as notes_meta, visibility computed once (notes__visible_ids), ordered position COLLATE "C", id, at most 5,000 rows.';
