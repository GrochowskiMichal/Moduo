-- Data that exists before 20261008225500_tasks_time_entries.sql runs, for
-- supabase/probes/tasks-time.probe.sql (TV-D3). It goes on top of the TV-D2
-- probe's stub chain and seed (people O, A, B, V, N, X; workspace W with the
-- shared buckets SB/SB2 and Bea's private PB; Nell's workspace WN; Ada's key
-- K), the way production held time until now: one absolute total per task,
-- tasks.time_spent_seconds.

-- Production runs in UTC; the probe compares these timestamps as text.
SET timezone = 'UTC';

DO $$
BEGIN
  PERFORM probe.new_task('T1 ninety minutes', 'A', 'A');
  PERFORM probe.new_task('T2 no time yet', 'A', 'A');
  PERFORM probe.new_task('T3 trashed', 'A', 'A');
  PERFORM probe.new_task('T4 Bea private', 'B', 'B', 'PB');
  PERFORM probe.new_task('T5 Nell''s', 'N', 'N', 'NB', 'WN');
  PERFORM probe.new_task('T6 old builds', 'A', 'A');
  PERFORM probe.new_task('T7 whole-row saves', 'B', 'B');
  PERFORM probe.new_task('T8 deleted for good', 'A', 'A');
  PERFORM probe.new_task('T9 Xavier works', 'A', 'X');

  -- Totals the old way (system writes: no shim exists yet anyway).
  UPDATE public.tasks SET time_spent_seconds = 5400 WHERE id = probe.id('T1 ninety minutes');
  UPDATE public.tasks SET time_spent_seconds = 600, deleted_at = now() WHERE id = probe.id('T3 trashed');
  UPDATE public.tasks SET time_spent_seconds = 300 WHERE id = probe.id('T4 Bea private');
  UPDATE public.tasks SET time_spent_seconds = 1200 WHERE id = probe.id('T6 old builds');
  UPDATE public.tasks SET time_spent_seconds = 1000 WHERE id = probe.id('T7 whole-row saves');
  UPDATE public.tasks SET time_spent_seconds = 45 WHERE id = probe.id('T8 deleted for good');
END;
$$;

-- What the migration must leave alone.
CREATE TABLE probe.time_before AS
SELECT (SELECT count(*) FROM public.module_activity) AS activity,
       (SELECT jsonb_object_agg(id, jsonb_build_array(time_spent_seconds, updated_at, title)) FROM public.tasks) AS tasks;
