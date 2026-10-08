-- DF-21b — Dismiss a notification (Universal Inbox / "the bell grows up").
--
-- Read state already lives per-user in `notification_state` (read_at). Dismiss is
-- a second, orthogonal per-user mark: a dismissed row leaves the ACTIVE bell feed
-- but stays in history (DF-21c's "See all" modal). States progress unread → read
-- → dismissed; dismiss sets ONLY dismissed_at (never read_at) so Undo restores the
-- row to its exact prior read/unread state, and the unread badge — which counts
-- only the active (non-dismissed) feed — stays symmetric across dismiss/undo.
--
-- Mirrors the CT-5 notification ops (SECURITY DEFINER, membership + targets-me
-- guard, idempotent upsert). additive + graceful-degrade: until this applies, the
-- client reads no `dismissed_at` (→ null → everything active) and the dismiss ops
-- 404 (surfaced as a friendly toast on the user-triggered click), nothing breaks.

ALTER TABLE public.notification_state
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- ── notifications.dismiss ────────────────────────────────────────────────────
-- Mark one activity row dismissed for the current user (member + targeted-by-it).
-- Idempotent; sets dismissed_at only, leaving read_at untouched.
CREATE OR REPLACE FUNCTION public.notifications_op_dismiss(
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

  INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
  VALUES (p_workspace_id, auth.uid(), p_activity_id, now())
  ON CONFLICT (user_id, activity_id) DO UPDATE
    SET dismissed_at = coalesce(public.notification_state.dismissed_at, now());
END;
$$;

-- ── notifications.undismiss ──────────────────────────────────────────────────
-- Clear the dismiss mark for one activity row (the 8s Undo). Restores the row to
-- the active feed in its prior read/unread state. Idempotent.
CREATE OR REPLACE FUNCTION public.notifications_op_undismiss(
  p_workspace_id uuid,
  p_activity_id uuid
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
  UPDATE public.notification_state
    SET dismissed_at = NULL
    WHERE user_id = auth.uid()
      AND activity_id = p_activity_id
      AND workspace_id = p_workspace_id;
END;
$$;

-- ── notifications_list — now returns dismissed_at ────────────────────────────
-- CREATE OR REPLACE can't change a function's output columns, so DROP + CREATE.
-- The bell filters `dismissed_at IS NULL` for its active feed; DF-21c reads the
-- full set (incl. dismissed) for the history modal.
DROP FUNCTION IF EXISTS public.notifications_list(uuid, integer);
CREATE FUNCTION public.notifications_list(
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
  read_at timestamptz,
  dismissed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ma.id, ma.workspace_id, ma.module, ma.entity_type, ma.entity_id, ma.op,
         ma.actor_type, ma.actor_id, ma.actor_label, ma.payload, ma.created_at,
         ns.read_at, ns.dismissed_at
  FROM public.module_activity ma
  LEFT JOIN public.notification_state ns
    ON ns.activity_id = ma.id AND ns.user_id = auth.uid()
  WHERE ma.workspace_id = p_workspace_id
    AND public.tasks_module_can_access_workspace(p_workspace_id)
    AND public.spine_activity_targets_me(ma)
  ORDER BY ma.created_at DESC
  LIMIT coalesce(p_limit, 50);
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- A fresh CREATE FUNCTION defaults to EXECUTE for PUBLIC, so the DROP+CREATE of
-- notifications_list above silently drops CT-5's REVOKE-from-anon, and the two
-- new ops would be PUBLIC-executable. Re-apply the CT-5 lockdown (authenticated
-- only) so anon can't call them (their internal guards already return nothing /
-- no-op for anon, but keep the posture explicit).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'notifications_list(uuid, integer)',
    'notifications_op_dismiss(uuid, uuid)',
    'notifications_op_undismiss(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;
