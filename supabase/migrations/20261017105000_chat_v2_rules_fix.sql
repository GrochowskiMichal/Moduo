-- Chat v2 · CV-2-fix: three rules CV-2a and CV-2b share (specs/chat-v2.md §12,
-- §Assumptions #13; CH3a). The stamp is provisional: it must stay after
-- …_chat_v2_conversation_ops (CV-2b). It runs again cleanly over itself.
--
-- The rules:
--   1. One manager rule everywhere. A manager is someone with a manager row who
--      is in the channel and whose role posts (chat__is_manager); an admin is
--      the owner or a role with "Manage any channel" (chat__can_manage). Posting
--      in an announcement channel, pinning there and switching announcement-only
--      read that rule, never a bare manager row. A send checks it before it
--      brings the sender back into the channel. The account erasure counts the
--      managers that remain the way the hand-over does, and hands a channel
--      only to someone whose role posts.
--   2. A removal is its own stamp. chat_members.removed_at marks "a manager
--      removed this person"; removed_by only says who, and goes when that
--      person's account goes. Every check of "was removed" reads removed_at,
--      the message row trigger too (so a removed person posts nothing there,
--      through an app either). A removal is a way of leaving (left_at is set
--      with it), and only a manager or admin adding the person back clears it.
--   3. A channel's name clashes only with channels its creator can see. Public
--      channels are unique among themselves, ignoring case (the index); a name
--      is also refused when a private channel the creator (or renamer) is in
--      uses it. A private channel someone isn't in never refuses their name.
--      General is made on the workspace's behalf, so only public names count.
--
-- Every redefined function starts from its live body (2026-10-15). Grants are
-- re-stated and asserted at the end; the sending limits (chat_send_limit,
-- chat_op_typing) are untouched and asserted in place.

SET LOCAL lock_timeout = '5s';

-- ── 1. The removal stamp ────────────────────────────────────────────────────

ALTER TABLE public.chat_members ADD COLUMN IF NOT EXISTS removed_at timestamptz;

-- Every removal so far: stamped when it happened.
UPDATE public.chat_members
   SET removed_at = left_at
 WHERE removed_by IS NOT NULL AND left_at IS NOT NULL AND removed_at IS NULL;
-- A remover recorded on an active row records nothing: no removal is in effect.
UPDATE public.chat_members
   SET removed_by = NULL
 WHERE removed_by IS NOT NULL AND left_at IS NULL;

ALTER TABLE public.chat_members DROP CONSTRAINT IF EXISTS chat_members_removal_check;
ALTER TABLE public.chat_members ADD CONSTRAINT chat_members_removal_check
  CHECK ((removed_at IS NULL OR left_at IS NOT NULL)
         AND (removed_by IS NULL OR removed_at IS NOT NULL));

-- Someone a manager removed, whoever removed them.
CREATE OR REPLACE FUNCTION public.chat__was_removed(p_channel_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.chat_members mb
                  WHERE mb.channel_id = p_channel_id AND mb.user_id = p_user
                    AND mb.left_at IS NOT NULL AND mb.removed_at IS NOT NULL)
$function$;

-- Joining, or being added back by a manager: the removal ends with it.
CREATE OR REPLACE FUNCTION public.chat__enter(p_channel_id uuid, p_workspace_id uuid, p_user uuid, p_level text DEFAULT 'mentions'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_newest public.chat_messages;
  v_rows int;
BEGIN
  SELECT * INTO v_newest FROM public.chat_messages m
   WHERE m.channel_id = p_channel_id
   ORDER BY m.created_at DESC, m.id DESC
   LIMIT 1;
  INSERT INTO public.chat_members AS mb
    (channel_id, user_id, workspace_id, notify_level, last_read_id, last_read_at, joined_at)
  VALUES
    (p_channel_id, p_user, p_workspace_id, p_level, v_newest.id, coalesce(v_newest.created_at, now()), now())
  ON CONFLICT (channel_id, user_id) DO UPDATE
    SET left_at = NULL,
        removed_by = NULL,
        removed_at = NULL,
        joined_at = now(),
        last_read_id = excluded.last_read_id,
        last_read_at = excluded.last_read_at
    WHERE mb.left_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_leave(p_channel_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_member public.chat_members;
  v_new uuid;
BEGIN
  -- Leaving twice is fine (the second time you may not read it any more).
  SELECT * INTO v_member FROM public.chat_members WHERE channel_id = p_channel_id AND user_id = v_me;
  IF v_member.channel_id IS NOT NULL AND v_member.left_at IS NOT NULL THEN
    RETURN;
  END IF;
  v_channel := public.chat_op__reader(p_channel_id);
  IF v_member.channel_id IS NULL THEN
    RETURN;
  END IF;
  -- One change of who manages it at a time (see chat__hand_over).
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  -- Only an active row: a removal that landed meanwhile stays a removal.
  UPDATE public.chat_members SET left_at = now(), removed_by = NULL, removed_at = NULL
   WHERE channel_id = p_channel_id AND user_id = v_me AND left_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  DELETE FROM public.chat_channel_managers WHERE channel_id = p_channel_id AND user_id = v_me;
  IF FOUND THEN
    v_new := public.chat__hand_over(p_channel_id, v_me);
  END IF;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.leave', CASE WHEN v_new IS NOT NULL THEN jsonb_build_object('manager_id', v_new) ELSE '{}'::jsonb END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_remove_member(p_channel_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_new uuid;
BEGIN
  IF v_me IS NOT NULL AND p_user_id = v_me THEN
    PERFORM public.chat_op_leave(p_channel_id);
    RETURN;
  END IF;
  v_channel := public.chat_op__channel(p_channel_id);
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'People can''t be removed from a direct message.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can remove people.' USING ERRCODE = '42501';
  END IF;
  -- One change of who manages it at a time (see chat__hand_over).
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  -- The removal is its stamp; removed_by only says who.
  UPDATE public.chat_members SET left_at = now(), removed_at = now(), removed_by = v_me
   WHERE channel_id = p_channel_id AND user_id = p_user_id AND left_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  DELETE FROM public.chat_channel_managers WHERE channel_id = p_channel_id AND user_id = p_user_id;
  IF FOUND THEN
    v_new := public.chat__hand_over(p_channel_id, p_user_id);
  END IF;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.member_remove',
    jsonb_build_object('user_id', p_user_id)
      || CASE WHEN v_new IS NOT NULL THEN jsonb_build_object('manager_id', v_new) ELSE '{}'::jsonb END);
END;
$function$;

-- ── 2. One manager rule ─────────────────────────────────────────────────────

-- The send: an announcement channel takes its managers' posts only, checked
-- before posting brings the sender back into the channel.
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
  v_notify jsonb := '[]'::jsonb;
  v_op text;
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

  -- The bell, as v1 rang it, until CV-5's fan-out replaces it: people named,
  -- everyone on @channel, and on a reply the chain's people; only those who can
  -- read the conversation, never the sender.
  SELECT coalesce(jsonb_agg(DISTINCT s.uid::text), '[]'::jsonb) INTO v_notify FROM (
    SELECT unnest(v_people) AS uid
    UNION
    SELECT m.user_id FROM public.chat_members m
     WHERE v_everyone AND m.channel_id = p_channel_id AND m.left_at IS NULL AND m.notify_level <> 'none'
    UNION
    SELECT v_root.author_id WHERE v_root.id IS NOT NULL
    UNION
    SELECT v_quoted.author_id WHERE v_quoted.id IS NOT NULL
    UNION
    SELECT r.author_id FROM public.chat_messages r
     WHERE v_root.id IS NOT NULL AND r.parent_id = v_root.id AND r.deleted_at IS NULL
  ) s
  WHERE s.uid IS NOT NULL AND s.uid IS DISTINCT FROM v_me
    AND public.chat__can_read_channel_as(p_channel_id, s.uid);

  IF v_notify <> '[]'::jsonb THEN
    v_op := CASE WHEN cardinality(v_people) > 0 OR v_everyone THEN 'chat.mention' ELSE 'chat.reply' END;
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id, v_op,
      jsonb_build_object(
        'message_id', v_msg.id,
        'parent_id', v_root.id,
        'reply_to_id', v_quoted.id,
        'channel_name', v_channel.name,
        'channel_kind', v_channel.kind,
        'excerpt', public.chat__excerpt(v_body),
        'format_version', 2,
        'notify_user_ids', v_notify));
  END IF;
  RETURN v_msg;
END;
$function$;

-- The backstop on every message row (an app posts as its key's creator): a
-- role that posts, not removed from the conversation, a manager in effect in an
-- announcement channel.
CREATE OR REPLACE FUNCTION public.share_chat_message_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_channel public.chat_channels;
  -- An app's message has no author; it posts as its key's creator.
  v_author uuid := coalesce(NEW.author_id, public.perm_actor_id());
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = NEW.channel_id;
  IF NOT public.chat_has_cap(NEW.workspace_id, v_author, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF NEW.kind <> 'event' AND public.chat__was_removed(NEW.channel_id, v_author) THEN
    RAISE EXCEPTION 'You were removed from this conversation.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.managers_only AND NOT public.chat__is_manager(v_channel, v_author) THEN
    RAISE EXCEPTION 'Only managers can post in this channel.' USING ERRCODE = '42501';
  END IF;
  IF NEW.mentions_everyone
     AND NOT public.chat_has_cap(NEW.workspace_id, v_author, 'mention_everyone') THEN
    RAISE EXCEPTION 'Your role can''t mention everyone.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Pin: whoever can post there (managers in effect in an announcement channel)
-- and holders of "Manage any channel".
CREATE OR REPLACE FUNCTION public.chat_op_pin(p_message_id uuid, p_pinned boolean DEFAULT true)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_channel public.chat_channels;
BEGIN
  IF p_pinned IS NULL THEN
    RAISE EXCEPTION 'Say whether to pin or unpin.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  v_channel := public.chat_op__channel(v_msg.channel_id);
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message can be pinned.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'manage_any')
     AND NOT public.chat__can_post(v_channel, v_me) THEN
    RAISE EXCEPTION 'Your role can''t pin messages here.' USING ERRCODE = '42501';
  END IF;
  IF p_pinned = (v_msg.pinned_at IS NOT NULL) THEN
    RETURN v_msg;
  END IF;
  -- One pin at a time per conversation, so the cap holds.
  PERFORM pg_advisory_xact_lock(hashtext('chat_pin:' || v_msg.channel_id::text));
  IF p_pinned AND (SELECT count(*) FROM public.chat_messages p
                    WHERE p.channel_id = v_msg.channel_id AND p.pinned_at IS NOT NULL
                      AND p.deleted_at IS NULL) >= 100 THEN
    RAISE EXCEPTION 'This conversation has 100 pinned messages; unpin one first.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.chat_messages
     SET pinned_at = CASE WHEN p_pinned THEN now() END,
         pinned_by = CASE WHEN p_pinned THEN v_me END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.pin', jsonb_build_object('message_id', v_msg.id, 'pinned', p_pinned));
  RETURN v_msg;
END;
$function$;

-- Announcement-only: the channel's managers in effect and admins.
CREATE OR REPLACE FUNCTION public.share_op_announce(p_channel_id uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_channel public.chat_channels;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF v_channel.id IS NULL OR NOT public.chat_can_read_channel(p_channel_id) THEN
    RAISE EXCEPTION 'That channel is gone.';
  END IF;
  PERFORM public.chat_op__guard(v_channel.workspace_id);
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages can''t be announcement-only.';
  END IF;
  IF NOT public.chat__can_manage(v_channel, auth.uid()) THEN
    RAISE EXCEPTION 'Only a channel manager can change this.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.chat_channels SET managers_only = coalesce(p_on, false) WHERE id = p_channel_id;
END;
$function$;

-- The account erasure: a channel the person managed is handed on unless
-- someone else still manages it, counted the way chat__hand_over counts them
-- (chat__can_manage), and only to someone whose role posts (a manager in
-- effect once in the channel). Anchored replaces on the live body, like
-- 20261014155205; each pair is applied once.
DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_old text[] := ARRAY[
$old1$      AND NOT EXISTS (
        SELECT 1 FROM public.chat_channel_managers m2
        WHERE m2.channel_id = c.id AND m2.user_id <> p_user
          AND NOT EXISTS (SELECT 1 FROM public.chat_members lm WHERE lm.channel_id = c.id
                          AND lm.user_id = m2.user_id AND lm.left_at IS NOT NULL)
          AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                       WHERE wm.workspace_id = c.workspace_id AND wm.user_id = m2.user_id)
               OR EXISTS (SELECT 1 FROM public.workspaces w
                          WHERE w.id = c.workspace_id AND w.owner_id = m2.user_id)))$old1$,
$old2$      WHERE cm.channel_id = r.id AND cm.user_id <> p_user AND cm.left_at IS NULL
$old2$,
$old3$        WHERE m.workspace_id = r.workspace_id AND m.user_id <> p_user
$old3$];
  v_new text[] := ARRAY[
$new1$      AND NOT EXISTS (
        SELECT 1 FROM public.chat_channel_managers m2
        WHERE m2.channel_id = c.id AND m2.user_id <> p_user
          -- One manager rule (chat__can_manage): in the channel, in a role that
          -- posts, or an admin.
          AND public.chat__can_manage(c, m2.user_id))$new1$,
$new2$      WHERE cm.channel_id = r.id AND cm.user_id <> p_user AND cm.left_at IS NULL
        AND public.chat_has_cap(r.workspace_id, cm.user_id, 'post')
$new2$,
$new3$        WHERE m.workspace_id = r.workspace_id AND m.user_id <> p_user
          AND public.chat_has_cap(r.workspace_id, m.user_id, 'post')
$new3$];
  v_changed boolean := false;
BEGIN
  FOR i IN 1..array_length(v_old, 1) LOOP
    CONTINUE WHEN position(v_new[i] IN v_def) > 0; -- re-run
    IF (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]) <> 1 THEN
      RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects (part %); redefine it by hand.', i;
    END IF;
    v_def := replace(v_def, v_old[i], v_new[i]);
    v_changed := true;
  END LOOP;
  IF v_changed THEN
    EXECUTE v_def;
  END IF;
END;
$erase$;

-- ── 3. Channel names ────────────────────────────────────────────────────────

-- Public channels: unique ignoring case among live ones. Private channels are
-- checked by the ops against what the creator can see, never by an index (an
-- index refuses whatever it holds, seen or not).
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_public_name_uq
  ON public.chat_channels (workspace_id, lower(name))
  WHERE kind = 'channel' AND deleted_at IS NULL AND NOT is_private;
DROP INDEX IF EXISTS public.chat_channels_live_name_uq;
DROP INDEX IF EXISTS public.chat_channels_name_uq;

-- Taken: a live channel of that name the person can see (any public one, a
-- private one they're in). With no person, public channels only.
DROP FUNCTION IF EXISTS public.chat__name_taken(uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.chat__name_taken(p_workspace_id uuid, p_name text, p_except uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.chat_channels c
                  WHERE c.workspace_id = p_workspace_id AND c.kind = 'channel'
                    AND c.deleted_at IS NULL AND lower(c.name) = lower(p_name)
                    AND c.id IS DISTINCT FROM p_except
                    AND (NOT c.is_private
                         OR (p_user IS NOT NULL
                             AND EXISTS (SELECT 1 FROM public.chat_members mb
                                          WHERE mb.channel_id = c.id AND mb.user_id = p_user
                                            AND mb.left_at IS NULL))))
$function$;

-- One create or rename per name at a time, so two private channels someone is
-- in can't take one name at once (no index holds private names).
CREATE OR REPLACE FUNCTION public.chat__lock_name(p_workspace_id uuid, p_name text)
 RETURNS void
 LANGUAGE sql
 VOLATILE
 SET search_path TO ''
AS $function$
  SELECT pg_advisory_xact_lock(hashtextextended(
    'chat_channel_name:' || p_workspace_id::text || ':' || lower(p_name), 0))
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_create_channel(p_workspace_id uuid, p_name text, p_topic text DEFAULT ''::text, p_is_private boolean DEFAULT false, p_member_ids uuid[] DEFAULT '{}'::uuid[], p_announcement boolean DEFAULT false)
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_name text;
  v_topic text;
  v_private boolean := coalesce(p_is_private, false);
  v_channel public.chat_channels;
  v_uid uuid;
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  IF v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_private') THEN
    RAISE EXCEPTION 'Your role can''t create private channels.' USING ERRCODE = '42501';
  ELSIF NOT v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_public') THEN
    RAISE EXCEPTION 'Your role can''t create channels.' USING ERRCODE = '42501';
  END IF;
  v_name := public.chat__channel_name(p_name);
  v_topic := public.chat__channel_topic(p_topic);
  -- The name clashes only with channels the creator can see.
  PERFORM public.chat__lock_name(p_workspace_id, v_name);
  IF public.chat__name_taken(p_workspace_id, v_name, NULL, v_me) THEN
    RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO public.chat_channels (workspace_id, kind, name, topic, is_private, managers_only, created_by)
    VALUES (p_workspace_id, 'channel', v_name, v_topic, v_private, coalesce(p_announcement, false), v_me)
    RETURNING * INTO v_channel;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
  END;

  -- The creator is on Mentions and replies, like everyone (AC1.7).
  PERFORM public.chat__enter(v_channel.id, p_workspace_id, v_me);
  FOREACH v_uid IN ARRAY coalesce(p_member_ids, '{}'::uuid[]) LOOP
    IF v_uid IS NOT NULL AND v_uid <> v_me AND public.chat_is_workspace_member(p_workspace_id, v_uid) THEN
      PERFORM public.chat__enter(v_channel.id, p_workspace_id, v_uid);
    END IF;
  END LOOP;

  PERFORM public.entities_op_upsert(p_workspace_id, 'chat_channel', v_channel.id, v_name, NULL);
  PERFORM public.module_activity_log(p_workspace_id, 'chat', 'chat_channel', v_channel.id,
    'chat.channel_create', jsonb_build_object('is_private', v_channel.is_private));
  RETURN v_channel;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_update_channel(p_channel_id uuid, p_name text DEFAULT NULL::text, p_topic text DEFAULT NULL::text)
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_name text := v_channel.name;
  v_topic text := v_channel.topic;
  v_renamed boolean := false;
  v_retopic boolean := false;
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages don''t have a name or topic.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NOT NULL THEN
    v_name := public.chat__channel_name(p_name);
    v_renamed := v_name IS DISTINCT FROM v_channel.name;
  END IF;
  IF p_topic IS NOT NULL THEN
    v_topic := public.chat__channel_topic(p_topic);
    v_retopic := v_topic IS DISTINCT FROM v_channel.topic;
  END IF;
  IF v_renamed AND NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can rename it.' USING ERRCODE = '42501';
  END IF;
  IF v_retopic AND NOT (public.chat__can_manage(v_channel, v_me) OR public.chat__can_post(v_channel, v_me)) THEN
    RAISE EXCEPTION 'Your role can''t change this channel''s topic.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_renamed AND NOT v_retopic THEN
    RETURN v_channel;
  END IF;
  -- The new name clashes only with channels the renamer can see.
  IF v_renamed THEN
    PERFORM public.chat__lock_name(v_channel.workspace_id, v_name);
    IF public.chat__name_taken(v_channel.workspace_id, v_name, v_channel.id, v_me) THEN
      RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
    END IF;
  END IF;

  BEGIN
    UPDATE public.chat_channels SET name = v_name, topic = v_topic
     WHERE id = p_channel_id
    RETURNING * INTO v_channel;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
  END;

  IF v_renamed THEN
    PERFORM public.entities_op_upsert(v_channel.workspace_id, 'chat_channel', v_channel.id, v_name, NULL);
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
      'chat.channel_rename', '{}'::jsonb);
  END IF;
  IF v_retopic THEN
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
      'chat.channel_topic', '{}'::jsonb);
  END IF;
  RETURN v_channel;
END;
$function$;

-- General is made on the workspace's behalf: only public names count, so it
-- never steps around (and so never hints at) a private channel's name.
CREATE OR REPLACE FUNCTION public.chat_op_bootstrap(p_workspace_id uuid)
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_general public.chat_channels;
  v_owner uuid;
  v_name text;
  v_bypass text;
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  -- Nothing to do (the usual open): General is there and nobody lacks a row.
  SELECT * INTO v_general FROM public.chat_channels
   WHERE workspace_id = p_workspace_id AND is_default;
  IF v_general.id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                      WHERE wm.workspace_id = p_workspace_id
                        AND NOT EXISTS (SELECT 1 FROM public.chat_members mb
                                         WHERE mb.channel_id = v_general.id AND mb.user_id = wm.user_id)) THEN
    RETURN v_general;
  END IF;
  -- One bootstrap per workspace at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat_op_bootstrap:' || p_workspace_id::text, 0));

  SELECT * INTO v_general FROM public.chat_channels
   WHERE workspace_id = p_workspace_id AND is_default;
  SELECT owner_id INTO v_owner FROM public.workspaces WHERE id = p_workspace_id;
  IF v_general.id IS NULL THEN
    -- A workspace from before General: the live public "general" v1's
    -- bootstrap made (in the owner's name) becomes it; a member's own channel
    -- of that name never does.
    UPDATE public.chat_channels c SET is_default = true
     WHERE c.id = (SELECT g.id FROM public.chat_channels g
                    WHERE g.workspace_id = p_workspace_id AND g.kind = 'channel'
                      AND lower(g.name) = 'general' AND g.deleted_at IS NULL
                      AND g.archived_at IS NULL AND NOT g.is_private
                      AND (g.created_by IS NULL OR g.created_by = v_owner)
                    ORDER BY g.created_at, g.id
                    LIMIT 1)
    RETURNING * INTO v_general;
  END IF;
  IF v_general.id IS NULL THEN
    -- Made on the workspace's behalf, whoever opens chat first (a viewer too).
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    FOR i IN 1..50 LOOP
      v_name := CASE WHEN i = 1 THEN 'General' ELSE 'General ' || i END;
      PERFORM public.chat__lock_name(p_workspace_id, v_name);
      -- Public names only (no person): a private channel's name never counts.
      CONTINUE WHEN public.chat__name_taken(p_workspace_id, v_name, NULL, NULL);
      INSERT INTO public.chat_channels (workspace_id, kind, name, topic, created_by, is_default)
      VALUES (p_workspace_id, 'channel', v_name, 'Everyone in the workspace', v_owner, true)
      RETURNING * INTO v_general;
      EXIT;
    END LOOP;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
    IF v_general.id IS NULL THEN
      RAISE EXCEPTION 'General couldn''t be made.' USING ERRCODE = '23505';
    END IF;
    PERFORM public.entities_op_upsert(p_workspace_id, 'chat_channel', v_general.id, v_general.name, NULL);
  END IF;

  -- Everyone in the workspace who has no row in General joins it; a row with
  -- left_at (they left, or were removed) keeps them out. Never a private one.
  IF v_general.archived_at IS NULL AND v_general.deleted_at IS NULL AND NOT v_general.is_private THEN
    INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
    SELECT v_general.id, u.user_id, p_workspace_id
      FROM (SELECT wm.user_id FROM public.workspace_members wm WHERE wm.workspace_id = p_workspace_id
            UNION
            SELECT w.owner_id FROM public.workspaces w WHERE w.id = p_workspace_id) u
     WHERE u.user_id IS NOT NULL
    ON CONFLICT (channel_id, user_id) DO NOTHING;
  END IF;
  RETURN v_general;
END;
$function$;

-- ── 4. Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal helpers: only the ops and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__was_removed(uuid, uuid)',
    'chat__enter(uuid, uuid, uuid, text)',
    'chat__name_taken(uuid, text, uuid, uuid)',
    'chat__lock_name(uuid, text)'
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
    'chat_op_leave(uuid)',
    'chat_op_remove_member(uuid, uuid)',
    'chat_op_send(uuid, uuid, text, uuid)',
    'chat_op_pin(uuid, boolean)',
    'share_op_announce(uuid, boolean)',
    'chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean)',
    'chat_op_update_channel(uuid, text, text)',
    'chat_op_bootstrap(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
  -- Server-only: the message trigger and the account erasure.
  REVOKE ALL ON FUNCTION public.share_chat_message_guard() FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.share_chat_message_guard() TO service_role;
  REVOKE ALL ON FUNCTION public.account_erase_workspace_data(uuid, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.account_erase_workspace_data(uuid, boolean) TO service_role;
  IF has_function_privilege('authenticated', 'public.share_chat_message_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.share_chat_message_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.account_erase_workspace_data(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.account_erase_workspace_data(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'share_chat_message_guard and account_erase_workspace_data must be server-only.';
  END IF;
END;
$$;

-- ── 5. Assert the result ────────────────────────────────────────────────────

DO $$
DECLARE
  v_bad text;
BEGIN
  -- One manager rule: no check reads a bare manager row.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.oid IN ('public.chat_op_pin(uuid, boolean)'::regprocedure,
                   'public.share_op_announce(uuid, boolean)'::regprocedure,
                   'public.share_chat_message_guard()'::regprocedure,
                   'public.chat_op_send(uuid, uuid, text, uuid)'::regprocedure)
     AND pg_get_functiondef(p.oid) ~ 'chat_channel_managers';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'These still read manager rows directly: %', v_bad;
  END IF;
  IF position('chat__can_manage(c, m2.user_id)' IN
              pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure)) = 0
     OR position('chat_has_cap(r.workspace_id, cm.user_id, ''post'')' IN
              pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data does not count managers through chat__can_manage.';
  END IF;
  -- A removal is its own stamp.
  IF pg_get_functiondef('public.chat__was_removed(uuid, uuid)'::regprocedure) ~ 'removed_by' THEN
    RAISE EXCEPTION 'chat__was_removed must read removed_at, not removed_by.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.chat_members'::regclass
                  AND conname = 'chat_members_removal_check' AND convalidated) THEN
    RAISE EXCEPTION 'chat_members_removal_check must hold.';
  END IF;
  -- Names: one index, public channels only; the old ones are gone.
  IF to_regclass('public.chat_channels_name_uq') IS NOT NULL
     OR to_regclass('public.chat_channels_live_name_uq') IS NOT NULL
     OR pg_get_indexdef('public.chat_channels_public_name_uq'::regclass) !~ 'NOT is_private' THEN
    RAISE EXCEPTION 'Channel names must be held unique among public channels only.';
  END IF;
  IF to_regprocedure('public.chat__name_taken(uuid, text, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'The 3-argument chat__name_taken must be gone.';
  END IF;
  -- The sending limits are untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.chat_messages'::regclass AND tgname = 'chat_send_limit'
                   AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.chat_messages'::regclass AND tgname = 'share_chat_message_guard'
                      AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'The chat_send_limit and share_chat_message_guard triggers must be in place.';
  END IF;
END;
$$;
