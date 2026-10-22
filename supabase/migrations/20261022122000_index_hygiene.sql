-- MOD-46, MOD-53 · Index hygiene from the 2026-10-22 advisor pass.
--
-- Prod is small (largest table ~2.4k rows), so the advisor's 193 "unused"
-- indexes mostly mean the planner prefers a seq scan today, not that the
-- index is dead. Nothing here is dropped for being unused. An index goes only
-- when it is redundant (an exact duplicate, a leading prefix of another btree
-- on the same table, or a partial index another one already serves) or when
-- no query can use it, each checked twice: against the catalog and against
-- every reader in apps/, supabase/functions/ and the SQL function bodies.
-- Every FK they guarded stays covered by the wider index.
--
-- 1. Legacy tables. tasks_items, tasks_projects, tasks_states, tasks_comments
--    (the pre-v2 tasks schema, superseded by tasks/buckets/sections; DB-IDX-1
--    and OPS-2 §5 left them "to drop in their own block") and panel_layouts
--    have no reader or writer anywhere: no app, Edge Function, SQL function,
--    view, trigger or publication. They are empty; the guard below refuses to
--    drop one that is not. Their RLS policies (6 initplan warnings, 2 duplicate
--    permissive SELECTs) and 4 unindexed FKs go with them.
-- 2. Redundant indexes (14), each with what covers it.
-- 3. Indexes for the 16 remaining unindexed foreign keys (workspace and chat
--    cascades, account erasure's NO ACTION checks). Nullable audit columns get
--    partial indexes, as chat_messages_*_by_idx do.
-- Plain CREATE/DROP INDEX, not CONCURRENTLY: a migration runs in one
-- transaction, and these tables hold at most a few hundred rows.

SET LOCAL lock_timeout = '5s';

-- 1. Legacy tables -----------------------------------------------------------

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks_comments', 'tasks_items', 'tasks_states', 'tasks_projects', 'panel_layouts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'public.% holds % rows; it is not the empty legacy table this migration expects', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

-- Children first; no CASCADE, so an unexpected dependent stops the migration.
DROP TABLE IF EXISTS public.tasks_comments;
DROP TABLE IF EXISTS public.tasks_items;
DROP TABLE IF EXISTS public.tasks_states;
DROP TABLE IF EXISTS public.tasks_projects;
DROP TABLE IF EXISTS public.panel_layouts;

-- 2. Redundant indexes -------------------------------------------------------

-- Exact duplicate of the unique founders_interest_email_key (prod-only drift).
DROP INDEX IF EXISTS public.founders_interest_email_idx;
-- Same key as notes_parent_idx (parent_id WHERE parent_id IS NOT NULL), which
-- serves every parent_id = $1 lookup and the FK check (prod-only drift).
DROP INDEX IF EXISTS public.idx_notes_parent_id;
-- Leading prefixes of a wider btree that also covers the FK:
DROP INDEX IF EXISTS public.chat_channels_workspace_idx;           -- chat_channels_delta_idx (workspace_id, updated_at, id)
DROP INDEX IF EXISTS public.chat_members_user_idx;                 -- chat_members_delta_idx (user_id, workspace_id, updated_at)
DROP INDEX IF EXISTS public.tags_workspace_id_idx;                 -- tags_workspace_updated (workspace_id, updated_at, id)
DROP INDEX IF EXISTS public.workspace_invites_workspace_id_idx;    -- workspace_invites_workspace_created_idx (workspace_id, created_at)
DROP INDEX IF EXISTS public.task_time_entries_workspace_id_idx;    -- task_time_entries_workspace_started_idx (workspace_id, …)
DROP INDEX IF EXISTS public.link_suggestion_declines_workspace_idx; -- unique (workspace_id, pair_key)
-- Partial index served by a narrower one: both deleted-channel sweeps
-- (chat__purge_deleted, chat_recently_deleted) also say purged_at IS NULL,
-- which is chat_channels_purge_idx.
DROP INDEX IF EXISTS public.chat_channels_deleted_idx;
-- No query can use these:
-- email_outbox__health reads failures by last_error/last_attempt_at
-- (email_outbox_failed_at_idx); nothing filters status = 'failed' by created_at.
DROP INDEX IF EXISTS public.email_outbox_failed_idx;
-- contacts.custom is only ever written; nothing queries it with @>, @? or @@.
DROP INDEX IF EXISTS public.contacts_custom_gin;
-- import_rows is read by import_id (its unique key) or workspace_id, never by
-- (entity_type, entity_id), which is polymorphic and has no FK to cascade.
DROP INDEX IF EXISTS public.import_rows_entity;
-- slot_bookings is always filtered by slot_id, id or cancel_token first
-- (booking-public, the TX-6 triggers); status alone is low-cardinality and the
-- one start_at range read is slot_bookings_active_start (prod-only drift).
DROP INDEX IF EXISTS public.idx_slot_bookings_status;
DROP INDEX IF EXISTS public.idx_slot_bookings_start_at;

-- 3. Foreign keys without a covering index -----------------------------------

-- Cascades from workspaces, and the app's workspace_id reads.
CREATE INDEX IF NOT EXISTS agent_session_summaries_workspace_id_idx ON public.agent_session_summaries (workspace_id);
CREATE INDEX IF NOT EXISTS imports_workspace_id_idx ON public.imports (workspace_id);
CREATE INDEX IF NOT EXISTS import_rows_workspace_id_idx ON public.import_rows (workspace_id);
CREATE INDEX IF NOT EXISTS note_favorites_workspace_id_idx ON public.note_favorites (workspace_id);
CREATE INDEX IF NOT EXISTS chat_custom_emoji_uploads_workspace_id_idx ON public.chat_custom_emoji_uploads (workspace_id);
CREATE INDEX IF NOT EXISTS notice_deliveries_workspace_id_idx ON public.notice_deliveries (workspace_id) WHERE workspace_id IS NOT NULL;
-- Checked on every chat channel and message delete (chat__purge_deleted, erasure).
CREATE INDEX IF NOT EXISTS chat_catchup_channel_id_idx ON public.chat_catchup (channel_id);
CREATE INDEX IF NOT EXISTS chat_members_last_read_id_idx ON public.chat_members (last_read_id) WHERE last_read_id IS NOT NULL;
-- Nullable "who did it" columns: checked when a person or key is erased.
CREATE INDEX IF NOT EXISTS task_waiting_created_by_idx ON public.task_waiting (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS teams_created_by_idx ON public.teams (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS areas_created_by_idx ON public.areas (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS areas_deleted_by_idx ON public.areas (deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_catchup_actor_id_idx ON public.chat_catchup (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS imports_key_id_idx ON public.imports (key_id) WHERE key_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_channels_deleted_by_idx ON public.chat_channels (deleted_by) WHERE deleted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_members_removed_by_idx ON public.chat_members (removed_by) WHERE removed_by IS NOT NULL;
