-- Chat v2 · CV-5 Addressed to you: Catch up rows and the bell (specs/chat-v2.md
-- §9, §11; §Assumptions #7, #8, #15, #25; .design/chat-v2/research/round-3-
-- database.md §2.14 a–c, §2.15, §2.18). The stamp is provisional: re-cut on the
-- day it applies, after …_chat_v2_conversation_ops (CV-2b) and the chat
-- migrations landed before it. It runs again cleanly over itself.
--
-- What it does:
--   1. The fan-out. chat_op_send, chat_op_edit (only people named for the first
--      time, CH75) and chat_op_agent_post work out, in the same transaction,
--      who a message is addressed to, among people who can read the
--      conversation, never its sender, one reason per person (the first that
--      applies):
--        a direct message ............ dm (no bell row: the bell is for work)
--        named in person ............. mention        bell chat.mention (person)
--        a team of theirs named ...... team_mention   bell chat.mention (team),
--                                      unless they turned their teams' notices off
--        @channel .................... everyone       bell chat.mention (everyone),
--                                      members not on Nothing
--        a post in an announcement
--        channel ..................... announcement   bell chat.announcement,
--                                      members not on Nothing
--        a reply in a chain they're in
--        (wrote its first message,
--        replied, were named in it)
--        or to their own message ..... reply          bell chat.reply, one item
--                                      per chain, unless they stopped following
--        anything else, to members on
--        Every message ............... every_message  no bell, one line per
--                                      conversation (CH73)
--      On Nothing a mention or a team mention is written as an item only: no
--      bell row, no count (CH40); everything else is nothing. Each item's bell
--      row is its twin (chat_catchup.activity_id). A grouped item (a chain, an
--      Every-message line) moves to its newest message; the twin of the reply
--      it pointed at before is dismissed, so the bell keeps one row per chain.
--      held_at stays null until the holds arrive (CV-18); device notices and
--      the email are CV-6a's.
--   2. One state with the bell (§2.15): Done in Catch up dismisses the twin;
--      dismissing in the bell closes the item, undismissing reopens it; reading
--      up to a message closes its items and dismisses their twins (sending
--      counts as reading up to your own message); marking unread reopens what
--      reading closed. The bell's own read dot stays the bell's.
--   3. New ops: chat_op_catchup_done(ids), chat_op_catchup_reopen(ids) (Undo),
--      chat_op_follow_chain(message, following) ("Stop following" closes the
--      chain's open item). They need no plan (#25) and log no activity (#15).
--   4. Counts: chat_unread_counts' catchup is now the conversation's open,
--      showing Catch up items (none on Nothing, none from a chain you stopped
--      following, none for a deleted message, quiet lines never, team
--      mentions not while your teams' notices are off); `addressed` leaves out
--      team mentions while they're off too.
--   5. The bell's recipient guard (module_activity_gate_recipients) covers the
--      three chat ops.
--
-- Every redefined function starts from its live body (2026-10-15). Grants are
-- re-stated and asserted at the end.

SET LOCAL lock_timeout = '5s';

-- ── 1. Indexes: one open item per chain, one open line per conversation ────

CREATE UNIQUE INDEX IF NOT EXISTS chat_catchup_open_chain_uq
  ON public.chat_catchup (user_id, chain_root_id) WHERE reason = 'reply' AND done_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_catchup_open_line_uq
  ON public.chat_catchup (user_id, channel_id) WHERE reason = 'every_message' AND done_at IS NULL;
-- The twin lookups (bell dismiss / undismiss) and the cascades from the bell
-- and the chain's root.
CREATE INDEX IF NOT EXISTS chat_catchup_activity_idx
  ON public.chat_catchup (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_catchup_chain_root_idx
  ON public.chat_catchup (chain_root_id) WHERE chain_root_id IS NOT NULL;

-- ── 2. Helpers (internal) ───────────────────────────────────────────────────

-- "Your teams" off (TV-D13's switch, user_preferences.preferences.notifications.teams).
CREATE OR REPLACE FUNCTION public.chat__team_muted(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce((SELECT (up.preferences -> 'notifications' -> 'teams') = 'false'::jsonb
                     FROM public.user_preferences up WHERE up.user_id = p_user), false)
$function$;

-- One bell row about a message, for the people listed; its id is the twin.
-- Attributed like module_activity_log: the person who sent it, or the key
-- (with its person's name) for an app's post.
CREATE OR REPLACE FUNCTION public.chat__activity(
  p_channel public.chat_channels,
  p_msg public.chat_messages,
  p_actor uuid,
  p_op text,
  p_reason text,
  p_users uuid[],
  p_team_ids uuid[] DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
  v_key uuid;
  v_label text;
  v_person text;
  v_payload jsonb;
BEGIN
  IF cardinality(coalesce(p_users, '{}'::uuid[])) = 0 THEN
    RETURN NULL;
  END IF;
  v_payload := jsonb_build_object(
    'message_id', p_msg.id,
    'parent_id', p_msg.parent_id,
    'reply_to_id', p_msg.reply_to_id,
    'channel_name', p_channel.name,
    'channel_kind', p_channel.kind,
    'excerpt', public.chat__excerpt(p_msg.body),
    'format_version', 2,
    'notify_user_ids', to_jsonb(ARRAY(SELECT DISTINCT u::text FROM unnest(p_users) u ORDER BY 1)));
  IF p_reason IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('reason', p_reason);
  END IF;
  IF cardinality(coalesce(p_team_ids, '{}'::uuid[])) > 0 THEN
    v_payload := v_payload || jsonb_build_object('team_ids', to_jsonb(p_team_ids));
  END IF;

  IF p_actor IS NOT NULL THEN
    INSERT INTO public.module_activity
      (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
    VALUES
      (p_channel.workspace_id, 'chat', 'chat_channel', p_channel.id, p_op, 'user', p_actor,
       (SELECT p.display_name FROM public.profiles p WHERE p.id = p_actor), v_payload)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  v_key := public.module_api_key_id();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'No actor context for activity attribution.';
  END IF;
  SELECT k.name, nullif(btrim(p.display_name), '')
    INTO v_label, v_person
    FROM public.workspace_api_keys k
    LEFT JOIN public.profiles p ON p.id = k.created_by
   WHERE k.id = v_key AND k.workspace_id = p_channel.workspace_id;
  IF v_person IS NOT NULL THEN
    v_label := v_person || ' · via ' || coalesce(nullif(btrim(v_label), ''), 'an API key');
  END IF;
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES
    (p_channel.workspace_id, 'chat', 'chat_channel', p_channel.id, p_op, 'api_key', v_key, v_label, v_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Close a person's open items, and dismiss their twins in the bell.
CREATE OR REPLACE FUNCTION public.chat__close(p_user uuid, p_ids uuid[], p_how text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH closed AS (
    UPDATE public.chat_catchup k
       SET done_at = now(), done_how = p_how
     WHERE k.user_id = p_user AND k.id = ANY (coalesce(p_ids, '{}'::uuid[])) AND k.done_at IS NULL
    RETURNING k.workspace_id, k.activity_id
  ), dismissed AS (
    INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
    SELECT DISTINCT c.workspace_id, p_user, c.activity_id, now()
      FROM closed c WHERE c.activity_id IS NOT NULL
    ON CONFLICT (user_id, activity_id) DO UPDATE
      SET dismissed_at = coalesce(public.notification_state.dismissed_at, EXCLUDED.dismissed_at)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM closed;
  RETURN v_n;
END;
$function$;

-- Reopen a person's closed items (never one closed because access went), and
-- undismiss their twins. A chain or an Every-message line reopens only its
-- newest item, and only while no item of it is open.
CREATE OR REPLACE FUNCTION public.chat__reopen(p_user uuid, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH cand AS (
    SELECT k.id, k.reason, k.channel_id, k.chain_root_id,
           coalesce(m.created_at, k.created_at) AS at, coalesce(m.id, k.id) AS tie
      FROM public.chat_catchup k
      LEFT JOIN public.chat_messages m ON m.id = k.message_id
     WHERE k.user_id = p_user AND k.id = ANY (coalesce(p_ids, '{}'::uuid[]))
       AND k.done_at IS NOT NULL AND k.done_how <> 'closed'
  ), grouped AS (
    SELECT DISTINCT ON (c.reason, coalesce(c.chain_root_id, c.channel_id))
           c.id, c.reason, c.channel_id, c.chain_root_id
      FROM cand c
     WHERE c.reason IN ('reply', 'every_message')
     ORDER BY c.reason, coalesce(c.chain_root_id, c.channel_id), c.at DESC, c.tie DESC
  ), pick AS (
    SELECT c.id FROM cand c WHERE c.reason NOT IN ('reply', 'every_message')
    UNION ALL
    SELECT g.id FROM grouped g
     WHERE NOT EXISTS (
       SELECT 1 FROM public.chat_catchup o
        WHERE o.user_id = p_user AND o.done_at IS NULL AND o.reason = g.reason
          AND CASE WHEN g.reason = 'reply' THEN o.chain_root_id = g.chain_root_id
                   ELSE o.channel_id = g.channel_id END)
  ), opened AS (
    UPDATE public.chat_catchup k
       SET done_at = NULL, done_how = NULL
      FROM pick
     WHERE k.id = pick.id
    RETURNING k.activity_id
  ), shown AS (
    UPDATE public.notification_state ns
       SET dismissed_at = NULL
      FROM opened o
     WHERE ns.user_id = p_user AND ns.activity_id = o.activity_id AND ns.dismissed_at IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM opened;
  RETURN v_n;
END;
$function$;

-- Reading up to a message closes what it brought you (quiet lines and
-- reminders stay: they aren't messages you read).
CREATE OR REPLACE FUNCTION public.chat__close_read(p_user uuid, p_channel_id uuid, p_upto public.chat_messages)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT public.chat__close(p_user, ARRAY(
    SELECT k.id
      FROM public.chat_catchup k
      JOIN public.chat_messages m ON m.id = k.message_id
     WHERE k.user_id = p_user AND k.channel_id = p_channel_id AND k.done_at IS NULL
       AND k.reason IN ('dm', 'mention', 'team_mention', 'everyone', 'reply', 'announcement', 'every_message')
       AND (m.created_at, m.id) <= (p_upto.created_at, p_upto.id)), 'read')
$function$;

-- The fan-out: who a message is addressed to, and why (see the header). On an
-- edit (p_before = the row before it), only people named for the first time.
CREATE OR REPLACE FUNCTION public.chat__fan_out(
  p_msg public.chat_messages,
  p_channel public.chat_channels,
  p_actor uuid,
  p_before public.chat_messages DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_edit boolean := p_before.id IS NOT NULL;
  v_people uuid[] := coalesce(p_msg.mentioned_user_ids, '{}'::uuid[]);
  v_teams uuid[] := coalesce(p_msg.mentioned_team_ids, '{}'::uuid[]);
  v_everyone boolean := coalesce(p_msg.mentions_everyone, false);
  v_who jsonb;
  v_reason text;
  v_users uuid[];
  v_bell uuid[];
  v_activity uuid;
BEGIN
  IF p_msg.id IS NULL OR p_msg.kind <> 'message' OR p_msg.deleted_at IS NOT NULL
     OR p_channel.id IS DISTINCT FROM p_msg.channel_id THEN
    RETURN;
  END IF;
  IF v_edit THEN
    v_people := ARRAY(SELECT u FROM unnest(v_people) u
                       WHERE u <> ALL (coalesce(p_before.mentioned_user_ids, '{}'::uuid[])));
    v_teams := ARRAY(SELECT t FROM unnest(v_teams) t
                      WHERE t <> ALL (coalesce(p_before.mentioned_team_ids, '{}'::uuid[])));
    v_everyone := v_everyone AND NOT coalesce(p_before.mentions_everyone, false);
    IF cardinality(v_people) = 0 AND cardinality(v_teams) = 0 AND NOT v_everyone THEN
      RETURN;
    END IF;
  END IF;

  WITH mem AS (
    SELECT m.user_id, m.notify_level
      FROM public.chat_members m
     WHERE m.channel_id = p_channel.id AND m.left_at IS NULL
  ), team_people AS (
    SELECT DISTINCT tm.user_id
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
     WHERE tm.team_id = ANY (v_teams) AND tm.deleted_at IS NULL
       AND tm.workspace_id = p_channel.workspace_id
       AND NOT public.chat__team_muted(tm.user_id)
  ), chain AS (
    -- A reply reaches its chain's people: the root's author, everyone who
    -- replied, everyone named in it, and the author of what it quotes, minus
    -- whoever stopped following.
    SELECT DISTINCT x.u
      FROM (
        SELECT rt.author_id AS a, rt.mentioned_user_ids AS named
          FROM public.chat_messages rt WHERE rt.id = p_msg.parent_id
        UNION ALL
        SELECT y.author_id, y.mentioned_user_ids
          FROM public.chat_messages y
         WHERE y.parent_id = p_msg.parent_id AND y.id <> p_msg.id
           AND y.kind = 'message' AND y.deleted_at IS NULL
        UNION ALL
        SELECT q.author_id, '{}'::uuid[]
          FROM public.chat_messages q WHERE q.id = p_msg.reply_to_id
      ) s
      CROSS JOIN LATERAL unnest(array[s.a] || coalesce(s.named, '{}'::uuid[])) AS x(u)
     WHERE NOT v_edit AND p_msg.parent_id IS NOT NULL AND x.u IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.chat_chain_mutes cm
                        WHERE cm.user_id = x.u AND cm.root_id = p_msg.parent_id)
  ), cand AS (
    SELECT u FROM unnest(v_people) u
    UNION
    SELECT user_id FROM team_people
    UNION
    SELECT u FROM chain
    UNION
    -- Members reached without being named: only when a rule can reach them.
    SELECT mem.user_id FROM mem
     WHERE v_everyone
        OR (NOT v_edit AND (p_channel.kind = 'dm' OR mem.notify_level = 'all'
                            OR (p_channel.managers_only AND p_msg.parent_id IS NULL)))
  ), decided AS (
    SELECT c.u,
           CASE
             WHEN p_channel.kind = 'dm' THEN
               CASE WHEN NOT v_edit AND mem.user_id IS NOT NULL AND mem.notify_level <> 'none' THEN 'dm'
                    WHEN mem.notify_level = 'none' AND c.u = ANY (v_people) THEN 'mention' END
             WHEN c.u = ANY (v_people) THEN 'mention'
             WHEN tp.user_id IS NOT NULL THEN 'team_mention'
             WHEN mem.notify_level = 'none' THEN NULL
             WHEN v_everyone AND mem.user_id IS NOT NULL THEN 'everyone'
             WHEN v_edit THEN NULL
             WHEN p_channel.managers_only AND p_msg.parent_id IS NULL AND mem.user_id IS NOT NULL THEN 'announcement'
             WHEN ch.u IS NOT NULL THEN 'reply'
             WHEN mem.notify_level = 'all' THEN 'every_message'
           END AS reason,
           (p_channel.kind <> 'dm' AND coalesce(mem.notify_level, 'mentions') <> 'none') AS bell_ok
      FROM cand c
      LEFT JOIN mem ON mem.user_id = c.u
      LEFT JOIN team_people tp ON tp.user_id = c.u
      LEFT JOIN chain ch ON ch.u = c.u
     WHERE c.u IS NOT NULL AND c.u IS DISTINCT FROM p_actor
       AND public.chat__can_read_channel_as(p_channel.id, c.u)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'u', d.u, 'r', d.reason,
           'b', d.bell_ok AND d.reason IN ('mention', 'team_mention', 'everyone', 'announcement', 'reply'))),
         '[]'::jsonb)
    INTO v_who
    FROM decided d
   WHERE d.reason IS NOT NULL
     -- Once per message: a send never twice; an edit not to anyone named,
     -- or written to, before.
     AND NOT EXISTS (SELECT 1 FROM public.chat_catchup k
                      WHERE k.user_id = d.u AND k.message_id = p_msg.id
                        AND (NOT v_edit OR k.reason IN ('dm', 'mention', 'team_mention', 'everyone')));

  FOREACH v_reason IN ARRAY ARRAY['dm', 'mention', 'team_mention', 'everyone', 'announcement', 'reply', 'every_message'] LOOP
    SELECT coalesce(array_agg((e ->> 'u')::uuid), '{}'::uuid[]),
           coalesce(array_agg((e ->> 'u')::uuid) FILTER (WHERE (e ->> 'b')::boolean), '{}'::uuid[])
      INTO v_users, v_bell
      FROM jsonb_array_elements(v_who) e
     WHERE e ->> 'r' = v_reason;
    CONTINUE WHEN cardinality(v_users) = 0;

    v_activity := public.chat__activity(p_channel, p_msg, p_actor,
      CASE v_reason WHEN 'reply' THEN 'chat.reply' WHEN 'announcement' THEN 'chat.announcement'
                    ELSE 'chat.mention' END,
      CASE v_reason WHEN 'mention' THEN 'person' WHEN 'team_mention' THEN 'team'
                    WHEN 'everyone' THEN 'everyone' END,
      v_bell,
      CASE WHEN v_reason = 'team_mention' THEN v_teams END);

    IF v_reason = 'reply' THEN
      -- One item per chain: it moves to the newest reply, and the bell keeps
      -- one row per chain (the twin it had is dismissed).
      INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
      SELECT DISTINCT k.workspace_id, k.user_id, k.activity_id, now()
        FROM public.chat_catchup k
       WHERE k.user_id = ANY (v_users) AND k.reason = 'reply' AND k.chain_root_id = p_msg.parent_id
         AND k.done_at IS NULL AND k.activity_id IS NOT NULL
      ON CONFLICT (user_id, activity_id) DO UPDATE
        SET dismissed_at = coalesce(public.notification_state.dismissed_at, EXCLUDED.dismissed_at);
      INSERT INTO public.chat_catchup
        (workspace_id, user_id, channel_id, message_id, chain_root_id, reason, actor_id, activity_id)
      SELECT p_channel.workspace_id, u, p_channel.id, p_msg.id, p_msg.parent_id, 'reply', p_actor,
             CASE WHEN u = ANY (v_bell) THEN v_activity END
        FROM unnest(v_users) u
      ON CONFLICT (user_id, chain_root_id) WHERE reason = 'reply' AND done_at IS NULL
      DO UPDATE SET message_id = EXCLUDED.message_id,
                    actor_id = EXCLUDED.actor_id,
                    activity_id = EXCLUDED.activity_id;
    ELSIF v_reason = 'every_message' THEN
      -- One line per conversation (CH73), pointing at its newest message.
      INSERT INTO public.chat_catchup
        (workspace_id, user_id, channel_id, message_id, reason, actor_id)
      SELECT p_channel.workspace_id, u, p_channel.id, p_msg.id, 'every_message', p_actor
        FROM unnest(v_users) u
      ON CONFLICT (user_id, channel_id) WHERE reason = 'every_message' AND done_at IS NULL
      DO UPDATE SET message_id = EXCLUDED.message_id,
                    actor_id = EXCLUDED.actor_id;
    ELSE
      INSERT INTO public.chat_catchup
        (workspace_id, user_id, channel_id, message_id, chain_root_id, reason, actor_id, activity_id)
      SELECT p_channel.workspace_id, u, p_channel.id, p_msg.id, p_msg.parent_id, v_reason, p_actor,
             CASE WHEN u = ANY (v_bell) THEN v_activity END
        FROM unnest(v_users) u
      ON CONFLICT (user_id, message_id, reason) WHERE message_id IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;
END;
$function$;

-- ── 3. Send, edit and an app's post fan out ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_op_send(p_id uuid, p_channel_id uuid, p_body text, p_reply_to_id uuid DEFAULT NULL::uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_body text := coalesce(p_body, '');
  v_quoted public.chat_messages;
  v_root public.chat_messages;
  v_msg public.chat_messages;
  v_people uuid[];
  v_teams uuid[];
  v_everyone boolean;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'A message needs its id.' USING ERRCODE = '22023';
  END IF;
  -- A resent id returns the stored row (the outbox retries with the same id),
  -- only to its author, in its conversation, while they can still read it.
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_id;
  IF v_msg.id IS NOT NULL THEN
    IF v_me IS NOT NULL AND v_msg.author_id = v_me AND v_msg.channel_id = p_channel_id
       AND public.chat_can_read_channel(p_channel_id) THEN
      RETURN v_msg;
    END IF;
    PERFORM public.chat_op__channel(p_channel_id);
    RAISE EXCEPTION 'That message id is already used.' USING ERRCODE = '22023';
  END IF;

  v_channel := public.chat_op__channel(p_channel_id);
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF public.chat__was_removed(p_channel_id, v_me) THEN
    RAISE EXCEPTION 'You were removed from this conversation.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat__check_body(v_body);

  -- A reply posts in the conversation and joins the chain of what it answers.
  IF p_reply_to_id IS NOT NULL THEN
    SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
    IF v_quoted.id IS NULL OR v_quoted.channel_id <> p_channel_id OR v_quoted.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    IF v_quoted.kind <> 'message' THEN
      RAISE EXCEPTION 'Only a message can be replied to.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_root FROM public.chat_messages
     WHERE id = coalesce(v_quoted.parent_id, v_quoted.id) FOR UPDATE;
  END IF;

  -- Who it mentions is read from the text, here.
  SELECT mt.people, mt.teams, mt.everyone INTO v_people, v_teams, v_everyone
    FROM public.chat__read_mentions(v_channel, v_body, v_me) mt;

  -- Posting in a public channel joins it, or back after leaving it.
  INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
  VALUES (p_channel_id, v_me, v_channel.workspace_id)
  ON CONFLICT (channel_id, user_id) DO UPDATE SET left_at = NULL
   WHERE public.chat_members.left_at IS NOT NULL;

  -- client_id = id while the v1 wrappers live: v1 screens and old builds match
  -- their optimistic row by it (CV-23 stops writing it).
  INSERT INTO public.chat_messages
    (id, client_id, workspace_id, channel_id, parent_id, reply_to_id, author_id, body, format_version,
     mentioned_user_ids, mentioned_team_ids, mentions_everyone)
  VALUES
    (p_id, p_id, v_channel.workspace_id, p_channel_id, v_root.id, v_quoted.id, v_me, v_body, 2,
     v_people, v_teams, v_everyone)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_msg;
  IF v_msg.id IS NULL THEN
    -- The same id sent twice at once: the first one won.
    SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_id;
    IF v_msg.author_id = v_me AND v_msg.channel_id = p_channel_id THEN
      RETURN v_msg;
    END IF;
    RAISE EXCEPTION 'That message id is already used.' USING ERRCODE = '22023';
  END IF;

  IF v_root.id IS NOT NULL THEN
    UPDATE public.chat_messages
       SET reply_count = reply_count + 1,
           last_reply_at = v_msg.created_at,
           reply_user_ids = (
             SELECT coalesce(array_agg(u), '{}') FROM (
               SELECT u FROM unnest(array[v_me] || array_remove(reply_user_ids, v_me)) WITH ORDINALITY t(u, o)
                ORDER BY o LIMIT 5) s)
     WHERE id = v_root.id;
  END IF;
  -- Replies post at the bottom too: the conversation's last message moves.
  UPDATE public.chat_channels SET last_message_at = v_msg.created_at
   WHERE id = p_channel_id AND (last_message_at IS NULL OR last_message_at < v_msg.created_at);
  -- The sender has read up to their own message.
  UPDATE public.chat_members mb
     SET last_read_id = v_msg.id,
         last_read_at = greatest(mb.last_read_at, v_msg.created_at)
   WHERE mb.channel_id = p_channel_id AND mb.user_id = v_me
     AND NOT EXISTS (SELECT 1 FROM public.chat_messages r
                      WHERE r.id = mb.last_read_id
                        AND (r.created_at, r.id) > (v_msg.created_at, v_msg.id));

  -- CV-5: Catch up items and the bell for everyone it's addressed to, and
  -- the sender's own items up to here are read.
  PERFORM public.chat__fan_out(v_msg, v_channel, v_me);
  PERFORM public.chat__close_read(v_me, p_channel_id, v_msg);
  RETURN v_msg;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_edit(p_message_id uuid, p_body text)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_before public.chat_messages;
  v_channel public.chat_channels;
  v_body text := coalesce(p_body, '');
  v_people uuid[];
  v_teams uuid[];
  v_everyone boolean;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  v_channel := public.chat_op__channel(v_msg.channel_id);
  IF v_msg.author_id IS DISTINCT FROM v_me OR v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'You can only edit your own messages.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF public.chat__was_removed(v_msg.channel_id, v_me) THEN
    RAISE EXCEPTION 'You were removed from this conversation.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat__check_body(v_body);
  -- The same text again changes nothing (a resent edit).
  IF v_msg.format_version = 2 AND v_msg.body = v_body THEN
    RETURN v_msg;
  END IF;

  SELECT mt.people, mt.teams, mt.everyone INTO v_people, v_teams, v_everyone
    FROM public.chat__read_mentions(v_channel, v_body, v_me) mt;

  v_before := v_msg;
  UPDATE public.chat_messages
     SET body = v_body,
         format_version = 2,
         mentioned_user_ids = v_people,
         mentioned_team_ids = v_teams,
         mentions_everyone = v_everyone,
         edited_at = now()
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.message_edit', jsonb_build_object('message_id', v_msg.id));
  -- CV-5: only people named for the first time hear about it (CH75).
  PERFORM public.chat__fan_out(v_msg, v_channel, v_me, v_before);
  RETURN v_msg;
END;
$function$;

-- The live app post (v1's body; its creator rules are CV-21's): its bell block
-- gives way to the fan-out.
CREATE OR REPLACE FUNCTION public.chat_op_agent_post(p_workspace_id uuid, p_channel_id uuid, p_body text, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key uuid := public.module_api_key_id();
  v_label text;
  v_channel public.chat_channels;
  v_parent public.chat_messages;
  v_msg public.chat_messages;
  v_body text := coalesce(p_body, '');
  v_stored text;
  v_mentions uuid[];
begin
  if v_key is null then
    raise exception 'Only an API key can post as an app.';
  end if;
  if public.chat_key_scope(p_workspace_id) <> 'edit' then
    raise exception 'This API key can''t post to chat — give it Chat: Edit in Workspace settings → API keys.';
  end if;
  if not public.chat_workspace_enabled(p_workspace_id) then
    raise exception 'Chat is available on the Duo and Team plans.';
  end if;

  select * into v_channel from public.chat_channels
   where id = p_channel_id and workspace_id = p_workspace_id;
  if v_channel.id is null or v_channel.kind <> 'channel' or v_channel.is_private then
    raise exception 'Apps can only post in public channels.';
  end if;
  if v_channel.archived_at is not null then
    raise exception 'This channel is archived.';
  end if;
  if btrim(v_body, E' \n\t') = '' then
    raise exception 'A message can''t be empty.';
  end if;
  if char_length(v_body) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;
  v_stored := public.chat__v1_to_v2(v_body);
  if char_length(v_stored) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.chat_messages where id = p_parent_id for update;
    if v_parent.id is null or v_parent.channel_id <> p_channel_id or v_parent.parent_id is not null
       or v_parent.deleted_at is not null then
      raise exception 'That thread no longer exists.';
    end if;
  end if;

  select k.name into v_label from public.workspace_api_keys k where k.id = v_key;

  select coalesce(array_agg(distinct m[1]::uuid), '{}') into v_mentions
    from regexp_matches(v_body, '<@([0-9a-fA-F-]{36})>', 'g') m
   where public.chat_is_workspace_member(p_workspace_id, m[1]::uuid);

  insert into public.chat_messages
    (workspace_id, channel_id, parent_id, reply_to_id, author_id, author_kind, author_label, body,
     format_version, mentioned_user_ids)
  values
    (p_workspace_id, p_channel_id, p_parent_id, p_parent_id, null, 'api_key', coalesce(v_label, 'App'), v_stored,
     2, v_mentions)
  returning * into v_msg;

  if v_parent.id is not null then
    update public.chat_messages
       set reply_count = reply_count + 1, last_reply_at = v_msg.created_at
     where id = v_parent.id;
  else
    update public.chat_channels set last_message_at = v_msg.created_at where id = p_channel_id;
  end if;

  -- CV-5: Catch up items and the bell, among people who can read the channel.
  perform public.chat__fan_out(v_msg, v_channel, null);
  return v_msg;
end;
$function$;

-- ── 4. Reading closes items; marking unread reopens what reading closed ─────

CREATE OR REPLACE FUNCTION public.chat_op_mark_read(p_channel_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.channel_id <> p_channel_id THEN
    RAISE EXCEPTION 'That message isn''t in this conversation.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.chat_members mb
     SET last_read_id = v_msg.id,
         last_read_at = greatest(mb.last_read_at, v_msg.created_at)
   WHERE mb.channel_id = p_channel_id AND mb.user_id = auth.uid() AND mb.left_at IS NULL
     AND CASE WHEN mb.last_read_id IS NULL THEN v_msg.created_at > mb.last_read_at
              ELSE NOT EXISTS (SELECT 1 FROM public.chat_messages r
                                WHERE r.id = mb.last_read_id
                                  AND (r.created_at, r.id) >= (v_msg.created_at, v_msg.id)) END;
  -- CV-5: what you read up to here leaves Catch up, and its bell rows go too.
  PERFORM public.chat__close_read(auth.uid(), p_channel_id, v_msg);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_mark_unread(p_channel_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
  v_prev public.chat_messages;
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.channel_id <> p_channel_id THEN
    RAISE EXCEPTION 'That message isn''t in this conversation.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_prev FROM public.chat_messages m
   WHERE m.channel_id = p_channel_id AND (m.created_at, m.id) < (v_msg.created_at, v_msg.id)
   ORDER BY m.created_at DESC, m.id DESC
   LIMIT 1;
  UPDATE public.chat_members
     SET last_read_id = v_prev.id,
         last_read_at = coalesce(v_prev.created_at, v_msg.created_at - interval '1 microsecond')
   WHERE channel_id = p_channel_id AND user_id = auth.uid() AND left_at IS NULL;
  -- CV-5: items that reading closed come back from this message on (Done and
  -- the bell's dismissals stay as they are).
  PERFORM public.chat__reopen(auth.uid(), ARRAY(
    SELECT k.id
      FROM public.chat_catchup k
      JOIN public.chat_messages m ON m.id = k.message_id
     WHERE k.user_id = auth.uid() AND k.channel_id = p_channel_id AND k.done_how = 'read'
       AND (m.created_at, m.id) >= (v_msg.created_at, v_msg.id)));
END;
$function$;

-- ── 5. Catch up's ops ───────────────────────────────────────────────────────

-- Done: the items leave Catch up and their bell rows are dismissed.
CREATE OR REPLACE FUNCTION public.chat_op_catchup_done(p_item_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(coalesce(p_item_ids, '{}'::uuid[])) > 1000 THEN
    RAISE EXCEPTION 'Up to 1,000 items at a time.' USING ERRCODE = '22023';
  END IF;
  RETURN public.chat__close(auth.uid(), p_item_ids, 'done');
END;
$function$;

-- Undo: the items come back, and their bell rows with them.
CREATE OR REPLACE FUNCTION public.chat_op_catchup_reopen(p_item_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(coalesce(p_item_ids, '{}'::uuid[])) > 1000 THEN
    RAISE EXCEPTION 'Up to 1,000 items at a time.' USING ERRCODE = '22023';
  END IF;
  RETURN public.chat__reopen(auth.uid(), p_item_ids);
END;
$function$;

-- Stop following a chain (or follow it again). Any message of the chain names
-- it. Stopping closes the chain's open item.
CREATE OR REPLACE FUNCTION public.chat_op_follow_chain(p_message_id uuid, p_following boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_root uuid;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__reader(v_msg.channel_id);
  IF p_following IS NULL THEN
    RAISE EXCEPTION 'Say whether to follow the chain.' USING ERRCODE = '22023';
  END IF;
  v_root := coalesce(v_msg.parent_id, v_msg.id);
  IF p_following THEN
    DELETE FROM public.chat_chain_mutes WHERE user_id = v_me AND root_id = v_root;
    RETURN;
  END IF;
  INSERT INTO public.chat_chain_mutes (user_id, root_id, workspace_id)
  VALUES (v_me, v_root, v_msg.workspace_id)
  ON CONFLICT (user_id, root_id) DO NOTHING;
  PERFORM public.chat__close(v_me, ARRAY(
    SELECT k.id FROM public.chat_catchup k
     WHERE k.user_id = v_me AND k.reason = 'reply' AND k.chain_root_id = v_root AND k.done_at IS NULL), 'done');
END;
$function$;

-- ── 6. The bell's dismiss closes the twin; undismiss reopens it ─────────────

-- Tasks' behaviour unchanged; the last statement is chat's.
CREATE OR REPLACE FUNCTION public.notifications_op_dismiss(p_workspace_id uuid, p_activity_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_activity public.module_activity;
BEGIN
  IF NOT public.tasks_module_can_access_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'You don''t have access to this workspace.';
  END IF;
  SELECT * INTO v_activity FROM public.module_activity
    WHERE id = p_activity_id AND workspace_id = p_workspace_id;
  IF NOT FOUND OR NOT public.spine_activity_targets_me(v_activity) THEN
    RETURN;
  END IF;

  INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
  VALUES (p_workspace_id, auth.uid(), p_activity_id, now())
  ON CONFLICT (user_id, activity_id) DO UPDATE
    SET dismissed_at = coalesce(public.notification_state.dismissed_at, now());

  -- Chat (CV-5): the bell and Catch up are one state; its Catch up twin closes.
  IF v_activity.module = 'chat' THEN
    PERFORM public.chat__close(auth.uid(), ARRAY(
      SELECT k.id FROM public.chat_catchup k
       WHERE k.user_id = auth.uid() AND k.activity_id = p_activity_id AND k.done_at IS NULL), 'bell');
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notifications_op_undismiss(p_workspace_id uuid, p_activity_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tasks_module_can_access_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'You don''t have access to this workspace.';
  END IF;
  UPDATE public.notification_state
    SET dismissed_at = NULL
    WHERE user_id = auth.uid()
      AND activity_id = p_activity_id
      AND workspace_id = p_workspace_id;

  -- Chat (CV-5): its Catch up twin comes back too.
  PERFORM public.chat__reopen(auth.uid(), ARRAY(
    SELECT k.id FROM public.chat_catchup k
     WHERE k.user_id = auth.uid() AND k.activity_id = p_activity_id
       AND k.workspace_id = p_workspace_id AND k.done_at IS NOT NULL));
END;
$function$;

-- ── 7. Counts: Catch up's share is the open items ───────────────────────────

CREATE OR REPLACE FUNCTION public.chat_unread_counts(p_workspace_id uuid)
 RETURNS TABLE(channel_id uuid, unread integer, mentions integer, addressed integer, catchup integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH me AS (
    SELECT auth.uid() AS id
  ), mine AS (
    SELECT mb.channel_id, mb.notify_level, mb.last_read_at, r.created_at AS mark_at, r.id AS mark_id,
           c.kind, c.managers_only
      FROM public.chat_members mb
      JOIN public.chat_channels c ON c.id = mb.channel_id
      LEFT JOIN public.chat_messages r ON r.id = mb.last_read_id
     WHERE mb.user_id = (SELECT id FROM me) AND mb.workspace_id = p_workspace_id
       AND mb.left_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL
       AND public.chat__reads_workspace(p_workspace_id, (SELECT id FROM me))
  ), teams AS (
    SELECT coalesce(array_agg(tm.team_id), '{}'::uuid[]) AS ids,
           public.chat__team_muted((SELECT id FROM me)) AS muted
      FROM public.team_members tm
     WHERE tm.user_id = (SELECT id FROM me) AND tm.workspace_id = p_workspace_id AND tm.deleted_at IS NULL
  ), fresh AS (
    SELECT mi.channel_id, mi.notify_level, mi.kind, m.id, m.parent_id,
           ((SELECT id FROM me) = ANY (m.mentioned_user_ids) OR m.mentions_everyone
            OR m.mentioned_team_ids && (SELECT ids FROM teams)) AS mentioned,
           -- What counts as addressed leaves out a team mention when your
           -- teams' notices are off (CV-5).
           ((SELECT id FROM me) = ANY (m.mentioned_user_ids) OR m.mentions_everyone
            OR (m.mentioned_team_ids && (SELECT ids FROM teams) AND NOT (SELECT muted FROM teams))) AS named,
           (mi.managers_only AND m.parent_id IS NULL) AS announced,
           (m.parent_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.chat_chain_mutes cm
                             WHERE cm.user_id = (SELECT id FROM me) AND cm.root_id = m.parent_id)
            AND (EXISTS (SELECT 1 FROM public.chat_messages q
                          WHERE q.id = m.reply_to_id AND q.author_id = (SELECT id FROM me))
                 OR EXISTS (SELECT 1 FROM public.chat_messages rt
                             WHERE rt.id = m.parent_id
                               AND (rt.author_id = (SELECT id FROM me)
                                    OR (SELECT id FROM me) = ANY (rt.mentioned_user_ids)))
                 OR EXISTS (SELECT 1 FROM public.chat_messages x
                             WHERE x.parent_id = m.parent_id
                               AND (x.created_at, x.id) < (m.created_at, m.id)
                               AND (x.author_id = (SELECT id FROM me)
                                    OR (SELECT id FROM me) = ANY (x.mentioned_user_ids))))) AS in_chain
      FROM mine mi
      JOIN public.chat_messages m ON m.channel_id = mi.channel_id
     WHERE m.kind = 'message' AND m.deleted_at IS NULL
       AND m.author_id IS DISTINCT FROM (SELECT id FROM me)
       AND CASE WHEN mi.mark_id IS NULL THEN m.created_at > mi.last_read_at
                ELSE (m.created_at, m.id) > (mi.mark_at, mi.mark_id) END
       AND NOT (m.v1_thread_reply AND EXISTS (
             SELECT 1 FROM public.chat_messages rt
              WHERE rt.id = m.parent_id
                AND CASE WHEN mi.mark_id IS NULL THEN rt.created_at <= mi.last_read_at
                         ELSE (rt.created_at, rt.id) <= (mi.mark_at, mi.mark_id) END))
  ), items AS (
    SELECT f.channel_id, f.mentioned,
           CASE WHEN f.notify_level = 'none' THEN NULL
                WHEN f.kind = 'dm' OR f.named OR f.announced THEN 'm:' || f.id::text
                WHEN f.in_chain THEN 'c:' || f.parent_id::text
                WHEN f.notify_level = 'all' THEN 'all'
           END AS item
      FROM fresh f
  ), open_items AS (
    -- Catch up's share (CV-5): open items showing now (not put off with
    -- Later), never on Nothing, never a team mention while your teams'
    -- notices are off, never a chain you stopped following, never a deleted
    -- message's, never a quiet line.
    SELECT k.channel_id, count(*)::int AS n
      FROM public.chat_catchup k
      JOIN mine mi ON mi.channel_id = k.channel_id AND mi.notify_level <> 'none'
      LEFT JOIN public.chat_messages km ON km.id = k.message_id
     WHERE k.user_id = (SELECT id FROM me) AND k.done_at IS NULL
       AND (k.later_until IS NULL OR k.later_until <= now())
       AND k.reason NOT IN ('added', 'removed', 'level_reset')
       AND NOT (k.reason = 'team_mention' AND (SELECT muted FROM teams))
       AND km.deleted_at IS NULL
       AND NOT (k.reason = 'reply' AND EXISTS (
             SELECT 1 FROM public.chat_chain_mutes cm
              WHERE cm.user_id = (SELECT id FROM me) AND cm.root_id = k.chain_root_id))
     GROUP BY k.channel_id
  )
  SELECT mi.channel_id,
         count(i.channel_id)::int,
         (count(i.channel_id) FILTER (WHERE i.mentioned))::int,
         (CASE WHEN mi.notify_level = 'none' THEN 0
               WHEN mi.kind = 'dm' OR mi.notify_level = 'all' THEN count(i.channel_id)
               ELSE count(i.item) END)::int,
         coalesce(oi.n, 0)::int
    FROM mine mi
    LEFT JOIN items i ON i.channel_id = mi.channel_id
    LEFT JOIN open_items oi ON oi.channel_id = mi.channel_id
   GROUP BY mi.channel_id, mi.notify_level, mi.kind, oi.n
$function$;

-- ── 8. The bell's recipient guard covers chat's three ops ───────────────────

-- Re-cut by anchored replace on the live trigger (extend the list, never paste
-- an older copy).
DO $gate$
DECLARE
  v_trigger text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_trigger FROM pg_trigger t
   WHERE t.tgrelid = 'public.module_activity'::regclass AND t.tgname = 'module_activity_gate_recipients';
  IF v_trigger IS NULL OR position('''tasks.agent_status''::text]' IN v_trigger) = 0
                          AND position('''chat.mention''::text' IN v_trigger) = 0 THEN
    RAISE EXCEPTION 'module_activity_gate_recipients isn''t the trigger this migration expects; recreate it by hand.';
  END IF;
  IF position('''chat.mention''::text' IN v_trigger) = 0 THEN
    DROP TRIGGER module_activity_gate_recipients ON public.module_activity;
    EXECUTE replace(v_trigger, '''tasks.agent_status''::text]',
      '''tasks.agent_status''::text, ''chat.mention''::text, ''chat.reply''::text, ''chat.announcement''::text]');
  END IF;
END;
$gate$;

-- ── 9. Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
  v_trigger text;
BEGIN
  -- Internal helpers: only the ops and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__team_muted(uuid)',
    'chat__activity(public.chat_channels, public.chat_messages, uuid, text, text, uuid[], uuid[])',
    'chat__close(uuid, uuid[], text)',
    'chat__reopen(uuid, uuid[])',
    'chat__close_read(uuid, uuid, public.chat_messages)',
    'chat__fan_out(public.chat_messages, public.chat_channels, uuid, public.chat_messages)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must not be callable by clients.', fn;
    END IF;
  END LOOP;
  -- The ops: signed-in people and the service role, never anon.
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_send(uuid, uuid, text, uuid)',
    'chat_op_edit(uuid, text)',
    'chat_op_mark_read(uuid, uuid)',
    'chat_op_mark_unread(uuid, uuid)',
    'chat_op_catchup_done(uuid[])',
    'chat_op_catchup_reopen(uuid[])',
    'chat_op_follow_chain(uuid, boolean)',
    'notifications_op_dismiss(uuid, uuid)',
    'notifications_op_undismiss(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
  -- An app's post: keys only (the service role), as before.
  REVOKE ALL ON FUNCTION public.chat_op_agent_post(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat_op_agent_post(uuid, uuid, text, uuid) TO service_role;
  -- The counts answer people only: a key (the service role) and anon get nothing.
  REVOKE ALL ON FUNCTION public.chat_unread_counts(uuid) FROM PUBLIC, anon, service_role;
  GRANT EXECUTE ON FUNCTION public.chat_unread_counts(uuid) TO authenticated;
  IF has_function_privilege('anon', 'public.chat_unread_counts(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.chat_unread_counts(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat_op_agent_post(uuid, uuid, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Grants on chat_unread_counts / chat_op_agent_post are not as intended.';
  END IF;

  -- Catch up stays read-only to clients; the bell's guard covers chat.
  IF has_table_privilege('authenticated', 'public.chat_catchup', 'INSERT')
     OR has_table_privilege('authenticated', 'public.chat_catchup', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.chat_chain_mutes', 'INSERT') THEN
    RAISE EXCEPTION 'chat_catchup / chat_chain_mutes must be written only through ops.';
  END IF;
  SELECT pg_get_triggerdef(t.oid) INTO v_trigger FROM pg_trigger t
   WHERE t.tgrelid = 'public.module_activity'::regclass AND t.tgname = 'module_activity_gate_recipients';
  IF position('''chat.announcement''::text' IN coalesce(v_trigger, '')) = 0
     OR position('''tasks.agent_status''::text' IN v_trigger) = 0 THEN
    RAISE EXCEPTION 'module_activity_gate_recipients does not cover chat''s bell rows.';
  END IF;
END;
$$;
