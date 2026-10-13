-- TV-U13 · Comments: edit, delete with Undo, six fixed reactions
-- (specs/tasks-v3.md §9, AC11.8; REPLAN 88, default q; research
-- views-board-detail.md §9; decisions/tasks.md "TV-U13").
--
-- 1. `comments.edited_at`: an edit shows "edited".
-- 2. `comment_reactions`: who reacted with which of the six (👍 ✅ 👀 🙏 ❤️ 😄,
--    stored as words; COMMENT_REACTIONS in @contracts/vocabularies). Read by
--    whoever can read the comment (its own RLS); written only by the op.
-- 3. One gate for the item a comment is on, `comments__item_level`: a task's
--    (tasks__visible; can_access … 'full'), a note's (can_access), the other
--    known types' (comments__item_visible_to), and nobody for an unknown type.
--    The comments read policy is redefined onto it, so reading and every op
--    agree. Mentions and participant notices reach only people who can see
--    the item (comments__item_visible_to). Every op asks it:
--    - comments_op_add (redefined from its live body): you comment only on
--      what you can see; the same refusal for hidden and missing;
--    - comments_op_edit:    the author only, while they can see the item; a
--                           person named for the first time is notified
--                           (`comments.edit`), nobody else;
--    - comments_op_delete:  the author while they can see the item, or Full
--                           access to the task or note; a soft delete (the
--                           8 s Undo);
--    - comments_op_restore: the same people, while it is deleted;
--    - comments_op_react:   whoever can comment on it (the same guard and item
--                           gate as comments_op_add); never notifies and
--                           writes no activity row (88).
--    Edit, delete, restore and react are a person's: an app over an API key
--    can't call them. Each one moves the comment's `updated_at`, so the shared
--    store's delta and the `comments` Realtime feed carry the change.
--
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS.

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
-- own policy (a member of its workspace who can see the item it's on).
DROP POLICY IF EXISTS comment_reactions_read ON public.comment_reactions;
CREATE POLICY comment_reactions_read ON public.comment_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_reactions.comment_id));

-- ── 3. Ops ────────────────────────────────────────────────────────────────────

-- How far the caller reaches the item a comment is on: 'full', 'view' (sees
-- it, without Full) or 'none'. Tasks and notes must be in the comment's
-- workspace; other items (contacts, events, email threads…) are seen or not,
-- and nobody has Full on them here. Workspace membership is the callers' own
-- check (the spine guard, comments__find). A key acts as its creator.
CREATE OR REPLACE FUNCTION public.comments__item_level(p_workspace_id uuid, p_type text, p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_type IN ('task', 'task_project') THEN
    IF NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = p_id AND t.workspace_id = p_workspace_id) THEN
      RETURN 'none';
    END IF;
    IF NOT public.tasks__visible(p_id) THEN RETURN 'none'; END IF;
    -- 'task_project' names a task under an older registry type: only a task
    -- proper takes the Full path.
    IF p_type = 'task' AND public.can_access('task', p_id, 'full') THEN RETURN 'full'; END IF;
    RETURN 'view';
  ELSIF p_type = 'note' THEN
    IF NOT EXISTS (SELECT 1 FROM public.notes n WHERE n.id = p_id AND n.workspace_id = p_workspace_id) THEN
      RETURN 'none';
    END IF;
    IF NOT public.can_access('note', p_id, 'view') THEN RETURN 'none'; END IF;
    IF public.can_access('note', p_id, 'full') THEN RETURN 'full'; END IF;
    RETURN 'view';
  ELSIF p_type IN ('bucket', 'contact', 'company', 'event', 'email_thread', 'email_account', 'calendar_account') THEN
    RETURN CASE WHEN public.comments__item_visible_to(p_workspace_id, p_type, p_id, public.perm_actor_id())
                THEN 'view' ELSE 'none' END;
  END IF;
  -- Any other type: nobody (never "everyone in the workspace").
  RETURN 'none';
END;
$$;

-- Whether a given person can see the item a comment is on: who a mention or
-- a participant notice may reach. The same rules as comments__item_level,
-- asked for someone else (can_access takes the person; owner-only items are
-- their owner's).
CREATE OR REPLACE FUNCTION public.comments__item_visible_to(p_workspace_id uuid, p_type text, p_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_user IS NULL THEN RETURN false; END IF;
  IF p_type IN ('task', 'task_project') THEN
    RETURN EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = p_id AND t.workspace_id = p_workspace_id)
       AND public.tasks__visible_to(p_id, p_user);
  ELSIF p_type IN ('note', 'bucket', 'contact', 'company', 'event') THEN
    RETURN public.can_access(p_type, p_id, 'view', p_user)
       AND CASE p_type
             WHEN 'note' THEN EXISTS (SELECT 1 FROM public.notes n WHERE n.id = p_id AND n.workspace_id = p_workspace_id)
             WHEN 'bucket' THEN EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = p_id AND b.workspace_id = p_workspace_id)
             WHEN 'contact' THEN EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_id AND c.workspace_id = p_workspace_id)
             WHEN 'company' THEN EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_id AND c.workspace_id = p_workspace_id)
             ELSE EXISTS (SELECT 1 FROM public.calendar_events e WHERE e.id = p_id AND e.workspace_id = p_workspace_id)
           END;
  ELSIF p_type = 'email_thread' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_refs r WHERE r.id = p_id AND r.owner_id = p_user AND r.workspace_id = p_workspace_id);
  ELSIF p_type = 'email_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = p_id AND a.owner_id = p_user AND a.workspace_id = p_workspace_id);
  ELSIF p_type = 'calendar_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.calendar_accounts a WHERE a.id = p_id AND a.owner_id = p_user AND a.workspace_id = p_workspace_id);
  END IF;
  RETURN false;
END;
$$;

-- Comments read through the same gate the ops use, so reading and writing
-- can never disagree (and their reactions follow, through their own policy).
DROP POLICY IF EXISTS comments_workspace_read ON public.comments;
CREATE POLICY comments_workspace_read ON public.comments
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id)
         AND public.comments__item_level(workspace_id, entity_type, entity_id) <> 'none');

-- A person (never an app over a key), a member of the comment's workspace
-- who can comment there and can see the item: the comment, locked. Anyone
-- else is refused without learning whether it exists.
CREATE OR REPLACE FUNCTION public.comments__find(p_comment_id uuid)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.comments;
BEGIN
  IF public.module_api_key_id() IS NOT NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Only people can change comments here.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.comments WHERE id = p_comment_id FOR UPDATE;
  IF NOT FOUND
     OR NOT public.tasks_module_can_access_workspace(v.workspace_id)
     OR public.comments__item_level(v.workspace_id, v.entity_type, v.entity_id) = 'none' THEN
    RAISE EXCEPTION 'That comment isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.spine_op__guard(v.workspace_id);
  RETURN v;
END;
$$;

-- Who may delete (or restore) a comment comments__find handed back: its
-- author, or Full access to the task or note it's on.
CREATE OR REPLACE FUNCTION public.comments__can_remove(c public.comments)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.module_api_key_id() IS NULL AND auth.uid() IS NOT NULL AND (
    (c.author_kind = 'user' AND c.created_by = auth.uid())
    OR public.comments__item_level(c.workspace_id, c.entity_type, c.entity_id) = 'full')
$$;

-- Redefined from its live body (20261008150000's), plus one check: you
-- comment only on an item you can see (comments__item_level).
CREATE OR REPLACE FUNCTION public.comments_op_add(p_workspace_id uuid, p_entity_type text, p_entity_id uuid, p_body text, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[], p_entity_label text DEFAULT NULL::text, p_entity_icon text DEFAULT NULL::text)
 RETURNS comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comment public.comments;
  v_body text := coalesce(p_body, '');
  v_mentions jsonb;
  v_owner uuid;
  v_creator uuid;  -- tasks: the creator, when known (TV-D1)
  v_notify jsonb;
  v_key uuid := public.module_api_key_id();
  v_key_label text;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  IF trim(v_body) = '' THEN
    RAISE EXCEPTION 'A comment can''t be empty.';
  END IF;
  -- TV-U13: only on something you can see (a key acts as its creator).
  IF public.comments__item_level(p_workspace_id, p_entity_type, p_entity_id) = 'none' THEN
    RAISE EXCEPTION 'That item isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
  -- TV-U13: a mention reaches only someone who can see the item.
  SELECT coalesce(jsonb_agg(DISTINCT u::text), '[]'::jsonb) INTO v_mentions
  FROM unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[])) AS u
  WHERE public.comments__item_visible_to(p_workspace_id, p_entity_type, p_entity_id, u);

  -- Ensure the target exists in the registry (satisfies the FK) without
  -- reviving a tombstone or clobbering an authoritative label.
  PERFORM public.entities_op_ensure(p_workspace_id, p_entity_type, p_entity_id, p_entity_label, p_entity_icon);

  -- A key's comment belongs to its creator (created_by is NOT NULL, and the
  -- creator's access governs it) but reads as the app that wrote it.
  IF v_key IS NOT NULL THEN
    SELECT k.name INTO v_key_label FROM public.workspace_api_keys k WHERE k.id = v_key;
  END IF;
  INSERT INTO public.comments
    (workspace_id, entity_type, entity_id, body, created_by, author_kind, author_label)
  VALUES (
    p_workspace_id, p_entity_type, p_entity_id, v_body, public.perm_actor_id(),
    CASE WHEN v_key IS NULL THEN 'user' ELSE 'api_key' END,
    CASE WHEN v_key IS NULL THEN NULL ELSE coalesce(v_key_label, 'App') END)
  RETURNING * INTO v_comment;

  -- Resolve the entity owner for the types that have one. Owner-less entities
  -- (contact/company/event) leave v_owner NULL → only participants notify. A
  -- soft-deleted (trashed) task/note resolves to NULL too — don't ping an owner
  -- about a comment on something in their trash.
  IF p_entity_type = 'task' THEN
    -- A task comment reaches its assignee and its creator (TV-D1: owner_id is
    -- the creator; left out when unknown or when they can no longer see the
    -- task), plus everyone who commented before.
    SELECT t.assignee_id,
           CASE WHEN t.creator_unknown OR NOT public.can_access('task', t.id, 'view', t.owner_id)
                THEN NULL ELSE t.owner_id END
      INTO v_owner, v_creator FROM public.tasks t
      WHERE t.id = p_entity_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL;
  ELSIF p_entity_type = 'note' THEN
    SELECT n.created_by INTO v_owner FROM public.notes n
      WHERE n.id = p_entity_id AND n.workspace_id = p_workspace_id AND n.deleted_at IS NULL;
  END IF;

  -- notify_user_ids = (owner ∪ prior participants) − the actor. De-duped; TEXT
  -- ids to match the predicate's `@> jsonb_build_array(auth.uid()::text)`.
  -- New here: a key's comment reads as the app, not as its creator, so it
  -- notifies the creator like anyone else's comment would (Maciej, 2026-10-08).
  SELECT coalesce(jsonb_agg(DISTINCT s.uid::text), '[]'::jsonb) INTO v_notify
  FROM (
    SELECT c.created_by AS uid
    FROM public.comments c
    WHERE c.workspace_id = p_workspace_id
      AND c.entity_type = p_entity_type
      AND c.entity_id = p_entity_id
      AND c.deleted_at IS NULL
    UNION
    SELECT v_owner
    WHERE v_owner IS NOT NULL
    UNION
    SELECT v_creator
    WHERE v_creator IS NOT NULL
  ) s
  WHERE (v_key IS NOT NULL OR s.uid IS DISTINCT FROM public.perm_actor_id())
    -- TV-U13: and only someone who can still see the item.
    AND public.comments__item_visible_to(p_workspace_id, p_entity_type, p_entity_id, s.uid);

  PERFORM public.module_activity_log(
    p_workspace_id, 'comments', p_entity_type, p_entity_id, 'comments.add',
    jsonb_build_object(
      'comment_id', v_comment.id,
      -- A short excerpt for the notification card — never the full body.
      'excerpt', left(v_body, 140),
      'mentioned_user_ids', v_mentions,
      'notify_user_ids', v_notify)
  );
  RETURN v_comment;
END;
$function$;

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
  IF v.author_kind <> 'user' OR v.created_by IS DISTINCT FROM auth.uid() THEN
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
    AND u IS DISTINCT FROM auth.uid()
    AND public.comments__item_visible_to(v.workspace_id, v.entity_type, v.entity_id, u);

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

-- Toggle one reaction; answers the comment's reactions after the change.
-- Whoever can comment on the item can react (comments__find runs the same
-- guard and item gate as comments_op_add). No activity row, no notice (88).
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
BEGIN
  IF p_reaction IS NULL OR p_reaction NOT IN ('thumbs_up', 'check', 'eyes', 'pray', 'heart', 'smile') THEN
    RAISE EXCEPTION 'Pick one of the six reactions.' USING ERRCODE = '22023';
  END IF;
  v := public.comments__find(p_comment_id);
  IF v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment was deleted.' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(p_on, true) THEN
    INSERT INTO public.comment_reactions (comment_id, user_id, reaction, workspace_id)
    VALUES (v.id, auth.uid(), p_reaction, v.workspace_id)
    ON CONFLICT (comment_id, user_id, reaction) DO NOTHING;
  ELSE
    DELETE FROM public.comment_reactions
     WHERE comment_id = v.id AND user_id = auth.uid() AND reaction = p_reaction;
  END IF;
  -- Carries the change to open panels (delta + Realtime); not an edit.
  UPDATE public.comments SET updated_at = now() WHERE id = v.id;

  RETURN QUERY
    SELECT r.* FROM public.comment_reactions r
     WHERE r.comment_id = v.id
     ORDER BY r.created_at, r.user_id;
END;
$$;

-- The read policy asks comments__item_level as the reader: callable by members
-- (it answers only for the caller), never anonymously.
REVOKE ALL ON FUNCTION public.comments__item_level(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.comments__item_visible_to(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comments__item_visible_to(uuid, text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.comments__can_remove(public.comments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.comments__find(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comments__item_level(uuid, text, uuid) TO authenticated, service_role;
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
