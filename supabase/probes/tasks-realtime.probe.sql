-- Probe for TV-D5's migrations (20261008223000_tasks_realtime_publication.sql,
-- 20261008224500_tasks_server_updated_at.sql). Run with ON_ERROR_STOP on a
-- throwaway database holding tasks-realtime.stub.sql after applying both; see
-- the round trip in the PR description.
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

-- 20261008224500_tasks_server_updated_at.sql: whatever updated_at a client
-- sends (a clock hours ahead or behind), the stored stamp is the database's,
-- for a signed-in user too (the trigger function has no EXECUTE grant; Postgres
-- doesn't check it when firing a trigger).
DO $$
DECLARE
  ws uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  stamp timestamptz;
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_stamp_updated_at' AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'stamp trigger missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.tasks_stamp_updated_at()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tasks_stamp_updated_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'stamp function is client-callable';
  END IF;
  SET LOCAL ROLE authenticated;
  INSERT INTO public.buckets (id, workspace_id, name, is_system, position, created_at, updated_at)
    VALUES (b, ws, 'B', false, 'a', now(), now() + interval '3 hours');
  INSERT INTO public.tasks (id, workspace_id, bucket_id, title, description, status, reschedule_count, position, created_at, updated_at, time_spent_seconds, creator_unknown)
    VALUES (t, ws, b, 'T', '', 'todo', 0, 'a', now(), now() + interval '3 hours', 0, false);
  INSERT INTO public.tags (id, workspace_id, name, created_at, updated_at)
    VALUES (g, ws, 'G', now(), now() - interval '3 hours');
  UPDATE public.tasks SET title = 'T2', updated_at = now() + interval '1 day' WHERE id = t;
  RESET ROLE;
  SELECT updated_at INTO stamp FROM public.tasks WHERE id = t;
  IF abs(extract(epoch FROM stamp - clock_timestamp())) > 5 THEN RAISE EXCEPTION 'task stamp %', stamp; END IF;
  SELECT updated_at INTO stamp FROM public.buckets WHERE id = b;
  IF abs(extract(epoch FROM stamp - clock_timestamp())) > 5 THEN RAISE EXCEPTION 'bucket stamp %', stamp; END IF;
  SELECT updated_at INTO stamp FROM public.tags WHERE id = g;
  IF abs(extract(epoch FROM stamp - clock_timestamp())) > 5 THEN RAISE EXCEPTION 'tag stamp %', stamp; END IF;
  RAISE NOTICE 'tasks-realtime probe: server stamps OK';
END $$;
