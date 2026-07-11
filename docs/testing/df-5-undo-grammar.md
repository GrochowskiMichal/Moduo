# Manual test checklist — DF-5 (destructive-action safety pack / one undo grammar)

> Generated 2026-07-10 · branch `t/maciej/df-5-undo-grammar` · **Live-verified:** partial — task-delete-undo round-trip clicked end-to-end on the hosted account (delete→Undo→reload-survives + clean-delete→reload-gone, zero console errors); contact-delete-undo proven at the DB layer (migration applied to prod + a rolled-back delete→restore round-trip on the test workspace: 4 links revived, registry un-tombstoned). The rest is unit-tested + typecheck-green; the surfaces below are the human confirmation pass.

## The grammar (what to look for everywhere)
- [ ] **Do:** Trigger any delete/remove below → **Expect:** a **neutral** toast (not green "success" styling) with an **Undo** button on the right; the window is ~8 seconds everywhere (no action feels shorter/longer than another) _(both)_
- [ ] **Do:** Look at any destructive escalation ("delete the tasks too") → **Expect:** it's a quiet **red text link inside the toast body**, never the toast's right-hand dismiss button _(both)_

## Tasks — task delete (the sharpest edge)
- [ ] **Do:** In Tasks → List view, select a task and press **⌘⌫** (or ⌃⌫) → **Expect:** the row disappears + a "Task deleted" toast with **Undo** _(both)_
- [ ] **Do:** Click **Undo** → **Expect:** the task returns in place; reload the page → it's still there _(both)_
- [ ] **Do:** Delete a task via the row's **right-click → Delete** and via a board card's context menu → **Expect:** same "Task deleted" + Undo (all delete entry points share it) _(both)_
- [ ] **Do:** Delete a **parent task with subtasks**, then Undo → **Expect:** the parent AND its subtasks come back attached (subtasks aren't left promoted-to-top-level) _(both)_
- [ ] **Do:** Delete a task and let the toast expire (don't click Undo) → reload → **Expect:** it stays gone _(both)_

## Tasks — tag delete
- [ ] **Do:** Open the tag filter/manage menu, delete a workspace tag → **Expect:** "Tag deleted" + Undo; the tag vanishes from every task immediately _(both)_
- [ ] **Do:** Click **Undo** within 8s → **Expect:** the tag + all its attachments snap back with no reload flicker (local restore, no network) _(both)_
- [ ] **Do:** Delete a tag and let the toast expire → reload → **Expect:** the tag is gone workspace-wide _(both)_

## Contacts — contact delete
- [ ] **Do:** Contacts → open a person → ⋯ → **Delete contact** → **Expect:** "Contact deleted" + Undo; you land back on the empty/last selection _(both)_
- [ ] **Do:** Click **Undo** → **Expect:** the contact returns, re-selected, with its previously-linked rows (tasks/notes/company) back on its hub; reload → still there _(both)_

## Contacts — company delete guard + clear-company
- [ ] **Do:** Open a **company** with members → ⋯ → **Delete company** → **Expect:** a **confirm dialog** that says "N people work here — they'll stay, but their company field clears" and warns it can't be undone _(both)_
- [ ] **Do:** Confirm → **Expect:** company gone, its former members survive with an empty company chip _(both)_
- [ ] **Do:** Cancel the dialog → **Expect:** nothing deleted _(both)_
- [ ] **Do:** Edit a person who has a company → **Expect:** an **X** next to the company field; click it → "Company removed" + Undo, the chip clears _(both)_
- [ ] **Do:** Click **Undo** on "Company removed" → **Expect:** the company chip returns (both the works-at link and the field) _(both)_

## Calendar — event delete
- [ ] **Do:** Delete a native event (the existing "Delete this event?" confirm still appears) → confirm → **Expect:** "Event deleted" + Undo _(both)_
- [ ] **Do:** Click **Undo** → **Expect:** the event reappears on the calendar; reload → still there _(both)_

## Dashboard — habit remove
- [ ] **Do:** On a Habits widget, remove a habit → **Expect:** "Removed …" + Undo, and the Undo window is now **8 seconds** (was 4s) _(both — desktop for the widget)_

## Notes — trash + detach
- [ ] **Do:** Trash a note that contains task lines → **Expect:** ONE toast, "Moved to Trash · N tasks detached", with **Undo** and a red **"Delete the task(s) too"** text link in the body (not in the dismiss slot) _(both)_
- [ ] **Do:** Detach task lines from a note (delete mode) → click the red **"Delete the tasks too"** → **Expect:** the tasks are deleted quietly — **no storm of "Task deleted" toasts** (one silent bulk delete) _(both)_

## Settings — API-key revoke
- [ ] **Do:** Workspace settings → API keys → Revoke a key → **Expect:** a **confirm dialog** ("Anything connected with this key loses access immediately. This can't be undone.") — revoke is NOT instant anymore _(both)_
- [ ] **Do:** Cancel → key stays; Confirm → key removed _(both)_

## Migrations / data
- [x] **`20260710120000_df5_restore_ops.sql` APPLIED to prod 2026-07-10** — `contacts_op_restore` + `calendar_op_event_restore` exist, `authenticated` has EXECUTE, `anon` does not; a rolled-back delete→restore round-trip on the test workspace revived 4 links + un-tombstoned the registry. **Confirm:** contact-delete Undo and calendar-event-delete Undo actually restore (not a "Couldn't restore" error toast).

## Known gaps / not-yet-testable
- Calendar-event-delete Undo was verified by schema-compile + code symmetry with the contact path (which was round-trip-proven), not a live click — worth one manual click on desktop.
- Storybook render is blocked in this worktree (recorded gotcha), so no story-level visual capture of the toast/dialog chrome.
- The undo-toast danger link's exact visual (red text link, rounded-md focus ring, font-display) was verified by the design-rule review, not an eyeball on a live toast — glance at it when trashing a note with tasks.
