-- Chat v2 · CV-9 Files (specs/chat-v2.md §7; round-3 §2.25 g; §Assumptions
-- #26, #35). Paste, drop or attach files to a message through the app's
-- attachments pipeline (AT-1/AT-2/AT-3). The stamp is fixed by the build's
-- queue (after CV-15, CV-11 and CV-17); every redefined function starts from
-- its live body, and it runs again cleanly over itself.
--
-- What it does:
--   1. Upload first, send after. attachments_op_begin takes
--      entity_type = 'chat_message' with the conversation (new p_channel_id)
--      and the message id the app minted. Only someone who may post in that
--      conversation uploads (the plan is checked through Chat's own rule);
--      up to 10 files per message, the eleventh refused before any bytes
--      move; the per-file limit and the storage budget are the owner's, as
--      for a task. A message that already exists takes no new files.
--   2. chat_op_send (live body) takes the sender's finished files uploaded
--      under its id: chat_messages.file_count says how many. A message with
--      files may have no words. A file that finishes after its message was
--      sent doesn't join it (finalize fails it, the purge removes it).
--   3. Access follows the conversation: a branch in the attachments row and
--      storage policies (never in can_access: a conversation is not a shared
--      item). A file of a sent message is read by whoever can read its
--      conversation, while the message isn't deleted; the uploader alone
--      sees their own unfinished upload. A removed member, a deleted
--      conversation or a deleted message reaches none of them at once.
--   4. Deleting a message sends its files to the trash with it
--      (deleted_reason 'chat_message'); its Undo (chat_op_restore, 10 s)
--      brings them back; after that window the purge removes the bytes.
--      Files whose message never came (or was purged with its conversation)
--      are removed a day after they were uploaded.
--   5. attachments_op_delete lets the uploader take a finished file back out
--      of a message they haven't sent yet (the composer's remove).
--   6. chat_files(conversation, before, limit, before_id): the Files view.
--
-- Unchanged on purpose: attachments_largest lists task files only (Settings →
-- Storage), attachments_op_restore restores task files only (a chat file comes
-- back with its message), storage__unsettled_bytes and attachments_op_abandon
-- already cover any upload.

SET LOCAL lock_timeout = '5s';

-- ── 1. The trash reason ───────────────────────────────────────────────────

ALTER TABLE public.attachments DROP CONSTRAINT IF EXISTS attachments_deleted_reason_check;
ALTER TABLE public.attachments ADD CONSTRAINT attachments_deleted_reason_check
  CHECK (deleted_reason IN ('user','task','bucket','chat_message'));

-- ── 2. How many files a message holds ─────────────────────────────────────

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS file_count smallint NOT NULL DEFAULT 0;
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_file_count_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_file_count_check
  CHECK (file_count BETWEEN 0 AND 10);

-- The most files one message holds (mirrors CHAT_FILES_PER_MESSAGE).
CREATE OR REPLACE FUNCTION public.attachments__chat_file_cap()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT 10 $$;
REVOKE ALL ON FUNCTION public.attachments__chat_file_cap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attachments__chat_file_cap() TO service_role;

-- ── 3. Access follows the conversation ────────────────────────────────────
-- The EXISTS reads chat_messages as the caller, so its own policy (who reads
-- the conversation) applies as well as the explicit check.

DROP POLICY IF EXISTS attachments_select ON public.attachments;
CREATE POLICY attachments_select ON public.attachments
  FOR SELECT TO authenticated
  USING (
    public.can_access(entity_type, entity_id, 'view')
    OR (entity_type = 'chat_message'
        AND ((status <> 'ready' AND uploader_id = (SELECT auth.uid()))
             OR (status = 'ready' AND deleted_at IS NULL AND EXISTS (
                   SELECT 1 FROM public.chat_messages m
                    WHERE m.id = attachments.entity_id
                      AND m.workspace_id = attachments.workspace_id
                      AND m.author_id IS NOT DISTINCT FROM attachments.uploader_id
                      AND m.deleted_at IS NULL
                      AND public.chat_can_read_channel(m.channel_id)))))
  );

DROP POLICY IF EXISTS attachments_object_select ON storage.objects;
CREATE POLICY attachments_object_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments' AND EXISTS (
      SELECT 1 FROM public.attachments a
       WHERE (a.object_path = objects.name OR a.preview_path = objects.name)
         AND ((a.status = 'ready' AND a.deleted_at IS NULL
               AND (public.can_access(a.entity_type, a.entity_id, 'view')
                    OR (a.entity_type = 'chat_message' AND EXISTS (
                          SELECT 1 FROM public.chat_messages m
                           WHERE m.id = a.entity_id
                             AND m.workspace_id = a.workspace_id
                             AND m.author_id IS NOT DISTINCT FROM a.uploader_id
                             AND m.deleted_at IS NULL
                             AND public.chat_can_read_channel(m.channel_id)))))
              OR (a.status = 'pending' AND a.uploader_id = (SELECT auth.uid()))))
  );

-- ── 4. Begin: chat_message under a conversation ───────────────────────────

DROP FUNCTION IF EXISTS public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer);

CREATE OR REPLACE FUNCTION public.attachments_op_begin(
  p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_file_name text, p_mime text,
  p_size_bytes bigint, p_preview_mime text DEFAULT NULL::text, p_width integer DEFAULT NULL::integer,
  p_height integer DEFAULT NULL::integer, p_channel_id uuid DEFAULT NULL::uuid)
 RETURNS attachments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_lim     record;
  v_used    bigint;
  v_pending bigint;
  v_id      uuid := gen_random_uuid();
  v_name    text;
  v_mime    text;
  v_ext     text;
  v_row     public.attachments;
  v_channel public.chat_channels;
BEGIN
  -- Uploads need a signed-in person: Storage checks the same uploader.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_entity_type = 'task' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tasks t
                   WHERE t.id = p_entity_id AND t.workspace_id = p_workspace_id
                     AND t.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.can_access('task', p_entity_id, 'edit', v_uid) THEN
      IF public.can_access('task', p_entity_id, 'view', v_uid) THEN
        RAISE EXCEPTION 'no_edit_access' USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_entity_type = 'chat_message' THEN
    -- CV-9: the app minted the message id; the conversation says who may post.
    SELECT * INTO v_channel FROM public.chat_channels c
     WHERE c.id = p_channel_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL;
    IF v_channel.id IS NULL OR p_entity_id IS NULL
       OR NOT public.chat_can_read_channel(p_channel_id) THEN
      RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
    END IF;
    -- A sent message takes no new files.
    IF EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = p_entity_id) THEN
      RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
    END IF;
    -- Reading never needs the plan; uploading does, like posting.
    IF NOT public.chat_workspace_enabled(p_workspace_id)
       OR v_channel.archived_at IS NOT NULL
       OR NOT public.chat__can_post(v_channel, v_uid) THEN
      RAISE EXCEPTION 'no_edit_access' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_entity' USING ERRCODE = '22023';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'invalid_size' USING ERRCODE = '22023';
  END IF;
  IF p_preview_mime IS NOT NULL AND p_preview_mime NOT IN ('image/webp','image/png','image/jpeg') THEN
    RAISE EXCEPTION 'invalid_preview_mime' USING ERRCODE = '22023';
  END IF;
  IF (p_width IS NOT NULL AND p_width <= 0) OR (p_height IS NOT NULL AND p_height <= 0) THEN
    RAISE EXCEPTION 'invalid_dimensions' USING ERRCODE = '22023';
  END IF;

  SELECT w.owner_id INTO v_owner
  FROM public.workspaces w WHERE w.id = p_workspace_id AND w.deleted_at IS NULL;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'entity_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- One begin at a time per pool: the checks below then see every upload
  -- begun before this one, so racing uploads can't all slip under the limit.
  INSERT INTO public.storage_usage (owner_id) VALUES (v_owner) ON CONFLICT (owner_id) DO NOTHING;
  PERFORM 1 FROM public.storage_usage su WHERE su.owner_id = v_owner FOR UPDATE;
  -- One person can't pile up unfinished uploads (pending or failed, until the
  -- purge removes them).
  IF (SELECT count(*) FROM public.attachments a
      WHERE a.uploader_id = v_uid AND a.status <> 'ready') >= 50 THEN
    RAISE EXCEPTION 'too_many_pending' USING ERRCODE = 'P0001';
  END IF;
  -- CV-9: up to 10 files per message, the eleventh refused before upload (the
  -- pool lock above orders racing begins for one message).
  IF p_entity_type = 'chat_message'
     AND (SELECT count(*) FROM public.attachments a
           WHERE a.entity_type = 'chat_message' AND a.entity_id = p_entity_id
             AND a.status <> 'failed' AND a.deleted_at IS NULL)
         >= public.attachments__chat_file_cap() THEN
    RAISE EXCEPTION 'too_many_files' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('max_files', public.attachments__chat_file_cap())::text;
  END IF;
  SELECT * INTO v_lim FROM public.storage__limits_for_owner(v_owner);
  IF p_size_bytes > v_lim.per_file_bytes THEN
    RAISE EXCEPTION 'attachment_too_large' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('size_bytes', p_size_bytes,
                                  'per_file_bytes', v_lim.per_file_bytes,
                                  'tier', v_lim.tier)::text;
  END IF;
  SELECT greatest(su.bytes_used, 0) INTO v_used
  FROM public.storage_usage su WHERE su.owner_id = v_owner;
  v_used := coalesce(v_used, 0);
  v_pending := public.storage__unsettled_bytes(v_owner);
  IF v_used + v_pending + p_size_bytes > v_lim.total_bytes THEN
    RAISE EXCEPTION 'storage_full' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('size_bytes', p_size_bytes,
                                  'used_bytes', v_used,
                                  'pending_bytes', v_pending,
                                  'total_bytes', v_lim.total_bytes,
                                  'tier', v_lim.tier)::text;
  END IF;

  -- The name is only shown, never part of a path.
  v_name := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[[:cntrl:]]', '', 'g')), 255);
  IF v_name = '' THEN
    v_name := 'file';
  END IF;
  v_mime := left(btrim(lower(coalesce(p_mime, ''))), 255);
  IF v_mime = '' THEN
    v_mime := 'application/octet-stream';
  END IF;
  v_ext := lower(substring(v_name FROM '\.([A-Za-z0-9]{1,10})$'));
  IF v_ext IS NULL THEN
    v_ext := 'bin';
  END IF;

  INSERT INTO public.attachments (
    id, workspace_id, entity_type, entity_id, uploader_id, file_name, mime,
    size_bytes, object_path, preview_path, preview_mime, width, height, status)
  VALUES (
    v_id, p_workspace_id, p_entity_type, p_entity_id, v_uid, v_name, v_mime, p_size_bytes,
    p_workspace_id::text || '/' || v_id::text || '/original.' || v_ext,
    CASE WHEN p_preview_mime IS NULL THEN NULL
         ELSE p_workspace_id::text || '/' || v_id::text || '/preview.'
              || CASE p_preview_mime WHEN 'image/webp' THEN 'webp' WHEN 'image/png' THEN 'png' ELSE 'jpg' END
    END,
    p_preview_mime, p_width, p_height, 'pending')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer, uuid) TO authenticated, service_role;

-- ── 5. Finalize: a file that finishes after its message was sent ───────────

CREATE OR REPLACE FUNCTION public.attachments_op_finalize(p_id uuid)
 RETURNS attachments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row     public.attachments;
  v_size    bigint;
  v_psize   bigint;
  v_owner   uuid;
  v_lim     record;
  v_failed  boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.attachments a WHERE a.id = p_id FOR UPDATE;
  IF NOT FOUND OR v_row.uploader_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Already settled: a retried finalize gets the same answer.
  IF v_row.status <> 'pending' THEN
    RETURN v_row;
  END IF;

  SELECT (o.metadata ->> 'size')::bigint INTO v_size
  FROM storage.objects o
  WHERE o.bucket_id = 'attachments' AND o.name = v_row.object_path;
  IF v_size IS NULL THEN
    -- Not uploaded (yet): stays pending, the app retries.
    RAISE EXCEPTION 'not_uploaded' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.preview_path IS NOT NULL THEN
    SELECT (o.metadata ->> 'size')::bigint INTO v_psize
    FROM storage.objects o
    WHERE o.bucket_id = 'attachments' AND o.name = v_row.preview_path;
  END IF;

  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = v_row.workspace_id;
  SELECT * INTO v_lim FROM public.storage__limits_for_owner(v_owner);
  IF v_size <> v_row.size_bytes
     OR v_size > v_lim.per_file_bytes
     OR coalesce(v_psize, 0) > public.attachments__preview_cap() THEN
    v_failed := true;
  END IF;
  -- CV-9: its message went without it: it never joins it afterwards.
  IF v_row.entity_type = 'chat_message'
     AND EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = v_row.entity_id) THEN
    v_failed := true;
  END IF;

  IF v_failed THEN
    -- The purge removes the objects; the row says why the tile failed.
    UPDATE public.attachments SET status = 'failed', updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  UPDATE public.attachments
  SET status = 'ready',
      preview_bytes = coalesce(v_psize, 0),
      -- No preview was uploaded: the tile shows the file type instead.
      preview_path = CASE WHEN v_psize IS NULL THEN NULL ELSE preview_path END,
      preview_mime = CASE WHEN v_psize IS NULL THEN NULL ELSE preview_mime END,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  PERFORM public.attachments__alert(v_row.workspace_id, v_owner);
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.attachments_op_finalize(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attachments_op_finalize(uuid) TO authenticated, service_role;

-- ── 6. Delete: the composer's remove, before the message is sent ───────────

CREATE OR REPLACE FUNCTION public.attachments_op_delete(p_id uuid)
 RETURNS attachments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.attachments;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.attachments a WHERE a.id = p_id FOR UPDATE;
  -- CV-9: a chat file leaves only with its message once sent; before that,
  -- only its uploader takes it back out (the purge removes it).
  IF FOUND AND v_row.entity_type = 'chat_message' THEN
    IF v_row.uploader_id IS DISTINCT FROM auth.uid()
       OR EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = v_row.entity_id) THEN
      RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_row.deleted_at IS NOT NULL THEN
      RETURN v_row;
    END IF;
    UPDATE public.attachments
    SET deleted_at = now(), deleted_reason = 'chat_message', deleted_batch_id = gen_random_uuid(),
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  IF NOT FOUND OR NOT public.can_access(v_row.entity_type, v_row.entity_id, 'view') THEN
    RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access(v_row.entity_type, v_row.entity_id, 'edit') THEN
    RAISE EXCEPTION 'no_edit_access' USING ERRCODE = '42501';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN v_row;
  END IF;
  UPDATE public.attachments
  SET deleted_at = now(), deleted_reason = 'user', deleted_batch_id = gen_random_uuid(),
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.attachments_op_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attachments_op_delete(uuid) TO authenticated, service_role;

-- ── 7. The purge: a deleted message's files, and files whose message never came

CREATE OR REPLACE FUNCTION public.attachments__purge_candidates(p_limit integer DEFAULT 500)
 RETURNS TABLE(id uuid, object_path text, preview_path text, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.id, a.object_path, a.preview_path,
         CASE
           WHEN w.deleted_at IS NOT NULL THEN 'workspace_deleted'
           WHEN a.status = 'failed' THEN 'failed'
           WHEN a.status = 'pending' AND a.created_at < now() - interval '24 hours' THEN 'abandoned'
           WHEN a.deleted_at < now() - interval '30 days' THEN 'expired'
           -- CV-9: past its message's Undo, a deleted message's file goes.
           WHEN a.deleted_reason = 'chat_message' AND a.deleted_at < now() - interval '10 seconds' THEN 'expired'
           ELSE 'orphaned'
         END
  FROM public.attachments a
  JOIN public.workspaces w ON w.id = a.workspace_id
  WHERE w.deleted_at IS NOT NULL
     OR a.status = 'failed'
     OR (a.status = 'pending' AND a.created_at < now() - interval '24 hours')
     OR a.deleted_at < now() - interval '30 days'
     OR (a.entity_type = 'task' AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = a.entity_id))
     OR (a.deleted_reason = 'chat_message' AND a.deleted_at < now() - interval '10 seconds')
     OR (a.entity_type = 'chat_message' AND a.created_at < now() - interval '24 hours'
         AND NOT EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = a.entity_id))
  ORDER BY a.created_at, a.id
  LIMIT greatest(coalesce(p_limit, 500), 1)
$function$;

REVOKE ALL ON FUNCTION public.attachments__purge_candidates(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attachments__purge_candidates(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.attachments__purge_rows(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.attachments a
    USING public.workspaces w
    WHERE w.id = a.workspace_id
      AND a.id = ANY (coalesce(p_ids, '{}'::uuid[]))
      AND (w.deleted_at IS NOT NULL
        OR a.status = 'failed'
        OR (a.status = 'pending' AND a.created_at < now() - interval '24 hours')
        OR a.deleted_at < now() - interval '30 days'
        OR (a.entity_type = 'task' AND NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = a.entity_id))
        OR (a.deleted_reason = 'chat_message' AND a.deleted_at < now() - interval '10 seconds')
        OR (a.entity_type = 'chat_message' AND a.created_at < now() - interval '24 hours'
            AND NOT EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = a.entity_id)))
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM d;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.attachments__purge_rows(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attachments__purge_rows(uuid[]) TO service_role;

-- ── 8. Send takes the sender's files (live body; only the files change) ────

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

REVOKE ALL ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) TO authenticated, service_role;

-- ── 9. Delete and its Undo take the message's files along ─────────────────

CREATE OR REPLACE FUNCTION public.chat_op_delete(p_message_id uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__channel(v_msg.channel_id);
  IF NOT public.chat__may_delete(v_msg, auth.uid()) THEN
    RAISE EXCEPTION 'You can only delete your own messages.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.deleted_at IS NOT NULL THEN
    RETURN v_msg;
  END IF;
  -- The clock, not the transaction's start: the Undo window is measured on it.
  UPDATE public.chat_messages SET deleted_at = clock_timestamp(), deleted_by = auth.uid()
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  -- CV-9: its files go to the trash on the same clock (its Undo brings them back).
  UPDATE public.attachments
     SET deleted_at = v_msg.deleted_at, deleted_reason = 'chat_message',
         deleted_batch_id = gen_random_uuid(), updated_at = now()
   WHERE entity_type = 'chat_message' AND entity_id = v_msg.id AND deleted_at IS NULL;
  IF v_msg.parent_id IS NOT NULL THEN
    PERFORM public.chat__chain_refresh(v_msg.parent_id);
  END IF;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.message_delete', jsonb_build_object('message_id', v_msg.id));
  RETURN v_msg;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_delete(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_op_restore(p_message_id uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
  v_unpin boolean;
  v_was timestamptz;
  v_owner uuid;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__channel(v_msg.channel_id);
  IF v_msg.deleted_at IS NULL THEN
    IF NOT public.chat__may_delete(v_msg, auth.uid()) THEN
      RAISE EXCEPTION 'You can only delete your own messages.' USING ERRCODE = '42501';
    END IF;
    RETURN v_msg;
  END IF;
  -- The Undo is the deleter's (while they may still delete it), or anyone's who
  -- may delete others' messages: an author can't undo a delete by someone else.
  IF NOT (coalesce(v_msg.deleted_by = auth.uid(), false) AND public.chat__may_delete(v_msg, auth.uid())
          OR public.chat_has_cap(v_msg.workspace_id, auth.uid(), 'delete_others')) THEN
    RAISE EXCEPTION 'Only the person who deleted it can undo that.' USING ERRCODE = '42501';
  END IF;
  IF clock_timestamp() - v_msg.deleted_at > interval '10 seconds' THEN
    RAISE EXCEPTION 'It''s too late to undo that delete.' USING ERRCODE = '22023';
  END IF;
  v_was := v_msg.deleted_at;
  -- Back unpinned if its conversation filled its 100 pins meanwhile.
  IF v_msg.pinned_at IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('chat_pin:' || v_msg.channel_id::text));
  END IF;
  v_unpin := v_msg.pinned_at IS NOT NULL
             AND (SELECT count(*) FROM public.chat_messages p
                   WHERE p.channel_id = v_msg.channel_id AND p.pinned_at IS NOT NULL
                     AND p.deleted_at IS NULL) >= 100;
  UPDATE public.chat_messages
     SET deleted_at = NULL, deleted_by = NULL,
         pinned_at = CASE WHEN v_unpin THEN NULL ELSE pinned_at END,
         pinned_by = CASE WHEN v_unpin THEN NULL ELSE pinned_by END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  -- CV-9: the files its delete took come back with it.
  UPDATE public.attachments
     SET deleted_at = NULL, deleted_reason = NULL, deleted_batch_id = NULL, updated_at = now()
   WHERE entity_type = 'chat_message' AND entity_id = p_message_id
     AND deleted_reason = 'chat_message' AND deleted_at = v_was;
  IF FOUND THEN
    SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = v_msg.workspace_id;
    PERFORM public.attachments__alert(v_msg.workspace_id, v_owner);
  END IF;
  IF v_msg.parent_id IS NOT NULL THEN
    PERFORM public.chat__chain_refresh(v_msg.parent_id);
  END IF;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.message_restore', jsonb_build_object('message_id', v_msg.id));
  IF v_unpin THEN
    PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
      'chat.pin', jsonb_build_object('message_id', v_msg.id, 'pinned', false));
  END IF;
  RETURN v_msg;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_restore(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_restore(uuid) TO authenticated, service_role;

-- ── 10. The Files view ─────────────────────────────────────────────────────
-- Newest message first; (before, before_id) is the last row of the previous
-- page. Reading never needs the plan (chat_op__reader).

CREATE OR REPLACE FUNCTION public.chat_files(
  p_channel_id uuid, p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 50,
  p_before_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, message_id uuid, author_id uuid, file_name text, mime text,
              size_bytes bigint, width integer, height integer, object_path text,
              preview_path text, preview_mime text, sent_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  RETURN QUERY
  SELECT a.id, m.id, m.author_id, a.file_name, a.mime, a.size_bytes, a.width, a.height,
         a.object_path, a.preview_path, a.preview_mime, m.created_at
    FROM public.chat_messages m
    JOIN public.attachments a
      ON a.workspace_id = m.workspace_id AND a.entity_type = 'chat_message' AND a.entity_id = m.id
     AND a.uploader_id IS NOT DISTINCT FROM m.author_id
   WHERE m.channel_id = p_channel_id
     AND m.deleted_at IS NULL AND m.file_count > 0
     AND a.status = 'ready' AND a.deleted_at IS NULL
     AND (p_before IS NULL
          OR (m.created_at, a.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   ORDER BY m.created_at DESC, a.id DESC
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_files(uuid, timestamptz, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_files(uuid, timestamptz, integer, uuid) TO authenticated, service_role;
