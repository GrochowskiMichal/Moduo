# Moduo Improvement Plan (2026-06)

> Multi-session working plan agreed 2026-06-11 (Maciej + Claude). Lives here so
> every session — human or agent — picks up where the last left off. Pairs with
> [moduo-tasks-feature-spec.md](./moduo-tasks-feature-spec.md),
> [moduo-architecture-vocabulary.md](./moduo-architecture-vocabulary.md), and
> [build-log.md](./build-log.md).

## Session protocol

1. At session start: read this file + the spec + vocabulary + the latest
   build-log entry. Work the **next unchecked session** unless told otherwise.
2. Cut a `t/<owner>/<short-kebab>` branch off the personal branch **before
   editing** (see CONTRIBUTING.md).
3. At session end: check the boxes here, append a build-log entry, and update
   this file if scope changed. If a decision below gets reversed, edit this
   file first, then code (same rule as the spec).

## Locked decisions feeding this plan

- **Cloud-first pivot (2026-06-11).** Moduo is cloud-based first (monetization);
  a lighter free local-first version comes later. Supabase becomes the source
  of truth; redb is paused, kept for the future lite/offline-cache story.
  Offline use with **local LLMs** is a later goal, not v1.
- **Density is a customization axis, not a fixed target.** Linear's density
  polarizes; the densest setting should *reach* Linear/Notion, the loose end
  stays comfortable. Don't chase one aesthetic — tune the range.
- **Subtasks = full tasks, one level.** `parentId`, no recursion, individually
  committable to Today. Not checklist items.
- **Blocked-by is wanted but not locked** — design check-in before building
  (Session 6). Current proposal: relation edges + *computed* blocked state
  (drift pattern), never a stored status, never red.
- **Theme shades (Discord-style app-wide tint presets)** are a future axis —
  keep every surface color token-routed in all frontend work so `data-shade`
  can land without component edits.

## Cross-module AI-readiness (applies from Session 8 onward)

Every module — current and future (Tasks, Notes, Mail, Calendar, …) — must
eventually be AI-interactable. To avoid re-designing this per module, the
platform sessions below establish a **per-module contract**, with Tasks as the
first implementation:

- **Intent ops**: each module exposes its mutations as named, invariant-keeping
  operations (e.g. `tasks.commit`, `notes.append`), not raw row writes.
- **Actor attribution + activity**: every mutation records *who* (user, agent,
  API key) and is visible to the user in-app. Agents never move things silently.
- **MCP surface registration**: each module contributes its resources/tools to
  the one Moduo MCP connector through a shared registration pattern; onboarding
  module N+1 is additive, not architectural.
- **Permission mapping**: agent/API-key scopes reuse the existing per-module
  none/view/edit/admin permissions. Read-only by default.

A new module isn't "done" until it has these four. (Tags already follow the
analogous UI rule: workspace-level, shared component, module-agnostic.)

## Sessions

### ☑ 1 — Density & type-scale pass *(design · no schema · parallelizable)*
- [x] Retune `--text-*`, `--ctrl-h*`, `--row-h`, `--pad-*` in `tokens.css` so
      density + text-size settings span a wider, well-tuned range (densest end
      ≈ Linear/Notion).
- [x] Consider a third density step; make "compact" actually compact.
      *(Added `dense`: comfortable 36 / compact 32 / dense 28 row ladder;
      "compact actually compact" landed as wiring the rows that ignored the
      tokens, see build log.)*
- [x] Verify all module surfaces respond (FeaturePanelsShell, rails, rows,
      Settings preview); Storybook spot-check + visual snapshots
      (`scripts/density-snapshots.mjs` + a density/text-size Storybook toolbar).

### ☑ 2 — Cloud consolidation *(platform · unblocks every schema change after it)*

> **Scope check 2026-06-11** (pre-session investigation, see build-log):
> desktop **notes stay on redb this session** — Mike's unsynced notes work
> (`origin/mike`: 14 commits incl. `commands/notes.rs` + six notes migrations
> dated 2026-06-05, *earlier* than our tasks migrations) owns that surface.
> Desktop→Supabase is a runtime **composition, not a swap**: email,
> time-tracking, calendar OAuth, integrations, and graph remain
> Tauri-invoke + redb (they have no Supabase path). The legacy sync engine is
> a skeleton (tasks tables absent, no case mappers, outbox never populated,
> and the `auth_link_to_cloud` Rust commands it depends on were never built) —
> do **not** finish it; go Supabase-direct in the webview.

- [x] **Coordinate with Mike before touching hosted** — resolved empirically
      (2026-06-12): `list_migrations` on hosted shows his six `20260605*`
      notes migrations **already applied**. (b) `mike` → `develop` timing is
      moot for this session (desktop notes already phased out of scope); ask
      when desktop-notes migration is scheduled.
- [x] Apply the hosted Supabase migrations — found **already applied**
      (2026-06-11, hosted versions `20260611131017/131039`), plus a
      `task_time_blocks` migration (`20260611132737`) that had no repo
      counterpart; back-filled `supabase/migrations/20260611132737_task_time_blocks.sql`
      from the hosted schema (hosted = ground truth).
- [x] Desktop app → Supabase runtime for **auth + workspaces + tasks** —
      done as a *composition*: `runtime.tauri.ts` reuses `webRuntime.auth` /
      `.workspace` / `.tasks` verbatim; a new `auth_set_cloud_session` Rust
      command mirrors the Supabase session into `AppState` so the
      invoke-backed modules (notes, email, calendar, time-tracking, graph)
      keep attributing writes. Capabilities: `hasLocalMnemonic` /
      `hasOfflineMode` now false (vault UI flows kept, keyed to the
      capability, for the lite version). Desktop **notes** still redb.
- [x] Migrate **time-blocks** → `task_time_blocks` table (one row per
      workspace, slot→bucket jsonb): `runtime.tasks.get/setTimeBlocks`,
      loaded with the bundle in `use-tasks-module`, optimistic writes.
- [x] Cleanup: dead `auth_link_to_cloud` / `auth_sign_in_cloud` invokes
      removed with the rest of the invoke-auth namespace. Orphaned redb
      tables for the lite story: `notes_outbox` / `notes_oplog` (see
      build-log).
- [x] Docs synced: spec §9 time-blocks wording, CLAUDE.md stack line,
      `web+desktop_plan.md` retired with a banner, build-log entry.

### ☐ 3 — Task detail panel + ambient mirrors *(tasks)*
- [ ] Right rail = task-detail-on-select: editable description, all properties,
      created/updated, drift info.
- [ ] **Render `rescheduleCount`** (first actual mirror — incremented today but
      shown nowhere).
- [ ] Distinct selected-row state (vs hover); teaching empty states
      ("Press `c` to capture").

### ☐ 4 — Organization layer: rail sections + tags v1 *(tasks + shared)*
- [ ] Bucket sections: optional `group` label → collapsible rail sections;
      presentational only, capture untouched, two levels max.
- [ ] Tags v1: **shared workspace-level** TagPicker in `src/components/`
      (cross-module contract — Mail/Notes adopt the same component later);
      label-color token palette; chips + filter in Tasks.

### ☐ 5 — Subtasks, one level *(tasks)*
- [ ] `parentId` on Task, recursion forbidden; ordered under the parent in the
      detail panel; hidden from top-level lists by default (expand affordance).
- [ ] Individually committable to Today (start a scary task via its smallest
      step); parent shows quiet n/m progress.

### ☐ 6 — Blocked-by dependencies *(tasks · design check-in first)*
- [ ] Decide the model with Maciej. Proposal: `task_relations` edges
      (blocker → blocked); **computed** blocked state (drift pattern); blocked
      tasks render dim/quiet, never red; cycles forbidden.
- [ ] The frontier walk: from any task, "what's actually next" = its unblocked
      frontier; committing a blocked task offers the frontier instead.

### ☐ 7 — Recurrence engine *(tasks · ADHD-critical)*
- [ ] Advance-on-done; **missed occurrences don't exist** (no backfill, no
      "7 overdue" — there is only the next occurrence).
- [ ] Catch-up semantics on app open; skip-occurrence affordance.

### ☐ 8 — Intent ops + activity *(platform · per-module contract, Tasks first)*
- [ ] Define the module contract (ops naming, actor field, activity table,
      registration shape) — see Cross-module AI-readiness above.
- [ ] Implement for Tasks: commit/reschedule/triage/recurrence invariants move
      from the React hook into backend RPCs.
- [ ] Activity trail rendered in the task detail panel.

### ☐ 9 — MCP connector v1 *(platform · cloud)*
- [ ] One Moduo MCP server with per-module registration; Tasks is module #1.
- [ ] Read-only resources first (buckets, tasks, queue, drift, tags, search).
- [ ] Writes exclusively via Session 8 intent ops; scoped API keys on the
      none/view/edit permission model.
- [ ] Document the "onboard a module to MCP" recipe so Notes/Mail/Calendar
      follow without redesign. Local-LLM/offline MCP stays deferred to the
      lite version.

### ☐ 10 — Theme shades + tokenization deepening *(design · anytime after 1)*
- [ ] `data-shade` axis: curated tinted-dark presets (warm/cool/slate/…),
      Settings picker, same cascade mechanism as `data-accent`.
- [ ] Audit for token bypasses while in there.

## Ordering notes

- **1 before 10** — the density pass changes the token values shades would tint.
- **2 before 4–7** — every schema change after consolidation is written once.
- **5 + 6 may merge** if both stay lean (same surfaces: detail panel, model,
  commit semantics).
- **8 strictly before 9** — agents writing before invariants live server-side
  would corrode the ambient mirrors.
- **1 and 10 are parallelizable** (pure frontend, no schema) — can interleave
  or go to Mike.

## Polish backlog (fold into whichever session touches the area)

- Board: drop animation, within-column reorder, insertion indicators.
- ⌘K: task actions (commit, move, schedule) in the palette.
- Execute: surface elapsed time (time-blindness mirror).
- Today queue: duration sum ("4 tasks · ~3h") — factual, never a wall.
