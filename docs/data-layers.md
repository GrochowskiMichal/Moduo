# Moduo — Architecture & Data Layers

> **Status:** Living architecture reference. Written 2026-06-24 alongside the alpha planning round.
> **Pairs with:** [architecture.md](./architecture.md) (frontend / Tauri code layout), [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) (what & why), [ROADMAP.md](./ROADMAP.md) (build sequence), [moduo-module-contract.md](./moduo-module-contract.md) (per-module AI-readiness contract), [moduo-architecture-vocabulary.md](./moduo-architecture-vocabulary.md) (terminology).
>
> This doc answers: **where does each kind of data live, who is the source of truth, and what is the target shape every new module must adopt** — especially the *connective-tissue spine* that is Moduo's actual moat. Read it before adding a new module or a new data store.

> ### ⚠ STATUS UPDATE (2026-07-11) — read this before the tables below
> This doc was written 2026-06-24 for its **intent and philosophy**, which still hold. Its per-module **status** is now ~4 waves stale — where it disagrees with the code, the code wins. What actually shipped since:
> - **~35 migrations** (not ~16); **7+ modules are cloud-first**, not just Tasks.
> - **The spine is built**, not a "TARGET": central `entities` registry + typed `entity_links` + comments/activity/notifications/suggestions (migrations `20260625…`–`20260627…`).
> - **Notes is cloud-synced + collaboratively editable** (Yjs↔Postgres + one Realtime latency layer), *not* single-player redb.
> - **Contacts, Calendar, Email** are all built (Email = desktop engine + lightweight cloud `email_refs` tissue).
> - **The MCP connector exposes 6 modules (~60 tools)**, not "Tasks only."
> For current status see [`onboarding/HANDOFF.md`](./onboarding/HANDOFF.md) and the live ledger [`specs/BUILD_ORDER.md`](../specs/BUILD_ORDER.md).

---

## 0. The one rule

**Moduo is cloud-first. Supabase is the source of truth for every new model.** redb (desktop) is paused — kept only for the future offline/"lite" version and for the not-yet-migrated legacy modules. Never make redb load-bearing for a new feature. A new module that cannot be expressed Supabase-first is not ready to build.

---

## 1. The two runtimes

The frontend talks to data through a runtime abstraction, so the *same* React feature code runs on web and desktop.

| File | Role |
| --- | --- |
| `src/lib/runtime.types.ts` | The abstraction boundary — `RuntimeSession`, `RuntimeCapabilities`, `WorkspaceApiKey`. |
| `src/lib/runtime.web.ts` | Web runtime — a direct Supabase client. Cloud-only, no offline. |
| `src/lib/runtime.tauri.ts` | Desktop runtime — **composite**: reuses `runtime.web` for auth/workspaces/tasks, and Tauri `invoke` for the legacy redb-backed modules (notes, email, calendar, time-tracking, graph). |

- Desktop mirrors the Supabase session into Rust `AppState` via the `auth_set_cloud_session` command, so Rust-side code can attribute actions to the signed-in user.
- **Footgun (see memory):** never import a bare `{ runtime }`; always resolve via `getRuntime()`. Grep `./runtime` when auditing lib exports.

```
            Web browser                         Desktop (Tauri window)
                │                                        │
        runtime.web.ts                          runtime.tauri.ts
                │                                   │        │
                ▼                                   ▼        ▼
        ┌───────────────┐                  ┌───────────────┐ ┌──────────────┐
        │   Supabase    │◀─────────────────│   Supabase    │ │ Tauri invoke │
        │ (source of    │   same client     │ (auth/wksp/   │ │  → Rust →    │
        │  truth)       │                   │  tasks)       │ │  redb (local)│
        └───────────────┘                  └───────────────┘ └──────────────┘
```

---

## 2. Data layers today (per module, honest state)

| Module | Backing today | Source of truth | Cross-device / multiplayer | Maturity |
| --- | --- | --- | --- | --- |
| Auth, Workspaces, Members, Profiles | **Supabase** | Supabase | Yes | ✅ prod |
| **Tasks** (buckets, tasks, tags, tag_links, relations, time_blocks, activity) | **Supabase** | Supabase | Yes | ✅ 5/5 prod |
| User preferences (appearance, focus) | **Supabase** (`user_preferences`) | Supabase | Yes | ✅ prod |
| MCP connector keys | **Supabase** (`workspace_api_keys`) | Supabase | Yes | ✅ prod |
| **Notes** | redb (desktop) + Yjs CRDT; web = localStorage fallback | redb (local) | **No** (single-player) | 🟡 4/5, rebuild planned |
| **Email** | redb + in-memory cache; Rust IMAP/SMTP engine | redb (local) | No | 🟡 desktop-only, 2/5 |
| **Calendar** | localStorage + OAuth tokens | local | No | 🟡 logic only, no UI |
| **Time-tracking** | redb | local | No | 🟡 Rust backend, no UI |
| **Mindmap** | localStorage | local | No | 🟡 3/5, exploratory |
| Dashboard widgets | mostly stateless / demo | n/a | No | 🟡 prototype (`/grid` to be replaced) |
| **Contacts / Finance** | — | — | — | ⚫ not built |

**Takeaway:** only Tasks (+ the account/workspace/prefs platform) is genuinely cloud-first today. Everything else is a local-first island or a shell. The alpha plan moves every kept module onto the Supabase-first pattern below.

---

## 3. The Supabase schema today (Tasks module)

Migrations live in `supabase/migrations/` (~16 files as of 2026-06-16). The load-bearing ones:

| Migration | Adds |
| --- | --- |
| `…_create_tasks_module.sql` | `buckets`, `tasks`, `tags`, `tag_links` |
| `…_buckets_add_group.sql` | `buckets.group_label` (rail sections) |
| `…_tasks_add_parent.sql` | `tasks.parent_id` + depth-1 trigger (subtasks) |
| `…_task_relations.sql` | `task_relations` (blocked-by edges; cycle-forbidding trigger) |
| `…_module_activity_intent_ops.sql` | `module_activity` + the `tasks_op_*` RPCs |
| `…_workspace_api_keys_mcp.sql` | `workspace_api_keys` (scoped MCP keys) |
| `…_tasks_add_time_spent.sql` | `tasks.time_spent_minutes` |
| `…_user_preferences.sql` | `user_preferences` (cloud prefs sync) |

Two patterns here are **reused by the whole product**, not just Tasks:

- **`tag_links`** is already **polymorphic** (`entity_type` ∈ {task, note, email, …}) — the seed of the spine's universal tagging.
- **`module_activity`** is an append-only, actor-attributed activity trail — the seed of the spine's activity feed *and* notifications.

---

## 4. The module contract (every module follows this)

Defined in `moduo-module-contract.md`; the typed shape is in `src/lib/module-manifest.ts` and the registry in `src/lib/module-registry.ts`. A module is **not done** until it implements all four pillars:

1. **Intent ops** — named, invariant-keeping mutations as server-side RPCs (Tasks: `tasks_op_commit`, `_reschedule`, `_set_status`, …). Permissions-checked + activity-logged in one transaction. No raw table writes from the client for state-changing actions.
2. **Actor attribution** — every op records who did it (user or API key/agent).
3. **Activity** — every op appends to `module_activity`.
4. **Registration** — the module contributes a `ModuleManifest` (read resources + write ops) to `module-registry.ts`, which is what the MCP connector exposes.

This contract is the reason new modules get AI access, activity trails, and notifications nearly for free — they ride the existing pattern.

---

## 5. The connective-tissue spine (TARGET — the actual moat)

Moduo's differentiation is **not** any single module; it is the layer that lets *any entity link/attach/relate to any other*. This spine is ~10 cross-cutting systems. Each must be **Supabase-first** and **polymorphic** (addressing entities by `(entity_type, entity_id)`), so every current and future module participates without bespoke wiring.

| # | Spine system | Today | Target shape |
| --- | --- | --- | --- |
| 1 | **Links** (entity↔entity) | only `task_relations` (task↔task), notes relations | **New `entity_links` table**: polymorphic both ends, typed (`relation_kind`), workspace-scoped. THE keystone. |
| 2 | **Attachments** | none unified | Files/emails/payments/notes attachable to anything — either folded into `entity_links` (kind=`attachment`) or a sibling `attachments` table. |
| 3 | **Drag payload** | per-feature DnD (`tasks/ui/dnd`) | **One drag-payload contract**: any entity can be dragged onto any drop target that declares what it consumes (task→calendar, email→task, payment→contact). UI architecture, not per-feature. |
| 4 | **Tags** | `tag_links` (polymorphic ✅) | Already cross-module; extend `entity_type` coverage as modules land. |
| 5 | **Comments + @mentions** | none | Polymorphic `comments` on any entity; mentions resolve to workspace members. |
| 6 | **Notifications** | none | Rides `module_activity`: a notification = an activity event that mentions/assigns *you*, with read-state + a deep-link to the target entity. |
| 7 | **Activity trail** | `module_activity` ✅ | Generalize beyond Tasks as each module ships intent ops. |
| 8 | **Permissions / sharing** | workspace + members + RLS ✅ (Tasks) | Same model for every new module (shared-workspace async multiplayer — see §7). |
| 9 | **MCP exposure** | Tasks only (8 read + 7 write) | Each module ships its read/write tools to `module-registry.ts`. |
| 10 | **Dashboard widget** | prototype only | Each module ships a live, interactive widget against the dashboard contract (see PRODUCT_BRIEF / dashboard brief). |

**Build implication:** the spine primitives (esp. `entity_links` + the drag contract + comments/notifications) are built **once**, alongside the *second* real module — they are ~60% of every module's true cost. Retrofitting them into 5 finished modules costs far more than designing them once and having modules 2–N adopt them. Tasks (done) is the first link consumer; **Contacts** — which is almost pure spine (a hub that rolls up linked work) — is the ideal second module and the architecture's proof.

---

## 6. Email — desktop-first hybrid data flow (alpha decision)

A full multi-account Spark replacement on a cloud-first web app would mean building/operating a server-side mail relay (IMAP/SMTP sync, OAuth app verification, token vault, security review). **At alpha we do not.** Instead:

- The **full client lives on desktop**, on the existing Rust engine (`src-tauri/src/commands/email.rs` + `email/` submodules) → redb cache. This replaces Spark for the founder *now*.
- **Lightweight message metadata** (message id, thread id, account, from, subject, date, snippet) is synced to Supabase so an email can participate in `entity_links` (email↔task, email↔contact) on **every** client — even though the body/management stays desktop.
- The full **web** email client is a post-alpha decision, made once it's proven to matter to customers (not just to us).

```
  Desktop only                                  All clients (web + desktop)
  ┌──────────────────────────┐                  ┌───────────────────────────┐
  │ Rust IMAP/SMTP engine     │  metadata only   │ Supabase: email_refs       │
  │  → redb (full bodies,     │ ───────────────▶ │  (id, thread, from, subj,  │
  │     folders, flags, send) │                  │   date, account)           │
  └──────────────────────────┘                  │  ↕ entity_links            │
        full client UX                           │  → task / contact / note   │
                                                 └───────────────────────────┘
```

---

## 7. Multiplayer & sync posture (alpha decision)

- **Shared-workspace *async* multiplayer**, NOT real-time collaborative editing. Built on Supabase RLS + `workspace_members`; changes appear on refresh/poll. Enough to build Moduo with a partner. No live cursors / simultaneous block-editing at alpha (that is the expensive trap).
- Consequence: **every new module is Supabase-first**, and **Notes must move to Supabase** (cloud-sync) — notes are the one kept module still local-CRDT, and shared design notes require it. The Notes rebuild is where this lands.
- In-app chat is **out of scope** (keep Slack). Coordination = comments + @mentions + notifications on entities.

---

## 8. AI / MCP access layer

- AI is **MCP-only — no built-in model.** The app is *accessible by* external agents (primarily Claude Code / Claude) for reading, editing, and writing across modules.
- Edge function `supabase/functions/moduo-mcp/` is a stateless HTTP MCP endpoint; auth via scoped `workspace_api_keys` (none/view/edit per module); calls the same intent-op RPCs as `service_role`.
- Each new module extends the connector by registering its manifest — additive, no re-architecture.

---

## 9. Migration posture & rules for new work

1. **Supabase-first.** New tables, RLS, and intent-op RPCs before any UI.
2. **Adopt the spine.** New entities are addressable by `(entity_type, entity_id)`; wire into `entity_links`, tags, comments, activity/notifications, permissions.
3. **Follow the module contract** (intent ops + attribution + activity + manifest).
4. **Ship the MCP tools and the dashboard widget** as part of definition-of-done.
5. **redb is paused.** Don't extend it for new features; legacy modules migrate to Supabase as they're rebuilt. It survives only for the future offline/lite version.

---

## Open architectural questions

These are tracked in the alpha **Open Questions & Risks** doc; the load-bearing ones for this doc:

- **`entity_links` shape** — one universal table with a `relation_kind` enum, vs. separate `links`/`attachments` tables. (Rec: one table, typed.)
- **Polymorphic integrity** — how to keep `(entity_type, entity_id)` referentially sane without per-type FKs (trigger validation vs. partial indexes vs. a central `entities` registry table). **(Resolved 2026-06-24, revised same day after the design-brief pass: a lean central `entities` registry — upserted per intent op; `entity_links`/`comments`/`tag_links` FK into it. Makes search / @mention / roll-up one indexed query and gives clean cascade-on-delete. Authoritative spec: [.design/connective-tissue/DESIGN_BRIEF.md](../.design/connective-tissue/DESIGN_BRIEF.md).)**
- **Notes CRDT ↔ Postgres** — how Yjs state reconciles with Supabase for cloud-sync (store the Yjs doc as a blob + derived searchable fields, vs. shred to rows).
- **Drag-payload contract** — the TypeScript shape for "any entity → any drop target" and where it lives (`src/lib/`).

*Resolve these before the spine is built; they are cheap now and expensive to retrofit.*
