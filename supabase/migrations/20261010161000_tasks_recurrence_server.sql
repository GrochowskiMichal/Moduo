-- TV-D8 · Recurrence on the server (specs/tasks-v3.md block 5, §Assumptions
-- #5, #26, #27; REPLAN §6.2).
--
--   * An occurrence engine in plpgsql for the RRULE subset the app writes and
--     imports need: DAILY / WEEKLY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL,
--     BYDAY (weekdays, workdays, the nth weekday of a month), BYMONTHDAY,
--     BYMONTH, WKST. It reads rules the way rrule.js does (in UTC from
--     DTSTART), so the app's previews and the server agree. A rule outside the
--     subset reads as "unsupported" and the caller's pointer is kept.
--     "After completion" (recurrence.mode = 'after_completion', no picker until
--     TV-D12/TV-U13) counts from the day it was done, in the assignee's zone.
--     Every evaluation is bounded (rule bounds, a 20-year horizon, a step cap),
--     and so is each roll-over run (a batch size and a time budget).
--   * The pointer (recurrence.nextOccurrence) moves only here: when a task is
--     completed or reopened (every path: the app, Home, Focus, MCP,
--     calendar_complete_block) and in the roll-over. A completed repeat stays
--     done for the rest of the day it was done on, and comes back at the
--     assignee's midnight on the day of its next occurrence
--     (user_preferences.time_zone, written by the app at every sign-in; UTC
--     until then). The roll-over runs every 15 minutes (pg_cron), and when an
--     app opens a workspace (tasks_op_catch_up, which no longer takes the
--     client's pass). It also moves an open repeat that missed a whole day
--     forward to today's occurrence ("missed occurrences don't exist").
--   * task_completions: who completed a task and when, per cycle. Reopening
--     takes the last completion back (soft delete); the roll-over doesn't.
--     Erased with the account and exported with the tasks.
--
-- Expand only. Old builds keep their client catch-up call; the op answers with
-- the server's rows instead of acting on what they sent. Verified on the local
-- stack by supabase/tests/tasks_recurrence.test.sql (bun run db:test).

SET LOCAL lock_timeout = '5s';

-- ── 1. Each person's time zone ──────────────────────────────────────────────

ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS time_zone text;

-- The app writes the device's zone at every sign-in (Settings → Time & region
-- adds an override in TV-D14). Only known zone names are kept.
CREATE OR REPLACE FUNCTION public.user_op_set_time_zone(p_time_zone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_zone text := btrim(coalesce(p_time_zone, ''));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to save your time zone.' USING ERRCODE = '42501';
  END IF;
  IF v_zone = '' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_zone) THEN
    RAISE EXCEPTION 'Unknown time zone.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_preferences (user_id, time_zone)
  VALUES (v_user, v_zone)
  ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone
  WHERE public.user_preferences.time_zone IS DISTINCT FROM excluded.time_zone;
  RETURN v_zone;
END;
$$;
REVOKE ALL ON FUNCTION public.user_op_set_time_zone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_op_set_time_zone(text) TO authenticated;

-- ── 2. Small helpers ────────────────────────────────────────────────────────

-- A timestamp from text, or NULL (a stored pointer can be anything an old
-- client wrote).
CREATE OR REPLACE FUNCTION public.tasks__try_ts(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- The app's ISO form (Date#toISOString): 2026-10-11T07:00:00.000Z.
CREATE OR REPLACE FUNCTION public.tasks__iso(p_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- The calendar day of an instant in a zone; an unknown zone reads as UTC.
CREATE OR REPLACE FUNCTION public.tasks__local_date(p_at timestamptz, p_zone text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (p_at AT TIME ZONE coalesce(nullif(p_zone, ''), 'UTC'))::date;
EXCEPTION WHEN OTHERS THEN
  RETURN (p_at AT TIME ZONE 'UTC')::date;
END;
$$;

-- Midnight at the start of a day in a zone, as an instant.
CREATE OR REPLACE FUNCTION public.tasks__local_midnight(p_day date, p_zone text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN p_day::timestamp AT TIME ZONE coalesce(nullif(p_zone, ''), 'UTC');
EXCEPTION WHEN OTHERS THEN
  RETURN p_day::timestamp AT TIME ZONE 'UTC';
END;
$$;

-- Whose day a task follows: its assignee's, else its creator's, else UTC.
CREATE OR REPLACE FUNCTION public.tasks__zone_of(p_task public.tasks)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT p.time_zone FROM public.user_preferences p
     WHERE p.user_id = coalesce(p_task.assignee_id, p_task.owner_id)),
    'UTC')
$$;

-- ── 3. The occurrence engine ────────────────────────────────────────────────

-- Every evaluation is bounded. Rules outside the bounds (INTERVAL or COUNT
-- over 1000, UNTIL or DTSTART outside 1900–2200, a long rule or long lists)
-- read as unsupported, and the CHECK on tasks.recurrence refuses storing them
-- (tasks__recurrence_problem, the first TV-D8 migration). The engine jumps to
-- the period an instant falls in arithmetically, then walks at most
-- tasks__rrule_max_steps() periods and never past a 20-year horizon, so one
-- call costs a few hundred small steps at worst.

CREATE OR REPLACE FUNCTION public.tasks__rrule_max_steps()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT 1500 $$;

-- RRULE text → its parts, or NULL when it uses anything outside the subset or
-- the bounds. {freq, interval, count?, until? (UTC wall clock), byday?: [{n,
-- wd}] (wd ISO 1 = Monday; n = 0 for every such weekday), bymonthday?,
-- bymonth?, wkst}.
CREATE OR REPLACE FUNCTION public.tasks__rrule_parse(p_rrule text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_days constant text[] := ARRAY['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  v jsonb := '{"interval": 1, "wkst": 1}'::jsonb;
  v_items text[];
  v_part text;
  v_key text;
  v_val text;
  v_item text;
  v_list jsonb;
  v_m text[];
  v_n integer;
BEGIN
  IF p_rrule IS NULL OR btrim(p_rrule) = '' OR length(p_rrule) > 500 THEN
    RETURN NULL;
  END IF;
  FOREACH v_part IN ARRAY string_to_array(regexp_replace(btrim(p_rrule), '^RRULE:', '', 'i'), ';') LOOP
    CONTINUE WHEN btrim(v_part) = '';
    v_key := upper(btrim(split_part(v_part, '=', 1)));
    v_val := upper(btrim(split_part(v_part, '=', 2)));
    IF v_key = 'FREQ' THEN
      IF v_val NOT IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') THEN
        RETURN NULL;
      END IF;
      v := v || jsonb_build_object('freq', v_val);
    ELSIF v_key = 'INTERVAL' THEN
      IF v_val !~ '^[0-9]{1,4}$' OR v_val::integer NOT BETWEEN 1 AND 1000 THEN
        RETURN NULL;
      END IF;
      v := v || jsonb_build_object('interval', v_val::integer);
    ELSIF v_key = 'COUNT' THEN
      IF v_val !~ '^[0-9]{1,4}$' OR v_val::integer NOT BETWEEN 1 AND 1000 THEN
        RETURN NULL;
      END IF;
      v := v || jsonb_build_object('count', v_val::integer);
    ELSIF v_key = 'UNTIL' THEN
      -- rrule.js reads UNTIL as UTC, with or without the Z.
      v_m := regexp_match(v_val, '^([0-9]{4})([0-9]{2})([0-9]{2})(T([0-9]{2})([0-9]{2})([0-9]{2})Z?)?$');
      IF v_m IS NULL OR v_m[1]::integer NOT BETWEEN 1900 AND 2199 THEN
        RETURN NULL;
      END IF;
      v := v || jsonb_build_object('until', format('%s-%s-%s %s:%s:%s', v_m[1], v_m[2], v_m[3],
        coalesce(v_m[5], '00'), coalesce(v_m[6], '00'), coalesce(v_m[7], '00')));
    ELSIF v_key IN ('BYDAY', 'BYMONTHDAY', 'BYMONTH') THEN
      v_items := string_to_array(v_val, ',');
      IF cardinality(v_items) > 31 THEN
        RETURN NULL;
      END IF;
      v_list := '[]'::jsonb;
      FOREACH v_item IN ARRAY v_items LOOP
        IF v_key = 'BYDAY' THEN
          v_m := regexp_match(btrim(v_item), '^([+-]?[0-9]{1,2})?(MO|TU|WE|TH|FR|SA|SU)$');
          IF v_m IS NULL THEN
            RETURN NULL;
          END IF;
          v_n := coalesce(v_m[1]::integer, 0);
          IF v_n NOT BETWEEN -5 AND 5 THEN
            RETURN NULL;
          END IF;
          v_list := v_list || jsonb_build_array(jsonb_build_object('n', v_n, 'wd', array_position(v_days, v_m[2])));
        ELSE
          IF btrim(v_item) !~ '^[+-]?[0-9]{1,2}$' THEN
            RETURN NULL;
          END IF;
          v_n := btrim(v_item)::integer;
          IF (v_key = 'BYMONTHDAY' AND (v_n = 0 OR v_n NOT BETWEEN -31 AND 31))
             OR (v_key = 'BYMONTH' AND v_n NOT BETWEEN 1 AND 12) THEN
            RETURN NULL;
          END IF;
          v_list := v_list || to_jsonb(v_n);
        END IF;
      END LOOP;
      v := v || jsonb_build_object(lower(v_key), v_list);
    ELSIF v_key = 'WKST' THEN
      IF array_position(v_days, v_val) IS NULL THEN
        RETURN NULL;
      END IF;
      v := v || jsonb_build_object('wkst', array_position(v_days, v_val));
    ELSE
      RETURN NULL;
    END IF;
  END LOOP;
  IF NOT v ? 'freq' THEN
    RETURN NULL;
  END IF;
  -- The nth weekday of a whole year isn't in the subset.
  IF v ->> 'freq' = 'YEARLY' AND v ? 'byday' AND NOT v ? 'bymonth' THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

-- DTSTART as a UTC wall clock, or NULL when missing or out of bounds.
CREATE OR REPLACE FUNCTION public.tasks__rrule_start(p_rec jsonb, p_fallback timestamptz)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN s >= '1900-01-01'::timestamp AND s < '2200-01-01'::timestamp THEN s END
  FROM (SELECT coalesce(public.tasks__try_ts(p_rec ->> 'dtstart'), p_fallback) AT TIME ZONE 'UTC' AS s) x
$$;

-- The days of one month a rule picks (unsorted, may repeat): at most 31 day
-- numbers and 5 per weekday. A weekday with an ordinal counts only in MONTHLY
-- and YEARLY (rrule.js ignores it otherwise, and so does the caller).
CREATE OR REPLACE FUNCTION public.tasks__rrule_month_days(p jsonb, p_month date, p_default_day integer)
RETURNS date[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_last integer := extract(day FROM (p_month + interval '1 month' - interval '1 day'))::integer;
  v_end date := p_month + (v_last - 1);
  v_days date[] := '{}';
  v_by date[] := '{}';
  v_md jsonb;
  v_bd jsonb;
  v_d integer;
  v_wd integer;
  v_n integer;
  v_x date;
  v_has_md boolean := p ? 'bymonthday';
  v_has_bd boolean := p ? 'byday';
BEGIN
  IF v_has_md THEN
    FOR v_md IN SELECT * FROM jsonb_array_elements(p -> 'bymonthday') LOOP
      v_d := (v_md #>> '{}')::integer;
      IF v_d < 0 THEN
        v_d := v_last + v_d + 1;
      END IF;
      IF v_d BETWEEN 1 AND v_last THEN
        v_days := v_days || (p_month + (v_d - 1));
      END IF;
    END LOOP;
  END IF;
  IF v_has_bd THEN
    FOR v_bd IN SELECT * FROM jsonb_array_elements(p -> 'byday') LOOP
      v_wd := (v_bd ->> 'wd')::integer;
      v_n := (v_bd ->> 'n')::integer;
      IF v_n >= 0 THEN
        -- The first such weekday of the month, then every week (n = 0) or the nth.
        v_x := p_month + (((v_wd - extract(isodow FROM p_month)::integer) + 7) % 7);
        IF v_n = 0 THEN
          WHILE v_x <= v_end LOOP
            v_by := v_by || v_x;
            v_x := v_x + 7;
          END LOOP;
        ELSE
          v_x := v_x + 7 * (v_n - 1);
          IF v_x <= v_end THEN
            v_by := v_by || v_x;
          END IF;
        END IF;
      ELSE
        v_x := v_end - (((extract(isodow FROM v_end)::integer - v_wd) + 7) % 7) - 7 * (abs(v_n) - 1);
        IF v_x >= p_month THEN
          v_by := v_by || v_x;
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF v_has_md AND v_has_bd THEN
    RETURN ARRAY(SELECT x FROM unnest(v_days) x WHERE x = ANY (v_by));
  ELSIF v_has_md THEN
    RETURN v_days;
  ELSIF v_has_bd THEN
    RETURN v_by;
  ELSIF p_default_day BETWEEN 1 AND v_last THEN
    RETURN ARRAY[p_month + (p_default_day - 1)];
  END IF;
  RETURN '{}';
END;
$$;

-- The first day of period k (0 = DTSTART's day, week, month or year).
CREATE OR REPLACE FUNCTION public.tasks__rrule_period_start(p jsonb, p_dt0 timestamp, p_k integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_int integer := (p ->> 'interval')::integer;
  v_day0 date := p_dt0::date;
BEGIN
  CASE p ->> 'freq'
    WHEN 'DAILY' THEN
      RETURN v_day0 + p_k * v_int;
    WHEN 'WEEKLY' THEN
      RETURN v_day0 - ((extract(isodow FROM v_day0)::integer - (p ->> 'wkst')::integer + 7) % 7)
             + 7 * p_k * v_int;
    WHEN 'MONTHLY' THEN
      RETURN (date_trunc('month', v_day0) + make_interval(months => p_k * v_int))::date;
    ELSE
      RETURN make_date(extract(year FROM v_day0)::integer + p_k * v_int, 1, 1);
  END CASE;
END;
$$;

-- The occurrences of period k, in order, as UTC wall-clock times. Not yet cut
-- by DTSTART, UNTIL or COUNT.
CREATE OR REPLACE FUNCTION public.tasks__rrule_period(p jsonb, p_dt0 timestamp, p_k integer)
RETURNS timestamp[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_freq text := p ->> 'freq';
  v_tod interval := p_dt0 - date_trunc('day', p_dt0);
  v_day0 date := p_dt0::date;
  v_start date := public.tasks__rrule_period_start(p, p_dt0, p_k);
  v_plain integer[];
  v_months integer[];
  v_days date[] := '{}';
  v_d date;
  v_mon integer;
BEGIN
  -- Plain weekdays (ordinals ignored outside MONTHLY / YEARLY, as in rrule.js).
  IF p ? 'byday' THEN
    v_plain := ARRAY(SELECT (e ->> 'wd')::integer FROM jsonb_array_elements(p -> 'byday') e
                     WHERE v_freq IN ('DAILY', 'WEEKLY') OR (e ->> 'n')::integer = 0);
  END IF;
  IF p ? 'bymonth' THEN
    v_months := ARRAY(SELECT (e #>> '{}')::integer FROM jsonb_array_elements(p -> 'bymonth') e);
  END IF;

  IF v_freq = 'DAILY' THEN
    IF (v_plain IS NULL OR extract(isodow FROM v_start)::integer = ANY (v_plain))
       AND (v_months IS NULL OR extract(month FROM v_start)::integer = ANY (v_months))
       AND (NOT p ? 'bymonthday' OR v_start = ANY (public.tasks__rrule_month_days(
             jsonb_build_object('bymonthday', p -> 'bymonthday'), date_trunc('month', v_start)::date, 0))) THEN
      v_days := ARRAY[v_start];
    END IF;
  ELSIF v_freq = 'WEEKLY' THEN
    IF v_plain IS NULL THEN
      v_plain := ARRAY[extract(isodow FROM v_day0)::integer];
    END IF;
    FOR i IN 0 .. 6 LOOP
      v_d := v_start + i;
      IF extract(isodow FROM v_d)::integer = ANY (v_plain)
         AND (v_months IS NULL OR extract(month FROM v_d)::integer = ANY (v_months)) THEN
        v_days := v_days || v_d;
      END IF;
    END LOOP;
  ELSIF v_freq = 'MONTHLY' THEN
    IF v_months IS NULL OR extract(month FROM v_start)::integer = ANY (v_months) THEN
      v_days := public.tasks__rrule_month_days(p, v_start, extract(day FROM v_day0)::integer);
    END IF;
  ELSIF v_freq = 'YEARLY' THEN
    FOREACH v_mon IN ARRAY coalesce(v_months, ARRAY[extract(month FROM v_day0)::integer]) LOOP
      v_days := v_days || public.tasks__rrule_month_days(
        p, make_date(extract(year FROM v_start)::integer, v_mon, 1), extract(day FROM v_day0)::integer);
    END LOOP;
  END IF;

  RETURN ARRAY(SELECT DISTINCT x + v_tod FROM unnest(v_days) x ORDER BY 1);
END;
$$;

-- Which period an instant falls in, by arithmetic (never past it).
CREATE OR REPLACE FUNCTION public.tasks__rrule_period_of(p jsonb, p_dt0 timestamp, p_at timestamp)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_int integer := (p ->> 'interval')::integer;
  v_day0 date := p_dt0::date;
BEGIN
  IF p_at <= p_dt0 THEN
    RETURN 0;
  END IF;
  CASE p ->> 'freq'
    WHEN 'DAILY' THEN
      RETURN (p_at::date - v_day0) / v_int;
    WHEN 'WEEKLY' THEN
      RETURN (p_at::date - public.tasks__rrule_period_start(p, p_dt0, 0)) / (7 * v_int);
    WHEN 'MONTHLY' THEN
      RETURN ((extract(year FROM p_at)::integer - extract(year FROM v_day0)::integer) * 12
              + extract(month FROM p_at)::integer - extract(month FROM v_day0)::integer) / v_int;
    ELSE
      RETURN (extract(year FROM p_at)::integer - extract(year FROM v_day0)::integer) / v_int;
  END CASE;
END;
$$;

-- The first occurrence after p_after (or at it, when inclusive), like
-- rrule.js's after(). DTSTART comes from the rule, else p_fallback (the task's
-- created_at, as in the app). NULL when the rule is unsupported or ends, or
-- when nothing comes within 20 years.
CREATE OR REPLACE FUNCTION public.tasks__rrule_next(p_rec jsonb, p_after timestamptz, p_fallback timestamptz, p_inclusive boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  p jsonb := public.tasks__rrule_parse(p_rec ->> 'rrule');
  v_dt0 timestamp := public.tasks__rrule_start(p_rec, p_fallback);
  v_after timestamp;
  v_horizon date;
  v_until timestamp;
  v_count integer;
  v_seen integer := 0;
  v_k integer;
  v_c timestamp;
BEGIN
  IF p IS NULL OR v_dt0 IS NULL OR p_after IS NULL THEN
    RETURN NULL;
  END IF;
  v_after := greatest(p_after AT TIME ZONE 'UTC', v_dt0 - interval '1 day');
  IF v_after >= '2200-01-01'::timestamp THEN
    RETURN NULL;
  END IF;
  v_horizon := (v_after + interval '20 years')::date;
  v_until := (p ->> 'until')::timestamp;
  v_count := (p ->> 'count')::integer;
  -- A counted rule is walked from its start (at most COUNT ≤ 1000 occurrences);
  -- any other jumps straight to the period p_after falls in.
  v_k := CASE WHEN v_count IS NULL
              THEN greatest(public.tasks__rrule_period_of(p, v_dt0, v_after) - 1, 0) ELSE 0 END;
  FOR i IN 0 .. public.tasks__rrule_max_steps() LOOP
    IF public.tasks__rrule_period_start(p, v_dt0, v_k + i) > v_horizon THEN
      RETURN NULL;
    END IF;
    FOREACH v_c IN ARRAY public.tasks__rrule_period(p, v_dt0, v_k + i) LOOP
      CONTINUE WHEN v_c < v_dt0;
      IF v_until IS NOT NULL AND v_c > v_until THEN
        RETURN NULL;
      END IF;
      IF v_count IS NOT NULL THEN
        v_seen := v_seen + 1;
        IF v_seen > v_count THEN
          RETURN NULL;
        END IF;
      END IF;
      IF v_c > v_after OR (p_inclusive AND v_c = v_after) THEN
        RETURN v_c AT TIME ZONE 'UTC';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$;

-- The last occurrence at or before p_at, like rrule.js's before(at, true).
-- NULL when there is none within the 20 years before p_at.
CREATE OR REPLACE FUNCTION public.tasks__rrule_prev(p_rec jsonb, p_at timestamptz, p_fallback timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  p jsonb := public.tasks__rrule_parse(p_rec ->> 'rrule');
  v_dt0 timestamp := public.tasks__rrule_start(p_rec, p_fallback);
  v_at timestamp;
  v_floor date;
  v_until timestamp;
  v_count integer;
  v_seen integer := 0;
  v_k integer;
  v_c timestamp;
  v_best timestamp;
  v_list timestamp[];
BEGIN
  IF p IS NULL OR v_dt0 IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;
  v_at := least(p_at AT TIME ZONE 'UTC', '2200-01-01'::timestamp);
  IF v_at < v_dt0 THEN
    RETURN NULL;
  END IF;
  v_until := (p ->> 'until')::timestamp;
  v_count := (p ->> 'count')::integer;
  IF v_count IS NOT NULL THEN
    -- Counted rules: walk from the start; COUNT ≤ 1000 ends it soon.
    FOR i IN 0 .. public.tasks__rrule_max_steps() LOOP
      FOREACH v_c IN ARRAY public.tasks__rrule_period(p, v_dt0, i) LOOP
        CONTINUE WHEN v_c < v_dt0;
        IF v_c > v_at OR (v_until IS NOT NULL AND v_c > v_until) THEN
          RETURN v_best AT TIME ZONE 'UTC';
        END IF;
        v_seen := v_seen + 1;
        IF v_seen > v_count THEN
          RETURN v_best AT TIME ZONE 'UTC';
        END IF;
        v_best := v_c;
      END LOOP;
    END LOOP;
    RETURN v_best AT TIME ZONE 'UTC';
  END IF;
  v_floor := (v_at - interval '20 years')::date;
  v_k := public.tasks__rrule_period_of(p, v_dt0, v_at) + 1;
  FOR i IN 0 .. public.tasks__rrule_max_steps() LOOP
    EXIT WHEN v_k - i < 0;
    -- Periods start in order: once one starts before the floor, stop.
    IF public.tasks__rrule_period_start(p, v_dt0, v_k - i) < v_floor THEN
      RETURN NULL;
    END IF;
    v_list := public.tasks__rrule_period(p, v_dt0, v_k - i);
    FOR j IN REVERSE coalesce(array_length(v_list, 1), 0) .. 1 LOOP
      v_c := v_list[j];
      CONTINUE WHEN v_c > v_at OR (v_until IS NOT NULL AND v_c > v_until);
      IF v_c < v_dt0 THEN
        RETURN NULL;
      END IF;
      RETURN v_c AT TIME ZONE 'UTC';
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$;

-- "After completion": the same time of day as DTSTART, the interval after the
-- day it was done, in the person's zone. Arithmetic only.
CREATE OR REPLACE FUNCTION public.tasks__after_completion_next(p_rec jsonb, p_done_at timestamptz, p_zone text, p_fallback timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  p jsonb := public.tasks__rrule_parse(p_rec ->> 'rrule');
  v_dt0 timestamptz := coalesce(public.tasks__try_ts(p_rec ->> 'dtstart'), p_fallback, p_done_at);
  v_zone text := coalesce(nullif(p_zone, ''), 'UTC');
  v_int integer;
  v_day date;
  v_tod time;
BEGIN
  IF p IS NULL OR p_done_at IS NULL OR p_done_at >= '2200-01-01T00:00:00Z'::timestamptz THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_tod := (v_dt0 AT TIME ZONE v_zone)::time;
  EXCEPTION WHEN OTHERS THEN
    v_zone := 'UTC';
    v_tod := (v_dt0 AT TIME ZONE 'UTC')::time;
  END;
  v_int := (p ->> 'interval')::integer;
  v_day := public.tasks__local_date(p_done_at, v_zone);
  v_day := CASE p ->> 'freq'
    WHEN 'DAILY' THEN v_day + v_int
    WHEN 'WEEKLY' THEN v_day + 7 * v_int
    WHEN 'MONTHLY' THEN (v_day + make_interval(months => v_int))::date
    ELSE (v_day + make_interval(years => v_int))::date
  END;
  RETURN (v_day + v_tod) AT TIME ZONE v_zone;
END;
$$;

-- Where the pointer goes when a repeat is completed now: the next occurrence
-- after the pending one (completing early skips it) or after now (no
-- backfill), and never one on the day it was done in the task's zone (at most
-- two occurrences can share a local day). {supported: false} when the server
-- can't read the rule.
CREATE OR REPLACE FUNCTION public.tasks__pointer_on_complete(p_task public.tasks, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec jsonb := p_task.recurrence;
  v_zone text := public.tasks__zone_of(p_task);
  v_today date := public.tasks__local_date(p_now, v_zone);
  v_next timestamptz;
BEGIN
  IF jsonb_typeof(v_rec) <> 'object' OR public.tasks__rrule_parse(v_rec ->> 'rrule') IS NULL THEN
    RETURN '{"supported": false}'::jsonb;
  END IF;
  IF v_rec ->> 'mode' = 'after_completion' THEN
    v_next := public.tasks__after_completion_next(v_rec, p_now, v_zone, p_task.created_at);
  ELSE
    v_next := public.tasks__rrule_next(v_rec, greatest(p_now, coalesce(p_task.scheduled_at, p_now)),
                                       p_task.created_at);
    FOR i IN 1 .. 4 LOOP
      EXIT WHEN v_next IS NULL OR public.tasks__local_date(v_next, v_zone) > v_today;
      v_next := public.tasks__rrule_next(v_rec, v_next, p_task.created_at);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('supported', true, 'next', public.tasks__iso(v_next));
END;
$$;

-- Where the pointer goes when a completed repeat is reopened by hand (it's
-- open again, so it only says what comes after the pending occurrence).
CREATE OR REPLACE FUNCTION public.tasks__pointer_on_reopen(p_task public.tasks, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec jsonb := p_task.recurrence;
BEGIN
  IF jsonb_typeof(v_rec) <> 'object' OR public.tasks__rrule_parse(v_rec ->> 'rrule') IS NULL THEN
    RETURN '{"supported": false}'::jsonb;
  END IF;
  IF v_rec ->> 'mode' = 'after_completion' THEN
    RETURN jsonb_build_object('supported', true, 'next', NULL);
  END IF;
  RETURN jsonb_build_object('supported', true, 'next', public.tasks__iso(
    public.tasks__rrule_next(v_rec, greatest(p_now, coalesce(p_task.scheduled_at, p_now)), p_task.created_at)));
END;
$$;

-- ── 4. Completion history ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_completions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- Who completed it (an API key: its creator; NULL: a system write).
  user_id      uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  -- The cycle it closes: the occurrence for a repeat, 'once' otherwise.
  cycle_key    text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS task_completions_one_per_cycle
  ON public.task_completions (task_id, cycle_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_completions_workspace_completed
  ON public.task_completions (workspace_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS task_completions_workspace_updated
  ON public.task_completions (workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS task_completions_user
  ON public.task_completions (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_completions_read ON public.task_completions;
CREATE POLICY task_completions_read ON public.task_completions
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks') AND public.can_access('task', task_id, 'view'));
-- Written only by the status op (no insert/update/delete policies).
REVOKE ALL ON public.task_completions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_completions TO authenticated;
GRANT ALL ON public.task_completions TO service_role;

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.task_completions;
CREATE TRIGGER zz_stamp_updated_at
  BEFORE INSERT OR UPDATE ON public.task_completions
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- The cycle a completion closes.
CREATE OR REPLACE FUNCTION public.tasks__cycle_key(p_task public.tasks, p_now timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_task.recurrence) <> 'object' OR p_task.recurrence IS NULL THEN 'once'
    WHEN p_task.scheduled_at IS NOT NULL THEN public.tasks__iso(p_task.scheduled_at)
    ELSE public.tasks__local_date(p_now, public.tasks__zone_of(p_task))::text
  END
$$;

-- ── 5. The status path computes the pointer and keeps the history ───────────

CREATE OR REPLACE FUNCTION public.tasks__apply_status(t public.tasks, p_status text, p_recurrence jsonb, p_position text)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from text := t.status;
  v_rec jsonb := t.recurrence;
  v_pointer jsonb;
  v_now timestamptz := now();
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('todo', 'in_progress', 'done', 'archived') THEN
    RAISE EXCEPTION 'Unknown task status.';
  END IF;
  IF t.status = p_status AND p_position IS NULL THEN
    RETURN t; -- no-op (a client's pointer alone never moves it)
  END IF;

  IF jsonb_typeof(t.recurrence) = 'object' AND v_from IS DISTINCT FROM p_status THEN
    BEGIN
      IF p_status = 'done' THEN
        v_pointer := public.tasks__pointer_on_complete(t, v_now);
      ELSIF v_from = 'done' AND p_status IN ('todo', 'in_progress') THEN
        v_pointer := public.tasks__pointer_on_reopen(t, v_now);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A rule the engine can't evaluate never blocks a status change.
      RAISE NOTICE 'tasks__apply_status: no pointer for task % (%)', t.id, SQLERRM;
      v_pointer := '{"supported": false}'::jsonb;
    END;
    IF v_pointer IS NOT NULL THEN
      IF (v_pointer ->> 'supported')::boolean THEN
        v_rec := t.recurrence || jsonb_build_object('nextOccurrence', v_pointer -> 'next');
      ELSIF jsonb_typeof(p_recurrence) = 'object' THEN
        -- A rule only the app's engine reads: its pointer, as before.
        v_rec := p_recurrence;
      END IF;
    END IF;
  END IF;

  UPDATE public.tasks
    SET status = p_status,
        recurrence = v_rec,
        position = coalesce(p_position, position),
        updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;

  IF v_from IS DISTINCT FROM 'done' AND t.status = 'done' THEN
    INSERT INTO public.task_completions (workspace_id, task_id, user_id, completed_at, cycle_key)
    VALUES (t.workspace_id, t.id, public.perm_actor_id(), v_now, public.tasks__cycle_key(t, v_now))
    ON CONFLICT (task_id, cycle_key) WHERE deleted_at IS NULL DO NOTHING;
  ELSIF v_from = 'done' AND t.status IS DISTINCT FROM 'done' THEN
    -- Reopened by hand: that completion didn't stand.
    UPDATE public.task_completions c SET deleted_at = now()
    WHERE c.id = (SELECT x.id FROM public.task_completions x
                  WHERE x.task_id = t.id AND x.deleted_at IS NULL
                  ORDER BY x.completed_at DESC, x.id DESC LIMIT 1);
  END IF;

  IF v_from IS DISTINCT FROM t.status THEN
    PERFORM public.module_activity_log(
      t.workspace_id, 'tasks', 'task', t.id, 'tasks.set_status',
      jsonb_build_object('from', v_from, 'to', t.status,
                         'next_occurrence', CASE WHEN jsonb_typeof(v_rec) = 'object'
                                                 THEN v_rec ->> 'nextOccurrence' END));
  END IF;
  RETURN t;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__apply_status(public.tasks, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── 6. The roll-over ────────────────────────────────────────────────────────

-- Brings completed repeats back at their assignee's midnight on the day of
-- the next occurrence (never on the day they were done), and moves an open
-- repeat that missed a whole day to today's occurrence (or gives one with no
-- time its occurrence). System work: no permission checks, logged as Moduo.
-- One workspace, or all of them (the cron). Bounded: at most p_limit tasks
-- per run, picked at random among the candidates so none waits forever, and
-- it stops when p_budget is spent; a task whose rule fails is skipped.
DROP FUNCTION IF EXISTS public.tasks__roll_over(uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.tasks__roll_over(
  p_workspace_id uuid DEFAULT NULL,
  p_now timestamptz DEFAULT now(),
  p_limit integer DEFAULT 1000,
  p_budget interval DEFAULT interval '30 seconds')
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_zone text;
  v_today date;
  v_end timestamptz;
  v_pointer timestamptz;
  v_done_at timestamptz;
  v_cur timestamptz;
  v_next timestamptz;
  v_from timestamptz;
  v_kind text;
  v_started timestamptz := clock_timestamp();
  v_changed boolean;
BEGIN
  FOR t IN
    SELECT * FROM public.tasks x
    WHERE (p_workspace_id IS NULL OR x.workspace_id = p_workspace_id)
      AND x.deleted_at IS NULL
      AND jsonb_typeof(x.recurrence) = 'object'
      AND ((x.status = 'done'
            AND coalesce(public.tasks__try_ts(x.recurrence ->> 'nextOccurrence'), '-infinity'::timestamptz)
                < p_now + interval '26 hours')
           OR (x.status IN ('todo', 'in_progress')
               AND coalesce(x.recurrence ->> 'mode', '') <> 'after_completion'
               AND (x.scheduled_at IS NULL OR x.scheduled_at < p_now)))
    -- Coming-back repeats first (they're due at a moment), then the rest.
    ORDER BY (x.status <> 'done'), random()
    LIMIT greatest(coalesce(p_limit, 1000), 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN clock_timestamp() - v_started > p_budget;
    CONTINUE WHEN public.tasks__rrule_parse(t.recurrence ->> 'rrule') IS NULL;
    v_changed := false;
    BEGIN
      v_zone := public.tasks__zone_of(t);
      v_today := public.tasks__local_date(p_now, v_zone);
      v_end := public.tasks__local_midnight(v_today + 1, v_zone) - interval '1 microsecond';
      v_from := t.scheduled_at;

      IF t.status = 'done' THEN
        v_pointer := public.tasks__try_ts(t.recurrence ->> 'nextOccurrence');
        IF v_pointer IS NULL THEN
          -- Completed before pointers were kept: the occurrence after it was done.
          v_pointer := public.tasks__rrule_next(t.recurrence, t.updated_at, t.created_at);
          CONTINUE WHEN v_pointer IS NULL; -- the rule has ended: it stays done
        END IF;
        SELECT max(c.completed_at) INTO v_done_at FROM public.task_completions c
        WHERE c.task_id = t.id AND c.deleted_at IS NULL;
        v_done_at := coalesce(v_done_at, t.updated_at);
        CONTINUE WHEN v_today < public.tasks__local_date(v_pointer, v_zone)
                   OR v_today <= public.tasks__local_date(v_done_at, v_zone);
        IF t.recurrence ->> 'mode' = 'after_completion' THEN
          v_cur := v_pointer;
          v_next := NULL;
        ELSE
          v_cur := public.tasks__rrule_prev(t.recurrence, v_end, t.created_at);
          IF v_cur IS NULL OR v_cur < v_pointer THEN
            v_cur := v_pointer;
          END IF;
          v_next := public.tasks__rrule_next(t.recurrence, v_cur, t.created_at);
        END IF;
        UPDATE public.tasks
          SET status = 'todo',
              scheduled_at = v_cur,
              recurrence = t.recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
              committed_for = NULL,
              commit_order = NULL,
              updated_at = now()
          WHERE id = t.id
          RETURNING * INTO t;
        v_kind := 'reopen';
        v_changed := true;
      ELSE
        v_cur := public.tasks__rrule_prev(t.recurrence, v_end, t.created_at);
        IF t.scheduled_at IS NULL THEN
          v_cur := coalesce(v_cur, public.tasks__rrule_next(t.recurrence, p_now, t.created_at));
          CONTINUE WHEN v_cur IS NULL;
          v_kind := 'adopt';
        ELSE
          CONTINUE WHEN v_cur IS NULL OR v_cur <= t.scheduled_at
                     OR public.tasks__local_date(t.scheduled_at, v_zone) >= public.tasks__local_date(v_cur, v_zone);
          v_kind := 'collapse';
        END IF;
        v_next := public.tasks__rrule_next(t.recurrence, v_cur, t.created_at);
        UPDATE public.tasks
          SET scheduled_at = v_cur,
              recurrence = t.recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
              updated_at = now()
          WHERE id = t.id
          RETURNING * INTO t;
        v_changed := true;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'tasks__roll_over: skipped task % (%)', t.id, SQLERRM;
    END;
    CONTINUE WHEN NOT v_changed;

    -- module_activity_log needs a person or a key; this is Moduo's own work.
    INSERT INTO public.module_activity
      (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
    VALUES (t.workspace_id, 'tasks', 'task', t.id, 'tasks.catch_up', 'agent', NULL, 'Moduo',
            jsonb_build_object('kind', v_kind, 'from', v_from, 'to', t.scheduled_at));
    RETURN NEXT t;
  END LOOP;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks__roll_over(uuid, timestamptz, integer, interval) FROM PUBLIC, anon, authenticated;

-- Old and new apps call this after opening a workspace. It now runs the
-- server's roll-over for the workspace (as system work, so a repeat you can
-- see but not edit no longer refuses the batch) and ignores the client's
-- engine results. It answers with every task it rolled over and every task
-- the caller named, as the server has them, so an old build's optimistic
-- reopen is put back. Only tasks the caller can see come back.
CREATE OR REPLACE FUNCTION public.tasks_op_catch_up(p_workspace_id uuid, p_items jsonb)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_bypass text;
  v_ids uuid[] := '{}';
  t public.tasks;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    SELECT coalesce(array_agg(DISTINCT x.id), '{}') INTO v_ids
    FROM (SELECT public.tasks__try_uuid(e ->> 'task_id') AS id
          FROM jsonb_array_elements(p_items) e) x
    WHERE x.id IS NOT NULL;
  END IF;

  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);
  -- An app's call is small: this workspace, a short batch, a few seconds.
  FOR t IN SELECT * FROM public.tasks__roll_over(p_workspace_id, now(), 300, interval '3 seconds') LOOP
    v_ids := v_ids || t.id;
  END LOOP;
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);

  RETURN QUERY
    SELECT x.* FROM public.tasks x
    WHERE x.workspace_id = p_workspace_id AND x.id = ANY (v_ids) AND x.deleted_at IS NULL
      AND public.can_access('task', x.id, 'view', v_actor)
    ORDER BY x.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tasks__try_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN p_value::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks__try_ts(text)', 'tasks__try_uuid(text)', 'tasks__iso(timestamptz)',
    'tasks__local_date(timestamptz, text)', 'tasks__local_midnight(date, text)',
    'tasks__zone_of(public.tasks)', 'tasks__rrule_parse(text)',
    'tasks__rrule_max_steps()', 'tasks__rrule_start(jsonb, timestamptz)',
    'tasks__rrule_period_start(jsonb, timestamp, integer)',
    'tasks__rrule_month_days(jsonb, date, integer)', 'tasks__rrule_period(jsonb, timestamp, integer)',
    'tasks__rrule_period_of(jsonb, timestamp, timestamp)',
    'tasks__rrule_next(jsonb, timestamptz, timestamptz, boolean)',
    'tasks__rrule_prev(jsonb, timestamptz, timestamptz)',
    'tasks__after_completion_next(jsonb, timestamptz, text, timestamptz)',
    'tasks__pointer_on_complete(public.tasks, timestamptz)',
    'tasks__pointer_on_reopen(public.tasks, timestamptz)',
    'tasks__cycle_key(public.tasks, timestamptz)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END;
$$;

-- ── 7. Every 15 minutes (zones with :30 and :45 offsets) ────────────────────

-- Each run is bounded three ways: 2,000 tasks at most, a 60-second budget the
-- function checks itself, and a statement timeout behind it.
SELECT cron.schedule(
  'tasks-roll-over',
  '*/15 * * * *',
  $cron$SET statement_timeout = '120s'; SELECT count(*) FROM public.tasks__roll_over(NULL, now(), 2000, interval '60 seconds')$cron$
);

-- ── 8. Account erasure covers task_completions (§Assumptions #26) ──────────

-- Production's body (read from the catalog on 2026-10-10: TV-D1's redefinition
-- of PRIV-2a's function), plus the completions the person recorded in other
-- people's workspaces: counted in the preview, deleted with the rest.
CREATE OR REPLACE FUNCTION public.account_erase_workspace_data(p_user uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_owned uuid[];
  r record;
  v_new uuid;
  v_owner uuid;
  i integer;

  v_note_del uuid[] := '{}';     v_note_keep uuid[] := '{}';     v_note_to uuid[] := '{}';
  v_bucket_del uuid[] := '{}';   v_bucket_keep uuid[] := '{}';   v_bucket_to uuid[] := '{}';
  v_task_del uuid[] := '{}';     v_task_move uuid[] := '{}';     v_task_move_to uuid[] := '{}';
  v_contact_del uuid[] := '{}';  v_contact_keep uuid[] := '{}';  v_contact_to uuid[] := '{}';
  v_group_del uuid[] := '{}';    v_group_keep uuid[] := '{}';    v_group_to uuid[] := '{}';
  v_company_del uuid[] := '{}';  v_company_keep uuid[] := '{}';  v_company_to uuid[] := '{}';
  v_event_del uuid[];
  v_calendar_del uuid[];
  v_set_del uuid[];
  v_account_del uuid[];
  v_email_ref_del uuid[];
  v_email_account_del uuid[];
  v_channel_del uuid[];
  v_manager_channel uuid[] := '{}';
  v_manager_to uuid[] := '{}';
  v_task_unassign integer;
  v_notification_state integer;
  v_api_keys integer;
  v_member_grants integer;
  v_email text;
  v_invites integer;
  v_completions integer;
  v_bypass text;

  v_keys text[];        -- 'type:id' of every deleted item
  v_id_texts text[];    -- every deleted id, for activity payloads (target_id)
  v_counts jsonb;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'account_erase_workspace_data: p_user is required';
  END IF;

  -- Workspaces the user owns are left to the auth cascade.
  SELECT coalesce(array_agg(w.id), '{}') INTO v_owned
  FROM public.workspaces w WHERE w.owner_id = p_user;

  -- ── Decide, before anything changes (every decision reads today's access) ──

  FOR r IN
    SELECT n.id, n.workspace_id FROM public.notes n
    WHERE n.created_by = p_user AND n.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('note', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_note_del := v_note_del || r.id;
    ELSE
      v_note_keep := v_note_keep || r.id;
      v_note_to := v_note_to || v_new;
    END IF;
  END LOOP;

  -- The Inbox is only ever its owner's, so it always goes.
  FOR r IN
    SELECT b.id, b.workspace_id FROM public.buckets b
    WHERE b.owner_id = p_user AND b.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('bucket', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_bucket_del := v_bucket_del || r.id;
    ELSE
      v_bucket_keep := v_bucket_keep || r.id;
      v_bucket_to := v_bucket_to || v_new;
    END IF;
  END LOOP;

  -- tasks.bucket_id is RESTRICT: every task in a bucket that goes either moves
  -- (someone else can see it, e.g. an assignee's grant) or goes too.
  FOR r IN
    SELECT t.id, t.workspace_id, t.assignee_id FROM public.tasks t WHERE t.bucket_id = ANY (v_bucket_del)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.resource_grants g
                   WHERE g.resource_type = 'task' AND g.resource_id = r.id) THEN
      -- can_access gives a task its own grants plus its bucket's access, and
      -- nobody else can see this bucket: without a grant the task is private.
      -- (A shortcut, so a big private bucket doesn't cost a search per task.)
      v_new := NULL;
    ELSIF r.assignee_id IS NOT NULL AND r.assignee_id <> p_user
          AND public.can_access('task', r.id, 'view', r.assignee_id) THEN
      -- The teammate it's assigned to keeps it, in their own Inbox.
      v_new := r.assignee_id;
    ELSE
      v_new := public.account_erasure_new_owner('task', r.id, r.workspace_id, p_user);
    END IF;
    IF v_new IS NULL THEN
      v_task_del := v_task_del || r.id;
    ELSE
      v_task_move := v_task_move || r.id;
      v_task_move_to := v_task_move_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.id, c.workspace_id FROM public.contacts c
    WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_contact_del := v_contact_del || r.id;
    ELSE
      v_contact_keep := v_contact_keep || r.id;
      v_contact_to := v_contact_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT g.id, g.workspace_id FROM public.contact_groups g
    WHERE g.owner_id = p_user AND g.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact_group', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_group_del := v_group_del || r.id;
    ELSE
      v_group_keep := v_group_keep || r.id;
      v_group_to := v_group_to || v_new;
    END IF;
  END LOOP;

  -- A company is visible through any contact the viewer can see that points at
  -- it. Contacts that go are private, so they never made a company visible.
  FOR r IN
    SELECT co.id, co.workspace_id FROM public.companies co
    WHERE co.owner_id = p_user AND co.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('company', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_company_del := v_company_del || r.id;
    ELSE
      v_company_keep := v_company_keep || r.id;
      v_company_to := v_company_to || v_new;
    END IF;
  END LOOP;

  -- Every event is filed in its owner's own calendar, so the user's calendars
  -- would only keep an empty name (integration calendars are often named after
  -- an email address). All of it goes.
  SELECT coalesce(array_agg(e.id), '{}') INTO v_event_del
  FROM public.calendar_events e
  WHERE e.owner_id = p_user AND e.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(c.id), '{}') INTO v_calendar_del
  FROM public.calendars c WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(s.id), '{}') INTO v_set_del
  FROM public.calendar_sets s WHERE s.owner_id = p_user AND s.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(a.id), '{}') INTO v_account_del
  FROM public.calendar_accounts a WHERE a.owner_id = p_user AND a.workspace_id <> ALL (v_owned);

  -- Email has no sharing: everything is the owner's alone.
  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_ref_del
  FROM public.email_refs x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_account_del
  FROM public.email_accounts x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  -- Chat rows outlive membership (someone who leaves keeps their chat_members
  -- and manager rows but can't open the workspace), so only people still in the
  -- workspace count below.
  -- A DM or private channel with nobody else still here in it, e.g. their DM
  -- with themselves.
  SELECT coalesce(array_agg(c.id), '{}') INTO v_channel_del
  FROM public.chat_channels c
  WHERE c.workspace_id <> ALL (v_owned)
    AND (c.kind = 'dm' OR c.is_private)
    AND EXISTS (SELECT 1 FROM public.chat_members cm
                WHERE cm.channel_id = c.id AND cm.user_id = p_user)
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_members cm
      WHERE cm.channel_id = c.id AND cm.user_id <> p_user
        AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                     WHERE wm.workspace_id = c.workspace_id AND wm.user_id = cm.user_id)
             OR EXISTS (SELECT 1 FROM public.workspaces w
                        WHERE w.id = c.workspace_id AND w.owner_id = cm.user_id)));

  -- Channels the user managed alone: the workspace owner if they can see the
  -- channel, otherwise the earliest member still here.
  FOR r IN
    SELECT c.id, c.workspace_id, c.is_private
    FROM public.chat_channel_managers m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user
      AND c.workspace_id <> ALL (v_owned)
      AND NOT (c.id = ANY (v_channel_del))
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_channel_managers m2
        WHERE m2.channel_id = c.id AND m2.user_id <> p_user
          AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                       WHERE wm.workspace_id = c.workspace_id AND wm.user_id = m2.user_id)
               OR EXISTS (SELECT 1 FROM public.workspaces w
                          WHERE w.id = c.workspace_id AND w.owner_id = m2.user_id)))
  LOOP
    v_new := NULL;
    SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = r.workspace_id;
    IF v_owner IS NOT NULL AND v_owner <> p_user
       AND (NOT r.is_private OR EXISTS (SELECT 1 FROM public.chat_members cm
                                        WHERE cm.channel_id = r.id AND cm.user_id = v_owner)) THEN
      v_new := v_owner;
    ELSE
      SELECT cm.user_id INTO v_new
      FROM public.chat_members cm
      JOIN public.workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = cm.user_id
      WHERE cm.channel_id = r.id AND cm.user_id <> p_user
      ORDER BY cm.joined_at, cm.user_id
      LIMIT 1;
      IF v_new IS NULL AND NOT r.is_private THEN
        SELECT m.user_id INTO v_new
        FROM public.workspace_members m
        WHERE m.workspace_id = r.workspace_id AND m.user_id <> p_user
        ORDER BY m.joined_at, m.user_id
        LIMIT 1;
      END IF;
    END IF;
    IF v_new IS NOT NULL THEN
      v_manager_channel := v_manager_channel || r.id;
      v_manager_to := v_manager_to || v_new;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_task_unassign
  FROM public.tasks t
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  SELECT count(*) INTO v_notification_state
  FROM public.notification_state s WHERE s.user_id = p_user;

  SELECT count(*) INTO v_api_keys
  FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);

  SELECT count(*) INTO v_member_grants
  FROM public.resource_grants g
  WHERE g.subject_type = 'member' AND g.subject_id = p_user;

  -- Invitations they accepted keep their email address; they have no use once
  -- the person is in (pending ones are the inviter's and stay).
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user;
  SELECT count(*) INTO v_invites
  FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  -- TV-D8: the completions they recorded in other people's workspaces (their
  -- own workspaces' rows go with the workspace).
  SELECT count(*) INTO v_completions
  FROM public.task_completions c
  WHERE c.user_id = p_user AND c.workspace_id <> ALL (v_owned);

  v_counts := jsonb_build_object(
    'preview', p_preview IS NOT FALSE,
    'notes_deleted', cardinality(v_note_del),
    'notes_handed_over', cardinality(v_note_keep),
    'buckets_deleted', cardinality(v_bucket_del),
    'buckets_handed_over', cardinality(v_bucket_keep),
    'tasks_deleted', cardinality(v_task_del),
    'tasks_moved', cardinality(v_task_move),
    'tasks_unassigned', v_task_unassign,
    'contacts_deleted', cardinality(v_contact_del),
    'contacts_handed_over', cardinality(v_contact_keep),
    'contact_groups_deleted', cardinality(v_group_del),
    'contact_groups_handed_over', cardinality(v_group_keep),
    'companies_deleted', cardinality(v_company_del),
    'companies_handed_over', cardinality(v_company_keep),
    'events_deleted', cardinality(v_event_del),
    'calendars_deleted', cardinality(v_calendar_del),
    'calendar_sets_deleted', cardinality(v_set_del),
    'calendar_accounts_deleted', cardinality(v_account_del),
    'email_refs_deleted', cardinality(v_email_ref_del),
    'email_accounts_deleted', cardinality(v_email_account_del),
    'chat_channels_deleted', cardinality(v_channel_del),
    'chat_managers_handed_over', cardinality(v_manager_channel),
    'notification_state_deleted', v_notification_state,
    'api_keys_deleted', v_api_keys,
    'member_grants_deleted', v_member_grants,
    'invites_deleted', v_invites,
    'task_completions_deleted', v_completions
  );

  -- Only an explicit false deletes; NULL previews like the default.
  IF p_preview IS NOT FALSE THEN
    RETURN v_counts;
  END IF;

  -- ── Apply ──────────────────────────────────────────────────────────────────

  -- Restored before returning, so a caller's later statements aren't bypassed.
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);

  -- 1. Shared items get their new owner.
  UPDATE public.notes n SET created_by = x.to_user
  FROM unnest(v_note_keep, v_note_to) AS x(id, to_user) WHERE n.id = x.id;
  UPDATE public.buckets b SET owner_id = x.to_user
  FROM unnest(v_bucket_keep, v_bucket_to) AS x(id, to_user) WHERE b.id = x.id;
  UPDATE public.contacts c SET owner_id = x.to_user
  FROM unnest(v_contact_keep, v_contact_to) AS x(id, to_user) WHERE c.id = x.id;
  UPDATE public.contact_groups g SET owner_id = x.to_user
  FROM unnest(v_group_keep, v_group_to) AS x(id, to_user) WHERE g.id = x.id;
  UPDATE public.companies co SET owner_id = x.to_user
  FROM unnest(v_company_keep, v_company_to) AS x(id, to_user) WHERE co.id = x.id;

  -- 2. Shared tasks leave the buckets that go, into their new owner's Inbox.
  FOR i IN 1 .. cardinality(v_task_move) LOOP
    UPDATE public.tasks t
    SET bucket_id = public.account_erasure_inbox(t.workspace_id, v_task_move_to[i])
    WHERE t.id = v_task_move[i];
  END LOOP;

  -- 3. Tasks assigned to the user are unassigned (the moved ones included).
  UPDATE public.tasks t SET assignee_id = NULL
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  -- 3b. Who completed what (TV-D8), in workspaces they don't own.
  DELETE FROM public.task_completions c
  WHERE c.user_id = p_user AND c.workspace_id <> ALL (v_owned);

  -- 4. Chat: new managers first, then the user's manager rows, then channels
  --    with nobody else in them (members and messages cascade).
  INSERT INTO public.chat_channel_managers (channel_id, user_id)
  SELECT x.channel_id, x.user_id FROM unnest(v_manager_channel, v_manager_to) AS x(channel_id, user_id)
  ON CONFLICT DO NOTHING;
  DELETE FROM public.chat_channel_managers m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND m.user_id = p_user AND c.workspace_id <> ALL (v_owned);
  DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);

  -- 5. What points at the deleted items without a foreign key, addressed as
  --    'type:id' in every type the spine (perm_can_see_entity), activity and
  --    grants use for them.
  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT 'note:' || x AS k FROM unnest(v_note_del) AS x
    UNION ALL SELECT 'bucket:' || x FROM unnest(v_bucket_del) AS x
    UNION ALL SELECT 'task:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'task_project:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'contact:' || x FROM unnest(v_contact_del) AS x
    UNION ALL SELECT 'contact_group:' || x FROM unnest(v_group_del) AS x
    UNION ALL SELECT 'company:' || x FROM unnest(v_company_del) AS x
    UNION ALL SELECT 'event:' || x FROM unnest(v_event_del) AS x
    UNION ALL SELECT 'calendar:' || x FROM unnest(v_calendar_del) AS x
    UNION ALL SELECT 'calendar_set:' || x FROM unnest(v_set_del) AS x
    UNION ALL SELECT 'calendar_account:' || x FROM unnest(v_account_del) AS x
    UNION ALL SELECT 'email_thread:' || x FROM unnest(v_email_ref_del) AS x
    UNION ALL SELECT 'email_account:' || x FROM unnest(v_email_account_del) AS x
    UNION ALL SELECT 'chat_channel:' || x FROM unnest(v_channel_del) AS x
  ) s;

  SELECT coalesce(array_agg(split_part(k, ':', 2)), '{}') INTO v_id_texts
  FROM unnest(v_keys) AS k;

  -- Activity rows (notification state cascades), including links-module rows
  -- whose deleted item is only the payload's target.
  DELETE FROM public.module_activity a
  WHERE (a.entity_type || ':' || a.entity_id) = ANY (v_keys)
     OR (a.payload ->> 'target_id') = ANY (v_id_texts);
  -- Activity only the user could read (RLS shows calendar and email activity to
  -- the actor and the item's owner), also for items removed earlier. A calendar
  -- account's entries carry its label, often an email address.
  DELETE FROM public.module_activity a
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user
    AND (a.entity_type IN ('calendar_account', 'email_account', 'email_thread')
         OR (a.entity_type = 'event' AND NOT EXISTS (
               SELECT 1 FROM public.calendar_events e
               WHERE e.id = a.entity_id AND e.owner_id <> p_user)));
  -- The rest of their activity stays, without their name: module_activity_log
  -- copies the actor's display name into actor_label, and the app shows it.
  UPDATE public.module_activity a SET actor_label = NULL
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user AND a.actor_label IS NOT NULL;
  DELETE FROM public.tag_links tl
  WHERE (tl.entity_type || ':' || tl.entity_id) = ANY (v_keys);
  DELETE FROM public.link_suggestion_declines d
  WHERE split_part(d.pair_key, '|', 1) = ANY (v_keys)
     OR split_part(d.pair_key, '|', 2) = ANY (v_keys);
  -- Entities: their links (either end) and every comment on them cascade.
  DELETE FROM public.entities e
  WHERE (e.entity_type || ':' || e.entity_id) = ANY (v_keys);

  -- 6. The items. Children before parents where a foreign key restricts.
  DELETE FROM public.exposed_notes x WHERE x.note_id = ANY (v_note_del::text[]);
  -- note_shares has a foreign key whose delete rule no migration records.
  DELETE FROM public.note_shares s WHERE s.note_id = ANY (v_note_del);
  -- notes.parent_id is SET NULL: a teammate's sub-note under a deleted note
  -- moves to the top level. note_updates cascade.
  DELETE FROM public.notes n WHERE n.id = ANY (v_note_del);

  UPDATE public.slot_bookings b SET contact_id = NULL WHERE b.contact_id = ANY (v_contact_del);
  UPDATE public.slot_bookings b SET calendar_event_id = NULL WHERE b.calendar_event_id = ANY (v_event_del);

  DELETE FROM public.tasks t WHERE t.id = ANY (v_task_del);
  DELETE FROM public.buckets b WHERE b.id = ANY (v_bucket_del);
  -- Time blocks map a slot to a bucket id; drop the slots of buckets that went.
  UPDATE public.task_time_blocks tb
  SET blocks = coalesce((
        SELECT jsonb_object_agg(j.key, j.value)
        FROM jsonb_each(tb.blocks) AS j
        WHERE NOT coalesce((j.value #>> '{}') = ANY (v_bucket_del::text[]), false)
      ), '{}'::jsonb),
      updated_at = now()
  WHERE EXISTS (SELECT 1 FROM jsonb_each(tb.blocks) AS j
                WHERE (j.value #>> '{}') = ANY (v_bucket_del::text[]));

  -- Group memberships and private notes on contacts cascade; contacts.company_id
  -- is SET NULL.
  DELETE FROM public.contact_groups g WHERE g.id = ANY (v_group_del);
  DELETE FROM public.contacts c WHERE c.id = ANY (v_contact_del);
  DELETE FROM public.companies co WHERE co.id = ANY (v_company_del);

  -- Events before accounts: calendar_events.source_account_id is SET NULL.
  -- Set items cascade; deleting an account also deletes its calendar.
  DELETE FROM public.calendar_events e WHERE e.id = ANY (v_event_del);
  DELETE FROM public.calendar_sets s WHERE s.id = ANY (v_set_del);
  DELETE FROM public.calendars c WHERE c.id = ANY (v_calendar_del);
  DELETE FROM public.calendar_accounts a WHERE a.id = ANY (v_account_del);

  -- email_refs.account_id is SET NULL, so refs go first.
  DELETE FROM public.email_refs x WHERE x.id = ANY (v_email_ref_del);
  DELETE FROM public.email_accounts x WHERE x.id = ANY (v_email_account_del);

  -- 7. Grants on everything that went, every grant to the user, their read
  --    state, the API keys they created (keys stop working without a creator
  --    anyway) and the invitations they accepted.
  DELETE FROM public.resource_grants g
  WHERE (g.resource_type || ':' || g.resource_id) = ANY (v_keys)
     OR (g.subject_type = 'member' AND g.subject_id = p_user);
  DELETE FROM public.notification_state s WHERE s.user_id = p_user;
  DELETE FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);
  DELETE FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN v_counts;
END;
$$;
