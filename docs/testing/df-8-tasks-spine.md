# Manual test checklist — DF-8 Tasks joins the spine

> Generated 2026-07-11 · branch `t/maciej/df-8-tasks-spine` · **Live-verified:** yes — task hub renders real cross-module links on `/tasks`; drop-to-link driven end-to-end on the notes surface (note → embedded task hub → link + Undo). See "Known gaps" for what could not be driven and why.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Task detail hub — renders linked entities
- [ ] **Do:** Open `/tasks`, select a task that has spine links (e.g. one with a blocks/blocked-by edge, or that a note/email spawned) → **Expect:** a **"Linked"** section near the bottom of the detail panel (after Tags/Subtasks/Blocked-by/Blocks, before the ambient mirrors), grouped by type with counts (e.g. "NOTES 2", "OPEN WORK 1"), each row showing the entity title + its relation kind (References / Spawned from / Blocks …). _(both)_
- [ ] **Do:** Select a task with **no** links → **Expect:** **no "Linked" section at all** — quiet by default, no empty "Nothing linked yet" card on the inspector. (The section appears the moment the task gains its first link.) _(both)_
- [ ] **Do:** Hover a linked row and open its **⋯** menu → **Expect:** Open · Change relation (only kinds valid for that endpoint pair) · Remove link. Change the relation → the row's kind label updates; Remove → the row disappears and the count drops. _(both)_
- [ ] **Do:** Click a linked **note / contact / event / email** row → **Expect:** it deep-links to that entity's module (opens it there). _(both)_
- [ ] **Do:** Click a linked **task** row whose bucket is **different** from the current scope → **Expect:** the app snaps scope to that task's bucket and selects it (does NOT silently bounce back to the first task in the current bucket — this was the validator #1 fix; it routes through the `?id=` deep-link path). _(both)_

## Task detail hub — accepts a drag-to-link drop (verified on the notes surface)
- [ ] **Do:** Open `/notes`, open a note that contains an inline task, click the task's **"Open task details"** affordance → **Expect:** the right panel switches to the **Task** tab showing that task's detail panel (with its own "Linked" hub). _(both)_
- [ ] **Do:** Drag another **note** from the sidebar and drop it onto that task panel → **Expect:** a toast **"Linked <note> → task · References"** with a relation-kind override dropdown + **Undo**; the task's "Linked" hub immediately gains the note row (no re-select needed — `TASK_DETAIL_REFRESH_EVENT`). _(both)_
- [ ] **Do:** Click **Undo** on that toast → **Expect:** the link is removed and the hub re-pulls back to its previous state. _(both)_
- [ ] **Do:** Drop the SAME note onto the task hub twice → **Expect:** the second drop says "Already linked" (no duplicate, no spurious Undo). _(both)_

## Hub shows up wherever a task panel appears
- [ ] **Do:** In `/calendar`, select a task (Detail panel) → **Expect:** the same "Linked" hub renders. _(both — task rows are desktop-visible in calendar)_
- [ ] **Do:** In `/email`, open the **Task** panel for a converted-to-task email → **Expect:** the "Linked" hub renders; opening a linked entity from it deep-links out. _(desktop — email is desktop-first)_

## Edge cases
- [ ] **Do:** As a **view-only** member (or a task you can't edit), open a task's hub → **Expect:** rows are read-only — no ⋯ menu, no drop ring; existing links still render and are clickable. _(both)_
- [ ] **Do:** Open a task in a workspace where the spine has no data / while offline → **Expect:** the hub shows its loading→empty/error state calmly; the rest of the inspector is unaffected. _(both)_
- [ ] **Do:** Remove the last link from a task via the ⋯ menu → **Expect:** the hub falls back to the empty state, not a blank gap. _(both)_

## Migrations / data
- [ ] None — DF-8 adds no schema. It reads/writes the existing `entity_links` via `runtime.spine.listLinks` / `createLink` / `setLinkKind` / `deleteLink` (all shipped in the CT-* spine work).

## Known gaps / not-yet-testable
- **Dragging a task ROW from the `/tasks` center list/board onto the hub does nothing yet** — this is intentional. The tasks-page drop target is a *ready receiver*; the app-level `DndContext` unification that lets center-pane task rows (and cross-pane entities) reach it is **DF-22**'s ratified scope. DF-8 deliberately does not touch the list/board/timeline reorder/nest contexts. Verify the drop on the **notes** surface (above), where a page-level context already carries draggable rows + the task hub.
- A throwaway empty **"Untitled"** note was created in the test account's Notes Inbox during live-verify and could not be deleted (the auto-mode classifier declined deleting a record in the shared hosted account). It is harmless demo data; delete it manually if desired. The spurious test link it briefly held was Undone in-session.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
