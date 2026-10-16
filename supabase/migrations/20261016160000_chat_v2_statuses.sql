-- Chat v2 · CV-17 Statuses, presence and Focus (specs/chat-v2.md §10, §15,
-- §18; CH28d, CH42, CH45, CH47, CH48; §Assumptions #17, #20, #31, #33;
-- .design/chat-v2/research/round-3-database.md §2.11, §2.13).
-- The stamp is fixed by the build's queue (after CV-10, CV-15, CV-11). It runs
-- again cleanly over itself.
--
-- What it does:
--   1. user_statuses: one status per person for every workspace (emoji ≤ 16,
--      text ≤ 100, do not disturb, clear_at, a Moduo preset or null for your
--      own). Anyone who shares a workspace with the person reads it; only its
--      owner changes it, through the ops. Published, so a change travels
--      live. "No status" is a row with nothing in it: clearing and expiry
--      update the row instead of deleting it, so every change passes the read
--      rule on its way to a listener.
--   2. user_saved_statuses: your own saved statuses ("Sleeping until 6"), at
--      most 20, private.
--   3. Ops (the person always from the session, never from the caller):
--      user_op_set_status(patch), user_op_clear_status(),
--      user_op_save_status(patch, id), user_op_forget_status(id). The app turns
--      "clear after" (30 min · 1 h · today · this week · a date · never) into
--      clear_at, because only it knows your midnight; the server checks it is
--      null or ahead (at most a year).
--   4. The job user-statuses-expire, every 5 minutes, clears statuses past
--      clear_at. Every read also treats an expired row as cleared.
--   5. chat_now(ws), the one read teammates get about Focus: per current
--      member of the workspace, their status, do not disturb, Focusing (a
--      running Focus run in its work phase, seen in the last 3 minutes, in any
--      workspace), "until" (a Pomodoro work phase's end, or the end of the Now
--      task's estimate counted from when its clock started), and the task
--      (only when its person turned on "Show what I'm focusing on", the task
--      is in this workspace and the caller can see it). It never shows the
--      run itself. A non-member, a signed-out caller and an API key get an
--      empty list.
--   6. Do not disturb holds pings: the notice gate answers hold while your
--      status has do not disturb on (CV-18 adds pause, quiet hours and
--      Focus).
--   7. Presence on chat:<ws> needs only workspace membership, not the plan:
--      it keeps working while chat is paused (spec §1).
--   8. Account erasure counts and deletes both tables (they also cascade from
--      profiles).
--
-- Every redefined function is changed in place from its live body
-- (pg_temp.recut, as CV-6a): a body that has moved on stops the migration.
-- Grants are re-stated by name at the end.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.recut(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
BEGIN
  IF position(p_old IN v_def) = 0 THEN
    IF position(p_new IN v_def) > 0 THEN
      RETURN; -- re-run
    END IF;
    RAISE EXCEPTION '% isn''t the body this migration expects; redefine it by hand.', p_fn;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$$;

-- ── 1. user_statuses ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_statuses (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text,
  text text,
  dnd boolean NOT NULL DEFAULT false,
  clear_at timestamptz,
  preset text,
  set_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'user_statuses_preset_check'
                    AND conrelid = 'public.user_statuses'::regclass) THEN
    ALTER TABLE public.user_statuses ADD CONSTRAINT user_statuses_preset_check
      CHECK (preset IS NULL OR preset IN ('meeting','sick','vacation','commuting'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'user_statuses_sizes'
                    AND conrelid = 'public.user_statuses'::regclass) THEN
    ALTER TABLE public.user_statuses ADD CONSTRAINT user_statuses_sizes
      CHECK ((emoji IS NULL OR char_length(emoji) BETWEEN 1 AND 16)
         AND (text IS NULL OR char_length(text) BETWEEN 1 AND 100));
  END IF;
  -- A row says something (an emoji, words or do not disturb) and was set, or
  -- it is cleared: nothing, no time, no preset.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'user_statuses_shape'
                    AND conrelid = 'public.user_statuses'::regclass) THEN
    ALTER TABLE public.user_statuses ADD CONSTRAINT user_statuses_shape
      CHECK (CASE WHEN emoji IS NULL AND text IS NULL AND NOT dnd
                  THEN set_at IS NULL AND clear_at IS NULL AND preset IS NULL
                  ELSE set_at IS NOT NULL END);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS user_statuses_clear_at_idx
  ON public.user_statuses (clear_at) WHERE clear_at IS NOT NULL;

-- Whether the caller shares a workspace with p_other (a live workspace both
-- are members of). About the caller only: the read rule's check.
CREATE OR REPLACE FUNCTION public.user_statuses__shares_workspace(p_other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND p_other IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.workspace_members a
      JOIN public.workspace_members b ON b.workspace_id = a.workspace_id AND b.user_id = p_other
      JOIN public.workspaces w ON w.id = a.workspace_id AND w.deleted_at IS NULL
     WHERE a.user_id = auth.uid())
$function$;

ALTER TABLE public.user_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_statuses_read ON public.user_statuses;
CREATE POLICY user_statuses_read ON public.user_statuses
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.user_statuses__shares_workspace(user_id));

-- People read; the ops write.
REVOKE ALL ON public.user_statuses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_statuses TO authenticated;
GRANT ALL ON public.user_statuses TO service_role;

-- ── 2. user_saved_statuses ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_saved_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text,
  text text,
  dnd boolean NOT NULL DEFAULT false,
  clear_after text NOT NULL DEFAULT 'never',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'user_saved_statuses_clear_after_check'
                    AND conrelid = 'public.user_saved_statuses'::regclass) THEN
    ALTER TABLE public.user_saved_statuses ADD CONSTRAINT user_saved_statuses_clear_after_check
      CHECK (clear_after IN ('30m','1h','today','this_week','date','never'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'user_saved_statuses_shape'
                    AND conrelid = 'public.user_saved_statuses'::regclass) THEN
    ALTER TABLE public.user_saved_statuses ADD CONSTRAINT user_saved_statuses_shape
      CHECK ((emoji IS NULL OR char_length(emoji) BETWEEN 1 AND 16)
         AND (text IS NULL OR char_length(text) BETWEEN 1 AND 100)
         AND (emoji IS NOT NULL OR text IS NOT NULL OR dnd)
         AND position BETWEEN 0 AND 1000);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS user_saved_statuses_user_idx
  ON public.user_saved_statuses (user_id, position);

ALTER TABLE public.user_saved_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_saved_statuses_own ON public.user_saved_statuses;
CREATE POLICY user_saved_statuses_own ON public.user_saved_statuses
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.user_saved_statuses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_saved_statuses TO authenticated;
GRANT ALL ON public.user_saved_statuses TO service_role;

-- ── 3. The ops ──────────────────────────────────────────────────────────────

-- A status's parts from a patch, checked: emoji, text, dnd (and, for the
-- current status, clear_at and preset; for a saved one, clear_after).
CREATE OR REPLACE FUNCTION public.user_statuses__parts(p_patch jsonb, p_saved boolean)
 RETURNS TABLE (s_emoji text, s_text text, s_dnd boolean, s_clear_at timestamptz, s_preset text, s_clear_after text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_key text;
  v_allowed text[] := CASE WHEN p_saved THEN ARRAY['emoji', 'text', 'dnd', 'clear_after']
                           ELSE ARRAY['emoji', 'text', 'dnd', 'clear_at', 'preset'] END;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Send the status to set.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT v_key = ANY (v_allowed) THEN
      RAISE EXCEPTION 'Unknown status field: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF jsonb_typeof(p_patch -> 'emoji') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'An emoji is text.' USING ERRCODE = '22023';
  END IF;
  s_emoji := nullif(btrim(p_patch ->> 'emoji'), '');
  IF s_emoji IS NOT NULL AND (char_length(s_emoji) > 16 OR NOT public.reactions__key_ok(s_emoji)) THEN
    RAISE EXCEPTION 'Pick one emoji.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_patch -> 'text') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'A status is text.' USING ERRCODE = '22023';
  END IF;
  s_text := nullif(btrim(regexp_replace(coalesce(p_patch ->> 'text', ''), '[[:cntrl:]]+', ' ', 'g')), '');
  IF char_length(s_text) > 100 THEN
    RAISE EXCEPTION 'Keep a status to 100 characters.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_patch -> 'dnd') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'Do not disturb is on or off.' USING ERRCODE = '22023';
  END IF;
  s_dnd := coalesce((p_patch ->> 'dnd')::boolean, false);

  IF s_emoji IS NULL AND s_text IS NULL AND NOT s_dnd THEN
    RAISE EXCEPTION 'A status needs an emoji, words or do not disturb.' USING ERRCODE = '22023';
  END IF;

  IF p_saved THEN
    s_clear_after := coalesce(p_patch ->> 'clear_after', 'never');
    IF s_clear_after NOT IN ('30m', '1h', 'today', 'this_week', 'date', 'never') THEN
      RAISE EXCEPTION 'Unknown "clear after": %', s_clear_after USING ERRCODE = '22023';
    END IF;
  ELSE
    IF jsonb_typeof(p_patch -> 'clear_at') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Clear after is a time.' USING ERRCODE = '22023';
    END IF;
    BEGIN
      s_clear_at := (p_patch ->> 'clear_at')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Clear after is a time.' USING ERRCODE = '22023';
    END;
    IF s_clear_at IS NOT NULL AND (s_clear_at <= now() OR s_clear_at > now() + interval '366 days') THEN
      RAISE EXCEPTION 'Pick a time ahead, within a year.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_patch -> 'preset') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Unknown preset.' USING ERRCODE = '22023';
    END IF;
    s_preset := p_patch ->> 'preset';
    IF s_preset IS NOT NULL AND s_preset NOT IN ('meeting', 'sick', 'vacation', 'commuting') THEN
      RAISE EXCEPTION 'Unknown preset: %', s_preset USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEXT;
END;
$function$;

-- Your status as the app reads it (null when you have none).
CREATE OR REPLACE FUNCTION public.user_statuses__json(p_row public.user_statuses, p_at timestamptz)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_row.set_at IS NULL OR (p_row.clear_at IS NOT NULL AND p_row.clear_at <= p_at) THEN NULL
    ELSE jsonb_build_object(
      'emoji', p_row.emoji, 'text', p_row.text, 'dnd', p_row.dnd, 'clear_at', p_row.clear_at,
      'preset', p_row.preset, 'set_at', p_row.set_at) END
$function$;

CREATE OR REPLACE FUNCTION public.user_op_set_status(p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v public.user_statuses;
  p record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.user_statuses__parts(p_patch, false);
  INSERT INTO public.user_statuses AS s (user_id, emoji, text, dnd, clear_at, preset, set_at, updated_at)
  VALUES (v_user, p.s_emoji, p.s_text, p.s_dnd, p.s_clear_at, p.s_preset, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    emoji = excluded.emoji, text = excluded.text, dnd = excluded.dnd,
    clear_at = excluded.clear_at, preset = excluded.preset,
    set_at = excluded.set_at, updated_at = excluded.updated_at
  RETURNING * INTO v;
  RETURN public.user_statuses__json(v, now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_op_clear_status()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_statuses s SET
    emoji = NULL, text = NULL, dnd = false, clear_at = NULL, preset = NULL, set_at = NULL, updated_at = now()
  WHERE s.user_id = v_user AND s.set_at IS NOT NULL;
END;
$function$;

-- Save a status (p_id null) or change one of yours (p_id). Twenty at most.
CREATE OR REPLACE FUNCTION public.user_op_save_status(p_patch jsonb, p_id uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  p record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.user_statuses__parts(p_patch, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('user_saved_statuses:' || v_user::text, 0));

  IF p_id IS NOT NULL THEN
    UPDATE public.user_saved_statuses x SET
      emoji = p.s_emoji, text = p.s_text, dnd = p.s_dnd, clear_after = p.s_clear_after
    WHERE x.id = p_id AND x.user_id = v_user
    RETURNING x.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'That saved status isn''t there.' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_id;
  END IF;

  IF (SELECT count(*) FROM public.user_saved_statuses x WHERE x.user_id = v_user) >= 20 THEN
    RAISE EXCEPTION 'You can save up to 20 statuses.' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.user_saved_statuses (user_id, emoji, text, dnd, clear_after, position)
  VALUES (v_user, p.s_emoji, p.s_text, p.s_dnd, p.s_clear_after,
          coalesce((SELECT max(x.position) + 1 FROM public.user_saved_statuses x WHERE x.user_id = v_user), 0))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_op_forget_status(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_saved_statuses x WHERE x.id = p_id AND x.user_id = v_user;
END;
$function$;

-- ── 4. Expiry ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_statuses__expire(p_now timestamptz DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.user_statuses s SET
    emoji = NULL, text = NULL, dnd = false, clear_at = NULL, preset = NULL, set_at = NULL, updated_at = p_now
  WHERE s.clear_at IS NOT NULL AND s.clear_at <= p_now;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- ── 5. chat_now(ws) ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_now(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH me AS (
    SELECT auth.uid() AS uid
  ), allowed AS (
    SELECT 1 FROM me
      JOIN public.workspace_members m ON m.workspace_id = p_workspace_id AND m.user_id = me.uid
      JOIN public.workspaces w ON w.id = p_workspace_id AND w.deleted_at IS NULL
  ), people AS (
    SELECT m.user_id FROM public.workspace_members m
     WHERE m.workspace_id = p_workspace_id AND EXISTS (SELECT 1 FROM allowed)
  ), rows AS (
    SELECT p.user_id,
           public.user_statuses__json(s, now()) AS status,
           f.id AS run_id, f.mode, f.phase_started_at, f.phase_seconds, f.now_task_id,
           coalesce(up.show_focus_task, false) AS show_task
      FROM people p
      LEFT JOIN public.user_statuses s ON s.user_id = p.user_id
      LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
      -- A running run in its work phase, seen in the last 3 minutes, in any
      -- workspace (one open run per person).
      LEFT JOIN public.focus_runs f
        ON f.user_id = p.user_id AND f.status = 'running' AND f.phase = 'work'
       AND f.seen_at > now() - interval '3 minutes'
  ), shaped AS (
    SELECT r.user_id, r.status,
           r.run_id IS NOT NULL AS focusing,
           CASE
             WHEN r.run_id IS NULL THEN NULL
             WHEN r.mode = 'pomodoro' THEN r.phase_started_at + make_interval(secs => r.phase_seconds)
             WHEN r.mode = 'per_task' THEN
               (SELECT r.phase_started_at + make_interval(mins => t.estimate_minutes)
                  FROM public.tasks t
                 WHERE t.id = r.now_task_id AND t.estimate_minutes > 0)
           END AS until_at,
           CASE WHEN r.run_id IS NOT NULL AND r.show_task AND r.now_task_id IS NOT NULL THEN
             (SELECT t.id FROM public.tasks t
               WHERE t.id = r.now_task_id AND t.workspace_id = p_workspace_id
                 AND public.tasks__visible_to(t.id, (SELECT uid FROM me)))
           END AS task_id
      FROM rows r
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', x.user_id,
           'status', x.status,
           'dnd', coalesce((x.status ->> 'dnd')::boolean, false),
           'focusing', x.focusing,
           'focus_until', CASE WHEN x.until_at > now() THEN x.until_at END,
           'focus_task_id', x.task_id,
           'focus_task_title', (SELECT t.title FROM public.tasks t WHERE t.id = x.task_id))
           ORDER BY x.user_id), '[]'::jsonb)
    FROM shaped x
   WHERE x.status IS NOT NULL OR x.focusing
$function$;

-- ── 6. Do not disturb holds pings ───────────────────────────────────────────

SELECT pg_temp.recut(
  'public.notice__gate(uuid, uuid, text, timestamptz)'::regprocedure,
  $old$  SELECT 'send'::text$old$,
  $new$  -- CV-17: a status with do not disturb on holds (Catch up keeps it).
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM public.user_statuses s
            WHERE s.user_id = p_user AND s.dnd AND s.set_at IS NOT NULL
              AND (s.clear_at IS NULL OR s.clear_at > p_at))
         THEN 'hold' ELSE 'send' END$new$);

-- ── 7. Presence needs membership, not the plan ──────────────────────────────

-- Whether the caller is a member of a live workspace (the presence topic).
CREATE OR REPLACE FUNCTION public.user_statuses__member(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members m
      JOIN public.workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
     WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid())
$function$;


SELECT pg_temp.recut(
  'public.chat_realtime_topic_allowed(text)'::regprocedure,
  $old$THEN public.chat_can_access_workspace(substring(p_topic from 6)::uuid)$old$,
  $new$THEN auth.uid() IS NOT NULL AND public.user_statuses__member(substring(p_topic from 6)::uuid)$new$);

SELECT pg_temp.recut(
  'public.chat_realtime_topic_writable(text)'::regprocedure,
  $old$AND public.chat_can_access_workspace(substring(p_topic from 6)::uuid)$old$,
  $new$AND auth.uid() IS NOT NULL AND public.user_statuses__member(substring(p_topic from 6)::uuid)$new$);

-- ── 8. Account erasure ──────────────────────────────────────────────────────

SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$  v_chat_mutes integer;
$old$,
  $new$  v_chat_mutes integer;
  v_user_statuses integer;
  v_saved_statuses integer;
$new$);
SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$  SELECT count(*) INTO v_chat_mutes FROM public.chat_chain_mutes x WHERE x.user_id = p_user;
$old$,
  $new$  SELECT count(*) INTO v_chat_mutes FROM public.chat_chain_mutes x WHERE x.user_id = p_user;
  -- CV-17: their status and saved statuses.
  SELECT count(*) INTO v_user_statuses FROM public.user_statuses x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$new$);
SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$'chat_chain_mutes_deleted', v_chat_mutes$old$,
  $new$'chat_chain_mutes_deleted', v_chat_mutes,
    'user_statuses_deleted', v_user_statuses,
    'saved_statuses_deleted', v_saved_statuses$new$);
SELECT pg_temp.recut(
  'public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
  $old$  DELETE FROM public.chat_chain_mutes x WHERE x.user_id = p_user;
$old$,
  $new$  DELETE FROM public.chat_chain_mutes x WHERE x.user_id = p_user;
  DELETE FROM public.user_statuses x WHERE x.user_id = p_user;
  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
$new$);

-- ── 9. Published ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'The supabase_realtime publication is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_statuses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_statuses;
  END IF;
END;
$$;

-- ── 10. Grants ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Server only.
  FOREACH fn IN ARRAY ARRAY[
    'user_statuses__parts(jsonb, boolean)',
    'user_statuses__json(public.user_statuses, timestamptz)',
    'user_statuses__expire(timestamptz)',
    'notice__gate(uuid, uuid, text, timestamptz)',
    'account_erase_workspace_data(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- People (signed in; keys are refused inside).
  FOREACH fn IN ARRAY ARRAY[
    'user_op_set_status(jsonb)',
    'user_op_clear_status()',
    'user_op_save_status(jsonb, uuid)',
    'user_op_forget_status(uuid)',
    'chat_now(uuid)',
    -- The read rule's check and the realtime topic policies (about the caller only).
    'user_statuses__shares_workspace(uuid)',
    'user_statuses__member(uuid)',
    'chat_realtime_topic_allowed(text)',
    'chat_realtime_topic_writable(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

-- ── 11. The expiry job ──────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'user-statuses-expire') THEN
    PERFORM cron.unschedule('user-statuses-expire');
  END IF;
END;
$$;
SELECT cron.schedule(
  'user-statuses-expire',
  '*/5 * * * *',
  $cron$SELECT public.user_statuses__expire(now());$cron$
);

-- ── 12. Assertions ──────────────────────────────────────────────────────────

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.user_statuses', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_statuses', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_statuses', 'DELETE')
     OR has_table_privilege('authenticated', 'public.user_saved_statuses', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_saved_statuses', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_saved_statuses', 'DELETE')
     OR has_table_privilege('anon', 'public.user_statuses', 'SELECT')
     OR has_table_privilege('anon', 'public.user_saved_statuses', 'SELECT') THEN
    RAISE EXCEPTION 'CV-17: statuses are written only through the ops.';
  END IF;
  IF has_function_privilege('authenticated', 'public.notice__gate(uuid, uuid, text, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.user_statuses__expire(timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chat_now(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CV-17: a server-only function is reachable.';
  END IF;
END;
$$;
