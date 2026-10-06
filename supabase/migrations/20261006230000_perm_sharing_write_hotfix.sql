-- HOTFIX (2026-10-06): writes broken since 20261006210000_perm_sharing.
--
-- 1) perm_enforce_write read table-specific columns (NEW.body, NEW.parent_id,
--    NEW.owner_id, OLD.author_id, OLD.source_account_id …) inside conditions
--    evaluated for EVERY guarded table. PL/pgSQL resolves every NEW/OLD field
--    named in an expression before evaluating it, so a table without that
--    column errors ("record new has no field body") — task edits, bucket
--    creation and live note saves all failed. Every table-specific read now
--    sits inside an IF on TG_TABLE_NAME.
-- 2) tasks/buckets SELECT rules looked the row up by id (can_access), which
--    can't see a row being inserted, so INSERT … RETURNING (the client's
--    upsert().select()) failed RLS. They now also pass on the row's own
--    columns: a task is visible if its bucket is (task rank ≥ bucket rank), a
--    bucket is visible to its creator while Tasks is visible to them.
-- 3) Deleting the items INSIDE a container needs Edit (spec §1 Layer 2:
--    "Can edit: create, change and delete the items inside"); deleting the
--    container itself (note, bucket, contact) still needs Full.
-- 4) Internal rank helpers were executable by anon.

CREATE OR REPLACE FUNCTION public.perm_enforce_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_module text := TG_ARGV[0];
  v_fixed  text := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1] ELSE NULL END;
  v_ws     uuid;
  v_actor  uuid;
  v_action text;
  v_verb   text;
  v_need   text;
  v_item   text;   -- 'edit' requirement for items inside a container
BEGIN
  v_ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_actor := public.perm_actor_id();

  -- Member-removal archive writes notes the actor can't open. The removal
  -- function sets this for the rest of its transaction only.
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- System work (service role without a key, cron, migrations).
  IF v_actor IS NULL OR v_ws IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF v_fixed IS NOT NULL THEN
    v_action := v_fixed;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
  ELSE
    v_action := 'edit';
  END IF;

  -- Mirrored external calendar events are the owner's own sync, not edits.
  IF TG_TABLE_NAME = 'calendar_events' THEN
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_account_id ELSE NEW.source_account_id END) IS NOT NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- The first channel of a workspace is chat's own bootstrap (#general).
  IF TG_TABLE_NAME = 'chat_channels' THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_channels c
                   WHERE c.workspace_id = v_ws AND c.id IS DISTINCT FROM coalesce(NEW.id, OLD.id)) THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- Soft delete / restore count as delete. Only tables guarded without a
  -- fixed action, all of which have deleted_at (chat_channels is INSERT-only).
  IF TG_OP = 'UPDATE' AND v_fixed IS NULL AND TG_TABLE_NAME <> 'chat_channels' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := 'delete';
    ELSIF TG_TABLE_NAME = 'chat_messages' THEN
      -- Reactions / thread counters live on the message row; only a body
      -- change is an edit.
      IF NEW.body IS NOT DISTINCT FROM OLD.body THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF NOT public.perm_is_owner(v_ws, v_actor)
     AND NOT public.perm_user_has(v_ws, v_actor, v_module || '.' || v_action) THEN
    v_verb := CASE v_action WHEN 'create' THEN 'add' ELSE v_action END;
    RAISE EXCEPTION 'Your role can''t % % in this workspace.', v_verb,
      CASE v_module WHEN 'tasks' THEN 'tasks' WHEN 'notes' THEN 'notes' WHEN 'calendar' THEN 'events'
                    WHEN 'contacts' THEN 'contacts' WHEN 'chat' THEN 'messages' ELSE v_module END
      USING ERRCODE = '42501';
  END IF;

  v_need := CASE WHEN v_action = 'delete' THEN 'full' ELSE 'edit' END;
  v_item := 'edit';

  IF TG_TABLE_NAME = 'notes' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.publish_token IS NULL AND NEW.publish_token IS NOT NULL
         AND NOT public.perm_user_has(v_ws, v_actor, 'ws.publish') THEN
        RAISE EXCEPTION 'Your role can''t publish to the web in this workspace.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.parent_id IS NOT NULL AND NOT public.can_access('note', NEW.parent_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.can_access('note', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'note_updates' THEN
    IF NOT public.can_access('note', coalesce(NEW.note_id, OLD.note_id), 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'buckets' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('bucket', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    ELSE
      -- Tasks are items inside a bucket: Edit covers deleting them.
      IF NOT public.can_access('task', OLD.id, v_item, v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
      END IF;
      -- Moving a task into another bucket needs Edit there too.
      IF TG_OP = 'UPDATE' AND NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
         AND NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.owner_id IS NOT NULL
       AND NOT public.perm_user_has(v_ws, NEW.owner_id, 'tasks.edit') THEN
      RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'contacts' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('contact', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this contact.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'companies' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('company', OLD.id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this company.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'calendar_events' THEN
    -- Events are items inside a calendar: Edit covers deleting them.
    IF TG_OP <> 'INSERT' THEN
      IF OLD.owner_id IS DISTINCT FROM v_actor
         AND (OLD.calendar_ref IS NULL OR NOT public.can_access('calendar', OLD.calendar_ref, v_item, v_actor)) THEN
        RAISE EXCEPTION 'You don''t have access to this event.' USING ERRCODE = '42501';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'chat_messages' THEN
    IF v_action = 'delete' AND TG_OP <> 'INSERT' THEN
      IF OLD.author_id IS DISTINCT FROM v_actor
         AND NOT public.chat_has_cap(v_ws, v_actor, 'delete_others') THEN
        RAISE EXCEPTION 'Your role can''t delete other people''s messages.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$function$;

-- 2) Insert-and-read-back works: the row's own columns can grant visibility.
DROP POLICY IF EXISTS tasks_workspace_access ON public.tasks;
CREATE POLICY tasks_workspace_access ON public.tasks
  FOR ALL TO authenticated
  USING (public.can_access('task', id, 'view') OR public.can_access('bucket', bucket_id, 'view'))
  WITH CHECK (public.can_access('task', id, 'view') OR public.can_access('bucket', bucket_id, 'edit'));

DROP POLICY IF EXISTS buckets_workspace_access ON public.buckets;
CREATE POLICY buckets_workspace_access ON public.buckets
  FOR ALL TO authenticated
  USING (
    public.can_access('bucket', id, 'view')
    OR (owner_id = (SELECT auth.uid()) AND public.perm_can_view(workspace_id, 'tasks'))
  )
  WITH CHECK (owner_id = (SELECT auth.uid()) OR public.can_access('bucket', id, 'edit'));

-- 4) Rank helpers are internal; signed-out callers never need them.
REVOKE EXECUTE ON FUNCTION public.share_direct_rank(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.perm_ceiling_rank(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grant_level_rank(text) FROM anon;
