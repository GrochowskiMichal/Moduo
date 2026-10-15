-- TV-D13 follow-up · review fixes (specs/tasks-v3.md block 28; decisions in
-- docs/decisions/tasks.md "TV-D13").
--
--   * account_erase_workspace_data (live body): a task someone else made that
--     sits in the leaving person's Inbox goes back to its creator (who still
--     sees it there, call 20a), the same as a plain removal does; it used to
--     be taken for private when nobody had a grant on it.
--   * tasks_notify_spine (live body): only a task still to do (To do or In
--     progress) calls the team; a finished one routed or given back doesn't.
--   * tasks_op_update (live body): the status is applied before the
--     assignment (which can hand the task into the assignee's Inbox), and the
--     subtasks a hand-over moved come back with the answer.
--   * teams_member_removed (live body): the hand-back notice says when the
--     person left on their own.
--   * comments_op_mention_teams (live body): its author has to still see the
--     item.
--
-- Apply after 20261013170000, TV-F6's 20261013130000 and TV-D15's
-- 20261013160000 (the erasure is re-cut from the body those two left).
-- Re-runnable. Verified by
-- supabase/tests/teams_routing.test.sql (bun run db:test).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.comments_op_mention_teams(uuid, uuid[])') IS NULL
     OR to_regprocedure('public.teams_member_removed()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013150000 and 20261013170000 before this migration.';
  END IF;
  -- The erasure below is re-cut from the body TV-F6 and TV-D15 left (it
  -- erases focus runs and templates), so their tables must be there.
  IF to_regclass('public.focus_runs') IS NULL OR to_regclass('public.task_templates') IS NULL
     OR to_regclass('public.project_templates') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-F6 (20261013130000) and TV-D15 (20261013160000) before this migration.';
  END IF;
END;
$$;

-- ── 1. Account erasure: a handed-over task goes back to its creator ───────

CREATE OR REPLACE FUNCTION public.account_erase_workspace_data(p_user uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owned uuid[];
  r record;
  v_new uuid;
  v_owner uuid;
  i integer;

  v_note_del uuid[] := '{}';     v_note_keep uuid[] := '{}';     v_note_to uuid[] := '{}';
  v_bucket_del uuid[] := '{}';   v_bucket_keep uuid[] := '{}';   v_bucket_to uuid[] := '{}';
  v_task_del uuid[] := '{}';     v_task_move uuid[] := '{}';     v_task_move_to uuid[] := '{}';
  v_contact_del uuid[] := '{}';  v_contact_keep uuid[] := '{}';  v_contact_to uuid[] := '{}';
  v_group_del uuid[] := '{}';    v_group_keep uuid[] := '{}';    v_group_to uuid[] := '{}';
  v_company_del uuid[] := '{}';  v_company_keep uuid[] := '{}';  v_company_to uuid[] := '{}';
  v_event_del uuid[];
  v_calendar_del uuid[];
  v_set_del uuid[];
  v_account_del uuid[];
  v_email_ref_del uuid[];
  v_email_account_del uuid[];
  v_channel_del uuid[];
  v_manager_channel uuid[] := '{}';
  v_manager_to uuid[] := '{}';
  v_task_unassign integer;
  v_notification_state integer;
  v_api_keys integer;
  v_member_grants integer;
  v_email text;
  v_invites integer;
  v_completions integer;
  v_completed_by integer;
  v_sessions integer;
  v_reminders integer;
  v_templates integer;
  v_push_subscriptions integer;
  v_deliveries integer;
  v_team_members integer;
  v_waiting integer;
  v_leads integer;
  v_focus_runs integer;
  v_bypass text;

  v_keys text[];        -- 'type:id' of every deleted item
  v_id_texts text[];    -- every deleted id, for activity payloads (target_id)
  v_counts jsonb;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'account_erase_workspace_data: p_user is required';
  END IF;

  -- Workspaces the user owns are left to the auth cascade.
  SELECT coalesce(array_agg(w.id), '{}') INTO v_owned
  FROM public.workspaces w WHERE w.owner_id = p_user;

  -- ── Decide, before anything changes (every decision reads today's access) ──

  FOR r IN
    SELECT n.id, n.workspace_id FROM public.notes n
    WHERE n.created_by = p_user AND n.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('note', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_note_del := v_note_del || r.id;
    ELSE
      v_note_keep := v_note_keep || r.id;
      v_note_to := v_note_to || v_new;
    END IF;
  END LOOP;

  -- The Inbox is only ever its owner's, so it always goes.
  FOR r IN
    SELECT b.id, b.workspace_id FROM public.buckets b
    WHERE b.owner_id = p_user AND b.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('bucket', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_bucket_del := v_bucket_del || r.id;
    ELSE
      v_bucket_keep := v_bucket_keep || r.id;
      v_bucket_to := v_bucket_to || v_new;
    END IF;
  END LOOP;

  -- tasks.bucket_id is RESTRICT: every task in a bucket that goes either moves
  -- (someone else can see it, e.g. an assignee's grant) or goes too.
  FOR r IN
    SELECT t.id, t.workspace_id, t.assignee_id, t.owner_id, t.creator_unknown
    FROM public.tasks t WHERE t.bucket_id = ANY (v_bucket_del)
  LOOP
    IF r.assignee_id IS NOT NULL AND r.assignee_id <> p_user
       AND public.can_access('task', r.id, 'view', r.assignee_id) THEN
      -- The teammate it's assigned to keeps it, in their own Inbox.
      v_new := r.assignee_id;
    ELSIF r.owner_id IS NOT NULL AND r.owner_id <> p_user AND NOT coalesce(r.creator_unknown, false)
          AND public.can_access('task', r.id, 'view', r.owner_id) THEN
      -- TV-D13 (20a): a task someone else made and handed into this Inbox
      -- goes back to its creator, who still sees it while it sits here.
      v_new := r.owner_id;
    ELSIF NOT EXISTS (SELECT 1 FROM public.resource_grants g
                      WHERE g.resource_type = 'task' AND g.resource_id = r.id) THEN
      -- can_access gives a task its own grants plus its bucket's access, and
      -- nobody else can see this bucket: without a grant (and no creator who
      -- handed it here) the task is private. (A shortcut, so a big private
      -- bucket doesn't cost a search per task.)
      v_new := NULL;
    ELSE
      v_new := public.account_erasure_new_owner('task', r.id, r.workspace_id, p_user);
    END IF;
    IF v_new IS NULL THEN
      v_task_del := v_task_del || r.id;
    ELSE
      v_task_move := v_task_move || r.id;
      v_task_move_to := v_task_move_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.id, c.workspace_id FROM public.contacts c
    WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_contact_del := v_contact_del || r.id;
    ELSE
      v_contact_keep := v_contact_keep || r.id;
      v_contact_to := v_contact_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT g.id, g.workspace_id FROM public.contact_groups g
    WHERE g.owner_id = p_user AND g.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact_group', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_group_del := v_group_del || r.id;
    ELSE
      v_group_keep := v_group_keep || r.id;
      v_group_to := v_group_to || v_new;
    END IF;
  END LOOP;

  -- A company is visible through any contact the viewer can see that points at
  -- it. Contacts that go are private, so they never made a company visible.
  FOR r IN
    SELECT co.id, co.workspace_id FROM public.companies co
    WHERE co.owner_id = p_user AND co.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('company', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_company_del := v_company_del || r.id;
    ELSE
      v_company_keep := v_company_keep || r.id;
      v_company_to := v_company_to || v_new;
    END IF;
  END LOOP;

  -- Every event is filed in its owner's own calendar, so the user's calendars
  -- would only keep an empty name (integration calendars are often named after
  -- an email address). All of it goes.
  SELECT coalesce(array_agg(e.id), '{}') INTO v_event_del
  FROM public.calendar_events e
  WHERE e.owner_id = p_user AND e.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(c.id), '{}') INTO v_calendar_del
  FROM public.calendars c WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(s.id), '{}') INTO v_set_del
  FROM public.calendar_sets s WHERE s.owner_id = p_user AND s.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(a.id), '{}') INTO v_account_del
  FROM public.calendar_accounts a WHERE a.owner_id = p_user AND a.workspace_id <> ALL (v_owned);

  -- Email has no sharing: everything is the owner's alone.
  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_ref_del
  FROM public.email_refs x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_account_del
  FROM public.email_accounts x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  -- Chat rows outlive membership (someone who leaves keeps their chat_members
  -- and manager rows but can't open the workspace), so only people still in the
  -- workspace count below.
  -- A DM or private channel with nobody else still here in it, e.g. their DM
  -- with themselves.
  SELECT coalesce(array_agg(c.id), '{}') INTO v_channel_del
  FROM public.chat_channels c
  WHERE c.workspace_id <> ALL (v_owned)
    AND (c.kind = 'dm' OR c.is_private)
    AND EXISTS (SELECT 1 FROM public.chat_members cm
                WHERE cm.channel_id = c.id AND cm.user_id = p_user)
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_members cm
      WHERE cm.channel_id = c.id AND cm.user_id <> p_user
        AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                     WHERE wm.workspace_id = c.workspace_id AND wm.user_id = cm.user_id)
             OR EXISTS (SELECT 1 FROM public.workspaces w
                        WHERE w.id = c.workspace_id AND w.owner_id = cm.user_id)));

  -- Channels the user managed alone: the workspace owner if they can see the
  -- channel, otherwise the earliest member still here.
  FOR r IN
    SELECT c.id, c.workspace_id, c.is_private
    FROM public.chat_channel_managers m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user
      AND c.workspace_id <> ALL (v_owned)
      AND NOT (c.id = ANY (v_channel_del))
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_channel_managers m2
        WHERE m2.channel_id = c.id AND m2.user_id <> p_user
          AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                       WHERE wm.workspace_id = c.workspace_id AND wm.user_id = m2.user_id)
               OR EXISTS (SELECT 1 FROM public.workspaces w
                          WHERE w.id = c.workspace_id AND w.owner_id = m2.user_id)))
  LOOP
    v_new := NULL;
    SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = r.workspace_id;
    IF v_owner IS NOT NULL AND v_owner <> p_user
       AND (NOT r.is_private OR EXISTS (SELECT 1 FROM public.chat_members cm
                                        WHERE cm.channel_id = r.id AND cm.user_id = v_owner)) THEN
      v_new := v_owner;
    ELSE
      SELECT cm.user_id INTO v_new
      FROM public.chat_members cm
      JOIN public.workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = cm.user_id
      WHERE cm.channel_id = r.id AND cm.user_id <> p_user
      ORDER BY cm.joined_at, cm.user_id
      LIMIT 1;
      IF v_new IS NULL AND NOT r.is_private THEN
        SELECT m.user_id INTO v_new
        FROM public.workspace_members m
        WHERE m.workspace_id = r.workspace_id AND m.user_id <> p_user
        ORDER BY m.joined_at, m.user_id
        LIMIT 1;
      END IF;
    END IF;
    IF v_new IS NOT NULL THEN
      v_manager_channel := v_manager_channel || r.id;
      v_manager_to := v_manager_to || v_new;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_task_unassign
  FROM public.tasks t
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  SELECT count(*) INTO v_notification_state
  FROM public.notification_state s WHERE s.user_id = p_user;

  SELECT count(*) INTO v_api_keys
  FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);

  SELECT count(*) INTO v_member_grants
  FROM public.resource_grants g
  WHERE g.subject_type = 'member' AND g.subject_id = p_user;

  -- Invitations they accepted keep their email address; they have no use once
  -- the person is in (pending ones are the inviter's and stay).
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user;
  SELECT count(*) INTO v_invites
  FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  -- TV-D8: the completions they recorded in other people's workspaces (their
  -- own workspaces' rows go with the workspace).
  SELECT count(*) INTO v_completions
  FROM public.task_completions c
  WHERE c.user_id = p_user AND c.workspace_id <> ALL (v_owned);

  -- TV-D9: who finished which task, in other people's workspaces (the task
  -- stays; the mark is cleared).
  SELECT count(*) INTO v_completed_by
  FROM public.tasks t
  WHERE t.completed_by = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  -- TV-D10: their work sessions, reminders and team memberships, the Waiting
  -- on… entries that name them, and the projects they lead (the project
  -- stays; the lead is cleared), in other people's workspaces.
  SELECT count(*) INTO v_sessions
  FROM public.task_sessions s WHERE s.user_id = p_user AND s.workspace_id <> ALL (v_owned);
  SELECT (SELECT count(*) FROM public.task_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned))
       + (SELECT count(*) FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned))
    INTO v_templates;
  SELECT count(*) INTO v_reminders
  FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_push_subscriptions FROM public.push_subscriptions x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_team_members
  FROM public.team_members m WHERE m.user_id = p_user AND m.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_waiting
  FROM public.task_waiting w
  WHERE w.kind = 'person' AND w.ref = p_user AND w.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_leads
  FROM public.buckets b
  WHERE b.lead_id = p_user AND b.workspace_id <> ALL (v_owned) AND NOT (b.id = ANY (v_bucket_del));

  -- TV-F6: their Focus runs in other people's workspaces (leaving a workspace
  -- already takes them, through focus_runs_member_removed).
  SELECT count(*) INTO v_focus_runs
  FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);

  v_counts := jsonb_build_object(
    'preview', p_preview IS NOT FALSE,
    'notes_deleted', cardinality(v_note_del),
    'notes_handed_over', cardinality(v_note_keep),
    'buckets_deleted', cardinality(v_bucket_del),
    'buckets_handed_over', cardinality(v_bucket_keep),
    'tasks_deleted', cardinality(v_task_del),
    'tasks_moved', cardinality(v_task_move),
    'tasks_unassigned', v_task_unassign,
    'contacts_deleted', cardinality(v_contact_del),
    'contacts_handed_over', cardinality(v_contact_keep),
    'contact_groups_deleted', cardinality(v_group_del),
    'contact_groups_handed_over', cardinality(v_group_keep),
    'companies_deleted', cardinality(v_company_del),
    'companies_handed_over', cardinality(v_company_keep),
    'events_deleted', cardinality(v_event_del),
    'calendars_deleted', cardinality(v_calendar_del),
    'calendar_sets_deleted', cardinality(v_set_del),
    'calendar_accounts_deleted', cardinality(v_account_del),
    'email_refs_deleted', cardinality(v_email_ref_del),
    'email_accounts_deleted', cardinality(v_email_account_del),
    'chat_channels_deleted', cardinality(v_channel_del),
    'chat_managers_handed_over', cardinality(v_manager_channel),
    'notification_state_deleted', v_notification_state,
    'api_keys_deleted', v_api_keys,
    'member_grants_deleted', v_member_grants,
    'invites_deleted', v_invites,
    'task_completions_deleted', v_completions,
    'tasks_completed_by_cleared', v_completed_by,
    'task_sessions_deleted', v_sessions,
    'task_reminders_deleted', v_reminders,
    'templates_deleted', v_templates,
    'push_subscriptions_deleted', v_push_subscriptions,
    'notice_deliveries_deleted', v_deliveries,
    'team_memberships_deleted', v_team_members,
    'waiting_entries_deleted', v_waiting,
    'project_leads_cleared', v_leads,
    'focus_runs_deleted', v_focus_runs
  );

  -- Only an explicit false deletes; NULL previews like the default.
  IF p_preview IS NOT FALSE THEN
    RETURN v_counts;
  END IF;

  -- ── Apply ──────────────────────────────────────────────────────────────────

  -- Restored before returning, so a caller's later statements aren't bypassed.
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);

  -- 1. Shared items get their new owner.
  UPDATE public.notes n SET created_by = x.to_user
  FROM unnest(v_note_keep, v_note_to) AS x(id, to_user) WHERE n.id = x.id;
  UPDATE public.buckets b SET owner_id = x.to_user
  FROM unnest(v_bucket_keep, v_bucket_to) AS x(id, to_user) WHERE b.id = x.id;
  UPDATE public.contacts c SET owner_id = x.to_user
  FROM unnest(v_contact_keep, v_contact_to) AS x(id, to_user) WHERE c.id = x.id;
  UPDATE public.contact_groups g SET owner_id = x.to_user
  FROM unnest(v_group_keep, v_group_to) AS x(id, to_user) WHERE g.id = x.id;
  UPDATE public.companies co SET owner_id = x.to_user
  FROM unnest(v_company_keep, v_company_to) AS x(id, to_user) WHERE co.id = x.id;

  -- 2. Shared tasks leave the buckets that go, into their new owner's Inbox.
  FOR i IN 1 .. cardinality(v_task_move) LOOP
    UPDATE public.tasks t
    SET bucket_id = public.account_erasure_inbox(t.workspace_id, v_task_move_to[i])
    WHERE t.id = v_task_move[i];
  END LOOP;

  -- 3. Tasks assigned to the user are unassigned (the moved ones included).
  UPDATE public.tasks t SET assignee_id = NULL
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  -- 3b. Who completed what (TV-D8), in workspaces they don't own.
  DELETE FROM public.task_completions c
  WHERE c.user_id = p_user AND c.workspace_id <> ALL (v_owned);

  -- 3c. Who finished which task (TV-D9), in workspaces they don't own.
  UPDATE public.tasks t SET completed_by = NULL
  WHERE t.completed_by = p_user AND t.workspace_id <> ALL (v_owned);

  -- 3d. TV-D10: sessions, reminders, team memberships, Waiting on… them, the
  --     projects they lead, and their name on what they made, in workspaces
  --     they don't own.
  DELETE FROM public.task_sessions s WHERE s.user_id = p_user AND s.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.push_subscriptions x WHERE x.user_id = p_user;
  DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;
  DELETE FROM public.team_members m WHERE m.user_id = p_user AND m.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_waiting w
  WHERE w.kind = 'person' AND w.ref = p_user AND w.workspace_id <> ALL (v_owned);
  UPDATE public.task_waiting w SET created_by = NULL
  WHERE w.created_by = p_user AND w.workspace_id <> ALL (v_owned);
  UPDATE public.teams x SET created_by = NULL
  WHERE x.created_by = p_user AND x.workspace_id <> ALL (v_owned);
  UPDATE public.buckets b SET lead_id = NULL
  WHERE b.lead_id = p_user AND b.workspace_id <> ALL (v_owned);

  -- 3e. TV-F6: their Focus runs, in workspaces they don't own.
  DELETE FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);

  -- 4. Chat: new managers first, then the user's manager rows, then channels
  --    with nobody else in them (members and messages cascade).
  INSERT INTO public.chat_channel_managers (channel_id, user_id)
  SELECT x.channel_id, x.user_id FROM unnest(v_manager_channel, v_manager_to) AS x(channel_id, user_id)
  ON CONFLICT DO NOTHING;
  DELETE FROM public.chat_channel_managers m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND m.user_id = p_user AND c.workspace_id <> ALL (v_owned);
  DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);

  -- 5. What points at the deleted items without a foreign key, addressed as
  --    'type:id' in every type the spine (perm_can_see_entity), activity and
  --    grants use for them.
  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT 'note:' || x AS k FROM unnest(v_note_del) AS x
    UNION ALL SELECT 'bucket:' || x FROM unnest(v_bucket_del) AS x
    UNION ALL SELECT 'task:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'task_project:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'contact:' || x FROM unnest(v_contact_del) AS x
    UNION ALL SELECT 'contact_group:' || x FROM unnest(v_group_del) AS x
    UNION ALL SELECT 'company:' || x FROM unnest(v_company_del) AS x
    UNION ALL SELECT 'event:' || x FROM unnest(v_event_del) AS x
    UNION ALL SELECT 'calendar:' || x FROM unnest(v_calendar_del) AS x
    UNION ALL SELECT 'calendar_set:' || x FROM unnest(v_set_del) AS x
    UNION ALL SELECT 'calendar_account:' || x FROM unnest(v_account_del) AS x
    UNION ALL SELECT 'email_thread:' || x FROM unnest(v_email_ref_del) AS x
    UNION ALL SELECT 'email_account:' || x FROM unnest(v_email_account_del) AS x
    UNION ALL SELECT 'chat_channel:' || x FROM unnest(v_channel_del) AS x
  ) s;

  SELECT coalesce(array_agg(split_part(k, ':', 2)), '{}') INTO v_id_texts
  FROM unnest(v_keys) AS k;

  -- Activity rows (notification state cascades), including links-module rows
  -- whose deleted item is only the payload's target.
  DELETE FROM public.module_activity a
  WHERE (a.entity_type || ':' || a.entity_id) = ANY (v_keys)
     OR (a.payload ->> 'target_id') = ANY (v_id_texts);
  -- Activity only the user could read (RLS shows calendar and email activity to
  -- the actor and the item's owner), also for items removed earlier. A calendar
  -- account's entries carry its label, often an email address.
  DELETE FROM public.module_activity a
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user
    AND (a.entity_type IN ('calendar_account', 'email_account', 'email_thread')
         OR (a.entity_type = 'event' AND NOT EXISTS (
               SELECT 1 FROM public.calendar_events e
               WHERE e.id = a.entity_id AND e.owner_id <> p_user)));
  -- The rest of their activity stays, without their name: module_activity_log
  -- copies the actor's display name into actor_label, and the app shows it.
  UPDATE public.module_activity a SET actor_label = NULL
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user AND a.actor_label IS NOT NULL;
  DELETE FROM public.tag_links tl
  WHERE (tl.entity_type || ':' || tl.entity_id) = ANY (v_keys);
  DELETE FROM public.link_suggestion_declines d
  WHERE split_part(d.pair_key, '|', 1) = ANY (v_keys)
     OR split_part(d.pair_key, '|', 2) = ANY (v_keys);
  -- Entities: their links (either end) and every comment on them cascade.
  DELETE FROM public.entities e
  WHERE (e.entity_type || ':' || e.entity_id) = ANY (v_keys);

  -- 6. The items. Children before parents where a foreign key restricts.
  DELETE FROM public.exposed_notes x WHERE x.note_id = ANY (v_note_del::text[]);
  -- note_shares has a foreign key whose delete rule no migration records.
  DELETE FROM public.note_shares s WHERE s.note_id = ANY (v_note_del);
  -- notes.parent_id is SET NULL: a teammate's sub-note under a deleted note
  -- moves to the top level. note_updates cascade.
  DELETE FROM public.notes n WHERE n.id = ANY (v_note_del);

  UPDATE public.slot_bookings b SET contact_id = NULL WHERE b.contact_id = ANY (v_contact_del);
  UPDATE public.slot_bookings b SET calendar_event_id = NULL WHERE b.calendar_event_id = ANY (v_event_del);

  DELETE FROM public.tasks t WHERE t.id = ANY (v_task_del);
  DELETE FROM public.buckets b WHERE b.id = ANY (v_bucket_del);
  -- Time blocks map a slot to a bucket id; drop the slots of buckets that went.
  UPDATE public.task_time_blocks tb
  SET blocks = coalesce((
        SELECT jsonb_object_agg(j.key, j.value)
        FROM jsonb_each(tb.blocks) AS j
        WHERE NOT coalesce((j.value #>> '{}') = ANY (v_bucket_del::text[]), false)
      ), '{}'::jsonb),
      updated_at = now()
  WHERE EXISTS (SELECT 1 FROM jsonb_each(tb.blocks) AS j
                WHERE (j.value #>> '{}') = ANY (v_bucket_del::text[]));
  -- TV-D10: the same in everyone's own time blocks ({workspace: {slot: id}}).
  UPDATE public.user_preferences p
  SET task_time_blocks = (
        SELECT coalesce(jsonb_object_agg(w.key, CASE WHEN jsonb_typeof(w.value) = 'object' THEN coalesce((
                 SELECT jsonb_object_agg(j.key, j.value) FROM jsonb_each(w.value) AS j
                 WHERE NOT coalesce((j.value #>> '{}') = ANY (v_bucket_del::text[]), false)), '{}'::jsonb)
               ELSE w.value END), '{}'::jsonb)
        FROM jsonb_each(p.task_time_blocks) AS w)
  WHERE cardinality(v_bucket_del) > 0
    AND EXISTS (SELECT 1 FROM jsonb_each(p.task_time_blocks) AS w
                CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object'
                                                   THEN w.value ELSE '{}'::jsonb END) AS j
                WHERE (j.value #>> '{}') = ANY (v_bucket_del::text[]));

  -- Group memberships and private notes on contacts cascade; contacts.company_id
  -- is SET NULL.
  DELETE FROM public.contact_groups g WHERE g.id = ANY (v_group_del);
  DELETE FROM public.contacts c WHERE c.id = ANY (v_contact_del);
  DELETE FROM public.companies co WHERE co.id = ANY (v_company_del);

  -- Events before accounts: calendar_events.source_account_id is SET NULL.
  -- Set items cascade; deleting an account also deletes its calendar.
  DELETE FROM public.calendar_events e WHERE e.id = ANY (v_event_del);
  DELETE FROM public.calendar_sets s WHERE s.id = ANY (v_set_del);
  DELETE FROM public.calendars c WHERE c.id = ANY (v_calendar_del);
  DELETE FROM public.calendar_accounts a WHERE a.id = ANY (v_account_del);

  -- email_refs.account_id is SET NULL, so refs go first.
  DELETE FROM public.email_refs x WHERE x.id = ANY (v_email_ref_del);
  DELETE FROM public.email_accounts x WHERE x.id = ANY (v_email_account_del);

  -- 7. Grants on everything that went, every grant to the user, their read
  --    state, the API keys they created (keys stop working without a creator
  --    anyway) and the invitations they accepted.
  DELETE FROM public.resource_grants g
  WHERE (g.resource_type || ':' || g.resource_id) = ANY (v_keys)
     OR (g.subject_type = 'member' AND g.subject_id = p_user);
  DELETE FROM public.notification_state s WHERE s.user_id = p_user;
  DELETE FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);
  DELETE FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN v_counts;
END;
$function$;

-- ── 2. Only a task still to do calls the team ────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_notify_spine()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_blocked RECORD;
  v_actor uuid := public.perm_actor_id();
  v_key uuid := public.module_api_key_id();
  v_assigned boolean := false;
  v_notify boolean;
  v_group uuid;
  v_from uuid;
  v_routed boolean := false;
  v_returned boolean := false;
  v_team_name text;
  v_member uuid;
  v_inbox uuid;
  v_bypass text;
BEGIN
  -- Never notify about a soft-deleted row (a delete is an UPDATE that stamps
  -- deleted_at; it must not read as an assignment or an unblock).
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- System writes (no signed-in user, no API key) notify nobody.
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── assigned-to-you ──────────────────────────────────────────────────────
  -- Every way a task gets an assignee lands here (tasks_op_assign, a create,
  -- an old build's owner_id write), so this is the one place it is logged:
  -- a create for someone else, and every later change, attributed to the
  -- actor ({from, to}). Only someone other than the actor is notified
  -- (mentioned_user_ids): unassigning and taking a task stay out of bells but
  -- in the trail. The actor is compared through perm_actor_id(), so an API
  -- key assigning its own creator doesn't notify. Member removal unassigns
  -- under share.bypass and logs nothing. Wrapped so a notification failure
  -- can never fail the task write.
  IF TG_OP = 'INSERT' THEN
    v_assigned := NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor;
  ELSE
    v_from := OLD.assignee_id;
    v_assigned := NEW.assignee_id IS DISTINCT FROM v_from
                  AND current_setting('share.bypass', true) IS DISTINCT FROM '1';
  END IF;
  IF v_assigned THEN
    BEGIN
      v_notify := NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor;
      v_group := NULL;
      IF v_notify THEN
        -- The open notice of this hour from the same actor (person or key)
        -- to the same person, if there is one.
        SELECT ma.id INTO v_group FROM public.module_activity ma
        WHERE ma.workspace_id = NEW.workspace_id AND ma.module = 'tasks'
          AND ma.op = 'tasks.assigned'
          AND ma.created_at > now() - interval '1 hour'
          AND CASE WHEN auth.uid() IS NOT NULL
                   THEN ma.actor_type = 'user' AND ma.actor_id = auth.uid()
                   ELSE ma.actor_type = 'api_key' AND ma.actor_id = v_key END
          AND (ma.payload -> 'mentioned_user_ids') @> jsonb_build_array(NEW.assignee_id::text)
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_state ns
            WHERE ns.activity_id = ma.id AND ns.user_id = NEW.assignee_id
              AND (ns.read_at IS NOT NULL OR ns.dismissed_at IS NOT NULL))
        ORDER BY ma.created_at DESC, ma.id DESC
        LIMIT 1
        FOR UPDATE;
      END IF;
      IF v_group IS NOT NULL THEN
        UPDATE public.module_activity ma SET payload =
          CASE WHEN ma.payload ->> 'project_id' IS NOT DISTINCT FROM NEW.bucket_id::text
               THEN ma.payload ELSE ma.payload - 'project_id' END
          || jsonb_build_object(
               'count', coalesce((ma.payload ->> 'count')::integer, 1) + 1,
               'task_ids', CASE WHEN jsonb_array_length(coalesce(ma.payload -> 'task_ids', '[]'::jsonb)) < 100
                                THEN coalesce(ma.payload -> 'task_ids', '[]'::jsonb) || jsonb_build_array(NEW.id::text)
                                ELSE ma.payload -> 'task_ids' END)
        WHERE ma.id = v_group;
      END IF;
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.assigned',
        jsonb_strip_nulls(jsonb_build_object(
          'mentioned_user_ids',
            CASE WHEN v_notify AND v_group IS NULL THEN jsonb_build_array(NEW.assignee_id::text) END,
          'task_ids', CASE WHEN v_notify AND v_group IS NULL THEN jsonb_build_array(NEW.id::text) END,
          'project_id', CASE WHEN v_notify AND v_group IS NULL THEN NEW.bucket_id END,
          'grouped_into', v_group,
          'title', NEW.title))
        -- from/to stay in when null (null = Unassigned). "self" is a person
        -- taking the task; an API key assigning its creator reads as an
        -- assignment.
        || jsonb_build_object(
             'from', v_from,
             'to', NEW.assignee_id,
             'self', v_key IS NULL AND NEW.assignee_id IS NOT DISTINCT FROM v_actor));
    EXCEPTION WHEN OTHERS THEN
      -- generation is a side-effect; it must never break completing/editing a task.
      -- Surface a WARNING (does not abort the txn) so a silent failure is debuggable.
      RAISE WARNING 'tasks_notify_spine: assigned notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── unclaimed for your team (TV-D13) ─────────────────────────────────────
  -- Only a task still to do calls the team (a finished one has nothing to take).
  IF NEW.team_id IS NOT NULL AND NEW.assignee_id IS NULL
     AND NEW.status_category IN ('todo', 'in_progress')
     AND current_setting('share.bypass', true) IS DISTINCT FROM '1' THEN
    IF TG_OP = 'INSERT' THEN
      v_routed := true;
    ELSIF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
      v_routed := true;
    ELSIF OLD.assignee_id IS NOT NULL THEN
      v_routed := true;
      v_returned := true;
    END IF;
  END IF;
  IF v_routed THEN
    BEGIN
      SELECT x.name INTO v_team_name FROM public.teams x WHERE x.id = NEW.team_id;
      FOR v_member IN
        SELECT m.user_id FROM public.team_members m
        WHERE m.team_id = NEW.team_id AND m.deleted_at IS NULL
          AND m.user_id IS DISTINCT FROM v_actor
          AND public.tasks__visible_to(NEW.id, m.user_id)
        ORDER BY m.created_at, m.id
      LOOP
        -- Each member's notice is their own, hung on their own Inbox: only
        -- they (and whoever routed) read it, and everything it names is a
        -- task they can see.
        v_bypass := current_setting('share.bypass', true);
        PERFORM set_config('share.bypass', '1', true);
        v_inbox := public.tasks__inbox(NEW.workspace_id, v_member);
        PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
        v_group := NULL;
        SELECT ma.id INTO v_group FROM public.module_activity ma
        WHERE ma.workspace_id = NEW.workspace_id AND ma.module = 'tasks'
          AND ma.op = 'tasks.routed'
          AND ma.entity_type = 'bucket' AND ma.entity_id = v_inbox
          AND ma.created_at > now() - interval '1 hour'
          AND CASE WHEN auth.uid() IS NOT NULL
                   THEN ma.actor_type = 'user' AND ma.actor_id = auth.uid()
                   ELSE ma.actor_type = 'api_key' AND ma.actor_id = v_key END
          AND ma.payload ->> 'team_id' = NEW.team_id::text
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_state ns
            WHERE ns.activity_id = ma.id AND ns.user_id = v_member
              AND (ns.read_at IS NOT NULL OR ns.dismissed_at IS NOT NULL))
        ORDER BY ma.created_at DESC, ma.id DESC
        LIMIT 1
        FOR UPDATE;
        IF v_group IS NOT NULL THEN
          UPDATE public.module_activity ma SET payload =
            (ma.payload - 'returned')
            || jsonb_build_object(
                 'count', coalesce((ma.payload ->> 'count')::integer, 1) + 1,
                 'task_ids', CASE WHEN jsonb_array_length(coalesce(ma.payload -> 'task_ids', '[]'::jsonb)) < 100
                                  THEN coalesce(ma.payload -> 'task_ids', '[]'::jsonb) || jsonb_build_array(NEW.id::text)
                                  ELSE ma.payload -> 'task_ids' END)
          WHERE ma.id = v_group;
        ELSE
          PERFORM public.module_activity_log(
            NEW.workspace_id, 'tasks', 'bucket', v_inbox, 'tasks.routed',
            jsonb_strip_nulls(jsonb_build_object(
              'mentioned_user_ids', jsonb_build_array(v_member::text),
              'task_id', NEW.id,
              'task_ids', jsonb_build_array(NEW.id::text),
              'count', 1,
              'team_id', NEW.team_id,
              'team_name', v_team_name,
              'title', NEW.title,
              'returned', CASE WHEN v_returned THEN true END)));
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks_notify_spine: team notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NULL;
  END IF;

  -- ── completed-by-someone-else ────────────────────────────────────────────
  -- The task just became done, and the person who did it isn't its creator:
  -- tell the creator. Only on the transition, so re-saving a done task can't
  -- notify again; never when the creator is unknown or can no longer see the
  -- task (the notification carries its title). Not for a repeating task, so a
  -- daily chore doesn't ping its creator every day (Maciej, 2026-10-08).
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status = 'done'
     AND (NEW.recurrence IS NULL OR jsonb_typeof(NEW.recurrence) = 'null')
     AND NEW.owner_id IS NOT NULL AND NOT NEW.creator_unknown
     AND NEW.owner_id IS DISTINCT FROM v_actor
     AND public.can_access('task', NEW.id, 'view', NEW.owner_id) THEN
    BEGIN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.completed',
        jsonb_build_object(
          'mentioned_user_ids', jsonb_build_array(NEW.owner_id::text),
          'title', NEW.title));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks_notify_spine: completed notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── blocked-task-unblocked ───────────────────────────────────────────────
  -- This task just CLOSED (open → done/archived). For every task it blocked, if
  -- this was its LAST open blocker, notify that task's assignee, else its
  -- creator. "Open" mirrors the client isOpen set (status NOT IN done/archived).
  -- Only fires for a genuine open→closed transition, so re-saving an
  -- already-done task can't re-notify.
  IF OLD.status NOT IN ('done', 'archived')
     AND NEW.status IN ('done', 'archived') THEN
    BEGIN
      FOR v_blocked IN
        SELECT bt.id AS task_id,
               coalesce(bt.assignee_id,
                        CASE WHEN bt.creator_unknown
                               OR NOT public.can_access('task', bt.id, 'view', bt.owner_id)
                             THEN NULL ELSE bt.owner_id END) AS target_id,
               bt.title AS title
        FROM public.task_relations r
        JOIN public.tasks bt ON bt.id = r.blocked_task_id
        WHERE r.blocker_task_id = NEW.id
          AND r.workspace_id = NEW.workspace_id
          AND bt.deleted_at IS NULL
          -- Only nudge if the freed task is still actionable (not already closed).
          AND bt.status NOT IN ('done', 'archived')
          -- …and no OTHER open blocker remains on it.
          AND NOT EXISTS (
            SELECT 1
            FROM public.task_relations r2
            JOIN public.tasks ob ON ob.id = r2.blocker_task_id
            WHERE r2.blocked_task_id = r.blocked_task_id
              AND r2.blocker_task_id <> NEW.id
              AND ob.deleted_at IS NULL
              AND ob.status NOT IN ('done', 'archived')
          )
      LOOP
        CONTINUE WHEN v_blocked.target_id IS NULL;
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'tasks', 'task', v_blocked.task_id, 'tasks.unblocked',
          jsonb_build_object(
            'notify_user_ids', jsonb_build_array(v_blocked.target_id::text),
            'title', v_blocked.title,
            'blocker_title', NEW.title));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- as above: never let the notification side-effect fail the task write.
      RAISE WARNING 'tasks_notify_spine: unblocked notification failed for blocker %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$function$;

-- ── 3. Status before the assignment; moved subtasks answered ─────────────

CREATE OR REPLACE FUNCTION public.tasks_op_update(p_workspace_id uuid, p_task_id uuid, p_patch jsonb)
 RETURNS SETOF tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  t0 public.tasks;
  c public.tasks;
  v_carried public.tasks[] := '{}';
  v_restore boolean;
  v_delete boolean;
  v_fields text[] := '{}';
  v_payload jsonb := '{}';
  -- Who the trail row names: the person, or the API key.
  v_actor uuid := coalesce(public.module_api_key_id(), public.perm_actor_id());
  v_field text;
  v_bypass text;
  v_due_on date;
  v_set_due_on boolean;
  v_target uuid;
  v_session_flag text;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  PERFORM public.tasks__check_keys(p_patch, ARRAY[
    'title', 'description', 'bucket_id', 'parent_id', 'due_date', 'due_on', 'due_time',
    'scheduled_at', 'duration_minutes', 'recurrence', 'energy_level', 'priority', 'position',
    'status', 'status_id', 'assignee_id', 'deleted_at', 'committed_for', 'commit_order',
    'reschedule_count',
    -- TV-D10
    'section_id', 'team_id', 'estimate_minutes']);

  SELECT * INTO t FROM public.tasks
  WHERE id = p_task_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  v_restore := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null';
  v_delete := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') <> 'null';
  -- A task the caller can't see reads as missing (never answered with, even
  -- for a patch that changes nothing); writes are checked again row by row.
  IF NOT FOUND OR (t.deleted_at IS NOT NULL AND NOT v_restore)
     OR NOT public.can_access('task', t.id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;

  -- Restore first, so the rest of the patch edits a live task.
  IF v_restore AND t.deleted_at IS NOT NULL THEN
    BEGIN
      UPDATE public.tasks SET deleted_at = NULL, updated_at = now()
      WHERE id = t.id RETURNING * INTO t;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'trash_expired' THEN
        RAISE EXCEPTION 'This task was deleted more than 30 days ago, so it can''t be restored.';
      END IF;
      RAISE;
    END;
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.restore', '{}'::jsonb);
  END IF;

  -- TV-D10: routing a task in an Inbox to a team files it into the team's
  -- default project (refused when the team has none).
  IF p_patch ? 'team_id' AND nullif(p_patch ->> 'team_id', '') IS NOT NULL THEN
    v_target := CASE WHEN p_patch ? 'bucket_id' THEN nullif(p_patch ->> 'bucket_id', '')::uuid ELSE t.bucket_id END;
    IF v_target IS NULL OR EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = v_target AND b.is_system) THEN
      p_patch := p_patch || jsonb_build_object('bucket_id',
        public.teams__route_project(p_workspace_id, nullif(p_patch ->> 'team_id', '')::uuid));
    END IF;
  END IF;

  IF p_patch ? 'recurrence' THEN
    PERFORM public.tasks__check_recurrence(public.tasks__json_object(p_patch -> 'recurrence'));
  END IF;
  IF p_patch ? 'bucket_id' THEN
    PERFORM public.tasks__check_bucket(p_workspace_id, nullif(p_patch ->> 'bucket_id', '')::uuid);
  END IF;
  IF p_patch ? 'parent_id' THEN
    PERFORM public.tasks__check_parent(p_workspace_id, nullif(p_patch ->> 'parent_id', '')::uuid);
  END IF;
  -- The due date: due_on leads; a date-only due_date is one too.
  IF p_patch ? 'due_on' THEN
    v_set_due_on := true;
    v_due_on := nullif(p_patch ->> 'due_on', '')::date;
  ELSIF p_patch ? 'due_date' AND public.tasks__date_only(p_patch ->> 'due_date') IS NOT NULL THEN
    v_set_due_on := true;
    v_due_on := public.tasks__date_only(p_patch ->> 'due_date');
  ELSE
    v_set_due_on := false;
  END IF;

  t0 := t;
  IF p_patch ?| ARRAY['title', 'description', 'bucket_id', 'parent_id', 'due_date', 'due_on',
                      'due_time', 'scheduled_at', 'duration_minutes', 'recurrence', 'energy_level',
                      'priority', 'position', 'committed_for', 'commit_order', 'reschedule_count',
                      'section_id', 'team_id', 'estimate_minutes'] THEN
    -- TV-D10: a schedule cleared through the op removes the session it showed.
    IF p_patch ? 'scheduled_at' THEN
      v_session_flag := current_setting('tasks.session_op', true);
      PERFORM set_config('tasks.session_op', '1', true);
    END IF;
    UPDATE public.tasks SET
      title = CASE WHEN p_patch ? 'title' THEN coalesce(p_patch ->> 'title', '') ELSE title END,
      description = CASE WHEN p_patch ? 'description' THEN coalesce(p_patch ->> 'description', '') ELSE description END,
      bucket_id = CASE WHEN p_patch ? 'bucket_id' THEN (p_patch ->> 'bucket_id')::uuid ELSE bucket_id END,
      parent_id = CASE WHEN p_patch ? 'parent_id' THEN nullif(p_patch ->> 'parent_id', '')::uuid ELSE parent_id END,
      due_on = CASE WHEN v_set_due_on THEN v_due_on ELSE due_on END,
      due_date = CASE WHEN v_set_due_on THEN due_date
                      WHEN p_patch ? 'due_date' THEN (p_patch ->> 'due_date')::timestamptz ELSE due_date END,
      due_time = CASE WHEN p_patch ? 'due_time' THEN nullif(p_patch ->> 'due_time', '')::time ELSE due_time END,
      scheduled_at = CASE WHEN p_patch ? 'scheduled_at' THEN (p_patch ->> 'scheduled_at')::timestamptz ELSE scheduled_at END,
      duration_minutes = CASE WHEN p_patch ? 'duration_minutes'
                              THEN (p_patch ->> 'duration_minutes')::numeric::integer ELSE duration_minutes END,
      recurrence = CASE WHEN p_patch ? 'recurrence' THEN public.tasks__json_object(p_patch -> 'recurrence') ELSE recurrence END,
      energy_level = CASE WHEN p_patch ? 'energy_level' THEN nullif(p_patch ->> 'energy_level', '') ELSE energy_level END,
      priority = CASE WHEN p_patch ? 'priority' THEN nullif(p_patch ->> 'priority', '') ELSE priority END,
      position = CASE WHEN p_patch ? 'position' THEN coalesce(p_patch ->> 'position', '') ELSE position END,
      committed_for = CASE WHEN p_patch ? 'committed_for' THEN (p_patch ->> 'committed_for')::date ELSE committed_for END,
      commit_order = CASE WHEN p_patch ? 'commit_order' THEN (p_patch ->> 'commit_order')::numeric::integer ELSE commit_order END,
      reschedule_count = CASE WHEN p_patch ? 'reschedule_count'
                              THEN coalesce((p_patch ->> 'reschedule_count')::numeric::integer, 0) ELSE reschedule_count END,
      section_id = CASE WHEN p_patch ? 'section_id' THEN nullif(p_patch ->> 'section_id', '')::uuid ELSE section_id END,
      team_id = CASE WHEN p_patch ? 'team_id' THEN nullif(p_patch ->> 'team_id', '')::uuid ELSE team_id END,
      estimate_minutes = CASE WHEN p_patch ? 'estimate_minutes'
                              THEN (p_patch ->> 'estimate_minutes')::numeric::integer ELSE estimate_minutes END,
      updated_at = now()
    WHERE id = t.id;
    IF p_patch ? 'scheduled_at' THEN
      PERFORM set_config('tasks.session_op', coalesce(v_session_flag, ''), true);
    END IF;
    -- The row as the triggers (the session mirror included) left it.
    SELECT * INTO t FROM public.tasks WHERE id = t.id;

    -- Moving a task takes its subtasks along, in this transaction: the ones
    -- the mover can edit. Anyone else's (say, a step in a private project)
    -- stays where it is, so the move never fails or hints at a task the mover
    -- can't see.
    IF t.bucket_id IS DISTINCT FROM t0.bucket_id THEN
      FOR c IN
        SELECT * FROM public.tasks x
        WHERE x.parent_id = t.id AND x.deleted_at IS NULL AND x.bucket_id IS DISTINCT FROM t.bucket_id
          AND public.can_access('task', x.id, 'edit', public.perm_actor_id())
        ORDER BY x.id
        FOR UPDATE
      LOOP
        UPDATE public.tasks SET bucket_id = t.bucket_id, updated_at = now()
        WHERE id = c.id RETURNING * INTO c;
        v_carried := v_carried || c;
      END LOOP;
    END IF;

    -- One trail line for what changed (status, assignee and delete log their own).
    FOREACH v_field IN ARRAY ARRAY['title', 'description', 'bucket_id', 'parent_id', 'due_date',
                                   'due_time', 'scheduled_at', 'duration_minutes', 'recurrence',
                                   'energy_level', 'priority', 'section_id', 'team_id',
                                   'estimate_minutes'] LOOP
      IF to_jsonb(t) -> v_field IS DISTINCT FROM to_jsonb(t0) -> v_field THEN
        -- The estimate mirrors duration_minutes for builds before TV-D10:
        -- name only the field the patch set.
        IF v_field IN ('duration_minutes', 'estimate_minutes') AND NOT p_patch ? v_field THEN
          CONTINUE;
        END IF;
        v_fields := v_fields || v_field;
        IF v_field = 'description' THEN
          CONTINUE; -- the text itself stays out of the trail
        ELSIF v_field = 'recurrence' THEN
          v_payload := v_payload || jsonb_build_object(v_field, jsonb_build_object(
            'from', to_jsonb(t0) -> v_field -> 'rrule', 'to', to_jsonb(t) -> v_field -> 'rrule'));
        ELSE
          v_payload := v_payload || jsonb_build_object(v_field, jsonb_build_object(
            'from', to_jsonb(t0) -> v_field, 'to', to_jsonb(t) -> v_field));
          IF v_field = 'due_date' THEN
            v_payload := v_payload || jsonb_build_object('due_on', jsonb_build_object(
              'from', to_jsonb(t0) -> 'due_on', 'to', to_jsonb(t) -> 'due_on'));
          END IF;
        END IF;
      END IF;
    END LOOP;
    IF cardinality(v_fields) > 0 THEN
      v_payload := v_payload || jsonb_build_object('fields', to_jsonb(v_fields));
      IF cardinality(v_carried) > 0 THEN
        v_payload := v_payload || jsonb_build_object('subtasks_moved', cardinality(v_carried));
      END IF;
      -- Typing in the description saves often: one line per stretch of editing
      -- (the same person's description edit in the last 10 minutes, with
      -- nothing logged on the task since).
      IF NOT (v_fields = ARRAY['description'] AND EXISTS (
            SELECT 1 FROM public.module_activity a
            WHERE a.workspace_id = p_workspace_id AND a.module = 'tasks'
              AND a.entity_type = 'task' AND a.entity_id = t.id
              AND a.op = 'tasks.update' AND a.actor_id IS NOT DISTINCT FROM v_actor
              AND a.payload -> 'fields' = '["description"]'::jsonb
              AND a.created_at > now() - interval '10 minutes'
              AND NOT EXISTS (
                SELECT 1 FROM public.module_activity b
                WHERE b.workspace_id = a.workspace_id AND b.module = 'tasks'
                  AND b.entity_type = 'task' AND b.entity_id = a.entity_id
                  AND b.created_at > a.created_at))) THEN
        PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.update', v_payload);
      END IF;
    END IF;
  END IF;

  -- TV-D13: the status first, then the assignment, which can hand an unfiled
  -- task over to the assignee's Inbox (out of the caller's sight).
  IF p_patch ? 'status' OR p_patch ? 'status_id' THEN
    t := public.tasks__apply_status(t, coalesce(nullif(p_patch ->> 'status_id', ''), p_patch ->> 'status'), NULL, NULL);
  END IF;

  IF p_patch ? 'assignee_id' THEN
    v_target := t.bucket_id;
    t := public.tasks_op_assign(p_workspace_id, t.id, nullif(p_patch ->> 'assignee_id', '')::uuid);
    -- Handed into the assignee's Inbox: its subtasks went with it.
    IF t.bucket_id IS DISTINCT FROM v_target THEN
      FOR c IN
        SELECT * FROM public.tasks x
        WHERE x.parent_id = t.id AND x.bucket_id = t.bucket_id AND x.deleted_at IS NULL
        ORDER BY x.id
      LOOP
        IF public.can_access('task', c.id, 'view', public.perm_actor_id()) THEN
          v_carried := v_carried || c;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF v_delete AND t.deleted_at IS NULL THEN
    UPDATE public.tasks SET deleted_at = now(), updated_at = now()
    WHERE id = t.id RETURNING * INTO t;
    -- Its subtasks stay, at the top level (work is never lost with a parent).
    -- That's the server's own consequence of the delete, so it runs as
    -- system work: a subtask the caller can't edit doesn't refuse the delete,
    -- and the answer names only the subtasks the caller can see.
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    FOR c IN
      SELECT * FROM public.tasks x
      WHERE x.parent_id = t.id AND x.deleted_at IS NULL
      ORDER BY x.id
      FOR UPDATE
    LOOP
      UPDATE public.tasks SET parent_id = NULL, updated_at = now()
      WHERE id = c.id RETURNING * INTO c;
      IF public.can_access('task', c.id, 'view', public.perm_actor_id()) THEN
        v_carried := v_carried || c;
      END IF;
    END LOOP;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.delete', '{}'::jsonb);
  END IF;

  RETURN NEXT t;
  FOREACH c IN ARRAY v_carried LOOP
    RETURN NEXT c;
  END LOOP;
  RETURN;
END;
$function$;

-- ── 4. Leaving on your own reads as leaving ───────────────────────────────

CREATE OR REPLACE FUNCTION public.teams_member_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_to uuid;
  v_name text;
  v_bypass text;
  v_inbox uuid;
  r record;
BEGIN
  SELECT w.owner_id INTO v_owner FROM public.workspaces w
  WHERE w.id = OLD.workspace_id AND w.deleted_at IS NULL;
  IF v_owner IS NULL OR v_owner = OLD.user_id THEN
    RETURN OLD;
  END IF;
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);

  UPDATE public.team_members m SET deleted_at = now()
  WHERE m.workspace_id = OLD.workspace_id AND m.user_id = OLD.user_id AND m.deleted_at IS NULL;
  UPDATE public.buckets b SET lead_id = NULL, updated_at = now()
  WHERE b.workspace_id = OLD.workspace_id AND b.lead_id = OLD.user_id;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
    v_to := auth.uid();
    IF v_to IS NULL OR v_to = OLD.user_id OR NOT public.tasks__is_member(OLD.workspace_id, v_to) THEN
      v_to := v_owner;
    END IF;
    SELECT coalesce(nullif(btrim(p.display_name), ''), 'A former member') INTO v_name
    FROM public.profiles p WHERE p.id = OLD.user_id;

    FOR r IN
      WITH inbox AS (
        SELECT x.id, x.parent_id, x.owner_id, x.creator_unknown
        FROM public.tasks x
        JOIN public.buckets b ON b.id = x.bucket_id
        WHERE b.workspace_id = OLD.workspace_id AND b.owner_id = OLD.user_id AND b.is_system
          AND x.deleted_at IS NULL
      ), tops AS (
        SELECT i.id,
               CASE WHEN NOT i.creator_unknown AND i.owner_id IS NOT NULL AND i.owner_id <> OLD.user_id
                         AND (public.perm_is_owner(OLD.workspace_id, i.owner_id)
                              OR (public.tasks__is_member(OLD.workspace_id, i.owner_id)
                                  AND public.perm_user_has(OLD.workspace_id, i.owner_id, 'tasks.edit')))
                    THEN i.owner_id ELSE v_to END AS person
        FROM inbox i
        WHERE i.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM inbox p WHERE p.id = i.parent_id)
      ), moves AS (
        SELECT t.id, t.person, true AS top FROM tops t
        UNION ALL
        SELECT s.id, t.person, false FROM inbox s JOIN tops t ON t.id = s.parent_id
      )
      SELECT mv.person, array_agg(mv.id) AS ids, count(*) FILTER (WHERE mv.top) AS tops
      FROM moves mv
      GROUP BY mv.person
    LOOP
      v_inbox := public.tasks__inbox(OLD.workspace_id, r.person);
      UPDATE public.tasks x SET bucket_id = v_inbox, updated_at = now()
      WHERE x.id = ANY (r.ids);
      IF r.person IS DISTINCT FROM auth.uid() THEN
        BEGIN
          PERFORM public.tasks__notice(
            OLD.workspace_id, 'bucket', v_inbox, 'tasks.handed_back',
            jsonb_build_object(
              'mentioned_user_ids', jsonb_build_array(r.person::text),
              'count', r.tops,
              'name', v_name,
              'left', auth.uid() IS NOT DISTINCT FROM OLD.user_id));
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'teams_member_removed: notice failed for %: %', r.person, SQLERRM;
        END;
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN OLD;
END;
$function$;

-- ── 5. A team mention needs its author to still see the item ────────────

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
  IF NOT public.comments__item_visible_to(c.workspace_id, c.entity_type, c.entity_id, v_actor) THEN
    RAISE EXCEPTION 'That comment isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
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

-- Grants as before (CREATE OR REPLACE keeps them; restated for a fresh replay).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['tasks_notify_spine()', 'teams_member_removed()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['tasks_op_update(uuid, uuid, jsonb)', 'comments_op_mention_teams(uuid, uuid[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  -- Account erasure stays the service's (delete-account) alone.
  REVOKE ALL ON FUNCTION public.account_erase_workspace_data(uuid, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.account_erase_workspace_data(uuid, boolean) TO service_role;
END;
$$;
