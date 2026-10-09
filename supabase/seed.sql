-- Local-only seed (scripts/local/stack.sh runs it after the schema snapshot).
-- Never runs against prod. Test login: dev@moduo.local / localdev
-- Profile/workspace rows are created by the app's own signup triggers.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 4194304, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('attachments', 'attachments', false, 52428800, null)
on conflict (id) do nothing;

do $$
declare uid uuid := '00000000-0000-4000-8000-000000000001';
begin
  if not exists (select 1 from auth.users where id = uid) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'dev@moduo.local', extensions.crypt('localdev', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{"full_name":"Local Dev"}', now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', 'dev@moduo.local', 'email_verified', true),
      'email', now(), now(), now());
  end if;
end $$;
