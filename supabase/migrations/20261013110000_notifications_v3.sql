-- TV-D12 · Reminders that reach you, and the notification table (specs/tasks-v3.md
-- block 27, §2 "Reminders", §13, §Assumptions #16, #26, #27; REPLAN 24, 73, 80;
-- decisions in docs/decisions/tasks.md "TV-D12").
--
--   * Reminders are delivered. A due reminder whose person still sees the task,
--     on a To do / In progress task in a project that isn't archived, becomes a
--     bell notice (hung on that person's own Inbox, so nobody else reads it) and
--     a delivery row for their devices: the desktop app hears it live and shows
--     an OS notification; browsers that opted in get a Web Push through the
--     push-send Edge Function. Anything else that's due is retired unsent. The
--     sender runs every minute.
--   * Backlog and Won't do suspend a task's reminders (every person's); moving
--     it back doesn't bring them back by itself: the app asks, and
--     tasks_op_reminders_restore does it. A reminder added to a parked task
--     starts suspended.
--   * notice_deliveries: one row per OS / browser notice, read only by its
--     person (RLS) and published, so a running desktop app hears its own;
--     push_subscriptions: each browser that opted in (per person, not per
--     workspace: reminders reach you in any workspace). The push sender is
--     kicked only when its URL and secret are in Vault (never on a local stack
--     unless someone puts them there), and only sends to known push services.
--   * The notification table (§13) on the server: assignments from one person
--     to one person within an hour gather on one notice ("assigned you 12
--     tasks"), while every assignment keeps its own trail line; an @person in a
--     task's description notifies through tasks_op_mention (people who can see
--     the task); Waiting on… clears when the person waited on comments on the
--     task or the email thread waited on gets a newer message, with one quiet
--     notice to whoever added it.
--   * A comment or mention notice is written only for people who can see the
--     item at that moment (module_activity_gate_recipients, on every path).
--   * buckets__archive_check no longer skips writes made by other triggers:
--     archived_at never changes through a foreign key.
--   * Account erasure covers the two new tables.
--
-- Apply after TV-D11b's 20261011120000 and TV-U13's 20261013100000 (it shares
-- no function with either). Verified on the local stack by
-- supabase/tests/notifications.test.sql and waiting.test.sql (bun run db:test).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.task_reminders') IS NULL OR to_regclass('public.access_changes') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D10 and TV-D11b before this migration.';
  END IF;
  IF to_regprocedure('public.tasks__visible_to(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D10-fix (20261011110000) before this migration.';
  END IF;
END;
$$;

-- ── 1. Reminders: suspended by Backlog / Won't do ──────────────────────────

ALTER TABLE public.task_reminders ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

DROP INDEX IF EXISTS public.task_reminders_due;
CREATE INDEX IF NOT EXISTS task_reminders_due ON public.task_reminders (at)
  WHERE deleted_at IS NULL AND fired_at IS NULL AND suspended_at IS NULL;

-- A task entering Backlog or Won't do suspends its reminders that haven't
-- fired, whoever's they are (REPLAN 24: a parked task never reminds).
CREATE OR REPLACE FUNCTION public.tasks__reminders_suspend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status_category IN ('backlog', 'wont_do') AND NEW.deleted_at IS NULL THEN
    UPDATE public.task_reminders r SET suspended_at = now()
    WHERE r.task_id = NEW.id AND r.deleted_at IS NULL
      AND r.fired_at IS NULL AND r.suspended_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tasks_reminders_suspend ON public.tasks;
CREATE TRIGGER tasks_reminders_suspend
  AFTER UPDATE OF status, status_id, status_category ON public.tasks
  FOR EACH ROW
  WHEN (OLD.status_category IS DISTINCT FROM NEW.status_category)
  EXECUTE FUNCTION public.tasks__reminders_suspend();

-- Restore what a move to Backlog / Won't do suspended, once the task is open
-- again: every person's when the caller can edit the task, else the caller's
-- own. Only reminders still ahead come back (a relative one is worked out from
-- the due date again); one whose time passed meanwhile stays suspended.
CREATE OR REPLACE FUNCTION public.tasks_op_reminders_restore(p_workspace_id uuid, p_task_id uuid)
RETURNS SETOF public.task_reminders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  t public.tasks;
  v_all boolean;
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tasks x
  WHERE x.id = p_task_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__visible_to(t.id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF t.status_category NOT IN ('todo', 'in_progress') THEN
    RAISE EXCEPTION 'Reminders come back once the task is To do or In progress.' USING ERRCODE = '22023';
  END IF;
  v_all := public.tasks__editable_to(t.id, v_actor);
  UPDATE public.task_reminders r SET
    suspended_at = NULL,
    at = CASE WHEN r.kind = 'at' THEN r.at ELSE public.tasks__reminder_at(t, r.kind) END
  WHERE r.task_id = t.id AND r.deleted_at IS NULL AND r.suspended_at IS NOT NULL
    AND r.fired_at IS NULL
    AND (v_all OR r.user_id = v_actor)
    AND (CASE WHEN r.kind = 'at' THEN r.at ELSE public.tasks__reminder_at(t, r.kind) END) > now();
  RETURN QUERY SELECT * FROM public.tasks__reminders_of(t.id, v_actor);
END;
$$;

-- tasks_op_reminder_add, from the live body (TV-D10-fix): a reminder added to
-- a task in Backlog or Won't do starts suspended.
CREATE OR REPLACE FUNCTION public.tasks_op_reminder_add(p_workspace_id uuid, p_task_id uuid, p_kind text, p_at timestamptz DEFAULT NULL)
RETURNS SETOF public.task_reminders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  t public.tasks;
  v_suspended timestamptz;
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tasks x
  WHERE x.id = p_task_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__visible_to(t.id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('at', 'day_before', 'hour_before') THEN
    RAISE EXCEPTION 'A reminder is at a time, a day before due or an hour before due.' USING ERRCODE = '22023';
  END IF;
  v_suspended := CASE WHEN t.status_category IN ('backlog', 'wont_do') THEN now() END;
  IF p_kind = 'at' THEN
    IF p_at IS NULL THEN
      RAISE EXCEPTION 'A reminder at a time needs the time.' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.task_reminders r
        WHERE r.task_id = t.id AND r.user_id = v_actor AND r.deleted_at IS NULL) >= 10 THEN
      RAISE EXCEPTION 'A task has at most 10 reminders for you.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.task_reminders (workspace_id, task_id, user_id, kind, at, suspended_at)
    VALUES (p_workspace_id, t.id, v_actor, 'at', p_at, v_suspended);
  ELSE
    INSERT INTO public.task_reminders (workspace_id, task_id, user_id, kind, at, suspended_at)
    VALUES (p_workspace_id, t.id, v_actor, p_kind, public.tasks__reminder_at(t, p_kind), v_suspended)
    ON CONFLICT (task_id, user_id, kind) WHERE deleted_at IS NULL AND kind <> 'at' DO NOTHING;
  END IF;
  RETURN QUERY SELECT * FROM public.tasks__reminders_of(t.id, v_actor);
END;
$$;

-- ── 2. Where a notice goes besides the bell ─────────────────────────────────

-- One row per OS / browser notice for one person. The desktop app hears its
-- own rows live (RLS: only yours); push-send delivers them to the browsers
-- that opted in. Kept a week.
CREATE TABLE IF NOT EXISTS public.notice_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reminder')),
  task_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  body text CHECK (body IS NULL OR char_length(body) <= 500),
  url text CHECK (url IS NULL OR (char_length(url) <= 500 AND url LIKE '/%')),
  created_at timestamptz NOT NULL DEFAULT now(),
  pushed_at timestamptz,
  push_attempts integer NOT NULL DEFAULT 0,
  push_error text
);
CREATE INDEX IF NOT EXISTS notice_deliveries_user ON public.notice_deliveries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notice_deliveries_unpushed ON public.notice_deliveries (created_at)
  WHERE pushed_at IS NULL;

ALTER TABLE public.notice_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_deliveries_own_read ON public.notice_deliveries;
CREATE POLICY notice_deliveries_own_read ON public.notice_deliveries
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.notice_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notice_deliveries TO authenticated;
GRANT ALL ON public.notice_deliveries TO service_role;

-- Each browser that turned on notifications for this person. Written only by
-- the two ops; the endpoint is a known push service (push-send checks again).
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  failures integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_own_read ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own_read ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

-- The push services browsers use (Chrome/Edge/Opera via FCM, Firefox, Safari,
-- Windows). Anything else is refused, so a stored endpoint can only ever send
-- a notice to a push service.
CREATE OR REPLACE FUNCTION public.push__endpoint_ok(p_endpoint text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_endpoint IS NOT NULL
    AND char_length(p_endpoint) <= 1000
    AND p_endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?/'
$$;

CREATE OR REPLACE FUNCTION public.push_op_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on notifications.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.push__endpoint_ok(p_endpoint) THEN
    RAISE EXCEPTION 'This browser''s notification service isn''t supported.' USING ERRCODE = '22023';
  END IF;
  -- An uncompressed P-256 key is 65 bytes (87 base64url characters), the
  -- auth secret 16 bytes (22).
  IF p_p256dh IS NULL OR p_p256dh !~ '^[A-Za-z0-9_-]{86,88}={0,2}$'
     OR p_auth IS NULL OR p_auth !~ '^[A-Za-z0-9_-]{21,24}={0,2}$' THEN
    RAISE EXCEPTION 'The browser sent keys that don''t read.' USING ERRCODE = '22023';
  END IF;
  -- An endpoint belongs to one browser profile; whoever signs in there last
  -- gets its notices.
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_actor, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id = v_actor, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent, updated_at = now(), failures = 0;
  -- At most 10 browsers per person: the oldest go.
  DELETE FROM public.push_subscriptions s
  WHERE s.user_id = v_actor AND s.id NOT IN (
    SELECT x.id FROM public.push_subscriptions x WHERE x.user_id = v_actor
    ORDER BY x.updated_at DESC, x.id LIMIT 10);
END;
$$;

CREATE OR REPLACE FUNCTION public.push_op_unsubscribe(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.push_subscriptions s
  WHERE s.endpoint = p_endpoint AND s.user_id = auth.uid();
END;
$$;

-- ── 3. Moduo's own notices ──────────────────────────────────────────────────

-- module_activity_log needs a person or a key; the reminder sender and other
-- system work write as "Moduo", the way the roll-over does (D8-7). With a
-- person or key in context, it's theirs.
CREATE OR REPLACE FUNCTION public.tasks__notice(
  p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_op text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL OR public.module_api_key_id() IS NOT NULL THEN
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', p_entity_type, p_entity_id, p_op, p_payload);
    RETURN;
  END IF;
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (p_workspace_id, 'tasks', p_entity_type, p_entity_id, p_op, 'agent', NULL, 'Moduo',
          coalesce(p_payload, '{}'::jsonb));
END;
$$;

-- ── 4. The reminder sender ──────────────────────────────────────────────────

-- Every minute: claims due reminders (FOR UPDATE SKIP LOCKED, so two runs
-- never send one twice). A reminder is delivered only while its person can
-- see the task (TV-D10-fix), the task is To do or In progress and its project
-- isn't archived (TV-U6); anything else that's due is retired unsent. The
-- title is read for that person at send time. Suspended reminders wait.
CREATE OR REPLACE FUNCTION public.tasks__fire_reminders(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_n integer := 0;
  v_inbox uuid;
BEGIN
  FOR r IN
    WITH due AS (
      SELECT x.id FROM public.task_reminders x
      WHERE x.deleted_at IS NULL AND x.fired_at IS NULL AND x.suspended_at IS NULL
        AND x.at <= p_now
      ORDER BY x.at
      LIMIT greatest(coalesce(p_limit, 500), 1)
      FOR UPDATE OF x SKIP LOCKED
    ), claimed AS (
      UPDATE public.task_reminders x SET fired_at = p_now
      FROM due WHERE x.id = due.id
      RETURNING x.id, x.task_id, x.user_id, x.workspace_id, x.kind
    )
    SELECT c.*, t.title,
           (t.deleted_at IS NULL
            AND t.status_category IN ('todo', 'in_progress')
            AND NOT EXISTS (SELECT 1 FROM public.buckets b
                            WHERE b.id = t.bucket_id AND b.archived_at IS NOT NULL)
            AND public.tasks__visible_to(c.task_id, c.user_id)) AS deliver
    FROM claimed c
    JOIN public.tasks t ON t.id = c.task_id
  LOOP
    CONTINUE WHEN NOT r.deliver;
    BEGIN
      -- The bell notice hangs on the person's own Inbox, which only they can
      -- read, so the trail of a shared task never shows someone's reminder.
      SELECT b.id INTO v_inbox FROM public.buckets b
      WHERE b.workspace_id = r.workspace_id AND b.owner_id = r.user_id
        AND b.is_system AND b.deleted_at IS NULL
      ORDER BY b.created_at, b.id
      LIMIT 1;
      IF v_inbox IS NOT NULL THEN
        PERFORM public.tasks__notice(r.workspace_id, 'bucket', v_inbox, 'tasks.reminder',
          jsonb_build_object(
            'notify_user_ids', jsonb_build_array(r.user_id::text),
            'task_id', r.task_id,
            'title', r.title,
            'reminder_id', r.id));
      END IF;
      INSERT INTO public.notice_deliveries (user_id, workspace_id, kind, task_id, title, url)
      VALUES (r.user_id, r.workspace_id, 'reminder', r.task_id,
              left(coalesce(nullif(btrim(r.title), ''), 'A task'), 300),
              '/tasks?id=' || r.task_id);
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      -- One reminder that can't be delivered never holds up the rest.
      RAISE WARNING 'tasks__fire_reminders: reminder % not delivered (%)', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── 5. The push sender's side of the database ───────────────────────────────

-- Kick push-send after a run that left deliveries for someone with a browser
-- subscription. Only when Vault holds both the function's URL and its secret
-- (prod sets them at release; a local stack has neither unless someone adds
-- them for a test), so no stack ever calls another's function by accident.
CREATE OR REPLACE FUNCTION public.notice_deliveries__kick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT s.decrypted_secret INTO v_url FROM vault.decrypted_secrets s WHERE s.name = 'push_sender_url';
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'push_sender_secret';
  IF v_url IS NULL OR v_secret IS NULL OR v_url !~ '^https?://' THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notice_deliveries d
    WHERE d.pushed_at IS NULL AND d.push_attempts < 5 AND d.created_at > now() - interval '1 day'
      AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = d.user_id)) THEN
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-sender-secret', v_secret),
    timeout_milliseconds := 10000
  );
END;
$$;

-- push-send proves it was called by the kick: the secret it got, compared
-- with Vault's by digest.
CREATE OR REPLACE FUNCTION public.notice_deliveries__authorize(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'push_sender_secret';
  IF v_secret IS NULL OR p_secret IS NULL OR length(p_secret) < 32 THEN
    RETURN false;
  END IF;
  RETURN extensions.digest(p_secret, 'sha256') = extensions.digest(v_secret, 'sha256');
END;
$$;

-- Up to p_limit deliveries waiting for a push, with each person's browsers.
-- Claiming counts an attempt, so a delivery that keeps failing stops after 5.
CREATE OR REPLACE FUNCTION public.notice_deliveries__claim(p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, title text, body text, url text, task_id uuid, subscriptions jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM public.notice_deliveries d
    WHERE d.pushed_at IS NULL AND d.push_attempts < 5 AND d.created_at > now() - interval '1 day'
      AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = d.user_id)
    ORDER BY d.created_at
    LIMIT greatest(least(coalesce(p_limit, 100), 500), 1)
    FOR UPDATE OF d SKIP LOCKED
  ), bumped AS (
    UPDATE public.notice_deliveries d SET push_attempts = d.push_attempts + 1
    FROM picked WHERE d.id = picked.id
    RETURNING d.*
  )
  SELECT b.id, b.title, b.body, b.url, b.task_id,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
          FROM public.push_subscriptions s WHERE s.user_id = b.user_id)
  FROM bumped b;
END;
$$;

-- What push-send did: [{id, ok, error?, gone?: [endpoints]}]. A delivery is
-- done once one browser took it; endpoints the push service says are gone
-- are forgotten.
CREATE OR REPLACE FUNCTION public.notice_deliveries__settle(p_results jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  IF jsonb_typeof(p_results) <> 'array' THEN
    RETURN 0;
  END IF;
  FOR r IN SELECT * FROM jsonb_to_recordset(p_results) AS x(id uuid, ok boolean, error text, gone jsonb)
  LOOP
    UPDATE public.notice_deliveries d SET
      pushed_at = CASE WHEN r.ok THEN now() ELSE d.pushed_at END,
      push_error = CASE WHEN r.ok THEN NULL ELSE left(r.error, 300) END
    WHERE d.id = r.id;
    IF jsonb_typeof(r.gone) = 'array' THEN
      DELETE FROM public.push_subscriptions s
      WHERE s.endpoint IN (SELECT jsonb_array_elements_text(r.gone));
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notice_deliveries__purge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.notice_deliveries d WHERE d.created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ── 6. Assignments gather per person and hour (REPLAN 80) ──────────────────

-- tasks_notify_spine, from the live body (TV-D1 / DF-9): only the assigned
-- block changes. Every assignment still logs its own tasks.assigned row (the
-- trail); the bell notice is the first row of an hour from one actor to one
-- person that the person hasn't read or dismissed yet, and later ones add to
-- its count and task list instead of notifying again.
CREATE OR REPLACE FUNCTION public.tasks_notify_spine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocked RECORD;
  v_actor uuid := public.perm_actor_id();
  v_key uuid := public.module_api_key_id();
  v_assigned boolean := false;
  v_notify boolean;
  v_group uuid;
  v_from uuid;
BEGIN
  -- Never notify about a soft-deleted row (a delete is an UPDATE that stamps
  -- deleted_at; it must not read as an assignment or an unblock).
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- System writes (no signed-in user, no API key) notify nobody.
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── assigned-to-you ──────────────────────────────────────────────────────
  -- Every way a task gets an assignee lands here (tasks_op_assign, a create,
  -- an old build's owner_id write), so this is the one place it is logged:
  -- a create for someone else, and every later change, attributed to the
  -- actor ({from, to}). Only someone other than the actor is notified
  -- (mentioned_user_ids): unassigning and taking a task stay out of bells but
  -- in the trail. The actor is compared through perm_actor_id(), so an API
  -- key assigning its own creator doesn't notify. Member removal unassigns
  -- under share.bypass and logs nothing. Wrapped so a notification failure
  -- can never fail the task write.
  IF TG_OP = 'INSERT' THEN
    v_assigned := NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor;
  ELSE
    v_from := OLD.assignee_id;
    v_assigned := NEW.assignee_id IS DISTINCT FROM v_from
                  AND current_setting('share.bypass', true) IS DISTINCT FROM '1';
  END IF;
  IF v_assigned THEN
    BEGIN
      v_notify := NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor;
      v_group := NULL;
      IF v_notify THEN
        -- The open notice of this hour from the same actor (person or key)
        -- to the same person, if there is one.
        SELECT ma.id INTO v_group FROM public.module_activity ma
        WHERE ma.workspace_id = NEW.workspace_id AND ma.module = 'tasks'
          AND ma.op = 'tasks.assigned'
          AND ma.created_at > now() - interval '1 hour'
          AND CASE WHEN auth.uid() IS NOT NULL
                   THEN ma.actor_type = 'user' AND ma.actor_id = auth.uid()
                   ELSE ma.actor_type = 'api_key' AND ma.actor_id = v_key END
          AND (ma.payload -> 'mentioned_user_ids') @> jsonb_build_array(NEW.assignee_id::text)
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_state ns
            WHERE ns.activity_id = ma.id AND ns.user_id = NEW.assignee_id
              AND (ns.read_at IS NOT NULL OR ns.dismissed_at IS NOT NULL))
        ORDER BY ma.created_at DESC, ma.id DESC
        LIMIT 1
        FOR UPDATE;
      END IF;
      IF v_group IS NOT NULL THEN
        UPDATE public.module_activity ma SET payload =
          CASE WHEN ma.payload ->> 'project_id' IS NOT DISTINCT FROM NEW.bucket_id::text
               THEN ma.payload ELSE ma.payload - 'project_id' END
          || jsonb_build_object(
               'count', coalesce((ma.payload ->> 'count')::integer, 1) + 1,
               'task_ids', CASE WHEN jsonb_array_length(coalesce(ma.payload -> 'task_ids', '[]'::jsonb)) < 100
                                THEN coalesce(ma.payload -> 'task_ids', '[]'::jsonb) || jsonb_build_array(NEW.id::text)
                                ELSE ma.payload -> 'task_ids' END)
        WHERE ma.id = v_group;
      END IF;
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.assigned',
        jsonb_strip_nulls(jsonb_build_object(
          'mentioned_user_ids',
            CASE WHEN v_notify AND v_group IS NULL THEN jsonb_build_array(NEW.assignee_id::text) END,
          'task_ids', CASE WHEN v_notify AND v_group IS NULL THEN jsonb_build_array(NEW.id::text) END,
          'project_id', CASE WHEN v_notify AND v_group IS NULL THEN NEW.bucket_id END,
          'grouped_into', v_group,
          'title', NEW.title))
        -- from/to stay in when null (null = Unassigned). "self" is a person
        -- taking the task; an API key assigning its creator reads as an
        -- assignment.
        || jsonb_build_object(
             'from', v_from,
             'to', NEW.assignee_id,
             'self', v_key IS NULL AND NEW.assignee_id IS NOT DISTINCT FROM v_actor));
    EXCEPTION WHEN OTHERS THEN
      -- generation is a side-effect; it must never break completing/editing a task.
      -- Surface a WARNING (does not abort the txn) so a silent failure is debuggable.
      RAISE WARNING 'tasks_notify_spine: assigned notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NULL;
  END IF;

  -- ── completed-by-someone-else ────────────────────────────────────────────
  -- The task just became done, and the person who did it isn't its creator:
  -- tell the creator. Only on the transition, so re-saving a done task can't
  -- notify again; never when the creator is unknown or can no longer see the
  -- task (the notification carries its title). Not for a repeating task, so a
  -- daily chore doesn't ping its creator every day (Maciej, 2026-10-08).
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status = 'done'
     AND (NEW.recurrence IS NULL OR jsonb_typeof(NEW.recurrence) = 'null')
     AND NEW.owner_id IS NOT NULL AND NOT NEW.creator_unknown
     AND NEW.owner_id IS DISTINCT FROM v_actor
     AND public.can_access('task', NEW.id, 'view', NEW.owner_id) THEN
    BEGIN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.completed',
        jsonb_build_object(
          'mentioned_user_ids', jsonb_build_array(NEW.owner_id::text),
          'title', NEW.title));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks_notify_spine: completed notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── blocked-task-unblocked ───────────────────────────────────────────────
  -- This task just CLOSED (open → done/archived). For every task it blocked, if
  -- this was its LAST open blocker, notify that task's assignee, else its
  -- creator. "Open" mirrors the client isOpen set (status NOT IN done/archived).
  -- Only fires for a genuine open→closed transition, so re-saving an
  -- already-done task can't re-notify.
  IF OLD.status NOT IN ('done', 'archived')
     AND NEW.status IN ('done', 'archived') THEN
    BEGIN
      FOR v_blocked IN
        SELECT bt.id AS task_id,
               coalesce(bt.assignee_id,
                        CASE WHEN bt.creator_unknown
                               OR NOT public.can_access('task', bt.id, 'view', bt.owner_id)
                             THEN NULL ELSE bt.owner_id END) AS target_id,
               bt.title AS title
        FROM public.task_relations r
        JOIN public.tasks bt ON bt.id = r.blocked_task_id
        WHERE r.blocker_task_id = NEW.id
          AND r.workspace_id = NEW.workspace_id
          AND bt.deleted_at IS NULL
          -- Only nudge if the freed task is still actionable (not already closed).
          AND bt.status NOT IN ('done', 'archived')
          -- …and no OTHER open blocker remains on it.
          AND NOT EXISTS (
            SELECT 1
            FROM public.task_relations r2
            JOIN public.tasks ob ON ob.id = r2.blocker_task_id
            WHERE r2.blocked_task_id = r.blocked_task_id
              AND r2.blocker_task_id <> NEW.id
              AND ob.deleted_at IS NULL
              AND ob.status NOT IN ('done', 'archived')
          )
      LOOP
        CONTINUE WHEN v_blocked.target_id IS NULL;
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'tasks', 'task', v_blocked.task_id, 'tasks.unblocked',
          jsonb_build_object(
            'notify_user_ids', jsonb_build_array(v_blocked.target_id::text),
            'title', v_blocked.title,
            'blocker_title', NEW.title));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- as above: never let the notification side-effect fail the task write.
      RAISE WARNING 'tasks_notify_spine: unblocked notification failed for blocker %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$$;

-- ── 7. @person in a task's description ──────────────────────────────────────

-- Called by the description editor when a person is picked (like
-- notes_op_mention). Notifies people other than the caller who can see the
-- task, once per person and task within 10 minutes; answers how many heard.
CREATE OR REPLACE FUNCTION public.tasks_op_mention(p_workspace_id uuid, p_task_id uuid, p_user_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  t public.tasks;
  v_ids jsonb;
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tasks x
  WHERE x.id = p_task_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__editable_to(t.id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RETURN 0;
  END IF;
  SELECT jsonb_agg(u::text) INTO v_ids
  FROM (
    SELECT DISTINCT u FROM unnest(p_user_ids[1:20]) AS u
    WHERE u IS NOT NULL AND u IS DISTINCT FROM v_actor
      AND public.tasks__visible_to(t.id, u)
      AND NOT EXISTS (
        SELECT 1 FROM public.module_activity ma
        WHERE ma.workspace_id = t.workspace_id AND ma.module = 'tasks'
          AND ma.entity_type = 'task' AND ma.entity_id = t.id
          AND ma.op = 'tasks.mentioned' AND ma.created_at > now() - interval '10 minutes'
          AND (ma.payload -> 'mentioned_user_ids') @> jsonb_build_array(u::text))
  ) s;
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.mentioned',
    jsonb_build_object('mentioned_user_ids', v_ids, 'title', t.title, 'where', 'description'));
  RETURN jsonb_array_length(v_ids);
END;
$$;

-- ── 7b. A notice about an item reaches only people who can see it ───────────

-- Whether a given person can see a spine item: perm_can_see_entity's rules,
-- for someone other than the caller.
CREATE OR REPLACE FUNCTION public.spine__visible_to(p_workspace_id uuid, p_type text, p_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL OR p_id IS NULL THEN
    RETURN false;
  END IF;
  IF p_type IN ('task', 'task_project') THEN
    RETURN public.tasks__visible_to(p_id, p_user);
  ELSIF p_type IN ('note', 'bucket', 'contact', 'company', 'event') THEN
    RETURN public.can_access(p_type, p_id, 'view', p_user);
  ELSIF p_type = 'email_thread' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_refs r WHERE r.id = p_id AND r.owner_id = p_user);
  ELSIF p_type = 'email_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = p_id AND a.owner_id = p_user);
  ELSIF p_type = 'calendar_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.calendar_accounts a WHERE a.id = p_id AND a.owner_id = p_user);
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.workspace_members m
                 WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user);
END;
$$;

-- Comment and mention notices carry an excerpt or a title, so at the moment
-- one is written its recipients are narrowed to people who can see the item
-- (whoever wrote the row: comments_op_add, notes_op_mention, tasks_op_mention).
CREATE OR REPLACE FUNCTION public.module_activity__gate_recipients()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_kept jsonb;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['mentioned_user_ids', 'notify_user_ids'] LOOP
    CONTINUE WHEN jsonb_typeof(NEW.payload -> v_key) IS DISTINCT FROM 'array';
    SELECT coalesce(jsonb_agg(u), '[]'::jsonb) INTO v_kept
    FROM jsonb_array_elements_text(NEW.payload -> v_key) AS u
    WHERE public.tasks__try_uuid(u) IS NOT NULL
      AND public.spine__visible_to(NEW.workspace_id, NEW.entity_type, NEW.entity_id, public.tasks__try_uuid(u));
    NEW.payload := jsonb_set(NEW.payload, ARRAY[v_key], v_kept);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS module_activity_gate_recipients ON public.module_activity;
CREATE TRIGGER module_activity_gate_recipients
  BEFORE INSERT ON public.module_activity
  FOR EACH ROW
  WHEN (NEW.op IN ('comments.add', 'notes.mention', 'tasks.mentioned'))
  EXECUTE FUNCTION public.module_activity__gate_recipients();

-- ── 8. Waiting on… came in (AC5.3) ──────────────────────────────────────────

-- Clear one entry and tell whoever added it, quietly, if they still see the
-- task (§13: "Something you were waiting on came in" · Waiting).
CREATE OR REPLACE FUNCTION public.tasks__waiting_came_in(p_entry public.task_waiting, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
BEGIN
  UPDATE public.task_waiting w SET deleted_at = now()
  WHERE w.id = p_entry.id AND w.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT t.title INTO v_title FROM public.tasks t WHERE t.id = p_entry.task_id AND t.deleted_at IS NULL;
  IF v_title IS NULL OR p_entry.created_by IS NULL
     OR NOT public.tasks__visible_to(p_entry.task_id, p_entry.created_by) THEN
    RETURN;
  END IF;
  PERFORM public.tasks__notice(p_entry.workspace_id, 'task', p_entry.task_id, 'tasks.waiting_resolved',
    jsonb_build_object(
      'notify_user_ids', jsonb_build_array(p_entry.created_by::text),
      'title', v_title,
      'kind', p_entry.kind,
      'reason', p_reason));
END;
$$;

-- The person waited on comments on the task.
CREATE OR REPLACE FUNCTION public.comments__waiting_came_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.task_waiting;
BEGIN
  IF NEW.entity_type <> 'task' OR NEW.deleted_at IS NOT NULL OR NEW.created_by IS NULL
     OR coalesce(NEW.author_kind, 'user') <> 'user' THEN
    RETURN NULL;
  END IF;
  BEGIN
    FOR w IN
      SELECT * FROM public.task_waiting x
      WHERE x.task_id = NEW.entity_id AND x.kind = 'person' AND x.ref = NEW.created_by
        AND x.deleted_at IS NULL AND x.since <= NEW.created_at
    LOOP
      PERFORM public.tasks__waiting_came_in(w, 'comment');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Never fail a comment over it.
    RAISE WARNING 'comments__waiting_came_in: comment %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS comments_waiting_came_in ON public.comments;
CREATE TRIGGER comments_waiting_came_in
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.comments__waiting_came_in();

-- The email thread waited on got a newer message from someone else (the
-- desktop email engine re-upserts a thread's ref when it reads a new message
-- in it).
CREATE OR REPLACE FUNCTION public.email_refs__waiting_came_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.task_waiting;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.sent_at IS NULL
     OR (OLD.sent_at IS NOT NULL AND NEW.sent_at <= OLD.sent_at) THEN
    RETURN NULL;
  END IF;
  -- A message the owner sent themselves isn't an answer.
  IF NEW.from_addr IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.email_accounts a
    WHERE a.owner_id = NEW.owner_id AND a.deleted_at IS NULL
      AND lower(a.address) = lower(NEW.from_addr)) THEN
    RETURN NULL;
  END IF;
  BEGIN
    FOR w IN
      SELECT * FROM public.task_waiting x
      WHERE x.kind = 'email' AND x.ref = NEW.id AND x.deleted_at IS NULL
        AND x.since < NEW.sent_at
    LOOP
      PERFORM public.tasks__waiting_came_in(w, 'email');
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'email_refs__waiting_came_in: ref %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS email_refs_waiting_came_in ON public.email_refs;
CREATE TRIGGER email_refs_waiting_came_in
  AFTER UPDATE OF sent_at ON public.email_refs
  FOR EACH ROW EXECUTE FUNCTION public.email_refs__waiting_came_in();

-- ── 9. Archiving a project asks for Full access on every path ──────────────

-- buckets__archive_check, from the live body (TV-U6): the pg_trigger_depth()
-- skip is gone. archived_at never changes through a foreign key's SET NULL,
-- the only nested write the project gates let through (D10F-5), so a write
-- another trigger makes is checked like any other.
CREATE OR REPLACE FUNCTION public.buckets__archive_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
     OR v_actor IS NULL
     OR coalesce(current_setting('share.bypass', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF NOT public.can_access('bucket', OLD.id, 'full', v_actor) THEN
    RAISE EXCEPTION 'Only people with full access to this project can archive or unarchive it.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 10. Account erasure covers the new tables (§Assumptions #26) ───────────

DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
BEGIN
  IF position('push_subscriptions' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position('v_reminders integer;' IN v_def) = 0
     OR position('''task_reminders_deleted'', v_reminders,' IN v_def) = 0
     OR position('DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects (TV-D10''s 182000); redefine it by hand.';
  END IF;
  v_new := replace(v_def, 'v_reminders integer;',
    'v_reminders integer;' || E'\n  v_push_subscriptions integer;\n  v_deliveries integer;');
  v_new := replace(v_new,
    'SELECT count(*) INTO v_team_members',
    'SELECT count(*) INTO v_push_subscriptions FROM public.push_subscriptions x WHERE x.user_id = p_user;'
    || E'\n  SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;'
    || E'\n  SELECT count(*) INTO v_team_members');
  v_new := replace(v_new, '''task_reminders_deleted'', v_reminders,',
    '''task_reminders_deleted'', v_reminders,'
    || E'\n    ''push_subscriptions_deleted'', v_push_subscriptions,'
    || E'\n    ''notice_deliveries_deleted'', v_deliveries,');
  -- Browsers and OS notices belong to the person, in every workspace.
  v_new := replace(v_new,
    'DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);',
    'DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  DELETE FROM public.push_subscriptions x WHERE x.user_id = p_user;'
    || E'\n  DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;');
  EXECUTE v_new;
END;
$erase$;

-- ── 11. Realtime, grants, schedule ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                   AND tablename = 'notice_deliveries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notice_deliveries;
  END IF;
END;
$$;

DO $$
DECLARE
  fn text;
BEGIN
  -- Server only.
  FOREACH fn IN ARRAY ARRAY[
    'tasks__reminders_suspend()',
    'tasks__fire_reminders(timestamptz, integer)',
    'tasks__notice(uuid, text, uuid, text, jsonb)',
    'tasks__waiting_came_in(public.task_waiting, text)',
    'comments__waiting_came_in()',
    'email_refs__waiting_came_in()',
    'notice_deliveries__kick()',
    'notice_deliveries__authorize(text)',
    'notice_deliveries__claim(integer)',
    'notice_deliveries__settle(jsonb)',
    'notice_deliveries__purge()',
    'spine__visible_to(uuid, text, uuid, uuid)',
    'module_activity__gate_recipients()',
    'buckets__archive_check()',
    'tasks_notify_spine()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- People and keys.
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_reminders_restore(uuid, uuid)',
    'tasks_op_reminder_add(uuid, uuid, text, timestamptz)',
    'tasks_op_mention(uuid, uuid, uuid[])',
    'push_op_subscribe(text, text, text, text)',
    'push_op_unsubscribe(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  -- A pure check, used by the ops and push-send.
  REVOKE ALL ON FUNCTION public.push__endpoint_ok(text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.push__endpoint_ok(text) TO authenticated, service_role;
END;
$$;

-- Reminders are precise to the minute ("one precise notice"); the push sender
-- is kicked right after, when there's something to push.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasks-reminders') THEN
    PERFORM cron.unschedule('tasks-reminders');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notice-deliveries-purge') THEN
    PERFORM cron.unschedule('notice-deliveries-purge');
  END IF;
END;
$$;
SELECT cron.schedule(
  'tasks-reminders',
  '* * * * *',
  $cron$SET statement_timeout = '50s'; SELECT public.tasks__fire_reminders(now(), 500); SELECT public.notice_deliveries__kick();$cron$
);
SELECT cron.schedule(
  'notice-deliveries-purge',
  '17 4 * * *',
  $cron$SELECT public.notice_deliveries__purge();$cron$
);
