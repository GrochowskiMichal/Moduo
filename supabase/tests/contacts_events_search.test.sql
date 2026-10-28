-- GS-5: contacts, companies and events on the search contract
-- (specs/global-search.md AC1–AC4; Assumptions 6, 7, 11; Q23).
--
-- contacts__search, companies__search and events__search answer with
-- SearchHit rows (archived included), apply each type's own rule before the
-- limit and resolve the actor from the request. Someone else's private event
-- is never matched by its title, description or attendees. A company is
-- visible through any visible person. The calendar ceiling is applied once
-- for the whole set, and the set equals can_access('event', …, 'view').
--
-- Cast: O owns workspace W. S is a member with shares, M a member without, N
-- a member whose role has no calendar (its ceiling is none), X is signed in
-- elsewhere. Keys: KC (O's, contacts view), KE (O's, calendar view), KMC (M's,
-- contacts view).
--
-- Every searchable title carries the word "quince".

SELECT test.person(n) FROM unnest(ARRAY['O', 'S', 'M', 'N', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Contacts and events W'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('S'), 'member'),
  (test.id('W'), test.id('M'), 'member');
INSERT INTO public.workspace_members (workspace_id, user_id, role, overrides) VALUES
  (test.id('W'), test.id('N'), 'member', '{"calendar.view": false}'::jsonb);
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KC'), test.id('W'), 'O contacts', 'mdo_kc5', md5('db-test-kc5'), '{"contacts": "view"}'::jsonb, test.id('O')),
  (test.id('KE'), test.id('W'), 'O calendar', 'mdo_ke5', md5('db-test-ke5'), '{"calendar": "view"}'::jsonb, test.id('O')),
  (test.id('KMC'), test.id('W'), 'M contacts', 'mdo_kmc5', md5('db-test-kmc5'), '{"contacts": "view"}'::jsonb, test.id('M'));

CREATE TABLE test.names AS SELECT NULL::uuid AS id, NULL::text AS name WHERE false;

-- A module function's rows as the signed-in person, as jsonb.
CREATE FUNCTION test.hits_as(p_who text, p_fn text, p_query text, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]')::text FROM public.%I(%L, %L, %s) h$q$,
    p_fn, test.id('W'), p_query, p_limit));
BEGIN
  IF r LIKE 'ERROR%' THEN RETURN jsonb_build_array(jsonb_build_object('error', r)); END IF;
  RETURN r::jsonb;
END;
$$;

-- What the rows name, as sorted fixture names ("?" for an unknown id).
CREATE FUNCTION test.found(p_rows jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(coalesce(n.name, coalesce(h ->> 'error', '?')), ','
                             ORDER BY coalesce(n.name, coalesce(h ->> 'error', '?'))), '')
    FROM jsonb_array_elements(p_rows) h
    LEFT JOIN test.names n ON n.id = (h ->> 'entity_id')::uuid
$$;

CREATE FUNCTION test.as_who(p_who text, p_fn text, p_query text) RETURNS text LANGUAGE sql AS $$
  SELECT test.found(test.hits_as(p_who, p_fn, p_query))
$$;

-- The same, as an API key (service_role + its header), through a temp table.
CREATE FUNCTION test.as_key_found(p_key text, p_fn text, p_query text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS key_rows (entity_id uuid) ON COMMIT DROP;
  GRANT ALL ON key_rows TO service_role;
  DELETE FROM key_rows;
  v := test.as_key(p_key, format($q$INSERT INTO pg_temp.key_rows SELECT h.entity_id FROM public.%I(%L, %L, 50) h$q$,
                                 p_fn, test.id('W'), p_query));
  IF v NOT LIKE 'ok%' THEN RETURN v; END IF;
  RETURN coalesce((SELECT string_agg(coalesce(n.name, '?'), ',' ORDER BY coalesce(n.name, '?'))
                     FROM key_rows k LEFT JOIN test.names n ON n.id = k.entity_id), '');
END;
$$;

-- ── Fixture ──────────────────────────────────────────────────────────────────

-- Companies: CQ is visible to S only through its person CS; CO through the
-- workspace-shared CW; CP2 through O's private CP; CN has no people.
INSERT INTO public.companies (id, workspace_id, owner_id, name, domains) VALUES
  (test.id('CQ'), test.id('W'), test.id('O'), 'Quince shared company', '{quinceshared.example}'),
  (test.id('CO'), test.id('W'), test.id('O'), 'Quince open company', '{quinceopen.example}'),
  (test.id('CP2'), test.id('W'), test.id('O'), 'Quince private company', '{}'),
  (test.id('CN'), test.id('W'), test.id('O'), 'Quince lonely company', '{}'),
  (test.id('CX'), test.id('W2'), test.id('X'), 'Quince elsewhere company', '{}');

-- People: CS shared with S, CW and CE with the workspace, CP O's own, CD
-- deleted, CXP in another workspace. CE's name lacks the word: only its email
-- carries it.
INSERT INTO public.contacts (id, workspace_id, owner_id, name, company_id, email, emails, deleted_at) VALUES
  (test.id('CS'), test.id('W'), test.id('O'), 'Quince shared person', test.id('CQ'), NULL, '[]', NULL),
  (test.id('CW'), test.id('W'), test.id('O'), 'Wanda Quince', test.id('CO'), NULL, '[]', NULL),
  (test.id('CE'), test.id('W'), test.id('O'), 'Edith Body', NULL, 'edith@quincefarm.example',
   '[{"label": "work", "value": "edith@quincefarm.example", "primary": true}]', NULL),
  (test.id('CP'), test.id('W'), test.id('O'), 'Quince private person', test.id('CP2'), NULL, '[]', NULL),
  (test.id('CD'), test.id('W'), test.id('O'), 'Quince deleted person', NULL, NULL, '[]', now()),
  (test.id('CXP'), test.id('W2'), test.id('X'), 'Quince elsewhere person', test.id('CX'), NULL, '[]', NULL);
DELETE FROM public.resource_grants WHERE resource_type = 'contact'
  AND resource_id IN (SELECT id FROM public.contacts WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'contact', test.id('CS'), 'member', test.id('S'), 'view', test.id('O')),
  (test.id('W'), 'contact', test.id('CW'), 'workspace', NULL, 'view', test.id('O')),
  (test.id('W'), 'contact', test.id('CE'), 'workspace', NULL, 'view', test.id('O'));

-- Calendars: O's CAL is shared at view with S and N. Events: EW an ordinary
-- event, EP O's private one (with a description and an attendee), EM M's own
-- event with no calendar, EN N's own event (N's ceiling hides even that),
-- ED deleted.
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CAL'), test.id('W'), test.id('O'), 'Work', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar' AND resource_id = test.id('CAL');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'calendar', test.id('CAL'), 'member', test.id('S'), 'view', test.id('O')),
  (test.id('W'), 'calendar', test.id('CAL'), 'member', test.id('N'), 'view', test.id('O'));
INSERT INTO public.calendar_events (id, workspace_id, owner_id, calendar_ref, title, description, location,
                                    attendees, start_time, end_time, is_private, deleted_at) VALUES
  (test.id('EW'), test.id('W'), test.id('O'), test.id('CAL'), 'Quince shared event', 'Bring the persimmon slides',
   'Room Loquat', '[{"name": "Yara Guest", "email": "yara@guest.example"}]',
   '2026-11-03 14:00+00', '2026-11-03 15:00+00', false, NULL),
  (test.id('EP'), test.id('W'), test.id('O'), test.id('CAL'), 'Quince secret event', 'kumquat agenda', 'Room Medlar',
   '[{"name": "Zed Attendee", "email": "zed@attendee.example"}]',
   '2026-11-04 09:00+00', '2026-11-04 10:00+00', true, NULL),
  (test.id('EM'), test.id('W'), test.id('M'), NULL, 'Quince member event', NULL, NULL, '[]',
   '2026-11-05 09:00+00', '2026-11-05 10:00+00', false, NULL),
  (test.id('EN'), test.id('W'), test.id('N'), NULL, 'Quince ceiling event', NULL, NULL, '[]',
   '2026-11-06 09:00+00', '2026-11-06 10:00+00', false, NULL),
  (test.id('ED'), test.id('W'), test.id('O'), test.id('CAL'), 'Quince deleted event', NULL, NULL, '[]',
   '2026-11-07 09:00+00', '2026-11-07 10:00+00', false, now());

INSERT INTO test.names (id, name)
SELECT test.id(n), n FROM unnest(ARRAY['CQ', 'CO', 'CP2', 'CN', 'CX', 'CS', 'CW', 'CE', 'CP', 'CD', 'CXP',
                                       'EW', 'EP', 'EM', 'EN', 'ED']) n;

-- ── The contract: shape, grants, actor from the request ─────────────────────

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.contacts__search(uuid, text, integer)',
                           'public.companies__search(uuid, text, integer)',
                           'public.events__search(uuid, text, integer)'] LOOP
    PERFORM test.ok(to_regprocedure(f) IS NOT NULL, f || ' exists');
    CONTINUE WHEN to_regprocedure(f) IS NULL;
    PERFORM test.ok(NOT has_function_privilege('anon', f, 'EXECUTE')
                AND has_function_privilege('authenticated', f, 'EXECUTE')
                AND has_function_privilege('service_role', f, 'EXECUTE'),
      f || ' is callable by authenticated and service_role, never anon');
    PERFORM test.ok((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
                       FROM pg_proc p WHERE p.oid = to_regprocedure(f)),
      f || ' is SECURITY DEFINER with an empty search_path');
    PERFORM test.ok((SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, NULL), ', ' ORDER BY a.ordinality)
                       FROM pg_proc p
                       CROSS JOIN LATERAL unnest(p.proallargtypes, p.proargnames, p.proargmodes)
                                  WITH ORDINALITY AS a(atttypid, attname, mode, ordinality)
                      WHERE p.oid = to_regprocedure(f) AND a.mode = 't')
                    = 'entity_type text, entity_id uuid, title text, context text, snippet text, icon text, '
                      'match text, rank real, updated_at timestamp with time zone, archived boolean',
      f || ' returns the SearchHit row with archived');
  END LOOP;
END;
$$;

-- ── Contacts ─────────────────────────────────────────────────────────────────

SELECT test.ok(test.as_who('O', 'contacts__search', 'quince') = 'CE,CP,CS,CW',
  'the owner finds every live person in the workspace, by name or by email',
  test.as_who('O', 'contacts__search', 'quince'));
SELECT test.ok(test.as_who('S', 'contacts__search', 'quince') = 'CE,CS,CW',
  'a sharee finds what was shared and what the workspace shares, never O''s private person',
  test.as_who('S', 'contacts__search', 'quince'));
SELECT test.ok(test.as_who('M', 'contacts__search', 'quince') = 'CE,CW',
  'a member without shares finds what the workspace shares', test.as_who('M', 'contacts__search', 'quince'));
SELECT test.ok(test.as_who('X', 'contacts__search', 'quince') = '', 'an outsider finds nothing',
  test.as_who('X', 'contacts__search', 'quince'));

DO $$
DECLARE
  v jsonb := test.hits_as('S', 'contacts__search', 'wanda');
  e jsonb := test.hits_as('S', 'contacts__search', 'quincefarm');
BEGIN
  PERFORM test.ok(v -> 0 ->> 'entity_type' = 'contact' AND v -> 0 ->> 'match' = 'title'
              AND v -> 0 ->> 'context' = 'Quince open company'
              AND (v -> 0 ->> 'archived')::boolean = false
              AND v -> 0 ->> 'snippet' IS NULL,
    'a name hit says the person''s company as its context, with no snippet', v::text);
  -- Only CE matches exactly; the typo rule may add names after it (fewer than 3 exact hits).
  PERFORM test.ok(e -> 0 ->> 'entity_id' = test.id('CE')::text AND e -> 0 ->> 'match' = 'body'
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e) h WHERE h ->> 'match' <> 'title_fuzzy'
                                AND h ->> 'entity_id' <> test.id('CE')::text)
              AND e -> 0 ->> 'snippet' LIKE '%' || chr(57344) || '%' || chr(57345) || '%'
              AND e -> 0 ->> 'context' IS NULL,
    'a word only in the email finds the person as a body hit, with a highlighted snippet', e::text);
  PERFORM test.ok(test.as_who('M', 'contacts__search', 'edith@quincefarm.example') = 'CE',
    'a whole email address finds its person');
  PERFORM test.ok(test.as_who('M', 'contacts__search', 'wandq') = 'CW'
              AND test.hits_as('M', 'contacts__search', 'wandq') -> 0 ->> 'match' = 'title_fuzzy',
    'a typo in a name is forgiven, as title_fuzzy', test.hits_as('M', 'contacts__search', 'wandq')::text);
END;
$$;

-- ── Companies: visible through any visible person ───────────────────────────

SELECT test.ok(test.as_who('O', 'companies__search', 'quince') = 'CN,CO,CP2,CQ',
  'the owner finds every company of the workspace', test.as_who('O', 'companies__search', 'quince'));
SELECT test.ok(test.as_who('S', 'companies__search', 'quince') = 'CO,CQ',
  'a sharee finds a company through a person shared with them, and none without a visible person',
  test.as_who('S', 'companies__search', 'quince'));
SELECT test.ok(test.as_who('M', 'companies__search', 'quince') = 'CO',
  'a member finds the company of a workspace-shared person', test.as_who('M', 'companies__search', 'quince'));
SELECT test.ok(test.as_who('X', 'companies__search', 'quince') = '', 'an outsider finds no company',
  test.as_who('X', 'companies__search', 'quince'));
SELECT test.ok(test.as_who('M', 'companies__search', 'quinceopen') = 'CO'
           AND test.hits_as('M', 'companies__search', 'quinceopen') -> 0 ->> 'match' = 'body',
  'a company is found by its domain', test.hits_as('M', 'companies__search', 'quinceopen')::text);

-- ── Events: private never matches, ceiling for the set, parity ──────────────

SELECT test.ok(test.as_who('O', 'events__search', 'quince') = 'EP,EW',
  'the owner finds their events, private included, never someone else''s calendar-less event or a deleted one',
  test.as_who('O', 'events__search', 'quince'));
SELECT test.ok(test.as_who('S', 'events__search', 'quince') = 'EW',
  'a sharee of the calendar finds the ordinary event, never the private one',
  test.as_who('S', 'events__search', 'quince'));
SELECT test.ok(test.as_who('S', 'events__search', 'secret') = ''
           AND test.as_who('S', 'events__search', 'kumquat') = ''
           AND test.as_who('S', 'events__search', 'zed') = ''
           AND test.as_who('S', 'events__search', 'medlar') = '',
  'someone else''s private event never matches by its title, description, attendees or location (Q23)');
SELECT test.ok(test.as_who('M', 'events__search', 'quince') = 'EM',
  'a member finds only their own event, not a calendar they can''t see', test.as_who('M', 'events__search', 'quince'));
SELECT test.ok(test.as_who('N', 'events__search', 'quince') = '',
  'with no calendar in their role, a member finds no event, not even their own or a shared calendar''s',
  test.as_who('N', 'events__search', 'quince'));
SELECT test.ok(test.as_who('X', 'events__search', 'quince') = '', 'an outsider finds no event',
  test.as_who('X', 'events__search', 'quince'));

DO $$
DECLARE
  v jsonb := test.hits_as('S', 'events__search', 'quince');
  b jsonb := test.hits_as('S', 'events__search', 'persimmon');
  a jsonb := test.hits_as('S', 'events__search', 'yara');
  p jsonb := test.hits_as('O', 'events__search', 'kumquat');
BEGIN
  PERFORM test.ok(v -> 0 ->> 'match' = 'title' AND v -> 0 ->> 'context' = 'Tue 3 Nov 2026'
              AND (v -> 0 ->> 'archived')::boolean = false,
    'an event''s context is its start date', v::text);
  PERFORM test.ok(test.found(b) = 'EW' AND b -> 0 ->> 'match' = 'body'
              AND b -> 0 ->> 'snippet' LIKE '%' || chr(57344) || 'persimmon' || chr(57345) || '%',
    'a word in the description finds the event with a snippet', b::text);
  PERFORM test.ok(test.found(a) = 'EW', 'an attendee''s name finds the event', a::text);
  PERFORM test.ok(test.found(p) = 'EP' AND p -> 0 ->> 'match' = 'body',
    'the owner finds their private event by its description', p::text);
END;
$$;

-- The date is in the asker's time zone when they have one.
INSERT INTO public.user_preferences (user_id, time_zone) VALUES (test.id('S'), 'Pacific/Auckland')
ON CONFLICT (user_id) DO UPDATE SET time_zone = EXCLUDED.time_zone;
SELECT test.ok(test.hits_as('S', 'events__search', 'quince') -> 0 ->> 'context' = 'Wed 4 Nov 2026',
  'the start date is read in the asker''s time zone', test.hits_as('S', 'events__search', 'quince')::text);

-- Parity: the set equals can_access('event', …, 'view') for every person.
DO $$
DECLARE
  p text;
  v_found text;
  v_want text;
BEGIN
  FOREACH p IN ARRAY ARRAY['O', 'S', 'M', 'N', 'X'] LOOP
    v_found := test.as_who(p, 'events__search', 'quince');
    SELECT coalesce(string_agg(n.name, ',' ORDER BY n.name), '') INTO v_want
      FROM public.calendar_events e JOIN test.names n ON n.id = e.id
     WHERE e.workspace_id = test.id('W') AND public.can_access('event', e.id, 'view', test.id(p));
    PERFORM test.ok(v_found = v_want, 'events__search equals can_access for ' || p, v_found || ' vs ' || v_want);
  END LOOP;
END;
$$;

SELECT test.ok(
  coalesce((SELECT d NOT LIKE '%can_access(''event''%' AND d LIKE '%perm_ceiling_rank%'
              FROM (SELECT pg_get_functiondef(to_regprocedure('public.events__search(uuid, text, integer)')) AS d) f),
           false),
  'events__search reads the calendar ceiling once for the set, never a per-event can_access');

-- ── Keys: the key's scope and its person's access ───────────────────────────

SELECT test.ok(test.as_key_found('KC', 'contacts__search', 'quince') = 'CE,CP,CS,CW'
           AND test.as_key_found('KC', 'companies__search', 'quince') = 'CN,CO,CP2,CQ'
           AND test.as_key_found('KC', 'events__search', 'quince') = '',
  'a contacts key finds people and companies, never events');
SELECT test.ok(test.as_key_found('KE', 'events__search', 'quince') = 'EP,EW'
           AND test.as_key_found('KE', 'contacts__search', 'quince') = ''
           AND test.as_key_found('KE', 'companies__search', 'quince') = '',
  'a calendar key finds its person''s events, never people');
SELECT test.ok(test.as_key_found('KMC', 'contacts__search', 'quince') = 'CE,CW'
           AND test.as_key_found('KMC', 'companies__search', 'quince') = 'CO',
  'a member''s key finds only what that member can open',
  test.as_key_found('KMC', 'contacts__search', 'quince') || ' / ' || test.as_key_found('KMC', 'companies__search', 'quince'));

-- ── search_all takes these types from the module functions ──────────────────

DO $$
DECLARE
  v jsonb := test.value_as('S', format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]')::text FROM public.search_all(%L, %L, NULL, 50) h$q$,
    test.id('W'), 'quince'))::jsonb;
BEGIN
  v := (SELECT coalesce(jsonb_agg(h), '[]') FROM jsonb_array_elements(v) h
         WHERE h ->> 'entity_type' IN ('contact', 'company', 'event'));
  PERFORM test.ok(test.found(v) = 'CE,CO,CQ,CS,CW,EW', 'search_all returns S''s contacts, companies and events',
    test.found(v));
  PERFORM test.ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v) h
                           WHERE h ->> 'entity_id' = test.id('CW')::text AND h ->> 'context' = 'Quince open company')
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v) h
                           WHERE h ->> 'entity_id' = test.id('EW')::text AND h ->> 'context' = 'Wed 4 Nov 2026')
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v) h
                           WHERE h ->> 'entity_id' = test.id('CE')::text AND h ->> 'match' = 'body'),
    'with their context lines and body hits, which the registry adapter never has', v::text);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) h
                               WHERE h ->> 'match' NOT IN ('handle', 'title', 'title_fuzzy', 'body')),
    'every match is in the vocabulary');
END;
$$;

-- ── AC4: visibility before the limit ────────────────────────────────────────

INSERT INTO public.contacts (id, workspace_id, owner_id, name, updated_at)
SELECT test.id('YP' || i), test.id('W'), test.id('O'), 'Yak keeper ' || i, now()
  FROM generate_series(1, 300) i;
INSERT INTO public.contacts (id, workspace_id, owner_id, name, updated_at) VALUES
  (test.id('YV'), test.id('W'), test.id('O'), 'Yak keeper open', now() - interval '90 days');
DELETE FROM public.resource_grants WHERE resource_type = 'contact'
  AND resource_id IN (SELECT test.id('YP' || i) FROM generate_series(1, 300) i);
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'contact', test.id('YV'), 'workspace', NULL, 'view', test.id('O'));

INSERT INTO public.calendar_events (id, workspace_id, owner_id, calendar_ref, title, start_time, end_time, is_private, updated_at)
SELECT test.id('ZP' || i), test.id('W'), test.id('O'), test.id('CAL'), 'Zebra review ' || i,
       now(), now() + interval '1 hour', true, now()
  FROM generate_series(1, 300) i;
INSERT INTO public.calendar_events (id, workspace_id, owner_id, calendar_ref, title, start_time, end_time, is_private, updated_at) VALUES
  (test.id('ZV'), test.id('W'), test.id('O'), test.id('CAL'), 'Zebra review open', now(), now() + interval '1 hour',
   false, now() - interval '90 days');
INSERT INTO test.names VALUES (test.id('YV'), 'YV'), (test.id('ZV'), 'ZV');

SELECT test.ok(test.found(test.hits_as('M', 'contacts__search', 'yak', 1)) = 'YV',
  '300 newer people M can''t see don''t push out the one M can (limit 1)',
  test.hits_as('M', 'contacts__search', 'yak', 1)::text);
SELECT test.ok(test.found(test.hits_as('S', 'events__search', 'zebra', 1)) = 'ZV',
  '300 newer private events don''t push out the one S can see (limit 1)',
  test.hits_as('S', 'events__search', 'zebra', 1)::text);
