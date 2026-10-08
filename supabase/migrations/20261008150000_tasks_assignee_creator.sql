-- TV-D1 · Safer saves + assignee data (specs/tasks-v2.md block 3).
--
-- A task now has an assignee of its own, and owner_id goes back to meaning the
-- creator:
--   * tasks.assignee_id (NULL = Unassigned), backfilled from owner_id, which
--     held the assignee until now.
--   * owner_id is whoever inserts the task and never changes afterwards.
--     Reassigned tasks get their creator back where the DF-9 activity log
--     names it; the rest keep owner_id as it is and are marked
--     creator_unknown, so the app doesn't claim a creator it can't know.
--   * App builds from before this change still write the assignee into
--     owner_id. A trigger lands those writes on assignee_id and keeps the
--     creator. They never send assignee_id, so its default is a placeholder
--     (the nil uuid) that tells "not sent" apart from an explicit NULL; the
--     insert trigger always replaces it.
--   * tasks_op_assign assigns or unassigns, after checking that the person is
--     a member who can work on tasks.
--   * Everything that meant "the assignee" by owner_id now reads assignee_id:
--     the assignee check in perm_enforce_write (only when the assignee is set,
--     so a teammate who later became a viewer or left no longer freezes the
--     task), the assignee's access grant (share_task_assign), the assigned and
--     unblocked notifications, comment notifications, and unassigning on
--     member removal and account deletion (PRIV-2a, live since 2026-10-08).
--   * New: completing a task someone else created notifies its creator
--     (tasks.completed).
--
-- Expand only: owner_id keeps its column, and the shim stays until TV-D7.
-- The functions redefined below are production's bodies as of 2026-10-08,
-- read from the catalog, with only the TV-D1 changes. account_erase_workspace_data
-- and share_member_removed come from PRIV-2a (20261008013000, PR #251);
-- comments_op_add from key_writes_act_as_creator (20261008020039, PR #247).

-- ── 1. Columns ───────────────────────────────────────────────────────────────

-- The backfill reads owner_id as the assignee, which is only true before this
-- migration: a second run would undo every Unassigned. Refuse instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'assignee_id') THEN
    RAISE EXCEPTION 'tasks.assignee_id exists already: 20261008150000_tasks_assignee_creator has run, and it must not run twice.';
  END IF;
  -- §9-§10 redefine PRIV-2a's functions; without them a fresh CREATE would
  -- expose account_erase_workspace_data through Supabase's default grants.
  IF to_regprocedure('public.account_erase_workspace_data(uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION 'PRIV-2a (20261008013000_account_erase_workspace_data) must be applied first.';
  END IF;
  -- §8 is PR #247's comments_op_add, which writes comments.author_kind; on a
  -- database without that column every comment would fail.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'author_kind') THEN
    RAISE EXCEPTION 'PR #247 (comments.author_kind, key_writes_act_as_creator) must be applied first.';
  END IF;
END;
$$;

ALTER TABLE public.tasks
  ADD COLUMN assignee_id uuid,
  ADD COLUMN creator_unknown boolean NOT NULL DEFAULT false;

-- The backfill below must not fire the assignment side effects: no grants, no
-- notifications. Both triggers are recreated further down.
DROP TRIGGER IF EXISTS share_task_assign ON public.tasks;
DROP TRIGGER IF EXISTS tasks_notify_spine ON public.tasks;

-- ── 2. Backfill ──────────────────────────────────────────────────────────────

-- owner_id held the assignee until now. One whose account is gone can't be
-- an assignee (the foreign key below): that task starts Unassigned.
UPDATE public.tasks t SET assignee_id = t.owner_id
WHERE t.owner_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.owner_id);

-- The creator, where the activity log names it. DF-9 logs tasks.assigned in
-- the insert itself when a task is created for someone else, so that row's
-- actor is the creator. It lands within seconds of the task's created_at (the
-- client sends created_at); a reassignment comes later (production on
-- 2026-10-08: insert rows 0.3–1.5 s after, the nearest reassignment 10 min).
WITH created AS (
  SELECT DISTINCT ON (a.entity_id) a.entity_id AS task_id, a.actor_id
  FROM public.module_activity a
  JOIN public.tasks t ON t.id = a.entity_id
  WHERE a.module = 'tasks' AND a.entity_type = 'task' AND a.op = 'tasks.assigned'
    AND a.actor_type = 'user' AND a.actor_id IS NOT NULL
    AND a.created_at BETWEEN t.created_at - interval '1 minute' AND t.created_at + interval '1 minute'
  ORDER BY a.entity_id, a.created_at
)
UPDATE public.tasks t SET owner_id = c.actor_id
FROM created c
WHERE c.task_id = t.id AND t.owner_id IS DISTINCT FROM c.actor_id;

-- Reassigned later with no insert row to name the creator: owner_id is the
-- assignee at the time, not necessarily the creator, so the app won't show it.
UPDATE public.tasks t SET creator_unknown = true
WHERE t.owner_id IS NULL
   OR (EXISTS (SELECT 1 FROM public.module_activity a
               WHERE a.module = 'tasks' AND a.entity_type = 'task' AND a.op = 'tasks.assigned'
                 AND a.entity_id = t.id
                 AND a.created_at NOT BETWEEN t.created_at - interval '1 minute'
                                          AND t.created_at + interval '1 minute')
       AND NOT EXISTS (SELECT 1 FROM public.module_activity a
                       WHERE a.module = 'tasks' AND a.entity_type = 'task' AND a.op = 'tasks.assigned'
                         AND a.entity_id = t.id
                         AND a.actor_type = 'user' AND a.actor_id IS NOT NULL
                         AND a.created_at BETWEEN t.created_at - interval '1 minute'
                                              AND t.created_at + interval '1 minute'));

-- ── 3. Constraints ───────────────────────────────────────────────────────────

-- Deleting an account unassigns its tasks everywhere.
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_assignee_id_fkey
  FOREIGN KEY (assignee_id) REFERENCES public.profiles (id) ON DELETE SET NULL;
-- The placeholder default is replaced on insert; it can never be stored.
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_assignee_not_placeholder
  CHECK (assignee_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000000'::uuid);
ALTER TABLE public.tasks
  ALTER COLUMN assignee_id SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
CREATE INDEX IF NOT EXISTS tasks_assignee_id_idx
  ON public.tasks (assignee_id) WHERE assignee_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.owner_id IS
  'The creator: whoever inserts the task; never changes (trigger assignee_and_creator_*). Until TV-D1 it meant the assignee, and app builds from before then still write it that way: the trigger moves those writes to assignee_id.';
COMMENT ON COLUMN public.tasks.assignee_id IS
  'Who the task is assigned to; NULL = Unassigned. Change it with tasks_op_assign. The default (the nil uuid) only tells the insert trigger that a pre-TV-D1 build left the column out; it is never stored.';
COMMENT ON COLUMN public.tasks.creator_unknown IS
  'The creator was overwritten by a reassignment before TV-D1 and could not be recovered, so the app hides "Created by". Set by the server only.';

-- ── 4. The creator is fixed; old builds' owner_id writes become assignments ──
-- Runs before perm_enforce_write (triggers of one event fire in name order:
-- "assignee_…" < "perm_…"), so the permission check sees the mapped assignee.

CREATE OR REPLACE FUNCTION public.tasks_assignee_and_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The placeholder default means the writer didn't send assignee_id: a build
    -- from before TV-D1, for which owner_id was the assignee.
    IF NEW.assignee_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
      NEW.assignee_id := NEW.owner_id;
    END IF;
    -- An upsert of a row that already exists goes on as an UPDATE (ON CONFLICT)
    -- that reads owner_id back from EXCLUDED: leave it as sent, and let the
    -- UPDATE pass below handle it.
    IF EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = NEW.id) THEN
      RETURN NEW;
    END IF;
    -- The creator is whoever creates the task (an API key acts as its creator).
    v_actor := public.perm_actor_id();
    IF v_actor IS NOT NULL THEN
      NEW.owner_id := v_actor;
    END IF;
    NEW.creator_unknown := NEW.owner_id IS NULL;
    RETURN NEW;
  END IF;

  -- UPDATE. A maintenance script can opt out for its own transaction.
  IF current_setting('tasks.creator_write', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    -- A build from before TV-D1 reassigning the task. A write that also sets
    -- assignee_id itself is a current client, and its value wins.
    IF NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
      NEW.assignee_id := NEW.owner_id;
    END IF;
    NEW.owner_id := OLD.owner_id;
  END IF;
  NEW.creator_unknown := OLD.creator_unknown;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assignee_and_creator_insert ON public.tasks;
CREATE TRIGGER assignee_and_creator_insert
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_assignee_and_creator();
DROP TRIGGER IF EXISTS assignee_and_creator_update ON public.tasks;
CREATE TRIGGER assignee_and_creator_update
  BEFORE UPDATE OF owner_id, creator_unknown ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_assignee_and_creator();

-- ── 5. perm_enforce_write: the assignee check reads assignee_id ──────────────

CREATE OR REPLACE FUNCTION public.perm_enforce_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_module text := TG_ARGV[0];
  v_fixed  text := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1] ELSE NULL END;
  v_ws     uuid;
  v_actor  uuid;
  v_action text;
  v_verb   text;
  v_need   text;
  v_item   text;   -- 'edit' requirement for items inside a container
  v_assignee uuid; -- tasks: an assignee being set, to check
BEGIN
  v_ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_actor := public.perm_actor_id();

  -- Member-removal archive writes notes the actor can't open. The removal
  -- function sets this for the rest of its transaction only.
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- System work (service role without a key, cron, migrations).
  IF v_actor IS NULL OR v_ws IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF v_fixed IS NOT NULL THEN
    v_action := v_fixed;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
  ELSE
    v_action := 'edit';
  END IF;

  -- Mirrored external calendar events are the owner's own sync, not edits.
  IF TG_TABLE_NAME = 'calendar_events' THEN
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_account_id ELSE NEW.source_account_id END) IS NOT NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- The first channel of a workspace is chat's own bootstrap (#general).
  IF TG_TABLE_NAME = 'chat_channels' THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_channels c
                   WHERE c.workspace_id = v_ws AND c.id IS DISTINCT FROM coalesce(NEW.id, OLD.id)) THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- Soft delete / restore count as delete. Only tables guarded without a
  -- fixed action, all of which have deleted_at (chat_channels is INSERT-only).
  IF TG_OP = 'UPDATE' AND v_fixed IS NULL AND TG_TABLE_NAME <> 'chat_channels' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := 'delete';
    ELSIF TG_TABLE_NAME = 'chat_messages' THEN
      -- Reactions / thread counters live on the message row; only a body
      -- change is an edit.
      IF NEW.body IS NOT DISTINCT FROM OLD.body THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF NOT public.perm_is_owner(v_ws, v_actor)
     AND NOT public.perm_user_has(v_ws, v_actor, v_module || '.' || v_action) THEN
    v_verb := CASE v_action WHEN 'create' THEN 'add' ELSE v_action END;
    RAISE EXCEPTION 'Your role can''t % % in this workspace.', v_verb,
      CASE v_module WHEN 'tasks' THEN 'tasks' WHEN 'notes' THEN 'notes' WHEN 'calendar' THEN 'events'
                    WHEN 'contacts' THEN 'contacts' WHEN 'chat' THEN 'messages' ELSE v_module END
      USING ERRCODE = '42501';
  END IF;

  v_need := CASE WHEN v_action = 'delete' THEN 'full' ELSE 'edit' END;
  v_item := 'edit';

  IF TG_TABLE_NAME = 'notes' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.publish_token IS NULL AND NEW.publish_token IS NOT NULL
         AND NOT public.perm_user_has(v_ws, v_actor, 'ws.publish') THEN
        RAISE EXCEPTION 'Your role can''t publish to the web in this workspace.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.parent_id IS NOT NULL AND NOT public.can_access('note', NEW.parent_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.can_access('note', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'note_updates' THEN
    IF NOT public.can_access('note', coalesce(NEW.note_id, OLD.note_id), 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'buckets' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('bucket', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    ELSE
      -- Tasks are items inside a bucket: Edit covers deleting them.
      IF NOT public.can_access('task', OLD.id, v_item, v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
      END IF;
      -- Moving a task into another bucket needs Edit there too.
      IF TG_OP = 'UPDATE' AND NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
         AND NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    END IF;
    -- Only someone who can work on tasks can be assigned one (TV-D1: the
    -- assignee is assignee_id, no longer owner_id). Checked when the assignee
    -- is set, not on every edit, so a teammate who later became a viewer or
    -- left doesn't freeze the task. An upsert of a row that already exists
    -- arrives here as an INSERT first; its UPDATE pass does the check.
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = NEW.id) THEN
        v_assignee := NEW.assignee_id;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
        v_assignee := NEW.assignee_id;
      END IF;
    END IF;
    IF v_assignee IS NOT NULL AND NOT public.perm_user_has(v_ws, v_assignee, 'tasks.edit') THEN
      RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'contacts' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('contact', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this contact.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'companies' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('company', OLD.id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this company.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'calendar_events' THEN
    -- Events are items inside a calendar: Edit covers deleting them.
    IF TG_OP <> 'INSERT' THEN
      IF OLD.owner_id IS DISTINCT FROM v_actor
         AND (OLD.calendar_ref IS NULL OR NOT public.can_access('calendar', OLD.calendar_ref, v_item, v_actor)) THEN
        RAISE EXCEPTION 'You don''t have access to this event.' USING ERRCODE = '42501';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'chat_messages' THEN
    IF v_action = 'delete' AND TG_OP <> 'INSERT' THEN
      IF OLD.author_id IS DISTINCT FROM v_actor
         AND NOT public.chat_has_cap(v_ws, v_actor, 'delete_others') THEN
        RAISE EXCEPTION 'Your role can''t delete other people''s messages.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$function$
;

-- ── 6. The assignee gets access to the task (was keyed on owner_id) ──────────

CREATE OR REPLACE FUNCTION public.share_task_assign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN RETURN NEW; END IF;
  END IF;
  IF public.can_access('bucket', NEW.bucket_id, 'edit', NEW.assignee_id) THEN RETURN NEW; END IF;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (NEW.workspace_id, 'task', NEW.id, 'member', NEW.assignee_id, 'edit', public.perm_actor_id())
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET level = 'edit';
  RETURN NEW;
END;
$$;

-- owner_id stays in the column list: an old build's reassignment names only
-- owner_id, and column triggers look at the statement, not at what a BEFORE
-- trigger changed.
CREATE TRIGGER share_task_assign
  AFTER INSERT OR UPDATE OF assignee_id, owner_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.share_task_assign();

-- ── 7. Task notifications (DF-9), keyed on the assignee ──────────────────────

CREATE OR REPLACE FUNCTION public.tasks_notify_spine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked RECORD;
  v_actor uuid := public.perm_actor_id();
  v_key uuid := public.module_api_key_id();
  v_assigned boolean := false;
  v_from uuid;
BEGIN
  -- Never notify about a soft-deleted row (a delete is an UPDATE that stamps
  -- deleted_at; it must not read as an assignment or an unblock).
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- System writes (no signed-in user, no API key) notify nobody.
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── assigned-to-you ──────────────────────────────────────────────────────
  -- Every way a task gets an assignee lands here (tasks_op_assign, a create,
  -- an old build's owner_id write), so this is the one place it is logged:
  -- a create for someone else, and every later change, attributed to the
  -- actor ({from, to}). Only someone other than the actor is notified
  -- (mentioned_user_ids): unassigning and taking a task stay out of bells but
  -- in the trail. The actor is compared through perm_actor_id(), so an API
  -- key assigning its own creator doesn't notify. Member removal unassigns
  -- under share.bypass and logs nothing. Wrapped so a notification failure
  -- can never fail the task write.
  IF TG_OP = 'INSERT' THEN
    v_assigned := NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor;
  ELSE
    v_from := OLD.assignee_id;
    v_assigned := NEW.assignee_id IS DISTINCT FROM v_from
                  AND current_setting('share.bypass', true) IS DISTINCT FROM '1';
  END IF;
  IF v_assigned THEN
    BEGIN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.assigned',
        jsonb_strip_nulls(jsonb_build_object(
          'mentioned_user_ids',
            CASE WHEN NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor
                 THEN jsonb_build_array(NEW.assignee_id::text) END,
          'title', NEW.title))
        -- from/to stay in when null (null = Unassigned). "self" is a person
        -- taking the task; an API key assigning its creator reads as an
        -- assignment.
        || jsonb_build_object(
             'from', v_from,
             'to', NEW.assignee_id,
             'self', v_key IS NULL AND NEW.assignee_id IS NOT DISTINCT FROM v_actor));
    EXCEPTION WHEN OTHERS THEN
      -- generation is a side-effect; it must never break completing/editing a task.
      -- Surface a WARNING (does not abort the txn) so a silent failure is debuggable.
      RAISE WARNING 'tasks_notify_spine: assigned notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NULL;
  END IF;

  -- ── completed-by-someone-else ────────────────────────────────────────────
  -- The task just became done, and the person who did it isn't its creator:
  -- tell the creator. Only on the transition, so re-saving a done task can't
  -- notify again; never when the creator is unknown or can no longer see the
  -- task (the notification carries its title).
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status = 'done'
     AND NEW.owner_id IS NOT NULL AND NOT NEW.creator_unknown
     AND NEW.owner_id IS DISTINCT FROM v_actor
     AND public.can_access('task', NEW.id, 'view', NEW.owner_id) THEN
    BEGIN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.completed',
        jsonb_build_object(
          'mentioned_user_ids', jsonb_build_array(NEW.owner_id::text),
          'title', NEW.title));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks_notify_spine: completed notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── blocked-task-unblocked ───────────────────────────────────────────────
  -- This task just CLOSED (open → done/archived). For every task it blocked, if
  -- this was its LAST open blocker, notify that task's assignee, else its
  -- creator. "Open" mirrors the client isOpen set (status NOT IN done/archived).
  -- Only fires for a genuine open→closed transition, so re-saving an
  -- already-done task can't re-notify.
  IF OLD.status NOT IN ('done', 'archived')
     AND NEW.status IN ('done', 'archived') THEN
    BEGIN
      FOR v_blocked IN
        SELECT bt.id AS task_id,
               coalesce(bt.assignee_id,
                        CASE WHEN bt.creator_unknown
                               OR NOT public.can_access('task', bt.id, 'view', bt.owner_id)
                             THEN NULL ELSE bt.owner_id END) AS target_id,
               bt.title AS title
        FROM public.task_relations r
        JOIN public.tasks bt ON bt.id = r.blocked_task_id
        WHERE r.blocker_task_id = NEW.id
          AND r.workspace_id = NEW.workspace_id
          AND bt.deleted_at IS NULL
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
        CONTINUE WHEN v_blocked.target_id IS NULL;
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'tasks', 'task', v_blocked.task_id, 'tasks.unblocked',
          jsonb_build_object(
            'notify_user_ids', jsonb_build_array(v_blocked.target_id::text),
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

CREATE TRIGGER tasks_notify_spine
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_notify_spine();

-- ── 8. Comment notifications: the assignee, the creator, earlier commenters ──

CREATE OR REPLACE FUNCTION public.comments_op_add(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_body text, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[], p_entity_label text DEFAULT NULL::text, p_entity_icon text DEFAULT NULL::text)
 RETURNS comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comment public.comments;
  v_body text := coalesce(p_body, '');
  v_mentions jsonb := to_jsonb(coalesce(p_mentioned_user_ids, '{}'::uuid[]));
  v_owner uuid;
  v_creator uuid;  -- tasks: the creator, when known (TV-D1)
  v_notify jsonb;
  v_key uuid := public.module_api_key_id();
  v_key_label text;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  IF trim(v_body) = '' THEN
    RAISE EXCEPTION 'A comment can''t be empty.';
  END IF;

  -- Ensure the target exists in the registry (satisfies the FK) without
  -- reviving a tombstone or clobbering an authoritative label.
  PERFORM public.entities_op_ensure(p_workspace_id, p_entity_type, p_entity_id, p_entity_label, p_entity_icon);

  -- A key's comment belongs to its creator (created_by is NOT NULL, and the
  -- creator's access governs it) but reads as the app that wrote it.
  IF v_key IS NOT NULL THEN
    SELECT k.name INTO v_key_label FROM public.workspace_api_keys k WHERE k.id = v_key;
  END IF;
  INSERT INTO public.comments
    (workspace_id, entity_type, entity_id, body, created_by, author_kind, author_label)
  VALUES (
    p_workspace_id, p_entity_type, p_entity_id, v_body, public.perm_actor_id(),
    CASE WHEN v_key IS NULL THEN 'user' ELSE 'api_key' END,
    CASE WHEN v_key IS NULL THEN NULL ELSE coalesce(v_key_label, 'App') END)
  RETURNING * INTO v_comment;

  -- Resolve the entity owner for the types that have one. Owner-less entities
  -- (contact/company/event) leave v_owner NULL → only participants notify. A
  -- soft-deleted (trashed) task/note resolves to NULL too — don't ping an owner
  -- about a comment on something in their trash.
  IF p_entity_type = 'task' THEN
    -- A task comment reaches its assignee and its creator (TV-D1: owner_id is
    -- the creator; left out when unknown or when they can no longer see the
    -- task), plus everyone who commented before.
    SELECT t.assignee_id,
           CASE WHEN t.creator_unknown OR NOT public.can_access('task', t.id, 'view', t.owner_id)
                THEN NULL ELSE t.owner_id END
      INTO v_owner, v_creator FROM public.tasks t
      WHERE t.id = p_entity_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL;
  ELSIF p_entity_type = 'note' THEN
    SELECT n.created_by INTO v_owner FROM public.notes n
      WHERE n.id = p_entity_id AND n.workspace_id = p_workspace_id AND n.deleted_at IS NULL;
  END IF;

  -- notify_user_ids = (owner ∪ prior participants) − the actor. De-duped; TEXT
  -- ids to match the predicate's `@> jsonb_build_array(auth.uid()::text)`.
  -- New here: a key's comment reads as the app, not as its creator, so it
  -- notifies the creator like anyone else's comment would (Maciej, 2026-10-08).
  SELECT coalesce(jsonb_agg(DISTINCT s.uid::text), '[]'::jsonb) INTO v_notify
  FROM (
    SELECT c.created_by AS uid
    FROM public.comments c
    WHERE c.workspace_id = p_workspace_id
      AND c.entity_type = p_entity_type
      AND c.entity_id = p_entity_id
      AND c.deleted_at IS NULL
    UNION
    SELECT v_owner
    WHERE v_owner IS NOT NULL
    UNION
    SELECT v_creator
    WHERE v_creator IS NOT NULL
  ) s
  WHERE v_key IS NOT NULL OR s.uid IS DISTINCT FROM public.perm_actor_id();

  PERFORM public.module_activity_log(
    p_workspace_id, 'comments', p_entity_type, p_entity_id, 'comments.add',
    jsonb_build_object(
      'comment_id', v_comment.id,
      -- A short excerpt for the notification card — never the full body.
      'excerpt', left(v_body, 140),
      'mentioned_user_ids', v_mentions,
      'notify_user_ids', v_notify)
  );
  RETURN v_comment;
END;
$function$
;

-- ── 9. Removing a member unassigns their tasks there (PRIV-2a) ───────────────

CREATE OR REPLACE FUNCTION public.share_member_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_name text;
BEGIN
  SELECT owner_id INTO v_owner FROM public.workspaces WHERE id = OLD.workspace_id AND deleted_at IS NULL;
  IF v_owner IS NULL OR v_owner = OLD.user_id THEN RETURN OLD; END IF;
  PERFORM set_config('share.bypass', '1', true);

  -- A removed member's tasks here are unassigned (PRIV-2 AC9). The tasks they
  -- created keep them as the creator (TV-D1: owner_id is the creator).
  UPDATE public.tasks SET assignee_id = NULL
  WHERE workspace_id = OLD.workspace_id AND assignee_id = OLD.user_id;

  DELETE FROM public.resource_grants
  WHERE subject_type = 'member' AND subject_id = OLD.user_id AND workspace_id = OLD.workspace_id;

  -- Account deletion: this cascade runs after the profile is gone. Private
  -- items were erased before it (account_erase_workspace_data); whatever a
  -- deletion outside the app left behind must never reach the owner.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), 'Member') INTO v_name
  FROM public.profiles WHERE id = OLD.user_id;
  v_name := coalesce(v_name, 'Member');

  UPDATE public.notes SET
    created_by = v_owner,
    title = 'From ' || v_name || ' (archived) ' || title
  WHERE workspace_id = OLD.workspace_id
    AND created_by = OLD.user_id
    AND deleted_at IS NULL
    AND share_mode = 'custom'
    AND NOT EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = notes.id AND g.subject_type = 'workspace'
    );

  UPDATE public.buckets SET
    owner_id = v_owner,
    name = 'From ' || v_name || ' (archived) ' || name
  WHERE workspace_id = OLD.workspace_id
    AND owner_id = OLD.user_id
    AND deleted_at IS NULL
    AND is_system = false
    AND NOT EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'bucket' AND g.resource_id = buckets.id AND g.subject_type = 'workspace'
    );

  RETURN OLD;
END;
$function$
;

-- ── 10. Account erasure (PRIV-2a): "assigned to the user" is assignee_id ─────

CREATE OR REPLACE FUNCTION public.account_erase_workspace_data(p_user uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owned uuid[];
  r record;
  v_new uuid;
  v_owner uuid;
  i integer;

  v_note_del uuid[] := '{}';     v_note_keep uuid[] := '{}';     v_note_to uuid[] := '{}';
  v_bucket_del uuid[] := '{}';   v_bucket_keep uuid[] := '{}';   v_bucket_to uuid[] := '{}';
  v_task_del uuid[] := '{}';     v_task_move uuid[] := '{}';     v_task_move_to uuid[] := '{}';
  v_contact_del uuid[] := '{}';  v_contact_keep uuid[] := '{}';  v_contact_to uuid[] := '{}';
  v_group_del uuid[] := '{}';    v_group_keep uuid[] := '{}';    v_group_to uuid[] := '{}';
  v_company_del uuid[] := '{}';  v_company_keep uuid[] := '{}';  v_company_to uuid[] := '{}';
  v_event_del uuid[];
  v_calendar_del uuid[];
  v_set_del uuid[];
  v_account_del uuid[];
  v_email_ref_del uuid[];
  v_email_account_del uuid[];
  v_channel_del uuid[];
  v_manager_channel uuid[] := '{}';
  v_manager_to uuid[] := '{}';
  v_task_unassign integer;
  v_notification_state integer;
  v_api_keys integer;
  v_member_grants integer;
  v_email text;
  v_invites integer;
  v_bypass text;

  v_keys text[];        -- 'type:id' of every deleted item
  v_id_texts text[];    -- every deleted id, for activity payloads (target_id)
  v_counts jsonb;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'account_erase_workspace_data: p_user is required';
  END IF;

  -- Workspaces the user owns are left to the auth cascade.
  SELECT coalesce(array_agg(w.id), '{}') INTO v_owned
  FROM public.workspaces w WHERE w.owner_id = p_user;

  -- ── Decide, before anything changes (every decision reads today's access) ──

  FOR r IN
    SELECT n.id, n.workspace_id FROM public.notes n
    WHERE n.created_by = p_user AND n.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('note', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_note_del := v_note_del || r.id;
    ELSE
      v_note_keep := v_note_keep || r.id;
      v_note_to := v_note_to || v_new;
    END IF;
  END LOOP;

  -- The Inbox is only ever its owner's, so it always goes.
  FOR r IN
    SELECT b.id, b.workspace_id FROM public.buckets b
    WHERE b.owner_id = p_user AND b.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('bucket', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_bucket_del := v_bucket_del || r.id;
    ELSE
      v_bucket_keep := v_bucket_keep || r.id;
      v_bucket_to := v_bucket_to || v_new;
    END IF;
  END LOOP;

  -- tasks.bucket_id is RESTRICT: every task in a bucket that goes either moves
  -- (someone else can see it, e.g. an assignee's grant) or goes too.
  FOR r IN
    SELECT t.id, t.workspace_id, t.assignee_id FROM public.tasks t WHERE t.bucket_id = ANY (v_bucket_del)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.resource_grants g
                   WHERE g.resource_type = 'task' AND g.resource_id = r.id) THEN
      -- can_access gives a task its own grants plus its bucket's access, and
      -- nobody else can see this bucket: without a grant the task is private.
      -- (A shortcut, so a big private bucket doesn't cost a search per task.)
      v_new := NULL;
    ELSIF r.assignee_id IS NOT NULL AND r.assignee_id <> p_user
          AND public.can_access('task', r.id, 'view', r.assignee_id) THEN
      -- The teammate it's assigned to keeps it, in their own Inbox.
      v_new := r.assignee_id;
    ELSE
      v_new := public.account_erasure_new_owner('task', r.id, r.workspace_id, p_user);
    END IF;
    IF v_new IS NULL THEN
      v_task_del := v_task_del || r.id;
    ELSE
      v_task_move := v_task_move || r.id;
      v_task_move_to := v_task_move_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.id, c.workspace_id FROM public.contacts c
    WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_contact_del := v_contact_del || r.id;
    ELSE
      v_contact_keep := v_contact_keep || r.id;
      v_contact_to := v_contact_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT g.id, g.workspace_id FROM public.contact_groups g
    WHERE g.owner_id = p_user AND g.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact_group', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_group_del := v_group_del || r.id;
    ELSE
      v_group_keep := v_group_keep || r.id;
      v_group_to := v_group_to || v_new;
    END IF;
  END LOOP;

  -- A company is visible through any contact the viewer can see that points at
  -- it. Contacts that go are private, so they never made a company visible.
  FOR r IN
    SELECT co.id, co.workspace_id FROM public.companies co
    WHERE co.owner_id = p_user AND co.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('company', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_company_del := v_company_del || r.id;
    ELSE
      v_company_keep := v_company_keep || r.id;
      v_company_to := v_company_to || v_new;
    END IF;
  END LOOP;

  -- Every event is filed in its owner's own calendar, so the user's calendars
  -- would only keep an empty name (integration calendars are often named after
  -- an email address). All of it goes.
  SELECT coalesce(array_agg(e.id), '{}') INTO v_event_del
  FROM public.calendar_events e
  WHERE e.owner_id = p_user AND e.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(c.id), '{}') INTO v_calendar_del
  FROM public.calendars c WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(s.id), '{}') INTO v_set_del
  FROM public.calendar_sets s WHERE s.owner_id = p_user AND s.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(a.id), '{}') INTO v_account_del
  FROM public.calendar_accounts a WHERE a.owner_id = p_user AND a.workspace_id <> ALL (v_owned);

  -- Email has no sharing: everything is the owner's alone.
  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_ref_del
  FROM public.email_refs x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_account_del
  FROM public.email_accounts x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  -- Chat rows outlive membership (someone who leaves keeps their chat_members
  -- and manager rows but can't open the workspace), so only people still in the
  -- workspace count below.
  -- A DM or private channel with nobody else still here in it, e.g. their DM
  -- with themselves.
  SELECT coalesce(array_agg(c.id), '{}') INTO v_channel_del
  FROM public.chat_channels c
  WHERE c.workspace_id <> ALL (v_owned)
    AND (c.kind = 'dm' OR c.is_private)
    AND EXISTS (SELECT 1 FROM public.chat_members cm
                WHERE cm.channel_id = c.id AND cm.user_id = p_user)
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_members cm
      WHERE cm.channel_id = c.id AND cm.user_id <> p_user
        AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                     WHERE wm.workspace_id = c.workspace_id AND wm.user_id = cm.user_id)
             OR EXISTS (SELECT 1 FROM public.workspaces w
                        WHERE w.id = c.workspace_id AND w.owner_id = cm.user_id)));

  -- Channels the user managed alone: the workspace owner if they can see the
  -- channel, otherwise the earliest member still here.
  FOR r IN
    SELECT c.id, c.workspace_id, c.is_private
    FROM public.chat_channel_managers m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user
      AND c.workspace_id <> ALL (v_owned)
      AND NOT (c.id = ANY (v_channel_del))
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_channel_managers m2
        WHERE m2.channel_id = c.id AND m2.user_id <> p_user
          AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                       WHERE wm.workspace_id = c.workspace_id AND wm.user_id = m2.user_id)
               OR EXISTS (SELECT 1 FROM public.workspaces w
                          WHERE w.id = c.workspace_id AND w.owner_id = m2.user_id)))
  LOOP
    v_new := NULL;
    SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = r.workspace_id;
    IF v_owner IS NOT NULL AND v_owner <> p_user
       AND (NOT r.is_private OR EXISTS (SELECT 1 FROM public.chat_members cm
                                        WHERE cm.channel_id = r.id AND cm.user_id = v_owner)) THEN
      v_new := v_owner;
    ELSE
      SELECT cm.user_id INTO v_new
      FROM public.chat_members cm
      JOIN public.workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = cm.user_id
      WHERE cm.channel_id = r.id AND cm.user_id <> p_user
      ORDER BY cm.joined_at, cm.user_id
      LIMIT 1;
      IF v_new IS NULL AND NOT r.is_private THEN
        SELECT m.user_id INTO v_new
        FROM public.workspace_members m
        WHERE m.workspace_id = r.workspace_id AND m.user_id <> p_user
        ORDER BY m.joined_at, m.user_id
        LIMIT 1;
      END IF;
    END IF;
    IF v_new IS NOT NULL THEN
      v_manager_channel := v_manager_channel || r.id;
      v_manager_to := v_manager_to || v_new;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_task_unassign
  FROM public.tasks t
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  SELECT count(*) INTO v_notification_state
  FROM public.notification_state s WHERE s.user_id = p_user;

  SELECT count(*) INTO v_api_keys
  FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);

  SELECT count(*) INTO v_member_grants
  FROM public.resource_grants g
  WHERE g.subject_type = 'member' AND g.subject_id = p_user;

  -- Invitations they accepted keep their email address; they have no use once
  -- the person is in (pending ones are the inviter's and stay).
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user;
  SELECT count(*) INTO v_invites
  FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  v_counts := jsonb_build_object(
    'preview', p_preview IS NOT FALSE,
    'notes_deleted', cardinality(v_note_del),
    'notes_handed_over', cardinality(v_note_keep),
    'buckets_deleted', cardinality(v_bucket_del),
    'buckets_handed_over', cardinality(v_bucket_keep),
    'tasks_deleted', cardinality(v_task_del),
    'tasks_moved', cardinality(v_task_move),
    'tasks_unassigned', v_task_unassign,
    'contacts_deleted', cardinality(v_contact_del),
    'contacts_handed_over', cardinality(v_contact_keep),
    'contact_groups_deleted', cardinality(v_group_del),
    'contact_groups_handed_over', cardinality(v_group_keep),
    'companies_deleted', cardinality(v_company_del),
    'companies_handed_over', cardinality(v_company_keep),
    'events_deleted', cardinality(v_event_del),
    'calendars_deleted', cardinality(v_calendar_del),
    'calendar_sets_deleted', cardinality(v_set_del),
    'calendar_accounts_deleted', cardinality(v_account_del),
    'email_refs_deleted', cardinality(v_email_ref_del),
    'email_accounts_deleted', cardinality(v_email_account_del),
    'chat_channels_deleted', cardinality(v_channel_del),
    'chat_managers_handed_over', cardinality(v_manager_channel),
    'notification_state_deleted', v_notification_state,
    'api_keys_deleted', v_api_keys,
    'member_grants_deleted', v_member_grants,
    'invites_deleted', v_invites
  );

  -- Only an explicit false deletes; NULL previews like the default.
  IF p_preview IS NOT FALSE THEN
    RETURN v_counts;
  END IF;

  -- ── Apply ──────────────────────────────────────────────────────────────────

  -- Restored before returning, so a caller's later statements aren't bypassed.
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);

  -- 1. Shared items get their new owner.
  UPDATE public.notes n SET created_by = x.to_user
  FROM unnest(v_note_keep, v_note_to) AS x(id, to_user) WHERE n.id = x.id;
  UPDATE public.buckets b SET owner_id = x.to_user
  FROM unnest(v_bucket_keep, v_bucket_to) AS x(id, to_user) WHERE b.id = x.id;
  UPDATE public.contacts c SET owner_id = x.to_user
  FROM unnest(v_contact_keep, v_contact_to) AS x(id, to_user) WHERE c.id = x.id;
  UPDATE public.contact_groups g SET owner_id = x.to_user
  FROM unnest(v_group_keep, v_group_to) AS x(id, to_user) WHERE g.id = x.id;
  UPDATE public.companies co SET owner_id = x.to_user
  FROM unnest(v_company_keep, v_company_to) AS x(id, to_user) WHERE co.id = x.id;

  -- 2. Shared tasks leave the buckets that go, into their new owner's Inbox.
  FOR i IN 1 .. cardinality(v_task_move) LOOP
    UPDATE public.tasks t
    SET bucket_id = public.account_erasure_inbox(t.workspace_id, v_task_move_to[i])
    WHERE t.id = v_task_move[i];
  END LOOP;

  -- 3. Tasks assigned to the user are unassigned (the moved ones included).
  UPDATE public.tasks t SET assignee_id = NULL
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  -- 4. Chat: new managers first, then the user's manager rows, then channels
  --    with nobody else in them (members and messages cascade).
  INSERT INTO public.chat_channel_managers (channel_id, user_id)
  SELECT x.channel_id, x.user_id FROM unnest(v_manager_channel, v_manager_to) AS x(channel_id, user_id)
  ON CONFLICT DO NOTHING;
  DELETE FROM public.chat_channel_managers m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND m.user_id = p_user AND c.workspace_id <> ALL (v_owned);
  DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);

  -- 5. What points at the deleted items without a foreign key, addressed as
  --    'type:id' in every type the spine (perm_can_see_entity), activity and
  --    grants use for them.
  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT 'note:' || x AS k FROM unnest(v_note_del) AS x
    UNION ALL SELECT 'bucket:' || x FROM unnest(v_bucket_del) AS x
    UNION ALL SELECT 'task:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'task_project:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'contact:' || x FROM unnest(v_contact_del) AS x
    UNION ALL SELECT 'contact_group:' || x FROM unnest(v_group_del) AS x
    UNION ALL SELECT 'company:' || x FROM unnest(v_company_del) AS x
    UNION ALL SELECT 'event:' || x FROM unnest(v_event_del) AS x
    UNION ALL SELECT 'calendar:' || x FROM unnest(v_calendar_del) AS x
    UNION ALL SELECT 'calendar_set:' || x FROM unnest(v_set_del) AS x
    UNION ALL SELECT 'calendar_account:' || x FROM unnest(v_account_del) AS x
    UNION ALL SELECT 'email_thread:' || x FROM unnest(v_email_ref_del) AS x
    UNION ALL SELECT 'email_account:' || x FROM unnest(v_email_account_del) AS x
    UNION ALL SELECT 'chat_channel:' || x FROM unnest(v_channel_del) AS x
  ) s;

  SELECT coalesce(array_agg(split_part(k, ':', 2)), '{}') INTO v_id_texts
  FROM unnest(v_keys) AS k;

  -- Activity rows (notification state cascades), including links-module rows
  -- whose deleted item is only the payload's target.
  DELETE FROM public.module_activity a
  WHERE (a.entity_type || ':' || a.entity_id) = ANY (v_keys)
     OR (a.payload ->> 'target_id') = ANY (v_id_texts);
  -- Activity only the user could read (RLS shows calendar and email activity to
  -- the actor and the item's owner), also for items removed earlier. A calendar
  -- account's entries carry its label, often an email address.
  DELETE FROM public.module_activity a
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user
    AND (a.entity_type IN ('calendar_account', 'email_account', 'email_thread')
         OR (a.entity_type = 'event' AND NOT EXISTS (
               SELECT 1 FROM public.calendar_events e
               WHERE e.id = a.entity_id AND e.owner_id <> p_user)));
  -- The rest of their activity stays, without their name: module_activity_log
  -- copies the actor's display name into actor_label, and the app shows it.
  UPDATE public.module_activity a SET actor_label = NULL
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user AND a.actor_label IS NOT NULL;
  DELETE FROM public.tag_links tl
  WHERE (tl.entity_type || ':' || tl.entity_id) = ANY (v_keys);
  DELETE FROM public.link_suggestion_declines d
  WHERE split_part(d.pair_key, '|', 1) = ANY (v_keys)
     OR split_part(d.pair_key, '|', 2) = ANY (v_keys);
  -- Entities: their links (either end) and every comment on them cascade.
  DELETE FROM public.entities e
  WHERE (e.entity_type || ':' || e.entity_id) = ANY (v_keys);

  -- 6. The items. Children before parents where a foreign key restricts.
  DELETE FROM public.exposed_notes x WHERE x.note_id = ANY (v_note_del::text[]);
  -- note_shares has a foreign key whose delete rule no migration records.
  DELETE FROM public.note_shares s WHERE s.note_id = ANY (v_note_del);
  -- notes.parent_id is SET NULL: a teammate's sub-note under a deleted note
  -- moves to the top level. note_updates cascade.
  DELETE FROM public.notes n WHERE n.id = ANY (v_note_del);

  UPDATE public.slot_bookings b SET contact_id = NULL WHERE b.contact_id = ANY (v_contact_del);
  UPDATE public.slot_bookings b SET calendar_event_id = NULL WHERE b.calendar_event_id = ANY (v_event_del);

  DELETE FROM public.tasks t WHERE t.id = ANY (v_task_del);
  DELETE FROM public.buckets b WHERE b.id = ANY (v_bucket_del);
  -- Time blocks map a slot to a bucket id; drop the slots of buckets that went.
  UPDATE public.task_time_blocks tb
  SET blocks = coalesce((
        SELECT jsonb_object_agg(j.key, j.value)
        FROM jsonb_each(tb.blocks) AS j
        WHERE NOT coalesce((j.value #>> '{}') = ANY (v_bucket_del::text[]), false)
      ), '{}'::jsonb),
      updated_at = now()
  WHERE EXISTS (SELECT 1 FROM jsonb_each(tb.blocks) AS j
                WHERE (j.value #>> '{}') = ANY (v_bucket_del::text[]));

  -- Group memberships and private notes on contacts cascade; contacts.company_id
  -- is SET NULL.
  DELETE FROM public.contact_groups g WHERE g.id = ANY (v_group_del);
  DELETE FROM public.contacts c WHERE c.id = ANY (v_contact_del);
  DELETE FROM public.companies co WHERE co.id = ANY (v_company_del);

  -- Events before accounts: calendar_events.source_account_id is SET NULL.
  -- Set items cascade; deleting an account also deletes its calendar.
  DELETE FROM public.calendar_events e WHERE e.id = ANY (v_event_del);
  DELETE FROM public.calendar_sets s WHERE s.id = ANY (v_set_del);
  DELETE FROM public.calendars c WHERE c.id = ANY (v_calendar_del);
  DELETE FROM public.calendar_accounts a WHERE a.id = ANY (v_account_del);

  -- email_refs.account_id is SET NULL, so refs go first.
  DELETE FROM public.email_refs x WHERE x.id = ANY (v_email_ref_del);
  DELETE FROM public.email_accounts x WHERE x.id = ANY (v_email_account_del);

  -- 7. Grants on everything that went, every grant to the user, their read
  --    state, the API keys they created (keys stop working without a creator
  --    anyway) and the invitations they accepted.
  DELETE FROM public.resource_grants g
  WHERE (g.resource_type || ':' || g.resource_id) = ANY (v_keys)
     OR (g.subject_type = 'member' AND g.subject_id = p_user);
  DELETE FROM public.notification_state s WHERE s.user_id = p_user;
  DELETE FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);
  DELETE FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN v_counts;
END;
$function$
;

-- ── 11. tasks_op_assign ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_op_assign(
  p_workspace_id uuid,
  p_task_id uuid,
  p_assignee_id uuid
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  -- Already so: nothing to check or write (a task can stay with someone who
  -- has since left).
  IF t.assignee_id IS NOT DISTINCT FROM p_assignee_id THEN
    -- The guard doesn't check access to this task, and the row goes back to
    -- the caller, so check it as the write would have.
    IF NOT public.can_access('task', t.id, 'edit', public.perm_actor_id()) THEN
      RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
    END IF;
    RETURN t;
  END IF;
  -- NULL unassigns. Anyone else has to be a member who can work on tasks.
  IF p_assignee_id IS NOT NULL THEN
    IF NOT public.perm_is_owner(p_workspace_id, p_assignee_id)
       AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
                       WHERE m.workspace_id = p_workspace_id AND m.user_id = p_assignee_id) THEN
      RAISE EXCEPTION 'That person isn''t a member of this workspace.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.perm_user_has(p_workspace_id, p_assignee_id, 'tasks.edit') THEN
      RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- perm_enforce_write still checks the caller's access to this task.
  -- tasks_notify_spine logs tasks.assigned (the assignee as the notify target)
  -- for this write, as for every other way a task gets an assignee, so the op
  -- doesn't log it a second time.
  UPDATE public.tasks
    SET assignee_id = p_assignee_id, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  RETURN t;
END;
$$;

-- ── 12. Grants ───────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated directly,
-- so they are revoked by name (REVOKE … FROM PUBLIC alone leaves anon).
DO $$
DECLARE fn text;
BEGIN
  -- The op: signed-in users and the MCP connector (service role).
  FOREACH fn IN ARRAY ARRAY['tasks_op_assign(uuid, uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- Trigger functions: nobody calls them directly.
  FOREACH fn IN ARRAY ARRAY['tasks_assignee_and_creator()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END;
$$;
