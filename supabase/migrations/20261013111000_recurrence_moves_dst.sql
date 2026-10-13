-- TV-D12 · Recurrence a–h on the server (specs/tasks-v3.md block 27, §2
-- "Repeats", edge cases "Dates, zones, repeats"; REPLAN 27 a–i; decisions in
-- docs/decisions/tasks.md "TV-D12").
--
--   * Rules read in the task's zone (the assignee's, else the creator's): a
--     9:00 repeat stays at 9:00 across a daylight-saving change. The engine
--     still evaluates in "floating" time (UTC from DTSTART, like rrule.js);
--     tasks__rrule_next_in / _prev_in feed it the zone's wall clock and read
--     the answer back in the zone, and the app's preview does the same.
--   * Which date a repeat sits on: its due date when that date is on the
--     rule's pattern, else its work session when that one is, else the due
--     date, else the session (tasks__occurrence_of). When it comes back, or
--     moves to today because it was missed, every date it has moves by the
--     same number of days, so due and scheduled keep their gap (c); a session
--     that sat exactly on the occurrence lands exactly on the new one.
--   * A repeat with no date gets a due date (a date alone is a due date),
--     no longer a calendar block.
--   * Subtasks reset each cycle: when a repeat comes back, its finished
--     subtasks (Done or Won't do) are To do again; their history stays (e).
--   * Archived projects never repeat (TV-U6).
--   * "Move just this one" (tasks_op_move_occurrence) shifts this cycle's
--     dates and remembers the pattern's slot (recurrence.movedFrom /
--     movedDays), so the next cycle is back on the pattern (g). Skipping an
--     occurrence is worked out on the server; the app's datetimes are used only
--     for a rule the server can't read.
--   * Changing the rule (any path) works the pointer out again and forgets a
--     moved slot or an ended-rule mark.
--   * tasks_op_history: a repeat's cycles, done and skipped, with who did
--     them and the caller's own tracked time per cycle (d).
--   * tasks__due_on_of reads an old build's local midnight at 11:00 UTC as
--     the next day (UTC+13 is far more common than UTC-11).
--
-- Apply after 20261013110000_notifications_v3. Verified on the local stack by
-- supabase/tests/tasks_recurrence.test.sql and recurrence_v3.test.sql.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.tasks__fire_reminders(timestamptz, integer)') IS NULL
     OR to_regclass('public.notice_deliveries') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013110000_notifications_v3 before this migration.';
  END IF;
END;
$$;

-- ── 1. Rules in the task's zone ────────────────────────────────────────────

-- An instant as the zone's wall clock written in UTC ("floating"), and back.
CREATE OR REPLACE FUNCTION public.tasks__floating(p_at timestamptz, p_zone text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (p_at AT TIME ZONE coalesce(nullif(p_zone, ''), 'UTC')) AT TIME ZONE 'UTC'
$$;

CREATE OR REPLACE FUNCTION public.tasks__unfloating(p_at timestamptz, p_zone text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (p_at AT TIME ZONE 'UTC') AT TIME ZONE coalesce(nullif(p_zone, ''), 'UTC')
$$;

-- The rule with DTSTART (else p_fallback) and UNTIL read as the zone's wall
-- clock, for the floating engine. UTC (or no zone) changes nothing.
CREATE OR REPLACE FUNCTION public.tasks__rrule_floating(p_rec jsonb, p_fallback timestamptz, p_zone text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_zone text := coalesce(nullif(p_zone, ''), 'UTC');
  v_dt timestamptz;
  v_rule text := p_rec ->> 'rrule';
  v_m text[];
  v_until timestamptz;
  v_float timestamptz;
BEGIN
  IF jsonb_typeof(p_rec) <> 'object' OR v_zone = 'UTC' THEN
    RETURN p_rec;
  END IF;
  v_dt := coalesce(public.tasks__try_ts(p_rec ->> 'dtstart'), p_fallback);
  IF v_dt IS NULL THEN
    RETURN p_rec;
  END IF;
  v_m := regexp_match(v_rule, '(^|;)\s*UNTIL\s*=\s*([0-9]{8})(T([0-9]{6})Z?)?', 'i');
  IF v_m IS NOT NULL THEN
    -- rrule.js reads UNTIL as UTC, with or without the Z.
    v_until := to_timestamp(v_m[2] || coalesce(v_m[4], '000000'), 'YYYYMMDDHH24MISS')::timestamp
               AT TIME ZONE 'UTC';
    v_float := public.tasks__floating(v_until, v_zone);
    IF v_float < '2200-01-01T00:00:00Z'::timestamptz THEN
      v_rule := regexp_replace(v_rule, '(^|;)(\s*UNTIL\s*=\s*)([0-9]{8})(T[0-9]{6}Z?)?',
        '\1\2' || to_char(v_float AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'), 'i');
    END IF;
  END IF;
  RETURN p_rec || jsonb_build_object(
    'rrule', v_rule,
    'dtstart', public.tasks__iso(public.tasks__floating(v_dt, v_zone)));
END;
$$;

-- tasks__rrule_next / _prev in a zone (DST-aware; D8-5's engine underneath).
CREATE OR REPLACE FUNCTION public.tasks__rrule_next_in(
  p_rec jsonb, p_after timestamptz, p_fallback timestamptz, p_zone text, p_inclusive boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN coalesce(nullif(p_zone, ''), 'UTC') = 'UTC'
    THEN public.tasks__rrule_next(p_rec, p_after, p_fallback, p_inclusive)
    ELSE public.tasks__unfloating(
      public.tasks__rrule_next(public.tasks__rrule_floating(p_rec, p_fallback, p_zone),
                               public.tasks__floating(p_after, p_zone), NULL, p_inclusive),
      p_zone)
  END
$$;

CREATE OR REPLACE FUNCTION public.tasks__rrule_prev_in(p_rec jsonb, p_at timestamptz, p_fallback timestamptz, p_zone text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN coalesce(nullif(p_zone, ''), 'UTC') = 'UTC'
    THEN public.tasks__rrule_prev(p_rec, p_at, p_fallback)
    ELSE public.tasks__unfloating(
      public.tasks__rrule_prev(public.tasks__rrule_floating(p_rec, p_fallback, p_zone),
                               public.tasks__floating(p_at, p_zone), NULL),
      p_zone)
  END
$$;

-- ── 2. Which date a repeat sits on ──────────────────────────────────────────

-- The rule's time of day in the zone (DTSTART's, else the task's creation).
CREATE OR REPLACE FUNCTION public.tasks__rule_time(p_task public.tasks, p_zone text)
RETURNS time
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (coalesce(public.tasks__try_ts(p_task.recurrence ->> 'dtstart'), p_task.created_at)
          AT TIME ZONE coalesce(nullif(p_zone, ''), 'UTC'))::time
$$;

-- Whether an instant falls on a day the rule picks, in the zone.
CREATE OR REPLACE FUNCTION public.tasks__on_pattern(p_task public.tasks, p_at timestamptz, p_zone text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_at IS NOT NULL
    AND public.tasks__local_date(
          public.tasks__rrule_prev_in(p_task.recurrence,
            public.tasks__local_midnight(public.tasks__local_date(p_at, p_zone) + 1, p_zone) - interval '1 microsecond',
            p_task.created_at, p_zone),
          p_zone) = public.tasks__local_date(p_at, p_zone)
$$;

-- The due date as an instant: its time, else the rule's time of day.
CREATE OR REPLACE FUNCTION public.tasks__due_instant(p_task public.tasks, p_zone text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_task.due_on IS NULL THEN NULL
    ELSE (p_task.due_on + coalesce(p_task.due_time, public.tasks__rule_time(p_task, p_zone)))
         AT TIME ZONE coalesce(nullif(p_zone, ''), 'UTC') END
$$;

-- The occurrence a repeat sits on now: its due date when that date is on the
-- pattern, else its work session when that is, else the due date, else the
-- session. NULL for a repeat with neither.
CREATE OR REPLACE FUNCTION public.tasks__occurrence_of(p_task public.tasks)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone text := public.tasks__zone_of(p_task);
  v_due timestamptz := public.tasks__due_instant(p_task, v_zone);
BEGIN
  IF v_due IS NOT NULL AND p_task.scheduled_at IS NOT NULL THEN
    IF public.tasks__on_pattern(p_task, v_due, v_zone) THEN
      RETURN v_due;
    ELSIF public.tasks__on_pattern(p_task, p_task.scheduled_at, v_zone) THEN
      RETURN p_task.scheduled_at;
    END IF;
  END IF;
  RETURN coalesce(v_due, p_task.scheduled_at);
END;
$$;

-- The pattern's slot this cycle stands for: where a "move just this one"
-- took it from, else where it sits.
CREATE OR REPLACE FUNCTION public.tasks__pattern_slot(p_task public.tasks)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.tasks__try_ts(p_task.recurrence ->> 'movedFrom'), public.tasks__occurrence_of(p_task))
$$;

-- Move every date of a repeat by p_days (wall clock in its zone), or put its
-- session exactly on p_exact when that session sat on the occurrence. Writes
-- scheduled_at (the session follows through tasks__session_legacy, as system
-- work) and due_on; never anything else.
CREATE OR REPLACE FUNCTION public.tasks__shift_dates(p_task public.tasks, p_days integer, p_exact timestamptz, p_old timestamptz)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone text := public.tasks__zone_of(p_task);
  v_sched timestamptz;
  v_due date;
  t public.tasks;
BEGIN
  IF p_task.scheduled_at IS NULL THEN
    v_sched := NULL;
  ELSIF p_exact IS NOT NULL AND p_old IS NOT NULL AND p_task.scheduled_at = p_old THEN
    v_sched := p_exact;
  ELSE
    v_sched := ((p_task.scheduled_at AT TIME ZONE v_zone) + make_interval(days => p_days)) AT TIME ZONE v_zone;
  END IF;
  v_due := CASE WHEN p_task.due_on IS NULL THEN NULL ELSE p_task.due_on + p_days END;
  IF v_sched IS NOT DISTINCT FROM p_task.scheduled_at AND v_due IS NOT DISTINCT FROM p_task.due_on THEN
    RETURN p_task;
  END IF;
  UPDATE public.tasks SET scheduled_at = v_sched, due_on = v_due, updated_at = now()
  WHERE id = p_task.id
  RETURNING * INTO t;
  RETURN t;
END;
$$;

-- ── 3. The pointer, from the pattern's slot, in the zone ────────────────────

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
    -- Completing early skips the pending occurrence; late never backfills.
    v_next := public.tasks__rrule_next_in(v_rec,
      greatest(p_now, coalesce(public.tasks__pattern_slot(p_task), p_now)), p_task.created_at, v_zone);
    FOR i IN 1 .. 4 LOOP
      EXIT WHEN v_next IS NULL OR public.tasks__local_date(v_next, v_zone) > v_today;
      v_next := public.tasks__rrule_next_in(v_rec, v_next, p_task.created_at, v_zone);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('supported', true, 'next', public.tasks__iso(v_next));
END;
$$;

CREATE OR REPLACE FUNCTION public.tasks__pointer_on_reopen(p_task public.tasks, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec jsonb := p_task.recurrence;
  v_zone text := public.tasks__zone_of(p_task);
BEGIN
  IF jsonb_typeof(v_rec) <> 'object' OR public.tasks__rrule_parse(v_rec ->> 'rrule') IS NULL THEN
    RETURN '{"supported": false}'::jsonb;
  END IF;
  IF v_rec ->> 'mode' = 'after_completion' THEN
    RETURN jsonb_build_object('supported', true, 'next', NULL);
  END IF;
  RETURN jsonb_build_object('supported', true, 'next', public.tasks__iso(
    public.tasks__rrule_next_in(v_rec,
      greatest(p_now, coalesce(public.tasks__pattern_slot(p_task), p_now)), p_task.created_at, v_zone)));
END;
$$;

-- The cycle a completion closes: the pattern's slot for a repeat.
CREATE OR REPLACE FUNCTION public.tasks__cycle_key(p_task public.tasks, p_now timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_task.recurrence) <> 'object' OR p_task.recurrence IS NULL THEN 'once'
    WHEN public.tasks__pattern_slot(p_task) IS NOT NULL THEN public.tasks__iso(public.tasks__pattern_slot(p_task))
    ELSE public.tasks__local_date(p_now, public.tasks__zone_of(p_task))::text
  END
$$;

-- ── 4. The roll-over ────────────────────────────────────────────────────────

-- From the live body (TV-D9's 170000), with: archived projects skipped; the
-- occurrence read by tasks__occurrence_of / tasks__pattern_slot instead of
-- scheduled_at alone; every date moved by the same days (a session on the
-- occurrence lands exactly on the new one); a dateless repeat gets a due
-- date; finished subtasks reset when a repeat comes back; rules read in the
-- task's zone. A repeat whose session comes before its due date comes back on
-- the session's day.
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
  v_slot timestamptz;
  v_at timestamptz;
  v_cur timestamptz;
  v_next timestamptz;
  v_from timestamptz;
  v_kind text;
  v_days integer;
  v_lead integer;
  v_reset integer;
  v_started timestamptz := clock_timestamp();
  v_changed boolean;
  v_supported boolean;
  v_missing boolean;
BEGIN
  FOR t IN
    SELECT * FROM public.tasks x
    WHERE (p_workspace_id IS NULL OR x.workspace_id = p_workspace_id)
      AND x.deleted_at IS NULL
      AND jsonb_typeof(x.recurrence) = 'object'
      AND public.tasks__recurrence_problem(x.recurrence) IS NULL
      -- Archived projects never repeat.
      AND NOT EXISTS (SELECT 1 FROM public.buckets b
                      WHERE b.id = x.bucket_id AND b.archived_at IS NOT NULL)
      AND ((x.status = 'done'
            AND jsonb_typeof(x.recurrence -> 'nextOccurrence') IS DISTINCT FROM 'null'
            AND coalesce(public.tasks__try_ts(x.recurrence ->> 'nextOccurrence'), '-infinity'::timestamptz)
                < p_now + interval '26 hours')
           OR (x.status IN ('todo', 'in_progress')
               AND x.status_category IS DISTINCT FROM 'backlog'
               AND coalesce(x.recurrence ->> 'mode', '') <> 'after_completion'
               -- Its dates have passed (a day either side for the zones).
               AND (x.scheduled_at IS NULL OR x.scheduled_at < p_now)
               AND (x.due_on IS NULL OR x.due_on <= (p_now AT TIME ZONE 'UTC')::date + 1)
               AND x.recurrence ->> 'endedRule' IS DISTINCT FROM public.tasks__rule_signature(x.recurrence)
               AND public.tasks__rrule_parse(x.recurrence ->> 'rrule') IS NOT NULL))
    -- Coming-back repeats first (they're due at a moment), then the rest.
    ORDER BY (x.status <> 'done'), random()
    LIMIT greatest(coalesce(p_limit, 1000), 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN clock_timestamp() - v_started > p_budget;
    v_supported := public.tasks__rrule_parse(t.recurrence ->> 'rrule') IS NOT NULL;
    v_changed := false;
    v_missing := false;
    v_reset := 0;
    BEGIN
      v_zone := public.tasks__zone_of(t);
      v_today := public.tasks__local_date(p_now, v_zone);
      v_end := public.tasks__local_midnight(v_today + 1, v_zone) - interval '1 microsecond';
      v_at := public.tasks__occurrence_of(t);
      v_slot := coalesce(public.tasks__try_ts(t.recurrence ->> 'movedFrom'), v_at);
      v_from := coalesce(v_at, t.scheduled_at);

      IF t.status = 'done' THEN
        v_pointer := public.tasks__try_ts(t.recurrence ->> 'nextOccurrence');
        IF v_pointer IS NULL THEN
          -- Completed before pointers were kept (or with one that doesn't
          -- read): the occurrence after it was done, stored so it's worked
          -- out once. Null when the rule has ended: it stays done, and stops
          -- being a candidate.
          IF v_supported THEN
            v_pointer := public.tasks__rrule_next_in(t.recurrence, t.updated_at, t.created_at, v_zone);
          END IF;
          IF v_pointer IS NULL THEN
            UPDATE public.tasks SET recurrence = t.recurrence || '{"nextOccurrence": null}'::jsonb
              WHERE id = t.id;
            CONTINUE;
          END IF;
          v_missing := true;
        END IF;
        SELECT max(c.completed_at) INTO v_done_at FROM public.task_completions c
        WHERE c.task_id = t.id AND c.deleted_at IS NULL;
        v_done_at := coalesce(v_done_at, t.updated_at);
        -- A date of the cycle before its occurrence (a session the day
        -- before it's due) brings it back that many days earlier.
        v_lead := least(0,
          coalesce(public.tasks__local_date(t.scheduled_at, v_zone) - public.tasks__local_date(v_slot, v_zone), 0),
          coalesce(t.due_on - public.tasks__local_date(v_slot, v_zone), 0));
        IF v_today < public.tasks__local_date(v_pointer, v_zone) + v_lead
           OR v_today <= public.tasks__local_date(v_done_at, v_zone) THEN
          IF v_missing THEN
            -- Not back yet: keep the pointer worked out, so it's asked once.
            UPDATE public.tasks
              SET recurrence = t.recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(v_pointer))
              WHERE id = t.id;
          END IF;
          CONTINUE;
        END IF;
        IF t.recurrence ->> 'mode' = 'after_completion' OR NOT v_supported THEN
          -- Back at the pointer; what comes after it is worked out when it's
          -- next completed (by the app, for a rule only the app reads).
          v_cur := v_pointer;
          v_next := NULL;
        ELSE
          v_cur := public.tasks__rrule_prev_in(t.recurrence, greatest(v_end, v_pointer), t.created_at, v_zone);
          IF v_cur IS NULL OR v_cur < v_pointer THEN
            v_cur := v_pointer;
          END IF;
          v_next := public.tasks__rrule_next_in(t.recurrence, v_cur, t.created_at, v_zone);
        END IF;
        IF NOT v_supported THEN
          -- A rule only the app reads keeps the app's model: the session sits
          -- on the occurrence; a due date moves by the same days.
          v_days := CASE WHEN t.scheduled_at IS NULL THEN 0
                         ELSE public.tasks__local_date(v_cur, v_zone) - public.tasks__local_date(t.scheduled_at, v_zone) END;
          UPDATE public.tasks SET
            scheduled_at = v_cur,
            due_on = CASE WHEN due_on IS NULL THEN NULL ELSE due_on + v_days END
          WHERE id = t.id RETURNING * INTO t;
        ELSIF v_slot IS NULL THEN
          -- A repeat with no date: the occurrence is its due date.
          UPDATE public.tasks SET due_on = public.tasks__local_date(v_cur, v_zone)
          WHERE id = t.id RETURNING * INTO t;
        ELSE
          v_days := public.tasks__local_date(v_cur, v_zone) - public.tasks__local_date(v_slot, v_zone)
                    - coalesce((t.recurrence ->> 'movedDays')::integer, 0);
          t := public.tasks__shift_dates(t, v_days, v_cur, v_slot);
        END IF;
        UPDATE public.tasks
          SET status = 'todo',
              recurrence = (t.recurrence - 'movedFrom' - 'movedDays')
                           || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
              committed_for = NULL,
              commit_order = NULL,
              updated_at = now()
          WHERE id = t.id
          RETURNING * INTO t;
        -- Subtasks reset each cycle: finished ones are To do again (their
        -- completions stay in the history).
        WITH reset AS (
          UPDATE public.tasks s
            SET status_id = (public.tasks__first_status(s.workspace_id, s.bucket_id, 'todo')).id,
                updated_at = now()
          WHERE s.parent_id = t.id AND s.deleted_at IS NULL
            AND s.status_category IN ('done', 'wont_do')
          RETURNING s.id)
        SELECT count(*) INTO v_reset FROM reset;
        v_kind := 'reopen';
        v_changed := true;
      ELSE
        v_cur := public.tasks__rrule_prev_in(t.recurrence, v_end, t.created_at, v_zone);
        IF v_cur IS NULL AND public.tasks__rrule_next_in(t.recurrence, p_now, t.created_at, v_zone) IS NULL THEN
          -- Nothing within 20 years either side: mark it for this rule, so
          -- it isn't worked out again until the rule changes.
          UPDATE public.tasks
            SET recurrence = t.recurrence || jsonb_build_object('endedRule', public.tasks__rule_signature(t.recurrence))
            WHERE id = t.id;
          CONTINUE;
        END IF;
        IF v_slot IS NULL THEN
          v_cur := coalesce(v_cur, public.tasks__rrule_next_in(t.recurrence, p_now, t.created_at, v_zone));
          CONTINUE WHEN v_cur IS NULL;
          UPDATE public.tasks SET due_on = public.tasks__local_date(v_cur, v_zone)
          WHERE id = t.id RETURNING * INTO t;
          v_kind := 'adopt';
        ELSE
          -- Moved to a later day by hand ("just this one"): stays there.
          IF v_cur IS NULL OR v_cur <= v_slot
             OR public.tasks__local_date(v_slot, v_zone) >= public.tasks__local_date(v_cur, v_zone)
             OR public.tasks__local_date(v_at, v_zone) >= public.tasks__local_date(v_cur, v_zone) THEN
            -- Nothing to move. A rule that ends (COUNT or UNTIL) with nothing
            -- after this occurrence never will have: mark it like one that
            -- never happens. Endless rules skip the extra look.
            IF (t.recurrence ->> 'rrule') ~* '(^|;)\s*(COUNT|UNTIL)\s*='
               AND public.tasks__rrule_next_in(t.recurrence, v_slot, t.created_at, v_zone) IS NULL THEN
              UPDATE public.tasks
                SET recurrence = t.recurrence || jsonb_build_object('endedRule', public.tasks__rule_signature(t.recurrence))
                WHERE id = t.id;
            END IF;
            CONTINUE;
          END IF;
          v_days := public.tasks__local_date(v_cur, v_zone) - public.tasks__local_date(v_slot, v_zone)
                    - coalesce((t.recurrence ->> 'movedDays')::integer, 0);
          t := public.tasks__shift_dates(t, v_days, v_cur, v_slot);
          v_kind := 'collapse';
        END IF;
        v_next := public.tasks__rrule_next_in(t.recurrence, v_cur, t.created_at, v_zone);
        UPDATE public.tasks
          SET recurrence = (t.recurrence - 'movedFrom' - 'movedDays')
                           || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
              updated_at = now()
          WHERE id = t.id
          RETURNING * INTO t;
        v_changed := true;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'tasks__roll_over: skipped task % (%)', t.id, SQLERRM;
      v_changed := false;
    END;
    CONTINUE WHEN NOT v_changed;

    -- module_activity_log needs a person or a key; this is Moduo's own work.
    INSERT INTO public.module_activity
      (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
    VALUES (t.workspace_id, 'tasks', 'task', t.id, 'tasks.catch_up', 'agent', NULL, 'Moduo',
            jsonb_strip_nulls(jsonb_build_object(
              'kind', v_kind, 'from', v_from, 'to', coalesce(t.scheduled_at, public.tasks__occurrence_of(t)),
              'due_on', t.due_on,
              'subtasks_reset', CASE WHEN v_reset > 0 THEN v_reset END)));
    RETURN NEXT t;
  END LOOP;
  RETURN;
END;
$$;

-- ── 5. Skip, move just this one, change the pattern ─────────────────────────

-- From the live body (TV-D8), worked out on the server: the next occurrence
-- after the pattern's slot (or now, when that's passed); every date moves by
-- the same days. The app's p_scheduled_at / p_recurrence are used only for a
-- rule the server can't read. The trail line names the occurrence skipped
-- (tasks_op_history lists it).
CREATE OR REPLACE FUNCTION public.tasks_op_skip_occurrence(p_workspace_id uuid, p_task_id uuid, p_scheduled_at timestamptz, p_recurrence jsonb, p_release_commit boolean DEFAULT false)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_zone text;
  v_slot timestamptz;
  v_to timestamptz;
  v_next timestamptz;
  v_from timestamptz;
  v_days integer;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF NOT public.can_access('task', t.id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF t.recurrence IS NULL OR jsonb_typeof(t.recurrence) <> 'object' THEN
    RAISE EXCEPTION 'Only recurring tasks have occurrences to skip.';
  END IF;
  IF t.status NOT IN ('todo', 'in_progress') THEN
    RAISE EXCEPTION 'Only open tasks can skip an occurrence.';
  END IF;
  v_from := coalesce(public.tasks__occurrence_of(t), t.scheduled_at);

  IF public.tasks__rrule_parse(t.recurrence ->> 'rrule') IS NULL
     OR t.recurrence ->> 'mode' = 'after_completion' THEN
    -- A rule only the app reads: the app's answer, as before.
    IF p_scheduled_at IS NULL OR p_recurrence IS NULL THEN
      RAISE EXCEPTION 'Skip needs the next occurrence.';
    END IF;
    IF t.scheduled_at IS NOT NULL AND p_scheduled_at <= t.scheduled_at THEN
      RAISE EXCEPTION 'Skip can only move an occurrence forward.';
    END IF;
    PERFORM public.tasks__check_recurrence(p_recurrence);
    UPDATE public.tasks
      SET scheduled_at = p_scheduled_at,
          recurrence = p_recurrence,
          committed_for = CASE WHEN p_release_commit THEN NULL ELSE committed_for END,
          commit_order = CASE WHEN p_release_commit THEN NULL ELSE commit_order END,
          updated_at = now()
      WHERE id = t.id
      RETURNING * INTO t;
    v_to := p_scheduled_at;
  ELSE
    v_zone := public.tasks__zone_of(t);
    v_slot := public.tasks__pattern_slot(t);
    v_to := public.tasks__rrule_next_in(t.recurrence, greatest(now(), coalesce(v_slot, now())), t.created_at, v_zone);
    IF v_to IS NULL THEN
      RAISE EXCEPTION 'This repeat has no occurrence after this one.';
    END IF;
    v_next := public.tasks__rrule_next_in(t.recurrence, v_to, t.created_at, v_zone);
    IF v_slot IS NULL THEN
      UPDATE public.tasks SET due_on = public.tasks__local_date(v_to, v_zone)
      WHERE id = t.id RETURNING * INTO t;
    ELSE
      v_days := public.tasks__local_date(v_to, v_zone) - public.tasks__local_date(v_slot, v_zone)
                - coalesce((t.recurrence ->> 'movedDays')::integer, 0);
      t := public.tasks__shift_dates(t, v_days, v_to, v_slot);
    END IF;
    UPDATE public.tasks
      SET recurrence = (t.recurrence - 'movedFrom' - 'movedDays')
                       || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
          committed_for = CASE WHEN coalesce(p_release_commit, false)
                                 OR public.tasks__local_date(v_to, v_zone) <> public.tasks__local_date(now(), v_zone)
                               THEN NULL ELSE committed_for END,
          commit_order = CASE WHEN coalesce(p_release_commit, false)
                                OR public.tasks__local_date(v_to, v_zone) <> public.tasks__local_date(now(), v_zone)
                              THEN NULL ELSE commit_order END,
          updated_at = now()
      WHERE id = t.id
      RETURNING * INTO t;
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.skip_occurrence',
    jsonb_build_object('from', v_from, 'to', v_to,
                       'skipped', coalesce(v_slot, v_from),
                       'next_occurrence', t.recurrence ->> 'nextOccurrence',
                       'released_commit', coalesce(p_release_commit, false)));
  RETURN t;
END;
$$;

-- "Move just this one": this cycle's dates move (a due date, or a session's
-- start), the other date by the same days, and the rule stays. The pattern's
-- slot is remembered, so completing it counts from the pattern and the next
-- cycle is back on it. Moving it back where it was forgets the move.
CREATE OR REPLACE FUNCTION public.tasks_op_move_occurrence(
  p_workspace_id uuid, p_task_id uuid, p_due_on date DEFAULT NULL, p_starts_at timestamptz DEFAULT NULL)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
  v_zone text;
  v_slot timestamptz;
  v_days integer;
  v_moved integer;
  v_from_due date;
  v_from_at timestamptz;
  v_flag text;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF NOT public.tasks__editable_to(t.id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF t.recurrence IS NULL OR jsonb_typeof(t.recurrence) <> 'object' THEN
    RAISE EXCEPTION 'Only a repeating task has occurrences to move.';
  END IF;
  IF t.status_category IN ('done', 'wont_do') THEN
    RAISE EXCEPTION 'Only an open repeat can move this occurrence.';
  END IF;
  IF (p_due_on IS NULL) = (p_starts_at IS NULL) THEN
    RAISE EXCEPTION 'Move the due date or the session, one at a time.' USING ERRCODE = '22023';
  END IF;
  v_zone := public.tasks__zone_of(t);
  v_slot := public.tasks__pattern_slot(t);
  v_from_due := t.due_on;
  v_from_at := t.scheduled_at;
  IF p_starts_at IS NOT NULL THEN
    IF t.scheduled_at IS NULL THEN
      RAISE EXCEPTION 'This repeat has no work session to move.' USING ERRCODE = '22023';
    END IF;
    v_days := public.tasks__local_date(p_starts_at, v_zone) - public.tasks__local_date(t.scheduled_at, v_zone);
    v_flag := current_setting('tasks.session_op', true);
    PERFORM set_config('tasks.session_op', '1', true);
    UPDATE public.tasks SET
      scheduled_at = p_starts_at,
      due_on = CASE WHEN due_on IS NULL THEN NULL ELSE due_on + v_days END,
      updated_at = now()
    WHERE id = t.id RETURNING * INTO t;
    PERFORM set_config('tasks.session_op', coalesce(v_flag, ''), true);
  ELSE
    IF t.due_on IS NULL THEN
      RAISE EXCEPTION 'This repeat has no due date to move.' USING ERRCODE = '22023';
    END IF;
    v_days := p_due_on - t.due_on;
    t := public.tasks__shift_dates(t, v_days, NULL, NULL);
  END IF;
  v_moved := coalesce((t.recurrence ->> 'movedDays')::integer, 0) + v_days;
  UPDATE public.tasks SET
    recurrence = CASE
      WHEN v_moved = 0 OR v_slot IS NULL THEN t.recurrence - 'movedFrom' - 'movedDays'
      ELSE t.recurrence || jsonb_build_object(
        'movedFrom', public.tasks__iso(v_slot), 'movedDays', v_moved) END,
    updated_at = now()
  WHERE id = t.id RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.move_occurrence',
    jsonb_build_object('due_on', jsonb_build_object('from', v_from_due, 'to', t.due_on),
                       'scheduled_at', jsonb_build_object('from', v_from_at, 'to', t.scheduled_at),
                       'pattern', public.tasks__iso(v_slot)));
  RETURN t;
END;
$$;

-- Changing the rule (the app's picker, "Change the pattern", MCP, an old
-- build) works the pointer out again and forgets a moved slot or an
-- ended-rule mark. Writes that only move the pointer (the status path, the
-- roll-over) keep the rule and pass straight through.
CREATE OR REPLACE FUNCTION public.tasks__rule_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pointer jsonb;
  v_zone text;
BEGIN
  IF jsonb_typeof(NEW.recurrence) <> 'object' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND jsonb_typeof(OLD.recurrence) = 'object'
     AND public.tasks__rule_signature(OLD.recurrence) = public.tasks__rule_signature(NEW.recurrence)
     AND OLD.recurrence ->> 'mode' IS NOT DISTINCT FROM NEW.recurrence ->> 'mode' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.recurrence ? 'nextOccurrence' THEN
    RETURN NEW;
  END IF;
  NEW.recurrence := NEW.recurrence - 'movedFrom' - 'movedDays' - 'endedRule';
  IF public.tasks__rrule_parse(NEW.recurrence ->> 'rrule') IS NULL THEN
    RETURN NEW; -- a rule only the app reads keeps the app's pointer
  END IF;
  BEGIN
    IF NEW.status_category = 'done' THEN
      v_pointer := public.tasks__pointer_on_complete(NEW, now());
      NEW.recurrence := NEW.recurrence || jsonb_build_object('nextOccurrence', v_pointer -> 'next');
    ELSIF coalesce(NEW.recurrence ->> 'mode', '') = 'after_completion' THEN
      NEW.recurrence := NEW.recurrence || '{"nextOccurrence": null}'::jsonb;
    ELSE
      v_zone := public.tasks__zone_of(NEW);
      NEW.recurrence := NEW.recurrence || jsonb_build_object('nextOccurrence', public.tasks__iso(
        public.tasks__rrule_next_in(NEW.recurrence,
          greatest(now(), coalesce(public.tasks__occurrence_of(NEW), now())), NEW.created_at, v_zone)));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'tasks__rule_changed: no pointer for task % (%)', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_rule_changed ON public.tasks;
CREATE TRIGGER tasks_rule_changed
  BEFORE INSERT OR UPDATE OF recurrence ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.tasks__rule_changed();

-- ── 6. A repeat's history (d) ───────────────────────────────────────────────

-- Each cycle done or skipped, newest first: when, by whom, and the caller's
-- own tracked time in that cycle (nobody sees anyone else's). Misses are
-- never listed. At most 100 cycles.
CREATE OR REPLACE FUNCTION public.tasks_op_history(p_workspace_id uuid, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  t public.tasks;
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tasks x
  WHERE x.id = p_task_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__visible_to(t.id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(c ORDER BY c ->> 'at' DESC)
    FROM (
      SELECT jsonb_build_object(
               'kind', 'done',
               'at', public.tasks__iso(d.completed_at),
               'cycle', d.cycle_key,
               'by', d.user_id,
               'my_seconds', (
                 SELECT coalesce(sum(e.seconds), 0) FROM public.task_time_entries e
                 WHERE e.task_id = t.id AND e.user_id = v_actor
                   AND e.started_at <= d.completed_at
                   AND e.started_at > coalesce((
                     SELECT max(p.completed_at) FROM public.task_completions p
                     WHERE p.task_id = t.id AND p.deleted_at IS NULL
                       AND p.completed_at < d.completed_at), '-infinity'::timestamptz))) AS c
      FROM public.task_completions d
      WHERE d.task_id = t.id AND d.deleted_at IS NULL
      UNION ALL
      SELECT jsonb_build_object(
               'kind', 'skipped',
               'at', public.tasks__iso(a.created_at),
               'cycle', coalesce(a.payload ->> 'skipped', a.payload ->> 'from'),
               'by', CASE WHEN a.actor_type = 'user' THEN a.actor_id END,
               'my_seconds', 0)
      FROM public.module_activity a
      WHERE a.workspace_id = t.workspace_id AND a.module = 'tasks'
        AND a.entity_type = 'task' AND a.entity_id = t.id AND a.op = 'tasks.skip_occurrence'
      ORDER BY 1
      LIMIT 100
    ) s), '[]'::jsonb);
END;
$$;

-- ── 7. An old build's local midnight at UTC+13 ─────────────────────────────

-- From the live body (TV-D9): with no saved zone, 11:00 UTC reads as the next
-- day's local midnight (UTC+13: New Zealand in summer, Samoa, Tonga) rather
-- than the same day's at UTC-11. Noon is still the mirror's own value.
CREATE OR REPLACE FUNCTION public.tasks__due_on_of(p_at timestamptz, p_zone text)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_at IS NULL THEN NULL
    WHEN p_zone IS NOT NULL AND (p_at AT TIME ZONE p_zone)::time = time '00:00'
      THEN (p_at AT TIME ZONE p_zone)::date
    WHEN (p_at AT TIME ZONE 'UTC')::time = time '12:00' THEN (p_at AT TIME ZONE 'UTC')::date
    WHEN (p_at AT TIME ZONE 'UTC')::time = time '11:00' THEN (p_at AT TIME ZONE 'UTC')::date + 1
    ELSE ((p_at + interval '12 hours') AT TIME ZONE 'UTC')::date
  END
$$;

-- ── 8. Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks__floating(timestamptz, text)',
    'tasks__unfloating(timestamptz, text)',
    'tasks__rrule_floating(jsonb, timestamptz, text)',
    'tasks__rrule_next_in(jsonb, timestamptz, timestamptz, text, boolean)',
    'tasks__rrule_prev_in(jsonb, timestamptz, timestamptz, text)',
    'tasks__rule_time(public.tasks, text)',
    'tasks__on_pattern(public.tasks, timestamptz, text)',
    'tasks__due_instant(public.tasks, text)',
    'tasks__occurrence_of(public.tasks)',
    'tasks__pattern_slot(public.tasks)',
    'tasks__shift_dates(public.tasks, integer, timestamptz, timestamptz)',
    'tasks__pointer_on_complete(public.tasks, timestamptz)',
    'tasks__pointer_on_reopen(public.tasks, timestamptz)',
    'tasks__cycle_key(public.tasks, timestamptz)',
    'tasks__roll_over(uuid, timestamptz, integer, interval)',
    'tasks__rule_changed()',
    'tasks__due_on_of(timestamptz, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_skip_occurrence(uuid, uuid, timestamptz, jsonb, boolean)',
    'tasks_op_move_occurrence(uuid, uuid, date, timestamptz)',
    'tasks_op_history(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;
