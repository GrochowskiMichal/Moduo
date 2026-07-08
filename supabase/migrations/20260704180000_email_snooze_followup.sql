-- Email snooze + follow-ups (cloud half) — block EM-6. Covers AC6 (snooze),
-- AC7 (follow-ups), AC16 (notification posture: new mail never notifies; snooze-
-- due + follow-up-due produce quiet grouped notifications riding module_activity).
--
-- The desktop engine owns the IMAP side (move to Moduo/Snoozed + the 60s restore —
-- Rust); this migration is the tissue/notification half:
--   • spine_activity_targets_me gains a `notify_user_ids` branch so a SELF-triggered
--     due reminder notifies the OWNER. The existing mention branch requires
--     actor ≠ me (you don't get notified about your own @mention); a snooze/
--     follow-up you set for YOURSELF is exactly the opposite — you ARE the actor and
--     the target. A distinct, actor-agnostic key keeps the two cases from colliding.
--   • email_op_snooze_due — the restore scheduler calls this when a snooze's time
--     comes: it unsnoozes the ref (is_snoozed→false) AND writes the due activity
--     targeting the owner (→ one notification; the restore is one-shot because
--     unsnoozing clears the due predicate).
--   • email_op_follow_up_due — a follow-up whose deadline passed with no reply. A
--     one-shot guard column (follow_up_notified_at) stops the 60s poll from
--     re-notifying every minute; the follow-up stays "awaiting" until a reply
--     clears it (email_op_clear_follow_up) or it's converted to a task.
--
-- Depends on: 20260626130000 (spine comments/notifications), 20260704170000 (email).

-- ── one-shot follow-up-due guard column ──────────────────────────────────────
-- Set the first time a follow-up fires its due notification; NULL = not yet
-- notified. The FOR-ALL email_refs RLS (op-only writes) already covers it.
ALTER TABLE public.email_refs
  ADD COLUMN IF NOT EXISTS follow_up_notified_at timestamptz;

-- follow_up_at is cleared/reset by follow_up / clear_follow_up; those must also
-- reset the notified guard so a re-armed follow-up can fire again. Patch both.
CREATE OR REPLACE FUNCTION public.email_op_follow_up(
  p_workspace_id uuid,
  p_ref_id uuid,
  p_follow_up_at timestamptz
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);
  IF p_follow_up_at IS NULL THEN
    RAISE EXCEPTION 'A follow-up time is required.';
  END IF;
  UPDATE public.email_refs
    SET follow_up_at = p_follow_up_at,
        follow_up_cleared_at = NULL,
        follow_up_notified_at = NULL, -- re-arm: a fresh deadline can notify again
        updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.follow_up',
    jsonb_build_object('at', p_follow_up_at));
  RETURN r;
END;
$$;

-- ── spine_activity_targets_me: add the self-notification branch ───────────────
-- Backward-compatible: the first disjunct is the unchanged mention rule; the new
-- second disjunct is actor-agnostic and keys on `notify_user_ids` (written only by
-- the email due ops below). Nothing else writes that key, so existing behavior is
-- untouched. STABLE, reads only its argument + auth.uid().
CREATE OR REPLACE FUNCTION public.spine_activity_targets_me(p_activity public.module_activity)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (
      -- Someone else named me (comment @mention). Not my own action.
      p_activity.actor_id IS DISTINCT FROM auth.uid()
      AND (p_activity.payload -> 'mentioned_user_ids') @> jsonb_build_array(auth.uid()::text)
    ) OR (
      -- A self-notification (snooze-due / follow-up-due): I set it for myself, so I
      -- AM the actor — the actor≠me guard must NOT apply here.
      (p_activity.payload -> 'notify_user_ids') @> jsonb_build_array(auth.uid()::text)
    );
$$;

-- ── email.snooze_due ─────────────────────────────────────────────────────────
-- The restore scheduler calls this when a snooze becomes due (after the desktop
-- has moved the mail back to INBOX): unsnooze the ref + write the owner-targeted
-- due activity. Idempotent — a second call on an already-unsnoozed ref writes no
-- new activity (guarded on is_snoozed).
CREATE OR REPLACE FUNCTION public.email_op_snooze_due(
  p_workspace_id uuid,
  p_ref_id uuid
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);
  IF NOT r.is_snoozed THEN
    RETURN r; -- already restored — idempotent, no duplicate notification
  END IF;
  UPDATE public.email_refs
    SET is_snoozed = false, snooze_until = NULL, updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.snooze_due',
    jsonb_build_object(
      'notify_user_ids', jsonb_build_array(r.owner_id::text),
      'subject', r.subject));
  RETURN r;
END;
$$;

-- ── email.follow_up_due ──────────────────────────────────────────────────────
-- A follow-up whose deadline passed with no reply. One-shot: only fires (and only
-- writes activity) when the ref is still awaiting AND hasn't already notified.
-- Returns NULL when there's nothing to do (not awaiting / already notified) so the
-- caller can skip it. The follow-up itself is NOT cleared — it stays awaiting until
-- a reply clears it or the user converts it to a task.
CREATE OR REPLACE FUNCTION public.email_op_follow_up_due(
  p_workspace_id uuid,
  p_ref_id uuid
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);
  IF r.follow_up_at IS NULL
     OR r.follow_up_cleared_at IS NOT NULL
     OR r.follow_up_notified_at IS NOT NULL THEN
    RETURN NULL; -- not awaiting, or already notified — nothing to do
  END IF;
  UPDATE public.email_refs
    SET follow_up_notified_at = now(), updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.follow_up_due',
    jsonb_build_object(
      'notify_user_ids', jsonb_build_array(r.owner_id::text),
      'subject', r.subject));
  RETURN r;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'email_op_snooze_due(uuid, uuid)',
    'email_op_follow_up_due(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;
