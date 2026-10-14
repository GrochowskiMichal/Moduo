-- TV-F6 · Focus salvage + one time engine (specs/tasks-v3.md block 22,
-- §Assumptions #11, #24, #26; REPLAN 62a, 63, §6.10, round 3 §L; decisions in
-- docs/decisions/tasks.md "TV-F6").
--
-- Re-cuts the queue-run record from #323. That file, 20261008235243_focus_runs,
-- has been on production since 2026-10-09 and is history: this one changes it.
--
--   * Timer: Per task · Pomodoro · Off (62a). A run's `mode` was pomodoro or
--     stopwatch, picked once per run; it is per_task, pomodoro or off now, and
--     can change mid-run (focus_runs__apply takes `mode`). A stopwatch run
--     reads as Per task. Off records no time (the device sends none), but the
--     run is on: Done, Skip and "is on this" still work. A new timer starts its
--     rhythm over; only Pomodoro has phases, and its length can't go missing
--     (the shape check is NULL-safe now). Saving and ending write the timer.
--   * The task gate (TV-D10-fix): a run's Now task must be one its person can
--     see (tasks__visible_to), and "<name> is on this" (focus_claims) answers
--     only for a task the caller sees (tasks__visible) and the runner still sees.
--   * focus_runs back in the supabase_realtime publication and its table grants
--     as production has them (each person reads their own runs; writes go
--     through the ops). Both are no-ops on production; they close the local
--     stack's drift (its schema snapshot carries neither).
--   * account_erase_workspace_data erases a person's runs in workspaces they
--     don't own (§Assumptions #26). Leaving a workspace already takes them
--     (focus_runs_member_removed), and their own workspaces go whole.
--
-- Apply after TV-D10-fix (20261011110000) and TV-D12 (20261013110000,
-- 20261013111000; account_erase_workspace_data is redefined from the body they
-- left). Verified on the local stack by supabase/tests/focus_runs.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 0. Preconditions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.focus_runs') IS NULL
     OR to_regprocedure('public.focus_runs__apply(public.focus_runs, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261008235243_focus_runs (#323) before this migration.';
  END IF;
  IF to_regprocedure('public.tasks__visible(uuid)') IS NULL
     OR to_regprocedure('public.tasks__visible_to(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D10-fix (20261011110000_task_sessions_access) before this migration.';
  END IF;
  IF to_regclass('public.push_subscriptions') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D12 (20261013110000_notifications_v3) before this migration.';
  END IF;
END;
$$;

-- ── 1. Timer: Per task · Pomodoro · Off ──────────────────────────────────────

ALTER TABLE public.focus_runs DROP CONSTRAINT IF EXISTS focus_runs_mode_check;
ALTER TABLE public.focus_runs DROP CONSTRAINT IF EXISTS focus_runs_phase_shape;

-- A stopwatch run is a Per task run (its phase is work, without a length); a
-- pomodoro run a save left without a length gets the default one.
UPDATE public.focus_runs SET mode = 'per_task' WHERE mode = 'stopwatch';
UPDATE public.focus_runs SET phase_seconds = 1500 WHERE mode = 'pomodoro' AND phase_seconds IS NULL;

ALTER TABLE public.focus_runs
  ADD CONSTRAINT focus_runs_mode_check CHECK (mode IN ('per_task','pomodoro','off'));
-- NULL-safe this time: #323's shape let a pomodoro run with no phase length
-- through (NULL OR false passes a CHECK).
ALTER TABLE public.focus_runs
  ADD CONSTRAINT focus_runs_phase_shape CHECK (
    (mode = 'pomodoro' AND phase_seconds IS NOT NULL AND phase_seconds BETWEEN 1 AND 86400)
    OR (mode IN ('per_task','off') AND phase = 'work' AND phase_seconds IS NULL)
  );
ALTER TABLE public.focus_runs ALTER COLUMN mode SET DEFAULT 'per_task';

COMMENT ON COLUMN public.focus_runs.mode IS
  'The timer (62a): per_task (the default; time goes to the task in focus), pomodoro (one rhythm for the session; time still goes to each task) or off (no time recorded). Can change mid-run.';

-- ── 2. A device's snapshot: the timer, and the Now task through the gate ─────

CREATE OR REPLACE FUNCTION public.focus_runs__apply(r public.focus_runs, p_state jsonb)
RETURNS public.focus_runs
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s jsonb := coalesce(p_state, '{}'::jsonb);
  v_task uuid;
  v_ids uuid[];
BEGIN
  IF jsonb_typeof(s) <> 'object' THEN
    RAISE EXCEPTION 'A run''s state is an object.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    -- The timer first: a new one starts its rhythm over, and the device's own
    -- phase keys (below) then say where it is.
    IF s ? 'mode' THEN
      IF jsonb_typeof(s->'mode') <> 'string' OR s->>'mode' NOT IN ('per_task','pomodoro','off') THEN
        RAISE EXCEPTION 'The timer is per task, pomodoro or off.' USING ERRCODE = '22023';
      END IF;
      IF s->>'mode' <> r.mode THEN
        r.mode := s->>'mode';
        r.phase := 'work';
        r.phase_started_at := now();
        r.phase_seconds := CASE WHEN r.mode = 'pomodoro' THEN 1500 END;
        r.blocks_completed := 0;
      END IF;
    END IF;
    IF s ? 'status' THEN
      IF s->>'status' NOT IN ('running', 'paused') THEN
        RAISE EXCEPTION 'A run is running or paused.' USING ERRCODE = '22023';
      END IF;
      r.status := s->>'status';
    END IF;
    IF s ? 'now_task_id' THEN
      v_task := nullif(s->>'now_task_id', '')::uuid;
      IF v_task IS NOT NULL THEN
        SELECT t.id INTO v_task FROM public.tasks t
        WHERE t.id = v_task AND t.workspace_id = r.workspace_id AND t.deleted_at IS NULL
          AND public.tasks__visible_to(t.id, r.user_id);
      END IF;
      r.now_task_id := v_task;
    END IF;
    IF s ? 'phase' THEN
      r.phase := s->>'phase';
    END IF;
    IF s ? 'phase_started_at' THEN
      r.phase_started_at := coalesce(public.focus_runs__clamp((s->>'phase_started_at')::timestamptz), now());
    END IF;
    -- A null length is no length: a Pomodoro run keeps the one it has.
    IF s ? 'phase_seconds' AND s->>'phase_seconds' IS NOT NULL THEN
      r.phase_seconds := (s->>'phase_seconds')::integer;
    END IF;
    IF s ? 'paused_at' THEN
      r.paused_at := public.focus_runs__clamp((s->>'paused_at')::timestamptz);
    END IF;
    IF s ? 'blocks_completed' THEN
      r.blocks_completed := (s->>'blocks_completed')::integer;
    END IF;
    IF s ? 'focused_seconds' THEN
      r.focused_seconds := (s->>'focused_seconds')::integer;
    END IF;
    IF s ? 'done_task_ids' THEN
      IF jsonb_typeof(s->'done_task_ids') <> 'array' THEN
        RAISE EXCEPTION 'done_task_ids is a list.' USING ERRCODE = '22023';
      END IF;
      -- Each task once, in the order done; the newest 500.
      SELECT coalesce(array_agg(x.id ORDER BY x.first_at), '{}') INTO v_ids
      FROM (
        SELECT e.value::uuid AS id, min(e.ord) AS first_at
        FROM jsonb_array_elements_text(s->'done_task_ids') WITH ORDINALITY AS e(value, ord)
        GROUP BY e.value::uuid
      ) x;
      IF cardinality(v_ids) > 500 THEN
        v_ids := v_ids[cardinality(v_ids) - 499 :];
      END IF;
      r.done_task_ids := v_ids;
    END IF;
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format
         OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'That run state isn''t valid.' USING ERRCODE = '22023';
  END;
  -- Only Pomodoro has phases; Per task and Off are one stretch of work.
  IF r.mode = 'pomodoro' THEN
    r.phase_seconds := coalesce(r.phase_seconds, 1500);
  ELSE
    r.phase := 'work';
    r.phase_seconds := NULL;
  END IF;
  -- Paused carries its moment; running doesn't.
  IF r.status = 'paused' THEN
    r.paused_at := coalesce(r.paused_at, now());
  ELSE
    r.paused_at := NULL;
  END IF;
  RETURN r;
END;
$$;

-- ── 3. Starting a run: the new timer vocabulary ──────────────────────────────

CREATE OR REPLACE FUNCTION public.focus_op_run_start(
  p_workspace_id uuid,
  p_device text,
  p_mode text,
  p_state jsonb DEFAULT '{}'::jsonb
)
RETURNS public.focus_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := public.focus_runs__runner(p_workspace_id);
  r public.focus_runs;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('per_task','pomodoro','off') THEN
    RAISE EXCEPTION 'The timer is per task, pomodoro or off.' USING ERRCODE = '22023';
  END IF;
  IF p_device IS NULL OR p_device !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'That device id isn''t valid.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.focus_runs__lock(v_user);

  UPDATE public.focus_runs f
  SET status = 'ended', ended_at = now(), paused_at = NULL, updated_at = now()
  WHERE f.user_id = v_user AND f.status <> 'ended';

  r.id := gen_random_uuid();
  r.workspace_id := p_workspace_id;
  r.user_id := v_user;
  r.status := 'running';
  r.mode := p_mode;
  r.started_at := now();
  r.phase := 'work';
  r.phase_started_at := now();
  r.phase_seconds := CASE WHEN p_mode = 'pomodoro' THEN 1500 END;
  r.blocks_completed := 0;
  r.focused_seconds := 0;
  r.done_task_ids := '{}';
  r.device_id := p_device;
  r.control_at := now();
  r.seen_at := now();
  r.created_at := now();
  r.updated_at := now();
  -- The timer is p_mode: a `mode` in the first snapshot doesn't override it.
  r := public.focus_runs__apply(r, coalesce(p_state, '{}'::jsonb) - 'mode');

  INSERT INTO public.focus_runs SELECT r.*;
  RETURN r;
END;
$$;

-- Saving and ending write the timer too (#323's never changed it after start).
CREATE OR REPLACE FUNCTION public.focus_op_run_save(
  p_run_id uuid,
  p_device text,
  p_take boolean,
  p_state jsonb
)
RETURNS public.focus_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  r public.focus_runs;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'A run belongs to a person: sign in.' USING ERRCODE = '42501';
  END IF;
  IF p_device IS NULL OR p_device !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'That device id isn''t valid.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.focus_runs__lock(v_user);
  SELECT * INTO r FROM public.focus_runs f WHERE f.id = p_run_id AND f.user_id = v_user FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF r.status = 'ended' OR (r.device_id <> p_device AND NOT coalesce(p_take, false)) THEN
    RETURN r;
  END IF;
  PERFORM public.focus_runs__runner(r.workspace_id);

  r := public.focus_runs__apply(r, p_state);
  IF r.device_id <> p_device THEN
    r.control_at := now();
  END IF;
  r.device_id := p_device;
  r.seen_at := now();
  r.updated_at := now();
  UPDATE public.focus_runs f
  SET status = r.status, mode = r.mode, now_task_id = r.now_task_id, phase = r.phase,
      phase_started_at = r.phase_started_at, phase_seconds = r.phase_seconds,
      paused_at = r.paused_at, blocks_completed = r.blocks_completed,
      focused_seconds = r.focused_seconds, done_task_ids = r.done_task_ids,
      device_id = r.device_id, control_at = r.control_at, seen_at = r.seen_at,
      updated_at = r.updated_at
  WHERE f.id = r.id;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.focus_op_run_end(
  p_run_id uuid,
  p_device text,
  p_state jsonb DEFAULT '{}'::jsonb
)
RETURNS public.focus_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  r public.focus_runs;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'A run belongs to a person: sign in.' USING ERRCODE = '42501';
  END IF;
  IF p_device IS NULL OR p_device !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'That device id isn''t valid.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.focus_runs__lock(v_user);
  SELECT * INTO r FROM public.focus_runs f WHERE f.id = p_run_id AND f.user_id = v_user FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF r.status = 'ended' THEN
    RETURN r;
  END IF;

  r := public.focus_runs__apply(r, coalesce(p_state, '{}'::jsonb) - 'status');
  UPDATE public.focus_runs f
  SET status = 'ended', ended_at = now(), paused_at = NULL, mode = r.mode, now_task_id = r.now_task_id,
      phase = r.phase, phase_started_at = r.phase_started_at, phase_seconds = r.phase_seconds,
      blocks_completed = r.blocks_completed, focused_seconds = r.focused_seconds,
      done_task_ids = r.done_task_ids, device_id = p_device,
      control_at = CASE WHEN r.device_id <> p_device THEN now() ELSE r.control_at END,
      seen_at = now(), updated_at = now()
  WHERE f.id = r.id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- ── 4. Claims: "<name> is on this", behind the task gate ─────────────────────
-- Who in the workspace is running which task right now: a running run seen in
-- the last 3 minutes, by a member who still sees the task, on a task the
-- caller sees. Nothing else about anyone's run, and never the caller's own.
-- Off still claims: the run is on the task, only its clock is off.
CREATE OR REPLACE FUNCTION public.focus_claims(p_workspace_id uuid)
RETURNS TABLE (user_id uuid, task_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.user_id, r.now_task_id
  FROM public.focus_runs r
  WHERE auth.uid() IS NOT NULL
    AND r.workspace_id = p_workspace_id
    AND r.status = 'running'
    AND r.now_task_id IS NOT NULL
    AND r.seen_at > now() - interval '3 minutes'
    AND r.user_id <> auth.uid()
    AND public.perm_can_view(p_workspace_id, 'tasks')
    AND EXISTS (SELECT 1 FROM public.workspace_members m
                WHERE m.workspace_id = r.workspace_id AND m.user_id = r.user_id)
    AND public.tasks__visible(r.now_task_id)
    AND public.tasks__visible_to(r.now_task_id, r.user_id)
  ORDER BY r.started_at, r.user_id
$$;

-- ── 5. Realtime and table grants, as production has them ─────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'focus_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.focus_runs;
  END IF;
END;
$$;

REVOKE ALL ON public.focus_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.focus_runs TO authenticated;
GRANT ALL ON public.focus_runs TO service_role;

-- ── 6. Erasure: a person's runs in workspaces they don't own ─────────────────
-- Redefined from the live body (TV-D12's), adding v_focus_runs: counted in the
-- preview as focus_runs_deleted, deleted with the other TV-D10/D12 rows (3e).

CREATE OR REPLACE FUNCTION public.account_erase_workspace_data(p_user uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_completed_by integer;
  v_sessions integer;
  v_reminders integer;
  v_push_subscriptions integer;
  v_deliveries integer;
  v_team_members integer;
  v_waiting integer;
  v_leads integer;
  v_focus_runs integer;
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

  -- TV-D9: who finished which task, in other people's workspaces (the task
  -- stays; the mark is cleared).
  SELECT count(*) INTO v_completed_by
  FROM public.tasks t
  WHERE t.completed_by = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  -- TV-D10: their work sessions, reminders and team memberships, the Waiting
  -- on… entries that name them, and the projects they lead (the project
  -- stays; the lead is cleared), in other people's workspaces.
  SELECT count(*) INTO v_sessions
  FROM public.task_sessions s WHERE s.user_id = p_user AND s.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_reminders
  FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_push_subscriptions FROM public.push_subscriptions x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_team_members
  FROM public.team_members m WHERE m.user_id = p_user AND m.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_waiting
  FROM public.task_waiting w
  WHERE w.kind = 'person' AND w.ref = p_user AND w.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_leads
  FROM public.buckets b
  WHERE b.lead_id = p_user AND b.workspace_id <> ALL (v_owned) AND NOT (b.id = ANY (v_bucket_del));

  -- TV-F6: their Focus runs in other people's workspaces (leaving a workspace
  -- already takes them, through focus_runs_member_removed).
  SELECT count(*) INTO v_focus_runs
  FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);

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
    'task_completions_deleted', v_completions,
    'tasks_completed_by_cleared', v_completed_by,
    'task_sessions_deleted', v_sessions,
    'task_reminders_deleted', v_reminders,
    'push_subscriptions_deleted', v_push_subscriptions,
    'notice_deliveries_deleted', v_deliveries,
    'team_memberships_deleted', v_team_members,
    'waiting_entries_deleted', v_waiting,
    'project_leads_cleared', v_leads,
    'focus_runs_deleted', v_focus_runs
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

  -- 3c. Who finished which task (TV-D9), in workspaces they don't own.
  UPDATE public.tasks t SET completed_by = NULL
  WHERE t.completed_by = p_user AND t.workspace_id <> ALL (v_owned);

  -- 3d. TV-D10: sessions, reminders, team memberships, Waiting on… them, the
  --     projects they lead, and their name on what they made, in workspaces
  --     they don't own.
  DELETE FROM public.task_sessions s WHERE s.user_id = p_user AND s.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.push_subscriptions x WHERE x.user_id = p_user;
  DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;
  DELETE FROM public.team_members m WHERE m.user_id = p_user AND m.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_waiting w
  WHERE w.kind = 'person' AND w.ref = p_user AND w.workspace_id <> ALL (v_owned);
  UPDATE public.task_waiting w SET created_by = NULL
  WHERE w.created_by = p_user AND w.workspace_id <> ALL (v_owned);
  UPDATE public.teams x SET created_by = NULL
  WHERE x.created_by = p_user AND x.workspace_id <> ALL (v_owned);
  UPDATE public.buckets b SET lead_id = NULL
  WHERE b.lead_id = p_user AND b.workspace_id <> ALL (v_owned);

  -- 3e. TV-F6: their Focus runs, in workspaces they don't own.
  DELETE FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);

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
  -- TV-D10: the same in everyone's own time blocks ({workspace: {slot: id}}).
  UPDATE public.user_preferences p
  SET task_time_blocks = (
        SELECT coalesce(jsonb_object_agg(w.key, CASE WHEN jsonb_typeof(w.value) = 'object' THEN coalesce((
                 SELECT jsonb_object_agg(j.key, j.value) FROM jsonb_each(w.value) AS j
                 WHERE NOT coalesce((j.value #>> '{}') = ANY (v_bucket_del::text[]), false)), '{}'::jsonb)
               ELSE w.value END), '{}'::jsonb)
        FROM jsonb_each(p.task_time_blocks) AS w)
  WHERE cardinality(v_bucket_del) > 0
    AND EXISTS (SELECT 1 FROM jsonb_each(p.task_time_blocks) AS w
                CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object'
                                                   THEN w.value ELSE '{}'::jsonb END) AS j
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
$function$;

-- ── 7. Grants ────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps a function's grants; they're restated so a fresh
-- database (or the local stack's broader defaults) ends up as production.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'focus_op_run_start(uuid, text, text, jsonb)',
    'focus_op_run_save(uuid, text, boolean, jsonb)',
    'focus_op_run_end(uuid, text, jsonb)',
    'focus_claims(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'focus_runs__apply(public.focus_runs, jsonb)',
    'account_erase_workspace_data(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;
