# Tasks follow-ups — continuation 4 (drag-to-subtask + q + live-verify, 2026-06-16)

> Paste into a fresh Claude Code session. Read [CLAUDE.md](../../CLAUDE.md),
> [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md), and the prior
> [CONTINUATION-3.md](./CONTINUATION-3.md) + [DECISIONS.md](./DECISIONS.md) first.

## Done this session (don't redo)
Branch `claude/awesome-mayer-57a503` (Opus), stacked on c3 (`95de6b3`). Two
commits; all five gates green each (`bun run typecheck` · `bun run test` now
**110**, +6 `canNestUnder` cases · `bun run lint:tw` · `bun run lint:css` ·
`bun run build:web`). **This session was live-verified end-to-end** (the step c3
deferred) — see below.

1. **Drag-a-task-onto-another → subtask** (`9562682`) — the last unbuilt piece of
   CONTINUATION-2 #1. New `NestableTask` in
   [`ui/dnd/task-dnd.tsx`](../../src/features/tasks/ui/dnd/task-dnd.tsx)
   (draggable + droppable on one node, *no* reordering — distinct from
   `SortableTask`); `useTaskDndSensors({ sortable:false })` for the keyboard path
   (nesting has no `SortableContext`, so it uses dnd-kit's default coordinate
   getter, not `sortableKeyboardCoordinates`). `TaskListView` gained a `nestable`
   mode (parallel to `reorderable`), gated to the flat single-bucket list
   (`groupBy === "none"`, `canEdit`, not the Queue, not "All"): childless
   top-level rows expose the grip + an `onto-task` droppable; on drop
   `api.setTaskParent` runs (one-level enforced there + the DB trigger). Drop
   eligibility is a pure, unit-tested helper `canNestUnder` (in `helpers.ts`):
   childless active, top-level target, not a no-op. Only valid targets highlight
   (`dropActive` on `TaskRow`, ring + accent like the board column); a title-chip
   `DragOverlay` follows the cursor; the new parent auto-expands on drop.
   `DragHandle` now reserves its gutter when disabled so a parent row (no grip)
   stays column-aligned. **Board reorder unchanged** (onto-card there = reorder).
   Also folded in: the **`q` queue shortcut** — the List `q` key (un)queues the
   selected task (Round D's queue key), replacing the stale `t` binding from when
   the queue was "Today" (`t` was never advertised).
2. **`property-row` → visual suite** (`29317c3`) — added the detail-panel grid
   primitive to `tests/visual/primitives.spec.ts`. **No PNG baselines committed**
   (see below).

## Live verification (done — don't repeat unless you change the DnD)
Web, worktree rsbuild `:8097` + local Dia browser via Chrome MCP, hosted test
acct ([[project-test-account-hosted]]). The browser already had a session — **no
credential entry was needed** (don't enter the account password yourself; the
recipe's password POST is an authentication action — get a session another way or
have Maciej sign in). No console errors throughout. Confirmed:
- nest branch **mounts** in the single-bucket List (the gates can't render it);
- grips render on **exactly the 3 childless Inbox rows**, none on the "Verify…"
  parent (one-level affordance + the disabled-grip gutter spacer);
- a **real dnd-kit drag** nested "Untagged filter-test task" under "Session 8 ops
  probe" (auto-expand + "0/1" mirror), and **detach** (context menu) restored it;
- **`q`** toggled the queue both ways;
- the **detail panel** renders as the PropertyRow grid + Time-spent row (c3).
- Demo data restored; one commit/uncommit pair landed in Session 8's activity
  trail as a side effect (noted in the test-acct memory).

**dnd-kit sim note:** synchronous synthetic pointer events are dropped by
dnd-kit's rAF collision loop (this is why c2/c3 called drag "unsimulable"). The
fix that worked: dispatch `pointerdown` on the grip, then `pointermove`s with a
~60ms delay between each (so the rAF loop runs), then `pointerup`. Coordinates
are CSS px from `getBoundingClientRect` (dispatch on elements/`document`, not via
screenshot coords — the screenshot is scaled vs `innerWidth`).

## Open work, prioritized (small)
1. **Visual-baseline PNGs** — `tests/visual/primitives.spec.ts` lists every
   primitive incl. `property-row`, but **no baselines have ever been generated**.
   They're platform-suffixed (`*-visual-darwin.png`) and the static-checks CI
   workflow (`.github/workflows/checks.yml`) does **not** run the visual project
   (only typecheck + lint:tw + lint:css) — so this is a *local* macOS tool, not a
   CI gate. Generate with Storybook serving + `bunx playwright test
   --project=visual --update-snapshots` and commit (a human/canonical-env step
   per the spec's own note). Low value until CI runs it.
2. **Future additive DnD drop targets** (the layer already accommodates): drag a
   task onto a **sidebar calendar** → schedule (`calendar-slot` variant on
   `TaskDropTarget` + one branch in that surface's `onDragEnd`), and the task
   list as a drag **source** onto other surfaces. Both wait on those surfaces
   existing. The `TaskDragData` payload + `asTaskDropTarget` are ready.
3. **`groupBy !== "none"` nesting** is intentionally out — nesting is only wired
   for the flat list. Revisit only if Maciej wants drag-nest inside grouped views.

## Git/PR
Concise present-tense commits, `Co-Authored-By: Claude Opus 4.8 (1M context)
<noreply@anthropic.com>`. PR #21 is the review vehicle; push only on Maciej's
say-so. FF `maciej` per chunk for `dev:desktop` testing once Maciej is ready.
