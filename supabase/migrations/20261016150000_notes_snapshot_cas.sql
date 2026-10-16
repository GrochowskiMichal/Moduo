-- Notes compaction: refuse a fold over a snapshot the client never saw.
--
-- Race this closes (pre-dates NR-7): client A pulls; client B compacts rows A
-- never saw (folds them into doc_state and deletes them from note_updates);
-- A then compacts and its snapshot replaces B's. The rows B folded were then
-- in neither the log nor the snapshot. Now the client passes the doc_version
-- it last pulled; on a mismatch the op changes nothing and answers
-- {refused: true, doc_version: <current>} (no RAISE), and the client pulls
-- and folds again next cycle. NULL keeps the old unconditional behaviour for
-- any caller that doesn't send it. The row lock taken by
-- notes_op__guard_note makes check-and-write atomic.
--
-- Body rebuilt from prod's pg_get_functiondef (identical to
-- 20260703120000_notes_module.sql) plus the version check. The old 6-arg
-- signature is dropped so named-arg RPC calls can't hit an ambiguous overload;
-- the new parameter has a default, so 6-arg calls still resolve.

DROP FUNCTION IF EXISTS public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text);

CREATE FUNCTION public.notes_op_save_snapshot(
  p_workspace_id uuid,
  p_note_id uuid,
  p_snapshot_b64 text,
  p_upto_update_id bigint,
  p_body_text text DEFAULT NULL,
  p_body_md text DEFAULT NULL,
  p_expected_doc_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_folded integer;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  IF p_snapshot_b64 IS NULL OR p_snapshot_b64 = '' THEN
    RAISE EXCEPTION 'A snapshot is required.';
  END IF;

  IF p_expected_doc_version IS NOT NULL
     AND n.doc_version IS DISTINCT FROM p_expected_doc_version THEN
    RETURN jsonb_build_object('folded', 0, 'refused', true, 'doc_version', n.doc_version);
  END IF;

  DELETE FROM public.note_updates
    WHERE note_id = n.id AND id <= coalesce(p_upto_update_id, 0);
  GET DIAGNOSTICS v_folded = ROW_COUNT;

  UPDATE public.notes SET
    doc_state = p_snapshot_b64,
    doc_version = doc_version + 1,
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md),
    updated_at = now()
    WHERE id = n.id;

  RETURN jsonb_build_object('folded', v_folded, 'refused', false, 'doc_version', n.doc_version + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text, bigint) TO service_role;
