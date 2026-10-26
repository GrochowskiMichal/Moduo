-- A new link needs Edit on at least one of its two items (MOD-593,
-- supabase/migrations/20261026210000_links_need_edit_exposed_notes_closed.sql).
-- The RLS matrix's world (rls_matrix.md): owner's task T, note N and contact C,
-- with editor at Edit, viewer at View and member at nothing.

\ir _rls_matrix.sql

CREATE FUNCTION test.link(p_who text, p_st text, p_s uuid, p_tt text, p_t uuid) RETURNS text LANGUAGE sql AS $$
  SELECT test.mx(p_who, format($q$SELECT public.links_op_create(%L, %L, %L, %L, %L)$q$,
    test.id('W'), p_st, p_s, p_tt, p_t))
$$;

DO $$
DECLARE
  r text;
  v_ghost text;
BEGIN
  r := test.link('member', 'task', test.id('T'), 'note', test.id('N'));
  PERFORM test.ok(r = '42501 You can''t link these.', 'member can''t link two items they can''t open', r);
  v_ghost := test.link('member', 'task', gen_random_uuid(), 'note', gen_random_uuid());
  PERFORM test.ok(v_ghost = r, 'and ids that don''t exist get the same answer', v_ghost);

  r := test.link('viewer', 'task', test.id('T'), 'note', test.id('N'));
  PERFORM test.ok(r = '42501 You can''t link these.', 'View on both items isn''t enough', r);
  r := test.link('editor', 'task', test.id('T'), 'note', test.id('N'));
  PERFORM test.ok(r = 'ok 1', 'Edit on them is', r);
  r := test.link('editor', 'note', test.id('N'), 'task', test.id('T-other'));
  PERFORM test.ok(r = 'ok 1', 'Edit on one end is enough (the other may be out of sight)', r);

  r := test.mx('member', format($q$SELECT public.contacts_op_link(%L, 'contact', %L, 'task', %L)$q$,
    test.id('W'), test.id('C'), test.id('T')));
  PERFORM test.ok(r = '42501 You can''t link these.', 'contacts_op_link asks the same', r);
  r := test.mx('editor', format($q$SELECT public.contacts_op_link(%L, 'contact', %L, 'task', %L)$q$,
    test.id('W'), test.id('C'), test.id('T')));
  PERFORM test.ok(r = 'ok 1', 'and lets an editor of the contact through', r);

  -- A conversation counts once you can read it.
  r := test.link('member', 'chat_channel', test.id('CH'), 'task', test.id('T'));
  PERFORM test.ok(r LIKE '42501 %', 'member can''t link a private channel they''re not in', r);
  r := test.link('viewer', 'chat_channel', test.id('CH'), 'task', test.id('T'));
  PERFORM test.ok(r = 'ok 1', 'viewer, in it, links it to a task they can see', r);
END;
$$;
