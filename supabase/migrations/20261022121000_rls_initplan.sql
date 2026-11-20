-- MOD-47, MOD-39 · RLS policies read the signed-in person once per query, not once per row.
--
-- A bare auth.uid() (or realtime.topic()) in a policy is re-run for every row
-- the policy checks. Wrapped as (SELECT auth.uid()) it becomes an InitPlan the
-- planner evaluates once per statement. Supabase's advisor flagged these 27
-- policies (auth_rls_initplan); each is the live policy text with only that
-- wrap applied, generated from pg_policies on 2026-10-22 (prod and the local
-- snapshot hashed identical). Names, commands, roles and every other term are
-- unchanged, so who can read or write what does not move.
--
-- The two chat policies on realtime.messages call a definer function on the
-- topic per row; realtime.authorize (234 ms mean on prod) runs them on every
-- channel join. The whole check is wrapped, so it runs once per statement:
-- the topic is one value for the statement, so the answer is the same.
--
-- profiles had two permissive SELECT policies (own row, people you share a
-- workspace with), so every read evaluated both. They become one policy with
-- the same OR of the two conditions (multiple_permissive_policies).
-- The legacy tasks_* tables and panel_layouts are dropped in 20261022122000.

SET LOCAL lock_timeout = '5s';

ALTER POLICY booking_link_hosts_read ON public.booking_link_hosts
  USING (((user_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM exposed_slot_links l
  WHERE ((l.id = booking_link_hosts.link_id) AND (l.owner_user_id = ((SELECT auth.uid()))::text))))));

ALTER POLICY calendar_set_items_owner ON public.calendar_set_items
  USING ((EXISTS ( SELECT 1
   FROM calendar_sets s
  WHERE ((s.id = calendar_set_items.set_id) AND (s.owner_id = (SELECT auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM calendar_sets s
  WHERE ((s.id = calendar_set_items.set_id) AND (s.owner_id = (SELECT auth.uid()))))));

ALTER POLICY calendar_sets_owner ON public.calendar_sets
  USING ((owner_id = (SELECT auth.uid())))
  WITH CHECK ((owner_id = (SELECT auth.uid())));

ALTER POLICY chat_members_select ON public.chat_members
  USING (((user_id = (SELECT auth.uid())) OR chat_can_read_channel(channel_id)));

ALTER POLICY contact_private_notes_own ON public.contact_private_notes
  USING ((user_id = (SELECT auth.uid())))
  WITH CHECK ((user_id = (SELECT auth.uid())));

ALTER POLICY dashboard_layouts_own ON public.dashboard_layouts
  USING ((user_id = (SELECT auth.uid())));

ALTER POLICY email_accounts_owner_read ON public.email_accounts
  USING ((owner_id = (SELECT auth.uid())));

ALTER POLICY exposed_slot_links_host ON public.exposed_slot_links
  USING ((owner_user_id = ((SELECT auth.uid()))::text))
  WITH CHECK (((owner_user_id = ((SELECT auth.uid()))::text) AND ((workspace_id IS NULL) OR tasks_module_can_access_workspace((workspace_id)::uuid))));

ALTER POLICY focus_runs_read_own ON public.focus_runs
  USING ((user_id = (SELECT auth.uid())));

ALTER POLICY habits_owner_all ON public.habits
  USING ((user_id = (SELECT auth.uid())))
  WITH CHECK ((user_id = (SELECT auth.uid())));

ALTER POLICY notes_live_read ON realtime.messages
  USING (((extension = 'broadcast'::text) AND ((SELECT realtime.topic()) = ('notes-live:'::text || ((SELECT auth.uid()))::text))));

ALTER POLICY note_shares_insert_owner ON public.note_shares
  WITH CHECK ((private.user_owns_note(note_id) AND (user_id <> (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = note_shares.workspace_id) AND (wm.user_id = note_shares.user_id))))));

ALTER POLICY note_shares_select_access ON public.note_shares
  USING (((user_id = (SELECT auth.uid())) OR private.user_owns_note(note_id)));

ALTER POLICY note_shares_update_owner ON public.note_shares
  USING (private.user_owns_note(note_id))
  WITH CHECK ((private.user_owns_note(note_id) AND (user_id <> (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = note_shares.workspace_id) AND (wm.user_id = note_shares.user_id))))));

ALTER POLICY notification_state_own_read ON public.notification_state
  USING ((user_id = (SELECT auth.uid())));

ALTER POLICY profiles_insert_own ON public.profiles
  WITH CHECK (((SELECT auth.uid()) = id));

ALTER POLICY profiles_update_own ON public.profiles
  USING (((SELECT auth.uid()) = id));

ALTER POLICY slot_bookings_host_read ON public.slot_bookings
  USING ((EXISTS ( SELECT 1
   FROM exposed_slot_links l
  WHERE ((l.slot_id = slot_bookings.slot_id) AND (l.owner_user_id = ((SELECT auth.uid()))::text)))));

ALTER POLICY task_time_entries_read_own ON public.task_time_entries
  USING (((user_id = (SELECT auth.uid())) AND perm_can_view(workspace_id, 'tasks'::text) AND tasks__visible(task_id)));

ALTER POLICY user_preferences_own ON public.user_preferences
  USING ((user_id = (SELECT auth.uid())))
  WITH CHECK ((user_id = (SELECT auth.uid())));

ALTER POLICY paid_plan_required_to_add_member ON public.workspace_members
  WITH CHECK (((user_id = (SELECT auth.uid())) OR (workspace_seat_cap(( SELECT w.owner_id
   FROM workspaces w
  WHERE (w.id = workspace_members.workspace_id))) > workspace_seats_used(workspace_id))));

ALTER POLICY workspace_members_delete_own ON public.workspace_members
  USING (((user_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = (SELECT auth.uid())))))));

ALTER POLICY workspace_notifications_select_own ON public.workspace_notifications
  USING ((user_id = (SELECT auth.uid())));

ALTER POLICY workspace_notifications_update_own ON public.workspace_notifications
  USING ((user_id = (SELECT auth.uid())));

ALTER POLICY workspaces_delete_owner ON public.workspaces
  USING ((owner_id = (SELECT auth.uid())));

ALTER POLICY workspaces_select_member ON public.workspaces
  USING (((owner_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM workspace_members
  WHERE ((workspace_members.workspace_id = workspaces.id) AND (workspace_members.user_id = (SELECT auth.uid())))))));

ALTER POLICY workspaces_update_owner ON public.workspaces
  USING ((owner_id = (SELECT auth.uid())));

ALTER POLICY chat_realtime_read ON realtime.messages
  USING (((extension = ANY (ARRAY['broadcast'::text, 'presence'::text])) AND (SELECT public.chat_realtime_topic_allowed((SELECT realtime.topic())))));

ALTER POLICY chat_realtime_write ON realtime.messages
  WITH CHECK (((extension = 'presence'::text) AND (SELECT public.chat_realtime_topic_writable((SELECT realtime.topic())))));

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_select_workspace_members ON public.profiles;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (
    ((SELECT auth.uid()) = id)
    OR (EXISTS (SELECT 1 FROM public.workspace_members wm
                WHERE wm.user_id = profiles.id AND public.user_is_workspace_member(wm.workspace_id)))
    OR (EXISTS (SELECT 1 FROM public.workspaces w
                WHERE w.owner_id = profiles.id AND public.user_is_workspace_member(w.id)))
  );
