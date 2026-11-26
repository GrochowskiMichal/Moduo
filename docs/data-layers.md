# Moduo — Architecture & Data Layers

> **Status:** Living architecture reference. Written 2026-06-24; **rewritten 2026-11-26** against the code at v1.8.1 (249 migrations, stamps 2026-05-12 to 2026-11-22). Where this doc and the code disagree, the code wins: fix the doc.
> **Pairs with:** [architecture.md](./architecture.md) (frontend and Tauri code layout), [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) (what and why), [moduo-module-contract.md](./moduo-module-contract.md) (what a module must ship), [moduo-mcp-connector.md](./moduo-mcp-connector.md) (the connector), [moduo-architecture-vocabulary.md](./moduo-architecture-vocabulary.md) (terminology).
>
> This doc answers: **where does each kind of data live, who is the source of truth, and what shape must a new module adopt**, above all the *connective-tissue spine* that is Moduo's moat. Read it before adding a module or a data store.

---

## 0. The one rule

**Moduo is cloud-first. Supabase is the source of truth for every model.** What sits on a device is a copy that makes the app fast and usable offline, never the record. There are two deliberate exceptions:

- **Mail** lives on the device (§6). The cloud holds only a reference to a thread you acted on.
- **redb** on the desktop is a leftover (§3). Never make it load-bearing for a new feature.

A new module that cannot be expressed Supabase-first is not ready to build.

---

## 1. The two runtimes

The frontend reaches data through a runtime abstraction, so the same React feature code runs in a browser and in the desktop app.

| File | Role |
| --- | --- |
| `apps/app/src/lib/runtime.ts` | Picks the runtime (web when there is no Tauri bridge) and hands it out through `getRuntime()`, which is null before `initRuntime`. There is no `runtime` export, so a bare import fails the typecheck. |
| `apps/app/src/lib/runtime.types.ts` | The boundary: `ModuoRuntime` and the shared types. Each module's port lives in `runtime.types.<module>.ts` and is re-exported here (chat and focus keep theirs in their feature folders). |
| `apps/app/src/lib/runtime.web.ts` | The web runtime: a composition root that assembles one file per module (`runtime.web.<module>.ts`). `runtime.web.client.ts` is the one Supabase client; `runtime.db.ts` holds the typed client and `runQuery`. |
| `apps/app/src/lib/runtime.tauri.ts` | The desktop runtime, a **composite**: it reuses the web runtime for auth, workspaces, tasks, notes, chat, contacts, calendar, home, preferences, attachments and the spine, and calls Rust (`invoke`) only for the mail engine (`mail_*`), provider calendar reads (`fetchExternalEvents`), integrations, the window, the device key-value store and the legacy leftovers of §3. |

- **Only `lib/runtime*` talks to Supabase.** `lint:boundaries` (`scripts/check-boundaries.ts`) fails any other import of `@supabase/*` or of the web runtime's internals, and fails `lib` importing `features`. Thirty-one older files are listed as exceptions; the list can only shrink.
- The desktop mirrors the Supabase session into Rust (`auth_set_cloud_session`) on every auth change. It is kept in memory only; it starts and stops the mail engine for that person and lets the calendar, integration and mail commands know who is signed in.

```
        Browser                                 Desktop (Tauri window)
           │                                           │
     runtime.web.ts                             runtime.tauri.ts
           │                                     │              │
           ▼                                     ▼              ▼
   ┌────────────────┐                  ┌────────────────┐ ┌──────────────────────┐
   │    Supabase    │◀─────────────────│    Supabase    │ │ Tauri invoke → Rust  │
   │ (source of     │   same client    │ (every module  │ │ mail engine (SQLite) │
   │  truth)        │                  │  but mail)     │ │ OS keychain, calendar│
   └────────────────┘                  └────────────────┘ │ provider reads, redb │
     + device copies in IndexedDB (both runtimes)         └──────────────────────┘
```

---

## 2. Where each module's data lives

Everything below is in Supabase unless the row says otherwise. "Device copy" means an IndexedDB copy the app opens from; "Live" means Realtime.

| Module | Main tables | Device copy | Live |
| --- | --- | --- | --- |
| **Accounts, workspaces** | `workspaces`, `workspace_members`, `profiles`, `workspace_invites`, `waitlist` | the workspace list is remembered | — |
| **Permissions and sharing** | `workspace_roles`, `resource_grants`, `workspace_share_defaults`, `teams`, `team_members`, `access_changes` | — | access changes |
| **Tasks** | `tasks`, `buckets` (projects; the table keeps its old name), `areas`, `sections`, `project_statuses`, `tags`, `tag_links`, `task_relations`, `task_queue`, `focus_runs`, `task_sessions`, `task_time_entries`, `task_reminders`, `task_waiting`, `task_completions`, `task_templates`, `project_templates`, `task_views`, `imports`, `agent_sessions` | yes (`moduo-sync`, 19 tables) | yes |
| **Notes** | `notes` (metadata, publish token), `note_bodies` (document state, text, Markdown, search vector), `note_updates` (the Yjs log), `note_favorites`, `note_live_viewers` | yes (`moduo-notes-v2` and one Yjs database per note) | a private "changed" topic per person |
| **Chat** | `chat_channels`, `chat_members`, `chat_messages`, `chat_catchup`, `chat_custom_emoji`, `user_statuses` | yes (`moduo-chat`) | yes, plus typing and presence |
| **Contacts** | `contacts`, `companies`, `contact_groups`, `contact_field_defs`, `contact_private_notes` | — | — |
| **Calendar** | `calendar_accounts`, `calendars`, `calendar_events` (provider events are mirrored in), `calendar_sets`, `exposed_slot_links`, `slot_bookings`, `slot_offers`, `user_integrations` | — | events |
| **Email** | on the device: one SQLite store per person (§6). In Supabase: `email_refs`, `email_settings_items` | the mail itself | — |
| **Comments** | `comments`, `comment_reactions` (any entity) | — | — |
| **Attachments** | `attachments`, `storage_usage`; buckets `attachments`, `avatars`, `chat-emoji` | an upload queue (`moduo-uploads`) | — |
| **Activity and notifications** | `module_activity`, `notification_state`, `notice_deliveries`, `push_subscriptions` | — | notice deliveries |
| **Home** | `dashboard_layouts`, `habits`; widgets read the other modules | the layout is cached | — |
| **Preferences** | `user_preferences` | mirrored in localStorage | — |
| **Connector access** | `workspace_api_keys` (keys and sign-in connections share the table) | — | — |
| **Billing** | the Stripe Sync Engine's `stripe.*` mirror, plan columns on `profiles`, the `user_entitlements` view, `founder_emails` | — | — |
| **Search** | the `entities` registry and its label indexes, `search_recents` | — | — |
| **Transactional email** (Moduo's own emails) | `email_outbox`, `email_suppressions`, `email_subscriptions` | — | — |

Not in the product, still in the repository: **Mindmap** (removed from the product on 2026-10-21) keeps its data on the device only and its route is still registered. **Finance** was never built.

The generated type file `apps/app/src/types/supabase.ts` is cut from production and can lag behind the newest migrations.

---

## 3. What lives on a device

**In the browser and in the desktop window (IndexedDB and localStorage):**

- `moduo-sync`: the Tasks copy, one record per person and workspace.
- `moduo-chat`: the chat sidebar and each conversation's newest messages.
- `moduo-notes-v2`: the notes list, the per-note sync state and two outboxes; plus one Yjs database per open note.
- `moduo-uploads`: files waiting to upload.
- localStorage: preferences mirrors, the last route, the selected workspace, the Supabase session.

All of these are keyed by person. Code that removes a person's copies finds them by record, never only through `indexedDB.databases()`.

**Only in the desktop app:**

- The mail store (§6) and its files.
- The **OS keychain**: mail credentials, calendar tokens, CalDAV and ICS credentials, integration tokens.
- **redb** (`moduo_desktop.redb`), a leftover from before the cloud move. It still backs the device key-value store (`localStore`), which holds the mindmaps, a cache of the Home layout and the avatar preview, and it holds the old notes that the one-time import reads. The legacy time-tracking commands (`tt_*`) are still registered and have no caller in the app. The redb-to-Supabase sync worker compiles only under the `lite` feature and is off in every build we ship. Do not extend any of it.

---

## 4. The module contract (every module follows this)

Defined in [moduo-module-contract.md](./moduo-module-contract.md). A module is **not done** until it has:

1. **Intent ops**: named, invariant-keeping changes as server-side functions (`<module>_op_*`), checked for permission and logged in one transaction.
2. **Actor attribution**: every op records who did it. `perm_actor_id()` is the signed-in person, or the creator of the key the connector is using; activity reads "Person · via KeyName" for a key.
3. **Activity**: every op appends to `module_activity`.
4. **Search**: a `<module>__search` function that `search_all` calls.
5. **Connector tools and a Home widget** (the product's rule, see [agents/tooling.md](./agents/tooling.md)).

**Where the code falls short of the contract today:**

- The connector does not read the app's module registry (`lib/module-registry.ts`, used only by tests). It keeps its own hand-written list in `supabase/functions/moduo-mcp/registry.ts` and `modules/*.ts`, a known duplication.
- Not every write is an op. Some functions have other names (API keys, booking hosts, calendar sets, contact merge and groups), and the client still writes a few tables directly: tags and tag links, task relations, projects, workspaces and invites, profiles, preferences, Home layouts and habits, booking links. Task changes all go through `tasks_op_*`.
- `perm_enforce_write`, a trigger on twelve tables, is what keeps a direct write inside the caller's permissions.

---

## 5. The connective-tissue spine (built)

Moduo's differentiation is **not** any single module; it is the layer that lets *any entity link to any other*. Every system here is Supabase-first and addresses an entity by `(entity_type, entity_id)`.

| # | System | How it works today |
| --- | --- | --- |
| 1 | **Entities and links** | `entities` is a lean registry (workspace, type, id, label, icon, handle). `entity_links` joins two registry rows with a typed `relation_kind` (references, spawned-from, blocks, attachment, mentions, works-at, follow-up, paid-by, conversation-of) and an origin (manual, drag, mention, ref, suggest); both ends cascade when a registry row is purged, and a soft delete only tombstones it. Ops: `links_op_create`, `_set_kind`, `_delete`; a link needs Edit on one end. Client: `lib/entity-links.ts`. |
| 2 | **Suggestions** | `links_suggest` proposes links from shared tags, email domains and time windows; a decline is remembered in `link_suggestion_declines`. |
| 3 | **Attachments** | `attachments` rows plus Storage, through begin → upload → finalize ops, with a pool per workspace owner (`storage_usage`) sized by plan and a 30-day trash. **Not yet "any entity":** only tasks and chat messages accept files. |
| 4 | **Drag payload** | One contract, `lib/drag-payload.ts`: any entity can be dragged onto a target that declares what it takes. Used by Tasks, Calendar, Notes and Contacts. |
| 5 | **Tags** | `tags` and `tag_links`; `entity_type` is an open string. |
| 6 | **Comments and @mentions** | `comments` on any registered entity (notes can anchor one to a passage), with reactions and resolve. The `@` picker sends people's ids; the server keeps only the people who can see the item. |
| 7 | **Activity** | `module_activity`, append-only, attributed to a person or to a key. |
| 8 | **Notifications** | Not rows of their own: a notification is an activity row that names you, listed by `notifications_list`, with read and dismissed state in `notification_state`. Assignments from one person within an hour merge into one row. Devices are reached through `notice_deliveries`: Realtime in an open app, Web Push through `push-send`. The only notification-like email is chat's "waiting for you". |
| 9 | **Permissions and sharing** | Roles (`workspace_roles`: admin, member, viewer and custom) hold `<module>.view/create/edit/delete` keys, with personal overrides; the owner can do everything. `resource_grants` shares one item with a member, the workspace or a public link, and grants inherit (sub-note → note, task → project, contact → group). `can_access` answers with the lower of the item's grant and the role's ceiling; a private item is its creator's alone. Teams route work; they are not permission subjects. |
| 10 | **Search** | `search_all` merges each module's search function over tasks, projects, notes, contacts, companies, events and linked mail threads, under the caller's own access. Chat has its own `chat_search`. |
| 11 | **Connector exposure** | §8. |
| 12 | **Home widget** | Each module ships live widgets for the Home grid, read through one shared data context. |

**Build implication, still true:** these primitives are built once and are most of every module's real cost. A new module adopts them; it never grows its own links, comments, activity or sharing.

---

## 6. Email: mail on the device, links in the cloud

A full mail client on a cloud-first web app would mean running a server-side mail relay (sync, a token vault, a security review). We do not. Instead:

- **The client is the desktop app**, on a Rust engine (`apps/desktop/src-tauri/src/mail/`): one SQLite file per signed-in person at `<app data>/moduo/mail/<user_id>/mail.db` (WAL, FTS5, schema v2), with attachments as files beside it. Accounts: Gmail and Google Workspace (OAuth), Outlook (OAuth, with Graph send where SMTP is closed), iCloud and any IMAP server (passwords). Secrets are in the OS keychain. The engine is compiled into the Windows build too; whether mail works there has not been verified.
- **Rules, tabs, priority people, blocked senders, snippets and saved searches** follow the person through `email_settings_items` in Supabase, and are applied on the device.
- **A thread reaches Supabase only when you connect it to something**: converting it to a task, linking it, attaching it to a note, dropping it on a task or making an event from it writes one `email_refs` row (message and thread keys, sender, subject, snippet, date), readable by its owner only. That row is what lets a thread take part in `entity_links` on every client. Reading mail writes nothing, and snoozes and follow-ups stay on the device.
- **The web `/email` page is the tissue view**: only the conversations linked to a task, a note or an event, read-only, under a "Mail lives on your Mac" banner.
- **The connector sees the same references**, never a message body and never send: it can list, search, link, snooze and set a follow-up on a thread you already linked.
- **Deleting an account** stops the engine, removes that person's keychain secrets and deletes the mail store from the device.
- A full web mail client is a later decision, to be made when it is proven to matter to customers.

```
  Desktop only                                    Every client (web + desktop)
  ┌───────────────────────────┐                   ┌────────────────────────────┐
  │ Rust mail engine (SQLite)  │  a reference,     │ Supabase: email_refs        │
  │  bodies, search, folders,  │  when you link    │  (ids, sender, subject,     │
  │  flags, send, snooze       │ ────────────────▶ │   snippet, date)            │
  └───────────────────────────┘                   │  ↕ entity_links             │
        the mail client                            │  → task / contact / note    │
                                                   └────────────────────────────┘
```

**Moduo's own emails are a separate system.** Emails Moduo sends to people are queued in `email_outbox` and sent by the `email-worker` function through Resend, with retries and a suppression list; sign-in codes are sent directly by the auth hook.

---

## 7. Sync, offline and real time

**One kernel on the client** (`apps/app/src/lib/sync/kernel/`): a device copy in IndexedDB, delta reads by server stamp, an outbox, write overlays, and Realtime as a *latency layer* that may only land a row newer than the one held. Realtime is never the source of truth.

| Module | On the kernel | Works offline |
| --- | --- | --- |
| **Tasks** | fully (`lib/sync/store.ts`) | opens from the device copy; captures and check-offs queue; other edits say "Offline" |
| **Chat** | its pieces, with its own message windows | the sidebar and each conversation's newest messages; sends queue and can be retried |
| **Notes** | shares the storage helpers only | each note's document and its edits persist and replay; create, rename and move queue in order |
| **Home** | — | the layout and the task widgets |
| **Calendar, Contacts** | — | no: nothing is kept on the device, and offline calendar writes are not built |

TanStack DB mirrors the kernel's tables into in-memory collections, but nothing in the app reads through them yet; moving writes, Chat and the other modules onto collections is paused (see `bun run docs:find data tanstack`).

**Notes are edited together.** A note is a Yjs document: the server keeps an update log (`note_updates`) and a folded state (`note_bodies`). An edit is pushed as an update within about a second; the server then sends each viewer a content-free "this note changed" message on their private topic, and the client pulls. Presence is a heartbeat that returns who is viewing. The client folds the log after 40 updates and a nightly job folds idle notes. **There are no live cursors**, on purpose.

**Realtime rules.** Clients broadcast nothing: the server writes who did what from the session, so never trust a sender named in a message, and never put content in one. Tasks, chat, calendar events and notice deliveries arrive over row changes; chat typing, chat presence and the notes signal use private topics.

**Calendars from outside** are pulled by the client, on opening the calendar, on waking the tab and every 15 minutes; there is no server-side job. On the web, Google and Outlook are read through Edge Functions with a stored refresh token; the desktop app also reads CalDAV and ICS through Rust. Events are mirrored into `calendar_events`. **Only Google is two-way**; Outlook, CalDAV and ICS are read-only.

**Posture.** People in a workspace see each other's changes live in Tasks, Chat, Calendar and Notes. Coordination *on the work* stays asynchronous by design: comments, @mentions and quiet notifications.

---

## 8. The connector (AI access)

- AI reaches Moduo **only from outside**: there is no built-in model, no embeddings, and search is Postgres full-text.
- `supabase/functions/moduo-mcp/` is a stateless HTTP MCP endpoint, published at `https://mcp.moduo.app` through a forwarding Worker (`infra/mcp-proxy`). It has 114 tools (40 that read, 74 that change) across tasks, calendar, contacts, notes, chat, email, links and search, and it calls the same ops the app does.
- **Access** is a row in `workspace_api_keys`: a key (shown once, stored as a hash, at most 20 live per workspace, optional expiry) or a connection made by signing in (Supabase OAuth 2.1, with a consent screen). Each carries none, view or edit per module, acts as its creator and can never do more than its creator can.
- Everything it does is attributed ("Person · via KeyName") in activity, on tasks, in chat and in notes, where an agent's edit is a real Yjs update that can be undone.

---

## 9. Rules for new work

1. **Supabase-first.** Tables, RLS and intent ops before any UI.
2. **Adopt the spine.** Register the entity; use `entity_links`, tags, comments, activity, notifications and the sharing model. Do not grow a parallel one.
3. **Follow the module contract** (§4): ops, attribution, activity, a search function, connector tools, a Home widget.
4. **Go through the runtime.** Feature code calls `getRuntime()`; only `lib/runtime*` imports Supabase.
5. **A device copy is a copy.** Put it on the sync kernel, key it by person, and let Realtime only speed it up.
6. **redb is frozen.** Nothing new reads or writes it.

---

## 10. Settled questions and known leftovers

**Settled** (they were open when this doc was first written):

- **`entity_links` shape**: one table, typed by `relation_kind`.
- **Polymorphic integrity**: a central `entities` registry that links, comments and search key into.
- **Notes and Postgres**: a Yjs update log plus a folded state, with text and Markdown derived for search, export and the connector.
- **The drag contract**: `lib/drag-payload.ts`.

**Leftovers to clear**, none of them urgent:

- The projects table is still named `buckets`, and `task_relations` is mirrored into `entity_links` by a trigger instead of being replaced by it.
- Attachments accept only tasks and chat messages.
- The connector's tool list duplicates the app's module manifests.
- Direct client writes and non-`_op_` functions listed in §4.
- Mindmap code and its device-only data; the legacy redb tables and `tt_*` commands; cloud snooze and follow-up columns on `email_refs` that only the connector writes; an `email_accounts` table nothing writes; a `workspace_notifications` table that is read and never written.
- Offline for Calendar and Contacts.
