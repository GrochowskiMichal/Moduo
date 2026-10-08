-- PERM sharing follow-ups, part 2 (frontend/connector review):
--
-- 1) Workspaces created after 20261006210000 got no workspace_chat_caps or
--    workspace_share_defaults rows: chat_has_cap() returned false (nobody but
--    the owner could post or create channels) and the Defaults panel never
--    loaded. Both are now seeded when a workspace is created, and backfilled.
-- 2) share_visible_ids() had no bucket/company branch, so the MCP connector
--    couldn't filter bucket lists or company lookups by sharing.
-- Newest body ← 20261006210000_perm_sharing.sql.

CREATE OR REPLACE FUNCTION public.share_seed_workspace()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.workspace_share_defaults (workspace_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.workspace_chat_caps (
    workspace_id, role_key, create_public, create_private, manage_any, delete_others, mention_everyone, post, start_calls
  )
  SELECT NEW.id, r.role_key,
    r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key = 'admin', r.role_key = 'admin',
    r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key <> 'viewer'
  FROM (VALUES ('admin'), ('member'), ('viewer')) AS r(role_key)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_seed_workspace ON public.workspaces;
CREATE TRIGGER share_seed_workspace
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.share_seed_workspace();

INSERT INTO public.workspace_share_defaults (workspace_id)
SELECT id FROM public.workspaces
ON CONFLICT DO NOTHING;

INSERT INTO public.workspace_chat_caps (
  workspace_id, role_key, create_public, create_private, manage_any, delete_others, mention_everyone, post, start_calls
)
SELECT w.id, r.role_key,
  r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key = 'admin', r.role_key = 'admin',
  r.role_key <> 'viewer', r.role_key <> 'viewer', r.role_key <> 'viewer'
FROM public.workspaces w
CROSS JOIN (VALUES ('admin'), ('member'), ('viewer')) AS r(role_key)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.share_visible_ids(p_workspace_id uuid, p_resource_type text)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := public.perm_actor_id();
BEGIN
  IF p_resource_type = 'note' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.notes n
      WHERE n.workspace_id = p_workspace_id AND public.can_access('note', n.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'task' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.tasks t
      WHERE t.workspace_id = p_workspace_id AND public.can_access('task', t.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'bucket' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.buckets b
      WHERE b.workspace_id = p_workspace_id AND b.deleted_at IS NULL
        AND public.can_access('bucket', b.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'contact' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND public.can_access('contact', c.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'company' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.companies c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND public.can_access('company', c.id, 'view', v_user)), '{}');
  ELSIF p_resource_type = 'calendar' THEN
    RETURN coalesce((SELECT array_agg(id) FROM public.calendars c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND public.can_access('calendar', c.id, 'view', v_user)), '{}');
  ELSE
    RETURN '{}';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.share_visible_ids(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_visible_ids(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.share_seed_workspace() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_seed_workspace() TO service_role;
