-- A calendar you made in Moduo (kind 'custom') can be renamed and deleted from
-- the rail, as a connected one can be removed. Delete takes your own events on it
-- with it (event rows and their registry entries tombstoned with one stamp), and
-- restore is Undo for a day: it revives the calendar and exactly those events, as
-- calendar_op_account_restore does for an account. Two kinds of event never go
-- with it, they move to their owner's Moduo calendar instead: a teammate's (a
-- shared calendar holds other people's work) and a booked one (a tombstoned
-- booking reads as a host cancel and emails its guests). Your Moduo calendar and
-- connected calendars are never touched here.

-- ── Rename ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_op_calendar_rename(
  p_workspace_id uuid,
  p_calendar_id uuid,
  p_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := left(btrim(coalesce(p_name, '')), 80);
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  IF v_name = '' THEN
    RAISE EXCEPTION 'A calendar needs a name.';
  END IF;
  UPDATE public.calendars
     SET name = v_name
   WHERE id = p_calendar_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
     AND kind = 'custom' AND owner_id = public.perm_actor_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar not found in this workspace.';
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'calendar', p_calendar_id, 'calendar.calendar_rename',
    jsonb_build_object('name', v_name)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_op_calendar_rename(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_calendar_rename(uuid, uuid, text) TO authenticated, service_role;

-- ── Delete ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_op_calendar_remove(
  p_workspace_id uuid,
  p_calendar_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.calendars;
  v_event record;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO c FROM public.calendars
   WHERE id = p_calendar_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
     AND kind = 'custom' AND owner_id = public.perm_actor_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar not found in this workspace.';
  END IF;
  -- Its events first, while the calendar is still live: perm_enforce_write lets
  -- the owner write events on it only while it is. The same now() stamps each
  -- tombstoned event and its registry entry, which restore matches on.
  FOR v_event IN
    SELECT e.id, e.owner_id,
           (e.owner_id IS DISTINCT FROM c.owner_id
            OR EXISTS (SELECT 1 FROM public.slot_bookings b WHERE b.calendar_event_id = e.id)) AS keep
      FROM public.calendar_events e
     WHERE e.calendar_ref = c.id AND e.source_account_id IS NULL AND e.deleted_at IS NULL
     ORDER BY e.id
     FOR UPDATE OF e
  LOOP
    IF v_event.keep THEN
      UPDATE public.calendar_events
         SET calendar_ref = public.share_ensure_moduo_calendar(p_workspace_id, v_event.owner_id),
             updated_at = now()
       WHERE id = v_event.id;
    ELSE
      UPDATE public.calendar_events
         SET deleted_at = now(), updated_at = now()
       WHERE id = v_event.id;
      PERFORM public.entities_op_tombstone(p_workspace_id, 'event', v_event.id);
    END IF;
  END LOOP;
  UPDATE public.calendars SET deleted_at = now() WHERE id = c.id;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'calendar', c.id, 'calendar.calendar_remove',
    jsonb_build_object('name', c.name)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_op_calendar_remove(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_calendar_remove(uuid, uuid) TO authenticated, service_role;

-- ── Undo ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_op_calendar_restore(
  p_workspace_id uuid,
  p_calendar_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.calendars;
  v_at timestamptz;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO c FROM public.calendars
   WHERE id = p_calendar_id AND workspace_id = p_workspace_id AND deleted_at IS NOT NULL
     AND kind = 'custom' AND owner_id = public.perm_actor_id()
     -- Undo, not an archive.
     AND deleted_at > now() - interval '1 day'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar not found in this workspace.';
  END IF;
  v_at := c.deleted_at;
  -- The calendar first: perm_enforce_write checks edit on the event's calendar,
  -- which a deleted calendar never grants.
  UPDATE public.calendars SET deleted_at = NULL WHERE id = c.id;
  UPDATE public.entities en
     SET deleted_at = NULL, updated_at = now()
    FROM public.calendar_events e
   WHERE e.calendar_ref = c.id AND e.source_account_id IS NULL AND e.deleted_at = v_at
     AND en.workspace_id = p_workspace_id AND en.entity_type = 'event'
     AND en.entity_id = e.id AND en.deleted_at = v_at;
  UPDATE public.calendar_events
     SET deleted_at = NULL, updated_at = now()
   WHERE calendar_ref = c.id AND source_account_id IS NULL AND deleted_at = v_at;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'calendar', c.id, 'calendar.calendar_restore',
    jsonb_build_object('name', c.name)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_op_calendar_restore(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_calendar_restore(uuid, uuid) TO authenticated, service_role;
