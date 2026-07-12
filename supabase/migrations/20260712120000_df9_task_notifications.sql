-- DF-9 — Notification generation v1 (spine lane). Two NEW quiet notification
-- types, generated server-side on the Tasks write path. The bell UI + reducer +
-- read RPC (notifications_list / spine_activity_targets_me) already exist (CT-5,
-- EM-6); this migration only GENERATES the activity rows that become them.
--
-- Why a TRIGGER, not an op: Tasks are written CLIENT-DIRECT (runtime.tasks.upsertTask
-- → supabaseClient.from("tasks").upsert(...)); there is no tasks_op_create/assign
-- SECURITY DEFINER fn to hook (docs/gotchas.md §Tasks data). A row-level trigger on
-- `tasks` is the one server-side seam that fires no matter HOW the task was mutated
-- — client-direct upsert, tasks_op_set_status, the MCP connector, or a future
-- assignment UI. Same posture as the CT-7 tasks_relations_mirror_to_links trigger:
-- SECURITY DEFINER so it can PERFORM the op-only module_activity_log (revoked from
-- authenticated), while auth.uid() still resolves to the real caller for attribution.
--
-- Both types slot into the EXISTING spine_activity_targets_me branches — NO predicate
-- change, so @mention / snooze-due / follow-up-due behaviour is untouched:
--   • assigned-to-you   → payload.mentioned_user_ids = [new owner]. The mention branch
--     already requires actor ≠ me, so self-created / self-owned tasks never notify —
--     only a task owned BY a member and set by SOMEONE ELSE pings that member.
--     ("Assignee" == owner_id at alpha; the live tasks model has only owner_id, no
--     dedicated assignee column — this hook fires the moment any assignment path sets
--     owner to another member. See docs/decisions.md DF-9.)
--   • blocked-task-unblocked → payload.notify_user_ids = [blocked task owner]. Uses the
--     actor-agnostic branch on purpose: a solo user (the alpha's dominant case) closing
--     the LAST open blocker of their own parked task still gets the quiet "you can start
--     this now" nudge; in multiplayer it correctly reaches the owner when a collaborator
--     clears the blocker.
--
-- Quiet-core: only the LAST open blocker CLOSING (status → done/archived, mirroring the
-- client isOpen set in tasks/helpers.ts) fires unblocked — deleting a blocker link or
-- soft-deleting the blocker does NOT (a deliberate gesture, not a completion event).
--
-- Depends on: 20260606120000 (tasks), 20260612140000 (task_relations),
-- 20260612150000 (module_activity_log), 20260626130000 (spine_activity_targets_me).

CREATE OR REPLACE FUNCTION public.tasks_notify_spine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked RECORD;
BEGIN
  -- Never notify about a soft-deleted row (a delete is an UPDATE that stamps
  -- deleted_at; it must not read as an assignment or an unblock).
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ── assigned-to-you ──────────────────────────────────────────────────────────
  -- A task whose owner is a member OTHER than the actor performing the write:
  -- a create-on-someone's-behalf (INSERT) or a re-assignment (UPDATE where owner
  -- changed). mentioned_user_ids + the actor≠me predicate keep self-owned tasks
  -- silent. Wrapped so a notification failure can never fail the task write.
  IF (TG_OP = 'INSERT'
        AND NEW.owner_id IS NOT NULL
        AND NEW.owner_id IS DISTINCT FROM auth.uid())
     OR (TG_OP = 'UPDATE'
        AND NEW.owner_id IS NOT NULL
        AND NEW.owner_id IS DISTINCT FROM OLD.owner_id
        AND NEW.owner_id IS DISTINCT FROM auth.uid()) THEN
    BEGIN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.assigned',
        jsonb_build_object(
          'mentioned_user_ids', jsonb_build_array(NEW.owner_id::text),
          'title', NEW.title));
    EXCEPTION WHEN OTHERS THEN
      -- generation is a side-effect; it must never break completing/editing a task.
      -- Surface a WARNING (does not abort the txn) so a silent failure is debuggable.
      RAISE WARNING 'tasks_notify_spine: assigned notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── blocked-task-unblocked ───────────────────────────────────────────────────
  -- This task just CLOSED (open → done/archived). For every task it blocked, if
  -- this was its LAST open blocker, notify that task's owner. "Open" mirrors the
  -- client isOpen set (status NOT IN done/archived). Only fires for a genuine
  -- open→closed transition, so re-saving an already-done task can't re-notify.
  IF TG_OP = 'UPDATE'
     AND OLD.status NOT IN ('done', 'archived')
     AND NEW.status IN ('done', 'archived') THEN
    BEGIN
      FOR v_blocked IN
        SELECT bt.id AS task_id, bt.owner_id AS owner_id, bt.title AS title
        FROM public.task_relations r
        JOIN public.tasks bt ON bt.id = r.blocked_task_id
        WHERE r.blocker_task_id = NEW.id
          AND r.workspace_id = NEW.workspace_id
          AND bt.deleted_at IS NULL
          AND bt.owner_id IS NOT NULL
          -- Only nudge if the freed task is still actionable (not already closed).
          AND bt.status NOT IN ('done', 'archived')
          -- …and no OTHER open blocker remains on it.
          AND NOT EXISTS (
            SELECT 1
            FROM public.task_relations r2
            JOIN public.tasks ob ON ob.id = r2.blocker_task_id
            WHERE r2.blocked_task_id = r.blocked_task_id
              AND r2.blocker_task_id <> NEW.id
              AND ob.deleted_at IS NULL
              AND ob.status NOT IN ('done', 'archived')
          )
      LOOP
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'tasks', 'task', v_blocked.task_id, 'tasks.unblocked',
          jsonb_build_object(
            'notify_user_ids', jsonb_build_array(v_blocked.owner_id::text),
            'title', v_blocked.title,
            'blocker_title', NEW.title));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- as above: never let the notification side-effect fail the task write.
      RAISE WARNING 'tasks_notify_spine: unblocked notification failed for blocker %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$$;

REVOKE ALL ON FUNCTION public.tasks_notify_spine() FROM PUBLIC;

-- AFTER INSERT OR UPDATE: the row (and, for unblock, this task's now-committed
-- 'done' status) is visible to the trigger's queries.
DROP TRIGGER IF EXISTS tasks_notify_spine ON public.tasks;
CREATE TRIGGER tasks_notify_spine
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks_notify_spine();
