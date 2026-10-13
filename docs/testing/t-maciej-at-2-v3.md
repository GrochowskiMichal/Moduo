# Manual test checklist — AT-2 upload pipeline, panel attachments, viewer

> Generated 2026-10-10, updated 2026-10-13 · branch `t/maciej/at-2-v3` (from `t/maciej/at-2-upload-pipeline`, merged with the v3 build; lands on `t/maciej/tasks-v3-build`, local build mode) · **Live-verified on v3 (2026-10-13):** yes on the web against the local stack (`dev@moduo.local`, the "Details" panel at about 254 px): a pasted PNG (WebP preview, row `ready`), a dropped 2 MB zip with the shared drop highlight, tiles wrapping under the description, the viewer ("1 of 2", →), Delete → Undo pressed with the viewer still open (file back, viewer open), a stray drop on the sidebar refused, the files back after a reload. **Earlier (2026-10-10, pre-v3 panel):** a 9 MB TUS upload, too-big and empty files, the Notes import zone, an offline paste surviving a reload, the reset guard. Not checked: the desktop app, HEIC in Safari, a reload in the middle of a big TUS upload.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Real uploads (local stack: `bun run local:up`, `bun run env:local`, `bun run dev:web`)
- [ ] **Do:** open a task, take a screenshot (⌘⇧⌃4) and press ⌘V anywhere on the panel → **Expect:** a dimmed tile with a progress bar under the description, then a sharp thumbnail. _(web)_
- [ ] **Do:** drop a 10–40 MB file (zip or video) on the panel → **Expect:** a file tile showing "N% of 38 MB", then the name and size. Reload while it's halfway: it resumes on its own, not from zero. _(web)_
- [ ] **Do:** drop a photo with location data (from a phone) → **Expect:** it attaches; open it, download it, and check its info: no GPS or camera data, and the right way up. _(web)_
- [ ] **Do:** drop an image longer than 4096 px → **Expect:** the viewer shows its size as 4096 on the long side. _(web)_
- [ ] **Do:** drop a `.HEIC` in Safari, then in Chrome → **Expect:** Safari: it becomes a `.jpg` with a thumbnail. Chrome: a file tile named `.heic` with no thumbnail. _(web)_

## Desktop (verify before release: needs a signed desktop build; `bun run dev:desktop` for a first look)
- [ ] **Do:** drag a file from Finder onto a task's panel → **Expect:** it attaches (the panel highlights while you hover). _(desktop)_
- [ ] **Do:** Notes → Import, and Contacts → Import: drop a file on each drop zone → **Expect:** both accept the drop (they were dead on desktop before). _(desktop)_
- [ ] **Do:** drop a file on the sidebar or an empty area → **Expect:** nothing happens; the window doesn't navigate to the file. _(desktop + web)_
- [ ] **Do:** signed out, drop a file on the sign-in screen → **Expect:** nothing happens; the app stays on the sign-in screen. _(desktop)_

## The strip and the viewer
- [ ] **Do:** click blank space in the task panel, then press ⌘V with a screenshot on the clipboard → **Expect:** it attaches (the panel keeps the focus). _(both)_
- [ ] **Do:** in the viewer, Delete a file, then press Undo on the toast → **Expect:** the file comes back and the viewer stays open. _(both)_
- [ ] **Do:** open a confirm dialog anywhere (e.g. delete a project) while a toast is showing, press the toast → **Expect:** the toast's action runs; the dialog stays open. _(both)_
- [ ] **Do:** leave a task with image files open for over an hour (desktop), then look at the strip → **Expect:** the thumbnails still show. _(desktop)_
- [ ] **Do:** look at a task with files → **Expect:** thumbnails 64×44 and file tiles with name + size, then "+", right under the description. _(both)_
- [ ] **Do:** click a thumbnail, press → and ← → **Expect:** it moves between files; the header shows "2 of 3". _(both)_
- [ ] **Do:** Copy on an image, then paste into another app → **Expect:** the image pastes. _(both)_
- [ ] **Do:** Download → **Expect:** the original file is saved under its name. _(both)_
- [ ] **Do:** Delete → **Expect:** the file goes, and a "File deleted" toast with Undo appears; Undo brings it back. _(both)_
- [ ] **Do:** close the viewer with Esc → **Expect:** focus is back on the thumbnail you opened. _(both)_
- [ ] **Do:** drop a file onto the description text → **Expect:** it attaches; the text doesn't change and no image appears in it. _(both)_

## Errors (never red, never a dialog)
- [ ] **Do:** as a Free owner, drop a 30 MB file → **Expect:** "x.mov is 30 MB — your plan allows 20 MB per file · Upgrade". As a member: the same line, without Upgrade. _(both)_
- [ ] **Do:** drop three files where two are too big → **Expect:** the small one attaches, and one line lists the two others. _(both)_
- [ ] **Do:** turn the network off and drop a file → **Expect:** "Not attached yet — offline…". Turn it back on: it attaches by itself. _(both)_
- [ ] **Do:** drop an empty file → **Expect:** "Not attached — x is empty", with no Retry. _(both)_

## Edge cases
- [ ] **Do:** drop a file, and sign out while it uploads → **Expect:** the upload stops; sign back in and it finishes by itself. _(both)_
- [ ] **Do:** a view-only member opens a task with files → **Expect:** files open and download; there's no "+", and a drop does nothing. _(both)_
- [ ] **Do:** have two tabs open, drop a big file in one, reload the other → **Expect:** one attachment, not two. _(web)_
- [ ] **Do:** with a file still uploading, Settings → Advanced → Reset local cache → **Expect:** blocked: "1 file hasn't finished uploading…". _(both)_

## Migrations / data
- None. AT-1's storage, ops and limits are used as they are.

## Known gaps / not-yet-testable
- An upload that is begun again (Retry after a failure, a refused upload, a dismissed one) leaves its old pending row counted against the owner's pool until the 24 h sweep: near the limit, a few retries of a big file can read "storage is full" for a while. A server op to abandon one's own unfinished upload is the follow-up (🟠 box, "From AT-2").
- Another person's upload shows in an open strip on the next open, not live (AT-3 wires the live feed with the 📎 counts).
- The local stack has no `attachments_guard_object` trigger on `storage.objects` (the snapshot loads prod's storage policies, not that trigger), so "a finalized file's bytes can't change" isn't exercised locally; it is on prod.
- The desktop Finder drop and the import zones need the desktop app.
- `tests/visual/attachments.spec.ts` baselines are a human capture (`bun run storybook`, then `bunx playwright test --project=visual tests/visual/attachments.spec.ts --update-snapshots`). The TV-U3 panel baselines change too: the "+" tile now shows under the description.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
