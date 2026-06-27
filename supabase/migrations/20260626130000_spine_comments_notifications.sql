-- Connective-tissue spine — block CT-5: comments + notification/activity
-- generalization. (specs/connective-tissue.md block 5; AC9, AC10, AC4.)
--
-- Two spine-owned, polymorphic capabilities built on CT-1's substrate:
--   1. `comments` — a comment on ANY registered entity (FK into the central
--      `entities` registry). `comments_op_add` writes the comment, ensures the
--      target in the registry, and logs an attributed `module_activity` row. A
--      comment that @-mentions workspace members records their ids in the
--      activity payload — that is what makes a mention a notification.
--   2. Notifications are DERIVED, not stored: a notification is a
--      `module_activity` row that targets the current user (today: a comment
--      mention), overlaid with a per-user `notification_state` (read/unread).
--      `notifications_list` reads them; `notifications_op_mark_read` /
--      `_mark_all_read` upsert the read state. NotificationCenter groups them by
--      target then verb (the pure-TS reducer in src/features/spine/notifications.ts).
--
-- Mirrors the proven Tasks/spine intent-op pattern: SECURITY DEFINER plpgsql,
-- SET search_path=public, permission guard + write + attributed activity in one
-- txn (Pillars 1–4). Reuses spine_op__guard / entities_op_ensure /
-- module_activity_log / tasks_module_can_access_workspace from prior migrations.

-- ── comments ─────────────────────────────────────────────────────────────────
-- Polymorphic: a comment belongs to a `(workspace, entity_type, entity_id)` that
-- FKs the registry (clean cascade-tombstone, no dangling refs). Body is plain
-- text at alpha; mentions of MEMBERS are resolved client-side and passed to the
-- op as user ids (entity @mentions are CT-4's job, not comments').
CREATE TABLE IF NOT EXISTS public.comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  entity_type   text NOT NULL,
  entity_id     uuid NOT NULL,
  body          text NOT NULL DEFAULT '',
  created_by    uuid NOT NULL DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  FOREIGN KEY (workspace_id, entity_type, entity_id)
    REFERENCES public.entities (workspace_id, entity_type, entity_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS comments_entity_idx
  ON public.comments (workspace_id, entity_type, entity_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ── notification_state ───────────────────────────────────────────────────────
-- Per-user read overlay on the derived (module_activity) notification feed. One
-- row per (user, activity) once the user has read it. FK to module_activity so
-- it cascades if the activity row is ever removed.
CREATE TABLE IF NOT EXISTS public.notification_state (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  activity_id   uuid NOT NULL REFERENCES public.module_activity (id) ON DELETE CASCADE,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_id)
);

CREATE INDEX IF NOT EXISTS notification_state_user_idx
  ON public.notification_state (user_id, workspace_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- comments: members read; writes op-only (SECURITY DEFINER bypasses RLS).
-- notification_state: a user reads ONLY their own rows; writes op-only.
ALTER TABLE public.comments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comments_workspace_read ON public.comments;
CREATE POLICY comments_workspace_read ON public.comments
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

DROP POLICY IF EXISTS notification_state_own_read ON public.notification_state;
CREATE POLICY notification_state_own_read ON public.notification_state
  FOR SELECT
  USING (user_id = auth.uid());

-- ── comments.add ─────────────────────────────────────────────────────────────
-- Guard (spine edit permission) + ensure the target in the registry + insert the
-- comment + log an attributed `comments.add` activity row. `p_mentioned_user_ids`
-- (workspace members @-mentioned in the body) are recorded in the activity
-- payload so the notification derivation can target them (AC9). Returns the row.
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

  PERFORM public.module_activity_log(
    p_workspace_id, 'comments', p_entity_type, p_entity_id, 'comments.add',
    jsonb_build_object(
      'comment_id', v_comment.id,
      -- A short excerpt for the notification card — never the full body.
      'excerpt', left(v_body, 140),
      'mentioned_user_ids', v_mentions)
  );
  RETURN v_comment;
END;
$$;

-- ── notifications: the "targets me" predicate ────────────────────────────────
-- A module_activity row notifies the current user when they are explicitly
-- targeted (today: named in a comment's `mentioned_user_ids`) AND they are not
-- the actor (you don't get notified about your own action). Centralized here so
-- the list + mark-all ops share one definition. STABLE, not SECURITY DEFINER —
-- it only reads its argument + auth.uid().
CREATE OR REPLACE FUNCTION public.spine_activity_targets_me(p_activity public.module_activity)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_activity.actor_id IS DISTINCT FROM auth.uid()
     AND (p_activity.payload -> 'mentioned_user_ids') @> jsonb_build_array(auth.uid()::text);
$$;

-- ── notifications.list ───────────────────────────────────────────────────────
-- The derived feed: module_activity rows in the workspace that target me, left-
-- joined with my notification_state. Newest first. SECURITY DEFINER so the
-- payload predicate runs server-side; scoped to workspaces I can access.
-- NOTE: the RETURNS TABLE out-columns share names with module_activity columns —
-- every reference in the body MUST stay table-qualified (ma./ns.) so it resolves
-- to the column, not the out-param. Keep it that way when editing.
CREATE OR REPLACE FUNCTION public.notifications_list(
  p_workspace_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  module text,
  entity_type text,
  entity_id uuid,
  op text,
  actor_type text,
  actor_id uuid,
  actor_label text,
  payload jsonb,
  created_at timestamptz,
  read_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ma.id, ma.workspace_id, ma.module, ma.entity_type, ma.entity_id, ma.op,
         ma.actor_type, ma.actor_id, ma.actor_label, ma.payload, ma.created_at,
         ns.read_at
  FROM public.module_activity ma
  LEFT JOIN public.notification_state ns
    ON ns.activity_id = ma.id AND ns.user_id = auth.uid()
  WHERE ma.workspace_id = p_workspace_id
    AND public.tasks_module_can_access_workspace(p_workspace_id)
    AND public.spine_activity_targets_me(ma)
  ORDER BY ma.created_at DESC
  LIMIT coalesce(p_limit, 50);
$$;

-- ── notifications.mark_read ──────────────────────────────────────────────────
-- Upsert a read mark for one activity row (the user must be a workspace member
-- and actually targeted by it). Idempotent.
CREATE OR REPLACE FUNCTION public.notifications_op_mark_read(
  p_workspace_id uuid,
  p_activity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity public.module_activity;
BEGIN
  IF NOT public.tasks_module_can_access_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'You don''t have access to this workspace.';
  END IF;
  SELECT * INTO v_activity FROM public.module_activity
    WHERE id = p_activity_id AND workspace_id = p_workspace_id;
  IF NOT FOUND OR NOT public.spine_activity_targets_me(v_activity) THEN
    RETURN; -- not a notification for me — quiet no-op
  END IF;

  INSERT INTO public.notification_state (workspace_id, user_id, activity_id, read_at)
  VALUES (p_workspace_id, auth.uid(), p_activity_id, now())
  ON CONFLICT (user_id, activity_id) DO UPDATE
    SET read_at = coalesce(public.notification_state.read_at, now());
END;
$$;

-- ── notifications.mark_all_read ──────────────────────────────────────────────
-- Upsert read marks for every currently-targeting-me, unread activity row in the
-- workspace. One statement.
CREATE OR REPLACE FUNCTION public.notifications_op_mark_all_read(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tasks_module_can_access_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'You don''t have access to this workspace.';
  END IF;

  INSERT INTO public.notification_state (workspace_id, user_id, activity_id, read_at)
  SELECT ma.workspace_id, auth.uid(), ma.id, now()
  FROM public.module_activity ma
  LEFT JOIN public.notification_state ns
    ON ns.activity_id = ma.id AND ns.user_id = auth.uid()
  WHERE ma.workspace_id = p_workspace_id
    AND public.spine_activity_targets_me(ma)
    AND ns.read_at IS NULL
  ON CONFLICT (user_id, activity_id) DO UPDATE
    SET read_at = coalesce(public.notification_state.read_at, now());
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.spine_activity_targets_me(public.module_activity) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.spine_activity_targets_me(public.module_activity) FROM anon;
GRANT EXECUTE ON FUNCTION public.spine_activity_targets_me(public.module_activity) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spine_activity_targets_me(public.module_activity) TO service_role;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'comments_op_add(uuid, text, uuid, text, uuid[], text, text)',
    'notifications_list(uuid, integer)',
    'notifications_op_mark_read(uuid, uuid)',
    'notifications_op_mark_all_read(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;
