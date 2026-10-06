-- Defence in depth: a founder's plan can't be lowered by any write path (stale function, manual SQL, bad sync).
create or replace function public.protect_founder_profile() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if exists (select 1 from auth.users u join public.founder_emails f on f.email = lower(u.email) where u.id = new.id) then
    new.plan_tier := 'founder';
    new.subscription_status := 'active';
    new.current_period_end := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.protect_founder_profile() from public, anon, authenticated;
drop trigger if exists protect_founder_profile on public.profiles;
create trigger protect_founder_profile
  before insert or update on public.profiles
  for each row execute function public.protect_founder_profile();
