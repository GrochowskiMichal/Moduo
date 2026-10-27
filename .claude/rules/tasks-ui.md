---
paths: ["apps/app/src/features/tasks/**"]
incident: "Folding every group made the List and the page fight over the selection until React #185, and the project crashed on every open on every device (MOD-122, prod, 2026-10-14)"
expires: 2027-01-31
---

# Tasks views: selection, place, List, Board, Timeline

Compiled from the UI gotchas (HV-14b). Data and commands: [docs/architecture.md](../../docs/architecture.md) §Tasks data and commands.

## Place, selection and deep links
- The place is resolved once from the address bar by `resolveEntryPlace` (`apps/app/src/features/tasks/default-view.ts`); every entry point writes the URL (`?place=`), never a setter from an effect. Writes land a render late, so write through `setSelection`, never `onUrlPlaceChange`.
- `useTasksPlanController` is a chain of hooks in a fixed order (place, deep link, backstop, mirror) that settle in one flush: add state to the step it belongs to, never to a layout component (a child's effects run first). `react-hooks/exhaustive-deps` asks for setters and `ref.current` that come through the controller: never add `ref.current`; disable the line with a reason.
- The selection has two owners that fall back on their own (`usePlanCursor` and the List): any new fallback must settle with the other. With nothing to show the List leaves the page's choice alone; the page's pick must be a row the List shows; the selection is never cleared to show the project. `task-list-view.fold-all.test.tsx` fails on a loop.
- The Timeline (like Focus) may keep "nothing selected": a new view that wants that opts out of the backstop in `usePlanCursor`.
- A saved view's selection `view:<id>` isn't a place: everything about the centre reads `place` (`viewPlace(view)`); only the sidebar highlight, `lastBucket`, the URL and fold keys read `selection`.
- Done, Won't do and Backlog tasks load after the open ones: "not in the list" isn't "gone" until `restLoaded` (`store.whenRest()` outside React). Links resolve against archived projects and tasks too (`linkable` in `apps/app/src/features/tasks/ui/tasks-plan-view.tsx`).
- A deep link into a grouped List can land and then be folded away: the collapse reset keeps the selected task's group open.
- A new workspace's Inbox doesn't exist until Tasks first opens: anything writing into it on a first open waits for `api.inbox`.

## The List and the Board
- A grouping with nothing to group by counts as no grouping everywhere (`groupBy = "none"`), or the drop planner writes `section_id: "all"`.
- Folds live in synced preferences: tests call `resetFoldsForTests()` (`apps/app/src/features/tasks/folds.ts`) in `afterEach`.
- Undo of a drop compares the exact status (`key|statusId`), not just the category.
- A view placing rows by `scheduledAt` moves a session through `scheduleTaskAt` (the reschedule op), not `updateSession`.

## Writes from views
- A bulk path's work function never throws (`runPool` runs under `Promise.all`): catch inside, collect refusals, settle with what saved, and record which op of a multi-op task saved.
- A project write that waits for task moves joins the project's chain before it waits (`chainProjectOp(id, async () => { await movesDone; … })`), or an Undo overtakes it.

## The Timeline
- A `VirtualStack` under a sticky header in the same scroller needs `scrollMargin`. TanStack Virtual's ancestor scroller is attached after the children's layout effects; `VirtualStack` renders once more after mount.
- A Timeline row spans the canvas: the deep-link reveal finds the mark (`data-task-id`), not the row, or `scrollIntoView` jumps sideways.
- The canvas starts a drag only under `[data-timeline-track]` and handles keys only when the scroller contains the target: portaled pickers bubble through the React tree.

## The detail panel
- The panel's scroll box keeps its 4 px side padding for focus rings; nothing pulls out by more (Notes hosts the panel in an unpadded scroller). jsdom measures every width as 0: treat "no room measured" as "everything fits".
