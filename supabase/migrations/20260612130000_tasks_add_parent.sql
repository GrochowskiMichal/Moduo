-- Subtasks, one level (improvement-plan Session 5; spec §11).
--
-- `parent_id` is a same-workspace self-reference on tasks. Exactly one level:
-- a task with a parent can never be a parent. The depth rule is enforced by a
-- trigger (a CHECK can't subquery); fuller server-side invariants move into
-- intent-op RPCs in Session 8 — this is the cheap corruption guard until then.
--
-- Deleting a parent promotes its children to top-level: the app layer clears
-- their parent_id alongside the soft delete; ON DELETE SET NULL covers any
-- hard delete. The trigger deliberately does NOT require the parent to be
-- un-deleted — a child briefly pointing at a soft-deleted parent must keep
-- accepting writes (clients treat an unresolvable parent as top-level).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.tasks (id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS tasks_parent_id_idx
  ON public.tasks (parent_id)
  WHERE parent_id IS NOT NULL;

-- One level, both directions: the parent must be top-level, and a task that has
-- live subtasks can't itself become one. SECURITY INVOKER — the rows checked
-- are same-workspace, so the caller's own RLS visibility is exactly right.
CREATE OR REPLACE FUNCTION public.tasks_enforce_one_level_subtasks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks p
    WHERE p.id = NEW.parent_id
      AND p.workspace_id = NEW.workspace_id
      AND p.parent_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Subtasks are one level: the parent must be a top-level task in the same workspace';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tasks c
    WHERE c.parent_id = NEW.id
      AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Subtasks are one level: a task with subtasks cannot become a subtask';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_one_level_subtasks ON public.tasks;
CREATE TRIGGER tasks_one_level_subtasks
  BEFORE INSERT OR UPDATE OF parent_id ON public.tasks
  FOR EACH ROW
  WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION public.tasks_enforce_one_level_subtasks();
