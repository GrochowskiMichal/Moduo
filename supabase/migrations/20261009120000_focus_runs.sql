-- TV-F2 · Queue run (specs/tasks-v2.md block 11, decision 6).
--
-- Focus is now running your Queue: line tasks up, press Start run, and the
-- run works down the queue (Now, then Up next). The clock itself stays on the
-- device (the TV-F1 engine); this is the run's shared record, so it
--   * survives a reload and shows on your other devices (F2-4): one open run
--     per person, written by the device that controls it, read through by the
--     others, and taken over by whichever device you act on;
--   * tells teammates "<name> is on this" for the task you're on (F2-6), and
--     nothing else about your run: focus_claims answers only who is running
--     which task, for tasks the caller can see, while the run is live.
--
--   * focus_runs: one row per run. Status running / paused / ended, the mode
--     (pomodoro or stopwatch, picked once per run), the Now task, the pomodoro
--     phase on shared timestamps (phase_started_at moves forward by pauses, so
--     every device computes the same countdown), the blocks and focused time
--     so far, and the tasks done in this run. device_id is the device in
--     control; seen_at is its last write (it saves at least once a minute while
--     the run is on).
--   * Ops, for the signed-in person only (a run is someone's live session in
--     the app; no connector tool runs one): focus_op_run_start (ends any open
--     run of theirs first), focus_op_run_save (a device that isn't in control
--     gets the row back unchanged unless it takes control: that's how the old
--     device learns it lost it), focus_op_run_end.
--   * Each person reads only their own runs. Teammates see claims through
--     focus_claims, only for a run seen in the last 3 minutes (a closed laptop
--     stops claiming), only for tasks they can see, and only for members.
--   * Leaving a workspace (or deleting the account) takes the person's runs
--     there with them.
--   * tasks_op_queue_keep: "Lined up 3 days ago — Keep all" (and the end of a
--     Review) marks the line-up as looked at. The line-up's age is the newest
--     updated_at of the person's queue rows; adds, moves and this op set it.
--   * task_time_entries.run_id gets its foreign key (TV-D3 left it for this).
--   * focus_runs joins the supabase_realtime publication, so another device of
--     the same person sees a change within a couple of seconds. Realtime checks
--     the subscriber's RLS (own rows) on inserts and updates; a delete carries
--     only the row's random id.

-- ── 0. Preconditions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.task_queue') IS NULL
     OR to_regprocedure('public.tasks_queue__mine(uuid, uuid)') IS NULL
     OR to_regprocedure('public.tasks_queue__lock(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TV-D2 (20261008171500_tasks_personal_queue) must be applied first.';
  END IF;
  IF to_regclass('public.task_time_entries') IS NULL THEN
    RAISE EXCEPTION 'TV-D3 (20261008225500_tasks_time_entries) must be applied first.';
  END IF;
  IF to_regprocedure('public.can_access(text, uuid, text, uuid)') IS NULL
     OR to_regprocedure('public.perm_actor_id()') IS NULL
     OR to_regprocedure('public.tasks_module_permission(uuid)') IS NULL
     OR to_regprocedure('public.perm_can_view(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'The sharing model (can_access, perm_actor_id, perm_can_view) must be applied first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'The supabase_realtime publication is missing.';
  END IF;
END;
$$;

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE public.focus_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  -- Deleting an account deletes its runs (the auth cascade takes profiles).
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  mode text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  -- The task the run is on (the head of the person's queue).
  now_task_id uuid REFERENCES public.tasks (id) ON DELETE SET NULL,
  phase text NOT NULL DEFAULT 'work',
  -- When the current phase began, moved forward by pauses: running, the phase
  -- has run now() - phase_started_at; paused, paused_at - phase_started_at.
  -- In a stopwatch run it is the start of the focus clock.
  phase_started_at timestamptz NOT NULL DEFAULT now(),
  -- The current phase's length (pomodoro only).
  phase_seconds integer,
  paused_at timestamptz,
  blocks_completed integer NOT NULL DEFAULT 0,
  -- Focused time in this run as of seen_at.
  focused_seconds integer NOT NULL DEFAULT 0,
  -- Tasks completed in this run, in order ("2 done this run · show").
  done_task_ids uuid[] NOT NULL DEFAULT '{}',
  -- The device in control, and its last write.
  device_id text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT focus_runs_status_check CHECK (status IN ('running', 'paused', 'ended')),
  CONSTRAINT focus_runs_mode_check CHECK (mode IN ('pomodoro', 'stopwatch')),
  CONSTRAINT focus_runs_phase_check CHECK (phase IN ('work', 'break', 'long_break')),
  CONSTRAINT focus_runs_ended CHECK ((status = 'ended') = (ended_at IS NOT NULL)),
  CONSTRAINT focus_runs_paused CHECK ((status = 'paused') = (paused_at IS NOT NULL)),
  CONSTRAINT focus_runs_phase_shape CHECK (
    (mode = 'pomodoro' AND phase_seconds BETWEEN 1 AND 86400)
    OR (mode = 'stopwatch' AND phase = 'work' AND phase_seconds IS NULL)
  ),
  CONSTRAINT focus_runs_counts CHECK (
    blocks_completed BETWEEN 0 AND 10000 AND focused_seconds BETWEEN 0 AND 8640000
  ),
  CONSTRAINT focus_runs_done_cap CHECK (cardinality(done_task_ids) <= 500),
  CONSTRAINT focus_runs_device_format CHECK (device_id ~ '^[A-Za-z0-9_-]{8,64}$')
);
-- One open run per person, across workspaces.
CREATE UNIQUE INDEX focus_runs_one_open ON public.focus_runs (user_id) WHERE status <> 'ended';
CREATE INDEX focus_runs_claims_idx ON public.focus_runs (workspace_id) WHERE status = 'running';
CREATE INDEX focus_runs_user_idx ON public.focus_runs (user_id, started_at DESC);
CREATE INDEX focus_runs_now_task_idx ON public.focus_runs (now_task_id) WHERE now_task_id IS NOT NULL;

COMMENT ON TABLE public.focus_runs IS
  'Queue runs (TV-F2): one row per run of a person''s queue, the shared record behind the device-side Focus clock. Written only by the focus_op_run_* ops; each person reads their own; teammates see only focus_claims ("<name> is on this").';
COMMENT ON COLUMN public.focus_runs.phase_started_at IS
  'When the current phase began, moved forward by pauses. Running: elapsed = now() - phase_started_at; paused: paused_at - phase_started_at.';

-- ── 2. Who can read it, who can write it ─────────────────────────────────────
-- Own rows only; writes only through the definer ops below.

ALTER TABLE public.focus_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focus_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.focus_runs TO authenticated;
GRANT ALL ON public.focus_runs TO service_role;

CREATE POLICY focus_runs_read_own ON public.focus_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── 3. Helpers ───────────────────────────────────────────────────────────────

-- The signed-in person, who must be able to work on tasks in the workspace.
CREATE OR REPLACE FUNCTION public.focus_runs__runner(p_workspace_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'A run belongs to a person: sign in.' USING ERRCODE = '42501';
  END IF;
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  RETURN v_user;
END;
$$;

-- One writer at a time per person: start, save and end never interleave.
CREATE OR REPLACE FUNCTION public.focus_runs__lock(p_user uuid)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('focus_runs:' || p_user::text, 0))
$$;

-- A device's clock is trusted for display only: never in the future, never
-- absurdly old.
CREATE OR REPLACE FUNCTION public.focus_runs__clamp(p_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_at IS NULL THEN NULL
    WHEN p_at > now() THEN now()
    WHEN p_at < now() - interval '30 days' THEN now()
    ELSE p_at
  END
$$;

-- Apply a device's snapshot (only the keys it sent) to a run. The Now task
-- must be a live task in the run's workspace that the person can see, else
-- the run is on nothing. Status here is running or paused; ending is its own op.
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
          AND public.can_access('task', t.id, 'view', r.user_id);
      END IF;
      r.now_task_id := v_task;
    END IF;
    IF s ? 'phase' THEN
      r.phase := s->>'phase';
    END IF;
    IF s ? 'phase_started_at' THEN
      r.phase_started_at := coalesce(public.focus_runs__clamp((s->>'phase_started_at')::timestamptz), now());
    END IF;
    IF s ? 'phase_seconds' THEN
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
  -- Paused carries its moment; running doesn't.
  IF r.status = 'paused' THEN
    r.paused_at := coalesce(r.paused_at, now());
  ELSE
    r.paused_at := NULL;
  END IF;
  RETURN r;
END;
$$;

-- ── 4. The ops ───────────────────────────────────────────────────────────────

-- Start a run (Start run in the Queue view). Any open run of yours ends first:
-- one run per person. p_state carries the first snapshot (Now, phase).
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
  IF p_mode IS NULL OR p_mode NOT IN ('pomodoro', 'stopwatch') THEN
    RAISE EXCEPTION 'A run is a pomodoro or a stopwatch.' USING ERRCODE = '22023';
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
  r.seen_at := now();
  r.created_at := now();
  r.updated_at := now();
  r := public.focus_runs__apply(r, p_state);

  INSERT INTO public.focus_runs SELECT r.*;
  RETURN r;
END;
$$;

-- Save a device's snapshot of your run. Only the device in control writes; any
-- other device gets the row back as it is (and so learns it isn't in control),
-- unless it takes control because you acted on it (p_take). An ended run, or
-- someone else's, isn't changed.
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
  r.device_id := p_device;
  r.seen_at := now();
  r.updated_at := now();
  UPDATE public.focus_runs f
  SET status = r.status, now_task_id = r.now_task_id, phase = r.phase,
      phase_started_at = r.phase_started_at, phase_seconds = r.phase_seconds,
      paused_at = r.paused_at, blocks_completed = r.blocks_completed,
      focused_seconds = r.focused_seconds, done_task_ids = r.done_task_ids,
      device_id = r.device_id, seen_at = r.seen_at, updated_at = r.updated_at
  WHERE f.id = r.id;
  RETURN r;
END;
$$;

-- End your run (End run, or the queue emptied), from any of your devices, with
-- the final snapshot. Ending works even after losing access to Tasks there.
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
  SET status = 'ended', ended_at = now(), paused_at = NULL, now_task_id = r.now_task_id,
      phase = r.phase, phase_started_at = r.phase_started_at, phase_seconds = r.phase_seconds,
      blocks_completed = r.blocks_completed, focused_seconds = r.focused_seconds,
      done_task_ids = r.done_task_ids, device_id = p_device, seen_at = now(), updated_at = now()
  WHERE f.id = r.id
  RETURNING * INTO r;
  RETURN r;
END;
$$;

-- ── 5. Claims: "<name> is on this" ───────────────────────────────────────────
-- Who in the workspace is running which task right now: a running run seen in
-- the last 3 minutes, by a member, on a task the caller can see. Nothing else
-- about anyone's run, and never the caller's own.
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
    AND public.can_access('task', r.now_task_id, 'view', auth.uid())
  ORDER BY r.started_at, r.user_id
$$;

-- ── 6. The stale line-up: "Keep all" ─────────────────────────────────────────
-- Marks your line-up in the workspace as looked at: the app shows "Lined up
-- N days ago" from the newest updated_at of your queue rows. Not logged.
CREATE OR REPLACE FUNCTION public.tasks_op_queue_keep(p_workspace_id uuid)
RETURNS SETOF public.task_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A queue belongs to a person: sign in, or use an API key.';
  END IF;
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks_queue__lock(p_workspace_id, v_actor);
  UPDATE public.task_queue q SET updated_at = now()
  WHERE q.workspace_id = p_workspace_id AND q.user_id = v_actor;
  RETURN QUERY SELECT * FROM public.tasks_queue__mine(p_workspace_id, v_actor);
END;
$$;

-- ── 7. Leaving a workspace takes your runs there ─────────────────────────────
-- Also fires on account deletion (the membership cascade): the runs would go
-- with the profile anyway.
CREATE OR REPLACE FUNCTION public.focus_runs_member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.focus_runs f
  WHERE f.workspace_id = OLD.workspace_id AND f.user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER focus_runs_member_removed
  AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.focus_runs_member_removed();

-- ── 8. Time entries belong to a run ──────────────────────────────────────────

ALTER TABLE public.task_time_entries
  ADD CONSTRAINT task_time_entries_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES public.focus_runs (id) ON DELETE SET NULL;
CREATE INDEX task_time_entries_run_idx ON public.task_time_entries (run_id) WHERE run_id IS NOT NULL;

-- ── 9. Live updates for your other devices ───────────────────────────────────

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

-- ── 10. Grants ───────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated directly,
-- so they are revoked by name (REVOKE … FROM PUBLIC alone leaves anon).
DO $$
DECLARE fn text;
BEGIN
  -- The ops and the claims read: signed-in users (and the service role).
  FOREACH fn IN ARRAY ARRAY[
    'focus_op_run_start(uuid, text, text, jsonb)',
    'focus_op_run_save(uuid, text, boolean, jsonb)',
    'focus_op_run_end(uuid, text, jsonb)',
    'focus_claims(uuid)',
    'tasks_op_queue_keep(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- Helpers and triggers: only the definer functions above call them.
  FOREACH fn IN ARRAY ARRAY[
    'focus_runs__runner(uuid)',
    'focus_runs__lock(uuid)',
    'focus_runs__clamp(timestamptz)',
    'focus_runs__apply(public.focus_runs, jsonb)',
    'focus_runs_member_removed()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END;
$$;
