-- Booking availability counts every occurrence of a repeat.
--
-- booking-public read the host's calendar_events rows directly, so a Moduo
-- repeat counted only at its first stored start: a weekly 1:1 that began weeks
-- ago didn't block this week. calendar__booking_host_events is that read with
-- repeats expanded over the booking window on the same engine as busy blocks
-- (calendar__occurrences: COUNT/UNTIL, exdates, the owner's wall clock across
-- clock changes). A moved or edited occurrence is its own row (series_id +
-- original_start, no repeat) and its original start is an exdate on the
-- series, so it blocks its new time and frees its old one.
--
-- Every kind comes back with its account and calendar: booking-public's
-- busyFromHostEvents decides which rows the link counts (focus only with
-- "focus" in its busy list). The host's saved zone wins; p_zone (the link's
-- host zone) stands in when they have none. Server only: booking-public calls
-- it with the service role.
-- Test: supabase/tests/booking_host_events.test.sql.

CREATE OR REPLACE FUNCTION public.calendar__booking_host_events(p_workspace_id uuid, p_owner_id uuid,
  p_from timestamptz, p_to timestamptz, p_zone text)
RETURNS TABLE (start_time timestamptz, end_time timestamptz, source_account_id uuid, calendar_id text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.o_start, o.o_end, e.source_account_id, e.calendar_id, e.kind
  FROM public.calendar_events e
  LEFT JOIN public.user_preferences up ON up.user_id = e.owner_id
  CROSS JOIN LATERAL public.calendar__occurrences(e.start_time, e.end_time, e.recurrence_rule,
    coalesce(e.exdates, '{}'), coalesce(nullif(up.time_zone, ''), nullif(p_zone, ''), 'UTC'), p_from, p_to) o
  WHERE e.workspace_id = p_workspace_id AND e.owner_id = p_owner_id AND e.deleted_at IS NULL
    -- One-offs outside the window never reach the expander (a mirrored calendar holds thousands).
    AND (e.recurrence_rule IS NOT NULL OR (e.start_time < p_to AND e.end_time > p_from))
  ORDER BY o.o_start, e.id
$$;

REVOKE ALL ON FUNCTION public.calendar__booking_host_events(uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar__booking_host_events(uuid, uuid, timestamptz, timestamptz, text) TO service_role;
