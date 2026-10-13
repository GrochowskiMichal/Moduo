\pset format unaligned
\echo == backfill (expect loose=t, parent=f, child=f, archived=f, root-with-trashed-child=t; updated_at untouched)
SELECT right(id::text,1) id, in_inbox, updated_at::date FROM public.notes ORDER BY id;
\echo == pins -> favorites (expect A on note 2 only; B denied)
SELECT right(user_id::text,1) u, right(note_id::text,1) n FROM public.note_favorites;
SELECT set_config('test.actor','aaaaaaaa-0000-0000-0000-000000000001', false);
\echo == classic create: root -> inbox t, child -> f
SELECT in_inbox FROM public.notes_op_create('00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-000000000001',NULL);
SELECT in_inbox FROM public.notes_op_create('00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
\echo == parent stays in inbox when it gains a child (expect t)
SELECT in_inbox FROM public.notes WHERE id='20000000-0000-0000-0000-000000000001';
\echo == move inbox root under a page clears it (expect f)
SELECT in_inbox FROM public.notes_op_move('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
\echo == move back to root keeps it out of inbox (expect f)
SELECT in_inbox FROM public.notes_op_move('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001',NULL);
\echo == file nested child into inbox re-roots it (expect parent null, t)
SELECT parent_id IS NULL, in_inbox FROM public.notes_op_file('00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-000000000002', true);
\echo == file to pages (expect f) + activity rows
SELECT in_inbox FROM public.notes_op_file('00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-000000000002', false, 'zz');
SELECT action, payload->>'to' FROM public.activity ORDER BY action;
\echo == no-op file writes no activity (expect count unchanged = 2)
SELECT in_inbox FROM public.notes_op_file('00000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-000000000002', false);
SELECT count(*) FROM public.activity WHERE action='notes.file';
\echo == CHECK rejects an inbox child
DO $$ BEGIN UPDATE public.notes SET in_inbox = true WHERE id='10000000-0000-0000-0000-000000000003'; RAISE NOTICE 'NOT REJECTED'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'rejected ok'; END $$;
\echo == import: absent inInbox root -> t, false -> f, child -> f
SELECT public.notes_op_import('00000000-0000-0000-0000-0000000000a1', '[{"id":"30000000-0000-0000-0000-000000000001","title":"mcp"},{"id":"30000000-0000-0000-0000-000000000002","title":"wiz","inInbox":false},{"id":"30000000-0000-0000-0000-000000000003","parentId":"30000000-0000-0000-0000-000000000002","inInbox":true}]');
SELECT right(id::text,1), in_inbox FROM public.notes WHERE id::text LIKE '30000000%' ORDER BY id;
\echo == duplicate keeps section (pages root -> f) and actor
SELECT in_inbox, created_by = 'aaaaaaaa-0000-0000-0000-000000000001' FROM public.notes_op_duplicate('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000002');
\echo == full width via set_meta
SELECT full_width FROM public.notes_op_set_meta('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000002','{"fullWidth":true}');
\echo == favorites: A adds two (append), reorder one, remove
SELECT public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001', true);
SELECT public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000002', true);
SELECT right(note_id::text,1), position FROM public.note_favorites WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' ORDER BY position;
SELECT public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000002', true, '0');
SELECT public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001', true);
SELECT right(note_id::text,1), position FROM public.note_favorites WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001' ORDER BY position;
SELECT public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001', false);
SELECT count(*) FROM public.note_favorites WHERE user_id='aaaaaaaa-0000-0000-0000-000000000001';
\echo == viewer (perm=view) can favorite; none cannot
SELECT set_config('test.perm','view', false);
SELECT public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001', true);
SELECT set_config('test.perm','none', false);
DO $$ BEGIN PERFORM public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000001', true); RAISE NOTICE 'NOT REJECTED'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rejected: %', SQLERRM; END $$;
SELECT set_config('test.perm','edit', false);
\echo == B cannot favorite a note it cannot open
SELECT set_config('test.actor','bbbbbbbb-0000-0000-0000-000000000002', false);
DO $$ BEGIN PERFORM public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000002', true); RAISE NOTICE 'NOT REJECTED'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rejected: %', SQLERRM; END $$;
SELECT public.notes_op_set_favorite('00000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-000000000002', true);
\echo == RLS: as authenticated, A sees only own rows; B sees only own
SET ROLE authenticated;
SELECT set_config('test.actor','aaaaaaaa-0000-0000-0000-000000000001', false);
SELECT right(user_id::text,1) u, count(*) FROM public.note_favorites GROUP BY 1;
SELECT set_config('test.actor','bbbbbbbb-0000-0000-0000-000000000002', false);
SELECT right(user_id::text,1) u, count(*) FROM public.note_favorites GROUP BY 1;
\echo == RLS: direct write refused
DO $$ BEGIN INSERT INTO public.note_favorites (workspace_id,user_id,note_id) VALUES ('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001'); RAISE NOTICE 'NOT REJECTED'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'rejected: %', SQLERRM; END $$;
RESET ROLE;
\echo == grants
SELECT has_function_privilege('anon','public.notes_op_file(uuid,uuid,boolean,text)','EXECUTE') anon_file,
       has_function_privilege('anon','public.notes_op_set_favorite(uuid,uuid,boolean,text)','EXECUTE') anon_fav,
       has_function_privilege('authenticated','public.notes_op_file(uuid,uuid,boolean,text)','EXECUTE') auth_file,
       has_function_privilege('authenticated','public.notes_in_inbox_default()','EXECUTE') auth_trig,
       has_table_privilege('anon','public.note_favorites','SELECT') anon_sel,
       has_table_privilege('anon','public.note_favorites','TRUNCATE') anon_trunc,
       has_table_privilege('authenticated','public.note_favorites','INSERT') auth_ins;
\echo == cascade: deleting user B removes B favorites
DELETE FROM auth.users WHERE id='bbbbbbbb-0000-0000-0000-000000000002';
SELECT count(*) FROM public.note_favorites WHERE user_id='bbbbbbbb-0000-0000-0000-000000000002';
