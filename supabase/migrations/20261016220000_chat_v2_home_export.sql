-- Chat v2 · CV-22 Home widgets, export and the shortcut sheet
-- (specs/chat-v2.md §10 "Home", §Edge cases "The export", AC12.8;
-- §Assumptions #31). The stamp is fixed by the build's queue (after CV-13,
-- CV-19, CV-16, CV-18). It runs again cleanly over itself.
--
-- What it does:
--   1. Every published chat table is keyed by its own row id. Realtime sends a
--      removed row's key to listeners without a read rule (a removed row can't
--      be checked against one), so a key must say nothing about anyone:
--      user_statuses and chat_members get an `id` primary key, and the person
--      columns that were their key stay unique (the ops' ON CONFLICT targets
--      keep working). The other published tables (chat_channels,
--      chat_messages, chat_catchup, notice_deliveries) already are.
--   2. Table grants re-stated for both (people read through the rules, the
--      server writes).
--   3. Account erasure also counts and removes CV-18's per-person tables
--      (user_notice_pauses, user_status_changes), re-cut from the live body;
--      it already covered chat_catchup, chat_chain_mutes, user_clients,
--      user_statuses and user_saved_statuses. Neither new table is published;
--      the published rows erasure removes (user_statuses, chat_catchup,
--      notice_deliveries, a cascaded chat_members row) reach listeners as
--      their row ids alone.
--   4. Asserts: no table in supabase_realtime has a key column that refers to
--      a person.
--
-- Needs CV-18 (20261016210000) applied first.

SET LOCAL lock_timeout = '5s';

-- ── 1. Row ids as the keys ──────────────────────────────────────────────────

ALTER TABLE public.user_statuses ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.chat_members ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

-- The default filled every existing row with its own id (a volatile default
-- is evaluated per row); check before the ids become the keys.
DO $$
BEGIN
  IF (SELECT count(*) <> count(DISTINCT id) FROM public.chat_members)
     OR (SELECT count(*) <> count(DISTINCT id) FROM public.user_statuses) THEN
    RAISE EXCEPTION 'CV-22: a row id repeats';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.user_statuses'::regclass AND conname = 'user_statuses_user_id_key') THEN
    ALTER TABLE public.user_statuses
      DROP CONSTRAINT user_statuses_pkey,
      ADD CONSTRAINT user_statuses_user_id_key UNIQUE (user_id),
      ADD CONSTRAINT user_statuses_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.chat_members'::regclass AND conname = 'chat_members_channel_user_key') THEN
    ALTER TABLE public.chat_members
      DROP CONSTRAINT chat_members_pkey,
      ADD CONSTRAINT chat_members_channel_user_key UNIQUE (channel_id, user_id),
      ADD CONSTRAINT chat_members_pkey PRIMARY KEY (id);
  END IF;
END;
$$;

-- ── 2. Grants (as last set: 20261016160000 for user_statuses, the foundation for chat_members) ──

REVOKE ALL ON public.user_statuses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_statuses TO authenticated;
GRANT ALL ON public.user_statuses TO service_role;

REVOKE ALL ON public.chat_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_members TO authenticated;
GRANT ALL ON public.chat_members TO service_role;

-- ── 3. Account erasure: CV-18's per-person tables ──────────────────────────
-- From the live body (CV-17's, 20261016160000); grants as last set
-- (20261015140000).

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
  v_agent_sessions integer;
  v_imports integer;
  v_templates integer;
  v_views integer;
  v_push_subscriptions integer;
  v_deliveries integer;
  v_user_clients integer;
  v_typing_marks integer;
  v_team_members integer;
  v_waiting integer;
  v_leads integer;
  v_focus_runs integer;
  v_time_notes integer;
  v_chat_catchup integer;
  v_chat_mutes integer;
  v_user_statuses integer;
  v_saved_statuses integer;
  v_notice_pauses integer;
  v_status_changes integer;
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
      WHERE cm.channel_id = c.id AND cm.user_id <> p_user AND cm.left_at IS NULL
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
          -- One manager rule (chat__can_manage): in the channel, in a role that
          -- posts, or an admin.
          AND public.chat__can_manage(c, m2.user_id))
  LOOP
    v_new := NULL;
    SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = r.workspace_id;
    IF v_owner IS NOT NULL AND v_owner <> p_user
       AND (NOT r.is_private OR EXISTS (SELECT 1 FROM public.chat_members cm
                                        WHERE cm.channel_id = r.id AND cm.user_id = v_owner AND cm.left_at IS NULL)) THEN
      v_new := v_owner;
    ELSE
      SELECT cm.user_id INTO v_new
      FROM public.chat_members cm
      JOIN public.workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = cm.user_id
      WHERE cm.channel_id = r.id AND cm.user_id <> p_user AND cm.left_at IS NULL
        AND public.chat_has_cap(r.workspace_id, cm.user_id, 'post')
      ORDER BY cm.joined_at, cm.user_id
      LIMIT 1;
      IF v_new IS NULL AND NOT r.is_private THEN
        SELECT m.user_id INTO v_new
        FROM public.workspace_members m
        WHERE m.workspace_id = r.workspace_id AND m.user_id <> p_user
          AND public.chat_has_cap(r.workspace_id, m.user_id, 'post')
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
  SELECT count(*) INTO v_views
  FROM public.task_views x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_agent_sessions
  FROM public.agent_sessions x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_imports
  FROM public.imports x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_reminders
  FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_push_subscriptions FROM public.push_subscriptions x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_deliveries FROM public.notice_deliveries x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_user_clients FROM public.user_clients x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_typing_marks FROM public.chat_typing_marks x WHERE x.user_id = p_user;
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
  SELECT count(*) INTO v_time_notes
  FROM public.task_time_entries x
  WHERE x.user_id = p_user AND x.note IS NOT NULL AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_focus_runs
  FROM public.focus_runs f WHERE f.user_id = p_user AND f.workspace_id <> ALL (v_owned);

  -- Chat v2 (CV-1): their Catch up items and the chains they stopped following.
  SELECT count(*) INTO v_chat_catchup FROM public.chat_catchup x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_chat_mutes FROM public.chat_chain_mutes x WHERE x.user_id = p_user;
  -- CV-17: their status and saved statuses.
  SELECT count(*) INTO v_user_statuses FROM public.user_statuses x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_saved_statuses FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  -- CV-18: the workspaces whose notices they paused, and their status-change
  -- counter (CV-22 counts and removes both).
  SELECT count(*) INTO v_notice_pauses FROM public.user_notice_pauses x WHERE x.user_id = p_user;
  SELECT count(*) INTO v_status_changes FROM public.user_status_changes x WHERE x.user_id = p_user;

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
    'agent_sessions_deleted', v_agent_sessions,
    'imports_deleted', v_imports,
    'templates_deleted', v_templates,
    'views_deleted', v_views,
    'push_subscriptions_deleted', v_push_subscriptions,
    'notice_deliveries_deleted', v_deliveries,
    'user_clients_deleted', v_user_clients,
    'chat_typing_marks_deleted', v_typing_marks,
    'team_memberships_deleted', v_team_members,
    'waiting_entries_deleted', v_waiting,
    'project_leads_cleared', v_leads,
    'focus_runs_deleted', v_focus_runs,
    'time_notes_cleared', v_time_notes,
    'chat_catchup_deleted', v_chat_catchup,
    'chat_chain_mutes_deleted', v_chat_mutes,
    'user_statuses_deleted', v_user_statuses,
    'saved_statuses_deleted', v_saved_statuses,
    'notice_pauses_deleted', v_notice_pauses,
    'status_changes_deleted', v_status_changes
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
  DELETE FROM public.agent_sessions x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.imports x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_views x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.push_subscriptions x WHERE x.user_id = p_user;
  DELETE FROM public.notice_deliveries x WHERE x.user_id = p_user;
  DELETE FROM public.user_clients x WHERE x.user_id = p_user;
  DELETE FROM public.chat_typing_marks x WHERE x.user_id = p_user;
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
  -- TV-D14: their notes on tracked time (the seconds stay in the totals).
  UPDATE public.task_time_entries x SET note = NULL
  WHERE x.user_id = p_user AND x.note IS NOT NULL AND x.workspace_id <> ALL (v_owned);

  -- 4. Chat: new managers first, then the user's manager rows, then channels
  --    with nobody else in them (members and messages cascade).
  INSERT INTO public.chat_channel_managers (channel_id, user_id)
  SELECT x.channel_id, x.user_id FROM unnest(v_manager_channel, v_manager_to) AS x(channel_id, user_id)
  ON CONFLICT DO NOTHING;
  DELETE FROM public.chat_channel_managers m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND m.user_id = p_user AND c.workspace_id <> ALL (v_owned);
  DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);
  DELETE FROM public.chat_catchup x WHERE x.user_id = p_user;
  DELETE FROM public.chat_chain_mutes x WHERE x.user_id = p_user;
  DELETE FROM public.user_statuses x WHERE x.user_id = p_user;
  DELETE FROM public.user_saved_statuses x WHERE x.user_id = p_user;
  DELETE FROM public.user_notice_pauses x WHERE x.user_id = p_user;
  DELETE FROM public.user_status_changes x WHERE x.user_id = p_user;

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
  -- TV-D16: their keys' trail labels name them; cleared like their own.
  UPDATE public.module_activity a SET actor_label = NULL
  FROM public.workspace_api_keys k
  WHERE a.actor_type = 'api_key' AND a.actor_id = k.id AND a.actor_label IS NOT NULL
    AND a.workspace_id <> ALL (v_owned)
    AND k.created_by = p_user AND k.workspace_id <> ALL (v_owned);
  DELETE FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);
  DELETE FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN v_counts;
END;
$function$;

REVOKE ALL ON FUNCTION public.account_erase_workspace_data(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_erase_workspace_data(uuid, boolean) TO service_role;

-- ── 4. Asserts ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ') INTO v_bad
  FROM pg_publication_tables t
  JOIN pg_constraint c ON c.conrelid = format('%I.%I', t.schemaname, t.tablename)::regclass AND c.contype = 'p'
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE t.pubname = 'supabase_realtime'
    AND EXISTS (
      SELECT 1 FROM pg_constraint f
      WHERE f.conrelid = c.conrelid AND f.contype = 'f'
        AND f.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
        AND a.attnum = ANY (f.conkey));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CV-22: a published table is keyed by a person: %', v_bad;
  END IF;

  IF (SELECT count(*) FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
        AND tablename IN ('user_statuses', 'chat_members')) <> 2 THEN
    RAISE EXCEPTION 'CV-22: user_statuses and chat_members must stay published';
  END IF;
END;
$$;
