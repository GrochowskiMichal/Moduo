# Moduo Tasks Module — Build Log

Breadcrumbs between Claude Code sessions. Newest first. Each entry: what was
built, key decisions, and anything deferred or broken. Pairs with
`moduo-tasks-feature-spec.md` (the anchor) and `moduo-architecture-vocabulary.md`.

---

## Session 2 — Plan Mode: Buckets + List + Capture (2026-06-06)

Branch `t/maciej/tasks-plan-mode` off `maciej`. First visible, usable Tasks UI on
the new model. Desktop (redb) and web (Supabase) both functional.

**New data-model field (decision — Maciej):** added an optional `priority`
(low/med/high) axis distinct from `energy_level`. Energy = *how demanding*;
priority = *how important in time*. Both optional, ambient (never red), and
opt-in group-by dimensions. Spec §11 updated first, then code. Touched:
[domain/mod.rs](../src-tauri/src/domain/mod.rs) (`PriorityLevel` enum +
`Task.priority`, `#[serde(default)]` → backward-compatible redb rows; test
literal updated), [model.ts](../src/features/tasks/model.ts), and a new
append-only migration
[20260606130000_tasks_add_priority.sql](../supabase/migrations/20260606130000_tasks_add_priority.sql)
(adds the column + recreates the drift view). `urgent` is a future non-breaking
enum/CHECK extension.

**Runtime bindings (both platforms — was deferred from Session 1):**
`ModuoRuntime.tasks` interface in [runtime.types.ts](../src/lib/runtime.types.ts);
desktop impl invokes the `tasks_module_*` commands
([runtime.tauri.ts](../src/lib/runtime.tauri.ts)); **web impl is Supabase-backed**
([runtime.web.ts](../src/lib/runtime.web.ts)) with camelCase↔snake_case row
mappers and JS-side lazy Inbox seeding (mirrors the redb path; RLS scopes rows).
Per Maciej's call, web parity is in this session (not deferred with cloud-sync).

**Route + nav:** `/tasks` route re-added ([router.tsx](../src/router.tsx)); nav
item (`module:"tasks"`, `check-square`) in
[app-chrome-constants.ts](../src/components/app/app-chrome-constants.ts) — gated by
`modulePermissions.tasks` (shows on web too, not desktop-only); palette "Open
Tasks"; `/tasks → "tasks"` in [panel-events.ts](../src/features/layout/panel-events.ts).

**Feature ([src/features/tasks/](../src/features/tasks/)):**
- `hooks/use-tasks-module.ts` — loads the bundle, optimistic CRUD over
  buckets/tasks, derived open-counts + soft per-bucket drift counts.
- `parse/capture-parser.ts` — Tier-1 parser: `chrono-node` for date/time +
  constrained vocabulary over `rrule.js` for recurrence (every day / weekday /
  <weekday> / N weeks / daily-weekly-monthly-yearly). Time-bearing → `scheduledAt`;
  date-only → `dueDate`; recurrence → `recurrence` + next occurrence (9am default
  when timeless). Unparseable "every …" is flagged, never guessed.
- `ui/` — `tasks-plan-view` (FeaturePanelsShell, hideRight; persists
  mode/selection/groupBy per workspace), `bucket-rail` (Plan/Execute toggle,
  All/Inbox + user buckets with counts + ambient drift, **instant** add-bucket,
  rename/delete), `task-list-view` (Linear-style: group by None/Status/Bucket/
  Priority/Energy, collapsible groups — one open by default when grouped by
  bucket; keyboard j/k/x/Enter-e/c/b/s/d, mod+⌫ delete), `task-row` (complete
  toggle, inline rename, scheduled/due/recurrence meta with inline popovers,
  energy/priority dots + right-click context menu), `capture-modal` (cmd+n,
  single field, live parse preview, confirmation toast), `execute-stub`.
- `routes/pages/tasks-page.tsx` — permission/auth gating (mirrors NotesPage).

Design principles honored: no required-field forms (capture is one field, lands
immediately), no triage queue, no blocking modals; drift is ambient/soft;
instant bucket creation.

**Verified:** `bun run typecheck` clean; `cargo check` clean; `cargo test
domain::tests` 5/5; `bun run lint:tw` clean; `lint:css` unchanged (no CSS
touched). Full web production build compiles.

**Deferred / not this session:**
- Commit action + Execute-mode loop (Now card/timer/queue, "Start my day") —
  **Session 3**. Execute is a visible stub; the toggle works.
- One-click "Edit" action on the confirmation toast (spec §6) — toast shows the
  parse; the inline-edit jump from it is a small follow-up.
- Real drift batch-triage + Board view + default-view (time-block) logic —
  **Session 4**. (Per-bucket drift counts already render, soft.)
- Live cloud-sync of the redb↔postgres tables (desktop offline → cloud) — still
  its own task; web talks to Supabase directly, desktop to redb.
- Supabase migrations (`…create_tasks_module`, `…add_priority`) must be applied
  to the hosted project for the **web** path to work; not auto-applied here.
- Tags UI (model + runtime bindings exist; no surface yet).

**Parked feedback (app-wide, not Tasks-specific):** Maciej finds the overall app
density too large vs. Notion/Linear — even the smallest font-size setting is
bigger than Notion's default. Needs a global type-scale / density tuning pass
(tokens.css + the density setting). Recorded; **not to be started unprompted.**

**Post-merge fixups (after syncing develop into maciej):** capture no longer
fails silently when no bucket is loaded (toasts instead); the List view shows a
"couldn't load tasks" banner + Retry when the bundle fails (e.g. web tables not
yet migrated).

**Capture modal redesigned → Linear-style (decision — Maciej; spec §6 updated
first).** Quiet by default, every property one click away: NL title line +
description + a row of always-visible property **pills** (bucket, scheduled, due,
recurrence, priority, energy, duration). The title still parses dates/recurrence
and pre-fills the relevant pills, but each pill is directly settable and a
manual edit wins over the parser (so a user can set a date by hand, or not at
all). Title is the only thing needed — Enter files instantly; `⌘↵` submits from
the description; a "Create more" toggle keeps it open for rapid entry. Recurrence
pill uses simple presets (no complex builder, per §7); tags deferred. New
`parse/recurrence.ts` (preset → RRULE + next occurrence + human label);
`durationMinutes` added to the task factory.

**Right panel:** Tasks now renders a placeholder right rail (removed the
`hideRight` lock) so the 3-pane resize/layout can be tested; real content comes
later.

---

## Session 1b — Legacy tasks model removed (2026-06-06)

Same branch. Pulled the staged deletion forward (was planned for the Plan-mode
session) so Session 2 starts on a clean slate. The new bucket/task/tag model is
now the **only** Tasks model.

**Removed (pure-legacy):** `commands/tasks.rs`; the legacy domain structs
(`TaskProject`/`TaskWorkflowState`/`TaskItem`/`TaskComment`/`TaskActivity`/
`TasksBundle`/`ProjectLabel`) + their redb tables (`tasks_projects`,
`tasks_states`, `tasks_items`, `tasks_comments`, `tasks_outbox`, `tasks_oplog`,
`tasks_activity`) + store methods; the entire `src/features/plan/` UI; the legacy
`src/features/tasks/` files (kept only `model.ts`); `ground-page.tsx`; the
dashboard `tasks-widget`; the notes `EmbeddedTask` block; and the orphaned
(dead) `app-chrome-menus.tsx`.

**Decoupled (edited, not deleted):** runtime `tasks` namespace dropped from
`runtime.types.ts` + `.tauri.ts` + `.web.ts`; `router.tsx` lost `/ground`,
`/tasks`, `/calendar` routes; `app-chrome-constants` lost the "Ground" nav item;
dashboard `grid-page`/`grid-workspace`/`dashboard-grid`/`widgets-panel` +
`WidgetType` lost the "tasks" widget; notes `SlashCommandPlugin` lost the "Embed
Task" command; `expose.ts` no longer hydrates task embeds; `EmbedNode` keeps the
`"task"` kind for back-compat but renders nothing; `sync/mod.rs` lost the
`tasks_*` push/pull entries; `migration_legacy` keeps notes import only;
`dump_workspace_hashes` now hashes the new bucket/task/tag bundle.

**Preserved (moved out of `plan/`):** `use-slot-bookings-sync.ts` (Calendar
slot-booking → calendar-event sync; live, called by `app-gate`) and
`expose-slot.ts` (Calendly-style host-side slot exposure) → moved to
`src/features/calendar/{hooks,utils}/`. `expose-slot` is now uncalled (its only
UI was the deleted plan link-view) — re-surface it when the Calendar module is built.

**Decisions (Maciej):** strip all tasks routes & nav now (no placeholder — Session
2 re-adds the `/tasks` route + nav); remove the notes EmbeddedTask + dashboard
tasks-widget (rebuild on the new model later). `modulePermissions.tasks` kept —
the new model reuses it.

**Verified:** `bun run typecheck` clean; `cargo check` clean; `cargo test
domain::tests` 5/5.

**Left for Session 2:** add the `/tasks` route + nav entry; build Plan-mode UI
(buckets + List + capture) on the new model; runtime bindings (`rt.tasks.*`) for
the `tasks_module_*` commands; cloud-sync wiring for the new tables.

---

## Session 1 — Data Model & Foundation (2026-06-06)

Branch `t/maciej/tasks-data-model` off `maciej`.

**Built the spec'd Tasks data model (§11) — schema only, no UI.**

- **Conflict found & decision:** the existing `tasks_*` code is a Linear/Jira-style
  issue tracker (TaskProject + per-project TaskWorkflowState + TaskItem with
  task_code/subtasks/relations/assignees), with a full `features/plan` UI on it.
  That conceptually conflicts with the spec's bucket/commit/execute model. Per
  Maciej's call, the new model **fully replaces** the old one — but the deletion
  is **staged**: this session lands the new model alongside the (now deprecated)
  old one so the tree stays green; the old tables + `commands/tasks.rs` + domain
  Linear structs + `features/plan` UI get removed in the Plan-mode session when
  the new UI replaces them.
- **redb (primary, local-first):** new tables `buckets`, `tasks`, `tags`,
  `tag_links` ([store_redb/mod.rs](../src-tauri/src/store_redb/mod.rs)); new
  domain structs `Bucket` / `Task` / `Tag` / `TagLink` / `RecurrenceRule` +
  `TaskStatus` / `EnergyLevel` enums + `TasksModuleBundle`
  ([domain/mod.rs](../src-tauri/src/domain/mod.rs)). Task carries both `due_date`
  and `scheduled_at`, plus `committed_for`/`commit_order`, `reschedule_count`,
  `recurrence`, `energy_level`, `duration_minutes`, fixed `status`.
- **Commands:** [commands/tasks_module.rs](../src-tauri/src/commands/tasks_module.rs)
  — list (lazy-seeds Inbox), seed_inbox, upsert/delete bucket (system-protected,
  reassigns orphans to Inbox), upsert/delete task (bucket fallback → Inbox),
  upsert/delete tag (cascades links), attach/detach tag (polymorphic). Registered
  in [lib.rs](../src-tauri/src/lib.rs).
- **`drifted` is computed, not stored:** `Task::is_drifted(now)` in Rust and
  `isDrifted()` in [model.ts](../src/features/tasks/model.ts); a
  `tasks_with_drift` view on the Postgres side. Logic:
  `scheduled_at < now AND status NOT IN (done, archived)`.
- **Inbox** seeded lazily per-workspace on first read (idempotent), `is_system`,
  undeletable; a partial unique index enforces one live Inbox per workspace.
- **TS types:** [src/features/tasks/model.ts](../src/features/tasks/model.ts)
  (camelCase fields, snake_case enum values — mirrors serde).
- **Supabase migration:**
  [20260606120000_create_tasks_module.sql](../supabase/migrations/20260606120000_create_tasks_module.sql)
  — tables + indexes + RLS (SECURITY-DEFINER workspace-access helper to avoid the
  known RLS recursion) + drift view.

**Verified:** `bun run typecheck` clean; `cargo check` clean.

**Deferred (not this session):**
- Removal of the legacy `tasks_*` model + `features/plan` UI → **done in Session 1b (above)**.
- Live cloud-sync wiring for the new tables (SYNC_TABLES/PULL_TABLES + the
  redb-camelCase ↔ postgres-snake_case field mapping). The existing sync engine
  has a casing mismatch and an unpopulated task outbox; wiring it correctly is
  its own task.
- TS runtime bindings (`rt.tasks.*` invoke glue) — added when Session 2's UI consumes them.
- Capture parser (chrono-node + rrule.js) that *populates* `recurrence` — Session 2.
- Commit-queue / Execute-mode behavior — fields exist; logic is Session 3.
- Lexorank position generation helpers — Session 2.
