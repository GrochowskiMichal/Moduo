-- Chat v2 · CV-10 Links in messages and "make a task" (specs/chat-v2.md §8;
-- CH10, CH11; §Assumptions #5, #6; .design/chat-v2/research/round-3-database.md
-- §2.21, §2.25 d). The stamp is provisional: re-cut on the day it applies; it
-- must stay after …_chat_v2_reactions (CV-7c), whose chat_op_send/_edit bodies
-- it starts from. It runs again cleanly over itself.
--
-- What it does:
--   1. Two reference kinds. A conversation is `moduo://chat_channel/<id>` (in
--      the registry already, labelled with its name, none for a direct
--      message); a message is `moduo://chat_message/<id>`, registered only when
--      something links to it, through chat_op_register_message(message), and
--      never with a label (⌘K's Messages come from chat_search, not from the
--      registry). Only someone who can read the message registers it.
--   2. chat_message_refs(ids): a message's chip and card (author, conversation,
--      time, first words) for the messages the caller can read; nothing for the
--      rest, so the app draws those as "Private item" with no title. A deleted
--      message answers with `deleted` and no words ("Deleted message").
--   3. "Mentioned in": chat_op_send and chat_op_edit (from their live bodies)
--      leave one entity_links row per conversation and item the message refers
--      to (source the conversation, relation `mentions`, origin `ref`; the
--      pair key keeps it one). Only items already in the registry that the
--      sender can open; edits and deletes never remove one (history). The row
--      is readable only by people who can read the conversation (entity_links'
--      policy, CV-1).
--   4. chat_conversations_for_item(type, id), the mentions half: the "Mentioned
--      in Acme · Oct 12" lines the caller can read, for an item they can open.
--      CV-13 adds the channel-link half.
--   5. The registry's ensure (entities_op_ensure, from its live body) registers
--      a conversation or a message only for someone who can read it, and a
--      message never with a label: links_op_create goes through it, so linking
--      a task to a message (the capture's "From:" chip) follows the same rule.
--
-- No op takes a person from the caller: the actor is always auth.uid(). An API
-- key reads no chat row through any of these (auth.uid() is null for a key, and
-- every read here checks chat_can_read_channel).

SET LOCAL lock_timeout = '5s';

-- ── 1. Refs in a stored body ────────────────────────────────────────────────
-- The `moduo://<type>/<uuid>` references in a stored v2 body, once each, in the
-- order they first appear. Fenced code blocks and inline code spans are text
-- (the client draws no chip there), so their refs don't count. At most 100.
CREATE OR REPLACE FUNCTION public.chat__body_refs(p_body text)
RETURNS TABLE (ref_type text, ref_id uuid)
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
DECLARE
  v_lines text[];
  v_keep text[] := '{}';
  n integer;
  i integer := 1;
  m text[];
  v_size integer;
  v_text text;
BEGIN
  IF p_body IS NULL OR position('moduo://' IN p_body) = 0 THEN
    RETURN;
  END IF;
  -- Fenced code blocks (chat__body_text's fence rule) drop out whole.
  v_lines := string_to_array(regexp_replace(p_body, E'\r\n?', E'\n', 'g'), E'\n');
  n := cardinality(v_lines);
  WHILE i <= n LOOP
    m := regexp_match(v_lines[i], '^ {0,3}(`{3,})([^`]*)$');
    IF m IS NOT NULL THEN
      v_size := length(m[1]);
      i := i + 1;
      WHILE i <= n LOOP
        m := regexp_match(v_lines[i], '^ {0,3}(`+)[ \t]*$');
        EXIT WHEN m IS NOT NULL AND length(m[1]) >= v_size;
        i := i + 1;
      END LOOP;
      i := i + 1;
      CONTINUE;
    END IF;
    v_keep := v_keep || v_lines[i];
    i := i + 1;
  END LOOP;
  v_text := array_to_string(v_keep, E'\n');
  -- Inline code: a single-backtick span on one line (what ⌘E and `x` write).
  v_text := regexp_replace(v_text, '`[^`\n]*`', ' ', 'g');
  RETURN QUERY
    SELECT r.t, r.i
      FROM (SELECT lower(x[1]) AS t, x[2]::uuid AS i, min(o) AS first_at
              FROM regexp_matches(v_text,
                     'moduo://([a-z][a-z_-]{0,31})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})',
                     'g') WITH ORDINALITY AS r0(x, o)
             GROUP BY 1, 2) r
     ORDER BY r.first_at
     LIMIT 100;
END
$function$;

REVOKE ALL ON FUNCTION public.chat__body_refs(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat__body_refs(text) TO service_role;

-- ── 3. "Mentioned in" ───────────────────────────────────────────────────────
-- One `mentions` link from the message's conversation to each item it refers
-- to: only items already in this workspace's registry (an unknown id stays
-- text) that the sender can open. People, teams, days, conversations and
-- messages aren't items with a Linked list, so they leave none. Called by the
-- send and edit ops (SECURITY DEFINER), never by the app.
CREATE OR REPLACE FUNCTION public.chat__link_mentions(p_msg public.chat_messages, p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_n integer := 0;
  v_rows integer;
  r record;
  v_type text;
BEGIN
  IF p_msg.id IS NULL OR p_actor IS NULL OR position('moduo://' IN coalesce(p_msg.body, '')) = 0 THEN
    RETURN 0;
  END IF;
  FOR r IN SELECT b.ref_type, b.ref_id FROM public.chat__body_refs(p_msg.body) b LOOP
    -- The registry's names for the two kinds a link may spell differently.
    v_type := CASE r.ref_type WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread' ELSE r.ref_type END;
    CONTINUE WHEN v_type IN ('person', 'team', 'date', 'tag', 'chat_channel', 'chat_message');
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.entities e
       WHERE e.workspace_id = p_msg.workspace_id AND e.entity_type = v_type
         AND e.entity_id = r.ref_id AND e.deleted_at IS NULL);
    CONTINUE WHEN NOT public.spine__visible_to(p_msg.workspace_id, v_type, r.ref_id, p_actor);
    INSERT INTO public.entity_links
      (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
    VALUES
      (p_msg.workspace_id, 'chat_channel', p_msg.channel_id, v_type, r.ref_id, 'mentions', 'ref', p_actor)
    ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
    DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_n := v_n + v_rows;
  END LOOP;
  RETURN v_n;
END
$function$;

REVOKE ALL ON FUNCTION public.chat__link_mentions(public.chat_messages, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat__link_mentions(public.chat_messages, uuid) TO service_role;

-- chat_op_send, from its live body (CV-2a, CV-5, CV-7c): + "Mentioned in".
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
  -- Managers in effect only: in the channel, in a role that posts.
  IF v_channel.managers_only AND NOT public.chat__is_manager(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only managers can post in this channel.' USING ERRCODE = '42501';
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
   WHERE public.chat_members.left_at IS NOT NULL AND public.chat_members.removed_at IS NULL;

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

  -- CV-10: the items it refers to show "Mentioned in" this conversation.
  PERFORM public.chat__link_mentions(v_msg, v_me);
  -- CV-5: Catch up items and the bell for everyone it's addressed to, and
  -- the sender's own items up to here are read.
  PERFORM public.chat__fan_out(v_msg, v_channel, v_me);
  PERFORM public.chat__close_read(v_me, p_channel_id, v_msg);
  RETURN v_msg;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) TO authenticated, service_role;

-- chat_op_edit, from its live body (CV-2a, CV-5): + "Mentioned in" for the
-- items an edit adds (the ones it drops keep their line: history).
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
  -- CV-10: items the edit adds show "Mentioned in" this conversation.
  PERFORM public.chat__link_mentions(v_msg, v_me);
  -- CV-5: only people named for the first time hear about it (CH75), and
  -- someone it no longer names at all leaves Catch up and the bell.
  PERFORM public.chat__fan_out(v_msg, v_channel, v_me, v_before);
  -- Still named through a team means a live team of this workspace, as the
  -- fan-out reads it. One close per person.
  PERFORM public.chat__close(g.user_id, g.ids, 'closed')
     FROM (SELECT k.user_id, array_agg(k.id) AS ids
             FROM public.chat_catchup k
            WHERE k.message_id = v_msg.id AND k.done_at IS NULL
              AND k.reason IN ('mention', 'team_mention', 'everyone')
              AND NOT (k.user_id = ANY (coalesce(v_msg.mentioned_user_ids, '{}'::uuid[])))
              AND NOT coalesce(v_msg.mentions_everyone, false)
              AND NOT EXISTS (SELECT 1 FROM public.team_members tm
                                JOIN public.teams t ON t.id = tm.team_id
                               WHERE tm.team_id = ANY (coalesce(v_msg.mentioned_team_ids, '{}'::uuid[]))
                                 AND t.deleted_at IS NULL AND t.workspace_id = v_channel.workspace_id
                                 AND tm.user_id = k.user_id AND tm.deleted_at IS NULL)
            GROUP BY k.user_id) g;
  RETURN v_msg;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_edit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_edit(uuid, text) TO authenticated, service_role;

-- ── 1. Registering a message ────────────────────────────────────────────────
-- Makes a message linkable (the capture's "From:" chip calls it on create, and
-- only if the chip is kept). Only someone who can read it; never a label.
CREATE OR REPLACE FUNCTION public.chat_op_register_message(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  -- Signed in, in the workspace, reading the conversation (an API key is none).
  PERFORM public.chat_op__reader(v_msg.channel_id);
  IF v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message can be linked.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon)
  VALUES (v_msg.workspace_id, 'chat_message', v_msg.id, '', NULL)
  ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;
  RETURN jsonb_build_object('type', 'chat_message', 'id', v_msg.id, 'workspace_id', v_msg.workspace_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_register_message(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_register_message(uuid) TO authenticated, service_role;

-- ── 2. A message's chip and card ────────────────────────────────────────────
-- For the messages the caller can read (at most 200 ids): who wrote it, where,
-- when and its first words (the stored plain text, which holds no referenced
-- item's title). A deleted one answers `deleted` with no words. Anything else
-- (another conversation, another workspace, no such id) doesn't answer.
CREATE OR REPLACE FUNCTION public.chat_message_refs(p_ids uuid[])
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  channel_id uuid,
  channel_kind text,
  channel_name text,
  channel_private boolean,
  parent_id uuid,
  author_id uuid,
  author_kind text,
  author_label text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted boolean,
  excerpt text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.id, m.workspace_id, m.channel_id, c.kind,
         CASE WHEN c.kind = 'channel' THEN c.name END,
         c.is_private, m.parent_id,
         CASE WHEN m.deleted_at IS NULL THEN m.author_id END,
         CASE WHEN m.deleted_at IS NULL THEN m.author_kind END,
         CASE WHEN m.deleted_at IS NULL THEN m.author_label END,
         m.created_at,
         CASE WHEN m.deleted_at IS NULL THEN m.edited_at END,
         m.deleted_at IS NOT NULL,
         CASE WHEN m.deleted_at IS NULL THEN left(m.body_text, 280) END
    FROM public.chat_messages m
    JOIN public.chat_channels c ON c.id = m.channel_id AND c.deleted_at IS NULL
   WHERE auth.uid() IS NOT NULL
     AND m.id = ANY ((coalesce(p_ids, '{}'::uuid[]))[1:200])
     AND m.kind = 'message'
     AND public.chat_can_read_channel(m.channel_id)
$function$;

REVOKE ALL ON FUNCTION public.chat_message_refs(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_message_refs(uuid[]) TO authenticated, service_role;

-- ── 4. The conversations an item is mentioned in ────────────────────────────
-- The mentions half: one line per conversation the caller can read that refers
-- to an item the caller can open, with the day it was first mentioned there.
CREATE OR REPLACE FUNCTION public.chat_conversations_for_item(p_type text, p_id uuid)
RETURNS TABLE (
  channel_id uuid,
  workspace_id uuid,
  channel_kind text,
  channel_name text,
  channel_private boolean,
  relation text,
  since timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH item AS (
    SELECT CASE p_type WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread' ELSE p_type END AS t
  ), hits AS (
    SELECT l.workspace_id,
           CASE WHEN l.source_type = 'chat_channel' THEN l.source_id ELSE l.target_id END AS cid,
           min(l.created_at) AS since
      FROM public.entity_links l, item
     WHERE auth.uid() IS NOT NULL
       AND l.deleted_at IS NULL
       AND l.relation_kind = 'mentions'
       AND ((l.source_type = 'chat_channel' AND l.target_type = item.t AND l.target_id = p_id)
         OR (l.target_type = 'chat_channel' AND l.source_type = item.t AND l.source_id = p_id))
     GROUP BY 1, 2
  )
  SELECT c.id, c.workspace_id, c.kind,
         CASE WHEN c.kind = 'channel' THEN c.name END,
         c.is_private, 'mentions'::text, h.since
    FROM hits h
    JOIN public.chat_channels c ON c.id = h.cid AND c.workspace_id = h.workspace_id AND c.deleted_at IS NULL
    , item
   WHERE public.chat_can_read_channel(c.id)
     AND public.perm_can_see_entity(h.workspace_id, item.t, p_id)
   ORDER BY h.since DESC, c.id
   LIMIT 50
$function$;

REVOKE ALL ON FUNCTION public.chat_conversations_for_item(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_conversations_for_item(text, uuid) TO authenticated, service_role;

-- ── 5. The registry's ensure, from its live body ────────────────────────────
-- A conversation or a message joins the registry (and so can be linked) only
-- for someone who can read it; a message never carries a label, and a
-- conversation carries its own name (none for a direct message), whatever the
-- caller passes. Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.entities_op_ensure(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_label text DEFAULT NULL::text, p_icon text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_entity_type IN ('chat_channel', 'chat_message') THEN
    IF NOT public.perm_can_see_entity(p_workspace_id, p_entity_type, p_entity_id) THEN
      RAISE EXCEPTION 'That conversation isn''t available.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon)
    SELECT p_workspace_id, p_entity_type, p_entity_id,
           CASE WHEN p_entity_type = 'chat_channel'
                THEN (SELECT CASE WHEN c.kind = 'channel' THEN c.name ELSE '' END
                        FROM public.chat_channels c WHERE c.id = p_entity_id)
                ELSE '' END,
           NULL
    ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;
    RETURN;
  END IF;
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, coalesce(p_label, ''), p_icon)
  ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;
END;
$function$;

-- Server code only, as on prod: the ops that register (links_op_create, the
-- chat ops) call it as its owner.
REVOKE ALL ON FUNCTION public.entities_op_ensure(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entities_op_ensure(uuid, text, uuid, text, text) TO service_role;
