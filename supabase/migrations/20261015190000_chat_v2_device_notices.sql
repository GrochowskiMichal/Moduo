-- Chat v2 · CV-6a Device notices, server side (specs/chat-v2.md §11; §Assumptions
-- #7, #29, #31; .design/chat-v2/research/round-3-database.md §2.14 b, d, e, g).
-- The stamp is provisional: re-cut on the day it applies; it must stay after
-- …_chat_v2_catchup (CV-5), whose fan-out it extends. It runs again cleanly
-- over itself.
--
-- Prod order: email-worker with the chat_waiting template deploys BEFORE this
-- migration (TX-3's rule: a kind the worker can't render waits and retries).
--
-- What it does:
--   1. Device notices for chat. The fan-out (chat__fan_out) now writes, per
--      reason and in the same statement for all its people, one
--      notice_deliveries row each, through the gate (notice__gate: send · hold
--      · drop; it answers send until CV-18 gives it rules):
--        a direct message, an Every-message line ... chat_message
--        @you, @Team, @channel ...................... chat_mention
--        a reply in a chain you're in ............... chat_reply
--        a post in an announcement channel .......... chat_announcement
--      (chat_reminder and chat_focus_summary are kinds now; their writers are
--      CV-11 and CV-18.) Nobody on Nothing gets one; nobody who can't read the
--      conversation (outside the workspace, without chat access, not in a
--      private one) is ever reached, because the fan-out only lists readers.
--      Title, text and link are built here, for that one person, from what
--      they can read now: "Sofia Ortiz · #plans · Acme" (a direct message:
--      "Sofia Ortiz · Acme"); the text only while they keep "Show message
--      text" on, with references drawn as names they can see, else "Private
--      item"; a burst on one tag reads "3 messages: …"; the link is
--      /chat?c=<conversation>&m=<message>. tag = chat:<conversation> (a chain
--      adds :<its first message>), push_after = written + 8 s.
--   2. Push at once: a statement trigger kicks push-send when a chat row
--      arrives for someone with a browser (Vault-gated, as before; never fails
--      a send). The claim (from its live body) takes only rows past their
--      push_after, not acknowledged, not held for Focus, not replaced by a
--      newer row on the same tag, and still readable by their person (the
--      conversation and the message); notice_deliveries__next_due tells
--      push-send how long to wait for the rest (≤ 10 s). The kick's own check
--      skips rows the claim would never take.
--   3. A notice row is readable by its person only while they can still read
--      what it's about (the conversation, a message not deleted).
--   4. One device rings: user_clients (client-minted id, surface, last seen,
--      last active, user agent from the request), own rows only;
--      user_op_client_seen(client_id, surface, active) stamps it from the
--      session and says whether this client is the latest active one;
--      notice_op_ack(ids) acknowledges your own rows. Twenty clients per
--      person, unseen ones go after 30 days.
--   5. Prefs: reaction_row, show_online, show_focus_task, notice_show_text,
--      email_when_away on user_preferences, op-only (a guard like Time &
--      region's): user_op_set_chat_prefs(patch) and user_chat_prefs().
--   6. The email after an hour: chat__queue_waiting_emails() every 5 minutes
--      queues chat_waiting through email_enqueue for an open dm / mention /
--      team_mention item over an hour old, not held, not emailed, for people
--      who keep "Email when away" on and whose every known client has been
--      quiet for an hour; one email per person, conversation and hour, which
--      covers the conversation's waiting items and stamps them emailed_at.
--   7. Account erasure counts and deletes user_clients (they also cascade from
--      profiles).
--
-- Every redefined function starts from its live body (2026-10-15). Grants are
-- re-stated by name at the end.

SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.recut(p_fn regprocedure, p_old text, p_new text)
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

-- ── 1. notice_deliveries: chat kinds and columns ───────────────────────────

ALTER TABLE public.notice_deliveries
  ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tag text,
  ADD COLUMN IF NOT EXISTS push_after timestamptz,
  ADD COLUMN IF NOT EXISTS acked_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_for_focus boolean NOT NULL DEFAULT false;

ALTER TABLE public.notice_deliveries DROP CONSTRAINT IF EXISTS notice_deliveries_tag_check;
ALTER TABLE public.notice_deliveries
  ADD CONSTRAINT notice_deliveries_tag_check CHECK (tag IS NULL OR char_length(tag) BETWEEN 1 AND 120);
ALTER TABLE public.notice_deliveries DROP CONSTRAINT IF EXISTS notice_deliveries_kind_check;
ALTER TABLE public.notice_deliveries
  ADD CONSTRAINT notice_deliveries_kind_check CHECK (kind IN ('reminder', 'agent', 'chat_message', 'chat_mention', 'chat_reply', 'chat_announcement', 'chat_reminder', 'chat_focus_summary'));

-- What push-send waits for, the burst count per tag, and the cascades.
CREATE INDEX IF NOT EXISTS notice_deliveries_due
  ON public.notice_deliveries (push_after) WHERE pushed_at IS NULL AND acked_at IS NULL;
CREATE INDEX IF NOT EXISTS notice_deliveries_tag
  ON public.notice_deliveries (user_id, tag, created_at DESC) WHERE tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS notice_deliveries_channel
  ON public.notice_deliveries (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notice_deliveries_message
  ON public.notice_deliveries (message_id) WHERE message_id IS NOT NULL;

-- A chat notice carries words, so its person reads it only while they can
-- read the conversation and the message is still there (the caller only).
CREATE OR REPLACE FUNCTION public.notice_deliveries__chat_visible(p_channel_id uuid, p_message_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT (p_channel_id IS NULL OR public.chat__can_read_channel_as(p_channel_id, auth.uid()))
     AND (p_message_id IS NULL OR EXISTS (
           SELECT 1 FROM public.chat_messages m
            WHERE m.id = p_message_id AND m.deleted_at IS NULL
              AND public.chat__can_read_channel_as(m.channel_id, auth.uid())))
$function$;

DROP POLICY IF EXISTS notice_deliveries_own_read ON public.notice_deliveries;
CREATE POLICY notice_deliveries_own_read ON public.notice_deliveries
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         AND (task_id IS NULL OR public.tasks__visible(task_id))
         AND ((channel_id IS NULL AND message_id IS NULL)
              OR public.notice_deliveries__chat_visible(channel_id, message_id)));
-- People read; only the server writes (acknowledging is notice_op_ack).
REVOKE ALL ON public.notice_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notice_deliveries TO authenticated;
GRANT ALL ON public.notice_deliveries TO service_role;

-- ── 2. user_clients: which of your apps and tabs is open ───────────────────

CREATE TABLE IF NOT EXISTS public.user_clients (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface IN ('desktop', 'web')),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_clients_user ON public.user_clients (user_id, last_seen_at DESC);

ALTER TABLE public.user_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_clients_own_read ON public.user_clients;
CREATE POLICY user_clients_own_read ON public.user_clients
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_clients_own_delete ON public.user_clients;
CREATE POLICY user_clients_own_delete ON public.user_clients
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.user_clients FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.user_clients TO authenticated;
GRANT ALL ON public.user_clients TO service_role;

-- ── 3. Chat prefs on user_preferences (op-only, like Time & region) ───────

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS reaction_row text[],
  ADD COLUMN IF NOT EXISTS show_online boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_focus_task boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notice_show_text boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_when_away boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_preferences DROP CONSTRAINT IF EXISTS user_preferences_reaction_row_check;
ALTER TABLE public.user_preferences
  ADD CONSTRAINT user_preferences_reaction_row_check
  CHECK (reaction_row IS NULL OR (cardinality(reaction_row) <= 6 AND array_position(reaction_row, NULL) IS NULL));

-- Direct writes keep these as they were; user_op_set_chat_prefs changes them.
CREATE OR REPLACE FUNCTION public.user_preferences__chat_prefs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.reaction_row := NULL;
    NEW.show_online := true;
    NEW.show_focus_task := false;
    NEW.notice_show_text := true;
    NEW.email_when_away := true;
  ELSE
    NEW.reaction_row := OLD.reaction_row;
    NEW.show_online := OLD.show_online;
    NEW.show_focus_task := OLD.show_focus_task;
    NEW.notice_show_text := OLD.notice_show_text;
    NEW.email_when_away := OLD.email_when_away;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS user_preferences__chat_prefs_guard ON public.user_preferences;
CREATE TRIGGER user_preferences__chat_prefs_guard
  BEFORE INSERT OR UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.user_preferences__chat_prefs_guard();

CREATE OR REPLACE FUNCTION public.user_chat_prefs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'reaction_row', to_jsonb(up.reaction_row),
    'show_online', coalesce(up.show_online, true),
    'show_focus_task', coalesce(up.show_focus_task, false),
    'notice_show_text', coalesce(up.notice_show_text, true),
    'email_when_away', coalesce(up.email_when_away, true))
    FROM (SELECT auth.uid() AS uid) me
    LEFT JOIN public.user_preferences up ON up.user_id = me.uid
   WHERE me.uid IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION public.user_op_set_chat_prefs(p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_key text;
  v_row text[];
  v_item text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Send the settings to change.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('reaction_row', 'show_online', 'show_focus_task', 'notice_show_text', 'email_when_away') THEN
      RAISE EXCEPTION 'Unknown setting: %', v_key USING ERRCODE = '22023';
    END IF;
    IF v_key <> 'reaction_row' AND jsonb_typeof(p_patch -> v_key) <> 'boolean' THEN
      RAISE EXCEPTION '% is on or off.', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Your quick reactions: null is Moduo's six; at most six, each once. A key
  -- is an emoji as Emojibase writes it (CV-7c's reactions__key_ok narrows it).
  IF p_patch ? 'reaction_row' AND jsonb_typeof(p_patch -> 'reaction_row') <> 'null' THEN
    IF jsonb_typeof(p_patch -> 'reaction_row') <> 'array'
       OR jsonb_array_length(p_patch -> 'reaction_row') > 6 THEN
      RAISE EXCEPTION 'Pick up to six reactions.' USING ERRCODE = '22023';
    END IF;
    v_row := '{}'::text[];
    FOR v_item IN SELECT e FROM jsonb_array_elements(p_patch -> 'reaction_row') AS x(e) LOOP
      IF jsonb_typeof(v_item::jsonb) <> 'string' THEN
        RAISE EXCEPTION 'A reaction is an emoji.' USING ERRCODE = '22023';
      END IF;
      v_item := v_item::jsonb #>> '{}';
      IF char_length(v_item) NOT BETWEEN 1 AND 32 OR v_item ~ '[[:alnum:][:space:][:cntrl:]]' THEN
        RAISE EXCEPTION 'A reaction is an emoji.' USING ERRCODE = '22023';
      END IF;
      IF v_item = ANY (v_row) THEN
        RAISE EXCEPTION 'Each reaction once.' USING ERRCODE = '22023';
      END IF;
      v_row := v_row || v_item;
    END LOOP;
  END IF;

  INSERT INTO public.user_preferences (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_preferences p SET
    reaction_row = CASE WHEN p_patch ? 'reaction_row' THEN v_row ELSE p.reaction_row END,
    show_online = coalesce((p_patch ->> 'show_online')::boolean, p.show_online),
    show_focus_task = coalesce((p_patch ->> 'show_focus_task')::boolean, p.show_focus_task),
    notice_show_text = coalesce((p_patch ->> 'notice_show_text')::boolean, p.notice_show_text),
    email_when_away = coalesce((p_patch ->> 'email_when_away')::boolean, p.email_when_away)
  WHERE p.user_id = v_user;
  RETURN public.user_chat_prefs();
END;
$function$;

-- ── 4. The gate: send · hold · drop (rules arrive with CV-18) ──────────────

CREATE OR REPLACE FUNCTION public.notice__gate(p_user uuid, p_workspace_id uuid, p_kind text, p_at timestamptz)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT 'send'::text
$function$;

-- ── 5. What a notice says, built for one person ────────────────────────────

-- Who sent it: the person's name, or the app's (a key's post).
CREATE OR REPLACE FUNCTION public.chat__sender_label(p_msg public.chat_messages, p_actor uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT left(coalesce(
    CASE WHEN p_actor IS NOT NULL THEN
      (SELECT nullif(btrim(p.display_name), '') FROM public.profiles p WHERE p.id = p_actor) END,
    CASE WHEN p_actor IS NULL THEN nullif(btrim(p_msg.author_label), '') END,
    'Someone'), 80)
$function$;

-- One reference as this person may see it: a person or team of the workspace
-- by name, a date as written, an item by its title while they can see it,
-- anything else "Private item".
CREATE OR REPLACE FUNCTION public.chat__notice_ref(p_workspace_id uuid, p_type text, p_id uuid, p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text;
BEGIN
  IF p_type = 'person' THEN
    SELECT '@' || nullif(btrim(p.display_name), '') INTO v
      FROM public.profiles p
     WHERE p.id = p_id
       AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                     WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_id)
            OR EXISTS (SELECT 1 FROM public.workspaces w
                        WHERE w.id = p_workspace_id AND w.owner_id = p_id));
  ELSIF p_type = 'team' THEN
    SELECT '@' || nullif(btrim(t.name), '') INTO v
      FROM public.teams t
     WHERE t.id = p_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL;
  ELSIF p_type = 'task' THEN
    IF public.tasks__visible_to(p_id, p_user) THEN
      SELECT nullif(btrim(t.title), '') INTO v FROM public.tasks t
       WHERE t.id = p_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL;
    END IF;
  ELSIF p_type = 'note' THEN
    IF public.spine__visible_to(p_workspace_id, 'note', p_id, p_user) THEN
      SELECT nullif(btrim(n.title), '') INTO v FROM public.notes n
       WHERE n.id = p_id AND n.workspace_id = p_workspace_id AND n.deleted_at IS NULL;
    END IF;
  ELSIF p_type = 'chat_channel' THEN
    IF public.spine__visible_to(p_workspace_id, 'chat_channel', p_id, p_user) THEN
      SELECT '#' || nullif(btrim(c.name), '') INTO v FROM public.chat_channels c WHERE c.id = p_id;
    END IF;
  END IF;
  RETURN left(coalesce(v, 'Private item'), 80);
END;
$function$;

-- A message's stored Markdown as one plain line for a notice, references
-- drawn for p_user. At most 200 characters.
CREATE OR REPLACE FUNCTION public.chat__notice_text(p_body text, p_workspace_id uuid, p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_src text := left(coalesce(p_body, ''), 4000);
  v_out text := '';
  v_names text[] := '{}'::text[];
  m text[];
  v_pos int;
  i int;
BEGIN
  -- 1. References become placeholders (an escaped "moduo\://" is text, not a reference).
  LOOP
    m := regexp_match(v_src, '^(.*?)moduo://(?:date/([0-9]{4}-[0-9]{2}-[0-9]{2})|([a-z][a-z_]{0,31})/([0-9a-fA-F-]{36}))(.*)$', 's');
    EXIT WHEN m IS NULL;
    v_out := v_out || m[1] || chr(1) || (cardinality(v_names) + 1) || chr(2);
    v_names := v_names || CASE
      WHEN m[2] IS NOT NULL THEN m[2]
      WHEN m[4] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN public.chat__notice_ref(p_workspace_id, m[3], m[4]::uuid, p_user)
      ELSE 'Private item' END;
    v_src := m[5];
    EXIT WHEN cardinality(v_names) >= 50;
  END LOOP;
  v_out := v_out || v_src;

  -- 2. The Markdown subset as plain words: links keep their text, marks go,
  --    escapes unescape, lines join.
  v_out := regexp_replace(v_out, '\[([^\]]*)\]\([^)]*\)', '\1', 'g');
  v_out := regexp_replace(v_out, '(^|\n)[ ]{0,3}(>[ ]?|[-*+][ ]|[0-9]{1,9}[.)][ ]|```[^\n]*)', '\1', 'g');
  v_out := regexp_replace(v_out, '(?<!\\)(\*\*|__|~~|[*_`~])', '', 'g');
  v_out := regexp_replace(v_out, '\\([^A-Za-z0-9[:space:]])', '\1', 'g');
  v_out := regexp_replace(v_out, '[[:space:]]+', ' ', 'g');

  -- 3. The names go in.
  FOR i IN 1 .. cardinality(v_names) LOOP
    v_out := replace(v_out, chr(1) || i || chr(2), v_names[i]);
  END LOOP;
  v_out := btrim(v_out);
  IF char_length(v_out) > 200 THEN
    v_out := left(v_out, 199) || '…';
  END IF;
  RETURN nullif(v_out, '');
END;
$function$;

-- Writes the device notices for one reason's people (from the fan-out).
CREATE OR REPLACE FUNCTION public.chat__notify_devices(
  p_channel public.chat_channels,
  p_msg public.chat_messages,
  p_actor uuid,
  p_reason text,
  p_users uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text := CASE p_reason
    WHEN 'dm' THEN 'chat_message'
    WHEN 'every_message' THEN 'chat_message'
    WHEN 'mention' THEN 'chat_mention'
    WHEN 'team_mention' THEN 'chat_mention'
    WHEN 'everyone' THEN 'chat_mention'
    WHEN 'reply' THEN 'chat_reply'
    WHEN 'announcement' THEN 'chat_announcement' END;
  v_now timestamptz := now();
  v_tag text;
  v_title text;
  v_url text;
BEGIN
  IF v_kind IS NULL OR cardinality(coalesce(p_users, '{}'::uuid[])) = 0 THEN
    RETURN;
  END IF;
  v_tag := 'chat:' || p_channel.id
           || CASE WHEN p_reason = 'reply' AND p_msg.parent_id IS NOT NULL THEN ':' || p_msg.parent_id ELSE '' END;
  v_title := left(public.chat__sender_label(p_msg, p_actor)
                  || CASE WHEN p_channel.kind <> 'dm' AND nullif(btrim(p_channel.name), '') IS NOT NULL
                          THEN ' · #' || left(btrim(p_channel.name), 80) ELSE '' END
                  || coalesce(' · ' || (SELECT left(nullif(btrim(w.name), ''), 80)
                                          FROM public.workspaces w WHERE w.id = p_channel.workspace_id), ''),
                  300);
  v_url := '/chat?c=' || p_channel.id || '&m=' || p_msg.id;

  -- One statement for everyone, so the kick runs once.
  INSERT INTO public.notice_deliveries
    (user_id, workspace_id, kind, title, body, url, channel_id, message_id, tag, push_after, held_for_focus)
  SELECT x.u, p_channel.workspace_id, v_kind, v_title,
         left(CASE WHEN x.burst > 1
                   THEN x.burst || ' messages' || coalesce(': ' || x.words, '')
                   ELSE x.words END, 500),
         v_url, p_channel.id, p_msg.id, v_tag, v_now + interval '8 seconds', x.gate = 'hold'
    FROM (
      SELECT g.u, g.gate,
             CASE WHEN coalesce(up.notice_show_text, true)
                  THEN public.chat__notice_text(p_msg.body, p_channel.workspace_id, g.u) END AS words,
             1 + (SELECT count(*) FROM public.notice_deliveries d
                   WHERE d.user_id = g.u AND d.tag = v_tag AND d.acked_at IS NULL
                     AND d.created_at > v_now - interval '10 minutes') AS burst
        FROM (SELECT DISTINCT u, public.notice__gate(u, p_channel.workspace_id, v_kind, v_now) AS gate
                FROM unnest(p_users) AS u) g
        LEFT JOIN public.user_preferences up ON up.user_id = g.u
        LEFT JOIN public.chat_members mem
          ON mem.channel_id = p_channel.id AND mem.user_id = g.u AND mem.left_at IS NULL
       WHERE g.u IS NOT NULL AND g.u IS DISTINCT FROM p_actor
         AND g.gate IN ('send', 'hold')
         -- Nothing: Catch up only, no notice (CH40).
         AND coalesce(mem.notify_level, 'mentions') <> 'none'
         AND public.chat__can_read_channel_as(p_channel.id, g.u)
    ) x;
END;
$function$;

-- The fan-out (CV-5) ends each reason with its device notices.
SELECT pg_temp.recut(
  'public.chat__fan_out(public.chat_messages, public.chat_channels, uuid, public.chat_messages)'::regprocedure,
  E'      ON CONFLICT (user_id, message_id, reason) WHERE message_id IS NOT NULL DO NOTHING;\n    END IF;\n  END LOOP;\nEND;',
  E'      ON CONFLICT (user_id, message_id, reason) WHERE message_id IS NOT NULL DO NOTHING;\n    END IF;\n    -- Their devices (CV-6a), through the gate.\n    PERFORM public.chat__notify_devices(p_channel, p_msg, p_actor, v_reason, v_users);\n  END LOOP;\nEND;');

-- ── 6. Push at once ─────────────────────────────────────────────────────────

-- The kick (live body): only when something is left that the claim would take
-- now or within its wait.
SELECT pg_temp.recut('public.notice_deliveries__kick()'::regprocedure,
  E'    WHERE d.pushed_at IS NULL AND d.push_attempts < 5 AND d.created_at > now() - interval ''1 day''\n      AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = d.user_id)) THEN',
  E'    WHERE d.pushed_at IS NULL AND d.push_attempts < 5 AND d.created_at > now() - interval ''1 day''\n      AND d.acked_at IS NULL AND NOT d.held_for_focus\n      AND (d.tag IS NULL OR NOT EXISTS (SELECT 1 FROM public.notice_deliveries n\n                                         WHERE n.user_id = d.user_id AND n.tag = d.tag AND n.created_at > d.created_at))\n      AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = d.user_id)) THEN');

-- A chat notice for someone with a browser kicks push-send from the write.
-- Never fails the write that made it.
CREATE OR REPLACE FUNCTION public.notice_deliveries__kick_now()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM new_rows n
              WHERE n.kind LIKE 'chat\_%' AND NOT n.held_for_focus
                AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = n.user_id)) THEN
    BEGIN
      PERFORM public.notice_deliveries__kick();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notice_deliveries__kick_now: %', SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS notice_deliveries_kick_now ON public.notice_deliveries;
CREATE TRIGGER notice_deliveries_kick_now
  AFTER INSERT ON public.notice_deliveries
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notice_deliveries__kick_now();

-- The claim (live body, TV-D16 + TV-D10-fix): past push_after, not
-- acknowledged, not held, not replaced on its tag, still readable.
DROP FUNCTION IF EXISTS public.notice_deliveries__claim(integer);
CREATE FUNCTION public.notice_deliveries__claim(p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, user_id uuid, kind text, title text, body text, url text, task_id uuid, tag text, subscriptions jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT d.id FROM public.notice_deliveries d
    WHERE d.pushed_at IS NULL AND d.push_attempts < 5 AND d.created_at > now() - interval '1 day'
      AND (d.push_after IS NULL OR d.push_after <= now())
      AND d.acked_at IS NULL AND NOT d.held_for_focus
      AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = d.user_id)
      -- Still theirs to see at send time (TV-D10-fix; chat: the conversation
      -- and the message).
      AND (d.task_id IS NULL OR public.tasks__visible_to(d.task_id, d.user_id))
      AND (d.channel_id IS NULL OR public.chat__can_read_channel_as(d.channel_id, d.user_id))
      AND (d.message_id IS NULL OR EXISTS (SELECT 1 FROM public.chat_messages m
                                            WHERE m.id = d.message_id AND m.deleted_at IS NULL))
      -- A newer notice on the same tag replaces this one (a burst).
      AND (d.tag IS NULL OR NOT EXISTS (SELECT 1 FROM public.notice_deliveries n
                                         WHERE n.user_id = d.user_id AND n.tag = d.tag
                                           AND n.created_at > d.created_at))
    ORDER BY d.created_at
    LIMIT greatest(least(coalesce(p_limit, 100), 500), 1)
    FOR UPDATE OF d SKIP LOCKED
  ), bumped AS (
    UPDATE public.notice_deliveries d SET push_attempts = d.push_attempts + 1
    FROM picked WHERE d.id = picked.id
    RETURNING d.*
  )
  SELECT b.id, b.user_id, b.kind, b.title, b.body, b.url, b.task_id, b.tag,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
          FROM public.push_subscriptions s WHERE s.user_id = b.user_id)
  FROM bumped b;
END;
$function$;

-- How long push-send should wait for the next notice inside its hold, in
-- milliseconds; null when none is due within 10 s.
CREATE OR REPLACE FUNCTION public.notice_deliveries__next_due()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT ceil(greatest(0, extract(epoch FROM min(d.push_after) - now())) * 1000)::integer
    FROM public.notice_deliveries d
   WHERE d.pushed_at IS NULL AND d.acked_at IS NULL AND NOT d.held_for_focus
     AND d.push_attempts < 5
     AND d.push_after > now() AND d.push_after <= now() + interval '10 seconds'
     AND EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = d.user_id)
$function$;

-- ── 7. One device rings: seen and acknowledged ─────────────────────────────

CREATE OR REPLACE FUNCTION public.user_op_client_seen(p_client_id uuid, p_surface text, p_active boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_headers jsonb;
  v_agent text;
  v_row public.user_clients;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Send this app''s id.' USING ERRCODE = '22023';
  END IF;
  IF p_surface IS NULL OR p_surface NOT IN ('desktop', 'web') THEN
    RAISE EXCEPTION 'Unknown surface.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;
  v_agent := left(nullif(btrim(v_headers ->> 'user-agent'), ''), 300);

  INSERT INTO public.user_clients AS c (id, user_id, surface, user_agent, last_seen_at, last_active_at)
  VALUES (p_client_id, v_user, p_surface, v_agent, now(), CASE WHEN coalesce(p_active, false) THEN now() END)
  ON CONFLICT (id) DO UPDATE
    SET surface = EXCLUDED.surface,
        user_agent = coalesce(EXCLUDED.user_agent, c.user_agent),
        last_seen_at = now(),
        last_active_at = CASE WHEN coalesce(p_active, false) THEN now() ELSE c.last_active_at END
    WHERE c.user_id = v_user
  RETURNING c.* INTO v_row;
  IF v_row.id IS NULL THEN
    -- Another person's app minted the same id: this app mints a new one.
    RAISE EXCEPTION 'Unknown client.' USING ERRCODE = '22023';
  END IF;

  -- Twenty apps and tabs per person; the longest unseen go.
  DELETE FROM public.user_clients c
   WHERE c.user_id = v_user
     AND c.id IN (SELECT o.id FROM public.user_clients o WHERE o.user_id = v_user
                   ORDER BY o.last_seen_at DESC, o.id OFFSET 20);

  RETURN jsonb_build_object(
    'id', v_row.id,
    'surface', v_row.surface,
    'last_seen_at', v_row.last_seen_at,
    'last_active_at', v_row.last_active_at,
    -- The one that rings: the most recently active of the apps still open.
    'latest', v_row.last_active_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.user_clients o
       WHERE o.user_id = v_user AND o.id <> v_row.id
         AND o.last_seen_at > now() - interval '3 minutes'
         AND o.last_active_at > v_row.last_active_at));
END;
$function$;

CREATE OR REPLACE FUNCTION public.notice_op_ack(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_n integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(coalesce(p_ids, '{}'::uuid[])) > 1000 THEN
    RAISE EXCEPTION 'At most 1,000 notices at a time.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.notice_deliveries d SET acked_at = now()
   WHERE d.user_id = v_user AND d.id = ANY (coalesce(p_ids, '{}'::uuid[])) AND d.acked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_clients__purge()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.user_clients c WHERE c.last_seen_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- ── 8. The email after an hour away ─────────────────────────────────────────

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_kind_check CHECK (kind IN ('auth_code','account_deleted','waitlist_invite','updates_confirm','workspace_invite','workspace_owner','workspace_removed','booking_guest_confirmed','booking_guest_added','booking_host_new','booking_host_guest_cancelled','booking_guest_cancelled','booking_guest_host_cancelled','booking_guest_reminder','welcome','trial_ending','trial_ended','founder_access','founder_access_ending','announcement','build_update','ops_alert','chat_waiting'));

-- The job's lookups: open, unemailed items by reason and age; the hour's
-- guard per person and conversation.
CREATE INDEX IF NOT EXISTS chat_catchup_waiting_idx
  ON public.chat_catchup (created_at)
  WHERE reason IN ('dm', 'mention', 'team_mention') AND done_at IS NULL AND emailed_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_catchup_emailed_idx
  ON public.chat_catchup (user_id, channel_id, emailed_at) WHERE emailed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.chat__queue_waiting_emails(p_now timestamptz DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_n integer := 0;
  v_hour text := to_char(date_trunc('hour', p_now AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24');
  v_ids uuid[];
  v_count integer;
  v_msg public.chat_messages;
  v_channel public.chat_channels;
  v_show boolean;
  v_text text;
  v_to text;
BEGIN
  FOR r IN
    SELECT DISTINCT k.user_id, k.channel_id, k.workspace_id
      FROM public.chat_catchup k
      JOIN public.chat_messages m ON m.id = k.message_id AND m.deleted_at IS NULL
     WHERE k.reason IN ('dm', 'mention', 'team_mention')
       AND k.done_at IS NULL AND k.emailed_at IS NULL AND k.held_at IS NULL
       AND k.created_at <= p_now - interval '1 hour'
       -- Nothing older than a week (a backlog is for Catch up, not the inbox).
       AND k.created_at > p_now - interval '7 days'
  LOOP
    -- Email when away (on by default).
    CONTINUE WHEN NOT coalesce((SELECT up.email_when_away FROM public.user_preferences up
                                 WHERE up.user_id = r.user_id), true);
    -- Away: we know their apps, and none was seen in the last hour.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.user_clients c WHERE c.user_id = r.user_id);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.user_clients c
                           WHERE c.user_id = r.user_id AND c.last_seen_at > p_now - interval '1 hour');
    -- Not on Nothing (Catch up only, CH40).
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.chat_members mem
                           WHERE mem.channel_id = r.channel_id AND mem.user_id = r.user_id
                             AND mem.left_at IS NULL AND mem.notify_level = 'none');
    -- Still theirs to read, and an address to write to.
    CONTINUE WHEN NOT public.chat__can_read_channel_as(r.channel_id, r.user_id);
    v_to := lower(btrim(coalesce((SELECT u.email FROM auth.users u WHERE u.id = r.user_id), '')));
    CONTINUE WHEN v_to !~ '^[^[:space:]@]+@[^[:space:]@]+$';
    -- One email per person, conversation and hour.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.chat_catchup e
                           WHERE e.user_id = r.user_id AND e.channel_id = r.channel_id
                             AND e.emailed_at > p_now - interval '1 hour');

    -- Everything waiting in that conversation goes in this one email.
    SELECT array_agg(k.id), count(*)
      INTO v_ids, v_count
      FROM public.chat_catchup k
      JOIN public.chat_messages m ON m.id = k.message_id AND m.deleted_at IS NULL
     WHERE k.user_id = r.user_id AND k.channel_id = r.channel_id
       AND k.reason IN ('dm', 'mention', 'team_mention')
       AND k.done_at IS NULL AND k.emailed_at IS NULL AND k.held_at IS NULL
       AND k.created_at > p_now - interval '7 days';
    CONTINUE WHEN coalesce(v_count, 0) = 0;
    SELECT m.* INTO v_msg
      FROM public.chat_catchup k
      JOIN public.chat_messages m ON m.id = k.message_id
     WHERE k.id = ANY (v_ids)
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 1;
    SELECT c.* INTO v_channel FROM public.chat_channels c WHERE c.id = r.channel_id;
    v_show := coalesce((SELECT up.notice_show_text FROM public.user_preferences up
                         WHERE up.user_id = r.user_id), true);
    v_text := CASE WHEN v_show THEN public.chat__notice_text(v_msg.body, r.workspace_id, r.user_id) END;

    PERFORM public.email_enqueue(
      'chat_waiting',
      v_to,
      r.user_id,
      jsonb_build_object(
        'workspace_name', (SELECT left(w.name, 80) FROM public.workspaces w WHERE w.id = r.workspace_id),
        'conversation_kind', CASE WHEN v_channel.kind = 'dm' THEN 'dm' ELSE 'channel' END,
        'conversation_name', CASE WHEN v_channel.kind <> 'dm' THEN left(v_channel.name, 80) END,
        'sender_name', public.chat__sender_label(v_msg, v_msg.author_id),
        'count', v_count,
        'text', v_text,
        'path', '/chat?c=' || r.channel_id || '&m=' || v_msg.id,
        'channel_id', r.channel_id),
      'chat_waiting:' || r.user_id || ':' || r.channel_id || ':' || v_hour,
      p_now);
    UPDATE public.chat_catchup k SET emailed_at = p_now WHERE k.id = ANY (v_ids);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ── 9. Account erasure covers user_clients (#31) ───────────────────────────

DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
BEGIN
  IF position('user_clients' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position('v_deliveries integer;' IN v_def) = 0
     OR position('''notice_deliveries_deleted'', v_deliveries,' IN v_def) = 0
     OR position('DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;' IN v_def) = 0
     OR position('SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;' IN v_def) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_new := replace(v_def, 'v_deliveries integer;', 'v_deliveries integer;' || E'\n  v_user_clients integer;');
  v_new := replace(v_new,
    'SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;',
    'SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;'
    || E'\n  SELECT count(*) INTO v_user_clients FROM public.user_clients x WHERE x.user_id = p_user;');
  v_new := replace(v_new, '''notice_deliveries_deleted'', v_deliveries,',
    '''notice_deliveries_deleted'', v_deliveries,' || E'\n    ''user_clients_deleted'', v_user_clients,');
  -- A person's apps and tabs, in every workspace.
  v_new := replace(v_new,
    'DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;',
    'DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;'
    || E'\n  DELETE FROM public.user_clients x WHERE x.user_id = p_user;');
  EXECUTE v_new;
END;
$erase$;

-- ── 10. Realtime, grants and the schedule ───────────────────────────────────

-- A running app hears its own notices (TV-D12 published the table; re-asserted
-- because the rows now carry chat's words and CV-6b's clients depend on it).
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
    'notice__gate(uuid, uuid, text, timestamptz)',
    'chat__sender_label(public.chat_messages, uuid)',
    'chat__notice_ref(uuid, text, uuid, uuid)',
    'chat__notice_text(text, uuid, uuid)',
    'chat__notify_devices(public.chat_channels, public.chat_messages, uuid, text, uuid[])',
    'chat__fan_out(public.chat_messages, public.chat_channels, uuid, public.chat_messages)',
    'notice_deliveries__kick()',
    'notice_deliveries__kick_now()',
    'notice_deliveries__claim(integer)',
    'notice_deliveries__next_due()',
    'user_clients__purge()',
    'chat__queue_waiting_emails(timestamptz)',
    'user_preferences__chat_prefs_guard()',
    'account_erase_workspace_data(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- People (signed in; keys are refused inside).
  FOREACH fn IN ARRAY ARRAY[
    'user_op_client_seen(uuid, text, boolean)',
    'notice_op_ack(uuid[])',
    'user_op_set_chat_prefs(jsonb)',
    'user_chat_prefs()',
    -- The read policy's check (about the caller only).
    'notice_deliveries__chat_visible(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-waiting-emails') THEN
    PERFORM cron.unschedule('chat-waiting-emails');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'user-clients-purge') THEN
    PERFORM cron.unschedule('user-clients-purge');
  END IF;
END;
$$;
SELECT cron.schedule(
  'chat-waiting-emails',
  '*/5 * * * *',
  $cron$SET statement_timeout = '50s'; SELECT public.chat__queue_waiting_emails(now());$cron$
);
SELECT cron.schedule(
  'user-clients-purge',
  '29 4 * * *',
  $cron$SELECT public.user_clients__purge();$cron$
);

-- ── 11. Assertions ──────────────────────────────────────────────────────────

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.user_clients', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_clients', 'UPDATE')
     OR has_table_privilege('anon', 'public.user_clients', 'SELECT') THEN
    RAISE EXCEPTION 'user_clients grants are wider than this migration states.';
  END IF;
  IF has_function_privilege('authenticated', 'public.notice_deliveries__claim(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__queue_waiting_emails(timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__notify_devices(public.chat_channels, public.chat_messages, uuid, text, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.user_op_client_seen(uuid, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A CV-6a function is callable by a role it shouldn''t be.';
  END IF;
END;
$$;
