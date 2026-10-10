-- TV-D5 · Live updates (specs/tasks-v2.md block 8, decision 10).
--
-- Teammates' changes to tasks, buckets, queues, tags and comments reach open
-- apps within a couple of seconds through Supabase Realtime
-- `postgres_changes`. A table only streams changes once it is in the
-- `supabase_realtime` publication; this adds the six Tasks tables.
--
-- Who receives what:
--   * Inserts and updates: Realtime checks each subscriber's row-level
--     security on the new row, so nobody receives a row they couldn't SELECT.
--     These policies already exist (tasks/buckets: can_access; tags/tag_links:
--     module access; task_queue: can view the task; comments: can see the
--     entity). Nothing here widens them.
--   * Deletes: Realtime can't check RLS on a row that is gone, so a DELETE
--     reaches every subscriber of the table, carrying ONLY the primary key
--     (with RLS on, Realtime drops the other old columns whatever the replica
--     identity; the tables keep the default one). All six keys are random
--     uuids. Tasks, buckets, tags and comments delete softly (an UPDATE, so
--     RLS applies); task_queue and tag_links hard-delete, so their row ids are
--     the only thing a delete gives away — no task, person or tag.
--   * `attachments` is in the spec's list but doesn't exist yet; the block
--     that creates it (AT-1/AT-2) adds it to the publication.
--
-- Comments are published for the comments panel (TV-U3); the Tasks client
-- listens to the other five tables from TV-D5 on.
--
-- Idempotent: adding a table that is already published is skipped.

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'The supabase_realtime publication is missing.';
  END IF;
  IF to_regclass('public.task_queue') IS NULL THEN
    RAISE EXCEPTION 'TV-D2 (20261008171500_tasks_personal_queue) must be applied first.';
  END IF;
  FOREACH t IN ARRAY ARRAY['tasks', 'buckets', 'task_queue', 'tags', 'tag_links', 'comments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
