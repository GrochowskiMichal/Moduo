# Manual test checklist — a contact can point only at a company you can open

> Generated 2026-10-08 · branch `t/maciej/contacts-company-access` · **Live-verified:** partial.
> - **Server, on a local replica (not prod):** migration `20261008124500_contacts_company_access_check.sql` ran on a throwaway Postgres 17 built the way [the API-key checklist's recipe](t-maciej-api-key-module-scopes.md) describes, with every function body taken from the repo (39 functions, nothing prod-only needed), `perm_enforce_write` and `share_contact_after` attached, the read policies on `contacts` / `companies`, and Supabase's default grants. The same 31 cases ran before and after the migration (62 checks, all as expected). Before it, the leak reproduced every way: create, update and the card's `set_details`, as a person and with a Contacts-edit key, and for the workspace owner too; afterwards each was refused with the same message, and everything still allowed kept working. Applying the file before `20261008123000` is refused and leaves nothing behind; applying it twice works.
> - **Prod, read-only:** prod's bodies of the three ops match, after db:reconcile's normalization, the exact bodies this migration starts from. Prod already runs `20261008123000`'s `contacts_op_create` and `contacts_op_import`, so the ordering check passes there. Grants on the ops are `anon` false, `authenticated` true, `service_role` true, and `CREATE OR REPLACE` keeps them.
> - **Prod, applied 2026-10-08** (Maciej's go-ahead in-session, MCP `apply_migration` as `contacts_company_access_check`): the catalog shows the guard locked to `service_role`, the three ops calling it with their grants unchanged and one overload each, and all four bodies hash-identical to this file. A rolled-back probe (no data returned, nothing kept) answered as expected: unknown id, the right company in another workspace, and a non-member asking for a real company were refused; the company's owner and NULL passed; `contacts_op_create` with an unknown company was refused before inserting anything.
> - **Follow-up `20261008125500` (validator review):** on a contact you can't edit, `update` / `set_details` used to answer differently for the company it already points at than for any other id, which told a member which company a teammate's private contact points at. The contact's own edit check now runs first. On the replica the guessing cases reproduced at `124500` and answered uniformly after `125500` (8 new cases; the 31 earlier ones still pass; grants unchanged; it refuses to run before `124500`). The app now sets the company before creating the works-at link (suggestion accept, Set company), so a refused company leaves no link behind. **Applied to prod 2026-10-08** with Maciej's go-ahead: both bodies hash-identical to the file, grants unchanged; a rolled-back probe with a temporary private contact answered "You don't have access to this contact." to all four guesses (update and set_details, its company and another id) and let the owner clear the company.
> - **Not yet:** the app and MCP passes below. The app has no screen that offers a private company, except the "Works at" suggestion (see Known gaps), so the app items mostly confirm nothing regressed.
>
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Contacts in the app (after the prod apply)
- [ ] **Do:** Open one of your contacts, set its company to one of your own companies, then clear it. → **Expect:** both save; the company chip appears, then goes. _(both)_
- [ ] **Do:** Create a contact and pick a company while creating it. → **Expect:** it saves with that company. _(both)_
- [ ] **Do:** Set a contact's company to one you can see only because a teammate shared a contact who works there. → **Expect:** it saves. _(both)_
- [ ] **Do:** On a contact that already has a company, change only the title (inline card), then only the name. → **Expect:** both save; the company stays. _(both)_
- [ ] **Do:** Accept a "Works at" suggestion for one of your companies. → **Expect:** the company is attached. _(both)_

## A teammate's private company stays private (two accounts in one workspace)
- [ ] **Do:** As Ben, create a company "Secret Co" with the domain `secret.example` and don't share anything about it. As Anna (Contacts edit), give one of your contacts an `@secret.example` email. → **Expect:** Anna's directory doesn't list Secret Co. _(both)_
- [ ] **Do:** As Anna, accept the "Works at Secret Co" suggestion if it appears. → **Expect:** an error, "No company with that id in this workspace."; the suggestion comes back; no works-at link to Secret Co is added (the company is now written before the link), and Secret Co still doesn't appear anywhere for Anna. (That the suggestion shows Secret Co's name at all is the separate `links_suggest` leak, fixed in #288.) _(both)_
- [ ] **Do:** As Anna, in the browser console run `await supabase.rpc('contacts_op_create', { p_workspace_id: '<ws>', p_name: 'x', p_company_id: '<Secret Co id>' })` (the id is in `entity_links` or a link list), then the same through `contacts_op_update` (`p_contact_id`, `p_set_company: true`, `p_company_id`) and `contacts_op_set_details` (`p_patch: { companyId: '<id>' }`). → **Expect:** each answers "No company with that id in this workspace."; `supabase.from('companies').select('name').eq('id', '<id>')` returns nothing. _(web)_
- [ ] **Do:** As the workspace owner, try the same `contacts_op_create` with Ben's private company. → **Expect:** the same refusal: owners don't see members' private companies either. _(web)_

## Over MCP (an MCP client, or `scripts/mcp-roundtrip.ts`)
- [ ] **Do:** With a Contacts = Edit key, `contacts_create` with `company_id` set to one of the key creator's companies, then `contacts_list`. → **Expect:** created; the list shows the contact and that company. _(web)_
- [ ] **Do:** `contacts_create` with `company_id` set to a teammate's private company. → **Expect:** "No company with that id in this workspace."; `contacts_list` doesn't show that company. _(web)_
- [ ] **Do:** `contacts_create` with a made-up uuid as `company_id`. → **Expect:** the same message, not a foreign-key error. _(web)_
- [ ] **Do:** With a Contacts = View key, call `contacts_create`. → **Expect:** refused for the key's scope, as before; no company message. _(web)_

## Edge cases
- [ ] **Do:** Create a contact with a deleted company, or with a company from another of your workspaces. → **Expect:** "No company with that id in this workspace." for both, the same text as for a private one. _(web)_
- [ ] **Do:** Restore a deleted contact whose company was deleted while it was in the trash (it keeps the dead company id; deleting a company clears only live contacts), then edit its title. → **Expect:** it saves; the company isn't checked unless you change it. _(both)_
- [ ] **Do:** As Anna, `contacts_op_update` / `contacts_op_set_details` on Ben's private contact, once with the company it points at and once with any other id. → **Expect:** "You don't have access to this contact." both times (after `20261008125500`). _(web)_
- [ ] **Do:** `contacts_op_set_details` with `{ "companyId": "not-a-uuid" }`. → **Expect:** "invalid input syntax for type uuid", as before. _(web)_
- [ ] **Do:** Import a CSV row whose Company is the name of a teammate's private company. → **Expect:** the contact gets a new company of that name owned by you (unchanged from #247). _(both)_

## Migrations / data
- [x] **Do:** Apply `20261008124500_contacts_company_access_check.sql` (only after `20261008123000`; it refuses to run before it). → **Expect:** it applies in one transaction. _(n/a)_
- [x] **Do:** `select has_function_privilege('anon', 'public.contacts_op__guard_company(uuid,uuid)', 'EXECUTE'), has_function_privilege('authenticated', 'public.contacts_op__guard_company(uuid,uuid)', 'EXECUTE');` → **Expect:** `false, false`. _(n/a)_
- [x] **Do:** `select proname, prosrc like '%contacts_op__guard_company%' from pg_proc where proname in ('contacts_op_create', 'contacts_op_update', 'contacts_op_set_details');` → **Expect:** three rows, all `true`, one overload each. _(n/a)_
- [x] **Do:** `select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE') from pg_proc p where proname in ('contacts_op_create', 'contacts_op_update', 'contacts_op_set_details');` → **Expect:** `false, true, true` on each, as before the apply. _(n/a)_
- [x] **Do:** A rolled-back DML probe on prod (DO block ending in `RAISE`), signed in as a member through `set_config('request.jwt.claims', …)`: create a contact with a company that member can't open, then with their own. → **Expect:** the first is refused with the message, the second succeeds, nothing persists. _(n/a)_
- [ ] **Do (optional, reads people's data, so with Maciej's OK):** find contacts that are their owner's only way to see a company someone else owns: `select c.id, c.workspace_id, c.created_at from contacts c join companies co on co.id = c.company_id where c.deleted_at is null and co.deleted_at is null and co.owner_id is distinct from c.owner_id and not exists (select 1 from contacts c2 where c2.company_id = co.id and c2.id <> c.id and c2.deleted_at is null and public.can_access('contact', c2.id, 'view', c.owner_id));` → **Expect:** none, or rows that are explainable (the company was visible through another contact at the time). This fix stops new ones; it doesn't undo old ones. _(n/a)_

- [x] **Do (after the `20261008125500` apply):** `select proname, prosrc like '%SET updated_at = updated_at%' from pg_proc where proname in ('contacts_op_update', 'contacts_op_set_details');` → **Expect:** both `true`; grants as above. _(n/a)_

## Known gaps / not-yet-testable
- **The app's reorder wasn't live-verified** (it needs two signed-in accounts and a private company); the drag-and-drop works-at path still links first, but it can only drag companies you can already see.
- **Applied to prod before the `/code-review ultra` pass** (Maciej's call: the leak was open in prod, for people through the app session or direct RPC and, since `20261008123000`, for Contacts-edit keys). Anything the review finds ships as a follow-up migration.
- **The "Works at" suggestion still shows a private company's name** (and `links_suggest` can show private notes, tasks and contacts by title, through shared tags or nearby activity): its filter only covers PERM-0's owner-only types. With this fix, accepting such a suggestion is refused, but the name has already been shown. Being fixed in #288 (`t/maciej/links-suggest-visibility`).
- **Old data isn't changed.** A contact that already points at a company its owner couldn't otherwise open keeps it; the optional query above finds them.
- **Still open from #247:** people (not keys) can link or comment onto an item they can't open, by id; the SQL ops guard the module, not the item.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
