-- Blocked-by dependencies (improvement-plan Session 6; spec §5c).
--
-- `task_relations` is a directed blocker → blocked edge between two
-- same-workspace tasks. *Blocked* is computed at read time (the drift
-- pattern) — never stored. Cycles of ANY length are forbidden by a trigger
-- (the frontier walk relies on the graph being a DAG); fuller server-side
-- invariants move into intent-op RPCs in Session 8 — this is the corruption
-- guard until then.
--
-- Soft-deleted tasks keep their edges (an edge whose blocker doesn't resolve
-- among live tasks is inert client-side); ON DELETE CASCADE cleans up on any
-- hard delete.

CREATE TABLE IF NOT EXISTS public.task_relations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  blocker_task_id uuid NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  blocked_task_id uuid NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, blocker_task_id, blocked_task_id),
  CONSTRAINT task_relations_not_self CHECK (blocker_task_id <> blocked_task_id)
);

CREATE INDEX IF NOT EXISTS task_relations_workspace_id_idx ON public.task_relations (workspace_id);
CREATE INDEX IF NOT EXISTS task_relations_blocker_idx ON public.task_relations (blocker_task_id);
CREATE INDEX IF NOT EXISTS task_relations_blocked_idx ON public.task_relations (blocked_task_id);

-- Forbid cycles of any length: inserting blocker → blocked closes a cycle iff
-- `blocked` already reaches `blocker` through existing edges. Walk blocked's
-- downstream closure with a recursive CTE. Both tasks must be same-workspace.
-- SECURITY INVOKER — the rows walked are same-workspace, so the caller's own
-- RLS visibility is exactly right.
CREATE OR REPLACE FUNCTION public.task_relations_forbid_cycles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks b, public.tasks d
    WHERE b.id = NEW.blocker_task_id
      AND d.id = NEW.blocked_task_id
      AND b.workspace_id = NEW.workspace_id
      AND d.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Dependencies link two tasks in the same workspace';
  END IF;

  IF EXISTS (
    WITH RECURSIVE downstream AS (
      SELECT r.blocked_task_id
      FROM public.task_relations r
      WHERE r.blocker_task_id = NEW.blocked_task_id
        AND r.workspace_id = NEW.workspace_id
      UNION
      SELECT r.blocked_task_id
      FROM public.task_relations r
      JOIN downstream ds ON r.blocker_task_id = ds.blocked_task_id
      WHERE r.workspace_id = NEW.workspace_id
    )
    SELECT 1 FROM downstream WHERE blocked_task_id = NEW.blocker_task_id
  ) THEN
    RAISE EXCEPTION 'Dependencies cannot form a cycle';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_relations_forbid_cycles ON public.task_relations;
CREATE TRIGGER task_relations_forbid_cycles
  BEFORE INSERT OR UPDATE ON public.task_relations
  FOR EACH ROW
  EXECUTE FUNCTION public.task_relations_forbid_cycles();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.task_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_relations_workspace_access ON public.task_relations;
CREATE POLICY task_relations_workspace_access ON public.task_relations
  FOR ALL
  USING (public.tasks_module_can_access_workspace(workspace_id))
  WITH CHECK (public.tasks_module_can_access_workspace(workspace_id));
