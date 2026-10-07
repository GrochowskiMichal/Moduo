-- Entitlements are now derived from the Stripe Sync Engine mirror (stripe.subscriptions)
-- and the founder_emails list. Clients can no longer write billing columns on profiles.
-- Requires 20261006115900_plan_tier_add_duo (enum value must be committed first).

-- 1. Billing columns are server-owned. Before this, any signed-in user could
--    `update profiles set plan_tier='founder', subscription_status='active'` from the browser.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, display_name, avatar_url, local_user_id, recovery_seed_hash, cloud_linked)
  on public.profiles to authenticated;
grant update (display_name, avatar_url, local_user_id, recovery_seed_hash, cloud_linked, updated_at)
  on public.profiles to authenticated;

-- 2. Founder allowlist: these emails always resolve to plan_tier='founder' (no payment, never gated).
create table if not exists public.founder_emails (
  email text primary key check (email = lower(email)),
  note text,
  created_at timestamptz not null default now()
);
alter table public.founder_emails enable row level security;
revoke all on public.founder_emails from anon, authenticated;
insert into public.founder_emails (email, note) values
  ('mike@moduo.app', 'founder'),
  ('maciej@moduo.app', 'founder')
on conflict (email) do nothing;

-- 3. Tier ordering (founder > team > duo > pro > free).
create or replace function public.plan_tier_rank(t text) returns int
language sql immutable as $$
  select case t when 'founder' then 4 when 'team' then 3 when 'duo' then 2 when 'pro' then 1 else 0 end
$$;

-- 4. The single place that decides a user's plan. Idempotent; writes only on change.
create or replace function public.recompute_entitlement(p_user uuid) returns void
language plpgsql security definer set search_path = public, stripe, auth as $$
declare
  v_email text;
  v_tier text := 'free';
  v_status text := 'inactive';
  v_sub_id text;
  v_cust text;
  v_end timestamptz;
  r record;
begin
  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is null then return; end if;

  if exists (select 1 from public.founder_emails where email = v_email) then
    v_tier := 'founder'; v_status := 'active';
  else
    -- Best live subscription for this user, matched by metadata, profile customer, or customer metadata.
    select s.id, s.customer, s.status,
           coalesce(pr.metadata->>'plan_tier', 'free') as tier,
           to_timestamp(case when s.status = 'trialing' then s.trial_end
                             else coalesce(s.current_period_end,
                                           (s.items->'data'->0->>'current_period_end')::bigint) end) as period_end
      into r
      from stripe.subscriptions s
      left join stripe.prices pr on pr.id = coalesce(s.items->'data'->0->'price'->>'id', s.items->'data'->0->'plan'->>'id')
     where s.status in ('active', 'trialing', 'past_due')
       and coalesce(pr.metadata->>'plan_tier', 'free') in ('pro', 'duo', 'team')
       and (   s.metadata->>'supabase_user_id' = p_user::text
            or s.customer in (select stripe_customer_id from public.profiles where id = p_user)
            or s.customer in (select c.id from stripe.customers c where c.metadata->>'supabase_user_id' = p_user::text))
     order by public.plan_tier_rank(coalesce(pr.metadata->>'plan_tier', 'free')) desc, s.created desc
     limit 1;

    if found then
      v_tier := r.tier; v_status := r.status; v_sub_id := r.id; v_cust := r.customer; v_end := r.period_end;
    elsif exists (
      select 1 from stripe.subscriptions s
       where s.metadata->>'supabase_user_id' = p_user::text
          or s.customer in (select stripe_customer_id from public.profiles where id = p_user)
    ) then
      v_status := 'canceled';
    end if;
  end if;

  update public.profiles
     set plan_tier = v_tier::plan_tier,
         subscription_status = v_status,
         stripe_subscription_id = v_sub_id,
         stripe_customer_id = coalesce(stripe_customer_id, v_cust),
         current_period_end = v_end,
         plan_updated_at = now(),
         updated_at = now()
   where id = p_user
     and (plan_tier::text, subscription_status, stripe_subscription_id, current_period_end)
         is distinct from (v_tier, v_status, v_sub_id, v_end);
end;
$$;
revoke execute on function public.recompute_entitlement(uuid) from public, anon, authenticated;

-- 5. Stripe Sync Engine writes stripe.subscriptions → recompute the affected user.
--    Never raises: a failure here must not break the sync engine's own write.
create or replace function public.sync_entitlement_from_subscription() returns trigger
language plpgsql security definer set search_path = public, stripe as $$
declare
  v_cust text := coalesce(new.customer, old.customer);
  v_meta text := coalesce(new.metadata->>'supabase_user_id', old.metadata->>'supabase_user_id');
  v_uid uuid;
begin
  for v_uid in
    select p.id from public.profiles p
     where p.stripe_customer_id = v_cust
        or (v_meta ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p.id = v_meta::uuid)
  loop
    perform public.recompute_entitlement(v_uid);
  end loop;
  return null;
exception when others then
  raise warning 'sync_entitlement_from_subscription failed: %', sqlerrm;
  return null;
end;
$$;
revoke execute on function public.sync_entitlement_from_subscription() from public, anon, authenticated;

drop trigger if exists sync_entitlement on stripe.subscriptions;
create trigger sync_entitlement
  after insert or update or delete on stripe.subscriptions
  for each row execute function public.sync_entitlement_from_subscription();

-- 6. New users (invited) get their founder plan on profile creation.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.profiles (id, display_name, created_at, updated_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''), now(), now())
  on conflict (id) do nothing;
  perform public.recompute_entitlement(new.id);
  return new;
end;
$$;

-- 7. Editing the founder list re-resolves that user immediately.
create or replace function public.founder_emails_changed() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = coalesce(new.email, old.email);
  if v_uid is not null then perform public.recompute_entitlement(v_uid); end if;
  return null;
end;
$$;
revoke execute on function public.founder_emails_changed() from public, anon, authenticated;
drop trigger if exists founder_emails_changed on public.founder_emails;
create trigger founder_emails_changed
  after insert or delete on public.founder_emails
  for each row execute function public.founder_emails_changed();

-- 8. One boolean the app gates on (web gate + desktop sync check agree).
create or replace view public.user_entitlements as
 select id as user_id,
        plan_tier::text as plan_tier,
        subscription_status,
        stripe_subscription_id,
        current_period_end,
        case when subscription_status = 'trialing' then current_period_end end as trial_ends_at,
        case when subscription_status = 'trialing' and current_period_end is not null
             then greatest(0::numeric, extract(epoch from (current_period_end - now())) / 86400::numeric) end as trial_days_remaining,
        (plan_tier::text = 'founder' or subscription_status in ('active', 'trialing', 'past_due')) as has_access
   from public.profiles p
  where id = auth.uid();

-- 9. Resolve the two founders now (mike exists; maciej resolves when his profile is created).
select public.recompute_entitlement(id) from auth.users where lower(email) in ('mike@moduo.app', 'maciej@moduo.app');

-- 10. Legacy: written only by the removed custom stripe-webhook (0 rows).
drop table if exists public.subscription_events;
