-- An invite's sharing settings (share_payload) are fixed once it is sent.
-- share_apply_invite grants them on accept with the inviter's (created_by's)
-- rights, so a signed-in update must not change them: otherwise anyone with
-- ws.invite could edit a colleague's pending invite to hand the invitee
-- resources only that colleague can reach. Same rule as the token, creator
-- and expiry (tx7); server SQL (no signed-in person) still can.
-- The rest of the function is unchanged from 20261015153935_tx7_workspace_emails.sql.

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
  IF TG_OP = 'UPDATE' AND lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
    -- An invite belongs to its address (S1): re-pointing one would skip B3,
    -- the daily cap and the sign-up allow-list's intent. Invite the new address.
    RAISE EXCEPTION 'An invite''s address can''t be changed. Revoke it and invite the new address.'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND v_actor IS NOT NULL THEN
    -- What the insert set stays set: a signed-in update (the app's role change,
    -- revoke, or accept through the op) can't extend an invite, swap its token,
    -- change what it shares, or bring a used or revoked one back (each would
    -- be an invite the daily cap and B3 never saw). Server SQL (no signed-in
    -- person) still can.
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'An invite can''t move to another workspace. Send a new one.' USING ERRCODE = '42501';
    END IF;
    NEW.token := OLD.token;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.expires_at := OLD.expires_at;
    NEW.share_payload := OLD.share_payload;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'revoked')) THEN
      RAISE EXCEPTION 'This invite can''t be changed back. Send a new one.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(btrim(NEW.email), '') !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Enter an email address like name@company.com.' USING ERRCODE = '22023';
    END IF;
    -- The inviter is whoever is signed in; the row's address, token and times
    -- are the server's (a client-chosen expiry would make a permanent sign-up
    -- allow-list entry and an unrenderable B3).
    IF v_actor IS NOT NULL THEN NEW.created_by := v_actor; END IF;
    NEW.email := lower(btrim(NEW.email));
    NEW.token := encode(extensions.gen_random_bytes(24), 'base64');
    NEW.created_at := now();
    NEW.expires_at := now() + interval '7 days';
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
      RAISE EXCEPTION 'You''ve sent 20 invites today. You can send more tomorrow.';
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
