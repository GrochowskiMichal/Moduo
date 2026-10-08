-- What production has that 20261009120000_focus_runs.sql needs beyond the
-- TV-D3 probe chain: the Realtime publication (Supabase creates it with every
-- project; TV-D5 added the Tasks tables to it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END;
$$;
