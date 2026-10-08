-- What production has on tasks beyond the TV-D2 stub chain that
-- 20261008224500_tasks_time_entries.sql must coexist with (project
-- wtoonrvuqumihpkbvwvs, pg_get_functiondef, 2026-10-09): TV-D5's server-side
-- updated_at stamp (applied as 20261008220401_tasks_server_updated_at, its file
-- still on TV-D5's branch). Every insert and update of a task, bucket or tag
-- gets the server's clock, after every other BEFORE trigger (the zz_ name).
-- AT-1's triggers come from its own stub + migration
-- (supabase/probes/attachments.stub.sql, 20261008210500_attachments_storage.sql).

CREATE OR REPLACE FUNCTION public.tasks_stamp_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();
