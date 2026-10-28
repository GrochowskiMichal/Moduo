-- CALR-15 · Private masking (specs/calendar-rethink.md AC28, §Assumptions
-- "Private masking").
--
-- A private event shows as "Busy" to everyone but its owner:
--   * can_access('event', …) gives a non-owner at most freebusy on a private
--     event, which hides it from the registry, search, mentions, comments and
--     edits. Re-cut from its live body; only the 'event' branch changes.
--   * calendar_events_owner_read (the base-table SELECT policy Realtime
--     applies) drops others' private rows, so no channel carries one.
--   * entity_links_workspace_read gates event ends through
--     perm_can_see_entity, so notes linked to a private event stay hidden.
--   * calendar_events_visible(ws, from, to) is the masked read the app and the
--     MCP connector use: own rows whole, others' viewable rows whole unless
--     private, others' private rows as "Busy" with the details nulled.
-- Re-runnable.

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
    SELECT workspace_id, owner_id, calendar_ref, is_private INTO v_ws, v_creator, v_cal, v_private
    FROM public.calendar_events WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN
      v_rank := 4;
      v_module := 'calendar';
    ELSIF v_cal IS NOT NULL THEN
      IF v_private AND v_need > 1 THEN RETURN false; END IF;
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

DROP POLICY IF EXISTS calendar_events_owner_read ON public.calendar_events;
CREATE POLICY calendar_events_owner_read ON public.calendar_events FOR SELECT TO authenticated
USING (workspace_id IS NOT NULL AND public.perm_can_view(workspace_id, 'calendar')
  AND (owner_id = (SELECT auth.uid())
       OR (calendar_ref IS NOT NULL AND NOT is_private AND public.can_access('calendar', calendar_ref, 'view'))));
DROP POLICY IF EXISTS entity_links_workspace_read ON public.entity_links;
CREATE POLICY entity_links_workspace_read ON public.entity_links FOR SELECT TO authenticated
USING (tasks_module_can_access_workspace(workspace_id)
  AND ((source_type <> ALL (ARRAY['chat_channel','chat_message','event'])) OR perm_can_see_entity(workspace_id, source_type, source_id))
  AND ((target_type <> ALL (ARRAY['chat_channel','chat_message','event'])) OR perm_can_see_entity(workspace_id, target_type, target_id)));
CREATE OR REPLACE FUNCTION public.calendar_events_visible(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS SETOF public.calendar_events LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_user uuid := public.perm_actor_id();
BEGIN
  IF v_user IS NULL OR p_workspace_id IS NULL OR public.calendar_module_permission(p_workspace_id) NOT IN ('view','edit','admin') THEN RETURN; END IF;
  RETURN QUERY
  WITH cals AS (SELECT c.id FROM public.calendars c WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
                  AND c.owner_id <> v_user AND public.can_access('calendar', c.id, 'view', v_user))
  SELECT (CASE WHEN e.owner_id = v_user OR NOT e.is_private THEN e
     ELSE jsonb_populate_record(e, jsonb_build_object('title','Busy','description',null,'location',null,'attendees','[]'::jsonb,
       'conference_url',null,'conference_provider',null,'tags','[]'::jsonb,'reminders','[]'::jsonb,'external_event_id',null,
       'external_series_id',null,'focus_task_id',null,'offer_id',null,'color',null)) END).*
  FROM public.calendar_events e
  WHERE e.workspace_id = p_workspace_id AND e.deleted_at IS NULL
    AND (e.owner_id = v_user OR e.calendar_ref IN (SELECT id FROM cals))
    AND (e.recurrence_rule IS NOT NULL OR (e.start_time <= p_to AND e.end_time >= p_from))
  ORDER BY e.start_time, e.id;
END $f$;
REVOKE ALL ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) TO authenticated, service_role;
