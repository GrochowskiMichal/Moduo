-- AT-1 (specs/attachments.md block 1): private attachment storage, the
-- per-owner storage pool with per-plan limits, the 80/95% alerts, and the
-- trash (soft delete with the task, 30-day purge by the purge-deleted Edge
-- Function).
--
-- How an upload works (no Edge Function hands out URLs):
--   1. attachments_op_begin checks edit access, the per-file limit and the pool
--      (used + unfinished uploads + this file), creates a `pending` row and returns its
--      object paths.
--   2. The app uploads straight to Storage. The INSERT policy below only lets a
--      file land on a path a pending row of the same uploader names.
--   3. attachments_op_finalize reads the stored size from storage.objects,
--      refuses a size that differs from the declared one (status `failed`,
--      removed by the daily purge) and otherwise flips the row to `ready`.
--
-- The pool: storage_usage holds one row per workspace owner, kept by a trigger
-- on attachments (only `ready`, undeleted files count) and moved on a
-- workspace ownership transfer. The daily purge re-adds it from scratch.
--
-- Vocabularies mirror @contracts (vocabularies.ts): ATTACHMENT_STATUSES,
-- ATTACHMENT_DELETED_REASONS, ATTACHMENT_PREVIEW_MIMES.

-- ── 1. The bucket ──────────────────────────────────────────────────────────
-- Private (signed links only). 500 MiB is the highest plan cap; the per-plan
-- caps are enforced by attachments_op_begin/finalize. Supabase also caps every
-- upload at the project's global limit (Storage settings), which is why
-- attachments__platform_file_cap() exists.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, type)
VALUES ('attachments', 'attachments', false, 524288000, NULL, 'STANDARD')
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = NULL;

-- ── 2. Tables ──────────────────────────────────────────────────────────────

CREATE TABLE public.attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  -- Polymorphic like the spine (open string); the ops accept 'task' only for now.
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  -- Account deletion keeps files in other people's workspaces, uploader cleared.
  uploader_id      uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  file_name        text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime             text NOT NULL CHECK (char_length(mime) BETWEEN 1 AND 255),
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  object_path      text NOT NULL UNIQUE,
  preview_path     text UNIQUE,
  preview_mime     text CHECK (preview_mime IN ('image/webp','image/png','image/jpeg')),
  preview_bytes    bigint NOT NULL DEFAULT 0 CHECK (preview_bytes >= 0),
  width            integer CHECK (width > 0),
  height           integer CHECK (height > 0),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  deleted_at       timestamptz,
  deleted_reason   text CHECK (deleted_reason IN ('user','task','bucket')),
  deleted_batch_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_deleted_has_reason CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL))
);

CREATE INDEX attachments_entity_idx ON public.attachments (workspace_id, entity_type, entity_id);
CREATE INDEX attachments_trash_idx ON public.attachments (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX attachments_unfinished_idx ON public.attachments (created_at) WHERE status <> 'ready';
CREATE INDEX attachments_uploader_idx ON public.attachments (uploader_id);

COMMENT ON TABLE public.attachments IS
  'Files on tasks (AT-1). Bytes live in the private `attachments` bucket at {workspace}/{id}/original.{ext} and …/preview.{ext}. Written only through the attachments_op_* functions.';

-- One row per workspace owner: the bytes of every ready, undeleted file in the
-- workspaces they own. Server-only; clients read it through storage_status.
CREATE TABLE public.storage_usage (
  owner_id         uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  bytes_used       bigint NOT NULL DEFAULT 0,
  -- The highest alert sent since usage was last under 75% (0, 80 or 95).
  last_alert_level smallint NOT NULL DEFAULT 0 CHECK (last_alert_level IN (0, 80, 95)),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Access ──────────────────────────────────────────────────────────────

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.attachments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.storage_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.attachments TO authenticated;
GRANT ALL ON public.attachments TO service_role;
GRANT ALL ON public.storage_usage TO service_role;

-- A file is visible to whoever can see its task (PERM per-item rules).
CREATE POLICY attachments_select ON public.attachments
  FOR SELECT TO authenticated
  USING (public.can_access(entity_type, entity_id, 'view'));

-- ── 4. Limits ──────────────────────────────────────────────────────────────

-- The hosted project's global upload limit (Storage settings). Supabase's Free
-- plan can't set it above 50 MB, so every per-file cap is held under it. Raise
-- this in a new migration when the dashboard setting goes up (500 MB covers
-- every plan).
CREATE FUNCTION public.attachments__platform_file_cap()
RETURNS bigint
LANGUAGE sql IMMUTABLE
AS $$ SELECT 52428800::bigint $$;

-- Per-file and pool limits for a workspace owner's plan (specs/attachments.md):
-- Free 20 MB / 2 GB · Pro 200 MB / 50 GB · Duo 200 MB / 100 GB ·
-- Team 500 MB / 50 GB per paid seat · Founder = Team per file, 1 TB pool.
CREATE FUNCTION public.storage__limits_for_owner(p_owner uuid)
RETURNS TABLE (tier text, per_file_bytes bigint, total_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (SELECT coalesce(public.profile_plan_tier_text(p_owner), 'free') AS tier)
  SELECT t.tier,
         least(
           CASE t.tier
             WHEN 'founder' THEN 500 WHEN 'team' THEN 500
             WHEN 'duo' THEN 200 WHEN 'pro' THEN 200
             ELSE 20
           END::bigint * 1048576,
           public.attachments__platform_file_cap()),
         CASE t.tier
           WHEN 'founder' THEN 1024::bigint * 1073741824
           WHEN 'team' THEN 50::bigint * 1073741824 * greatest(public.workspace_seat_cap(p_owner), 1)
           WHEN 'duo' THEN 100::bigint * 1073741824
           WHEN 'pro' THEN 50::bigint * 1073741824
           ELSE 2::bigint * 1073741824
         END
  FROM t
$$;

-- What one row adds to its owner's pool.
CREATE FUNCTION public.attachments__bytes(p_status text, p_deleted_at timestamptz, p_size bigint, p_preview bigint)
RETURNS bigint
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_status = 'ready' AND p_deleted_at IS NULL THEN p_size + p_preview ELSE 0 END
$$;

-- Bytes held by files that aren't ready yet: uploads in progress, abandoned
-- and failed ones, until the purge removes them. Each counts the larger of what
-- was declared and what is actually stored (original + preview), so bytes
-- uploaded past a declared size, or left behind by a failed upload, still use
-- the pool until they're gone.
CREATE FUNCTION public.storage__unsettled_bytes(p_owner uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(greatest(
           a.size_bytes,
           coalesce((SELECT (o.metadata ->> 'size')::bigint FROM storage.objects o
                     WHERE o.bucket_id = 'attachments' AND o.name = a.object_path), 0)
         + coalesce((SELECT (o.metadata ->> 'size')::bigint FROM storage.objects o
                     WHERE o.bucket_id = 'attachments' AND o.name = a.preview_path), 0))), 0)::bigint
  FROM public.attachments a
  JOIN public.workspaces w ON w.id = a.workspace_id
  WHERE w.owner_id = p_owner AND a.status <> 'ready'
$$;

-- ── 5. The pool ledger ─────────────────────────────────────────────────────

-- Add a delta to an owner's pool. When usage drops under 75% the alerts re-arm.
CREATE FUNCTION public.storage_usage__add(p_owner uuid, p_delta bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used bigint;
  v_total bigint;
BEGIN
  IF p_owner IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;
  -- The owner's profile is already gone (account deletion cascading).
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_owner) THEN
    RETURN;
  END IF;
  INSERT INTO public.storage_usage AS su (owner_id, bytes_used)
  VALUES (p_owner, p_delta)
  ON CONFLICT (owner_id) DO UPDATE
    SET bytes_used = su.bytes_used + excluded.bytes_used, updated_at = now()
  RETURNING su.bytes_used INTO v_used;
  IF p_delta < 0 THEN
    SELECT l.total_bytes INTO v_total FROM public.storage__limits_for_owner(p_owner) l;
    IF v_used < v_total * 0.75 THEN
      UPDATE public.storage_usage SET last_alert_level = 0
      WHERE owner_id = p_owner AND last_alert_level <> 0;
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION public.attachments__ledger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old bigint := 0;
  v_new bigint := 0;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := public.attachments__bytes(OLD.status, OLD.deleted_at, OLD.size_bytes, OLD.preview_bytes);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := public.attachments__bytes(NEW.status, NEW.deleted_at, NEW.size_bytes, NEW.preview_bytes);
  END IF;
  -- A workspace removed by a cascade has no owner left to look up; the daily
  -- reconcile settles that pool.
  IF TG_OP = 'UPDATE' AND OLD.workspace_id = NEW.workspace_id THEN
    IF v_new <> v_old THEN
      PERFORM public.storage_usage__add(
        (SELECT w.owner_id FROM public.workspaces w WHERE w.id = NEW.workspace_id), v_new - v_old);
    END IF;
  ELSE
    IF v_old <> 0 THEN
      PERFORM public.storage_usage__add(
        (SELECT w.owner_id FROM public.workspaces w WHERE w.id = OLD.workspace_id), -v_old);
    END IF;
    IF v_new <> 0 THEN
      PERFORM public.storage_usage__add(
        (SELECT w.owner_id FROM public.workspaces w WHERE w.id = NEW.workspace_id), v_new);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER attachments_ledger
  AFTER INSERT OR UPDATE OR DELETE ON public.attachments
  FOR EACH ROW EXECUTE FUNCTION public.attachments__ledger();

-- Workspace ownership transfer: the workspace's files move to the new owner's
-- pool. Over the new owner's limit is allowed ("over limit": uploads pause).
CREATE FUNCTION public.attachments__owner_moved()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bytes bigint;
BEGIN
  SELECT coalesce(sum(public.attachments__bytes(a.status, a.deleted_at, a.size_bytes, a.preview_bytes)), 0)
    INTO v_bytes
  FROM public.attachments a WHERE a.workspace_id = NEW.id;
  IF v_bytes <> 0 THEN
    -- Both pools locked in owner_id order, like the recount, so two transfers
    -- (or a transfer and the recount) can't deadlock.
    PERFORM 1 FROM public.storage_usage su
    WHERE su.owner_id IN (OLD.owner_id, NEW.owner_id)
    ORDER BY su.owner_id
    FOR UPDATE;
    PERFORM public.storage_usage__add(OLD.owner_id, -v_bytes);
    PERFORM public.storage_usage__add(NEW.owner_id, v_bytes);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER attachments_owner_moved
  AFTER UPDATE OF owner_id ON public.workspaces
  FOR EACH ROW WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id)
  EXECUTE FUNCTION public.attachments__owner_moved();

-- Recount every pool from the attachments table (the daily purge runs it, so a
-- missed delta never lasts). Returns how many pools changed.
CREATE FUNCTION public.storage_usage__reconcile()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer;
BEGIN
  -- Hold every pool while recounting: a finalize running now waits, then adds
  -- its delta on top of the recount instead of being overwritten by it.
  PERFORM 1 FROM public.storage_usage ORDER BY owner_id FOR UPDATE;
  WITH actual AS (
    SELECT w.owner_id,
           coalesce(sum(public.attachments__bytes(a.status, a.deleted_at, a.size_bytes, a.preview_bytes)), 0)::bigint AS bytes
    FROM public.attachments a
    JOIN public.workspaces w ON w.id = a.workspace_id
    GROUP BY w.owner_id
  ),
  wanted AS (
    SELECT su.owner_id, coalesce(ac.bytes, 0) AS bytes
    FROM public.storage_usage su LEFT JOIN actual ac ON ac.owner_id = su.owner_id
    UNION
    SELECT ac.owner_id, ac.bytes FROM actual ac
    WHERE NOT EXISTS (SELECT 1 FROM public.storage_usage su WHERE su.owner_id = ac.owner_id)
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ac.owner_id)
  ),
  upserted AS (
    INSERT INTO public.storage_usage AS su (owner_id, bytes_used)
    SELECT owner_id, bytes FROM wanted
    ON CONFLICT (owner_id) DO UPDATE
      SET bytes_used = excluded.bytes_used, updated_at = now()
      WHERE su.bytes_used IS DISTINCT FROM excluded.bytes_used
    RETURNING 1
  )
  SELECT count(*) INTO v_changed FROM upserted;
  RETURN v_changed;
END;
$$;

-- ── 6. Alerts ──────────────────────────────────────────────────────────────

-- Tell the owner once per level when their pool passes 80% and 95%. Needs an
-- actor (module_activity_log attributes the entry), so it runs inside the
-- caller's op; a system write skips it.
CREATE FUNCTION public.attachments__alert(p_workspace_id uuid, p_owner uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used bigint;
  v_last smallint;
  v_total bigint;
  v_level smallint := 0;
BEGIN
  IF p_owner IS NULL OR public.perm_actor_id() IS NULL THEN
    RETURN;
  END IF;
  SELECT su.bytes_used, su.last_alert_level INTO v_used, v_last
  FROM public.storage_usage su WHERE su.owner_id = p_owner
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT l.total_bytes INTO v_total FROM public.storage__limits_for_owner(p_owner) l;
  IF v_used >= v_total * 0.95 THEN
    v_level := 95;
  ELSIF v_used >= v_total * 0.80 THEN
    v_level := 80;
  ELSIF v_used < v_total * 0.75 AND v_last <> 0 THEN
    UPDATE public.storage_usage SET last_alert_level = 0 WHERE owner_id = p_owner;
    RETURN;
  END IF;
  IF v_level <= v_last THEN
    RETURN;
  END IF;
  UPDATE public.storage_usage SET last_alert_level = v_level WHERE owner_id = p_owner;
  PERFORM public.module_activity_log(
    p_workspace_id, 'attachments', 'workspace', p_workspace_id,
    'attachments.storage_' || v_level,
    jsonb_build_object(
      'notify_user_ids', jsonb_build_array(p_owner::text),
      'level', v_level,
      'used_bytes', v_used,
      'total_bytes', v_total));
END;
$$;

-- ── 7. Ops (the app's only write path) ─────────────────────────────────────

CREATE FUNCTION public.attachments_op_begin(
  p_workspace_id uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_file_name    text,
  p_mime         text,
  p_size_bytes   bigint,
  p_preview_mime text DEFAULT NULL,
  p_width        integer DEFAULT NULL,
  p_height       integer DEFAULT NULL
)
RETURNS public.attachments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_lim     record;
  v_used    bigint;
  v_pending bigint;
  v_id      uuid := gen_random_uuid();
  v_name    text;
  v_mime    text;
  v_ext     text;
  v_row     public.attachments;
BEGIN
  -- Uploads need a signed-in person: Storage checks the same uploader.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_entity_type IS DISTINCT FROM 'task' THEN
    RAISE EXCEPTION 'unsupported_entity' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks t
                 WHERE t.id = p_entity_id AND t.workspace_id = p_workspace_id
                   AND t.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access('task', p_entity_id, 'edit', v_uid) THEN
    IF public.can_access('task', p_entity_id, 'view', v_uid) THEN
      RAISE EXCEPTION 'no_edit_access' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'invalid_size' USING ERRCODE = '22023';
  END IF;
  IF p_preview_mime IS NOT NULL AND p_preview_mime NOT IN ('image/webp','image/png','image/jpeg') THEN
    RAISE EXCEPTION 'invalid_preview_mime' USING ERRCODE = '22023';
  END IF;
  IF (p_width IS NOT NULL AND p_width <= 0) OR (p_height IS NOT NULL AND p_height <= 0) THEN
    RAISE EXCEPTION 'invalid_dimensions' USING ERRCODE = '22023';
  END IF;

  SELECT w.owner_id INTO v_owner
  FROM public.workspaces w WHERE w.id = p_workspace_id AND w.deleted_at IS NULL;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- One begin at a time per pool: the checks below then see every upload
  -- begun before this one, so racing uploads can't all slip under the limit.
  INSERT INTO public.storage_usage (owner_id) VALUES (v_owner) ON CONFLICT (owner_id) DO NOTHING;
  PERFORM 1 FROM public.storage_usage su WHERE su.owner_id = v_owner FOR UPDATE;
  -- One person can't pile up unfinished uploads (pending or failed, until the
  -- purge removes them).
  IF (SELECT count(*) FROM public.attachments a
      WHERE a.uploader_id = v_uid AND a.status <> 'ready') >= 50 THEN
    RAISE EXCEPTION 'too_many_pending' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_lim FROM public.storage__limits_for_owner(v_owner);
  IF p_size_bytes > v_lim.per_file_bytes THEN
    RAISE EXCEPTION 'attachment_too_large' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('size_bytes', p_size_bytes,
                                  'per_file_bytes', v_lim.per_file_bytes,
                                  'tier', v_lim.tier)::text;
  END IF;
  SELECT greatest(su.bytes_used, 0) INTO v_used
  FROM public.storage_usage su WHERE su.owner_id = v_owner;
  v_used := coalesce(v_used, 0);
  v_pending := public.storage__unsettled_bytes(v_owner);
  IF v_used + v_pending + p_size_bytes > v_lim.total_bytes THEN
    RAISE EXCEPTION 'storage_full' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('size_bytes', p_size_bytes,
                                  'used_bytes', v_used,
                                  'pending_bytes', v_pending,
                                  'total_bytes', v_lim.total_bytes,
                                  'tier', v_lim.tier)::text;
  END IF;

  -- The name is only shown, never part of a path.
  v_name := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]', '', 'g')), 255);
  IF v_name = '' THEN
    v_name := 'file';
  END IF;
  v_mime := left(btrim(lower(coalesce(p_mime, ''))), 255);
  IF v_mime = '' THEN
    v_mime := 'application/octet-stream';
  END IF;
  v_ext := lower(substring(v_name FROM '\.([A-Za-z0-9]{1,10})$'));
  IF v_ext IS NULL THEN
    v_ext := 'bin';
  END IF;

  INSERT INTO public.attachments (
    id, workspace_id, entity_type, entity_id, uploader_id, file_name, mime,
    size_bytes, object_path, preview_path, preview_mime, width, height, status)
  VALUES (
    v_id, p_workspace_id, 'task', p_entity_id, v_uid, v_name, v_mime, p_size_bytes,
    p_workspace_id::text || '/' || v_id::text || '/original.' || v_ext,
    CASE WHEN p_preview_mime IS NULL THEN NULL
         ELSE p_workspace_id::text || '/' || v_id::text || '/preview.'
              || CASE p_preview_mime WHEN 'image/webp' THEN 'webp' WHEN 'image/png' THEN 'png' ELSE 'jpg' END
    END,
    p_preview_mime, p_width, p_height, 'pending')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Previews are small (1280 px); anything bigger than this isn't one.
CREATE FUNCTION public.attachments__preview_cap()
RETURNS bigint
LANGUAGE sql IMMUTABLE
AS $$ SELECT 10485760::bigint $$;

CREATE FUNCTION public.attachments_op_finalize(p_id uuid)
RETURNS public.attachments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.attachments;
  v_size    bigint;
  v_psize   bigint;
  v_owner   uuid;
  v_lim     record;
  v_failed  boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.attachments a WHERE a.id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.uploader_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Already settled: a retried finalize gets the same answer.
  IF v_row.status <> 'pending' THEN
    RETURN v_row;
  END IF;

  SELECT (o.metadata ->> 'size')::bigint INTO v_size
  FROM storage.objects o
  WHERE o.bucket_id = 'attachments' AND o.name = v_row.object_path;
  IF v_size IS NULL THEN
    -- Not uploaded (yet): stays pending, the app retries.
    RAISE EXCEPTION 'not_uploaded' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.preview_path IS NOT NULL THEN
    SELECT (o.metadata ->> 'size')::bigint INTO v_psize
    FROM storage.objects o
    WHERE o.bucket_id = 'attachments' AND o.name = v_row.preview_path;
  END IF;

  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = v_row.workspace_id;
  SELECT * INTO v_lim FROM public.storage__limits_for_owner(v_owner);
  IF v_size <> v_row.size_bytes
     OR v_size > v_lim.per_file_bytes
     OR coalesce(v_psize, 0) > public.attachments__preview_cap() THEN
    v_failed := true;
  END IF;

  IF v_failed THEN
    -- The purge removes the objects; the row says why the tile failed.
    UPDATE public.attachments SET status = 'failed', updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  UPDATE public.attachments
  SET status = 'ready',
      preview_bytes = coalesce(v_psize, 0),
      -- No preview was uploaded: the tile shows the file type instead.
      preview_path = CASE WHEN v_psize IS NULL THEN NULL ELSE preview_path END,
      preview_mime = CASE WHEN v_psize IS NULL THEN NULL ELSE preview_mime END,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  PERFORM public.attachments__alert(v_row.workspace_id, v_owner);
  RETURN v_row;
END;
$$;

-- Move a file to the trash. Its space is free at once; it can be restored for
-- 30 days.
CREATE FUNCTION public.attachments_op_delete(p_id uuid)
RETURNS public.attachments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.attachments;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.attachments a WHERE a.id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access(v_row.entity_type, v_row.entity_id, 'view') THEN
    RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access(v_row.entity_type, v_row.entity_id, 'edit') THEN
    RAISE EXCEPTION 'no_edit_access' USING ERRCODE = '42501';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN v_row;
  END IF;
  UPDATE public.attachments
  SET deleted_at = now(), deleted_reason = 'user', deleted_batch_id = gen_random_uuid(),
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Undo a delete. Never checks the limit: getting work back is never blocked
-- (the pool may end up over it; uploads then pause).
CREATE FUNCTION public.attachments_op_restore(p_id uuid)
RETURNS public.attachments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.attachments;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.attachments a WHERE a.id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access(v_row.entity_type, v_row.entity_id, 'view') THEN
    RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access(v_row.entity_type, v_row.entity_id, 'edit') THEN
    RAISE EXCEPTION 'no_edit_access' USING ERRCODE = '42501';
  END IF;
  IF v_row.deleted_at IS NULL THEN
    RETURN v_row;
  END IF;
  -- Past 30 days the purge may already be removing its bytes.
  IF v_row.deleted_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'attachment_expired' USING ERRCODE = 'P0001';
  END IF;
  -- A file trashed with its task comes back with the task.
  IF v_row.deleted_reason <> 'user'
     OR (v_row.entity_type = 'task' AND EXISTS (
           SELECT 1 FROM public.tasks t WHERE t.id = v_row.entity_id AND t.deleted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'restore_with_task' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.attachments
  SET deleted_at = NULL, deleted_reason = NULL, deleted_batch_id = NULL, updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = v_row.workspace_id;
  PERFORM public.attachments__alert(v_row.workspace_id, v_owner);
  RETURN v_row;
END;
$$;

-- The pool as the app shows it (upload pre-checks, Settings → Storage).
-- Anyone in the workspace can read it; how many workspaces the owner has is
-- only told to the owner.
CREATE FUNCTION public.storage_status(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_lim     record;
  v_used    bigint;
  v_pending bigint;
  v_ratio   numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tasks_module_can_access_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT w.owner_id INTO v_owner
  FROM public.workspaces w WHERE w.id = p_workspace_id AND w.deleted_at IS NULL;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_lim FROM public.storage__limits_for_owner(v_owner);
  SELECT greatest(su.bytes_used, 0) INTO v_used
  FROM public.storage_usage su WHERE su.owner_id = v_owner;
  v_used := coalesce(v_used, 0);
  v_pending := public.storage__unsettled_bytes(v_owner);
  v_ratio := v_used::numeric / greatest(v_lim.total_bytes, 1);
  RETURN jsonb_build_object(
    'tier', v_lim.tier,
    'per_file_bytes', v_lim.per_file_bytes,
    'total_bytes', v_lim.total_bytes,
    'used_bytes', v_used,
    'pending_bytes', v_pending,
    'level', CASE WHEN v_ratio >= 0.95 THEN 95 WHEN v_ratio >= 0.80 THEN 80 ELSE 0 END,
    'over_limit', v_used >= v_lim.total_bytes,
    'is_owner', v_owner = v_uid,
    'owned_workspaces', CASE WHEN v_owner = v_uid THEN
      (SELECT count(*) FROM public.workspaces w WHERE w.owner_id = v_owner AND w.deleted_at IS NULL)
    END);
END;
$$;

-- ── 8. Trash: files follow their task ──────────────────────────────────────

-- Deleting a task puts its live files in the trash with it (one batch);
-- restoring the task brings that batch back, without a limit check. A batch id
-- on the task (TV-U6's deleted_batch_id) is reused when the column exists.
CREATE FUNCTION public.attachments__task_trash()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid;
  v_owner uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    v_batch := coalesce(nullif(to_jsonb(NEW) ->> 'deleted_batch_id', '')::uuid, gen_random_uuid());
    UPDATE public.attachments
    SET deleted_at = NEW.deleted_at, deleted_reason = 'task', deleted_batch_id = v_batch,
        updated_at = now()
    WHERE entity_type = 'task' AND entity_id = NEW.id AND deleted_at IS NULL;
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE public.attachments
    SET deleted_at = NULL, deleted_reason = NULL, deleted_batch_id = NULL, updated_at = now()
    WHERE entity_type = 'task' AND entity_id = NEW.id AND deleted_reason IN ('task', 'bucket')
      AND deleted_at >= now() - interval '30 days';
    IF FOUND THEN
      SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = NEW.workspace_id;
      PERFORM public.attachments__alert(NEW.workspace_id, v_owner);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER attachments_task_trash
  AFTER UPDATE OF deleted_at ON public.tasks
  FOR EACH ROW WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.attachments__task_trash();

-- The trash clock is the server's. The app stamps tasks.deleted_at and
-- buckets.deleted_at from the device clock; now that the purge hard-deletes
-- after 30 days, a wrong (or backdated) clock would skip the restore window.
-- A delete is stamped now(); a later write can't move the stamp; and past 30
-- days nothing comes back out of the trash.
CREATE FUNCTION public.trash__stamp_deleted_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR OLD.deleted_at IS NULL THEN
      NEW.deleted_at := now();
    ELSE
      NEW.deleted_at := OLD.deleted_at;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at < now() - interval '30 days' THEN
    -- Past 30 days it's the purge's: its files may already be gone.
    RAISE EXCEPTION 'trash_expired' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trash_stamp_deleted_at
  BEFORE INSERT OR UPDATE OF deleted_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trash__stamp_deleted_at();
CREATE TRIGGER trash_stamp_deleted_at
  BEFORE INSERT OR UPDATE OF deleted_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.trash__stamp_deleted_at();

-- Once a file is finalized its bytes can't change. Policies only see writes
-- made under the person's own role; this trigger sees every write to the
-- bucket, whatever path it takes, and refuses any that doesn't land on a
-- pending row's path. Deletes (the purge) aren't touched.
CREATE FUNCTION public.attachments__guard_object()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.bucket_id IS DISTINCT FROM 'attachments'
     AND (TG_OP = 'INSERT' OR OLD.bucket_id IS DISTINCT FROM 'attachments') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.bucket_id IS NOT DISTINCT FROM OLD.bucket_id
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.version IS NOT DISTINCT FROM OLD.version
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata THEN
    RETURN NEW;  -- bookkeeping only (timestamps): the bytes are unchanged
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.name IS DISTINCT FROM NEW.name THEN
    RAISE EXCEPTION 'attachment_object_locked' USING ERRCODE = '42501';
  END IF;
  -- Share-lock the pending row: a finalize holding it (FOR UPDATE) makes this
  -- write wait, and once finalize commits the row is no longer pending, so the
  -- write is refused. A write that got the lock first commits before finalize
  -- reads the size. Either way finalize counts the bytes that stay.
  PERFORM 1 FROM public.attachments a
  WHERE (a.object_path = NEW.name OR a.preview_path = NEW.name)
    AND a.status = 'pending'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attachment_object_locked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attachments_guard_object
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.attachments__guard_object();

-- ── 9. Storage policies ────────────────────────────────────────────────────
-- `storage.objects.name` is written out in full: inside the subquery a bare
-- `name` could bind to a column of the joined table.

DROP POLICY IF EXISTS attachments_object_insert ON storage.objects;
CREATE POLICY attachments_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.attachments a
      WHERE (a.object_path = storage.objects.name OR a.preview_path = storage.objects.name)
        AND a.status = 'pending'
        AND a.uploader_id = (SELECT auth.uid())
        AND a.created_at > now() - interval '24 hours'));

-- A retry of an upload whose answer got lost overwrites (upsert = insert + update + read back).
DROP POLICY IF EXISTS attachments_object_update ON storage.objects;
CREATE POLICY attachments_object_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.attachments a
      WHERE (a.object_path = storage.objects.name OR a.preview_path = storage.objects.name)
        AND a.status = 'pending'
        AND a.uploader_id = (SELECT auth.uid())))
  WITH CHECK (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.attachments a
      WHERE (a.object_path = storage.objects.name OR a.preview_path = storage.objects.name)
        AND a.status = 'pending'
        AND a.uploader_id = (SELECT auth.uid())));

-- Reading (and signing a link) needs view access to the task, while the file
-- is out of the trash. The uploader can also read back a pending upload.
DROP POLICY IF EXISTS attachments_object_select ON storage.objects;
CREATE POLICY attachments_object_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND EXISTS (
      SELECT 1 FROM public.attachments a
      WHERE (a.object_path = storage.objects.name OR a.preview_path = storage.objects.name)
        AND ((a.status = 'ready' AND a.deleted_at IS NULL
              AND public.can_access(a.entity_type, a.entity_id, 'view'))
          OR (a.status = 'pending' AND a.uploader_id = (SELECT auth.uid())))));

-- No client DELETE policy: objects are removed only by the purge (service role,
-- Storage API).

-- ── 10. Purge support (purge-deleted Edge Function, service role) ──────────

-- Files whose objects should go now: trashed more than 30 days ago, abandoned
-- uploads (pending > 24 h), failed uploads, files of deleted workspaces, and
-- files whose task no longer exists.
CREATE FUNCTION public.attachments__purge_candidates(p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, object_path text, preview_path text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.object_path, a.preview_path,
         CASE
           WHEN w.deleted_at IS NOT NULL THEN 'workspace_deleted'
           WHEN a.status = 'failed' THEN 'failed'
           WHEN a.status = 'pending' AND a.created_at < now() - interval '24 hours' THEN 'abandoned'
           WHEN a.deleted_at < now() - interval '30 days' THEN 'expired'
           ELSE 'orphaned'
         END
  FROM public.attachments a
  JOIN public.workspaces w ON w.id = a.workspace_id
  WHERE w.deleted_at IS NOT NULL
     OR a.status = 'failed'
     OR (a.status = 'pending' AND a.created_at < now() - interval '24 hours')
     OR a.deleted_at < now() - interval '30 days'
     OR (a.entity_type = 'task' AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = a.entity_id))
  ORDER BY a.created_at, a.id
  LIMIT greatest(coalesce(p_limit, 500), 1)
$$;

-- After their objects are gone: delete the rows (the ledger trigger frees any
-- bytes they still counted). Only rows that are still candidates go, so a file
-- restored meanwhile stays.
CREATE FUNCTION public.attachments__purge_rows(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.attachments a
    USING public.workspaces w
    WHERE w.id = a.workspace_id
      AND a.id = ANY (coalesce(p_ids, '{}'::uuid[]))
      AND (w.deleted_at IS NOT NULL
        OR a.status = 'failed'
        OR (a.status = 'pending' AND a.created_at < now() - interval '24 hours')
        OR a.deleted_at < now() - interval '30 days'
        OR (a.entity_type = 'task' AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = a.entity_id)))
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM d;
  RETURN v_count;
END;
$$;

-- Objects in the bucket no row names any more (an account deletion that took
-- the rows, a crash between upload and begin's rollback), older than a day.
CREATE FUNCTION public.attachments__orphan_objects(p_limit integer DEFAULT 500)
RETURNS TABLE (name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'attachments'
    AND o.created_at < now() - interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM public.attachments a
                    WHERE a.object_path = o.name OR a.preview_path = o.name)
  ORDER BY o.name
  LIMIT greatest(coalesce(p_limit, 500), 1)
$$;

-- Tasks and buckets in the trash for more than 30 days. A task waits until its
-- files' rows are gone (the purge removes the objects first); a bucket waits
-- until no task points at it. Links and the registry entry are tombstoned like
-- notes__purge_ids does. System work: perm_enforce_write lets an actor-less
-- delete through.
CREATE FUNCTION public.tasks__purge_expired(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids     uuid[];
  v_tasks   integer := 0;
  v_buckets integer := 0;
BEGIN
  SELECT array_agg(s.id) INTO v_ids FROM (
    SELECT t.id FROM public.tasks t
    WHERE t.deleted_at < now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM public.attachments a
                      WHERE a.entity_type = 'task' AND a.entity_id = t.id)
    ORDER BY t.id
    LIMIT greatest(coalesce(p_limit, 500), 1)
    FOR UPDATE SKIP LOCKED
  ) s;

  IF v_ids IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.tasks t
      WHERE t.id = ANY (v_ids) AND t.deleted_at < now() - interval '30 days'
      RETURNING t.id, t.workspace_id
    ),
    links AS (
      UPDATE public.entity_links l
      SET deleted_at = now()
      FROM d
      WHERE l.workspace_id = d.workspace_id AND l.deleted_at IS NULL
        AND ((l.source_type = 'task' AND l.source_id = d.id)
          OR (l.target_type = 'task' AND l.target_id = d.id))
      RETURNING 1
    ),
    registry AS (
      UPDATE public.entities e
      SET deleted_at = now(), updated_at = now()
      FROM d
      WHERE e.workspace_id = d.workspace_id AND e.entity_type = 'task'
        AND e.entity_id = d.id AND e.deleted_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_tasks FROM d;
  END IF;

  WITH d AS (
    DELETE FROM public.buckets b
    WHERE b.id IN (
      SELECT b2.id FROM public.buckets b2
      WHERE b2.deleted_at < now() - interval '30 days'
        AND NOT b2.is_system
        AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.bucket_id = b2.id)
      ORDER BY b2.id
      LIMIT greatest(coalesce(p_limit, 500), 1)
      FOR UPDATE SKIP LOCKED)
    RETURNING 1
  )
  SELECT count(*) INTO v_buckets FROM d;

  RETURN jsonb_build_object('tasks', v_tasks, 'buckets', v_buckets);
END;
$$;

-- What a dry run reports: the same selections, counted, nothing changed.
CREATE FUNCTION public.purge__preview()
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
                WHERE b.deleted_at < now() - interval '30 days' AND NOT b.is_system))
$$;

-- ── 11. Grants ─────────────────────────────────────────────────────────────
-- Client ops: signed-in people only (revoke anon by name: Supabase grants it
-- directly, not through PUBLIC). Everything named *__* is server-only.

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer)',
    'public.attachments_op_finalize(uuid)',
    'public.attachments_op_delete(uuid)',
    'public.attachments_op_restore(uuid)',
    'public.storage_status(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'public.attachments__platform_file_cap()',
    'public.attachments__preview_cap()',
    'public.storage__limits_for_owner(uuid)',
    'public.attachments__bytes(text, timestamptz, bigint, bigint)',
    'public.storage__unsettled_bytes(uuid)',
    'public.storage_usage__add(uuid, bigint)',
    'public.attachments__ledger()',
    'public.attachments__owner_moved()',
    'public.storage_usage__reconcile()',
    'public.attachments__alert(uuid, uuid)',
    'public.attachments__task_trash()',
    'public.trash__stamp_deleted_at()',
    'public.attachments__guard_object()',
    'public.attachments__purge_candidates(integer)',
    'public.attachments__purge_rows(uuid[])',
    'public.attachments__orphan_objects(integer)',
    'public.tasks__purge_expired(integer)',
    'public.purge__preview()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;

-- Fail the migration if a grant drifted (gotchas: REVOKE FROM PUBLIC misses anon).
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.storage_status(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.storage__limits_for_owner(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.attachments__purge_rows(uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tasks__purge_expired(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tasks__purge_expired(integer)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.attachments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.attachments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.storage_usage', 'SELECT')
     OR NOT has_function_privilege('authenticated', 'public.attachments_op_finalize(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.attachments__purge_candidates(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AT-1 grants drifted: client roles must not reach the server-only helpers.';
  END IF;
END;
$$;
