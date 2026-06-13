# Build Tasks: Tasks UI/UX rebuild (Session 11)

Generated from: [.design/tasks-polish/BRIEF.md](./BRIEF.md) · Decisions: [DECISIONS.md](./DECISIONS.md)
Date: 2026-06-13 · Branch: `t/maciej/session11-tasks-ui` · Delivery: one PR, internal waves.

**Conventions:** kebab-case files; new `src/components/ui/` primitives need a `<name>.stories.tsx`
(rule 5) + a row in [tests/visual/primitives.spec.ts](../../tests/visual/primitives.spec.ts) (rule 4).
shadcn = new-york, css vars on [tokens.css](../../src/styles/tokens.css), `bunx shadcn@latest add …`.
Verify gate after each wave: `bun run typecheck · test · lint:tw · lint:css · build:web`.
**Aesthetic:** Linear (dense, quiet, hairline, strong type hierarchy) + Todoist/TickTick (content-first).
Motion: restrained + **fade/micro-blur** signature; one delight (check-off). Accent budget: one primary
action per pane · selection · focus ring · quiet done-check; segmented + priority stay neutral.

---

## Wave 1 — Foundation (tokens + global) ✅ DONE (verified live + lint green)
- [x] **F1 · `*`-rule fix**: replaced `* { font-family: "Pilat Extended" … }` → `var(--font-body)`. Verified: unclassed text now Geist, `font-display` still wins. **Deviation from brief:** did NOT flip Label/SelectTrigger bases to display — a Select's *value* is content → stays **body** (consistent with titles→body); the per-call `font-display` overrides get removed in Wave 3 instead. _Modified: [global.css](../../src/global.css)._
- [x] **F2 · Icon tokens**: added density-scaling `--icon-xs/-sm/-base/-lg` (comfortable 12/14/16/20 · compact 12/14/15/18 · dense 11/12.5/14/16) + `@theme` `--spacing-icon-*` → `size-icon-*` utilities. Default density KEPT `comfortable`. _Modified: tokens.css._
- [x] **F3 · Motion tokens**: added `--motion-fade` (kept ~80ms under reduced-motion) + `--blur-veil` (→0 under reduced-motion); movement durations still zero under reduced-motion. _Modified: tokens.css._

## Wave 2 — Shared primitives (`src/components/ui/`, each + story; visual-test rows deferred to W5)
- [x] **P1 · FieldShell** ✓: `field-shell.ts` cva (`filled`/`ghost`/`bare`), modern ring (`ring-2 ring-ring/50`, no offset — `ring-[3px]` avoided to stay lint-clean); Input gains `variant`+`size` (Omit native `size`), Textarea + SelectTrigger compose it; all bumped to text-base (14). _New: field-shell.ts; Modified: ui/{input,textarea,select}.tsx + input.stories._
- [x] **Button retune** ✓ (part of the control ladder): base text-sm→**text-base**, removed per-size font overrides (font constant across rungs), svg→`size-icon-sm`, modern ring, motion-token transition. _Modified: ui/button.tsx._
- [x] **P2 · SegmentedControl** ✓: built on `radix-ui` ToggleGroup (no CLI needed — unified pkg), neutral raised-plate active, `size`/`items`/`iconOnly`, single-select guard. _New: ui/segmented-control.tsx + story._
- [x] **P3 · IconButton** ✓: wraps Button `size=icon` + **required** `label` (aria-label + Tooltip), `sm`/`md` rung. _New: ui/icon-button.tsx + story._
- [x] **P7 · Toolbar** ✓: layout primitive (`Toolbar`/`.Group`/`.Spacer`/`.Primary`). _New: ui/toolbar.tsx + story._
- [x] **P4 · Calendar + DateField** ✓: installed `react-day-picker@10` + `date-fns@4`; token-routed Calendar (selected `bg-primary`, today ring, hover `bg-accent`); `DateField` = ghost/outline Button trigger + Popover, `withTime` (HH:mm Input), Today/Tomorrow/Next-week presets, Clear. _New: ui/{calendar,date-field}.tsx + stories._ (Wire into surfaces in S4/S6.)
- [x] **P5 · TagChip v2** ✓: dropped the dot, `#` hued via `.tag-hash`, neutral name, borderless `text-2xs`; active chip = full-hue (`.tag-chip-active`). _Modified: components/tag-chip.tsx, global.css; New: tag-chip.stories.tsx._
- [x] **P6 · CompleteToggle** ✓: promoted to `ui/complete-toggle.tsx`; check springs in (`.check-pop`, reduced-motion → none); modern ring; updated 3 import sites (row/card/detail). _New: ui/complete-toggle.tsx + story._
- [x] **P8 · EmptyState** ✓: generic `ui/empty-state.tsx` (icon/title/description/action/hint); list-view's empty state now composes it. _New: ui/empty-state.tsx + story._

## Wave 3 — Surfaces (compose the primitives)
- [x] **S1 · Top toolbar** ✓: `Toolbar` + `SegmentedControl` (List/Board aligned at 26px). Group/Columns control → **ghost Select** (drops the filled-well + the `font-display` override; quiet, coherent) — chose ghost-Select over a separate DropdownMenu-radio for simplicity; flag for review. _Modified: plan-view-header.tsx, task-list-view.tsx, task-board-view.tsx._
- [x] **S3 · Rail + sections** ✓: section eyebrows display→**body** (narrower/quieter at 11px — the "too large" was the wide Pilat + zoom); ModeToggle → `SegmentedControl` (full-width); "Today"→"Queue" + ListChecks. _Modified: bucket-rail.tsx._
- [x] **S4 · Detail panel** ✓ (core): native date inputs → **DateField** (verified: June 2026 calendar + presets + time); all property selects → **ghost**; title/eyebrows → body. _Deferred: full inline label→value PropertyRow grid (kept the `Field` stacked layout, now quiet via ghost controls)._ _Modified: task-detail-panel.tsx._
- [x] **S5 · Board** ✓: Linear-quiet — cards `bg-card`+hairline (fixes inverted elevation), columns **transparent**; **drag grip removed** (verified 0 grips; whole card draggable); selection recipe parity. _Modified: task-board-view.tsx, task-card.tsx._
- [x] **S6 · Capture modal** ✓: chromeless (no "New task" band; floating close); title 20px display, description body; date pills → **DateField**; dead attachment button removed. _Modified: capture-modal.tsx._
- [x] **S7 · "Today"→"Queue" rename** ✓: rail, mode toggle (Plan/Queue), scope title, row/card queue toggle + context menus, detail commit (now `bg-primary`), frontier dialog, execute heading. Internal `committed_for`/"today"/`execute` model unchanged. _Modified: 7 files._
- [x] **S8 · Queue/Execute card** ✓ (restyle): heading "Queue"; **timer compact** (text-6xl→text-3xl, body+tabular); ModeToggle → `SegmentedControl`; **x/y label moved back to the bottom**; **empty "Linked" placeholder removed**. _Time-spent mode + estimate-chip land with Wave 4 (migration-gated)._ _Modified: execute-view.tsx._
- [x] **S2 · Task row** ✓ (core): no hover reflow (schedule/due reserve-space + fade, was `hidden→flex`); **title body/15px**; selection = accent bar + **faint accent tint** (`--selected-bg`, verified `rgb(37,21,28)` on black); **always-visible quiet queue toggle** (ListChecks; committed→accent, idle→faint, darkens on hover — unifies marker + action); subtask **indent guide** (vertical hairline); TagChip v2 + CompleteToggle already flow in. _Deferred: `q` keyboard shortcut (secondary); meta-icon density-scaling (minor)._ _Modified: task-row.tsx, tokens.css (--selected-bg/-border)._
- [ ] **S3 · Rail + sections** → section headers = display eyebrow uppercase `text-2xs` muted/70 (stay 11px, read quieter), rows on `--row-h`, active = selection recipe, inline editors use FieldShell `bare`. _Modifies: bucket-rail.tsx. Depends: P1._
- [ ] **S4 · Detail panel** → `PropertyRow` (inline label→value grid), ghost FieldShell controls, DateField for dates, one `bg-primary` "Commit to Queue", quieter activity trail. _Modifies: task-detail-panel.tsx; New: features/tasks/ui/property-row.tsx. Depends: P1,P4._
- [ ] **S5 · Board** → **Linear-quiet**: transparent columns on the card pane, cards `bg-card` + hairline (fixes inverted elevation); **whole card draggable, grip removed**; selection parity with List; group control = SegmentedControl/DropdownMenu. _Modifies: task-board-view.tsx, task-card.tsx. Depends: P2, F2._
- [ ] **S6 · Capture modal** → remove "New task" band, borderless title (20px display) + body description, property pills on one quiet neutral row, DateField, footer primary + `⌘↵` hint; keep chrono parse + pill pre-fill; hide dead attachment button. _Modifies: capture-modal.tsx. Depends: P1,P4._
- [ ] **S7 · "Today" → "Queue" rename** → rail label, mode toggle **Plan / Queue**, verbs ("Add to queue"/"Queued"), icon **ListChecks**, row/card menus, [activity.ts](../../src/features/tasks/activity.ts) vocab; keep the `committed_for(date)` model (UI-only). Update spec wording. _Modifies: bucket-rail.tsx, tasks-plan-view.tsx, execute-view.tsx, task-row/card, activity.ts, docs/spec._
- [ ] **S8 · Queue/Execute card** → re-hierarchy (title + key details prominent, **timer compact**), `SegmentedControl` **Pomodoro | Time-spent** + static editable **estimate chip**, **x/y completed label back at the bottom**, **linked section hidden when empty**. _Modifies: execute-view.tsx. Depends: P2; pairs with W4._

## Wave 4 — Time-tracking (GATED — held for Maciej's hosted-migration go-ahead; split to follow-up)
Irreversible shared-DB change → not applied unattended. The Execute card is restyled (S8);
the tracker lands once the migration is approved. Supabase-only (NO Rust — tasks are Supabase-direct).
- [ ] **T1 · Migration + intent-op**: `task_time_entries` (workspace_id, task_id, started_at, ended_at, source) + cached `time_spent_seconds`; RLS; `tasks_op_track_time` RPC (start/stop, edit-permission, `module_activity` attribution). _Skills: /supabase + supabase-postgres-best-practices._
- [ ] **T2 · Runtime + tracker UI**: `runtime.web.ts` track-time methods; Queue-card stopwatch (Time-spent mode) + static estimate chip; detail-panel total + session list. _Depends: T1, S8._
- [ ] **T3 · Pomodoro settings**: persisted prefs in Settings → **Focus** + a card gear popover.

## Wave 5 — Review & docs
- [x] **R1 · Gate**: typecheck ✓ · vitest 91/91 ✓ · lint:tw ✓ · lint:css ✓ · build:web ✓.
- [x] **R4 · Docs**: DESIGN_SYSTEM.md addendum (control/type/icon ladders, primitives, motion, accent policy); build-log entry; improvement-plan Session 11 ☑.
- [ ] **R2 · /design-review** + **R3 live cross-accent/density/shade verify** + project **/code-review** — recommended next, with Maciej's review.
- [ ] **Visual-test baselines** — rows added to primitives.spec.ts; PNGs need a Storybook+Playwright `--update-snapshots` run (human-committed).
