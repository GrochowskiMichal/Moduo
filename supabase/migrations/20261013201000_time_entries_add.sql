-- TV-D14 · Time entries you log, the time report (specs/tasks-v3.md block 29,
-- §14, §Assumptions #18, #26; REPLAN 75; decisions in docs/decisions/tasks.md
-- "TV-D14"). Builds on TV-D3's task_time_entries (20261008225500) and TV-F6's
-- run_id foreign key (20261013130000).
--
--   * "Add time…": a logged entry (kind `manual`) is a length on a day you
--     pick, with an optional note ("2h · yesterday · call with Anna"). Your
--     own logged and Focus entries can be edited (length, note; a logged
--     entry's day) and removed; a Focus stretch keeps its end.
--   * Focus saves carry their run (run_id, only a run of yours in that
--     workspace); a give-back after a takeover (TV-F6, F6-16) is labelled
--     (reason `give_back`) and can't be removed by hand.
--   * The task gate (TV-D10-fix): you read your own entries only on tasks you
--     can still see; writing needs Edit on the task, and only your own entries
--     change.
--   * tasks_time_report: the rows behind the report sheet, the project
--     overview and Home's time widget. Each row is one entry on a task the
--     reader can see (tasks__visible_to), on a day of the period in the
--     reader's zone; your own entries always, a teammate's only when the
--     reader owns the workspace and that teammate shares their time
--     (user_preferences.share_time_with_owner). Waiting time and the dateless
--     legacy totals never count; a work session's planned length is not an
--     entry, so it never counts either. Scoped to projects or a client, every
--     project must be one the reader can see; a project the reader can't see
--     has no name in the rows.
--   * Account erasure clears the person's notes on their entries in
--     workspaces they don't own (the seconds stay in each task's total, and
--     the account's deletion already forgets whose they were).
--
-- Apply after 20261013200000_user_preferences_time_region. Redefines
-- tasks_op_track_time (new parameters: the old signature is dropped first, so
-- PostgREST never sees two), tasks_time__mine and tasks_time_totals (a logged
-- entry is your share too), the read policy on task_time_entries and
-- account_erase_workspace_data (by anchored replace on its live body).
-- Verified on the local stack by supabase/tests/time_report.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 0. Preconditions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.task_time_entries') IS NULL
     OR to_regprocedure('public.tasks_time__sum(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D3 (20261008225500_tasks_time_entries) before this migration.';
  END IF;
  IF to_regprocedure('public.tasks__visible(uuid)') IS NULL
     OR to_regprocedure('public.tasks__visible_to(uuid, uuid)') IS NULL
     OR to_regprocedure('public.projects__visible_to(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D10 and TV-D10-fix before this migration.';
  END IF;
  IF to_regclass('public.focus_runs') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_time_entries_run_id_fkey') THEN
    RAISE EXCEPTION 'Apply TV-F6 (20261013130000_focus_runs_v3) before this migration.';
  END IF;
  IF to_regprocedure('public.time_region__zone_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013200000_user_preferences_time_region first.';
  END IF;
END;
$$;

-- ── 1. The entry: a logged day, a note, a give-back label ─────────────────────

ALTER TABLE public.task_time_entries
  ADD COLUMN IF NOT EXISTS entry_on date,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS reason text;

ALTER TABLE public.task_time_entries DROP CONSTRAINT IF EXISTS task_time_entries_kind_check;
ALTER TABLE public.task_time_entries DROP CONSTRAINT IF EXISTS task_time_entries_shape;
ALTER TABLE public.task_time_entries DROP CONSTRAINT IF EXISTS task_time_entries_entry_on_shape;
ALTER TABLE public.task_time_entries DROP CONSTRAINT IF EXISTS task_time_entries_note_shape;
ALTER TABLE public.task_time_entries DROP CONSTRAINT IF EXISTS task_time_entries_reason_check;

ALTER TABLE public.task_time_entries
  ADD CONSTRAINT task_time_entries_kind_check
    CHECK (kind IN ('focus','waiting','adjustment','legacy','manual')),
  ADD CONSTRAINT task_time_entries_shape CHECK (
    (kind IN ('focus', 'waiting') AND seconds > 0
       AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at)
    OR (kind = 'adjustment' AND seconds <> 0)
    OR (kind = 'legacy' AND seconds > 0)
    OR (kind = 'manual' AND seconds > 0 AND entry_on IS NOT NULL)
  ),
  ADD CONSTRAINT task_time_entries_entry_on_shape CHECK (entry_on IS NULL OR kind = 'manual'),
  ADD CONSTRAINT task_time_entries_note_shape CHECK (
    note IS NULL OR (kind IN ('manual', 'focus') AND char_length(note) BETWEEN 1 AND 500)),
  ADD CONSTRAINT task_time_entries_reason_check CHECK (
    reason IS NULL OR (kind = 'adjustment' AND reason IN ('give_back')));

CREATE INDEX IF NOT EXISTS task_time_entries_workspace_day_idx
  ON public.task_time_entries (workspace_id, entry_on) WHERE entry_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_time_entries_workspace_started_idx
  ON public.task_time_entries (workspace_id, (coalesce(started_at, created_at)));

COMMENT ON COLUMN public.task_time_entries.entry_on IS
  'TV-D14: the day a logged entry (kind manual) is for. Other entries take their day from when they happened, in the reader''s zone.';
COMMENT ON COLUMN public.task_time_entries.note IS
  'TV-D14: the person''s note on a logged or Focus entry (at most 500 characters). Cleared by account erasure.';
COMMENT ON COLUMN public.task_time_entries.reason IS
  'TV-D14: why an adjustment exists: give_back = time counted on two devices, given back after a takeover (TV-F6).';

-- ── 2. Who reads it: your own entries, on tasks you can still see ────────────

-- The table grants as TV-D3 set them (a no-op on production; it closes the
-- local stack's drift, whose schema snapshot grants every role everything,
-- TRUNCATE included, which RLS doesn't gate).
REVOKE ALL ON public.task_time_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_time_entries TO authenticated;
GRANT ALL ON public.task_time_entries TO service_role;

DROP POLICY IF EXISTS task_time_entries_read_own ON public.task_time_entries;
CREATE POLICY task_time_entries_read_own ON public.task_time_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         AND public.perm_can_view(workspace_id, 'tasks')
         AND public.tasks__visible(task_id));

-- ── 3. Your share includes what you logged ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_time__mine(p_task_id uuid, p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT least(greatest(coalesce(sum(e.seconds), 0), 0), public.tasks_time__total(p_task_id))::integer
  FROM public.task_time_entries e
  WHERE e.task_id = p_task_id AND e.user_id = p_user AND e.kind IN ('focus', 'adjustment', 'manual')
$$;

-- Re-cut from the live body (TV-D3): a logged entry counts in your share, and
-- in your share since a time by its day (its start, in UTC).
CREATE OR REPLACE FUNCTION public.tasks_time_totals(p_workspace_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS TABLE (
  task_id uuid,
  total_seconds integer,
  my_seconds integer,
  my_waiting_seconds integer,
  my_seconds_since integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH sums AS (
    SELECT e.task_id AS tid,
           least(greatest(coalesce(sum(e.seconds) FILTER (WHERE e.kind <> 'waiting'), 0), 0),
                 2147483647)::integer AS total,
           greatest(coalesce(sum(e.seconds) FILTER (
             WHERE e.user_id = v_actor AND e.kind IN ('focus', 'adjustment', 'manual')), 0), 0) AS mine,
           coalesce(sum(e.seconds) FILTER (
             WHERE e.user_id = v_actor AND e.kind = 'waiting'), 0) AS waiting,
           greatest(coalesce(sum(e.seconds) FILTER (
             WHERE e.user_id = v_actor AND e.kind IN ('focus', 'adjustment', 'manual')
               AND coalesce(e.ended_at, e.entry_on::timestamptz, e.created_at) >= p_since), 0), 0) AS mine_since
    FROM public.task_time_entries e
    JOIN public.tasks t ON t.id = e.task_id
    WHERE e.workspace_id = p_workspace_id AND t.workspace_id = p_workspace_id
      AND t.deleted_at IS NULL
    GROUP BY e.task_id
  )
  SELECT s.tid,
         s.total,
         least(s.mine, s.total)::integer,
         least(s.waiting, 2147483647)::integer,
         CASE WHEN p_since IS NULL THEN NULL ELSE least(s.mine_since, s.total)::integer END
  FROM sums s
  WHERE public.can_access('task', s.tid, 'view', v_actor);
END;
$$;

-- ── 4. The op ────────────────────────────────────────────────────────────────
-- Re-cut from the live body (TV-D3, unchanged since). New:
--   'add'     log p_seconds (a minute … 24 hours) on day p_on (up to ~13
--             months back, never after tomorrow), with p_note; p_client_key
--             makes a resend count once;
--   'edit'    your own logged or Focus entry p_entry_id: p_seconds (a Focus
--             stretch keeps its end), p_on (logged entries), p_note ('' clears
--             it, NULL leaves it);
--   'remove'  your own logged or Focus entry p_entry_id;
--   p_run_id  on 'focus' and 'adjust': the Focus run it came from (kept only
--             when it is a run of yours in this workspace);
--   p_reason  on 'adjust': 'give_back' (TV-F6's takeover give-back).
-- Answers as before: {status, task_id, entry_id, total_seconds, my_seconds,
-- my_waiting_seconds}.

DROP FUNCTION IF EXISTS public.tasks_op_track_time(uuid, uuid, text, integer, timestamptz, text, uuid);

CREATE OR REPLACE FUNCTION public.tasks_op_track_time(
  p_workspace_id uuid,
  p_task_id uuid,
  p_action text,
  p_seconds integer DEFAULT NULL,
  p_ended_at timestamptz DEFAULT NULL,
  p_client_key text DEFAULT NULL,
  p_entry_id uuid DEFAULT NULL,
  p_on date DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_run_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_action text := lower(coalesce(p_action, ''));
  t public.tasks;
  e public.task_time_entries;
  v_entry uuid;
  v_seconds integer;
  v_ended timestamptz;
  v_status text := 'saved';
  v_note text := CASE WHEN p_note IS NULL THEN NULL ELSE nullif(btrim(p_note), '') END;
  v_zone text;
  v_today date;
  v_run uuid;
BEGIN
  IF v_action NOT IN ('focus','waiting','adjust','set_total','undo','add','edit','remove') THEN
    RAISE EXCEPTION 'Unknown time action: %', p_action USING ERRCODE = '22023';
  END IF;
  IF v_action IN ('focus', 'waiting') AND (p_seconds IS NULL OR p_seconds < 1 OR p_seconds > 604800) THEN
    RAISE EXCEPTION 'A tracked stretch is between a second and a week long.' USING ERRCODE = '22023';
  ELSIF v_action = 'adjust' AND (p_seconds IS NULL OR p_seconds = 0 OR abs(p_seconds) > 315360000) THEN
    RAISE EXCEPTION 'An adjustment needs a number of seconds.' USING ERRCODE = '22023';
  ELSIF v_action = 'set_total' AND (p_seconds IS NULL OR p_seconds < 0 OR p_seconds > 315360000) THEN
    RAISE EXCEPTION 'The total can''t be negative.' USING ERRCODE = '22023';
  ELSIF v_action IN ('undo', 'edit', 'remove') AND p_entry_id IS NULL THEN
    RAISE EXCEPTION 'Say which entry.' USING ERRCODE = '22023';
  ELSIF v_action = 'add' AND (p_seconds IS NULL OR p_seconds < 60 OR p_seconds > 86400) THEN
    RAISE EXCEPTION 'Logged time is between a minute and 24 hours.' USING ERRCODE = '22023';
  ELSIF v_action = 'add' AND p_on IS NULL THEN
    RAISE EXCEPTION 'Logged time needs a day.' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND (v_action NOT IN ('add', 'edit') OR char_length(btrim(p_note)) > 500) THEN
    RAISE EXCEPTION 'A note is at most 500 characters, on time you log or edit.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND (v_action <> 'adjust' OR p_reason NOT IN ('give_back')) THEN
    RAISE EXCEPTION 'Unknown reason for an adjustment.' USING ERRCODE = '22023';
  END IF;
  IF p_client_key IS NOT NULL AND p_client_key !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'That save key isn''t valid.' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Tracked time belongs to a person: sign in, or use an API key.' USING ERRCODE = '42501';
  END IF;
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;

  -- The task, locked: writes to one task's time go one at a time, so a resend
  -- waits for the first copy and then finds it.
  SELECT * INTO t FROM public.tasks
  WHERE id = p_task_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
    RETURN jsonb_build_object('status', 'gone', 'task_id', p_task_id);
  END IF;
  IF NOT public.can_access('task', t.id, 'edit', v_actor) THEN
    RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
  END IF;

  IF p_client_key IS NOT NULL AND v_action NOT IN ('undo', 'edit', 'remove') THEN
    SELECT x.id INTO v_entry FROM public.task_time_entries x
    WHERE x.task_id = t.id AND x.client_key = p_client_key;
    IF FOUND THEN
      RETURN public.tasks_time__answer(t.id, v_actor, 'duplicate', v_entry);
    END IF;
  END IF;

  -- A run is kept only when it is the caller's own, in this workspace.
  IF p_run_id IS NOT NULL AND v_action IN ('focus', 'adjust') THEN
    SELECT r.id INTO v_run FROM public.focus_runs r
    WHERE r.id = p_run_id AND r.user_id = v_actor AND r.workspace_id = t.workspace_id;
  END IF;

  IF v_action IN ('add', 'edit') AND p_on IS NOT NULL THEN
    v_zone := public.tasks__known_zone(v_actor);
    v_today := (now() AT TIME ZONE CASE WHEN public.time_region__zone_ok(v_zone) THEN v_zone ELSE 'UTC' END)::date;
    IF p_on > v_today + 1 OR p_on < v_today - 400 THEN
      RAISE EXCEPTION 'Logged time goes on a day from the last 13 months, up to today.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_action IN ('focus', 'waiting') THEN
    v_ended := least(coalesce(p_ended_at, now()), now());
    IF v_ended < now() - interval '1 year' THEN
      v_ended := now();
    END IF;
    INSERT INTO public.task_time_entries
      (workspace_id, task_id, user_id, kind, started_at, ended_at, seconds, client_key, run_id)
    VALUES
      (t.workspace_id, t.id, v_actor, v_action,
       v_ended - make_interval(secs => p_seconds), v_ended, p_seconds, p_client_key,
       CASE WHEN v_action = 'focus' THEN v_run END)
    RETURNING id INTO v_entry;
  ELSIF v_action = 'add' THEN
    INSERT INTO public.task_time_entries
      (workspace_id, task_id, user_id, kind, seconds, entry_on, note, client_key)
    VALUES
      (t.workspace_id, t.id, v_actor, 'manual', p_seconds, p_on, v_note, p_client_key)
    RETURNING id INTO v_entry;
  ELSIF v_action IN ('adjust', 'set_total') THEN
    IF v_action = 'adjust' THEN
      v_seconds := greatest(p_seconds, -greatest(public.tasks_time__sum(t.id), 0))::integer;
    ELSE
      v_seconds := (p_seconds - public.tasks_time__sum(t.id))::integer;
    END IF;
    IF v_seconds = 0 THEN
      v_status := 'noop';
    ELSE
      INSERT INTO public.task_time_entries
        (workspace_id, task_id, user_id, kind, seconds, client_key, run_id, reason)
      VALUES (t.workspace_id, t.id, v_actor, 'adjustment', v_seconds, p_client_key, v_run, p_reason)
      RETURNING id INTO v_entry;
    END IF;
  ELSIF v_action = 'edit' THEN
    SELECT * INTO e FROM public.task_time_entries x
    WHERE x.id = p_entry_id AND x.task_id = t.id AND x.user_id = v_actor
      AND x.kind IN ('manual', 'focus')
    FOR UPDATE;
    IF NOT FOUND THEN
      v_status := 'noop';
    ELSE
      IF p_seconds IS NOT NULL AND (p_seconds < 1
           OR (e.kind = 'manual' AND (p_seconds < 60 OR p_seconds > 86400))
           OR (e.kind = 'focus' AND p_seconds > 604800)) THEN
        RAISE EXCEPTION 'That length doesn''t fit this entry.' USING ERRCODE = '22023';
      END IF;
      IF p_on IS NOT NULL AND e.kind <> 'manual' THEN
        RAISE EXCEPTION 'A Focus stretch stays on the day it happened.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.task_time_entries x SET
        seconds = coalesce(p_seconds, x.seconds),
        -- A Focus stretch keeps its end (it never ends after now); a new
        -- length moves its start.
        started_at = CASE WHEN x.kind = 'focus' AND p_seconds IS NOT NULL
                          THEN x.ended_at - make_interval(secs => p_seconds) ELSE x.started_at END,
        entry_on = CASE WHEN x.kind = 'manual' THEN coalesce(p_on, x.entry_on) ELSE x.entry_on END,
        note = CASE WHEN p_note IS NULL THEN x.note ELSE v_note END
      WHERE x.id = e.id;
      v_entry := e.id;
    END IF;
  ELSIF v_action = 'remove' THEN
    DELETE FROM public.task_time_entries x
    WHERE x.id = p_entry_id AND x.task_id = t.id AND x.user_id = v_actor AND x.kind IN ('manual', 'focus')
    RETURNING x.id INTO v_entry;
    IF v_entry IS NULL THEN
      v_status := 'noop';
    END IF;
  ELSE
    -- Undo: your own adjustment, never a give-back.
    DELETE FROM public.task_time_entries x
    WHERE x.id = p_entry_id AND x.task_id = t.id AND x.user_id = v_actor AND x.kind = 'adjustment'
      AND x.reason IS NULL
    RETURNING x.id INTO v_entry;
    IF v_entry IS NULL THEN
      v_status := 'noop';
    END IF;
  END IF;

  -- Taking time away after someone else did (typed 0, say) leaves the task at
  -- zero rather than owing time, so time saved later counts in full. The
  -- evening-out entry is nobody's to undo.
  IF v_status = 'saved' AND v_action IN ('undo', 'edit', 'remove')
     AND public.tasks_time__sum(t.id) < 0 THEN
    INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds)
    VALUES (t.workspace_id, t.id, NULL, 'adjustment', -public.tasks_time__sum(t.id));
  END IF;

  IF v_status <> 'noop' AND v_action <> 'waiting' THEN
    PERFORM public.tasks_time__store_total(t.id);
  END IF;
  RETURN public.tasks_time__answer(t.id, v_actor, v_status, v_entry);
END;
$$;

-- ── 5. The report ────────────────────────────────────────────────────────────
-- One row per entry, on a task the reader can see, dated p_from … p_to
-- (inclusive, at most a year) in p_zone (else the reader's saved zone, else
-- UTC). Scope: p_project_ids, or p_client_contact_id (the projects whose
-- client it is), or the whole workspace; a scoped report reads only projects
-- the reader can see. Rows: the reader's own entries, and when the reader
-- owns the workspace, the entries of people who share their time. Signed
-- (a give-back is negative): sum them. At most p_limit rows, in a total order
-- (the app pages with PostgREST's range and asks for rows up to its page's
-- end, one past its cap to know a report was cut).

CREATE OR REPLACE FUNCTION public.tasks_time_report(
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_project_ids uuid[] DEFAULT NULL,
  p_client_contact_id uuid DEFAULT NULL,
  p_zone text DEFAULT NULL,
  p_limit integer DEFAULT 5001
)
RETURNS TABLE (
  entry_id uuid,
  task_id uuid,
  task_title text,
  project_id uuid,
  project_name text,
  project_is_inbox boolean,
  user_id uuid,
  is_mine boolean,
  entry_day date,
  seconds integer,
  kind text,
  reason text,
  note text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_zone text;
  v_owner boolean;
  v_scoped boolean := p_project_ids IS NOT NULL OR p_client_contact_id IS NOT NULL;
  v_limit integer := least(greatest(coalesce(p_limit, 5001), 1), 20001);
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL
     OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'A report covers a period of up to a year.' USING ERRCODE = '22023';
  END IF;
  IF p_project_ids IS NOT NULL AND cardinality(p_project_ids) > 500 THEN
    RAISE EXCEPTION 'A report covers at most 500 projects.' USING ERRCODE = '22023';
  END IF;
  v_zone := p_zone;
  IF NOT public.time_region__zone_ok(v_zone) THEN
    v_zone := public.tasks__known_zone(v_actor);
    IF NOT public.time_region__zone_ok(v_zone) THEN
      v_zone := 'UTC';
    END IF;
  END IF;
  v_owner := EXISTS (SELECT 1 FROM public.workspaces w
                     WHERE w.id = p_workspace_id AND w.owner_id = v_actor);

  RETURN QUERY
  WITH people AS (
    -- Whose entries this reader may read: their own, and (owners only) the
    -- people who share their time.
    SELECT v_actor AS uid
    UNION
    SELECT up.user_id FROM public.user_preferences up
    WHERE v_owner AND up.share_time_with_owner
  ),
  near AS (
    SELECT x.*,
           coalesce(x.entry_on,
                    (coalesce(x.started_at, x.created_at) AT TIME ZONE v_zone)::date) AS on_day
    FROM public.task_time_entries x
    WHERE x.workspace_id = p_workspace_id
      AND x.kind IN ('focus', 'manual', 'adjustment')
      AND x.user_id IN (SELECT uid FROM people)
      AND ((x.entry_on IS NOT NULL AND x.entry_on BETWEEN p_from AND p_to)
           OR (x.entry_on IS NULL
               AND coalesce(x.started_at, x.created_at) >= (p_from - 2)::timestamp AT TIME ZONE 'UTC'
               AND coalesce(x.started_at, x.created_at) < (p_to + 3)::timestamp AT TIME ZONE 'UTC'))
  )
  SELECT n.id,
         t.id,
         t.title,
         t.bucket_id,
         CASE WHEN b.id IS NOT NULL AND public.projects__visible_to(b.id, v_actor) THEN b.name END,
         CASE WHEN b.id IS NOT NULL AND public.projects__visible_to(b.id, v_actor)
              THEN coalesce(b.is_system, false) END,
         n.user_id,
         n.user_id = v_actor,
         n.on_day,
         n.seconds,
         n.kind,
         n.reason,
         n.note
  FROM near n
  JOIN public.tasks t ON t.id = n.task_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL
  LEFT JOIN public.buckets b ON b.id = t.bucket_id
  WHERE n.on_day BETWEEN p_from AND p_to
    AND (p_project_ids IS NULL OR t.bucket_id = ANY (p_project_ids))
    AND (p_client_contact_id IS NULL OR b.client_contact_id = p_client_contact_id)
    AND (NOT v_scoped OR (b.id IS NOT NULL AND public.projects__visible_to(b.id, v_actor)))
    AND public.tasks__visible_to(t.id, v_actor)
  ORDER BY n.on_day, t.title, t.id, n.created_at, n.id
  LIMIT v_limit;
END;
$$;

-- ── 6. Account erasure (§Assumptions #26) ────────────────────────────────────
-- Anchored replace on the live body (TV-F6's lines), like TV-D15 did: the
-- person's notes go; the seconds stay in each task's total.

DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
BEGIN
  IF position('time_notes_cleared' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position('v_focus_runs integer;' IN v_def) = 0
     OR position('SELECT count(*) INTO v_focus_runs' IN v_def) = 0
     OR position('''focus_runs_deleted'', v_focus_runs' IN v_def) = 0
     OR position('DELETE FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_new := replace(v_def, 'v_focus_runs integer;',
    'v_focus_runs integer;' || E'\n  v_time_notes integer;');
  v_new := replace(v_new, 'SELECT count(*) INTO v_focus_runs',
    'SELECT count(*) INTO v_time_notes'
    || E'\n  FROM public.task_time_entries x'
    || E'\n  WHERE x.user_id = p_user AND x.note IS NOT NULL AND x.workspace_id <> ALL (v_owned);'
    || E'\n  SELECT count(*) INTO v_focus_runs');
  v_new := replace(v_new, '''focus_runs_deleted'', v_focus_runs',
    '''focus_runs_deleted'', v_focus_runs,'
    || E'\n    ''time_notes_cleared'', v_time_notes');
  v_new := replace(v_new,
    'DELETE FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);',
    'DELETE FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);'
    || E'\n  -- TV-D14: their notes on tracked time (the seconds stay in the totals).'
    || E'\n  UPDATE public.task_time_entries x SET note = NULL'
    || E'\n  WHERE x.user_id = p_user AND x.note IS NOT NULL AND x.workspace_id <> ALL (v_owned);');
  EXECUTE v_new;
END;
$erase$;

-- ── 7. Grants ────────────────────────────────────────────────────────────────
-- DROP + CREATE reset the op's grants, so every one is set again by name.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_track_time(uuid, uuid, text, integer, timestamptz, text, uuid, date, text, uuid, text)',
    'tasks_time_totals(uuid, timestamptz)',
    'tasks_time_report(uuid, date, date, uuid[], uuid, text, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.tasks_time__mine(uuid, uuid) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tasks_time__mine(uuid, uuid) FROM anon';
  EXECUTE 'REVOKE ALL ON FUNCTION public.tasks_time__mine(uuid, uuid) FROM authenticated';
END;
$$;
