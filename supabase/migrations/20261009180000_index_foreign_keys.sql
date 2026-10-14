-- DB-IDX-1 · Cover the foreign keys the performance advisor flags as unindexed.
--
-- Postgres indexes the referenced side of a foreign key, not the referencing
-- column. Without an index, every delete on the parent (a workspace, a
-- profile, a calendar, a contact) scans the child table to cascade or null it,
-- and so does every filter on that column. Account and workspace erasure walks
-- most of these.
--
-- One btree index per flagged FK, columns read from prod's catalog on
-- 2026-10-09 (pg_constraint). An existing composite index does not cover a
-- foreign key unless the FK column leads it, which is why chat_members
-- (user_id, workspace_id), habits (user_id, workspace_id) and note_shares
-- (workspace_id, user_id) still get one.
--
-- Left out on purpose:
--   * tasks_items, tasks_comments, tasks_states (4 FKs): legacy tables
--     superseded by the tasks module, empty and read by no code (OPS-2 §5).
--     They should be dropped in their own block, not indexed.
--   * stripe._managed_webhooks: owned by the Stripe Sync Engine, not us.
--
-- Plain CREATE INDEX, not CONCURRENTLY: apply_migration runs in a transaction,
-- and the largest of these tables held ~650 rows on 2026-10-09, so the write
-- lock lasts milliseconds. IF NOT EXISTS keeps a re-apply a no-op. The lock
-- timeout makes a blocked apply fail fast instead of queueing every writer.
--
-- task_time_entries is created by TV-D3 (20261008225500, maciej's lane), which
-- may not be on the branch this lands on first, so its index is guarded.

set local lock_timeout = '5s';

-- workspace_id (ON DELETE CASCADE from workspaces)
create index if not exists calendar_sets_workspace_id_idx on public.calendar_sets (workspace_id);
create index if not exists chat_members_workspace_id_idx on public.chat_members (workspace_id);
create index if not exists chat_messages_workspace_id_idx on public.chat_messages (workspace_id);
create index if not exists contact_groups_workspace_id_idx on public.contact_groups (workspace_id);
create index if not exists dashboard_layouts_workspace_id_idx on public.dashboard_layouts (workspace_id);
create index if not exists habits_workspace_id_idx on public.habits (workspace_id);
create index if not exists note_updates_workspace_id_idx on public.note_updates (workspace_id);
create index if not exists notification_state_workspace_id_idx on public.notification_state (workspace_id);
create index if not exists resource_grants_workspace_id_idx on public.resource_grants (workspace_id);
create index if not exists workspace_invites_workspace_id_idx on public.workspace_invites (workspace_id);
create index if not exists workspace_notifications_workspace_id_idx on public.workspace_notifications (workspace_id);
do $$
begin
  if to_regclass('public.task_time_entries') is not null then
    create index if not exists task_time_entries_workspace_id_idx on public.task_time_entries (workspace_id);
  end if;
end $$;

-- Other parents
create index if not exists calendar_events_calendar_ref_idx on public.calendar_events (calendar_ref);
create index if not exists calendar_set_items_calendar_id_idx on public.calendar_set_items (calendar_id);
create index if not exists contact_group_members_contact_id_idx on public.contact_group_members (contact_id);
create index if not exists email_refs_account_id_idx on public.email_refs (account_id);
create index if not exists notification_state_activity_id_idx on public.notification_state (activity_id);
create index if not exists workspace_invites_role_id_idx on public.workspace_invites (role_id);

-- Users and profiles (hit when an account is deleted)
create index if not exists chat_channels_created_by_idx on public.chat_channels (created_by);
create index if not exists chat_messages_pinned_by_idx on public.chat_messages (pinned_by);
create index if not exists note_shares_user_id_idx on public.note_shares (user_id);
create index if not exists workspace_invites_created_by_idx on public.workspace_invites (created_by);
