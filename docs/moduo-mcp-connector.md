# Moduo MCP Connector — One Server, Per-Module Registration

**Purpose:** the single MCP surface for Moduo (improvement-plan Session 9),
built on the module contract ([moduo-module-contract.md](./moduo-module-contract.md)).
Agents and API clients read module state and mutate it **exclusively through
intent ops** — never raw rows. Tasks is module #1; onboarding module N+1 is a
registration entry, not architecture.

This is a living spec. When a decision changes, update this file first, then code.

---

## Shape

- **One stateless edge function** —
  [`supabase/functions/moduo-mcp/`](../supabase/functions/moduo-mcp/) — speaks
  MCP Streamable HTTP (JSON-RPC over a single POST endpoint; notifications
  acknowledged with 202; no SSE stream, no session state). Since MCPO-2 the
  protocol is the official SDK (`@modelcontextprotocol/server`, protocol
  versions up to 2025-11-25): `server.ts` builds one server per request
  holding only the key's tools; `index.ts` mounts it with `@supabase/server`
  (CORS, service-role clients). `sdk-parity.test.ts` holds every answer to
  what the hand-written server said. Deployed with `verify_jwt = false`: MCP
  clients present a Moduo key, not a Supabase JWT.
- **Endpoint:** **`https://mcp.moduo.app`** in production, shown with a copy
  affordance in Settings → API keys and Integrations → AI & MCP
  (`runtime.workspace.getMcpEndpoint()`; any other project, such as the local
  stack, shows its function URL). It is a Cloudflare Worker
  (`infra/mcp-proxy`, `moduo-mcp-proxy`) that forwards every request to the
  function unchanged, so Claude shows Moduo's icon: Claude takes a custom
  connector's icon from its URL's domain and ignores `serverInfo.icons`
  (anthropics/claude-ai-mcp#152). The function's own address,
  `https://<project>.supabase.co/functions/v1/moduo-mcp`, keeps working
  exactly as before for connections made with it. Discovery names whichever
  of the two the client used (`public-url.ts`: the Worker sends
  `x-moduo-mcp-origin`, believed only for `MCP_PUBLIC_URL`'s origins,
  `https://mcp.moduo.app` when unset). `serverInfo` carries `websiteUrl` and
  `icons` (moduo.app's favicons) for clients that read them. The Worker
  deploys with each release tag (`_deploy-mcp-proxy.yml`).
- **Auth:** `Authorization: Bearer moduo_sk_…`. The secret is sha256-matched
  against `workspace_api_keys.key_hash`; revoked or unknown → 401. The key
  pins the workspace: **tools never take a workspace argument.**
- **Or sign in (OAuth, MCPO-1…6, on in prod since 2026-10-23):** any other
  bearer is checked as a Supabase OAuth 2.1 token from an app (it carries
  `client_id`) and swapped for its **connection**: a `workspace_api_keys` row
  with `oauth_client_id` instead of a secret, made on the consent screen. From
  there it runs exactly like a pasted key. See "Connecting by sign-in" below.

## Connecting by sign-in (OAuth)

How an app such as Claude connects with only the URL
([specs/mcp-oauth.md](../specs/mcp-oauth.md), decisions in
[decisions/mcp.md](decisions/mcp.md)):

1. The app calls the connector with no credentials and gets 401 with
   `WWW-Authenticate: Bearer resource_metadata=…/oauth-protected-resource`
   (`https://mcp.moduo.app/oauth-protected-resource`, or
   `…/moduo-mcp/oauth-protected-resource` on the Supabase URL), whose
   `resource` is the address the app called and whose sign-in server is
   always the project's Supabase Auth (`https://<project>.supabase.co/auth/v1`).
   Supabase Auth accepts any absolute `resource` (it checks only the URI's
   shape and that the token request repeats it), and the token's audience
   doesn't depend on it, so one token works at both addresses.
2. It registers itself (dynamic client registration) and sends the person to
   Supabase's authorize endpoint (PKCE), which redirects to
   `https://app.moduo.app/oauth/consent?authorization_id=…`.
3. The consent screen (sign in with the emailed code first if needed) shows
   the app, where it returns to, a workspace picker, the access card and an
   expiry. **Approve** calls `workspace_api_keys_connect_oauth` (one live
   connection per person and app registration, capped by the person's access
   and the 20 cap, a bell notice) and then approves the sign-in.
4. The app swaps the code for a token. Each call: the connector verifies the
   token, loads the live connection for `(sub, client_id)` with the key checks
   (revoked, expired, creator still a member), then runs as that key.

Prod settings (Authentication in the Supabase dashboard): OAuth server on,
authorization path `/oauth/consent`, Site URL `https://app.moduo.app`, dynamic
registration on, **TOTP, phone and WebAuthn MFA off** (an MFA-verified token
loses `client_id`). The lockout (`20261022230000`, `20261023000000`) keeps an
app's token out of everything but this connector.

What people see, per client:
- **Claude Code** (CLI and the desktop app's Code tab) returns to
  `http://localhost:<port>` (a loopback redirect, RFC 8252), so the screen
  shows "Moduo hasn't checked this app". Its sign-in lives on the Mac.
- **Claude** (claude.ai and the desktop app's chat) returns to
  `https://claude.ai`. Its connectors belong to the **Claude account**: a
  desktop Connect finishes in whichever Claude account the browser is signed
  into, so with two Claude accounts the connection lands on the other one.
  Each Connect registers a fresh client. Settings → API keys shows when each
  connection was made and last used, to the minute, and the consent screen
  offers "Replace your other Claude connection" for each earlier one (ticked
  unless it was used in the last two minutes), so repeats don't pile up.
- Claude speaks MCP protocol 2026-07-28: it opens with `server/discover`
  (the per-request `_meta` envelope, no `initialize`). The connector serves
  that era through the SDK's `createMcpHandler` and the 2025 era as before;
  `initialize` asking for 2026-07-28 is answered with 2025-11-25.

## Scoped API keys (contract Pillar 4)

`workspace_api_keys` (migration `20260612160000`): workspace-scoped, named
keys with a per-module `scopes` jsonb on the **none / view / edit** ladder.
**Admin is never key-grantable.** The secret is generated server-side
(`workspace_api_keys_create`), returned exactly once, and stored only as a hash
(`key_prefix` is the display stub; a column-level grant keeps `key_hash`
unreadable by clients). Max 20 live keys per workspace.

**The modules** (`MCP_KEY_MODULES` in `@contracts/vocabularies`, held by the
`workspace_api_keys_scopes_check` CHECK since `20261008120000`): Tasks, Notes,
Calendar, Email, Contacts, Chat, and Links (the spine: search, links and
comments across the other modules).

- `view` → the module's read tools are visible and callable.
- `edit` → read tools + the module's intent-op write tools.
- `none` / absent → the module contributes nothing to this key's surface.

**Inside the permission model (PERM-0/1).** A key acts as the person who
created it and never gets more than they can do:

- Every call is capped live: the connector reads
  `module_api_key_effective_scopes` (key scope ∩ the creator's current access
  per module) at auth time, and each `<module>_module_permission()` applies
  the same cap for the ops. Roles and personal exceptions apply through the
  write triggers (`perm_enforce_write` checks the creator's
  `<module>.create|edit|delete`), and per-item sharing through
  `share_visible_ids` / `perm_can_see_entity`. A key whose creator left the
  workspace reads as no access; a key with no recorded creator is refused.
- Setting scopes enforces it too (`workspace_api_keys_create` /
  `workspace_api_keys_set_scopes`, `20261008120000`): a level above
  `module_api_key_cap()` (what the creator can do on that module today) is
  refused, and **only the creator can widen a key**. Anyone with the API keys
  permission (`ws.api_keys`) can narrow or revoke any key. `set_scopes`
  merges (`scopes || p_scopes`), so a module missing from the payload keeps its
  level; the UI always sends all seven.
- Settings → API keys mirrors these rules to explain and disable
  ([`api-keys.ts`](../src/features/settings/api-keys.ts): `keyScopeCap`,
  `scopeCeiling`), shows what each key acts as, and what it can do today.

**Cross-module tools.** A tool appears only when the key holds its own level
on its module **and** Edit on every module in `MCP_TOOL_NEEDS`
(`@contracts/mcp-key-scopes`): Calendar's task-block tools (schedule / move /
complete / roll forward) run `tasks_op_*`, and `notes_link` runs
`links_op_create`. `links_suggest` is listed at Edit, since its RPC sits behind
the Links Edit guard. `api-keys.test.ts` re-derives the list from the module
files plus the latest SQL. Module deletes inline their registry tombstone
(`20261008121000`, like `notes_op_trash`), so Contacts, Calendar and Email
Edit don't need Links Edit. `email_op_ref_remove` checks that the *actor* (the
person, or the key's creator) can change links (`20261008122000`), so a key
never does more than its creator could.

**None means none, across modules.** Results that carry another module's data
are filtered by the key's scopes: `links_search_entities` and `links_suggest`
return only entity types the key can view (`MCP_ENTITY_TYPE_MODULES`), and
only items its creator can open; `links_list` / `contacts_get` drop links into
modules the key can't see; `calendar_day` leaves task blocks out without
Tasks View. Writes that point at another entity (`links_create`,
`comments_add`, `contacts_link`, `email_link`, `notes_link`, a note's parent)
check that entity first (`assertReach` in
[`share.ts`](../supabase/functions/moduo-mcp/share.ts)).

**Comments are Links'.** `comments_list(entity_type, entity_id, limit)` (Links:
View, MOD-94) reads an item's comments, newest last (the latest `limit`,
default 50, ≤ 200, and the `total`): `author` (a person's name, an app as
`"<key name> (app)"`), `at`, `edited`, `body`. It passes `assertReach` first,
so it needs View on the item's module too and shows only what the key's
person can open (the app's rule, `comments__item_seen`). `tasks_get` carries a
task's latest 20 only for a key with Links: View. Writing is `comments_add` /
`tasks_comment` at Links: Edit.

The secret never changes when scopes do: the connector reads `scopes` per
request, so a change applies to the key's next call (an MCP client that cached
its tool list needs a reconnect to see new tools; `listChanged` is false).

## Actor attribution (contract Pillar 2)

The connector verifies the secret, then calls Postgres as `service_role` with
an `x-moduo-key-id` header. `module_api_key_id()` trusts that header **only
under a service_role JWT** — an authenticated client sending it is ignored
(`auth.uid()` keeps precedence in `module_activity_log`), anon can't execute
ops at all, and the secret itself never reaches Postgres. Every mutation lands
in `module_activity` as `actor_type 'api_key'` with the key's id and a label
snapshot that names the person and the key, **"Alex · via Claude Desktop"**
(TV-D16, REPLAN 51/52; the key's name alone when the person has none). A call
with neither a user nor a key context fails loudly — nothing ever logs
anonymously.

`<module>_module_permission()` resolves a key call to the key's module scope
(live, unrevoked, workspace-matched, capped by the creator), so each
`<module>_op__guard`'s edit+ requirement applies to keys with **zero changes
to the ops themselves**. Rows a key creates are **owned by its creator**:
every op stamps `perm_actor_id()` (the signed-in user, or the key's creator)
into creator/owner columns, never a bare `auth.uid()`, which is NULL under a
key (`20261008123000` fixed the last six). A key's comment also records
`author_kind 'api_key'` and the key's name, so it reads as the app, never as
the person (like chat messages).

## Tools (Tasks, module #1) — v3 (TV-D16)

The surface of specs/tasks-v3.md §Assumptions #14, in
[`modules/tasks.ts`](../supabase/functions/moduo-mcp/modules/tasks.ts)
(shared reads in [`tasks-helpers.ts`](../supabase/functions/moduo-mcp/tasks-helpers.ts),
argument schemas in `_shared/contracts/mcp-tool-args.ts`). Every tool goes
through the same ops and gates as the app; the rule for all of them:

- **No tool returns what the key's person can't see.** Reads run as
  service_role, so every task and project passes `share_visible_ids` /
  `perm_can_see_entity`; a hidden task or project answers exactly like a
  missing one ("Task not found in this workspace." / "That project isn't in
  this workspace."), and nothing counts hidden items (tag usage counts only
  visible tasks; search limits after the gate).
- **Every task argument takes a handle or a uuid** (`MOD-142`, any case),
  and so does every argument that points at a task from another tool (a
  link's ends, a comment's target: `assertReach` resolves it and the op gets
  the uuid, MOD-112).
- **Descriptions are Markdown, read and written** (dogfood call #15): the
  app's editor stores Markdown; an older description (the editor's HTML) is
  answered converted (`_shared/description-markdown.ts`), and `tasks_list`'s
  280-character excerpt never ends in half a link. A reference is
  `[task](moduo://task/<uuid>)` (the kind's word, never a title; `"card"` or
  `"link"` as the link's title for how it shows), a date chip
  `[Oct 17](moduo://date/2026-10-17)`. On write (`tasks_create`,
  `tasks_update`) HTML is converted as on read, then the Markdown is read for
  references once (`descriptionTokens`, the editor's own pattern) and written
  back from that reading: a task's handle in a reference
  (`moduo://task/MOD-12`) becomes its uuid; only a reference that passes
  `assertReach` (the key's scope, live in this workspace, its person can see
  it) is written as one, and anything else (unreachable, unknown, a tag, a
  kind agents can't point at) goes back to its label as plain words; the
  words between pass through `defuseReferences`, so none reads as a reference
  later. With Links at Edit, each written reference is linked from the task
  (`links_op_create`, `mentions`, origin `mention`); without it, no link.
- **Status by category or name:** a category word (`backlog` · `todo` ·
  `in_progress` · `done` · `wont_do`; the older `archived` = won't do), the
  project's own status name, or its id (`tasks__resolve_status`).

| Read (View) | What |
| --- | --- |
| `projects_list` | projects the person sees: Inbox (`is_inbox`), status, area, colour, dates, lead, `description` (plain text, when set; TV-U16 · U13b); `include_archived` |
| `areas_list`, `sections_list`, `statuses_list`, `teams_list` | structure (a team's default project only when visible) |
| `templates_list` | own and shared task/project templates: name, kind, counts; never the body or its sources |
| `tasks_list` | paged (`limit` ≤ 200 + `offset`); filters `category` (or a legacy `status` word: `todo` leaves Backlog out), `project_id`, `section_id`, `area_id`, `team_id`, `assignee`, `completed_from/to`, `top_level`, `include_archived`. **A short row by default** (MOD-113, `fields: "summary"`): handle, id, title, `status` (category) + `status_name` when the project calls it something else, priority, assignee's name, project (when the list spans projects), section, tags, `due`, and `blocked` / `drifted` / `queued_by_me` / `subtasks` / `parent` only when they apply; names only from projects the person can see. `fields: "full"` answers the full task shape, 25 to a page unless `limit` says otherwise (summary pages default to 100) |
| `tasks_get` | one task in full: edges, subtasks, work sessions, **your** reminders, waiting on, the agent sessions you may see, with Links: View its latest 20 comments (newest last, `earlier_comments` counts the rest; none without Links), the trail |
| `tasks_search` | words (`tasks_search` RPC, gated per match), a handle, or an import key (`ENG-123`) |
| `tasks_history` | a repeat's past cycles (`tasks_op_history`) |
| `tasks_time_report` | tracked time for a period by task or day (`tasks_time_report`: your own, plus sharers' for the owner) |
| `tasks_queue`, `tasks_drift`, `tasks_list_tags`, `tasks_activity`, `tasks_attachments_list`, `tasks_list_assignees`, `tasks_focus_settings` | as before |
| `tasks_list_buckets`, `tasks_today` | **deprecated** until TV-D7 (use `projects_list`, `tasks_queue`) |

| Write (Edit) | Op |
| --- | --- |
| `tasks_create` | `tasks_op_create_with`: fields + project/section/status/assignee/team/due/estimate/repeat + tags (by name; a new one is coloured as the app colours it, MOD-93), reminders, work sessions, `imported_from {source, key}`, `import_id`; atomic; a key you already used on a live task **of yours** updates it (a re-run); an `id` that's already there answers with that task (`action: "existing"`) and writes nothing more, exactly like `tasks_op_create` |
| `tasks_update` | `tasks_op_update_with`: fields + `tags_add` / `tags_remove` |
| `tasks_set_status` | `tasks_op_set_status`; finishing a top-level, non-repeating task finishes its open subtasks the person can edit (`also_finished`, call 87) |
| `tasks_assign`, `tasks_route_team`, `tasks_claim` | `tasks_op_assign`, `tasks_op_update {team_id}`, `tasks_op_claim` |
| `tasks_handoff`, `tasks_waiting_clear` | `tasks_op_waiting_add` (a person or words), `tasks_op_waiting_remove` |
| `tasks_comment` | `comments_op_add` — only when a person asked; **needs Links: Edit too** (`MCP_TOOL_NEEDS`) |
| `tasks_session_status` | `tasks_op_agent_report` (below) |
| `tasks_reminder_add/remove`, `tasks_work_session_add/update/remove`, `tasks_move_occurrence` | the D10/D12 ops (reminders are the person's own; a session is theirs or the assignee's) |
| `projects_create/update/duplicate`, `sections_create`, `areas_create`, `templates_apply` | the D10/U6/D15 ops; `projects_create` and `projects_update` take `description` (null clears it; the ops check Edit on the project, TV-U13b); `projects_duplicate` asks `templates_can_copy` first; keys can't share, edit or delete templates |
| `imports_begin/finish/undo` | `imports_op_*` (below) |
| `tasks_queue_add/remove/reorder`, `tasks_reschedule`, `tasks_unschedule`, `tasks_skip_occurrence` | as before; `tasks_commit/uncommit/skip_today` **deprecated** until TV-D7 |

**Agent sessions** (`agent_sessions`, spec §12 / #15): `tasks_session_status`
posts the five fields — state (`working` · `needs_you` · `ready` · `failed`),
a note, step n of m, links, times — plus an optional hand-back summary. One
live session per task and key; `working` after `ready`/`failed` starts a new
run. A session is **private to its person** (RLS `agent_sessions__shown`)
unless they turn on "Show my agent work to teammates"
(`user_preferences.show_agent_work`, Settings → Preferences → Agents); the
summary is theirs alone (`agent_session_summaries`) until they post it as a
comment. `needs_you` / `ready` / `failed` notify the person once (a bell
notice on their own Inbox, op `tasks.agent_status`, gated to people who can
see the task; an OS/browser notice, delivery kind `agent`, muted with the
"Your agents" switch); a `Waiting on` this agent clears. A revoked key
stops its sessions ("Stopped (key revoked)"). No trail row: the trail
already has every write.

**Imports** (#20): `imports_begin` → `projects_create` / `sections_create`
/ `tasks_create` with `import_id` and `imported_from` → `imports_finish`.
A re-run is a new run whose tasks update by key. `imports_undo` sends what
the run made and nobody touched since (a task: any activity on it after the
run wrote it; a section or project: any change after the run's last write)
to Recently deleted — tasks, then its empty sections and projects (a project
with a section left stays); rows it only updated stay. Runs are their
person's only; finishing or undoing one needs Tasks edit.
`imported_from` is unique per (workspace, person) among live tasks.

Deliberately **not** exposed: `tasks.catch_up` (app-lifecycle batch pass),
Focus runs (a signed-in person's), template share/edit/delete, hard deletes.

The local end-to-end check is `bun scripts/mcp-import-roundtrip.ts` (with
`bun run local:functions` serving the connector): a Todoist-shaped import,
its re-run, Undo, a session and a cascade, in a disposable workspace.

## Tools (Notes, module #5) — NR-6

In [`modules/notes.ts`](../supabase/functions/moduo-mcp/modules/notes.ts), the
connector-side mirror of `src/features/notes/ops-manifest.ts`. Key scope:
`scopes->>'notes'`.

| Tool | Access | Does |
| --- | --- | --- |
| `notes_list` | view | The note tree: id, title, parent, icon, published flag (trashed excluded). |
| `notes_get` | view | One note as markdown (`body_md`) plus its meta. |
| `notes_search` | view | Full-text search over titles and bodies, with a snippet. |
| `notes_create` | edit | Create a note from markdown, optionally under a parent; a root note lands in the Inbox. |
| `notes_append` | edit | Append markdown to the end of a note; live, attributed, undoable. |
| `notes_update` | edit | Replace a note's body wholesale (optionally rename it); live, attributed, undoable. |
| `notes_move` | edit | Reparent a note and its subtree, or move it to the root; cycle-guarded. |
| `notes_archive` | edit | Archive a note and its subtree (reversible). |
| `notes_trash` | edit | Move a note and its subtree to the Trash (30-day purge). |
| `notes_link` | edit | Link a note to another entity (idempotent; the key also needs Links: Edit). |

Writes are real CRDT changes: the connector rebuilds the note's Yjs doc,
applies the edit through the app's headless editor (the prebuilt
`_shared/notes-doc/notes-doc.bundle.js`) and pushes the update through
`notes_op_apply_updates`. The server stamps the row `origin = 'api_key'` with
`actor_key_id` from the calling key and logs `notes.agent_edit`; open editors
pull it (the `note_updates` commit trigger, NR-7) and offer Undo. Run
`bun run build:notes-doc` whenever the notes editor schema changes.

## Tools (Chat, module #7) — v2 (CV-21)

In [`modules/chat.ts`](../supabase/functions/moduo-mcp/modules/chat.ts), the
connector-side mirror of `src/features/chat/ops-manifest.ts` (specs/chat-v2.md
§14). Every tool is one RPC; none reads a chat table itself.

- **Its own key scope:** `scopes->>'chat'`, none by default.
- **A key acts as its creator** ("Alex · via CI key"), inside the key's rules,
  which the database applies (`chat__key_actor`, `chat__key_reads_channel`):
  channels only, public ones, and private ones only with the key's "Include
  private channels I'm in" switch while its creator is a member. Direct
  messages never.
- **The private-chat switch** is `workspace_api_keys.include_private_chat`
  (off by default), set through `workspace_api_keys_set_private_chat(key, on)`:
  only the key's creator turns it on, any key manager turns it off.

| Read (View) | Purpose |
| --- | --- |
| `chat_list_channels` | the conversations this key can read |
| `chat_read` | a conversation's messages, oldest first, or one reply chain (`chain_id`); pages back with `before` |
| `chat_search` | messages in readable conversations, newest first; whole words and their beginnings, Polish without diacritics too |
| `chat_addressed_to_me` | what's waiting for the key's creator in Catch up (mentions, chain replies, announcements), never direct messages |

| Write (Edit) | Purpose |
| --- | --- |
| `chat_post` | post as the key's creator, Markdown, `<@USER_ID>` and `<!channel>`; 30 posts a minute per key |
| `chat_reply` | reply to a message; the reply joins its chain |
| `chat_react` | add or take back the creator's reaction (emoji or `:name:`) |
| `chat_mark_decision` | mark or unmark a message as a decision |
| `chat_wrap_up` | wrap up a reply chain with the reply that settled it |
| `chat_create_channel` | create a channel as the creator (private only with the switch on) |

## Tools (other modules) — the code is the source of truth

Short lists; each tool's description and arguments live in its module file
under [`modules/`](../supabase/functions/moduo-mcp/modules/).

| Module | View | Edit |
| --- | --- | --- |
| Calendar (`calendar.ts`) | `calendar_list_events`, `calendar_day` | `calendar_create_event`, `calendar_update_event`, `calendar_delete_event`, `calendar_schedule_task`, `calendar_move_block`, `calendar_complete_block`, `calendar_roll_forward` |
| Contacts (`contacts.ts`) | `contacts_list`, `contacts_get`, `contacts_search` | `contacts_create`, `contacts_update`, `contacts_set_status`, `contacts_link`, `contacts_unlink`, `contacts_delete`, `contacts_import` |
| Email (`email.ts`, tissue threads, metadata only) | `email_list`, `email_get`, `email_search` | `email_snooze`, `email_unsnooze`, `email_follow_up`, `email_clear_follow_up`, `email_link`, `email_remove` |
| Links (`links.ts`) | `links_search_entities`, `links_list`, `comments_list` | `links_suggest` (Edit: suggestions exist to be accepted), `links_create`, `links_set_kind`, `links_delete`, `comments_add` |

`comments_list` (MOD-94) reads an item's comments, newest last; it needs View
on the item's own module too and shows only what the key's person can open.

## Onboard a module to MCP (the recipe)

Prereq: the module satisfies the contract (intent ops + activity + manifest —
see "A module isn't done until" in the contract doc). Then:

1. **App side** — add the module's manifest to
   [`src/lib/module-registry.ts`](../src/lib/module-registry.ts) (done already
   if the contract checklist passed).
2. **Permission lane** — the module gets PERM-1 keys (`<module>.view|create|edit|delete`
   in `perm_all_keys()`), and its `<module>_module_permission()` gets the same
   api-key branch the others have: `module_api_key_scope(ws, '<module>', '<lane>')`,
   which reads `scopes ->> '<module>'` capped by the key's creator. Ops that
   stamp a creator or owner use `perm_actor_id()`, never `auth.uid()`.
3. **Grants** — `GRANT EXECUTE … TO service_role` for the module's
   agent-meaningful `<module>_op_*` RPCs (one migration block).
4. **Connector side** — add
   `supabase/functions/moduo-mcp/modules/<module>.ts` exporting a
   `ConnectorModule` (read tools mirroring the manifest's resources, write
   tools wrapping the ops; descriptions reuse the manifest summaries
   verbatim), and register it in
   [`registry.ts`](../supabase/functions/moduo-mcp/registry.ts)'s
   `connectorModules`. Every read query MUST filter on
   `ctx.key.workspaceId` — reads run as service_role, RLS does not scope them.
5. **Scope picker** — add the module to `MCP_KEY_MODULES` (contracts) and the
   `workspace_api_key_scopes_valid()` CHECK list in a migration, and give it a
   hint in [`api-keys.ts`](../src/features/settings/api-keys.ts); Settings →
   API keys renders one None / View / Edit row per module. `api-keys.test.ts`
   fails until the lists agree with the app registry and the connector's
   modules. A tool that also needs another module goes in `MCP_TOOL_NEEDS` and
   its manifest op's `alsoNeeds`; an entity type it surfaces goes in
   `MCP_ENTITY_TYPE_MODULES`.
6. Redeploy `moduo-mcp`.

Known duplication (accepted v1): Deno can't import the app's extensionless
modules, so the connector keeps its own module files; tool descriptions are
copied from the manifests. Unify (shared `_shared/` source or codegen) when a
second module makes the duplication real.

## Deferred

- `agent` actor type (in-app agents, distinct from API keys) — CHECK-reserved
  since Session 8.
- Workspace-level activity feed UI (the connector already exposes
  `tasks_activity` without a task filter).
- Local-LLM / offline MCP — the lite version's story, explicitly out of v1.
