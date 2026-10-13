# Manual test checklist — TV-F6 Focus salvage + one time engine

> Generated 2026-10-13 · branch `t/maciej/tv-f6-focus` · **Live-verified:** partial, on the local stack as `dev@moduo.local` (web, one browser): Focus's Track time started the session and its run (`focus_runs` row, Per task); ⋯ → Timer → Pomodoro changed the running session, the run (`mode`, 1500 s phase) and the synced default; going to Notes kept the top-bar clock; Stop from the top bar ended the run 10 s later with its time saved (72 s in two keyed entries = `focused_seconds`); Calendar showed two sessions of one task as two blocks and a due-only task in the all-day lane (click opened it); ▶ on a block started Focus (top of Up next, same clock in the popover, the block and the top bar); Stop → "Focus stopped · Undo" → Undo kept the same run; dragging the 5 PM session moved that session an hour (server row moved, length kept); Home's Pomodoro widget showed and paused the same session and Stop ended it; marking the Now task done on Home ended the session by itself (Up next ran out) with the task in the run's done list. Two devices, claims between two people and desktop weren't driven (see the gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## One clock everywhere
- [ ] **Do:** Tasks → Focus, Track time on the Now task → **Expect:** the clock runs on the card and in the top bar ("0:05", a dot). _(both)_
- [ ] **Do:** go to Notes, then Calendar, then Home → **Expect:** the top-bar clock keeps counting; nothing restarts. _(both)_
- [ ] **Do:** hover the top-bar timer → **Expect:** pause on the left, Stop (a square) at the far right; the clock opens Focus. _(both)_
- [ ] **Do:** top bar → Stop → **Expect:** the timer goes, "Focus stopped · Undo" for 10 s; Undo brings the clock back as if it never stopped. _(both)_
- [ ] **Do:** Stop and let the 10 s pass → **Expect:** the session is over; the task's Time shows what was tracked (Focus card "Xm", the panel's Time row). _(both)_

## Timer: Per task · Pomodoro · Off
- [ ] **Do:** Focus card ⋯ → Timer → Pomodoro while running → **Expect:** the clock becomes a 25:00 countdown; top bar shows it too; on a break it reads "Break 4:12". _(both)_
- [ ] **Do:** switch to Off → **Expect:** no clock anywhere (top bar reads "Focus"); Done/Skip still work; the task's Time stops growing. _(both)_
- [ ] **Do:** switch back to Per task → **Expect:** the clock counts from where the task's own clock was. _(both)_
- [ ] **Do:** reload, open Settings → Focus on another device → **Expect:** the chosen timer is your default there too (synced Focus prefs). _(both)_

## Calendar
- [ ] **Do:** give a task two work sessions today (the panel's Scheduled, or Calendar drag-create) → **Expect:** two blocks, one per session. _(both)_
- [ ] **Do:** a task of yours with only a due date today → **Expect:** a chip in the all-day lane; clicking it opens the task. Scheduled tasks, Won't do tasks and teammates' tasks (assigned to them, or theirs and unassigned) don't get one. _(both)_
- [ ] **Do:** drag one of the task's blocks → **Expect:** only that block moves (the other stays); reload keeps it. _(both)_
- [ ] **Do:** on an elapsed block of a task with two sessions, Later, then Remove on the other → **Expect:** each acts on the block you used (Later moves it to the next free slot today; Remove takes only that block off, Undo puts it back). _(both)_
- [ ] **Do:** click a block → Start focus → **Expect:** the task goes to the top of Up next and the clock starts; the popover, that block and the top bar show the same clock; only one of the task's blocks shows it. _(both)_
- [ ] **Do:** popover Stop → **Expect:** "Focus stopped · Undo", no "47m logged" toast. _(both)_

## Home
- [ ] **Do:** Home → edit → add the Pomodoro widget → **Expect:** idle: "Pomodoro", your Focus work length, "Next: <top of Up next>", ▶. With nothing in Up next, ▶ is off and it says so. _(both)_
- [ ] **Do:** ▶ → **Expect:** a Pomodoro on that task: the widget, the top bar and Focus show the same countdown; Pause and Stop work from the widget. _(both)_
- [ ] **Do:** the widget's ⋯ → durations → **Expect:** they're your Focus lengths (Settings → Focus shows the same). _(both)_

## The run rules
- [ ] **Do:** while a session runs on the Now task, finish it from a list or Home → **Expect:** the session moves to the next task in Up next (rhythm kept), or ends if none is left. _(both)_
- [ ] **Do:** have a teammate finish your Now task → **Expect:** a quiet toast "<name> completed “…”." and the session moves on. _(both, two people)_
- [ ] **Do:** remove the Now task from Up next → **Expect:** the next one becomes Now. _(both)_

## Two devices (AC8.11)
- [ ] **Do:** start Focus in the desktop app, open the web app → **Expect:** within a few seconds the web top bar shows the same session (tooltip "on your other device"). _(both devices)_
- [ ] **Do:** pause or stop it on the web → **Expect:** the web takes it over; the desktop's clock stops within a few seconds; the task's time isn't counted twice (check Time on the panel against the minutes worked). _(both devices)_
- [ ] **Do:** Stop on one device → **Expect:** after the 10 s Undo the other stops showing it. _(both devices)_
- [ ] **Do:** with the desktop's Wi-Fi off, take the session over on the web, wait 2 minutes, turn Wi-Fi back on → **Expect:** the desktop stops within seconds; the task's total is the minutes actually worked (the desktop gives back what it saved after the takeover as one negative adjustment). _(both devices)_

## Claims ("is on this")
- [ ] **Do:** Mike runs Focus on a task you can see → **Expect:** within a minute that task's panel header shows his avatar with a quiet dot; hovering it reads "Mike is on this". You never see yourself there. _(two people)_
- [ ] **Do:** Mike runs a task in a project private to him → **Expect:** you get no claim for it. _(two people)_

## Edge cases
- [ ] **Do:** Stop, then reload the page within 10 s → **Expect:** the session doesn't come back; the run ends. _(both)_
- [ ] **Do:** close the laptop with Focus running for 10+ minutes, open it → **Expect:** "While you were away" (Per task / Pomodoro); under Off nothing is asked. _(desktop)_
- [ ] **Do:** a viewer opens Focus → **Expect:** no Track time, nothing saved. _(both)_

## Migrations / data
- [x] **Do:** `20261013130000_focus_runs_v3` applied to the local stack → **Expect:** `bun run db:test focus_runs` 52/52; every SQL test file green after D12 merged. _(local)_
- [ ] **Do:** release: confirm prod already has `20261008235243` (`focus_runs`) and apply `20261013130000_focus_runs_v3` after D12's three → **Expect:** `select pg_get_constraintdef(oid) from pg_constraint where conname = 'focus_runs_mode_check'` lists per_task, pomodoro, off; no `stopwatch` rows left. _(prod)_

## Known gaps / not-yet-testable
- **Verify before release:** two real devices (web + signed desktop) taking a session over; claims between two real people through prod's PostgREST; Realtime on `focus_runs` through prod (local only had it after this migration added it); the desktop app's away prompt after sleep; a desktop build from before TV-F6 against the re-cut (`stopwatch` refused: such builds never shipped #323's run, so nothing should send it).
- The Focus screen itself (Now card pill, ⋯ menu with Stop, Up next) is TV-F7; today's card keeps its old layout with the three-way Timer in its ⋯.
- "Is on this" shows only in the task panel's header for now; rows and the Focus screen get it in TV-F7 (`useTaskClaim`).
