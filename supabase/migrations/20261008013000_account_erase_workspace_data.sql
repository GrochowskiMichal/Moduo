-- PRIV-2a · Erase what a deleted account leaves in other people's workspaces.
-- Spec: specs/privacy-account-erasure.md (block 1). Called by delete-account
-- (PRIV-2b) and the privacy@ admin command (PRIV-2c) as the service role,
-- BEFORE auth.admin.deleteUser. The auth cascade then removes the profile and
-- every workspace the user owns, with everything in it.
--
-- In every workspace the user does NOT own:
--   * Private items (no other current member can view them, by can_access) are
--     hard-deleted with everything attached that has no foreign key: grants,
--     tag links, link-suggestion declines, activity (notification state
--     cascades) and spine entities (their links and comments cascade).
--   * Shared items stay. Their owner becomes the workspace owner if the owner
--     could already see them, otherwise the member with the most access (ties:
--     earliest grant, then earliest to join). Nobody gains access to anything.
--   * Shared tasks in buckets that go move to the Inbox of the teammate they
--     are assigned to, or else of their new owner; tasks assigned to the user
--     are unassigned.
--   * Calendars, calendar sets, calendar and email accounts, email records,
--     notification state, API keys the user created, invitations they
--     accepted and chat channels with nobody else in them are deleted.
--     Channels the user managed alone get a new manager by the same rule.
--   * The user's messages, comments and activity stay, without a name: names
--     come from profiles, which the auth cascade deletes, and from the copy on
--     activity entries (actor_label), cleared here. Activity only they could
--     read (their calendar and email items) is deleted.
-- Preview (the default, also for NULL) computes the same counts and changes
-- nothing; only p_preview => false deletes.
--
-- share_member_removed changes too (it fires inside the account cascade):
--   * a removed member's tasks in that workspace are unassigned (a non-member
--     owner froze them: perm_enforce_write refuses every later edit);
--   * when the profile is already gone (account deletion) private items are
--     never handed to the workspace owner.
-- notes_share_fields_owner_only honours share.bypass, so an owner can remove a
-- member who has private notes (the hand-over used to make the removal fail).
-- Tasks still assigned to people removed before this migration are unassigned
-- once.
--
-- Every write below runs as the service role, so perm_enforce_write passes
-- (no actor); share.bypass is set for the transaction like share_member_removed.

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- Effective access level as a number (view 2 · edit 3 · full 4), through the
-- same can_access every policy and op uses.
CREATE OR REPLACE FUNCTION public.account_erasure_rank(p_type text, p_id uuid, p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.can_access(p_type, p_id, 'full', p_user) THEN 4
    WHEN public.can_access(p_type, p_id, 'edit', p_user) THEN 3
    WHEN public.can_access(p_type, p_id, 'view', p_user) THEN 2
    ELSE 0
  END
$$;

-- Who takes over an item the user shared, or NULL when nobody else can see it
-- (then it is private and goes). Only people who can already view it qualify.
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

-- A member's Inbox, created when missing in the same shape as the app's
-- ensureWebInbox (src/lib/runtime.web.ts). share_bucket_after skips system
-- buckets, so it gets no workspace grant.
CREATE OR REPLACE FUNCTION public.account_erasure_inbox(p_workspace_id uuid, p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT b.id INTO v_id
  FROM public.buckets b
  WHERE b.workspace_id = p_workspace_id AND b.owner_id = p_user
    AND b.is_system AND b.deleted_at IS NULL
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.buckets (workspace_id, owner_id, name, is_system, position, created_at, updated_at)
  VALUES (p_workspace_id, p_user, 'Inbox', true, 'a0', now(), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── The erasure ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.account_erase_workspace_data(
  p_user uuid,
  p_preview boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT t.id, t.workspace_id, t.owner_id FROM public.tasks t WHERE t.bucket_id = ANY (v_bucket_del)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.resource_grants g
                   WHERE g.resource_type = 'task' AND g.resource_id = r.id) THEN
      -- can_access gives a task its own grants plus its bucket's access, and
      -- nobody else can see this bucket: without a grant the task is private.
      -- (A shortcut, so a big private bucket doesn't cost a search per task.)
      v_new := NULL;
    ELSIF r.owner_id IS NOT NULL AND r.owner_id <> p_user
          AND public.can_access('task', r.id, 'view', r.owner_id) THEN
      -- The teammate it's assigned to keeps it, in their own Inbox.
      v_new := r.owner_id;
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
  WHERE t.owner_id = p_user AND t.workspace_id <> ALL (v_owned)
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
    'invites_deleted', v_invites
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
  UPDATE public.tasks t SET owner_id = NULL
  WHERE t.owner_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

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
$$;

-- ── Member removal (and the account cascade that fires it) ───────────────────

-- Newest body ← 20261006210000_perm_sharing.sql. CREATE OR REPLACE keeps it
-- attached to the workspace_members trigger.
CREATE OR REPLACE FUNCTION public.share_member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_name text;
BEGIN
  SELECT owner_id INTO v_owner FROM public.workspaces WHERE id = OLD.workspace_id AND deleted_at IS NULL;
  IF v_owner IS NULL OR v_owner = OLD.user_id THEN RETURN OLD; END IF;
  PERFORM set_config('share.bypass', '1', true);

  -- A non-member can't own a task: perm_enforce_write refuses every later edit
  -- of it ("Viewers can't be assigned tasks"). Unassign instead.
  UPDATE public.tasks SET owner_id = NULL
  WHERE workspace_id = OLD.workspace_id AND owner_id = OLD.user_id;

  DELETE FROM public.resource_grants
  WHERE subject_type = 'member' AND subject_id = OLD.user_id AND workspace_id = OLD.workspace_id;

  -- Account deletion: this cascade runs after the profile is gone. Private
  -- items were erased before it (account_erase_workspace_data); whatever a
  -- deletion outside the app left behind must never reach the owner.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    RETURN OLD;
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), 'Member') INTO v_name
  FROM public.profiles WHERE id = OLD.user_id;
  v_name := coalesce(v_name, 'Member');

  UPDATE public.notes SET
    created_by = v_owner,
    title = 'From ' || v_name || ' (archived) ' || title
  WHERE workspace_id = OLD.workspace_id
    AND created_by = OLD.user_id
    AND deleted_at IS NULL
    AND share_mode = 'custom'
    AND NOT EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = notes.id AND g.subject_type = 'workspace'
    );

  UPDATE public.buckets SET
    owner_id = v_owner,
    name = 'From ' || v_name || ' (archived) ' || name
  WHERE workspace_id = OLD.workspace_id
    AND owner_id = OLD.user_id
    AND deleted_at IS NULL
    AND is_system = false
    AND NOT EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'bucket' AND g.resource_id = buckets.id AND g.subject_type = 'workspace'
    );

  RETURN OLD;
END;
$$;

-- One-time: members removed before this migration left tasks assigned to
-- someone no longer in the workspace, which perm_enforce_write then refuses to
-- save ("Viewers can't be assigned tasks"). Unassign them, as removal now does.
DO $$
BEGIN
  PERFORM set_config('share.bypass', '1', true);
  UPDATE public.tasks t SET owner_id = NULL
  WHERE t.owner_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
                    WHERE m.workspace_id = t.workspace_id AND m.user_id = t.owner_id)
    AND NOT EXISTS (SELECT 1 FROM public.workspaces w
                    WHERE w.id = t.workspace_id AND w.owner_id = t.owner_id);
  PERFORM set_config('share.bypass', '', true);
END;
$$;

-- Production's body (no migration creates it) plus the share.bypass exit that
-- perm_enforce_write already honours. Without it, an owner removing a member
-- who has private notes fails: the hand-over above changes created_by while the
-- owner is signed in, and this guard refuses it.
CREATE OR REPLACE FUNCTION public.notes_share_fields_owner_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND auth.uid() IS NOT NULL
    AND OLD.created_by IS DISTINCT FROM auth.uid()
    AND (
      OLD.share_scope IS DISTINCT FROM NEW.share_scope
      OR OLD.share_permission IS DISTINCT FROM NEW.share_permission
      OR OLD.created_by IS DISTINCT FROM NEW.created_by
      OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    )
  THEN
    RAISE EXCEPTION 'only the note owner can change sharing or ownership';
  END IF;

  RETURN NEW;
END;
$$;

-- ── Grants: service role only ────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.account_erasure_rank(text, uuid, uuid)',
    'public.account_erasure_new_owner(text, uuid, uuid, uuid)',
    'public.account_erasure_inbox(uuid, uuid)',
    'public.account_erase_workspace_data(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;
