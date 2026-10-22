-- MCPO-1 (specs/mcp-oauth.md): passwords can't be set or changed through
-- Supabase Auth.
--
-- An app's OAuth token is a full user token, and Auth's own PUT /auth/v1/user
-- accepts it: the app could set the person's password, sign in with it and get
-- an ordinary session that reaches everything 20261022230000_app_token_lockout
-- refuses to app tokens. Auth has no setting that keeps OAuth tokens off /user,
-- and it doesn't check `aud` there, so the database refuses the write instead.
--
-- Moduo has no password sign-in (people type an emailed code), new accounts
-- never keep a password (20261010155652_tx4_invite_only_gate.sql), and Settings
-- no longer offers to change one. So every password write that comes through
-- Auth (supabase_auth_admin) is refused: /user, recovery, and the admin API.
-- Existing passwords keep working until they're cleared; SQL run by an
-- operator (seed.sql, a migration) is not Auth and still can set one.

CREATE OR REPLACE FUNCTION public.auth_users__no_password_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user = 'supabase_auth_admin'
     AND NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
     AND coalesce(NEW.encrypted_password, '') <> '' THEN
    RAISE EXCEPTION 'Moduo has no passwords: sign in with the code we email you.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auth_users__no_password_change() IS
  'Refuses setting or changing a password through Supabase Auth, so an app''s OAuth token can''t turn into a full session (MCPO-1).';

REVOKE ALL ON FUNCTION public.auth_users__no_password_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS auth_users_no_password_change ON auth.users;
CREATE TRIGGER auth_users_no_password_change
  BEFORE UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auth_users__no_password_change();
