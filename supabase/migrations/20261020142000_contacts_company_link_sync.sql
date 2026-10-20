-- A contact's company and its works-at link stay in step, whoever writes them.
--
-- A contact's company lives twice: contacts.company_id (the header chip, the
-- directory column) and a works-at link between the contact and the company
-- (the spine: hubs, Links, search). Only the Contacts page kept the two in
-- step, with separate calls per gesture. Everything else wrote one half:
-- contacts_op_link from the MCP connector made the link but never set
-- company_id, so an agent's "works at" never showed in the app, and a failed
-- second call in the page left the halves apart.
--
-- The rule now lives in the database, so every writer (app, MCP, import,
-- Links) keeps it, in the same transaction as its own write. One company per
-- contact, as the app shows it:
--   * company_id set or changed (contacts_op_create, contacts_op_update, an
--     import): a live works-at link to the new company is made if missing, and
--     works-at links to the company it replaced are removed (soft delete).
--   * a live works-at link between a contact and a company appears (any op,
--     either direction, a restored link, or a link whose kind changes to
--     works-at): company_id becomes that company.
--   * the live works-at link to a contact's current company is removed (or
--     its kind changes away from works-at):
--     company_id becomes another company it still has a live works-at link to
--     (the newest), or NULL.
-- Each side only acts when the other is out of step, so the two triggers stop
-- after one round. The writes run with the actor of the op that started them,
-- so the permission trigger on contacts still applies. A trashed contact is
-- left as it is (it keeps its company for a restore), and a link writer who
-- can't edit the contact gets the link without moving the contact's company.
-- Trigger-made changes write the activity entries the page's calls used to.
--
-- Backfill: contacts without a company but with a live works-at link get the
-- newest one's company; contacts with a company but no live link to it get the
-- link. Nothing is removed by the backfill.
--
-- Verified on the local stack by supabase/tests/contacts_company_link.test.sql.

-- The company a contact has a live works-at link to, newest first.
CREATE OR REPLACE FUNCTION public.contacts__works_at_company(p_workspace_id uuid, p_contact_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN l.source_type = 'company' THEN l.source_id ELSE l.target_id END
  FROM public.entity_links l
  JOIN public.companies co
    ON co.id = CASE WHEN l.source_type = 'company' THEN l.source_id ELSE l.target_id END
   AND co.workspace_id = p_workspace_id
   AND co.deleted_at IS NULL
  WHERE l.workspace_id = p_workspace_id
    AND l.relation_kind = 'works-at'
    AND l.deleted_at IS NULL
    AND ((l.source_type = 'contact' AND l.source_id = p_contact_id AND l.target_type = 'company')
      OR (l.target_type = 'contact' AND l.target_id = p_contact_id AND l.source_type = 'company'))
  ORDER BY l.created_at DESC, l.id
  LIMIT 1
$function$;

-- company_id → links.
CREATE OR REPLACE FUNCTION public.contacts__company_to_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old uuid := CASE WHEN TG_OP = 'UPDATE' THEN OLD.company_id ELSE NULL END;
  v_company_name text;
  v_actor uuid;
  v_link_id uuid;
BEGIN
  -- A trashed contact keeps its company as it was (restore brings it back).
  IF NEW.company_id IS NOT DISTINCT FROM v_old OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_old IS NOT NULL THEN
    UPDATE public.entity_links l
      SET deleted_at = now()
      WHERE l.workspace_id = NEW.workspace_id
        AND l.relation_kind = 'works-at'
        AND l.deleted_at IS NULL
        AND l.pair_key = public.spine_pair_key('contact', NEW.id, 'company', v_old);
  END IF;

  IF NEW.company_id IS NOT NULL THEN
    SELECT co.name INTO v_company_name
    FROM public.companies co
    WHERE co.id = NEW.company_id AND co.workspace_id = NEW.workspace_id AND co.deleted_at IS NULL;
    IF FOUND THEN
      v_actor := coalesce(public.perm_actor_id(), NEW.owner_id,
        (SELECT w.owner_id FROM public.workspaces w WHERE w.id = NEW.workspace_id));
      PERFORM public.entities_op_ensure(NEW.workspace_id, 'contact', NEW.id, NEW.name, NULL);
      PERFORM public.entities_op_ensure(NEW.workspace_id, 'company', NEW.company_id, v_company_name, 'building-2');
      INSERT INTO public.entity_links
        (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
      VALUES
        (NEW.workspace_id, 'contact', NEW.id, 'company', NEW.company_id, 'works-at', 'manual', v_actor)
      ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
      DO NOTHING
      RETURNING id INTO v_link_id;
      -- The feed shows it as the page's own link call used to ("linked a workplace").
      IF v_link_id IS NOT NULL AND public.perm_actor_id() IS NOT NULL THEN
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'contacts', 'contact', NEW.id, 'contacts.link',
          jsonb_build_object('link_id', v_link_id, 'target_type', 'company', 'target_id', NEW.company_id,
                             'relation_kind', 'works-at', 'origin', 'manual'));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.contacts__company_to_link() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_company_to_link ON public.contacts;
CREATE TRIGGER contacts_company_to_link
  AFTER INSERT OR UPDATE OF company_id ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts__company_to_link();

-- links → company_id.
CREATE OR REPLACE FUNCTION public.entity_links__works_at_to_company()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact uuid;
  v_company uuid;
  v_current uuid;
  v_next uuid;
  v_actor uuid;
  v_live_now boolean := NEW.deleted_at IS NULL AND NEW.relation_kind = 'works-at';
  v_live_before boolean := CASE WHEN TG_OP = 'UPDATE'
    THEN OLD.deleted_at IS NULL AND OLD.relation_kind = 'works-at' ELSE false END;
BEGIN
  IF v_live_now = v_live_before THEN
    RETURN NEW;
  END IF;
  IF NEW.source_type = 'contact' AND NEW.target_type = 'company' THEN
    v_contact := NEW.source_id;
    v_company := NEW.target_id;
  ELSIF NEW.source_type = 'company' AND NEW.target_type = 'contact' THEN
    v_contact := NEW.target_id;
    v_company := NEW.source_id;
  ELSE
    RETURN NEW;
  END IF;

  -- Only a live contact: deleting one trashes it first, then its links, and
  -- the trashed contact keeps its company for a restore.
  SELECT c.company_id INTO v_current
  FROM public.contacts c
  WHERE c.id = v_contact AND c.workspace_id = NEW.workspace_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- The link is the writer's to make (Links checks it); the company is the
  -- contact's, so it moves only for someone who can edit the contact.
  v_actor := public.perm_actor_id();
  IF v_actor IS NOT NULL AND NOT public.can_access('contact', v_contact, 'edit', v_actor) THEN
    RETURN NEW;
  END IF;

  IF v_live_now THEN
    -- Only a live company of this workspace the actor can open, as
    -- contacts_op__guard_company asks of Set company.
    IF v_current IS DISTINCT FROM v_company
       AND EXISTS (SELECT 1 FROM public.companies co
                   WHERE co.id = v_company AND co.workspace_id = NEW.workspace_id
                     AND co.deleted_at IS NULL)
       AND (v_actor IS NULL OR public.can_access('company', v_company, 'view', v_actor)) THEN
      v_next := v_company;
    ELSE
      RETURN NEW;
    END IF;
  ELSIF v_current = v_company THEN
    v_next := public.contacts__works_at_company(NEW.workspace_id, v_contact);
    IF v_next IS NOT DISTINCT FROM v_current THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  UPDATE public.contacts SET company_id = v_next, updated_at = now() WHERE id = v_contact;
  IF v_actor IS NOT NULL THEN
    PERFORM public.module_activity_log(
      NEW.workspace_id, 'contacts', 'contact', v_contact, 'contacts.update',
      jsonb_build_object('company_id', v_next, 'via_link', NEW.id));
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.entity_links__works_at_to_company() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contacts__works_at_company(uuid, uuid) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS entity_links_works_at_to_company ON public.entity_links;
CREATE TRIGGER entity_links_works_at_to_company
  AFTER INSERT OR UPDATE OF deleted_at, relation_kind ON public.entity_links
  FOR EACH ROW EXECUTE FUNCTION public.entity_links__works_at_to_company();

-- Backfill (a function, so the test can run it on seeded rows). Contacts with
-- no company but a live works-at link take the newest one's company (the
-- company_id trigger then finds the link already there); contacts with a live
-- company but no live link to it get the link. It only adds; it never removes.
CREATE OR REPLACE FUNCTION public.contacts__company_link_backfill()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  UPDATE public.contacts c
    SET company_id = public.contacts__works_at_company(c.workspace_id, c.id)
    WHERE c.company_id IS NULL
      AND c.deleted_at IS NULL
      AND public.contacts__works_at_company(c.workspace_id, c.id) IS NOT NULL;

  FOR r IN
    SELECT c.id, c.workspace_id, c.name, c.company_id, co.name AS company_name,
           coalesce(c.owner_id, w.owner_id) AS actor
    FROM public.contacts c
    JOIN public.companies co ON co.id = c.company_id AND co.workspace_id = c.workspace_id
                            AND co.deleted_at IS NULL
    JOIN public.workspaces w ON w.id = c.workspace_id
    WHERE c.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.entity_links l
        WHERE l.workspace_id = c.workspace_id
          AND l.relation_kind = 'works-at'
          AND l.deleted_at IS NULL
          AND l.pair_key = public.spine_pair_key('contact', c.id, 'company', c.company_id))
  LOOP
    PERFORM public.entities_op_ensure(r.workspace_id, 'contact', r.id, r.name, NULL);
    PERFORM public.entities_op_ensure(r.workspace_id, 'company', r.company_id, r.company_name, 'building-2');
    INSERT INTO public.entity_links
      (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
    VALUES
      (r.workspace_id, 'contact', r.id, 'company', r.company_id, 'works-at', 'manual', r.actor)
    ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
    DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.contacts__company_link_backfill() FROM PUBLIC, anon, authenticated;

SELECT public.contacts__company_link_backfill();
