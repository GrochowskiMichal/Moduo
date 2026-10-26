-- MOD-571 · share_member_removed puts share.bypass back when it is done.
--
-- The AFTER DELETE trigger on workspace_members turned share.bypass on for
-- its clean-up (unassign, drop grants, archive private notes and projects to
-- the owner) and never turned it off, so it stayed on for the rest of the
-- transaction. It now saves the caller's value and restores it before every
-- RETURN that follows the set, the way teams_member_removed
-- (20261013180000_teams_routing_fixes.sql) already does. The body is the
-- latest one (20261008150000_tasks_assignee_creator.sql) with only that change.
--
-- Audit of every other function that sets share.bypass (latest definition of
-- each): account_erase_workspace_data, areas__mirror_labels, areas_op_update,
-- chat_op_bootstrap, project_statuses_op_delete, projects_op_delete,
-- sections_op_update, tasks__hand_to_inbox, tasks_notify_spine,
-- tasks_op_catch_up, tasks_op_trash_restore, tasks_op_update,
-- teams_member_removed and teams_op_update all save the value first and
-- restore it on every path that returns after setting it (a raised error rolls
-- the setting back with its subtransaction). Only this function needed a fix.
--
-- CREATE OR REPLACE keeps the function's owner, grants and trigger.
-- Test: supabase/tests/share_bypass_restore.test.sql.

CREATE OR REPLACE FUNCTION public.share_member_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_name text;
  v_bypass text;
BEGIN
  SELECT owner_id INTO v_owner FROM public.workspaces WHERE id = OLD.workspace_id AND deleted_at IS NULL;
  IF v_owner IS NULL OR v_owner = OLD.user_id THEN RETURN OLD; END IF;
  v_bypass := current_setting('share.bypass', true);
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
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
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

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN OLD;
END;
$function$
;
