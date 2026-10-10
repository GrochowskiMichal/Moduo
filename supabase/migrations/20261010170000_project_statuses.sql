-- TV-D9 · Statuses per project, inside five fixed categories (specs/tasks-v3.md
-- block 9, §Assumptions #3, #24, #27, #28; REPLAN 53, 53a, 53b; decisions in
-- docs/decisions/tasks.md "TV-D9").
--
--   * project_statuses: each project names its own statuses inside the five
--     categories Backlog · To do · In progress · Done · Won't do (rename, add,
--     hide, reorder). The category carries the app's behaviour; the name
--     belongs to the project. Rows with project_id IS NULL are the workspace's
--     default set: new projects copy it, and the Inbox (a system project) uses
--     it as it is. A category is never left without a status.
--   * tasks.status_id points at one of its project's statuses, and
--     tasks.status_category copies that status's category so a row (and a
--     Realtime payload) says what it is without a join. The legacy
--     tasks.status keeps today's four values as a mirror of the category
--     (Backlog reads "todo", Won't do "archived"), so builds from before this
--     migration see every task, and their write of it lands on the first status
--     of that category. Moving a task to another project keeps its status name
--     when that project has it, else the first status of the same category.
--   * Status words, names and ids: the ops accept a status id, a category word
--     (backlog, todo, "To do", in_progress, done, wont_do, "Won't do", or the
--     old archived) or one of the project's status names; anything else is
--     refused with the project's list.
--   * Backlog: scheduling or queuing a backlog task moves it to To do; the
--     roll-over leaves backlog repeats alone; a task moved to Backlog leaves
--     every queue.
--
-- Expand only: nothing is dropped. TV-D7 retires the legacy column's values.
-- Verified on the local stack by supabase/tests/statuses.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 1. The vocabulary (@contracts/vocabularies TASK_STATUS_CATEGORIES) ──────

-- A category from a word: the stored tokens, the old "archived", and the
-- category names as people write them ("To do", "Won't do", "in progress").
CREATE OR REPLACE FUNCTION public.tasks__status_category_of(p_word text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE regexp_replace(lower(btrim(coalesce(p_word, ''))), '[[:space:]''’_-]+', '', 'g')
    WHEN 'backlog' THEN 'backlog'
    WHEN 'todo' THEN 'todo'
    WHEN 'inprogress' THEN 'in_progress'
    WHEN 'done' THEN 'done'
    WHEN 'wontdo' THEN 'wont_do'
    WHEN 'archived' THEN 'wont_do'
  END
$$;

-- What builds from before TV-D9 read in tasks.status for a category.
CREATE OR REPLACE FUNCTION public.tasks__legacy_status(p_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_category
    WHEN 'backlog' THEN 'todo'
    WHEN 'wont_do' THEN 'archived'
    ELSE p_category
  END
$$;

-- The categories' fixed order (lists, pickers, the "unknown status" answer).
CREATE OR REPLACE FUNCTION public.tasks__category_rank(p_category text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_category
    WHEN 'backlog' THEN 0 WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2
    WHEN 'done' THEN 3 WHEN 'wont_do' THEN 4 ELSE 5
  END
$$;

-- ── 2. The table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- NULL: the workspace's default set.
  project_id uuid REFERENCES public.buckets(id) ON DELETE CASCADE,
  category text NOT NULL,
  name text NOT NULL,
  -- Order inside the category (1, 2, …).
  position integer NOT NULL DEFAULT 1,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT project_statuses_category_check CHECK (category IN ('backlog','todo','in_progress','done','wont_do')),
  CONSTRAINT project_statuses_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);

-- One name per set (case and spaces aside), among live statuses.
CREATE UNIQUE INDEX IF NOT EXISTS project_statuses_name_per_set
  ON public.project_statuses (workspace_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_statuses_project
  ON public.project_statuses (project_id, category, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_statuses_workspace_defaults
  ON public.project_statuses (workspace_id, category, position) WHERE project_id IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS project_statuses_workspace_updated
  ON public.project_statuses (workspace_id, updated_at);

-- Readable by whoever can read Tasks in the workspace and the project; every
-- write goes through the ops below.
ALTER TABLE public.project_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_statuses_read ON public.project_statuses;
CREATE POLICY project_statuses_read ON public.project_statuses
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks')
         AND (project_id IS NULL OR public.can_access('bucket', project_id, 'view')));
REVOKE ALL ON public.project_statuses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_statuses TO authenticated;
GRANT ALL ON public.project_statuses TO service_role;

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.project_statuses;
CREATE TRIGGER zz_stamp_updated_at
  BEFORE INSERT OR UPDATE ON public.project_statuses
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- Live updates (the shared store, TV-D11a, listens).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'project_statuses') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_statuses;
  END IF;
END;
$$;

-- ── 3. Default sets and per-project copies ──────────────────────────────────

-- A set that has no live status gets one: the workspace default is the five
-- categories under their own names; a project copies the workspace default.
-- Idempotent and serialized per set.
CREATE OR REPLACE FUNCTION public.project_statuses__seed(p_workspace_id uuid, p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'project_statuses:' || p_workspace_id::text || ':' || coalesce(p_project_id::text, ''), 0));
  IF EXISTS (SELECT 1 FROM public.project_statuses s
             WHERE s.workspace_id = p_workspace_id
               AND s.project_id IS NOT DISTINCT FROM p_project_id
               AND s.deleted_at IS NULL) THEN
    RETURN;
  END IF;
  IF p_project_id IS NULL THEN
    INSERT INTO public.project_statuses (workspace_id, project_id, category, name, position)
    VALUES (p_workspace_id, NULL, 'backlog', 'Backlog', 1),
           (p_workspace_id, NULL, 'todo', 'To do', 1),
           (p_workspace_id, NULL, 'in_progress', 'In progress', 1),
           (p_workspace_id, NULL, 'done', 'Done', 1),
           (p_workspace_id, NULL, 'wont_do', 'Won''t do', 1);
  ELSE
    PERFORM public.project_statuses__seed(p_workspace_id, NULL);
    INSERT INTO public.project_statuses (workspace_id, project_id, category, name, position, hidden)
    SELECT p_workspace_id, p_project_id, s.category, s.name, s.position, s.hidden
    FROM public.project_statuses s
    WHERE s.workspace_id = p_workspace_id AND s.project_id IS NULL AND s.deleted_at IS NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.project_statuses__seed_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.project_statuses__seed(NEW.id, NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS project_statuses_seed ON public.workspaces;
CREATE TRIGGER project_statuses_seed
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.project_statuses__seed_workspace();

-- A new project starts from the workspace default (the Inbox uses it as is).
CREATE OR REPLACE FUNCTION public.project_statuses__seed_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.project_statuses__seed(NEW.workspace_id, NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS project_statuses_seed ON public.buckets;
CREATE TRIGGER project_statuses_seed
  AFTER INSERT ON public.buckets
  FOR EACH ROW WHEN (NOT NEW.is_system)
  EXECUTE FUNCTION public.project_statuses__seed_project();

-- Backfill: every workspace, then every project (deleted ones too, so a
-- restore finds its statuses).
SELECT public.project_statuses__seed(w.id, NULL) FROM public.workspaces w;
SELECT public.project_statuses__seed(b.workspace_id, b.id) FROM public.buckets b WHERE NOT b.is_system;

-- ── 4. Which status: sets, the first of a category, words and names ─────────

-- The set a project's tasks use: the project's own, or NULL (the workspace
-- default) for the Inbox and for a project that can't be found.
CREATE OR REPLACE FUNCTION public.tasks__status_set(p_bucket_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id FROM public.buckets b WHERE b.id = p_bucket_id AND NOT b.is_system
$$;

-- Is this status live and in that set?
CREATE OR REPLACE FUNCTION public.tasks__status_in_set(p_status public.project_statuses, p_workspace_id uuid, p_set uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_status.id IS NOT NULL AND p_status.deleted_at IS NULL
     AND CASE WHEN p_set IS NULL THEN p_status.project_id IS NULL AND p_status.workspace_id = p_workspace_id
              ELSE p_status.project_id = p_set END
$$;

-- The first status of a category in a set: visible ones first, then by
-- position. Seeds the set when it has none.
CREATE OR REPLACE FUNCTION public.tasks__first_status(p_workspace_id uuid, p_set uuid, p_category text)
RETURNS public.project_statuses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.project_statuses;
  v_try integer;
BEGIN
  FOR v_try IN 1 .. 2 LOOP
    SELECT * INTO s FROM public.project_statuses x
    WHERE x.category = p_category AND x.deleted_at IS NULL
      AND CASE WHEN p_set IS NULL THEN x.project_id IS NULL AND x.workspace_id = p_workspace_id
               ELSE x.project_id = p_set END
    ORDER BY x.hidden, x.position, x.created_at, x.id
    LIMIT 1;
    IF FOUND THEN
      RETURN s;
    END IF;
    PERFORM public.project_statuses__seed(p_workspace_id,  p_set);
  END LOOP;
  IF p_set IS NOT NULL THEN
    -- A project without that category can't happen (the ops keep one); the
    -- workspace default is the answer that keeps the write going.
    RETURN public.tasks__first_status(p_workspace_id, NULL, p_category);
  END IF;
  RAISE EXCEPTION 'No "%" status in this workspace.', p_category;
END;
$$;

-- Read a status from what a caller sent: a status id from the project's set,
-- a category word, or one of the project's status names. A category word keeps
-- the current status when it is already in that category ("in_progress" on a
-- task In review stays In review); otherwise it is the category's first.
CREATE OR REPLACE FUNCTION public.tasks__resolve_status(
  p_workspace_id uuid, p_bucket_id uuid, p_value text, p_current uuid DEFAULT NULL)
RETURNS public.project_statuses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set uuid := public.tasks__status_set(p_bucket_id);
  v text := btrim(coalesce(p_value, ''));
  v_id uuid;
  v_cat text;
  s public.project_statuses;
  v_names text;
BEGIN
  IF v = '' THEN
    RAISE EXCEPTION 'Unknown task status.' USING ERRCODE = '22023';
  END IF;
  -- Make sure the set exists before reading names from it.
  PERFORM public.tasks__first_status(p_workspace_id, v_set, 'todo');

  v_id := public.tasks__try_uuid(v);
  IF v_id IS NOT NULL THEN
    SELECT * INTO s FROM public.project_statuses x WHERE x.id = v_id;
    IF NOT public.tasks__status_in_set(s, p_workspace_id, v_set) THEN
      RAISE EXCEPTION 'That status isn''t in this project.' USING ERRCODE = '22023';
    END IF;
    RETURN s;
  END IF;

  v_cat := public.tasks__status_category_of(v);
  IF v_cat IS NULL THEN
    SELECT * INTO s FROM public.project_statuses x
    WHERE lower(btrim(x.name)) = lower(v) AND x.deleted_at IS NULL
      AND CASE WHEN v_set IS NULL THEN x.project_id IS NULL AND x.workspace_id = p_workspace_id
               ELSE x.project_id = v_set END
    LIMIT 1;
    IF FOUND THEN
      RETURN s;
    END IF;
    SELECT string_agg(x.name, ', ' ORDER BY public.tasks__category_rank(x.category), x.position, x.created_at)
      INTO v_names
    FROM public.project_statuses x
    WHERE x.deleted_at IS NULL
      AND CASE WHEN v_set IS NULL THEN x.project_id IS NULL AND x.workspace_id = p_workspace_id
               ELSE x.project_id = v_set END;
    RAISE EXCEPTION 'Unknown task status "%". This project''s statuses: %.', v, v_names USING ERRCODE = '22023';
  END IF;

  IF p_current IS NOT NULL THEN
    SELECT * INTO s FROM public.project_statuses x WHERE x.id = p_current;
    IF public.tasks__status_in_set(s, p_workspace_id, v_set) AND s.category = v_cat THEN
      RETURN s;
    END IF;
  END IF;
  RETURN public.tasks__first_status(p_workspace_id, v_set, v_cat);
END;
$$;

-- ── 5. tasks.status_id, its category, and the legacy mirror ─────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status_id uuid
  REFERENCES public.project_statuses(id);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS status_category text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_category_check'
                   AND conrelid = 'public.tasks'::regclass) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_category_check
      CHECK (status_category IN ('backlog','todo','in_progress','done','wont_do'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS tasks_status_id_idx ON public.tasks (status_id);

-- Backfill before the trigger exists: every task takes the first status of
-- its legacy value's category in its project (or the workspace default).
UPDATE public.tasks t
SET (status_id, status_category) = (
  SELECT s.id, s.category FROM public.project_statuses s
  WHERE s.deleted_at IS NULL
    AND s.category = coalesce(public.tasks__status_category_of(t.status), 'todo')
    AND (s.project_id = (SELECT b.id FROM public.buckets b WHERE b.id = t.bucket_id AND NOT b.is_system)
         OR (s.project_id IS NULL AND s.workspace_id = t.workspace_id
             AND NOT EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = t.bucket_id AND NOT b.is_system)))
  ORDER BY s.hidden, s.position, s.created_at, s.id
  LIMIT 1)
WHERE t.status_id IS NULL;

ALTER TABLE public.tasks ALTER COLUMN status_id SET NOT NULL;
ALTER TABLE public.tasks ALTER COLUMN status_category SET NOT NULL;

-- Keeps status_id, status_category and the legacy status in step, on every
-- write path (the ops, old builds' raw writes, the roll-over, account erasure):
--   1. a write of status_id wins (it must be one of the project's statuses);
--   2. else a write of the legacy status lands on that category's first status;
--   3. else a move to another project keeps the name when it's there, else
--      takes the first status of the same category;
--   4. a new row without a status_id reads its legacy status (To do when none).
-- Only what changed is acted on, so an old build saving a whole row it read
-- (a backlog task reads "todo") changes nothing. Scheduling a backlog task
-- moves it to To do.
CREATE OR REPLACE FUNCTION public.tasks__status_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set uuid := public.tasks__status_set(NEW.bucket_id);
  s public.project_statuses;
  v_old public.project_statuses;
  v_cat text;
BEGIN
  IF NEW.status_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id) THEN
    SELECT * INTO s FROM public.project_statuses x WHERE x.id = NEW.status_id;
    IF NOT public.tasks__status_in_set(s, NEW.workspace_id, v_set) THEN
      RAISE EXCEPTION 'That status isn''t in this project.' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_cat := public.tasks__status_category_of(NEW.status);
    IF v_cat IS NULL THEN
      RAISE EXCEPTION 'Unknown task status.' USING ERRCODE = '22023';
    END IF;
    s := public.tasks__first_status(NEW.workspace_id, v_set, v_cat);
  ELSIF TG_OP = 'UPDATE' AND NEW.status_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.project_statuses x WHERE x.id = NEW.status_id;
    IF public.tasks__status_in_set(v_old, NEW.workspace_id, v_set) THEN
      s := v_old;
    ELSE
      -- Moved: the same name in the new project (same category), else the
      -- category's first status there.
      v_cat := coalesce(v_old.category, OLD.status_category,
                        public.tasks__status_category_of(OLD.status), 'todo');
      SELECT * INTO s FROM public.project_statuses x
      WHERE x.category = v_cat AND x.deleted_at IS NULL
        AND lower(btrim(x.name)) = lower(btrim(v_old.name))
        AND CASE WHEN v_set IS NULL THEN x.project_id IS NULL AND x.workspace_id = NEW.workspace_id
                 ELSE x.project_id = v_set END
      LIMIT 1;
      IF NOT FOUND THEN
        s := public.tasks__first_status(NEW.workspace_id, v_set, v_cat);
      END IF;
      -- The trail says so when the move changed the status's name (the
      -- project change is the op's own line).
      IF lower(btrim(s.name)) IS DISTINCT FROM lower(btrim(v_old.name))
         AND (auth.uid() IS NOT NULL OR public.module_api_key_id() IS NOT NULL) THEN
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.set_status',
          jsonb_build_object('from', OLD.status, 'to', public.tasks__legacy_status(s.category),
                             'from_category', v_cat, 'to_category', s.category,
                             'from_name', v_old.name, 'to_name', s.name, 'reason', 'moved'));
      END IF;
    END IF;
  ELSE
    v_cat := coalesce(public.tasks__status_category_of(NEW.status), 'todo');
    s := public.tasks__first_status(NEW.workspace_id, v_set, v_cat);
  END IF;

  -- Scheduling a backlog task moves it to To do (REPLAN 53).
  IF s.category = 'backlog' AND NEW.scheduled_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at) THEN
    s := public.tasks__first_status(NEW.workspace_id, v_set, 'todo');
    IF TG_OP = 'UPDATE' AND (auth.uid() IS NOT NULL OR public.module_api_key_id() IS NOT NULL) THEN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.set_status',
        jsonb_build_object('from', 'todo', 'to', 'todo',
                           'from_category', 'backlog', 'to_category', 'todo',
                           'to_name', s.name, 'reason', 'scheduled'));
    END IF;
  END IF;

  NEW.status_id := s.id;
  NEW.status_category := s.category;
  NEW.status := public.tasks__legacy_status(s.category);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_status_sync ON public.tasks;
CREATE TRIGGER tasks_status_sync
  BEFORE INSERT OR UPDATE OF status, status_id, status_category, bucket_id, scheduled_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__status_sync();

-- ── 6. The one status path, by id, name or category ─────────────────────────

-- Production's body (TV-D8's 20261010161000, read from the catalog on
-- 2026-10-10), resolving what the caller sent to one of the project's
-- statuses: the no-op, the repeat pointer and the completion history follow
-- the category; status_id and the legacy mirror are written together (so
-- `AFTER UPDATE OF status` triggers keep firing); the trail line names both.
CREATE OR REPLACE FUNCTION public.tasks__apply_status(t public.tasks, p_status text, p_recurrence jsonb, p_position text)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text := t.status;
  v_from_id uuid := t.status_id;
  v_from_cat text := coalesce(t.status_category, public.tasks__status_category_of(t.status));
  v_from_name text;
  v_to public.project_statuses;
  v_rec jsonb := t.recurrence;
  v_pointer jsonb;
  v_now timestamptz := now();
BEGIN
  v_to := public.tasks__resolve_status(t.workspace_id, t.bucket_id, p_status, t.status_id);
  IF v_to.id IS NOT DISTINCT FROM t.status_id AND p_position IS NULL THEN
    RETURN t; -- no-op (a client's pointer alone never moves it)
  END IF;
  SELECT x.name INTO v_from_name FROM public.project_statuses x WHERE x.id = v_from_id;

  IF jsonb_typeof(t.recurrence) = 'object' AND v_from_cat IS DISTINCT FROM v_to.category THEN
    BEGIN
      IF v_to.category = 'done' THEN
        v_pointer := public.tasks__pointer_on_complete(t, v_now);
      ELSIF v_from_cat = 'done' AND v_to.category IN ('backlog', 'todo', 'in_progress') THEN
        v_pointer := public.tasks__pointer_on_reopen(t, v_now);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A rule the engine can't evaluate never blocks a status change.
      RAISE NOTICE 'tasks__apply_status: no pointer for task % (%)', t.id, SQLERRM;
      v_pointer := '{"supported": false}'::jsonb;
    END;
    IF v_pointer IS NOT NULL THEN
      IF (v_pointer ->> 'supported')::boolean THEN
        v_rec := t.recurrence || jsonb_build_object('nextOccurrence', v_pointer -> 'next');
      ELSIF jsonb_typeof(p_recurrence) = 'object' THEN
        -- A rule only the app's engine reads: its pointer, as before.
        v_rec := p_recurrence;
      END IF;
    END IF;
  END IF;

  UPDATE public.tasks
    SET status_id = v_to.id,
        status = public.tasks__legacy_status(v_to.category),
        recurrence = v_rec,
        position = coalesce(p_position, position),
        updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;

  IF v_from_cat IS DISTINCT FROM 'done' AND t.status_category = 'done' THEN
    PERFORM public.tasks__record_completion(t, v_now);
  ELSIF v_from_cat = 'done' AND t.status_category IS DISTINCT FROM 'done' THEN
    -- Reopened by hand, or marked Won't do: that completion didn't stand.
    UPDATE public.task_completions c SET deleted_at = now()
    WHERE c.id = (SELECT x.id FROM public.task_completions x
                  WHERE x.task_id = t.id AND x.deleted_at IS NULL
                  ORDER BY x.completed_at DESC, x.id DESC LIMIT 1);
  END IF;

  IF v_from_id IS DISTINCT FROM t.status_id THEN
    PERFORM public.module_activity_log(
      t.workspace_id, 'tasks', 'task', t.id, 'tasks.set_status',
      jsonb_build_object('from', v_from, 'to', t.status,
                         'from_category', v_from_cat, 'to_category', t.status_category,
                         'from_name', v_from_name, 'to_name', v_to.name,
                         'next_occurrence', CASE WHEN jsonb_typeof(v_rec) = 'object'
                                                 THEN v_rec ->> 'nextOccurrence' END));
  END IF;
  RETURN t;
END;
$$;

-- ── 7. Backlog and the queue, the roll-over ─────────────────────────────────

-- Queuing a backlog task moves it to To do (the queue op, the legacy commit
-- mirror, anything that adds a queue row), when the person can edit it.
CREATE OR REPLACE FUNCTION public.tasks_queue__backlog_to_todo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
BEGIN
  SELECT * INTO t FROM public.tasks x WHERE x.id = NEW.task_id;
  IF FOUND AND t.status_category = 'backlog' AND t.deleted_at IS NULL
     AND public.perm_actor_id() IS NOT NULL
     AND public.can_access('task', t.id, 'edit', public.perm_actor_id()) THEN
    PERFORM public.tasks__apply_status(t, 'todo', NULL, NULL);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tasks_queue_backlog_to_todo ON public.task_queue;
CREATE TRIGGER tasks_queue_backlog_to_todo
  AFTER INSERT ON public.task_queue
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue__backlog_to_todo();

-- TV-D2's body (20261008171500), plus: a task moved to Backlog leaves every
-- queue too (the queue is what you mean to do next).
CREATE OR REPLACE FUNCTION public.tasks_queue_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.status IN ('done', 'archived') OR NEW.status_category = 'backlog' OR NEW.deleted_at IS NOT NULL THEN
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

DROP TRIGGER IF EXISTS tasks_queue_leave ON public.tasks;
CREATE TRIGGER tasks_queue_leave
  AFTER UPDATE OF status, status_id, deleted_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue_leave();

-- Production's body (TV-D8's 20261010161000, read from the catalog on
-- 2026-10-10), plus: backlog repeats sit out of the roll-over (a backlog task
-- reads "todo" in the legacy column, so the open-repeat test reads the
-- category).
CREATE OR REPLACE FUNCTION public.tasks__roll_over(p_workspace_id uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 1000, p_budget interval DEFAULT '00:00:30'::interval)
 RETURNS SETOF tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_zone text;
  v_today date;
  v_end timestamptz;
  v_pointer timestamptz;
  v_done_at timestamptz;
  v_cur timestamptz;
  v_next timestamptz;
  v_from timestamptz;
  v_kind text;
  v_started timestamptz := clock_timestamp();
  v_changed boolean;
  v_supported boolean;
  v_missing boolean;
BEGIN
  FOR t IN
    SELECT * FROM public.tasks x
    WHERE (p_workspace_id IS NULL OR x.workspace_id = p_workspace_id)
      AND x.deleted_at IS NULL
      AND jsonb_typeof(x.recurrence) = 'object'
      AND public.tasks__recurrence_problem(x.recurrence) IS NULL
      AND ((x.status = 'done'
            AND jsonb_typeof(x.recurrence -> 'nextOccurrence') IS DISTINCT FROM 'null'
            AND coalesce(public.tasks__try_ts(x.recurrence ->> 'nextOccurrence'), '-infinity'::timestamptz)
                < p_now + interval '26 hours')
           OR (x.status IN ('todo', 'in_progress')
               AND x.status_category IS DISTINCT FROM 'backlog'
               AND coalesce(x.recurrence ->> 'mode', '') <> 'after_completion'
               AND (x.scheduled_at IS NULL OR x.scheduled_at < p_now)
               AND x.recurrence ->> 'endedRule' IS DISTINCT FROM public.tasks__rule_signature(x.recurrence)
               AND public.tasks__rrule_parse(x.recurrence ->> 'rrule') IS NOT NULL))
    -- Coming-back repeats first (they're due at a moment), then the rest.
    ORDER BY (x.status <> 'done'), random()
    LIMIT greatest(coalesce(p_limit, 1000), 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN clock_timestamp() - v_started > p_budget;
    v_supported := public.tasks__rrule_parse(t.recurrence ->> 'rrule') IS NOT NULL;
    v_changed := false;
    v_missing := false;
    BEGIN
      v_zone := public.tasks__zone_of(t);
      v_today := public.tasks__local_date(p_now, v_zone);
      v_end := public.tasks__local_midnight(v_today + 1, v_zone) - interval '1 microsecond';
      v_from := t.scheduled_at;

      IF t.status = 'done' THEN
        v_pointer := public.tasks__try_ts(t.recurrence ->> 'nextOccurrence');
        IF v_pointer IS NULL THEN
          -- Completed before pointers were kept (or with one that doesn't
          -- read): the occurrence after it was done, stored so it's worked
          -- out once. Null when the rule has ended: it stays done, and stops
          -- being a candidate.
          IF v_supported THEN
            v_pointer := public.tasks__rrule_next(t.recurrence, t.updated_at, t.created_at);
          END IF;
          IF v_pointer IS NULL THEN
            UPDATE public.tasks SET recurrence = t.recurrence || '{"nextOccurrence": null}'::jsonb
              WHERE id = t.id;
            CONTINUE;
          END IF;
          v_missing := true;
        END IF;
        SELECT max(c.completed_at) INTO v_done_at FROM public.task_completions c
        WHERE c.task_id = t.id AND c.deleted_at IS NULL;
        v_done_at := coalesce(v_done_at, t.updated_at);
        IF v_today < public.tasks__local_date(v_pointer, v_zone)
           OR v_today <= public.tasks__local_date(v_done_at, v_zone) THEN
          IF v_missing THEN
            -- Not back yet: keep the pointer worked out, so it's asked once.
            UPDATE public.tasks
              SET recurrence = t.recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(v_pointer))
              WHERE id = t.id;
          END IF;
          CONTINUE;
        END IF;
        IF t.recurrence ->> 'mode' = 'after_completion' OR NOT v_supported THEN
          -- Back at the pointer; what comes after it is worked out when it's
          -- next completed (by the app, for a rule only the app reads).
          v_cur := v_pointer;
          v_next := NULL;
        ELSE
          v_cur := public.tasks__rrule_prev(t.recurrence, v_end, t.created_at);
          IF v_cur IS NULL OR v_cur < v_pointer THEN
            v_cur := v_pointer;
          END IF;
          v_next := public.tasks__rrule_next(t.recurrence, v_cur, t.created_at);
        END IF;
        UPDATE public.tasks
          SET status = 'todo',
              scheduled_at = v_cur,
              recurrence = t.recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
              committed_for = NULL,
              commit_order = NULL,
              updated_at = now()
          WHERE id = t.id
          RETURNING * INTO t;
        v_kind := 'reopen';
        v_changed := true;
      ELSE
        v_cur := public.tasks__rrule_prev(t.recurrence, v_end, t.created_at);
        IF v_cur IS NULL AND public.tasks__rrule_next(t.recurrence, p_now, t.created_at) IS NULL THEN
          -- Nothing within 20 years either side: mark it for this rule, so
          -- it isn't worked out again until the rule changes.
          UPDATE public.tasks
            SET recurrence = t.recurrence || jsonb_build_object('endedRule', public.tasks__rule_signature(t.recurrence))
            WHERE id = t.id;
          CONTINUE;
        END IF;
        IF t.scheduled_at IS NULL THEN
          v_cur := coalesce(v_cur, public.tasks__rrule_next(t.recurrence, p_now, t.created_at));
          CONTINUE WHEN v_cur IS NULL;
          v_kind := 'adopt';
        ELSE
          IF v_cur IS NULL OR v_cur <= t.scheduled_at
             OR public.tasks__local_date(t.scheduled_at, v_zone) >= public.tasks__local_date(v_cur, v_zone) THEN
            -- Nothing to move. A rule that ends (COUNT or UNTIL) with nothing
            -- after this occurrence never will have: mark it like one that
            -- never happens. Endless rules skip the extra look.
            IF (t.recurrence ->> 'rrule') ~* '(^|;)\s*(COUNT|UNTIL)\s*='
               AND public.tasks__rrule_next(t.recurrence, t.scheduled_at, t.created_at) IS NULL THEN
              UPDATE public.tasks
                SET recurrence = t.recurrence || jsonb_build_object('endedRule', public.tasks__rule_signature(t.recurrence))
                WHERE id = t.id;
            END IF;
            CONTINUE;
          END IF;
          v_kind := 'collapse';
        END IF;
        v_next := public.tasks__rrule_next(t.recurrence, v_cur, t.created_at);
        UPDATE public.tasks
          SET scheduled_at = v_cur,
              recurrence = t.recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
              updated_at = now()
          WHERE id = t.id
          RETURNING * INTO t;
        v_changed := true;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'tasks__roll_over: skipped task % (%)', t.id, SQLERRM;
    END;
    CONTINUE WHEN NOT v_changed;

    -- module_activity_log needs a person or a key; this is Moduo's own work.
    INSERT INTO public.module_activity
      (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
    VALUES (t.workspace_id, 'tasks', 'task', t.id, 'tasks.catch_up', 'agent', NULL, 'Moduo',
            jsonb_build_object('kind', v_kind, 'from', v_from, 'to', t.scheduled_at));
    RETURN NEXT t;
  END LOOP;
  RETURN;
END;
$function$;

-- ── 8. Editing a project's statuses ─────────────────────────────────────────

-- Who may change a set: a project's, whoever can edit the project; the
-- workspace default, the owner or an admin. The Inbox's are the default's.
CREATE OR REPLACE FUNCTION public.project_statuses__guard(p_workspace_id uuid, p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL THEN
    IF NOT (public.perm_is_owner(p_workspace_id, v_actor)
            OR public.perm_user_has(p_workspace_id, v_actor, 'ws.manage_roles')) THEN
      RAISE EXCEPTION 'Only the workspace owner or an admin can change the default statuses.' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;
  SELECT * INTO b FROM public.buckets x
  WHERE x.id = p_project_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.can_access('bucket', b.id, 'view', v_actor) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF b.is_system THEN
    RAISE EXCEPTION 'The Inbox uses the workspace''s default statuses.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_access('bucket', b.id, 'edit', v_actor) THEN
    RAISE EXCEPTION 'You don''t have edit access to this project.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- A set's live statuses in order: by category, then position.
CREATE OR REPLACE FUNCTION public.project_statuses__set_rows(p_workspace_id uuid, p_project_id uuid)
RETURNS SETOF public.project_statuses
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.project_statuses x
  WHERE x.deleted_at IS NULL
    AND CASE WHEN p_project_id IS NULL THEN x.project_id IS NULL AND x.workspace_id = p_workspace_id
             ELSE x.project_id = p_project_id END
  ORDER BY public.tasks__category_rank(x.category), x.position, x.created_at, x.id
$$;

CREATE OR REPLACE FUNCTION public.project_statuses__check_name(
  p_workspace_id uuid, p_project_id uuid, p_name text, p_except uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text := btrim(coalesce(p_name, ''));
BEGIN
  IF v = '' THEN
    RAISE EXCEPTION 'A status needs a name.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v) > 60 THEN
    RAISE EXCEPTION 'A status name is at most 60 characters.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.project_statuses__set_rows(p_workspace_id, p_project_id) x
             WHERE lower(btrim(x.name)) = lower(v) AND x.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'There''s already a status called "%".', v USING ERRCODE = '23505';
  END IF;
  RETURN v;
END;
$$;

-- Add a status at the end of its category. Answers with the whole set.
CREATE OR REPLACE FUNCTION public.project_statuses_op_create(
  p_workspace_id uuid, p_project_id uuid, p_category text, p_name text)
RETURNS SETOF public.project_statuses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat text := public.tasks__status_category_of(p_category);
  v_name text;
BEGIN
  PERFORM public.project_statuses__guard(p_workspace_id, p_project_id);
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'A status belongs to Backlog, To do, In progress, Done or Won''t do.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.project_statuses__seed(p_workspace_id, p_project_id);
  v_name := public.project_statuses__check_name(p_workspace_id, p_project_id, p_name, NULL);
  INSERT INTO public.project_statuses (workspace_id, project_id, category, name, position)
  SELECT p_workspace_id, p_project_id, v_cat, v_name, coalesce(max(x.position), 0) + 1
  FROM public.project_statuses__set_rows(p_workspace_id, p_project_id) x
  WHERE x.category = v_cat;
  RETURN QUERY SELECT * FROM public.project_statuses__set_rows(p_workspace_id, p_project_id);
END;
$$;

-- Rename ("name"), hide or show ("hidden") and reorder inside the category
-- ("after": the status to follow, null for the first place). A status keeps
-- its category. Answers with the whole set.
CREATE OR REPLACE FUNCTION public.project_statuses_op_update(
  p_workspace_id uuid, p_status_id uuid, p_patch jsonb)
RETURNS SETOF public.project_statuses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.project_statuses;
  v_after public.project_statuses;
  v_key text;
  v_order uuid[];
  v_name text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Expected an object of status fields.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('name', 'hidden', 'after') THEN
      RAISE EXCEPTION 'Statuses have no field "%".', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT * INTO s FROM public.project_statuses x
  WHERE x.id = p_status_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Status not found.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.project_statuses__guard(p_workspace_id, s.project_id);

  IF p_patch ? 'name' THEN
    v_name := public.project_statuses__check_name(p_workspace_id, s.project_id, p_patch ->> 'name', s.id);
    UPDATE public.project_statuses SET name = v_name WHERE id = s.id AND name IS DISTINCT FROM v_name;
  END IF;
  IF p_patch ? 'hidden' THEN
    IF jsonb_typeof(p_patch -> 'hidden') <> 'boolean' THEN
      RAISE EXCEPTION 'hidden is true or false.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.project_statuses SET hidden = (p_patch ->> 'hidden')::boolean
    WHERE id = s.id AND hidden IS DISTINCT FROM (p_patch ->> 'hidden')::boolean;
  END IF;
  IF p_patch ? 'after' THEN
    IF jsonb_typeof(p_patch -> 'after') <> 'null' THEN
      SELECT * INTO v_after FROM public.project_statuses x
      WHERE x.id = public.tasks__try_uuid(p_patch ->> 'after');
      IF NOT public.tasks__status_in_set(v_after, p_workspace_id, s.project_id)
         OR v_after.category <> s.category THEN
        RAISE EXCEPTION 'A status moves only among its category''s statuses.' USING ERRCODE = '22023';
      END IF;
    END IF;
    -- The category's order without it, then it right after "after" (or first).
    SELECT coalesce(array_agg(x.id ORDER BY x.position, x.created_at, x.id), '{}') INTO v_order
    FROM public.project_statuses__set_rows(p_workspace_id, s.project_id) x
    WHERE x.category = s.category AND x.id <> s.id;
    IF v_after.id IS NULL THEN
      v_order := s.id || v_order;
    ELSE
      v_order := v_order[1:array_position(v_order, v_after.id)] || s.id
                 || v_order[array_position(v_order, v_after.id) + 1:];
    END IF;
    UPDATE public.project_statuses x SET position = o.n
    FROM unnest(v_order) WITH ORDINALITY AS o(id, n)
    WHERE x.id = o.id AND x.position IS DISTINCT FROM o.n::integer;
  END IF;

  RETURN QUERY SELECT * FROM public.project_statuses__set_rows(p_workspace_id, s.project_id);
END;
$$;

-- Delete a status. Its tasks (deleted ones too, so a restore lands right) move
-- to the first other status of the same category; a category always keeps one
-- status. Answers {moved, moved_to, moved_to_name}.
CREATE OR REPLACE FUNCTION public.project_statuses_op_delete(p_workspace_id uuid, p_status_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.project_statuses;
  v_to public.project_statuses;
  v_moved integer;
  v_bypass text;
BEGIN
  SELECT * INTO s FROM public.project_statuses x
  WHERE x.id = p_status_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Status not found.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.project_statuses__guard(p_workspace_id, s.project_id);
  -- Serialize with other edits of this set.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'project_statuses:' || p_workspace_id::text || ':' || coalesce(s.project_id::text, ''), 0));

  SELECT * INTO v_to FROM public.project_statuses__set_rows(p_workspace_id, s.project_id) x
  WHERE x.category = s.category AND x.id <> s.id
  ORDER BY x.hidden, x.position, x.created_at, x.id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A category always keeps one status. Rename or hide this one instead.' USING ERRCODE = '23514';
  END IF;

  -- The move is the server's own consequence of the delete (the category
  -- doesn't change), so it runs as system work, like a parent's delete
  -- promoting subtasks.
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);
  UPDATE public.tasks t SET status_id = v_to.id, updated_at = now()
  WHERE t.status_id = s.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);

  UPDATE public.project_statuses SET deleted_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('moved', v_moved, 'moved_to', v_to.id, 'moved_to_name', v_to.name);
END;
$$;

-- ── 9. Grants ────────────────────────────────────────────────────────────────

-- The three pure word helpers stay callable: the status trigger (definer) and
-- app code may use them, and they read only their argument.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'project_statuses__seed(uuid, uuid)', 'project_statuses__seed_workspace()',
    'project_statuses__seed_project()', 'tasks__status_set(uuid)',
    'tasks__status_in_set(public.project_statuses, uuid, uuid)',
    'tasks__first_status(uuid, uuid, text)', 'tasks__resolve_status(uuid, uuid, text, uuid)',
    'tasks__status_sync()', 'tasks_queue__backlog_to_todo()',
    'project_statuses__guard(uuid, uuid)', 'project_statuses__set_rows(uuid, uuid)',
    'project_statuses__check_name(uuid, uuid, text, uuid)',
    'tasks__apply_status(public.tasks, text, jsonb, text)', 'tasks_queue_leave()',
    'tasks__roll_over(uuid, timestamptz, integer, interval)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'project_statuses_op_create(uuid, uuid, text, text)',
    'project_statuses_op_update(uuid, uuid, jsonb)',
    'project_statuses_op_delete(uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'tasks__status_category_of(text)', 'tasks__legacy_status(text)', 'tasks__category_rank(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;
