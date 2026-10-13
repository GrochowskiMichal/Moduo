# Manual test checklist — TV-F8 Along the way, meeting divider, pace, In flight

> Generated 2026-10-14 · branch `t/maciej/tv-f8-focus-extras` · **Live-verified:** on the local stack as `dev@moduo.local` (web, headless Chrome on a dev server of this worktree, a workspace of its own per run): with Logo concepts (Acme, ~30m) on the Now card, Up next "· 3 · ~1h 5m" showed "Arrange by project · 2 fewer switches" and "── 2:28 AM · Acme call ──" after the one task that fits before a meeting 75 minutes away; ⋯ lists Timer · Arrange by project · Offer quick tasks along the way ✓ · Show what's done · Stop; Arrange grouped Acme then Website and Undo put the line-up back; Done on the Acme task, with Website next, showed "↳ Before you leave · Acme rebrand / Send invoice #14 · 5m — Take it ⏎ · Not now Esc" in the card's place, Esc dismissed it; W opened "Waiting on…", typing and ⏎ moved to Check back + "Where you left off", ⏎ handed it off: the next task became Now, "Waiting on Anna's feedback · In flight · Undo", "1 in flight" under Up next opened the panel on In flight with the card "Waiting on Anna's feedback · check in 30m". `tests/focus.spec.ts` (6, AC8.1–8.8 + Hand off) and `tests/tasks-detail.spec.ts` (5) pass serially on installed Chrome. Pomodoro's break offer, a due check-back's notice and the agent line on the card weren't driven live (unit tests; see the gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Arrange by project (57, AC8.7)
- [ ] **Do:** line up tasks alternating two projects (Acme, Web, Acme, Web, Acme) → **Expect:** Up next's header shows "Arrange by project · 3 fewer switches" on the right. _(both)_
- [ ] **Do:** click it → **Expect:** Up next reads Acme, Acme, then Web, Web (Now's project first, your order inside each); "Arranged by project · Undo"; the header's offer goes. _(both)_
- [ ] **Do:** Undo → **Expect:** the line-up is back as it was. _(both)_
- [ ] **Do:** a line-up that would save only one switch → **Expect:** no header offer; ⋯ → Arrange by project still works; with nothing to save it's greyed out. _(both)_
- [ ] **Do:** a project holding a high-priority task in the middle of the line-up → **Expect:** after Now's project, that project's group comes next. _(both)_

## The meeting divider (64, AC8.6)
- [ ] **Do:** add an event on your own calendar starting in about an hour; line up tasks with estimates → **Expect:** "── 2:30 PM · Acme call ──" inside Up next after the tasks that fit before it (Now's remaining estimate counts first). Hover: "Tasks above the line fit before it, using your estimates". _(both)_
- [ ] **Do:** remove the estimate of the first Up next task → **Expect:** the divider moves above it. _(both)_
- [ ] **Do:** an event three hours away with a short line-up → **Expect:** no divider. A line-up of more than three hours' estimates → it shows. _(both)_
- [ ] **Do:** an all-day event, a cancelled one, or one on a calendar someone shared with you → **Expect:** no divider. _(both)_

## Between tasks: along the way (57, 59a, AC8.8)
- [ ] **Do:** Now in Acme, next in Web, an unqueued Acme task with a 5-minute estimate → Done → **Expect:** in the card's place "↳ Before you leave · Acme" with that task and "Take it ⏎ · Not now Esc"; Up next unchanged below. _(both)_
- [ ] **Do:** ⏎ → **Expect:** the task becomes the Now card (with a session running, the clock moves to it). _(both)_
- [ ] **Do:** repeat, press Esc → **Expect:** the offer goes; the Web task is Now. Finish it with the next in Web too → no offer (no project change). _(both)_
- [ ] **Do:** a 20-minute task, someone else's task, a blocked or waiting one, a Backlog one → **Expect:** never offered. _(both)_
- [ ] **Do:** answer Not now three times for the same task (three changes) → **Expect:** the fourth offer reads "You've passed on this three times…" with Shrink · Move · Let go · Not now; Shrink opens its Details, Move puts it in Backlog (Undo), Let go marks it Won't do (Undo). _(both)_
- [ ] **Do:** ⋯ → Offer quick tasks along the way (off), or Settings → Focus → off → **Expect:** no offer at a project change. _(both)_
- [ ] **Do:** Done on the last task in Up next → **Expect:** no offer; the session ends. _(both)_

## Between tasks: Pomodoro's break (62a)
- [ ] **Do:** Timer → Pomodoro with 1-minute lengths (Settings → Focus), Start, wait for the work block to end, then Done → **Expect:** "Work block done. Take a 1-minute break ⏎ · Skip Esc" first (before any along-the-way offer). Take it → the header pill counts the break; Skip → a fresh work block runs. _(both)_

## Hand off W and In flight (call 5, AC11.7)
- [ ] **Do:** on the Now card press W (or click Hand off) → **Expect:** "Waiting on…" with the workspace's people; typing something else offers it under "Something else". _(both)_
- [ ] **Do:** pick someone → **Expect:** "Waiting on Sam · Change", Check back None · 30m · 2h · Tomorrow · Next week, "Where you left off (optional)"; ⏎ hands it off. _(both)_
- [ ] **Do:** after the hand-off → **Expect:** the next task is Now (the session moved with its rhythm); "Waiting on Sam · In flight · Undo"; "1 in flight" under Up next; the task still counts in the sidebar's Focus. _(both)_
- [ ] **Do:** Undo → **Expect:** the wait and the check-back are gone; the task is Now again. _(both)_
- [ ] **Do:** with a note typed → **Expect:** the task's feed shows "Where I left off: …". _(both)_
- [ ] **Do:** click "1 in flight" (or Details ▾ → In flight, ⌥3) → **Expect:** the panel shows the card: title, project, "Waiting on Sam · check in 30m" (or "since 2h"). Click the title → the task opens with "← In flight". _(both)_
- [ ] **Do:** wait for the check-back → **Expect:** the reminder arrives (bell; OS notification on desktop, browser one if allowed); the card brightens ("check back now") with Pick up · Check back tomorrow; "1 to check" in Focus. _(both)_
- [ ] **Do:** Pick up → **Expect:** the wait ends; the task is back at the top of Focus; Undo puts the wait back. _(both)_
- [ ] **Do:** Sam comments on the task → **Expect:** the wait clears by itself (TV-D12); the task leaves In flight and is back in Up next where it was. _(both, two people)_
- [ ] **Do:** an agent (MCP key) posts "working" on a task of yours → **Expect:** In flight lists it "Claude · Writing tests · 2m ago"; the Now card shows the same line under its title when it's Now. _(both)_
- [ ] **Do:** Details ▾ on the Timeline → **Expect:** Details · Project / In flight · No date (⌥1–⌥4). _(both)_

## Usual pace (10, AC8.10)
- [ ] **Do:** finish ten tasks that had an estimate and tracked time → **Expect:** Up next's header adds "≈ 1h 20m at your usual pace". Nine → nothing. _(both)_
- [ ] **Do:** Timer → Off, or Settings → Focus → Show my usual pace off → **Expect:** the pace line goes. _(both)_

## Settings → Focus (F7-17)
- [ ] **Do:** Settings → Focus → **Expect:** "Timer and offers": Timer Per task · Pomodoro · Off (the line under it explains each), Count down the estimate (Per task only), Offer quick tasks along the way, Show my usual pace; then "Pomodoro" with the lengths. _(both)_
- [ ] **Do:** change the Timer here, then Start in Focus → **Expect:** the new session uses it; a running session keeps its own until ⋯ changes it. _(both)_

## Known gaps / not-yet-testable
- The notice a check-back sends says "Reminder" (it is one); a "Check back" wording is in Polish later.
- Pomodoro's break offer, a due check-back's brightening and the agent line on the card are covered by unit tests, not driven live.

## Verify before release
- The check-back's OS notification on a signed desktop build with the window closed (menu bar), and Web Push in a real browser.
- `tests/focus.spec.ts` serially against staging once the v3 migrations are there.

## Polish later
- Bell and OS copy for a check-back ("Check back: <task>") instead of "Reminder" — needs the notice to know it's a check-back (a reminder kind, a migration).
- The panel's Details ▾ menu shows no count for In flight ("In flight 2", rule 45): `RightPanel` has no count slot yet.
- Up next's header and the menu: "Offer quick tasks along the way" is long; check it never wraps at the menu's width on desktop zoom levels.
- The meeting divider reads "attending" as "on my own calendar"; once events carry attendance, use it.
- Pick up keeps a check-back that's still ahead (it fires later as a plain reminder); remove ahead-of-time check-backs on Pick up.
- The offer shows while the session already runs on the next task, so a few seconds of reading land there.
- List rows' `w` (keymap row letters) still isn't bound; Hand off lives in Focus only.
- Hand-off's people list shows everyone in the workspace, not only those who can see the task.
- Hand-off's Undo (validator MINOR): an Undo before the check-back reached the server leaves the check-back (a `tmp-` reminder can't be removed yet); a very fast Undo can race the wait's own save; the "Where I left off" comment stays; with nothing left to move to, the ended session isn't restarted.
- Pick up ends every wait on the task, a teammate's too; its Undo re-adds them as new entries (yours, "since" now).
- "Once per change" is remembered while Focus is open: leaving Focus and coming back can offer the same project change again.

## Validator round (lighter gate)
- MAJOR fixed: after Not now / the break's answer, focus fell to the page and the screen's keys stopped (the screen takes focus back now; test "after Esc on the offer the screen keeps the keys").
- MAJOR fixed: Arrange by project refused partway left the screen and the server apart with no Undo (the saved moves stand, the line-up shows the server's order, "Arranged only in part · Undo"; module tests).
- MINOR fixed: ⏎ no longer takes the Shrink · Move · Let go ask; ⇧F drops a showing offer; "Checking back tomorrow" only when the check-back went out; a stray doc comment in engine-core.
