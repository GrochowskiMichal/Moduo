-- Session 8 follow-up: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on
-- new functions to anon/authenticated/service_role, so REVOKE FROM PUBLIC in
-- the previous migration left the intent-op functions anon-executable
-- (surfaced by the security advisor). The ops self-reject without auth.uid(),
-- but module_activity_log must never be reachable by anon — revoke explicitly.

REVOKE ALL ON FUNCTION public.module_activity_log(uuid, text, text, uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op__guard(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_module_permission(uuid) FROM anon;

REVOKE ALL ON FUNCTION public.tasks_op_commit(uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op_uncommit(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op_skip_today(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op_set_status(uuid, uuid, text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op_reschedule(uuid, uuid, timestamptz, integer) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op_unschedule(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op_skip_occurrence(uuid, uuid, timestamptz, jsonb, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.tasks_op_catch_up(uuid, jsonb) FROM anon;
