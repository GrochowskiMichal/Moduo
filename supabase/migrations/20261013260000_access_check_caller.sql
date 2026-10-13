-- TV-SEC1 · The access check answers only for the caller unless a server
-- function asks (docs/decisions/tasks.md "TV-SEC1").
--
--   * public.can_access(type, id, min, user) keeps its signature, its grants
--     and every caller: the row-level security policies, the ops and the
--     server helpers. It is now a thin SECURITY INVOKER front door. Asked by
--     a signed-in client (directly or through a policy), it answers for that
--     client only: a question about anyone else reads false, the same answer
--     as an item that doesn't exist. Asked from inside a server function (one
--     owned by postgres or supabase_admin) or by the service role, it answers
--     for whoever it's asked about, as before. An API key follows its person
--     (the key's calls arrive as the service role and resolve to its maker).
--   * The rules themselves move unchanged into private.can_access, re-cut
--     from the live body (TV-D13's task branch, rule 20a, included). Its own
--     nested checks call it directly. The private schema is not served by
--     the API, so the front door is the only way a client reaches it.
--     A later change to the rules re-cuts private.can_access from its live
--     body; public.can_access stays the front door.
--   * Three server-side helpers that answer about a given person stop being
--     callable by clients: share_direct_rank and perm_ceiling_rank (parts of
--     the access check) and chat_is_workspace_member. Only server functions
--     call them, and still do; no policy, view or app code does.
--   * share_assign_preview (the assign warning) still asks about the person
--     being assigned, now only someone who works in the project's workspace.
--
-- No tables or columns. Verified on the local stack by
-- supabase/tests/access_check.test.sql.

-- ── 0. Preflight ────────────────────────────────────────────────────────────
-- The body moved below is the one TV-D13 left (rule 20a in the task branch).
-- Run after every Tasks v3 migration before this one.
DO $pre$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.can_access(text, uuid, text, uuid)')
      AND p.prosecdef AND p.prosrc LIKE '%TV-D13 (20a)%'
  ) THEN
    RAISE EXCEPTION 'public.can_access is not the body this migration moves: apply the earlier Tasks v3 migrations first.';
  END IF;
END
$pre$;

-- ── 1. The rules, moved unchanged ───────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.can_access(p_type text, p_id uuid, p_min text, p_user uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := coalesce(p_user, public.perm_actor_id());
  v_need int := public.grant_level_rank(p_min);
  v_rank int := 0;
  v_ws uuid;
  v_module text;
  v_id uuid;
  v_parent uuid;
  v_mode text;
  v_creator uuid;
  v_system boolean;
  v_bucket uuid;
  v_cal uuid;
  v_guard int := 0;
  v_unknown boolean;
BEGIN
  IF v_user IS NULL OR p_id IS NULL OR v_need = 0 THEN
    RETURN false;
  END IF;

  IF p_type = 'note' THEN
    v_id := p_id;
    LOOP
      v_guard := v_guard + 1;
      EXIT WHEN v_guard > 100;
      SELECT workspace_id, parent_id, coalesce(share_mode, 'custom'), created_by
        INTO v_ws, v_parent, v_mode, v_creator
      FROM public.notes WHERE id = v_id;
      EXIT WHEN NOT FOUND;
      IF v_creator = v_user THEN v_rank := greatest(v_rank, 4); END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('note', v_id, v_user));
      EXIT WHEN v_mode IS DISTINCT FROM 'inherit' OR v_parent IS NULL;
      v_id := v_parent;
    END LOOP;
    v_module := 'notes';

  ELSIF p_type = 'bucket' THEN
    SELECT workspace_id, owner_id, is_system INTO v_ws, v_creator, v_system
    FROM public.buckets WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_system THEN
      v_rank := CASE WHEN v_creator = v_user THEN 4 ELSE 0 END;
    ELSE
      IF v_creator = v_user THEN v_rank := 4; END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('bucket', p_id, v_user));
    END IF;
    v_module := 'tasks';

  ELSIF p_type = 'task' THEN
    SELECT workspace_id, bucket_id, owner_id, creator_unknown
      INTO v_ws, v_bucket, v_creator, v_unknown
    FROM public.tasks WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    v_rank := public.share_direct_rank('task', p_id, v_user);
    IF v_bucket IS NOT NULL THEN
      -- Inherit the bucket. Call the rank by re-entering for 'full' then scaling
      -- is wrong; read the bucket rank directly via a nested check's grant.
      IF private.can_access('bucket', v_bucket, 'full', v_user) THEN v_rank := greatest(v_rank, 4);
      ELSIF private.can_access('bucket', v_bucket, 'edit', v_user) THEN v_rank := greatest(v_rank, 3);
      ELSIF private.can_access('bucket', v_bucket, 'view', v_user) THEN v_rank := greatest(v_rank, 2);
      END IF;
    END IF;
    -- TV-D13 (20a): a task you made that you handed, unfiled, to someone.
    IF v_rank < 3 AND v_creator = v_user AND NOT coalesce(v_unknown, false) AND v_bucket IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = v_bucket AND b.is_system) THEN
      v_rank := 3;
    END IF;
    v_module := 'tasks';

  ELSIF p_type = 'calendar' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator FROM public.calendars WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('calendar', p_id, v_user));
    v_module := 'calendar';

  ELSIF p_type = 'contact_group' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contact_groups WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact_group', p_id, v_user));
    v_module := 'contacts';

  ELSIF p_type = 'contact' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contacts WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact', p_id, v_user));
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND private.can_access('contact_group', g.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND private.can_access('contact_group', g.id, 'edit', v_user)
    ) THEN
      v_rank := greatest(v_rank, 3);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'company' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.companies WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    IF EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.company_id = p_id AND c.deleted_at IS NULL
        AND private.can_access('contact', c.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'event' THEN
    SELECT workspace_id, owner_id, calendar_ref INTO v_ws, v_creator, v_cal
    FROM public.calendar_events WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN
      v_rank := 4;
      v_module := 'calendar';
    ELSIF v_cal IS NOT NULL THEN
      RETURN private.can_access('calendar', v_cal, p_min, v_user);
    ELSE
      RETURN false;
    END IF;

  ELSE
    RETURN false;
  END IF;

  IF v_ws IS NULL THEN RETURN false; END IF;
  RETURN least(v_rank, public.perm_ceiling_rank(v_ws, v_user, v_module)) >= v_need;
END;
$function$;

REVOKE ALL ON FUNCTION private.can_access(text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access(text, uuid, text, uuid) TO authenticated, service_role;
-- The front door runs as its caller, so a signed-in client's policies need to
-- name the function in this schema. The schema stays off the API.
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ── 2. The front door ───────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: current_user is the immediate caller here, so
-- inside a server function it is that function's owner, and in a client's
-- request (a policy or a direct call) it is the client's role.
CREATE OR REPLACE FUNCTION public.can_access(p_type text, p_id uuid, p_min text, p_user uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_user IS NULL
      OR p_user = auth.uid()
      OR current_user IN ('postgres', 'supabase_admin', 'service_role')
      THEN private.can_access(p_type, p_id, p_min, p_user)
    ELSE false
  END
$function$;

REVOKE ALL ON FUNCTION public.can_access(text, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access(text, uuid, text, uuid) TO authenticated, service_role;

-- ── 3. Helpers that answer about a given person: server functions only ─────
REVOKE ALL ON FUNCTION public.share_direct_rank(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.perm_ceiling_rank(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_is_workspace_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_direct_rank(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.perm_ceiling_rank(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_is_workspace_member(uuid, uuid) TO service_role;

-- ── 4. The assign warning: only about someone who works there ───────────────
-- Re-cut from the live body (PERM-9); the one change is the membership test.
CREATE OR REPLACE FUNCTION public.share_assign_preview(p_bucket_id uuid, p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_person text;
  v_sees_bucket boolean;
BEGIN
  -- The warning quotes the bucket's name, so the name only for a bucket the
  -- caller can see. Someone who only has a task in it (a task-level share)
  -- still gets the warning, without the name; anyone else gets nothing.
  v_sees_bucket := coalesce(public.can_access('bucket', p_bucket_id, 'view'), false);
  IF NOT v_sees_bucket AND NOT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.bucket_id = p_bucket_id AND t.deleted_at IS NULL
      AND public.can_access('task', t.id, 'view')
  ) THEN
    RETURN NULL;
  END IF;
  -- TV-SEC1: only about someone who works in the bucket's workspace.
  IF NOT EXISTS (
    SELECT 1 FROM public.buckets b
    WHERE b.id = p_bucket_id AND public.tasks__is_member(b.workspace_id, p_user_id)
  ) THEN
    RETURN NULL;
  END IF;
  IF public.can_access('bucket', p_bucket_id, 'view', p_user_id) THEN RETURN NULL; END IF;
  IF v_sees_bucket THEN
    SELECT name INTO v_name FROM public.buckets WHERE id = p_bucket_id;
  END IF;
  SELECT coalesce(nullif(display_name, ''), 'They') INTO v_person FROM public.profiles WHERE id = p_user_id;
  RETURN coalesce(v_person, 'They') || ' can''t see "' || coalesce(v_name, 'this bucket') || '" — they''ll only see this task.';
END;
$function$;

REVOKE ALL ON FUNCTION public.share_assign_preview(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_assign_preview(uuid, uuid) TO authenticated, service_role;
