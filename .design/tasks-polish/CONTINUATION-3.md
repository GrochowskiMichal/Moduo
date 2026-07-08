# Tasks follow-ups — continuation 3 (DnD + detail panel + Pomodoro, 2026-06-16)

> Paste into a fresh Claude Code session. Read [CLAUDE.md](../../CLAUDE.md),
> [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md), and the prior
> [CONTINUATION-2.md](./CONTINUATION-2.md) + [DECISIONS.md](./DECISIONS.md) first.

## Done this session (don't redo)
Four committed chunks (branch `claude/suspicious-golick-3f4e80`, stacked on
`cca9e11`). All five gates green on each: `bun run typecheck` · `bun run test`
(now **104**, +13 reorder-math tests) · `bun run lint:tw` · `bun run lint:css`
· `bun run build:web`.

1. **Reusable DnD layer + Queue reorder** (`ee37d47`). New
   `src/features/tasks/ui/dnd/task-dnd.tsx`: typed `taskDrag` payload, an
   extensible `TaskDropTarget` union (`onto-task` / `column` today;
   calendar-slot etc. are additive), shared pointer+keyboard sensors, a
   `SortableTask` wrapper + `DragHandle` grip. Pure ordering math +
   unit tests in `src/features/tasks/reorder.{ts,test.ts}` (`commitOrderUpdates`,
   `positionForReorder`, `moveItem`). The **Queue** (Today list) is a vertical
   sortable — drag the quiet grip to reorder, persisting `commit_order` via
   `api.reorderQueue` (raw save path, no intent op — same call shape as the
   board's `position` drag). Focus dropped its interim **"Do last"** link
   (Skip + Done only); `api.doLast` removed.
2. **Board within-column reorder + insertion indicators** (`cc3f08b`). Board
   cards are now a multi-container sortable (per-column `SortableContext`).
   Within a column drag reorders (neighbours animate apart = the indicator);
   cross-column still moves status/bucket but slots `position` at the drop
   point. DragOverlay regained its default drop animation. Reorder/move resolve
   on drop from the over target via `positionForReorder` — no mid-drag
   cross-container state.
3. **Detail panel = PropertyRow grid** (`68d6317`). New `PropertyRow` primitive
   (`src/components/ui/property-row.tsx` + story) — label-left / value-right,
   `align="start"` for multi-line. `task-detail-panel.tsx` rebuilt: scalar props
   (status/bucket/scheduled/due/priority/energy/duration/repeat) are now an
   aligned grid; description is label-less under the title; collections (tags,
   subtasks, blocked-by, blocks) stay full-width sections. Added a **manual
   "Time spent" row** — minutes input → `setTimeSpent` (locked decision: detail
   panel adjusts the total only, the live tracker stays Focus-only; never
   truncates the seconds-precise total on a bare blur).
4. **Pomodoro prefs → Settings → Focus** (`cb3ee7a`). New `src/lib/focus-prefs.ts`
   (work / short break / long break / long-break rhythm / auto-start / sound,
   same persistence shape as `appearance.ts`) + a **Settings → Focus** section.
   The Focus timer (`execute-view.tsx` `useFocusTimer`) reads them: long-break
   rhythm, auto-start-next (or pause-to-resume), Web-Audio chime. The card's ⋯
   popover edits the same persisted work/break values + links to Settings.
   Timer is still strictly opt-in (never auto-starts on focus).

## Verification note (read before claiming it's tested live)
All four chunks are **gate-verified** (typecheck / 104 tests / lints / build)
and the reorder math is unit-tested. They were **not** click-tested in a live
authed browser this session: the tasks UI sits behind auth (the test-account
password wasn't on hand and CONTINUATION-2 steers away from password login),
and drag interactions don't simulate reliably through automated browser tools.
`PropertyRow` has a Storybook story for visual spot-check. **First step for the
next session: live-verify** per the CONTINUATION-2 recipe (worktree rsbuild on a
free port + Chrome MCP Browser 1, session-injection) — exercise Queue drag,
board within-column drag, the detail-panel grid + Time-spent row, and Settings →
Focus.

## Open work, prioritized
1. **Drag-a-task-onto-another → subtask** (the one piece of CONTINUATION-2 #1 not
   built). The foundation is ready: `TaskDropTarget` already has the `onto-task`
   variant, plus `DragHandle` + sensors. Deferred because the per-bucket List's
   parent/child/group rendering makes a clean nesting surface materially more
   complex/regression-prone than the flat queue, and it's the least
   automated-verifiable interaction. Suggested approach: a `nestable` mode on
   `TaskListView` (parallel to `reorderable`), restricted to the flat per-bucket
   list (`groupBy === "none"`, `canEdit`) — top-level rows become draggable
   (handle) + droppable (`onto-task`); on drop call `api.setTaskParent`
   (one-level guard already exists). Track `activeId` to highlight only valid
   targets (target top-level, active childless). Minimal overlay (title chip).
   Keep board reorder unchanged (onto-card there = reorder, not nest).
2. **Visual-test baselines** — `tests/visual/primitives.spec.ts` rows exist;
   generate PNGs via Storybook + Playwright `--update-snapshots` and commit
   (now includes `property-row`).
3. **`q` queue shortcut** — add `q` to commit/uncommit in the List keyboard map
   (CONTINUATION-2 carryover).
4. **Future DnD drop targets** (design already accommodates): dragging a task
   onto a sidebar **calendar** → schedule (`calendar-slot` variant), and a task
   sidebar as a drag *source* onto other surfaces. Additive — new `TaskDropTarget`
   variant + one branch per surface.

## Git/PR
Concise present-tense commits, `Co-Authored-By: Claude Opus 4.8 (1M context)
<noreply@anthropic.com>`. PR #21 is the review vehicle; push only on Maciej's
say-so. FF `maciej` per chunk for `dev:desktop` testing once Maciej is ready.
