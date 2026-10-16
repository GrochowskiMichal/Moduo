-- NR-8 · Comments anchored to text (specs/notes-refresh.md, assumption 20).
--
-- A note's text carries @lexical/mark MarkNodes whose ids are thread ids. A
-- thread is every comment on the note sharing an `anchor_id`; `resolved_at`
-- closes it (the client then removes the mark). Comments with no anchor stay
-- note-level, so every existing comment (quote-comments included) reads as
-- before, and Tasks/Contacts comments never get one.
--
-- comments_op_add is left exactly as prod has it (the MCP connector and every
-- surface call it); the anchored write wraps it, so the guard, visibility,
-- registry ensure, mentions and notifications are the same code path.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS anchor_id uuid NULL,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL;

ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_resolved_needs_anchor,
  ADD CONSTRAINT comments_resolved_needs_anchor CHECK (resolved_at IS NULL OR anchor_id IS NOT NULL),
  DROP CONSTRAINT IF EXISTS comments_anchor_on_notes,
  ADD CONSTRAINT comments_anchor_on_notes CHECK (anchor_id IS NULL OR entity_type = 'note');

CREATE INDEX IF NOT EXISTS comments_anchor_idx
  ON public.comments (workspace_id, entity_id, anchor_id)
  WHERE anchor_id IS NOT NULL;

-- Start (or reply in) a thread anchored to text in a note.
CREATE OR REPLACE FUNCTION public.comments_op_add_anchored(
  p_workspace_id uuid,
  p_entity_id uuid,
  p_anchor_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[],
  p_entity_label text DEFAULT NULL::text,
  p_entity_icon text DEFAULT NULL::text
)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comment public.comments;
BEGIN
  IF p_anchor_id IS NULL THEN
    RAISE EXCEPTION 'An anchored comment needs its thread.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.spine_op__guard(p_workspace_id);
  IF NOT public.comments__item_seen(p_workspace_id, 'note', p_entity_id) THEN
    RAISE EXCEPTION 'That item isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
  -- Serialize writers on one thread so a reply can't slip past a resolve.
  PERFORM pg_advisory_xact_lock(hashtextextended('comments.anchor:' || p_anchor_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.anchor_id = p_anchor_id
      AND (c.workspace_id <> p_workspace_id OR c.entity_id <> p_entity_id)
  ) THEN
    RAISE EXCEPTION 'That thread belongs to another note.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.comments c
    WHERE c.workspace_id = p_workspace_id AND c.entity_id = p_entity_id
      AND c.anchor_id = p_anchor_id AND c.resolved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'That thread is resolved.' USING ERRCODE = 'P0001';
  END IF;

  -- The shared write: guard, can-see check, mentions, notifications.
  v_comment := public.comments_op_add(
    p_workspace_id, 'note', p_entity_id, p_body,
    p_mentioned_user_ids, p_entity_label, p_entity_icon);

  UPDATE public.comments SET anchor_id = p_anchor_id
  WHERE id = v_comment.id
  RETURNING * INTO v_comment;
  RETURN v_comment;
END;
$function$;

-- Resolve (or reopen) a thread: every comment in it, deleted ones included,
-- so a restored comment comes back into the same state.
CREATE OR REPLACE FUNCTION public.comments_op_resolve(
  p_workspace_id uuid,
  p_entity_id uuid,
  p_anchor_id uuid,
  p_resolved boolean DEFAULT true
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  -- A person resolves (the highlight lives in their editor); an app's key can't.
  IF public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'An app can''t resolve a comment thread.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.comments__item_seen(p_workspace_id, 'note', p_entity_id) THEN
    RAISE EXCEPTION 'That item isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('comments.anchor:' || p_anchor_id::text, 0));

  UPDATE public.comments c
  SET resolved_at = CASE WHEN coalesce(p_resolved, true) THEN coalesce(c.resolved_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE c.workspace_id = p_workspace_id
    AND c.entity_type = 'note'
    AND c.entity_id = p_entity_id
    AND c.anchor_id = p_anchor_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'That thread isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.module_activity_log(
    p_workspace_id, 'comments', 'note', p_entity_id,
    CASE WHEN coalesce(p_resolved, true) THEN 'comments.resolve' ELSE 'comments.reopen' END,
    jsonb_build_object('anchor_id', p_anchor_id));
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.comments_op_add_anchored(uuid, uuid, uuid, text, uuid[], text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comments_op_resolve(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comments_op_add_anchored(uuid, uuid, uuid, text, uuid[], text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.comments_op_resolve(uuid, uuid, uuid, boolean) TO authenticated, service_role;
