-- Drop two permission wrappers nothing calls any more.
--
-- - `perm_has(uuid, text)`: PERM-1's "does the caller hold this key" wrapper
--   over `perm_user_has(ws, perm_actor_id(), key)`. Nothing has ever called it:
--   no function body, policy or client in any branch or release. Policies use
--   `perm_i_have`, and server code calls `perm_user_has` directly.
-- - `share_can(text, uuid, text)`: a client wrapper over
--   `can_access(type, id, min, perm_actor_id())`. The notes live channel called
--   it from PERM-2b (2026-10-06) until NR-7 moved that check to the server
--   (2026-10-16). Every build from 1.0.21 (`app_settings.min_build`) is past
--   NR-7; older builds are held read-only. DB-SEC-1 kept it for older builds;
--   min_build now covers that.
--
-- Probed on prod 2026-10-23 before writing this: nothing depends on either. No
-- function body, policy (any schema), view or cron job references them, and
-- no current code calls them. Open branches cut before NR-7 (Maciej's TX-8,
-- TX-9a, TV-F2, PRIV-2d; Mike's #344, #345) still carry the old call from
-- their base; none touch that file, so a merge drops it. Re-runnable.
DROP FUNCTION IF EXISTS public.perm_has(uuid, text);
DROP FUNCTION IF EXISTS public.share_can(text, uuid, text);
