# Manual test checklist — TV-F7 Focus screen v3

> Generated 2026-10-13 · branch `t/maciej/tv-f7-focus-screen` · **Live-verified:** on the local stack as `dev@moduo.local` (web, the Browser pane, a workspace of its own, "Focus check (TV-F7)"): the sidebar has no Plan · Focus switch; Focus with nothing lined up teaches the three ways in and listed two tasks scheduled today (Realtime added them while the screen was open); clicking one opened its details on the right; "Line up all 2" made the first the Now card with Start; Start under the synced Pomodoro default put "Focus 24:58" in the header and none on the card; ⋯ → Timer → Per task moved the clock onto the card ("⏸ 0:21") and the top bar; Done moved the session to the next task and the panel followed ("1 done · Show"); a line-up with a high-priority, estimated task showed "· ▮▮▮", "0:02 of ~45m", its description, its subtasks with "notes", Up next "· 3 · ~55m" with Bugs/Website dividers and ▶/× on hover; a click on a subtask opened its own details with the parent above and ▶ "Focus on this", which made it the Now card ("Website › Draft the launch announcement"); ⋯ → Stop showed "Focus stopped · Undo" and the card went back to Start; ⇧F on a List row started Focus with "Focusing on “…” · Open Focus"; the top-bar timer opened Focus; S skipped and ⏎ finished the Now task (subtask struck through, session on its parent); Show listed what's done. `tests/focus.spec.ts` (2) and trust-pass AC1.6/AC1.9 pass on installed Chrome against the local stack when run serially. Drag reorder, two devices and claims between two people weren't driven (see the gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Focus is a place in the sidebar
- [ ] **Do:** open Tasks → **Expect:** no "Plan · Focus" switch above the sidebar; Focus sits under Inbox with its count; its screen reader label says "n lined up". _(both)_
- [ ] **Do:** click Focus → **Expect:** the header reads "Focus ⋯" only (no view switch, no Filter, no New). _(both)_
- [ ] **Do:** on a device that was left in the old Focus mode, open Tasks → **Expect:** it opens on Focus once; afterwards it opens where you last were. _(both)_
- [ ] **Do:** with a session running, click the top-bar timer from Notes → **Expect:** Tasks opens on Focus. _(both)_

## The empty state teaches three ways in (first use)
- [ ] **Do:** Focus with nothing lined up → **Expect:** "Line up what you'll do next, then press Start.", one line on what Focus is, "Press Q…", "Press ⇧F…", and either today's scheduled tasks as rows or "tasks you schedule for today show up here". _(both)_
- [ ] **Do:** schedule two of your tasks for today (panel → Scheduled, or Calendar) → **Expect:** both rows appear in time order with project and time; a teammate's session, a Backlog or finished task doesn't. _(both)_
- [ ] **Do:** click a row → **Expect:** its details on the right. "+" adds just it; "Line up all n" adds them all in time order. _(both)_
- [ ] **Do:** "New task C" (or press C) → **Expect:** capture opens; the new task lands in Focus. _(both)_
- [ ] **Do:** as a viewer, open Focus → **Expect:** the hints, no "+", no Line up, "Lining up tasks needs edit access…". _(both)_

## The Now card and the timer
- [ ] **Do:** line up three tasks → **Expect:** the first is the Now card: one quiet line (dot · project › section · Due …, the priority mark only when high), Start top right, title, description folded at about six lines with Show more, linked items as chips, subtasks with "notes · 1 file · 2 links", Done ⏎ and Skip S. _(both)_
- [ ] **Do:** Start with Timer = Per task → **Expect:** "⏸ 0:01 of ~45m" on the card (with an estimate), the same clock in the top bar; click the pill → "▶ Paused · 0:05". _(both)_
- [ ] **Do:** let a 1-minute estimate run out → **Expect:** "1:10 · +1m", neutral (no red). With time tracked on an earlier day the note reads "~12m left". _(both)_
- [ ] **Do:** ⋯ → Timer → Count down the estimate → **Expect:** "44:50 left", then "+0:10" past it; with no estimate it counts up. _(both)_
- [ ] **Do:** ⋯ → Timer → Pomodoro → **Expect:** the card's pill goes; "Focus 24:58" sits in the header beside ⋯ with pause inside; on a break "Break 4:12". Lengths ▸ 50 / 10 changes the rhythm; "Other lengths…" opens Settings → Focus. _(both)_
- [ ] **Do:** ⋯ → Timer → Off → **Expect:** no pill anywhere on the screen; Done and Skip still work; the done line reads "2 done" without time. _(both)_
- [ ] **Do:** ⋯ → Stop → **Expect:** "Focus stopped · Undo" for 10 s; the card shows Start again; Undo brings the clock back. Stop sits alone at the bottom of ⋯, never next to Pause. _(both)_
- [ ] **Do:** go to Notes and back → **Expect:** the session kept running (top bar), the card shows the same clock. _(both)_

## Done, Skip and the keys
- [ ] **Do:** Done on the Now card while it runs → **Expect:** the session moves to the next task with its rhythm; the panel follows; "1 done · 25m · Show". _(both)_
- [ ] **Do:** Done on the last one → **Expect:** the session ends by itself; the screen shows "n done · …" and the empty state. _(both)_
- [ ] **Do:** Skip → **Expect:** the task goes to the end of Up next; the session moves on (alone, it stays). _(both)_
- [ ] **Do:** Done or Skip without starting → **Expect:** nothing starts; the next task becomes the Now card. _(both)_
- [ ] **Do:** click empty space on the screen, press ⏎, then S, then C → **Expect:** Done, Skip, new task at the top of Up next. Typing in the panel or capture never triggers them. _(both)_

## Subtasks open in the panel (65a)
- [ ] **Do:** click a subtask on the Now card → **Expect:** the right panel shows that subtask's own details with "← <parent>" and the parent breadcrumb; the row is highlighted. _(both)_
- [ ] **Do:** finish it there → **Expect:** the card's checklist updates; finishing the last one doesn't finish the parent. _(both)_
- [ ] **Do:** ▶ in its panel header, or ⇧F on its row → **Expect:** it becomes the Now card, "Project › Parent" in its top line; the parent moves to Up next. _(both)_

## Up next
- [ ] **Do:** a line-up across two projects → **Expect:** "Up next · 4 · ~1h", numbered rows, a divider with the project's dot at each project change; one project → no dividers. _(both)_
- [ ] **Do:** drag a row (or ⌥⇧↑/↓ on a focused row) → **Expect:** it moves, "Moved" with Undo; the Now card stays put. _(both)_
- [ ] **Do:** hover a row → **Expect:** ▶ (Focus on this) and × (Remove from Focus, with Undo); click the row → its details on the right. _(both)_
- [ ] **Do:** drag a row onto a project in the sidebar → **Expect:** it moves there (Undo). _(both)_

## ⇧F from any task (31) and the words
- [ ] **Do:** in a project's List, select a task, press ⇧F → **Expect:** "Focusing on “…”" with Open Focus (8 s); the top bar's clock runs; Open Focus shows it as the Now card. _(both)_
- [ ] **Do:** right-click a row or card → **Expect:** "Focus on this ⇧F" and "Add to Focus Q" / "Remove from Focus". _(both)_
- [ ] **Do:** the panel header → **Expect:** a Focus toggle icon (pressed when it's in your Focus; tooltip "Add to Focus Q") and ▶ "Focus on this ⇧F" (hidden while your session is on it). _(both)_
- [ ] **Do:** open Filter → **Expect:** the dimension reads "In my Focus"; tooltips say "In Mike's Focus" / "Also in Mike's Focus". _(both)_

## "Is on this" (two people)
- [ ] **Do:** Mike starts Focus on a task you can see → **Expect:** within a minute, its rows/cards show Mike's avatar with a quiet dot ("Mike is on this"); the panel header shows him once (not again as "In Mike's Focus"). _(both, two people)_
- [ ] **Do:** Mike pauses or stops → **Expect:** the mark goes within a minute. _(both, two people)_

## Known gaps / not-yet-testable
- **Verify before release:** drag reorder in Up next with a real pointer (the Browser pane's drag tool can't drive dnd-kit; Playwright can); "is on this" between two real people on rows (unit-tested, live only in F6's panel); two devices: Done/Skip on a session running on the other device takes it over; the visual baselines for `tests/visual/focus.spec.ts` (no Playwright browsers on this Mac: capture with `bun run storybook` and `--update-snapshots`); the desktop app (one webview, so the keys and the away prompt there).
- **TV-F8:** Arrange by project, the along-the-way offer, the meeting divider, the usual pace, Hand off W and the In flight view, the Pomodoro break offer between tasks, Settings → Tasks → Focus (Timer).
- **e2e:** run `tests/focus.spec.ts` and the trust pass serially (`--workers=1`): they share `dev@moduo.local`, and a Focus run one test leaves becomes the next one's Now card in parallel. trust-pass "AC1.10 + AC1.7" fails on the notice wording (TV-D12's batched "Someone assigned you 3 tasks"), not on Focus.
