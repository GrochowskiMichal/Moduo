-- booking_host_respond: only a host who has just answered can un-pause the link.
--
-- booking_host_respond(p_link_id, p_accept) records the caller's answer to a
-- collective booking link, then un-pauses the link once no host is pending or
-- declined. The second step didn't depend on the first. Any signed-in user could
-- call it with any link id, change no answer, and still un-pause a link whose
-- hosts had all accepted, including one its owner had paused by hand (the
-- "Paused" switch) or deleted. Now the un-pause runs only when the caller's own
-- pending answer was just recorded, and never on a deleted link. A host who
-- re-clicks after answering changes nothing, as before. Found 2026-10-08 during
-- the SEC-1 sweep of SECURITY DEFINER functions.
--
-- Same signature and return type, so CREATE OR REPLACE keeps the grants: the
-- app calls this as a signed-in host, so authenticated keeps EXECUTE and anon
-- doesn't get it (asserted below). Supersedes the body in
-- 20261006210000_perm_sharing.sql.

CREATE OR REPLACE FUNCTION public.booking_host_respond(p_link_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.booking_link_hosts
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
  WHERE link_id = p_link_id AND user_id = auth.uid() AND status = 'pending';
  -- Not a pending host of this link: nothing to record, nothing to move on.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.booking_link_hosts WHERE link_id = p_link_id AND status = 'pending'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.booking_link_hosts WHERE link_id = p_link_id AND status = 'declined'
  ) THEN
    UPDATE public.exposed_slot_links SET paused = false
    WHERE id = p_link_id AND collective = true AND deleted_at IS NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.booking_host_respond(uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.booking_host_respond(uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.booking_host_respond(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'booking_host_respond grants drifted: authenticated and service_role must have EXECUTE, anon must not.';
  END IF;
END;
$$;
