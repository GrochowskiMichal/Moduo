-- Plan seat limits, enforced where invites and members are created.
--   Free / Pro: 1 person · Duo: 2 · Team: paid seats (min 3) · Founder: unlimited.
-- Previously Pro could invite (landing says Pro is one person) and Duo did not exist.

create or replace function public.workspace_seat_cap(p_owner uuid) returns int
language sql stable security definer set search_path = public, stripe as $$
  select case public.profile_plan_tier_text(p_owner)
    when 'founder' then 1000000
    when 'team' then coalesce(
      (select greatest((s.items->'data'->0->>'quantity')::int, 3)
         from public.profiles p join stripe.subscriptions s on s.id = p.stripe_subscription_id
        where p.id = p_owner), 3)
    when 'duo' then 2
    else 1
  end
$$;

-- Seats in use = members (the owner counts) + still-open invites.
create or replace function public.workspace_seats_used(p_workspace uuid) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.workspace_members where workspace_id = p_workspace)::int
       + (select count(*) from public.workspace_invites
           where workspace_id = p_workspace and status = 'pending'
             and (expires_at is null or expires_at > now()))::int
$$;

revoke execute on function public.workspace_seat_cap(uuid), public.workspace_seats_used(uuid) from public, anon;
grant execute on function public.workspace_seat_cap(uuid), public.workspace_seats_used(uuid) to authenticated, service_role;

-- The old "paid_plan_*" policies were PERMISSIVE, so the OR with workspace_invites_insert_admin /
-- workspace_members_insert_owner made the plan check bypassable (a Free owner could invite).
-- These are RESTRICTIVE: they AND with whoever is otherwise allowed to invite/add (owner or admin),
-- and cap against the workspace OWNER's plan.
drop policy if exists paid_plan_required_to_invite on public.workspace_invites;
create policy paid_plan_required_to_invite on public.workspace_invites
  as restrictive for insert
  with check (
    public.workspace_seat_cap((select w.owner_id from public.workspaces w where w.id = workspace_invites.workspace_id))
      > public.workspace_seats_used(workspace_invites.workspace_id)
  );

drop policy if exists paid_plan_required_to_add_member on public.workspace_members;
create policy paid_plan_required_to_add_member on public.workspace_members
  as restrictive for insert
  with check (
    user_id = auth.uid()
    or public.workspace_seat_cap((select w.owner_id from public.workspaces w where w.id = workspace_members.workspace_id))
         > public.workspace_seats_used(workspace_members.workspace_id)
  );

-- Superseded by the trigger in 20261006120000 (and read the wrong JSON path); never attached.
drop function if exists public.sync_profile_from_stripe_subscription();
