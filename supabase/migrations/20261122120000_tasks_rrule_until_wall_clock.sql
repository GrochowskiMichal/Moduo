-- HV-15 509-4: a repeat's UNTIL is the person's wall clock, as written.
--
-- The repeat picker writes "Ends on Dec 15" as UNTIL=20261215T235959Z: the end
-- of the person's local day, its digits their wall clock (apps/app/src/features/
-- tasks/repeat.ts specToRrule). tasks__rrule_floating read those digits as a
-- UTC instant and converted it to the zone's wall clock a second time, so the
-- end moved by the zone's offset: west of UTC the last day's evening
-- occurrence never came (Los Angeles, 6 PM: no Dec 15), east of UTC a day came
-- back (Auckland, 9 AM: Dec 16 too). UNTIL now passes through untouched, next to
-- the floated DTSTART; the client engine (recurrence-engine.ts) reads it the
-- same way since the same change. Rules the app's repeat picker saved need no
-- rewrite: their digits always were the picked local day. A rule an agent
-- wrote through the connector with a real UTC UNTIL (…Z) before this change now
-- ends shifted by the zone's offset; the connector converts UNTIL to the
-- person's wall clock from this change on (moduo-mcp tasks-helpers.ts
-- untilToWallClock), and capture, importers and templates never write UNTIL.
--
-- Builds on 20261013111000_recurrence_moves_dst.sql, the only definition.
-- CREATE OR REPLACE with the same signature keeps its grants; they are
-- re-stated below as section 8 there sets them (an internal helper: service
-- role only). Re-runnable.

CREATE OR REPLACE FUNCTION public.tasks__rrule_floating(p_rec jsonb, p_fallback timestamptz, p_zone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_zone text := coalesce(nullif(p_zone, ''), 'UTC');
  v_dt timestamptz;
BEGIN
  IF jsonb_typeof(p_rec) <> 'object' OR v_zone = 'UTC' THEN
    RETURN p_rec;
  END IF;
  v_dt := coalesce(public.tasks__try_ts(p_rec ->> 'dtstart'), p_fallback);
  IF v_dt IS NULL THEN
    RETURN p_rec;
  END IF;
  -- UNTIL (with or without the Z) is already the zone's wall clock: it stays
  -- as written. Only DTSTART, a real instant, is floated.
  RETURN p_rec || jsonb_build_object(
    'dtstart', public.tasks__iso(public.tasks__floating(v_dt, v_zone)));
END;
$$;

COMMENT ON FUNCTION public.tasks__rrule_floating(jsonb, timestamptz, text) IS
  'The rule with DTSTART (else p_fallback) floated to the zone''s wall clock for the floating engine; UNTIL is already wall clock and stays as written (HV-15 509-4). UTC (or no zone) changes nothing.';

REVOKE ALL ON FUNCTION public.tasks__rrule_floating(jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tasks__rrule_floating(jsonb, timestamptz, text) TO service_role;
