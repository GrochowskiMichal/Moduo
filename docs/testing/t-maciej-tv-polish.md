# Manual test checklist — TV-POLISH Tasks v3 polish batch

> Generated 2026-10-14 · branch `t/maciej/tv-polish` · **Live-verified:** partly: the Timeline items ran in the real app through `tests/tasks-timeline.spec.ts` (⇧L, view-only handles at All) against a production build on the local stack; the reference tick outside Tasks and the storage toast are covered by unit tests and wait for your pass. What was deferred, and why: [tasks-v3-polish-deferred.md](./tasks-v3-polish-deferred.md).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Timeline across projects (TL2's view-only handles)
- [ ] **Do:** as a teammate, make a project with dates and a dated task, and share it with you **view only**; open Tasks → All → Timeline → **Expect:** its bar has no ends to drag and doesn't move when dragged; your own projects' bars still drag _(web)_
- [ ] **Do:** unfold that project → **Expect:** its tasks' points have no grab cursor; dragging does nothing; your own tasks' points still drag _(web)_
- [ ] **Do:** put the cursor on one of its tasks and press ⌥→, `d`, ⇧D → **Expect:** nothing changes, no "Couldn't save" toast _(web)_
- [ ] **Do:** open No date (if it has an undated task) → **Expect:** its row isn't draggable; yours are _(web)_
- [ ] **Do:** the same at My tasks → **Expect:** the same _(web)_

## Timeline keys and drops (TL2)
- [ ] **Do:** make a task due before one it waits on (the late mark ↰ appears left of its point), put the cursor on its row, press ⇧L → **Expect:** the mark's popover: "Waits on “…”, due …, after this." and "Move to …", focused _(web)_
- [ ] **Do:** Esc → **Expect:** it closes and ↑↓ move the cursor again; ⇧L then ⏎ on "Move to …" moves the date, with Undo _(web)_
- [ ] **Do:** open No date, drag a task over the name column → **Expect:** the preview says "Drop on a day"; over the days it says "Due …"; letting go over the names does nothing _(web)_
- [ ] **Do:** move a blocker later, click "Also move the one that waits on this" where that one repeats, then Cancel the "Just this one · Change the pattern" question → **Expect:** a toast "Moved · The ones that wait on it stay where they are." whose Undo puts the blocker back _(web)_

## A reference's tick outside Tasks (call 87)
- [ ] **Do:** in a note, insert a task that has two open subtasks, show it as a Card, press its Complete → **Expect:** the task and both subtasks are done; a toast "Done · also 2 subtasks"; Undo puts all three back (and the task back in Focus where it was, if it was lined up) _(web)_
- [ ] **Do:** Complete a task with no subtasks from a card → **Expect:** the card shows it done, no toast; unticking reopens it _(web)_
- [ ] **Do:** the same inside Tasks (a reference in a task's description) → **Expect:** unchanged: the module's own check-off and toast _(web)_

## Storage (AT-3)
- [ ] **Do:** as a workspace owner on a full pool, drop a file on a List row → **Expect:** "Not attached — storage is full (…)" with **Free up space** and **Upgrade**; Upgrade opens Settings → Billing _(web)_
- [ ] **Do:** the same as a member → **Expect:** Free up space only _(web)_
- [ ] **Do:** as an owner on Free, drop a 30 MB file → **Expect:** the "your plan allows 20 MB per file" line with **Upgrade** beside Open _(web)_
- [ ] **Do:** open a storage alert (80%/95%) from the bell → **Expect:** Settings → Storage opens in the workspace that raised it _(web)_
- [ ] **Do:** Settings → Storage in a workspace with more than 50 files → **Expect:** "Showing the 50 largest files." under the list _(web)_

## Small ones
- [ ] **Do:** start a big import (Tasks sidebar ⋯ → Import tasks…) → **Expect:** no × while the bar runs; Stop is there; the × comes back at the end _(web)_
- [ ] **Do:** select several tasks, type `@` or `#` with ⌥ on a European Mac layout (or AltGr on Windows) → **Expect:** the Assign / Tag picker opens _(web)_

## Tests (automated)
- [ ] **Do:** `bun run db:test` with other data on the stack (your own reminders, an e2e import) → **Expect:** all 36 files pass _(local)_
- [ ] **Do:** `bun run e2e -- --project=e2e` → **Expect:** 66 passed, one spec at a time (about 5 minutes) _(local)_

## Known gaps / not-yet-testable
- The visual project in a bare `bun run e2e` has no screenshot baselines yet (the visual round); its screenshot specs fail until they're captured.
- Per-project handles are asked once per page visit: a grant changed meanwhile shows on the next visit (the server still refuses).

## Verify before release
- The AltGr `@`/`#` path on a real Windows keyboard.
