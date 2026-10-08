-- TV-U6 (specs/tasks-v2.md block 16, decision 15): bucket colours, archiving a
-- bucket, deleting a bucket with or without its tasks, and Recently deleted.
--
-- What changes:
--   1. buckets.color (a label hue name, like tags.color; NULL = neutral),
--      buckets.archived_at, and a trash batch: buckets.deleted_batch_id and
--      tasks.deleted_batch_id. A bucket deleted with its tasks shares one batch
--      id with them (and, through AT-1's attachments__task_trash, with their
--      files), so Undo and Restore bring the whole batch back. A bucket deleted
--      with "Move the tasks to Inbox" remembers which tasks it moved
--      (buckets.trash_moved_task_ids), so its Restore moves them back.
--   2. Restoring a row (deleted_at back to NULL, by any path) clears its batch.
--   3. Archiving a bucket takes its tasks out of every queue, as deleting one
--      does (tasks_queue_leave). Unarchiving never puts them back.
--   4. Ops, each acting for perm_actor_id() and checked row by row by
--      perm_enforce_write:
--        tasks_op_bucket_delete(ws, bucket, with_tasks)  delete, one batch
--        tasks_op_trash_restore(ws, type, id)            Undo / Restore
--        tasks_op_trash_purge(ws, type, id)              Delete forever
--      None logs activity: buckets have no activity trail, and a task's trail
--      goes with it when it is purged.
--
-- The 30-day purge itself is AT-1's (purge-deleted, tasks__purge_expired):
-- unchanged. Delete forever removes the rows now; their files have no task
-- any more, so the next daily purge removes the objects (AT-1 §10).
--
-- Archiving and colours are plain field writes from the app (perm_enforce_write
-- checks Edit on the bucket), so they need no op.

-- ── 1. Columns ─────────────────────────────────────────────────────────────

ALTER TABLE public.buckets
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_batch_id uuid,
  ADD COLUMN IF NOT EXISTS trash_moved_task_ids uuid[];

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deleted_batch_id uuid;

-- A hue name from the app's label palette (src/components/tag-colors.ts); read
-- back through normalizeLabelColor, like tags.color.
ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_color_length;
ALTER TABLE public.buckets
  ADD CONSTRAINT buckets_color_length CHECK (color IS NULL OR char_length(color) BETWEEN 1 AND 32);
-- The Inbox is where tasks go; it can't be archived away.
ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_inbox_not_archived;
ALTER TABLE public.buckets
  ADD CONSTRAINT buckets_inbox_not_archived CHECK (NOT (is_system AND archived_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS tasks_deleted_batch_idx
  ON public.tasks (deleted_batch_id) WHERE deleted_batch_id IS NOT NULL;
-- Recently deleted reads a workspace's trash by date.
CREATE INDEX IF NOT EXISTS tasks_trash_idx
  ON public.tasks (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.buckets.deleted_batch_id IS
  'TV-U6: set while the bucket is in the trash; the tasks (and their files) deleted with it share it.';
COMMENT ON COLUMN public.buckets.trash_moved_task_ids IS
  'TV-U6: the tasks its delete moved to the Inbox; a Restore moves the ones still in an Inbox back.';
COMMENT ON COLUMN public.tasks.deleted_batch_id IS
  'TV-U6: set while the task is in the trash as part of a batch (a bucket deleted with its tasks).';

-- ── 2. A restored row leaves its batch ─────────────────────────────────────
-- Whatever restores a task or bucket (an op, an Undo through a plain update,
-- an old build's whole-row save), it is no longer part of a batch.

CREATE OR REPLACE FUNCTION public.tasks__trash_restored()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    NEW.deleted_batch_id := NULL;
    IF TG_TABLE_NAME = 'buckets' THEN
      NEW.trash_moved_task_ids := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trash_restored ON public.tasks;
CREATE TRIGGER trash_restored
  BEFORE UPDATE OF deleted_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__trash_restored();
DROP TRIGGER IF EXISTS trash_restored ON public.buckets;
CREATE TRIGGER trash_restored
  BEFORE UPDATE OF deleted_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.tasks__trash_restored();

-- ── 3. Archived buckets leave queues ───────────────────────────────────────
-- Production's body as of 2026-10-09 (20261008171500), plus archived_at.

CREATE OR REPLACE FUNCTION public.tasks_queue_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.status IN ('done', 'archived') OR NEW.deleted_at IS NOT NULL THEN
      DELETE FROM public.task_queue q WHERE q.task_id = NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'buckets' THEN
    -- Deleted with tasks still in it, or archived (TV-U6).
    IF NEW.deleted_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
      DELETE FROM public.task_queue q
      USING public.tasks t
      WHERE t.id = q.task_id AND t.bucket_id = NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tasks_queue_leave ON public.buckets;
CREATE TRIGGER tasks_queue_leave
  AFTER UPDATE OF deleted_at, archived_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue_leave();

-- ── 4. Helpers ─────────────────────────────────────────────────────────────

-- A person's Inbox in a workspace (each member has their own), created the way
-- the app's ensureWebInbox does when it doesn't exist yet.
CREATE OR REPLACE FUNCTION public.tasks__inbox_for(p_workspace_id uuid, p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT b.id INTO v_id FROM public.buckets b
  WHERE b.workspace_id = p_workspace_id AND b.is_system AND b.owner_id = p_user
    AND b.deleted_at IS NULL
  ORDER BY b.created_at, b.id
  LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.buckets (workspace_id, owner_id, name, is_system, position)
    VALUES (p_workspace_id, p_user, 'Inbox', true, 'a0')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      -- Lost a race to the one-Inbox-per-person index: read the winner.
      SELECT b.id INTO v_id FROM public.buckets b
      WHERE b.workspace_id = p_workspace_id AND b.is_system AND b.owner_id = p_user
        AND b.deleted_at IS NULL
      LIMIT 1;
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- Every op here needs edit access to Tasks (a person's role, or a key's scope).
CREATE OR REPLACE FUNCTION public.tasks__trash_guard(p_workspace_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to change buckets.' USING ERRCODE = '42501';
  END IF;
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

-- ── 5. Delete a bucket ─────────────────────────────────────────────────────
-- p_with_tasks = false: its tasks move to the caller's Inbox (the app's
-- default). true: they go to the trash with it, with the subtasks of those
-- tasks wherever they are (when the caller can edit them). Either way the
-- answer carries the batch id; deleting a bucket already in the trash changes
-- nothing.

CREATE OR REPLACE FUNCTION public.tasks_op_bucket_delete(
  p_workspace_id uuid,
  p_bucket_id uuid,
  p_with_tasks boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.tasks__trash_guard(p_workspace_id);
  b       public.buckets;
  v_batch uuid := gen_random_uuid();
  v_ids   uuid[];
  v_inbox uuid;
  v_count integer := 0;
BEGIN
  SELECT * INTO b FROM public.buckets
  WHERE id = p_bucket_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access('bucket', b.id, 'view', v_actor) THEN
    RAISE EXCEPTION 'Bucket not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;
  IF b.is_system THEN
    RAISE EXCEPTION 'The Inbox can''t be deleted.' USING ERRCODE = 'P0001';
  END IF;
  IF b.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('batch_id', b.deleted_batch_id, 'moved', 0, 'deleted', 0);
  END IF;
  IF NOT public.can_access('bucket', b.id, 'full', v_actor) THEN
    RAISE EXCEPTION 'You don''t have access to delete this bucket.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(p_with_tasks, false) THEN
    SELECT array_agg(t.id) INTO v_ids
    FROM public.tasks t
    WHERE t.workspace_id = p_workspace_id AND t.deleted_at IS NULL
      AND (t.bucket_id = b.id
        OR (t.parent_id IN (SELECT p.id FROM public.tasks p
                            WHERE p.bucket_id = b.id AND p.deleted_at IS NULL)
            AND public.can_access('task', t.id, 'edit', v_actor)));
    UPDATE public.tasks
    SET deleted_at = now(), deleted_batch_id = v_batch, updated_at = now()
    WHERE id = ANY (coalesce(v_ids, '{}'::uuid[]));
    GET DIAGNOSTICS v_count = ROW_COUNT;
    UPDATE public.buckets
    SET deleted_at = now(), deleted_batch_id = v_batch, trash_moved_task_ids = NULL,
        updated_at = now()
    WHERE id = b.id;
    RETURN jsonb_build_object('batch_id', v_batch, 'moved', 0, 'deleted', v_count);
  END IF;

  v_inbox := public.tasks__inbox_for(p_workspace_id, v_actor);
  WITH m AS (
    UPDATE public.tasks t
    SET bucket_id = v_inbox, updated_at = now()
    WHERE t.bucket_id = b.id AND t.deleted_at IS NULL
    RETURNING t.id
  )
  SELECT array_agg(m.id), count(*) INTO v_ids, v_count FROM m;
  UPDATE public.buckets
  SET deleted_at = now(), deleted_batch_id = v_batch,
      trash_moved_task_ids = coalesce(v_ids, '{}'::uuid[]), updated_at = now()
  WHERE id = b.id;
  RETURN jsonb_build_object('batch_id', v_batch, 'moved', v_count, 'deleted', 0,
                            'inbox_id', v_inbox);
END;
$$;

-- ── 6. Undo / Restore ──────────────────────────────────────────────────────
-- A bucket comes back with its batch (the tasks deleted with it, and their
-- files) and takes back the tasks its delete moved to an Inbox, unless they
-- have moved on since. A task comes back on its own; when its bucket is gone
-- it lands in the caller's Inbox. Past 30 days nothing comes back (the purge
-- may already be removing it). Restoring something that isn't in the trash
-- changes nothing.

CREATE OR REPLACE FUNCTION public.tasks_op_trash_restore(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.tasks__trash_guard(p_workspace_id);
  b       public.buckets;
  t       public.tasks;
  v_inbox uuid;
  v_tasks integer := 0;
  v_moved integer := 0;
BEGIN
  IF p_entity_type = 'bucket' THEN
    SELECT * INTO b FROM public.buckets
    WHERE id = p_entity_id AND workspace_id = p_workspace_id
    FOR UPDATE;
    IF NOT FOUND OR NOT public.can_access('bucket', b.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Bucket not found in this workspace.' USING ERRCODE = 'P0002';
    END IF;
    IF b.deleted_at IS NULL THEN
      RETURN jsonb_build_object('buckets', 0, 'tasks', 0, 'moved', 0);
    END IF;
    IF b.deleted_at < now() - interval '30 days' THEN
      RAISE EXCEPTION 'That was deleted more than 30 days ago and can''t be restored.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.buckets SET deleted_at = NULL, updated_at = now() WHERE id = b.id;
    IF b.deleted_batch_id IS NOT NULL THEN
      UPDATE public.tasks
      SET deleted_at = NULL, updated_at = now()
      WHERE workspace_id = p_workspace_id AND deleted_batch_id = b.deleted_batch_id
        AND deleted_at IS NOT NULL AND deleted_at >= now() - interval '30 days';
      GET DIAGNOSTICS v_tasks = ROW_COUNT;
    END IF;
    IF b.trash_moved_task_ids IS NOT NULL AND cardinality(b.trash_moved_task_ids) > 0 THEN
      UPDATE public.tasks x
      SET bucket_id = b.id, updated_at = now()
      WHERE x.id = ANY (b.trash_moved_task_ids) AND x.workspace_id = p_workspace_id
        AND x.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM public.buckets i WHERE i.id = x.bucket_id AND i.is_system)
        AND public.can_access('task', x.id, 'edit', v_actor);
      GET DIAGNOSTICS v_moved = ROW_COUNT;
    END IF;
    RETURN jsonb_build_object('buckets', 1, 'tasks', v_tasks, 'moved', v_moved);

  ELSIF p_entity_type = 'task' THEN
    SELECT * INTO t FROM public.tasks
    WHERE id = p_entity_id AND workspace_id = p_workspace_id
    FOR UPDATE;
    IF NOT FOUND OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Task not found in this workspace.' USING ERRCODE = 'P0002';
    END IF;
    IF t.deleted_at IS NULL THEN
      RETURN jsonb_build_object('buckets', 0, 'tasks', 0, 'moved', 0);
    END IF;
    IF t.deleted_at < now() - interval '30 days' THEN
      RAISE EXCEPTION 'That was deleted more than 30 days ago and can''t be restored.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.buckets x
                   WHERE x.id = t.bucket_id AND x.deleted_at IS NULL) THEN
      v_inbox := public.tasks__inbox_for(p_workspace_id, v_actor);
    END IF;
    UPDATE public.tasks
    SET deleted_at = NULL, bucket_id = coalesce(v_inbox, bucket_id), updated_at = now()
    WHERE id = t.id;
    RETURN jsonb_build_object('buckets', 0, 'tasks', 1, 'moved', 0, 'inbox_id', v_inbox);
  END IF;

  RAISE EXCEPTION 'Only tasks and buckets can be restored here.' USING ERRCODE = '22023';
END;
$$;

-- ── 7. Delete forever ──────────────────────────────────────────────────────
-- Only from the trash. A bucket goes with the tasks deleted with it; any other
-- task still pointing at it (one deleted on its own earlier) moves to the
-- caller's Inbox first, since tasks.bucket_id is ON DELETE RESTRICT. Tasks go
-- before their bucket, so perm_enforce_write can still read each task's bucket
-- (gotchas/supabase.md). Links and registry entries are tombstoned the way
-- tasks__purge_expired does it.

CREATE OR REPLACE FUNCTION public.tasks_op_trash_purge(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := public.tasks__trash_guard(p_workspace_id);
  b         public.buckets;
  t         public.tasks;
  v_ids     uuid[];
  v_inbox   uuid;
  v_tasks   integer := 0;
  v_buckets integer := 0;
BEGIN
  IF p_entity_type = 'bucket' THEN
    SELECT * INTO b FROM public.buckets
    WHERE id = p_entity_id AND workspace_id = p_workspace_id
    FOR UPDATE;
    IF NOT FOUND OR NOT public.can_access('bucket', b.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Bucket not found in this workspace.' USING ERRCODE = 'P0002';
    END IF;
    IF b.deleted_at IS NULL THEN
      RAISE EXCEPTION 'Only something in Recently deleted can be deleted forever.' USING ERRCODE = 'P0001';
    END IF;
    IF b.deleted_batch_id IS NOT NULL THEN
      SELECT array_agg(x.id) INTO v_ids FROM public.tasks x
      WHERE x.workspace_id = p_workspace_id AND x.deleted_batch_id = b.deleted_batch_id
        AND x.deleted_at IS NOT NULL;
    END IF;
  ELSIF p_entity_type = 'task' THEN
    SELECT * INTO t FROM public.tasks
    WHERE id = p_entity_id AND workspace_id = p_workspace_id
    FOR UPDATE;
    IF NOT FOUND OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Task not found in this workspace.' USING ERRCODE = 'P0002';
    END IF;
    IF t.deleted_at IS NULL THEN
      RAISE EXCEPTION 'Only something in Recently deleted can be deleted forever.' USING ERRCODE = 'P0001';
    END IF;
    v_ids := ARRAY[t.id];
  ELSE
    RAISE EXCEPTION 'Only tasks and buckets can be deleted here.' USING ERRCODE = '22023';
  END IF;

  IF v_ids IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.tasks x
      WHERE x.id = ANY (v_ids)
      RETURNING x.id, x.workspace_id
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

  IF p_entity_type = 'bucket' THEN
    IF EXISTS (SELECT 1 FROM public.tasks x WHERE x.bucket_id = b.id) THEN
      v_inbox := public.tasks__inbox_for(p_workspace_id, v_actor);
      UPDATE public.tasks x SET bucket_id = v_inbox, updated_at = now() WHERE x.bucket_id = b.id;
    END IF;
    DELETE FROM public.buckets WHERE id = b.id;
    GET DIAGNOSTICS v_buckets = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('tasks', v_tasks, 'buckets', v_buckets);
END;
$$;

-- ── 8. Grants ──────────────────────────────────────────────────────────────
-- Ops: signed-in people and the connector's service role (anon revoked by
-- name: Supabase grants it directly). Helpers and triggers: definer-only.

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.tasks_op_bucket_delete(uuid, uuid, boolean)',
    'public.tasks_op_trash_restore(uuid, text, uuid)',
    'public.tasks_op_trash_purge(uuid, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'public.tasks__inbox_for(uuid, uuid)',
    'public.tasks__trash_guard(uuid)',
    'public.tasks__trash_restored()',
    'public.tasks_queue_leave()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END;
$$;

-- Fail the migration if a grant drifted (gotchas: REVOKE FROM PUBLIC misses anon).
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.tasks_op_bucket_delete(uuid, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tasks_op_trash_restore(uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tasks_op_trash_purge(uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tasks__inbox_for(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tasks__inbox_for(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tasks__trash_guard(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.tasks_op_trash_restore(uuid, text, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.tasks_op_bucket_delete(uuid, uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TV-U6 grants drifted: anon must not reach the ops, nor clients the helpers.';
  END IF;
END;
$$;
