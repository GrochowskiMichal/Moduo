-- DF-21d — Comment-on-your-entity notification (Universal Inbox / "the bell
-- grows up"). AC8: a comment on an entity you OWN (task/note) or on a thread
-- you've PARTICIPATED in notifies you even without an @mention; your own
-- comments never notify you; owner-also-mentioned de-dupes to one notification.
--
-- The only change is inside comments_op_add: alongside the client-supplied
-- `mentioned_user_ids` (the @mention branch), the op now also computes and logs
-- a server-side `notify_user_ids` set:
--
--     notify_user_ids = (entity owner ∪ prior participants) − the actor
--
--   • owner is resolved for the types that HAVE one — tasks.owner_id,
--     notes.created_by. Owner-less entities (contact/company/event) resolve to
--     NULL, so only participants notify (spec edge case).
--   • prior participants = everyone who has commented on this (entity_type,
--     entity_id) (the just-inserted row included — the actor is removed next).
--   • the actor is excluded, so a self-comment writes an empty set → no self
--     notification, even though the notify_user_ids predicate branch is
--     actor-agnostic (that branch was added by the email-due migration).
--
-- This rides the `notify_user_ids` disjunct of spine_activity_targets_me. That
-- disjunct was authored in 20260704180000_email_snooze_followup.sql, but a
-- rolled-back prod probe on 2026-07-14 found the DEPLOYED predicate is still the
-- CT-5 mention-only version — the email migration's predicate change was never
-- applied (which also silently disabled DF-9's tasks.unblocked and email
-- snooze/follow-up-due notifications). So this migration RE-ASSERTS the two-branch
-- predicate (idempotent, backward-compatible: the mention branch is unchanged, the
-- notify branch is additive) to make DF-21d self-sufficient and to resurrect those
-- other notify-branch types. A user who is BOTH the owner and @mentioned still
-- yields ONE module_activity row → one notification (the id sets overlap
-- harmlessly; grouping/badge count rows, not ids).
--
-- CREATE OR REPLACE throughout (not DROP): signatures + return types are unchanged,
-- so grants are preserved — but we re-assert the predicate's grants anyway to match
-- the email migration's posture (harmless; contrast the notifications_list
-- DROP+CREATE that DID reset grants, gotchas §Supabase).
--
-- Depends on: 20260626130000 (comments_op_add + spine_activity_targets_me + notes
-- created_by is 20260703120000), 20260612150000 (module_activity_log).

-- ── spine_activity_targets_me — ensure the two-branch (mention + notify) shape ──
-- Mirrors 20260704180000. Backward-compatible: disjunct 1 is the unchanged CT-5
-- mention rule (someone else named me); disjunct 2 is actor-agnostic and keys on
-- `notify_user_ids` (written by the email due ops, DF-9's unblock trigger, and now
-- comments_op_add below). STABLE — reads only its argument + auth.uid().
CREATE OR REPLACE FUNCTION public.spine_activity_targets_me(p_activity public.module_activity)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (
      p_activity.actor_id IS DISTINCT FROM auth.uid()
      AND (p_activity.payload -> 'mentioned_user_ids') @> jsonb_build_array(auth.uid()::text)
    ) OR (
      (p_activity.payload -> 'notify_user_ids') @> jsonb_build_array(auth.uid()::text)
    );
$$;

REVOKE ALL ON FUNCTION public.spine_activity_targets_me(public.module_activity) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.spine_activity_targets_me(public.module_activity) FROM anon;
GRANT EXECUTE ON FUNCTION public.spine_activity_targets_me(public.module_activity) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spine_activity_targets_me(public.module_activity) TO service_role;

CREATE OR REPLACE FUNCTION public.comments_op_add(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] DEFAULT '{}',
  p_entity_label text DEFAULT NULL,
  p_entity_icon text DEFAULT NULL
)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comment public.comments;
  v_body text := coalesce(p_body, '');
  v_mentions jsonb := to_jsonb(coalesce(p_mentioned_user_ids, '{}'::uuid[]));
  v_owner uuid;
  v_notify jsonb;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  IF trim(v_body) = '' THEN
    RAISE EXCEPTION 'A comment can''t be empty.';
  END IF;

  -- Ensure the target exists in the registry (satisfies the FK) without
  -- reviving a tombstone or clobbering an authoritative label.
  PERFORM public.entities_op_ensure(p_workspace_id, p_entity_type, p_entity_id, p_entity_label, p_entity_icon);

  INSERT INTO public.comments (workspace_id, entity_type, entity_id, body, created_by)
  VALUES (p_workspace_id, p_entity_type, p_entity_id, v_body, auth.uid())
  RETURNING * INTO v_comment;

  -- Resolve the entity owner for the types that have one. Owner-less entities
  -- (contact/company/event) leave v_owner NULL → only participants notify. A
  -- soft-deleted (trashed) task/note resolves to NULL too — don't ping an owner
  -- about a comment on something in their trash.
  IF p_entity_type = 'task' THEN
    SELECT t.owner_id INTO v_owner FROM public.tasks t
      WHERE t.id = p_entity_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL;
  ELSIF p_entity_type = 'note' THEN
    SELECT n.created_by INTO v_owner FROM public.notes n
      WHERE n.id = p_entity_id AND n.workspace_id = p_workspace_id AND n.deleted_at IS NULL;
  END IF;

  -- notify_user_ids = (owner ∪ prior participants) − the actor. De-duped; TEXT
  -- ids to match the predicate's `@> jsonb_build_array(auth.uid()::text)`.
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
  ) s
  WHERE s.uid IS DISTINCT FROM auth.uid();

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
$$;
