-- Chat v1: per-person sending and typing limits — a standalone change to the
-- live module, like 20261014090000_chat_privacy_rules.
--
--   1. Sending. A BEFORE INSERT trigger on chat_messages, so it holds on every
--      way a message is written (chat_op_send, chat_op_agent_post, later ops).
--      A person may post at most 10 messages in 10 seconds and 30 in 60
--      seconds in one workspace (sustained, one every 2 seconds). An app's
--      messages have no author (author_id NULL, author_kind 'api_key'), so the
--      apps of one workspace share one budget of the same size. Writes with
--      neither a signed-in person nor an API key behind them (service work,
--      cron, migrations) are not limited. Every message counts, deleted ones
--      and thread replies included. The app's retry of a failed send reuses
--      its client_id, and chat_op_send answers an already-saved client_id
--      before inserting, so a retry never counts twice.
--      Why these numbers: a fast typist sending one-line replies stays well
--      under one message a second, and a pasted list is one message, so
--      neither reaches 10 in 10 s; 30 a minute is about twice the steadiest
--      back-and-forth. A refusal is SQLSTATE PT429, which PostgREST answers as
--      HTTP 429 with the message in the body; the app marks the message as not
--      sent (with Retry) and shows the message in its toast, and the connector
--      returns it to the app that posted. Each check reads at most the
--      sender's 30 newest messages, and waits at most 2 seconds for the
--      sender's previous send to finish (then it is refused the same way).
--   2. Typing. chat_op_typing broadcasts a person's "typing" at most once per
--      2.5 seconds per conversation (the app sends at most one every 3 s), and
--      "stopped typing" only to end a "typing" that went out, once. Every
--      other call returns quietly. So a conversation hears at most one start
--      and one stop per person per 2.5 s. The last start per person and
--      conversation (its time, its thread, whether it is still open) is kept
--      in chat_typing_marks, and a stop names the thread of the start it
--      closes. No client reads or writes the marks, and they go with the
--      person's account and with the conversation.
--   3. Account erasure counts and removes the person's typing marks.
--
-- chat_op_typing is redefined from the live body (2026-10-14), same signature;
-- its grants are re-stated and asserted below.

-- Fail fast instead of queueing the app behind this migration's locks.
SET LOCAL lock_timeout = '5s';

-- ── 1. Sending ───────────────────────────────────────────────────────────────

-- Serves "this author's messages in this workspace since T" and, with
-- author_id IS NULL, "this workspace's app messages since T".
CREATE INDEX IF NOT EXISTS chat_messages_author_recent_idx
  ON public.chat_messages (author_id, workspace_id, created_at);

-- lock_timeout bounds the wait for the sender's previous send; the function's
-- own setting, restored when it returns.
CREATE OR REPLACE FUNCTION public.chat_send_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '2s' AS $$
DECLARE
  v_in_10s integer;
  v_in_60s integer;
BEGIN
  -- Only what a signed-in person or an API key writes.
  IF auth.uid() IS NULL AND public.module_api_key_id() IS NULL THEN
    RETURN NEW;
  END IF;

  -- One send per sender and workspace at a time, so each count includes the
  -- send before it. A send still waiting after 2 s is refused like any other.
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'chat_send_limit:' || coalesce(NEW.author_id::text, 'apps') || ':' || NEW.workspace_id::text, 0));
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'You''re sending messages too quickly. Wait a moment and try again.'
      USING ERRCODE = 'PT429';
  END;

  -- The newest 30 in the last minute are all either limit needs.
  IF NEW.author_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE r.created_at > now() - interval '10 seconds')
      INTO v_in_60s, v_in_10s
      FROM (SELECT m.created_at FROM public.chat_messages m
             WHERE m.author_id = NEW.author_id
               AND m.workspace_id = NEW.workspace_id
               AND m.created_at > now() - interval '60 seconds'
             ORDER BY m.created_at DESC
             LIMIT 30) r;
  ELSE
    SELECT count(*), count(*) FILTER (WHERE r.created_at > now() - interval '10 seconds')
      INTO v_in_60s, v_in_10s
      FROM (SELECT m.created_at FROM public.chat_messages m
             WHERE m.author_id IS NULL
               AND m.workspace_id = NEW.workspace_id
               AND m.author_kind = 'api_key'
               AND m.created_at > now() - interval '60 seconds'
             ORDER BY m.created_at DESC
             LIMIT 30) r;
  END IF;

  IF v_in_10s >= 10 OR v_in_60s >= 30 THEN
    RAISE EXCEPTION 'You''re sending messages too quickly. Wait a moment and try again.'
      USING ERRCODE = 'PT429';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_send_limit() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS chat_send_limit ON public.chat_messages;
CREATE TRIGGER chat_send_limit
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_send_limit();

-- ── 2. Typing ────────────────────────────────────────────────────────────────

-- When each person last told a conversation they were typing, in which
-- thread (NULL: the conversation itself), and whether that "typing" is still
-- open (no "stopped" sent for it yet). Server-only.
CREATE TABLE IF NOT EXISTS public.chat_typing_marks (
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  sent_at    timestamptz NOT NULL,
  parent_id  uuid,
  open       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, channel_id)
);
ALTER TABLE public.chat_typing_marks ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.chat_typing_marks ADD COLUMN IF NOT EXISTS open boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS chat_typing_marks_channel_idx ON public.chat_typing_marks (channel_id);
ALTER TABLE public.chat_typing_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_typing_marks FROM PUBLIC, anon, authenticated;

-- "I'm typing" (or "I stopped") in a conversation I can read, told to the
-- conversation's members through its typing topic. The sender is the session.
-- "Typing" goes out at most once per 2.5 s per person and conversation;
-- "stopped" goes out once for each "typing" that did.
CREATE OR REPLACE FUNCTION public.chat_op_typing(
  p_channel_id uuid,
  p_parent_id uuid DEFAULT NULL,
  p_stop boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_send boolean;
  v_parent uuid := p_parent_id;
BEGIN
  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.id = p_parent_id AND m.channel_id = v_channel.id
      AND m.parent_id IS NULL AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'That thread no longer exists.';
  END IF;
  IF NOT coalesce(p_stop, false) THEN
    -- Moves the mark only when the last start is old enough; a row back means send.
    INSERT INTO public.chat_typing_marks AS t (user_id, channel_id, sent_at, parent_id, open)
    VALUES (auth.uid(), v_channel.id, now(), p_parent_id, true)
    ON CONFLICT (user_id, channel_id) DO UPDATE
      SET sent_at = EXCLUDED.sent_at, parent_id = EXCLUDED.parent_id, open = true
      WHERE t.sent_at <= EXCLUDED.sent_at - interval '2.5 seconds'
    RETURNING true INTO v_send;
  ELSE
    -- Closes an open start, never moving its time; a row back means send, for
    -- the thread that start was in.
    UPDATE public.chat_typing_marks SET open = false
     WHERE user_id = auth.uid() AND channel_id = v_channel.id AND open
    RETURNING true, parent_id INTO v_send, v_parent;
  END IF;
  IF v_send IS NULL THEN
    RETURN;
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'userId', auth.uid(),
      'channelId', v_channel.id,
      'parentId', v_parent,
      'stop', coalesce(p_stop, false)),
    'typing',
    'chat:typing:' || v_channel.id::text,
    true);
END;
$$;
REVOKE ALL ON FUNCTION public.chat_op_typing(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.chat_op_typing(uuid, uuid, boolean) TO authenticated;

-- ── 3. Account erasure: the person's typing marks ───────────────────────────
-- Anchored replace on the live body, like 20261013201000 did. The marks are
-- the person's own wherever they are, so all of them go (as with
-- notice_deliveries); deleting the account would cascade them anyway.

DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
  v_anchor text;
BEGIN
  IF position('chat_typing_marks_deleted' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  FOREACH v_anchor IN ARRAY ARRAY[
    'v_deliveries integer;',
    'SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;',
    '''notice_deliveries_deleted'', v_deliveries,',
    'DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;'
  ] LOOP
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects (%); redefine it by hand.', v_anchor;
    END IF;
  END LOOP;
  v_new := replace(v_def, 'v_deliveries integer;',
    'v_deliveries integer;' || E'\n  v_typing_marks integer;');
  v_new := replace(v_new,
    'SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;',
    'SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;'
    || E'\n  SELECT count(*) INTO v_typing_marks FROM public.chat_typing_marks x WHERE x.user_id = p_user;');
  v_new := replace(v_new, '''notice_deliveries_deleted'', v_deliveries,',
    '''notice_deliveries_deleted'', v_deliveries,'
    || E'\n    ''chat_typing_marks_deleted'', v_typing_marks,');
  v_new := replace(v_new,
    'DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;',
    'DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;'
    || E'\n  DELETE FROM public.chat_typing_marks x WHERE x.user_id = p_user;');
  EXECUTE v_new;
END;
$erase$;

-- ── Assert the result ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid = 'public.chat_messages'::regclass AND tgname = 'chat_send_limit'
                   AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'The chat_send_limit trigger is not in place on chat_messages.';
  END IF;
  IF to_regclass('public.chat_messages_author_recent_idx') IS NULL THEN
    RAISE EXCEPTION 'chat_messages_author_recent_idx is missing.';
  END IF;
  IF NOT coalesce((SELECT 'lock_timeout=2s' = ANY (proconfig) FROM pg_proc
                   WHERE oid = 'public.chat_send_limit()'::regprocedure), false) THEN
    RAISE EXCEPTION 'chat_send_limit must bound its wait with its own lock_timeout.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute
      WHERE attrelid = 'public.chat_typing_marks'::regclass AND NOT attisdropped
        AND ((attname = 'open' AND attnotnull) OR attname = 'parent_id')) <> 2 THEN
    RAISE EXCEPTION 'chat_typing_marks needs its open and parent_id columns.';
  END IF;
  -- Both definer functions count and write past RLS as their owner.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
             WHERE p.oid IN ('public.chat_send_limit()'::regprocedure,
                             'public.chat_op_typing(uuid, uuid, boolean)'::regprocedure)
               AND NOT r.rolbypassrls) THEN
    RAISE EXCEPTION 'chat_send_limit and chat_op_typing must be owned by a role that bypasses RLS (postgres).';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chat_typing_marks'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_typing_marks')
     OR has_table_privilege('anon', 'public.chat_typing_marks', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.chat_typing_marks', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'chat_typing_marks must be server-only: RLS on, no policies, no client grants.';
  END IF;
  IF has_function_privilege('anon', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'chat_op_typing must be callable by signed-in people only.';
  END IF;
  IF position('chat_typing_marks_deleted' IN
              pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data does not count the typing marks.';
  END IF;
END;
$$;
