-- Notes refresh NR-12: the new Notes becomes the only Notes UI. Nothing in
-- anyone's sidebar should move at the switch.
--
--   1. Inbox. Classic never stored the Inbox; it showed "a root with no live
--      children" there and every other root under Workspace. Since NR-1 the
--      `in_inbox` trigger has marked each new root as a capture, so a classic
--      user's page that grew children is still `in_inbox` and would appear in
--      the new Inbox. File those roots to Pages, which is where classic drew
--      them.
--   2. Favorites. NR-1 turned workspace pins into each member's favorite
--      once; pins set in classic since then never became favorites. Carry them
--      over the same way (a favorite someone already has is left alone).
--
-- Runs once: the marker on `in_inbox`'s comment keeps a manual re-run from
-- filing away a parent someone has since put back in the Inbox on purpose.
-- No updated_at bump (a re-file is not an edit: Recents and Home order by it);
-- with no actor, perm_enforce_write lets the backfill through, as in NR-1.

DO $$
BEGIN
  IF coalesce(col_description('public.notes'::regclass, (
       SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.notes'::regclass AND attname = 'in_inbox'
     )), '') LIKE '%nr12-refiled%' THEN
    RETURN;
  END IF;

  UPDATE public.notes n
     SET in_inbox = false
   WHERE n.in_inbox
     AND n.parent_id IS NULL
     AND n.deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.notes c
        WHERE c.parent_id = n.id
          AND c.deleted_at IS NULL
          AND NOT coalesce(c.is_archived, false));

  INSERT INTO public.note_favorites (workspace_id, user_id, note_id, position, created_at)
  SELECT n.workspace_id, m.user_id, n.id, coalesce(n.position, ''), now()
    FROM public.notes n
    JOIN public.workspace_members m ON m.workspace_id = n.workspace_id
   WHERE coalesce(n.is_pinned, false)
     AND n.deleted_at IS NULL
     AND m.user_id IS NOT NULL
     AND public.can_access('note', n.id, 'view', m.user_id)
  ON CONFLICT (user_id, note_id) DO NOTHING;

  COMMENT ON COLUMN public.notes.in_inbox IS
    'Stored Inbox (NR-1): true for a capture not yet filed. Roots only. nr12-refiled';
END;
$$;
