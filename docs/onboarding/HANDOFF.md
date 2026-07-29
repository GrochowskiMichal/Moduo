# Moduo — Handoff / Progress Summary

**Audience:** Mike, picking the project back up.
**Written:** 2026-07-11.
**Purpose:** everything that shipped since you were last deep in this, module by module, plus the frontend/backend state, the decisions behind them, and the future backlog — so you can pick it up without re-deriving it from the code.

> This doc is a **map**, not a replacement for the source-of-truth docs. Where it points you at `docs/…`, read that — it's more detailed and kept current per-block. There is a companion memo, [backend-refactor-memo.md](./backend-refactor-memo.md), specifically for the "should we change the backend?" question.

---

## 0. Read-these-first (in order)

1. [`docs/PRODUCT_BRIEF.md`](../PRODUCT_BRIEF.md) — what Moduo is and the "spine is the moat" thesis.
2. [`docs/ROADMAP.md`](../ROADMAP.md) — waves, scored backlog, open questions/risks.
3. [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md) — **the live status ledger.** What's done, what's next.
4. [`docs/architecture.md`](../architecture.md) + [`docs/moduo-module-contract.md`](../moduo-module-contract.md) — code layout + how a module is built (the 4-pillar contract).
5. [`docs/data-layers.md`](../data-layers.md) + [`docs/moduo-architecture-vocabulary.md`](../moduo-architecture-vocabulary.md) — the two-runtime data model, the spine, the vocabulary. **⚠ its status table is ~4 waves stale — read it for the *why*, not current status (see §9).**
6. [`CONTRIBUTING.md`](../../CONTRIBUTING.md) + [`docs/gotchas.md`](../gotchas.md) — branching model + the footguns that will bite you.
7. [`DESIGN_SYSTEM.md`](../../DESIGN_SYSTEM.md) / [`DESIGN_RULES.md`](../../DESIGN_RULES.md) — the token system and its hard rules.

---

## 1. The 60-second summary

Moduo went from a **Tasks-only app** to a **full-suite private alpha**: Tasks, Contacts, Calendar, Notes, Email, a Dashboard/Home surface, and — the point of the whole thing — a **connective-tissue "spine"** that links any entity to any other across modules. All of it is **cloud-first on Supabase** (source of truth), with the desktop Tauri/Rust app reduced to a thin Supabase client plus a native "sidecar" for the things that genuinely need the machine (the email IMAP/SMTP engine, OAuth calendar sync, time-tracking).

Roughly **eight feature waves** landed since you were last involved. Everything numbered (Waves 0–3, Email, Timeline, Dashboard) is **shipped**. The only remaining pre-alpha work is a **cross-cutting polish + dogfood-fix wave ("DF")** and one connector-hardening block (MCP-1) — not new modules. Details in §10.

---

## 2. What changed since you last touched it (the delta)

Framed by **feature wave**, newest-first. Each is fully shipped unless noted. (Per-wave detail: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md); rationale: [`docs/decisions.md`](../decisions.md).)

| Wave | What landed | Blocks |
|---|---|---|
| **DF — Dogfood fixes** (in progress) | Whole-app UX/cohesion punch-list from a 2026-07 critique. Deep-links, one app-wide undo grammar, trial/billing fix, email daily-use pack, Notes editor baseline, Mindmap hidden from nav. | DF-1,3,4,5,6,13,14 ✅ · **16 open** (see §10) |
| **Dashboard / Home (Wave 6)** | `/` is now an iPadOS-style live **widget grid** (8×4 bounded engine, drag, multi-page, persistence) + a widget **registry** with 16 widgets + a gallery. Old dashboard module deleted and re-ported. | DB-1…DB-8 ✅ |
| **Email (Wave 5)** | Desktop-first **Spark replacement**: Rust IMAP/SMTP engine, Gmail OAuth, threading, triage, snooze/follow-ups, compose/attachments, convert-email→task, hybrid search, smart inbox. Only lightweight **metadata** (`email_refs`) syncs to the cloud — the inbox never leaves the machine. | EM-1…EM-11 ✅ |
| **Notes (Wave 3)** | Full rebuild: **cloud-synced** Lexical editor (Yjs↔Postgres CRDT), live multiplayer (first Realtime consumer), task-lines ("the checkbox *is* the task"), comments, and **publish-to-web** at a public `/p/$token` route. Retired the redb-local notes engine. | NO-1…NO-10, NO-9b, NO-7b ✅ |
| **Tasks — Timeline** | A lightweight Gantt/timeline view (no heavy library; day-anchored drag; dependency dots). | TL-1…TL-3 ✅ |
| **Calendar (Wave 2)** | Time-blocking on a **task-lens** model (a calendar block *is* the task row — Tasks/Calendar can't drift), the schedule→completion loop, focus timer, external read-only **mirror** (Google/Outlook OAuth + **CalDAV/ICS**). | CAL-1…CAL-8b ✅ |
| **Contacts (Wave 1 + 1.5)** | Folk-lite CRM: people/companies as **hubs** with auto roll-up, CSV import, multi-value channels + custom fields, "needs attention" signals. First live consumer of the spine's drag-to-link. | CO-1…CO-5, v2, FX-1…FX-9 ✅ |
| **Spine (Wave 0)** | **The moat.** Central `entities` registry + typed `entity_links` + EntityHub roll-up + universal drag-payload + @mention/`/ref` + comments + derived notifications + activity trail + deterministic link suggestions. | CT-1…CT-7 ✅ |

Also shipped along the way: the **MCP connector** now exposes **6 modules (~60 tools)**, per-user preference sync (appearance/focus/calendar/email), a Stripe billing/trial system, and the workflow-skill rename (`/plan /execute /wrap` → `/s1 /s2 /s3`).

---

## 3. The product in one screen

- **What it is:** a lightweight, all-in-one personal workspace (tasks · notes · calendar · contacts · email · dashboard). Desktop-first (macOS), min window 1024×700.
- **The moat is the spine, not any one module.** The differentiation is the layer that lets *any* entity link/attach/relate/@mention/notify across modules. Individual modules are built to a **depth ceiling** with one signature moment — deliberately *not* to best-in-class parity ("not the best notes app; the best-connected one").
- **Hard non-goals** (see [`docs/PRODUCT_BRIEF.md`](../PRODUCT_BRIEF.md)): no Notion-style databases, **no abstract graph-view UI** (the moat is felt through one-gesture links, never shown as a node hairball), AI is **MCP-only** (no built-in model), quiet/minimal until the user opts in, graceful slippage (mirrors not walls).

---

## 4. Architecture at a glance

- **Stack:** Tauri 2 + React 19 + Rspack/Rsbuild + TanStack Router + Tailwind v4 · Lexical (rich text) · Yjs (Notes collab) · XYFlow (Mindmap) · Storybook 8 · Vitest/Playwright · Bun.
- **Two runtimes, one seam.** Everything data goes through `getRuntime()` → a `ModuoRuntime` interface. `src/lib/runtime.web.ts` is the **only** implementation with real logic (a single Supabase client; the **only** file in the app that calls `.rpc()`/`.from()`). `src/lib/runtime.tauri.ts` is a desktop composite that delegates almost everything back to the web runtime and only uses Tauri `invoke()` for genuinely-native surfaces.
- **Cloud-first.** **Supabase is the source of truth for every new model.** redb (desktop) is **paused** — kept only for the future offline/"lite" tier and legacy modules not yet migrated. *Never make redb load-bearing for a new feature.*
- **Writes = intent ops.** State-changing mutations go through `SECURITY DEFINER` Postgres RPCs named `<module>_op_<name>` (permission-check + activity-log + invariant-keeping, all in one transaction). **No raw client table writes for state changes.** Reads are RLS-filtered `.from()` selects.
- **The module contract (4 pillars).** A module isn't "done" until it has: (1) intent ops, (2) spine wiring, (3) MCP tools (a manifest the connector exposes), (4) a dashboard widget. This is why new modules get AI access + activity + notifications nearly for free. See [`docs/moduo-module-contract.md`](../moduo-module-contract.md).
- **Multiplayer posture:** shared-workspace **async** multiplayer (Supabase RLS + `workspace_members`), *not* live collaborative editing — except Notes, which has one Realtime latency-layer for near-live co-edit (durability still comes from the outbox/pull).

---

## 5. Module-by-module status

Pillars: **Ops** (intent-op RPCs) · **Spine** (registry + links + activity) · **MCP** (connector tools) · **Widget** (dashboard).

| Module | Status | Ops / Spine / MCP / Widget | Where it lives |
|---|---|---|---|
| **Tasks** — the reference implementation (Plan/Board/List/Timeline + Focus/Execute mode + schedule loop) | **Shipped** | ✅ / ✅ / ✅ (15) / ✅ | `src/features/tasks/`, `src/routes/pages/tasks-page.tsx` |
| **Spine** — registry, typed links, EntityHub, drag, @mention, comments, notifications, suggestions | **Shipped** | ✅ / *is the substrate* / ✅ (7) / ✅ | `src/features/spine/`, `src/lib/entity-links.ts`, `module-registry.ts` |
| **Contacts** — folk-lite CRM, hubs, roll-up, CSV import | **Shipped** | ✅ / ✅ / ✅ (10) / ✅ | `src/features/contacts/`, `contacts-page.tsx` |
| **Calendar** — task-lens time-blocking, the loop, external mirror | **Shipped** | ✅ / ✅ / ✅ (9) / ✅ | `src/features/calendar/`, Rust `src-tauri/src/commands/{calendar,caldav}.rs` |
| **Notes** — cloud-synced Lexical + Yjs, task-lines, multiplayer, publish | **Shipped** | ✅ / ✅ / ✅ (10) / ✅ | `src/features/notes/`, `notes-page.tsx`, `published-note-page.tsx` |
| **Email** — desktop IMAP/SMTP, lazy tissue refs, convert→task | **Shipped** | ✅ / ✅ (refs) / ✅ (9) / ✅ | `src/features/email/`, Rust `src-tauri/src/commands/email*` |
| **Dashboard / Home** — widget grid + registry (the widget host) | **Shipped** | grid ops / consumes spine / ✅ / *is the host* | `src/features/dashboard/`, `home-page.tsx` |
| **Settings** — account, billing, workspace, appearance | **Shipped** (overhaul pending, DF-19) | raw RLS writes / — / — / — | `src/features/settings/` |
| **Mindmap** — XYFlow mind-mapping | **Built but HIDDEN + pending rethink** (DF-4) | ❌ (redb-local, not spine-wired) | `src/features/mindmap/`, route `/mindmap` reachable but off-nav |
| **Time-tracking** — time→invoice | **Paused (stub)** | ❌ | native Rust command + a desktop-only widget shell; revives with Finance post-alpha |
| **Finance** — CSV-first money-flow + invoicing | **Planned — post-alpha, out of v1** | — | design brief only: [`.design/finance/BRIEF.md`](../../.design/finance/BRIEF.md) |

**Alpha module set = Tasks, Contacts, Calendar, Notes, Email, Dashboard, Spine — all shipped.**

---

## 6. Frontend & design system

- **Shell:** `src/components/app/app-chrome.tsx` (left module nav, top panel, notification center, command palette) + `feature-panels-shell.tsx` (the shared 3-pane list/main/right-panel that Tasks/Calendar/Contacts/Notes compose). `src/routes/layouts/app-gate.tsx` resolves auth+workspace before any page mounts.
- **Tokens are the single source of truth:** `src/styles/tokens.css` (OKLCH). Customization axes: `data-theme` (light/dark/system) · `data-shade` (6) · `data-accent` (8, AA-verified, default mono/white — hues are opt-in) · `data-density` (comfortable/compact/dense) · `data-font` (default Geist). **Density is the size axis** (the text-size picker was retired). Cross-device sync via `src/lib/prefs-sync.ts`.
- **Hard rules** (enforced by `lint:css`/`lint:tw` + the `moduo-design-quality` skill): no raw hex, no arbitrary Tailwind values for color/spacing/radius/font, no inline-style color overrides, primitives wrap shadcn. Full rules: [`DESIGN_RULES.md`](../../DESIGN_RULES.md) (R1–R10).
- **Primitives:** ~34 shadcn components in `src/components/ui/` (near-complete). **68 Storybook stories** (33 cover the primitives).
- **Route convergence:** the app converged from **23 exploratory routes to ~7 core features** — Home, Notes, Tasks, Calendar, Email, Contacts, Settings (Mindmap hidden). ~13 page files in `src/routes/pages/`. **Don't add top-level routes without an explicit ask** (a new route needs 5 separate wirings — see gotchas).
- **Dependency health:** a `npx madge --circular` sweep (2026-07-11) found **zero circular dependencies** across 599 modules — the import graph is clean, not tangled. (The 82 warnings are unresolved `@/` path-aliases, not cycles; pass `--ts-config tsconfig.json` to silence them.)
- **In-flight / half-migrated:** the `src/tw/` React-Native compat shim is nearly gone (only `onboarding-page.tsx` + `paywall-page.tsx` still use it); Subframe integration (`src/ui/`) is parked/dormant (theme deliberately not imported so it can't override the OKLCH tokens); fonts are **not installed yet** — `--font-*` fall back to system fonts (the one real code-level TODO, `tokens.css:21`).

---

## 7. Backend & data

**This is the part the [refactor memo](./backend-refactor-memo.md) is about — read that before proposing changes.**

### The two-runtime split (honest version)
Almost everything runs on **Supabase via the web runtime, on both web and desktop**: auth, workspaces, tasks, spine, contacts, notes, calendar CRUD, preferences, dashboard, habits, and email's cloud **tissue** (metadata refs). Only these are genuinely native (Rust `invoke`, desktop-only):
- **Email full client** — IMAP/SMTP, message bodies, send, attachments, search, folders → redb cache. The largest native surface; your live Spark replacement.
- **Calendar provider sync** — Google/Outlook OAuth + CalDAV/ICS (Rust fetches raw events; the **frontend** holds the session and writes the mirror to Supabase — *Rust can't write Supabase*).
- **Time-tracking** — native active-window → redb.
- **Integrations** (Zoom/Meet OAuth), device-local KV (`local_store`), one-time legacy import.

**Dead/dormant in Rust** (hollowed out by the cloud pivot, kept behind the clean seam): the redb tasks store, the local mnemonic/PIN auth + local-workspace vault (`hasLocalMnemonic:false`, `hasOfflineMode:false`), a **near-vestigial** sync worker, and a **fully dead graph (helix-rs) + embeddings (ONNX) subsystem** still initialized in `AppState` with no caller. This is the concentration of real, deletable debt (see the memo).

### Supabase schema
- **Base platform tables** (created via dashboard pre-migrations, no `CREATE TABLE` in repo): `workspaces`, `profiles`, `workspace_members`/`invites`/`notifications`, plus billing (`subscription_events`, `founders_interest`) and the legacy `notes`/`calendar_events` (later extended in place).
- **Migration-owned tables (22):** tasks (`buckets`, `tasks`, `tags`, `tag_links`, `task_time_blocks`, `task_relations`), spine (`entities`, `entity_links`, `link_suggestion_declines`, `comments`, `notification_state`, `module_activity`), contacts (`companies`, `contacts`, `contact_field_defs`), calendar (`calendar_accounts`), notes (`note_updates`), email (`email_accounts`, `email_refs`), platform (`user_preferences`, `workspace_api_keys`, `habits`).
- **35 migrations total** (`supabase/migrations/`), all applied to prod as of the blocks that shipped them. The keystone is `20260625120000_spine_entity_links` (the central registry + typed links).
- **RLS signature (very consistent):** every module table has RLS on, a single member-`SELECT` policy, and **no insert/update/delete policies** — all writes go through `SECURITY DEFINER` intent-op RPCs. Exceptions (direct-write, "preference-class"): `user_preferences`, `habits`, dashboard layouts. Owner-only reads: `email_accounts`, `notification_state`.
- **Auth:** Supabase Auth (`auth.uid()`). Per-module permission ladder none/view/edit/admin via `{module}_module_permission()` helpers (all ride the single `permissions_tasks` lane at alpha except Email, which has its own). API keys resolve scope via `module_api_key_id()`.

### Edge functions (`supabase/functions/`, 12)
- **`moduo-mcp/`** — the AI-access layer. Stateless MCP server over HTTP; auth by `moduo_sk_…` keys (sha256-verified); runs as service_role with actor attribution; a key's none/view/edit scope filters visible tools. **6 modules, ~60 tools** (tasks 15, contacts 10, notes 10, calendar 9, email 9, links 7).
- **Billing/Stripe (7)** — checkout/portal/webhook/sync/trial. Model in [`docs/billing_entitlements.md`](../billing_entitlements.md).
- **`notes-public/`** — public JSON API for a published note (rendered client-side at `/p/$token`; edge functions can't serve HTML — a Supabase platform limit).

### The spine data model (the moat, built)
Central `entities` registry (PK `(workspace_id, entity_type, entity_id)`), `entity_links` (the keystone: typed, polymorphic both ends, FK'd into the registry, direction-agnostic dedupe via a generated `pair_key`), 8 closed relation-kinds (`references` · spawned-from · blocks · attachment · mentions · works-at · follow-up · paid-by). Notifications are a **derived read over `module_activity`** (only read-state is stored), not a table. Attachments are folded into links (`kind='attachment'`). Still unbuilt at the data layer: a files/storage module; `payment`/`invoice`/`file` entity types exist only in the client kind-matrix, anticipating Finance.

---

### Backend structure (from the code graph)

A local AST graph (built with Graphify, no LLM, nothing left the machine) of the repo — 762 files → **5,282 symbols / 14,136 edges / 271 communities** — corroborates this section and the [refactor memo](./backend-refactor-memo.md):

- **Largest backend area:** `src-tauri/src/commands` (567 symbols), dominated by the email engine (`model.rs` / `storage.rs` / `sync.rs` / `parsing.rs` / `realtime.rs` all rank as hubs) — email is the load-bearing native code.
- **The seam is real:** `runtime.web.ts` (degree 100) is the single Supabase boundary; `ModuoRuntime` / `runtime.types.ts` (140) the interface.
- **`AppState` is the one god-object** (degree 215) — it constructs the dead `graph_helix` (12 nodes) + `embeddings` (9) engines at boot; start proposal C there.
- **The dead debt is isolated:** graph + embeddings + vestigial `sync` ≈ 36 symbols, absent from every coupling hotspot → pruning is low-risk.
- **Caveat:** the 35 SQL migrations don't parse into the graph (graphify's SQL support is nascent), so the graph covers the *code* backend; the schema is enumerated above.
- Regenerate anytime (local, no API key): `graphify extract . --code-only`, then `graphify explain "AppState"` or `graphify query "how does email sync reach Supabase"`.

## 8. Key decisions & why (the load-bearing ones)

Full log (107 entries, newest-first): [`docs/decisions.md`](../decisions.md). The ones that constrain how you may evolve things:

- **Cloud-first pivot (2026-06-11).** Supabase is the source of truth for every new model; redb is paused. *Driver:* shared-workspace multiplayer requires it — "a module that cannot be expressed Supabase-first is not ready to build."
- **The spine is the moat (2026-06-24).** Built once, alongside the second module, because spine primitives are ~60% of every module's true cost and retrofitting 5 finished modules costs far more.
- **Intent ops, not raw writes.** Invariants + permissions + activity in one transaction — *and* it's what gives MCP agents safe writes for free.
- **Central `entities` registry** (over per-type FKs or trigger-only validation) — one indexed query for search/@mention/roll-up, clean cascade-on-delete.
- **Async multiplayer, not live collab** (the expensive trap) — except Notes' one Realtime latency layer.
- **AI is MCP-only**, behind scoped keys (none/view/edit; admin never key-grantable).
- **Email is desktop-first hybrid** — full client on the machine (redb); only `email_refs` metadata in the cloud. **No server-side mail relay at alpha** ("the most expensive thing we could build").
- **redb kept, not deleted** — it's the seed of the future offline/"lite" tier and the escape valve against the "cloud-vs-privacy" risk.
- **No graph-view UI** — a hard guardrail: the moat is felt through one-gesture links, never shown as an abstract graph.
- **Per-module depth ceilings** — bounded depth + one signature moment per module, not feature parity.

---

## 9. Gotchas that will bite you (backend/data top hits)

Full list: [`docs/gotchas.md`](../gotchas.md). The sharp edges:

- **`bun run verify` never touches Postgres.** A green PR with a new `.sql` only means it parsed. RLS/RPCs/FKs are unproven until applied + exercised by an authenticated round-trip.
- **The Supabase JS client is UNTYPED.** `.from("typo")` and `.rpc("unmigrated_fn")` typecheck fine; column renames are silent. The live round-trip is the only real check.
- **supabase-js reports REST failures via the `error` field — it does NOT throw.** Destructuring just `{ data }` silently coerces a 500/expired-JWT-401/RLS error to "no rows" (this bit the billing gate — would have paywalled a paying user). If absent-vs-failed matters, check `error`.
- **A "new" table may already exist in prod** from the pre-migrations era — grep `src/types/supabase.ts` before `CREATE TABLE IF NOT EXISTS` (it silently no-ops against the wrong shape).
- **A new module's `_module_permission` MUST include the `module_api_key_id()` branch** or every agent WRITE through its ops is dead on arrival (service_role → `auth.uid()` is NULL → "no edit access"). Shipped broken in three modules before it was caught. Copy `tasks_module_permission`.
- **Spine dedupe needs `COLLATE "C"`** so `entity_links.pair_key` (SQL) matches `deriveLinkKey` (TS) — keep them in lockstep.
- **Never import a bare `{ runtime }`** — always `getRuntime()` (the bare export was an always-null const).
- **`tasks.due_date` is a `timestamptz`, not `YYYY-MM-DD`** — a raw lexical compare is off-by-a-day east of UTC.
- **Adding a top-level route needs 5 wirings** the compiler catches none of; adding a `user_preferences` domain needs 7.
- **The Supabase MCP is pinned to project `wtoonrvuqumihpkbvwvs` ("moduohyb")** — if a session ever shows a different org, STOP.

---

## 10. What's left — the future backlog

**The authoritative backlog is [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md) + [`docs/ROADMAP.md`](../ROADMAP.md).** This project tracks future work in the ledger/roadmap, **not** in code comments (a full `TODO/FIXME` sweep of `src/` + `src-tauri/` returns exactly one benign marker) — so grepping for TODOs understates the backlog by design. Summary:

### Pre-alpha, ready now (DF wave — all deps met)
The "next" work, all in the DF section (spec: [`docs/reviews/whole-app-critique-2026-07-plan.md`](../reviews/whole-app-critique-2026-07-plan.md)):

- **DF-2** Deep-link selection: Calendar + Email
- **DF-7** Rollup snippets + company parity
- **DF-8** Tasks joins the spine (EntityHub in task detail + accept drops)
- **DF-9** Notification generation v1 (assigned-to-you, blocked→unblocked)
- **DF-10** Palette searches entities
- **DF-11** Focus session survives navigation
- **DF-12** Boot fetch consolidation (dedupe auth/profiles/workspaces reads)
- **DF-15** Home first-run composition
- **DF-16** Dead-chrome + copy sweep
- **DF-17** Legacy deletions (dead `email-workspace.tsx` tree, mindmap dead code)
- **DF-18** Eyebrow/header/toolbar standardization
- **DF-19** Settings overhaul *(needs a short `/s1` first)*
- **DF-20** Global capture command bar (`/note` `/event` `/contact`)
- **DF-24** Workspace membership loop (`/join/:token`, member names, leave/remove)

### Pre-alpha, blocked on a sibling
- **DF-21** Universal Inbox (blocked on DF-9 + a short `/s1`)
- **DF-22** Cross-pane drag-to-link (blocked on DF-8; the riskiest — one app-level `DndContext`)
- **DF-23** @mention + `/ref` beyond Notes (blocked on DF-2)

### Pre-alpha gates (after the DF waves)
- **Mindmap rethink** — pulled *into* alpha but **not yet specced** (needs an `/s1`); gates MCP-1.
- **MCP-1** — connector hardening: redeploy `moduo-mcp` + a keyed write round-trip per module (a read-only smoke test misses dead writes — see §9). Deps = the whole alpha feature set incl. the Mindmap rework.
- **DESKTOP-1** — macOS auto-updater + CI release (deferred until the app is "ready"; macOS-first, Windows deprioritized).

### Post-alpha / out of v1
- **Finance (Wave 4)** — CSV-first money-flow + invoicing. Highest-scored *unbuilt* backlog cluster (the founder's #1 personal pain); revives time-tracking → invoice line items. Kept, explicitly *not* deleted.
- **Email post-v1** — Outlook/Microsoft 365, Workspace-Google, send-as aliases, scheduled send (returns with a relay), cloud mail relay/full web client, folder management, MCP body-read/send.
- **Calendar** — Calendly-like booking links (paid-tier hook).
- **Smaller deferred micro-items** recorded inside shipped blocks: `contacts_op_merge` (dedupe detects but can't merge yet), calendar roll-forward origin payload, email web-tissue linked-entity chips, Notes live cursors.

### Genuinely-open decisions (⚠ NEED-YOU — don't re-litigate the rest)
- **Pricing & free-tier** — blocked on a **cost/unit-economics model** (Supabase + desktop email engine, per workspace / per free student). The single most load-bearing launch decision; does *not* block the build.
- **Assistive scheduling at alpha** — confirm "none beyond drag-to-schedule + reflow" (opaque auto-reshuffle is explicitly ruled out).
- **Perpetual-fallback license** — a deferred "maybe"; lossless export *is* committed at launch.

### The other open surface: manual-test checklists
Nearly every shipped block has a `docs/testing/<block>.md` checklist whose boxes are **still unchecked** (~700+ items) — these are human-run passes largely *not yet executed*, not bugs. They cluster into "known gaps" a human/desktop pass must close before alpha: real OAuth round-trips (Google/Outlook/CalDAV), drag gestures (unsimulable in CI), post-deploy migration/edge-fn round-trips, and visual-baseline PNGs.

---

## 11. Doc-accuracy caveats (so you're not misled)

- **[`docs/data-layers.md`](../data-layers.md) is ~4 waves stale on *status*** (dated 2026-06-24; describes "~16 migrations, only Tasks cloud-first, spine aspirational"). Reality: 35 migrations, 7+ modules cloud-first, spine built, MCP exposes 6 modules. Read it for **intent/philosophy**, not current status — where doc and code disagree, the code wins.
- **[`docs/ROADMAP.md`](../ROADMAP.md) §B Q5 prose is stale** — it still reads "lean trigger-based validation over a central registry." That was superseded the same day; the **central `entities` registry won and shipped** (CT-1). Trust the "Resolved" block / `data-layers.md`, not the Q5 line.
- **`specs/contacts-v2.md` status line lags** — marked "In progress" though its batches are done and `contacts-v3-fixpack.md` supersedes it.
- **[`docs/improvement-plan.md`](../improvement-plan.md) is the *completed* Tasks-era log** — history, not the live plan. The live plan is BUILD_ORDER + ROADMAP.

---

## 12. How to run it

```
bun run dev:web        # web dev server, http://127.0.0.1:8081
bun run dev:desktop    # Tauri dev (Rust + web)
bun run storybook      # port 6006
bun run verify         # typecheck + lint + tests  (does NOT touch Postgres — see §9)
bun run build:desktop --bundles app   # macOS dogfood build (drop-in replace; data survives)
```

- **Workflow skills:** `/s1` plan (read-only grill + research) → `/s2` execute one block → `/s3` wrap (commit, PR into personal branch, merge, test checklist).
- **Branching:** cut `t/<owner>/<short-kebab>` off the personal branch (`maciej`/`mike`) *before* editing. Never branch from `main`/`develop`; never push to them. Full contract: [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
- **Supabase project:** `wtoonrvuqumihpkbvwvs` ("moduohyb"). There's a hosted test account for live verification (ask Maciej).

---

*Generated with [Claude Code](https://claude.com/claude-code).*
