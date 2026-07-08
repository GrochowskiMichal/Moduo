-- Tasks module v1 — cloud schema (buckets / tasks / tags / tag_links).
--
-- The canonical, spec'd ADHD bucket/commit/execute Tasks model
-- (docs/moduo-tasks-feature-spec.md §11). This defines the Supabase side of the
-- model; the active runtime path is the local-first redb store on desktop
-- (src-tauri/src/store_redb). Live cloud-sync wiring (push/pull + the
-- camelCase[redb] <-> snake_case[postgres] field mapping) is intentionally
-- DEFERRED to a later session — this migration only establishes the schema so
-- that wiring has a target.
--
-- Supersedes the legacy Linear-style tasks_projects / tasks_states / tasks_items
-- tables, which will be dropped when their UI is removed. Inbox is seeded by the
-- app layer (tasks_module_seed_inbox / lazy on first read), not by a DB trigger.

-- ── RLS helper ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the policy's membership lookup bypasses RLS on
-- workspaces / workspace_members and can't recurse (same pattern as
-- profile_plan_tier_text in the prior migration).
CREATE OR REPLACE FUNCTION public.tasks_module_can_access_workspace(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id
      AND w.owner_id = auth.uid()
      AND w.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.tasks_module_can_access_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tasks_module_can_access_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasks_module_can_access_workspace(uuid) TO service_role;

-- ── buckets ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buckets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id     uuid DEFAULT auth.uid(),
  name         text NOT NULL,
  is_system    boolean NOT NULL DEFAULT false,
  position     text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS buckets_workspace_id_idx ON public.buckets (workspace_id);
-- At most one live system (Inbox) bucket per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS buckets_one_system_per_workspace_idx
  ON public.buckets (workspace_id)
  WHERE is_system AND deleted_at IS NULL;

-- ── tasks ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id         uuid DEFAULT auth.uid(),
  bucket_id        uuid NOT NULL REFERENCES public.buckets (id) ON DELETE RESTRICT,
  title            text NOT NULL DEFAULT '',
  description      text NOT NULL DEFAULT '',
  due_date         timestamptz,
  scheduled_at     timestamptz,
  duration_minutes integer,
  recurrence       jsonb,
  energy_level     text CHECK (energy_level IN ('low', 'medium', 'high')),
  status           text NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('todo', 'in_progress', 'done', 'archived')),
  committed_for    date,
  commit_order     integer,
  reschedule_count integer NOT NULL DEFAULT 0,
  position         text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS tasks_workspace_id_idx ON public.tasks (workspace_id);
CREATE INDEX IF NOT EXISTS tasks_bucket_id_idx ON public.tasks (bucket_id);
CREATE INDEX IF NOT EXISTS tasks_workspace_committed_idx
  ON public.tasks (workspace_id, committed_for);
CREATE INDEX IF NOT EXISTS tasks_workspace_scheduled_idx
  ON public.tasks (workspace_id, scheduled_at);

-- ── tags ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id     uuid DEFAULT auth.uid(),
  name         text NOT NULL,
  color        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS tags_workspace_id_idx ON public.tags (workspace_id);

-- ── tag_links (polymorphic association) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tag_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES public.tags (id) ON DELETE CASCADE,
  entity_type  text NOT NULL,            -- "task" | "note" | "email" | ...
  entity_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tag_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS tag_links_workspace_id_idx ON public.tag_links (workspace_id);
CREATE INDEX IF NOT EXISTS tag_links_entity_idx ON public.tag_links (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS tag_links_tag_id_idx ON public.tag_links (tag_id);

-- ── computed `drifted` view ──────────────────────────────────────────────────
-- `drifted` cannot be a stored generated column (now() is not immutable), so it
-- is exposed as a view. security_invoker keeps the base-table RLS in force.
CREATE OR REPLACE VIEW public.tasks_with_drift
WITH (security_invoker = true)
AS
SELECT
  t.*,
  (
    t.scheduled_at IS NOT NULL
    AND t.scheduled_at < now()
    AND t.status NOT IN ('done', 'archived')
  ) AS drifted
FROM public.tasks t;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.buckets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buckets_workspace_access ON public.buckets;
CREATE POLICY buckets_workspace_access ON public.buckets
  FOR ALL
  USING (public.tasks_module_can_access_workspace(workspace_id))
  WITH CHECK (public.tasks_module_can_access_workspace(workspace_id));

DROP POLICY IF EXISTS tasks_workspace_access ON public.tasks;
CREATE POLICY tasks_workspace_access ON public.tasks
  FOR ALL
  USING (public.tasks_module_can_access_workspace(workspace_id))
  WITH CHECK (public.tasks_module_can_access_workspace(workspace_id));

DROP POLICY IF EXISTS tags_workspace_access ON public.tags;
CREATE POLICY tags_workspace_access ON public.tags
  FOR ALL
  USING (public.tasks_module_can_access_workspace(workspace_id))
  WITH CHECK (public.tasks_module_can_access_workspace(workspace_id));

DROP POLICY IF EXISTS tag_links_workspace_access ON public.tag_links;
CREATE POLICY tag_links_workspace_access ON public.tag_links
  FOR ALL
  USING (public.tasks_module_can_access_workspace(workspace_id))
  WITH CHECK (public.tasks_module_can_access_workspace(workspace_id));
