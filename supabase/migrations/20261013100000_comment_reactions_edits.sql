-- TV-U13 · Comments: edit, delete with Undo, six fixed reactions
-- (specs/tasks-v3.md §9, AC11.8; REPLAN 88, default q; research
-- views-board-detail.md §9; decisions/tasks.md "TV-U13").
--
-- 1. `comments.edited_at`: an edit shows "edited".
-- 2. `comment_reactions`: who reacted with which of the six (👍 ✅ 👀 🙏 ❤️ 😄,
--    stored as words; COMMENT_REACTIONS in @contracts/vocabularies). Read by
--    whoever can read the comment (its own RLS); written only by the op.
-- 3. Ops, every one SECURITY DEFINER and checked:
--    - comments_op_edit:    the author only, while they can see the item; a
--                           person named for the first time is notified
--                           (`comments.edit`), nobody else;
--    - comments_op_delete:  the author, or whoever has Full access to the
--                           task / note; a soft delete (the 8 s Undo);
--    - comments_op_restore: the same people, while it is deleted;
--    - comments_op_react:   anyone who can comment on the item; never notifies
--                           and writes no activity row (88).
--    Each one moves the comment's `updated_at`, so the shared store's delta
--    and the `comments` Realtime feed carry the change to open panels.
--
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS.
-- Nothing here redefines an existing function.

-- ── 1. Edited ─────────────────────────────────────────────────────────────────
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- ── 2. Reactions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comment_reactions (
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reaction text NOT NULL
    CONSTRAINT comment_reactions_reaction_check
    CHECK (reaction IN ('thumbs_up','check','eyes','pray','heart','smile')),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id, reaction)
);
CREATE INDEX IF NOT EXISTS comment_reactions_user ON public.comment_reactions (user_id);
CREATE INDEX IF NOT EXISTS comment_reactions_workspace ON public.comment_reactions (workspace_id);

ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comment_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comment_reactions TO authenticated;
GRANT ALL ON public.comment_reactions TO service_role;

-- A reaction reads like its comment: the subquery runs under the comment's
-- own policy (the workspace and the item's visibility).
DROP POLICY IF EXISTS comment_reactions_read ON public.comment_reactions;
CREATE POLICY comment_reactions_read ON public.comment_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_reactions.comment_id));

-- ── 3. Ops ────────────────────────────────────────────────────────────────────

-- Who may delete (or restore) a comment: its author while they can still see
-- the item, or whoever has Full access to the task or note it's on.
CREATE OR REPLACE FUNCTION public.comments__can_remove(c public.comments)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.module_api_key_id() IS NULL
     AND c.author_kind = 'user'
     AND c.created_by = public.perm_actor_id()
     AND public.perm_can_see_entity(c.workspace_id, c.entity_type, c.entity_id) THEN
    RETURN true;
  END IF;
  IF c.entity_type IN ('task', 'task_project') THEN
    RETURN public.can_access('task', c.entity_id, 'full');
  ELSIF c.entity_type = 'note' THEN
    RETURN public.can_access('note', c.entity_id, 'full');
  END IF;
  RETURN false;
END;
$$;

-- The comment, locked, in a workspace the caller belongs to; else refused.
CREATE OR REPLACE FUNCTION public.comments__find(p_comment_id uuid)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.comments;
BEGIN
  SELECT * INTO v FROM public.comments WHERE id = p_comment_id FOR UPDATE;
  IF NOT FOUND
     OR NOT public.tasks_module_can_access_workspace(v.workspace_id)
     OR NOT public.perm_can_see_entity(v.workspace_id, v.entity_type, v.entity_id) THEN
    RAISE EXCEPTION 'That comment isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.comments_op_edit(
  p_comment_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.comments;
  v_body text := coalesce(p_body, '');
  v_before jsonb;
  v_new jsonb;
BEGIN
  v := public.comments__find(p_comment_id);
  PERFORM public.spine_op__guard(v.workspace_id);
  IF public.module_api_key_id() IS NOT NULL
     OR v.author_kind <> 'user'
     OR v.created_by IS DISTINCT FROM public.perm_actor_id() THEN
    RAISE EXCEPTION 'Only its author can edit a comment.' USING ERRCODE = '42501';
  END IF;
  IF v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment was deleted.' USING ERRCODE = 'P0002';
  END IF;
  IF trim(v_body) = '' THEN
    RAISE EXCEPTION 'A comment can''t be empty.';
  END IF;
  IF v_body = v.body THEN
    RETURN v;
  END IF;

  -- People this comment named before (its add and earlier edits) hear nothing
  -- new; only someone named for the first time is notified.
  SELECT coalesce(jsonb_agg(DISTINCT m.uid), '[]'::jsonb) INTO v_before
  FROM public.module_activity a,
       LATERAL jsonb_array_elements_text(coalesce(a.payload -> 'mentioned_user_ids', '[]'::jsonb)) AS m(uid)
  WHERE a.workspace_id = v.workspace_id
    AND a.module = 'comments'
    AND a.entity_type = v.entity_type
    AND a.entity_id = v.entity_id
    AND a.op IN ('comments.add', 'comments.edit')
    AND a.payload ->> 'comment_id' = v.id::text;
  SELECT coalesce(jsonb_agg(DISTINCT u::text), '[]'::jsonb) INTO v_new
  FROM unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[])) AS u
  WHERE NOT (v_before @> jsonb_build_array(u::text))
    AND u IS DISTINCT FROM public.perm_actor_id();

  UPDATE public.comments
     SET body = v_body, edited_at = now(), updated_at = now()
   WHERE id = v.id
  RETURNING * INTO v;

  PERFORM public.module_activity_log(
    v.workspace_id, 'comments', v.entity_type, v.entity_id, 'comments.edit',
    jsonb_build_object(
      'comment_id', v.id,
      'excerpt', left(v_body, 140),
      'mentioned_user_ids', v_new));
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.comments_op_delete(p_comment_id uuid)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.comments;
BEGIN
  v := public.comments__find(p_comment_id);
  PERFORM public.spine_op__guard(v.workspace_id);
  IF NOT public.comments__can_remove(v) THEN
    RAISE EXCEPTION 'You can delete your own comments; Full access deletes anyone''s.'
      USING ERRCODE = '42501';
  END IF;
  IF v.deleted_at IS NOT NULL THEN
    RETURN v;
  END IF;
  UPDATE public.comments SET deleted_at = now(), updated_at = now()
   WHERE id = v.id
  RETURNING * INTO v;
  PERFORM public.module_activity_log(
    v.workspace_id, 'comments', v.entity_type, v.entity_id, 'comments.delete',
    jsonb_build_object('comment_id', v.id));
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.comments_op_restore(p_comment_id uuid)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.comments;
BEGIN
  v := public.comments__find(p_comment_id);
  PERFORM public.spine_op__guard(v.workspace_id);
  IF NOT public.comments__can_remove(v) THEN
    RAISE EXCEPTION 'You can delete your own comments; Full access deletes anyone''s.'
      USING ERRCODE = '42501';
  END IF;
  IF v.deleted_at IS NULL THEN
    RETURN v;
  END IF;
  UPDATE public.comments SET deleted_at = NULL, updated_at = now()
   WHERE id = v.id
  RETURNING * INTO v;
  PERFORM public.module_activity_log(
    v.workspace_id, 'comments', v.entity_type, v.entity_id, 'comments.restore',
    jsonb_build_object('comment_id', v.id));
  RETURN v;
END;
$$;

-- Toggle one reaction; answers the comment's reactions after the change. A
-- person reacts (never an app over a key). No activity row, no notice (88).
CREATE OR REPLACE FUNCTION public.comments_op_react(
  p_comment_id uuid,
  p_reaction text,
  p_on boolean DEFAULT true
)
RETURNS SETOF public.comment_reactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.comments;
  v_me uuid := public.perm_actor_id();
BEGIN
  IF public.module_api_key_id() IS NOT NULL OR v_me IS NULL THEN
    RAISE EXCEPTION 'Reactions come from people.' USING ERRCODE = '42501';
  END IF;
  IF p_reaction IS NULL OR p_reaction NOT IN ('thumbs_up', 'check', 'eyes', 'pray', 'heart', 'smile') THEN
    RAISE EXCEPTION 'Pick one of the six reactions.' USING ERRCODE = '22023';
  END IF;
  v := public.comments__find(p_comment_id);
  PERFORM public.spine_op__guard(v.workspace_id);
  IF v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment was deleted.' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(p_on, true) THEN
    INSERT INTO public.comment_reactions (comment_id, user_id, reaction, workspace_id)
    VALUES (v.id, v_me, p_reaction, v.workspace_id)
    ON CONFLICT (comment_id, user_id, reaction) DO NOTHING;
  ELSE
    DELETE FROM public.comment_reactions
     WHERE comment_id = v.id AND user_id = v_me AND reaction = p_reaction;
  END IF;
  -- Carries the change to open panels (delta + Realtime); not an edit.
  UPDATE public.comments SET updated_at = now() WHERE id = v.id;

  RETURN QUERY
    SELECT r.* FROM public.comment_reactions r
     WHERE r.comment_id = v.id
     ORDER BY r.created_at, r.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.comments__can_remove(public.comments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.comments__find(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comments__can_remove(public.comments) TO service_role;
GRANT EXECUTE ON FUNCTION public.comments__find(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.comments_op_edit(uuid, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comments_op_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comments_op_restore(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comments_op_react(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comments_op_edit(uuid, text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.comments_op_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.comments_op_restore(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.comments_op_react(uuid, text, boolean) TO authenticated, service_role;
