---
paths: ["apps/app/src/**/dnd/**", "apps/app/src/features/tasks/ui/**", "apps/app/src/features/notes/shell/**", "apps/app/src/features/contacts/ui/**", "apps/app/src/features/calendar/ui/**", "apps/app/src/features/dashboard/**", "apps/app/src/features/attachments/**", "apps/app/src/routes/pages/contacts-page.tsx"]
incident: "Drops landed hours late after the calendar grid auto-scrolled (CAL-3) and again in the notes sidebar (NR-2): dnd-kit's delta folds auto-scroll in"
expires: 2027-01-31
---

# Drag and drop (dnd-kit and the hand-rolled pointer engines)

Compiled from the UI gotchas (HV-14b). `lint:ast` fails a bare `<DndContext>` (`dnd-context-without-sensors`).

## dnd-kit
- `event.delta` is not pointer travel: it folds in auto-scroll. Track the raw pointer with a capture `pointermove` listener attached synchronously in `onDragStart`, store coordinates, and resolve the target against rects (and `scrollLeft`) measured in `onDragEnd`. Anything that moves the canvas under a still pointer makes a target resolved at move time stale.
- Pointer-driven targets use `pointerWithin`; a closest-centre fallback "drops" a release outside every target onto the nearest one.
- The Tasks page has one app-level `DndContext`; List, Board, Timeline and the right-pane hub are `useDndMonitor` consumers (`apps/app/src/features/tasks/ui/dnd/task-dnd.tsx` `DndBoundary`). Its one `collisionDetection` branches per surface (`apps/app/src/features/tasks/ui/plan/plan-dnd-host.tsx` `appCollision`): `link:*` and `rail:*` pointer-first, Board `closestCorners`, Queue `closestCenter` (the whole row is the activator, so pointer and rect centre differ by the grab offset), the List none (it plans from the raw pointer in `apps/app/src/features/tasks/dnd/drop-mode.ts`), the Timeline `pointerWithin` over its one axis droppable. `dndMode` defaults to `"internal"` so stories keep their own context.
- Two nested `DndContext`s don't share a drag. A sub-surface with its own drag logic keeps it through `useDndMonitor` under the page's context, and every `onDragEnd` subscriber acts only on its own surface.
- A `DragOverlay` modifier moves the collision rect too: use one only where the drop is resolved from the pointer, and switch it off for rect-based drops (`overlayBesideCursor`).
- A whole-row drag needs `setActivatorNodeRef` on the row, or Space/Enter on any button inside starts a keyboard drag. A test that starts one cancels it before cleanup.
- `useDraggable`/`useDroppable` throw without a context: render a draggable wrapper component only when the page guarantees one, never a conditional hook. Spread only `listeners` on a row that already selects on click. The Timeline needs a `DndContext` above it (`useDndMonitor`).
- `links_op_create` is idempotent, so a re-drop isn't an error: guard "already linked" on the target's own direct links before creating, or the toast's Undo deletes a link the person didn't just make. A denormalized mirror of a link lives in a trigger, never in a second client call.
- A Board drop id is opaque: register each target's name (`registerBoardDropNames`) so announcements can say where it went.
- A drag ends with a click on the common ancestor: swallow that one click in the capture phase, or a multi-selection collapses (`apps/app/src/features/tasks/ui/use-timeline-canvas.ts`).

## Hand-rolled pointer engines (calendar, Timeline, dashboard grid)
- Three exits, not one: `pointerup`, `pointercancel`, and a `pointermove` with `buttons === 0`; re-measure cached rects per move. Synthetic tests dispatch moves with `buttons: 1`.
- The dashboard grid is its own engine, not dnd-kit: pure math in `apps/app/src/features/dashboard/grid-geometry.ts` and `resolveDrag` (greedy nearest-free relocation, not a cascade push; it rejects conservatively on a near-full grid).

## File drops
- An unhandled file drop navigates the window to the file; `useFileDropGuard` refuses leftovers at `window`, so a new drop zone must `preventDefault()` on `dragover`.
- A file drag over a memoised list lights the row from one container listener keeping one `targetId`, never per-row listeners (`apps/app/src/features/tasks/ui/row-drop.ts` `useRowFileDrop`).
- Lexical's rich-text drop and paste take files with `preventDefault()` but no `stopPropagation()`: an ancestor's handler skips events from inside `[data-lexical-editor]` (not `defaultPrevented`), or one drop attaches twice.
- An HTML5 drag inside the notes editor is handled in the capture phase with `stopPropagation`, marked with its own MIME type so file and text drops still reach Lexical.
