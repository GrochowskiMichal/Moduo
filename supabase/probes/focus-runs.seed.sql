-- Data for supabase/probes/focus-runs.probe.sql (TV-F2), on top of the TV-D3
-- probe chain (people O, A, B, V, N, X; workspace W with the shared buckets
-- SB/SB2 and Bea's private PB; Nell's workspace WN; Ada's key K).

SET timezone = 'UTC';

DO $$
BEGIN
  -- Ada's private bucket: only Ada can see what's in it.
  INSERT INTO public.buckets (id, workspace_id, owner_id, name)
  VALUES (probe.id('PA'), probe.id('W'), probe.id('A'), 'Ada private');
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = probe.id('PA');

  PERFORM probe.new_task('R1 shared', 'A', 'A');
  PERFORM probe.new_task('R2 shared', 'A', 'A');
  PERFORM probe.new_task('R3 Ada private', 'A', 'A', 'PA');
  PERFORM probe.new_task('R4 Bea private', 'B', 'B', 'PB');
  PERFORM probe.new_task('R5 Nell''s', 'N', 'N', 'NB', 'WN');
  PERFORM probe.new_task('R6 Xavier''s', 'A', 'X');

  -- Ada's line-up: R1, R2.
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('R1 shared'));
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('R2 shared'));
  -- Bea's: R2.
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('R2 shared'));
  PERFORM probe.as_system();
  -- Lined up long ago.
  UPDATE public.task_queue SET updated_at = now() - interval '4 days', queued_at = now() - interval '4 days';
END;
$$;
