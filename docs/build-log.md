# Moduo Tasks Module — Build Log

Breadcrumbs between Claude Code sessions. Newest first. Each entry: what was
built, key decisions, and anything deferred or broken. Pairs with
`moduo-tasks-feature-spec.md` (the anchor) and `moduo-architecture-vocabulary.md`.

---

## Improvement-plan Session 3 — Task detail panel + ambient mirrors (2026-06-12)

Branch `t/maciej/session3-task-detail` off `maciej`. The right rail stops being a
"Context" placeholder and becomes a live task inspector; the first ambient mirror
(`rescheduleCount`) finally renders.

**New: the detail rail** ([task-detail-panel.tsx](../src/features/tasks/ui/task-detail-panel.tsx)).
Binds to the selected task, resolved **live from the bundle** in
[tasks-plan-view.tsx](../src/features/tasks/ui/tasks-plan-view.tsx) (so it follows
edits and empties when the task is deleted). Editable title (borderless but keeps
the focus ring — a11y) + description (commit-on-blur), and all properties as a
compact list: status / bucket / scheduled / due / priority / energy / duration as
shadcn `Select` + `Input`, recurrence shown **read-only** (the capture parser owns
creation), and a Commit-to-today toggle. Every write goes through `api.patchTask`
(optimistic) — **no new write paths**. Created/updated metadata at the bottom.

**Ambient mirrors (principles 4 & 5).** `rescheduleCount` renders as
"Rescheduled N×" (muted, factual, **never red**) only when > 0 — the first mirror
that was being incremented but shown nowhere. Drift gets a quiet one-liner in the
same block when `isDrifted(task)`.

**Selection lifted** (pre-flight item b). The task cursor was local to
`task-list-view.tsx`; it's now `selectedTaskId` in `tasks-plan-view.tsx` (a
**distinct name** — `selection` there still means bucket scope) threaded to both
views via `sharedViewProps`. List keeps its keyboard cursor (j/k) but is now
*controlled* (the `selectedId`/`setSelectedId` aliases keep that logic intact);
the existing auto-select-first effect means the rail is populated on entry. Board
got **select-on-click** ([task-card.tsx](../src/features/tasks/ui/task-card.tsx) /
[task-board-view.tsx](../src/features/tasks/ui/task-board-view.tsx)) — available to
view-only users too, since selecting to read details isn't an edit.

**Distinct selected state (pre-flight item c).** Rows already had
`bg-accent` vs `hover:bg-accent/60` (opacity-only, easy to confuse); added a quiet
`bg-primary` left accent bar to the selected row
([task-row.tsx](../src/features/tasks/ui/task-row.tsx)). Board cards get
`border-ring bg-accent` when selected. Teaching empty states: the detail rail's
empty state and the list's empty state both surface "press `c` to capture".

**Verified:** typecheck ✓, lint:tw ✓ (new files are token-clean, not in
`IGNORED_PATHS`), lint:css ✓ (same 5 pre-existing global.css warnings, 0 errors),
vitest 24/24 ✓, `build:web` ✓. **Live on web** against hosted with the Session 2
disposable account: `/tasks` loads the test workspace, the rail replaces the
Context placeholder and auto-selects the first task showing every property +
created/updated; then **Commit-to-today → Execute → Skip** surfaced
**"Rescheduled 1×"** in the rail — the mirror, end-to-end. (Test task's
`rescheduleCount` is now 1; left as demo data.)

**Env note for future live-verify:** the Claude preview sandbox binds to whichever
worktree owns the active dev server (another session held `:8081`), and worktrees
don't share the repo's `node_modules`. Workaround used: `bun install` in the
worktree (1.4s, hardlinked) + a local `web-s3` launch config on `:8091`
(`.claude/launch.json`, gitignored), driven via the Chrome MCP. Display is
high-DPI (innerWidth 2207); full-frame screenshots need the left rail collapsed.

**Next per plan:** a Fable `/code-review` pass on this branch before merge
(Opus-session policy). Not merged — awaiting review + authorization.

**Deferred:** title/description are the only inline-edit *text* fields; board
within-column reorder + insertion indicators and ⌘K task actions stay in the
polish backlog.

---

## Improvement-plan Session 2 — Cloud consolidation (2026-06-12)

Branch `t/maciej/cloud-consolidation` off `maciej`. Desktop and web now share
one Supabase-backed code path for auth, workspaces and tasks; time-blocks moved
from localStorage to a workspace table. The cloud-first pivot is now *in the
code*, not just the plan.

**Hosted state surprise (resolves the Mike-coordination item).** Pre-session
`list_migrations` on hosted (project `wtoonrvuqumihpkbvwvs`) showed Mike's six
`20260605*` notes migrations **already applied**, and our tasks migrations
applied too (hosted versions `20260611131017/131039`, fresh timestamps from an
MCP apply on 2026-06-11) — plus a `task_time_blocks` migration
(`20260611132737`) that existed on hosted but not in the repo. Treated hosted
as ground truth and back-filled
[20260611132737_task_time_blocks.sql](../supabase/migrations/20260611132737_task_time_blocks.sql)
(verified column-for-column incl. `ON DELETE CASCADE` and the
`tasks_module_can_access_workspace` RLS policy). `mike` → `develop` timing is
only relevant when desktop notes migrate (later session).

**Desktop → Supabase as composition** ([runtime.tauri.ts](../src/lib/runtime.tauri.ts)):
`auth`, `workspace` and `tasks` are now literally `webRuntime.auth` /
`.workspace` / `.tasks` — zero forked logic. Everything else (notes, email,
time-tracking, calendar OAuth, integrations, graph, localStore, window) stays
invoke-based. Because Rust commands gate on `state.session`
(`require_user_id`), a new **`auth_set_cloud_session`** command
([commands/auth.rs](../src-tauri/src/commands/auth.rs), registered in lib.rs)
mirrors the Supabase session into `AppState` — pushed from runtime.tauri.ts on
every `onAuthStateChange` (INITIAL_SESSION covers boot restore; `null` on
sign-out also stops email IDLE workers). Capabilities: `hasLocalMnemonic` and
`hasOfflineMode` flipped to false.

**Lite-version seam (Maciej's constraint: don't block offline-then-sync).**
The `ModuoRuntime` interface is the seam: the vault/PIN auth UI flows in
[email-auth-panel.tsx](../src/components/auth/email-auth-panel.tsx) now key off
`capabilities.hasLocalMnemonic` (not `isWeb`), so the future lite runtime
re-activates them by flipping a capability — same for the Login-key section in
[account-section.tsx](../src/features/settings/sections/account-section.tsx).
All local-auth Rust commands and redb tables stay. Orphans parked for the lite
story: `notes_outbox` / `notes_oplog` redb tables (sync-engine skeleton,
never populated), `auth_register_local_mnemonic` & friends (unreachable from
the UI until a runtime exposes `hasLocalMnemonic`).

**Time-blocks → workspace data.** `runtime.tasks.getTimeBlocks/setTimeBlocks`
(types in [runtime.types.ts](../src/lib/runtime.types.ts), impl in
[runtime.web.ts](../src/lib/runtime.web.ts)); `TimeBlockSlot/Map` +
`sanitizeTimeBlocks` moved to [model.ts](../src/features/tasks/model.ts)
(default-view re-exports). [use-tasks-module.ts](../src/features/tasks/hooks/use-tasks-module.ts)
loads them with the bundle (non-blocking on failure) and exposes
`timeBlocks` + `setTimeBlock` (optimistic); plan-view's localStorage
read/write deleted. Spec §9 wording updated. Mode/selection/grouping stay
per-device localStorage.

**Auth panel & profile on cloud:** web `getLocalAuthState` now derives
profileExists/displayName/userId from the Supabase session (was an all-false
stub), so app-chrome and Settings → Account display names work on web and
desktop unchanged. Dead `auth_link_to_cloud` / `auth_sign_in_cloud` invokes
went away with the replaced namespace.

**Docs:** CLAUDE.md stack line rewritten (Supabase source of truth; redb =
desktop-only leftovers + future lite); `web+desktop_plan.md` retired with a
banner (its pending todos spec the never-built auth-link hybrid — do not
implement); plan Session 2 checked off with findings.

**Verified:** typecheck ✓, vitest 24/24 ✓ (default-view tests rewritten:
localStorage cases → `sanitizeTimeBlocks`), `cargo check` ✓, lint:tw ✓,
lint:css unchanged (5 pre-existing global.css warnings), `build:web` ✓.
**Live end-to-end on web** against hosted with a disposable account
(`grzywaczmj+moduo-s2-test@gmail.com` / workspace "Claude Test S2", left in
place for dogfooding): trial start → onboarding workspace create → Tasks
Inbox seed → bucket "Deep Work" → task create → **Open at → Morning** →
reload → slot restored from `task_time_blocks` (DB row confirmed; zero
localStorage timeblock keys). Handled Inbox-seed 409 race observed working.
**Not live-verified: the desktop (Tauri) runtime composition** — same TS code
path and `cargo check` passes, but `auth_set_cloud_session` + webview
supabase-js need one `bun run dev:desktop` boot + sign-in to gut-check; flagged
for next session / Maciej's dogfood.

**Deferred:** desktop notes → Supabase (Mike's surface; after his branch
lands); legacy sync-engine removal decision (skeleton still compiles, unused);
`user_entitlements` 401 noise during pre-session-restore renders (pre-existing,
web-only, self-heals) — worth a look whenever the SubscriptionGate is next
touched.

---

## Interlude — Session 1 merged · Session 2 scope check (2026-06-11)

Session 1 fast-forwarded into `maciej` (`0775a21`) and pushed; task branch
deleted per CONTRIBUTING. Before starting Session 2, Maciej asked whether the
plan matches the actual cloud/persistence state (the area is traditionally
Mike's). Investigation findings (two read-only sweeps: codebase + git):

- **Desktop has no Supabase session.** `runtime.tauri.ts:237-258` invokes
  `auth_link_to_cloud` / `auth_sign_in_cloud`, but those Rust commands don't
  exist. The sync engine (`src-tauri/src/sync/mod.rs`) covers only
  `notes_meta` + `calendar_events`; the tasks tables are absent from
  `SYNC_TABLES`/`PULL_TABLES`, no write ever enqueues, there are no
  camelCase↔snake_case mappers, and even the notes outbox is never populated.
  → Finishing sync would mean *building* the paused local-first architecture;
  Supabase-direct in the webview (reusing `runtime.web.ts` paths) is the
  cheaper, validated option.
- **Composition, not swap.** Email, time-tracking, calendar OAuth,
  integrations, and graph are Rust/redb-only (web stubs them "Desktop only").
  Desktop keeps Tauri-invoke for those; only auth/workspaces/tasks go
  Supabase-direct in Session 2.
- **Mike's state**: his May cloud/billing/runtime-split infra is already in
  `main`. His active branch (`origin/mike`, forked off develop 2026-05-14,
  never pulled since, last push 2026-06-07) is notes-only — 14 commits
  touching `commands/notes.rs` + NotesSplitView restructuring + **six notes
  migrations dated 2026-06-05**, i.e. earlier timestamps than our tasks
  migrations (2026-06-06). He never touched tasks files post-fork (his branch
  still carries the deleted legacy tasks model; a future develop sync deletes
  it cleanly). Conflict risk concentrates in notes at his next sync.
- Plan Session 2 amended accordingly: Mike-coordination item first, desktop
  notes phased out of scope, `web+desktop_plan.md` retirement added (it specs
  the never-built auth-link hybrid), dead-invoke cleanup added.

**Open inputs for Session 2** (gather before/at session start): Mike's two
answers — hosted notes migrations applied? `mike` → `develop` timing? — and
Supabase project access (dashboard or `supabase link`) for the hosted apply.

---

## Improvement-plan Session 1 — Density & type-scale pass (2026-06-11)

Branch `t/maciej/density-type-scale` off `maciej`. First session of the 2026-06
improvement plan ([improvement-plan.md](./improvement-plan.md)): make density +
text-size a real, well-tuned customization range whose dense end ≈ Linear/Notion.

**Third density step** ([tokens.css](../src/styles/tokens.css) §7,
[appearance.ts](../src/lib/appearance.ts),
[density-picker.tsx](../src/features/settings/appearance/density-picker.tsx)):
`data-density` is now `comfortable | compact | dense` on an even 4px row ladder —
rows 36 / 32 / 28, controls 32 / 30 / 26 (sm 26 / 24 / 22, lg 40 / 36 / 32),
pads 16·10 / 14·8 / 12·6 (sm 12·6 / 10·5 / 8·4). **Dense** is the Linear/Notion
end (28px rows ≈ Linear sidebar / Notion list); comfortable is untouched, and
compact moved from the old near-dense values (28px rows) to the true middle
(32px). Old `compact` users land between their old feel and the new dense option.

**Type-scale retune** (tokens.css §9): body-tier base ladder is now
**13 / 14 / 16 px** across small / normal / large (was 13 / 15 / 17) — small ≈
Linear UI text, normal ≈ Notion chrome (default drops 15→14, addressing the
"app reads larger than Notion/Linear" feedback), large stays generous. `--text-md`
follows at +1 (14 / 15 / 17). Display sizes (lg+) stay fixed, as documented.
Notes *content* is unaffected (the Lexical editor hardcodes 16px — pre-redesign
file, untouched per the tw-shim rule).

**Rows actually respond now** — the real reason "compact" never read as compact:
module rows hardcoded `py-1.5` and ignored `--row-h`. Task rows
([task-row.tsx](../src/features/tasks/ui/task-row.tsx)), bucket-rail rows
([bucket-rail.tsx](../src/features/tasks/ui/bucket-rail.tsx)), Execute queue rows
([execute-view.tsx](../src/features/tasks/ui/execute-view.tsx)) and drift-triage
rows ([drift-triage-dialog.tsx](../src/features/tasks/ui/drift-triage-dialog.tsx))
now take `min-height: var(--row-h)` (same idiom as notes/settings) with `py-0.5`
kept only as a multiline guard. Buttons/inputs/selects already rode `--ctrl-h*`;
FeaturePanelsShell already rode `--pad-*`. Board cards and the drag ghost stay
fixed (cards, not rows).

**Storybook appearance toolbar** ([.storybook/preview.tsx](../.storybook/preview.tsx)):
new Density and Text-size toolbar globals apply `data-density` / `data-text-size`
to the document, mirroring `useAppearance`. Spot-check script
[scripts/density-snapshots.mjs](../scripts/density-snapshots.mjs) (Playwright
against Storybook) screenshots shell/button/input across the range and prints
the resolved `--row-h`/`--ctrl-h`/`--text-base` per combo.

**Docs synced first:** `DESIGN_SYSTEM.md` attribute table;
`.design/foundation/TOKENS.md` density table (3 columns + pad-sm rows + the
min-height row recipe) and type-scale tables (14px base).

**Verified:** typecheck ✓, lint:tw ✓, lint:css unchanged (same 5 pre-existing
`global.css` warnings), vitest 24/24 (incl. default-view 14/14), web production
build ✓. Visual spot-check via the snapshot script: token cascade confirmed
end-to-end (36/32/28 rows, 14→13px base at small) on shell, buttons, inputs at
all three densities. **Not hand-dogfooded** in the real app (same Supabase
auth gap as Sessions 2–4); the Tasks-row wiring uses the proven notes idiom but
deserves a desktop-run gut check on feel.

**Flags for Maciej:**
- **Default got 1px smaller** (`--text-base` 15→14). Intentional per your
  density feedback, but it shifts the whole app's default voice — eyeball it.
- **Compact loosened numerically** (rows 28→32) while becoming *visually*
  denser in Tasks (rows previously ignored the token). If you had muscle-memory
  for old compact, **dense** is your setting now.
- Density still doesn't shift line-height (TOKENS.md open question stands —
  revisit if dense+small feels cramped).

**Deferred:** none for this session. (Launch config gained a `storybook` entry
on port 6106 — 6006 was busy on this machine.)

---

## Session 4 — Board view + drift triage + default-view (2026-06-06)

Branch `maciej`. Filled in the remaining Plan-mode surface: the three items
deferred at the end of Session 3.

**Board view** ([ui/task-board-view.tsx](../src/features/tasks/ui/task-board-view.tsx),
[ui/task-card.tsx](../src/features/tasks/ui/task-card.tsx)): kanban columns via
`@dnd-kit/core` (already a dep; same `PointerSensor` distance-8 + `DragOverlay`
pattern as the dashboard grid). Columns group by **status** (Todo → In progress →
Done, left→right; Archived excluded) or by **bucket** when in the "All" selection
(a Columns: Status/Bucket control appears only there). **Cross-column drag** is the
kanban action — drop changes `status` (or `bucketId`) and appends to the
destination column's end (`endPosition`); dragging to Done completes the task.
Columns are `useDroppable`, cards are `useDraggable` (single `onDragEnd`, no
live-cross-container move → robust, no flicker). Within-column manual reordering is
**deferred** (consistent with the already-deferred Today-queue drag). The card
reuses `CompleteToggle` / `LevelDots` (now exported from `task-row`) and has a
compact self-contained context menu (done, commit, move-to-bucket, priority,
energy, delete).

**View switcher + shared header** ([ui/plan-view-header.tsx](../src/features/tasks/ui/plan-view-header.tsx)):
List/Board segmented toggle (mirrors the rail's Plan/Execute toggle styling),
plus a `PlanViewHeader` (title · group control · switcher · New task) now used by
**both** List and Board so they're visually identical above the fold. `view`
persisted per workspace; `boardGroupBy` persisted separately from List's `groupBy`
so each view keeps its own grouping.

**Drift batch-triage** ([ui/drift-triage-dialog.tsx](../src/features/tasks/ui/drift-triage-dialog.tsx)):
the per-bucket drift count in the rail is now a **button** (`(3)` → opens triage;
tooltip "N open · M drifted — click to triage"); also reachable from the bucket
"…" menu ("Triage N drifted…"). Dialog is soft/pressure-free (factual copy, never
red/overdue) with batch ("apply to all") and per-task actions: **Reschedule**
(Tomorrow / Next week, keeps clock time → `rescheduleScheduledAt`), **Archive**
(`archiveTask`), **Ignore** (clears `scheduledAt`, keeps the task). The list
recomputes live so it empties as you triage. New hook helpers: `archiveTask`,
`rescheduleScheduledAt`.

**Default-view logic** ([default-view.ts](../src/features/tasks/default-view.ts)):
on open, resolve **time-block bucket → last-opened bucket → Inbox**, in the
**last-used view** (spec §9). Never opens on "All"/"Today" (last bucket is tracked
separately from the live selection; resolution is one-shot per workspace after the
bundle loads, so it never fights in-session navigation). **Time-blocks** are
defined per-bucket via the rail's **"…" → "Open at"** submenu (Morning 05–12 /
Afternoon 12–18 / Evening 18–05, wrapping; one bucket per slot), stored per
workspace in localStorage as a view preference — no separate editor surface
(quiet until used). Pure resolver + slot logic covered by **14 unit tests**
([default-view.test.ts](../src/features/tasks/default-view.test.ts)).

**Decisions / spec sync (updated spec first, then code):**
- §4 — drift "Ignore" defined as *clear the stale time, keep the task* (drift is
  computed, not stored, so there's no acknowledge-and-keep without a new
  `drift_acknowledged_at` field — deferred until asked).
- §9 — documented how time-blocks are defined (per-bucket "Open at" menu, 3 slots,
  localStorage, one-shot resolution).
- §4 — documented Board column order / drag semantics / within-column-reorder
  deferral / Today-as-status-columns.

**Verified:** `bun run typecheck` clean; `bun run lint:tw` clean; `lint:css`
unchanged (0 errors; same 5 pre-existing `global.css` warnings); `vitest`
default-view 14/14; **web production build** compiles. Dev server boots clean (no
errors). **Not interactively hand-dogfooded:** the web path is gated behind
Supabase magic-code auth (can't log in headlessly — same gap as Sessions 2–3); a
real run needs the desktop app or a logged-in session.

**Flags for Maciej (spec tensions surfaced while building):**
- **"Ignore" UX** — current behavior unschedules the task. If you expect "ignore"
  to keep the past time but stop counting it, that needs the stored ack flag above.
  Worth a dogfood gut-check on which feels right.
- **Board on Today** — I let Board render status columns of the committed set for
  uniformity. Spec says "Today is never grouped (queue order)"; if Today-as-board
  feels wrong, we can force List when Today is selected (one-line change).
- **Time-block editor placement** — the per-bucket "Open at" menu is intentionally
  minimal/discoverable, but it's a provisional home. If you want a dedicated
  time-blocks surface (e.g. a settings card with a visual day strip), say so.
- **Time-blocks are local-only** (not synced). Fine for a single-device dogfood;
  flag if you want them to follow the workspace across devices.

**Deferred:** within-column drag reorder on the board; true drift "acknowledge"
(stored flag); synced time-blocks; right-panel content; live cloud-sync of the
redb↔postgres tables. Calendar module remains separate/unbuilt.

---

## Session 3 — Commit + Execute loop (2026-06-06)

Branch `t/maciej/tasks-commit-execute` off `maciej` (which now includes the
develop sync + all of Session 2). The core feature: build today's queue, then run it.

**Commit queue (Plan side):** `toggleCommit` / `markDone` / `rescheduleFromToday`
on the hook (sets `committedFor`=today + `commitOrder`; reschedule bumps
`rescheduleCount` ambiently, no wall). `committedTasks` derived (today, ordered).
Commit from the List via the **`t`** key (`c` is capture) or the row context menu;
committed rows show a quiet Sunrise marker. New **"Today"** selection in the left
rail (ordered queue + count) and a **"Start my day"** CTA (shown when ≥1
committed). Today is never grouped (queue order); capture from Today lands in Inbox.

**Execute mode** ([ui/execute-view.tsx](../src/features/tasks/ui/execute-view.tsx)):
isolated — replaces the whole 3-pane area (no rails). Brief **intro ceremony**
("N tasks committed. Let's go.") on Start-my-day; the plain mode toggle skips
straight in. **Now card**: bucket + duration context, large title, **timer
(Pomodoro 25/5 default, switchable to per-task Duration countdown)** auto-running
on entry, "Mark done → next". **Queue** below (items 3+ dimmed, read-only).
**End-of-queue**: factual done/total summary. "Reschedule" drops the current task
from today (ambient count++) and advances; "End session" returns to Plan.

**Decisions (Maciej):** timer = Pomodoro **+ switchable** to Duration; commit
queue surfaced as a **"Today" rail selection** (+ row marker).

**Polish pass (round-2 feedback — Maciej):**
- **Typography roles** codified in `DESIGN_SYSTEM.md` + applied: primary =
  `font-display` (chrome: buttons, labels, titles, headings), secondary = body
  (context: dates, counters, meta, modal footer). The **`Button` primitive base
  is now `font-display`** (was `font-sans`) — fixes the "mono button" app-wide
  (mono now strictly code-only).
- **Casing**: Sentence case convention documented in `DESIGN_SYSTEM.md`
  ("Done, next", "Do last", "2 / 2 Done", etc.).
- **Density now reaches modules**: `FeaturePanelsShell` padding is driven by the
  `--pad-*` tokens (was fixed `p-5`/`p-4`) → the Appearance → density control
  moves the panels; baseline is tighter (rails run on `--pad-*-sm`). New
  **`--text-2xs`** eyebrow token (scales with text-size) for section labels.
- **Dialog blur reduced globally** (`bg-background/60`, no `backdrop-blur`); the
  Settings modal keeps its own overlay so its appearance-tab behaviour is intact.
- **Execute moved into the center panel** (rails stay), redesigned: richer Now
  card + meta, a **relations placeholder** (cross-module links, future), button
  **"✓ Done, next"**, **Skip** (reschedule out, ambient count++) + **Do last**
  (re-queue to end), "N / M Done". Pomodoro/Duration toggle kept.
- **Left rail**: Plan/Execute toggle concentric-radius fix; **"Today"** queue
  selection; drift is numbers-only (dot + count, word in tooltip) with the hover
  "…" pushing counts left; **hover "+"** add-bucket on the Buckets header
  (removed the bottom button + the redundant "Start my day" button/ceremony).
- **List**: group control + dropdown → primary font; **no "Bucket" grouping
  inside a single bucket**; empty schedule/due affordances no longer reserve
  space (only show on hover / when set) — fixes the lone-calendar-icon misalign.
- **Capture modal**: visible header title (fixes the X overlap), borderless
  Linear-style inputs, primary fonts for title/description, secondary footer,
  **attachment placeholder** (left of the footer) for the cross-module link concept.
- **Parked (noted, not done):** full density/type-scale pass (per Maciej);
  wiring the *content* of cross-module relations/embeds (placeholders only).

**Verified:** typecheck ✓, cargo check ✓, lint:tw ✓, lint:css (no new errors) ✓,
web production build ✓, app boots clean (no console errors). Not yet hand-dogfooded
(Execute timer/flow + the visual polish need a real run); commit not yet made —
left in the working tree for review.

**Deferred:** queue reordering (drag) within Today; long-break pomodoro cadence;
sound/notification on phase change; Board view + drift triage + default-view
(Session 4).

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
