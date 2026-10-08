# Manual test checklist — TV-Q1 Quick fixes

> Generated 2026-10-08 · branch `t/maciej/tv-q1-quick-fixes` · **Live-verified:** partial. Checked in Chromium on a temporary harness that mounted the real rail, List, Board, shortcut sheet and `useTasksModule` over an in-memory runtime; an agent can't sign in to the hosted project. Not yet run in the desktop app or against Supabase.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Keyboard with the list focused (Q1-1)
- [ ] **Do:** Open Tasks → a bucket, click a task, then press ⌘K → **Expect:** the command palette opens and the selection doesn't move. _(both)_
- [ ] **Do:** Same, press ⌘⇧K → **Expect:** the quick-capture bar opens. _(both)_
- [ ] **Do:** Same, press ⌘C, ⌘X and ⌘V → **Expect:** nothing happens in the list: no capture modal, no task completed. _(both)_
- [ ] **Do:** Press ⌘1 … ⌘7 with the list focused → **Expect:** you jump to that tab (⌘7 is Chat on Duo, Team and Founder workspaces). _(desktop; on the web the browser may keep ⌘1–9)_
- [ ] **Do:** Press j, k, x, e, c, b, s, d, q and ⌘⌫ → **Expect:** each works as before. _(both)_

## Buttons inside rows keep Space and Enter (Q1-2)
- [ ] **Do:** In a bucket, Tab until a row's queue toggle (the list-check icon) has focus, press Space → **Expect:** that task joins or leaves the Queue; the row doesn't lift into a drag and the selected task doesn't complete. _(both)_
- [ ] **Do:** Same on a row's check-off circle, press Enter → **Expect:** that row completes; no title editor opens. _(both)_
- [ ] **Do:** Queue → Tab to a row's "Remove from queue", press Space → **Expect:** the task leaves the Queue, no drag. _(both)_
- [ ] **Do:** Board → Tab to a card's queue toggle, press Space → **Expect:** it toggles and the card stays put. Tab to the card itself, press Space → **Expect:** the card lifts; arrows move it; Escape puts it back. _(both)_
- [ ] **Do:** Click a task's title, then press Enter → **Expect:** the title editor opens. Click another title and press Space → **Expect:** that task completes. _(web; Chrome focuses a clicked title)_
- [ ] **Do:** Tab to an unselected row's title, press Space → **Expect:** that row becomes selected; press Space again → **Expect:** it completes. _(both)_
- [ ] **Do:** Click a row's check-off, then press Space → **Expect:** Space completes the selected row; it doesn't re-toggle the row you clicked. Press j, then Space → **Expect:** the newly selected row completes. _(web)_
- [ ] **Do:** Drag a row onto another in a bucket; drag Queue rows to reorder → **Expect:** drag still nests and reorders. _(both)_

## Bucket pill (Q1-3)
- [ ] **Do:** Open a bucket (and Inbox), set Group to Status, then Priority, then Energy → **Expect:** no row shows a bucket pill. _(both)_
- [ ] **Do:** All grouped by Bucket → **Expect:** no pills under the group headers. All grouped by None or Status, and the Queue → **Expect:** every row shows its bucket pill. _(both)_
- [ ] **Do:** Where the pill is hidden, select a task and press b → **Expect:** the bucket picker opens beside the row; picking a bucket moves the task, and the picker's arrows and Enter don't move the list cursor. _(both)_
- [ ] **Do:** Board in a single bucket → **Expect:** no pill on cards. Board in All grouped by Status → **Expect:** pills shown. _(both)_

## Delete bucket (Q1-4)
- [ ] **Do:** Rail → a bucket's ⋯ → "Delete bucket…" → **Expect:** a dialog "Delete “<name>”?" saying "It has N tasks, which will move to Inbox." N counts every task in that bucket's list; when some are done it reads like "It has 5 tasks (3 open), …", matching the rail's open count. Cancel has focus. _(both)_
- [ ] **Do:** Cancel → **Expect:** nothing changes, and the rail is clickable again. _(both)_
- [ ] **Do:** Delete bucket → **Expect:** the bucket leaves the rail, Inbox's count grows, and a toast reads "“<name>” deleted · Its N tasks moved to Inbox. · Undo". _(both)_
- [ ] **Do:** Click Undo within 8 seconds, then reload → **Expect:** the bucket and its tasks are back where they were, also after the reload. _(both)_
- [ ] **Do:** Delete again and let the toast close, then reload → **Expect:** the bucket is gone and its tasks are in Inbox. Check from a second browser too. _(both)_
- [ ] **Do:** Delete, keep the pointer on the toast past 8 seconds, then Undo → **Expect:** Undo still works; the delete waits for the toast to close. _(both)_
- [ ] **Do:** Delete a bucket with no tasks → **Expect:** the dialog says "It has no tasks." and the toast has no second line. _(both)_
- [ ] **Do:** Delete two buckets within a few seconds → **Expect:** both stay gone from the rail while their toasts are up, including when the first toast closes. _(both)_
- [ ] **Do:** Delete a bucket, switch to Calendar and back to Tasks before the toast closes → **Expect:** the bucket stays gone on both pages, and after the toast closes too. _(both)_
- [ ] **Do:** Delete a bucket, rename one of its tasks (now in Inbox) before the toast closes, then Undo → **Expect:** the task is back in the bucket with its new name, also after a reload. _(both)_

## Shortcut sheet (Q1-5)
- [ ] **Do:** Press ? (or the bottom bar's help) → **Expect:** the sheet lists "⌘1 – ⌘7 · Jump to a module". _(both)_

## Edge cases
- [ ] **Do:** Press s on a task, then type Space, arrows and ⌘⌫ in the date field → **Expect:** they edit the field; the task isn't completed, moved or deleted. _(both)_
- [ ] **Do:** Delete a bucket, then quit or reload before the toast closes → **Expect:** the bucket is still there afterwards (known limit: the delete commits when the toast closes). _(desktop)_

## Migrations / data
- [ ] None. No schema change: the server delete is the same `deleteBucket` call as before, now sent when the Undo toast closes.

## Known gaps / not-yet-testable
- Not yet run in the desktop app or against Supabase. WebKit doesn't focus a clicked button, so the Chrome-only "clicked title" case doesn't arise on desktop.
- The row context menu's "Schedule…", "Set due date…" and "Move to bucket…" didn't open their popovers in the harness. Those code paths are untouched here, so this looks older than this block; the s, d and b keys work.
- The Queue has no keyboard-only reorder until TV-U5's ⌘↑/⌘↓.
- When the delete dialog closes, focus goes to the page body (the same as the notes "Delete forever" dialog), so press a key in the list only after clicking it.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
