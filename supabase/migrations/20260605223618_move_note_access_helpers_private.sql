CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.user_can_read_note(
  p_note_id uuid,
  p_workspace_id uuid,
  p_created_by uuid,
  p_share_scope text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      p_created_by = auth.uid()
      OR (
        p_share_scope = 'workspace'
        AND (public.user_is_workspace_member(p_workspace_id) OR public.user_is_workspace_owner(p_workspace_id))
      )
      OR (
        p_share_scope = 'selected'
        AND EXISTS (
          SELECT 1
          FROM public.note_shares ns
          WHERE ns.note_id = p_note_id
            AND ns.user_id = auth.uid()
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.user_can_edit_note(
  p_note_id uuid,
  p_workspace_id uuid,
  p_created_by uuid,
  p_share_scope text,
  p_share_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND (
      p_created_by = auth.uid()
      OR (
        p_share_scope = 'workspace'
        AND p_share_permission = 'edit'
        AND (public.user_is_workspace_member(p_workspace_id) OR public.user_is_workspace_owner(p_workspace_id))
      )
      OR (
        p_share_scope = 'selected'
        AND EXISTS (
          SELECT 1
          FROM public.note_shares ns
          WHERE ns.note_id = p_note_id
            AND ns.user_id = auth.uid()
            AND ns.permission = 'edit'
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.user_owns_note(p_note_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.id = p_note_id
      AND n.created_by = auth.uid()
  );
$function$;

DROP POLICY IF EXISTS notes_select_access ON public.notes;
DROP POLICY IF EXISTS notes_update_access ON public.notes;
DROP POLICY IF EXISTS note_shares_select_access ON public.note_shares;
DROP POLICY IF EXISTS note_shares_insert_owner ON public.note_shares;
DROP POLICY IF EXISTS note_shares_update_owner ON public.note_shares;
DROP POLICY IF EXISTS note_shares_delete_owner ON public.note_shares;

CREATE POLICY notes_select_access ON public.notes
FOR SELECT
TO authenticated
USING (
  private.user_can_read_note(id, workspace_id, created_by, share_scope)
);

CREATE POLICY notes_update_access ON public.notes
FOR UPDATE
TO authenticated
USING (
  private.user_can_edit_note(id, workspace_id, created_by, share_scope, share_permission)
)
WITH CHECK (
  private.user_can_edit_note(id, workspace_id, created_by, share_scope, share_permission)
);

CREATE POLICY note_shares_select_access ON public.note_shares
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR private.user_owns_note(note_id)
);

CREATE POLICY note_shares_insert_owner ON public.note_shares
FOR INSERT
TO authenticated
WITH CHECK (
  private.user_owns_note(note_id)
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = note_shares.workspace_id
      AND wm.user_id = note_shares.user_id
  )
);

CREATE POLICY note_shares_update_owner ON public.note_shares
FOR UPDATE
TO authenticated
USING (private.user_owns_note(note_id))
WITH CHECK (
  private.user_owns_note(note_id)
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = note_shares.workspace_id
      AND wm.user_id = note_shares.user_id
  )
);

CREATE POLICY note_shares_delete_owner ON public.note_shares
FOR DELETE
TO authenticated
USING (private.user_owns_note(note_id));

DROP FUNCTION IF EXISTS public.user_can_read_note(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.user_can_edit_note(uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.user_owns_note(uuid);
