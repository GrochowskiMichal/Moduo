# Manual test checklist — NO-7b (Notes rail in Contacts/Calendar + drag-into-editor/hub)

> Generated 2026-07-04 · branch `claude/interesting-archimedes-a725d6` · **Live-verified:** partial — the "Notes" rail (render + New-linked-note create+link+list) was live-verified end-to-end on the hosted account (Contacts); the Calendar rail's tab + null-focus state were verified; the **drag gestures on /notes are NOT auto-verifiable** (dnd-kit pointer drags are unsimulable in a worktree — see Known gaps) and need a human pass.

## Contacts — "Notes" rail
- [ ] **Do:** Open /contacts with nothing selected → **Expect:** no right panel (the rail only appears once you select someone). _(web)_
- [ ] **Do:** Select a contact → look at the right panel → **Expect:** a "Notes" panel header + "New linked note" button; "No linked notes yet" if none are linked. _(web)_
- [ ] **Do:** Click **New linked note** → **Expect:** a toast "Note created and linked · Find it in this rail or in Notes."; you STAY on the contact (no jump to /notes); a new **Untitled** row appears in the rail. _(web)_
- [ ] **Do:** Click that Untitled row in the rail → **Expect:** it opens /notes with that note selected (you can now type its title/body). _(web)_
- [ ] **Do:** Back on the contact, open /notes separately and confirm the new note sits in **Inbox** and its Detail hub shows the contact under links. _(web)_
- [ ] **Do:** Select a **company** → **Expect:** the same Notes rail works (New linked note links to the company). _(web)_

## Calendar — "Notes" rail
- [ ] **Do:** Open /calendar, open the right panel, look at the panel-view switcher → **Expect:** three tabs **Tasks · Detail · Notes**. _(web)_
- [ ] **Do:** Click **Notes** with nothing selected → **Expect:** "Select something to see its notes." _(web)_
- [ ] **Do:** Click an event (or a task in the Tasks panel) so it opens in Detail, then click the **Notes** tab → **Expect:** the rail now shows that event/task's linked notes + "New linked note". _(web)_
- [ ] **Do:** Click **New linked note** for a selected event → **Expect:** toast; the note appears in the rail; opening /notes shows it linked to the event. _(web)_
- [ ] **Do:** Switch the panel to Notes, reload the page → **Expect:** the panel remembers "Notes" (persisted per user+workspace). _(web)_

## Notes — drag-into-editor (chip) — **needs a human pass**
- [ ] **Do:** On /notes, open a note in the editor. Drag a DIFFERENT note's row from the sidebar INTO the editor body → **Expect:** a reference **chip** (the dragged note's title) is inserted at the drop point; clicking the chip deep-links to that note. _(both)_
- [ ] **Do:** Confirm that inserting the chip did **NOT** create a spine link — open the current note's Detail hub → **Expect:** the dragged note is NOT listed under links (a chip is an inline reference, not a link). _(both)_
- [ ] **Do:** Drop a note onto the editor's top padding / an empty area → **Expect:** the chip still lands (appended at the end as a fallback), no crash. _(web)_

## Notes — drag-onto-hub (link) — **needs a human pass**
- [ ] **Do:** On /notes with a note open and the right panel on **Detail**, drag a different sidebar note onto the Detail hub → **Expect:** a "Linked … → note" toast (with Undo); the dragged note appears in the hub's **Notes** section immediately (no reselect). _(both)_
- [ ] **Do:** Drag the SAME note onto the hub again → **Expect:** "Already linked" (no second success toast, no destructive Undo). _(web)_
- [ ] **Do:** Drag the currently-open note onto its own Detail hub → **Expect:** "You can't link a note to itself." _(web)_

## Regression — Notes sidebar reorder (the risky refactor)
- [ ] **Do:** On /notes, drag a sidebar note ONTO another note row (into/before/after zones) → **Expect:** it reparents/reorders exactly as before this change (the reorder engine was lifted to a page-level DndContext + monitor — this must be unchanged). _(both)_
- [ ] **Do:** Reload after a reorder → **Expect:** the new order/parent persists. _(both)_
- [ ] **Do:** Create a child from the sidebar "+" while its parent is open → **Expect:** a page-row still mirrors into the open parent's body (unrelated but shares the editor bridge). _(both)_

## Edge cases
- [ ] **Do:** As a **view-only** member, open /contacts and select a contact → **Expect:** the Notes rail lists linked notes but shows **no** "New linked note" button; on /notes, no drag handles (rows aren't draggable), no reorder. _(web)_
- [ ] **Do:** With the Notes migration NOT applied (deploy-gap) — n/a on prod (applied per NO-9) but if a workspace degrades — **Expect:** clicking New linked note surfaces an honest "Couldn't create the note" error toast, never a silent failure. _(web)_
- [ ] **Do:** Link a note to a contact, then trash+purge the note → reopen the contact's Notes rail → **Expect:** the row renders dimmed/struck-through ("Deleted note"), non-clickable (tombstone). _(web)_

## Migrations / data
- [ ] None — NO-7b adds no migration. It rides the shipped `notesV2.create` + `spine.createLink`/`listLinks` + `useEntityHub`.

## Known gaps / not-yet-testable
- **The actual pointer-drag gestures on /notes (chip insert, hub link, reorder) were not auto-verified** — dnd-kit's PointerSensor + rAF collision loop makes synchronous synthetic drags unreliable in the worktree preview (recorded gotcha; every prior drag block — FX-9, CAL-3, TL-2 — is manual/human-verified). What WAS verified automatically: /notes mounts clean with the new page-level DndContext + external-mode sidebar (zero console errors from the lift), drag sources (`.cursor-grab`) and drop targets (`[data-note-row]`) are present, and the pure link-arg + selection logic is unit-tested. The three human-pass sections above are the confirmation.
- **Desktop (Tauri)** paths for all of the above were not run here (no desktop build in the worktree) — the code is platform-agnostic (same runtime methods), but a desktop pass is worth it for the drag gestures on WebKit.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
