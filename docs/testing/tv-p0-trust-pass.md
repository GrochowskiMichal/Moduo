# Manual test checklist — TV-P0 trust pass (Tasks v3 block 3)

> Generated 2026-10-10 · branch `t/maciej/tv-p0-trust-pass`, landed on the local integration branch `t/maciej/tasks-v3-build` · **Live-verified:** yes, on the local stack (web, `127.0.0.1`), by hand in the browser pane and by `tests/trust-pass.spec.ts` (10/10). Desktop not run.
> Run on the local stack: `bun run local:up`, `bun run env:local`, `bun run dev:web`, sign in as dev@moduo.local (code in Mailpit). Each item is a step → what you should see → where.

## Capture keeps your words (AC1.3)
- [ ] **Do:** New task, type `Send March report` → **Expect:** no date pill; the title keeps "March". _(web)_
- [ ] **Do:** type `Call Mike at 5` → **Expect:** the scheduled pill reads today (or tomorrow if it's past 5 PM) at **5:00 PM**, title "Call Mike". _(web)_
- [ ] **Do:** type `Team sync tomorrow 3pm every week` → **Expect:** the scheduled pill reads "Tomorrow, 3:00 PM" and the repeat pill "every week". _(web)_
- [ ] **Do:** type `Pay rent every month for the flat on the 1st` → **Expect:** title "Pay rent for the flat", repeat "every month on the 1st". _(web)_
- [ ] **Do:** with text in the title, press ⌘A → **Expect:** all the text is selected (also in ⌘⇧K). _(web + desktop)_

## Won't do and Reopen (AC1.4)
- [ ] **Do:** open a task, ⋯ → **Won't do** → **Expect:** the task stays listed, struck through and dimmed; the panel shows "Won't do · Reopen"; Status reads "Won't do". _(web)_
- [ ] **Do:** select a task in Inbox, click All, then ⋯ → Won't do → **Expect:** same as above, in All. _(web)_
- [ ] **Do:** click **Reopen** → **Expect:** Status "To do"; the trail shows "marked this Won't do" then "reopened this". _(web)_
- [ ] **Do:** click another bucket in the rail → **Expect:** the Won't do task leaves the list. Its link (Copy link → paste in the address bar) opens it again with Reopen. _(web)_

## Loading and empty states (AC1.5)
- [ ] **Do:** reload /tasks on a slow connection (DevTools → Network → Slow 4G) → **Expect:** grey placeholder rows (List) or card outlines (Board), never "Nothing here yet". _(web)_
- [ ] **Do:** filter by a tag no task in this bucket has → **Expect:** "No tasks match" with **Clear filters**; clicking it brings the list back. _(web)_
- [ ] **Do:** open an empty bucket → **Expect:** "No tasks in <bucket>" with Add a task / press c. _(web)_

## Focus time saves from any page (AC1.6)
- [ ] **Do:** Tasks → Focus → **Track time**, click **Notes**, wait 10 s, pause from the top-bar timer → **Expect:** no "not saved yet"; back in Tasks the task's Time row includes those seconds. _(web + desktop)_

## Notifications name the task (AC1.7)
- [ ] **Do:** as a teammate, assign a task to your account → **Expect:** the bell card reads "<name> assigned “<task title>” to you"; Home's Activity widget says the same. _(web)_
- [ ] **Do:** comment on a task someone else follows → **Expect:** their card reads "… commented on “<task>”: “<excerpt>”". _(web)_

## Subtasks follow their parent (AC1.8)
- [ ] **Do:** a parent with two subtasks in Inbox → move the parent (panel breadcrumb, or drag its card to another bucket column) → **Expect:** both subtasks are in the new bucket too. _(web)_

## New in Focus lands in Up next (AC1.9)
- [ ] **Do:** Tasks → Focus → ⌘N (or the bottom bar's +), create a task → **Expect:** it appears at the end of Up next and in the Queue. _(web)_

## Private project and Private item (AC1.10)
- [ ] **Do:** as the owner, make a bucket private (Share → only me), put a task in it and assign it to a member; sign in as the member and open the assignment's notification → **Expect:** that task opens (in All); its project reads "Private project" with a lock, never "Inbox". _(web)_
- [ ] **Do:** as the member, open a link to a task in that private bucket that isn't assigned to you → **Expect:** the panel says "Private item"; **Back to your tasks** returns to the list. _(web)_

## Trail and dates (AC1.11, AC1.12, AC1.15, AC1.16)
- [ ] **Do:** open any task → **Expect:** the meta line under the trail never says "Rescheduled N×". _(web)_
- [ ] **Do:** select a row, press **s**, pick Tomorrow, type a time, press Enter → **Expect:** one save; the row shows "Tomorrow"; the trail adds "rescheduled this to Tomorrow, 10:30 AM". Pressing Esc instead saves nothing. _(web)_
- [ ] **Do:** in a note, open a task line's schedule picker, pick a day and a time, click away → **Expect:** one save when the picker closes (not on the day click); Esc closes it without saving. _(web)_
- [ ] **Do:** look at dates across a row, a card, the panel, the trail and Calendar's Tasks panel → **Expect:** one form everywhere: Today · Tomorrow · Mon · Oct 16 · Oct 16, 2027 · 3:00 PM · 45m · 1h 30m. _(web)_
- [ ] **Do:** look at assignee avatars on rows, cards, the panel, the trail and your avatar in the top bar → **Expect:** two letters (first and last initial; a one-word name's first two letters); yours never "M". _(web)_
- [ ] **Do:** narrow the right panel, open a task with a long project name and a scheduled time that has passed → **Expect:** values wrap between words ("Today, / 4:15 PM", "passed" under it), nothing ends in "…"; same on cards and in Calendar's Tasks panel. _(web)_

## Edge cases
- [ ] **Do:** as a viewer, Tasks → Focus → "Add one more…" → **Expect:** "You don't have edit access…" toast. _(web)_
- [ ] **Do:** mark a recurring task done → **Expect:** toast "Done — next: Tomorrow, 9:00 AM" (the date in the one grammar). _(web)_

## Migrations / data
- [ ] None: this block adds no migrations.

## Known gaps / not-yet-testable
- Desktop (Tauri) not run; ⌘A relies on the app menu's Select All there.
- "Private item" can't tell a deleted task from a private one (RF-1 / TV-D8 make the registry answer); a stale id restored on refresh clears quietly.
- A comment notice names its task only once the task is in the entity registry (any comment puts it there); TV-D8 registers every task at creation.
- Rows and the rail still truncate long titles (TV-U10, TV-U6); group headers still use small caps (DS-6, call 40).
- In the Queue scope a task marked Won't do leaves the line-up at once (it leaves every queue on the server); reopen it from its link or from All.
- AC1.13 (MCP lists past 1,000) and AC1.14 ("blocks" links block) are TV-D8's and join `tests/trust-pass.spec.ts` with it.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
