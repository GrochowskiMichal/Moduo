ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS share_scope text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS share_permission text NOT NULL DEFAULT 'view';

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_share_scope_check,
  ADD CONSTRAINT notes_share_scope_check
    CHECK (share_scope = ANY (ARRAY['private'::text, 'workspace'::text, 'selected'::text]));

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_share_permission_check,
  ADD CONSTRAINT notes_share_permission_check
    CHECK (share_permission = ANY (ARRAY['view'::text, 'edit'::text]));

UPDATE public.notes n
SET created_by = w.owner_id
FROM public.workspaces w
WHERE n.workspace_id = w.id
  AND n.created_by IS NULL;

CREATE TABLE IF NOT EXISTS public.note_shares (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  note_id uuid NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'view',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_shares_permission_check CHECK (permission = ANY (ARRAY['view'::text, 'edit'::text])),
  CONSTRAINT note_shares_unique_user UNIQUE (note_id, user_id)
);

ALTER TABLE public.note_shares ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS notes_workspace_share_scope_idx
  ON public.notes (workspace_id, share_scope);

CREATE INDEX IF NOT EXISTS notes_created_by_idx
  ON public.notes (created_by);

CREATE INDEX IF NOT EXISTS note_shares_note_id_idx
  ON public.note_shares (note_id);

CREATE INDEX IF NOT EXISTS note_shares_workspace_user_idx
  ON public.note_shares (workspace_id, user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_shares TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_shares TO service_role;

CREATE OR REPLACE FUNCTION public.user_can_read_note(
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

CREATE OR REPLACE FUNCTION public.user_can_edit_note(
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

CREATE OR REPLACE FUNCTION public.user_owns_note(p_note_id uuid)
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

CREATE OR REPLACE FUNCTION public.note_share_workspace_matches_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  note_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO note_workspace_id
  FROM public.notes
  WHERE id = NEW.note_id;

  IF note_workspace_id IS NULL OR note_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'note share workspace must match note workspace';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS note_shares_workspace_matches_note ON public.note_shares;
CREATE TRIGGER note_shares_workspace_matches_note
BEFORE INSERT OR UPDATE ON public.note_shares
FOR EACH ROW
EXECUTE FUNCTION public.note_share_workspace_matches_note();

CREATE OR REPLACE FUNCTION public.notes_share_fields_owner_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
    AND auth.uid() IS NOT NULL
    AND OLD.created_by IS DISTINCT FROM auth.uid()
    AND (
      OLD.share_scope IS DISTINCT FROM NEW.share_scope
      OR OLD.share_permission IS DISTINCT FROM NEW.share_permission
      OR OLD.created_by IS DISTINCT FROM NEW.created_by
      OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    )
  THEN
    RAISE EXCEPTION 'only the note owner can change sharing or ownership';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS notes_share_fields_owner_only ON public.notes;
CREATE TRIGGER notes_share_fields_owner_only
BEFORE UPDATE ON public.notes
FOR EACH ROW
EXECUTE FUNCTION public.notes_share_fields_owner_only();

DROP POLICY IF EXISTS notes_select_member ON public.notes;
DROP POLICY IF EXISTS notes_update_member_write ON public.notes;
DROP POLICY IF EXISTS notes_delete_owner ON public.notes;
DROP POLICY IF EXISTS notes_insert_member ON public.notes;

CREATE POLICY notes_select_access ON public.notes
FOR SELECT
TO authenticated
USING (
  public.user_can_read_note(id, workspace_id, created_by, share_scope)
);

CREATE POLICY notes_insert_member ON public.notes
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND share_scope = 'private'
  AND (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = notes.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.permissions_notes = 'write'
    )
    OR EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = notes.workspace_id
        AND w.owner_id = auth.uid()
    )
  )
);

CREATE POLICY notes_update_access ON public.notes
FOR UPDATE
TO authenticated
USING (
  public.user_can_edit_note(id, workspace_id, created_by, share_scope, share_permission)
)
WITH CHECK (
  public.user_can_edit_note(id, workspace_id, created_by, share_scope, share_permission)
);

CREATE POLICY notes_delete_owner ON public.notes
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

DROP POLICY IF EXISTS note_shares_select_access ON public.note_shares;
DROP POLICY IF EXISTS note_shares_insert_owner ON public.note_shares;
DROP POLICY IF EXISTS note_shares_update_owner ON public.note_shares;
DROP POLICY IF EXISTS note_shares_delete_owner ON public.note_shares;

CREATE POLICY note_shares_select_access ON public.note_shares
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.user_owns_note(note_id)
);

CREATE POLICY note_shares_insert_owner ON public.note_shares
FOR INSERT
TO authenticated
WITH CHECK (
  public.user_owns_note(note_id)
  AND user_id <> auth.uid()
  AND public.user_is_workspace_member(workspace_id)
);

CREATE POLICY note_shares_update_owner ON public.note_shares
FOR UPDATE
TO authenticated
USING (public.user_owns_note(note_id))
WITH CHECK (
  public.user_owns_note(note_id)
  AND user_id <> auth.uid()
);

CREATE POLICY note_shares_delete_owner ON public.note_shares
FOR DELETE
TO authenticated
USING (public.user_owns_note(note_id));
