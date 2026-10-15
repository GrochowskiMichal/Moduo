-- TX-7 · Workspace emails (specs/transactional-email.md T20, AC34–AC39).
--
-- 1. Retire the prod-only invite trigger. `on_workspace_invite_inserted` →
--    `trigger_send_workspace_invite()` posted every new invite to the
--    `send-workspace-invite` function without its secret, so every invite email
--    failed (503) and nobody noticed. No migration ever created either, so this
--    one creates-or-replaces the function (making the file self-contained on
--    any database) and then drops both.
-- 2. B3: a new invite queues one email through the outbox (dedupe key
--    `B3:<invite id>`), from "<Inviter> via Moduo" with replies to the inviter.
--    The inviter is the signed-in caller, never the client-written
--    `created_by`, which the validate trigger now pins to the caller as well.
--    Revoking a pending invite cancels its email if it hasn't gone out yet.
-- 3. An invite only works for the address it was sent to (S1):
--    `workspace_op_accept_invite` refuses any other signed-in address with
--    `invite_email_mismatch`, carrying the masked invited address in HINT
--    (the recipient can't read the invite row) for the join page.
-- 4. At most 20 invites per workspace per 24 hours (S2), checked on every
--    insert whoever makes it. The count is the larger of the invites created
--    in the window (whatever their status, so revoking doesn't free a slot;
--    this one also sees earlier rows of a many-row insert) and the B3 emails
--    queued for the workspace in the window (admins can delete invite rows or
--    edit their `created_at`, but nobody but the server touches the outbox).
--    `created_at` is pinned to now() on insert.
-- 5. B4 when ownership is transferred, to the new owner; B5 when an owner or
--    admin removes someone, to that person. Leaving a workspace yourself is a
--    direct delete of your own membership row (runtime.workspace.leave), so it
--    never reaches workspace_op_remove_member and sends nothing.
--
-- Every email's payload carries the dates it prints (TX-3: a retry must render
-- the same body). Kinds workspace_invite / workspace_owner / workspace_removed
-- are already in email_outbox's CHECK (TX-1/TX-2). Deploy `email-worker` with
-- their templates before applying this (docs/email-runbook.md §TX-7).

-- ---------------------------------------------------------------------------
-- 1. The old trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trigger_send_workspace_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_workspace_invite_inserted ON public.workspace_invites;
DROP FUNCTION IF EXISTS public.trigger_send_workspace_invite();

-- ---------------------------------------------------------------------------
-- Shared: a person's name and address for an email
-- ---------------------------------------------------------------------------

-- {name, email} of a user, read where the emails need them. Name is '' when
-- they never set one (the templates then use the address).
CREATE OR REPLACE FUNCTION public.workspace__email_person(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'name', coalesce(btrim((SELECT p.display_name FROM public.profiles p WHERE p.id = u.id)), ''),
    'email', lower(btrim(u.email))
  )
  FROM auth.users u
  WHERE u.id = p_user AND coalesce(btrim(u.email), '') <> ''
$$;

CREATE OR REPLACE FUNCTION public.workspace__email_time(p_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- ---------------------------------------------------------------------------
-- 2 + 4. Invites: pin who and when, cap per day, queue B3
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS workspace_invites_workspace_created_idx
  ON public.workspace_invites (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS email_outbox_workspace_invite_idx
  ON public.email_outbox ((payload ->> 'workspace_id'), created_at)
  WHERE kind = 'workspace_invite';

CREATE OR REPLACE FUNCTION public.perm_invites_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.workspace_roles;
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The inviter is whoever is signed in; the row's timestamps are the server's.
    IF v_actor IS NOT NULL THEN NEW.created_by := v_actor; END IF;
    NEW.created_at := now();
    -- S2: at most 20 invites per workspace in 24 hours. The lock makes two
    -- invites sent at once count each other.
    PERFORM pg_advisory_xact_lock(hashtextextended('workspace_invites:' || NEW.workspace_id::text, 0));
    IF greatest(
         (SELECT count(*) FROM public.workspace_invites i
           WHERE i.workspace_id = NEW.workspace_id
             AND i.created_at > now() - interval '24 hours'),
         (SELECT count(*) FROM public.email_outbox o
           WHERE o.kind = 'workspace_invite'
             AND o.payload ->> 'workspace_id' = NEW.workspace_id::text
             AND o.created_at > now() - interval '24 hours')
       ) >= 20 THEN
      RAISE EXCEPTION 'You''ve sent 20 invites today. You can send more tomorrow.'
        USING ERRCODE = 'P0001', HINT = 'invite_daily_limit';
    END IF;
  END IF;
  IF NEW.role_id IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.role IS DISTINCT FROM OLD.role) THEN
    NEW.role_id := public.perm_system_role_id(NEW.workspace_id, NEW.role);
  END IF;
  SELECT * INTO r FROM public.workspace_roles WHERE id = NEW.role_id;
  IF r.id IS NULL OR r.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'That role doesn''t belong to this workspace.';
  END IF;
  -- Only checked when the role is being set (status-only updates like accept
  -- or revoke don't re-validate).
  IF v_actor IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND NOT public.perm_can_grant(NEW.workspace_id, v_actor, r.permissions) THEN
    RAISE EXCEPTION 'You can''t invite someone as % — it has permissions you don''t have.', r.name
      USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND NOT public.perm_is_owner(NEW.workspace_id, v_actor)
     AND (r.permissions && ARRAY['ws.manage_members', 'ws.manage_roles']) THEN
    RAISE EXCEPTION 'Only the owner can invite someone with member or role management.'
      USING ERRCODE = '42501';
  END IF;
  -- Invites keep the app vocabulary (editor, not member): builds ≤ 1.0.9 read
  -- this column straight into their role badges.
  NEW.role := CASE public.perm_role_tier(r) WHEN 'member' THEN 'editor' ELSE public.perm_role_tier(r) END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_invites__enqueue_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inviter jsonb;
  v_workspace text;
  v_role public.workspace_roles;
BEGIN
  -- Revoking stops a B3 that hasn't gone out yet.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' AND NEW.status = 'revoked' THEN
      PERFORM public.email_cancel('B3:' || NEW.id::text);
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN RETURN NULL; END IF;
  v_inviter := public.workspace__email_person(coalesce(auth.uid(), NEW.created_by));
  IF v_inviter IS NULL THEN
    RAISE NOTICE 'workspace invite %: no inviter address, no email', NEW.id;
    RETURN NULL;
  END IF;
  SELECT w.name INTO v_workspace FROM public.workspaces w WHERE w.id = NEW.workspace_id;
  SELECT * INTO v_role FROM public.workspace_roles r WHERE r.id = NEW.role_id;

  PERFORM public.email_enqueue(
    'workspace_invite',
    NEW.email,
    NULL,
    jsonb_build_object(
      'invite_id', NEW.id,
      'workspace_id', NEW.workspace_id,
      'email', lower(btrim(NEW.email)),
      'workspace_name', coalesce(nullif(btrim(v_workspace), ''), 'a workspace'),
      'inviter_name', v_inviter ->> 'name',
      'inviter_email', v_inviter ->> 'email',
      'role_name', coalesce(v_role.name, ''),
      'role_key', v_role.system_key,
      'expires_at', public.workspace__email_time(NEW.expires_at),
      'token', NEW.token
    ),
    'B3:' || NEW.id::text,
    NULL
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS workspace_invites_enqueue_email ON public.workspace_invites;
CREATE TRIGGER workspace_invites_enqueue_email
  AFTER INSERT OR UPDATE OF status ON public.workspace_invites
  FOR EACH ROW EXECUTE FUNCTION public.workspace_invites__enqueue_email();

-- ---------------------------------------------------------------------------
-- 3. Accept only for the invited address
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workspace_op_accept_invite(p_token text)
RETURNS public.workspace_invites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_invite public.workspace_invites;
  v_token  text := replace(btrim(coalesce(p_token, '')), ' ', '+');
  v_role_id uuid;
  v_caller_email text;
  v_invited text;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_token = '' THEN RAISE EXCEPTION 'Invalid or expired invite'; END IF;
  SELECT * INTO v_invite FROM public.workspace_invites
   WHERE token = v_token AND status = 'pending' LIMIT 1;
  IF v_invite.id IS NULL OR v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;
  -- S1: the invite works for its own address only. The HINT is that address
  -- masked (t•••@becker.studio), for the join page.
  SELECT lower(btrim(u.email)) INTO v_caller_email FROM auth.users u WHERE u.id = v_caller;
  v_invited := lower(btrim(v_invite.email));
  IF v_caller_email IS DISTINCT FROM v_invited THEN
    RAISE EXCEPTION 'invite_email_mismatch'
      USING HINT = left(split_part(v_invited, '@', 1), 1) || '•••@'
                   || substring(v_invited FROM position('@' IN v_invited) + 1);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = v_invite.workspace_id AND m.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'You''re already a member of this workspace.';
  END IF;
  v_role_id := coalesce(
    (SELECT r.id FROM public.workspace_roles r
      WHERE r.id = v_invite.role_id AND r.workspace_id = v_invite.workspace_id),
    public.perm_system_role_id(v_invite.workspace_id,
      CASE lower(coalesce(v_invite.role, 'member')) WHEN 'admin' THEN 'admin' WHEN 'viewer' THEN 'viewer' ELSE 'member' END));
  INSERT INTO public.workspace_members
    (workspace_id, user_id, role, role_id, overrides, permissions_notes, permissions_tasks)
  VALUES (
    v_invite.workspace_id, v_caller, 'member', v_role_id,
    CASE WHEN (SELECT read_only FROM public.workspace_roles WHERE id = v_role_id) THEN '{}'::jsonb
         ELSE public.perm_legacy_overrides(v_invite.permissions_notes, v_invite.permissions_tasks) END,
    'write', 'write');
  PERFORM public.share_apply_invite(v_invite.id, v_caller);
  UPDATE public.workspace_invites SET status = 'accepted' WHERE id = v_invite.id RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. B4 on transfer, B5 on removal
-- ---------------------------------------------------------------------------

-- B4 / B5 for one event. The key carries the moment (clock_timestamp: now()
-- repeats inside a transaction), so ownership going A → B → A mails each time.
CREATE OR REPLACE FUNCTION public.workspace__queue_member_email(
  p_kind text,
  p_workspace_id uuid,
  p_to_user uuid,
  p_by_user uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_to jsonb := public.workspace__email_person(p_to_user);
  v_by jsonb := public.workspace__email_person(p_by_user);
  v_at timestamptz := clock_timestamp();
  v_workspace text;
BEGIN
  IF v_to IS NULL OR v_by IS NULL THEN RETURN NULL; END IF;
  SELECT w.name INTO v_workspace FROM public.workspaces w WHERE w.id = p_workspace_id;
  RETURN public.email_enqueue(
    p_kind,
    v_to ->> 'email',
    p_to_user,
    jsonb_build_object(
      'workspace_name', coalesce(nullif(btrim(v_workspace), ''), 'a workspace'),
      'by_name', v_by ->> 'name',
      'by_email', v_by ->> 'email',
      'at', public.workspace__email_time(v_at)
    ),
    CASE p_kind WHEN 'workspace_owner' THEN 'B4:' ELSE 'B5:' END
      || p_workspace_id::text || ':' || p_to_user::text || ':'
      || floor(extract(epoch FROM v_at) * 1000)::bigint::text,
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_op_transfer_ownership(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid(); v_workspace_id uuid; v_target_user uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT m.workspace_id, m.user_id INTO v_workspace_id, v_target_user
    FROM public.workspace_members m WHERE m.id = p_member_id;
  IF v_workspace_id IS NULL THEN RAISE EXCEPTION 'member not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = v_workspace_id AND w.owner_id = v_caller AND w.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'only the workspace owner can transfer ownership'; END IF;
  IF v_target_user = v_caller THEN RAISE EXCEPTION 'you already own this workspace'; END IF;
  UPDATE public.workspaces SET owner_id = v_target_user WHERE id = v_workspace_id;
  UPDATE public.workspace_members SET role = 'owner', overrides = '{}'::jsonb WHERE id = p_member_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id, permissions_notes, permissions_tasks)
  VALUES (v_workspace_id, v_caller, 'admin', public.perm_system_role_id(v_workspace_id, 'admin'), 'write', 'write')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = 'admin', role_id = public.perm_system_role_id(v_workspace_id, 'admin'), overrides = '{}'::jsonb;
  -- B4 to the new owner.
  PERFORM public.workspace__queue_member_email('workspace_owner', v_workspace_id, v_target_user, v_caller);
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_op_remove_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  m public.workspace_members;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO m FROM public.workspace_members WHERE id = p_member_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'member not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = m.workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace not found';
  END IF;
  IF public.perm_is_owner(m.workspace_id, m.user_id) THEN
    RAISE EXCEPTION 'cannot remove the workspace owner';
  END IF;
  IF m.user_id = v_actor THEN RAISE EXCEPTION 'use leave to remove yourself'; END IF;
  IF NOT public.perm_can_manage_member(m.workspace_id, v_actor, m.user_id) THEN
    RAISE EXCEPTION 'You can''t remove this person.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.workspace_members WHERE id = p_member_id;
  -- B5 to the person removed (never for leaving yourself: that is refused above).
  PERFORM public.workspace__queue_member_email('workspace_removed', m.workspace_id, m.user_id, v_actor);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The three workspace_op_* and perm_invites_validate keep theirs
-- (CREATE OR REPLACE). The new helpers are internal: REVOKE FROM PUBLIC
-- doesn't cover anon or authenticated on Supabase, so name them.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.workspace__email_person(uuid)',
    'public.workspace__email_time(timestamptz)',
    'public.workspace_invites__enqueue_email()',
    'public.workspace__queue_member_email(text, uuid, uuid, uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$$;
