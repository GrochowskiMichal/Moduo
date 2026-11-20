-- CALR-14 · Focus time (specs/calendar-rethink.md AC23, §Assumptions "Focus
-- item"). Focus time is a calendar item (kind 'focus') that can hold a task;
-- teammates see it as "Focus time", busy, never its title or the task inside.
--   * can_access('event', …) gives a non-owner at most freebusy on a focus
--     item, exactly like a private one.
--   * calendar_events_owner_read (the policy Realtime applies) drops others'
--     focus rows, so no channel carries the task's title.
--   * calendar_events_visible masks others' focus rows as "Focus time" (kind
--     kept, details nulled); private still wins ("Busy").
-- Booking links treat focus as free unless the link lists "focus" in its busy
-- calendars (supabase/functions/_shared/booking-busy.ts): no schema change.
-- Re-cut from 20261028150000; only the lines above change. Re-runnable.
-- Test: supabase/tests/calendar_focus_item.test.sql.

-- Refuse to apply before the bodies this file re-cuts from.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calendar_events_visible') THEN
    RAISE EXCEPTION 'CALR-14 needs 20261028150000 applied first.';
  END IF;
END;
$$;

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
  v_private boolean;
  v_kind text;
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
    SELECT workspace_id, owner_id, calendar_ref, is_private, kind INTO v_ws, v_creator, v_cal, v_private, v_kind
    FROM public.calendar_events WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN
      v_rank := 4;
      v_module := 'calendar';
    ELSIF v_cal IS NOT NULL THEN
      IF (v_private OR v_kind = 'focus') AND v_need > 1 THEN RETURN false; END IF;
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

REVOKE ALL ON FUNCTION public.can_access(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access(text, uuid, text, uuid) TO postgres, service_role;

-- Policy swaps take ACCESS EXCLUSIVE on two busy tables: wait briefly, never queue.
-- Table grants are left as they are (prod gives the client roles ALL on both,
-- RLS decides; narrowing them is out of this block).
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS calendar_events_owner_read ON public.calendar_events;
CREATE POLICY calendar_events_owner_read ON public.calendar_events FOR SELECT TO authenticated
USING (workspace_id IS NOT NULL AND public.perm_can_view(workspace_id, 'calendar')
  AND (owner_id = (SELECT auth.uid())
       OR (calendar_ref IS NOT NULL AND NOT is_private AND kind <> 'focus' AND public.can_access('calendar', calendar_ref, 'view'))));
CREATE OR REPLACE FUNCTION public.calendar_events_visible(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS SETOF public.calendar_events LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_user uuid := public.perm_actor_id();
BEGIN
  IF v_user IS NULL OR p_workspace_id IS NULL OR public.calendar_module_permission(p_workspace_id) NOT IN ('view','edit','admin') THEN RETURN; END IF;
  RETURN QUERY
  -- Every calendar the actor can view, their own included: a teammate's event
  -- on your calendar (they can edit it) is yours to see, as the table policy says.
  WITH cals AS (SELECT c.id FROM public.calendars c WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
                  AND public.can_access('calendar', c.id, 'view', v_user))
  -- The row is built once in a LATERAL (a bare (CASE … END).* would rebuild
  -- it once per column). A new sensitive column joins the mask list here.
  SELECT (m.r).*
  FROM public.calendar_events e
  CROSS JOIN LATERAL (SELECT CASE WHEN e.owner_id = v_user OR (NOT e.is_private AND e.kind <> 'focus') THEN e
     ELSE jsonb_populate_record(e, jsonb_build_object('title',CASE WHEN e.is_private THEN 'Busy' ELSE 'Focus time' END,'description',null,'location',null,'attendees','[]'::jsonb,
       'conference_url',null,'conference_provider',null,'tags','[]'::jsonb,'reminders','[]'::jsonb,'external_event_id',null,
       'external_series_id',null,'focus_task_id',null,'offer_id',null,'color',null)) END AS r) m
  WHERE e.workspace_id = p_workspace_id AND e.deleted_at IS NULL
    AND (e.owner_id = v_user OR e.calendar_ref IN (SELECT id FROM cals))
    AND (e.recurrence_rule IS NOT NULL OR (e.start_time <= p_to AND e.end_time >= p_from))
  ORDER BY e.start_time, e.id;
END $f$;
REVOKE ALL ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) TO authenticated, service_role;
