# Manual test checklist — TV-T1 Shared tag store

> Generated 2026-10-08 · branch `t/maciej/tv-t1-shared-tag-store` · **Live-verified:** partial. The real tag UI (two Tasks-module instances standing in for Tasks and Calendar, plus a note's tag row) was driven in the browser over in-memory data: a tag added on one surface showed on the other before the save returned, a tag made on the note showed in Tasks' picker, a capture with `#launch` attached once the task saved, delete hid the tag everywhere and committed when the toast closed, and Undo brought it back with no server call. The hosted account couldn't be signed into from this session, so nothing below has run against the real backend yet.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Tags show everywhere at once (T1-1)
- [ ] **Do:** In Tasks, open a task and add an existing tag from its detail panel. Then go to Calendar and open the same task (or a Notes / Email panel that shows it). → **Expect:** the tag is already there, without reloading. _(both)_
- [ ] **Do:** Remove that tag in Calendar's task panel, then go back to Tasks. → **Expect:** it's gone on the row, the card and in the detail panel. _(both)_
- [ ] **Do:** On a note's tag row, create a new tag ("client"). Open any task's tag picker. → **Expect:** "client" is listed, with its colour. _(both)_
- [ ] **Do:** Recolour a tag from a task's picker. Look at a note, contact or email thread that has it. → **Expect:** the new colour shows there at once. _(both)_
- [ ] **Do:** Delete a tag from any picker. → **Expect:** it disappears from every task, note, contact and thread, and from the Tasks tag filter; the toast says it comes off everything. _(both)_
- [ ] **Do:** Delete a tag, then click **Undo** in the toast. → **Expect:** it's back everywhere, on everything it was on. _(both)_
- [ ] **Do:** Delete a tag and let the toast close, then reload. → **Expect:** it stays deleted. _(both)_

## Hub tag rows work again
- [ ] **Do:** Open a contact, a company, a note and an email thread that already have tags (add some first if needed, then reload). → **Expect:** each shows its tags under the title. Before this block these rows always came up empty after a reload. _(both)_
- [ ] **Do:** With a tag filter active in the contacts directory, add that tag to a contact from its card. → **Expect:** the contact appears in the filtered list at once. _(both)_

## Create by name (T1-2, the capture path TV-U7 builds on)
- [ ] **Do:** In a task's tag picker, type the name of an existing tag in different case (e.g. "DESIGN" for "design") and choose Create. → **Expect:** the existing tag is attached; no second "design" appears. _(both)_
- [ ] **Do:** Type a new name and create it. → **Expect:** the chip shows at once, with an auto-picked colour, and survives a reload. _(both)_

## Edge cases
- [ ] **Do:** Go offline (or block the network), add a tag to a task. → **Expect:** it shows, then comes back off on every surface with "Couldn’t add the tag". _(web)_
- [ ] **Do:** Click a tag on and off quickly several times, then reload. → **Expect:** after the reload the task shows the state you left it in. _(both)_
- [ ] **Do:** Sign out and sign in as another account in the same window. → **Expect:** none of the first account's tags show anywhere before the new account's data loads. _(web)_
- [ ] **Do:** As a Viewer in a shared workspace, open a task. → **Expect:** tags show; no picker; nothing can be added. _(both)_

## Migrations / data
- [ ] None. No schema change; tag ids are now generated in the app (the server already accepted them).

## Known gaps / not-yet-testable
- Nothing ran against the hosted backend in this session (no sign-in available); the checks above are the first real-data pass.
- Typing `#tag` in capture is TV-U7: this block only provides the "create by name before the task exists" call it will use.
- Workspaces with more than 10,000 tag assignments (the SCALE-1 cap) are covered by unit tests only.
- Another person's tag change still needs a reload to show; live updates are TV-D5.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
