-- chat_has_cap is internal: close it to signed-in users too.
--
-- 20261008002050 closed chat_has_cap(uuid, uuid, text) to anon but kept
-- authenticated, reading its explicit grant in 20261006210000_perm_sharing.sql as
-- deliberate. Nothing outside SQL calls it: no `.rpc()` in src/,
-- supabase/functions/ or scripts/, and no RLS policy uses it. Every SQL caller
-- is SECURITY DEFINER and owned by postgres: perm_enforce_write, the
-- share_chat_channel_guard and share_chat_message_guard triggers, and the chat
-- ops. Those run as the owner, so caller grants don't apply. Left open, any
-- signed-in user could ask what a member of any workspace may do in its chat:
-- the rehearsal for 20261008002050 got `true` for an outsider. Found by the code
-- review of PR #248.

REVOKE ALL ON FUNCTION public.chat_has_cap(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_has_cap(uuid, uuid, text) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.chat_has_cap(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat_has_cap(uuid, uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.chat_has_cap(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'chat_has_cap grants are not as intended: only postgres and service_role may run it.';
  END IF;
END;
$$;
