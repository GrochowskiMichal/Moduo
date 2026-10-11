-- TV-D5 · The server stamps updated_at on tasks, buckets and tags.
--
-- Live updates (20261008223000_tasks_realtime_publication.sql) decide which of
-- two versions of a row is newer by updated_at. Until now a client-direct
-- write (field edits, bucket/tag saves, deletes, the focus time total) sent
-- the writing device's clock while the tasks_op_* ops used the server's, so a
-- device whose clock runs ahead made its rows look newer than later changes:
-- open apps then dropped a teammate's later change (or your own later status
-- op) until the next refetch. Stamping every insert and update here with the
-- database clock puts all versions on one clock. clock_timestamp(), not now():
-- of two overlapping transactions, the one that writes the row later gets the
-- later stamp, whatever order they started in.
--
-- Old builds still send updated_at; the stamp quietly replaces it. No reader
-- compares a sent updated_at with the stored one. created_at is untouched.
-- The trigger is named to run after the other BEFORE triggers (they fire in
-- name order), so nothing after it changes the row.

CREATE OR REPLACE FUNCTION public.tasks_stamp_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tasks_stamp_updated_at() IS
  'TV-D5: stamps updated_at with the database clock on tasks, buckets and tags, so live updates compare versions on one clock.';

REVOKE ALL ON FUNCTION public.tasks_stamp_updated_at() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'buckets', 'tags'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at()', t);
  END LOOP;
END;
$$;
