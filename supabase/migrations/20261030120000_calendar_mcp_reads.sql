-- CALR-21 · The MCP connector's calendar reads (specs/calendar-rethink.md AC46,
-- §Assumptions "MCP tools").
--
--   * calendar_who_sees(ws, p_event_id): who sees what of your calendars, one
--     row per calendar you own and teammate: 'all', 'busy', 'focus_time' or
--     'nothing'. With an event (your own, on your own calendar), only that
--     event's calendar, through the event's own mask: private reads "Busy" to
--     everyone, focus time "Focus time".
--   * calendar_event_occurrences(ws, from, to): every occurrence in [from, to)
--     of the events the masked read returns (calendar__events_visible_for),
--     repeats expanded in the event owner's zone, exdates skipped. A window
--     past a year is refused.
--
-- Both are key-aware through calendar__viewer (calendar_module_permission and
-- perm_actor_id()): a key without Calendar reads nothing. Re-runnable.
-- Test: supabase/tests/calendar_mcp_reads.test.sql, mcp_tools.test.sql.

CREATE OR REPLACE FUNCTION public.calendar_who_sees(p_workspace_id uuid, p_event_id uuid)
RETURNS TABLE (calendar_id uuid, calendar_name text, user_id uuid, sees text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.calendar__viewer(p_workspace_id, NULL);
  v_calendar uuid;
  v_private boolean := false;
  v_focus boolean := false;
BEGIN
  -- No Calendar for this person or key: no rows.
  IF v_actor IS NULL THEN
    RETURN;
  END IF;

  -- With an event: it must be the actor's own, on a calendar the actor owns.
  -- One answer for missing, deleted, elsewhere and someone else's.
  IF p_event_id IS NOT NULL THEN
    SELECT e.calendar_ref, e.is_private, e.kind = 'focus'
      INTO v_calendar, v_private, v_focus
      FROM public.calendar_events e
      JOIN public.calendars c ON c.id = e.calendar_ref
     WHERE e.id = p_event_id
       AND e.workspace_id = p_workspace_id
       AND e.deleted_at IS NULL
       AND e.owner_id = v_actor
       AND c.owner_id = v_actor
       AND c.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Event not found in this workspace.';
    END IF;
  END IF;

  RETURN QUERY
  WITH my_calendars AS (
    SELECT c.id, c.name
      FROM public.calendars c
     WHERE c.workspace_id = p_workspace_id
       AND c.owner_id = v_actor
       AND c.deleted_at IS NULL
       AND (p_event_id IS NULL OR c.id = v_calendar)
  ),
  teammates AS (
    SELECT m.user_id AS member_id,
           public.module_member_permission(p_workspace_id, m.user_id, 'calendar') IN ('view', 'edit', 'admin') AS has_calendar
      FROM public.workspace_members m
     WHERE m.workspace_id = p_workspace_id
       AND m.user_id <> v_actor
  ),
  calendar_levels AS (
    SELECT mc.id AS cal_id,
           mc.name AS cal_name,
           t.member_id,
           CASE
             WHEN NOT t.has_calendar THEN 'nothing'
             WHEN public.can_access('calendar', mc.id, 'view', t.member_id) THEN 'all'
             WHEN public.can_access('calendar', mc.id, 'freebusy', t.member_id) THEN 'busy'
             ELSE 'nothing'
           END AS level
      FROM my_calendars mc
     CROSS JOIN teammates t
  )
  SELECT cl.cal_id,
         cl.cal_name,
         cl.member_id,
         CASE
           WHEN cl.level = 'nothing' THEN 'nothing'
           WHEN v_private THEN 'busy'
           WHEN v_focus THEN 'focus_time'
           ELSE cl.level
         END
    FROM calendar_levels cl
   ORDER BY cl.cal_name, cl.member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_event_occurrences(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (event_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_to - p_from > interval '366 days' THEN
    RAISE EXCEPTION 'A range of at most a year.';
  END IF;

  RETURN QUERY
  WITH visible_events AS (
    SELECT v.id, v.owner_id, v.start_time, v.end_time, v.recurrence_rule, v.exdates
      FROM public.calendar__events_visible_for(public.calendar__viewer(p_workspace_id, NULL), p_workspace_id, p_from, p_to) v
  )
  SELECT ve.id, o.o_start, o.o_end
    FROM visible_events ve
    -- A repeat is expanded in its owner's zone, as calendar_busy_blocks does.
    LEFT JOIN public.user_preferences up ON up.user_id = ve.owner_id
   CROSS JOIN LATERAL public.calendar__occurrences(ve.start_time, ve.end_time, ve.recurrence_rule, ve.exdates,
                                                  up.time_zone, p_from, p_to) o
   ORDER BY o.o_start, ve.id;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_who_sees(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_event_occurrences(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_who_sees(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_event_occurrences(uuid, timestamptz, timestamptz) TO authenticated, service_role;
