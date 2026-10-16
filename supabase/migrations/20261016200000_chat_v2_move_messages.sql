-- CV-16: Move to… (spec §5 "Tidy up afterwards", round-3 §2.19, Assumption
-- #24, CH55). Fixed stamp in chat's order (after CV-10-fix, CV-11, CV-17,
-- CV-9 and CV-13). Adds; redefines nothing that exists.
--
--   1. Columns on chat_messages: moved_at, moved_by, moved_from_channel_id
--      (the last move: when, who, from where).
--   2. Helpers (server only): chat__channel_readers (who can read a
--      conversation right now, the same rule as chat_can_read_channel) and
--      chat__move_refile_items (Catch up items follow their messages for the
--      people who can read where they went; the rest close as 'closed').
--   3. chat_op_move_messages(ids, target, confirm): the person comes from the
--      session; read on the source, post rights in the target. Your own
--      messages go anywhere: when people who can read the target couldn't
--      read the source, the op first answers with how many and moves only
--      when called again with confirm. Someone else's messages move only by
--      the source's managers and admins, and only to a conversation whose
--      readers could all read the source already. A root brings its whole
--      chain; a reply moved alone leaves its chain; pins are dropped;
--      reactions and files stay on the message. One quiet event line in each
--      conversation (moved_out in the source with the ids, moved_in in the
--      target naming the source as a moduo:// reference). Nothing pings.
--      Called again by the same person within 10 s with the moved ids and the
--      source as the target, it is the Undo: the messages go back where they
--      were (chains and quotes restored) and both lines are soft-deleted.
--      At most five moves per person in 10 s (PT429, the sending limit's code).
--   4. Grants, by name.
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
CREATE OR REPLACE FUNCTION public.chat_op_move_messages(
  p_ids uuid[],
  p_target_channel_id uuid,
  p_confirm boolean DEFAULT false)
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
  v_recent integer;
  v_in public.chat_messages;
  v_out public.chat_messages;
  v_detached jsonb;
  v_roots uuid[];
  v_settled uuid[];
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
  IF cardinality(v_sel) > 100 THEN
    RAISE EXCEPTION 'Move at most 100 messages at a time.' USING ERRCODE = '22023';
  END IF;

  -- Every picked message, readable, in one conversation.
  SELECT min(m.channel_id::text)::uuid, count(DISTINCT m.channel_id)
    INTO v_source_id, v_convs
    FROM public.chat_messages m WHERE m.id = ANY (v_sel);
  IF v_source_id IS NULL OR NOT public.chat_can_read_channel(v_source_id)
     OR (SELECT count(*) FROM public.chat_messages m WHERE m.id = ANY (v_sel)) <> cardinality(v_sel) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF v_convs > 1 THEN
    RAISE EXCEPTION 'Pick messages from one conversation.' USING ERRCODE = '22023';
  END IF;
  v_source := public.chat_op__channel(v_source_id);
  v_target := public.chat_op__channel(p_target_channel_id);
  IF v_target.workspace_id <> v_source.workspace_id THEN
    RAISE EXCEPTION 'That conversation no longer exists.' USING ERRCODE = 'P0002';
  END IF;
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

  -- The messages and their chains, locked in id order, then read again.
  PERFORM 1 FROM public.chat_messages m
   WHERE m.id = ANY (v_sel) OR m.parent_id = ANY (v_sel)
   ORDER BY m.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.chat_messages m
              WHERE m.id = ANY (v_sel)
                AND (m.channel_id <> v_source.id OR m.kind <> 'message' OR m.deleted_at IS NOT NULL)) THEN
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

  -- ── The Undo: the same person, within 10 s, back where they came from ──
  SELECT * INTO v_in FROM public.chat_messages e
   WHERE e.channel_id = v_source.id AND e.kind = 'event' AND e.event ->> 'type' = 'moved_in'
     AND e.author_id = v_me AND e.deleted_at IS NULL
     AND e.created_at > v_now - interval '10 seconds'
     AND (e.event ->> 'from_id')::uuid = v_target.id
     AND ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(e.event -> 'ids') x ORDER BY 1) = v_all
   ORDER BY e.created_at DESC
   LIMIT 1;
  IF v_in.id IS NOT NULL THEN
    SELECT * INTO v_out FROM public.chat_messages WHERE id = (v_in.event ->> 'out_id')::uuid;
    IF NOT public.chat__can_post(v_target, v_me) AND NOT public.chat__can_manage(v_target, v_me) THEN
      RAISE EXCEPTION 'You can''t post in that conversation.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.chat_messages m
       SET channel_id = v_target.id, moved_at = NULL, moved_by = NULL, moved_from_channel_id = NULL
     WHERE m.id = ANY (v_all);
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
       WHERE m.id = r.id::uuid;
      IF r.parent_id IS NOT NULL THEN
        PERFORM public.chat__chain_refresh(r.parent_id::uuid);
      END IF;
    END LOOP;
    UPDATE public.chat_messages e
       SET deleted_at = v_now, deleted_by = v_me
     WHERE e.id IN (v_in.id, v_out.id) AND e.deleted_at IS NULL;
    PERFORM public.chat__move_refile_items(v_all, v_target.id);
    PERFORM public.chat__move_relink(v_all, v_source.id, v_target.id);
    PERFORM public.module_activity_log(v_source.workspace_id, 'chat', 'chat_channel', v_target.id,
      'chat.move', jsonb_build_object('undo', true, 'count', cardinality(v_all),
                                      'from_id', v_source.id, 'to_id', v_target.id));
    RETURN jsonb_build_object('status', 'undone', 'ids', to_jsonb(v_all),
                              'from', v_source.id, 'to', v_target.id);
  END IF;

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
         array_agg(DISTINCT m.parent_id) FILTER (WHERE m.parent_id IS NOT NULL AND NOT m.parent_id = ANY (v_all))
    INTO v_detached, v_roots
    FROM public.chat_messages m
   WHERE m.id = ANY (v_all)
     AND ((m.parent_id IS NOT NULL AND NOT m.parent_id = ANY (v_all))
          OR (m.reply_to_id IS NOT NULL AND NOT m.reply_to_id = ANY (v_all)));
  -- Chains a settling reply leaves are open again.
  SELECT array_agg(p.id) INTO v_settled
    FROM public.chat_messages p
   WHERE p.id = ANY (coalesce(v_roots, '{}'::uuid[])) AND p.settled_id = ANY (v_all);

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
                        'detached', v_detached))
  RETURNING * INTO v_out;
  INSERT INTO public.chat_messages
    (workspace_id, channel_id, author_id, author_kind, body, kind, event)
  VALUES
    (v_target.workspace_id, v_target.id, v_me, 'user', '', 'event',
     jsonb_build_object('type', 'moved_in', 'ids', to_jsonb(v_all), 'count', cardinality(v_all),
                        'from_id', v_source.id, 'from', 'moduo://chat_channel/' || v_source.id,
                        'out_id', v_out.id))
  RETURNING * INTO v_in;

  PERFORM public.chat__move_refile_items(v_all, v_target.id);
  PERFORM public.chat__move_relink(v_all, v_source.id, v_target.id);
  PERFORM public.module_activity_log(v_source.workspace_id, 'chat', 'chat_channel', v_source.id,
    'chat.move', jsonb_build_object('count', cardinality(v_all), 'from_id', v_source.id,
                                    'to_id', v_target.id, 'newly', v_newly));
  RETURN jsonb_build_object('status', 'moved', 'ids', to_jsonb(v_all), 'out_id', v_out.id,
                            'in_id', v_in.id, 'from', v_source.id, 'to', v_target.id);
END;
$function$;

-- ── 4. Grants ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'chat__channel_readers(uuid)',
    'chat__move_refile_items(uuid[], uuid)',
    'chat__move_relink(uuid[], uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  REVOKE ALL ON FUNCTION public.chat_op_move_messages(uuid[], uuid, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat_op_move_messages(uuid[], uuid, boolean) TO authenticated, service_role;
END;
$$;
