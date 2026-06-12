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

### ☑ 3 — Task detail panel + ambient mirrors *(tasks)*

> **Done 2026-06-12** (Opus, branch `t/maciej/session3-task-detail`). New
> `task-detail-panel.tsx`; selection lifted to `tasks-plan-view.tsx` as
> `selectedTaskId` and threaded to List (controlled cursor) + Board
> (select-on-click). `rescheduleCount` mirror live-verified end-to-end
> (commit → Execute → Skip → "Rescheduled 1×"). See build-log. Next: Fable
> `/code-review` before merge.

> **Pre-flight (Fable, 2026-06-12)** — for whichever model runs this:
> (a) The right-rail placeholder to replace is the "Context" panel in
> `tasks-plan-view.tsx` (~line 262). (b) Task-level selection already exists
> but is **local to `task-list-view.tsx`** (`selectedId`, keyboard-driven,
> ~line 58; rows already render `selected ? "bg-accent" : "hover:bg-accent/60"`)
> — it must be lifted to `tasks-plan-view.tsx` so the rail can bind to it.
> Careful: `selection` in tasks-plan-view already means *bucket scope*; pick a
> distinct name (`selectedTaskId`). Board view needs its own select-on-click.
> (c) `rescheduleCount` is at `model.ts:79`, incremented in
> `use-tasks-module.ts` (`rescheduleFromToday`), rendered nowhere — it's an
> *ambient mirror*: muted-foreground, factual ("Rescheduled 3×"), never
> red/warning (spec design principles 4–5). (d) Mutations go through
> `api.patchTask` (optimistic; do not add new write paths). (e) Detail panel is
> a feature component (`src/features/tasks/ui/`) — no Storybook story required,
> but any new shadcn primitive goes through the CLI per CLAUDE.md rule 4.
- [x] Right rail = task-detail-on-select: editable description, all properties,
      created/updated, drift info.
- [x] **Render `rescheduleCount`** (first actual mirror — incremented today but
      shown nowhere).
- [x] Distinct selected-row state (vs hover); teaching empty states
      ("Press `c` to capture").

### ☑ 4 — Organization layer: rail sections + tags v1 *(tasks + shared)*

> **Done 2026-06-12** (Opus, branch `t/maciej/session4-org-tags`). Tags' data
> layer already existed (tables + runtime CRUD from Session 1–2); this session is
> the UI + one additive schema change (`buckets.group_label`). Decisions locked
> with Maciej: header **Filter** control + click-chip-to-filter (OR/union);
> chips **always shown, quiet** on rows/cards; **inline create + auto color**
> (recolorable). New shared `TagPicker` + `TagChip`/`TagChipList` +
> `tag-colors.ts` in `src/components/` (cross-module); label palette in
> tokens.css §13b (`data-label`) + `.tag-chip`/`.tag-dot` in global.css.
> Migration `20260612120000_buckets_add_group.sql` **applied to hosted** (Maciej's
> go-ahead) and **live-verified on web** (section + tags + filter, DB-confirmed;
> see build log). Next: Fable `/code-review` before merge.

- [x] Bucket sections: optional `group` label → collapsible rail sections;
      presentational only, capture untouched, two levels max. *(`group` on
      Bucket — TS/Rust/SQL; `bucketSections` helper; rail renders ungrouped
      flat then collapsible sections; assign via bucket "…" → Section.)*
- [x] Tags v1: **shared workspace-level** TagPicker in `src/components/`
      (cross-module contract — Mail/Notes adopt the same component later);
      label-color token palette; chips + filter in Tasks. *(TagPicker:
      search/toggle/create/recolor/delete; detail-panel Tags field; quiet chips
      on rows+cards; header tag filter, click-chip-to-filter, union semantics.)*

### ☑ 5 — Subtasks, one level *(tasks)*

> **Done 2026-06-12** (Fable, branch `t/maciej/session5-subtasks`). Migration
> `20260612130000_tasks_add_parent.sql` (parent_id + one-level trigger)
> **applied to hosted** (Maciej's go-ahead) and **live-verified on web**
> end-to-end (add → n/m mirror → expand → commit subtask → Today/Execute flat
> with parent captions; trigger blocks nesting; DB-confirmed). Spec §5b added.
> See build log. Next: `/code-review` before merge.

- [x] `parentId` on Task, recursion forbidden; ordered under the parent in the
      detail panel; hidden from top-level lists by default (expand affordance).
- [x] Individually committable to Today (start a scary task via its smallest
      step); parent shows quiet n/m progress.

### ☑ 6 — Blocked-by dependencies *(tasks · design check-in first)*

> **Done 2026-06-12** (Fable, branch `t/maciej/session6-blocked-by`). Design
> check-in resolved with Maciej (4 questions): full transitive cycle trigger
> (recursive CTE); commit-on-blocked = offer frontier + "Commit anyway"
> escape hatch; edge UI in the detail panel only; hosted migration
> pre-approved. Spec gained **§5c**; vocabulary gained "Blocked / Frontier".
> Migration `20260612140000_task_relations.sql` applied to hosted + trigger
> validated by SQL probe. Live-verified end-to-end. See build log.

- [x] Decide the model with Maciej. Proposal taken as-is: `task_relations`
      edges (blocker → blocked); **computed** blocked state (drift pattern);
      blocked tasks render dim/quiet, never red; cycles forbidden (any
      length, DB-enforced).
- [x] The frontier walk: from any task, "what's actually next" = its unblocked
      frontier; committing a blocked task offers the frontier (quiet dialog,
      commit-anyway escape hatch; un-commit never intercepted).

### ☑ 7 — Recurrence engine *(tasks · ADHD-critical)*

> **Done 2026-06-12** (Fable, branch `t/maciej/session7-recurrence`, stacked on
> Session 6's branch while PR #16 is open). **Single-row model** (spec **§5d**):
> one task row cycles; `scheduledAt` carries the current occurrence,
> `recurrence.nextOccurrence` is the stored pointer. **Zero schema change**
> (the jsonb column + Rust parity existed since the first tasks migration).
> Completion stays visibly done for the day (Execute n/m intact); catch-up on
> open reopens/collapses. Skip ≠ reschedule (no counter). Live-verified
> end-to-end against hosted incl. a backdated catch-up + idempotency probe.
> See build log.

- [x] Advance-on-done; **missed occurrences don't exist** (no backfill, no
      "7 overdue" — there is only the next occurrence). *(Pointer advances
      from `max(now, scheduledAt)` — completing early skips the pending
      occurrence; quiet "Done — next …" toast.)*
- [x] Catch-up semantics on app open; skip-occurrence affordance. *(One
      idempotent pass per bundle load: done+pointer-arrived → reopen at the
      latest occurrence ≤ now, stale commit cleared; open+missed → collapse
      forward to one quiet drift. Skip lives in the detail panel + row/card
      context menus; the panel gained an editable Repeat preset field.)*

### ☑ 8 — Intent ops + activity *(platform · per-module contract, Tasks first)*

> **Done 2026-06-12** (Fable, branch `t/maciej/session8-intent-ops`). New
> anchor doc [docs/moduo-module-contract.md](./moduo-module-contract.md) (the
> four pillars + Tasks reference table); spec gained **§11b**, vocabulary
> gained "Intent op" + "Activity". Migrations
> `20260612150000_module_activity_intent_ops.sql` +
> `…151000_intent_ops_revoke_anon.sql` **applied to hosted** (Maciej's
> go-ahead after the classifier gate, same as Sessions 4/5) and live-verified
> end-to-end incl. security probes (forged activity INSERT rejected; anon RPC
> rejected). Incidental token fix: `--z-dropdown` 40 → 70 (dropdowns inside
> dialogs were unclickable app-wide). See build log.

- [x] Define the module contract (ops naming, actor field, activity table,
      registration shape) — see Cross-module AI-readiness above.
      *(`docs/moduo-module-contract.md`; registration = typed manifests:
      `src/lib/module-manifest.ts` + `module-registry.ts` +
      `src/features/tasks/ops-manifest.ts`.)*
- [x] Implement for Tasks: commit/reschedule/triage/recurrence invariants move
      from the React hook into backend RPCs. *(8 `tasks_op_*` RPCs: commit/
      uncommit/skip-today/set-status/reschedule/unschedule/skip-occurrence/
      batched catch-up — each checks edit permission server-side (new
      `tasks_module_permission()` ladder; RLS alone only checked membership),
      enforces invariants, and logs attributed activity in one transaction.)*
- [x] Activity trail rendered in the task detail panel. *(Quiet newest-first
      trail, actor attribution, op→sentence vocabulary in `activity.ts`.)*

### ☑ 9 — MCP connector v1 *(platform · cloud)*

> **Done 2026-06-12** (Fable, branch `t/maciej/session9-mcp-connector`,
> stacked on Session 8's branch while PR #18 is open). New anchor doc
> **[docs/moduo-mcp-connector.md](./moduo-mcp-connector.md)**. One stateless
> edge function (`supabase/functions/moduo-mcp/`, hand-rolled MCP Streamable
> HTTP — 8 read tools, 7 intent-op write tools, recurrence-engine port) +
> `workspace_api_keys` migration (`20260612160000` + search_path follow-up
> `…161000`) + Settings UI (workspace modal → API keys: create /
> reveal-once / revoke, view default). The auto-mode gate blocked the hosted
> steps mid-session (same as Session 8); **Maciej approved**, migration
> applied + `moduo-mcp` deployed (`verify_jwt = false`) and the full live
> probe checklist passed, incl. the header-spoof and revoked-key rejections
> and "Probe edit key committed this…" rendering in the app trail. See
> build log.

- [x] One Moduo MCP server with per-module registration; Tasks is module #1.
      *(`moduo-mcp` edge fn; connector registry + `modules/tasks.ts`;
      key-pinned workspace, no workspace args on tools.)*
- [x] Read-only resources first (buckets, tasks, queue, drift, tags, search).
      *(8 view-scope tools incl. `tasks_get` + `tasks_activity`, computed
      drifted/blocked.)*
- [x] Writes exclusively via Session 8 intent ops; scoped API keys on the
      none/view/edit permission model. *(7 ops, `catch_up` excluded;
      `workspace_api_keys` hashed secrets, view default, admin never
      key-grantable; `actor_type='api_key'` via the service-role-only
      header path.)*
- [x] Document the "onboard a module to MCP" recipe so Notes/Mail/Calendar
      follow without redesign. Local-LLM/offline MCP stays deferred to the
      lite version. *(docs/moduo-mcp-connector.md.)*

### ☐ 10 — Theme shades + tokenization deepening *(design · anytime after 1)*
- [ ] `data-shade` axis: curated tinted-dark presets (warm/cool/slate/…),
      Settings picker, same cascade mechanism as `data-accent`.
- [ ] Audit for token bypasses while in there.

### ☐ 11 — Tasks UI/UX pass *(design · scope TBD with Maciej)*

> Added 2026-06-12: Maciej isn't happy with how Tasks looks overall and wants
> visual modifications — deferred while features land. No other session covers
> this (1 was density, 10 is shades/tokens; the polish backlog is small
> mechanics, not look-and-feel). Start with a design critique / brief session
> with Maciej (what specifically reads wrong: hierarchy? chrome? spacing?
> typography?), then restyle the Tasks surfaces against it. Natural pairing:
> run alongside or right after 10, since both touch the token layer.

- [ ] Collect the critique → brief (`.design/` doc) with Maciej.
- [ ] Restyle Tasks surfaces (rail, rows, cards, detail panel, Execute)
      against the brief; fold in the polish backlog items that fit.

## Model assignment (decided with Maciej, 2026-06-12)

- **Opus-tier sessions** (UI on existing surfaces, strong guardrails):
  **3, 4, 10**. After each, a Fable `/code-review` pass on the branch before
  merge — review is cheap relative to authoring.
- **Fable-tier sessions** (semantics / platform / security): **7, 8, 9** —
  recurrence edge cases, server-side invariants, API-key scopes. **5/6**
  borderline; 6 starts with a Maciej design check-in either way.
- Either way the session protocol's verification gates (typecheck, vitest,
  lints, live verify against hosted — test account in build-log Session 2)
  are mandatory; they are the model-agnostic safety net.

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
