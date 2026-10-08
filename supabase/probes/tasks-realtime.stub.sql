-- Stub of production for supabase/probes/tasks-realtime.probe.sql (TV-D5).
-- The `supabase_realtime` publication exactly as production has it
-- (pg_publication, project wtoonrvuqumihpkbvwvs, 2026-10-08: not FOR ALL
-- TABLES; insert, update, delete, truncate; publish_via_partition_root off;
-- chat_channels, chat_members, chat_messages), and the nine tables involved,
-- columns + primary keys read from the catalog the same day. Row-level
-- security is on everywhere, replica identity default, as in production.

CREATE TABLE public.buckets (id uuid NOT NULL, workspace_id uuid NOT NULL, owner_id uuid, name text NOT NULL, is_system boolean NOT NULL, "position" text NOT NULL, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL, deleted_at timestamp with time zone, group_label text, PRIMARY KEY (id));
CREATE TABLE public.chat_channels (id uuid NOT NULL, workspace_id uuid NOT NULL, kind text NOT NULL, name text, topic text NOT NULL, is_private boolean NOT NULL, dm_key text, created_by uuid, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL, archived_at timestamp with time zone, last_message_at timestamp with time zone, managers_only boolean NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.chat_members (channel_id uuid NOT NULL, user_id uuid NOT NULL, workspace_id uuid NOT NULL, notify_level text NOT NULL, starred boolean NOT NULL, last_read_at timestamp with time zone NOT NULL, joined_at timestamp with time zone NOT NULL, PRIMARY KEY (channel_id,user_id));
CREATE TABLE public.chat_messages (id uuid NOT NULL, workspace_id uuid NOT NULL, channel_id uuid NOT NULL, parent_id uuid, author_id uuid, body text NOT NULL, mentioned_user_ids uuid[] NOT NULL, reactions jsonb NOT NULL, reply_count integer NOT NULL, last_reply_at timestamp with time zone, reply_user_ids uuid[] NOT NULL, pinned_at timestamp with time zone, pinned_by uuid, edited_at timestamp with time zone, deleted_at timestamp with time zone, client_id uuid, created_at timestamp with time zone NOT NULL, author_kind text NOT NULL, author_label text, PRIMARY KEY (id));
CREATE TABLE public.comments (id uuid NOT NULL, workspace_id uuid NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL, body text NOT NULL, created_by uuid NOT NULL, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL, deleted_at timestamp with time zone, author_kind text NOT NULL, author_label text, PRIMARY KEY (id));
CREATE TABLE public.tag_links (id uuid NOT NULL, workspace_id uuid NOT NULL, tag_id uuid NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL, created_at timestamp with time zone NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.tags (id uuid NOT NULL, workspace_id uuid NOT NULL, owner_id uuid, name text NOT NULL, color text, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL, deleted_at timestamp with time zone, PRIMARY KEY (id));
CREATE TABLE public.task_queue (id uuid NOT NULL, workspace_id uuid NOT NULL, user_id uuid NOT NULL, task_id uuid NOT NULL, "position" text NOT NULL, queued_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL, PRIMARY KEY (id));
CREATE TABLE public.tasks (id uuid NOT NULL, workspace_id uuid NOT NULL, owner_id uuid, bucket_id uuid NOT NULL, title text NOT NULL, description text NOT NULL, due_date timestamp with time zone, scheduled_at timestamp with time zone, duration_minutes integer, recurrence jsonb, energy_level text, status text NOT NULL, committed_for date, commit_order integer, reschedule_count integer NOT NULL, "position" text NOT NULL, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL, deleted_at timestamp with time zone, priority text, parent_id uuid, time_spent_seconds integer NOT NULL, assignee_id uuid, creator_unknown boolean NOT NULL, PRIMARY KEY (id));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['buckets','chat_channels','chat_members','chat_messages','comments','tag_links','tags','task_queue','tasks'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE PUBLICATION supabase_realtime
  WITH (publish = 'insert, update, delete, truncate', publish_via_partition_root = false);
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages, public.chat_channels, public.chat_members;
