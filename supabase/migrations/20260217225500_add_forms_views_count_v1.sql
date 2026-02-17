begin;

alter table public.forms
  add column if not exists views_count bigint not null default 0;

create or replace function public.forms_public_get_by_slug(
  p_slug text,
  p_access_code text default null
)
returns table (
  form_id uuid,
  form_name text,
  form_description text,
  form_schema jsonb,
  is_locked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form_id uuid;
  v_form_name text;
  v_form_description text;
  v_form_schema jsonb;
  v_access_code_hash text;
  v_require_access_code boolean;
  v_locked boolean;
begin
  select
    f.id,
    f.name,
    f.description,
    f.schema,
    l.access_code_hash,
    l.require_access_code
  into
    v_form_id,
    v_form_name,
    v_form_description,
    v_form_schema,
    v_access_code_hash,
    v_require_access_code
  from public.form_share_links l
  join public.forms f on f.id = l.form_id
  where l.slug = p_slug
    and l.is_active = true
    and (l.expires_at is null or l.expires_at > now())
    and f.deleted_at is null
    and f.status = 'published'
  limit 1;

  if v_form_id is null then
    return;
  end if;

  v_locked := v_require_access_code and (
    v_access_code_hash is null
    or coalesce(p_access_code, '') = ''
    or extensions.crypt(p_access_code, v_access_code_hash) <> v_access_code_hash
  );

  update public.forms
  set views_count = views_count + 1,
      updated_at = now()
  where id = v_form_id;

  return query
  select
    v_form_id,
    v_form_name,
    v_form_description,
    case when v_locked then null else v_form_schema end,
    v_locked;
end;
$$;

revoke all on function public.forms_public_get_by_slug(text, text) from public;
grant execute on function public.forms_public_get_by_slug(text, text) to anon, authenticated;

commit;
