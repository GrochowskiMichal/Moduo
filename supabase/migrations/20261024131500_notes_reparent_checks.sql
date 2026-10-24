-- MOD-553 · Moving a note checks the new parent, and moving it into a
-- published page needs the right to publish.
--
-- notes_op_move checked only that the new parent existed and that there was
-- no cycle, and perm_enforce_write checks a note's parent only on INSERT. So a
-- member with Edit on a note that follows its parent's sharing (share_mode
-- 'inherit') could move it under any live note, even one they can't open, and
-- the note took on that parent's audience. Under a published page, the
-- anonymous /p/<token> endpoint (notes_public_subtree) then served its body
-- to anyone: no ws.publish, no Full on the note. Published notes' ids are in
-- that endpoint's JSON, so the target was easy to find.
--
-- A BEFORE UPDATE trigger on notes now holds two rules on every path (the op,
-- the MCP connector, a raw UPDATE):
--   * a new parent must be a note of the same workspace you can Edit;
--   * a note that ends up following a parent inside a published tree (moved
--     there while it inherits, or switched to inherit while there) needs
--     ws.publish and Full on the note, the same two rights publishing and
--     changing who has access need on their own.
-- Moving to the top level (parent NULL) is not checked: it narrows access.
-- System work (no actor) and share.bypass pass, as in perm_enforce_write.
--
-- Trashing a note now also takes it off the web: a second trigger clears
-- publish_token and published_at when deleted_at is set, as notes_op_archive
-- already does for archiving. A restored note stays private until someone
-- publishes it again.
--
-- Verified on the local stack by supabase/tests/notes_reparent_checks.test.sql.

-- Whether a note's public page would show what sits under it: the note is a
-- published root, or it follows its parent and that parent is in such a tree.
-- The same chain notes_public_subtree walks down (live, unarchived roots;
-- 'inherit' links).
CREATE OR REPLACE FUNCTION public.notes__in_published_tree(p_note_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := p_note_id;
  v_guard int := 0;
  n record;
BEGIN
  LOOP
    v_guard := v_guard + 1;
    EXIT WHEN v_id IS NULL OR v_guard > 100;
    SELECT parent_id, share_mode, publish_token, published_at, deleted_at, is_archived
      INTO n
    FROM public.notes WHERE id = v_id;
    EXIT WHEN NOT FOUND;
    IF n.deleted_at IS NOT NULL OR coalesce(n.is_archived, false) THEN
      RETURN false;
    END IF;
    IF n.publish_token IS NOT NULL AND n.publish_token <> '' AND n.published_at IS NOT NULL THEN
      RETURN true;
    END IF;
    EXIT WHEN coalesce(n.share_mode, 'custom') <> 'inherit';
    v_id := n.parent_id;
  END LOOP;
  RETURN false;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notes__in_published_tree(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notes__guard_reparent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_moved boolean := NEW.parent_id IS DISTINCT FROM OLD.parent_id;
BEGIN
  IF coalesce(current_setting('share.bypass', true), '') = '1' OR v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_moved THEN
    IF NOT EXISTS (SELECT 1 FROM public.notes p
                   WHERE p.id = NEW.parent_id AND p.workspace_id = NEW.workspace_id)
       OR NOT public.can_access('note', NEW.parent_id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF coalesce(NEW.share_mode, 'custom') = 'inherit'
     AND (v_moved OR coalesce(OLD.share_mode, 'custom') <> 'inherit')
     AND public.notes__in_published_tree(NEW.parent_id) THEN
    IF NOT public.perm_user_has(NEW.workspace_id, v_actor, 'ws.publish') THEN
      RAISE EXCEPTION 'That page is published to the web, and your role can''t publish in this workspace.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access('note', OLD.id, 'full', v_actor) THEN
      RAISE EXCEPTION 'That page is published to the web, and you can''t change who has access to this note.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notes__guard_reparent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notes_guard_reparent ON public.notes;
CREATE TRIGGER notes_guard_reparent
  BEFORE UPDATE OF parent_id, share_mode ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes__guard_reparent();

CREATE OR REPLACE FUNCTION public.notes__unpublish_on_trash()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
     AND (NEW.publish_token IS NOT NULL OR NEW.published_at IS NOT NULL) THEN
    NEW.publish_token := NULL;
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notes__unpublish_on_trash() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notes_unpublish_on_trash ON public.notes;
CREATE TRIGGER notes_unpublish_on_trash
  BEFORE UPDATE OF deleted_at ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes__unpublish_on_trash();

-- Notes trashed before this migration that still carry a token: the public
-- endpoint already refuses a trashed root, so this only stops a restore from
-- putting them back on the web.
UPDATE public.notes
   SET publish_token = NULL, published_at = NULL
 WHERE deleted_at IS NOT NULL
   AND (publish_token IS NOT NULL OR published_at IS NOT NULL);
