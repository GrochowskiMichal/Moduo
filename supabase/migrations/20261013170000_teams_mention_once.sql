-- TV-D13 follow-up · @Team in a comment reaches each person once
-- (specs/tasks-v3.md §13 "`@Team` in a comment · One notice each"; decisions
-- in docs/decisions/tasks.md "TV-D13").
--
--   * comments_op_mention_teams (live body after 20261013150000) also counts
--     the comment's participant notice as having reached someone: the item's
--     creator, assignee or an earlier commenter who is in a named team already
--     has "commented on" for this comment, so the team notice skips them.
--
-- Apply after 20261013150000 (and TV-D15's 20261013160000; it shares nothing
-- with it). Verified by supabase/tests/teams_routing.test.sql.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.comments_op_mention_teams(uuid, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013150000_teams_routing before this migration.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.comments_op_mention_teams(p_comment_id uuid, p_team_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.comments;
  v_actor uuid := auth.uid();
  v_teams uuid[];
  v_names jsonb;
  v_before jsonb;
  v_people jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.comments x WHERE x.id = p_comment_id;
  IF NOT FOUND OR c.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
  IF c.author_kind <> 'user' OR c.created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only its author can mention a team in a comment.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.spine_op__guard(c.workspace_id);
  IF cardinality(coalesce(p_team_ids, '{}'::uuid[])) > 20 THEN
    RAISE EXCEPTION 'A comment can mention up to 20 teams.' USING ERRCODE = '22023';
  END IF;

  -- Live teams of this workspace this comment hasn't told yet.
  SELECT array_agg(x.id ORDER BY lower(x.name), x.id), jsonb_agg(x.name ORDER BY lower(x.name), x.id)
    INTO v_teams, v_names
  FROM public.teams x
  WHERE x.id = ANY (coalesce(p_team_ids, '{}'::uuid[]))
    AND x.workspace_id = c.workspace_id AND x.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.module_activity a
      WHERE a.workspace_id = c.workspace_id AND a.module = 'comments'
        AND a.entity_type = c.entity_type AND a.entity_id = c.entity_id
        AND a.op = 'comments.team_mention'
        AND a.payload ->> 'comment_id' = c.id::text
        AND (a.payload -> 'team_ids') @> jsonb_build_array(x.id::text));
  IF v_teams IS NULL THEN
    RETURN;
  END IF;

  -- Everyone this comment already reached: named in person, told as a
  -- participant (the item's creator, assignee or earlier commenters), or
  -- through a team before.
  SELECT coalesce(jsonb_agg(DISTINCT m.uid), '[]'::jsonb) INTO v_before
  FROM public.module_activity a,
       LATERAL jsonb_array_elements_text(
         coalesce(a.payload -> 'mentioned_user_ids', '[]'::jsonb)
         || coalesce(a.payload -> 'notify_user_ids', '[]'::jsonb)) AS m(uid)
  WHERE a.workspace_id = c.workspace_id AND a.module = 'comments'
    AND a.entity_type = c.entity_type AND a.entity_id = c.entity_id
    AND a.op IN ('comments.add', 'comments.edit', 'comments.team_mention')
    AND a.payload ->> 'comment_id' = c.id::text;

  SELECT coalesce(jsonb_agg(DISTINCT m.user_id::text), '[]'::jsonb) INTO v_people
  FROM public.team_members m
  WHERE m.team_id = ANY (v_teams) AND m.deleted_at IS NULL
    AND m.user_id <> v_actor
    AND NOT (v_before @> jsonb_build_array(m.user_id::text))
    AND public.comments__item_visible_to(c.workspace_id, c.entity_type, c.entity_id, m.user_id);

  PERFORM public.module_activity_log(
    c.workspace_id, 'comments', c.entity_type, c.entity_id, 'comments.team_mention',
    jsonb_build_object(
      'comment_id', c.id,
      -- A short excerpt for the notification card, never the full body.
      'excerpt', left(c.body, 140),
      'team_ids', to_jsonb(v_teams),
      'team_names', v_names,
      'mentioned_user_ids', v_people));
END;
$function$;

REVOKE ALL ON FUNCTION public.comments_op_mention_teams(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comments_op_mention_teams(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.comments_op_mention_teams(uuid, uuid[]) TO authenticated, service_role;
