# Manual test checklist — AT-3 attachments everywhere + Settings → Storage

> Generated 2026-10-14 · branch `t/maciej/at-3-everywhere` (lands on `t/maciej/tasks-v3-build`, local build mode) · migration `20261013272000_attachments_everywhere` (local stack only) · **Live-verified (2026-10-14):** yes on the web against the local stack (`dev@moduo.local`): the 📎 count on a List row; a file trashed outside the app (as the same person, through the op) dropped the row's 📎 from 6 to 5 and the open strip re-read without reopening; a PNG dropped on a row lit the row and attached (`ready`, WebP preview), its 📎 1 appeared live; a screenshot pasted into the capture became a 📎 chip and attached to the new task after Create; Settings → Storage showed the meter, the plan line and the largest files, and Delete took a file out (meter and list re-read). Not checked live: the Board, Timeline, Focus, Calendar, Home and note marks (unit-tested), the notices' deep link, an offline capture, the desktop app.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The 📎 mark (AT3-3)
- [ ] **Do:** give a task two files, then look at it in the List, on the Board, in the Timeline's name column, in Focus (Now card and Up next), on its Calendar block, in Home's Tasks widget, as a task line in a note, and in ⌘K → **Expect:** a quiet paperclip and "2" after the title (after the tags, before comments), muted, never a thumbnail. A task with no files shows nothing. _(both)_
- [ ] **Do:** in a second window as a teammate, add a file to a task you have open → **Expect:** your row's 📎 count goes up and the open strip shows the new file, without reopening. Delete it there: both go back. _(web)_
- [ ] **Do:** Filter → Has attachments → **Expect:** only tasks with files; adding a file elsewhere brings its task in. _(both)_

## Drops on rows and cards (AT3-1)
- [ ] **Do:** drag a screenshot from the desktop over the List → **Expect:** the row under the pointer lights (the same look as a drag-and-drop target); between rows nothing lights. Drop it → **Expect:** a toast "Attaching shot.png · on “…”" with Open; the row's 📎 count appears once it's up. _(web)_
- [ ] **Do:** the same on a Board card → **Expect:** the card lights, then the same toast and count. _(web)_
- [ ] **Do:** as a Free owner, drop a 30 MB file on a row → **Expect:** one line "x.mov is 30 MB — your plan allows 20 MB per file" in the toast, nothing attached, nothing left waiting on the task. _(both)_
- [ ] **Do:** in an archived (read-only) project, drag a file over a row → **Expect:** no highlight; the drop does nothing. _(both)_

## Capture (AT3-2)
- [ ] **Do:** ⌘⇧K, type a title, ⌘V a screenshot (in the title or the description) → **Expect:** a 📎 chip with the file's name; × takes it off. Create → **Expect:** the task appears; open it: the file is there (or uploading). _(both)_
- [ ] **Do:** drop two files on the capture, plus a folder → **Expect:** two chips; the folder is left out. _(web)_
- [ ] **Do:** go offline, capture a task with a screenshot, reload, go back online → **Expect:** the task syncs, then the file attaches by itself; meanwhile the task's strip reads "Not attached yet — the task is still syncing…". _(web)_
- [ ] **Do:** pick a template in the capture and paste a file → **Expect:** the file lands on the task the template makes. _(both)_

## Settings → Storage (AT3-4)
- [ ] **Do:** as the workspace owner, open Settings → Storage → **Expect:** "N MB of 2 GB used" (a bar under it), "Your Free plan · 20 MB per file · shared across the n workspaces you own", then the largest files (name, task · who · when, size, a bin). _(both)_
- [ ] **Do:** as an admin → **Expect:** the same meter, worded as the owner's plan. As a member or viewer → **Expect:** no meter at all; only files on tasks you can see; no bin on files of tasks you can only view. _(both)_
- [ ] **Do:** Delete a file there → **Expect:** it leaves the list, the meter drops, a "File deleted" toast; Undo brings it back. _(both)_
- [ ] **Do:** fill the pool past 80% → **Expect:** the meter's line reads stronger with "· 8x%", never red; the bell's "filled storage past 80%" card opens Settings → Storage. _(both)_
- [ ] **Do:** on a full pool, drop a file on a task's panel and press "Free up space" on its tile → **Expect:** Settings → Storage opens. _(both)_

## Uploads that never finish
- [ ] **Do:** near the limit, drop a big file, Dismiss it while it uploads, then drop it again → **Expect:** the second try isn't refused as "storage is full" (the first one's space was let go). _(both)_

## Migrations / data
- `20261013272000_attachments_everywhere` (local stack, applied 2026-10-14): `attachments_op_abandon`, `attachments_largest`, `storage__unsettled_bytes` re-cut, an index, the attachments grants re-asserted. SQL test: `bun run db:test attachments_everywhere` (69 checks).

## Verify before release
- The desktop app: drag a file from Finder onto a List row and a Board card (needs `dragDropEnabled: false`, AT-2).
- On prod, the `attachments_guard_object` trigger exists (the local stack has none): an abandoned upload's object can't change afterwards there either way (the upload policies refuse it), but check the trigger is still in place after the release's migrations.
- Realtime on prod delivers `attachments` changes (it is in `supabase_realtime` since TV-D11b's migration).

## Polish later
- Settings → Storage: the task name in a file's line could open the task (and close Settings).
- The Focus Now card's subtask marks ("1 file") still read each subtask's files on open; they could read the store's counts.
- Timeline: a task point's hover text could add "· 2 files".
- The Storage list shows only the 50 largest; no "more" line.
- Visual baselines for the new marks and the Storage section are uncaptured.

## Known gaps / not-yet-testable
- A capture the server refuses comes back with its words, but its file chips don't come back with it (the files are dropped).
- The notices' deep link was unit-tested, not driven live (it needs a pool past 80%).

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
