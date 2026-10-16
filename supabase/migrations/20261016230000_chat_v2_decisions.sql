-- Chat v2 · CV-14 Decisions (specs/chat-v2.md §8, §5, §12; CH13, CH52, CH53;
-- §Assumptions #15, #24, #25; .design/chat-v2/research/round-3-database.md
-- §2.17). The stamp is fixed by the build's migration queue; it must stay after
-- …_chat_v2_chains (CV-12: chat_op_wrap_up's live body) and
-- …_chat_v2_linked_channels (CV-13: chat_channels.linked_type / linked_id and
-- chat_conversations_for_item's two halves, which chat_decisions_for_item
-- mirrors). Every redefined function starts from its live body on the local
-- stack. It runs again cleanly over itself.
--
-- What it does:
--   1. chat_messages.decision_at / decision_by: a message marked as a decision
--      (a single update Realtime carries like any other; the publication has
--      no column list, so the new columns ride it as they are). Messages only,
--      never event lines. A partial index for Details' Decisions and the item
--      reads.
--   2. chat_op_mark_decision(message, on): marks or unmarks. Needs reading the
--      message and the right to post in its conversation (members, managers,
--      admins; never a viewer, never in an archived channel), and the plan.
--      Activity `chat.decision` with ids only; no notice (quiet).
--   3. chat_op_wrap_up (CV-12's live body): "Also mark as decision" now marks
--      the settling reply, under the same rule as 2.
--   4. chat_decisions_for_item(type, id): the decisions to show on an item
--      ("Decided with Mike · Oct 12: …"), from the conversations linked to it
--      (all their decisions) or that mention it (the decisions whose own text
--      refers to it), only those the caller can read, for an item the caller
--      can open. Works from direct messages too, for their readers only.
--   Nothing here takes a person from the caller; an API key reads no chat row
--   through it.

SET LOCAL lock_timeout = '5s';

-- ── 1. The decision columns ─────────────────────────────────────────────────
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS decision_at timestamptz;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS decision_by uuid;

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_decision_by_fkey;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_decision_by_fkey
  FOREIGN KEY (decision_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- A decision is a message's (never an event line's); whoever marked it may be
-- erased later (their id goes, the decision stays).
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_decision_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_decision_check
  CHECK ((decision_at IS NULL OR kind = 'message')
         AND (decision_by IS NULL OR decision_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS chat_messages_decisions_idx
  ON public.chat_messages (channel_id, decision_at DESC)
  WHERE decision_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_messages_decision_by_idx
  ON public.chat_messages (decision_by) WHERE decision_by IS NOT NULL;

-- ── 2. Mark, unmark ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_op_mark_decision(p_message_id uuid, p_on boolean DEFAULT true)
 RETURNS public.chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_channel public.chat_channels;
BEGIN
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Say whether to mark or unmark it.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  -- Signed in, in the workspace, on a plan with chat, reading the conversation.
  v_channel := public.chat_op__channel(v_msg.channel_id);
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
$function$;

-- ── 3. Wrap up: "Also mark as decision" (CV-12's live body + the mark) ──────
CREATE OR REPLACE FUNCTION public.chat_op_wrap_up(p_root_id uuid, p_settled_id uuid, p_mark_decision boolean DEFAULT false)
 RETURNS public.chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       SET decision_at = now(), decision_by = v_me
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
     SET wrapped_at = clock_timestamp(), wrapped_by = v_me, settled_id = v_settled.id,
         reopened_at = NULL, reopened_by = NULL
   WHERE id = v_root.id
  RETURNING * INTO v_root;
  PERFORM public.module_activity_log(v_root.workspace_id, 'chat', 'chat_channel', v_root.channel_id,
    'chat.wrap_up', jsonb_build_object('message_id', v_root.id, 'settled_id', v_settled.id,
                                       'mark_decision', coalesce(p_mark_decision, false)));
  RETURN v_root;
END;
$function$;

-- ── 4. Decisions on an item ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.chat_decisions_for_item(text, uuid);
CREATE FUNCTION public.chat_decisions_for_item(p_type text, p_id uuid)
 RETURNS TABLE(message_id uuid, parent_id uuid, channel_id uuid, workspace_id uuid, channel_kind text,
               channel_name text, with_names text[], decision_at timestamptz, decision_by uuid,
               author_id uuid, author_kind text, author_label text, excerpt text,
               created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH item AS (
    -- The registry's name (links and the link column) and the message text's
    -- (`moduo://project/…`, `moduo://email/…`).
    SELECT CASE p_type WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread' ELSE p_type END AS t,
           CASE p_type WHEN 'bucket' THEN 'project' WHEN 'email_thread' THEN 'email' ELSE p_type END AS ref
  ), convs AS (
    -- Conversations that mention the item (chat__link_mentions' rows) …
    SELECT l.workspace_id, l.source_id AS cid, false AS linked
      FROM public.entity_links l, item
     WHERE auth.uid() IS NOT NULL
       AND l.deleted_at IS NULL
       AND l.relation_kind = 'mentions'
       AND l.origin = 'ref'
       AND l.source_type = 'chat_channel'
       AND l.target_type = item.t AND l.target_id = p_id
    UNION
    -- … and the channels linked to it (the column is the truth, CV-13).
    SELECT c.workspace_id, c.id, true
      FROM public.chat_channels c, item
     WHERE auth.uid() IS NOT NULL
       AND c.linked_type = item.t AND c.linked_id = p_id
  ), readable AS (
    SELECT c.*, bool_or(v.linked) AS is_linked
      FROM convs v
      JOIN public.chat_channels c ON c.id = v.cid AND c.workspace_id = v.workspace_id
                                 AND c.deleted_at IS NULL
      , item
     WHERE public.chat_can_read_channel(c.id)
       AND public.perm_can_see_entity(v.workspace_id, item.t, p_id)
     GROUP BY c.id
  )
  SELECT m.id, m.parent_id, c.id, c.workspace_id, c.kind,
         CASE WHEN c.kind = 'channel' THEN c.name END,
         CASE WHEN c.kind = 'dm' THEN ARRAY(
           SELECT coalesce(nullif(btrim(p.display_name), ''), 'Someone')
             FROM public.chat_members cm
             LEFT JOIN public.profiles p ON p.id = cm.user_id
            WHERE cm.channel_id = c.id AND cm.left_at IS NULL AND cm.user_id <> auth.uid()
            ORDER BY 1) END,
         m.decision_at, m.decision_by, m.author_id, m.author_kind, m.author_label,
         public.chat__excerpt(m.body), m.created_at
    FROM readable c
    JOIN public.chat_messages m
      ON m.channel_id = c.id AND m.decision_at IS NOT NULL AND m.deleted_at IS NULL
     AND m.kind = 'message'
    , item
   WHERE c.is_linked
      OR EXISTS (SELECT 1 FROM public.chat__body_refs(m.body) b
                  WHERE b.ref_type = item.ref AND b.ref_id = p_id)
   ORDER BY m.decision_at DESC, m.id
   LIMIT 50
$function$;

-- ── 5. Grants (re-stated by name; DROP + CREATE reset them) ─────────────────
-- chat_op_wrap_up's are CV-12's (…_chat_v2_chains.sql): signed-in people and
-- the service role, never anon.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_mark_decision(uuid, boolean)',
    'chat_op_wrap_up(uuid, uuid, boolean)',
    'chat_decisions_for_item(text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
END;
$$;
