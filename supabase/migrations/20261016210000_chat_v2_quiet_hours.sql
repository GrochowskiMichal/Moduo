-- Chat v2 · CV-18 Quiet hours, pausing and holds (specs/chat-v2.md §10, §11,
-- §15; CH7, CH41, CH46, CH74; §Assumptions #21, #33;
-- .design/chat-v2/research/round-3-database.md §2.10, §2.12, §2.14 f).
-- The stamp is fixed by the build's queue (after CV-13, CV-19, CV-16). It runs
-- again cleanly over itself.
--
-- What it does:
--   1. Quiet hours live with Time & region: user_preferences.quiet_hours_on,
--      quiet_from, quiet_to (a range in the person's zone that may cross
--      midnight), written only by user_op_set_time_region (key quiet_hours =
--      {on, from, to}) and read by user_time_region. The guard keeps the
--      columns op-only, like the zone.
--   2. time_region__quiet_now(user, at) → (quiet, back_at), in the person's
--      saved zone (UTC when unknown).
--   3. Pausing a workspace: workspace_members.notices_paused_at, written only by
--      workspace_op_pause_notices(ws, paused) on the caller's own row.
--   4. The gate's rules (notice__gate): drop while the workspace is paused, in
--      quiet hours or on do not disturb; hold chat kinds while a Focus run is
--      running (in its work phase, seen in the last 3 minutes, any
--      workspace); otherwise send. Kinds that break through: none.
--   5. A BEFORE INSERT trigger on notice_deliveries asks the gate for every
--      row, so every module's device notices (Tasks' reminders included) are
--      dropped by the same rules; the bell row and Catch up item are written
--      by their own writers and always stay.
--   6. Chat's switches in Settings (Direct messages, Mentions and replies,
--      Announcements, Every message) now hold server-side: a switch that is
--      off writes no device notice and no email for its messages.
--   7. A Catch up item written while the gate drops (or its switch is off) is
--      stamped held_at, and the email job never emails it; the job also sends
--      nothing while the person is paused, in quiet hours or on do not
--      disturb, and stamps what waits then (nothing pings when it ends).
--   8. Focus ending (a run leaving running): that person's held notices close
--      and one chat_focus_summary goes through the gate ("3 messages while
--      you focused").
--   9. chat_now gains quiet_now and back_at ("Sofia's quiet hours · back
--      9:00"); people in quiet hours are listed.
--  10. Setting or clearing a status is limited to 30 changes in 10 minutes.
--
-- Every redefined function is changed in place from its live body
-- (pg_temp.recut, as CV-6a and CV-17): a body that has moved on stops the
-- migration. Grants are re-stated by name at the end.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.recut(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
BEGIN
  -- Already cut (a re-run): the new text may contain the old, so look for it first.
  IF position(p_new IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old IN v_def) = 0 THEN
    RAISE EXCEPTION '% isn''t the body this migration expects; redefine it by hand.', p_fn;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$$;

-- ── 1. Quiet hours in Time & region ─────────────────────────────────────────

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS quiet_hours_on boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_from time,
  ADD COLUMN IF NOT EXISTS quiet_to time;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.user_preferences'::regclass
                    AND conname = 'user_preferences_quiet_hours_shape') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_quiet_hours_shape
      CHECK (NOT quiet_hours_on
             OR (quiet_from IS NOT NULL AND quiet_to IS NOT NULL AND quiet_from <> quiet_to));
  END IF;
END;
$$;

-- The guard: the columns are the op's, like the zone.
SELECT pg_temp.recut('public.user_preferences__time_region_guard()'::regprocedure,
$o$    NEW.share_time_with_owner := false;
  ELSE$o$,
$n$    NEW.share_time_with_owner := false;
    NEW.quiet_hours_on := false;
    NEW.quiet_from := NULL;
    NEW.quiet_to := NULL;
  ELSE$n$);
SELECT pg_temp.recut('public.user_preferences__time_region_guard()'::regprocedure,
$o$    NEW.share_time_with_owner := OLD.share_time_with_owner;
  END IF;$o$,
$n$    NEW.share_time_with_owner := OLD.share_time_with_owner;
    NEW.quiet_hours_on := OLD.quiet_hours_on;
    NEW.quiet_from := OLD.quiet_from;
    NEW.quiet_to := OLD.quiet_to;
  END IF;$n$);

-- The read: quiet_hours = {on, from, to} ("HH:MM", or null when never set).
SELECT pg_temp.recut('public.user_time_region()'::regprocedure,
$o$    'share_time_with_owner', coalesce(p.share_time_with_owner, false))$o$,
$n$    'share_time_with_owner', coalesce(p.share_time_with_owner, false),
    'quiet_hours', jsonb_build_object(
      'on', coalesce(p.quiet_hours_on, false),
      'from', to_char(p.quiet_from, 'HH24:MI'),
      'to', to_char(p.quiet_to, 'HH24:MI')))$n$);

-- The op: key quiet_hours = {on, from, to}. Turning them on needs a range;
-- from and to are "HH:MM" and differ (19:00 → 9:00 crosses midnight).
SELECT pg_temp.recut('public.user_op_set_time_region(jsonb)'::regprocedure,
$o$  v_share boolean;
BEGIN$o$,
$n$  v_share boolean;
  v_quiet jsonb;
  v_q_on boolean;
  v_q_from time;
  v_q_to time;
  v_q_key text;
BEGIN$n$);
SELECT pg_temp.recut('public.user_op_set_time_region(jsonb)'::regprocedure,
$o$'date_order', 'share_time_with_owner') THEN$o$,
$n$'date_order', 'share_time_with_owner', 'quiet_hours') THEN$n$);
SELECT pg_temp.recut('public.user_op_set_time_region(jsonb)'::regprocedure,
$o$  INSERT INTO public.user_preferences (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;$o$,
$n$  IF p_patch ? 'quiet_hours' THEN
    v_quiet := p_patch -> 'quiet_hours';
    IF jsonb_typeof(v_quiet) <> 'object' OR jsonb_typeof(v_quiet -> 'on') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Quiet hours are on or off, with a range.' USING ERRCODE = '22023';
    END IF;
    FOR v_q_key IN SELECT jsonb_object_keys(v_quiet) LOOP
      IF v_q_key NOT IN ('on', 'from', 'to') THEN
        RAISE EXCEPTION 'Unknown quiet hours setting: %', v_q_key USING ERRCODE = '22023';
      END IF;
    END LOOP;
    FOREACH v_q_key IN ARRAY ARRAY['from', 'to'] LOOP
      IF v_quiet ? v_q_key AND jsonb_typeof(v_quiet -> v_q_key) <> 'null'
         AND (jsonb_typeof(v_quiet -> v_q_key) <> 'string'
              OR (v_quiet ->> v_q_key) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
        RAISE EXCEPTION 'Quiet hours start and end at a time like 19:00.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_q_on := (v_quiet ->> 'on')::boolean;
    v_q_from := (v_quiet ->> 'from')::time;
    v_q_to := (v_quiet ->> 'to')::time;
  END IF;

  INSERT INTO public.user_preferences (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;
  IF p_patch ? 'quiet_hours' THEN
    -- A range left out keeps the saved one.
    SELECT coalesce(v_q_from, CASE WHEN NOT (v_quiet ? 'from') THEN p.quiet_from END),
           coalesce(v_q_to, CASE WHEN NOT (v_quiet ? 'to') THEN p.quiet_to END)
      INTO v_q_from, v_q_to
      FROM public.user_preferences p WHERE p.user_id = v_user;
    IF v_q_on AND (v_q_from IS NULL OR v_q_to IS NULL) THEN
      RAISE EXCEPTION 'Pick when quiet hours start and end.' USING ERRCODE = '22023';
    END IF;
    IF v_q_from = v_q_to THEN
      RAISE EXCEPTION 'Quiet hours start and end at different times.' USING ERRCODE = '22023';
    END IF;
  END IF;$n$);
SELECT pg_temp.recut('public.user_op_set_time_region(jsonb)'::regprocedure,
$o$    share_time_with_owner = CASE WHEN p_patch ? 'share_time_with_owner' THEN v_share
                                 ELSE p.share_time_with_owner END$o$,
$n$    share_time_with_owner = CASE WHEN p_patch ? 'share_time_with_owner' THEN v_share
                                 ELSE p.share_time_with_owner END,
    quiet_hours_on = CASE WHEN p_patch ? 'quiet_hours' THEN v_q_on ELSE p.quiet_hours_on END,
    quiet_from = CASE WHEN p_patch ? 'quiet_hours' THEN v_q_from ELSE p.quiet_from END,
    quiet_to = CASE WHEN p_patch ? 'quiet_hours' THEN v_q_to ELSE p.quiet_to END$n$);

-- ── 2. Is it someone's quiet hours? ─────────────────────────────────────────
-- In their saved zone (UTC when unknown or unreadable). back_at is when the
-- range ends, only while it holds.
CREATE OR REPLACE FUNCTION public.time_region__quiet_now(p_user uuid, p_at timestamptz,
                                                         OUT quiet boolean, OUT back_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_from time;
  v_to time;
  v_zone text;
  v_local timestamp;
  v_t time;
  v_back timestamp;
BEGIN
  quiet := false;
  back_at := NULL;
  SELECT up.quiet_from, up.quiet_to, up.time_zone INTO v_from, v_to, v_zone
    FROM public.user_preferences up
   WHERE up.user_id = p_user AND up.quiet_hours_on
     AND up.quiet_from IS NOT NULL AND up.quiet_to IS NOT NULL AND up.quiet_from <> up.quiet_to;
  IF NOT FOUND OR p_at IS NULL THEN
    RETURN;
  END IF;
  v_zone := coalesce(nullif(btrim(v_zone), ''), 'UTC');
  BEGIN
    v_local := p_at AT TIME ZONE v_zone;
  EXCEPTION WHEN OTHERS THEN
    v_zone := 'UTC';
    v_local := p_at AT TIME ZONE v_zone;
  END;
  v_t := v_local::time;
  IF v_from < v_to THEN
    -- 13:00 → 14:00: the same day.
    quiet := v_t >= v_from AND v_t < v_to;
    v_back := v_local::date + v_to;
  ELSE
    -- 19:00 → 9:00: crosses midnight.
    quiet := v_t >= v_from OR v_t < v_to;
    v_back := CASE WHEN v_t >= v_from THEN (v_local::date + 1) + v_to ELSE v_local::date + v_to END;
  END IF;
  IF quiet THEN
    back_at := v_back AT TIME ZONE v_zone;
  END IF;
END;
$$;

-- ── 3. Pausing a workspace ──────────────────────────────────────────────────

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS notices_paused_at timestamptz;

-- Only the op writes it (a direct write keeps what was there).
CREATE OR REPLACE FUNCTION public.workspace_members__pause_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.notices_paused_at := NULL;
  ELSE
    NEW.notices_paused_at := OLD.notices_paused_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspace_members__pause_guard ON public.workspace_members;
CREATE TRIGGER workspace_members__pause_guard
  BEFORE INSERT OR UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.workspace_members__pause_guard();

-- "Pause notifications from this workspace": the caller's own row, nobody else's.
CREATE OR REPLACE FUNCTION public.workspace_op_pause_notices(p_workspace_id uuid, p_paused boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_at timestamptz;
BEGIN
  IF v_user IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Sign in to pause notifications.' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR p_paused IS NULL THEN
    RAISE EXCEPTION 'Pick a workspace and whether to pause it.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspace_members m
     SET notices_paused_at = CASE WHEN p_paused THEN coalesce(m.notices_paused_at, now()) END
   WHERE m.workspace_id = p_workspace_id AND m.user_id = v_user
     AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = m.workspace_id AND w.deleted_at IS NULL)
  RETURNING m.notices_paused_at INTO v_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You''re not in that workspace.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('workspace_id', p_workspace_id, 'paused', v_at IS NOT NULL, 'paused_at', v_at);
END;
$$;

-- Your paused workspaces (for the switcher).
CREATE OR REPLACE FUNCTION public.workspace_notice_pauses()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT coalesce(jsonb_agg(m.workspace_id ORDER BY m.workspace_id), '[]'::jsonb)
    FROM public.workspace_members m
   WHERE m.user_id = auth.uid() AND m.notices_paused_at IS NOT NULL
     AND public.module_api_key_id() IS NULL
$$;

-- ── 4. The gate's rules ─────────────────────────────────────────────────────
-- drop: no device notice (the bell row and the Catch up item stay, and the
-- item never emails). hold: the row is written held_for_focus, never pushed,
-- and closed into one summary when Focus ends. Kinds that break through the
-- holds: none (Chat's list is empty; a module would add its kinds here).
CREATE OR REPLACE FUNCTION public.notice__gate(p_user uuid, p_workspace_id uuid, p_kind text, p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_kind = ANY ('{}'::text[]) THEN 'send'
    -- A paused workspace (CH46).
    WHEN p_workspace_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.workspace_members m
            WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user
              AND m.notices_paused_at IS NOT NULL) THEN 'drop'
    -- A status with do not disturb on (by hand, Out sick, On vacation), in every workspace.
    WHEN EXISTS (
           SELECT 1 FROM public.user_statuses s
            WHERE s.user_id = p_user AND s.dnd AND s.set_at IS NOT NULL
              AND (s.clear_at IS NULL OR s.clear_at > p_at)) THEN 'drop'
    -- Quiet hours, in the person's zone (CH7).
    WHEN (SELECT q.quiet FROM public.time_region__quiet_now(p_user, p_at) q) THEN 'drop'
    -- Focus holds chat's pings until the run stops running (any workspace).
    WHEN p_kind LIKE 'chat\_%' AND p_kind <> 'chat_focus_summary' AND EXISTS (
           SELECT 1 FROM public.focus_runs f
            WHERE f.user_id = p_user AND f.status = 'running' AND f.phase = 'work'
              AND f.seen_at > p_at - interval '3 minutes') THEN 'hold'
    ELSE 'send'
  END
$$;

-- ── 5. Every device notice passes the gate ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notice_deliveries__gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_gate text := public.notice__gate(NEW.user_id, NEW.workspace_id, NEW.kind, now());
BEGIN
  IF v_gate = 'drop' THEN
    RETURN NULL;
  END IF;
  IF v_gate = 'hold' THEN
    NEW.held_for_focus := true;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notice_deliveries_gate ON public.notice_deliveries;
CREATE TRIGGER notice_deliveries_gate
  BEFORE INSERT ON public.notice_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.notice_deliveries__gate();

-- ── 6. Chat's switches, server-side ─────────────────────────────────────────
-- Settings → Notifications keeps them at user_preferences.preferences ->
-- 'notifications' (false = off; absent or unreadable = on).
CREATE OR REPLACE FUNCTION public.chat__notice_switch_on(p_user uuid, p_reason text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT coalesce((
    SELECT CASE WHEN jsonb_typeof(v.val) = 'boolean' THEN (v.val #>> '{}')::boolean END
      FROM public.user_preferences up
     CROSS JOIN LATERAL (SELECT up.preferences -> 'notifications' -> (
               CASE
                 WHEN p_reason = 'dm' THEN 'chatDirect'
                 WHEN p_reason IN ('mention', 'team_mention', 'everyone', 'reply') THEN 'chatMentions'
                 WHEN p_reason = 'announcement' THEN 'chatAnnouncements'
                 WHEN p_reason = 'every_message' THEN 'chatEvery'
               END) AS val) v
     WHERE up.user_id = p_user), true)
$$;

-- Devices: a switch that is off writes no notice; what the gate drops (or a
-- switch keeps quiet) waits in Catch up stamped held, never emailed.
SELECT pg_temp.recut('public.chat__notify_devices(public.chat_channels, public.chat_messages, uuid, text, uuid[])'::regprocedure,
$o$  v_url := '/chat?c=' || p_channel.id || '&m=' || p_msg.id;
$o$,
$n$  v_url := '/chat?c=' || p_channel.id || '&m=' || p_msg.id;

  -- CV-18: what waits while the gate drops it, or its switch is off, is held.
  UPDATE public.chat_catchup k SET held_at = v_now
   WHERE k.message_id = p_msg.id AND k.user_id = ANY (p_users)
     AND k.held_at IS NULL AND k.done_at IS NULL
     AND (public.notice__gate(k.user_id, p_channel.workspace_id, v_kind, v_now) = 'drop'
          OR NOT public.chat__notice_switch_on(k.user_id, p_reason));
$n$);
SELECT pg_temp.recut('public.chat__notify_devices(public.chat_channels, public.chat_messages, uuid, text, uuid[])'::regprocedure,
$o$         AND g.gate IN ('send', 'hold')
$o$,
$n$         AND g.gate IN ('send', 'hold')
         AND public.chat__notice_switch_on(g.u, p_reason)
$n$);

-- ── 7. The email after an hour honours holds, pauses and switches ───────────
SELECT pg_temp.recut('public.chat__queue_waiting_emails(timestamptz)'::regprocedure,
$o$  v_to text;
BEGIN$o$,
$n$  v_to text;
  v_gate text;
BEGIN$n$);
SELECT pg_temp.recut('public.chat__queue_waiting_emails(timestamptz)'::regprocedure,
$o$AND k.held_at IS NULL
$o$,
$n$AND k.held_at IS NULL
       AND public.chat__notice_switch_on(k.user_id, k.reason)
$n$);
SELECT pg_temp.recut('public.chat__queue_waiting_emails(timestamptz)'::regprocedure,
$o$    -- Away: we know their apps, and none was seen in the last hour.
$o$,
$n$    -- Nothing while paused, in quiet hours or on do not disturb (CV-18): what
    -- waits then is stamped held and never emails, so nothing pings after.
    v_gate := public.notice__gate(r.user_id, r.workspace_id, 'chat_message', p_now);
    IF v_gate = 'drop' THEN
      UPDATE public.chat_catchup k SET held_at = p_now
       WHERE k.user_id = r.user_id AND k.channel_id = r.channel_id
         AND k.reason IN ('dm', 'mention', 'team_mention')
         AND k.done_at IS NULL AND k.emailed_at IS NULL AND k.held_at IS NULL;
    END IF;
    CONTINUE WHEN v_gate <> 'send';
    -- Away: we know their apps, and none was seen in the last hour.
$n$);

-- ── 8. Focus ends: held pings close into one summary ────────────────────────
CREATE OR REPLACE FUNCTION public.focus_runs__release_held()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_run public.focus_runs := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_n integer;
BEGIN
  -- Another run still running holds on (one open run per person; belt and braces).
  IF EXISTS (SELECT 1 FROM public.focus_runs f
              WHERE f.user_id = v_run.user_id AND f.id <> v_run.id AND f.status = 'running') THEN
    RETURN NULL;
  END IF;
  WITH closed AS (
    UPDATE public.notice_deliveries d SET acked_at = now()
     WHERE d.user_id = v_run.user_id AND d.held_for_focus AND d.acked_at IS NULL
    RETURNING d.id, d.channel_id, d.message_id)
  SELECT count(DISTINCT coalesce(c.message_id, c.id)) INTO v_n
    FROM closed c
   WHERE c.channel_id IS NULL OR public.chat__can_read_channel_as(c.channel_id, v_run.user_id);
  IF TG_OP = 'DELETE' OR coalesce(v_n, 0) = 0 THEN
    RETURN NULL;
  END IF;
  -- One summary, through the gate (the trigger on notice_deliveries); the
  -- items are in Catch up. A failure never stops Focus from ending.
  BEGIN
    INSERT INTO public.notice_deliveries (user_id, workspace_id, kind, title, url, tag, push_after)
    VALUES (v_run.user_id, v_run.workspace_id, 'chat_focus_summary',
            v_n || CASE WHEN v_n = 1 THEN ' message' ELSE ' messages' END || ' while you focused',
            '/chat?view=catchup', 'chat:focus:' || v_run.id, now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'focus_runs__release_held: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS focus_runs_release_held ON public.focus_runs;
CREATE TRIGGER focus_runs_release_held
  AFTER UPDATE OF status ON public.focus_runs
  FOR EACH ROW WHEN (OLD.status = 'running' AND NEW.status <> 'running')
  EXECUTE FUNCTION public.focus_runs__release_held();
DROP TRIGGER IF EXISTS focus_runs_release_held_gone ON public.focus_runs;
CREATE TRIGGER focus_runs_release_held_gone
  AFTER DELETE ON public.focus_runs
  FOR EACH ROW WHEN (OLD.status = 'running')
  EXECUTE FUNCTION public.focus_runs__release_held();

-- ── 9. chat_now: quiet hours ────────────────────────────────────────────────
-- (One step at a time, each one a body that compiles.)
SELECT pg_temp.recut('public.chat_now(uuid)'::regprocedure,
$o$       AND f.seen_at > now() - interval '3 minutes'
  ), shaped AS ($o$,
$n$       AND f.seen_at > now() - interval '3 minutes'
      LEFT JOIN LATERAL public.time_region__quiet_now(p.user_id, now()) q ON true
  ), shaped AS ($n$);
SELECT pg_temp.recut('public.chat_now(uuid)'::regprocedure,
$o$           coalesce(up.show_focus_task, false) AS show_task
$o$,
$n$           coalesce(up.show_focus_task, false) AS show_task,
           coalesce(q.quiet, false) AS quiet_now, q.back_at
$n$);
SELECT pg_temp.recut('public.chat_now(uuid)'::regprocedure,
$o$    SELECT r.user_id, r.status,
$o$,
$n$    SELECT r.user_id, r.status, r.quiet_now, r.back_at,
$n$);
SELECT pg_temp.recut('public.chat_now(uuid)'::regprocedure,
$o$           'focus_task_title', (SELECT t.title FROM public.tasks t WHERE t.id = x.task_id))$o$,
$n$           'focus_task_title', (SELECT t.title FROM public.tasks t WHERE t.id = x.task_id),
           'quiet_now', x.quiet_now,
           'back_at', x.back_at)$n$);
SELECT pg_temp.recut('public.chat_now(uuid)'::regprocedure,
$o$   WHERE x.status IS NOT NULL OR x.focusing
$o$,
$n$   WHERE x.status IS NOT NULL OR x.focusing OR x.quiet_now
$n$);

-- ── 10. A limit on status changes ───────────────────────────────────────────
-- Each change reaches every teammate live: 30 in 10 minutes per person.
CREATE TABLE IF NOT EXISTS public.user_status_changes (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  n integer NOT NULL
);
ALTER TABLE public.user_status_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_status_changes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_status_changes TO service_role;

CREATE OR REPLACE FUNCTION public.user_statuses__rate(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.user_status_changes AS c (user_id, window_start, n)
  VALUES (p_user, now(), 1)
  ON CONFLICT (user_id) DO UPDATE SET
    window_start = CASE WHEN c.window_start <= now() - interval '10 minutes' THEN now() ELSE c.window_start END,
    n = CASE WHEN c.window_start <= now() - interval '10 minutes' THEN 1 ELSE c.n + 1 END
  RETURNING c.n INTO v_n;
  IF v_n > 30 THEN
    RAISE EXCEPTION 'You''re changing your status too often. Try again in a few minutes.'
      USING ERRCODE = 'PT429';
  END IF;
END;
$$;

SELECT pg_temp.recut('public.user_op_set_status(jsonb)'::regprocedure,
$o$    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.user_statuses__parts(p_patch, false);$o$,
$n$    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.user_statuses__rate(v_user);
  SELECT * INTO p FROM public.user_statuses__parts(p_patch, false);$n$);
SELECT pg_temp.recut('public.user_op_clear_status()'::regprocedure,
$o$    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_statuses s SET$o$,
$n$    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.user_statuses__rate(v_user);
  UPDATE public.user_statuses s SET$n$);

-- ── 11. Grants ──────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated directly,
-- so they are revoked by name.
DO $$
DECLARE
  fn text;
BEGIN
  -- Server only.
  FOREACH fn IN ARRAY ARRAY[
    'time_region__quiet_now(uuid, timestamptz)',
    'notice__gate(uuid, uuid, text, timestamptz)',
    'notice_deliveries__gate()',
    'chat__notice_switch_on(uuid, text)',
    'chat__notify_devices(public.chat_channels, public.chat_messages, uuid, text, uuid[])',
    'chat__queue_waiting_emails(timestamptz)',
    'focus_runs__release_held()',
    'workspace_members__pause_guard()',
    'user_statuses__rate(uuid)',
    'user_preferences__time_region_guard()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- People (signed in; keys are refused inside).
  FOREACH fn IN ARRAY ARRAY[
    'workspace_op_pause_notices(uuid, boolean)',
    'workspace_notice_pauses()',
    'user_time_region()',
    'user_op_set_time_region(jsonb)',
    'user_op_set_status(jsonb)',
    'user_op_clear_status()',
    'chat_now(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;
