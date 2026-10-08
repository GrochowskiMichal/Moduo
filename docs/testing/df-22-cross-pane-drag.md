# Manual test checklist — DF-22 cross-pane drag-to-link

> Generated 2026-07-11 · branch `t/maciej/df-22-cross-pane-drag` · **Live-verified: yes** — all four gestures below were driven end-to-end on the hosted test account (web), and the test data was restored afterward. Your pass is confirmation, not first-discovery.

DF-22 unified the Tasks page onto **one** app-level drag context so a task dragged in the center pane can be dropped on the **selected task's detail hub** in the right pane to link them. The whole point is: nothing that worked before should behave differently, and one new gesture (task → hub) now works. So most of this checklist is regression-guarding.

## New: cross-pane drag-to-link (the DF-22 payoff)
- [ ] **Do:** Open **Tasks**, select a task so its detail panel shows on the right (expand the right panel if collapsed). In the center **list**, drag a *different* task row and drop it onto the right-pane detail panel. → **Expect:** a quiet accent ring on the panel while hovering, then a **"Linked task → task · References"** toast with **References** (change-kind) and **Undo** buttons; the panel's **Linked** section gains the dropped task. Click **Undo** → the link disappears. _(web / desktop)_
- [ ] **Do:** Switch to **Board** view, select a card, then drag another card onto the right-pane detail panel. → **Expect:** same link + toast (the card also links, exactly like a list row). _(web / desktop)_
- [ ] **Do:** Drag a task row onto the hub of **that same task** (its own detail). → **Expect:** a **"You can't link a task to itself"** message, no link created. _(web)_
- [ ] **Do:** Drag a task onto a hub it's **already linked to**. → **Expect:** an **"Already linked"** message, no duplicate + no stray Undo-that-deletes-the-old-link. _(web)_

## Regression: Queue reorder (must be unchanged)
- [ ] **Do:** Commit ≥2 tasks to the **Queue** (each row's "Add to queue"), open the **Queue** scope in **List** view, and drag a task to a new position. → **Expect:** neighbours slide apart as you drag; on drop the new order sticks and survives a refresh. The drop lands where the pointer is — the same feel as before DF-22. _(web / desktop)_

## Regression: subtask nest (drag-onto-task, must be unchanged)
- [ ] **Do:** In a single bucket / **Inbox** (List view, Group = None), drag one childless top-level task **onto another** task row. → **Expect:** a highlight ring on the target row while hovering; on drop the dragged task becomes a **subtask** (target shows an `n/m` count + an expand chevron; the moved task is nested under it). Select the moved task → **Detach** returns it to top level. _(web / desktop)_
- [ ] **Do:** A task **with** subtasks — try to drag it onto another task. → **Expect:** it is **not** draggable (a parent can't become a subtask; one-level rule). _(web)_

## Regression: Board move / reorder (must be unchanged)
- [ ] **Do:** In **Board** view, drag a card **within** its column to reorder, and **across** to another column. → **Expect:** within-column reorder persists; cross-column drop changes the card's status/bucket to the destination column. Empty column still reads "Drop tasks here" and accepts a drop. _(web / desktop)_

## Regression: Timeline (left untouched by design — should be identical)
- [ ] **Do:** In **Timeline** view with unscheduled tasks in the tray, drag a **tray chip** up onto a day. → **Expect:** it schedules to that day (day-wash preview under the chip while dragging); dropping off the axis is a quiet no-op. Bar move/resize and the connector-dot (drag a bar's end onto another bar to add a blocker) still work. _(web / desktop)_

## Edge cases
- [ ] **Do:** With the right panel **collapsed** (no task selected, or panel hidden), do any center-pane drag (reorder / nest / board move). → **Expect:** works exactly as before; there's simply no hub to link to. _(web)_
- [ ] **Do:** Read-only workspace (Tasks permission = read): the hub shows no drop ring and a drop creates no link. → **Expect:** no link, no error toast. _(web)_

## Migrations / data
- None. This is a pure frontend refactor of the drag wiring — no schema or data changes.

## Known gaps / not-yet-testable
- **Timeline tray → hub link** is intentionally **out of scope**: the Timeline keeps its own isolated drag context (its tray drag needs auto-scroll-off + a keyboard-disabled, pointer-derived drop that conflict with a shared context, and it has no cross-pane target). Dragging a tray chip onto the hub does nothing — this is by design, not a bug.
- **Keyboard drag-to-nest** now rides the sortable keyboard sensor rather than the default; in practice keyboard-nesting was already unreachable (the nest rows expose no keyboard activator), and pointer nesting is unaffected. No behavior change you can observe.
- **Desktop (Tauri):** verified on **web** only. The change is renderer-only shared code, so desktop should match, but a desktop pass on the four gestures is worth a glance.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
