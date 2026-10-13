-- TV-D16 follow-up · every bell notice names its item by id.
-- Local stack only until the release. Re-runnable. Every function is re-cut
-- from its live body by anchored replace.
--
-- A notice outlives its reader's access to what it's about, so none carries
-- the task's title, a note's title or a comment's text any more (20261013268000
-- did this for reminders, team notices and agents' notices). The app names
-- the item through the entity registry and reads a comment's text through
-- the comments' own read policy, both of which answer only while the reader
-- can see it.
--
--   tasks.assigned, tasks.completed           tasks_notify_spine: no title
--   tasks.unblocked                           tasks_notify_spine: no titles;
--                                             the blocker by id (blocker_id)
--   tasks.team_check_back                     tasks__team_check_backs
--   tasks.waiting_resolved                    tasks__waiting_came_in
--   tasks.mentioned                           tasks_op_mention
--   notes.mention                             notes_op_mention
--   comments.add, comments.edit,              comments_op_add, comments_op_edit,
--   comments.team_mention                     comments_op_mention_teams: no excerpt
--
-- The other kinds the notice gate lists (tasks.routed, tasks.handed_back,
-- tasks.agent_status) already carry ids only, plus team and member names.

CREATE FUNCTION pg_temp.notice_recut(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
BEGIN
  IF position(p_old IN v_def) = 0 THEN
    IF position(p_new IN v_def) > 0 THEN
      RETURN; -- re-run
    END IF;
    RAISE EXCEPTION '% isn''t the body this migration expects; redefine it by hand.', p_fn;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$$;

-- ── tasks_notify_spine: assigned, completed, unblocked ─────────────────────

SELECT pg_temp.notice_recut('public.tasks_notify_spine()'::regprocedure,
  E'          ''grouped_into'', v_group,\n          ''title'', NEW.title))',
  E'          ''grouped_into'', v_group))');
SELECT pg_temp.notice_recut('public.tasks_notify_spine()'::regprocedure,
  E'          ''mentioned_user_ids'', jsonb_build_array(NEW.owner_id::text),\n          ''title'', NEW.title));',
  E'          ''mentioned_user_ids'', jsonb_build_array(NEW.owner_id::text)));');
SELECT pg_temp.notice_recut('public.tasks_notify_spine()'::regprocedure,
  E'            ''title'', v_blocked.title,\n            ''blocker_title'', NEW.title));',
  E'            ''blocker_id'', NEW.id));');
SELECT pg_temp.notice_recut('public.tasks_notify_spine()'::regprocedure,
  E'  -- task (the notification carries its title). Not for a repeating task, so a',
  E'  -- task (the notification names it by id). Not for a repeating task, so a');

-- ── The other task notices ──────────────────────────────────────────────────

SELECT pg_temp.notice_recut('public.tasks__team_check_backs(timestamptz, integer)'::regprocedure,
  E'          ''notify_user_ids'', jsonb_build_array(v_to::text),\n          ''title'', t.title,\n',
  E'          ''notify_user_ids'', jsonb_build_array(v_to::text),\n');
SELECT pg_temp.notice_recut('public.tasks__waiting_came_in(public.task_waiting, text)'::regprocedure,
  E'      ''notify_user_ids'', jsonb_build_array(p_entry.created_by::text),\n      ''title'', v_title,\n',
  E'      ''notify_user_ids'', jsonb_build_array(p_entry.created_by::text),\n');
SELECT pg_temp.notice_recut('public.tasks_op_mention(uuid, uuid, uuid[])'::regprocedure,
  E'jsonb_build_object(''mentioned_user_ids'', v_ids, ''title'', t.title, ''where'', ''description'')',
  E'jsonb_build_object(''mentioned_user_ids'', v_ids, ''where'', ''description'')');

-- ── A note's mention ────────────────────────────────────────────────────────

SELECT pg_temp.notice_recut('public.notes_op_mention(uuid, uuid, uuid[])'::regprocedure,
  E'    jsonb_build_object(\n      ''title'', n.title,\n      ''mentioned_user_ids'',',
  E'    jsonb_build_object(\n      ''mentioned_user_ids'',');

-- ── Comments: the comment by id, never its text ─────────────────────────────

SELECT pg_temp.notice_recut('public.comments_op_add(uuid, text, uuid, text, uuid[], text, text)'::regprocedure,
  E'      ''comment_id'', v_comment.id,\n      -- A short excerpt for the notification card — never the full body.\n      ''excerpt'', left(v_body, 140),\n',
  E'      ''comment_id'', v_comment.id,\n');
SELECT pg_temp.notice_recut('public.comments_op_edit(uuid, text, uuid[])'::regprocedure,
  E'      ''comment_id'', v.id,\n      ''excerpt'', left(v_body, 140),\n',
  E'      ''comment_id'', v.id,\n');
SELECT pg_temp.notice_recut('public.comments_op_mention_teams(uuid, uuid[])'::regprocedure,
  E'      ''comment_id'', c.id,\n      -- A short excerpt for the notification card, never the full body.\n      ''excerpt'', left(c.body, 140),\n',
  E'      ''comment_id'', c.id,\n');

DROP FUNCTION pg_temp.notice_recut(regprocedure, text, text);

-- ── Notices written before this ─────────────────────────────────────────────

UPDATE public.module_activity a SET payload = a.payload - 'title'
WHERE a.op IN ('tasks.assigned', 'tasks.completed', 'tasks.team_check_back', 'tasks.waiting_resolved',
               'tasks.mentioned', 'notes.mention')
  AND a.payload ? 'title';
UPDATE public.module_activity a SET payload = a.payload - 'title' - 'blocker_title'
WHERE a.op = 'tasks.unblocked' AND (a.payload ? 'title' OR a.payload ? 'blocker_title');
UPDATE public.module_activity a SET payload = a.payload - 'excerpt'
WHERE a.op IN ('comments.add', 'comments.edit', 'comments.team_mention') AND a.payload ? 'excerpt';
