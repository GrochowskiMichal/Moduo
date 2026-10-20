-- A published note's public page shows only what publishing shared.
--
-- notes-public (the anonymous /p/<token> endpoint) used to read every live
-- note in the workspace with the service role and return the whole subtree
-- under the published root. Two faults:
--   * a sub-note with its own sharing (share_mode 'custom') went public with
--     its parent, though can_access stops walking up at such a note, so it
--     never follows its parent's sharing;
--   * the read had no limit, so PostgREST's row cap could drop notes in a
--     large workspace.
--
-- notes_public_subtree(token) walks down from the published root in SQL and
-- follows only sub-notes that inherit (share_mode 'inherit'), the same chain
-- can_access walks up. A 'custom' sub-note and everything below it stay out,
-- as do trashed and archived notes and what is below them. It answers one
-- JSON value, so no row cap applies. Server code only (service_role).
--
-- Verified on the local stack by supabase/tests/notes_public_subtree.test.sql.

CREATE OR REPLACE FUNCTION public.notes_public_subtree(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH RECURSIVE root AS (
    SELECT n.id, n.workspace_id
    FROM public.notes n
    WHERE p_token IS NOT NULL AND p_token <> ''
      AND n.publish_token = p_token
      AND n.published_at IS NOT NULL
      AND n.deleted_at IS NULL
      AND NOT n.is_archived
  ),
  tree AS (
    SELECT r.id, NULL::uuid AS parent_id, 0 AS depth, ARRAY[r.id] AS path
    FROM root r
    UNION ALL
    SELECT c.id, c.parent_id, t.depth + 1, t.path || c.id
    FROM tree t
    JOIN public.notes c ON c.parent_id = t.id
    JOIN root r ON c.workspace_id = r.workspace_id
    WHERE c.share_mode = 'inherit'
      AND c.deleted_at IS NULL
      AND NOT c.is_archived
      AND t.depth < 100
      AND NOT c.id = ANY (t.path)
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM root) THEN
    jsonb_build_object(
      'rootId', (SELECT id FROM root),
      'notes', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', n.id,
                 'parentId', t.parent_id,
                 'title', coalesce(n.title, ''),
                 'icon', n.icon,
                 'bodyMd', coalesce(n.body_md, ''),
                 'position', coalesce(n.position, ''),
                 'createdAt', n.created_at
               ) ORDER BY t.depth, n.position, n.created_at, n.id)
        FROM tree t
        JOIN public.notes n ON n.id = t.id
      ), '[]'::jsonb))
  END
$function$;

COMMENT ON FUNCTION public.notes_public_subtree(text) IS
  'A published note and the sub-notes that inherit its sharing, as {rootId, notes}; NULL for an unknown, revoked, trashed or archived root. notes-public only (service_role).';

REVOKE ALL ON FUNCTION public.notes_public_subtree(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes_public_subtree(text) TO service_role;
