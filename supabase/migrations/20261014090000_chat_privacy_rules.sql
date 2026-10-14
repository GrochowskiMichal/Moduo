-- Chat v1 privacy rules — a standalone change to the live module. The Chat v2
-- rebuild keeps every rule here (.design/chat-v2/research/round-3-database.md
-- §2.7 and §2.25 a), so its foundation migration can take them as given.
--
-- The rules:
--   1. A row about a conversation outside the chat tables follows the
--      conversation's read rule. perm_can_see_entity answers for chat_channel
--      and chat_message through chat_can_read_channel, so the policies that
--      call it (entities_workspace_read, module_activity_workspace_read) do too.
--   2. Typing reaches only the conversation's members, and the sender comes
--      from the session. One private Realtime topic per conversation,
--      chat:typing:<channel id>, readable by the people who can read the
--      conversation; no client writes to it. Its only writer is chat_op_typing,
--      which checks membership and broadcasts through realtime.send with
--      auth.uid() in the payload. The workspace topic chat:<workspace id> keeps
--      presence only: members with chat read it and track themselves on it.
--   3. chat_caps_get answers members of that workspace; anyone else gets [].
--   4. share_op_announce applies to a channel the caller can read, never to a
--      direct message.
--
-- Every existing body is redefined from the live catalog (2026-10-14). Same
-- signatures keep their grants; every grant is re-stated and asserted below.

-- Fail fast instead of queueing the app behind this migration's policy locks.
SET LOCAL lock_timeout = '5s';

-- ── 1. Conversations in the registry and the activity feed ──────────────────

CREATE OR REPLACE FUNCTION public.perm_can_see_entity(p_workspace_id uuid, p_type text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_type = 'note' THEN RETURN public.can_access('note', p_id, 'view');
  ELSIF p_type IN ('task', 'task_project') THEN RETURN public.can_access('task', p_id, 'view');
  ELSIF p_type = 'bucket' THEN RETURN public.can_access('bucket', p_id, 'view');
  ELSIF p_type = 'contact' THEN RETURN public.can_access('contact', p_id, 'view');
  ELSIF p_type = 'company' THEN RETURN public.can_access('company', p_id, 'view');
  ELSIF p_type = 'event' THEN RETURN public.can_access('event', p_id, 'view');
  ELSIF p_type = 'email_thread' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_refs r WHERE r.id = p_id AND r.owner_id = public.perm_actor_id());
  ELSIF p_type = 'email_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = p_id AND a.owner_id = public.perm_actor_id());
  ELSIF p_type = 'calendar_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.calendar_accounts a WHERE a.id = p_id AND a.owner_id = public.perm_actor_id());
  -- A conversation, and anything about it, is readable by the people who can
  -- read the conversation: every member with chat for a public channel, its
  -- members for a private channel or a direct message (chat_can_read_channel).
  -- Apps read chat through the chat tools alone, never through the spine.
  ELSIF p_type = 'chat_channel' THEN
    IF public.module_api_key_id() IS NULL THEN
      RETURN EXISTS (SELECT 1 FROM public.chat_channels c
                     WHERE c.id = p_id AND c.workspace_id = p_workspace_id)
         AND public.chat_can_read_channel(p_id);
    END IF;
    RETURN false;
  ELSIF p_type = 'chat_message' THEN
    IF public.module_api_key_id() IS NULL THEN
      RETURN EXISTS (SELECT 1 FROM public.chat_messages m
                     WHERE m.id = p_id AND m.workspace_id = p_workspace_id
                       AND public.chat_can_read_channel(m.channel_id));
    END IF;
    RETURN false;
  ELSE
    RETURN public.perm_can_view_entity(p_workspace_id, p_type);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.perm_can_see_entity(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perm_can_see_entity(uuid, text, uuid) TO authenticated, service_role;

-- ── 2. Typing: one private topic per conversation, written by the server ────

-- Topics a signed-in person may read: the workspace's presence topic
-- (chat:<workspace id>) as a member with chat, and a conversation's typing
-- topic (chat:typing:<channel id>) as someone who can read the conversation.
CREATE OR REPLACE FUNCTION public.chat_realtime_topic_allowed(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.chat_can_access_workspace(substring(p_topic from 6)::uuid)
    WHEN p_topic ~ '^chat:typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.chat_can_read_channel(substring(p_topic from 13)::uuid)
    ELSE false
  END
$$;
REVOKE ALL ON FUNCTION public.chat_realtime_topic_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_realtime_topic_allowed(text) TO authenticated;

-- Topics a signed-in person may write to: only the workspace's presence topic.
-- Nothing a client sends lands on a typing topic.
CREATE OR REPLACE FUNCTION public.chat_realtime_topic_writable(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND public.chat_can_access_workspace(substring(p_topic from 6)::uuid)
$$;
REVOKE ALL ON FUNCTION public.chat_realtime_topic_writable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_realtime_topic_writable(text) TO authenticated;

DROP POLICY IF EXISTS chat_realtime_read ON realtime.messages;
CREATE POLICY chat_realtime_read ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension IN ('broadcast', 'presence')
         AND public.chat_realtime_topic_allowed(realtime.topic()));

DROP POLICY IF EXISTS chat_realtime_write ON realtime.messages;
CREATE POLICY chat_realtime_write ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (realtime.messages.extension = 'presence'
              AND public.chat_realtime_topic_writable(realtime.topic()));

-- "I'm typing" (or "I stopped") in a conversation I can read, told to the
-- conversation's members through its typing topic. The sender is the session.
CREATE OR REPLACE FUNCTION public.chat_op_typing(
  p_channel_id uuid,
  p_parent_id uuid DEFAULT NULL,
  p_stop boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
BEGIN
  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.id = p_parent_id AND m.channel_id = v_channel.id
      AND m.parent_id IS NULL AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'That thread no longer exists.';
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'userId', auth.uid(),
      'channelId', v_channel.id,
      'parentId', p_parent_id,
      'stop', coalesce(p_stop, false)),
    'typing',
    'chat:typing:' || v_channel.id::text,
    true);
END;
$$;
REVOKE ALL ON FUNCTION public.chat_op_typing(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.chat_op_typing(uuid, uuid, boolean) TO authenticated;

-- ── 3. Chat capabilities are a member's reading ─────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_caps_get(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
  FROM public.workspace_chat_caps c
  WHERE c.workspace_id = p_workspace_id
    AND public.chat_is_workspace_member(p_workspace_id, auth.uid())
$$;
REVOKE ALL ON FUNCTION public.chat_caps_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_caps_get(uuid) TO authenticated, service_role;

-- ── 4. Announcement mode: a channel the caller can read, never a DM ─────────

CREATE OR REPLACE FUNCTION public.share_op_announce(p_channel_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_channel public.chat_channels;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF v_channel.id IS NULL OR NOT public.chat_can_read_channel(p_channel_id) THEN
    RAISE EXCEPTION 'That channel is gone.';
  END IF;
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages can''t be announcement-only.';
  END IF;
  IF NOT (
    public.chat_has_cap(v_channel.workspace_id, auth.uid(), 'manage_any')
    OR EXISTS (SELECT 1 FROM public.chat_channel_managers m WHERE m.channel_id = p_channel_id AND m.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Only a channel manager can change this.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.chat_channels SET managers_only = coalesce(p_on, false) WHERE id = p_channel_id;
END;
$$;
REVOKE ALL ON FUNCTION public.share_op_announce(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_announce(uuid, boolean) TO authenticated, service_role;

-- ── Assert the grants and the policies ──────────────────────────────────────

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'perm_can_see_entity(uuid, text, uuid)',
    'chat_realtime_topic_allowed(text)',
    'chat_realtime_topic_writable(text)',
    'chat_op_typing(uuid, uuid, boolean)',
    'chat_caps_get(uuid)',
    'share_op_announce(uuid, boolean)'
  ] LOOP
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
  -- Typing is a person's act: neither a key (service_role) nor anon may call it.
  IF has_function_privilege('service_role', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'chat_op_typing must be callable by signed-in people only.';
  END IF;
  -- realtime.send inserts as the op's owner and turns a refusal into a warning,
  -- so the owner must bypass RLS on realtime.messages for typing to arrive.
  IF NOT (SELECT r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.oid = 'public.chat_op_typing(uuid, uuid, boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'chat_op_typing must be owned by a role that bypasses RLS (postgres).';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'realtime' AND tablename = 'messages'
        AND policyname IN ('chat_realtime_read', 'chat_realtime_write')) <> 2 THEN
    RAISE EXCEPTION 'The chat Realtime policies are not both in place.';
  END IF;
END;
$$;
