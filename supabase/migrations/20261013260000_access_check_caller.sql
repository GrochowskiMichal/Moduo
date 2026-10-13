-- TV-SEC1 · The access check answers only for the caller unless called from
-- a server function (docs/decisions/tasks.md "TV-SEC1").
--
--   * public.can_access(type, id, min) is the form clients and row-level
--     security use: it always answers for the caller (perm_actor_id(): the
--     signed-in person, or an API key's person). It takes no person.
--   * public.can_access(type, id, min, user) holds the rules, re-cut from the
--     live body (TV-D13's task branch, rule 20a, included). Only server code
--     calls it: SECURITY DEFINER functions (as their owner) and the service
--     role. It has no default for `user`, so a three-argument call always
--     means the caller's form.
--   * The policies that call can_access are re-created with their text
--     unchanged, so their three-argument calls bind to the caller's form.
--   * share_direct_rank, perm_ceiling_rank and chat_is_workspace_member are
--     for server functions only (no policy, view or app code calls them).
--   * share_assign_preview (the assign warning) answers to someone who can
--     assign in the project, about someone who works in its workspace.
--
-- Re-runnable: it accepts the TV-D13 body, the earlier draft of this file
-- (a front door over private.can_access) or its own result, and leaves the
-- same state. Takes short exclusive locks on the tables whose policies it
-- re-creates; apply with a lock_timeout. No tables or columns change.
-- Verified on the local stack by supabase/tests/access_check.test.sql.

-- One transaction: the policies are set aside and put back inside it.
BEGIN;

-- ── 0. Preflight ────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_four oid := to_regprocedure('public.can_access(text, uuid, text, uuid)');
  v_private oid := to_regprocedure('private.can_access(text, uuid, text, uuid)');
BEGIN
  IF v_four IS NULL THEN
    RAISE EXCEPTION 'public.can_access(text, uuid, text, uuid) is missing: apply the earlier Tasks v3 migrations first.';
  END IF;
  IF NOT (
    -- the TV-D13 body, or this file's own result
    EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_four AND p.prosecdef AND p.prosrc LIKE '%TV-D13 (20a)%')
    -- the earlier draft of this file
    OR (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_four AND NOT p.prosecdef)
        AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_private AND p.prosrc LIKE '%TV-D13 (20a)%'))
  ) THEN
    RAISE EXCEPTION 'public.can_access is not a body this migration knows: re-cut it from the live body first.';
  END IF;
END
$pre$;

-- ── 1. Set aside the policies that call can_access ──────────────────────────
-- Expected (2026-10-13): attachments.attachments_select,
-- buckets.buckets_workspace_access, calendar_events.calendar_events_owner_read,
-- calendars.calendars_read, companies.companies_workspace_read,
-- contact_group_members.contact_group_members_read,
-- contact_groups.contact_groups_read, contacts.contacts_workspace_read,
-- note_updates.note_updates_workspace_read, notes.notes_workspace_read,
-- project_statuses.project_statuses_read, storage.objects.attachments_object_select,
-- task_completions.task_completions_read, task_relations.task_relations_delete,
-- task_relations.task_relations_insert, task_relations.task_relations_read,
-- tasks.tasks_workspace_access. A different set stops the migration.
DROP TABLE IF EXISTS pg_temp.sec1_policies;
CREATE TEMP TABLE sec1_policies AS
SELECT pol.oid AS old_oid, pol.polrelid, pol.polname,
       pol.polrelid::regclass::text || '.' || pol.polname AS label,
       pg_get_expr(pol.polqual, pol.polrelid) AS qual,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check,
       obj_description(pol.oid, 'pg_policy') AS note,
       format('CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s',
         pol.polname, pol.polrelid::regclass,
         CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
         CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                         WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
         CASE WHEN pol.polroles = '{0}'::oid[] THEN 'PUBLIC'
              ELSE (SELECT string_agg(quote_ident(r.rolname), ', ' ORDER BY r.rolname)
                    FROM pg_roles r WHERE r.oid = ANY (pol.polroles)) END,
         ' USING (' || pg_get_expr(pol.polqual, pol.polrelid) || ')',
         ' WITH CHECK (' || pg_get_expr(pol.polwithcheck, pol.polrelid) || ')') AS create_sql
FROM pg_policy pol
WHERE pol.oid IN (
  SELECT d.objid FROM pg_depend d
  WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass
    AND d.refobjid IN (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                       WHERE p.proname = 'can_access' AND n.nspname IN ('public', 'private')));

DO $set_aside$
DECLARE
  v_expected text[] := ARRAY[
    'attachments.attachments_select', 'buckets.buckets_workspace_access',
    'calendar_events.calendar_events_owner_read', 'calendars.calendars_read',
    'companies.companies_workspace_read', 'contact_group_members.contact_group_members_read',
    'contact_groups.contact_groups_read', 'contacts.contacts_workspace_read',
    'note_updates.note_updates_workspace_read', 'notes.notes_workspace_read',
    'project_statuses.project_statuses_read', 'storage.objects.attachments_object_select',
    'task_completions.task_completions_read', 'task_relations.task_relations_delete',
    'task_relations.task_relations_insert', 'task_relations.task_relations_read',
    'tasks.tasks_workspace_access'];
  v_found text[];
  r record;
BEGIN
  SELECT coalesce(array_agg(label ORDER BY label), '{}') INTO v_found FROM sec1_policies;
  IF NOT (v_found @> v_expected AND v_expected @> v_found) THEN
    RAISE EXCEPTION 'The policies that call can_access differ from the expected set. Unexpected: %. Missing: %.',
      (SELECT array_agg(x) FROM unnest(v_found) x WHERE x <> ALL (v_expected)),
      (SELECT array_agg(x) FROM unnest(v_expected) x WHERE x <> ALL (v_found));
  END IF;
  FOR r IN SELECT * FROM sec1_policies LOOP
    EXECUTE format('DROP POLICY %I ON %s', r.polname, r.polrelid::regclass);
  END LOOP;
END
$set_aside$;

-- ── 2. Replace the functions ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.can_access(text, uuid, text);
DROP FUNCTION IF EXISTS public.can_access(text, uuid, text, uuid);
DROP FUNCTION IF EXISTS private.can_access(text, uuid, text, uuid);
REVOKE USAGE ON SCHEMA private FROM authenticated, service_role;

-- The rules. No default for p_user: server code names the person (or NULL
-- for the caller); clients and policies use the three-argument form.
CREATE FUNCTION public.can_access(p_type text, p_id uuid, p_min text, p_user uuid)
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
      IF public.can_access('bucket', v_bucket, 'full', v_user) THEN v_rank := greatest(v_rank, 4);
      ELSIF public.can_access('bucket', v_bucket, 'edit', v_user) THEN v_rank := greatest(v_rank, 3);
      ELSIF public.can_access('bucket', v_bucket, 'view', v_user) THEN v_rank := greatest(v_rank, 2);
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
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'edit', v_user)
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
        AND public.can_access('contact', c.id, 'view', v_user)
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
      RETURN public.can_access('calendar', v_cal, p_min, v_user);
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

-- The caller's form: for clients, policies and any code asking about the
-- caller. It takes no person.
CREATE FUNCTION public.can_access(p_type text, p_id uuid, p_min text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.can_access(p_type, p_id, p_min, public.perm_actor_id());
END;
$function$;

REVOKE ALL ON FUNCTION public.can_access(text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access(text, uuid, text, uuid) TO postgres, service_role;
REVOKE ALL ON FUNCTION public.can_access(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access(text, uuid, text) TO authenticated, service_role;

-- ── 3. Put the policies back, unchanged ─────────────────────────────────────
DO $put_back$
DECLARE
  r record;
  v_new oid;
BEGIN
  FOR r IN SELECT * FROM sec1_policies LOOP
    EXECUTE r.create_sql;
    SELECT pol.oid INTO v_new FROM pg_policy pol WHERE pol.polrelid = r.polrelid AND pol.polname = r.polname;
    IF r.note IS NOT NULL THEN
      EXECUTE format('COMMENT ON POLICY %I ON %s IS %L', r.polname, r.polrelid::regclass, r.note);
    END IF;
    IF (SELECT pg_get_expr(pol.polqual, pol.polrelid) FROM pg_policy pol WHERE pol.oid = v_new) IS DISTINCT FROM r.qual
       OR (SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) FROM pg_policy pol WHERE pol.oid = v_new) IS DISTINCT FROM r.with_check THEN
      RAISE EXCEPTION 'Policy % did not come back unchanged.', r.label;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass
      AND d.refobjid = 'public.can_access(text, uuid, text, uuid)'::regprocedure
  ) THEN
    RAISE EXCEPTION 'A policy calls the four-argument can_access; policies use the three-argument form.';
  END IF;
END
$put_back$;

DROP TABLE pg_temp.sec1_policies;

-- ── 4. Helpers that answer about a given person: server functions only ─────
REVOKE ALL ON FUNCTION public.share_direct_rank(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.perm_ceiling_rank(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_is_workspace_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_direct_rank(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.perm_ceiling_rank(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_is_workspace_member(uuid, uuid) TO service_role;

-- ── 5. The assign warning ───────────────────────────────────────────────────
-- Re-cut from the live body (PERM-9). It answers to someone who can assign
-- in the project (Edit on it, or on a live task in it), about someone who
-- works in its workspace.
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
  -- caller can see. Someone who can only edit a task in it (a task-level
  -- share) still gets the warning, without the name; anyone else gets nothing.
  v_sees_bucket := coalesce(public.can_access('bucket', p_bucket_id, 'view'), false);
  IF NOT coalesce(public.can_access('bucket', p_bucket_id, 'edit'), false) AND NOT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.bucket_id = p_bucket_id AND t.deleted_at IS NULL
      AND public.can_access('task', t.id, 'edit')
  ) THEN
    RETURN NULL;
  END IF;
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

COMMIT;
