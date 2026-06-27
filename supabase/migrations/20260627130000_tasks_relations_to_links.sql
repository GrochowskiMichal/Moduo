-- Connective-tissue spine — block CT-7 (AC13): Tasks proves the link layer.
-- (specs/connective-tissue.md block 7; Assumption 8 — dual-path during transition.)
--
-- Tasks' blocker→blocked dependencies (`task_relations`) become readable/writable
-- as `entity_links` (relation_kind='blocks') WITHOUT regressing the shipped
-- blocked-by feature. The mechanism is a **mirror trigger**, not a cutover:
--
--   * The shipped read path is UNCHANGED — the app still computes "blocked" from
--     the `task_relations` bundle (src/features/tasks/helpers.ts). Zero read
--     regression, and no new RPC on a hot path (so no deploy-gap breakage).
--   * An AFTER INSERT/DELETE trigger mirrors every dependency into the spine as a
--     `blocks` edge (registering both task entities so the registry FK holds), so
--     a task's EntityHub and the link layer now carry its dependencies.
--   * A backfill seeds the blocks edges for every pre-existing dependency.
--
-- So both stores hold the edges; writes populate both (trigger); reads can use
-- either (blocked-by uses task_relations; the hub uses entity_links). When Tasks
-- fully adopts intent ops (post-alpha) the relation write becomes a first-class
-- op and this mirror retires.
--
-- Decisions: the mirror does **not** log a `module_activity` row — the
-- task_relations write is the canonical action and logs nothing today, so adding
-- activity here would change the shipped blocked-by trail (a regression in
-- behavior). The blocks edge is a derived shadow during transition; its
-- attributed activity arrives when the relation write becomes a real intent op.
-- The trigger is SECURITY DEFINER so it can write the op-only `entity_links`
-- (RLS = member SELECT; CT-1), exactly as the spine ops do.

CREATE OR REPLACE FUNCTION public.tasks_relations_mirror_to_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Real user on the live path; workspace owner as a system fallback (the
    -- entity_links.created_by is NOT NULL).
    v_actor := COALESCE(auth.uid(), (SELECT w.owner_id FROM public.workspaces w WHERE w.id = NEW.workspace_id));
    -- Register both endpoints (best-effort label from the task title) so the
    -- entity_links FK into the registry is satisfied; never revives a tombstone.
    PERFORM public.entities_op_ensure(NEW.workspace_id, 'task', NEW.blocker_task_id,
      (SELECT t.title FROM public.tasks t WHERE t.id = NEW.blocker_task_id), 'task');
    PERFORM public.entities_op_ensure(NEW.workspace_id, 'task', NEW.blocked_task_id,
      (SELECT t.title FROM public.tasks t WHERE t.id = NEW.blocked_task_id), 'task');
    -- Mirror the dependency as a blocks edge (blocker → blocked). Idempotent via
    -- the live partial-unique index, so a re-add after a remove is clean.
    INSERT INTO public.entity_links
      (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
    VALUES
      (NEW.workspace_id, 'task', NEW.blocker_task_id, 'task', NEW.blocked_task_id, 'blocks', 'manual', v_actor)
    ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
    DO NOTHING;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- Tombstone the mirrored blocks edge so the hub stops showing the dependency.
    UPDATE public.entity_links
      SET deleted_at = now()
      WHERE workspace_id = OLD.workspace_id
        AND relation_kind = 'blocks'
        AND deleted_at IS NULL
        AND pair_key = public.spine_pair_key('task', OLD.blocker_task_id, 'task', OLD.blocked_task_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tasks_relations_mirror_to_links() FROM PUBLIC;

-- AFTER so the mirror only runs on a successful insert (the BEFORE cycle-forbid
-- trigger from 20260612140000 still validates the edge first).
DROP TRIGGER IF EXISTS tasks_relations_mirror_to_links ON public.task_relations;
CREATE TRIGGER tasks_relations_mirror_to_links
  AFTER INSERT OR DELETE ON public.task_relations
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_relations_mirror_to_links();

-- ── Backfill: seed the blocks edges for every existing dependency ─────────────
-- Direct entity_links inserts (these don't re-fire the trigger). Idempotent, so
-- re-running the migration is safe. No activity (a backfill is not a user event).
DO $$
DECLARE
  r RECORD;
  v_actor uuid;
BEGIN
  FOR r IN SELECT * FROM public.task_relations LOOP
    v_actor := (SELECT w.owner_id FROM public.workspaces w WHERE w.id = r.workspace_id);
    PERFORM public.entities_op_ensure(r.workspace_id, 'task', r.blocker_task_id,
      (SELECT t.title FROM public.tasks t WHERE t.id = r.blocker_task_id), 'task');
    PERFORM public.entities_op_ensure(r.workspace_id, 'task', r.blocked_task_id,
      (SELECT t.title FROM public.tasks t WHERE t.id = r.blocked_task_id), 'task');
    INSERT INTO public.entity_links
      (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
    VALUES
      (r.workspace_id, 'task', r.blocker_task_id, 'task', r.blocked_task_id, 'blocks', 'manual', v_actor)
    ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
    DO NOTHING;
  END LOOP;
END;
$$;
