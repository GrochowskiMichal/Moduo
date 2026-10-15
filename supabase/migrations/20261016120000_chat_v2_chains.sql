-- Chat v2 · CV-12 Replies and Wrap up (specs/chat-v2.md §5, §12; CH30a,
-- CH30c, CH30d, CH53, CH54; §Assumptions #15, #23; round-3 §2.3, §2.18).
-- The stamp is provisional: re-cut on the day it applies, after
-- …_chat_v2_reactions (CV-7c). It runs again cleanly over itself.
--
-- What it does:
--   1. A chain's root keeps its wrap-up: wrapped_at / wrapped_by / settled_id
--      (the reply that settled it, always a reply of that chain), and the
--      last reopen: reopened_at / reopened_by ("Reopened by Mike"). Wrapping
--      up is a drawing rule on the root: the replies stay rows for unread,
--      Catch up, search and export; the app stops drawing them in the stream.
--   2. chat_op_wrap_up(root, settled_id, mark_decision) and
--      chat_op_reopen(root). Who: the root's author, the channel's managers
--      and admins ("Manage any channel"); in a direct message anyone in it who
--      can post; never a viewer. mark_decision is accepted now and stored by
--      CV-14 (Decisions), so the signature stays. A reopen by the person who
--      wrapped it within 10 s of wrapping is the toast's Undo: the chain is
--      open again without a "Reopened by" line.
--   3. chat_op_attach_to_chain(message, reply_to_id), "Reply to…": a message
--      of the same conversation joins the chain of what it now answers (one
--      level: the root of the quoted message); the chain it left and the one
--      it joins recount. Own messages for anyone who can post; anyone's for
--      managers and admins. A message with replies of its own stays a root.
--      Joining a wrapped chain reopens it, as a new reply does (CH54).
--   4. chat_op_send (from its live body): a reply to a wrapped chain reopens
--      it ("Reopened by <sender>"). Nothing else in it changes.
--   5. Reading the stream past a reply it no longer draws (its chain is
--      wrapped up) leaves that reply's Catch up item open: the read mark is
--      what was on screen (§6 #17). chat_op_chain_read(root) closes your open
--      items for a chain you read on the right.
--   6. The Reply chains view's index: a conversation's chains, newest
--      activity first.
-- Every op takes the person from the session, never from the caller.
-- Activity rows: chat.wrap_up, chat.reopen (#15).

SET LOCAL lock_timeout = '5s';

-- ── 1. The root's wrap-up ───────────────────────────────────────────────────
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS wrapped_at timestamptz,
  ADD COLUMN IF NOT EXISTS wrapped_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settled_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'chat_messages_wrap_shape'
                    AND conrelid = 'public.chat_messages'::regclass) THEN
    -- Only a root is wrapped up; a settled reply belongs to a wrapped root.
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_wrap_shape
      CHECK ((wrapped_at IS NULL OR parent_id IS NULL) AND (settled_id IS NULL OR wrapped_at IS NOT NULL));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS chat_messages_chains_idx
  ON public.chat_messages (channel_id, last_reply_at DESC)
  WHERE reply_count > 0 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_messages_settled_idx
  ON public.chat_messages (settled_id) WHERE settled_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_wrapped_by_idx
  ON public.chat_messages (wrapped_by) WHERE wrapped_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_reopened_by_idx
  ON public.chat_messages (reopened_by) WHERE reopened_by IS NOT NULL;

-- ── 2. Who may wrap up and reopen a chain ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat__may_wrap(p_channel public.chat_channels, p_root public.chat_messages, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT p_user IS NOT NULL AND p_channel.id IS NOT NULL AND p_root.id IS NOT NULL
     AND public.chat_has_cap(p_channel.workspace_id, p_user, 'post')
     AND (public.chat__can_manage(p_channel, p_user)
          OR (p_root.author_id = p_user AND public.chat__can_post(p_channel, p_user))
          OR (p_channel.kind = 'dm' AND public.chat__can_post(p_channel, p_user)))
$$;

REVOKE ALL ON FUNCTION public.chat__may_wrap(public.chat_channels, public.chat_messages, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat__may_wrap(public.chat_channels, public.chat_messages, uuid) TO service_role;

-- A chain's root, locked, in a conversation the caller may act in.
CREATE OR REPLACE FUNCTION public.chat__chain_root(p_root_id uuid)
RETURNS public.chat_messages
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_root public.chat_messages;
BEGIN
  SELECT * INTO v_root FROM public.chat_messages WHERE id = p_root_id FOR UPDATE;
  -- A message you can't read reads as one that isn't there.
  IF v_root.id IS NULL OR NOT public.chat_can_read_channel(v_root.channel_id) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF v_root.kind <> 'message' OR v_root.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only the first message of a reply chain can be wrapped up.' USING ERRCODE = '22023';
  END IF;
  RETURN v_root;
END;
$$;

REVOKE ALL ON FUNCTION public.chat__chain_root(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat__chain_root(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_op_wrap_up(p_root_id uuid, p_settled_id uuid, p_mark_decision boolean DEFAULT false)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_root public.chat_messages;
  v_channel public.chat_channels;
  v_settled public.chat_messages;
BEGIN
  v_root := public.chat__chain_root(p_root_id);
  v_channel := public.chat_op__channel(v_root.channel_id);
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__may_wrap(v_channel, v_root, v_me) THEN
    RAISE EXCEPTION 'Only whoever started the chain, the channel''s managers and admins can wrap it up.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_settled FROM public.chat_messages WHERE id = p_settled_id;
  IF v_settled.id IS NULL OR v_settled.parent_id IS DISTINCT FROM v_root.id
     OR v_settled.deleted_at IS NOT NULL OR v_settled.kind <> 'message' THEN
    RAISE EXCEPTION 'Pick the reply of this chain that settled it.' USING ERRCODE = '22023';
  END IF;
  IF v_root.wrapped_at IS NOT NULL AND v_root.settled_id = v_settled.id THEN
    RETURN v_root;
  END IF;
  -- The clock, not the transaction's start: the Undo window is measured on it.
  UPDATE public.chat_messages
     SET wrapped_at = clock_timestamp(), wrapped_by = v_me, settled_id = v_settled.id,
         reopened_at = NULL, reopened_by = NULL
   WHERE id = v_root.id
  RETURNING * INTO v_root;
  PERFORM public.module_activity_log(v_root.workspace_id, 'chat', 'chat_channel', v_root.channel_id,
    'chat.wrap_up', jsonb_build_object('message_id', v_root.id, 'settled_id', v_settled.id,
                                       'mark_decision', coalesce(p_mark_decision, false)));
  RETURN v_root;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_op_wrap_up(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_wrap_up(uuid, uuid, boolean) TO authenticated, service_role;

-- Opens a wrapped chain again (no-op on an open one). p_stamp false: the
-- reply or attach that reopens it writes its own line.
CREATE OR REPLACE FUNCTION public.chat__reopen_chain(p_root public.chat_messages, p_user uuid, p_at timestamptz)
RETURNS public.chat_messages
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_root public.chat_messages := p_root;
  v_undo boolean;
BEGIN
  IF v_root.wrapped_at IS NULL THEN
    RETURN v_root;
  END IF;
  -- The toast's Undo: the person who wrapped it, within 10 s, leaves no line.
  v_undo := v_root.wrapped_by = p_user AND clock_timestamp() - v_root.wrapped_at <= interval '10 seconds'
            AND p_at IS NULL;
  UPDATE public.chat_messages
     SET wrapped_at = NULL, wrapped_by = NULL, settled_id = NULL,
         reopened_at = CASE WHEN v_undo THEN NULL ELSE coalesce(p_at, clock_timestamp()) END,
         reopened_by = CASE WHEN v_undo THEN NULL ELSE p_user END
   WHERE id = v_root.id
  RETURNING * INTO v_root;
  PERFORM public.module_activity_log(v_root.workspace_id, 'chat', 'chat_channel', v_root.channel_id,
    'chat.reopen', jsonb_build_object('message_id', v_root.id, 'undo', v_undo));
  RETURN v_root;
END;
$$;

REVOKE ALL ON FUNCTION public.chat__reopen_chain(public.chat_messages, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat__reopen_chain(public.chat_messages, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_op_reopen(p_root_id uuid)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_root public.chat_messages;
  v_channel public.chat_channels;
BEGIN
  v_root := public.chat__chain_root(p_root_id);
  v_channel := public.chat_op__channel(v_root.channel_id);
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__may_wrap(v_channel, v_root, v_me) THEN
    RAISE EXCEPTION 'Only whoever started the chain, the channel''s managers and admins can reopen it.'
      USING ERRCODE = '42501';
  END IF;
  RETURN public.chat__reopen_chain(v_root, v_me, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.chat_op_reopen(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_reopen(uuid) TO authenticated, service_role;

-- ── 3. Reply to… ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_op_attach_to_chain(p_message_id uuid, p_reply_to_id uuid)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_quoted public.chat_messages;
  v_root public.chat_messages;
  v_channel public.chat_channels;
  v_old uuid;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  IF v_msg.id IS NULL OR NOT public.chat_can_read_channel(v_msg.channel_id) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  v_channel := public.chat_op__channel(v_msg.channel_id);
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.chat__can_manage(v_channel, v_me)
          OR (v_msg.author_id = v_me AND public.chat__can_post(v_channel, v_me))) THEN
    RAISE EXCEPTION 'You can only move your own messages.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.kind <> 'message' OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
  IF v_quoted.id IS NULL OR v_quoted.channel_id <> v_msg.channel_id
     OR v_quoted.deleted_at IS NOT NULL OR v_quoted.kind <> 'message' THEN
    RAISE EXCEPTION 'Pick a message in this conversation.' USING ERRCODE = '22023';
  END IF;
  IF (v_quoted.created_at, v_quoted.id) >= (v_msg.created_at, v_msg.id) THEN
    RAISE EXCEPTION 'A reply answers an earlier message.' USING ERRCODE = '22023';
  END IF;

  -- Both chains, in id order (two attaches at once never wait on each other).
  PERFORM 1 FROM public.chat_messages
   WHERE id IN (coalesce(v_quoted.parent_id, v_quoted.id), v_msg.id, coalesce(v_msg.parent_id, v_msg.id))
   ORDER BY id FOR UPDATE;
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
  SELECT * INTO v_root FROM public.chat_messages WHERE id = coalesce(v_quoted.parent_id, v_quoted.id);
  IF v_msg.deleted_at IS NOT NULL OR v_quoted.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  -- One level: a message other replies hang on stays their root.
  IF v_msg.parent_id IS NULL
     AND EXISTS (SELECT 1 FROM public.chat_messages c WHERE c.parent_id = v_msg.id) THEN
    RAISE EXCEPTION 'A message with replies of its own starts its chain.' USING ERRCODE = '22023';
  END IF;
  IF v_root.id = v_msg.id THEN
    RAISE EXCEPTION 'A message can''t reply to itself.' USING ERRCODE = '22023';
  END IF;
  IF v_msg.parent_id IS NOT DISTINCT FROM v_root.id AND v_msg.reply_to_id IS NOT DISTINCT FROM v_quoted.id THEN
    RETURN v_msg;
  END IF;

  v_old := v_msg.parent_id;
  UPDATE public.chat_messages SET parent_id = v_root.id, reply_to_id = v_quoted.id
   WHERE id = v_msg.id
  RETURNING * INTO v_msg;
  IF v_old IS NOT NULL AND v_old <> v_root.id THEN
    PERFORM public.chat__chain_refresh(v_old);
  END IF;
  PERFORM public.chat__chain_refresh(v_root.id);
  -- Joining a wrapped chain reopens it, as a new reply does (CH54).
  SELECT * INTO v_root FROM public.chat_messages WHERE id = v_root.id;
  PERFORM public.chat__reopen_chain(v_root, v_me, clock_timestamp());
  RETURN v_msg;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_op_attach_to_chain(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_attach_to_chain(uuid, uuid) TO authenticated, service_role;

-- ── 4. A reply reopens a wrapped chain (chat_op_send, from its live body) ────
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
     WHERE id = v_root.id
    RETURNING * INTO v_root;
    -- CV-12: a new reply to a wrapped chain reopens it, visibly (CH54).
    PERFORM public.chat__reopen_chain(v_root, v_me, v_msg.created_at);
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

REVOKE ALL ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) TO authenticated, service_role;

-- ── 5. Hidden replies stay in Catch up until their chain is read ────────────
-- (chat__close_read, from its live body: one condition added.)
CREATE OR REPLACE FUNCTION public.chat__close_read(p_user uuid, p_channel_id uuid, p_upto chat_messages)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT public.chat__close(p_user, ARRAY(
    SELECT k.id
      FROM public.chat_catchup k
     WHERE k.user_id = p_user AND k.channel_id = p_channel_id AND k.done_at IS NULL
       AND k.reason IN ('dm', 'mention', 'team_mention', 'everyone', 'reply', 'announcement', 'every_message')
       AND public.chat__read_covers(p_upto, k.message_id)
       -- CV-12: a reply in a wrapped chain isn't drawn in the stream, so
       -- reading the stream past it doesn't read it.
       AND NOT EXISTS (SELECT 1
                         FROM public.chat_messages m
                         JOIN public.chat_messages r ON r.id = m.parent_id
                        WHERE m.id = k.message_id AND r.wrapped_at IS NOT NULL)), 'read', p_upto)
$function$;

REVOKE ALL ON FUNCTION public.chat__close_read(uuid, uuid, chat_messages) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat__close_read(uuid, uuid, chat_messages) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_op_chain_read(p_root_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_root public.chat_messages;
BEGIN
  SELECT * INTO v_root FROM public.chat_messages WHERE id = p_root_id;
  IF v_root.id IS NULL OR NOT public.chat_can_read_channel(v_root.channel_id) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__reader(v_root.channel_id);
  RETURN public.chat__close(v_me, ARRAY(
    SELECT k.id
      FROM public.chat_catchup k
      LEFT JOIN public.chat_messages m ON m.id = k.message_id
     WHERE k.user_id = v_me AND k.channel_id = v_root.channel_id AND k.done_at IS NULL
       AND k.reason IN ('dm', 'mention', 'team_mention', 'everyone', 'reply', 'announcement', 'every_message')
       AND (k.chain_root_id = v_root.id OR m.parent_id = v_root.id OR m.id = v_root.id)), 'read');
END;
$$;

REVOKE ALL ON FUNCTION public.chat_op_chain_read(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_chain_read(uuid) TO authenticated, service_role;
