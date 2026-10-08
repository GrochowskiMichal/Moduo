-- Probe for 20261008223000_tasks_realtime_publication.sql (TV-D5). Run with
-- ON_ERROR_STOP on a throwaway database holding tasks-realtime.stub.sql, after
-- applying the migration once; see the round trip in the PR description.
-- Every check raises on failure.

DO $$
DECLARE
  want text[] := ARRAY['buckets','chat_channels','chat_members','chat_messages','comments','tag_links','tags','task_queue','tasks'];
  got text[];
  p record;
BEGIN
  SELECT array_agg(tablename::text ORDER BY tablename) INTO got
  FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'published tables: % (want %)', got, want;
  END IF;
  -- Whole rows, no row filters: Realtime applies RLS itself.
  IF EXISTS (SELECT 1 FROM pg_publication_rel r JOIN pg_publication pb ON pb.oid = r.prpubid
             WHERE pb.pubname = 'supabase_realtime' AND (r.prqual IS NOT NULL OR r.prattrs IS NOT NULL)) THEN
    RAISE EXCEPTION 'a column list or row filter crept in';
  END IF;
  SELECT * INTO p FROM pg_publication WHERE pubname = 'supabase_realtime';
  IF p.puballtables OR NOT (p.pubinsert AND p.pubupdate AND p.pubdelete AND p.pubtruncate) THEN
    RAISE EXCEPTION 'publication options changed';
  END IF;
  -- Deletes must keep carrying only the key: default replica identity, RLS on.
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = ANY (want)
               AND (c.relreplident <> 'd' OR NOT c.relrowsecurity)) THEN
    RAISE EXCEPTION 'replica identity or RLS changed';
  END IF;
  RAISE NOTICE 'tasks-realtime probe: OK (% tables published)', array_length(got, 1);
END $$;
