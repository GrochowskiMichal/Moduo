-- Drop three chat functions nothing calls any more.
--
-- - `chat__convert_v1(uuid)`: the one-shot v1 → v2 conversion (CV-1). It ran
--   once in …_chat_v2_convert_v1.sql and refuses to run again now that v2 data
--   exists. Server-only.
-- - `chat__v1_tokens(text)`: rewrote v1 composer tokens for the v1 edit
--   wrapper `chat_op_edit(uuid, text, uuid[])` (CV-2a), which prod no longer
--   has. Server-only.
-- - `chat_can_access_workspace(uuid)`: the v1 workspace check. The realtime
--   topic rule and the v1 reads that asked it were redefined without it, and
--   no app, desktop build (every release tag checked) or Edge Function ever
--   called it as an RPC. DB-SEC-1 kept it for older desktop builds; none of
--   them call it.
--
-- Probed on prod 2026-10-23 before writing this: nothing depends on any of the
-- three (pg_depend), and no function body, policy in any schema, view, trigger
-- or cron job references them. `chat__v1_to_v2` and its helpers stay: the
-- connector's `chat_op_agent_post` and the body_text trigger still use them.
-- Re-runnable.
DROP FUNCTION IF EXISTS public.chat__convert_v1(uuid);
DROP FUNCTION IF EXISTS public.chat__v1_tokens(text);
DROP FUNCTION IF EXISTS public.chat_can_access_workspace(uuid);
