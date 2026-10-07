-- PERM sharing follow-ups (review of 20261006210000_perm_sharing.sql):
--
-- 1) Events never got a calendar. Nothing set calendar_events.calendar_ref on
--    new rows (app-created events, Google/Outlook mirror sync, bookings when no
--    calendar existed yet), so anything created after the migration was
--    invisible to shared calendars and free/busy. A BEFORE INSERT trigger now
--    files each event: native → the owner's Moduo calendar, mirrored → the
--    integration calendar of its account (both created on demand). Existing
--    unfiled events are backfilled.
-- 2) Only the 2nd member got a Moduo calendar. Every member who joins a shared
--    workspace now gets one (with the workspace default sharing); connecting a
--    calendar account creates its integration calendar.
-- 3) "Share existing" on an invite shared every item the inviter had Full on —
--    including their private notes in an already-shared workspace. It now
--    shares only items already shared with the workspace, or (when the inviter
--    was alone until now) everything they own.
-- 4) One bad entry in an invite's resource list aborted acceptance (CHECK
--    violation inside workspace_op_accept_invite). Bad entries are skipped.
-- Newest bodies ← 20261006210000_perm_sharing.sql.

-- ── calendars on demand ──────────────────────────────────────────────────────

-- Default workspace grant for a new calendar, only once the workspace is shared.
CREATE OR REPLACE FUNCTION public.share_default_calendar_grant(p_calendar_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ws uuid;
  v_level text;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.calendars WHERE id = p_calendar_id;
  IF v_ws IS NULL OR public.share_member_count(v_ws) < 2 THEN RETURN; END IF;
  v_level := coalesce((SELECT calendars FROM public.workspace_share_defaults WHERE workspace_id = v_ws), 'freebusy');
  IF v_level = 'private' THEN RETURN; END IF;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level)
  VALUES (v_ws, 'calendar', p_calendar_id, 'workspace', v_level)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.share_ensure_moduo_calendar(p_workspace_id uuid, p_owner_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_workspace_id IS NULL OR p_owner_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.calendars
   WHERE workspace_id = p_workspace_id AND owner_id = p_owner_id AND kind = 'moduo' AND deleted_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.calendars (workspace_id, owner_id, name, kind)
  VALUES (p_workspace_id, p_owner_id, 'Moduo', 'moduo')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN  -- lost a race: someone else created it
    SELECT id INTO v_id FROM public.calendars
     WHERE workspace_id = p_workspace_id AND owner_id = p_owner_id AND kind = 'moduo' AND deleted_at IS NULL;
  ELSE
    PERFORM public.share_default_calendar_grant(v_id);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.share_ensure_account_calendar(p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.calendar_accounts;
  v_id uuid;
BEGIN
  IF p_account_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.calendars WHERE account_id = p_account_id AND deleted_at IS NULL LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT * INTO a FROM public.calendar_accounts WHERE id = p_account_id AND deleted_at IS NULL;
  IF a.id IS NULL OR a.owner_id IS NULL OR a.workspace_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.calendars (workspace_id, owner_id, name, kind, account_id)
  VALUES (a.workspace_id, a.owner_id, coalesce(nullif(btrim(a.display_label), ''), 'Calendar'), 'integration', a.id)
  RETURNING id INTO v_id;
  PERFORM public.share_default_calendar_grant(v_id);
  RETURN v_id;
END;
$$;

-- File every new event into a calendar.
CREATE OR REPLACE FUNCTION public.share_event_calendar_ref()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.calendar_ref IS NULL AND NEW.workspace_id IS NOT NULL THEN
    IF NEW.source_account_id IS NOT NULL THEN
      NEW.calendar_ref := public.share_ensure_account_calendar(NEW.source_account_id);
    ELSE
      NEW.calendar_ref := public.share_ensure_moduo_calendar(NEW.workspace_id, NEW.owner_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_event_calendar_ref ON public.calendar_events;
CREATE TRIGGER share_event_calendar_ref
  BEFORE INSERT ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.share_event_calendar_ref();

-- A newly connected account gets its calendar right away (not only on first sync).
CREATE OR REPLACE FUNCTION public.share_account_calendar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    PERFORM public.share_ensure_account_calendar(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS share_account_calendar ON public.calendar_accounts;
CREATE TRIGGER share_account_calendar
  AFTER INSERT ON public.calendar_accounts
  FOR EACH ROW EXECUTE FUNCTION public.share_account_calendar();

-- Backfill: calendars for accounts and every member of shared workspaces,
-- then file every unfiled event (mirror sync and app writes since 20:37).
SELECT public.share_ensure_account_calendar(a.id)
FROM public.calendar_accounts a
WHERE a.deleted_at IS NULL AND a.owner_id IS NOT NULL AND a.workspace_id IS NOT NULL;

SELECT public.share_ensure_moduo_calendar(m.workspace_id, m.user_id)
FROM public.workspace_members m
WHERE public.share_member_count(m.workspace_id) >= 2;

UPDATE public.calendar_events e
   SET calendar_ref = CASE
         WHEN e.source_account_id IS NOT NULL THEN public.share_ensure_account_calendar(e.source_account_id)
         ELSE public.share_ensure_moduo_calendar(e.workspace_id, e.owner_id)
       END
 WHERE e.calendar_ref IS NULL AND e.workspace_id IS NOT NULL AND e.deleted_at IS NULL;

-- ── every joiner gets a calendar ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.share_on_member_joined()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int := public.share_member_count(NEW.workspace_id);
BEGIN
  IF v_count < 2 THEN RETURN NEW; END IF;
  IF v_count = 2 THEN
    -- Becoming a shared workspace: everyone's calendars start at the default.
    PERFORM public.share_ensure_moduo_calendar(NEW.workspace_id, m.user_id)
    FROM public.workspace_members m WHERE m.workspace_id = NEW.workspace_id;
    PERFORM public.share_default_calendar_grant(c.id)
    FROM public.calendars c WHERE c.workspace_id = NEW.workspace_id AND c.deleted_at IS NULL;
  ELSE
    -- Later joiners: only their own new calendar; other people's choices stay.
    PERFORM public.share_ensure_moduo_calendar(NEW.workspace_id, NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── invites ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.share_apply_invite(p_invite_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite public.workspace_invites;
  v_existing text;
  v_item jsonb;
  v_level text;
  v_type text;
  v_id uuid;
  v_was_solo boolean;
BEGIN
  SELECT * INTO v_invite FROM public.workspace_invites WHERE id = p_invite_id;
  IF v_invite.id IS NULL THEN RETURN; END IF;
  -- The joiner's row is already in: two members means the inviter was alone.
  v_was_solo := public.share_member_count(v_invite.workspace_id) <= 2;
  v_existing := coalesce(v_invite.share_payload->>'existing', 'none');

  IF v_existing IN ('view', 'edit') THEN
    INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
    SELECT v_invite.workspace_id, 'note', n.id, 'member', p_user_id, v_existing, v_invite.created_by
    FROM public.notes n
    WHERE n.workspace_id = v_invite.workspace_id AND n.deleted_at IS NULL
      AND public.can_access('note', n.id, 'full', v_invite.created_by)
      AND (v_was_solo OR EXISTS (
            SELECT 1 FROM public.resource_grants g
            WHERE g.resource_type = 'note' AND g.resource_id = n.id AND g.subject_type = 'workspace'))
    ON CONFLICT DO NOTHING;
    INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
    SELECT v_invite.workspace_id, 'bucket', b.id, 'member', p_user_id, v_existing, v_invite.created_by
    FROM public.buckets b
    WHERE b.workspace_id = v_invite.workspace_id AND b.deleted_at IS NULL AND b.is_system = false
      AND public.can_access('bucket', b.id, 'full', v_invite.created_by)
      AND (v_was_solo OR EXISTS (
            SELECT 1 FROM public.resource_grants g
            WHERE g.resource_type = 'bucket' AND g.resource_id = b.id AND g.subject_type = 'workspace'))
    ON CONFLICT DO NOTHING;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(v_invite.share_payload->'resources') = 'array'
           THEN v_invite.share_payload->'resources' ELSE '[]'::jsonb END)
  LOOP
    BEGIN
      v_type := v_item->>'type';
      v_level := coalesce(v_item->>'level', 'view');
      IF v_type NOT IN ('note', 'bucket', 'task', 'calendar', 'contact', 'contact_group', 'channel')
         OR v_level NOT IN ('view', 'edit', 'full', 'freebusy')
         OR (v_level = 'freebusy' AND v_type <> 'calendar') THEN
        CONTINUE;
      END IF;
      v_id := nullif(v_item->>'id', '')::uuid;
      IF v_id IS NULL THEN CONTINUE; END IF;
      IF public.can_access(v_type, v_id, 'full', v_invite.created_by) THEN
        INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
        VALUES (v_invite.workspace_id, v_type, v_id, 'member', p_user_id, v_level, v_invite.created_by)
        ON CONFLICT DO NOTHING;
      END IF;
    EXCEPTION WHEN others THEN
      -- A malformed entry must never stop someone joining.
      CONTINUE;
    END;
  END LOOP;
END;
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'share_default_calendar_grant(uuid)', 'share_ensure_moduo_calendar(uuid, uuid)',
    'share_ensure_account_calendar(uuid)', 'share_event_calendar_ref()', 'share_account_calendar()',
    'share_on_member_joined()', 'share_apply_invite(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;
