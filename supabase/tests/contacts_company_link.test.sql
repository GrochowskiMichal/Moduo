-- A contact's company (contacts.company_id) and its works-at link stay in
-- step, whoever writes either one
-- (supabase/migrations/20261020142000_contacts_company_link_sync.sql).
--
-- Cast: O owns workspace W, with companies Acme and Bolt and contacts Ada,
-- Grace and Linus. E is a member with a contact of her own, Eve; O's
-- companies stay private to O (a new company is its creator's). K is O's
-- workspace key with Contacts edit, the way the MCP connector calls.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('E'), 'member');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_k', md5('db-test-k'),
   '{"contacts": "edit", "links": "edit"}'::jsonb, test.id('O'));

-- Rows are found by name: the ops pick their own ids.
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.contacts WHERE workspace_id = test.id('W') AND name = p_name
  UNION ALL
  SELECT id FROM public.companies WHERE workspace_id = test.id('W') AND name = p_name
  LIMIT 1
$$;
CREATE FUNCTION test.company_of(p_contact text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT company_id FROM public.contacts WHERE id = test.ref(p_contact)
$$;
-- The companies a contact has a live works-at link to, either direction.
CREATE FUNCTION test.works_at(p_contact text) RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(CASE WHEN source_type = 'company' THEN source_id ELSE target_id END ORDER BY created_at), '{}')
  FROM public.entity_links
  WHERE workspace_id = test.id('W') AND relation_kind = 'works-at' AND deleted_at IS NULL
    AND ((source_type = 'contact' AND source_id = test.ref(p_contact) AND target_type = 'company')
      OR (target_type = 'contact' AND target_id = test.ref(p_contact) AND source_type = 'company'))
$$;
CREATE FUNCTION test.link_id(p_contact text, p_company text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.entity_links
  WHERE workspace_id = test.id('W') AND relation_kind = 'works-at' AND deleted_at IS NULL
    AND pair_key = public.spine_pair_key('contact', test.ref(p_contact), 'company', test.ref(p_company))
$$;

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.as_user('O', format($q$SELECT public.companies_op_create(%L, 'Acme')$q$, test.id('W')));
  PERFORM test.as_user('O', format($q$SELECT public.companies_op_create(%L, 'Bolt')$q$, test.id('W')));

  -- Created with a company: one call, both halves.
  r := test.as_user('O', format($q$SELECT public.contacts_op_create(%L, 'Ada', p_company_id => %L)$q$,
    test.id('W'), test.ref('Acme')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Ada') = test.ref('Acme') AND test.works_at('Ada') = ARRAY[test.ref('Acme')],
    'a contact created with a company also gets the works-at link', r);

  -- Set company: the new company replaces the old one, on both halves.
  r := test.as_user('O', format($q$SELECT public.contacts_op_update(%L, %L, p_set_company => true, p_company_id => %L)$q$,
    test.id('W'), test.ref('Ada'), test.ref('Bolt')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Ada') = test.ref('Bolt') AND test.works_at('Ada') = ARRAY[test.ref('Bolt')],
    'changing the company moves the works-at link with it', r);

  -- Clear company: the link goes too.
  r := test.as_user('O', format($q$SELECT public.contacts_op_update(%L, %L, p_set_company => true, p_company_id => NULL)$q$,
    test.id('W'), test.ref('Ada')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Ada') IS NULL AND test.works_at('Ada') = '{}',
    'clearing the company removes the works-at link', r);

  -- An agent links a contact to a company (MCP contacts_link): the app sees it.
  PERFORM test.as_user('O', format($q$SELECT public.contacts_op_create(%L, 'Grace')$q$, test.id('W')));
  r := test.as_key('K', format($q$SELECT public.contacts_op_link(%L, 'contact', %L, 'company', %L, 'works-at')$q$,
    test.id('W'), test.ref('Grace'), test.ref('Acme')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') = test.ref('Acme'),
    'a works-at link made through a key sets the contact''s company', r);

  -- A link to another company replaces the first, as Set company does.
  r := test.as_user('O', format($q$SELECT public.links_op_create(%L, 'company', %L, 'contact', %L, 'works-at')$q$,
    test.id('W'), test.ref('Bolt'), test.ref('Grace')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') = test.ref('Bolt') AND test.works_at('Grace') = ARRAY[test.ref('Bolt')],
    'a works-at link from the company''s side, through Links, moves the company and replaces the old link', r);

  -- Removing the current company's link clears the company.
  r := test.as_key('K', format($q$SELECT public.contacts_op_unlink(%L, %L)$q$, test.id('W'), test.link_id('Grace', 'Bolt')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') IS NULL AND test.works_at('Grace') = '{}',
    'unlinking the company through a key clears the contact''s company', r);

  -- Restoring the link (Undo) brings the company back.
  UPDATE public.entity_links SET deleted_at = NULL
    WHERE id = (SELECT id FROM public.entity_links
                WHERE pair_key = public.spine_pair_key('contact', test.ref('Grace'), 'company', test.ref('Bolt'))
                  AND relation_kind = 'works-at' ORDER BY deleted_at DESC LIMIT 1);
  PERFORM test.ok(test.company_of('Grace') = test.ref('Bolt'), 'a restored works-at link brings the company back');

  -- A link that stops being works-at no longer names the company.
  r := test.as_user('O', format($q$SELECT public.links_op_set_kind(%L, %L, 'references')$q$,
    test.id('W'), (SELECT id FROM public.entity_links
                   WHERE pair_key = public.spine_pair_key('contact', test.ref('Grace'), 'company', test.ref('Bolt'))
                     AND deleted_at IS NULL)));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') IS NULL,
    'changing the link''s kind away from works-at clears the company', r);
  r := test.as_user('O', format($q$SELECT public.links_op_set_kind(%L, %L, 'works-at')$q$,
    test.id('W'), (SELECT id FROM public.entity_links
                   WHERE pair_key = public.spine_pair_key('contact', test.ref('Grace'), 'company', test.ref('Bolt'))
                     AND deleted_at IS NULL)));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') = test.ref('Bolt'),
    'and changing it back to works-at sets it again', r);

  -- Other kinds of link between a contact and a company leave the company alone.
  r := test.as_user('O', format($q$SELECT public.contacts_op_link(%L, 'contact', %L, 'company', %L, 'references')$q$,
    test.id('W'), test.ref('Grace'), test.ref('Acme')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') = test.ref('Bolt'),
    'a references link to another company doesn''t change the contact''s company', r);

  -- A company the linker can't open never becomes the contact's company.
  PERFORM test.as_user('E', format($q$SELECT public.contacts_op_create(%L, 'Eve')$q$, test.id('W')));
  PERFORM test.ok(NOT public.can_access('company', test.ref('Acme'), 'view', test.id('E')),
    'setup: E can''t open Acme');
  r := test.as_user('E', format($q$SELECT public.contacts_op_link(%L, 'contact', %L, 'company', %L, 'works-at')$q$,
    test.id('W'), test.ref('Eve'), test.ref('Acme')));
  PERFORM test.ok(r = 'ok 1' AND test.works_at('Eve') = ARRAY[test.ref('Acme')] AND test.company_of('Eve') IS NULL,
    'a works-at link to a company the linker can''t open doesn''t set the company', r);
END;
$$;

-- Data from before the rule: a contact with works-at links to two companies.
-- Removing the current one falls back to the other, not to nothing.
ALTER TABLE public.entity_links DISABLE TRIGGER entity_links_works_at_to_company;
ALTER TABLE public.contacts DISABLE TRIGGER contacts_company_to_link;
INSERT INTO public.contacts (id, workspace_id, owner_id, name, company_id)
  VALUES (test.id('C3'), test.id('W'), test.id('O'), 'Linus', test.ref('Bolt'));
INSERT INTO public.entities (workspace_id, entity_type, entity_id, label)
  VALUES (test.id('W'), 'contact', test.id('C3'), 'Linus');
INSERT INTO public.entity_links (workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by, created_at)
VALUES (test.id('W'), 'contact', test.ref('Linus'), 'company', test.ref('Acme'), 'works-at', test.id('O'), now() - interval '2 days'),
       (test.id('W'), 'contact', test.ref('Linus'), 'company', test.ref('Bolt'), 'works-at', test.id('O'), now() - interval '1 day');
ALTER TABLE public.entity_links ENABLE TRIGGER entity_links_works_at_to_company;
ALTER TABLE public.contacts ENABLE TRIGGER contacts_company_to_link;

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.links_op_delete(%L, %L)$q$, test.id('W'), test.link_id('Linus', 'Bolt')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Linus') = test.ref('Acme') AND test.works_at('Linus') = ARRAY[test.ref('Acme')],
    'removing the current company''s link falls back to another live works-at link', r);

  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.contacts__works_at_company(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.contacts__works_at_company(uuid, uuid)', 'EXECUTE'),
    'the helper is not callable from the app');
END;
$$;

-- Trash and restore, merge, and writers who can't edit the contact.
DO $$
DECLARE
  r text;
BEGIN
  -- Deleting a contact with a company works, and a restore brings both halves back.
  PERFORM test.as_user('O', format($q$SELECT public.contacts_op_create(%L, 'Zed', p_company_id => %L)$q$,
    test.id('W'), test.ref('Acme')));
  r := test.as_user('O', format($q$SELECT public.contacts_op_delete(%L, %L)$q$, test.id('W'), test.ref('Zed')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT deleted_at IS NOT NULL FROM public.contacts WHERE name = 'Zed'
                                    AND workspace_id = test.id('W'))
              AND test.company_of('Zed') = test.ref('Acme'),
    'a contact with a company can be deleted, and keeps its company in the trash', r);
  -- contacts_op_restore's own writes (it is refused on this stack for an
  -- unrelated reason): the contact comes back, then the links trashed with it.
  UPDATE public.contacts SET deleted_at = NULL WHERE id = test.ref('Zed');
  UPDATE public.entity_links SET deleted_at = NULL
    WHERE workspace_id = test.id('W') AND deleted_at IS NOT NULL
      AND pair_key = public.spine_pair_key('contact', test.ref('Zed'), 'company', test.ref('Acme'));
  PERFORM test.ok(test.company_of('Zed') = test.ref('Acme') AND test.works_at('Zed') = ARRAY[test.ref('Acme')],
    'restoring it brings back the company and its works-at link');

  -- A contact merged away (trashed, its links left live) doesn't block deleting its company.
  PERFORM test.as_user('O', format($q$SELECT public.companies_op_create(%L, 'Cobalt')$q$, test.id('W')));
  PERFORM test.as_user('O', format($q$SELECT public.contacts_op_create(%L, 'Mia', 'mia@example.com', p_company_id => %L)$q$,
    test.id('W'), test.ref('Cobalt')));
  PERFORM test.as_user('O', format($q$SELECT public.contacts_op_create(%L, 'Mia K', 'mia@example.com', p_company_id => %L)$q$,
    test.id('W'), test.ref('Cobalt')));
  r := test.as_user('O', format($q$SELECT public.contact_merge(%L, %L)$q$, test.ref('Mia'), test.ref('Mia K')));
  PERFORM test.ok(r = 'ok 1', 'setup: the duplicate is merged away', r);
  r := test.as_user('O', format($q$SELECT public.companies_op_delete(%L, %L)$q$, test.id('W'), test.ref('Cobalt')));
  PERFORM test.ok(r = 'ok 1', 'the company of a merged-away contact can still be deleted', r);

  -- Activity: Set company writes the "linked a workplace" entry the page's call used to.
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity
                          WHERE entity_id = test.ref('Zed') AND op = 'contacts.link'),
    'a link made with the company is in the activity feed');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity
                          WHERE entity_id = test.ref('Grace') AND op = 'contacts.update'),
    'a company moved by a link is in the activity feed');

  -- E can't edit O's contact Grace. E's works-at link to E's own company is
  -- E's to make; Grace's company stays as it is. The same for removing a link.
  PERFORM test.ok(NOT public.can_access('contact', test.ref('Grace'), 'edit', test.id('E')),
    'setup: E can''t edit Grace');
  PERFORM test.as_user('E', format($q$SELECT public.companies_op_create(%L, 'Eve Co')$q$, test.id('W')));
  r := test.as_user('E', format($q$SELECT public.links_op_create(%L, 'contact', %L, 'company', %L, 'works-at')$q$,
    test.id('W'), test.ref('Grace'), test.ref('Eve Co')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') = test.ref('Bolt'),
    'a works-at link by someone who can''t edit the contact is made, without moving its company', r);
  r := test.as_user('E', format($q$SELECT public.links_op_delete(%L, %L)$q$, test.id('W'), test.link_id('Grace', 'Bolt')));
  PERFORM test.ok(r = 'ok 1' AND test.company_of('Grace') = test.ref('Bolt'),
    'and removing one is allowed, without clearing its company', r);
END;
$$;

-- The backfill only adds. Seeded with the triggers off, as data from before the rule.
ALTER TABLE public.entity_links DISABLE TRIGGER entity_links_works_at_to_company;
ALTER TABLE public.contacts DISABLE TRIGGER contacts_company_to_link;
INSERT INTO public.contacts (id, workspace_id, owner_id, name, company_id) VALUES
  (test.id('P1'), test.id('W'), test.id('O'), 'Link only', NULL),
  (test.id('P2'), test.id('W'), test.id('O'), 'Company only', test.ref('Acme'));
INSERT INTO public.entities (workspace_id, entity_type, entity_id, label) VALUES
  (test.id('W'), 'contact', test.id('P1'), 'Link only');
INSERT INTO public.entity_links (workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by)
VALUES (test.id('W'), 'company', test.ref('Bolt'), 'contact', test.id('P1'), 'works-at', test.id('O'));
ALTER TABLE public.entity_links ENABLE TRIGGER entity_links_works_at_to_company;
ALTER TABLE public.contacts ENABLE TRIGGER contacts_company_to_link;

CREATE TABLE test.before_backfill AS
  SELECT id FROM public.entity_links WHERE deleted_at IS NULL
  UNION ALL SELECT id FROM public.contacts WHERE deleted_at IS NULL;

SELECT public.contacts__company_link_backfill();

DO $$
BEGIN
  PERFORM test.ok(test.company_of('Link only') = test.ref('Bolt'),
    'backfill: a contact with only a works-at link gets that company');
  PERFORM test.ok(test.works_at('Company only') = ARRAY[test.ref('Acme')],
    'backfill: a contact with only a company gets the works-at link');
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM test.before_backfill b
      WHERE NOT EXISTS (SELECT 1 FROM public.entity_links l WHERE l.id = b.id AND l.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = b.id AND c.deleted_at IS NULL)),
    'backfill: nothing that was live is removed');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.contacts__company_link_backfill()', 'EXECUTE'),
    'the backfill is not callable from the app');
END;
$$;
