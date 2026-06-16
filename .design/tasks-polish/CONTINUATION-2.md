# Tasks follow-ups — continuation 2 (Focus-card session, 2026-06-16)

> Paste into a fresh Claude Code session. Read [CLAUDE.md](../../CLAUDE.md),
> [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md), and the original
> [CONTINUATION.md](./CONTINUATION.md) + [DECISIONS.md](./DECISIONS.md) first.

## Where things are
- Branch **`claude/brave-tu-53b553`** (Session-11 line + the `main` structural-refactor
  reconciliation merged in). **Local `maciej` is fast-forwarded to this branch** for
  `dev:desktop` testing — keep FF-ing each chunk to `maciej` so Maciej can test. PR #21
  (`t/maciej/session11-tasks-ui`) is the review vehicle; **push to it only when Maciej says so.**
- Verify recipe + gates are in [CONTINUATION.md](./CONTINUATION.md) (unchanged): `bun run typecheck`
  · `bun run test` · `bun run lint:tw` · `bun run lint:css` · `bun run build:web`. Live-verify via a
  worktree web dev server + Chrome MCP **Browser 1** (don't authenticate with the test password —
  verify mechanisms without login where possible).

## Done this session (don't redo)
- **Refactor ↔ Session 11 reconciliation** merged (new `src/app/router`, `@/*`→`src/*` alias, feature
  file splits) with Session 11 as home. All prior sessions verified intact. Two regressions caught+fixed
  (cloud-first runtime types; email IDLE bootstrap in `src-tauri/src/lib.rs`).
- **Font picker restored** as one customizable axis (`data-font`, Geist default).
- **Lightweight time-tracking** (chosen over the full sessions/intent-op design): one column
  `tasks.time_spent_seconds` (**migration applied to hosted** `wtoonrvuqumihpkbvwvs`), written via the
  normal `patchTask` save path. Hook: `addTimeSpent(id, delta)` + `setTimeSpent(id, seconds)` in
  `use-tasks-module.ts`. No sessions table, no intent-op, no activity row.
- **Focus card redesigned** (`src/features/tasks/ui/execute-view.tsx`), after a full grill:
  task-first, left-aligned, **opt-in timer** (never auto-starts — `Track time` button bottom-left that
  starts on click and collapses to the tracked total at rest), elevated `bg-popover` card (no shadow),
  bucket eyebrow, total has a tooltip, square `IconButton`s, gentle running-dot pulse (`.track-pulse`).
  Stopwatch base + optional Pomodoro overlay; `⋯` popover = add-time / set-total / Pomodoro intervals.

## Locked decisions for the open work (from Maciej, 2026-06-16)
- **Detail panel = manual time-spent input ONLY, no live tracker.** The running timer lives only in
  Focus. The detail panel just lets you type/adjust the total (reuse `setTimeSpent` / `addTimeSpent`).
- **Time-tracking stays lightweight** (the single column). Don't reintroduce the sessions table / intent-op.
- Opt-in timer, no auto-start — keep that principle anywhere tracking appears.

## Open work, prioritized
1. **Reordering + a reusable drag-and-drop foundation.** The Queue/List can't reorder today (only the
   board has dnd-kit). Build a **reusable DnD layer** (extend the board's dnd-kit usage), because Maciej
   wants drag for several things over time:
   - **Reorder** the committed queue (List/Queue view) — persist `commit_order` (the commit op already
     race-safely orders; a reorder needs a "move to position / move to bottom" path).
   - **Drag a task onto another task → make it a subtask** (set `parentId`; one level only, recursion
     forbidden — guard already exists). 
   - **Design for future drop targets**: dragging a task onto a **calendar** open in the sidebar (→
     schedule it), and a **task sidebar you can drag tasks from** onto other surfaces. So: typed
     drop-targets (reorder-slot, onto-task, calendar-slot, …) and task rows as drag sources, not a
     one-off. Once this lands, Focus drops its interim "Do last" link (Skip + Done only).
2. **Detail-panel redesign** (the module's weakest surface: `task-detail-panel.tsx`, 953 lines, **zero
   `PropertyRow` use** — still the deferred stacked-`Field` interim). Rebuild as the intended
   **label-left / value-right `PropertyRow` grid** (the primitive exists in `src/components/ui/`), and
   add a **manual "time spent" row** (input only — per the locked decision, no tracker).
3. **Pomodoro prefs in Settings → new Focus section** (persisted work / break / long-break / auto-start
   / sound) and wire the Focus timer to read them (it holds intervals in local state today). Follows the
   `appearance.ts` prefs pattern.
4. **Board polish**: drop animation, within-column reorder, insertion indicators (folds naturally into #1).

## Unresolved question to ask Maciej first
**"You lost the details row somewhere, can't see it on the panel."** `task-detail-panel.tsx` is
**unchanged** since Session 11 (`9328550`) — not touched by the merge or any of this session's commits.
Candidates: (a) the Focus card's **description** only renders when the task has one (`task.description ?`
guard in execute-view) — the test task may have none; (b) in Focus mode the right rail binds to the
**selected** task, not the current Focus task, so it can show the empty "Pick a task" state; (c) a
property row in the detail panel he expected. **Clarify which before acting.**

## Git/PR
Concise present-tense commits, `Co-Authored-By: Claude <noreply@anthropic.com>`. FF `maciej` per chunk;
push PR #21 only on Maciej's say-so.
