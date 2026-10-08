-- PRIV-2a follow-up (cloud review of GrochowskiMichal/Moduo#251): skip the
-- member search for items nobody but their creator can reach.
--
-- account_erasure_new_owner asks can_access for every member of the workspace,
-- per item. For a big private collection that is items × members checks only
-- to learn that nobody else can see any of it (22.5 s to preview 6,700
-- private items in a 60-member workspace). account_erasure_only_creator spots
-- those items from their own rows: the user created it, there is no grant on
-- it, and none of the other ways can_access lets anyone in. It mirrors
-- can_access's branches (newest body in 20261006210000_perm_sharing.sql), so a
-- new access path there needs a line here too; the probe checks the two agree.
-- When it can't tell, the full search runs as before.

CREATE OR REPLACE FUNCTION public.account_erasure_only_creator(p_type text, p_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_type
    -- A system bucket (an Inbox) is its owner's alone; any other bucket is
    -- reached through its own grants.
    WHEN 'bucket' THEN
      EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = p_id AND b.owner_id = p_user)
      AND (EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = p_id AND b.is_system)
           OR NOT EXISTS (SELECT 1 FROM public.resource_grants g
                          WHERE g.resource_type = 'bucket' AND g.resource_id = p_id))
    -- A note is reached through its own grants, and through its parent's when
    -- it follows its parent (share_mode 'inherit'): those go to the search.
    WHEN 'note' THEN
      NOT EXISTS (SELECT 1 FROM public.resource_grants g
                  WHERE g.resource_type = 'note' AND g.resource_id = p_id)
      AND EXISTS (SELECT 1 FROM public.notes n
                  WHERE n.id = p_id AND n.created_by = p_user
                    AND (coalesce(n.share_mode, 'custom') <> 'inherit' OR n.parent_id IS NULL))
    -- A contact is reached through its own grants and through any group it is in.
    WHEN 'contact' THEN
      EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_id AND c.owner_id = p_user)
      AND NOT EXISTS (SELECT 1 FROM public.resource_grants g
                  WHERE g.resource_type = 'contact' AND g.resource_id = p_id)
      AND NOT EXISTS (SELECT 1 FROM public.contact_group_members gm WHERE gm.contact_id = p_id)
    WHEN 'contact_group' THEN
      EXISTS (SELECT 1 FROM public.contact_groups cg WHERE cg.id = p_id AND cg.owner_id = p_user)
      AND NOT EXISTS (SELECT 1 FROM public.resource_grants g
                  WHERE g.resource_type = 'contact_group' AND g.resource_id = p_id)
    -- A company has no grants of its own; it is seen through its contacts.
    WHEN 'company' THEN
      EXISTS (SELECT 1 FROM public.companies co WHERE co.id = p_id AND co.owner_id = p_user)
      AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.company_id = p_id AND c.deleted_at IS NULL)
    ELSE false
  END
$$;

-- Newest body ← 20261008013000_account_erase_workspace_data.sql, plus the
-- shortcut at the top. CREATE OR REPLACE keeps its grants.
CREATE OR REPLACE FUNCTION public.account_erasure_new_owner(
  p_type text,
  p_id uuid,
  p_workspace_id uuid,
  p_user uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_pick uuid;
BEGIN
  IF public.account_erasure_only_creator(p_type, p_id, p_user) THEN
    RETURN NULL;
  END IF;

  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF v_owner IS NOT NULL AND v_owner <> p_user
     AND public.can_access(p_type, p_id, 'view', v_owner) THEN
    RETURN v_owner;
  END IF;

  SELECT m.user_id INTO v_pick
  FROM public.workspace_members m
  WHERE m.workspace_id = p_workspace_id
    AND m.user_id <> p_user
    AND public.can_access(p_type, p_id, 'view', m.user_id)
  ORDER BY public.account_erasure_rank(p_type, p_id, m.user_id) DESC,
           (SELECT min(g.created_at) FROM public.resource_grants g
             WHERE g.resource_type = p_type AND g.resource_id = p_id
               AND g.subject_type = 'member' AND g.subject_id = m.user_id) ASC NULLS LAST,
           m.joined_at ASC,
           m.user_id
  LIMIT 1;
  RETURN v_pick;
END;
$$;

REVOKE ALL ON FUNCTION public.account_erasure_only_creator(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erasure_only_creator(text, uuid, uuid) TO service_role;
