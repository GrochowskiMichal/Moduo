# Manual test checklist — Notes NO-5: Task lines (the great moment)

> **✅ Migration status (reconciled 2026-08-14 · DOC-1): every migration this checklist depends on is APPLIED to prod.** OPS-1 + OPS-2 (2026-07-29) applied and verified every migration file in the repo against the live catalog. Any "unapplied" / "deploy-gated" / "**[post-deploy]**" wording below describes the state when this doc was written — **those rows are runnable now, not blocked**. Status of record: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md).

> Generated 2026-07-04 · branch `claude/nifty-torvalds-7c2339` · **Live-verified:** partial — every server-round-trip flow (mint→Inbox+spawned-from link, link-existing→references, checkbox→status op, rename→title patch, ⌘Z-after-mint full revert incl. task+link deletion, detach toast+undo) was verified against the REAL hosted Tasks/spine backend from a local dev server; the notes shell ran on stubbed `notes_op_*` RPCs (migration still unapplied — same NO-1..4 posture). Gestures that resist synthetic events (⌘⇧T batch selection, schedule popover click-through) are listed for your pass.
> Run top-to-bottom in `/notes`; check off as you go. Task lines only fully work once the NO-1 migration is deployed; pre-deploy the notes module is read-only (degraded banner) and none of this is reachable.

## /task — create (mint)
- [ ] **Do:** in a note body type `/task`, pick nothing, type a NEW title (e.g. "Ship the alpha invite"), Enter on **Create task "…"** → **Expect:** the line becomes a task line: circle checkbox left, quiet meta right; a tiny pulsing dot while creating, then it settles (never a broken chip). _(web + desktop)_
- [ ] **Do:** open `/tasks` → **Expect:** the minted task sits in **Inbox**, todo, no due/schedule. _(both)_
- [ ] **Do:** on the task in /tasks, check its links (or the note's Detail rail after NO-7) → **Expect:** a **Spawned from** link back to the note. _(web)_

## /task — link existing
- [ ] **Do:** `/task`, type a few letters of an EXISTING open task, Enter on it → **Expect:** a task line for that task (its real title), no duplicate task created; the link kind is **References**. _(both)_
- [ ] **Do:** `/task` and type the exact title of an existing task → **Expect:** NO "Create task" row (exact match suppresses it); the existing task is the top row. _(web)_
- [ ] **Do:** `/task` picker open → press Escape / click away → **Expect:** picker closes, caret returns to the note, no insertion. _(web)_

## Two-way sync
- [ ] **Do:** click the line's checkbox → **Expect:** instant strike-through + muted text; in /tasks the task reads **Done** (recurrence-aware). Uncheck reopens. _(both)_
- [ ] **Do:** edit the line's text, pause ~1s → **Expect:** the task's title in /tasks updates to the line text (rename only — status/schedule untouched). _(both)_
- [ ] **Do:** rename/complete the task IN /tasks, come back to the note (window refocus) → **Expect:** the line text/checkbox reflects it within a moment (never while your caret is inside that line). _(web)_
- [ ] **Do:** delete the task in /tasks, refocus the note → **Expect:** the line renders a quiet "task deleted" tombstone with an ✕ **remove line** affordance; ✕ removes just the line. _(web)_

## Task-detail rail + schedule
- [ ] **Do:** click the line's meta chip ("Details" or the date label) → **Expect:** the right panel opens **Task detail** — the full Tasks panel (status, bucket, schedule, due, priority, subtasks, activity) for THIS task; edits there reflect on the line. ✕ in the header closes it. _(web)_
- [ ] **Do:** hover the line → click the small calendar-clock icon → pick a date+time → **Expect:** popover closes; the meta chip now shows the schedule; /tasks + /calendar agree. _(web)_

## Convert (checkbox → task)
- [ ] **Do:** make a plain `/todo` checkbox line, hover it → **Expect:** a quiet **Make task** pill appears at the line's right; clicking it mints (checkbox → live task line, task in Inbox). _(web)_
- [ ] **Do:** right-click a checkbox line → **Expect:** menu with **Make task (⌘⇧T)**; right-click a TASK line → **Open task details / Detach, keep task / Detach and delete task**. _(web)_
- [ ] **Do:** select ACROSS three checkbox lines, press **⌘⇧T** → **Expect:** all three mint (batch), each its own task, one after another — no modal. _(web — untested by synthetic events, please verify)_
- [ ] **Do:** convert a checkbox in a list with items BELOW it → **Expect:** the list splits around the new task line; the items below keep their order and checkbox-ness. _(web)_

## Detach & revert (AC4)
- [ ] **Do:** immediately after minting via `/task` or convert, press **⌘Z** → **Expect:** the line reverts (checkbox/text back), AND the just-minted task is GONE from /tasks — no orphan. _(both)_
- [ ] **Do:** line menu → **Detach, keep task** → **Expect:** line becomes a humble checkbox, task survives in /tasks, note↔task link quietly removed. No toast. _(web)_
- [ ] **Do:** line menu → **Detach and delete task** → **Expect:** line becomes a checkbox + ONE toast "Task deleted · Undo"; Undo restores the task, the link, and the task line. _(web)_
- [ ] **Do:** select N task lines (mixed with normal text) and delete the selection → **Expect:** ONE toast — "N tasks detached · Still in Tasks — delete them too?" with **Delete tasks** and **Undo** (8s). Never stacked toasts, never a modal. _(web)_
- [ ] **Do:** click that toast's **Undo** → **Expect:** the lines re-appear (with their tasks re-linked). **Do:** repeat and click **Delete tasks** → **Expect:** the tasks leave /tasks too. _(web)_
- [ ] **Do:** delete a task line, then press **⌘Z** instead of the toast → **Expect:** the line comes back, the link is restored, the toast retires — no double-undo weirdness. _(web)_
- [ ] **Do:** trash a NOTE containing task lines from the sidebar → **Expect:** ONE toast "Moved to Trash · N task(s) detached" with Undo + Delete tasks; the note↔task links are dropped (real detach — the count covers child pages too, up to 20 docs); the tasks survive in /tasks; Undo restores the note AND the links. _(web)_
- [ ] **Do:** delete a task line and press ⌘Z within a beat (before the toast would appear) → **Expect:** the line is simply back — NO detach toast, links untouched. _(web — live-verified)_

## Markdown doors
- [ ] **Do:** copy a task line (select the whole line, ⌘C) and paste into a plain-text editor → **Expect:** `- [ ] Title <!-- moduo:task:<id> -->` (checked = `[x]`). _(web)_
- [ ] **Do:** paste that md into a fresh EMPTY note → **Expect:** it becomes a real task line bound to the same task (not a literal-text bullet). A plain `- [ ] item` WITHOUT the comment stays a humble checkbox. _(web)_

## Edge cases
- [ ] **Do:** mint while offline / with the network throttled to fail → **Expect:** an honest error toast; the line degrades back to a plain checkbox (title kept) — never a forever-pending dot. _(web)_
- [ ] **Do:** Enter at the end of a task line → **Expect:** a plain paragraph below (never a second line of the same task). Backspace at the line's start → the line degrades to a paragraph + the ONE detach toast. _(web)_
- [ ] **Do:** two windows on the same note; delete a task line in window A → **Expect:** the toast appears in A only; B just sees the line disappear. _(two sessions, post-NO-6)_
- [ ] **Do:** view-only member opens a note with task lines → **Expect:** checkbox disabled, no hover actions, no Make-task pill; meta chip still opens Task detail read-only. _(web, needs a viewer account)_

## Migrations / data
- [ ] No new migration in this block. It RIDES `20260703120000_notes_module.sql` (NO-1, **still unapplied**) — apply that first or /notes stays degraded/read-only. `allowedKinds(note,task)` already permitted `spawned-from`/`references` (now test-pinned).
- [ ] Live-verify probe data on the hosted test account was cleaned (3 probe tasks soft-deleted, 4 links op-deleted); a few tombstoned probe links may linger harmlessly in hub trails.

## Known gaps / not-yet-testable
- **⌘⇧T batch selection + schedule-popover click path** — synthetic-event limits; single-line convert + the DateField write path were verified, the multi-line selection gesture needs a human pass.
- **Storybook story** (`task-line-states.stories.tsx`) compiles but can't render in this worktree (known preview binding issue — gotchas.md).
- **Toast-undo restores lines as plain text** (title only) — inline formatting inside a deleted task line isn't rebuilt by the TOAST undo (Lexical ⌘Z keeps full fidelity). Accepted at alpha.
- **Note-trash detach walks the gesture note + up to 20 descendants** (800ms doc-boot cap each) — a huge subtree may undercount; purge still drops any missed links server-side.
- **⌘Z-after-mint is bounded to 60s** — past that, undoing a mint detaches with the normal toast instead of deleting the task (an hour-later undo sweep must not quietly delete worked-on tasks).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
