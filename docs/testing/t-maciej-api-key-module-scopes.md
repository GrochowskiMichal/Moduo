# Manual test checklist — per-module API key scopes (port onto the permission model)

> Generated 2026-10-08 · branch `t/maciej/api-key-module-scopes` · **Live-verified:** partial.
> - **UI:** the real `ApiKeysSection` was driven in the browser pane through a temporary harness (in-memory runtime, removed before commit), as owner and as a member: new-key caps, editing someone else's key, the save payload, and the "Acts as" lines. The app only offers emailed-code sign-in, so the signed-in screen itself is your pass.
> - **Server, before the migrations:** a keyed write round-trip on prod (rolled back, nothing kept) ran every connector write op under a real key context. It found six broken writes (see Migrations).
> - **Server, the migrations:** `20261008120000` ran on a throwaway local Postgres with a stub schema (40 cases). All four ran on a local replica of prod's schema (the recipe is at the end). The replica reproduced prod's bugs before the migrations and passed 26 cases after, re-run after the review fixes (contact links start only at a contact or a company; a key with no creator can only be lowered; an import no longer takes a teammate's private company by name). Auto mode refused running migration DDL against prod, even rolled back.
> - **Connector:** 19 unit tests (`supabase/functions/moduo-mcp/key-scopes.test.ts`) run the real tool gating, reach checks and cross-module filters against an in-memory database. Each fix's test was checked to fail on the old code.
> - **Not yet:** the connector redeploy and the prod apply (they wait for Maciej's go-ahead), then the same keyed round-trip on prod.
>
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Settings → API keys: creating a key
- [ ] **Do:** Open Settings → API keys as the workspace owner. → **Expect:** three groups. **Connector** has the MCP address and a copy button. **New key** has Name, then Access with seven rows (Tasks, Notes, Calendar, Email, Contacts, Chat, Links), each None / View / Edit. **Keys** lists the workspace's keys. New-key rows start at Tasks = View, the rest None. _(both)_
- [ ] **Do:** Type a name, set Notes = Edit, Calendar = View, Chat = View, Tasks = None, press **Create key**. → **Expect:** a green "<name> is ready. Copy the key now…" banner with the secret; the key appears in Keys reading "Edit: Notes · View: Calendar, Chat" and "Acts as you"; the form resets to read-only Tasks. _(both)_
- [ ] **Do:** Set every module to None with a name typed. → **Expect:** Create key is disabled, the hint says "Give the key access to at least one module.", and Enter does nothing. _(both)_
- [ ] **Do:** Set Calendar = Edit while Tasks isn't Edit, then Notes = Edit while Links isn't Edit. → **Expect:** an amber note under each row: "Moving scheduled tasks also needs Tasks: Edit." / "Linking notes also needs Links: Edit."; each goes away once the named module is at Edit. _(both)_
- [ ] **Do:** In a Pro or Free workspace, look at the Chat row. → **Expect:** "Chat is on the Duo and Team plans." under it. _(both)_

## Settings → API keys: a key never gets more than you
- [ ] **Do:** As a member whose role can view Notes but not edit them (Settings → Members and access → a custom role, or an exception), open API keys. → **Expect:** Notes' Edit is greyed out with "You can only view Notes yourself."; a module you can't see at all is None-only with "You don't have access to … yourself." _(both)_
- [ ] **Do:** As someone without the "API keys and integrations" permission, open API keys. → **Expect:** "Your role doesn't include API keys in this workspace. Ask the workspace owner." and no form or list. _(both)_

## Settings → API keys: editing access
- [ ] **Do:** On your own key, press **Edit access**, change two modules, **Save**. → **Expect:** "Access updated for <name>." toast; the summary updates; the editor closes and focus returns to Edit access. The secret is unchanged. _(both)_
- [ ] **Do:** As the owner, open **Edit access** on a teammate's key. → **Expect:** one line above the rows: "Only <name> can give this key more access. You can lower it or revoke it."; every level above the key's current one is greyed out; lowering one and saving works. _(both)_
- [ ] **Do:** Find a key whose creator's role was lowered after it was made. → **Expect:** its summary shows what it can do now, with "· Limited to what <name> can do". _(both)_
- [ ] **Do:** A key made by someone who has since left. → **Expect:** "No access" and "Acts as a former member, so it has no access"; Edit access only lowers; revoke works. _(both)_
- [ ] **Do:** Set every module to None in the editor; then change something and Cancel. → **Expect:** Save is disabled with the revoke hint; after Cancel and reopen, the saved access shows. _(both)_

## The connector honours it (an MCP client, e.g. Claude Desktop, or the script)
- [ ] **Do:** Make two keys in a test workspace, one View everywhere and one Edit everywhere, and run `MODUO_MCP_KEY=<key> bun scripts/mcp-roundtrip.ts --write` with each. → **Expect:** every line PASS: reads per module; with the Edit key, reversible writes (task commit/uncommit, note and contact created *and readable by the key*, a link made and removed, an event made and deleted, a follow-up set and cleared); with the View key, "refuses <write tool>". _(web)_
- [ ] **Do:** Connect with Tasks = View, Notes = View, everything else None; list tools. → **Expect:** tasks and notes read tools only; no write tools, no `links_*`, no calendar tools. _(web)_
- [ ] **Do:** Set Calendar = Edit (Tasks still View) and reconnect. → **Expect:** `calendar_create_event` / `update` / `delete` appear, but **not** `calendar_schedule_task`, `calendar_move_block`, `calendar_complete_block`, `calendar_roll_forward`. Raise Tasks to Edit and reconnect: the four appear. _(web)_
- [ ] **Do:** With Links = View and Notes = None, call `links_search_entities` with no query. → **Expect:** no note results (tasks show only if Tasks ≥ View). `links_suggest` isn't listed until Links = Edit. _(web)_
- [ ] **Do:** With Calendar = View and Tasks = None, call `calendar_day`. → **Expect:** events, empty `blocks` / `strip`, and "Task blocks are left out: this API key has no access to Tasks." _(web)_
- [ ] **Do:** With Links = Edit, Notes = Edit, call `links_create` between a task and a note, then `comments_add` on the task. → **Expect:** both succeed (they failed for every key before `20261008123000`); the link appears on both items; the comment shows on the note/task as "<key name> (app)", not as you. _(web)_
- [ ] **Do:** With Notes = Edit, call `notes_create`. → **Expect:** the note appears in your Notes tree (before the fix it was created invisible to everyone). With Contacts = Edit, `contacts_create` → the contact appears in your directory. _(web)_
- [ ] **Do:** With Contacts = Edit and Links = None, call `contacts_delete` on a throwaway contact. → **Expect:** it succeeds (no Links scope needed). _(web)_
- [ ] **Do:** Call a tool the key can't use. → **Expect:** "This API key can't use <tool>: it needs <Module>: Edit [and <Module>: Edit]. Change the key's access in Moduo → Settings → API keys." _(web)_
- [ ] **Do:** With Contacts = Edit, call `contacts_link` with `contact_type: "task"`. → **Expect:** refused before anything is written (`contact_type` must be `contact` or `company`); the database refuses it too. _(web)_
- [ ] **Do:** With Contacts = Edit, `contacts_import` a row whose `company` is the name of a teammate's private company. → **Expect:** the contact gets a new company of that name, owned by you; the teammate's company isn't attached and stays hidden from you. _(web)_
- [ ] **Do:** With Links = Edit, call `links_delete` with a real link id written without hyphens. → **Expect:** "No link with that id in this workspace." and the link is still there. _(web)_
- [ ] **Do:** With Tasks = View and Links = View in a workspace with many notes, call `links_search_entities` with no query. → **Expect:** your tasks come back (a full page when there are enough), not an empty list. _(web)_

## Comments written by an app
- [ ] **Do:** After an agent comments on a note, open the note's comments panel. → **Expect:** "<key name> (app) · <time>", never "You". Your own comments still say "You". _(both)_

## Edge cases
- [ ] **Do:** Open a key made before this change (Tasks + Chat only). → **Expect:** summary "View: Tasks" (or "Edit: Tasks", plus Chat if set); Edit access shows the rest at None. _(both)_
- [ ] **Do:** Open API keys while the member list is still loading (or fails to load). → **Expect:** a teammate's key reads "Acts as a teammate" with its stored access, never "former member" or "No access". _(both)_
- [ ] **Do:** Switch workspace with Settings open. → **Expect:** the list reloads for the new workspace; no editor, secret banner or revoke dialog carries over; the new-key form resets. _(both)_
- [ ] **Do:** A teammate with Email but no module edit rights removes one of their email threads from Moduo (in the app or via their key). → **Expect:** refused, "You don't have edit access to links in this workspace."; their key gets the same answer as they do. _(both)_

## Migrations / data (`20261008120000…123000`; **not yet applied to prod**, waiting on the go-ahead)
- [ ] **Do:** `select conname, convalidated from pg_constraint where conname in ('workspace_api_keys_scopes_check','comments_author_kind_check');` → **Expect:** both rows, `convalidated = true`. _(n/a)_
- [ ] **Do:** `select has_function_privilege('anon','public.workspace_api_keys_set_scopes(uuid,jsonb)','EXECUTE'), has_function_privilege('authenticated','public.workspace_api_keys__check_scopes(uuid,uuid,jsonb,jsonb,boolean)','EXECUTE'), has_function_privilege('authenticated','public.module_api_key_cap(uuid,uuid,text)','EXECUTE'), has_function_privilege('service_role','public.workspace_api_key_scopes_valid(jsonb)','EXECUTE');` → **Expect:** `false, false, false, true`. The last one matters: the connector's `last_used_at` stamp runs the CHECK as service_role and swallows its own errors, so a missing grant would fail silently. _(n/a)_
- [ ] **Do:** Run `bun run db:reconcile` and paste query 2 into the Supabase MCP `execute_sql`. → **Expect:** `contacts_op_delete`, `calendar_op_event_delete`, `email_op_ref_remove` no longer listed as body drift, and `workspace_api_keys_set_scopes` no longer "in prod, not in any migration". _(n/a)_
- [ ] **Do:** The keyed round-trip on prod (rolled back), as in the Recipe below but against prod with DML only. → **Expect:** every write op ok with an Edit key; link/comment `created_by`, contact `owner_id` and note `created_by` = the key's creator; the comment `author_kind = 'api_key'`; a View key refused on every write. _(n/a)_

## Known gaps / not-yet-testable
- **Redeploy + prod apply pending** Maciej's go-ahead, in this order: `supabase functions deploy moduo-mcp` first, then the four migrations (or both in one sitting). The new connector is safe against today's database. The old connector is not safe against the new one: once `20261008123000` makes key links and comments work, the deployed connector has no per-item checks, so a Links key with Notes = None could link or comment onto notes, and the shipped app would show those comments as "You". Until the migrations apply, prod keeps the 2026-10-01 `set_scopes` (no creator cap, no creator-only widening) and the six broken writes. The connector caps every call by the creator regardless, so nothing escalates in the gap; the UI and the new connector code work against either.
- **The app UI reaches users only when `maciej` moves to `develop` and `prod-app`** (not done here: "don't touch develop"). Until then the shipped Settings screen still offers Tasks + Chat only, though the connector and the database honour per-module keys made any way.
- **MCP-1 leftovers, not part of this change:** `notes_append` / `notes_update` don't reach an already-materialized note's live editor (CRDT path); there's no MCP tool to create a task (the landing's "Add a task…" demo prompt can't happen over MCP today).
- The client cap mirror reads Email from the member's tier (viewer → View, else Edit). `workspace_members.permissions_email` is unset for everyone today; if it's ever set, the server is still right and the screen may offer a level the server refuses with a clear error.
- People can link or comment onto an item they can't open by id (the SQL ops guard the module, not the item). Keys can't any more (`assertReach`); the person-side gap predates this branch.
- **Older privacy gap, fixed on another branch:** someone with Contacts edit (or their key) could give a new contact a teammate's private company id and then read that company, because `contacts_op_create` didn't check `p_company_id` and `can_access('company')` grants View through any visible contact that points at it. Company ids are readable in `entity_links`. Same for a person and their key, so a key still never exceeds its creator. Fixed in `20261008124500_contacts_company_access_check.sql` (branch `t/maciej/contacts-company-access`), which also covers the card's `contacts_op_set_details`; checklist [t-maciej-contacts-company-access.md](t-maciej-contacts-company-access.md). The same leak by company *name* in `contacts_op_import` is fixed here, since this branch redefines that op.

## Recipe: verify migrations on a local replica (used here)
1. `initdb --no-locale` with `LANG=C LC_ALL=C`, start on a free port with `-k /tmp` (a scratchpad socket path is too long), and check no other session's Postgres owns the port.
2. Stub roles `anon` / `authenticated` / `service_role`, schema `auth` with `auth.uid()` reading `request.jwt.claims ->> 'sub'`, `extensions` with pgcrypto, `uuid-ossp`, and the `plan_tier` enum.
3. Rebuild the tables the migrations touch from prod's catalog (read-only): `pg_attribute` + `format_type` + `pg_get_expr` for defaults and generated columns, and `pg_indexes` for unique and partial indexes (`ON CONFLICT` needs them).
4. Load the newest repo definitions of every function involved (`SET check_function_bodies = off`), plus any prod-only bodies (here: the old branch's three files), and attach the `perm_enforce_write` triggers.
5. Seed with no JWT claims (system writes pass the trigger), run the cases, apply the migrations, run the cases again. Keyed calls: `set_config('request.jwt.claims','{"role":"service_role"}')` + `set_config('request.headers','{"x-moduo-key-id":"<key>"}')`.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
