DROP POLICY IF EXISTS note_shares_insert_owner ON public.note_shares;
DROP POLICY IF EXISTS note_shares_update_owner ON public.note_shares;

CREATE POLICY note_shares_insert_owner ON public.note_shares
FOR INSERT
TO authenticated
WITH CHECK (
  public.user_owns_note(note_id)
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
USING (public.user_owns_note(note_id))
WITH CHECK (
  public.user_owns_note(note_id)
  AND user_id <> auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = note_shares.workspace_id
      AND wm.user_id = note_shares.user_id
  )
);
