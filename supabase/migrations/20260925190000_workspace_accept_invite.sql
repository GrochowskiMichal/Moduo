-- Accepting an invite cannot be a client SELECT. workspace_invites SELECT/UPDATE
-- is owner/admin only, so the person who received the link always saw
-- "Invalid or expired invite" even when the row was brand new.

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
  v_role   text;
  v_notes  text;
  v_tasks  text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_token = '' THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  SELECT * INTO v_invite
    FROM public.workspace_invites
   WHERE token = v_token
     AND status = 'pending'
   LIMIT 1;

  IF v_invite.id IS NULL OR v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = v_invite.workspace_id
       AND m.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'You''re already a member of this workspace.';
  END IF;

  -- Never grant owner through an invite. App "editor" is stored as "member".
  v_role := CASE lower(coalesce(v_invite.role, 'member'))
    WHEN 'admin' THEN 'admin'
    WHEN 'viewer' THEN 'viewer'
    WHEN 'member' THEN 'member'
    ELSE 'member'
  END;
  v_notes := CASE lower(coalesce(v_invite.permissions_notes, 'write'))
    WHEN 'view' THEN 'read'
    WHEN 'read' THEN 'read'
    WHEN 'none' THEN 'none'
    ELSE 'write'
  END;
  v_tasks := CASE lower(coalesce(v_invite.permissions_tasks, 'write'))
    WHEN 'view' THEN 'read'
    WHEN 'read' THEN 'read'
    WHEN 'none' THEN 'none'
    ELSE 'write'
  END;

  INSERT INTO public.workspace_members (
    workspace_id, user_id, role, permissions_notes, permissions_tasks
  ) VALUES (
    v_invite.workspace_id, v_caller, v_role, v_notes, v_tasks
  );

  UPDATE public.workspace_invites
     SET status = 'accepted'
   WHERE id = v_invite.id
   RETURNING * INTO v_invite;

  RETURN v_invite;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_op_accept_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_op_accept_invite(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.workspace_op_accept_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_op_accept_invite(text) TO service_role;
