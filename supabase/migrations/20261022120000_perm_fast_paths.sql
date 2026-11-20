-- MOD-PERF · The access check does the same work in a fraction of the lookups.
--
-- RLS on tasks, tag_links, comments and task_time_entries runs can_access once
-- per row. For a task in a bucket the old body asked about the bucket up to
-- three times (full, then edit, then view), and every one of those, plus the
-- task's own check, called perm_ceiling_rank, which called perm_user_has up to
-- three times, each re-reading workspaces and workspace_members. That is up to
-- ~30 queries per task row: prod's id sweeps (tasks 248 ms, tag_links 522 ms,
-- comments 289 ms mean for a few hundred rows) were almost all this.
--
-- Same answers, fewer reads:
--   * perm_ceiling_rank reads the owner row and the member row once each and
--     maps the member's perms in one CASE. workspace_members is UNIQUE
--     (workspace_id, user_id), so one row stands for the old EXISTS checks;
--     a NULL perms array or NULL element still reads as "no", as before.
--   * can_access('task', …) reads the bucket once, ranks it once, and reuses
--     the bucket's is_system flag and, when the bucket sits in the task's
--     workspace (always, today), the tasks ceiling it already computed.
--     The bucket's effective rank only counts from view (2) up, as the old
--     full/edit/view ladder did; a freebusy (1) bucket grant still adds nothing.
-- Every other branch is unchanged. No GRANT or REVOKE here on purpose:
-- CREATE OR REPLACE keeps each function's ACL, and both stay server-only
-- (TV-SEC1, 20261013260000; access_check.test.sql pins it).

CREATE OR REPLACE FUNCTION public.perm_ceiling_rank(p_workspace_id uuid, p_user_id uuid, p_module text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 0
    WHEN public.perm_is_owner(p_workspace_id, p_user_id) THEN 4
    ELSE coalesce((
      SELECT CASE
        WHEN NOT coalesce((p_module || '.view') = ANY (m.perms), false) THEN 0
        WHEN coalesce((p_module || '.delete') = ANY (m.perms), false) THEN 4
        WHEN coalesce((p_module || '.edit') = ANY (m.perms), false) THEN 3
        ELSE 2
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id
    ), 0)
  END
$function$;

CREATE OR REPLACE FUNCTION public.can_access(p_type text, p_id uuid, p_min text, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := coalesce(p_user, public.perm_actor_id());
  v_need int := public.grant_level_rank(p_min);
  v_rank int := 0;
  v_ws uuid;
  v_module text;
  v_id uuid;
  v_parent uuid;
  v_mode text;
  v_creator uuid;
  v_system boolean;
  v_bucket uuid;
  v_cal uuid;
  v_guard int := 0;
  v_unknown boolean;
  v_b_ws uuid;
  v_b_owner uuid;
  v_b_system boolean;
  v_b_rank int;
  v_b_ceiling int;
  v_ceiling int;
BEGIN
  IF v_user IS NULL OR p_id IS NULL OR v_need = 0 THEN
    RETURN false;
  END IF;

  IF p_type = 'note' THEN
    v_id := p_id;
    LOOP
      v_guard := v_guard + 1;
      EXIT WHEN v_guard > 100;
      SELECT workspace_id, parent_id, coalesce(share_mode, 'custom'), created_by
        INTO v_ws, v_parent, v_mode, v_creator
      FROM public.notes WHERE id = v_id;
      EXIT WHEN NOT FOUND;
      IF v_creator = v_user THEN v_rank := greatest(v_rank, 4); END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('note', v_id, v_user));
      EXIT WHEN v_mode IS DISTINCT FROM 'inherit' OR v_parent IS NULL;
      v_id := v_parent;
    END LOOP;
    v_module := 'notes';

  ELSIF p_type = 'bucket' THEN
    SELECT workspace_id, owner_id, is_system INTO v_ws, v_creator, v_system
    FROM public.buckets WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_system THEN
      v_rank := CASE WHEN v_creator = v_user THEN 4 ELSE 0 END;
    ELSE
      IF v_creator = v_user THEN v_rank := 4; END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('bucket', p_id, v_user));
    END IF;
    v_module := 'tasks';

  ELSIF p_type = 'task' THEN
    SELECT workspace_id, bucket_id, owner_id, creator_unknown
      INTO v_ws, v_bucket, v_creator, v_unknown
    FROM public.tasks WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    v_rank := public.share_direct_rank('task', p_id, v_user);
    v_module := 'tasks';
    IF v_bucket IS NOT NULL THEN
      -- Inherit the bucket: its rank as can_access('bucket', …) would see it,
      -- computed once instead of once per level.
      SELECT workspace_id, owner_id, is_system INTO v_b_ws, v_b_owner, v_b_system
      FROM public.buckets WHERE id = v_bucket;
      IF FOUND AND v_b_ws IS NOT NULL THEN
        IF v_b_system THEN
          v_b_rank := CASE WHEN v_b_owner = v_user THEN 4 ELSE 0 END;
        ELSE
          v_b_rank := CASE WHEN v_b_owner = v_user THEN 4 ELSE 0 END;
          v_b_rank := greatest(v_b_rank, public.share_direct_rank('bucket', v_bucket, v_user));
        END IF;
        IF v_b_rank >= 2 THEN
          v_b_ceiling := public.perm_ceiling_rank(v_b_ws, v_user, 'tasks');
          v_b_rank := least(v_b_rank, v_b_ceiling);
          IF v_b_ws = v_ws THEN v_ceiling := v_b_ceiling; END IF;
        END IF;
        IF v_b_rank >= 2 THEN v_rank := greatest(v_rank, v_b_rank); END IF;
      END IF;
      -- TV-D13 (20a): a task you made that you handed, unfiled, to someone.
      IF v_rank < 3 AND v_creator = v_user AND NOT coalesce(v_unknown, false)
         AND coalesce(v_b_system, false) THEN
        v_rank := 3;
      END IF;
    END IF;

  ELSIF p_type = 'calendar' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator FROM public.calendars WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('calendar', p_id, v_user));
    v_module := 'calendar';

  ELSIF p_type = 'contact_group' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contact_groups WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact_group', p_id, v_user));
    v_module := 'contacts';

  ELSIF p_type = 'contact' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contacts WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact', p_id, v_user));
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'edit', v_user)
    ) THEN
      v_rank := greatest(v_rank, 3);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'company' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.companies WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    IF EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.company_id = p_id AND c.deleted_at IS NULL
        AND public.can_access('contact', c.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'event' THEN
    SELECT workspace_id, owner_id, calendar_ref INTO v_ws, v_creator, v_cal
    FROM public.calendar_events WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN
      v_rank := 4;
      v_module := 'calendar';
    ELSIF v_cal IS NOT NULL THEN
      RETURN public.can_access('calendar', v_cal, p_min, v_user);
    ELSE
      RETURN false;
    END IF;

  ELSE
    RETURN false;
  END IF;

  IF v_ws IS NULL THEN RETURN false; END IF;
  IF v_rank < v_need THEN RETURN false; END IF;
  RETURN least(v_rank, coalesce(v_ceiling, public.perm_ceiling_rank(v_ws, v_user, v_module))) >= v_need;
END;
$function$;
