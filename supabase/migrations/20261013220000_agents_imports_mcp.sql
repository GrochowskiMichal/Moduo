-- TV-D16 · Agents and MCP v3 (specs/tasks-v3.md block 31: §12, §13's agent
-- row, §Assumptions #14, #15, #20, #26; REPLAN 6, 7, 35, 51, 52, 74).
-- Local stack only until the release. Re-runnable.
--
-- 1. "Alex · via Claude Desktop": a key's trail rows name the person it acts
--    for and the key (module_activity_log, re-cut from the live body).
-- 2. Agent sessions: the five-field status an agent posts on a task (state,
--    note, step n of m, links, times), private to whoever started it unless
--    they show their agent work to teammates; the hand-back summary stays
--    theirs until they post it as a comment. A revoked key stops its sessions.
-- 3. The agent's loud states (needs you · ready for review · failed) reach the
--    person who started it, once: a bell notice on their own Inbox and an
--    OS / browser notice (delivery kind 'agent').
-- 4. Tags by name, through one op (agents had no way to tag).
-- 5. Imports: "imported from" is unique per person (it was per workspace, so a
--    collision told you a task you can't see existed), a run is recorded, a
--    re-run updates what the person made, and Undo removes what the run made
--    that nobody touched since.
-- 6. Account erasure covers the new tables.
-- 7. Grants.

-- ── 1. "via <key>" ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.module_activity_log(
  p_workspace_id uuid, p_module text, p_entity_type text, p_entity_id uuid, p_op text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key uuid;
  v_label text;
  v_person text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.module_activity
      (workspace_id, module, entity_type, entity_id, op,
       actor_type, actor_id, actor_label, payload)
    VALUES (
      p_workspace_id, p_module, p_entity_type, p_entity_id, p_op,
      'user', auth.uid(),
      (SELECT p.display_name FROM public.profiles p WHERE p.id = auth.uid()),
      coalesce(p_payload, '{}'::jsonb)
    );
    RETURN;
  END IF;
  v_key := public.module_api_key_id();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'No actor context for activity attribution.';
  END IF;
  -- TV-D16 (REPLAN 51, 52): the trail says whom the agent works for and
  -- through which key, "Alex · via Claude Desktop". A key whose person has no
  -- name keeps the key's name alone.
  SELECT k.name, nullif(btrim(p.display_name), '')
    INTO v_label, v_person
  FROM public.workspace_api_keys k
  LEFT JOIN public.profiles p ON p.id = k.created_by
  WHERE k.id = v_key;
  IF v_person IS NOT NULL THEN
    v_label := v_person || ' · via ' || coalesce(nullif(btrim(v_label), ''), 'an API key');
  END IF;
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op,
     actor_type, actor_id, actor_label, payload)
  VALUES (
    p_workspace_id, p_module, p_entity_type, p_entity_id, p_op,
    'api_key', v_key, v_label, coalesce(p_payload, '{}'::jsonb)
  );
END;
$$;

-- ── 2. Agent sessions ────────────────────────────────────────────────────────

-- "Show my agent work to teammates" (spec §12): off by default.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS show_agent_work boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.user_preferences.show_agent_work IS
  'TV-D16: teammates who can see a task see this person''s agent sessions on it. Written only by user_op_set_agent_work.';

-- One live session per task and key: an agent's reports update it in place,
-- and a new run starts when it reports working after ready or failed.
CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- Whoever started it: the key's person.
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key_id uuid REFERENCES public.workspace_api_keys(id) ON DELETE SET NULL,
  -- The name the line shows ("Claude"): what the agent says, else the key's name.
  agent text NOT NULL CHECK (char_length(agent) BETWEEN 1 AND 60),
  state text NOT NULL CHECK (state IN ('working', 'needs_you', 'ready', 'failed')),
  note text CHECK (note IS NULL OR char_length(note) <= 280),
  step integer CHECK (step IS NULL OR step BETWEEN 1 AND 999),
  steps integer CHECK (steps IS NULL OR steps BETWEEN 1 AND 999),
  -- [{url, label?}], http(s) only.
  links jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) <= 5),
  -- The run's earlier lines, newest first: [{at, state, note?, step?, steps?}].
  earlier jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(earlier) = 'array' AND jsonb_array_length(earlier) <= 20),
  -- When a hand-back summary arrived and when its person posted it (the text
  -- itself is in agent_session_summaries, which only they read).
  summary_at timestamptz,
  summary_posted_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Its key was revoked while it was working or waiting on its person.
  stopped_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT agent_sessions_steps CHECK ((step IS NULL) = (steps IS NULL) AND (step IS NULL OR step <= steps))
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_live_key
  ON public.agent_sessions (task_id, key_id) WHERE deleted_at IS NULL AND key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_sessions_sync
  ON public.agent_sessions (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS agent_sessions_user ON public.agent_sessions (user_id);
CREATE INDEX IF NOT EXISTS agent_sessions_key ON public.agent_sessions (key_id) WHERE key_id IS NOT NULL;

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.agent_sessions;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.agent_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- The hand-back summary: its person's alone, never in Realtime.
CREATE TABLE IF NOT EXISTS public.agent_session_summaries (
  session_id uuid PRIMARY KEY REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_session_summaries_user ON public.agent_session_summaries (user_id);

-- Who sees a session: whoever started it, and, while they show their agent
-- work, anyone who can see the task. Never once its person can't see the task.
CREATE OR REPLACE FUNCTION public.agent_sessions__shown_to(p_task_id uuid, p_owner uuid, p_viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_viewer IS NOT NULL AND p_owner IS NOT NULL
     AND public.tasks__visible_to(p_task_id, p_viewer)
     AND (p_owner = p_viewer
          OR (public.tasks__visible_to(p_task_id, p_owner)
              AND coalesce((SELECT up.show_agent_work FROM public.user_preferences up
                            WHERE up.user_id = p_owner), false)))
$$;

-- The read policy's question, for the signed-in caller. It answers true only
-- for a session that exists, so calling it directly tells nobody more than
-- the rows they can read.
CREATE OR REPLACE FUNCTION public.agent_sessions__shown(p_task_id uuid, p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.agent_sessions s WHERE s.task_id = p_task_id AND s.user_id = p_owner)
     AND public.agent_sessions__shown_to(p_task_id, p_owner, auth.uid())
$$;

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_sessions_read ON public.agent_sessions;
CREATE POLICY agent_sessions_read ON public.agent_sessions
  FOR SELECT TO authenticated
  USING (public.agent_sessions__shown(task_id, user_id));
REVOKE ALL ON public.agent_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_sessions TO authenticated;
GRANT ALL ON public.agent_sessions TO service_role;

ALTER TABLE public.agent_session_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_session_summaries_own_read ON public.agent_session_summaries;
CREATE POLICY agent_session_summaries_own_read ON public.agent_session_summaries
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.agent_session_summaries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_session_summaries TO authenticated;
GRANT ALL ON public.agent_session_summaries TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                   AND tablename = 'agent_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_sessions;
  END IF;
END;
$$;

-- An OS / browser notice for the agent's loud states.
ALTER TABLE public.notice_deliveries DROP CONSTRAINT IF EXISTS notice_deliveries_kind_check;
ALTER TABLE public.notice_deliveries
  ADD CONSTRAINT notice_deliveries_kind_check CHECK (kind IN ('reminder', 'agent'));

-- A session's lines, as one of its runs left them: a link is {url, label?}
-- with an http(s) url; a bare string is the url.
CREATE OR REPLACE FUNCTION public.agent_sessions__links(p_links jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_url text;
  v_label text;
BEGIN
  IF p_links IS NULL OR jsonb_typeof(p_links) = 'null' THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_links) <> 'array' OR jsonb_array_length(p_links) > 5 THEN
    RAISE EXCEPTION 'links is a list of at most 5 links.' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT x FROM jsonb_array_elements(p_links) AS x LOOP
    IF jsonb_typeof(v_item) = 'string' THEN
      v_url := btrim(v_item #>> '{}');
      v_label := NULL;
    ELSIF jsonb_typeof(v_item) = 'object' THEN
      v_url := btrim(coalesce(v_item ->> 'url', ''));
      v_label := nullif(btrim(coalesce(v_item ->> 'label', '')), '');
    ELSE
      RAISE EXCEPTION 'A link is a url or {url, label}.' USING ERRCODE = '22023';
    END IF;
    IF v_url !~* '^https?://[^\s]+$' OR char_length(v_url) > 500 THEN
      RAISE EXCEPTION 'A link is an http(s) address of at most 500 characters.' USING ERRCODE = '22023';
    END IF;
    IF v_label IS NOT NULL AND char_length(v_label) > 80 THEN
      RAISE EXCEPTION 'A link''s label is at most 80 characters.' USING ERRCODE = '22023';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('url', v_url, 'label', v_label)));
  END LOOP;
  RETURN v_out;
END;
$$;

-- An agent reports its work on a task (MCP tasks_session_status). Keys only:
-- a person's own words go in comments. Needs Tasks edit on the key and edit
-- access to the task for its person. A report states the current line: note
-- and step change with every report; links stay until a report sends new
-- ones; the agent's name stays once given. No trail row: sessions are
-- private, and the trail already has every write the agent made.
CREATE OR REPLACE FUNCTION public.tasks_op_agent_report(p_workspace_id uuid, p_task_id uuid, p_report jsonb)
RETURNS public.agent_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key uuid := public.module_api_key_id();
  v_actor uuid := public.perm_actor_id();
  t public.tasks;
  s public.agent_sessions;
  v_found boolean;
  v_old_state text;
  v_state text := p_report ->> 'state';
  v_note text;
  v_step integer;
  v_steps integer;
  v_links jsonb;
  v_agent text;
  v_key_name text;
  v_summary text;
  v_new_run boolean := false;
  v_line jsonb;
  v_inbox uuid;
  v_words text;
  v_muted boolean;
  w public.task_waiting;
BEGIN
  IF v_key IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'Only an agent reports its own work on a task.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks__check_keys(p_report, ARRAY['state', 'note', 'step', 'steps', 'links', 'summary', 'agent']);
  t := public.tasks__guard_edit(p_workspace_id, p_task_id);

  IF v_state IS NULL OR v_state NOT IN ('working', 'needs_you', 'ready', 'failed') THEN
    RAISE EXCEPTION 'A session''s state is working, needs_you, ready or failed.' USING ERRCODE = '22023';
  END IF;
  v_note := nullif(btrim(coalesce(p_report ->> 'note', '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 280 THEN
    RAISE EXCEPTION 'A note is at most 280 characters.' USING ERRCODE = '22023';
  END IF;
  IF (p_report ? 'step' AND jsonb_typeof(p_report -> 'step') <> 'null')
     OR (p_report ? 'steps' AND jsonb_typeof(p_report -> 'steps') <> 'null') THEN
    IF jsonb_typeof(p_report -> 'step') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_report -> 'steps') IS DISTINCT FROM 'number'
       OR (p_report ->> 'step') !~ '^[0-9]{1,3}$' OR (p_report ->> 'steps') !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'A step is "step n of m": two whole numbers from 1 to 999.' USING ERRCODE = '22023';
    END IF;
    v_step := (p_report ->> 'step')::integer;
    v_steps := (p_report ->> 'steps')::integer;
    IF v_step < 1 OR v_steps < 1 OR v_step > v_steps THEN
      RAISE EXCEPTION 'A step is "step n of m", with n from 1 to m.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_report ? 'links' THEN
    v_links := public.agent_sessions__links(p_report -> 'links');
  END IF;
  v_summary := nullif(btrim(coalesce(p_report ->> 'summary', '')), '');
  IF v_summary IS NOT NULL AND char_length(v_summary) > 4000 THEN
    RAISE EXCEPTION 'A summary is at most 4,000 characters.' USING ERRCODE = '22023';
  END IF;
  v_agent := nullif(btrim(coalesce(p_report ->> 'agent', '')), '');
  IF v_agent IS NOT NULL AND char_length(v_agent) > 60 THEN
    RAISE EXCEPTION 'An agent''s name is at most 60 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO s FROM public.agent_sessions x
  WHERE x.task_id = t.id AND x.key_id = v_key AND x.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;
  SELECT k.name INTO v_key_name FROM public.workspace_api_keys k WHERE k.id = v_key;
  v_agent := coalesce(v_agent, CASE WHEN v_found THEN s.agent END,
                      left(coalesce(nullif(btrim(v_key_name), ''), 'Agent'), 60));

  IF NOT v_found THEN
    v_new_run := true;
    INSERT INTO public.agent_sessions
      (workspace_id, task_id, user_id, key_id, agent, state, note, step, steps, links, summary_at)
    VALUES
      (p_workspace_id, t.id, v_actor, v_key, v_agent, v_state, v_note, v_step, v_steps,
       coalesce(v_links, '[]'::jsonb), CASE WHEN v_summary IS NOT NULL THEN now() END)
    RETURNING * INTO s;
  ELSE
    v_old_state := s.state;
    v_new_run := s.stopped_at IS NOT NULL OR (s.state IN ('ready', 'failed') AND v_state = 'working');
    v_line := jsonb_strip_nulls(jsonb_build_object(
      'at', s.updated_at, 'state', s.state, 'note', s.note, 'step', s.step, 'steps', s.steps));
    UPDATE public.agent_sessions x SET
      agent = v_agent,
      state = v_state,
      note = v_note,
      step = v_step,
      steps = v_steps,
      links = CASE WHEN v_links IS NOT NULL THEN v_links
                   WHEN v_new_run THEN '[]'::jsonb ELSE x.links END,
      earlier = CASE WHEN v_new_run THEN '[]'::jsonb
                     ELSE (SELECT coalesce(jsonb_agg(e.v ORDER BY e.n), '[]'::jsonb)
                           FROM jsonb_array_elements(jsonb_build_array(v_line) || x.earlier)
                                WITH ORDINALITY AS e(v, n)
                           WHERE e.n <= 20) END,
      started_at = CASE WHEN v_new_run THEN now() ELSE x.started_at END,
      summary_at = CASE WHEN v_summary IS NOT NULL THEN now()
                        WHEN v_new_run THEN NULL ELSE x.summary_at END,
      summary_posted_at = CASE WHEN v_summary IS NOT NULL OR v_new_run THEN NULL ELSE x.summary_posted_at END,
      stopped_at = NULL
    WHERE x.id = s.id
    RETURNING * INTO s;
    IF v_new_run THEN
      DELETE FROM public.agent_session_summaries m WHERE m.session_id = s.id;
    END IF;
  END IF;
  IF v_summary IS NOT NULL THEN
    INSERT INTO public.agent_session_summaries (session_id, workspace_id, user_id, summary)
    VALUES (s.id, p_workspace_id, v_actor, v_summary)
    ON CONFLICT (session_id) DO UPDATE SET summary = EXCLUDED.summary, updated_at = now();
  END IF;

  -- The loud moments: once per change into one, to the person who started it.
  IF v_state IN ('needs_you', 'ready', 'failed')
     AND (v_new_run OR v_old_state IS DISTINCT FROM v_state) THEN
    -- Whatever waited on this agent here came back.
    FOR w IN
      SELECT * FROM public.task_waiting x
      WHERE x.task_id = t.id AND x.kind = 'agent' AND x.ref = v_key AND x.deleted_at IS NULL
    LOOP
      IF w.created_by IS NOT DISTINCT FROM v_actor THEN
        -- Its person hears from the agent itself below.
        UPDATE public.task_waiting x SET deleted_at = now() WHERE x.id = w.id;
      ELSE
        PERFORM public.tasks__waiting_came_in(w, 'agent');
      END IF;
    END LOOP;

    v_words := CASE v_state WHEN 'needs_you' THEN 'needs you'
                            WHEN 'ready' THEN 'is ready for review'
                            ELSE 'failed' END;
    -- On their own Inbox, which only they read (like a reminder): the
    -- session stays private wherever the task is shared.
    v_inbox := public.tasks__inbox(p_workspace_id, v_actor);
    INSERT INTO public.module_activity
      (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
    VALUES (p_workspace_id, 'tasks', 'bucket', v_inbox, 'tasks.agent_status', 'api_key', v_key, v_agent,
            jsonb_strip_nulls(jsonb_build_object(
              'notify_user_ids', jsonb_build_array(v_actor::text),
              'task_id', t.id,
              'title', t.title,
              'state', v_state,
              'note', v_note,
              'session_id', s.id)));
    -- "That key's notifications": the person's Agents switch mutes the OS /
    -- browser notice too (the bell filters its own rows).
    SELECT coalesce((up.preferences -> 'notifications' ->> 'agents')::boolean, true) = false
      INTO v_muted
    FROM public.user_preferences up WHERE up.user_id = v_actor;
    IF NOT coalesce(v_muted, false) THEN
      INSERT INTO public.notice_deliveries (user_id, workspace_id, kind, task_id, title, body, url)
      VALUES (v_actor, p_workspace_id, 'agent', t.id,
              left(v_agent || ' ' || v_words, 300),
              left(coalesce(nullif(btrim(t.title), ''), 'A task'), 500),
              '/tasks?id=' || t.id);
    END IF;
  END IF;
  RETURN s;
END;
$$;

-- The sessions on a task the caller can see (MCP, the panel): their own with
-- the hand-back summary, others' (while shown) without it.
CREATE OR REPLACE FUNCTION public.tasks_agent_sessions(p_workspace_id uuid, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks x
                 WHERE x.id = p_task_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL)
     OR NOT public.tasks__visible_to(p_task_id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(
             (to_jsonb(s) - 'key_id' - 'workspace_id' - 'deleted_at')
             || jsonb_build_object('mine', s.user_id = v_actor)
             || CASE WHEN s.user_id = v_actor
                     THEN jsonb_build_object('summary', m.summary) ELSE '{}'::jsonb END
             ORDER BY s.updated_at DESC, s.id)
    FROM public.agent_sessions s
    LEFT JOIN public.agent_session_summaries m ON m.session_id = s.id AND m.user_id = v_actor
    WHERE s.task_id = p_task_id AND s.workspace_id = p_workspace_id AND s.deleted_at IS NULL
      AND public.agent_sessions__shown_to(s.task_id, s.user_id, v_actor)), '[]'::jsonb);
END;
$$;

-- "Post as comment": the hand-back summary becomes a comment by its person.
CREATE OR REPLACE FUNCTION public.tasks_op_agent_session_post(p_workspace_id uuid, p_session_id uuid)
RETURNS public.agent_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  s public.agent_sessions;
  v_summary text;
BEGIN
  IF v_user IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Only its person posts a session''s summary.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.agent_sessions x
  WHERE x.id = p_session_id AND x.workspace_id = p_workspace_id AND x.user_id = v_user
    AND x.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT public.tasks__visible_to(s.task_id, v_user) THEN
    RAISE EXCEPTION 'Session not found.' USING ERRCODE = '22023';
  END IF;
  SELECT m.summary INTO v_summary FROM public.agent_session_summaries m WHERE m.session_id = s.id;
  IF v_summary IS NULL THEN
    RAISE EXCEPTION 'This session has no summary to post.' USING ERRCODE = '22023';
  END IF;
  IF s.summary_posted_at IS NOT NULL THEN
    RETURN s;
  END IF;
  PERFORM public.comments_op_add(p_workspace_id, 'task', s.task_id, v_summary, '{}'::uuid[]);
  UPDATE public.agent_sessions x SET summary_posted_at = now() WHERE x.id = s.id RETURNING * INTO s;
  RETURN s;
END;
$$;

-- Its person clears a session's line from the task.
CREATE OR REPLACE FUNCTION public.tasks_op_agent_session_dismiss(p_workspace_id uuid, p_session_id uuid)
RETURNS public.agent_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  s public.agent_sessions;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.agent_sessions x
  WHERE x.id = p_session_id AND x.workspace_id = p_workspace_id AND x.user_id = v_actor
  FOR UPDATE;
  IF NOT FOUND OR NOT public.tasks__visible_to(s.task_id, v_actor) THEN
    RAISE EXCEPTION 'Session not found.' USING ERRCODE = '22023';
  END IF;
  IF s.deleted_at IS NULL THEN
    UPDATE public.agent_sessions x SET deleted_at = now() WHERE x.id = s.id RETURNING * INTO s;
  END IF;
  RETURN s;
END;
$$;

-- The switch, read and written by its person.
CREATE OR REPLACE FUNCTION public.user_agent_work()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT up.show_agent_work FROM public.user_preferences up
                   WHERE up.user_id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.user_op_set_agent_work(p_show boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ws uuid;
BEGIN
  IF v_user IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Sign in to change who sees your agent work.' USING ERRCODE = '42501';
  END IF;
  IF p_show IS NULL THEN
    RAISE EXCEPTION 'Showing your agent work is on or off.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_preferences (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_preferences up SET show_agent_work = p_show
  WHERE up.user_id = v_user AND up.show_agent_work IS DISTINCT FROM p_show;
  IF FOUND THEN
    -- Teammates' copies follow at once: a row now shown arrives as a change,
    -- and one now hidden leaves through their access check.
    UPDATE public.agent_sessions s SET updated_at = now()
    WHERE s.user_id = v_user AND s.deleted_at IS NULL;
    FOR v_ws IN
      SELECT DISTINCT s.workspace_id FROM public.agent_sessions s
      WHERE s.user_id = v_user AND s.deleted_at IS NULL
    LOOP
      PERFORM public.access_changes__note(v_ws, NULL, 'workspace', v_ws);
    END LOOP;
  END IF;
  RETURN p_show;
END;
$$;

-- A revoked key stops what it was doing: "Stopped (key revoked)" (spec §12's
-- edge case); the trail keeps "via <key name>". Waiting on it ends too.
CREATE OR REPLACE FUNCTION public.agent_sessions__key_revoked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.agent_sessions s SET stopped_at = now()
  WHERE s.key_id = NEW.id AND s.deleted_at IS NULL AND s.stopped_at IS NULL
    AND s.state IN ('working', 'needs_you');
  UPDATE public.task_waiting w SET deleted_at = now()
  WHERE w.kind = 'agent' AND w.ref = NEW.id AND w.deleted_at IS NULL;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS agent_sessions_key_revoked ON public.workspace_api_keys;
CREATE TRIGGER agent_sessions_key_revoked
  AFTER UPDATE OF revoked_at ON public.workspace_api_keys
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION public.agent_sessions__key_revoked();

-- ── 4. Tags by name ──────────────────────────────────────────────────────────

-- Add and remove a task's tags by name (case doesn't matter). A name the
-- workspace doesn't have yet becomes a tag when the caller may make tags (as
-- the app's tag picker). Needs edit access to the task. Answers with the
-- task's tag names.
CREATE OR REPLACE FUNCTION public.tasks_op_tag(
  p_workspace_id uuid, p_task_id uuid, p_add text[], p_remove text[] DEFAULT '{}'::text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  t public.tasks;
  g public.tags;
  v_name text;
  v_added text[] := '{}';
  v_removed text[] := '{}';
  v_n integer;
BEGIN
  t := public.tasks__guard_edit(p_workspace_id, p_task_id);
  IF coalesce(cardinality(p_add), 0) + coalesce(cardinality(p_remove), 0) > 20 THEN
    RAISE EXCEPTION 'At most 20 tags at a time.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_name IN ARRAY coalesce(p_remove, '{}'::text[]) LOOP
    v_name := btrim(coalesce(v_name, ''));
    CONTINUE WHEN v_name = '';
    DELETE FROM public.tag_links l
    USING public.tags x
    WHERE l.tag_id = x.id AND x.workspace_id = p_workspace_id AND lower(x.name) = lower(v_name)
      AND l.workspace_id = p_workspace_id AND l.entity_type = 'task' AND l.entity_id = t.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_removed := v_removed || v_name;
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY coalesce(p_add, '{}'::text[]) LOOP
    v_name := btrim(coalesce(v_name, ''));
    CONTINUE WHEN v_name = '';
    IF char_length(v_name) > 50 THEN
      RAISE EXCEPTION 'A tag''s name is at most 50 characters.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO g FROM public.tags x
    WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL AND lower(x.name) = lower(v_name)
    ORDER BY x.created_at, x.id
    LIMIT 1;
    IF NOT FOUND THEN
      IF NOT public.perm_can_tag(p_workspace_id) THEN
        RAISE EXCEPTION 'You can''t make new tags in this workspace.' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.tags (workspace_id, owner_id, name)
      VALUES (p_workspace_id, v_actor, v_name)
      RETURNING * INTO g;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tag_links l
                   WHERE l.tag_id = g.id AND l.entity_type = 'task' AND l.entity_id = t.id) THEN
      INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id)
      VALUES (p_workspace_id, g.id, 'task', t.id);
      v_added := v_added || g.name;
    END IF;
  END LOOP;

  IF cardinality(v_added) > 0 OR cardinality(v_removed) > 0 THEN
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.tag',
      jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  END IF;
  RETURN coalesce((
    SELECT array_agg(x.name ORDER BY lower(x.name), x.id)
    FROM public.tag_links l JOIN public.tags x ON x.id = l.tag_id AND x.deleted_at IS NULL
    WHERE l.entity_type = 'task' AND l.entity_id = t.id), '{}'::text[]);
END;
$$;

-- ── 5. Imports ───────────────────────────────────────────────────────────────

-- "Imported from" names one live task per person (was: per workspace).
DROP INDEX IF EXISTS public.tasks_imported_from_key;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_imported_from_key
  ON public.tasks (workspace_id, owner_id, (imported_from ->> 'source'), (imported_from ->> 'key'))
  WHERE imported_from IS NOT NULL AND deleted_at IS NULL;

-- tasks_op_create's own check follows (anchored replace on the live body).
DO $create$
DECLARE
  v_def text := pg_get_functiondef('public.tasks_op_create(uuid, jsonb)'::regprocedure);
  v_old text := 'WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL'
                || E'\n                   AND x.imported_from ->> ''source'' = p_task -> ''imported_from'' ->> ''source''';
  v_new text := 'WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL AND x.owner_id = v_actor'
                || E'\n                   AND x.imported_from ->> ''source'' = p_task -> ''imported_from'' ->> ''source''';
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position(v_old IN v_def) = 0
     OR position('-- TV-D10: an import key names one live task per workspace.' IN v_def) = 0 THEN
    RAISE EXCEPTION 'tasks_op_create isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, '-- TV-D10: an import key names one live task per workspace.',
    '-- TV-D10, TV-D16: an import key names one live task per person.');
  EXECUTE v_def;
END;
$create$;

-- A run of an import: who ran it (a person, maybe through a key), from where.
CREATE TABLE IF NOT EXISTS public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key_id uuid REFERENCES public.workspace_api_keys(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  label text CHECK (label IS NULL OR char_length(label) <= 120),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  undone_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imports_user ON public.imports (user_id, workspace_id, started_at DESC);
DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.imports;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.imports
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- What one run made or changed, for "Undo this import".
CREATE TABLE IF NOT EXISTS public.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('task', 'bucket', 'section')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated')),
  logged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS import_rows_entity ON public.import_rows (entity_type, entity_id);

ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS imports_own_read ON public.imports;
CREATE POLICY imports_own_read ON public.imports
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.imports TO authenticated;
GRANT ALL ON public.imports TO service_role;

ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_rows_own_read ON public.import_rows;
CREATE POLICY import_rows_own_read ON public.import_rows
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.imports i
                 WHERE i.id = import_rows.import_id AND i.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.import_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.import_rows TO authenticated;
GRANT ALL ON public.import_rows TO service_role;

-- The caller's own import in this workspace, locked; anyone else's reads as
-- missing.
CREATE OR REPLACE FUNCTION public.imports__own(p_workspace_id uuid, p_import_id uuid)
RETURNS public.imports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.imports;
BEGIN
  SELECT * INTO i FROM public.imports x
  WHERE x.id = p_import_id AND x.workspace_id = p_workspace_id
    AND x.user_id = public.perm_actor_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No import with that id.' USING ERRCODE = '22023';
  END IF;
  RETURN i;
END;
$$;

-- What a run did, counted from its own rows (only what the caller still sees).
CREATE OR REPLACE FUNCTION public.imports__summary(i public.imports)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', i.id,
    'source', i.source,
    'label', i.label,
    'started_at', i.started_at,
    'finished_at', i.finished_at,
    'undone_at', i.undone_at,
    'tasks_created', (SELECT count(*) FROM public.import_rows r
                      WHERE r.import_id = i.id AND r.entity_type = 'task' AND r.action = 'created'
                        AND public.tasks__visible_to(r.entity_id, i.user_id)),
    'tasks_updated', (SELECT count(*) FROM public.import_rows r
                      WHERE r.import_id = i.id AND r.entity_type = 'task' AND r.action = 'updated'
                        AND public.tasks__visible_to(r.entity_id, i.user_id)),
    'projects_created', (SELECT count(*) FROM public.import_rows r
                         WHERE r.import_id = i.id AND r.entity_type = 'bucket'
                           AND public.projects__visible_to(r.entity_id, i.user_id)),
    'sections_created', (SELECT count(*) FROM public.import_rows r
                         JOIN public.sections s ON s.id = r.entity_id
                         WHERE r.import_id = i.id AND r.entity_type = 'section'
                           AND public.projects__visible_to(s.project_id, i.user_id)))
$$;

-- Begin a run (MCP imports_begin; TV-U18's importers too).
CREATE OR REPLACE FUNCTION public.imports_op_begin(p_workspace_id uuid, p_source text, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_source text := btrim(coalesce(p_source, ''));
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  i public.imports;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF v_source = '' OR char_length(v_source) > 40 THEN
    RAISE EXCEPTION 'Name where the import comes from (at most 40 characters), like "todoist".' USING ERRCODE = '22023';
  END IF;
  IF v_label IS NOT NULL AND char_length(v_label) > 120 THEN
    RAISE EXCEPTION 'An import''s label is at most 120 characters.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.imports (workspace_id, user_id, key_id, source, label)
  VALUES (p_workspace_id, v_actor, public.module_api_key_id(), v_source, v_label)
  RETURNING * INTO i;
  RETURN public.imports__summary(i);
END;
$$;

-- Create a task with its tags, reminders and work sessions in one go; with an
-- "imported from" key the caller already used on a live task of theirs, update
-- that task instead (a re-run). Inside an import run, the row is recorded for
-- Undo. A re-run changes the fields it's given and adds missing tags;
-- reminders and work sessions are set only when it creates the task.
CREATE OR REPLACE FUNCTION public.tasks_op_create_with(p_workspace_id uuid, p_task jsonb, p_with jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_with jsonb := coalesce(p_with, '{}'::jsonb);
  i public.imports;
  t public.tasks;
  v_existing uuid;
  v_action text := 'created';
  v_tags text[];
  v_item jsonb;
  v_reminders integer := 0;
  v_sessions integer := 0;
BEGIN
  PERFORM public.tasks__check_keys(v_with, ARRAY['import_id', 'tags', 'reminders', 'sessions']);
  IF p_task IS NULL OR jsonb_typeof(p_task) <> 'object' THEN
    RAISE EXCEPTION 'Expected an object of task fields.' USING ERRCODE = '22023';
  END IF;
  IF v_with ? 'import_id' AND jsonb_typeof(v_with -> 'import_id') <> 'null' THEN
    i := public.imports__own(p_workspace_id, public.tasks__try_uuid(v_with ->> 'import_id'));
    IF i.finished_at IS NOT NULL OR i.undone_at IS NOT NULL THEN
      RAISE EXCEPTION 'That import is finished: begin a new one to run it again.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_with ? 'tags' AND jsonb_typeof(v_with -> 'tags') <> 'null' THEN
    IF jsonb_typeof(v_with -> 'tags') <> 'array' THEN
      RAISE EXCEPTION 'tags is a list of names.' USING ERRCODE = '22023';
    END IF;
    v_tags := ARRAY(SELECT jsonb_array_elements_text(v_with -> 'tags'));
  END IF;
  IF jsonb_typeof(coalesce(v_with -> 'reminders', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(v_with -> 'reminders', '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'reminders is a list of at most 10.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(v_with -> 'sessions', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(v_with -> 'sessions', '[]'::jsonb)) > 10 THEN
    RAISE EXCEPTION 'sessions is a list of at most 10.' USING ERRCODE = '22023';
  END IF;

  -- A re-run: the caller's own live task with this key.
  IF jsonb_typeof(p_task -> 'imported_from') = 'object' AND v_actor IS NOT NULL THEN
    SELECT x.id INTO v_existing FROM public.tasks x
    WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.deleted_at IS NULL
      AND x.imported_from ->> 'source' = p_task -> 'imported_from' ->> 'source'
      AND x.imported_from ->> 'key' = p_task -> 'imported_from' ->> 'key'
    LIMIT 1;
  END IF;

  IF v_existing IS NOT NULL THEN
    v_action := 'updated';
    SELECT * INTO t FROM public.tasks_op_update(
      p_workspace_id, v_existing, p_task - 'id' - 'imported_from' - 'position') LIMIT 1;
    IF NOT public.tasks__editable_to(t.id, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
    END IF;
  ELSE
    t := public.tasks_op_create(p_workspace_id, p_task);
    FOR v_item IN SELECT x FROM jsonb_array_elements(coalesce(v_with -> 'reminders', '[]'::jsonb)) AS x LOOP
      IF jsonb_typeof(v_item) <> 'object' THEN
        RAISE EXCEPTION 'A reminder is {kind, at?}.' USING ERRCODE = '22023';
      END IF;
      PERFORM public.tasks__check_keys(v_item, ARRAY['kind', 'at']);
      PERFORM public.tasks_op_reminder_add(p_workspace_id, t.id, coalesce(v_item ->> 'kind', 'at'),
        public.tasks__try_ts(v_item ->> 'at'));
      v_reminders := v_reminders + 1;
    END LOOP;
    FOR v_item IN SELECT x FROM jsonb_array_elements(coalesce(v_with -> 'sessions', '[]'::jsonb)) AS x LOOP
      PERFORM public.tasks_op_session_add(p_workspace_id, t.id, v_item);
      v_sessions := v_sessions + 1;
    END LOOP;
  END IF;

  IF v_tags IS NOT NULL AND cardinality(v_tags) > 0 THEN
    v_tags := public.tasks_op_tag(p_workspace_id, t.id, v_tags, '{}'::text[]);
  END IF;
  IF i.id IS NOT NULL THEN
    INSERT INTO public.import_rows (import_id, workspace_id, entity_type, entity_id, action)
    VALUES (i.id, p_workspace_id, 'task', t.id, v_action)
    ON CONFLICT (import_id, entity_type, entity_id) DO NOTHING;
  END IF;
  SELECT * INTO t FROM public.tasks x WHERE x.id = t.id;
  RETURN jsonb_build_object(
    'action', v_action,
    'task', to_jsonb(t),
    'reminders_added', v_reminders,
    'sessions_added', v_sessions);
END;
$$;

-- Edit a task and its tags in one go (MCP tasks_update).
CREATE OR REPLACE FUNCTION public.tasks_op_update_with(
  p_workspace_id uuid, p_task_id uuid, p_patch jsonb, p_with jsonb DEFAULT '{}'::jsonb)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_with jsonb := coalesce(p_with, '{}'::jsonb);
  v_rows public.tasks[];
  v_add text[] := '{}';
  v_remove text[] := '{}';
  t public.tasks;
BEGIN
  PERFORM public.tasks__check_keys(v_with, ARRAY['tags_add', 'tags_remove']);
  IF jsonb_typeof(coalesce(v_with -> 'tags_add', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(v_with -> 'tags_remove', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'tags_add and tags_remove are lists of names.' USING ERRCODE = '22023';
  END IF;
  v_add := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_with -> 'tags_add', '[]'::jsonb)));
  v_remove := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_with -> 'tags_remove', '[]'::jsonb)));
  SELECT array_agg(x) INTO v_rows FROM public.tasks_op_update(p_workspace_id, p_task_id, coalesce(p_patch, '{}'::jsonb)) x;
  IF cardinality(v_add) > 0 OR cardinality(v_remove) > 0 THEN
    PERFORM public.tasks_op_tag(p_workspace_id, p_task_id, v_add, v_remove);
  END IF;
  FOREACH t IN ARRAY coalesce(v_rows, '{}'::public.tasks[]) LOOP
    SELECT * INTO t FROM public.tasks x WHERE x.id = t.id;
    RETURN NEXT t;
  END LOOP;
  RETURN;
END;
$$;

-- Record a project or a section this run made (MCP projects_create /
-- sections_create with an import id). Only one the caller made since the run
-- began, in a project they can edit.
CREATE OR REPLACE FUNCTION public.imports_op_note(
  p_workspace_id uuid, p_import_id uuid, p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  i public.imports;
BEGIN
  i := public.imports__own(p_workspace_id, p_import_id);
  IF i.finished_at IS NOT NULL OR i.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'That import is finished: begin a new one to run it again.' USING ERRCODE = '22023';
  END IF;
  IF p_entity_type = 'bucket' THEN
    IF NOT EXISTS (SELECT 1 FROM public.buckets b
                   WHERE b.id = p_entity_id AND b.workspace_id = p_workspace_id AND b.deleted_at IS NULL
                     AND NOT b.is_system AND b.owner_id = v_actor AND b.created_at >= i.started_at)
       OR NOT public.projects__visible_to(p_entity_id, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t one this import made.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_entity_type = 'section' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sections s
                   WHERE s.id = p_entity_id AND s.workspace_id = p_workspace_id AND s.deleted_at IS NULL
                     AND s.created_at >= i.started_at
                     AND public.projects__visible_to(s.project_id, v_actor)
                     AND public.projects__editable_to(s.project_id, v_actor)) THEN
      RAISE EXCEPTION 'That section isn''t one this import made.' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'An import records projects and sections here; tasks go through tasks_op_create_with.'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.import_rows (import_id, workspace_id, entity_type, entity_id, action)
  VALUES (i.id, p_workspace_id, p_entity_type, p_entity_id, 'created')
  ON CONFLICT (import_id, entity_type, entity_id) DO NOTHING;
  RETURN public.imports__summary(i);
END;
$$;

CREATE OR REPLACE FUNCTION public.imports_op_finish(p_workspace_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.imports;
BEGIN
  i := public.imports__own(p_workspace_id, p_import_id);
  IF i.finished_at IS NULL THEN
    UPDATE public.imports x SET finished_at = now() WHERE x.id = i.id RETURNING * INTO i;
  END IF;
  RETURN public.imports__summary(i);
END;
$$;

-- "Undo this import": what the run made and nobody touched since goes to
-- Recently deleted (tasks first, newest first; then its sections and projects
-- left empty). What was edited since, or that the caller can no longer edit,
-- stays. Rows the run only updated stay as they are.
CREATE OR REPLACE FUNCTION public.imports_op_undo(p_workspace_id uuid, p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  i public.imports;
  r public.import_rows;
  x public.tasks;
  v_removed integer := 0;
  v_kept integer := 0;
  v_projects_removed integer := 0;
  v_projects_kept integer := 0;
  v_sections_removed integer := 0;
  v_sections_kept integer := 0;
  v_project uuid;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  i := public.imports__own(p_workspace_id, p_import_id);
  IF i.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'This import was already undone.' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT * FROM public.import_rows y
    WHERE y.import_id = i.id AND y.entity_type = 'task' AND y.action = 'created'
    ORDER BY y.logged_at DESC, y.id DESC
  LOOP
    SELECT * INTO x FROM public.tasks t WHERE t.id = r.entity_id;
    CONTINUE WHEN NOT FOUND OR x.deleted_at IS NOT NULL OR NOT public.tasks__visible_to(x.id, v_actor);
    -- Touched since: anything logged on it after the run wrote it (the run's
    -- own writes share its transaction's time).
    IF EXISTS (SELECT 1 FROM public.module_activity a
               WHERE a.workspace_id = p_workspace_id AND a.entity_type = 'task'
                 AND a.entity_id = x.id AND a.created_at > r.logged_at)
       OR NOT public.tasks__editable_to(x.id, v_actor) THEN
      v_kept := v_kept + 1;
      CONTINUE;
    END IF;
    PERFORM public.tasks_op_update(p_workspace_id, x.id, jsonb_build_object('deleted_at', now()));
    v_removed := v_removed + 1;
  END LOOP;

  FOR r IN
    SELECT * FROM public.import_rows y
    WHERE y.import_id = i.id AND y.entity_type = 'section'
    ORDER BY y.logged_at DESC, y.id DESC
  LOOP
    SELECT s.project_id INTO v_project FROM public.sections s
    WHERE s.id = r.entity_id AND s.deleted_at IS NULL;
    CONTINUE WHEN v_project IS NULL OR NOT public.projects__visible_to(v_project, v_actor);
    IF EXISTS (SELECT 1 FROM public.tasks t WHERE t.section_id = r.entity_id AND t.deleted_at IS NULL)
       OR NOT public.projects__editable_to(v_project, v_actor) THEN
      v_sections_kept := v_sections_kept + 1;
      CONTINUE;
    END IF;
    PERFORM public.sections_op_update(p_workspace_id, r.entity_id, jsonb_build_object('deleted_at', now()));
    v_sections_removed := v_sections_removed + 1;
  END LOOP;

  FOR r IN
    SELECT * FROM public.import_rows y
    WHERE y.import_id = i.id AND y.entity_type = 'bucket'
    ORDER BY y.logged_at DESC, y.id DESC
  LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = r.entity_id AND b.deleted_at IS NULL)
               OR NOT public.projects__visible_to(r.entity_id, v_actor);
    IF EXISTS (SELECT 1 FROM public.tasks t WHERE t.bucket_id = r.entity_id AND t.deleted_at IS NULL)
       OR NOT public.can_access('bucket', r.entity_id, 'full', v_actor) THEN
      v_projects_kept := v_projects_kept + 1;
      CONTINUE;
    END IF;
    PERFORM public.projects_op_delete(p_workspace_id, r.entity_id);
    v_projects_removed := v_projects_removed + 1;
  END LOOP;

  UPDATE public.imports y SET undone_at = now(), finished_at = coalesce(y.finished_at, now())
  WHERE y.id = i.id RETURNING * INTO i;
  RETURN public.imports__summary(i) || jsonb_build_object(
    'tasks_removed', v_removed, 'tasks_kept', v_kept,
    'sections_removed', v_sections_removed, 'sections_kept', v_sections_kept,
    'projects_removed', v_projects_removed, 'projects_kept', v_projects_kept);
END;
$$;

-- ── 5b. The notice gate takes the agent's notice ─────────────────────────────

-- The gate narrows a notice's recipients to people who can see what it hangs
-- on. A notice that hangs on someone's Inbox but names a task in its payload
-- (an agent's state, a team notice) now also needs its reader to see that
-- task. Both re-cut by anchored replace on the live definitions (TV-D13's
-- note: extend the list, never paste an older copy).
DO $gate$
DECLARE
  v_def text := pg_get_functiondef('public.module_activity__gate_recipients()'::regprocedure);
  v_old text := 'AND public.spine__visible_to(NEW.workspace_id, NEW.entity_type, NEW.entity_id, public.tasks__try_uuid(u));';
  v_new text := 'AND public.spine__visible_to(NEW.workspace_id, NEW.entity_type, NEW.entity_id, public.tasks__try_uuid(u))'
    || E'\n      -- TV-D16: and the task it names, when it names one.'
    || E'\n      AND (public.tasks__try_uuid(NEW.payload ->> ''task_id'') IS NULL'
    || E'\n           OR public.tasks__visible_to(public.tasks__try_uuid(NEW.payload ->> ''task_id''), public.tasks__try_uuid(u)));';
  v_trigger text;
BEGIN
  IF position('TV-D16: and the task it names' IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'module_activity__gate_recipients isn''t the body this migration expects; redefine it by hand.';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;

  SELECT pg_get_triggerdef(t.oid) INTO v_trigger FROM pg_trigger t
  WHERE t.tgrelid = 'public.module_activity'::regclass AND t.tgname = 'module_activity_gate_recipients';
  IF v_trigger IS NULL OR (position('''comments.team_mention''::text]' IN v_trigger) = 0
                           AND position('''tasks.agent_status''' IN v_trigger) = 0) THEN
    RAISE EXCEPTION 'module_activity_gate_recipients isn''t the trigger this migration expects; recreate it by hand.';
  END IF;
  IF position('''tasks.agent_status''' IN v_trigger) = 0 THEN
    DROP TRIGGER module_activity_gate_recipients ON public.module_activity;
    EXECUTE replace(v_trigger, '''comments.team_mention''::text]',
                    '''comments.team_mention''::text, ''tasks.agent_status''::text]');
  END IF;
END;
$gate$;

-- ── 6. Account erasure covers the new tables (§Assumptions #26) ─────────────

DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
BEGIN
  IF position('agent_sessions' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position('v_reminders integer;' IN v_def) = 0
     OR position('''task_reminders_deleted'', v_reminders,' IN v_def) = 0
     OR position('SELECT count(*) INTO v_reminders' IN v_def) = 0
     OR position('DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_new := replace(v_def, 'v_reminders integer;',
    'v_reminders integer;' || E'\n  v_agent_sessions integer;' || E'\n  v_imports integer;');
  v_new := replace(v_new, 'SELECT count(*) INTO v_reminders',
    'SELECT count(*) INTO v_agent_sessions'
    || E'\n  FROM public.agent_sessions x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  SELECT count(*) INTO v_imports'
    || E'\n  FROM public.imports x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  SELECT count(*) INTO v_reminders');
  v_new := replace(v_new, '''task_reminders_deleted'', v_reminders,',
    '''task_reminders_deleted'', v_reminders,'
    || E'\n    ''agent_sessions_deleted'', v_agent_sessions,'
    || E'\n    ''imports_deleted'', v_imports,');
  -- TV-D16: their agent sessions (and summaries) and their import runs, in
  -- workspaces they don't own (what the runs made stays).
  v_new := replace(v_new,
    'DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);',
    'DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  DELETE FROM public.agent_sessions x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  DELETE FROM public.imports x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);');
  EXECUTE v_new;
END;
$erase$;

-- ── 7. Grants ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Server-only helpers.
  FOREACH fn IN ARRAY ARRAY[
    'agent_sessions__shown_to(uuid, uuid, uuid)', 'agent_sessions__links(jsonb)',
    'agent_sessions__key_revoked()', 'imports__own(uuid, uuid)', 'imports__summary(public.imports)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- The ops and reads: people (the app) and keys (the connector).
  FOREACH fn IN ARRAY ARRAY[
    'agent_sessions__shown(uuid, uuid)',
    'tasks_op_agent_report(uuid, uuid, jsonb)', 'tasks_agent_sessions(uuid, uuid)',
    'tasks_op_agent_session_post(uuid, uuid)', 'tasks_op_agent_session_dismiss(uuid, uuid)',
    'user_agent_work()', 'user_op_set_agent_work(boolean)',
    'tasks_op_tag(uuid, uuid, text[], text[])',
    'imports_op_begin(uuid, text, text)', 'imports_op_note(uuid, uuid, text, uuid)',
    'imports_op_finish(uuid, uuid)', 'imports_op_undo(uuid, uuid)',
    'tasks_op_create_with(uuid, jsonb, jsonb)', 'tasks_op_update_with(uuid, uuid, jsonb, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;
