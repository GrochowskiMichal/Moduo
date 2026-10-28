-- CALR-16 · Preview as and teammates (specs/calendar-rethink.md AC19, AC29,
-- AC30, §Sharing "Preview as" and "Shared with you").
--
--   * calendar_events_visible(ws, from, to, p_as): the CALR-15 masked read,
--     now one body (calendar__events_visible_for) run for a viewer. With p_as
--     it is Preview as: p_as's own read, cut to the caller's events on the
--     caller's calendars. Nothing for API keys or a p_as without Calendar.
--   * calendar_busy_blocks(ws, from, to, p_as): the Busy only stream, gated on
--     Calendar (a key without it read blocks before), with the calendar's
--     owner, the kind and all-day, and repeats expanded in the event owner's
--     zone (calendar__occurrences, on the tasks RRULE engine).
--   * calendar_preview_levels(ws, p_as): p_as's level on each of your calendars.
--   * calendar_shared_with_me(ws): teammates' calendars you can see, at their level.
-- Re-runnable. The 3-argument forms stay for deployed clients as wrappers
-- with p_as => NULL; p_as has no default, so a 3-argument call is never ambiguous.
-- Test: supabase/tests/calendar_preview_as.test.sql, calendar_busy_blocks_owner.test.sql.

DROP FUNCTION IF EXISTS public.calendar_events_visible(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.calendar_busy_blocks(uuid, timestamptz, timestamptz);

-- Whose eyes a read runs through: the actor, or with p_as a member with
-- Calendar (never for a key). NULL when the read returns nothing.
CREATE OR REPLACE FUNCTION public.calendar__viewer(p_workspace_id uuid, p_as uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.perm_actor_id() IS NULL OR p_workspace_id IS NULL
      OR public.calendar_module_permission(p_workspace_id) NOT IN ('view','edit','admin') THEN NULL
    WHEN p_as IS NULL THEN public.perm_actor_id()
    WHEN public.module_api_key_id() IS NULL
      AND public.module_member_permission(p_workspace_id, p_as, 'calendar') IN ('view','edit','admin') THEN p_as
  END
$$;

-- The masked read for one viewer: the CALR-15 body with the focus mask the
-- focus-time migration (20261029100000) puts on it, so others' focus time
-- reads "Focus time" whichever of the two applies first. A new sensitive
-- column joins the mask list here.
CREATE OR REPLACE FUNCTION public.calendar__events_visible_for(p_viewer uuid, p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS SETOF public.calendar_events LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cals AS (SELECT c.id FROM public.calendars c WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
                  AND public.can_access('calendar', c.id, 'view', p_viewer))
  SELECT (m.r).*
  FROM public.calendar_events e
  CROSS JOIN LATERAL (SELECT CASE WHEN e.owner_id = p_viewer OR (NOT e.is_private AND e.kind <> 'focus') THEN e
     ELSE jsonb_populate_record(e, jsonb_build_object('title',CASE WHEN e.is_private THEN 'Busy' ELSE 'Focus time' END,'description',null,'location',null,'attendees','[]'::jsonb,
       'conference_url',null,'conference_provider',null,'tags','[]'::jsonb,'reminders','[]'::jsonb,'external_event_id',null,
       'external_series_id',null,'focus_task_id',null,'offer_id',null,'color',null)) END AS r) m
  WHERE p_viewer IS NOT NULL AND e.workspace_id = p_workspace_id AND e.deleted_at IS NULL
    AND (e.owner_id = p_viewer OR e.calendar_ref IN (SELECT id FROM cals))
    AND (e.recurrence_rule IS NOT NULL OR (e.start_time <= p_to AND e.end_time >= p_from))
  ORDER BY e.start_time, e.id
$$;

-- Each occurrence of an event overlapping [from, to): a repeat expanded as
-- the zone's wall clock (DST-correct), COUNT/UNTIL honoured, exdates skipped,
-- at most 200 past the window's start; no rule or an unparseable one is a one-off.
CREATE OR REPLACE FUNCTION public.calendar__occurrences(p_start timestamptz, p_end timestamptz, p_rule text,
  p_exdates timestamptz[], p_zone text, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (o_start timestamptz, o_end timestamptz) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_start, p_end WHERE public.tasks__rrule_parse(p_rule) IS NULL AND p_start < p_to AND p_end > p_from
  UNION ALL
  SELECT o.s, o.s + (p_end - p_start)
  FROM (SELECT public.tasks__rrule_parse(p_rule) AS p, p_start AT TIME ZONE z AS t0, z
        FROM (SELECT coalesce(nullif(p_zone, ''), 'UTC') AS z) q) r
  CROSS JOIN LATERAL public.tasks__rrule_days(r.p, r.t0,
    CASE WHEN r.p ? 'count' THEN r.t0::date ELSE ((p_from AT TIME ZONE r.z) - (p_end - p_start))::date - 1 END,
    least((p_to AT TIME ZONE r.z)::date, r.t0::date + 7300), false, coalesce((r.p ->> 'count')::integer, 200)) d
  CROSS JOIN LATERAL (SELECT (d + (r.t0 - date_trunc('day', r.t0))) AT TIME ZONE r.z AS s) o
  WHERE r.p IS NOT NULL AND o.s < p_to AND o.s + (p_end - p_start) > p_from
    AND (r.p ->> 'until' IS NULL OR o.s <= (r.p ->> 'until')::timestamp AT TIME ZONE 'UTC')
    AND NOT (o.s = ANY (p_exdates))
$$;

CREATE OR REPLACE FUNCTION public.calendar_events_visible(p_workspace_id uuid, p_from timestamptz, p_to timestamptz, p_as uuid)
RETURNS SETOF public.calendar_events LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.* FROM public.calendar__events_visible_for(public.calendar__viewer(p_workspace_id, p_as), p_workspace_id, p_from, p_to) v
  WHERE p_as IS NULL OR (v.owner_id = public.perm_actor_id() AND EXISTS (
    SELECT 1 FROM public.calendars c WHERE c.id = v.calendar_ref AND c.owner_id = public.perm_actor_id()))
$$;

CREATE OR REPLACE FUNCTION public.calendar_busy_blocks(p_workspace_id uuid, p_from timestamptz, p_to timestamptz, p_as uuid)
RETURNS TABLE (calendar_id uuid, owner_id uuid, start_time timestamptz, end_time timestamptz, kind text, all_day boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT public.calendar__viewer(p_workspace_id, p_as) AS id),
  cals AS (SELECT c.id, c.owner_id FROM public.calendars c, v
           WHERE v.id IS NOT NULL AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
             AND (p_as IS NULL OR c.owner_id = public.perm_actor_id())
             AND public.can_access('calendar', c.id, 'freebusy', v.id)
             AND NOT public.can_access('calendar', c.id, 'view', v.id))
  SELECT c.id, c.owner_id, o.o_start, o.o_end, e.kind, e.all_day
  FROM public.calendar_events e
  JOIN cals c ON c.id = e.calendar_ref
  LEFT JOIN public.user_preferences up ON up.user_id = e.owner_id
  -- An all-day repeat is a run of dates: expanded in UTC, where its midnights are stored.
  CROSS JOIN LATERAL public.calendar__occurrences(e.start_time, e.end_time, e.recurrence_rule, e.exdates,
    CASE WHEN e.all_day THEN 'UTC' ELSE up.time_zone END, p_from, p_to) o
  WHERE e.workspace_id = p_workspace_id AND e.deleted_at IS NULL
    -- One-offs outside the window never reach the expander (a mirrored calendar holds thousands).
    AND (e.recurrence_rule IS NOT NULL OR (e.start_time < p_to AND e.end_time > p_from))
    AND (p_as IS NULL OR e.owner_id = public.perm_actor_id())
  ORDER BY o.o_start, c.id
$$;

CREATE FUNCTION public.calendar_events_visible(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS SETOF public.calendar_events LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.calendar_events_visible(p_workspace_id, p_from, p_to, NULL::uuid)
$$;

CREATE FUNCTION public.calendar_busy_blocks(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (calendar_id uuid, owner_id uuid, start_time timestamptz, end_time timestamptz, kind text, all_day boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.calendar_busy_blocks(p_workspace_id, p_from, p_to, NULL::uuid)
$$;

CREATE OR REPLACE FUNCTION public.calendar_preview_levels(p_workspace_id uuid, p_as uuid)
RETURNS TABLE (calendar_id uuid, level text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, CASE WHEN public.can_access('calendar', c.id, 'view', p_as) THEN 'view'
                    WHEN public.can_access('calendar', c.id, 'freebusy', p_as) THEN 'freebusy' ELSE 'none' END
  FROM public.calendars c
  WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND c.owner_id = public.perm_actor_id()
    AND public.module_api_key_id() IS NULL AND public.calendar__viewer(p_workspace_id, NULL) IS NOT NULL
  ORDER BY c.name
$$;

CREATE OR REPLACE FUNCTION public.calendar_shared_with_me(p_workspace_id uuid)
RETURNS TABLE (calendar_id uuid, owner_id uuid, level text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.owner_id, CASE WHEN public.can_access('calendar', c.id, 'view') THEN 'view' ELSE 'freebusy' END
  FROM public.calendars c
  WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND c.owner_id <> public.perm_actor_id()
    AND public.calendar__viewer(p_workspace_id, NULL) IS NOT NULL
    AND public.can_access('calendar', c.id, 'freebusy')
  ORDER BY c.owner_id, c.name
$$;

REVOKE ALL ON FUNCTION public.calendar__viewer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calendar__events_visible_for(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calendar__occurrences(timestamptz, timestamptz, text, timestamptz[], text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar__viewer(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.calendar__events_visible_for(uuid, uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.calendar__occurrences(timestamptz, timestamptz, text, timestamptz[], text, timestamptz, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_busy_blocks(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_busy_blocks(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_busy_blocks(uuid, timestamptz, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.calendar_preview_levels(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_shared_with_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_busy_blocks(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_preview_levels(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calendar_shared_with_me(uuid) TO authenticated, service_role;
