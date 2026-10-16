-- Chat v2 · CV-21 Agents and MCP tools (specs/chat-v2.md §14, §11; §6 #12, #25;
-- §Assumptions #14, #35; .design/chat-v2/research/round-3-database.md §2.3,
-- §2.25 f). The stamp is fixed by the build's migration queue; it must stay
-- after …_chat_v2_decisions (CV-14: chat_op_mark_decision, chat_op_wrap_up),
-- …_chat_v2_move_messages (CV-16), …_chat_v2_quiet_hours (CV-18:
-- chat__notify_devices, chat__notice_switch_on) and the custom emoji block
-- (CV-20: chat_op_react). Every redefined function starts from its live body on
-- the local stack. It runs again cleanly over itself.
--
-- What it does:
--   1. workspace_api_keys.include_private_chat ("Include private channels I'm
--      in", off by default). KEYS-1's scopes map, its normalizer and its CHECK
--      are untouched. Set by workspace_api_keys_set_private_chat: only the
--      key's creator turns it on (it opens their own channels), any key
--      manager turns it off.
--   2. A key acts as its creator, inside the key's rules:
--      chat__key_actor(need) answers the key's workspace, its creator and the
--      switch (Chat: View or Edit as KEYS-1 caps it, the plan, a creator who
--      still reads chat there); chat__key_reads_channel(channel, creator,
--      private_ok) is the one rule for what a key reads: channels only (never
--      a direct message), public ones, and private ones only with the switch
--      while its creator is a member.
--   3. chat_op_agent_post (live body, same signature, so the deployed
--      connector keeps working until it is redeployed): the post is its
--      creator's, "via <key>": author_id the creator, author_kind 'api_key',
--      author_label the key's name, api_key_id the key. Its fourth argument is
--      the message it answers (a chain's root reads as before); the reply joins
--      that chain like a person's. Mentions are read as a person's send reads
--      them, so @channel from a creator who may not is plain text; an
--      announcement channel only for a creator who manages it (the guard). The
--      per-key send limit (chat_send_limit: 30 a minute) now applies, since
--      api_key_id is set. It doesn't move the creator's read mark: a post
--      through a key counts as new for its creator.
--   4. Fan-out (chat__fan_out, chat__notify_devices, chat__activity,
--      chat__sender_label): a key's post reaches its creator like anyone's
--      (mentions, Every message); a reply to a key's post reaches its creator
--      only while that key's notification switch is on
--      (user_preferences.preferences.chatKeyReplies.<key id>, on when unset),
--      unless it mentions them; its own replies are new to its creator but
--      never a reply item for them; the bell, notices and emails say
--      "<person> · via <key>".
--   5. Counts (chat_unread_counts, chat_catchup_open): a key's posts count as
--      unread for their creator; replies to them count only through the switch.
--   6. The app's ops the tools need, each one body for both callers:
--      chat__react_as, chat__mark_decision_as, chat__wrap_up_as,
--      chat__create_channel_as take the acting person; chat_op_react,
--      chat_op_mark_decision, chat_op_wrap_up, chat_op_create_channel pass
--      auth.uid() (unchanged for the app), and chat_op_agent_react,
--      _mark_decision, _wrap_up, _create_channel pass the key's creator after
--      the key's rules.
--   7. Reads for the connector, as the creator through the key's rule:
--      chat_agent_conversations, chat_agent_messages (a conversation or a
--      chain, keyset pages), chat_agent_search (chat_search's query, shared
--      through chat__search_in), chat_agent_addressed (the creator's open
--      Catch up items, never a direct message).
--   8. chat_key_readers(channel): who has a key that reads this private
--      channel, for Details' "An app of Alex's can read this"; chat_my_keys:
--      your keys that read chat, for Settings' reply switches.
--
-- Left as they are: chat_op_send and the person's other ops (a key still gets
-- "You don't have access to this workspace."); v1 app rows keep a null author
-- and read "<key name>"; chat__move_relink still relinks people's messages
-- only.

SET LOCAL lock_timeout = '5s';

-- ── 1. The switch on the key ────────────────────────────────────────────────

ALTER TABLE public.workspace_api_keys
  ADD COLUMN IF NOT EXISTS include_private_chat boolean NOT NULL DEFAULT false;

-- Clients read keys column by column (the hash never): add this one.
GRANT SELECT (include_private_chat) ON public.workspace_api_keys TO authenticated;

COMMENT ON COLUMN public.workspace_api_keys.include_private_chat IS
  'Chat (CV-21): the key also reads the private channels its creator is a member of. Off by default; only the creator turns it on.';

CREATE OR REPLACE FUNCTION public.workspace_api_keys_set_private_chat(p_key_id uuid, p_on boolean)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
DECLARE
  k public.workspace_api_keys;
BEGIN
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Say whether to include private channels.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO k FROM public.workspace_api_keys WHERE id = p_key_id FOR UPDATE;
  IF k.id IS NULL OR NOT public.workspace_api_keys_can_manage(k.workspace_id) THEN
    RAISE EXCEPTION 'API key not found.' USING ERRCODE = 'P0002';
  END IF;
  IF k.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This key was revoked — create a new one instead.';
  END IF;
  IF k.expires_at IS NOT NULL AND k.expires_at <= now() THEN
    RAISE EXCEPTION 'This key has expired — create a new one instead.';
  END IF;
  -- Its private channels are its creator's: only they open them to the key.
  IF p_on AND NOT k.include_private_chat AND k.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the person who created this key can let it read their private channels.'
      USING ERRCODE = '42501';
  END IF;
  IF k.include_private_chat <> p_on THEN
    UPDATE public.workspace_api_keys SET include_private_chat = p_on WHERE id = k.id;
  END IF;
  RETURN p_on;
END;
$$;

-- ── 2. A key acts as its creator ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat__key_actor(
  p_need text,
  OUT workspace_id uuid,
  OUT creator uuid,
  OUT private_ok boolean)
  RETURNS record
  LANGUAGE plpgsql
  STABLE
  SET search_path = ''
AS $$
DECLARE
  v_key uuid := public.module_api_key_id();
  v_scope text;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Only an API key can do this.' USING ERRCODE = '42501';
  END IF;
  SELECT k.workspace_id, k.created_by, k.include_private_chat
    INTO workspace_id, creator, private_ok
    FROM public.workspace_api_keys k
   WHERE k.id = v_key AND k.revoked_at IS NULL
     AND (k.expires_at IS NULL OR k.expires_at > now());
  IF workspace_id IS NULL OR creator IS NULL THEN
    RAISE EXCEPTION 'This API key can''t read chat.' USING ERRCODE = '42501';
  END IF;
  -- KEYS-1's level, capped by what the creator may do in chat now.
  v_scope := public.chat_key_scope(workspace_id);
  IF p_need = 'edit' AND v_scope <> 'edit' THEN
    RAISE EXCEPTION 'This API key can''t post to chat — give it Chat: Edit in Workspace settings → API keys.'
      USING ERRCODE = '42501';
  ELSIF v_scope NOT IN ('view', 'edit') THEN
    RAISE EXCEPTION 'This API key can''t read chat — give it Chat: View in Workspace settings → API keys.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat_workspace_enabled(workspace_id) THEN
    RAISE EXCEPTION 'Chat is available on the Duo and Team plans.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__reads_workspace(workspace_id, creator) THEN
    RAISE EXCEPTION 'This API key can''t read chat.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- What a key reads: a channel (never a direct message) its creator reads now,
-- and a private one only with the key's switch on (its creator is a member then).
CREATE OR REPLACE FUNCTION public.chat__key_reads_channel(p_channel_id uuid, p_creator uuid, p_private_ok boolean)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT p_creator IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channels c
     WHERE c.id = p_channel_id AND c.kind = 'channel' AND c.deleted_at IS NULL
       AND (NOT c.is_private OR coalesce(p_private_ok, false)))
    AND public.chat__can_read_channel_as(p_channel_id, p_creator)
$$;

CREATE OR REPLACE FUNCTION public.chat__key_channel_ids(p_workspace_id uuid, p_creator uuid, p_private_ok boolean)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT r.id
    FROM public.chat__readable_channel_ids(p_workspace_id, p_creator) AS r(id)
    JOIN public.chat_channels c ON c.id = r.id
   WHERE c.kind = 'channel' AND (NOT c.is_private OR coalesce(p_private_ok, false))
$$;

-- A reply to a post made through a key reaches the key's creator only while
-- that key's notification switch is on (on when unset). Any other message: true.
CREATE OR REPLACE FUNCTION public.chat__key_replies_on(p_user uuid, p_key uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT p_key IS NULL OR coalesce((
    SELECT CASE WHEN jsonb_typeof(v.val) = 'boolean' THEN (v.val #>> '{}')::boolean END
      FROM public.user_preferences up
     CROSS JOIN LATERAL (SELECT up.preferences -> 'chatKeyReplies' -> (p_key::text) AS val) v
     WHERE up.user_id = p_user), true)
$$;

-- The guards of the app's ops, for a given person (the signed-in one, or a
-- key's creator after the key's rules). Same answers as chat_op__guard,
-- chat_op__reader and chat_op__channel give auth.uid().
CREATE OR REPLACE FUNCTION public.chat__op_guard_as(p_workspace_id uuid, p_user uuid)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SET search_path = 'public'
AS $$
BEGIN
  IF p_user IS NULL OR NOT public.chat_is_workspace_member(p_workspace_id, p_user) THEN
    RAISE EXCEPTION 'You don''t have access to this workspace.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat_workspace_enabled(p_workspace_id) THEN
    RAISE EXCEPTION 'Chat is available on the Duo and Team plans.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat__op_reader_as(p_channel_id uuid, p_user uuid)
  RETURNS public.chat_channels
  LANGUAGE plpgsql
  STABLE
  SET search_path = 'public'
AS $$
DECLARE v_channel public.chat_channels;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF v_channel.id IS NULL OR v_channel.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That conversation no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF p_user IS NULL OR NOT public.chat_is_workspace_member(v_channel.workspace_id, p_user) THEN
    RAISE EXCEPTION 'You don''t have access to this workspace.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__can_read_channel_as(p_channel_id, p_user) THEN
    RAISE EXCEPTION 'You''re not a member of this conversation.' USING ERRCODE = '42501';
  END IF;
  RETURN v_channel;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat__op_channel_as(p_channel_id uuid, p_user uuid)
  RETURNS public.chat_channels
  LANGUAGE plpgsql
  STABLE
  SET search_path = 'public'
AS $$
DECLARE v_channel public.chat_channels;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF v_channel.id IS NULL OR v_channel.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That conversation no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat__op_guard_as(v_channel.workspace_id, p_user);
  IF NOT public.chat__can_read_channel_as(p_channel_id, p_user) THEN
    RAISE EXCEPTION 'You''re not a member of this conversation.' USING ERRCODE = '42501';
  END IF;
  RETURN v_channel;
END;
$$;

-- ── 3. chat_op_agent_post ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_op_agent_post(
  p_workspace_id uuid,
  p_channel_id uuid,
  p_body text,
  p_parent_id uuid DEFAULT NULL)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
DECLARE
  -- p_parent_id: the message this answers (its chain's root reads as before).
  v_key uuid := public.module_api_key_id();
  v_actor record;
  v_label text;
  v_channel public.chat_channels;
  v_channel_id uuid := p_channel_id;
  v_quoted public.chat_messages;
  v_root public.chat_messages;
  v_root_id uuid;
  v_msg public.chat_messages;
  v_body text := coalesce(p_body, '');
  v_stored text;
  v_people uuid[];
  v_teams uuid[];
  v_everyone boolean;
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Only an API key can post as an app.' USING ERRCODE = '42501';
  END IF;
  v_actor := public.chat__key_actor('edit');
  IF p_workspace_id IS DISTINCT FROM v_actor.workspace_id THEN
    RAISE EXCEPTION 'This API key belongs to another workspace.' USING ERRCODE = '42501';
  END IF;

  -- A reply may name only what it answers; the conversation is that message's.
  IF p_parent_id IS NOT NULL THEN
    SELECT * INTO v_quoted FROM public.chat_messages
     WHERE id = p_parent_id AND workspace_id = v_actor.workspace_id;
    IF v_quoted.id IS NULL OR v_quoted.deleted_at IS NOT NULL
       OR (v_channel_id IS NOT NULL AND v_quoted.channel_id <> v_channel_id)
       OR NOT public.chat__key_reads_channel(v_quoted.channel_id, v_actor.creator, v_actor.private_ok) THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    v_channel_id := v_quoted.channel_id;
  END IF;

  SELECT * INTO v_channel FROM public.chat_channels
   WHERE id = v_channel_id AND workspace_id = v_actor.workspace_id;
  -- One answer for a direct message, a private channel the key doesn't read,
  -- a deleted one and one that isn't there.
  IF v_channel.id IS NULL
     OR NOT public.chat__key_reads_channel(v_channel.id, v_actor.creator, v_actor.private_ok) THEN
    RAISE EXCEPTION 'Apps can only post in channels their key can read.' USING ERRCODE = 'P0002';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  -- Capped by its creator: their role, their removal, an announcement channel.
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_actor.creator, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF public.chat__was_removed(v_channel.id, v_actor.creator) THEN
    RAISE EXCEPTION 'You were removed from this conversation.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.managers_only AND NOT public.chat__is_manager(v_channel, v_actor.creator) THEN
    RAISE EXCEPTION 'Only managers can post in this channel.' USING ERRCODE = '42501';
  END IF;

  -- A person's send's rules, on what's typed and on what's stored: apps write
  -- v1's markup (<@USER_ID>, **bold**), the stored form is v2's.
  PERFORM public.chat__check_body(v_body);
  v_stored := public.chat__v1_to_v2(v_body);
  PERFORM public.chat__check_body(v_stored);

  -- A reply joins the chain of what it answers (as chat_op_send does): the
  -- quoted message and its root locked in id order, then read again.
  IF v_quoted.id IS NOT NULL THEN
    IF v_quoted.kind <> 'message' THEN
      RAISE EXCEPTION 'Only a message can be replied to.' USING ERRCODE = '22023';
    END IF;
    v_root_id := coalesce(v_quoted.parent_id, v_quoted.id);
    PERFORM 1 FROM public.chat_messages
     WHERE id IN (v_quoted.id, v_root_id)
     ORDER BY id FOR UPDATE;
    SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_parent_id;
    SELECT * INTO v_root FROM public.chat_messages WHERE id = coalesce(v_quoted.parent_id, v_quoted.id);
    IF v_quoted.channel_id <> v_channel.id OR v_quoted.deleted_at IS NOT NULL
       OR v_root.id IS NULL OR v_root.channel_id <> v_channel.id THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    IF v_root.id <> v_root_id OR v_root.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'That conversation just changed. Try again.' USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Who it mentions, as a person's send reads it: @channel only if the creator may.
  SELECT mt.people, mt.teams, mt.everyone INTO v_people, v_teams, v_everyone
    FROM public.chat__read_mentions(v_channel, v_stored, v_actor.creator) mt;

  SELECT k.name INTO v_label FROM public.workspace_api_keys k WHERE k.id = v_key;

  INSERT INTO public.chat_messages
    (workspace_id, channel_id, parent_id, reply_to_id, author_id, author_kind, author_label, api_key_id,
     body, format_version, mentioned_user_ids, mentioned_team_ids, mentions_everyone)
  VALUES
    (v_channel.workspace_id, v_channel.id, v_root.id, v_quoted.id, v_actor.creator, 'api_key',
     left(coalesce(nullif(btrim(v_label), ''), 'An app'), 80), v_key,
     v_stored, 2, v_people, v_teams, v_everyone)
  RETURNING * INTO v_msg;

  IF v_root.id IS NOT NULL THEN
    UPDATE public.chat_messages
       SET reply_count = reply_count + 1,
           last_reply_at = v_msg.created_at,
           reply_user_ids = (
             SELECT coalesce(array_agg(u), '{}') FROM (
               SELECT u FROM unnest(array[v_actor.creator] || array_remove(reply_user_ids, v_actor.creator))
                        WITH ORDINALITY t(u, o)
                ORDER BY o LIMIT 5) s)
     WHERE id = v_root.id
    RETURNING * INTO v_root;
    PERFORM public.chat__reopen_chain(v_root, v_actor.creator, v_msg.created_at);
  END IF;
  UPDATE public.chat_channels SET last_message_at = v_msg.created_at
   WHERE id = v_channel.id AND (last_message_at IS NULL OR last_message_at < v_msg.created_at);

  -- Its references show "Mentioned in" (CV-10), as its creator may see them.
  PERFORM public.chat__link_mentions(v_msg, v_actor.creator);
  -- Catch up, the bell and devices (CV-5). The creator's read mark stays: a
  -- post through a key is new to them too.
  PERFORM public.chat__fan_out(v_msg, v_channel, v_actor.creator);
  RETURN v_msg;
END;
$$;

-- ── 4. Fan-out ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat__sender_label(p_msg public.chat_messages, p_actor uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = ''
AS $$
  SELECT left(coalesce(
    -- A post through a key: "<person> · via <key>".
    CASE WHEN p_msg.api_key_id IS NOT NULL THEN
      (SELECT nullif(btrim(p.display_name), '') FROM public.profiles p WHERE p.id = p_msg.author_id)
      || ' · via ' || coalesce(nullif(btrim(p_msg.author_label), ''), 'an API key') END,
    CASE WHEN p_msg.api_key_id IS NOT NULL THEN nullif(btrim(p_msg.author_label), '') END,
    CASE WHEN p_actor IS NOT NULL THEN
      (SELECT nullif(btrim(p.display_name), '') FROM public.profiles p WHERE p.id = p_actor) END,
    CASE WHEN p_actor IS NULL THEN nullif(btrim(p_msg.author_label), '') END,
    'Someone'), 80)
$$;

CREATE OR REPLACE FUNCTION public.chat__activity(
  p_channel public.chat_channels,
  p_msg public.chat_messages,
  p_actor uuid,
  p_op text,
  p_reason text,
  p_users uuid[],
  p_team_ids uuid[] DEFAULT NULL::uuid[])
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
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
    -- CV-9: a message of files only says so (else the notice reads blank).
    'excerpt', CASE
      WHEN btrim(coalesce(p_msg.body, ''), E' \n\t') = '' AND coalesce(p_msg.file_count, 0) > 0 THEN
        CASE WHEN p_msg.file_count = 1 THEN 'Sent a file'
             ELSE 'Sent ' || p_msg.file_count || ' files' END
      ELSE public.chat__excerpt(p_msg.body)
    END,
    'format_version', 2,
    'notify_user_ids', to_jsonb(ARRAY(SELECT DISTINCT u::text FROM unnest(p_users) u ORDER BY 1)));
  IF p_reason IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('reason', p_reason);
  END IF;
  IF cardinality(coalesce(p_team_ids, '{}'::uuid[])) > 0 THEN
    v_payload := v_payload || jsonb_build_object('team_ids', to_jsonb(p_team_ids));
  END IF;

  -- CV-21: what a key does now keeps the key's attribution ("<person> · via
  -- <key>"), even though its creator is the actor; a person's edit is theirs.
  IF p_actor IS NOT NULL AND public.module_api_key_id() IS NULL THEN
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
$$;

CREATE OR REPLACE FUNCTION public.chat__fan_out(
  p_msg public.chat_messages,
  p_channel public.chat_channels,
  p_actor uuid,
  p_before public.chat_messages DEFAULT NULL::public.chat_messages)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  v_edit boolean := p_before.id IS NOT NULL;
  v_people uuid[] := coalesce(p_msg.mentioned_user_ids, '{}'::uuid[]);
  v_teams uuid[] := coalesce(p_msg.mentioned_team_ids, '{}'::uuid[]);
  v_everyone boolean := coalesce(p_msg.mentions_everyone, false);
  -- CV-21: a post the key is making now is new to its creator too, so nobody
  -- is skipped (an edit its creator makes in the app is theirs, as usual).
  v_skip uuid := CASE WHEN p_msg.api_key_id IS NOT NULL
                           AND public.module_api_key_id() IS NOT DISTINCT FROM p_msg.api_key_id
                      THEN NULL ELSE p_actor END;
  -- The key's creator, while their key posts: its replies are new to them,
  -- never a reply addressed to them.
  v_key_self uuid := CASE WHEN v_skip IS NULL AND p_msg.api_key_id IS NOT NULL THEN p_actor END;
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

  FOR v_reason, v_users, v_bell IN
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
    -- whoever stopped following. A post made through a key brings its creator
    -- in only while that key's notification switch is on (CV-21).
    SELECT DISTINCT x.u
      FROM (
        SELECT CASE WHEN public.chat__key_replies_on(rt.author_id, rt.api_key_id) THEN rt.author_id END AS a,
               rt.mentioned_user_ids AS named
          FROM public.chat_messages rt WHERE rt.id = p_msg.parent_id
        UNION ALL
        SELECT CASE WHEN public.chat__key_replies_on(y.author_id, y.api_key_id) THEN y.author_id END,
               y.mentioned_user_ids
          FROM public.chat_messages y
         WHERE y.parent_id = p_msg.parent_id AND y.id <> p_msg.id
           AND y.kind = 'message' AND y.deleted_at IS NULL
        UNION ALL
        SELECT CASE WHEN public.chat__key_replies_on(q.author_id, q.api_key_id) THEN q.author_id END,
               '{}'::uuid[]
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
             WHEN ch.u IS NOT NULL AND c.u = v_key_self THEN
               CASE WHEN mem.notify_level = 'all' THEN 'every_message' END
             WHEN ch.u IS NOT NULL THEN 'reply'
             WHEN mem.notify_level = 'all' THEN 'every_message'
           END AS reason,
           (p_channel.kind <> 'dm' AND coalesce(mem.notify_level, 'mentions') <> 'none') AS bell_ok
      FROM cand c
      LEFT JOIN mem ON mem.user_id = c.u
      LEFT JOIN team_people tp ON tp.user_id = c.u
      LEFT JOIN chain ch ON ch.u = c.u
     WHERE c.u IS NOT NULL AND c.u IS DISTINCT FROM v_skip
       AND public.chat__can_read_channel_as(p_channel.id, c.u)
  )
  -- Per reason: who, and who of them gets the bell row.
  SELECT d.reason,
         array_agg(d.u),
         coalesce(array_agg(d.u) FILTER (
           WHERE d.bell_ok AND d.reason IN ('mention', 'team_mention', 'everyone', 'announcement', 'reply')),
           '{}'::uuid[])
    FROM decided d
   WHERE d.reason IS NOT NULL
     -- Once per message: a send never twice; an edit not to anyone named,
     -- or written to, before.
     AND NOT EXISTS (SELECT 1 FROM public.chat_catchup k
                      WHERE k.user_id = d.u AND k.message_id = p_msg.id
                        AND (NOT v_edit OR k.reason IN ('dm', 'mention', 'team_mention', 'everyone')))
   GROUP BY d.reason
  LOOP
    v_activity := public.chat__activity(p_channel, p_msg, p_actor,
      CASE v_reason WHEN 'reply' THEN 'chat.reply' WHEN 'announcement' THEN 'chat.announcement'
                    ELSE 'chat.mention' END,
      CASE v_reason WHEN 'mention' THEN 'person' WHEN 'team_mention' THEN 'team'
                    WHEN 'everyone' THEN 'everyone' END,
      v_bell,
      CASE WHEN v_reason = 'team_mention' THEN v_teams END);

    IF v_reason = 'reply' THEN
      -- One item per chain: it moves to the newest reply, and the bell keeps
      -- one row per chain (the twin it had is dismissed). An item already on
      -- a newer reply (a send that committed first) stays where it is.
      INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
      SELECT DISTINCT k.workspace_id, k.user_id, k.activity_id, now()
        FROM public.chat_catchup k
        JOIN public.chat_messages cur ON cur.id = k.message_id
       WHERE k.user_id = ANY (v_users) AND k.reason = 'reply' AND k.chain_root_id = p_msg.parent_id
         AND k.done_at IS NULL AND k.activity_id IS NOT NULL
         AND (cur.created_at, cur.id) < (p_msg.created_at, p_msg.id)
      ON CONFLICT (user_id, activity_id) DO UPDATE
        SET dismissed_at = coalesce(public.notification_state.dismissed_at, EXCLUDED.dismissed_at);
      INSERT INTO public.chat_catchup AS k
        (workspace_id, user_id, channel_id, message_id, chain_root_id, reason, actor_id, activity_id)
      SELECT p_channel.workspace_id, u, p_channel.id, p_msg.id, p_msg.parent_id, 'reply', p_actor,
             CASE WHEN u = ANY (v_bell) THEN v_activity END
        FROM unnest(v_users) u
      ON CONFLICT (user_id, chain_root_id) WHERE reason = 'reply' AND done_at IS NULL
      DO UPDATE SET message_id = EXCLUDED.message_id,
                    actor_id = EXCLUDED.actor_id,
                    activity_id = EXCLUDED.activity_id
       WHERE NOT EXISTS (SELECT 1 FROM public.chat_messages cur
                          WHERE cur.id = k.message_id
                            AND (cur.created_at, cur.id) > (p_msg.created_at, p_msg.id));
      -- Whoever's item stayed on a newer reply doesn't see this one's row either.
      IF v_activity IS NOT NULL THEN
        INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
        SELECT p_channel.workspace_id, u, v_activity, now()
          FROM unnest(v_bell) u
         WHERE NOT EXISTS (SELECT 1 FROM public.chat_catchup x
                            WHERE x.user_id = u AND x.activity_id = v_activity)
        ON CONFLICT (user_id, activity_id) DO NOTHING;
      END IF;
    ELSIF v_reason = 'every_message' THEN
      -- One line per conversation (CH73), pointing at its newest message.
      INSERT INTO public.chat_catchup AS k
        (workspace_id, user_id, channel_id, message_id, reason, actor_id)
      SELECT p_channel.workspace_id, u, p_channel.id, p_msg.id, 'every_message', p_actor
        FROM unnest(v_users) u
      ON CONFLICT (user_id, channel_id) WHERE reason = 'every_message' AND done_at IS NULL
      DO UPDATE SET message_id = EXCLUDED.message_id,
                    actor_id = EXCLUDED.actor_id
       WHERE NOT EXISTS (SELECT 1 FROM public.chat_messages cur
                          WHERE cur.id = k.message_id
                            AND (cur.created_at, cur.id) > (p_msg.created_at, p_msg.id));
    ELSE
      INSERT INTO public.chat_catchup
        (workspace_id, user_id, channel_id, message_id, chain_root_id, reason, actor_id, activity_id)
      SELECT p_channel.workspace_id, u, p_channel.id, p_msg.id, p_msg.parent_id, v_reason, p_actor,
             CASE WHEN u = ANY (v_bell) THEN v_activity END
        FROM unnest(v_users) u
      ON CONFLICT (user_id, message_id, reason) WHERE message_id IS NOT NULL DO NOTHING;
    END IF;
    -- Their devices (CV-6a), through the gate.
    PERFORM public.chat__notify_devices(p_channel, p_msg, p_actor, v_reason, v_users);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat__notify_devices(
  p_channel public.chat_channels,
  p_msg public.chat_messages,
  p_actor uuid,
  p_reason text,
  p_users uuid[])
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
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
  -- CV-21: a post the key is making now rings its creator too.
  v_skip uuid := CASE WHEN p_msg.api_key_id IS NOT NULL
                           AND public.module_api_key_id() IS NOT DISTINCT FROM p_msg.api_key_id
                      THEN NULL ELSE p_actor END;
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

  -- CV-18: what waits while the gate drops it, or its switch is off, is held.
  UPDATE public.chat_catchup k SET held_at = v_now
   WHERE k.message_id = p_msg.id AND k.user_id = ANY (p_users)
     AND k.held_at IS NULL AND k.done_at IS NULL
     AND (public.notice__gate(k.user_id, p_channel.workspace_id, v_kind, v_now) = 'drop'
          OR NOT public.chat__notice_switch_on(k.user_id, p_reason));

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
             -- Earlier notices on the tag about messages still unread.
             1 + (SELECT count(*) FROM public.notice_deliveries d
                    JOIN public.chat_messages pm ON pm.id = d.message_id AND pm.deleted_at IS NULL
                   WHERE d.user_id = g.u AND d.tag = v_tag AND d.acked_at IS NULL
                     AND d.message_id <> p_msg.id
                     AND d.created_at > v_now - interval '10 minutes'
                     AND pm.created_at > coalesce(mem.last_read_at, '-infinity'::timestamptz)) AS burst
        FROM (SELECT DISTINCT u, public.notice__gate(u, p_channel.workspace_id, v_kind, v_now) AS gate
                FROM unnest(p_users) AS u) g
        LEFT JOIN public.user_preferences up ON up.user_id = g.u
        LEFT JOIN public.chat_members mem
          ON mem.channel_id = p_channel.id AND mem.user_id = g.u AND mem.left_at IS NULL
       WHERE g.u IS NOT NULL AND g.u IS DISTINCT FROM v_skip
         AND g.gate IN ('send', 'hold')
         AND public.chat__notice_switch_on(g.u, p_reason)
         -- Nothing: Catch up only, no notice (CH40).
         AND coalesce(mem.notify_level, 'mentions') <> 'none'
         AND public.chat__can_read_channel_as(p_channel.id, g.u)
    ) x;
END;
$$;

-- ── 5. Counts ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_unread_counts(p_workspace_id uuid)
  RETURNS TABLE(channel_id uuid, unread integer, mentions integer, addressed integer, catchup integer)
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
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
           -- A team mention counts only while your teams' notices are on (CV-5).
           ((SELECT id FROM me) = ANY (m.mentioned_user_ids) OR m.mentions_everyone
            OR (m.mentioned_team_ids && (SELECT ids FROM teams) AND NOT (SELECT muted FROM teams))) AS mentioned,
           (mi.managers_only AND m.parent_id IS NULL) AS announced,
           -- CV-21: your key's post brings you into its chain only through
           -- that key's notification switch.
           (m.parent_id IS NOT NULL
            -- your own key's reply is new to you, not addressed to you
            AND NOT (m.api_key_id IS NOT NULL AND m.author_id = (SELECT id FROM me))
            AND NOT EXISTS (SELECT 1 FROM public.chat_chain_mutes cm
                             WHERE cm.user_id = (SELECT id FROM me) AND cm.root_id = m.parent_id)
            AND (EXISTS (SELECT 1 FROM public.chat_messages q
                          WHERE q.id = m.reply_to_id AND q.author_id = (SELECT id FROM me)
                            AND public.chat__key_replies_on(q.author_id, q.api_key_id))
                 OR EXISTS (SELECT 1 FROM public.chat_messages rt
                             WHERE rt.id = m.parent_id
                               AND ((rt.author_id = (SELECT id FROM me)
                                     AND public.chat__key_replies_on(rt.author_id, rt.api_key_id))
                                    OR (SELECT id FROM me) = ANY (rt.mentioned_user_ids)))
                 OR EXISTS (SELECT 1 FROM public.chat_messages x
                             WHERE x.parent_id = m.parent_id
                               AND (x.created_at, x.id) < (m.created_at, m.id)
                               AND ((x.author_id = (SELECT id FROM me)
                                     AND public.chat__key_replies_on(x.author_id, x.api_key_id))
                                    OR (SELECT id FROM me) = ANY (x.mentioned_user_ids))))) AS in_chain
      FROM mine mi
      JOIN public.chat_messages m ON m.channel_id = mi.channel_id
     WHERE m.kind = 'message' AND m.deleted_at IS NULL
       -- A post through your key is new to you (CV-21).
       AND (m.author_id IS DISTINCT FROM (SELECT id FROM me) OR m.api_key_id IS NOT NULL)
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
                WHEN f.kind = 'dm' OR f.mentioned OR f.announced THEN 'm:' || f.id::text
                WHEN f.in_chain THEN 'c:' || f.parent_id::text
                WHEN f.notify_level = 'all' THEN 'all'
           END AS item
      FROM fresh f
  ), open_items AS (
    -- Catch up's share (CV-5): open items showing now (not put off with
    -- Later), never on Nothing, never a team mention while your teams'
    -- notices are off, never a chain you stopped following, never a quiet
    -- line, no Every-message line unless you're on Every message, and never a
    -- deleted message's, unless it's a chain's or a line's whose newest
    -- message was deleted while an older one of it is still unread.
    SELECT k.channel_id, count(*)::int AS n
      FROM public.chat_catchup k
      JOIN mine mi ON mi.channel_id = k.channel_id AND mi.notify_level <> 'none'
      LEFT JOIN public.chat_messages km ON km.id = k.message_id
     WHERE k.user_id = (SELECT id FROM me) AND k.done_at IS NULL
       AND (k.later_until IS NULL OR k.later_until <= now())
       AND k.reason NOT IN ('added', 'removed', 'level_reset')
       AND NOT (k.reason = 'team_mention' AND (SELECT muted FROM teams))
       AND NOT (k.reason = 'every_message' AND mi.notify_level <> 'all')
       AND (km.deleted_at IS NULL
            OR (k.reason IN ('reply', 'every_message') AND EXISTS (
                  SELECT 1 FROM public.chat_messages x
                   WHERE x.channel_id = k.channel_id AND x.kind = 'message' AND x.deleted_at IS NULL
                     AND (x.author_id IS DISTINCT FROM (SELECT id FROM me) OR x.api_key_id IS NOT NULL)
                     AND (k.reason = 'every_message' OR x.parent_id = k.chain_root_id)
                     AND (x.created_at, x.id) < (km.created_at, km.id)
                     AND CASE WHEN mi.mark_id IS NULL THEN x.created_at > mi.last_read_at
                              ELSE (x.created_at, x.id) > (mi.mark_at, mi.mark_id) END)))
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
$$;

CREATE OR REPLACE FUNCTION public.chat_catchup_open(p_workspace_id uuid)
  RETURNS TABLE(id uuid, channel_id uuid, message_id uuid, chain_root_id uuid, reason text, actor_id uuid,
                created_at timestamp with time zone, later_until timestamp with time zone,
                returned_at timestamp with time zone, at timestamp with time zone, channel_name text)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT k.id, coalesce(m.channel_id, k.channel_id),
         -- A chain or Every-message line whose newest message was deleted shows
         -- its newest live message from someone else (the count keeps it too).
         CASE WHEN m.deleted_at IS NULL THEN k.message_id ELSE alive.id END,
         k.chain_root_id, k.reason, k.actor_id,
         k.created_at, k.later_until, k.later_notified_at,
         greatest(coalesce(CASE WHEN m.deleted_at IS NULL THEN m.created_at ELSE alive.created_at END,
                           k.created_at),
                  coalesce(k.later_notified_at, '-infinity'::timestamptz)),
         k.channel_name
    FROM public.chat_catchup k
    LEFT JOIN public.chat_messages m ON m.id = k.message_id
    LEFT JOIN public.chat_members mem
      ON mem.channel_id = coalesce(m.channel_id, k.channel_id) AND mem.user_id = v_me AND mem.left_at IS NULL
    LEFT JOIN public.chat_messages rm ON rm.id = mem.last_read_id
    LEFT JOIN LATERAL (
      SELECT x.id, x.created_at FROM public.chat_messages x
       WHERE m.deleted_at IS NOT NULL AND k.reason IN ('reply', 'every_message')
         AND x.channel_id = m.channel_id AND x.kind = 'message' AND x.deleted_at IS NULL
         -- someone else's, or a post through your key (new to you, CV-21)
         AND (x.author_id IS DISTINCT FROM v_me OR x.api_key_id IS NOT NULL)
         AND (k.reason = 'every_message' OR x.parent_id = k.chain_root_id)
         AND (x.created_at, x.id) < (m.created_at, m.id)
         -- still unread (past your read mark), as chat_unread_counts keeps it
         AND (mem.channel_id IS NULL
              OR CASE WHEN rm.id IS NULL THEN x.created_at > coalesce(mem.last_read_at, '-infinity'::timestamptz)
                      ELSE (x.created_at, x.id) > (rm.created_at, rm.id) END)
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT 1
    ) alive ON true
   WHERE k.user_id = v_me AND k.workspace_id = p_workspace_id AND k.done_at IS NULL
     AND (k.later_until IS NULL OR k.later_notified_at IS NOT NULL OR k.later_until <= now())
     AND (k.message_id IS NULL OR (m.id IS NOT NULL AND (m.deleted_at IS NULL OR alive.id IS NOT NULL)))
     AND NOT (k.reason = 'team_mention' AND public.chat__team_muted(v_me))
     AND NOT (k.reason = 'every_message' AND coalesce(mem.notify_level, '') <> 'all')
     AND NOT (k.reason = 'reply' AND EXISTS (
           SELECT 1 FROM public.chat_chain_mutes cm
            WHERE cm.user_id = v_me AND cm.root_id = k.chain_root_id))
     -- Readable conversations only; "X removed you from Q" is the one line
     -- about a conversation you can no longer read (no message, its stored name).
     AND (public.chat__can_read_channel_as(coalesce(m.channel_id, k.channel_id), v_me)
          OR (k.reason = 'removed' AND k.message_id IS NULL
              AND public.chat__reads_workspace(p_workspace_id, v_me)))
   ORDER BY 10 DESC, k.id DESC
   LIMIT 2000;
END;
$$;

-- ── 6. The app's ops, one body for a person and a key's creator ─────────────

-- chat_op_react (CV-7c, CV-20's live body), for p_user.
CREATE OR REPLACE FUNCTION public.chat__react_as(p_user uuid, p_message_id uuid, p_key text, p_on boolean)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SET search_path = 'public'
AS $$
DECLARE
  v_msg public.chat_messages;
  v_me text := p_user::text;
  v_list jsonb;
BEGIN
  p_key := public.reactions__key_canonical(p_key);
  IF NOT public.reactions__key_ok(p_key) THEN
    RAISE EXCEPTION 'That reaction isn''t supported.' USING ERRCODE = '22023';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Say whether the reaction is on or off.' USING ERRCODE = '22023';
  END IF;
  -- A message the caller can't read gets the same answer as a missing one.
  SELECT * INTO v_msg FROM public.chat_messages
   WHERE id = p_message_id AND public.chat__can_read_channel_as(channel_id, p_user)
     FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF (public.chat__op_reader_as(v_msg.channel_id, p_user)).archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message takes reactions.' USING ERRCODE = '22023';
  END IF;
  -- CV-20: a custom emoji is added only while it's live in this workspace.
  IF p_on AND p_key ~ public.reactions__custom_key_pattern()
     AND NOT public.chat__emoji_live(v_msg.workspace_id, p_key) THEN
    RAISE EXCEPTION 'That emoji isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;

  v_list := coalesce(v_msg.reactions -> p_key, '[]'::jsonb);
  IF p_on = (v_list ? v_me) THEN
    RETURN v_msg;
  END IF;
  IF p_on THEN
    IF NOT (v_msg.reactions ? p_key) AND (SELECT count(*) FROM jsonb_object_keys(v_msg.reactions)) >= 20 THEN
      RAISE EXCEPTION 'This message has the most reactions it can hold.' USING ERRCODE = '22023';
    END IF;
    v_list := v_list || to_jsonb(v_me);
  ELSE
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_list
      FROM jsonb_array_elements_text(v_list) x WHERE x <> v_me;
  END IF;

  UPDATE public.chat_messages
     SET reactions = CASE WHEN jsonb_array_length(v_list) = 0 THEN reactions - p_key
                          ELSE jsonb_set(reactions, array[p_key], v_list) END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.react', jsonb_build_object('message_id', v_msg.id, 'key', p_key, 'on', p_on));
  RETURN v_msg;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_react(p_message_id uuid, p_key text, p_on boolean)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  RETURN public.chat__react_as(auth.uid(), p_message_id, p_key, p_on);
END;
$$;

-- chat_op_mark_decision (CV-14's live body), for p_user.
CREATE OR REPLACE FUNCTION public.chat__mark_decision_as(p_user uuid, p_message_id uuid, p_on boolean)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SET search_path = 'public'
AS $$
DECLARE
  v_me uuid := p_user;
  v_msg public.chat_messages;
  v_channel public.chat_channels;
BEGIN
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Say whether to mark or unmark it.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  -- A message you can't read answers like one that isn't there.
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL
     OR NOT public.chat__can_read_channel_as(v_msg.channel_id, v_me) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  -- Signed in, in the workspace, on a plan with chat, reading the conversation.
  v_channel := public.chat__op_channel_as(v_msg.channel_id, v_me);
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message can be a decision.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat__can_post(v_channel, v_me) THEN
    RAISE EXCEPTION 'Your role can''t mark decisions here.' USING ERRCODE = '42501';
  END IF;
  IF p_on = (v_msg.decision_at IS NOT NULL) THEN
    RETURN v_msg;
  END IF;
  UPDATE public.chat_messages
     SET decision_at = CASE WHEN p_on THEN now() END,
         decision_by = CASE WHEN p_on THEN v_me END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.decision', jsonb_build_object('message_id', v_msg.id, 'on', p_on));
  RETURN v_msg;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_mark_decision(p_message_id uuid, p_on boolean DEFAULT true)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  RETURN public.chat__mark_decision_as(auth.uid(), p_message_id, p_on);
END;
$$;

-- chat__chain_root (CV-12's live body), for p_user.
CREATE OR REPLACE FUNCTION public.chat__chain_root_as(p_root_id uuid, p_user uuid)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  v_root public.chat_messages;
BEGIN
  SELECT * INTO v_root FROM public.chat_messages WHERE id = p_root_id FOR UPDATE;
  -- A message you can't read reads as one that isn't there.
  IF v_root.id IS NULL OR NOT public.chat__can_read_channel_as(v_root.channel_id, p_user) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF v_root.kind <> 'message' OR v_root.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only the first message of a reply chain can be wrapped up.' USING ERRCODE = '22023';
  END IF;
  RETURN v_root;
END;
$$;

-- chat_op_wrap_up (CV-14's live body), for p_user.
CREATE OR REPLACE FUNCTION public.chat__wrap_up_as(p_user uuid, p_root_id uuid, p_settled_id uuid, p_mark_decision boolean)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SET search_path = 'public'
AS $$
DECLARE
  v_me uuid := p_user;
  v_root public.chat_messages;
  v_channel public.chat_channels;
  v_settled public.chat_messages;
  -- One clock for the wrap-up and the decision it makes: the toast's Undo
  -- (chat_op_reopen) recognises that decision by it.
  v_at timestamptz := clock_timestamp();
BEGIN
  v_root := public.chat__chain_root_as(p_root_id, v_me);
  v_channel := public.chat__op_channel_as(v_root.channel_id, v_me);
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__may_wrap(v_channel, v_root, v_me) THEN
    RAISE EXCEPTION 'Only whoever started the chain, the channel''s managers and admins can wrap it up.'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_settled FROM public.chat_messages WHERE id = p_settled_id FOR UPDATE;
  IF v_settled.id IS NULL OR v_settled.parent_id IS DISTINCT FROM v_root.id
     OR v_settled.deleted_at IS NOT NULL OR v_settled.kind <> 'message' THEN
    RAISE EXCEPTION 'Pick the reply of this chain that settled it.' USING ERRCODE = '22023';
  END IF;
  -- CV-14: the decision follows the rule of chat_op_mark_decision (post rights).
  IF coalesce(p_mark_decision, false) AND NOT public.chat__can_post(v_channel, v_me) THEN
    RAISE EXCEPTION 'Your role can''t mark decisions here.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_mark_decision, false) AND v_settled.decision_at IS NULL THEN
    UPDATE public.chat_messages
       SET decision_at = v_at, decision_by = v_me
     WHERE id = v_settled.id
    RETURNING * INTO v_settled;
    PERFORM public.module_activity_log(v_settled.workspace_id, 'chat', 'chat_channel', v_settled.channel_id,
      'chat.decision', jsonb_build_object('message_id', v_settled.id, 'on', true));
  END IF;
  IF v_root.wrapped_at IS NOT NULL AND v_root.settled_id = v_settled.id THEN
    RETURN v_root;
  END IF;
  -- The clock, not the transaction's start: the Undo window is measured on it.
  UPDATE public.chat_messages
     SET wrapped_at = v_at, wrapped_by = v_me, settled_id = v_settled.id,
         reopened_at = NULL, reopened_by = NULL
   WHERE id = v_root.id
  RETURNING * INTO v_root;
  PERFORM public.module_activity_log(v_root.workspace_id, 'chat', 'chat_channel', v_root.channel_id,
    'chat.wrap_up', jsonb_build_object('message_id', v_root.id, 'settled_id', v_settled.id,
                                       'mark_decision', coalesce(p_mark_decision, false)));
  RETURN v_root;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_wrap_up(p_root_id uuid, p_settled_id uuid, p_mark_decision boolean DEFAULT false)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  RETURN public.chat__wrap_up_as(auth.uid(), p_root_id, p_settled_id, p_mark_decision);
END;
$$;

-- chat_op_create_channel (CV-13's live body), for p_user.
-- p_names_of: whose private channels a new name may clash with (the person
-- creating it, or null for public channels only). An earlier draft had nine
-- arguments: never two of them.
DROP FUNCTION IF EXISTS public.chat__create_channel_as(uuid, uuid, text, text, boolean, uuid[], boolean, text, uuid);
CREATE OR REPLACE FUNCTION public.chat__create_channel_as(
  p_user uuid,
  p_workspace_id uuid,
  p_name text,
  p_topic text,
  p_is_private boolean,
  p_member_ids uuid[],
  p_announcement boolean,
  p_link_type text,
  p_link_id uuid,
  p_names_of uuid)
  RETURNS public.chat_channels
  LANGUAGE plpgsql
  SET search_path = 'public'
AS $$
DECLARE
  v_me uuid := p_user;
  v_name text;
  v_topic text;
  v_private boolean := coalesce(p_is_private, false);
  v_channel public.chat_channels;
  v_uid uuid;
  v_link_type text;
BEGIN
  PERFORM public.chat__op_guard_as(p_workspace_id, v_me);
  IF v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_private') THEN
    RAISE EXCEPTION 'Your role can''t create private channels.' USING ERRCODE = '42501';
  ELSIF NOT v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_public') THEN
    RAISE EXCEPTION 'Your role can''t create channels.' USING ERRCODE = '42501';
  END IF;
  -- CV-13: the optional link, checked before anything is made.
  IF (p_link_type IS NULL) <> (p_link_id IS NULL) THEN
    RAISE EXCEPTION 'Pick what to link this conversation to.' USING ERRCODE = '22023';
  END IF;
  IF p_link_id IS NOT NULL THEN
    v_link_type := public.chat__link_type(p_link_type);
    PERFORM public.chat__check_link_target(p_workspace_id, v_link_type, p_link_id, v_me);
  END IF;
  v_name := public.chat__channel_name(p_name);
  v_topic := public.chat__channel_topic(p_topic);
  -- The name clashes only with channels the creator can see (public ones,
  -- and p_names_of's private ones).
  PERFORM public.chat__lock_name(p_workspace_id, v_name);
  IF public.chat__name_taken(p_workspace_id, v_name, NULL, p_names_of) THEN
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
  IF p_link_id IS NOT NULL THEN
    v_channel := public.chat__set_link(v_channel, v_link_type, p_link_id, v_me);
  END IF;
  RETURN v_channel;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_create_channel(
  p_workspace_id uuid,
  p_name text,
  p_topic text DEFAULT ''::text,
  p_is_private boolean DEFAULT false,
  p_member_ids uuid[] DEFAULT '{}'::uuid[],
  p_announcement boolean DEFAULT false,
  p_link_type text DEFAULT NULL::text,
  p_link_id uuid DEFAULT NULL::uuid)
  RETURNS public.chat_channels
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  RETURN public.chat__create_channel_as(auth.uid(), p_workspace_id, p_name, p_topic, p_is_private,
    p_member_ids, p_announcement, p_link_type, p_link_id, auth.uid());
END;
$$;

-- The agent's side: the key's rules first, then the same body as its creator.
-- A message or chain the key can't read answers like a missing one.

CREATE OR REPLACE FUNCTION public.chat__key_message(p_workspace_id uuid, p_message_id uuid, p_need text, OUT creator uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_channel uuid;
BEGIN
  v_actor := public.chat__key_actor(p_need);
  IF p_workspace_id IS DISTINCT FROM v_actor.workspace_id THEN
    RAISE EXCEPTION 'This API key belongs to another workspace.' USING ERRCODE = '42501';
  END IF;
  SELECT m.channel_id INTO v_channel FROM public.chat_messages m
   WHERE m.id = p_message_id AND m.workspace_id = v_actor.workspace_id AND m.deleted_at IS NULL;
  IF v_channel IS NULL
     OR NOT public.chat__key_reads_channel(v_channel, v_actor.creator, v_actor.private_ok) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  creator := v_actor.creator;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_agent_react(p_workspace_id uuid, p_message_id uuid, p_key text, p_on boolean DEFAULT true)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  RETURN public.chat__react_as(public.chat__key_message(p_workspace_id, p_message_id, 'edit'), p_message_id, p_key, p_on);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_agent_mark_decision(p_workspace_id uuid, p_message_id uuid, p_on boolean DEFAULT true)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  RETURN public.chat__mark_decision_as(public.chat__key_message(p_workspace_id, p_message_id, 'edit'), p_message_id, p_on);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_agent_wrap_up(p_workspace_id uuid, p_root_id uuid, p_settled_id uuid, p_mark_decision boolean DEFAULT false)
  RETURNS public.chat_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
BEGIN
  RETURN public.chat__wrap_up_as(public.chat__key_message(p_workspace_id, p_root_id, 'edit'), p_root_id, p_settled_id,
    p_mark_decision);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_op_agent_create_channel(
  p_workspace_id uuid,
  p_name text,
  p_topic text DEFAULT '',
  p_is_private boolean DEFAULT false)
  RETURNS public.chat_channels
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = 'public'
AS $$
DECLARE
  v_actor record;
BEGIN
  v_actor := public.chat__key_actor('edit');
  IF p_workspace_id IS DISTINCT FROM v_actor.workspace_id THEN
    RAISE EXCEPTION 'This API key belongs to another workspace.' USING ERRCODE = '42501';
  END IF;
  -- A private channel the key couldn't read afterwards isn't made through it.
  IF coalesce(p_is_private, false) AND NOT v_actor.private_ok THEN
    RAISE EXCEPTION 'Turn on "Include private channels I''m in" for this key to create private channels.'
      USING ERRCODE = '42501';
  END IF;
  -- A key without private access checks name clashes against public channels only.
  RETURN public.chat__create_channel_as(v_actor.creator, p_workspace_id, p_name, p_topic, p_is_private,
    '{}'::uuid[], false, NULL, NULL,
    CASE WHEN v_actor.private_ok THEN v_actor.creator END);
END;
$$;

-- ── 7. Reads for the connector ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_agent_conversations(p_workspace_id uuid)
  RETURNS TABLE (
    id uuid,
    name text,
    topic text,
    is_private boolean,
    announcement boolean,
    archived boolean,
    last_message_at timestamptz)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_actor record;
BEGIN
  v_actor := public.chat__key_actor('view');
  IF p_workspace_id IS DISTINCT FROM v_actor.workspace_id THEN
    RAISE EXCEPTION 'This API key belongs to another workspace.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.id, c.name, nullif(c.topic, ''), c.is_private, c.managers_only, c.archived_at IS NOT NULL,
           c.last_message_at
      FROM public.chat__key_channel_ids(v_actor.workspace_id, v_actor.creator, v_actor.private_ok) AS r(id)
      JOIN public.chat_channels c ON c.id = r.id
     ORDER BY c.archived_at IS NOT NULL, c.name, c.id;
END;
$$;

-- A conversation's messages (no chain given: top-level ones) or a chain (its
-- root and replies), newest first, a keyset page of at most 100.
CREATE OR REPLACE FUNCTION public.chat_agent_messages(
  p_channel_id uuid,
  p_root_id uuid DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 30)
  RETURNS TABLE (
    id uuid,
    channel_id uuid,
    parent_id uuid,
    reply_to_id uuid,
    author_id uuid,
    author_name text,
    via text,
    body text,
    reactions jsonb,
    reply_count integer,
    decision boolean,
    wrapped boolean,
    settled_id uuid,
    edited boolean,
    created_at timestamptz)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_actor record;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_before timestamptz := p_before;
BEGIN
  v_actor := public.chat__key_actor('view');
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels c
                  WHERE c.id = p_channel_id AND c.workspace_id = v_actor.workspace_id)
     OR NOT public.chat__key_reads_channel(p_channel_id, v_actor.creator, v_actor.private_ok) THEN
    RAISE EXCEPTION 'That conversation no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF p_root_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.chat_messages rt
        WHERE rt.id = p_root_id AND rt.channel_id = p_channel_id AND rt.parent_id IS NULL
          AND rt.kind = 'message' AND rt.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  -- A page may start from a message alone: its time is read here.
  IF v_before IS NULL AND p_before_id IS NOT NULL THEN
    SELECT b.created_at INTO v_before FROM public.chat_messages b
     WHERE b.id = p_before_id AND b.channel_id = p_channel_id;
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN QUERY
    SELECT m.id, m.channel_id, m.parent_id, m.reply_to_id, m.author_id,
           coalesce(CASE WHEN m.author_id IS NOT NULL THEN
                      coalesce(nullif(btrim(p.display_name), ''), 'Former member') END,
                    nullif(btrim(m.author_label), ''), 'An app'),
           CASE WHEN m.author_kind = 'api_key' AND m.author_id IS NOT NULL THEN m.author_label END,
           m.body, m.reactions, m.reply_count, m.decision_at IS NOT NULL, m.wrapped_at IS NOT NULL,
           m.settled_id, m.edited_at IS NOT NULL, m.created_at
      FROM public.chat_messages m
      LEFT JOIN public.profiles p ON p.id = m.author_id
     WHERE m.channel_id = p_channel_id
       AND m.kind = 'message' AND m.deleted_at IS NULL
       AND CASE WHEN p_root_id IS NULL THEN m.parent_id IS NULL
                ELSE (m.id = p_root_id OR m.parent_id = p_root_id) END
       AND (v_before IS NULL
            OR m.created_at < v_before
            OR (m.created_at = v_before AND p_before_id IS NOT NULL AND m.id < p_before_id))
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT v_limit;
END;
$$;

-- chat_search's query, for a given set of conversations (CV-19's live body).
CREATE OR REPLACE FUNCTION public.chat__search_in(
  p_channels uuid[],
  p_workspace_id uuid,
  p_query text,
  p_before timestamptz,
  p_before_id uuid,
  p_limit integer,
  p_from uuid,
  p_after timestamptz,
  p_has_file boolean)
  RETURNS TABLE (
    message_id uuid,
    channel_id uuid,
    channel_kind text,
    channel_name text,
    parent_id uuid,
    reply_to_id uuid,
    author_id uuid,
    author_kind text,
    author_label text,
    created_at timestamptz,
    snippet text)
  LANGUAGE plpgsql STABLE
  SET search_path = ''
AS $$
DECLARE
  v_q tsquery;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
BEGIN
  IF p_workspace_id IS NULL OR p_query IS NULL OR pg_catalog.cardinality(coalesce(p_channels, '{}')) = 0 THEN
    RETURN;
  END IF;
  v_q := public.chat__search_query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT h.id, h.channel_id, c.kind, c.name, h.parent_id, h.reply_to_id, h.author_id, h.author_kind,
           h.author_label, h.created_at,
           pg_catalog.ts_headline('public.chat_headline'::regconfig, h.body_text, v_q,
             'StartSel=' || pg_catalog.chr(57344) || ', StopSel=' || pg_catalog.chr(57345)
             || ', MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "')
      FROM (
        SELECT m.id, m.channel_id, m.parent_id, m.reply_to_id, m.author_id, m.author_kind,
               m.author_label, m.created_at, m.body_text
          FROM public.chat_messages m
         WHERE m.search_tsv @@ v_q
           AND m.deleted_at IS NULL
           AND m.kind = 'message'
           AND m.workspace_id = p_workspace_id
           AND m.channel_id = ANY (p_channels)
           AND (p_from IS NULL OR m.author_id = p_from)
           AND (p_after IS NULL OR m.created_at >= p_after)
           AND (p_before IS NULL
                OR m.created_at < p_before
                OR (m.created_at = p_before AND p_before_id IS NOT NULL AND m.id < p_before_id))
           AND (NOT coalesce(p_has_file, false) OR EXISTS (
                 SELECT 1 FROM public.attachments a
                  WHERE a.workspace_id = m.workspace_id
                    AND a.entity_type = 'chat_message' AND a.entity_id = m.id
                    AND a.status = 'ready' AND a.deleted_at IS NULL))
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT v_limit
      ) h
      JOIN public.chat_channels c ON c.id = h.channel_id
     ORDER BY h.created_at DESC, h.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_search(
  p_workspace_id uuid,
  p_query text,
  p_channel_id uuid DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_from uuid DEFAULT NULL,
  p_after timestamptz DEFAULT NULL,
  p_has_file boolean DEFAULT false
)
  RETURNS TABLE (
    message_id uuid,
    channel_id uuid,
    channel_kind text,
    channel_name text,
    parent_id uuid,
    reply_to_id uuid,
    author_id uuid,
    author_kind text,
    author_label text,
    created_at timestamptz,
    snippet text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  SET statement_timeout = '5s'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_channels uuid[];
BEGIN
  IF v_me IS NULL OR p_workspace_id IS NULL OR p_query IS NULL THEN
    RETURN;
  END IF;
  v_channels := ARRAY(SELECT public.chat__readable_channel_ids(p_workspace_id, v_me));
  IF p_channel_id IS NOT NULL THEN
    v_channels := CASE WHEN p_channel_id = ANY (v_channels)
                       THEN ARRAY[p_channel_id] ELSE '{}'::uuid[] END;
  END IF;
  RETURN QUERY SELECT * FROM public.chat__search_in(v_channels, p_workspace_id, p_query, p_before,
    p_before_id, p_limit, p_from, p_after, p_has_file);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_agent_search(
  p_workspace_id uuid,
  p_query text,
  p_channel_id uuid DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20)
  RETURNS TABLE (
    message_id uuid,
    channel_id uuid,
    channel_name text,
    parent_id uuid,
    author_id uuid,
    author_name text,
    via text,
    created_at timestamptz,
    snippet text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  SET statement_timeout = '5s'
AS $$
DECLARE
  v_actor record;
  v_channels uuid[];
BEGIN
  v_actor := public.chat__key_actor('view');
  IF p_workspace_id IS DISTINCT FROM v_actor.workspace_id THEN
    RAISE EXCEPTION 'This API key belongs to another workspace.' USING ERRCODE = '42501';
  END IF;
  v_channels := ARRAY(SELECT public.chat__key_channel_ids(v_actor.workspace_id, v_actor.creator,
                                                           v_actor.private_ok));
  IF p_channel_id IS NOT NULL THEN
    v_channels := CASE WHEN p_channel_id = ANY (v_channels)
                       THEN ARRAY[p_channel_id] ELSE '{}'::uuid[] END;
  END IF;
  RETURN QUERY
    SELECT s.message_id, s.channel_id, s.channel_name, s.parent_id, s.author_id,
           coalesce(CASE WHEN s.author_id IS NOT NULL THEN
                      coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Former member') END,
                    nullif(pg_catalog.btrim(s.author_label), ''), 'An app'),
           CASE WHEN s.author_kind = 'api_key' AND s.author_id IS NOT NULL THEN s.author_label END,
           s.created_at, s.snippet
      FROM public.chat__search_in(v_channels, p_workspace_id, p_query, p_before, p_before_id,
                                  least(greatest(coalesce(p_limit, 20), 1), 50), NULL, NULL, false) s
      LEFT JOIN public.profiles p ON p.id = s.author_id;
END;
$$;

-- What's addressed to the key's creator: their open Catch up items that name
-- them, answer them or announce, in conversations the key reads (never a
-- direct message), newest first.
CREATE OR REPLACE FUNCTION public.chat_agent_addressed(p_workspace_id uuid, p_limit integer DEFAULT 30)
  RETURNS TABLE (
    item_id uuid,
    reason text,
    channel_id uuid,
    channel_name text,
    message_id uuid,
    chain_root_id uuid,
    author_id uuid,
    author_name text,
    via text,
    body text,
    created_at timestamptz)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_actor record;
BEGIN
  v_actor := public.chat__key_actor('view');
  IF p_workspace_id IS DISTINCT FROM v_actor.workspace_id THEN
    RAISE EXCEPTION 'This API key belongs to another workspace.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT k.id, k.reason, c.id, c.name, m.id, k.chain_root_id, m.author_id,
           coalesce(CASE WHEN m.author_id IS NOT NULL THEN
                      coalesce(nullif(btrim(p.display_name), ''), 'Former member') END,
                    nullif(btrim(m.author_label), ''), 'An app'),
           CASE WHEN m.author_kind = 'api_key' AND m.author_id IS NOT NULL THEN m.author_label END,
           m.body, m.created_at
      FROM public.chat_catchup k
      JOIN public.chat_messages m ON m.id = k.message_id AND m.deleted_at IS NULL
      JOIN public.chat_channels c ON c.id = m.channel_id
      LEFT JOIN public.profiles p ON p.id = m.author_id
     WHERE k.user_id = v_actor.creator AND k.workspace_id = v_actor.workspace_id
       AND k.done_at IS NULL
       -- What Catch up shows now (chat_catchup_open's rules): not put off
       -- with Later, no team mention while teams are muted, no muted chain.
       AND (k.later_until IS NULL OR k.later_notified_at IS NOT NULL OR k.later_until <= now())
       AND k.reason IN ('mention', 'team_mention', 'everyone', 'reply', 'announcement')
       -- Never the key's own posts back to it.
       AND m.api_key_id IS DISTINCT FROM public.module_api_key_id()
       AND NOT (k.reason = 'team_mention' AND public.chat__team_muted(v_actor.creator))
       AND NOT (k.reason = 'reply' AND EXISTS (
             SELECT 1 FROM public.chat_chain_mutes cm
              WHERE cm.user_id = v_actor.creator AND cm.root_id = k.chain_root_id))
       AND m.channel_id IN (SELECT public.chat__key_channel_ids(v_actor.workspace_id, v_actor.creator,
                                                                v_actor.private_ok))
     ORDER BY m.created_at DESC, k.id DESC
     LIMIT least(greatest(coalesce(p_limit, 30), 1), 100);
END;
$$;

-- ── 8. Who has a key that reads this private channel ────────────────────────

CREATE OR REPLACE FUNCTION public.chat_key_readers(p_channel_id uuid)
  RETURNS TABLE (user_id uuid, display_name text)
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NOT public.chat_can_read_channel(p_channel_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT k.created_by, coalesce(nullif(btrim(p.display_name), ''), 'Someone')
      FROM public.chat_channels c
      JOIN public.workspace_api_keys k ON k.workspace_id = c.workspace_id
      LEFT JOIN public.profiles p ON p.id = k.created_by
     WHERE c.id = p_channel_id AND c.kind = 'channel' AND c.is_private AND c.deleted_at IS NULL
       AND k.include_private_chat AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > now())
       AND coalesce(public.module_api_key_effective_scopes(k.id) ->> 'chat', 'none') IN ('view', 'edit')
       AND public.chat__can_read_channel_as(c.id, k.created_by);
END;
$$;

-- Your own live keys that read chat here (Settings' "Replies to posts by <key>"),
-- whether or not you still manage keys.
CREATE OR REPLACE FUNCTION public.chat_my_keys(p_workspace_id uuid)
  RETURNS TABLE (id uuid, name text)
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT k.id, k.name
    FROM public.workspace_api_keys k
   WHERE k.workspace_id = p_workspace_id AND k.created_by = auth.uid()
     AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
     AND coalesce(public.module_api_key_effective_scopes(k.id) ->> 'chat', 'none') IN ('view', 'edit')
   ORDER BY k.created_at, k.id
$$;

-- ── Grants (DROP-free: redefined functions keep theirs; restated by name) ────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal: callable from the definer ops only (and the service role, by
  -- the build's convention).
  FOREACH fn IN ARRAY ARRAY[
    'chat__key_actor(text)',
    'chat__key_reads_channel(uuid, uuid, boolean)',
    'chat__key_channel_ids(uuid, uuid, boolean)',
    'chat__key_replies_on(uuid, uuid)',
    'chat__key_message(uuid, uuid, text)',
    'chat__op_guard_as(uuid, uuid)',
    'chat__op_reader_as(uuid, uuid)',
    'chat__op_channel_as(uuid, uuid)',
    'chat__chain_root_as(uuid, uuid)',
    'chat__react_as(uuid, uuid, text, boolean)',
    'chat__mark_decision_as(uuid, uuid, boolean)',
    'chat__wrap_up_as(uuid, uuid, uuid, boolean)',
    'chat__create_channel_as(uuid, uuid, text, text, boolean, uuid[], boolean, text, uuid, uuid)',
    'chat__search_in(uuid[], uuid, text, timestamptz, uuid, integer, uuid, timestamptz, boolean)',
    'chat__sender_label(public.chat_messages, uuid)',
    'chat__activity(public.chat_channels, public.chat_messages, uuid, text, text, uuid[], uuid[])',
    'chat__fan_out(public.chat_messages, public.chat_channels, uuid, public.chat_messages)',
    'chat__notify_devices(public.chat_channels, public.chat_messages, uuid, text, uuid[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;

  -- The connector's (a key, as the service role) alone.
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_agent_post(uuid, uuid, text, uuid)',
    'chat_op_agent_react(uuid, uuid, text, boolean)',
    'chat_op_agent_mark_decision(uuid, uuid, boolean)',
    'chat_op_agent_wrap_up(uuid, uuid, uuid, boolean)',
    'chat_op_agent_create_channel(uuid, text, text, boolean)',
    'chat_agent_conversations(uuid)',
    'chat_agent_messages(uuid, uuid, timestamptz, uuid, integer)',
    'chat_agent_search(uuid, text, uuid, timestamptz, uuid, integer)',
    'chat_agent_addressed(uuid, integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;

  -- People's (as before for the four ops; the two new ones too).
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_react(uuid, text, boolean)',
    'chat_op_mark_decision(uuid, boolean)',
    'chat_op_wrap_up(uuid, uuid, boolean)',
    'chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;

  -- Signed-in people only: they answer about auth.uid() (a key gets nothing).
  FOREACH fn IN ARRAY ARRAY[
    'chat_unread_counts(uuid)',
    'chat_catchup_open(uuid)',
    'chat_key_readers(uuid)',
    'chat_my_keys(uuid)',
    'workspace_api_keys_set_private_chat(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;

  -- chat_search answers people only (CV-19).
  REVOKE ALL ON FUNCTION public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)
    TO authenticated;
END;
$$;
