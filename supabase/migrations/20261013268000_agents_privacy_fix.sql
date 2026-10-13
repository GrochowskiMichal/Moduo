-- TV-D16 follow-up · agents and imports: every read follows the task.
-- Local stack only until the release. Re-runnable. Each function is re-cut
-- from its live body (anchored replace) or, where this block owns it whole,
-- redefined from 20261013220000's body.
--
-- 1. A key's trail label ("Alex · via Claude Desktop") names a key of the
--    workspace the row is in, and nothing for any other key.
-- 2. An agent's bell notice carries its task's id and state, never the task's
--    title or the agent's note: the app names the task through the entity
--    registry, which answers only while the reader can see it.
-- 3. An OS / browser notice (notice_deliveries) is readable by its person,
--    and through Realtime, only while they can see the task it names.
-- 4. A hand-back summary is readable by its person only while they can see
--    the task (its session).
-- 5. imports__summary answers only for the run's own person.

-- ── 1. The trail label names only a key of this workspace ────────────────────

DO $log$
DECLARE
  v_def text := pg_get_functiondef('public.module_activity_log(uuid, text, text, uuid, text, jsonb)'::regprocedure);
  v_old text := E'  LEFT JOIN public.profiles p ON p.id = k.created_by\n  WHERE k.id = v_key;';
  v_new text := E'  LEFT JOIN public.profiles p ON p.id = k.created_by\n  WHERE k.id = v_key AND k.workspace_id = p_workspace_id;';
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'module_activity_log isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, '-- name keeps the key''s name alone.',
    '-- name keeps the key''s name alone; a key of another workspace is never named.');
  EXECUTE v_def;
END;
$log$;

-- ── 2. An agent's notice names its task by id only ───────────────────────────

DO $report$
DECLARE
  v_def text := pg_get_functiondef('public.tasks_op_agent_report(uuid, uuid, jsonb)'::regprocedure);
  v_old text := E'              ''task_id'', t.id,\n              ''title'', t.title,\n              ''state'', v_state,\n              ''note'', v_note,\n';
  v_new text := E'              ''task_id'', t.id,\n              ''state'', v_state,\n';
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    IF position(v_new IN v_def) > 0 THEN
      RETURN; -- re-run
    END IF;
    RAISE EXCEPTION 'tasks_op_agent_report isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def,
    E'    -- On their own Inbox, which only they read (like a reminder): the\n    -- session stays private wherever the task is shared.',
    E'    -- On their own Inbox, which only they read (like a reminder): the\n    -- session stays private wherever the task is shared. The task by id\n    -- only: the app names it while its reader can still see it.');
  EXECUTE v_def;
END;
$report$;

-- Notices written before this carried the title and the note.
UPDATE public.module_activity a SET payload = a.payload - 'title' - 'note'
WHERE a.op = 'tasks.agent_status' AND (a.payload ? 'title' OR a.payload ? 'note');

-- ── 3. A delivery is its person's while they can see its task ───────────────

DO $deliveries$
DECLARE
  v_qual text;
BEGIN
  SELECT p.qual INTO v_qual FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename = 'notice_deliveries' AND p.policyname = 'notice_deliveries_own_read';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'notice_deliveries_own_read isn''t there; redefine the read policy by hand.';
  END IF;
  IF position('tasks__visible' IN v_qual) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF regexp_replace(v_qual, '\s+', '', 'g') <> '(user_id=(SELECTuid()ASuid))' THEN
    RAISE EXCEPTION 'notice_deliveries_own_read isn''t the policy this migration expects (%); redefine it by hand.', v_qual;
  END IF;
  DROP POLICY notice_deliveries_own_read ON public.notice_deliveries;
  CREATE POLICY notice_deliveries_own_read ON public.notice_deliveries
    FOR SELECT TO authenticated
    USING (user_id = (SELECT auth.uid()) AND (task_id IS NULL OR public.tasks__visible(task_id)));
END;
$deliveries$;

-- ── 4. A summary is its person's while they can see the task ────────────────

-- The session's own read policy asks whether its task is visible to the
-- reader, so a summary readable only alongside its session follows the task.
DROP POLICY IF EXISTS agent_session_summaries_own_read ON public.agent_session_summaries;
CREATE POLICY agent_session_summaries_own_read ON public.agent_session_summaries
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         AND EXISTS (SELECT 1 FROM public.agent_sessions s
                     WHERE s.id = agent_session_summaries.session_id));

-- ── 5. A run's summary answers only its person ──────────────────────────────

CREATE OR REPLACE FUNCTION public.imports__summary(i public.imports)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF i.id IS NULL OR i.user_id IS DISTINCT FROM public.perm_actor_id() THEN
    RAISE EXCEPTION 'No import with that id.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'id', i.id,
    'source', i.source,
    'label', i.label,
    'started_at', i.started_at,
    'finished_at', i.finished_at,
    'undone_at', i.undone_at,
    'tasks_created', (SELECT count(*) FROM public.import_rows r
                      WHERE r.import_id = i.id AND r.entity_type = 'task' AND r.action = 'created'
                        AND public.tasks__visible_to(r.entity_id, i.user_id)),
    'tasks_updated', (SELECT count(*) FROM public.import_rows r
                      WHERE r.import_id = i.id AND r.entity_type = 'task' AND r.action = 'updated'
                        AND public.tasks__visible_to(r.entity_id, i.user_id)),
    'projects_created', (SELECT count(*) FROM public.import_rows r
                         WHERE r.import_id = i.id AND r.entity_type = 'bucket'
                           AND public.projects__visible_to(r.entity_id, i.user_id)),
    'sections_created', (SELECT count(*) FROM public.import_rows r
                         JOIN public.sections s ON s.id = r.entity_id
                         WHERE r.import_id = i.id AND r.entity_type = 'section'
                           AND public.projects__visible_to(s.project_id, i.user_id)));
END;
$$;
REVOKE ALL ON FUNCTION public.imports__summary(public.imports) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.imports__summary(public.imports) TO service_role;
