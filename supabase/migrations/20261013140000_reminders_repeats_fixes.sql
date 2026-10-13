-- TV-D12 · Follow-ups to 20261013110000_notifications_v3 and
-- 20261013111000_recurrence_moves_dst (specs/tasks-v3.md block 27; decisions
-- in docs/decisions/tasks.md "TV-D12"), from the block's review:
--
--   * A repeat with a "1 day before" reminder comes back the day before its
--     occurrence, so the reminder is armed again for every cycle (it was only
--     re-armed on the occurrence day, when "the day before" had passed).
--   * tasks_op_history keeps the newest 100 cycles.
--   * tasks__due_on_of reads 11:00 UTC as the next day only with no saved zone.
--   * Reminders already on Backlog / Won't do tasks start suspended, as new
--     ones would.
--   * The push claim checks again that the person can still see the task.
--   * A delivery's link is a path inside Moduo (one leading slash).
--
-- Every function is re-cut from its live body. Apply after TV-F6's
-- 20261013130000 (no shared function). Verified on the local stack by
-- supabase/tests/recurrence_v3.test.sql and notifications.test.sql.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.notice_deliveries') IS NULL
     OR to_regprocedure('public.tasks_op_history(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013110000 and 20261013111000 before this migration.';
  END IF;
END;
$$;

-- ── The roll-over: a day early for a "1 day before" reminder ─────────────────

CREATE OR REPLACE FUNCTION public.tasks__roll_over(p_workspace_id uuid DEFAULT NULL::uuid, p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 1000, p_budget interval DEFAULT '00:00:30'::interval)
 RETURNS SETOF tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                < p_now + interval '26 hours'
                  -- …and the days a session comes before the due date.
                  + make_interval(days => greatest(0, least(366,
                      coalesce(x.due_on - (x.scheduled_at AT TIME ZONE 'UTC')::date, 0))))
                  -- …and a day for a "1 day before" reminder (TV-D12).
                  + CASE WHEN EXISTS (SELECT 1 FROM public.task_reminders r
                                      WHERE r.task_id = x.id AND r.kind = 'day_before'
                                        AND r.deleted_at IS NULL AND r.suspended_at IS NULL)
                         THEN interval '1 day' ELSE interval '0' END)
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
          coalesce(t.due_on - public.tasks__local_date(v_slot, v_zone), 0),
          -- A "1 day before" reminder (anyone's) brings it back the day
          -- before, so the reminder is armed again and fires (TV-D12).
          CASE WHEN EXISTS (SELECT 1 FROM public.task_reminders r
                            WHERE r.task_id = t.id AND r.kind = 'day_before'
                              AND r.deleted_at IS NULL AND r.suspended_at IS NULL)
               THEN -1 ELSE 0 END);
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
$function$;

-- ── A repeat's history: the newest 100 ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_op_history(p_workspace_id uuid, p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     SELECT u.c FROM (
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
     ) u
     -- The newest 100 (ISO times sort as text).
     ORDER BY u.c ->> 'at' DESC
     LIMIT 100
    ) s), '[]'::jsonb);
END;
$function$;

-- ── An old build's 11:00 UTC: only with no saved zone ──────────────────────

CREATE OR REPLACE FUNCTION public.tasks__due_on_of(p_at timestamp with time zone, p_zone text)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_at IS NULL THEN NULL
    WHEN p_zone IS NOT NULL AND (p_at AT TIME ZONE p_zone)::time = time '00:00'
      THEN (p_at AT TIME ZONE p_zone)::date
    WHEN (p_at AT TIME ZONE 'UTC')::time = time '12:00' THEN (p_at AT TIME ZONE 'UTC')::date
    WHEN p_zone IS NULL AND (p_at AT TIME ZONE 'UTC')::time = time '11:00' THEN (p_at AT TIME ZONE 'UTC')::date + 1
    ELSE ((p_at + interval '12 hours') AT TIME ZONE 'UTC')::date
  END
$function$;

-- ── The push claim, at send time ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notice_deliveries__claim(p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, user_id uuid, title text, body text, url text, task_id uuid, subscriptions jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM public.notice_deliveries d
    WHERE d.pushed_at IS NULL AND d.push_attempts < 5 AND d.created_at > now() - interval '1 day'
      AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = d.user_id)
      -- Still theirs to see at send time (TV-D10-fix).
      AND (d.task_id IS NULL OR public.tasks__visible_to(d.task_id, d.user_id))
    ORDER BY d.created_at
    LIMIT greatest(least(coalesce(p_limit, 100), 500), 1)
    FOR UPDATE OF d SKIP LOCKED
  ), bumped AS (
    UPDATE public.notice_deliveries d SET push_attempts = d.push_attempts + 1
    FROM picked WHERE d.id = picked.id
    RETURNING d.*
  )
  SELECT b.id, b.user_id, b.title, b.body, b.url, b.task_id,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
          FROM public.push_subscriptions s WHERE s.user_id = b.user_id)
  FROM bumped b;
END;
$function$;

-- ── Reminders already on parked tasks ───────────────────────────────────────

UPDATE public.task_reminders r SET suspended_at = now()
FROM public.tasks t
WHERE t.id = r.task_id AND t.status_category IN ('backlog', 'wont_do') AND t.deleted_at IS NULL
  AND r.deleted_at IS NULL AND r.fired_at IS NULL AND r.suspended_at IS NULL;

-- ── A delivery's link stays inside Moduo ───────────────────────────────────

ALTER TABLE public.notice_deliveries DROP CONSTRAINT IF EXISTS notice_deliveries_url_check;
ALTER TABLE public.notice_deliveries ADD CONSTRAINT notice_deliveries_url_check
  CHECK (url IS NULL OR (char_length(url) <= 500 AND url ~ '^/([^/]|$)'));


-- ── Grants (unchanged: the same as the functions had) ───────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks__roll_over(uuid, timestamptz, integer, interval)',
    'tasks__due_on_of(timestamptz, text)',
    'notice_deliveries__claim(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  REVOKE ALL ON FUNCTION public.tasks_op_history(uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.tasks_op_history(uuid, uuid) TO authenticated, service_role;
END;
$$;
