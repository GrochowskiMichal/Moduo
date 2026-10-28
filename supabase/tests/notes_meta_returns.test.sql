-- NS-5 · Meta ops return meta only (specs/notes-schema-hardening.md, AC6,
-- Assumption 5; supabase/migrations/20261030140000_notes_lean_meta_results.sql).
-- The ten meta ops return public.notes_meta: every column noteRowSchema reads
-- (supabase/functions/_shared/contracts/rows.ts), and never doc_state or a
-- body column. A rename while typing a title no longer ships the document.
--
-- Cast: O owns W. P is a page, N a note under it.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text, position) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'Roadmap', 'secret body', 'secret body', 'a');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text, parent_id, position) VALUES
  (test.id('N'), test.id('W'), test.id('O'), 'Q4 plan', 'secret body', 'secret body', test.id('P'), 'a');

-- The columns the app reads, in noteRowSchema's order.
CREATE FUNCTION test.meta_cols() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['id', 'workspace_id', 'created_by', 'parent_id', 'title', 'icon', 'position', 'is_archived', 'published_at', 'publish_token', 'doc_version', 'share_mode',
    'workspace_shared', 'in_inbox', 'full_width', 'edited_by', 'edited_at', 'created_at',
    'updated_at', 'deleted_at']
$$;

-- One op call as O, its result as jsonb (or the error text).
CREATE FUNCTION test.call_op(p_call text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.value_as('O', format('SELECT to_jsonb(r)::text FROM %s r', p_call));
  IF v IS NULL OR v LIKE 'ERROR %' THEN
    RETURN jsonb_build_object('__error', coalesce(v, 'no row'));
  END IF;
  RETURN v::jsonb;
END;
$$;

CREATE FUNCTION test.keys(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM jsonb_object_keys(p) k
$$;

DO $$
DECLARE
  v_ws uuid := test.id('W');
  v_n uuid := test.id('N');
  v_p uuid := test.id('P');
  v_new uuid := test.id('NEW');
  v_expected text[] := (SELECT array_agg(c ORDER BY c) FROM unnest(test.meta_cols()) c);
  v_ops text[] := ARRAY['create', 'rename', 'move', 'set_meta', 'duplicate', 'file',
    'archive', 'unarchive', 'publish', 'unpublish'];
  v_op text;
  v_oid oid;
  v_calls jsonb;
  v_r jsonb;
BEGIN
  -- The type holds exactly the app's columns, in its order.
  PERFORM test.ok(
    (SELECT array_agg(a.attname::text ORDER BY a.attnum)
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.notes_meta') AND a.attnum > 0 AND NOT a.attisdropped)
      IS NOT DISTINCT FROM test.meta_cols(),
    'public.notes_meta has exactly the columns noteRowSchema reads');

  -- Each op returns the type, and only authenticated and service_role may call it.
  FOREACH v_op IN ARRAY v_ops LOOP
    SELECT p.oid INTO v_oid FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notes_op_' || v_op;
    PERFORM test.ok(v_oid IS NOT NULL AND (SELECT count(*) FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notes_op_' || v_op) = 1,
      format('notes_op_%s has one signature', v_op));
    PERFORM test.ok(pg_get_function_result(v_oid) = 'notes_meta',
      format('notes_op_%s returns notes_meta', v_op), pg_get_function_result(v_oid));
    PERFORM test.ok(
      has_function_privilege('authenticated', v_oid, 'EXECUTE')
        AND has_function_privilege('service_role', v_oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = v_oid)) a
                         WHERE a.grantee = 0),
      format('notes_op_%s: authenticated and service_role execute, anon and PUBLIC don''t', v_op));
  END LOOP;

  -- The helper is internal: only the definer ops (and service_role) call it.
  PERFORM test.ok(
    NOT has_function_privilege('anon', 'public.notes__meta(public.notes)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.notes__meta(public.notes)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.notes__meta(public.notes)', 'EXECUTE'),
    'notes__meta is not callable by anon or authenticated');

  -- Each op, called as the app calls it, returns the lean row.
  v_calls := jsonb_build_object(
    'create', format('public.notes_op_create(%L, %L, %L, %L, %L, %L)', v_ws, v_new, v_p, 'Fresh', 'b', NULL),
    'rename', format('public.notes_op_rename(%L, %L, %L)', v_ws, v_n, 'Q4 plan, renamed'),
    'move', format('public.notes_op_move(%L, %L, %L, %L, %L)', v_ws, v_n, NULL, 'c', false),
    'set_meta', format('public.notes_op_set_meta(%L, %L, %L::jsonb)', v_ws, v_n, '{"icon":"📌","fullWidth":true}'),
    'duplicate', format('public.notes_op_duplicate(%L, %L, %L)', v_ws, v_p, 'z'),
    'file', format('public.notes_op_file(%L, %L, %L, %L)', v_ws, v_n, true, 'd'),
    'archive', format('public.notes_op_archive(%L, %L)', v_ws, v_n),
    'unarchive', format('public.notes_op_unarchive(%L, %L)', v_ws, v_n),
    'publish', format('public.notes_op_publish(%L, %L)', v_ws, v_n),
    'unpublish', format('public.notes_op_unpublish(%L, %L)', v_ws, v_n));

  FOREACH v_op IN ARRAY v_ops LOOP
    v_r := test.call_op(v_calls ->> v_op);
    PERFORM test.ok(NOT v_r ? '__error', format('notes_op_%s runs', v_op), v_r ->> '__error');
    PERFORM test.ok(
      NOT (v_r ?| ARRAY['doc_state', 'body_text', 'body_md', 'search_tsv']),
      format('notes_op_%s returns no doc_state or body column', v_op), v_r::text);
    PERFORM test.ok(test.keys(v_r) = v_expected,
      format('notes_op_%s returns every column the app reads, and no other', v_op),
      test.keys(v_r)::text);
    PERFORM test.ok(
      v_r ->> 'id' = CASE v_op WHEN 'create' THEN v_new::text
                               WHEN 'duplicate' THEN (SELECT id::text FROM public.notes
                                 WHERE workspace_id = v_ws AND title = 'Roadmap (copy)' AND id <> v_p)
                               ELSE v_n::text END
        AND v_r ->> 'workspace_id' = v_ws::text,
      format('notes_op_%s returns the note it wrote', v_op), v_r::text);
  END LOOP;

  -- The values are the stored row's, not a stale or partial copy.
  v_r := test.call_op(format('public.notes_op_rename(%L, %L, %L)', v_ws, v_n, 'Final title'));
  PERFORM test.ok(
    v_r = (SELECT to_jsonb(m) FROM (SELECT n.id, n.workspace_id, n.created_by, n.parent_id, n.title,
             n.icon, n.position, n.is_archived, n.published_at, n.publish_token,
             n.doc_version, n.share_mode, n.workspace_shared, n.in_inbox, n.full_width, n.edited_by,
             n.edited_at, n.created_at, n.updated_at, n.deleted_at
           FROM public.notes n WHERE n.id = v_n) m),
    'a rename returns the stored values of every meta column', v_r::text);

  v_r := test.call_op(format('public.notes_op_publish(%L, %L)', v_ws, v_n));
  PERFORM test.ok(v_r ->> 'publish_token' IS NOT NULL
      AND v_r ->> 'publish_token' = (SELECT publish_token FROM public.notes WHERE id = v_n),
    'publish returns the new publish_token');
END;
$$;
