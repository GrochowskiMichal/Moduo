-- Probe for supabase/migrations/20261008013000_account_erase_workspace_data.sql
-- and its follow-up 20261008040000_account_erasure_private_shortcut.sql
-- (PRIV-2a, specs/privacy-account-erasure.md). Run it on a throwaway Postgres 17
-- database that holds nothing else, after the stub and the migrations:
--
--   createdb -h /tmp -p 54329 -U postgres erasure_probe
--   psql -h /tmp -p 54329 -U postgres -d erasure_probe -v ON_ERROR_STOP=1 -q \
--     -f supabase/probes/account-erasure.stub.sql \
--     -f supabase/migrations/20261008013000_account_erase_workspace_data.sql \
--     -f supabase/migrations/20261008040000_account_erasure_private_shortcut.sql \
--     -f supabase/probes/account-erasure.probe.sql
--
-- Every check stops the run with the failing check's message. A clean run
-- prints one PASS line per acceptance criterion and ends with "PASS: all".
--
-- Cast: X is the account being deleted. O owns workspace W, where X, B, C and
-- V (a viewer) are members, and Z was one (Z left; Z's chat rows remain). X
-- owns WX alone. W3 and W4 (also O's) test member removal (D) and a dashboard
-- deletion (E).

CREATE SCHEMA probe;
GRANT USAGE, CREATE ON SCHEMA probe TO service_role;

-- People get fixed ids: B joined W before C but sorts after C by id, so the
-- join-order tie-break can't pass by accident. Everything else is named.
CREATE FUNCTION probe.id(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'X' THEN '00000000-0000-4000-8000-000000000001'
    WHEN 'O' THEN '00000000-0000-4000-8000-000000000002'
    WHEN 'C' THEN '00000000-0000-4000-8000-000000000003'
    WHEN 'V' THEN '00000000-0000-4000-8000-000000000005'
    WHEN 'D' THEN '00000000-0000-4000-8000-000000000006'
    WHEN 'E' THEN '00000000-0000-4000-8000-000000000007'
    WHEN 'Z' THEN '00000000-0000-4000-8000-000000000008'
    WHEN 'B' THEN '00000000-0000-4000-8000-000000000009'
    ELSE md5('probe:' || p_name)::text
  END::uuid
$$;

CREATE FUNCTION probe.perms(p_actions text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_agg(m || '.' || a)
  FROM unnest(ARRAY['notes', 'tasks', 'contacts', 'calendar', 'chat']) AS m, unnest(p_actions) AS a
$$;

-- Fingerprint of every table, for "preview changes nothing".
CREATE FUNCTION probe.state() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r record;
  h text;
  v text := '';
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth') AND c.relkind = 'r' ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(t::text, E''\n'' ORDER BY t::text), '''')) FROM %I.%I t',
                   r.nspname, r.relname) INTO h;
    v := v || r.nspname || '.' || r.relname || ' ' || h || E'\n';
  END LOOP;
  RETURN v;
END;
$$;

-- Who (other than X) can view what, by the same can_access every policy uses.
CREATE FUNCTION probe.items() RETURNS TABLE (item text, workspace_id uuid) LANGUAGE sql STABLE AS $$
  SELECT 'note:' || id, workspace_id FROM public.notes
  UNION ALL SELECT 'bucket:' || id, workspace_id FROM public.buckets
  UNION ALL SELECT 'task:' || id, workspace_id FROM public.tasks
  UNION ALL SELECT 'contact:' || id, workspace_id FROM public.contacts
  UNION ALL SELECT 'contact_group:' || id, workspace_id FROM public.contact_groups
  UNION ALL SELECT 'company:' || id, workspace_id FROM public.companies
  UNION ALL SELECT 'calendar:' || id, workspace_id FROM public.calendars
  UNION ALL SELECT 'event:' || id, workspace_id FROM public.calendar_events
$$;
CREATE FUNCTION probe.visible() RETURNS TABLE (user_id uuid, item text) LANGUAGE sql STABLE AS $$
  SELECT m.user_id, i.item
  FROM probe.items() i
  JOIN public.workspace_members m ON m.workspace_id = i.workspace_id
  WHERE m.user_id <> probe.id('X')
    AND public.can_access(split_part(i.item, ':', 1), split_part(i.item, ':', 2)::uuid, 'view', m.user_id)
$$;

-- ── The migration's one-time fix (rows the stub added before it ran) ─────────

DO $$
BEGIN
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = 'f0000000-0000-4000-8000-000000000020') IS NULL,
    'a task assigned to someone removed earlier is still assigned';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = 'f0000000-0000-4000-8000-000000000021')
    = 'f0000000-0000-4000-8000-000000000002', 'a member''s task was unassigned';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = 'f0000000-0000-4000-8000-000000000022')
    = 'f0000000-0000-4000-8000-000000000001', 'the owner''s task was unassigned';
  ASSERT current_setting('share.bypass', true) IS DISTINCT FROM '1', 'the migration left share.bypass on';
  RAISE NOTICE 'PASS AC9: tasks frozen by earlier removals are unassigned once, nobody else''s';
END;
$$;

-- ── Fixtures (as the database owner, no signed-in user) ──────────────────────

INSERT INTO auth.users (id, email)
SELECT probe.id(n), lower(n) || '@example.com' FROM unnest(ARRAY['X', 'O', 'B', 'C', 'V', 'D', 'E', 'Z']) AS n;
INSERT INTO public.profiles (id, display_name) VALUES
  (probe.id('X'), 'Xavier'), (probe.id('O'), 'Olga'), (probe.id('B'), 'Bea'), (probe.id('C'), 'Cyril'),
  (probe.id('V'), 'Vera'), (probe.id('D'), 'Dee'), (probe.id('E'), 'Eve'), (probe.id('Z'), 'Zed');

INSERT INTO public.workspaces (id, name, owner_id) VALUES
  (probe.id('W'), 'Team', probe.id('O')),
  (probe.id('WX'), 'Solo', probe.id('X')),
  (probe.id('W3'), 'Removal', probe.id('O')),
  (probe.id('W4'), 'Dashboard', probe.id('O'));

INSERT INTO public.workspace_members (workspace_id, user_id, role, perms, joined_at) VALUES
  (probe.id('W'), probe.id('O'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01'),
  (probe.id('W'), probe.id('X'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-02'),
  (probe.id('W'), probe.id('B'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-03'),
  (probe.id('W'), probe.id('C'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-04'),
  (probe.id('W'), probe.id('V'), 'viewer', probe.perms(ARRAY['view']), '2026-01-05'),
  (probe.id('WX'), probe.id('X'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01'),
  (probe.id('W3'), probe.id('O'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01'),
  (probe.id('W3'), probe.id('D'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-02'),
  (probe.id('W4'), probe.id('O'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01'),
  (probe.id('W4'), probe.id('E'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-02');

-- Notes.
INSERT INTO public.notes (id, workspace_id, created_by, title, share_mode, deleted_at, publish_token, published_at) VALUES
  (probe.id('N1'), probe.id('W'), probe.id('X'), 'X private', 'custom', NULL, NULL, NULL),
  (probe.id('N2'), probe.id('W'), probe.id('X'), 'X shared with the workspace', 'custom', NULL, NULL, NULL),
  (probe.id('N3'), probe.id('W'), probe.id('X'), 'X shared with B (view) and C (edit)', 'custom', NULL, NULL, NULL),
  (probe.id('N4'), probe.id('W'), probe.id('X'), 'X shared with C then B (edit)', 'custom', NULL, NULL, NULL),
  (probe.id('N5'), probe.id('W'), probe.id('X'), 'X shared with B and C at once (edit)', 'custom', NULL, NULL, NULL),
  (probe.id('N6'), probe.id('W'), probe.id('X'), 'X private, published', 'custom', NULL, 'tok-n6', now()),
  (probe.id('N7'), probe.id('W'), probe.id('X'), 'X shared with the viewer only', 'custom', NULL, NULL, NULL),
  (probe.id('N9'), probe.id('W'), probe.id('X'), 'X private, in the trash', 'custom', now(), NULL, NULL),
  (probe.id('NB'), probe.id('W'), probe.id('B'), 'B shared with the workspace', 'custom', NULL, 'tok-nb', now()),
  (probe.id('NB2'), probe.id('W'), probe.id('B'), 'B shared with X', 'custom', NULL, NULL, NULL),
  (probe.id('NX'), probe.id('WX'), probe.id('X'), 'X in their own workspace', 'custom', NULL, NULL, NULL);
INSERT INTO public.notes (id, workspace_id, created_by, title, parent_id, share_mode) VALUES
  (probe.id('N1c'), probe.id('W'), probe.id('B'), 'B under X private', probe.id('N1'), 'custom'),
  (probe.id('N1x'), probe.id('W'), probe.id('X'), 'X under X private, inherits', probe.id('N1'), 'inherit'),
  (probe.id('N8'), probe.id('W'), probe.id('X'), 'X under B shared, inherits', probe.id('NB'), 'inherit');

INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_at) VALUES
  (probe.id('W'), 'note', probe.id('N2'), 'workspace', NULL, 'edit', '2026-02-01 09:00'),
  (probe.id('W'), 'note', probe.id('N3'), 'member', probe.id('B'), 'view', '2026-02-01 10:00'),
  (probe.id('W'), 'note', probe.id('N3'), 'member', probe.id('C'), 'edit', '2026-02-01 11:00'),
  (probe.id('W'), 'note', probe.id('N4'), 'member', probe.id('C'), 'edit', '2026-02-01 10:00'),
  (probe.id('W'), 'note', probe.id('N4'), 'member', probe.id('B'), 'edit', '2026-02-01 11:00'),
  (probe.id('W'), 'note', probe.id('N5'), 'member', probe.id('C'), 'edit', '2026-02-01 12:00'),
  (probe.id('W'), 'note', probe.id('N5'), 'member', probe.id('B'), 'edit', '2026-02-01 12:00'),
  (probe.id('W'), 'note', probe.id('N7'), 'member', probe.id('V'), 'view', '2026-02-01 10:00'),
  (probe.id('W'), 'note', probe.id('NB'), 'workspace', NULL, 'view', '2026-02-01 10:00'),
  (probe.id('W'), 'note', probe.id('NB2'), 'member', probe.id('X'), 'view', '2026-02-01 10:00');

INSERT INTO public.note_updates (workspace_id, note_id, update_b64) VALUES
  (probe.id('W'), probe.id('N1'), 'AAA='), (probe.id('W'), probe.id('N2'), 'BBB=');
INSERT INTO public.note_shares (note_id, workspace_id, user_id) VALUES
  (probe.id('N1'), probe.id('W'), probe.id('B')), (probe.id('N2'), probe.id('W'), probe.id('C'));
INSERT INTO public.exposed_notes (note_id, title) VALUES
  (probe.id('N1')::text, 'X private'), (probe.id('N6')::text, 'X private, published'),
  (probe.id('NB')::text, 'B shared with the workspace');

-- Buckets and tasks. share_bucket_after shares every new non-system bucket
-- with the workspace; BP is made private afterwards.
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (probe.id('BI'), probe.id('W'), probe.id('X'), 'Inbox', true),
  (probe.id('BIC'), probe.id('W'), probe.id('C'), 'Inbox', true),
  (probe.id('BP'), probe.id('W'), probe.id('X'), 'X private bucket', false),
  (probe.id('BS'), probe.id('W'), probe.id('X'), 'X shared bucket', false),
  (probe.id('BB'), probe.id('W'), probe.id('B'), 'B bucket', false),
  (probe.id('BX'), probe.id('WX'), probe.id('X'), 'X solo bucket', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = probe.id('BP');

-- share_task_assign gives an assignee who can't edit the bucket a task grant.
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title) VALUES
  (probe.id('TI1'), probe.id('W'), probe.id('BI'), probe.id('B'), 'In X Inbox, assigned to B'),
  (probe.id('TI2'), probe.id('W'), probe.id('BI'), probe.id('X'), 'In X Inbox, assigned to X'),
  (probe.id('TI3'), probe.id('W'), probe.id('BI'), probe.id('C'), 'In X Inbox, assigned to C'),
  (probe.id('TI4'), probe.id('W'), probe.id('BI'), probe.id('B'), 'In X Inbox, assigned to B, shared with all'),
  (probe.id('TP7'), probe.id('W'), probe.id('BP'), NULL, 'X private bucket, task shared with all'),
  (probe.id('TP1'), probe.id('W'), probe.id('BP'), NULL, 'X private'),
  (probe.id('TP2'), probe.id('W'), probe.id('BP'), NULL, 'X private bucket, shared with C'),
  (probe.id('TP3'), probe.id('W'), probe.id('BP'), NULL, 'X private parent'),
  (probe.id('TP5'), probe.id('W'), probe.id('BP'), NULL, 'X private bucket, parent shared with B'),
  (probe.id('TS1'), probe.id('W'), probe.id('BS'), probe.id('X'), 'Shared bucket, assigned to X'),
  (probe.id('TS2'), probe.id('W'), probe.id('BS'), probe.id('B'), 'Shared bucket, assigned to B'),
  (probe.id('TB1'), probe.id('W'), probe.id('BB'), probe.id('X'), 'B bucket, assigned to X'),
  (probe.id('TB2'), probe.id('W'), probe.id('BB'), probe.id('B'), 'B bucket, assigned to B'),
  (probe.id('TX'), probe.id('WX'), probe.id('BX'), probe.id('X'), 'X solo task');
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, parent_id) VALUES
  (probe.id('TP4'), probe.id('W'), probe.id('BP'), NULL, 'Subtask shared with C', probe.id('TP3')),
  (probe.id('TP6'), probe.id('W'), probe.id('BP'), NULL, 'Private subtask', probe.id('TP5'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level) VALUES
  (probe.id('W'), 'task', probe.id('TP2'), 'member', probe.id('C'), 'view'),
  (probe.id('W'), 'task', probe.id('TP4'), 'member', probe.id('C'), 'view'),
  (probe.id('W'), 'task', probe.id('TP5'), 'member', probe.id('B'), 'view'),
  (probe.id('W'), 'task', probe.id('TI4'), 'workspace', NULL, 'view'),
  (probe.id('W'), 'task', probe.id('TP7'), 'workspace', NULL, 'view');
INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES
  (probe.id('W'), probe.id('TP1'), probe.id('TB1'));
INSERT INTO public.task_time_blocks (workspace_id, blocks) VALUES (probe.id('W'), jsonb_build_object(
  'mon-09', probe.id('BP'), 'mon-10', probe.id('BB'), 'tue-09', probe.id('BI'), 'wed-09', NULL));
-- tasks_notify_spine logged assignments without an actor; not part of the cast.
DELETE FROM public.module_activity;

-- Contacts, groups, companies.
INSERT INTO public.companies (id, workspace_id, owner_id, name) VALUES
  (probe.id('COP'), probe.id('W'), probe.id('X'), 'Only X private contact works here'),
  (probe.id('COS'), probe.id('W'), probe.id('X'), 'X shared contact works here'),
  (probe.id('COB'), probe.id('W'), probe.id('B'), 'B company'),
  (probe.id('COX'), probe.id('W'), probe.id('X'), 'X company, nobody works here');
INSERT INTO public.contacts (id, workspace_id, owner_id, name, company_id) VALUES
  (probe.id('CP'), probe.id('W'), probe.id('X'), 'X private', probe.id('COP')),
  (probe.id('CP2'), probe.id('W'), probe.id('X'), 'X private, in X private group', NULL),
  (probe.id('CP3'), probe.id('W'), probe.id('X'), 'X private, at B company', probe.id('COB')),
  (probe.id('CS'), probe.id('W'), probe.id('X'), 'X shared with the workspace', probe.id('COS')),
  (probe.id('CGc'), probe.id('W'), probe.id('X'), 'X, only in a group shared with B', NULL),
  (probe.id('CB'), probe.id('W'), probe.id('B'), 'B shared', probe.id('COB'));
INSERT INTO public.contact_groups (id, workspace_id, owner_id, name) VALUES
  (probe.id('CG'), probe.id('W'), probe.id('X'), 'X group shared with B'),
  (probe.id('CG2'), probe.id('W'), probe.id('X'), 'X private group');
INSERT INTO public.contact_group_members (group_id, contact_id) VALUES
  (probe.id('CG'), probe.id('CGc')), (probe.id('CG2'), probe.id('CP2')), (probe.id('CG2'), probe.id('CB'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level) VALUES
  (probe.id('W'), 'contact', probe.id('CS'), 'workspace', NULL, 'view'),
  (probe.id('W'), 'contact', probe.id('CB'), 'workspace', NULL, 'view'),
  (probe.id('W'), 'contact_group', probe.id('CG'), 'member', probe.id('B'), 'edit');
INSERT INTO public.contact_private_notes (contact_id, user_id, body) VALUES
  (probe.id('CP'), probe.id('B'), 'B note on X private contact');

-- Calendars, sets, accounts, events.
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id) VALUES
  (probe.id('CACC'), probe.id('W'), probe.id('X'));
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind, account_id) VALUES
  (probe.id('CAL1'), probe.id('W'), probe.id('X'), 'X calendar', 'moduo', NULL),
  (probe.id('CAL2'), probe.id('W'), probe.id('X'), 'xavier@gmail.com', 'integration', probe.id('CACC')),
  (probe.id('CALB'), probe.id('W'), probe.id('B'), 'B calendar', 'moduo', NULL);
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level) VALUES
  (probe.id('W'), 'calendar', probe.id('CAL1'), 'member', probe.id('B'), 'view'),
  (probe.id('W'), 'calendar', probe.id('CALB'), 'workspace', NULL, 'view');
INSERT INTO public.calendar_sets (id, workspace_id, owner_id, name) VALUES
  (probe.id('CSET'), probe.id('W'), probe.id('X'), 'X set'),
  (probe.id('BSET'), probe.id('W'), probe.id('B'), 'B set');
INSERT INTO public.calendar_set_items (set_id, calendar_id) VALUES
  (probe.id('CSET'), probe.id('CAL1')), (probe.id('CSET'), probe.id('CALB')),
  (probe.id('BSET'), probe.id('CAL1')), (probe.id('BSET'), probe.id('CALB'));
INSERT INTO public.calendar_events (id, workspace_id, owner_id, title, calendar_ref, source_account_id, deleted_at) VALUES
  (probe.id('EV1'), probe.id('W'), probe.id('X'), 'X event', probe.id('CAL1'), NULL, NULL),
  (probe.id('EV2'), probe.id('W'), probe.id('X'), 'X synced event', probe.id('CAL2'), probe.id('CACC'), NULL),
  (probe.id('EV3'), probe.id('W'), probe.id('X'), 'X event in the trash', probe.id('CAL1'), NULL, now()),
  (probe.id('EVB'), probe.id('W'), probe.id('B'), 'B event', probe.id('CALB'), NULL, NULL);
INSERT INTO public.slot_bookings (id, contact_id, calendar_event_id) VALUES
  (probe.id('SB1'), probe.id('CP'), probe.id('EV1')), (probe.id('SB2'), probe.id('CB'), probe.id('EVB'));

-- Email.
INSERT INTO public.email_accounts (id, workspace_id, owner_id, address) VALUES
  (probe.id('EACC'), probe.id('W'), probe.id('X'), 'xavier@gmail.com'),
  (probe.id('EBA'), probe.id('W'), probe.id('B'), 'bea@gmail.com');
INSERT INTO public.email_refs (id, workspace_id, owner_id, account_id, subject) VALUES
  (probe.id('EREF'), probe.id('W'), probe.id('X'), probe.id('EACC'), 'X thread'),
  (probe.id('EREF2'), probe.id('W'), probe.id('X'), NULL, 'X thread, no account'),
  (probe.id('EBR'), probe.id('W'), probe.id('B'), probe.id('EBA'), 'B thread');

-- Chat.
INSERT INTO public.chat_channels (id, workspace_id, kind, name, is_private, managers_only, created_by) VALUES
  (probe.id('CH_SELF'), probe.id('W'), 'dm', NULL, true, false, probe.id('X')),
  (probe.id('CH_DM'), probe.id('W'), 'dm', NULL, true, false, probe.id('X')),
  (probe.id('CH_ALONE'), probe.id('W'), 'channel', 'X alone', true, false, probe.id('X')),
  (probe.id('CH_PRIV'), probe.id('W'), 'channel', 'X, C and B', true, true, probe.id('X')),
  (probe.id('CH_PRIV_O'), probe.id('W'), 'channel', 'X and O', true, true, probe.id('X')),
  (probe.id('CH_PUB'), probe.id('W'), 'channel', 'announcements', false, true, probe.id('X')),
  (probe.id('CH_PUB2'), probe.id('W'), 'channel', 'co-managed', false, true, probe.id('X')),
  (probe.id('CH_DM_Z'), probe.id('W'), 'dm', NULL, true, false, probe.id('X')),
  (probe.id('CH_PRIV_Z'), probe.id('W'), 'channel', 'X, Z (left) and C', true, true, probe.id('X')),
  (probe.id('CH_PUB_Z'), probe.id('W'), 'channel', 'co-managed with Z (left)', false, true, probe.id('X'));
INSERT INTO public.chat_members (channel_id, user_id, workspace_id, joined_at) VALUES
  (probe.id('CH_SELF'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_DM'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_DM'), probe.id('B'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_ALONE'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PRIV'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PRIV'), probe.id('C'), probe.id('W'), '2026-03-02'),
  (probe.id('CH_PRIV'), probe.id('B'), probe.id('W'), '2026-03-03'),
  (probe.id('CH_PRIV_O'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PRIV_O'), probe.id('O'), probe.id('W'), '2026-03-04'),
  (probe.id('CH_PUB'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PUB'), probe.id('B'), probe.id('W'), '2026-03-02'),
  (probe.id('CH_PUB2'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PUB2'), probe.id('B'), probe.id('W'), '2026-03-02'),
  (probe.id('CH_DM_Z'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_DM_Z'), probe.id('Z'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PRIV_Z'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PRIV_Z'), probe.id('Z'), probe.id('W'), '2026-03-02'),
  (probe.id('CH_PRIV_Z'), probe.id('C'), probe.id('W'), '2026-03-05'),
  (probe.id('CH_PUB_Z'), probe.id('X'), probe.id('W'), '2026-03-01'),
  (probe.id('CH_PUB_Z'), probe.id('B'), probe.id('W'), '2026-03-02');
INSERT INTO public.chat_channel_managers (channel_id, user_id) VALUES
  (probe.id('CH_ALONE'), probe.id('X')), (probe.id('CH_PRIV'), probe.id('X')),
  (probe.id('CH_PRIV_O'), probe.id('X')), (probe.id('CH_PUB'), probe.id('X')),
  (probe.id('CH_PUB2'), probe.id('X')), (probe.id('CH_PUB2'), probe.id('B')),
  (probe.id('CH_PRIV_Z'), probe.id('X')),
  (probe.id('CH_PUB_Z'), probe.id('X')), (probe.id('CH_PUB_Z'), probe.id('Z'));
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body) VALUES
  (probe.id('M_SELF'), probe.id('W'), probe.id('CH_SELF'), probe.id('X'), 'note to self'),
  (probe.id('M_DM_X'), probe.id('W'), probe.id('CH_DM'), probe.id('X'), 'hi Bea'),
  (probe.id('M_DM_B'), probe.id('W'), probe.id('CH_DM'), probe.id('B'), 'hi Xavier'),
  (probe.id('M_PUB_X'), probe.id('W'), probe.id('CH_PUB'), probe.id('X'), 'announcement'),
  (probe.id('M_DM_Z'), probe.id('W'), probe.id('CH_DM_Z'), probe.id('X'), 'hi Zed (who left)');

-- The spine: registry, links, comments, tags, declines, activity, read state.
INSERT INTO public.entities (workspace_id, entity_type, entity_id, label) VALUES
  (probe.id('W'), 'note', probe.id('N1'), 'X private'),
  (probe.id('W'), 'note', probe.id('N2'), 'X shared with the workspace'),
  (probe.id('W'), 'note', probe.id('NB'), 'B shared with the workspace'),
  (probe.id('W'), 'task', probe.id('TP1'), 'X private'),
  (probe.id('W'), 'task', probe.id('TB1'), 'B bucket, assigned to X'),
  (probe.id('W'), 'bucket', probe.id('BP'), 'X private bucket'),
  (probe.id('W'), 'contact', probe.id('CP'), 'X private'),
  (probe.id('W'), 'company', probe.id('COP'), 'Only X private contact works here'),
  (probe.id('W'), 'event', probe.id('EV1'), 'X event'),
  (probe.id('W'), 'email_thread', probe.id('EREF'), 'X thread'),
  (probe.id('WX'), 'note', probe.id('NX'), 'X in their own workspace');
INSERT INTO public.entity_links (id, workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by, pair_key) VALUES
  (probe.id('L1'), probe.id('W'), 'note', probe.id('N1'), 'task', probe.id('TB1'), 'references', probe.id('X'),
   public.spine_pair_key('note', probe.id('N1'), 'task', probe.id('TB1'))),
  (probe.id('L2'), probe.id('W'), 'note', probe.id('N2'), 'task', probe.id('TB1'), 'references', probe.id('X'),
   public.spine_pair_key('note', probe.id('N2'), 'task', probe.id('TB1'))),
  (probe.id('L3'), probe.id('W'), 'task', probe.id('TP1'), 'task', probe.id('TB1'), 'blocks', probe.id('X'),
   public.spine_pair_key('task', probe.id('TP1'), 'task', probe.id('TB1'))),
  (probe.id('L4'), probe.id('W'), 'note', probe.id('NB'), 'contact', probe.id('CP'), 'references', probe.id('B'),
   public.spine_pair_key('note', probe.id('NB'), 'contact', probe.id('CP')));
INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, body, created_by) VALUES
  (probe.id('K_N1'), probe.id('W'), 'note', probe.id('N1'), 'X on X private', probe.id('X')),
  (probe.id('K_N2'), probe.id('W'), 'note', probe.id('N2'), 'X on X shared', probe.id('X')),
  (probe.id('K_NB'), probe.id('W'), 'note', probe.id('NB'), 'X on B shared', probe.id('X'));
INSERT INTO public.tag_links (id, workspace_id, tag_id, entity_type, entity_id) VALUES
  (probe.id('TL_N1'), probe.id('W'), probe.id('TAG'), 'note', probe.id('N1')),
  (probe.id('TL_N2'), probe.id('W'), probe.id('TAG'), 'note', probe.id('N2')),
  (probe.id('TL_CP'), probe.id('W'), probe.id('TAG'), 'contact', probe.id('CP')),
  (probe.id('TL_BP'), probe.id('W'), probe.id('TAG'), 'bucket', probe.id('BP'));
INSERT INTO public.link_suggestion_declines (id, workspace_id, pair_key, declined_by) VALUES
  (probe.id('D_N1'), probe.id('W'), public.spine_pair_key('note', probe.id('N1'), 'task', probe.id('TB1')), probe.id('X')),
  (probe.id('D_N2'), probe.id('W'), public.spine_pair_key('note', probe.id('N2'), 'task', probe.id('TB1')), probe.id('X')),
  (probe.id('D_CP'), probe.id('W'), public.spine_pair_key('contact', probe.id('CP'), 'note', probe.id('NB')), probe.id('B'));
INSERT INTO public.module_activity (id, workspace_id, module, entity_type, entity_id, op, actor_id, actor_label, payload) VALUES
  (probe.id('A1'), probe.id('W'), 'notes', 'note', probe.id('N1'), 'notes.update', probe.id('X'), 'Xavier', '{}'),
  (probe.id('A2'), probe.id('W'), 'notes', 'note', probe.id('N2'), 'notes.update', probe.id('X'), 'Xavier', '{}'),
  (probe.id('A3'), probe.id('W'), 'links', 'task', probe.id('TB1'), 'links.create', probe.id('X'), 'Xavier',
   jsonb_build_object('target_type', 'note', 'target_id', probe.id('N1'))),
  (probe.id('A4'), probe.id('W'), 'tasks', 'task', probe.id('TB2'), 'tasks.update', probe.id('B'), 'Bea', '{}'),
  (probe.id('A5'), probe.id('W'), 'calendar', 'calendar_account', probe.id('CACC'), 'calendar.account_connect',
   probe.id('X'), 'Xavier', '{"label": "xavier@gmail.com"}'),
  (probe.id('A6'), probe.id('W'), 'calendar', 'calendar_account', probe.id('CACC_GONE'), 'calendar.account_remove',
   probe.id('X'), 'Xavier', '{"label": "xavier@old.com"}'),
  (probe.id('A7'), probe.id('W'), 'email', 'email_thread', probe.id('EREF'), 'email.snooze', probe.id('X'), 'Xavier', '{}'),
  (probe.id('A8'), probe.id('W'), 'calendar', 'event', probe.id('EVB'), 'calendar.update', probe.id('X'), 'Xavier', '{}'),
  (probe.id('A9'), probe.id('W'), 'calendar', 'event', probe.id('EV_GONE'), 'calendar.update', probe.id('X'), 'Xavier', '{}'),
  (probe.id('A10'), probe.id('W'), 'chat', 'chat_channel', probe.id('CH_SELF'), 'chat.create', probe.id('X'), 'Xavier', '{}'),
  (probe.id('A11'), probe.id('W'), 'contacts', 'contact', probe.id('CP'), 'contacts.create', probe.id('X'), 'Xavier', '{}'),
  (probe.id('A12'), probe.id('W'), 'tasks', 'task', probe.id('TB1'), 'tasks.update', probe.id('X'), 'Xavier', '{}'),
  (probe.id('AX'), probe.id('WX'), 'notes', 'note', probe.id('NX'), 'notes.update', probe.id('X'), 'Xavier', '{}');
INSERT INTO public.notification_state (workspace_id, user_id, activity_id) VALUES
  (probe.id('W'), probe.id('B'), probe.id('A1')),
  (probe.id('W'), probe.id('B'), probe.id('A2')),
  (probe.id('W'), probe.id('X'), probe.id('A4')),
  (probe.id('WX'), probe.id('X'), probe.id('AX'));
INSERT INTO public.workspace_invites (id, workspace_id, email, status) VALUES
  (probe.id('I_X'), probe.id('W'), 'X@Example.com', 'accepted'),
  (probe.id('I_X3'), probe.id('W3'), 'x@example.com', 'accepted'),
  (probe.id('I_XP'), probe.id('W4'), 'x@example.com', 'pending'),
  (probe.id('I_B'), probe.id('W'), 'b@example.com', 'accepted'),
  (probe.id('I_XX'), probe.id('WX'), 'x@example.com', 'accepted');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, created_by) VALUES
  (probe.id('K1'), probe.id('W'), 'X key', probe.id('X')),
  (probe.id('K2'), probe.id('W'), 'B key', probe.id('B')),
  (probe.id('KX'), probe.id('WX'), 'X solo key', probe.id('X'));

-- ── Grants: service role only ────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.account_erasure_rank(text, uuid, uuid)',
    'public.account_erasure_new_owner(text, uuid, uuid, uuid)',
    'public.account_erasure_inbox(uuid, uuid)',
    'public.account_erase_workspace_data(uuid, boolean)',
    'public.account_erasure_only_creator(text, uuid)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), fn || ': anon can execute';
    ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), fn || ': authenticated can execute';
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), fn || ': service_role can''t execute';
  END LOOP;
  RAISE NOTICE 'PASS: only the service role can run the erasure functions';
END;
$$;

-- ── Preview (the default) changes nothing (AC12) ─────────────────────────────

CREATE TABLE probe.expected AS SELECT jsonb_build_object(
  'notes_deleted', 4,                -- N1, N1x, N6, N9
  'notes_handed_over', 6,            -- N2, N3, N4, N5, N7, N8
  'buckets_deleted', 2,              -- BI, BP
  'buckets_handed_over', 1,          -- BS
  'tasks_deleted', 4,                -- TI2, TP1, TP3, TP6
  'tasks_moved', 7,                  -- TI1, TI3, TI4, TP2, TP4, TP5, TP7
  'tasks_unassigned', 2,             -- TS1, TB1
  'contacts_deleted', 3,             -- CP, CP2, CP3
  'contacts_handed_over', 2,         -- CS, CGc
  'contact_groups_deleted', 1,       -- CG2
  'contact_groups_handed_over', 1,   -- CG
  'companies_deleted', 2,            -- COP, COX
  'companies_handed_over', 1,        -- COS
  'events_deleted', 3,               -- EV1, EV2, EV3
  'calendars_deleted', 2,            -- CAL1, CAL2
  'calendar_sets_deleted', 1,        -- CSET
  'calendar_accounts_deleted', 1,    -- CACC
  'email_refs_deleted', 2,           -- EREF, EREF2
  'email_accounts_deleted', 1,       -- EACC
  'chat_channels_deleted', 3,        -- CH_SELF, CH_ALONE, CH_DM_Z
  'chat_managers_handed_over', 5,    -- CH_PRIV, CH_PRIV_O, CH_PUB, CH_PRIV_Z, CH_PUB_Z
  'notification_state_deleted', 2,   -- on A4, and AX in WX
  'api_keys_deleted', 1,             -- K1
  'member_grants_deleted', 1,        -- NB2
  'invites_deleted', 2               -- I_X, I_X3
) AS counts;

CREATE TABLE probe.before_state AS SELECT probe.state() AS s;
CREATE TABLE probe.before_items AS SELECT item FROM probe.items();
CREATE TABLE probe.before_visible AS SELECT * FROM probe.visible();

SET ROLE service_role;
CREATE TABLE probe.preview AS SELECT public.account_erase_workspace_data(probe.id('X')) AS r;
RESET ROLE;

DO $$
DECLARE
  v_r jsonb := (SELECT r FROM probe.preview);
BEGIN
  ASSERT v_r = (SELECT counts FROM probe.expected) || '{"preview": true}', 'preview counts: ' || v_r::text;
  ASSERT probe.state() = (SELECT s FROM probe.before_state), 'preview changed the database';
  -- Only an explicit false deletes: NULL previews too.
  ASSERT public.account_erase_workspace_data(probe.id('X'), NULL) = v_r, 'NULL did not preview';
  ASSERT probe.state() = (SELECT s FROM probe.before_state), 'a NULL preview changed the database';
  BEGIN
    PERFORM public.account_erase_workspace_data(NULL, true);
    RAISE EXCEPTION 'FAIL: a NULL user was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%p_user is required%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS AC12: preview is the default, reports the counts and changes nothing';
END;
$$;

-- ── The erasure ──────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE service_role;
CREATE TABLE probe.applied AS SELECT public.account_erase_workspace_data(probe.id('X'), false) AS r;
CREATE TABLE probe.bypass_after AS SELECT current_setting('share.bypass', true) AS v;
COMMIT;

DO $$
BEGIN
  ASSERT (SELECT r FROM probe.applied) = (SELECT counts FROM probe.expected) || '{"preview": false}',
    'apply counts: ' || (SELECT r::text FROM probe.applied);
  ASSERT (SELECT v IS DISTINCT FROM '1' FROM probe.bypass_after), 'share.bypass left on for the caller';
END;
$$;

-- AC1: private items are gone; X's own workspace is left to the auth cascade.
DO $$
DECLARE
  v_gone text[] := ARRAY['N1', 'N1x', 'N6', 'N9'];
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.notes WHERE id IN (SELECT probe.id(n) FROM unnest(v_gone) n)), 'private notes left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.buckets WHERE id IN (probe.id('BI'), probe.id('BP'))), 'private buckets left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.tasks
    WHERE id IN (probe.id('TI2'), probe.id('TP1'), probe.id('TP3'), probe.id('TP6'))), 'private tasks left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.contacts
    WHERE id IN (probe.id('CP'), probe.id('CP2'), probe.id('CP3'))), 'private contacts left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.contact_groups WHERE id = probe.id('CG2')), 'private group left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.companies WHERE id IN (probe.id('COP'), probe.id('COX'))),
    'private companies left';
  ASSERT EXISTS (SELECT 1 FROM public.companies WHERE id = probe.id('COB') AND owner_id = probe.id('B')),
    'B company touched';
  ASSERT NOT EXISTS (SELECT 1 FROM public.calendars WHERE owner_id = probe.id('X')), 'X calendars left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.calendar_sets WHERE owner_id = probe.id('X')), 'X sets left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.calendar_accounts WHERE owner_id = probe.id('X')), 'X calendar accounts left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.calendar_events WHERE owner_id = probe.id('X')), 'X events left';
  ASSERT (SELECT array_agg(calendar_id) FROM public.calendar_set_items WHERE set_id = probe.id('BSET'))
    = ARRAY[probe.id('CALB')], 'B set should keep only B calendar';
  ASSERT NOT EXISTS (SELECT 1 FROM public.email_accounts WHERE owner_id = probe.id('X')), 'X email accounts left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.email_refs WHERE owner_id = probe.id('X')), 'X email refs left';
  ASSERT EXISTS (SELECT 1 FROM public.email_refs WHERE id = probe.id('EBR') AND account_id = probe.id('EBA')),
    'B email touched';
  ASSERT NOT EXISTS (SELECT 1 FROM public.chat_channels
    WHERE id IN (probe.id('CH_SELF'), probe.id('CH_ALONE'))), 'channels with nobody else left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id = probe.id('M_SELF')), 'self-DM message left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = probe.id('CH_DM_Z')),
    'DM with someone who left the workspace kept';
  ASSERT (SELECT array_agg(id ORDER BY id) FROM public.workspace_invites) = (SELECT array_agg(x ORDER BY x)
    FROM unnest(ARRAY[probe.id('I_XP'), probe.id('I_B'), probe.id('I_XX')]) x),
    'accepted invitations to X not deleted, or others touched';
  ASSERT (SELECT count(*) FROM public.notification_state WHERE user_id = probe.id('X')) = 0, 'X read state left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.workspace_api_keys WHERE id = probe.id('K1')), 'X API key left';
  ASSERT EXISTS (SELECT 1 FROM public.workspace_api_keys WHERE id = probe.id('K2')), 'B API key touched';
  ASSERT NOT EXISTS (SELECT 1 FROM public.contact_private_notes WHERE contact_id = probe.id('CP')),
    'notes on a deleted contact left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.contact_group_members WHERE group_id = probe.id('CG2')),
    'deleted group memberships left';
  ASSERT EXISTS (SELECT 1 FROM public.contacts WHERE id = probe.id('CB') AND owner_id = probe.id('B')),
    'B contact touched';
  -- A teammate's sub-note under a deleted note moves to the top level.
  ASSERT EXISTS (SELECT 1 FROM public.notes
    WHERE id = probe.id('N1c') AND parent_id IS NULL AND created_by = probe.id('B')), 'B sub-note not re-rooted';
  -- X's own workspace is untouched until the account goes.
  ASSERT EXISTS (SELECT 1 FROM public.notes WHERE id = probe.id('NX') AND created_by = probe.id('X')), 'WX note touched';
  ASSERT EXISTS (SELECT 1 FROM public.tasks WHERE id = probe.id('TX') AND owner_id = probe.id('X')), 'WX task touched';
  ASSERT EXISTS (SELECT 1 FROM public.workspace_api_keys WHERE id = probe.id('KX')), 'WX key touched';
  RAISE NOTICE 'PASS AC1: private items in other workspaces are deleted';
END;
$$;

-- AC2: nothing points at what went.
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.note_updates WHERE note_id = probe.id('N1')), 'note updates left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.note_shares WHERE note_id = probe.id('N1')), 'note shares left';
  ASSERT EXISTS (SELECT 1 FROM public.note_shares WHERE note_id = probe.id('N2')), 'kept note lost its shares';
  ASSERT NOT EXISTS (SELECT 1 FROM public.exposed_notes
    WHERE note_id IN (probe.id('N1')::text, probe.id('N6')::text)), 'published copy left';
  ASSERT EXISTS (SELECT 1 FROM public.exposed_notes WHERE note_id = probe.id('NB')::text), 'B published copy touched';
  ASSERT NOT EXISTS (SELECT 1 FROM public.entities
    WHERE (entity_type, entity_id) IN (('note', probe.id('N1')), ('task', probe.id('TP1')), ('bucket', probe.id('BP')),
      ('contact', probe.id('CP')), ('company', probe.id('COP')), ('event', probe.id('EV1')),
      ('email_thread', probe.id('EREF')))), 'search labels left';
  ASSERT (SELECT count(*) FROM public.entities
    WHERE (entity_type, entity_id) IN (('note', probe.id('N2')), ('note', probe.id('NB')), ('task', probe.id('TB1')))) = 3,
    'kept search labels lost';
  ASSERT (SELECT array_agg(id) FROM public.entity_links) = ARRAY[probe.id('L2')], 'links to deleted items left';
  ASSERT (SELECT array_agg(id ORDER BY id) FROM public.comments) = (SELECT array_agg(x ORDER BY x)
    FROM unnest(ARRAY[probe.id('K_N2'), probe.id('K_NB')]) x), 'comments wrong';
  ASSERT (SELECT array_agg(id) FROM public.tag_links) = ARRAY[probe.id('TL_N2')], 'tags on deleted items left';
  ASSERT (SELECT array_agg(id) FROM public.link_suggestion_declines) = ARRAY[probe.id('D_N2')], 'declines left';
  ASSERT (SELECT array_agg(id ORDER BY id) FROM public.module_activity) = (SELECT array_agg(x ORDER BY x)
    FROM unnest(ARRAY[probe.id('A2'), probe.id('A4'), probe.id('A8'), probe.id('A12'), probe.id('AX')]) x),
    'activity wrong: ' || (SELECT string_agg(id::text, ', ') FROM public.module_activity);
  ASSERT (SELECT array_agg(activity_id) FROM public.notification_state WHERE workspace_id = probe.id('W'))
    = ARRAY[probe.id('A2')], 'read state on deleted activity left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_relations WHERE probe.id('TP1') IN (blocker_task_id, blocked_task_id)),
    'task relation left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.resource_grants
    WHERE resource_id IN (SELECT probe.id(n) FROM unnest(ARRAY['N1', 'N6', 'BP', 'TP1', 'CP', 'CG2', 'CAL1', 'CAL2']) n)),
    'grants on deleted items left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.resource_grants WHERE subject_type = 'member' AND subject_id = probe.id('X')),
    'grants to X left';
  ASSERT (SELECT contact_id IS NULL AND calendar_event_id IS NULL FROM public.slot_bookings WHERE id = probe.id('SB1')),
    'booking still points at deleted contact or event';
  ASSERT (SELECT contact_id = probe.id('CB') AND calendar_event_id = probe.id('EVB') FROM public.slot_bookings
    WHERE id = probe.id('SB2')), 'B booking touched';
  ASSERT (SELECT blocks FROM public.task_time_blocks WHERE workspace_id = probe.id('W'))
    = jsonb_build_object('mon-10', probe.id('BB'), 'wed-09', NULL), 'time blocks: '
      || (SELECT blocks::text FROM public.task_time_blocks WHERE workspace_id = probe.id('W'));
  RAISE NOTICE 'PASS AC2: no link, comment, tag, activity, grant, label or booking points at a deleted item';
END;
$$;

-- AC3: shared items stay with the right owner.
DO $$
BEGIN
  ASSERT (SELECT created_by FROM public.notes WHERE id = probe.id('N2')) = probe.id('O'), 'workspace-shared note -> owner';
  ASSERT (SELECT created_by FROM public.notes WHERE id = probe.id('N3')) = probe.id('C'), 'most access wins (C edit > B view)';
  ASSERT (SELECT created_by FROM public.notes WHERE id = probe.id('N4')) = probe.id('C'), 'earlier grant beats earlier join';
  ASSERT (SELECT created_by FROM public.notes WHERE id = probe.id('N5')) = probe.id('B'), 'earlier join wins';
  ASSERT (SELECT created_by FROM public.notes WHERE id = probe.id('N7')) = probe.id('V'), 'the only viewer takes it';
  ASSERT (SELECT created_by FROM public.notes WHERE id = probe.id('N8')) = probe.id('O'), 'inherited sharing counts';
  ASSERT (SELECT owner_id FROM public.buckets WHERE id = probe.id('BS')) = probe.id('O'), 'shared bucket -> owner';
  ASSERT (SELECT owner_id FROM public.contacts WHERE id = probe.id('CS')) = probe.id('O'), 'shared contact -> owner';
  ASSERT (SELECT owner_id FROM public.companies WHERE id = probe.id('COS')) = probe.id('O'), 'company of a kept contact';
  ASSERT (SELECT owner_id FROM public.contact_groups WHERE id = probe.id('CG')) = probe.id('B'), 'group shared with B';
  ASSERT (SELECT owner_id FROM public.contacts WHERE id = probe.id('CGc')) = probe.id('B'), 'contact seen through a group';
  ASSERT NOT EXISTS (SELECT 1 FROM public.notes WHERE title LIKE 'From %'), 'nothing is archived to anyone';
  -- Grants to others on kept items stay.
  ASSERT (SELECT count(*) FROM public.resource_grants WHERE resource_id = probe.id('N3')) = 2, 'N3 grants lost';
  RAISE NOTICE 'PASS AC3: shared items stay, owner by the rule';
END;
$$;

-- AC3: nobody sees anything new, and nobody loses a kept item.
DO $$
DECLARE
  v_new text;
  v_lost text;
BEGIN
  SELECT string_agg(a.user_id || ' ' || a.item, '; ') INTO v_new
  FROM probe.visible() a
  WHERE a.item IN (SELECT item FROM probe.before_items)
    AND NOT EXISTS (SELECT 1 FROM probe.before_visible b WHERE b.user_id = a.user_id AND b.item = a.item);
  ASSERT v_new IS NULL, 'new access: ' || v_new;
  SELECT string_agg(b.user_id || ' ' || b.item, '; ') INTO v_lost
  FROM probe.before_visible b
  WHERE b.item IN (SELECT item FROM probe.items())
    AND NOT EXISTS (SELECT 1 FROM probe.visible() a WHERE a.user_id = b.user_id AND a.item = b.item);
  ASSERT v_lost IS NULL, 'lost access: ' || v_lost;
  RAISE NOTICE 'PASS AC3: no member can see anything they couldn''t before, nor lost a kept item';
END;
$$;

-- AC4: shared tasks move to their new owner's Inbox; X's assignments go.
DO $$
DECLARE
  v_b_inbox uuid;
BEGIN
  ASSERT (SELECT count(*) FROM public.buckets
    WHERE workspace_id = probe.id('W') AND owner_id = probe.id('B') AND is_system) = 1, 'B should have exactly one Inbox';
  SELECT id INTO v_b_inbox FROM public.buckets
  WHERE workspace_id = probe.id('W') AND owner_id = probe.id('B') AND is_system;
  ASSERT (SELECT name FROM public.buckets WHERE id = v_b_inbox) = 'Inbox', 'created Inbox name';
  ASSERT NOT EXISTS (SELECT 1 FROM public.resource_grants WHERE resource_id = v_b_inbox), 'created Inbox is shared';
  ASSERT (SELECT bucket_id FROM public.tasks WHERE id = probe.id('TI1')) = v_b_inbox, 'TI1 -> B Inbox (created)';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = probe.id('TI1')) = probe.id('B'), 'TI1 stays assigned to B';
  ASSERT (SELECT bucket_id FROM public.tasks WHERE id = probe.id('TP5')) = v_b_inbox, 'TP5 -> B Inbox (reused)';
  ASSERT (SELECT bucket_id = v_b_inbox AND owner_id = probe.id('B') FROM public.tasks WHERE id = probe.id('TI4')),
    'TI4 -> its assignee''s Inbox, even though the owner can see it';
  ASSERT (SELECT b.owner_id = probe.id('O') AND b.is_system FROM public.tasks t JOIN public.buckets b ON b.id = t.bucket_id
    WHERE t.id = probe.id('TP7')), 'TP7 (shared with all, unassigned) -> owner Inbox';
  ASSERT (SELECT bucket_id FROM public.tasks WHERE id = probe.id('TI3')) = probe.id('BIC'), 'TI3 -> C Inbox';
  ASSERT (SELECT bucket_id FROM public.tasks WHERE id = probe.id('TP2')) = probe.id('BIC'), 'TP2 -> C Inbox';
  ASSERT (SELECT bucket_id = probe.id('BIC') AND parent_id IS NULL FROM public.tasks WHERE id = probe.id('TP4')),
    'TP4 -> C Inbox, top level';
  ASSERT (SELECT bucket_id = probe.id('BS') AND owner_id IS NULL FROM public.tasks WHERE id = probe.id('TS1')),
    'TS1 unassigned in the kept bucket';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = probe.id('TS2')) = probe.id('B'), 'TS2 keeps B';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = probe.id('TB1')) IS NULL, 'TB1 unassigned';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = probe.id('TB2')) = probe.id('B'), 'TB2 keeps B';
  ASSERT NOT EXISTS (SELECT 1 FROM public.tasks
    WHERE owner_id = probe.id('X') AND workspace_id <> probe.id('WX')), 'tasks still assigned to X';
  RAISE NOTICE 'PASS AC4: shared tasks move to their assignee''s or new owner''s Inbox, X''s tasks are unassigned';
END;
$$;

-- AC5: channels X managed alone get a manager; nobody keeps X.
DO $$
BEGIN
  ASSERT (SELECT array_agg(user_id) FROM public.chat_channel_managers WHERE channel_id = probe.id('CH_PUB'))
    = ARRAY[probe.id('O')], 'public channel -> owner';
  ASSERT (SELECT array_agg(user_id) FROM public.chat_channel_managers WHERE channel_id = probe.id('CH_PRIV'))
    = ARRAY[probe.id('C')], 'private channel without the owner -> earliest member (C)';
  ASSERT (SELECT array_agg(user_id) FROM public.chat_channel_managers WHERE channel_id = probe.id('CH_PRIV_O'))
    = ARRAY[probe.id('O')], 'private channel with the owner -> owner';
  ASSERT (SELECT array_agg(user_id) FROM public.chat_channel_managers WHERE channel_id = probe.id('CH_PUB2'))
    = ARRAY[probe.id('B')], 'co-managed channel keeps B only';
  ASSERT (SELECT array_agg(user_id) FROM public.chat_channel_managers WHERE channel_id = probe.id('CH_PRIV_Z'))
    = ARRAY[probe.id('C')], 'someone who left can''t take over a channel';
  ASSERT EXISTS (SELECT 1 FROM public.chat_channel_managers
    WHERE channel_id = probe.id('CH_PUB_Z') AND user_id = probe.id('O')),
    'a co-manager who left doesn''t count: the channel needs a new manager';
  ASSERT NOT EXISTS (SELECT 1 FROM public.chat_channel_managers WHERE user_id = probe.id('X')), 'X still manages';
  RAISE NOTICE 'PASS AC5: channels X managed alone have a new manager';
END;
$$;

-- AC6 (database side): X's messages, comments and activity elsewhere stay,
-- without the copied name.
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.chat_messages
    WHERE id IN (probe.id('M_DM_X'), probe.id('M_DM_B'), probe.id('M_PUB_X'))) = 3, 'messages lost';
  ASSERT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = probe.id('CH_DM')), 'DM with a teammate lost';
  ASSERT (SELECT count(*) FROM public.comments WHERE created_by = probe.id('X')) = 2, 'comments lost';
  ASSERT (SELECT count(*) FROM public.module_activity
    WHERE id IN (probe.id('A2'), probe.id('A8'), probe.id('A12')) AND actor_id = probe.id('X') AND actor_label IS NULL) = 3,
    'X activity lost or still named';
  ASSERT (SELECT actor_label FROM public.module_activity WHERE id = probe.id('A4')) = 'Bea', 'B activity touched';
  ASSERT (SELECT actor_label FROM public.module_activity WHERE id = probe.id('AX')) = 'Xavier', 'WX activity touched';
  RAISE NOTICE 'PASS AC6: messages, comments and activity stay, the copied name is cleared';
END;
$$;

-- A retry finds nothing left to do.
SET ROLE service_role;
CREATE TABLE probe.rerun AS SELECT public.account_erase_workspace_data(probe.id('X'), false) AS r;
RESET ROLE;
DO $$
DECLARE
  v_r jsonb := (SELECT r FROM probe.rerun);
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_each(v_r) e WHERE e.key <> 'preview' AND e.value <> '0'), 'rerun: ' || v_r::text;
  RAISE NOTICE 'PASS: a retry is a no-op';
END;
$$;

-- The ownership guard still stops a teammate outside the hand-over.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', probe.id('B'))::text, true);
  BEGIN
    UPDATE public.notes SET created_by = probe.id('B') WHERE id = probe.id('N2');
    RAISE EXCEPTION 'FAIL: a teammate took over someone else''s note';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'only the note owner%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: notes_share_fields_owner_only still refuses a teammate';
END;
$$;

-- ── AC9: removing a member, and a deletion from the dashboard ────────────────

INSERT INTO public.notes (id, workspace_id, created_by, title, share_mode) VALUES
  (probe.id('ND'), probe.id('W3'), probe.id('D'), 'D private', 'custom'),
  (probe.id('NDS'), probe.id('W3'), probe.id('D'), 'D shared', 'custom'),
  (probe.id('NE'), probe.id('W4'), probe.id('E'), 'E private', 'custom');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, level) VALUES
  (probe.id('W3'), 'note', probe.id('NDS'), 'workspace', 'edit');
INSERT INTO public.buckets (id, workspace_id, owner_id, name) VALUES
  (probe.id('BD'), probe.id('W3'), probe.id('D'), 'D private bucket'),
  (probe.id('BO3'), probe.id('W3'), probe.id('O'), 'O bucket'),
  (probe.id('BE'), probe.id('W4'), probe.id('E'), 'E private bucket');
DELETE FROM public.resource_grants WHERE resource_id IN (probe.id('BD'), probe.id('BE'));
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title) VALUES
  (probe.id('TD'), probe.id('W3'), probe.id('BO3'), probe.id('D'), 'O bucket, assigned to D'),
  (probe.id('TDB'), probe.id('W3'), probe.id('BD'), probe.id('D'), 'D bucket, assigned to D'),
  (probe.id('TE'), probe.id('W4'), probe.id('BE'), probe.id('E'), 'E bucket, assigned to E');
DELETE FROM public.module_activity WHERE actor_id IS NULL;

-- The owner removes D, as workspace_op_remove_member does (signed in as O).
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', probe.id('O'))::text, true);
  DELETE FROM public.workspace_members WHERE workspace_id = probe.id('W3') AND user_id = probe.id('D');
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = probe.id('TD')) IS NULL, 'TD still assigned to D';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = probe.id('TDB')) IS NULL, 'TDB still assigned to D';
  ASSERT (SELECT created_by = probe.id('O') AND title = 'From Dee (archived) D private'
    FROM public.notes WHERE id = probe.id('ND')), 'removal hand-over of the private note changed';
  ASSERT (SELECT created_by FROM public.notes WHERE id = probe.id('NDS')) = probe.id('D'), 'shared note moved';
  ASSERT (SELECT owner_id = probe.id('O') AND name = 'From Dee (archived) D private bucket'
    FROM public.buckets WHERE id = probe.id('BD')), 'removal hand-over of the private bucket changed';
  RAISE NOTICE 'PASS AC9: an owner can remove a member with private notes; their tasks are unassigned';
END;
$$;

-- E is deleted straight from auth (the dashboard path): nothing reaches O.
DELETE FROM auth.users WHERE id = probe.id('E');
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.notes WHERE workspace_id = probe.id('W4') AND title LIKE 'From %'),
    'a deleted account''s note was archived to the owner';
  ASSERT NOT EXISTS (SELECT 1 FROM public.buckets WHERE workspace_id = probe.id('W4') AND name LIKE 'From %'),
    'a deleted account''s bucket was archived to the owner';
  ASSERT NOT public.can_access('note', probe.id('NE'), 'view', probe.id('O')), 'O can see E''s private note';
  ASSERT NOT public.can_access('bucket', probe.id('BE'), 'view', probe.id('O')), 'O can see E''s private bucket';
  ASSERT (SELECT owner_id FROM public.tasks WHERE id = probe.id('TE')) IS NULL, 'TE still assigned to E';
  RAISE NOTICE 'PASS AC9: a dashboard deletion never hands private items to the owner';
END;
$$;

-- ── Then the account goes (auth cascade, as delete-account does last) ────────

DELETE FROM auth.users WHERE id = probe.id('X');
DO $$
DECLARE
  v_new text;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = probe.id('WX')), 'X workspace left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.notes WHERE id = probe.id('NX')), 'X workspace note left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.workspace_api_keys WHERE id = probe.id('KX')), 'X workspace key left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = probe.id('X')), 'memberships left';
  ASSERT NOT EXISTS (SELECT 1 FROM public.notes WHERE title LIKE 'From %' AND workspace_id = probe.id('W')),
    'something was archived to the owner';
  ASSERT (SELECT author_id IS NULL FROM public.chat_messages WHERE id = probe.id('M_DM_X')), 'message author kept';
  ASSERT (SELECT count(*) FROM public.chat_messages WHERE id IN (probe.id('M_DM_X'), probe.id('M_PUB_X'))) = 2,
    'messages lost with the account';
  ASSERT (SELECT count(*) FROM public.comments WHERE id IN (probe.id('K_N2'), probe.id('K_NB'))) = 2,
    'comments lost with the account';
  ASSERT NOT EXISTS (SELECT 1 FROM public.module_activity WHERE actor_id = probe.id('X') AND actor_label IS NOT NULL),
    'a name is left on activity';
  SELECT string_agg(a.user_id || ' ' || a.item, '; ') INTO v_new
  FROM probe.visible() a
  WHERE a.item IN (SELECT item FROM probe.before_items)
    AND NOT EXISTS (SELECT 1 FROM probe.before_visible b WHERE b.user_id = a.user_id AND b.item = a.item);
  ASSERT v_new IS NULL, 'new access after the account went: ' || v_new;
  RAISE NOTICE 'PASS: the account cascade finishes the job and hands nothing over';
END;
$$;

DO $$ BEGIN RAISE NOTICE 'PASS: all'; END $$;
