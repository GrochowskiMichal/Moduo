-- CV-16: Move to… (spec §5 "Tidy up afterwards", round-3 §2.19, Assumption
-- #24, CH55). Fixed stamp in chat's order (after CV-10-fix, CV-11, CV-17,
-- CV-9 and CV-13). Adds the move; redefines chat_op_send,
-- chat_op_attach_to_chain and chat_sync_ids (section 4, from their live bodies).
--
--   1. Columns on chat_messages: moved_at, moved_by, moved_from_channel_id
--      (the last move: when, who, from where).
--   2. Helpers (server only): chat__channel_readers (who can read a
--      conversation right now, the same rule as chat_can_read_channel) and
--      chat__move_refile_items (Catch up items follow their messages for the
--      people who can read where they went; the rest close as 'closed'),
--      chat__move_scrub_notices (waiting notices and "waiting" emails lose
--      the words for people who can't read where the messages went) and
--      chat__move_relink (below).
--   3. chat_op_move_messages(ids, target, confirm, undo): the person comes from the
--      session; read on the source, post rights in the target. Your own
--      messages go anywhere: when people who can read the target couldn't
--      read the source, the op first answers with how many and moves only
--      when called again with confirm. Someone else's messages move only by
--      the source's managers and admins, and only to a conversation whose
--      readers could all read the source already. A root brings its whole
--      chain; a reply moved alone leaves its chain; a quote across the two
--      conversations is dropped (on both sides); pins are dropped;
--      reactions and files stay on the message. One quiet event line in each
--      conversation (moved_out in the source with the ids, moved_in in the
--      target naming the source as a moduo:// reference). Nothing pings.
--      With undo, by the same person within 10 s, the moved ids and the
--      source as the target: the messages go back where they were (chains,
--      quotes, pins and a chain they had settled restored) and both lines are
--      soft-deleted; too late, it moves nothing (never a fresh move).
--      At most five moves per person in 10 s (PT429, the sending limit's code).
--   4. chat_op_send and chat_op_attach_to_chain check again, once the chain
--      is locked, that the message they answer and its chain are still in
--      this conversation (a move at the same moment can't leave a reply
--      across two conversations); chat_sync_ids also names the ids an Undo
--      took back, so a device that was offline drops them on its next sync.
--   5. Grants, by name.
--
-- "Mentioned in" lines follow the messages through chat__link_mentions (the
-- chat path's only writer of those rows), with each message's author; a
-- source line nothing left there refers to is retired.

SET LOCAL lock_timeout = '5s';

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS moved_at timestamptz,
  ADD COLUMN IF NOT EXISTS moved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moved_from_channel_id uuid REFERENCES public.chat_channels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_messages_moved_by_idx
  ON public.chat_messages (moved_by) WHERE moved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_moved_from_idx
  ON public.chat_messages (moved_from_channel_id) WHERE moved_from_channel_id IS NOT NULL;
-- The move locks the messages quoting what it moves (one index lookup each).
CREATE INDEX IF NOT EXISTS chat_messages_reply_to_idx
  ON public.chat_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

COMMENT ON COLUMN public.chat_messages.moved_at IS
  'When the message last moved to this conversation (chat_op_move_messages); NULL if never or undone.';
COMMENT ON COLUMN public.chat_messages.moved_from_channel_id IS
  'The conversation it last moved from; readers who can''t read it see "Private item".';

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
-- Everyone who can read the conversation now: the workspace's owner and the
-- members with chat.view, then the whole of a public channel or the members
-- (not left) of a private channel or direct message. The same rule as
-- chat_can_read_channel / chat__can_read_channel_as.
CREATE OR REPLACE FUNCTION public.chat__channel_readers(p_channel_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH c AS (
    SELECT ch.* FROM public.chat_channels ch
      JOIN public.workspaces w ON w.id = ch.workspace_id AND w.deleted_at IS NULL
     WHERE ch.id = p_channel_id AND ch.deleted_at IS NULL
  ), ws AS (
    SELECT w.owner_id AS user_id FROM c JOIN public.workspaces w ON w.id = c.workspace_id
    UNION
    SELECT wm.user_id FROM c JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id
     WHERE 'chat.view' = ANY (wm.perms)
  )
  SELECT ws.user_id
    FROM ws, c
   WHERE ws.user_id IS NOT NULL
     AND ((c.kind = 'channel' AND NOT c.is_private)
          OR EXISTS (SELECT 1 FROM public.chat_members m
                      WHERE m.channel_id = c.id AND m.user_id = ws.user_id AND m.left_at IS NULL))
$function$;

-- Catch up items of moved messages (by message or by chain) follow them to
-- p_to for the people who can read it; everyone else's open ones close.
CREATE OR REPLACE FUNCTION public.chat__move_refile_items(p_ids uuid[], p_to uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  WITH readers AS (
    SELECT r AS user_id FROM public.chat__channel_readers(p_to) r
  ), items AS (
    SELECT k.id, k.user_id, k.done_at
      FROM public.chat_catchup k
     WHERE (k.message_id = ANY (p_ids) OR k.chain_root_id = ANY (p_ids))
       -- one open "new messages" line per conversation: it stays where it is
       AND k.reason NOT IN ('every_message', 'level_reset', 'added', 'removed')
  ), refile AS (
    UPDATE public.chat_catchup k SET channel_id = p_to
      FROM items i
     WHERE k.id = i.id AND k.channel_id <> p_to
       AND EXISTS (SELECT 1 FROM readers r WHERE r.user_id = i.user_id)
    RETURNING k.id
  )
  UPDATE public.chat_catchup k
     SET done_at = clock_timestamp(), done_how = 'closed'
    FROM items i
   WHERE k.id = i.id AND i.done_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM readers r WHERE r.user_id = i.user_id)
$function$;

-- Notices still waiting about moved messages: the people who can't read where
-- they went lose the words (an unsent push goes, a sent one keeps no body, a
-- queued "waiting" email drops its text), as a delete does for everyone.
CREATE OR REPLACE FUNCTION public.chat__move_scrub_notices(p_ids uuid[], p_to uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  DELETE FROM public.notice_deliveries d
   WHERE d.message_id = ANY (p_ids) AND d.pushed_at IS NULL
     AND NOT public.chat__can_read_channel_as(p_to, d.user_id);
  UPDATE public.notice_deliveries d SET body = NULL
   WHERE d.message_id = ANY (p_ids) AND d.body IS NOT NULL
     AND NOT public.chat__can_read_channel_as(p_to, d.user_id);
  UPDATE public.email_outbox o SET payload = o.payload || '{"text": null}'::jsonb
   WHERE o.kind = 'chat_waiting' AND o.created_at > now() - interval '8 days'
     AND o.payload ->> 'text' IS NOT NULL
     AND substring(o.payload ->> 'path' FROM '&m=([0-9a-f-]{36})$')::uuid = ANY (p_ids)
     AND NOT public.chat__can_read_channel_as(p_to, o.to_user_id);
$function$;

-- "Mentioned in" follows moved messages: the chat path's own writer
-- (chat__link_mentions, as send and edit call it, with each message's author)
-- leaves the lines for where they are now; a source line that no message left
-- there refers to any more is retired. Called by the move and by its Undo.
CREATE OR REPLACE FUNCTION public.chat__move_relink(p_ids uuid[], p_from uuid, p_to uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  r public.chat_messages;
BEGIN
  FOR r IN SELECT * FROM public.chat_messages m
            WHERE m.id = ANY (p_ids) AND m.channel_id = p_to AND m.kind = 'message'
              AND m.deleted_at IS NULL AND m.author_kind = 'user' AND m.author_id IS NOT NULL
              AND position('moduo://' IN m.body) > 0 LOOP
    PERFORM public.chat__link_mentions(r, r.author_id);
  END LOOP;
  WITH moved_refs AS (
    SELECT DISTINCT
           CASE b.ref_type WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread' ELSE b.ref_type END AS t,
           b.ref_id AS id
      FROM public.chat_messages m, public.chat__body_refs(m.body) b
     WHERE m.id = ANY (p_ids) AND position('moduo://' IN m.body) > 0
  )
  UPDATE public.entity_links l
     SET deleted_at = clock_timestamp()
    FROM moved_refs x
   WHERE l.source_type = 'chat_channel' AND l.source_id = p_from
     AND l.relation_kind = 'mentions' AND l.origin = 'ref' AND l.deleted_at IS NULL
     AND l.target_type = x.t AND l.target_id = x.id
     -- what stays behind (deleted messages too: a delete keeps its line)
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_messages m, public.chat__body_refs(m.body) b
        WHERE m.channel_id = p_from AND m.kind = 'message'
          AND position(l.target_id::text IN m.body) > 0
          AND b.ref_id = l.target_id
          AND CASE b.ref_type WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread' ELSE b.ref_type END
              = l.target_type);
END
$function$;

-- ── 3. The op ───────────────────────────────────────────────────────────────
-- Answers jsonb:
--   { "status": "confirm", "newly": n }       own messages, n people would newly see them
--   { "status": "moved", "ids": [...], "out_id", "in_id", "from", "to" }
--   { "status": "undone", "ids": [...], "from", "to" }
-- The local stack had a three-argument draft of the op; nothing else did.
DROP FUNCTION IF EXISTS public.chat_op_move_messages(uuid[], uuid, boolean);

CREATE OR REPLACE FUNCTION public.chat_op_move_messages(
  p_ids uuid[],
  p_target_channel_id uuid,
  p_confirm boolean DEFAULT false,
  p_undo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_source public.chat_channels;
  v_target public.chat_channels;
  v_sel uuid[];
  v_all uuid[];
  v_source_id uuid;
  v_others boolean;
  v_newly integer;
  v_convs integer;
  v_convs_ok integer;
  v_found bigint;
  v_recent integer;
  v_in public.chat_messages;
  v_out public.chat_messages;
  v_detached jsonb;
  v_roots uuid[];
  v_settled uuid[];
  v_reopened jsonb;
  v_pins jsonb;
  r record;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to move messages.' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_sel FROM unnest(coalesce(p_ids, '{}'::uuid[])) x WHERE x IS NOT NULL;
  IF v_sel IS NULL OR cardinality(v_sel) = 0 THEN
    RAISE EXCEPTION 'Pick at least one message.' USING ERRCODE = '22023';
  END IF;
  -- A person picks at most 100; an Undo names every id the move took
  -- (chains included), which the move itself capped at 500.
  IF cardinality(v_sel) > (CASE WHEN coalesce(p_undo, false) THEN 500 ELSE 100 END) THEN
    RAISE EXCEPTION 'Move at most % messages at a time.',
      (CASE WHEN coalesce(p_undo, false) THEN 500 ELSE 100 END) USING ERRCODE = '22023';
  END IF;

  -- Every picked message exists and sits in a conversation you can read; any
  -- id that doesn't gets the same answer as an id that never existed. Only
  -- then is "one conversation" checked.
  SELECT count(*) FILTER (WHERE public.chat_can_read_channel(c.channel_id)),
         sum(c.n) FILTER (WHERE public.chat_can_read_channel(c.channel_id)),
         count(*), min(c.channel_id::text)::uuid
    INTO v_convs_ok, v_found, v_convs, v_source_id
    FROM (SELECT m.channel_id, count(*) AS n FROM public.chat_messages m
           WHERE m.id = ANY (v_sel) GROUP BY m.channel_id) c;
  IF v_source_id IS NULL OR v_convs_ok <> v_convs OR v_found <> cardinality(v_sel) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF v_convs > 1 THEN
    RAISE EXCEPTION 'Pick messages from one conversation.' USING ERRCODE = '22023';
  END IF;
  v_source := public.chat_op__channel(v_source_id);
  -- The destination is in the same workspace (any other answers as missing).
  SELECT * INTO v_target FROM public.chat_channels WHERE id = p_target_channel_id;
  IF v_target.id IS NULL OR v_target.workspace_id <> v_source.workspace_id THEN
    RAISE EXCEPTION 'That conversation no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  v_target := public.chat_op__channel(p_target_channel_id);
  IF v_target.id = v_source.id THEN
    RAISE EXCEPTION 'They''re already in that conversation.' USING ERRCODE = '22023';
  END IF;
  IF v_source.archived_at IS NOT NULL OR v_target.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;

  -- One move at a time per person; at most five in 10 s (event lines aren't
  -- counted by the sending limit).
  PERFORM pg_advisory_xact_lock(hashtextextended('chat_move:' || v_me::text, 0));
  SELECT count(*) INTO v_recent
    FROM public.chat_messages e
   WHERE e.author_id = v_me AND e.workspace_id = v_source.workspace_id
     AND e.created_at > now() - interval '10 seconds'
     AND e.kind = 'event' AND e.event ->> 'type' = 'moved_out';

  -- The messages, their chains and the roots of picked replies, locked in id
  -- order (send and attach-to-chain lock the same rows), then read again.
  -- (One UNION of index lookups: an OR of them reads the whole table.)
  PERFORM 1 FROM public.chat_messages m
   WHERE m.id IN (
           SELECT unnest(v_sel)
           UNION SELECT c.id FROM public.chat_messages c WHERE c.parent_id = ANY (v_sel)
           UNION SELECT p.parent_id FROM public.chat_messages p WHERE p.id = ANY (v_sel)
           -- and the messages that quote them (a move drops those quotes)
           UNION SELECT q.id FROM public.chat_messages q WHERE q.reply_to_id = ANY (v_sel)
           UNION SELECT q.id FROM public.chat_messages q
                  WHERE q.reply_to_id = ANY (ARRAY(SELECT c.id FROM public.chat_messages c
                                                    WHERE c.parent_id = ANY (v_sel))))
   ORDER BY m.id FOR UPDATE;
  -- (A deleted reply rides along with its picked root: an Undo names it.)
  IF EXISTS (SELECT 1 FROM public.chat_messages m
              WHERE m.id = ANY (v_sel)
                AND (m.channel_id <> v_source.id OR m.kind <> 'message'
                     OR (m.deleted_at IS NOT NULL AND NOT coalesce(m.parent_id = ANY (v_sel), false)))) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  -- A picked root brings its whole chain.
  SELECT array_agg(DISTINCT m.id ORDER BY m.id) INTO v_all
    FROM public.chat_messages m
   WHERE m.channel_id = v_source.id
     AND (m.id = ANY (v_sel) OR m.parent_id = ANY (v_sel));
  IF cardinality(v_all) > 500 THEN
    RAISE EXCEPTION 'That''s too many messages to move at once.' USING ERRCODE = '22023';
  END IF;

  -- ── The Undo (p_undo): the same person, within 10 s, back where they came
  -- from. Asked for and not found, it moves nothing (never a fresh move). ──
  IF coalesce(p_undo, false) THEN
  SELECT * INTO v_in FROM public.chat_messages e
   WHERE e.channel_id = v_source.id AND e.kind = 'event' AND e.event ->> 'type' = 'moved_in'
     AND e.author_id = v_me AND e.deleted_at IS NULL
     AND e.created_at > v_now - interval '10 seconds'
     AND (e.event ->> 'from_id')::uuid = v_target.id
     AND ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(e.event -> 'ids') x ORDER BY 1) = v_all
   ORDER BY e.created_at DESC
   LIMIT 1;
  IF v_in.id IS NULL THEN
    RAISE EXCEPTION 'It''s too late to undo that move.' USING ERRCODE = '22023';
  END IF;
    SELECT * INTO v_out FROM public.chat_messages WHERE id = (v_in.event ->> 'out_id')::uuid;
    IF NOT public.chat__can_post(v_target, v_me) AND NOT public.chat__can_manage(v_target, v_me) THEN
      RAISE EXCEPTION 'You can''t post in that conversation.' USING ERRCODE = '42501';
    END IF;
    -- What the restore points at again (the chains and quotes they left),
    -- locked in id order.
    PERFORM 1 FROM public.chat_messages m
     WHERE m.id IN (SELECT (d ->> 'parent_id')::uuid FROM jsonb_array_elements(coalesce(v_out.event -> 'detached', '[]'::jsonb)) d
                    UNION
                    SELECT (d ->> 'reply_to_id')::uuid FROM jsonb_array_elements(coalesce(v_out.event -> 'detached', '[]'::jsonb)) d)
     ORDER BY m.id FOR UPDATE;
    -- A chain or quote a moved message took up where it went stays there: it
    -- leaves that chain (which counts again, and reopens if it settled it).
    SELECT array_agg(DISTINCT m.parent_id) FILTER (WHERE m.parent_id IS NOT NULL AND NOT m.parent_id = ANY (v_all))
      INTO v_roots
      FROM public.chat_messages m WHERE m.id = ANY (v_all);
    SELECT array_agg(p.id) INTO v_settled
      FROM public.chat_messages p
     WHERE p.id = ANY (coalesce(v_roots, '{}'::uuid[])) AND p.settled_id = ANY (v_all);
    UPDATE public.chat_messages m
       SET parent_id = CASE WHEN m.parent_id = ANY (v_all) THEN m.parent_id END,
           reply_to_id = CASE WHEN m.reply_to_id = ANY (v_all) THEN m.reply_to_id END
     WHERE m.id = ANY (v_all)
       AND ((m.parent_id IS NOT NULL AND NOT m.parent_id = ANY (v_all))
            OR (m.reply_to_id IS NOT NULL AND NOT m.reply_to_id = ANY (v_all)));
    UPDATE public.chat_messages m
       SET channel_id = v_target.id, moved_at = NULL, moved_by = NULL, moved_from_channel_id = NULL
     WHERE m.id = ANY (v_all);
    FOR r IN SELECT unnest(coalesce(v_roots, '{}'::uuid[])) AS id LOOP
      PERFORM public.chat__chain_refresh(r.id);
    END LOOP;
    FOR r IN SELECT p FROM public.chat_messages p WHERE p.id = ANY (coalesce(v_settled, '{}'::uuid[])) LOOP
      PERFORM public.chat__reopen_chain(r.p, v_me, v_now);
    END LOOP;
    -- Chains and quotes as they were.
    FOR r IN SELECT d ->> 'id' AS id, d ->> 'parent_id' AS parent_id, d ->> 'reply_to_id' AS reply_to_id
               FROM jsonb_array_elements(coalesce(v_out.event -> 'detached', '[]'::jsonb)) d LOOP
      UPDATE public.chat_messages m
         SET parent_id = CASE WHEN EXISTS (SELECT 1 FROM public.chat_messages p
                                            WHERE p.id = r.parent_id::uuid AND p.channel_id = v_target.id
                                              AND p.parent_id IS NULL)
                              THEN r.parent_id::uuid END,
             reply_to_id = CASE WHEN EXISTS (SELECT 1 FROM public.chat_messages p
                                              WHERE p.id = r.reply_to_id::uuid AND p.channel_id = v_target.id)
                                THEN r.reply_to_id::uuid END
       WHERE m.id = r.id::uuid AND m.channel_id = v_target.id;
      IF r.parent_id IS NOT NULL THEN
        PERFORM public.chat__chain_refresh(r.parent_id::uuid);
      END IF;
    END LOOP;
    -- Pins the move dropped, and chains it reopened (still as it left them).
    UPDATE public.chat_messages m
       SET pinned_at = (p ->> 'pinned_at')::timestamptz, pinned_by = (p ->> 'pinned_by')::uuid
      FROM jsonb_array_elements(coalesce(v_out.event -> 'pins', '[]'::jsonb)) p
     WHERE m.id = (p ->> 'id')::uuid AND m.channel_id = v_target.id AND m.pinned_at IS NULL;
    UPDATE public.chat_messages m
       SET wrapped_at = (w ->> 'wrapped_at')::timestamptz, wrapped_by = (w ->> 'wrapped_by')::uuid,
           settled_id = (w ->> 'settled_id')::uuid,
           reopened_at = (w ->> 'reopened_at')::timestamptz, reopened_by = (w ->> 'reopened_by')::uuid
      FROM jsonb_array_elements(coalesce(v_out.event -> 'reopened', '[]'::jsonb)) w
     WHERE m.id = (w ->> 'id')::uuid AND m.channel_id = v_target.id
       AND m.wrapped_at IS NULL AND m.reopened_by = v_me
       AND EXISTS (SELECT 1 FROM public.chat_messages s
                    WHERE s.id = (w ->> 'settled_id')::uuid AND s.parent_id = m.id);
    UPDATE public.chat_messages e
       SET deleted_at = v_now, deleted_by = v_me
     WHERE e.id IN (v_in.id, v_out.id) AND e.deleted_at IS NULL;
    PERFORM public.chat__move_scrub_notices(v_all, v_target.id);
    PERFORM public.chat__move_refile_items(v_all, v_target.id);
    PERFORM public.chat__move_relink(v_all, v_source.id, v_target.id);
    PERFORM public.module_activity_log(v_source.workspace_id, 'chat', 'chat_channel', v_target.id,
      'chat.move', jsonb_build_object('undo', true, 'count', cardinality(v_all),
                                      'from_id', v_source.id, 'to_id', v_target.id));
    RETURN jsonb_build_object('status', 'undone', 'ids', to_jsonb(v_all),
                              'from', v_source.id, 'to', v_target.id);
  END IF;
  -- A plain move back writes its own lines, like any move.

  -- ── Who and where ──
  IF NOT public.chat__can_post(v_target, v_me) THEN
    RAISE EXCEPTION 'You can''t post in that conversation.' USING ERRCODE = '42501';
  END IF;
  -- The move line in the source is written in your name too.
  IF v_source.managers_only AND NOT public.chat__is_manager(v_source, v_me) THEN
    RAISE EXCEPTION 'Only managers can move messages out of this channel.' USING ERRCODE = '42501';
  END IF;
  v_others := EXISTS (SELECT 1 FROM public.chat_messages m
                       WHERE m.id = ANY (v_all)
                         AND (m.author_id IS DISTINCT FROM v_me OR m.author_kind <> 'user'));
  IF v_others THEN
    IF NOT public.chat__can_manage(v_source, v_me) THEN
      RAISE EXCEPTION 'You can only move your own messages.' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (public.chat__can_post(v_source, v_me) OR public.chat__can_manage(v_source, v_me)) THEN
    RAISE EXCEPTION 'You can only move your own messages.' USING ERRCODE = '42501';
  END IF;

  -- ── The audience (CH55): only people who couldn't read the source count ──
  SELECT count(*) INTO v_newly
    FROM (SELECT public.chat__channel_readers(v_target.id)
          EXCEPT
          SELECT public.chat__channel_readers(v_source.id)) n;
  IF v_newly > 0 THEN
    IF v_others THEN
      RAISE EXCEPTION 'People who aren''t in this conversation would see someone else''s messages there.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT coalesce(p_confirm, false) THEN
      RETURN jsonb_build_object('status', 'confirm', 'newly', v_newly);
    END IF;
  END IF;

  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'You''re moving messages too quickly. Wait a moment and try again.'
      USING ERRCODE = 'PT429';
  END IF;

  -- ── What moves ──
  -- A reply moved without its root leaves its chain; a quote of a message
  -- that stays behind is dropped. Both are kept on the source's line for Undo.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'parent_id', m.parent_id,
                                               'reply_to_id', m.reply_to_id) ORDER BY m.id), '[]'::jsonb),
         array_agg(DISTINCT m.parent_id) FILTER (WHERE m.id = ANY (v_all) AND m.parent_id IS NOT NULL
                                                   AND NOT m.parent_id = ANY (v_all))
    INTO v_detached, v_roots
    FROM public.chat_messages m
   WHERE (m.id = ANY (v_all)
          AND ((m.parent_id IS NOT NULL AND NOT m.parent_id = ANY (v_all))
               OR (m.reply_to_id IS NOT NULL AND NOT m.reply_to_id = ANY (v_all))))
      -- Messages left behind that quote a moved one lose the quote too (a
      -- quote stays inside its conversation); Undo gives it back.
      OR (m.channel_id = v_source.id AND NOT m.id = ANY (v_all) AND m.reply_to_id = ANY (v_all));
  UPDATE public.chat_messages m SET reply_to_id = NULL
   WHERE m.channel_id = v_source.id AND NOT m.id = ANY (v_all) AND m.reply_to_id = ANY (v_all);
  -- Chains a settling reply leaves are open again (kept for Undo).
  SELECT array_agg(p.id),
         coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'wrapped_at', p.wrapped_at,
                  'wrapped_by', p.wrapped_by, 'settled_id', p.settled_id,
                  'reopened_at', p.reopened_at, 'reopened_by', p.reopened_by)), '[]'::jsonb)
    INTO v_settled, v_reopened
    FROM public.chat_messages p
   WHERE p.id = ANY (coalesce(v_roots, '{}'::uuid[])) AND p.settled_id = ANY (v_all);
  -- Pins are dropped (kept for Undo).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'pinned_at', m.pinned_at,
                                               'pinned_by', m.pinned_by)), '[]'::jsonb)
    INTO v_pins
    FROM public.chat_messages m WHERE m.id = ANY (v_all) AND m.pinned_at IS NOT NULL;

  UPDATE public.chat_messages m
     SET channel_id = v_target.id,
         parent_id = CASE WHEN m.parent_id = ANY (v_all) THEN m.parent_id END,
         reply_to_id = CASE WHEN m.reply_to_id = ANY (v_all) THEN m.reply_to_id END,
         pinned_at = NULL, pinned_by = NULL,
         moved_at = v_now, moved_by = v_me, moved_from_channel_id = v_source.id
   WHERE m.id = ANY (v_all);
  FOR r IN SELECT unnest(coalesce(v_roots, '{}'::uuid[])) AS id LOOP
    PERFORM public.chat__chain_refresh(r.id);
  END LOOP;
  FOR r IN SELECT p FROM public.chat_messages p WHERE p.id = ANY (coalesce(v_settled, '{}'::uuid[])) LOOP
    PERFORM public.chat__reopen_chain(r.p, v_me, v_now);
  END LOOP;

  -- ── The two lines (quiet: an insert by an op pings nobody) ──
  INSERT INTO public.chat_messages
    (workspace_id, channel_id, author_id, author_kind, body, kind, event)
  VALUES
    (v_source.workspace_id, v_source.id, v_me, 'user', '', 'event',
     jsonb_build_object('type', 'moved_out', 'ids', to_jsonb(v_all), 'count', cardinality(v_all),
                        'to_id', v_target.id, 'to', 'moduo://chat_channel/' || v_target.id,
                        'detached', v_detached, 'pins', v_pins, 'reopened', v_reopened))
  RETURNING * INTO v_out;
  INSERT INTO public.chat_messages
    (workspace_id, channel_id, author_id, author_kind, body, kind, event)
  VALUES
    (v_target.workspace_id, v_target.id, v_me, 'user', '', 'event',
     jsonb_build_object('type', 'moved_in', 'ids', to_jsonb(v_all), 'count', cardinality(v_all),
                        'from_id', v_source.id, 'from', 'moduo://chat_channel/' || v_source.id,
                        'out_id', v_out.id))
  RETURNING * INTO v_in;

  PERFORM public.chat__move_scrub_notices(v_all, v_target.id);
  PERFORM public.chat__move_refile_items(v_all, v_target.id);
  PERFORM public.chat__move_relink(v_all, v_source.id, v_target.id);
  PERFORM public.module_activity_log(v_source.workspace_id, 'chat', 'chat_channel', v_source.id,
    'chat.move', jsonb_build_object('count', cardinality(v_all), 'from_id', v_source.id,
                                    'to_id', v_target.id, 'newly', v_newly));
  RETURN jsonb_build_object('status', 'moved', 'ids', to_jsonb(v_all), 'out_id', v_out.id,
                            'in_id', v_in.id, 'from', v_source.id, 'to', v_target.id);
END;
$function$;

-- ── 4. Send, attach-to-chain and the access check, from their live bodies ──
-- chat_op_send (live: 20261017115000_chat_v2_files) and
-- chat_op_attach_to_chain (live: 20261017109000_chat_v2_chains): once the
-- rows are locked (the quoted message too, so a move of it waits or is
-- waited on), the quoted message, the message and the chain's root must
-- still be in this conversation.
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
  v_files integer;
  v_root_id uuid;
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
  -- CV-9: the sender's finished files uploaded under this id go with it
  -- (locked, so the composer's remove can't race the send).
  SELECT count(*) INTO v_files FROM (
    SELECT 1 FROM public.attachments a
     WHERE a.entity_type = 'chat_message' AND a.entity_id = p_id AND a.uploader_id = v_me
       AND a.workspace_id = v_channel.workspace_id AND a.status = 'ready' AND a.deleted_at IS NULL
     FOR UPDATE) f;
  IF v_files > public.attachments__chat_file_cap() THEN
    RAISE EXCEPTION 'A message holds up to % files.', public.attachments__chat_file_cap()
      USING ERRCODE = '22023';
  END IF;
  -- A message with files may have no words.
  IF v_files = 0 OR btrim(v_body, E' \n\t') <> '' THEN
    PERFORM public.chat__check_body(v_body);
  END IF;

  -- A reply posts in the conversation and joins the chain of what it answers.
  IF p_reply_to_id IS NOT NULL THEN
    SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
    IF v_quoted.id IS NULL OR v_quoted.channel_id <> p_channel_id OR v_quoted.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    IF v_quoted.kind <> 'message' THEN
      RAISE EXCEPTION 'Only a message can be replied to.' USING ERRCODE = '22023';
    END IF;
    -- The quoted message and its chain's root, locked in id order (as a move
    -- locks them), then read again: a move or a delete that got there first
    -- leaves nothing to answer here.
    v_root_id := coalesce(v_quoted.parent_id, v_quoted.id);
    PERFORM 1 FROM public.chat_messages
     WHERE id IN (v_quoted.id, v_root_id)
     ORDER BY id FOR UPDATE;
    SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
    SELECT * INTO v_root FROM public.chat_messages WHERE id = coalesce(v_quoted.parent_id, v_quoted.id);
    IF v_quoted.channel_id <> p_channel_id OR v_quoted.deleted_at IS NOT NULL
       OR v_root.id IS NULL OR v_root.channel_id <> p_channel_id THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    -- It joined another chain before the lock: that root isn't locked.
    IF v_root.id <> v_root_id OR v_root.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'That conversation just changed. Try again.' USING ERRCODE = '40001';
    END IF;
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
     mentioned_user_ids, mentioned_team_ids, mentions_everyone, file_count)
  VALUES
    (p_id, p_id, v_channel.workspace_id, p_channel_id, v_root.id, v_quoted.id, v_me, v_body, 2,
     v_people, v_teams, v_everyone, v_files)
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

  -- CV-10: the items it refers to show "Mentioned in" this conversation.
  PERFORM public.chat__link_mentions(v_msg, v_me);
  -- CV-5: Catch up items and the bell for everyone it's addressed to, and
  -- the sender's own items up to here are read.
  PERFORM public.chat__fan_out(v_msg, v_channel, v_me);
  PERFORM public.chat__close_read(v_me, p_channel_id, v_msg);
  RETURN v_msg;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_attach_to_chain(p_message_id uuid, p_reply_to_id uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   WHERE id IN (v_quoted.id, coalesce(v_quoted.parent_id, v_quoted.id), v_msg.id, coalesce(v_msg.parent_id, v_msg.id))
   ORDER BY id FOR UPDATE;
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
  SELECT * INTO v_root FROM public.chat_messages WHERE id = coalesce(v_quoted.parent_id, v_quoted.id);
  IF v_msg.deleted_at IS NOT NULL OR v_quoted.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  -- A move that got there first: all three still in this conversation.
  IF v_msg.channel_id <> v_channel.id THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF v_quoted.channel_id <> v_channel.id OR v_root.id IS NULL OR v_root.channel_id <> v_channel.id THEN
    RAISE EXCEPTION 'Pick a message in this conversation.' USING ERRCODE = '22023';
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
  PERFORM public.chat__chain_refresh(v_root.id);
  IF v_old IS DISTINCT FROM v_root.id THEN
    IF v_old IS NOT NULL THEN
      PERFORM public.chat__chain_refresh(v_old);
      -- The reply that settled the chain it leaves: that chain is open again.
      SELECT * INTO v_quoted FROM public.chat_messages WHERE id = v_old;
      IF v_quoted.settled_id = v_msg.id THEN
        PERFORM public.chat__reopen_chain(v_quoted, v_me, clock_timestamp());
      END IF;
    END IF;
    -- Joining a wrapped chain reopens it, as a new reply does (CH54); a new
    -- quote inside the same chain doesn't.
    SELECT * INTO v_root FROM public.chat_messages WHERE id = v_root.id;
    PERFORM public.chat__reopen_chain(v_root, v_me, clock_timestamp());
  END IF;
  RETURN v_msg;
END;
$function$;

-- chat_sync_ids (live: 20261017104000_chat_v2_conversation_ops): moved_away
-- also comes from moved_in lines, live or undone. An Undo soft-deletes the
-- moved_in line (its updated_at moves, so p_since finds it) and the ids go
-- back where you may not read them; a live moved_in or an undone moved_out
-- names ids that sit where you can read them, so the last filter drops them.
CREATE OR REPLACE FUNCTION public.chat_sync_ids(p_workspace_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(kind text, id uuid, conversation_id uuid, checked_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH t AS (
    SELECT clock_timestamp() AS at, auth.uid() AS me
  ), readable AS (
    SELECT r.id FROM t, public.chat__readable_channel_ids(p_workspace_id, t.me) AS r(id)
  ), moved AS (
    SELECT DISTINCT x.mid, e.channel_id AS source
      FROM public.chat_messages e
      JOIN readable r ON r.id = e.channel_id
     CROSS JOIN LATERAL (
       SELECT v::uuid AS mid FROM jsonb_array_elements_text(coalesce(e.event -> 'ids', '[]'::jsonb)) v
     ) x
      LEFT JOIN public.chat_messages m ON m.id = x.mid
     WHERE e.workspace_id = p_workspace_id
       AND e.kind = 'event'
       AND e.event ->> 'type' IN ('moved_out', 'moved_in')
       AND e.updated_at >= coalesce(p_since, '-infinity'::timestamptz)
       AND (m.id IS NULL OR NOT EXISTS (SELECT 1 FROM readable r2 WHERE r2.id = m.channel_id))
  )
  SELECT 'conversation'::text, r.id, r.id, t.at FROM readable r, t
  UNION ALL
  SELECT 'member'::text, m.channel_id, m.channel_id, t.at
    FROM public.chat_members m
    JOIN readable r ON r.id = m.channel_id, t
   WHERE m.user_id = t.me AND m.left_at IS NULL
  UNION ALL
  SELECT 'moved_away'::text, mv.mid, mv.source, t.at FROM moved mv, t
  UNION ALL
  SELECT 'checked'::text, NULL::uuid, NULL::uuid, t.at FROM t
$function$;

-- ── 5. Grants ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'chat__channel_readers(uuid)',
    'chat__move_refile_items(uuid[], uuid)',
    'chat__move_scrub_notices(uuid[], uuid)',
    'chat__move_relink(uuid[], uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  REVOKE ALL ON FUNCTION public.chat_op_move_messages(uuid[], uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat_op_move_messages(uuid[], uuid, boolean, boolean) TO authenticated, service_role;
END;
$$;
