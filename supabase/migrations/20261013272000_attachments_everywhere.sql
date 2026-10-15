-- AT-3 (specs/attachments.md block 3): attachments everywhere + Settings → Storage.
--
-- 1. attachments_op_abandon(id): the uploader lets go of an upload that never
--    finished (dismissed, or begun again after a refusal or a failure). Until
--    now the old pending row kept its declared size in the owner's pool until
--    the 24 h sweep. With nothing stored yet the row goes at once; with bytes
--    stored it turns `failed` (the daily purge removes the bytes, then the row)
--    and holds only what it stored (2).
-- 2. storage__unsettled_bytes: a failed upload counts the bytes it really
--    stored, never its declared size. A failed row's objects can't grow: the
--    object guard and the upload policies only take writes to pending rows.
--    Re-cut from the live body (20261008210500).
-- 3. attachments_largest(workspace, limit): Settings → Storage's "largest
--    files" list. SECURITY INVOKER: RLS on attachments and tasks decides what
--    shows, and the same item gate is asked again explicitly, so a file shows
--    only to someone who can see its task. Each row says whether the reader
--    may delete it (edit access to the task, as attachments_op_delete asks).
-- 4. An index for the shared store's delta read of attachments (TV-D11a's
--    (workspace_id, updated_at, id) order).
--
-- Re-runnable: CREATE OR REPLACE, IF NOT EXISTS.

-- ── 1. Abandon one's own unfinished upload ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.attachments_op_abandon(p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_row    public.attachments;
  v_stored boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  -- The row lock orders this against an upload landing now: the object guard
  -- share-locks the pending row, so a write in flight commits first (and is
  -- counted below), and a write after this sees no pending row and is refused.
  SELECT * INTO v_row FROM public.attachments a WHERE a.id = p_id FOR UPDATE;
  -- Only the uploader's own upload: anyone else learns nothing about it.
  IF NOT FOUND OR v_row.uploader_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- A finished file is never abandoned (a Dismiss that raced its finalize):
  -- deleting it is attachments_op_delete's, with its Undo.
  IF v_row.status = 'ready' THEN
    RETURN 'ready';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'attachments'
      AND (o.name = v_row.object_path OR o.name = v_row.preview_path)
  ) INTO v_stored;
  IF NOT v_stored THEN
    DELETE FROM public.attachments WHERE id = p_id;
    RETURN 'removed';
  END IF;
  IF v_row.status = 'pending' THEN
    UPDATE public.attachments SET status = 'failed', updated_at = now() WHERE id = p_id;
  END IF;
  RETURN 'failed';
END;
$$;

-- ── 2. What unfinished uploads hold ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.storage__unsettled_bytes(p_owner uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Pending: the larger of what was declared and what is stored (an upload in
  -- progress holds its whole size). Failed: only what is stored, until the
  -- purge removes it.
  SELECT coalesce(sum(CASE WHEN a.status = 'failed' THEN s.stored
                           ELSE greatest(a.size_bytes, s.stored) END), 0)::bigint
  FROM public.attachments a
  JOIN public.workspaces w ON w.id = a.workspace_id
  CROSS JOIN LATERAL (
    SELECT coalesce((SELECT (o.metadata ->> 'size')::bigint FROM storage.objects o
                     WHERE o.bucket_id = 'attachments' AND o.name = a.object_path), 0)
         + coalesce((SELECT (o.metadata ->> 'size')::bigint FROM storage.objects o
                     WHERE o.bucket_id = 'attachments' AND o.name = a.preview_path), 0) AS stored
  ) s
  WHERE w.owner_id = p_owner AND a.status <> 'ready'
$$;

-- ── 3. Settings → Storage: the largest files you can see ───────────────────

CREATE OR REPLACE FUNCTION public.attachments_largest(p_workspace_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE (
  id          uuid,
  task_id     uuid,
  task_title  text,
  file_name   text,
  mime        text,
  size_bytes  bigint,
  uploader_id uuid,
  created_at  timestamptz,
  can_delete  boolean
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tasks_module_can_access_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT a.id, a.entity_id, t.title, a.file_name, a.mime, a.size_bytes, a.uploader_id, a.created_at,
         public.can_access('task', a.entity_id, 'edit')
  FROM public.attachments a
  JOIN public.tasks t ON t.id = a.entity_id AND t.workspace_id = a.workspace_id
  WHERE a.workspace_id = p_workspace_id
    AND a.entity_type = 'task'
    AND a.status = 'ready'
    AND a.deleted_at IS NULL
    AND t.deleted_at IS NULL
    -- RLS already filters both tables; asked again so the list never depends
    -- on the caller's role honouring it.
    AND public.can_access('task', a.entity_id, 'view')
  ORDER BY a.size_bytes DESC, a.id
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END;
$$;

-- ── 4. The store's delta read ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS attachments_sync_idx
  ON public.attachments (workspace_id, updated_at, id);

-- ── Grants ─────────────────────────────────────────────────────────────────
-- The tables' grants as AT-1 set them, re-asserted now that the shared store
-- reads attachments too (a no-op on prod; the local snapshot grants every
-- table to anon and authenticated, TRUNCATE included, which RLS doesn't gate).
REVOKE ALL ON public.attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.attachments TO authenticated;
GRANT ALL ON public.attachments TO service_role;
REVOKE ALL ON public.storage_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.storage_usage TO service_role;

-- Both functions need a signed-in person (auth.uid()); a key (service_role)
-- has none, so neither is granted to it. Revoke anon and service_role by name:
-- Supabase grants new functions to them directly, not through PUBLIC.

REVOKE ALL ON FUNCTION public.attachments_op_abandon(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.attachments_op_abandon(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.attachments_largest(uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.attachments_largest(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.storage__unsettled_bytes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage__unsettled_bytes(uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.attachments_op_abandon(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.attachments_op_abandon(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.attachments_op_abandon(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.attachments_largest(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.attachments_largest(uuid, integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.attachments_largest(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.storage__unsettled_bytes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.storage__unsettled_bytes(uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.attachments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.attachments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.attachments', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.storage_usage', 'SELECT') THEN
    RAISE EXCEPTION 'AT-3 grants drifted: abandon and the largest-files list are for signed-in people only.';
  END IF;
END;
$$;
