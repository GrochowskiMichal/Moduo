-- TV-D2 · Personal queue, data (specs/tasks-v2.md block 4).
--
-- Each person gets their own Queue: an ordered line-up of the tasks they mean
-- to do next, not tied to a date (nothing resets at midnight). Until now the
-- queue was tasks.committed_for / commit_order, one per task and so shared by
-- the whole workspace.
--   * task_queue: one row per (person, task), ordered by a position key in the
--     app's fractional-index format (10 base-36 digits, 2^20 apart), so a
--     client can mint an optimistic key between two of them.
--   * Ops for the person themselves (an API key acts for its creator):
--     tasks_op_queue_add (end, or top for Calendar's "Start focus"),
--     tasks_op_queue_remove, tasks_op_queue_reorder (after another task, or to
--     the top) and tasks_op_queue_move_to_end. Each returns the caller's queue
--     in order. Adding and removing are logged in the task's trail; moves are
--     not.
--   * Anyone who can see a task can read who has it queued (claims: "In
--     Mike's queue"). Nobody writes rows directly; the ops do.
--   * A task leaves every queue when it is completed, archived or deleted, or
--     its bucket is deleted, and when someone leaves the workspace their queue
--     there goes. Restoring never queues anything again.
--   * Today's commits carry over once, into the queue of whoever committed
--     them (else the assignee), in their order.
--   * Old app versions keep working: tasks_op_commit / uncommit / skip_today
--     now act on the caller's queue (and still write the old columns, which
--     old versions read), and an old version's direct writes of committed_for
--     (capture straight into today) and commit_order (dragging the queue)
--     land in the writer's queue too. Removals only ever come through the
--     ops: a stale whole-row save from a build older than TV-D1 can write
--     committed_for back to NULL, and must not empty anyone's queue.
--   * skip_today no longer bumps the reschedule count (spec decision 4).
--   * Catch-up and skipping an occurrence still clear the old columns for old
--     versions, but no longer take anything out of a queue.
--
-- Expand only: the old columns, ops and MCP tools stay until TV-D7. The three
-- ops redefined below are production's bodies as of 2026-10-08, read from the
-- catalog, with only the TV-D2 changes.

-- ── 0. Preconditions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  -- The backfill falls back to the assignee, and the claims read through the
  -- TV-D1 task policy.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'assignee_id') THEN
    RAISE EXCEPTION 'TV-D1 (20261008150000_tasks_assignee_creator) must be applied first.';
  END IF;
END;
$$;

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE public.task_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  -- Deleting an account empties its queues (the auth cascade takes profiles).
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  -- Byte order, like the app's string compare (docs/gotchas/supabase.md).
  position text COLLATE "C" NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_queue_user_task_key UNIQUE (user_id, task_id),
  CONSTRAINT task_queue_position_format CHECK (position ~ '^[0-9a-z]+$')
);
CREATE INDEX task_queue_line_up_idx ON public.task_queue (workspace_id, user_id, position);
CREATE INDEX task_queue_task_idx ON public.task_queue (task_id);

COMMENT ON TABLE public.task_queue IS
  'Each person''s Queue (TV-D2): the tasks they mean to do next, in order, not tied to a date. Written only by the tasks_op_queue_* ops (and the legacy commit shims); readable by anyone who can see the task (claims).';
COMMENT ON COLUMN public.task_queue.position IS
  'Order within the person''s queue in this workspace: the app''s fractional-index keys (10 base-36 digits, 2^20 apart); compare bytewise.';

-- ── 2. Who can read it, who can write it ─────────────────────────────────────
-- Reading: anyone who can see the task (the subquery runs under the tasks
-- policy), so a task that stops being shared with you drops out of your queue
-- and out of your view of others'. Writing: only the definer ops.

ALTER TABLE public.task_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_queue TO authenticated;
GRANT ALL ON public.task_queue TO service_role;

CREATE POLICY task_queue_read ON public.task_queue FOR SELECT TO authenticated
  USING (
    public.perm_can_view(workspace_id, 'tasks')
    AND EXISTS (SELECT 1 FROM public.tasks t
                WHERE t.id = task_queue.task_id AND t.deleted_at IS NULL)
  );

-- ── 3. Position keys ─────────────────────────────────────────────────────────
-- The app's format (src/features/tasks/helpers.ts encodePos): n in base 36,
-- zero-padded to 10 digits; fresh keys are 2^20 apart. The server only ever
-- writes such clean keys, renumbering the queue when two neighbours have no
-- room left between them.

CREATE OR REPLACE FUNCTION public.tasks_queue__key(p_n bigint)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_n bigint := greatest(coalesce(p_n, 0), 0);
  v_out text := '';
BEGIN
  LOOP
    v_out := substr(v_digits, (v_n % 36)::int + 1, 1) || v_out;
    v_n := v_n / 36;
    EXIT WHEN v_n = 0;
  END LOOP;
  IF length(v_out) > 10 THEN
    RAISE EXCEPTION 'Queue position out of range.';
  END IF;
  RETURN lpad(v_out, 10, '0');
END;
$$;

-- A clean key's number, or NULL for anything else.
CREATE OR REPLACE FUNCTION public.tasks_queue__num(p_key text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_n bigint := 0;
BEGIN
  IF p_key IS NULL OR length(p_key) <> 10 OR p_key !~ '^[0-9a-z]+$' THEN
    RETURN NULL;
  END IF;
  FOR i IN 1 .. 10 LOOP
    v_n := v_n * 36 + strpos(v_digits, substr(p_key, i, 1)) - 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- One writer at a time per person and workspace, so two devices can't mint
-- the same key or renumber across each other.
CREATE OR REPLACE FUNCTION public.tasks_queue__lock(p_workspace_id uuid, p_user uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('task_queue:' || p_user::text || ':' || p_workspace_id::text, 0))
$$;

-- Rewrite every key in a person's queue as 2^20, 2·2^20, … in its current
-- order, leaving out one task (the one about to be placed).
CREATE OR REPLACE FUNCTION public.tasks_queue__renumber(p_workspace_id uuid, p_user uuid, p_except uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.task_queue q
  SET position = public.tasks_queue__key(1048576 * r.rn), updated_at = now()
  FROM (
    SELECT x.id, row_number() OVER (ORDER BY x.position, x.id) AS rn
    FROM public.task_queue x
    WHERE x.workspace_id = p_workspace_id AND x.user_id = p_user
      AND x.task_id IS DISTINCT FROM p_except
  ) r
  WHERE q.id = r.id AND q.position <> public.tasks_queue__key(1048576 * r.rn)
$$;

-- Put a task in a person's queue (or move it there): at the end, at the top,
-- or right after another task in it. The caller holds the lock and has
-- checked access. Returns true when the row is new.
CREATE OR REPLACE FUNCTION public.tasks_queue__place(
  p_workspace_id uuid,
  p_user uuid,
  p_task_id uuid,
  p_where text,
  p_after uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_step constant bigint := 1048576;
  v_lo text;
  v_hi text;
  v_lo_n bigint;
  v_hi_n bigint;
  v_key text;
  v_new boolean;
BEGIN
  FOR v_try IN 1 .. 2 LOOP
    v_lo := NULL;
    v_hi := NULL;
    IF p_where = 'end' THEN
      SELECT max(q.position) INTO v_lo FROM public.task_queue q
      WHERE q.workspace_id = p_workspace_id AND q.user_id = p_user AND q.task_id <> p_task_id;
    ELSIF p_where = 'top' THEN
      SELECT min(q.position) INTO v_hi FROM public.task_queue q
      WHERE q.workspace_id = p_workspace_id AND q.user_id = p_user AND q.task_id <> p_task_id;
    ELSIF p_where = 'after' THEN
      SELECT q.position INTO v_lo FROM public.task_queue q
      WHERE q.workspace_id = p_workspace_id AND q.user_id = p_user AND q.task_id = p_after;
      IF v_lo IS NULL THEN
        RAISE EXCEPTION 'That task isn''t in your queue.';
      END IF;
      SELECT min(q.position) INTO v_hi FROM public.task_queue q
      WHERE q.workspace_id = p_workspace_id AND q.user_id = p_user AND q.task_id <> p_task_id
        AND q.position > v_lo;
    ELSE
      RAISE EXCEPTION 'Unknown queue placement: %', p_where;
    END IF;

    v_lo_n := public.tasks_queue__num(v_lo);
    v_hi_n := public.tasks_queue__num(v_hi);
    v_key := NULL;
    IF v_lo IS NULL AND v_hi IS NULL THEN
      v_key := public.tasks_queue__key(v_step);
    ELSIF v_lo IS NULL THEN
      IF v_hi_n > 1 THEN v_key := public.tasks_queue__key(v_hi_n / 2); END IF;
    ELSIF v_hi IS NULL THEN
      IF v_lo_n IS NOT NULL THEN v_key := public.tasks_queue__key(v_lo_n + v_step); END IF;
    ELSIF v_hi_n - v_lo_n > 1 THEN
      v_key := public.tasks_queue__key((v_lo_n + v_hi_n) / 2);
    END IF;
    EXIT WHEN v_key IS NOT NULL;
    -- No room (or a key the server didn't mint): space the queue out, retry.
    PERFORM public.tasks_queue__renumber(p_workspace_id, p_user, p_task_id);
  END LOOP;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Couldn''t place the task in the queue.';
  END IF;

  v_new := NOT EXISTS (SELECT 1 FROM public.task_queue q WHERE q.user_id = p_user AND q.task_id = p_task_id);
  INSERT INTO public.task_queue (workspace_id, user_id, task_id, position)
  VALUES (p_workspace_id, p_user, p_task_id, v_key)
  ON CONFLICT (user_id, task_id)
  DO UPDATE SET position = EXCLUDED.position, updated_at = now();
  RETURN v_new;
END;
$$;

-- The caller's queue in this workspace, in order: what every op returns.
CREATE OR REPLACE FUNCTION public.tasks_queue__mine(p_workspace_id uuid, p_user uuid)
RETURNS SETOF public.task_queue
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT q.* FROM public.task_queue q
  WHERE q.workspace_id = p_workspace_id AND q.user_id = p_user
  ORDER BY q.position, q.id
$$;

-- The op preamble: Tasks edit access (the guard; it also locks the task row),
-- a person to act for, and a task they can see.
CREATE OR REPLACE FUNCTION public.tasks_queue__guard(p_workspace_id uuid, p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A queue belongs to a person: sign in, or use an API key.';
  END IF;
  IF NOT public.can_access('task', t.id, 'view', v_actor) THEN
    RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks_queue__lock(p_workspace_id, v_actor);
  RETURN t;
END;
$$;

-- ── 4. The ops ───────────────────────────────────────────────────────────────

-- Add a task to your queue: at the end (default), or at the top (Calendar's
-- "Start focus"). Already there: 'end' leaves it where it is, 'top' moves it.
CREATE OR REPLACE FUNCTION public.tasks_op_queue_add(
  p_workspace_id uuid,
  p_task_id uuid,
  p_at text DEFAULT 'end'
)
RETURNS SETOF public.task_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
  v_at text := coalesce(p_at, 'end');
BEGIN
  IF v_at NOT IN ('end', 'top') THEN
    RAISE EXCEPTION 'A task goes to the end or the top of the queue.';
  END IF;
  t := public.tasks_queue__guard(p_workspace_id, p_task_id);
  IF t.status = 'done' THEN
    RAISE EXCEPTION 'Done tasks can''t be queued.';
  ELSIF t.status = 'archived' THEN
    RAISE EXCEPTION 'Archived tasks can''t be queued.';
  END IF;
  IF v_at = 'top' OR NOT EXISTS (SELECT 1 FROM public.task_queue q
                                 WHERE q.user_id = v_actor AND q.task_id = t.id) THEN
    IF public.tasks_queue__place(p_workspace_id, v_actor, t.id, v_at) THEN
      PERFORM public.module_activity_log(
        p_workspace_id, 'tasks', 'task', t.id, 'tasks.queue_add',
        jsonb_build_object('at', v_at));
    END IF;
  END IF;
  RETURN QUERY SELECT * FROM public.tasks_queue__mine(p_workspace_id, v_actor);
END;
$$;

-- Take a task out of your queue. Not there: nothing happens.
CREATE OR REPLACE FUNCTION public.tasks_op_queue_remove(p_workspace_id uuid, p_task_id uuid)
RETURNS SETOF public.task_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
  v_gone integer;
BEGIN
  t := public.tasks_queue__guard(p_workspace_id, p_task_id);
  DELETE FROM public.task_queue q WHERE q.user_id = v_actor AND q.task_id = t.id;
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  IF v_gone > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'tasks', 'task', t.id, 'tasks.queue_remove', '{}'::jsonb);
  END IF;
  RETURN QUERY SELECT * FROM public.tasks_queue__mine(p_workspace_id, v_actor);
END;
$$;

-- Move a task within your queue: right after p_after_task_id, or to the top
-- when that is NULL. Not logged.
CREATE OR REPLACE FUNCTION public.tasks_op_queue_reorder(
  p_workspace_id uuid,
  p_task_id uuid,
  p_after_task_id uuid DEFAULT NULL
)
RETURNS SETOF public.task_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
BEGIN
  t := public.tasks_queue__guard(p_workspace_id, p_task_id);
  IF NOT EXISTS (SELECT 1 FROM public.task_queue q WHERE q.user_id = v_actor AND q.task_id = t.id) THEN
    RAISE EXCEPTION 'That task isn''t in your queue.';
  END IF;
  IF p_after_task_id IS NULL THEN
    PERFORM public.tasks_queue__place(p_workspace_id, v_actor, t.id, 'top');
  ELSIF p_after_task_id <> t.id THEN
    PERFORM public.tasks_queue__place(p_workspace_id, v_actor, t.id, 'after', p_after_task_id);
  END IF;
  RETURN QUERY SELECT * FROM public.tasks_queue__mine(p_workspace_id, v_actor);
END;
$$;

-- Send a task to the end of your queue (Skip in a run, "Do later today").
-- Not logged, and never counts as a reschedule.
CREATE OR REPLACE FUNCTION public.tasks_op_queue_move_to_end(p_workspace_id uuid, p_task_id uuid)
RETURNS SETOF public.task_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
BEGIN
  t := public.tasks_queue__guard(p_workspace_id, p_task_id);
  IF NOT EXISTS (SELECT 1 FROM public.task_queue q WHERE q.user_id = v_actor AND q.task_id = t.id) THEN
    RAISE EXCEPTION 'That task isn''t in your queue.';
  END IF;
  PERFORM public.tasks_queue__place(p_workspace_id, v_actor, t.id, 'end');
  RETURN QUERY SELECT * FROM public.tasks_queue__mine(p_workspace_id, v_actor);
END;
$$;

-- ── 5. The old commit ops act on the caller's queue ──────────────────────────
-- They still write committed_for / commit_order, which app versions from
-- before TV-D4 read as "today's queue". The setting tells the legacy trigger
-- (§7) that the op has already updated the queue.

CREATE OR REPLACE FUNCTION public.tasks_op_commit(p_workspace_id uuid, p_task_id uuid, p_for date)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_order integer;
  v_reordered boolean;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF p_for IS NULL THEN
    RAISE EXCEPTION 'Commit needs a date.';
  END IF;
  IF t.status = 'archived' THEN
    RAISE EXCEPTION 'Archived tasks can''t be committed.';
  END IF;
  -- TV-D2: committing puts the task at the end of the caller's queue
  -- (recommitting moves it there, as it moved to the end of the day's queue).
  -- Done tasks keep the old answer (the column write below) but no queue row.
  IF public.perm_actor_id() IS NOT NULL AND t.status <> 'done' THEN
    PERFORM public.tasks_queue__guard(p_workspace_id, t.id);
    PERFORM public.tasks_queue__place(p_workspace_id, public.perm_actor_id(), t.id, 'end');
  END IF;
  v_reordered := t.committed_for = p_for;
  SELECT coalesce(max(commit_order), 0) + 1 INTO v_order
    FROM public.tasks
    WHERE workspace_id = p_workspace_id AND committed_for = p_for
      AND deleted_at IS NULL AND id <> t.id;
  PERFORM set_config('tasks.queue_legacy', 'op', true);
  UPDATE public.tasks
    SET committed_for = p_for, commit_order = v_order, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  PERFORM set_config('tasks.queue_legacy', '', true);
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.commit',
    jsonb_build_object('for', p_for, 'order', v_order, 'reordered', coalesce(v_reordered, false))
  );
  RETURN t;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.tasks_op_uncommit(p_workspace_id uuid, p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_was date;
  v_dequeued integer := 0;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  -- TV-D2: out of the caller's queue.
  IF public.perm_actor_id() IS NOT NULL THEN
    PERFORM public.tasks_queue__lock(p_workspace_id, public.perm_actor_id());
    DELETE FROM public.task_queue q WHERE q.user_id = public.perm_actor_id() AND q.task_id = t.id;
    GET DIAGNOSTICS v_dequeued = ROW_COUNT;
  END IF;
  IF t.committed_for IS NULL AND v_dequeued = 0 THEN
    RETURN t; -- no-op, no log
  END IF;
  v_was := t.committed_for;
  IF t.committed_for IS NOT NULL THEN
    PERFORM set_config('tasks.queue_legacy', 'op', true);
    UPDATE public.tasks
      SET committed_for = NULL, commit_order = NULL, updated_at = now()
      WHERE id = t.id
      RETURNING * INTO t;
    PERFORM set_config('tasks.queue_legacy', '', true);
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.uncommit',
    jsonb_build_object('was', v_was)
  );
  RETURN t;
END;
$function$
;

-- Skip: out of the caller's queue, and no longer a reschedule (spec decision 4:
-- leaving the queue isn't a slip).
CREATE OR REPLACE FUNCTION public.tasks_op_skip_today(p_workspace_id uuid, p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_dequeued integer := 0;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF public.perm_actor_id() IS NOT NULL THEN
    PERFORM public.tasks_queue__lock(p_workspace_id, public.perm_actor_id());
    DELETE FROM public.task_queue q WHERE q.user_id = public.perm_actor_id() AND q.task_id = t.id;
    GET DIAGNOSTICS v_dequeued = ROW_COUNT;
  END IF;
  IF t.committed_for IS NULL AND v_dequeued = 0 THEN
    RETURN t; -- nothing to skip out of
  END IF;
  IF t.committed_for IS NOT NULL THEN
    PERFORM set_config('tasks.queue_legacy', 'op', true);
    UPDATE public.tasks
      SET committed_for = NULL, commit_order = NULL, updated_at = now()
      WHERE id = t.id
      RETURNING * INTO t;
    PERFORM set_config('tasks.queue_legacy', '', true);
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.skip_today',
    jsonb_build_object('reschedule_count', t.reschedule_count)
  );
  RETURN t;
END;
$function$
;

-- ── 6. Carry today's commits over (once) ─────────────────────────────────────
-- "Today" is the committer's local date, so anything committed for yesterday,
-- today or tomorrow in UTC. Each open task goes to whoever committed it last
-- (an API key's commit is its creator's), else to its assignee, if they are
-- still in the workspace; their order follows the day, then commit_order.

INSERT INTO public.task_queue (workspace_id, user_id, task_id, position)
SELECT c.workspace_id, c.user_id, c.task_id,
       public.tasks_queue__key(1048576 * row_number() OVER (
         PARTITION BY c.workspace_id, c.user_id
         ORDER BY c.committed_for, c.commit_order NULLS LAST, c.created_at, c.task_id))
FROM (
  SELECT t.id AS task_id, t.workspace_id, t.committed_for, t.commit_order, t.created_at,
         coalesce(
           (SELECT CASE WHEN a.actor_type = 'api_key' THEN k.created_by ELSE a.actor_id END
            FROM public.module_activity a
            LEFT JOIN public.workspace_api_keys k ON a.actor_type = 'api_key' AND k.id = a.actor_id
            WHERE a.module = 'tasks' AND a.entity_type = 'task' AND a.entity_id = t.id
              AND a.op = 'tasks.commit'
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT 1),
           t.assignee_id) AS user_id
  FROM public.tasks t
  WHERE t.committed_for BETWEEN current_date - 1 AND current_date + 1
    AND t.deleted_at IS NULL
    AND t.status NOT IN ('done', 'archived')
) c
WHERE c.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.user_id)
  AND (public.perm_is_owner(c.workspace_id, c.user_id)
       OR EXISTS (SELECT 1 FROM public.workspace_members m
                  WHERE m.workspace_id = c.workspace_id AND m.user_id = c.user_id))
ON CONFLICT (user_id, task_id) DO NOTHING;

-- ── 7. Old versions' direct writes land in the writer's queue ────────────────
-- Builds from before TV-D4 capture straight into today (an insert with
-- committed_for) and reorder the day's queue by writing commit_order. Mirror
-- both into the writer's queue. Only additions and moves: an old build's
-- whole-row save can write a stale NULL back, and catch-up / skip-occurrence
-- clear the column for a date reason; neither may empty a queue. Removals
-- come through the ops. A failure here never fails the task write.

CREATE OR REPLACE FUNCTION public.tasks_queue_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF current_setting('tasks.queue_legacy', true) = 'op' THEN
    RETURN NULL; -- tasks_op_commit / uncommit / skip_today did it themselves
  END IF;
  IF NEW.committed_for IS NULL OR NEW.deleted_at IS NOT NULL
     OR NEW.status IN ('done', 'archived')
     OR NEW.committed_for < current_date - 1 THEN
    RETURN NULL;
  END IF;
  v_actor := public.perm_actor_id();
  IF v_actor IS NULL THEN
    RETURN NULL; -- system work
  END IF;

  BEGIN
    IF TG_OP = 'INSERT' OR OLD.committed_for IS DISTINCT FROM NEW.committed_for THEN
      -- A commit: to the end of the writer's queue, unless it's there already.
      IF NOT EXISTS (SELECT 1 FROM public.task_queue q WHERE q.user_id = v_actor AND q.task_id = NEW.id) THEN
        PERFORM public.tasks_queue__lock(NEW.workspace_id, v_actor);
        PERFORM public.tasks_queue__place(NEW.workspace_id, v_actor, NEW.id, 'end');
      END IF;
    ELSIF OLD.commit_order IS DISTINCT FROM NEW.commit_order
          AND EXISTS (SELECT 1 FROM public.task_queue q WHERE q.user_id = v_actor AND q.task_id = NEW.id) THEN
      -- A drag in the old day's queue. The app renumbers one task per request,
      -- so re-sort the writer's rows for that day's tasks by commit_order
      -- (their slots keep their keys): once the last write lands, the order
      -- matches. Rows queued another way keep their places.
      PERFORM public.tasks_queue__lock(NEW.workspace_id, v_actor);
      UPDATE public.task_queue q
      SET position = s.position, updated_at = now()
      FROM (
        SELECT d.id, slot.position
        FROM (
          SELECT q2.id, row_number() OVER (ORDER BY t.commit_order, q2.position) AS rn
          FROM public.task_queue q2
          JOIN public.tasks t ON t.id = q2.task_id
          WHERE q2.workspace_id = NEW.workspace_id AND q2.user_id = v_actor
            AND t.committed_for = NEW.committed_for AND t.commit_order IS NOT NULL
            AND t.deleted_at IS NULL
        ) d
        JOIN (
          SELECT q3.position, row_number() OVER (ORDER BY q3.position) AS rn
          FROM public.task_queue q3
          JOIN public.tasks t ON t.id = q3.task_id
          WHERE q3.workspace_id = NEW.workspace_id AND q3.user_id = v_actor
            AND t.committed_for = NEW.committed_for AND t.commit_order IS NOT NULL
            AND t.deleted_at IS NULL
        ) slot ON slot.rn = d.rn
      ) s
      WHERE q.id = s.id AND q.position <> s.position;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tasks_queue_legacy: task %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tasks_queue_legacy_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW WHEN (NEW.committed_for IS NOT NULL)
  EXECUTE FUNCTION public.tasks_queue_legacy();
CREATE TRIGGER tasks_queue_legacy_update
  AFTER UPDATE OF committed_for, commit_order ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue_legacy();

-- ── 8. Leaving every queue ───────────────────────────────────────────────────
-- Completed, archived or deleted: the task leaves every queue (a recurring
-- task too; its next occurrence reopens it later without queuing it).
-- Restoring or reopening never puts it back.

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
    IF NEW.deleted_at IS NOT NULL THEN
      DELETE FROM public.task_queue q
      USING public.tasks t
      WHERE t.id = q.task_id AND t.bucket_id = NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tasks_queue_leave
  AFTER UPDATE OF status, deleted_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue_leave();
CREATE TRIGGER tasks_queue_leave
  AFTER UPDATE OF deleted_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue_leave();

-- Someone who leaves a workspace (or deletes their account) takes their queue
-- there with them, so nobody sees "In <name>'s queue" for a former member.
CREATE OR REPLACE FUNCTION public.tasks_queue_member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.task_queue q
  WHERE q.workspace_id = OLD.workspace_id AND q.user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER tasks_queue_member_removed
  AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue_member_removed();

-- ── 9. Writes need Tasks edit access (perm_enforce_write) ────────────────────
-- Inserts and moves only: removals follow from someone else's change (a task
-- completed, a member removed), which already passed its own check, and a
-- cascade must never fail on a person's queue.

CREATE TRIGGER perm_enforce_write
  BEFORE INSERT OR UPDATE ON public.task_queue
  FOR EACH ROW EXECUTE FUNCTION public.perm_enforce_write('tasks', 'edit');

-- ── 10. Grants ───────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated directly,
-- so they are revoked by name (REVOKE … FROM PUBLIC alone leaves anon).
DO $$
DECLARE fn text;
BEGIN
  -- The ops: signed-in users and the MCP connector (service role).
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_queue_add(uuid, uuid, text)',
    'tasks_op_queue_remove(uuid, uuid)',
    'tasks_op_queue_reorder(uuid, uuid, uuid)',
    'tasks_op_queue_move_to_end(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- Helpers and triggers: only the definer functions above call them.
  FOREACH fn IN ARRAY ARRAY[
    'tasks_queue__key(bigint)',
    'tasks_queue__num(text)',
    'tasks_queue__lock(uuid, uuid)',
    'tasks_queue__renumber(uuid, uuid, uuid)',
    'tasks_queue__place(uuid, uuid, uuid, text, uuid)',
    'tasks_queue__mine(uuid, uuid)',
    'tasks_queue__guard(uuid, uuid)',
    'tasks_queue_legacy()',
    'tasks_queue_leave()',
    'tasks_queue_member_removed()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END;
$$;
