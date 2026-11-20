-- GS-3: search_all shows exactly what the asker could open (specs/global-search.md
-- AC3, AC4; Assumptions 6, 7, 12). Every type ⌘K searches through search_all is
-- run as the owner, a sharee, a member without a share, an outsider and scoped
-- API keys.
--
-- Cast: O owns workspace W. S is a member with shares, M a member without, X is
-- signed in elsewhere. Keys: KON (O's, notes view), KOT (O's, tasks view),
-- KOA (O's, notes + tasks + contacts + calendar view, no email),
-- KMT (M's, tasks view), KX (O's key in another workspace W2).
--
-- Every searchable title carries the word "plum", so one query reaches every
-- type; the private copies carry "secret" too.

SELECT test.person(n) FROM unnest(ARRAY['O', 'S', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Visibility W'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('S'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W2'), test.id('O'), 'member');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KON'), test.id('W'), 'O notes', 'mdo_kon', md5('db-test-kon'), '{"notes": "view"}'::jsonb, test.id('O')),
  (test.id('KOT'), test.id('W'), 'O tasks', 'mdo_kot', md5('db-test-kot'), '{"tasks": "view"}'::jsonb, test.id('O')),
  (test.id('KOA'), test.id('W'), 'O all but mail', 'mdo_koa', md5('db-test-koa'),
   '{"notes": "view", "tasks": "view", "contacts": "view", "calendar": "view"}'::jsonb, test.id('O')),
  (test.id('KMT'), test.id('W'), 'M tasks', 'mdo_kmt', md5('db-test-kmt'), '{"tasks": "view"}'::jsonb, test.id('M')),
  (test.id('KX'), test.id('W2'), 'O elsewhere', 'mdo_kx', md5('db-test-kx'),
   '{"notes": "view", "tasks": "view", "contacts": "view", "calendar": "view"}'::jsonb, test.id('O'));

-- What a person finds, as "type:name" sorted (names mapped back from ids).
CREATE TABLE test.names AS SELECT NULL::uuid AS id, NULL::text AS name WHERE false;

CREATE FUNCTION test.found(p_rows jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg((h ->> 'entity_type') || ':' || coalesce(n.name, '?'), ','
                             ORDER BY (h ->> 'entity_type') || ':' || coalesce(n.name, '?')), '')
    FROM jsonb_array_elements(p_rows) h
    LEFT JOIN test.names n ON n.id = (h ->> 'entity_id')::uuid
$$;

CREATE FUNCTION test.rows_as(p_who text, p_query text, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]')::text FROM public.search_all(%L, %L, NULL, %s) h$q$,
    test.id('W'), p_query, p_limit));
BEGIN
  IF r LIKE 'ERROR%' THEN RETURN jsonb_build_array(jsonb_build_object('error', r)); END IF;
  RETURN r::jsonb;
END;
$$;

CREATE FUNCTION test.as_who(p_who text, p_query text) RETURNS text LANGUAGE sql AS $$
  SELECT test.found(test.rows_as(p_who, p_query))
$$;

-- The same, as an API key (service_role + its header). The rows come back
-- through a temp table, since the key's role can't write the test schema.
CREATE FUNCTION test.as_key_found(p_key text, p_query text, p_ws text DEFAULT 'W') RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS key_rows (entity_type text, entity_id uuid) ON COMMIT DROP;
  GRANT ALL ON key_rows TO service_role;
  DELETE FROM key_rows;
  v := test.as_key(p_key, format($q$INSERT INTO pg_temp.key_rows SELECT h.entity_type, h.entity_id
                                     FROM public.search_all(%L, %L, NULL, 50) h$q$, test.id(p_ws), p_query));
  IF v NOT LIKE 'ok%' THEN RETURN v; END IF;
  RETURN coalesce((SELECT string_agg(k.entity_type || ':' || coalesce(n.name, '?'), ','
                                     ORDER BY k.entity_type || ':' || coalesce(n.name, '?'))
                     FROM key_rows k LEFT JOIN test.names n ON n.id = k.entity_id), '');
END;
$$;

-- ── Fixture ──────────────────────────────────────────────────────────────────

-- Projects: PS shared with S only, PW with the workspace, PO O's own.
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('PS'), test.id('W'), test.id('O'), 'Plum secret project', false),
  (test.id('PW'), test.id('W'), test.id('O'), 'Plum open project', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id IN (test.id('PS'), test.id('PW'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'bucket', test.id('PS'), 'member', test.id('S'), 'view', test.id('O')),
  (test.id('W'), 'bucket', test.id('PW'), 'workspace', NULL, 'edit', test.id('O'));

INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status, updated_at) VALUES
  (test.id('TS'), test.id('W'), test.id('PS'), test.id('O'), 'Plum secret task', 'todo', now() - interval '60 days'),
  (test.id('TW'), test.id('W'), test.id('PW'), test.id('O'), 'Plum open task', 'todo', now() - interval '60 days');

-- Notes: NS shared with S, NW with the workspace, NO O's own, NC a child of
-- NS that inherits (S sees it through the parent's sharing).
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('NS'), test.id('W'), test.id('O'), 'Plum secret note', ''),
  (test.id('NW'), test.id('W'), test.id('O'), 'Plum open note', ''),
  (test.id('NO'), test.id('W'), test.id('O'), 'Plum own secret note', '');
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, parent_id) VALUES
  (test.id('NC'), test.id('W'), test.id('O'), 'Plum inherited secret note', '', test.id('NS'));
UPDATE public.notes SET share_mode = 'inherit' WHERE id = test.id('NC');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (SELECT id FROM public.notes WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'note', test.id('NS'), 'member', test.id('S'), 'view', test.id('O')),
  (test.id('W'), 'note', test.id('NW'), 'workspace', NULL, 'view', test.id('O'));

-- Contacts: CS shared with S, CW with the workspace (its company CO is then
-- visible through it), CO2 a company only O can see.
INSERT INTO public.companies (id, workspace_id, owner_id, name) VALUES
  (test.id('CO'), test.id('W'), test.id('O'), 'Plum open company'),
  (test.id('CO2'), test.id('W'), test.id('O'), 'Plum secret company');
INSERT INTO public.contacts (id, workspace_id, owner_id, name, company_id) VALUES
  (test.id('CS'), test.id('W'), test.id('O'), 'Plum secret contact', NULL),
  (test.id('CW'), test.id('W'), test.id('O'), 'Plum open contact', test.id('CO'));
DELETE FROM public.resource_grants WHERE resource_type = 'contact' AND resource_id IN (test.id('CS'), test.id('CW'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'contact', test.id('CS'), 'member', test.id('S'), 'view', test.id('O')),
  (test.id('W'), 'contact', test.id('CW'), 'workspace', NULL, 'view', test.id('O'));

-- Events on O's calendar CAL, shared with S at view: EW an ordinary event,
-- EP a private one (Q23: never searchable for anyone but O).
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CAL'), test.id('W'), test.id('O'), 'Work', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar' AND resource_id = test.id('CAL');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'calendar', test.id('CAL'), 'member', test.id('S'), 'view', test.id('O'));
INSERT INTO public.calendar_events (id, workspace_id, owner_id, calendar_ref, title, start_time, end_time, is_private) VALUES
  (test.id('EW'), test.id('W'), test.id('O'), test.id('CAL'), 'Plum shared event', now(), now() + interval '1 hour', false),
  (test.id('EP'), test.id('W'), test.id('O'), test.id('CAL'), 'Plum secret event', now(), now() + interval '1 hour', true);

-- Mail: an email thread pulled into Moduo is its owner's alone.
INSERT INTO public.email_refs (id, workspace_id, owner_id, thread_key, subject) VALUES
  (test.id('ML'), test.id('W'), test.id('O'), 'thread-plum', 'Plum secret mail');

INSERT INTO public.entities (workspace_id, entity_type, entity_id, label) VALUES
  (test.id('W'), 'bucket', test.id('PS'), 'Plum secret project'),
  (test.id('W'), 'bucket', test.id('PW'), 'Plum open project'),
  (test.id('W'), 'company', test.id('CO'), 'Plum open company'),
  (test.id('W'), 'company', test.id('CO2'), 'Plum secret company'),
  (test.id('W'), 'contact', test.id('CS'), 'Plum secret contact'),
  (test.id('W'), 'contact', test.id('CW'), 'Plum open contact'),
  (test.id('W'), 'event', test.id('EW'), 'Plum shared event'),
  (test.id('W'), 'event', test.id('EP'), 'Plum secret event'),
  (test.id('W'), 'email_thread', test.id('ML'), 'Plum secret mail')
ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;

INSERT INTO test.names (id, name)
SELECT test.id(n), n FROM unnest(ARRAY['PS', 'PW', 'TS', 'TW', 'NS', 'NW', 'NO', 'NC', 'CO', 'CO2', 'CS', 'CW',
                                       'EW', 'EP', 'ML']) n;

-- ── AC3: each person sees exactly what they could open ───────────────────────

SELECT test.ok(test.as_who('O', 'plum') =
  'bucket:PS,bucket:PW,company:CO,company:CO2,contact:CS,contact:CW,email_thread:ML,event:EP,event:EW,note:NC,note:NO,note:NS,note:NW,task:TS,task:TW',
  'the owner finds everything of theirs, mail and private event included', test.as_who('O', 'plum'));
SELECT test.ok(test.as_who('S', 'plum') =
  'bucket:PS,bucket:PW,company:CO,contact:CS,contact:CW,event:EW,note:NC,note:NS,note:NW,task:TS,task:TW',
  'a sharee finds what was shared, a note inheriting from it, and a company through a visible contact; never the private event, the owner''s mail or own notes',
  test.as_who('S', 'plum'));
SELECT test.ok(test.as_who('M', 'plum') = 'bucket:PW,company:CO,contact:CW,note:NW,task:TW',
  'a member without shares finds only what the workspace shares', test.as_who('M', 'plum'));
SELECT test.ok(test.as_who('X', 'plum') = '', 'an outsider finds nothing', test.as_who('X', 'plum'));
SELECT test.ok(test.as_who('S', 'secret event') NOT LIKE '%event:%'
           AND test.as_who('M', 'plum event') NOT LIKE '%event:%',
  'someone else''s private event never matches by its title, and a calendar you can''t see matches nothing');

-- API keys: the key's scopes and its person's access, both.
SELECT test.ok(test.as_key_found('KON', 'plum') = 'note:NC,note:NO,note:NS,note:NW',
  'a notes-only key finds only notes', test.as_key_found('KON', 'plum'));
SELECT test.ok(test.as_key_found('KOT', 'plum') = 'bucket:PS,bucket:PW,task:TS,task:TW',
  'a tasks-only key finds only tasks and projects', test.as_key_found('KOT', 'plum'));
SELECT test.ok(test.as_key_found('KOA', 'plum') =
  'bucket:PS,bucket:PW,company:CO,company:CO2,contact:CS,contact:CW,event:EP,event:EW,note:NC,note:NO,note:NS,note:NW,task:TS,task:TW',
  'a key without email scope never finds its person''s mail', test.as_key_found('KOA', 'plum'));
SELECT test.ok(test.as_key_found('KMT', 'plum') = 'bucket:PW,task:TW',
  'a member''s key finds only what that member can open', test.as_key_found('KMT', 'plum'));
SELECT test.ok(test.as_key_found('KX', 'plum') = '',
  'a key asking about another workspace than its own finds nothing', test.as_key_found('KX', 'plum'));

-- ── AC4: visibility before the limit, and no counts of the invisible ────────

INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
SELECT test.id('ZP' || i), test.id('W'), test.id('PS'), test.id('O'), 'Zebra crossing ' || i, 'todo'
  FROM generate_series(1, 300) i;
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status, updated_at) VALUES
  (test.id('ZV'), test.id('W'), test.id('PW'), test.id('O'), 'Zebra crossing open', 'todo', now() - interval '90 days');
INSERT INTO test.names VALUES (test.id('ZV'), 'ZV');

DO $$
DECLARE
  v jsonb := test.rows_as('M', 'zebra', 1);
BEGIN
  PERFORM test.ok(test.found(v) = 'task:ZV',
    '300 newer matches M can''t see don''t push out the one M can (limit 1)', v::text);
  PERFORM test.ok((v -> 0 ->> 'type_total')::int = 1, 'and they aren''t counted either', v::text);
END;
$$;
