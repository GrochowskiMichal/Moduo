-- TV-D14 · Time & region (specs/tasks-v3.md block 29, §14, §Assumptions #17;
-- REPLAN 76; decisions in docs/decisions/tasks.md "TV-D14").
--
-- One personal setting every module reads: the time zone (TV-D8's
-- user_preferences.time_zone, which the server already uses for a repeat's
-- roll-over, reminders and due times), the week start, the 12- or 24-hour
-- clock and the date order; plus "Share my tracked time with the workspace
-- owner" (REPLAN 75), which the time report (the next migration) reads.
--
--   * Plain columns on user_preferences, written by one op
--     (user_op_set_time_region) and read by one (user_time_region), like
--     time_zone and task_time_blocks: never a synced prefs domain, so a prefs
--     push can't carry a stale copy over them.
--   * NULL means "follow the device" for the week start, the clock and the
--     date order.
--   * time_zone_manual: the zone was picked by the person (in Settings, or
--     by answering the travel prompt), or a current build adopted the
--     device's at sign-in. Builds from before this block still send the
--     device's zone at every sign-in through user_op_set_time_zone; once the
--     zone is the person's, that call no longer changes it.
--
-- The Calendar's own week start (`calendar.weekStartsOn`) is not carried
-- over: nothing ever let anyone change it, so its stored value is only the
-- old default (Monday) and would pin it for everyone who opened the Calendar.
--
-- Expand only. Verified on the local stack by supabase/tests/time_report.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 0. Preconditions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regprocedure('public.user_op_set_time_zone(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'user_preferences'
                      AND column_name = 'time_zone') THEN
    RAISE EXCEPTION 'Apply TV-D8 (20261010161000_tasks_recurrence_server) before this migration.';
  END IF;
END;
$$;

-- ── 1. The columns ───────────────────────────────────────────────────────────

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS time_zone_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS week_start smallint,
  ADD COLUMN IF NOT EXISTS hour_cycle text,
  ADD COLUMN IF NOT EXISTS date_order text,
  ADD COLUMN IF NOT EXISTS share_time_with_owner boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_week_start_check') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_week_start_check
      CHECK (week_start IS NULL OR week_start BETWEEN 0 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_hour_cycle_check') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_hour_cycle_check
      CHECK (hour_cycle IS NULL OR hour_cycle IN ('h12','h23'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_date_order_check') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_date_order_check
      CHECK (date_order IS NULL OR date_order IN ('month_day','day_month'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.user_preferences.time_zone_manual IS
  'TV-D14: the zone is the person''s (picked, answered, or adopted by a current build); the old sign-in write no longer changes it.';
COMMENT ON COLUMN public.user_preferences.week_start IS
  'TV-D14: 0 = Sunday … 6 = Saturday; NULL follows the device.';
COMMENT ON COLUMN public.user_preferences.share_time_with_owner IS
  'TV-D14: "Share my tracked time with the workspace owner" (REPLAN 75): owners see this person''s time entries in time reports.';

-- ── 2. A zone name Postgres knows ────────────────────────────────────────────

-- True for a zone `AT TIME ZONE` accepts by name (one try, no catalog scan).
CREATE OR REPLACE FUNCTION public.time_region__zone_ok(p_zone text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_zone IS NULL OR btrim(p_zone) = '' OR length(p_zone) > 64 OR p_zone !~ '^[A-Za-z][A-Za-z0-9_+/-]*$' THEN
    RETURN false;
  END IF;
  PERFORM now() AT TIME ZONE p_zone;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- ── 3. The read ──────────────────────────────────────────────────────────────

-- The signed-in person's Time & region, and their share switch.
CREATE OR REPLACE FUNCTION public.user_time_region()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'time_zone', p.time_zone,
    'time_zone_manual', coalesce(p.time_zone_manual, false),
    'week_start', p.week_start,
    'hour_cycle', p.hour_cycle,
    'date_order', p.date_order,
    'share_time_with_owner', coalesce(p.share_time_with_owner, false))
  FROM (SELECT auth.uid() AS uid) me
  LEFT JOIN public.user_preferences p ON p.user_id = me.uid
  WHERE me.uid IS NOT NULL
$$;

-- ── 4. The write ─────────────────────────────────────────────────────────────

-- Change any of: time_zone (a known zone name; the zone becomes the
-- person's), week_start (0–6, or null for the device's), hour_cycle
-- ('h12' | 'h23' | null), date_order ('month_day' | 'day_month' | null),
-- share_time_with_owner (true | false). Keys left out stay as they are; an
-- unknown key is refused. Answers what user_time_region reads.
CREATE OR REPLACE FUNCTION public.user_op_set_time_region(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_key text;
  v_zone text;
  v_week smallint;
  v_hour text;
  v_order text;
  v_share boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to change Time & region.' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Send the settings to change.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('time_zone', 'week_start', 'hour_cycle', 'date_order', 'share_time_with_owner') THEN
      RAISE EXCEPTION 'Unknown setting: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_patch ? 'time_zone' THEN
    v_zone := btrim(coalesce(p_patch ->> 'time_zone', ''));
    IF jsonb_typeof(p_patch -> 'time_zone') <> 'string' OR NOT public.time_region__zone_ok(v_zone) THEN
      RAISE EXCEPTION 'Unknown time zone.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'week_start' AND jsonb_typeof(p_patch -> 'week_start') <> 'null' THEN
    IF jsonb_typeof(p_patch -> 'week_start') <> 'number'
       OR (p_patch ->> 'week_start') !~ '^[0-6]$' THEN
      RAISE EXCEPTION 'A week starts on a day from 0 (Sunday) to 6 (Saturday).' USING ERRCODE = '22023';
    END IF;
    v_week := (p_patch ->> 'week_start')::smallint;
  END IF;
  IF p_patch ? 'hour_cycle' AND jsonb_typeof(p_patch -> 'hour_cycle') <> 'null' THEN
    v_hour := p_patch ->> 'hour_cycle';
    IF jsonb_typeof(p_patch -> 'hour_cycle') <> 'string' OR v_hour NOT IN ('h12','h23') THEN
      RAISE EXCEPTION 'The clock is 12- or 24-hour.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'date_order' AND jsonb_typeof(p_patch -> 'date_order') <> 'null' THEN
    v_order := p_patch ->> 'date_order';
    IF jsonb_typeof(p_patch -> 'date_order') <> 'string' OR v_order NOT IN ('month_day','day_month') THEN
      RAISE EXCEPTION 'Dates read month first or day first.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'share_time_with_owner' THEN
    IF jsonb_typeof(p_patch -> 'share_time_with_owner') <> 'boolean' THEN
      RAISE EXCEPTION 'Sharing is on or off.' USING ERRCODE = '22023';
    END IF;
    v_share := (p_patch ->> 'share_time_with_owner')::boolean;
  END IF;

  INSERT INTO public.user_preferences (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_preferences p SET
    time_zone = CASE WHEN p_patch ? 'time_zone' THEN v_zone ELSE p.time_zone END,
    time_zone_manual = CASE WHEN p_patch ? 'time_zone' THEN true ELSE p.time_zone_manual END,
    week_start = CASE WHEN p_patch ? 'week_start' THEN v_week ELSE p.week_start END,
    hour_cycle = CASE WHEN p_patch ? 'hour_cycle' THEN v_hour ELSE p.hour_cycle END,
    date_order = CASE WHEN p_patch ? 'date_order' THEN v_order ELSE p.date_order END,
    share_time_with_owner = CASE WHEN p_patch ? 'share_time_with_owner' THEN v_share
                                 ELSE p.share_time_with_owner END
  WHERE p.user_id = v_user;
  RETURN public.user_time_region();
END;
$$;

-- ── 5. The sign-in write of builds from before this block ────────────────────
-- Re-cut from the live body (TV-D8): it still keeps only known zone names, and
-- now leaves a zone that is the person's alone.

CREATE OR REPLACE FUNCTION public.user_op_set_time_zone(p_time_zone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_zone text := btrim(coalesce(p_time_zone, ''));
  v_kept text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to save your time zone.' USING ERRCODE = '42501';
  END IF;
  IF v_zone = '' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_zone) THEN
    RAISE EXCEPTION 'Unknown time zone.' USING ERRCODE = '22023';
  END IF;
  SELECT p.time_zone INTO v_kept FROM public.user_preferences p
  WHERE p.user_id = v_user AND p.time_zone_manual AND p.time_zone IS NOT NULL;
  IF v_kept IS NOT NULL THEN
    RETURN v_kept;
  END IF;
  INSERT INTO public.user_preferences (user_id, time_zone)
  VALUES (v_user, v_zone)
  ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone
  WHERE public.user_preferences.time_zone IS DISTINCT FROM excluded.time_zone;
  RETURN v_zone;
END;
$$;

-- ── 6. Grants ────────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated directly,
-- so they are revoked by name (REVOKE … FROM PUBLIC alone leaves anon).

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'user_time_region()',
    'user_op_set_time_region(jsonb)',
    'user_op_set_time_zone(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.time_region__zone_ok(text) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.time_region__zone_ok(text) FROM anon';
  EXECUTE 'REVOKE ALL ON FUNCTION public.time_region__zone_ok(text) FROM authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.time_region__zone_ok(text) TO service_role';
END;
$$;
