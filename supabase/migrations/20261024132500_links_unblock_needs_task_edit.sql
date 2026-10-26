-- MOD-549 · Removing a task's dependency through its link needs Edit on the
-- task that waits.
--
-- A "blocks" link between two tasks mirrors a task_relations row (the waiting
-- task can't start until the other is done). Making one asks for Edit on the
-- waiting task (entity_links__blocks_to_relations, and the task_relations
-- RLS policies). Removing one didn't: links_op_delete and links_op_set_kind
-- checked only the links lane (spine_op__guard), and the AFTER trigger then
-- deleted the task_relations row as definer. Every member reads link ids
-- (entity_links_workspace_read), so anyone with the default role, or an API
-- key with links=edit, could clear dependencies inside a teammate's private
-- project.
--
-- Both ops now ask for Edit on the waiting task (the link's target) before
-- they delete a task-to-task "blocks" link or retype it to another kind, the
-- same rule the task_relations DELETE policy holds. The check sits in the
-- ops, not the trigger: the trigger also runs when a task is deleted or
-- purged and its relation goes with it, which needs no Edit on the other
-- task. entity_links has no UPDATE policy, so the ops are the only way a
-- person or a key changes a link. System work with no actor passes.
--
-- Verified on the local stack by supabase/tests/links_unblock_access.test.sql.

CREATE OR REPLACE FUNCTION public.links__assert_can_unblock(p_link public.entity_links)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF p_link.relation_kind = 'blocks' AND p_link.source_type = 'task' AND p_link.target_type = 'task'
     AND v_actor IS NOT NULL
     AND NOT public.can_access('task', p_link.target_id, 'edit', v_actor) THEN
    RAISE EXCEPTION 'You can''t change what that task waits on.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.links__assert_can_unblock(public.entity_links) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.links_op_delete(p_workspace_id uuid, p_link_id uuid)
 RETURNS entity_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.entity_links;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_link FROM public.entity_links
      WHERE id = p_link_id AND workspace_id = p_workspace_id;
    IF v_link.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN v_link;
  END IF;

  -- A "Mentioned in" line is history: it stays.
  IF v_link.relation_kind = 'mentions'
     AND (lower(btrim(v_link.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(v_link.target_type)) IN ('chat_channel', 'chat_message')) THEN
    RAISE EXCEPTION 'A mention in a conversation stays: it''s part of the conversation''s history.'
      USING ERRCODE = '42501';
  END IF;
  -- A conversation's link to its item is changed from the conversation (CV-13).
  IF v_link.relation_kind = 'conversation-of' THEN
    RAISE EXCEPTION 'Unlink it from the conversation''s Details.' USING ERRCODE = '42501';
  END IF;
  -- MOD-549: a task's dependency is changed by someone who can edit that task.
  PERFORM public.links__assert_can_unblock(v_link);

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE id = v_link.id
    RETURNING * INTO v_link;

  PERFORM public.module_activity_log(
    p_workspace_id, 'links', v_link.source_type, v_link.source_id, 'links.delete',
    jsonb_build_object(
      'link_id', v_link.id, 'relation_kind', v_link.relation_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$function$;


CREATE OR REPLACE FUNCTION public.links_op_set_kind(p_workspace_id uuid, p_link_id uuid, p_relation_kind text)
 RETURNS entity_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.entity_links;
  v_from text;
  v_kind text := p_relation_kind;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found in this workspace.';
  END IF;
  IF v_link.relation_kind = v_kind THEN
    RETURN v_link;
  END IF;
  -- "Mentioned in" lines are Chat's: none is retyped, and none is made here.
  IF (lower(btrim(v_link.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(v_link.target_type)) IN ('chat_channel', 'chat_message'))
     AND (v_link.relation_kind = 'mentions' OR v_kind = 'mentions') THEN
    RAISE EXCEPTION 'Mentions and inline references with a conversation or a message are written by Chat only.'
      USING ERRCODE = '42501';
  END IF;
  -- MOD-549: retyping a dependency away removes it, so it needs Edit on the
  -- waiting task too (retyping into one is checked by the trigger).
  PERFORM public.links__assert_can_unblock(v_link);

  v_from := v_link.relation_kind;
  BEGIN
    UPDATE public.entity_links
      SET relation_kind = v_kind
      WHERE id = v_link.id
      RETURNING * INTO v_link;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'These two are already linked as %.', v_kind;
  END;

  PERFORM public.module_activity_log(
    p_workspace_id, 'links', v_link.source_type, v_link.source_id, 'links.set_kind',
    jsonb_build_object(
      'link_id', v_link.id, 'from', v_from, 'to', v_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$function$;


REVOKE EXECUTE ON FUNCTION public.links_op_delete(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.links_op_set_kind(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.links_op_delete(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.links_op_set_kind(uuid, uuid, text) TO authenticated, service_role;
