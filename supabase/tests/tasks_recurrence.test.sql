-- TV-D8 · Recurrence on the server
-- (supabase/migrations/20261010161000_tasks_recurrence_server.sql).
-- specs/tasks-v3.md AC map: "complete on Home / MCP never reopens today"
-- (AC1.2), plus the engine's parity with rrule.js, the roll-over at each
-- assignee's midnight, completion history and its erasure (#26).
--
-- Cast: O owns workspace W. A, B and E are members, V a viewer. A's zone is
-- picked so it is about noon there now, B's so it is about 18:00: B's next
-- midnight always comes before A's. K is an API key E made (Tasks at Edit).

CREATE FUNCTION test.zone_at_local_hour(p_hour integer) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v integer := (((p_hour - extract(hour FROM now() AT TIME ZONE 'UTC')::integer) % 24) + 24) % 24;
BEGIN
  IF v > 12 THEN v := v - 24; END IF;
  RETURN CASE WHEN v = 0 THEN 'Etc/GMT' WHEN v > 0 THEN 'Etc/GMT-' || v ELSE 'Etc/GMT+' || (-v) END;
END;
$$;
CREATE FUNCTION test.at_local(p_day date, p_time time, p_zone text) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (p_day + p_time) AT TIME ZONE p_zone
$$;
CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.pointer(p_name text) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (recurrence ->> 'nextOccurrence')::timestamptz FROM public.tasks WHERE id = test.id(p_name)
$$;
-- A daily repeat at 06:00 in a zone, started three days ago, pending today's
-- occurrence (as the app's capture leaves it).
CREATE FUNCTION test.daily(p_name text, p_who text, p_zone text, p_rule text DEFAULT 'FREQ=DAILY',
                           p_mode text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_today date := (now() AT TIME ZONE p_zone)::date;
  v_start timestamptz := test.at_local(v_today - 3, '06:00', p_zone);
  v_occ timestamptz := test.at_local(v_today, '06:00', p_zone);
  v_rec jsonb := jsonb_strip_nulls(jsonb_build_object(
    'rrule', p_rule, 'dtstart', public.tasks__iso(v_start), 'nextOccurrence', public.tasks__iso(v_occ),
    'mode', p_mode));
BEGIN
  RETURN test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id('SB'),
                       'scheduled_at', public.tasks__iso(v_occ), 'recurrence', v_rec)));
END;
$$;

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'E', 'V']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Repeats');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-2'),
        '{"tasks": "edit"}'::jsonb, test.id('E'));

-- ── The engine reads rules the way rrule.js does (expected values from rrule.js 2.8) ──
DO $$
BEGIN
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=DAILY;INTERVAL=1","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-11T07:00:00.000Z'::timestamptz,
    'after: daily', public.tasks__rrule_next('{"rrule":"FREQ=DAILY;INTERVAL=1","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;INTERVAL=1","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-10T07:00:00.000Z'::timestamptz,
    'before: daily', public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;INTERVAL=1","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=DAILY;INTERVAL=3","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-13T07:00:00.000Z'::timestamptz,
    'after: every 3 days', public.tasks__rrule_next('{"rrule":"FREQ=DAILY;INTERVAL=3","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;INTERVAL=3","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-10T07:00:00.000Z'::timestamptz,
    'before: every 3 days', public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;INTERVAL=3","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR","dtstart":"2026-10-09T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-09T08:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-12T07:00:00.000Z'::timestamptz,
    'after: workdays from a Friday', public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR","dtstart":"2026-10-09T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-09T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR","dtstart":"2026-10-09T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-09T08:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-09T07:00:00.000Z'::timestamptz,
    'before: workdays from a Friday', public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR","dtstart":"2026-10-09T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-09T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=TU","dtstart":"2026-09-01T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-07T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-13T16:00:00.000Z'::timestamptz,
    'after: every other Tuesday', public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=TU","dtstart":"2026-09-01T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-07T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=TU","dtstart":"2026-09-01T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-07T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-09-29T16:00:00.000Z'::timestamptz,
    'before: every other Tuesday', public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=TU","dtstart":"2026-09-01T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-07T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=1","dtstart":"2026-09-30T09:30:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T09:30:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-21T09:30:00.000Z'::timestamptz,
    'after: weekly, no BYDAY', public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=1","dtstart":"2026-09-30T09:30:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T09:30:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=1","dtstart":"2026-09-30T09:30:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T09:30:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-14T09:30:00.000Z'::timestamptz,
    'before: weekly, no BYDAY', public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=1","dtstart":"2026-09-30T09:30:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T09:30:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;INTERVAL=1","dtstart":"2026-01-31T09:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-03-31T10:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-05-31T09:00:00.000Z'::timestamptz,
    'after: monthly on the 31st skips short months', public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;INTERVAL=1","dtstart":"2026-01-31T09:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-03-31T10:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;INTERVAL=1","dtstart":"2026-01-31T09:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-03-31T10:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-03-31T09:00:00.000Z'::timestamptz,
    'before: monthly on the 31st skips short months', public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;INTERVAL=1","dtstart":"2026-01-31T09:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-03-31T10:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1","dtstart":"2026-10-05T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-11-01T08:00:00.000Z'::timestamptz,
    'after: monthly on the 1st', public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1","dtstart":"2026-10-05T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1","dtstart":"2026-10-05T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL) IS NOT DISTINCT FROM NULL::timestamptz,
    'before: monthly on the 1st', public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1","dtstart":"2026-10-05T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;BYMONTHDAY=-1","dtstart":"2026-01-10T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-02-01T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-02-28T08:00:00.000Z'::timestamptz,
    'after: last day of the month', public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;BYMONTHDAY=-1","dtstart":"2026-01-10T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-02-01T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;BYMONTHDAY=-1","dtstart":"2026-01-10T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-02-01T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-01-31T08:00:00.000Z'::timestamptz,
    'before: last day of the month', public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;BYMONTHDAY=-1","dtstart":"2026-01-10T08:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-02-01T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;BYDAY=2TU","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-11-10T15:00:00.000Z'::timestamptz,
    'after: second Tuesday', public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;BYDAY=2TU","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;BYDAY=2TU","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-13T15:00:00.000Z'::timestamptz,
    'before: second Tuesday', public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;BYDAY=2TU","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-14T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;BYDAY=-1FR","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-31T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-11-27T15:00:00.000Z'::timestamptz,
    'after: last Friday', public.tasks__rrule_next('{"rrule":"FREQ=MONTHLY;BYDAY=-1FR","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-31T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;BYDAY=-1FR","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-31T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-30T15:00:00.000Z'::timestamptz,
    'before: last Friday', public.tasks__rrule_prev('{"rrule":"FREQ=MONTHLY;BYDAY=-1FR","dtstart":"2026-01-01T15:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-31T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=YEARLY","dtstart":"2024-02-29T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2024-03-01T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2028-02-29T10:00:00.000Z'::timestamptz,
    'after: yearly on Feb 29', public.tasks__rrule_next('{"rrule":"FREQ=YEARLY","dtstart":"2024-02-29T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2024-03-01T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=YEARLY","dtstart":"2024-02-29T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2024-03-01T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2024-02-29T10:00:00.000Z'::timestamptz,
    'before: yearly on Feb 29', public.tasks__rrule_prev('{"rrule":"FREQ=YEARLY","dtstart":"2024-02-29T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2024-03-01T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=YEARLY;BYMONTH=3,10;BYMONTHDAY=15","dtstart":"2026-01-01T06:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-16T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2027-03-15T06:00:00.000Z'::timestamptz,
    'after: yearly in March and October on the 15th', public.tasks__rrule_next('{"rrule":"FREQ=YEARLY;BYMONTH=3,10;BYMONTHDAY=15","dtstart":"2026-01-01T06:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-16T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=YEARLY;BYMONTH=3,10;BYMONTHDAY=15","dtstart":"2026-01-01T06:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-16T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-15T06:00:00.000Z'::timestamptz,
    'before: yearly in March and October on the 15th', public.tasks__rrule_prev('{"rrule":"FREQ=YEARLY;BYMONTH=3,10;BYMONTHDAY=15","dtstart":"2026-01-01T06:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-16T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T000000Z","dtstart":"2026-10-06T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-12-09T00:00:00.000Z', NULL) IS NOT DISTINCT FROM NULL::timestamptz,
    'after: until', public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T000000Z","dtstart":"2026-10-06T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-12-09T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T000000Z","dtstart":"2026-10-06T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-12-09T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-12-08T16:00:00.000Z'::timestamptz,
    'before: until', public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T000000Z","dtstart":"2026-10-06T16:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-12-09T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-04T08:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-05T07:00:00.000Z'::timestamptz,
    'after: count, mid-way', public.tasks__rrule_next('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-04T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-04T08:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-04T07:00:00.000Z'::timestamptz,
    'before: count, mid-way', public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-04T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL) IS NOT DISTINCT FROM NULL::timestamptz,
    'after: count, used up', public.tasks__rrule_next('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-05T07:00:00.000Z'::timestamptz,
    'before: count, used up', public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;COUNT=5","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-05T08:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=2","dtstart":"2026-10-10T07:00:00.123Z","nextOccurrence":null}'::jsonb, '2026-10-24T07:00:00.123Z', NULL) IS NOT DISTINCT FROM '2026-11-07T07:00:00.123Z'::timestamptz,
    'after: milliseconds kept', public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=2","dtstart":"2026-10-10T07:00:00.123Z","nextOccurrence":null}'::jsonb, '2026-10-24T07:00:00.123Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=2","dtstart":"2026-10-10T07:00:00.123Z","nextOccurrence":null}'::jsonb, '2026-10-24T07:00:00.123Z', NULL) IS NOT DISTINCT FROM '2026-10-24T07:00:00.123Z'::timestamptz,
    'before: milliseconds kept', public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=2","dtstart":"2026-10-10T07:00:00.123Z","nextOccurrence":null}'::jsonb, '2026-10-24T07:00:00.123Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU","dtstart":"2026-10-04T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-06T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-18T10:00:00.000Z'::timestamptz,
    'after: week starting Sunday', public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU","dtstart":"2026-10-04T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-06T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU","dtstart":"2026-10-04T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-06T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-05T10:00:00.000Z'::timestamptz,
    'before: week starting Sunday', public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU","dtstart":"2026-10-04T10:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-06T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=DAILY;BYDAY=MO,WE,FR","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-12T07:00:00.000Z'::timestamptz,
    'after: daily on some weekdays', public.tasks__rrule_next('{"rrule":"FREQ=DAILY;BYDAY=MO,WE,FR","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;BYDAY=MO,WE,FR","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-09T07:00:00.000Z'::timestamptz,
    'before: daily on some weekdays', public.tasks__rrule_prev('{"rrule":"FREQ=DAILY;BYDAY=MO,WE,FR","dtstart":"2026-10-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=DAILY","dtstart":"2020-01-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-11T07:00:00.000Z'::timestamptz,
    'after: far ahead', public.tasks__rrule_next('{"rrule":"FREQ=DAILY","dtstart":"2020-01-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=DAILY","dtstart":"2020-01-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-10T07:00:00.000Z'::timestamptz,
    'before: far ahead', public.tasks__rrule_prev('{"rrule":"FREQ=DAILY","dtstart":"2020-01-01T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-10T12:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;BYDAY=WE","dtstart":"2026-10-14T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-01T00:00:00.000Z', NULL) IS NOT DISTINCT FROM '2026-10-14T07:00:00.000Z'::timestamptz,
    'after: before DTSTART', public.tasks__rrule_next('{"rrule":"FREQ=WEEKLY;BYDAY=WE","dtstart":"2026-10-14T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-01T00:00:00.000Z', NULL)::text);
  PERFORM test.ok(public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;BYDAY=WE","dtstart":"2026-10-14T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-01T00:00:00.000Z', NULL) IS NOT DISTINCT FROM NULL::timestamptz,
    'before: before DTSTART', public.tasks__rrule_prev('{"rrule":"FREQ=WEEKLY;BYDAY=WE","dtstart":"2026-10-14T07:00:00.000Z","nextOccurrence":null}'::jsonb, '2026-10-01T00:00:00.000Z', NULL)::text);
END;
$$;

-- ── Behaviour ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v_za text := test.zone_at_local_hour(12);
  v_zb text := test.zone_at_local_hour(18);
  v_la date;
  v_lb date;
  v_n integer;
  v_c public.task_completions;
  v_t public.tasks;
BEGIN
  -- Time zones come from the device at sign-in.
  r := test.as_user('A', format($q$SELECT public.user_op_set_time_zone(%L)$q$, v_za));
  PERFORM test.ok(r = 'ok 1' AND (SELECT time_zone FROM public.user_preferences WHERE user_id = test.id('A')) = v_za,
    'a person''s time zone is saved at sign-in', r);
  PERFORM test.as_user('B', format($q$SELECT public.user_op_set_time_zone(%L)$q$, v_zb));
  PERFORM test.as_user('E', format($q$SELECT public.user_op_set_time_zone(%L)$q$, v_za));
  r := test.try('A', $q$SELECT public.user_op_set_time_zone('Mars/Olympus_Mons')$q$);
  PERFORM test.ok(r LIKE '22023%Unknown time zone%', 'an unknown zone is refused', r);
  r := test.run(NULL, $q$SELECT public.user_op_set_time_zone('Europe/Warsaw')$q$, false);
  PERFORM test.ok(r LIKE '42501%', 'only a signed-in person sets a zone', r);
  v_la := (now() AT TIME ZONE v_za)::date;
  v_lb := (now() AT TIME ZONE v_zb)::date;

  -- ── AC1.2: completing a repeat on Home / through MCP never reopens it today ──
  PERFORM test.daily('RA', 'A', v_za);
  PERFORM test.daily('RB', 'B', v_zb);
  -- Home's widget and MCP's calendar_complete_block send no pointer.
  r := test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done', NULL, NULL)$q$, test.id('W'), test.id('RA')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('RA')).status = 'done', 'Home''s complete (no pointer) completes the repeat', r);
  PERFORM test.ok(test.pointer('RA') = test.at_local(v_la + 1, '06:00', v_za),
    'the server moves the pointer to the next occurrence, never one today', test.pointer('RA')::text);
  r := test.as_user('B', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done', NULL, NULL)$q$, test.id('W'), test.id('RB')));
  PERFORM test.ok(test.pointer('RB') = test.at_local(v_lb + 1, '06:00', v_zb), 'the same in B''s zone', test.pointer('RB')::text);

  -- Exactly once: completing again changes nothing.
  r := test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done', NULL, NULL)$q$, test.id('W'), test.id('RA')));
  PERFORM test.ok(test.pointer('RA') = test.at_local(v_la + 1, '06:00', v_za)
              AND (SELECT count(*) FROM public.task_completions WHERE task_id = test.id('RA')) = 1
              AND (SELECT count(*) FROM public.module_activity WHERE entity_id = test.id('RA') AND op = 'tasks.set_status') = 1,
    'completing again moves nothing and records nothing');
  SELECT * INTO v_c FROM public.task_completions WHERE task_id = test.id('RA');
  PERFORM test.ok(v_c.user_id = test.id('A') AND v_c.workspace_id = test.id('W') AND v_c.deleted_at IS NULL
              AND v_c.cycle_key = public.tasks__iso(test.at_local(v_la, '06:00', v_za)),
    'the completion is recorded: who, when, which occurrence', v_c.cycle_key);

  -- A reload the same day leaves it done: the server roll-over…
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), now());
  PERFORM test.ok((test.task('RA')).status = 'done' AND (test.task('RB')).status = 'done', 'the roll-over leaves it done today');
  -- …and an old build's catch-up, which asks to reopen it.
  r := test.as_user('A', format($q$SELECT * FROM public.tasks_op_catch_up(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_array(jsonb_build_object('task_id', test.id('RA'), 'kind', 'reopen', 'status', 'todo',
      'scheduled_at', public.tasks__iso(now()), 'recurrence', (test.task('RA')).recurrence, 'clear_commit', true))));
  PERFORM test.ok(r = 'ok 1' AND (test.task('RA')).status = 'done',
    'an old build''s catch-up can''t reopen it; the op answers with the server''s row', r);

  -- It comes back at its assignee's midnight: B's comes first.
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), public.tasks__local_midnight(v_lb + 1, v_zb) + interval '1 minute');
  PERFORM test.ok((test.task('RB')).status = 'todo' AND (test.task('RA')).status = 'done',
    'at B''s midnight B''s repeat comes back and A''s stays done (A''s day isn''t over)');
  PERFORM test.ok((test.task('RB')).scheduled_at = test.at_local(v_lb + 1, '06:00', v_zb)
              AND test.pointer('RB') = test.at_local(v_lb + 2, '06:00', v_zb),
    'it comes back at its next occurrence, with the pointer after that');
  PERFORM test.ok((SELECT actor_label || ':' || (payload ->> 'kind') FROM public.module_activity
                   WHERE entity_id = test.id('RB') AND op = 'tasks.catch_up') = 'Moduo:reopen',
    'the trail says Moduo brought it back');
  PERFORM test.ok((SELECT count(*) FROM public.task_completions WHERE task_id = test.id('RB') AND deleted_at IS NULL) = 1,
    'coming back keeps the completion');
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), public.tasks__local_midnight(v_la + 1, v_za) - interval '1 minute');
  PERFORM test.ok((test.task('RA')).status = 'done', 'a minute before A''s midnight it is still done');
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), public.tasks__local_midnight(v_la + 1, v_za) + interval '1 minute');
  PERFORM test.ok((test.task('RA')).status = 'todo' AND (test.task('RA')).scheduled_at = test.at_local(v_la + 1, '06:00', v_za),
    'a minute after A''s midnight it is back, for tomorrow 06:00');

  -- ── Every path computes the pointer ───────────────────────────────────────
  -- The app sends its own pointer: a wrong one (later today) is ignored.
  PERFORM test.daily('RC', 'A', v_za);
  r := test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done', %L::jsonb, NULL)$q$, test.id('W'), test.id('RC'),
    (test.task('RC')).recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(test.at_local(v_la, '23:00', v_za)))));
  PERFORM test.ok(test.pointer('RC') = test.at_local(v_la + 1, '06:00', v_za), 'a client''s pointer is replaced by the server''s', r);
  -- A field patch with a status.
  PERFORM test.daily('RD', 'A', v_za);
  r := test.as_user('A', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status": "done"}'::jsonb)$q$, test.id('W'), test.id('RD')));
  PERFORM test.ok(test.pointer('RD') = test.at_local(v_la + 1, '06:00', v_za), 'a field patch with a status moves it the same way', r);
  -- An agent (MCP) completing it.
  PERFORM test.daily('RK', 'E', v_za);
  r := test.as_key('K', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done', NULL, NULL)$q$, test.id('W'), test.id('RK')));
  PERFORM test.ok(r = 'ok 1' AND test.pointer('RK') = test.at_local(v_la + 1, '06:00', v_za)
              AND (SELECT user_id FROM public.task_completions WHERE task_id = test.id('RK')) = test.id('E'),
    'an agent''s complete moves it too, recorded as the key''s creator', r);

  -- Reopened by hand: the completion is taken back.
  r := test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'todo', NULL, NULL)$q$, test.id('W'), test.id('RC')));
  PERFORM test.ok((SELECT count(*) FROM public.task_completions WHERE task_id = test.id('RC') AND deleted_at IS NULL) = 0
              AND (SELECT count(*) FROM public.task_completions WHERE task_id = test.id('RC')) = 1,
    'reopening by hand takes the completion back (kept as deleted)', r);

  -- A one-off task: one completion per time it is done.
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_create(%L, '{"id": %s, "title": "Once", "bucket_id": %s}'::jsonb)$q$,
    test.id('W'), to_json(test.id('T1')::text), to_json(test.id('SB')::text)));
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done')$q$, test.id('W'), test.id('T1')));
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'todo')$q$, test.id('W'), test.id('T1')));
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done')$q$, test.id('W'), test.id('T1')));
  PERFORM test.ok((SELECT count(*) FROM public.task_completions WHERE task_id = test.id('T1') AND deleted_at IS NULL AND cycle_key = 'once') = 1
              AND (SELECT count(*) FROM public.task_completions WHERE task_id = test.id('T1')) = 2,
    'a one-off task records each completion; an undone one is kept as deleted');

  -- "After completion": counted from the day it was done.
  PERFORM test.daily('RX', 'A', v_za, 'FREQ=DAILY;INTERVAL=3', 'after_completion');
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done')$q$, test.id('W'), test.id('RX')));
  PERFORM test.ok(test.pointer('RX') = test.at_local(v_la + 3, '06:00', v_za),
    '"every 3 days after completion" comes back 3 days after the day it was done', test.pointer('RX')::text);

  -- A rule the server can't read keeps the app's pointer.
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), jsonb_build_object(
    'id', test.id('RH'), 'title', 'Hourly', 'bucket_id', test.id('SB'),
    'recurrence', jsonb_build_object('rrule', 'FREQ=HOURLY', 'dtstart', public.tasks__iso(now()), 'nextOccurrence', NULL))));
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_set_status(%L, %L, 'done', %L::jsonb, NULL)$q$, test.id('W'), test.id('RH'),
    jsonb_build_object('rrule', 'FREQ=HOURLY', 'dtstart', public.tasks__iso(now()), 'nextOccurrence', '2030-01-01T00:00:00.000Z')));
  PERFORM test.ok(test.pointer('RH') = '2030-01-01T00:00:00Z'::timestamptz, 'an unsupported rule keeps the app''s pointer');

  -- ── Open repeats that missed a whole day move to today's occurrence ──────
  PERFORM test.daily('RO', 'A', v_za);
  PERFORM test.as_op('A', format($q$UPDATE public.tasks SET scheduled_at = %L WHERE id = %L$q$,
    test.at_local(v_la - 2, '06:00', v_za), test.id('RO')));
  PERFORM test.daily('RT', 'A', v_za);
  PERFORM test.as_op('A', format($q$UPDATE public.tasks SET scheduled_at = %L WHERE id = %L$q$,
    test.at_local(v_la, '04:00', v_za), test.id('RT')));
  PERFORM test.daily('RN', 'A', v_za);
  PERFORM test.as_op('A', format($q$UPDATE public.tasks SET scheduled_at = NULL WHERE id = %L$q$, test.id('RN')));
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), now());
  PERFORM test.ok((test.task('RO')).scheduled_at = test.at_local(v_la, '06:00', v_za)
              AND (SELECT payload ->> 'kind' FROM public.module_activity WHERE entity_id = test.id('RO') AND op = 'tasks.catch_up') = 'collapse',
    'an open repeat two days behind moves to today''s occurrence (one quiet move, no pile)');
  PERFORM test.ok((test.task('RT')).scheduled_at = test.at_local(v_la, '04:00', v_za),
    'a time moved within today is left alone');
  PERFORM test.ok((test.task('RN')).scheduled_at = test.at_local(v_la, '06:00', v_za),
    'a repeat with no time gets today''s occurrence');

  -- ── The catch-up op runs as system work but answers only with what you see ──
  PERFORM test.as_op('O', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title, status, assignee_id, scheduled_at, recurrence)
      VALUES (%L, %L, %L, 'Private repeat', 'done', %L, %L, %L::jsonb)$q$,
    test.id('RP'), test.id('W'), test.id('PB'), test.id('O'), now() - interval '3 days',
    jsonb_build_object('rrule', 'FREQ=DAILY', 'dtstart', public.tasks__iso(now() - interval '10 days'),
                       'nextOccurrence', public.tasks__iso(now() - interval '2 days'))));
  INSERT INTO public.task_completions (workspace_id, task_id, user_id, completed_at, cycle_key)
  VALUES (test.id('W'), test.id('RP'), test.id('O'), now() - interval '3 days', 'x');
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_catch_up(%L, '[]'::jsonb) WHERE id = %L$q$, test.id('W'), test.id('RP')));
  PERFORM test.ok(r = 'ok 0' AND (test.task('RP')).status = 'todo',
    'a member''s catch-up rolls over a private repeat but never returns it to them', r);
  r := test.try('V', format($q$SELECT * FROM public.tasks_op_catch_up(%L, '[]'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%edit access to Tasks%', 'a viewer''s app doesn''t run the catch-up', r);

  PERFORM test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasks-roll-over' AND schedule = '*/15 * * * *'),
    'the roll-over runs every 15 minutes');

  -- ── Completions are read by those who see the task, and erased with the person ──
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*) FROM public.task_completions WHERE task_id = %L$q$, test.id('RA'))) = '1',
    'a teammate who sees the task sees who completed it');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*) FROM public.task_completions WHERE task_id = %L$q$, test.id('RP'))) = '0',
    'nobody sees completions of a task they can''t see');
  r := test.try('A', format($q$INSERT INTO public.task_completions (workspace_id, task_id, cycle_key) VALUES (%L, %L, 'forged')$q$,
    test.id('W'), test.id('RA')));
  PERFORM test.ok(r LIKE '42501%', 'nobody writes a completion directly', r);

  SELECT count(*) INTO v_n FROM public.task_completions WHERE user_id = test.id('B');
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, true) ->> 'task_completions_deleted'$q$, test.id('B')), false);
  PERFORM test.ok(v_n = 1 AND (public.account_erase_workspace_data(test.id('B'), true) ->> 'task_completions_deleted')::integer = 1,
    'the erasure preview counts the person''s completions', r);
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('B')), false);
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.task_completions WHERE user_id = test.id('B'))
              AND EXISTS (SELECT 1 FROM public.task_completions WHERE user_id = test.id('A')),
    'account erasure deletes their completions and no one else''s', r);
END;
$$;
