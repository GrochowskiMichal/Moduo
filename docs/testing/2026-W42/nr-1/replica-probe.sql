-- NR-1 rehearsal probe, run against the `replica` database built by
-- replica-setup.sql AFTER the migration was applied once in one transaction.
-- Every check prints one line starting PASS or FAIL.
--
-- Runner (from the repo root; output committed as replica-probe.out):
--   export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres
--   psql -qc 'DROP DATABASE IF EXISTS replica' -c 'CREATE DATABASE replica'
--   psql -d replica -q -v ON_ERROR_STOP=1 -f docs/testing/2026-W42/nr-1/replica-setup.sql
--   psql -d replica -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261013120000_notes_refresh_organize.sql
--   psql -d replica -X -f docs/testing/2026-W42/nr-1/replica-probe.sql
--
-- Acting user = the `request.jwt.claim.sub` GUC (auth.uid() reads it); ops
-- run under SET ROLE authenticated so EXECUTE grants are exercised too.

\pset footer off
\pset null '∅'
\pset format unaligned
\pset tuples_only on
SET client_min_messages = warning;

\set W   '00000000-0000-0000-0000-0000000000a1'
\set A   'aaaaaaaa-0000-0000-0000-000000000001'
\set B   'bbbbbbbb-0000-0000-0000-000000000002'
\set C   'cccccccc-0000-0000-0000-000000000003'
\set P   '10000000-0000-0000-0000-000000000001'
\set K   '10000000-0000-0000-0000-000000000002'
\set G   '10000000-0000-0000-0000-000000000003'
\set L   '10000000-0000-0000-0000-000000000004'
\set PIN '10000000-0000-0000-0000-000000000005'
\set ARC '10000000-0000-0000-0000-000000000006'
\set TR  '10000000-0000-0000-0000-000000000007'
\set TRC '10000000-0000-0000-0000-000000000008'
\set PRV '10000000-0000-0000-0000-000000000009'

CREATE FUNCTION pg_temp.ok(label text, cond boolean) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN coalesce(cond, false) THEN 'PASS  ' ELSE 'FAIL  ' END || label
$$;
-- Runs stmt in a subtransaction as the CURRENT role; PASS when it raises an
-- error whose message contains `want`.
CREATE FUNCTION pg_temp.err(label text, stmt text, want text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN 'FAIL  ' || label || ' -> no error';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE '%' || want || '%' THEN 'PASS  ' ELSE 'FAIL  ' END
         || label || ' -> ' || SQLERRM;
END $$;

\echo
\echo ==== 1. Schema after apply #1
SELECT pg_temp.ok('notes.in_inbox NOT NULL, no default',
  (SELECT is_nullable = 'NO' AND column_default IS NULL FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='in_inbox'));
SELECT pg_temp.ok('notes.full_width NOT NULL default false',
  (SELECT is_nullable = 'NO' AND column_default = 'false' FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='full_width'));
SELECT pg_temp.ok('CHECK notes_in_inbox_roots_only present',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notes_in_inbox_roots_only'));
SELECT pg_temp.ok('trigger notes_in_inbox_default BEFORE INSERT OR UPDATE OF parent_id',
  (SELECT pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE OF parent_id%' FROM pg_trigger WHERE tgname='notes_in_inbox_default'));
SELECT pg_temp.ok('RLS enabled on note_favorites',
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.note_favorites'::regclass));

\echo
\echo ==== 2. Backfill: in_inbox = live, unarchived root with no live, unarchived child; updated_at untouched
WITH exp(id, want) AS (VALUES
  (:'P'::uuid, false), (:'K'::uuid, false), (:'G'::uuid, false), (:'L'::uuid, true),
  (:'PIN'::uuid, true), (:'ARC'::uuid, false), (:'TR'::uuid, true), (:'TRC'::uuid, false),
  (:'PRV'::uuid, true))
SELECT pg_temp.ok(format('%-26s in_inbox=%s want=%s updated_at=%s', n.title, n.in_inbox, e.want, n.updated_at::date),
                  n.in_inbox = e.want AND n.updated_at = '2026-01-01')
  FROM exp e JOIN public.notes n ON n.id = e.id ORDER BY n.id;

\echo
\echo ==== 3. Pins -> favorites for every member who can view (PIN: A,B,C; private PRV: C only)
SELECT format('  fav %s -> %s pos=%s', right(f.user_id::text, 1), n.title, f.position)
  FROM public.note_favorites f JOIN public.notes n ON n.id = f.note_id ORDER BY f.user_id, n.title;
SELECT pg_temp.ok('pins backfilled exactly {A:PIN, B:PIN, C:PIN, C:PRV}',
  (SELECT array_agg(right(user_id::text,1) || ':' || right(note_id::text,1) ORDER BY user_id, note_id)
     FROM public.note_favorites) = ARRAY['1:5','2:5','3:5','3:9']);

\echo
\echo ==== 4. notes_op_create (classic create, no in_inbox) as A
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.ok(format('create root -> in_inbox=%s share_mode=%s', in_inbox, share_mode),
                  in_inbox AND share_mode = 'custom' AND created_by = :'A')
  FROM public.notes_op_create(:'W', '20000000-0000-0000-0000-000000000001', NULL, 'N1 capture');
SELECT pg_temp.ok(format('create child under P -> in_inbox=%s share_mode=%s', in_inbox, share_mode),
                  NOT in_inbox AND share_mode = 'inherit')
  FROM public.notes_op_create(:'W', '20000000-0000-0000-0000-000000000002', :'P', 'N2 child of P');
SELECT pg_temp.ok(format('create child under inbox root N1 -> child in_inbox=%s', in_inbox), NOT in_inbox)
  FROM public.notes_op_create(:'W', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'N3 child of N1');
SELECT pg_temp.ok(format('parent N1 stays in Inbox after gaining a child (in_inbox=%s)', in_inbox), in_inbox)
  FROM public.notes WHERE id = '20000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok(format('notes_op_move inbox root L under P clears it (in_inbox=%s)', in_inbox), NOT in_inbox)
  FROM public.notes_op_move(:'W', :'L', :'P');
SELECT pg_temp.ok(format('notes_op_move L back to root keeps it in Pages (in_inbox=%s)', in_inbox), NOT in_inbox)
  FROM public.notes_op_move(:'W', :'L', NULL);

\echo
\echo ==== 5. THE SHARING CASE: C (did not create K; edit only via the workspace grant on P) files K into the Inbox
RESET ROLE;
\echo -- control: what plain re-rooting (prod notes_op_move to root, no freeze) would do, rolled back
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
SELECT 'control moved K to root as ' || share_mode FROM public.notes_op_move(:'W', :'K', NULL);
SELECT format('  control after plain re-root: %s view K=%s view G=%s', u.n,
              public.can_access('note', :'K', 'view', u.id), public.can_access('note', :'G', 'view', u.id))
  FROM (VALUES ('A', :'A'::uuid), ('B', :'B'::uuid), ('C', :'C'::uuid)) u(n, id);
ROLLBACK;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
SELECT format('  before: %s view K=%s edit K=%s view G=%s', u.n,
              public.can_access('note', :'K', 'view', u.id), public.can_access('note', :'K', 'edit', u.id),
              public.can_access('note', :'G', 'view', u.id))
  FROM (VALUES ('A', :'A'::uuid), ('B', :'B'::uuid), ('C', :'C'::uuid)) u(n, id);
SELECT pg_temp.ok(format('notes_op_file(K, true) as C -> parent=%s in_inbox=%s share_mode=%s created_by=B',
                         parent_id, in_inbox, share_mode),
                  parent_id IS NULL AND in_inbox AND share_mode = 'custom' AND created_by = :'B')
  FROM public.notes_op_file(:'W', :'K', true);
SELECT format('  grant on K: %s %s %s', subject_type, coalesce(right(subject_id::text, 1), '-'), level)
  FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = :'K' ORDER BY subject_type, subject_id;
SELECT pg_temp.ok(format('after: %s view K=%s edit K=%s | view G=%s edit G=%s', u.n,
                         public.can_access('note', :'K', 'view', u.id), public.can_access('note', :'K', 'edit', u.id),
                         public.can_access('note', :'G', 'view', u.id), public.can_access('note', :'G', 'edit', u.id)),
                  public.can_access('note', :'K', 'view', u.id) AND public.can_access('note', :'K', 'edit', u.id)
                  AND public.can_access('note', :'G', 'view', u.id) AND public.can_access('note', :'G', 'edit', u.id))
  FROM (VALUES ('A', :'A'::uuid), ('B', :'B'::uuid), ('C', :'C'::uuid)) u(n, id);
SELECT pg_temp.ok('A (creator of ancestor P) keeps full on K', public.can_access('note', :'K', 'full', :'A'));
SELECT pg_temp.ok('C keeps exactly edit on K (not full)',
                  public.can_access('note', :'K', 'edit', :'C') AND NOT public.can_access('note', :'K', 'full', :'C'));
SELECT pg_temp.ok('K.workspace_shared synced true', workspace_shared) FROM public.notes WHERE id = :'K';
SELECT pg_temp.ok('G still a child of K, inherit', parent_id = :'K' AND share_mode = 'inherit' AND NOT in_inbox)
  FROM public.notes WHERE id = :'G';
SELECT pg_temp.ok('activity notes.file to=inbox from_parent=P, actor C',
  EXISTS (SELECT 1 FROM public.replica_activity WHERE action = 'notes.file' AND entity_id = :'K'
           AND payload ->> 'to' = 'inbox' AND payload ->> 'from_parent' = :'P' AND actor = :'C'));

\echo
\echo ==== 6. notes_op_file(K, false) -> Pages; no-op file writes no activity
SELECT pg_temp.ok(format('file K to Pages -> parent=%s in_inbox=%s', parent_id, in_inbox), parent_id IS NULL AND NOT in_inbox)
  FROM public.notes_op_file(:'W', :'K', false, 'b1');
SELECT count(*) AS n_file_rows FROM public.replica_activity WHERE action = 'notes.file' \gset
SELECT pg_temp.ok('no-op file(K, false) returns the note', NOT in_inbox) FROM public.notes_op_file(:'W', :'K', false);
SELECT pg_temp.ok(format('no-op wrote no activity (notes.file rows %s -> %s)', :n_file_rows, count(*)), count(*) = :n_file_rows)
  FROM public.replica_activity WHERE action = 'notes.file';
SELECT pg_temp.ok('two notes.file rows total (inbox, pages)', :n_file_rows = 2);
SELECT pg_temp.err('file with NULL target refused',
  format('SELECT public.notes_op_file(%L, %L, NULL)', :'W', :'K'), 'Say whether the note goes');
SELECT pg_temp.err('file a trashed note refused',
  format('SELECT public.notes_op_file(%L, %L, true)', :'W', :'TRC'), 'This note is in the trash.');
SET replica.notes_perm = 'view';
SELECT pg_temp.err('module perm view cannot file',
  format('SELECT public.notes_op_file(%L, %L, true)', :'W', :'L'), 'You do not have edit access to notes');
RESET replica.notes_perm;

\echo
\echo ==== 7. CHECK + trigger
RESET ROLE;
RESET request.jwt.claim.sub;
SELECT pg_temp.err('CHECK rejects in_inbox=true on a child',
  format('UPDATE public.notes SET in_inbox = true WHERE id = %L', :'G'), 'notes_in_inbox_roots_only');
INSERT INTO public.notes (id, workspace_id, created_by, parent_id, title, in_inbox)
  VALUES ('20000000-0000-0000-0000-000000000010', :'W', :'A', :'P', 'explicit inbox child', true);
SELECT pg_temp.ok('INSERT child with in_inbox=true is forced false by the trigger', NOT in_inbox)
  FROM public.notes WHERE id = '20000000-0000-0000-0000-000000000010';
INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES ('20000000-0000-0000-0000-000000000011', :'W', :'A', 'raw root');
SELECT pg_temp.ok('raw INSERT root omitting in_inbox -> true', in_inbox) FROM public.notes WHERE id = '20000000-0000-0000-0000-000000000011';
INSERT INTO public.notes (id, workspace_id, created_by, title, in_inbox) VALUES ('20000000-0000-0000-0000-000000000012', :'W', :'A', 'raw root, false', false);
SELECT pg_temp.ok('raw INSERT root in_inbox=false stays false', NOT in_inbox) FROM public.notes WHERE id = '20000000-0000-0000-0000-000000000012';
UPDATE public.notes SET parent_id = :'P' WHERE id = '20000000-0000-0000-0000-000000000011';
SELECT pg_temp.ok('raw UPDATE parent_id on an inbox root clears in_inbox', NOT in_inbox) FROM public.notes WHERE id = '20000000-0000-0000-0000-000000000011';

\echo
\echo ==== 8. notes_op_import as A (per-row inInbox)
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.ok('import returns imported=3 skipped=0', r = '{"imported": 3, "skipped": 0}'::jsonb)
  FROM public.notes_op_import(:'W', '[
    {"id":"30000000-0000-0000-0000-000000000001","title":"mcp root (no inInbox)"},
    {"id":"30000000-0000-0000-0000-000000000002","title":"wizard root","inInbox":false},
    {"id":"30000000-0000-0000-0000-000000000003","title":"wizard child","parentId":"30000000-0000-0000-0000-000000000002","inInbox":true}]'::jsonb) r;
WITH exp(id, want) AS (VALUES ('30000000-0000-0000-0000-000000000001'::uuid, true),
                              ('30000000-0000-0000-0000-000000000002'::uuid, false),
                              ('30000000-0000-0000-0000-000000000003'::uuid, false))
SELECT pg_temp.ok(format('import %-22s in_inbox=%s want=%s created_by=A', n.title, n.in_inbox, e.want),
                  n.in_inbox = e.want AND n.created_by = :'A')
  FROM exp e JOIN public.notes n ON n.id = e.id ORDER BY n.id;
SELECT pg_temp.ok('re-import of existing ids skips', r = '{"imported": 0, "skipped": 1}'::jsonb)
  FROM public.notes_op_import(:'W', '[{"id":"30000000-0000-0000-0000-000000000001"}]'::jsonb) r;

\echo
\echo ==== 9. notes_op_duplicate keeps the section; attributed to the actor
SELECT pg_temp.ok(format('A dup P (Pages root) -> in_inbox=%s parent=%s created_by=A title=%s', in_inbox, parent_id, title),
                  NOT in_inbox AND parent_id IS NULL AND created_by = :'A' AND title = 'P shared root (copy)')
  FROM public.notes_op_duplicate(:'W', :'P');
SELECT pg_temp.ok('duplicate copied the un-compacted update tail',
  (SELECT count(*) FROM public.note_updates u JOIN public.notes n ON n.id = u.note_id WHERE n.title = 'P shared root (copy)') = 1);
SELECT pg_temp.ok(format('A dup PIN (Inbox root, B''s) -> in_inbox=%s created_by=A', in_inbox), in_inbox AND created_by = :'A')
  FROM public.notes_op_duplicate(:'W', :'PIN');
SELECT pg_temp.ok(format('A dup G (child) -> parent=K in_inbox=%s share_mode=%s', in_inbox, share_mode),
                  parent_id = :'K' AND NOT in_inbox AND share_mode = 'inherit')
  FROM public.notes_op_duplicate(:'W', :'G');
SET request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
SELECT pg_temp.ok(format('C dup own private PRV -> works, in_inbox=%s created_by=C', in_inbox), in_inbox AND created_by = :'C')
  FROM public.notes_op_duplicate(:'W', :'PRV');
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.err('B dup C''s private PRV refused',
  format('SELECT public.notes_op_duplicate(%L, %L)', :'W', :'PRV'), 'Note not found in this workspace.');

\echo
\echo ==== 10. notes_op_set_meta fullWidth
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.ok(format('fullWidth true -> full_width=%s', full_width), full_width)
  FROM public.notes_op_set_meta(:'W', :'P', '{"fullWidth":true}');
SELECT pg_temp.ok(format('icon-only patch keeps full_width=%s, icon=%s', full_width, icon), full_width AND icon = 'x')
  FROM public.notes_op_set_meta(:'W', :'P', '{"icon":"x"}');
SELECT pg_temp.ok(format('fullWidth false -> full_width=%s', full_width), NOT full_width)
  FROM public.notes_op_set_meta(:'W', :'P', '{"fullWidth":false}');
SELECT pg_temp.ok(format('isPinned still works -> is_pinned=%s', is_pinned), is_pinned)
  FROM public.notes_op_set_meta(:'W', :'L', '{"isPinned":true}');

\echo
\echo ==== 11. notes_op_set_favorite
SELECT public.notes_op_set_favorite(:'W', :'L', true);
SELECT public.notes_op_set_favorite(:'W', :'G', true);
SELECT pg_temp.ok(format('A appends L then G after PIN: %s', string_agg(n.title || '@' || f.position, ', ' ORDER BY f.position COLLATE "C")),
                  array_agg(right(f.note_id::text, 1) ORDER BY f.position COLLATE "C") = ARRAY['5','4','3'])
  FROM public.note_favorites f JOIN public.notes n ON n.id = f.note_id WHERE f.user_id = :'A';
SELECT public.notes_op_set_favorite(:'W', :'G', true, '0');
SELECT public.notes_op_set_favorite(:'W', :'L', true);
SELECT pg_temp.ok(format('reorder G to front; re-adding L keeps its spot: %s', string_agg(n.title || '@' || f.position, ', ' ORDER BY f.position COLLATE "C")),
                  array_agg(right(f.note_id::text, 1) ORDER BY f.position COLLATE "C") = ARRAY['3','5','4'])
  FROM public.note_favorites f JOIN public.notes n ON n.id = f.note_id WHERE f.user_id = :'A';
SELECT public.notes_op_set_favorite(:'W', :'L', false);
SELECT public.notes_op_set_favorite(:'W', :'L', false);
SELECT pg_temp.ok('remove L (twice, idempotent)', NOT EXISTS (SELECT 1 FROM public.note_favorites WHERE user_id = :'A' AND note_id = :'L'));
SELECT pg_temp.ok('set_favorite wrote no activity row', NOT EXISTS (SELECT 1 FROM public.replica_activity WHERE action LIKE '%favorite%'));
SELECT pg_temp.err('trashed note refused',
  format('SELECT public.notes_op_set_favorite(%L, %L, true)', :'W', :'TRC'), 'Note not found in this workspace.');
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SET replica.notes_perm = 'view';
SELECT public.notes_op_set_favorite(:'W', :'P', true);
SELECT pg_temp.ok('viewer (module perm view) can favorite P', EXISTS (SELECT 1 FROM public.note_favorites WHERE user_id = :'B' AND note_id = :'P'));
SET replica.notes_perm = 'none';
SELECT pg_temp.err('module perm none refused',
  format('SELECT public.notes_op_set_favorite(%L, %L, true)', :'W', :'L'), 'You do not have access to notes in this workspace.');
RESET replica.notes_perm;
SELECT pg_temp.err('B cannot favorite C''s private PRV',
  format('SELECT public.notes_op_set_favorite(%L, %L, true)', :'W', :'PRV'), 'You do not have access to this note.');
RESET request.jwt.claim.sub;
SELECT pg_temp.err('no actor refused',
  format('SELECT public.notes_op_set_favorite(%L, %L, true)', :'W', :'L'), 'Sign in to keep favorites.');

\echo
\echo ==== 12. RLS + table privileges on note_favorites
RESET ROLE;
SELECT count(*) FILTER (WHERE user_id = :'A') AS fa, count(*) FILTER (WHERE user_id = :'B') AS fb,
       count(*) FILTER (WHERE user_id = :'C') AS fc FROM public.note_favorites \gset
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.ok(format('A sees only own favorites (%s of own %s)', count(*), :fa), bool_and(user_id = :'A') AND count(*) = :fa) FROM public.note_favorites;
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.ok(format('B sees only own favorites (%s of own %s)', count(*), :fb), bool_and(user_id = :'B') AND count(*) = :fb) FROM public.note_favorites;
SET request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
SELECT pg_temp.ok(format('C sees only own favorites (%s of own %s)', count(*), :fc), bool_and(user_id = :'C') AND count(*) = :fc) FROM public.note_favorites;
RESET request.jwt.claim.sub;
SELECT pg_temp.ok('no actor sees nothing', count(*) = 0) FROM public.note_favorites;
RESET ROLE;
\echo -- B makes PIN private: A and C keep their favorite rows but RLS hides them
DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = :'PIN' AND subject_type = 'workspace';
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.ok('A no longer sees the PIN favorite once PIN is private', NOT EXISTS (SELECT 1 FROM public.note_favorites WHERE note_id = :'PIN'));
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.ok('B (creator) still sees the PIN favorite', EXISTS (SELECT 1 FROM public.note_favorites WHERE note_id = :'PIN'));
RESET ROLE;
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level) VALUES (:'W', 'note', :'PIN', 'workspace', 'edit');
SET ROLE authenticated;
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.err('authenticated direct INSERT refused',
  format('INSERT INTO public.note_favorites (workspace_id, user_id, note_id) VALUES (%L, %L, %L)', :'W', :'B', :'L'), 'permission denied');
SELECT pg_temp.err('authenticated UPDATE refused', 'UPDATE public.note_favorites SET position = ''z''', 'permission denied');
SELECT pg_temp.err('authenticated DELETE refused', 'DELETE FROM public.note_favorites', 'permission denied');
SELECT pg_temp.err('authenticated TRUNCATE refused', 'TRUNCATE public.note_favorites', 'permission denied');
SET ROLE anon;
SELECT pg_temp.err('anon SELECT refused', 'SELECT 1 FROM public.note_favorites', 'permission denied');
RESET ROLE;
SELECT pg_temp.ok(format('%-13s SELECT=%s INSERT=%s UPDATE=%s DELETE=%s TRUNCATE=%s REFERENCES=%s TRIGGER=%s', r,
                         has_table_privilege(r, 'public.note_favorites', 'SELECT'), has_table_privilege(r, 'public.note_favorites', 'INSERT'),
                         has_table_privilege(r, 'public.note_favorites', 'UPDATE'), has_table_privilege(r, 'public.note_favorites', 'DELETE'),
                         has_table_privilege(r, 'public.note_favorites', 'TRUNCATE'), has_table_privilege(r, 'public.note_favorites', 'REFERENCES'),
                         has_table_privilege(r, 'public.note_favorites', 'TRIGGER')),
                  CASE r
                    WHEN 'authenticated' THEN has_table_privilege(r, 'public.note_favorites', 'SELECT')
                      AND NOT has_table_privilege(r, 'public.note_favorites', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    WHEN 'anon' THEN NOT has_table_privilege(r, 'public.note_favorites', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    WHEN 'service_role' THEN has_table_privilege(r, 'public.note_favorites', 'SELECT') AND has_table_privilege(r, 'public.note_favorites', 'INSERT')
                      AND has_table_privilege(r, 'public.note_favorites', 'UPDATE') AND has_table_privilege(r, 'public.note_favorites', 'DELETE')
                      AND has_table_privilege(r, 'public.note_favorites', 'TRUNCATE')
                  END)
  FROM unnest(ARRAY['authenticated', 'anon', 'service_role']) r;
SELECT '  note_favorites relacl = ' || relacl::text FROM pg_class WHERE oid = 'public.note_favorites'::regclass;

\echo
\echo ==== 13. Function grants
WITH f(sig, role, want) AS (VALUES
  ('public.notes_op_file(uuid,uuid,boolean,text)',              'anon',          false),
  ('public.notes_op_set_favorite(uuid,uuid,boolean,text)',      'anon',          false),
  ('public.notes_op_file(uuid,uuid,boolean,text)',              'authenticated', true),
  ('public.notes_op_set_favorite(uuid,uuid,boolean,text)',      'authenticated', true),
  ('public.notes_op_file(uuid,uuid,boolean,text)',              'service_role',  true),
  ('public.notes_op_set_favorite(uuid,uuid,boolean,text)',      'service_role',  true),
  ('public.notes__keep_access_on_reroot(uuid,uuid)',            'authenticated', false),
  ('public.notes__keep_access_on_reroot(uuid,uuid)',            'anon',          false),
  ('public.notes__keep_access_on_reroot(uuid,uuid)',            'service_role',  true),
  ('public.notes_in_inbox_default()',                           'authenticated', false),
  ('public.notes_in_inbox_default()',                           'anon',          false),
  ('public.note_favorites__member_removed()',                   'authenticated', false),
  ('public.note_favorites__member_removed()',                   'anon',          false),
  ('public.notes_op_set_meta(uuid,uuid,jsonb)',                 'anon',          false),
  ('public.notes_op_set_meta(uuid,uuid,jsonb)',                 'authenticated', true),
  ('public.notes_op_duplicate(uuid,uuid,text)',                 'anon',          false),
  ('public.notes_op_duplicate(uuid,uuid,text)',                 'authenticated', true),
  ('public.notes_op_import(uuid,jsonb)',                        'anon',          false),
  ('public.notes_op_import(uuid,jsonb)',                        'authenticated', true))
SELECT pg_temp.ok(format('%-55s %-13s EXECUTE=%s', sig, role, has_function_privilege(role, sig, 'EXECUTE')),
                  has_function_privilege(role, sig, 'EXECUTE') = want) FROM f;
SET ROLE authenticated;
SELECT pg_temp.err('authenticated calling notes__keep_access_on_reroot refused',
  format('SELECT public.notes__keep_access_on_reroot(%L, %L)', :'W', :'K'), 'permission denied');
RESET ROLE;

\echo
\echo ==== 14. Member removal and account erasure
RESET ROLE;
RESET request.jwt.claim.sub;  -- system work: account erasure runs with no end-user actor
SELECT pg_temp.ok(format('B has %s favorites in W before removal', count(*)), count(*) > 0) FROM public.note_favorites WHERE user_id = :'B' AND workspace_id = :'W';
DELETE FROM public.workspace_members WHERE workspace_id = :'W' AND user_id = :'B';
SELECT pg_temp.ok('B''s favorites in W gone after leaving', count(*) = 0) FROM public.note_favorites WHERE user_id = :'B' AND workspace_id = :'W';
SELECT pg_temp.ok(format('C has %s favorites before account deletion', count(*)), count(*) > 0) FROM public.note_favorites WHERE user_id = :'C';
DELETE FROM auth.users WHERE id = :'C';
SELECT pg_temp.ok('C''s favorites gone after auth.users delete', count(*) = 0) FROM public.note_favorites WHERE user_id = :'C';
SELECT pg_temp.ok('A''s favorites untouched', count(*) > 0) FROM public.note_favorites WHERE user_id = :'A';

\echo
\echo ==== 15. Re-apply the migration (single transaction)
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT public.notes_op_set_favorite(:'W', :'PIN', false);  -- A unfavorites a pinned note before the re-run
RESET ROLE;
RESET request.jwt.claim.sub;
CREATE TEMP TABLE snap_notes AS SELECT id, title, in_inbox, full_width, updated_at FROM public.notes;
CREATE TEMP TABLE snap_favs AS SELECT user_id, note_id, position FROM public.note_favorites;
BEGIN;
\ir ../../../../supabase/migrations/20261013120000_notes_refresh_organize.sql
INSERT INTO public.replica_activity (action) VALUES ('reapply-marker');
COMMIT;
SELECT pg_temp.ok('re-apply committed without error', EXISTS (SELECT 1 FROM public.replica_activity WHERE action = 'reapply-marker'));
SELECT pg_temp.ok('re-apply: still exactly one notes_in_inbox_default trigger and one member trigger',
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('notes_in_inbox_default', 'note_favorites_member_removed')) = 2);
\echo -- data drift caused by re-running (informational: a migration runs once)
SELECT format('  in_inbox changed by re-run: %s %s -> %s', s.title, s.in_inbox, n.in_inbox)
  FROM snap_notes s JOIN public.notes n USING (id) WHERE s.in_inbox IS DISTINCT FROM n.in_inbox ORDER BY s.title;
SELECT format('  favorite re-added by re-run: user %s note %s', right(f.user_id::text, 1), n.title)
  FROM public.note_favorites f JOIN public.notes n ON n.id = f.note_id
 WHERE NOT EXISTS (SELECT 1 FROM snap_favs s WHERE s.user_id = f.user_id AND s.note_id = f.note_id);
SELECT pg_temp.ok('re-run left updated_at untouched',
  NOT EXISTS (SELECT 1 FROM snap_notes s JOIN public.notes n USING (id) WHERE s.updated_at IS DISTINCT FROM n.updated_at));

\echo
\echo ==== Summary
\echo (count PASS/FAIL lines in this output)
