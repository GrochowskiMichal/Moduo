-- booking_hosts_set: changing the co-host list kept wiping everyone back to
-- "pending" and pausing the link, so any edit of a collective link (even adding
-- one person) made already-accepted co-hosts accept again. Now:
--   * people who stay keep their status (accepted stays accepted);
--   * only newly added people start as pending;
--   * the link is paused only while someone is still pending or declined;
--   * an empty list turns the link back into a solo link (unchanged).
-- Newest body ← 20261006210000_perm_sharing.sql.

CREATE OR REPLACE FUNCTION public.booking_hosts_set(p_link_id uuid, p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link public.exposed_slot_links;
  v_tier text;
  v_uid uuid;
  v_keep uuid[] := '{}';
BEGIN
  SELECT * INTO v_link FROM public.exposed_slot_links WHERE id = p_link_id AND deleted_at IS NULL;
  IF v_link.id IS NULL OR v_link.owner_user_id IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'You can''t change this booking link.';
  END IF;
  IF coalesce(array_length(p_user_ids, 1), 0) = 0 THEN
    DELETE FROM public.booking_link_hosts WHERE link_id = p_link_id;
    UPDATE public.exposed_slot_links SET collective = false WHERE id = p_link_id;
    RETURN;
  END IF;
  SELECT plan_tier INTO v_tier FROM public.profiles WHERE id = auth.uid();
  IF coalesce(v_tier, 'free') NOT IN ('duo', 'team', 'founder') THEN
    RAISE EXCEPTION 'Collective booking links are on the Duo plan.';
  END IF;

  -- The valid list: members of the link's workspace, never the owner.
  FOREACH v_uid IN ARRAY p_user_ids LOOP
    IF v_uid IS NULL OR v_uid = auth.uid() OR v_uid = ANY (v_keep) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = v_link.workspace_id::uuid AND m.user_id = v_uid
    ) THEN CONTINUE; END IF;
    v_keep := v_keep || v_uid;
  END LOOP;

  DELETE FROM public.booking_link_hosts
   WHERE link_id = p_link_id AND NOT (user_id = ANY (v_keep));
  INSERT INTO public.booking_link_hosts (link_id, user_id, status)
  SELECT p_link_id, u, 'pending' FROM unnest(v_keep) AS u
  ON CONFLICT DO NOTHING;

  UPDATE public.exposed_slot_links
     SET collective = coalesce(array_length(v_keep, 1), 0) > 0,
         paused = CASE
           WHEN EXISTS (SELECT 1 FROM public.booking_link_hosts h
                         WHERE h.link_id = p_link_id AND h.status IN ('pending', 'declined'))
             THEN true
           ELSE paused
         END
   WHERE id = p_link_id;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_hosts_set(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_hosts_set(uuid, uuid[]) TO authenticated, service_role;
