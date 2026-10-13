DO $r$ BEGIN CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
CREATE TABLE public.workspace_members (workspace_id uuid REFERENCES public.workspaces(id), user_id uuid);
CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  created_by uuid, parent_id uuid REFERENCES public.notes(id), title text DEFAULT '', icon text, kind text,
  position text DEFAULT '', is_pinned boolean DEFAULT false, is_archived boolean DEFAULT false,
  doc_state text, doc_version int DEFAULT 0, body_text text DEFAULT '', body_md text DEFAULT '',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz);
CREATE TABLE public.note_updates (id bigserial, workspace_id uuid, note_id uuid, client_id text, client_seq int, update_b64 text);
CREATE TABLE public.activity (ws uuid, entity uuid, action text, payload jsonb);
CREATE TABLE public.stub_denied (note_id uuid, user_id uuid);
CREATE FUNCTION public.perm_actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
CREATE FUNCTION public.notes_module_permission(p uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.perm', true), ''), 'edit') $$;
CREATE FUNCTION public.can_access(p_type text, p_id uuid, p_min text, p_user uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(p_user, public.perm_actor_id()) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.stub_denied d WHERE d.note_id = p_id AND d.user_id = coalesce(p_user, public.perm_actor_id())) $$;
GRANT EXECUTE ON FUNCTION public.can_access(text, uuid, text, uuid) TO authenticated;
CREATE FUNCTION public.module_activity_log(ws uuid, m text, t text, e uuid, a text, p jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.activity VALUES (ws, e, a, p) $$;
CREATE FUNCTION public.entities_op_upsert(ws uuid, t text, e uuid, l text, m text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.notes_op__guard(p_workspace_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF public.notes_module_permission(p_workspace_id) NOT IN ('edit','admin') THEN RAISE EXCEPTION 'You do not have edit access to notes in this workspace.'; END IF; END $$;
CREATE FUNCTION public.notes_op__guard_note(p_workspace_id uuid, p_note_id uuid, p_include_trashed boolean DEFAULT false) RETURNS public.notes
LANGUAGE plpgsql AS $$ DECLARE n public.notes; BEGIN PERFORM public.notes_op__guard(p_workspace_id);
  SELECT * INTO n FROM public.notes WHERE id = p_note_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note not found in this workspace.'; END IF; RETURN n; END $$;
CREATE FUNCTION public.notes_op_import(p_workspace_id uuid, p_rows jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('x', public.perm_actor_id()) $$;
-- the classic create op (inserts without in_inbox)
CREATE FUNCTION public.notes_op_create(p_workspace_id uuid, p_id uuid, p_parent_id uuid) RETURNS public.notes LANGUAGE sql AS $$
  INSERT INTO public.notes (id, workspace_id, parent_id) VALUES (p_id, p_workspace_id, p_parent_id) RETURNING * $$;
CREATE FUNCTION public.notes_op_move(p_workspace_id uuid, p_note_id uuid, p_parent_id uuid) RETURNS public.notes LANGUAGE sql AS $$
  UPDATE public.notes SET parent_id = p_parent_id WHERE id = p_note_id RETURNING * $$;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
-- fixture: ws1, users A B; notes: loose root, parent root w/ child, archived root, trashed-child root, pinned page
INSERT INTO public.workspaces VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO auth.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO public.workspace_members VALUES ('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO public.notes (id, workspace_id, parent_id, is_archived, deleted_at, is_pinned, updated_at) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1',NULL,false,NULL,false,'2026-01-01'),  -- loose
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1',NULL,false,NULL,true,'2026-01-01'),   -- parent (pinned)
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000002',false,NULL,false,'2026-01-01'), -- child
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a1',NULL,true,NULL,false,'2026-01-01'),   -- archived root
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a1',NULL,false,NULL,false,'2026-01-01'),  -- root whose only child is trashed
 ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000005',false,now(),false,'2026-01-01');
-- B cannot open the pinned parent
INSERT INTO public.stub_denied VALUES ('10000000-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002');
