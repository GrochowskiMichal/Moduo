# Manual test checklist — account deletion erasure (DF-19h follow-up)

> Generated 2026-10-07 · branch `t/maciej/delete-account-erasure` · **Live-verified:** no. The new `delete-account` is **not deployed**, and production was not queried (both need the designer's OK). Verified locally: `account-erasure.test.ts` (28 tests against in-memory supabase-js / Stripe stand-ins; each of ten deliberate code breaks made a test fail), `bun run typecheck` (now covers the module and its test), the function type-checked against the local supabase-js and Stripe types, and a skeptical review pass whose findings are fixed.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## 0. Before deploying: read-only live check (designer present)
Run in the Supabase SQL editor (or MCP `execute_sql`) on project `wtoonrvuqumihpkbvwvs`. Nothing here writes.
- [ ] **Do:** list every FK that points at a user or a workspace, with its delete rule:
  ```sql
  select c.conrelid::regclass as table_name, a.attname as column_name,
         c.confrelid::regclass as references_table,
         case c.confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT'
                            when 'r' then 'RESTRICT' else 'NO ACTION' end as on_delete
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f'
    and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.workspaces'::regclass)
  order by 3, 1, 2;
  ```
  → **Expect:** no `RESTRICT` / `NO ACTION` anywhere (one would make `auth.admin.deleteUser` fail at the very last step, after everything else is gone). Note whether `user_integrations`, `exposed_slot_links`, `slot_bookings`, `booking_link_hosts`, `contact_private_notes` appear at all (the repo says their user columns have no FK; the new code deletes them explicitly either way).
- [ ] **Do:** list user-looking columns with **no** FK (what survives a deletion unless code removes it):
  ```sql
  select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid and c.relkind = 'r'
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where a.attnum > 0 and not a.attisdropped
    and a.attname ~ '(^|_)(user_id|owner_id|owner_user_id|created_by|author_id|actor_id|subject_id)$'
    and not exists (select 1 from pg_constraint f
                    where f.contype = 'f' and f.conrelid = c.oid and a.attnum = any (f.conkey))
  order by 1, 2;
  ```
  → **Expect:** a list to compare with "Not covered yet" in the 2026-10-07 entry of `docs/decisions.md`.
- [ ] **Do:** confirm the columns the function relies on:
  ```sql
  select table_name, column_name, data_type from information_schema.columns
  where table_schema = 'public'
    and table_name in ('user_integrations', 'exposed_slot_links', 'slot_bookings', 'slot_conflict_windows',
                       'booking_link_hosts', 'contact_private_notes', 'waitlist', 'founders_interest', 'profiles')
    and column_name in ('user_id', 'owner_user_id', 'slot_id', 'email', 'stripe_customer_id', 'id')
  order by 1, 2;
  ```
  → **Expect:** `user_integrations.user_id`, `exposed_slot_links.id` + `owner_user_id` + `slot_id`, `slot_bookings.slot_id`, `slot_conflict_windows.slot_id`, `booking_link_hosts.user_id`, `contact_private_notes.user_id`, `waitlist.email`, `founders_interest.id` + `email`, `profiles.stripe_customer_id`. A missing one makes that step fail for everyone (it fails closed, so nothing is half-done).
- [ ] **Do:** `select id, public from storage.buckets order by id;` → **Expect:** only `avatars` holds user files (any other bucket needs adding to the erasure).
- [ ] **Do:** check no profile points at someone else's Stripe customer:
  ```sql
  select p.id, p.stripe_customer_id, c.metadata ->> 'supabase_user_id' as tagged_user
  from public.profiles p
  join stripe.customers c on c.id = p.stripe_customer_id
  where c.metadata ->> 'supabase_user_id' is not null
    and c.metadata ->> 'supabase_user_id' <> p.id::text;
  ```
  → **Expect:** no rows. Deletion now skips such a customer, but the row would also open that customer's billing portal to the wrong person: report it.
- [ ] **Do:** count leftovers from deletions that already happened:
  ```sql
  select 'user_integrations' as t, count(*) from public.user_integrations x
    where not exists (select 1 from auth.users u where u.id::text = x.user_id::text)
  union all select 'exposed_slot_links', count(*) from public.exposed_slot_links x
    where not exists (select 1 from auth.users u where u.id::text = x.owner_user_id::text)
  union all select 'booking_link_hosts', count(*) from public.booking_link_hosts x
    where not exists (select 1 from auth.users u where u.id = x.user_id)
  union all select 'contact_private_notes', count(*) from public.contact_private_notes x
    where not exists (select 1 from auth.users u where u.id = x.user_id)
  union all select 'stripe customers (mirror)', count(*) from stripe.customers c
    where coalesce(c.deleted, false) = false and c.metadata ->> 'supabase_user_id' is not null
      and not exists (select 1 from auth.users u where u.id::text = c.metadata ->> 'supabase_user_id');
  ```
  → **Expect:** zeros. Anything else is data from an earlier deletion; removing it is a one-off cleanup that needs its own OK.

## 1. Deploy (designer OK required)
- [ ] **Do:** `supabase functions deploy delete-account --project-ref wtoonrvuqumihpkbvwvs --no-verify-jwt --import-map supabase/functions/deno.json --use-api` (or MCP `deploy_edge_function` with `_shared/account-erasure.ts`, `_shared/billing.ts`, `_shared/secret-keys.ts`) → **Expect:** deploy succeeds; `STRIPE_SECRET_KEY` is already a project secret (start-trial uses it). _(server)_
- [ ] **Do:** `curl -X POST https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/delete-account` with no `Authorization` → **Expect:** `401 {"error":"Unauthorized"}`. A `GET` → `405`. _(server)_

## 2. Delete a throwaway account end to end (never the reusable test account)
Set up a throwaway invited account first: sign in once (the app starts the Stripe trial), upload a profile picture, give its solo workspace a logo, create a booking link and book one slot from another browser, connect Google Calendar if handy, and join the landing waitlist with the same email.
- [ ] **Do:** copy the profile-picture URL and the logo URL (right-click → copy image address) before deleting → **Expect:** both load. _(web)_
- [ ] **Do:** Settings → Account → Danger zone → type the email → **Delete account** → **Expect:** signed out, land on `/auth`. _(both)_
- [ ] **Do:** open the two copied image URLs → **Expect:** not found (no image). Uploads set a 1-hour cache, so a CDN copy can linger up to an hour; check again later if one still loads. _(web)_
- [ ] **Do:** open the booking page `moduo.app/book/<slug>` and the guest's cancel link → **Expect:** not found. _(web)_
- [ ] **Do:** Stripe dashboard → Customers → search the email → **Expect:** the customer is gone (deleted); its trial subscription shows **Canceled** with the comment "Moduo account deleted". _(Stripe)_
- [ ] **Do:** read-only SQL with the throwaway's id + email:
  ```sql
  select (select count(*) from public.user_integrations where user_id::text = '<uid>') as integrations,
         (select count(*) from public.exposed_slot_links where owner_user_id::text = '<uid>') as links,
         (select count(*) from public.booking_link_hosts where user_id = '<uid>') as cohost_seats,
         (select count(*) from public.contact_private_notes where user_id = '<uid>') as contact_notes,
         (select count(*) from public.waitlist where email = '<email>') as waitlist,
         (select count(*) from public.founders_interest where lower(email) = '<email>') as founders,
         (select count(*) from storage.objects where bucket_id = 'avatars'
            and name like 'profiles/<uid>/%') as avatar_files,
         (select count(*) from auth.users where id = '<uid>') as auth_user;
  ```
  → **Expect:** all `0`.

## 3. The sole-owner block is unchanged
- [ ] **Do:** on an account that solely owns a workspace with another member, try to delete → **Expect:** the panel lists the workspace and says to hand off ownership or delete it first; nothing is deleted: the Stripe customer, the picture and the booking links are all still there. _(both)_

## Edge cases (covered by unit tests, not live)
- [ ] **Do:** nothing; read `supabase/functions/_shared/account-erasure.test.ts` if curious → **Expect:** covered: a Stripe failure stops before anything in Moduo is deleted, and a retry finishes; a later failure keeps the account and a retry finishes without touching Stripe twice; a stored customer that Stripe tags with another user is never touched; a customer search refused for good is a warning, a rate limit or outage fails the step; a stored id this Stripe account doesn't have is a warning; no Stripe key + a stored customer refuses; Stripe's pages of customers and subscriptions are followed; nested storage folders are emptied; a booking made mid-delete is swept; bookings that another host's link shares a slot id with are kept; founders rows match whatever their case, and a LIKE wildcard never takes someone else's row; paging past PostgREST's 1000-row cap.

## Migrations / data
- No migration. The `delete-account` Edge Function changes, plus the new shared module it imports; `tsconfig.json` now includes that module and its test so `bun run typecheck` checks them.

## Known gaps / not-yet-testable
- Not deployed and not run against production (designer OK needed for both, per the task).
- Not erased yet, needs decisions (PRIV-2; see the 2026-10-07 entry in `docs/decisions.md`): the `stripe.*` Sync Engine mirror rows (customer email/name, invoices, charges); invoices and charges Stripe itself keeps after a customer is deleted; founder coupons and promotion codes, which carry the email in their name and metadata; private items the user owns in **other people's** workspaces (owner-only calendar and email accounts, private contacts, calendars; private buckets there, and possibly private notes, go to that workspace's owner through the member-removal trigger). Google / Zoom grants are not revoked at the provider, same as the existing Disconnect.
- A deleted co-host seat leaves the other owner's collective link paused (collective links are switched off today).
- Waitlist and founders rows are only deleted when the account's email is confirmed (OTP sign-in confirms it, so in practice always).
- Deleting a user from the Supabase dashboard still skips all of this. Use the in-app flow.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
