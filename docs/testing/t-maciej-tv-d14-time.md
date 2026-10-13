# Manual test checklist — TV-D14 Time entries, the time report, Time & region

> Generated 2026-10-13 · branch `t/maciej/tv-d14-time` · **Live-verified:** yes, on the local stack as dev@moduo.local with a teammate who shares their time: "Add time…" in the Time field and the entries list, the project's report (by task, by day, rounded) and its print layout, the client hub's report, Settings → Time & region, the view's ⋯ (Copy as text, Print…). `tests/time-report.spec.ts` (Add time, CSV, print layout) passes against the worktree's dev server.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## "Add time…" and your entries (AC6.1)
- [ ] **Do:** open a task → click its Estimate/Time value → in **Add time** type `2h yesterday call with Anna` → **Expect:** the line under it reads "2h · Yesterday · call with Anna"; Enter (or Add) logs it, the field empties, the total grows by 2h and "Your entries" lists "Yesterday · 2h · Logged · call with Anna". _(web / desktop)_
- [ ] **Do:** type `45m`, then `1h 30m mon review`, then `30m 2026-10-01 audit` → **Expect:** today, last Monday and Oct 1 respectively. _(web)_
- [ ] **Do:** type `call with Anna` (no length) or `25h` → **Expect:** "Start with a length: 2h, 45m or 1h 30m, up to 24h." and Add stays off. _(web)_
- [ ] **Do:** the pencil on a logged entry → change it to `1h 15m yesterday` → Enter → **Expect:** the entry and the total change; clearing the note works by leaving it out. _(web)_
- [ ] **Do:** the pencil on a Focus entry → change its length and add a note → **Expect:** saved; its day stays. _(web)_
- [ ] **Do:** × on an entry → **Expect:** "Removed 1h 15m" with Undo; Undo logs it back on the same day. _(web)_
- [ ] **Do:** after a Focus takeover from another device (TV-F6) → **Expect:** a "Given back · Counted on two devices at once" line with no pencil or ×. _(two devices)_
- [ ] **Do:** as a viewer of the project → **Expect:** the Time value doesn't open (no logging). _(web)_

## The time report (AC6.2, AC6.3)
- [ ] **Do:** a project → panel title ▾ → **Project** → **Time report** → **Expect:** a sheet from the right: "Time report · <project> · Oct 1 – Oct 31", This month, By task, lines with notes, Total at the foot. _(web)_
- [ ] **Do:** By day, then turn on **Round to 15 min** → **Expect:** one section per day ("Mon, Oct 12"), each line up to the next quarter hour, the total their sum. _(web)_
- [ ] **Do:** Period → This week / Last week → **Expect:** the week starts where Settings → Time & region says. Pick dates → From/To fields. _(web)_
- [ ] **Do:** **Export CSV** → **Expect:** a `time-report-<project>-<from>-<to>.csv` with Project, Task, Hours (2.75), Duration (2h 45m), Notes, and a Total row; a title starting with `=` reads as text in a spreadsheet. _(web / desktop)_
- [ ] **Do:** **Export PDF** → **Expect:** the print dialog shows one clean light page: the project, the period, the total, the lines with notes, "Made with Moduo"; "Save as PDF" makes the file. In dark theme too. _(web; desktop: see below)_
- [ ] **Do:** as the workspace owner, with a teammate who hasn't shared → **Expect:** only your own time. The teammate turns on Settings → Time & region → **Share my tracked time with the workspace owner** → reopen the report → **Expect:** their lines appear with their name ("Design · Tess Mate"), and the people at the foot of the PDF. Off again → gone. _(two accounts)_
- [ ] **Do:** as a member (not the owner) → **Expect:** only your own lines, whatever anyone shares. _(two accounts)_
- [ ] **Do:** a task in a project you can't see but that was shared with you → **Expect:** in your whole-workspace numbers it reads "Private project"; a project or client report never includes it. _(two accounts)_
- [ ] **Do:** a contact who is a project's client → their hub → **Expect:** a "Time" section "Tracked time on <project>" with **Time report**, covering all their projects. A contact who is nobody's client has none. _(web)_

## Time & region (AC12.7)
- [ ] **Do:** Settings → **Time & region** → **Expect:** Time zone (your zone, with "Use <city> time" when this computer is elsewhere), Week starts on (Automatic shows the device's day), Clock, Date order, and the share switch under Tracked time. _(web / desktop)_
- [ ] **Do:** Clock → 24-hour → **Expect:** the sample reads 15:00; task times, the activity feed, the Calendar's hours, the Clock widget and email dates read 24-hour at once. _(web)_
- [ ] **Do:** Date order → Day first → **Expect:** "16 Oct" everywhere (panel, rows, Calendar, the report). _(web)_
- [ ] **Do:** Week starts on → Sunday → **Expect:** Filter → Due → This week ends Saturday; the Calendar's week and the date picker start on Sunday; `/next week` and the picker's "Next week" are next Sunday. _(web)_
- [ ] **Do:** the same on a second device → **Expect:** it reads the change at its next sign-in. _(two devices)_
- [ ] **Do:** set your zone to Tokyo in Settings, sign out and in → **Expect:** no prompt (you picked it here). Move the computer's zone (System Settings) to New York, reopen Moduo → **Expect:** once: "Your computer is on New York time now." with **Use New York time** / **Keep Tokyo**; either answer, and it doesn't ask again for New York. _(desktop or web)_

## Getting a list out (default f)
- [ ] **Do:** a view's ⋯ (next to Display) → **Copy as text** → paste into an email → **Expect:** "<view title>", then `- [ ] Title (MOD-12) · due Oct 16 · Anna`, subtasks indented under their parent, done ones `[x]`; the view's filter and order apply. _(web)_
- [ ] **Do:** ⋯ → **Export view as CSV** → **Expect:** ID, Title, Status, Project, Parent, Assignee, Due, Priority, Estimate, Tracked hours, Created, Completed. _(web)_
- [ ] **Do:** ⋯ → **Print…** → **Expect:** the print dialog with the view's tasks on one light page. _(web)_
- [ ] **Do:** the Project panel → **Copy as text** → **Expect:** name, state and dates, "3 of 5 done · 2 open", then the open tasks. _(web)_
- [ ] **Do:** a row's right-click → Copy as text (TV-U10) → **Expect:** unchanged. _(web)_
- [ ] **Do:** Settings → Advanced → Export data → **Expect:** `tasks` carries `timeEntries` (yours, with days and notes). _(web)_

## Migrations / data
- [ ] **Do:** `bun run db:test time_report` → **Expect:** 93 checks pass (logging, edits, give-backs, the read gate, the report's people and scopes, outsiders, zones, Time & region, erasure). `20261013200000` and `20261013201000` are on the local stack. _(local)_

## Polish later
From the validator round (MINOR/NIT, screen side; not blocking):
- The view's Print… layout stays mounted up to two minutes when the desktop's print dialog doesn't report closing; printing the report sheet in that window would print both.
- Removing an entry reads your entries twice (the total's change reads them again).
- Undo after removing a Focus entry logs it back as logged time (it loses its run and start).
- Two projects you can't see show as two sections both called "Private project" in a whole-workspace report.
- Chat's message rows are memoised: a Time & region change shows there at their next redraw.
- `tasks_time_totals`' "since" share dates a logged entry at UTC midnight of its day (nothing passes `since` yet; TV-H1 will).
- A very long report (thousands of entries) re-reads the server function per 1,000-row page (each page stops at its end); fine for a month, slow for a busy year.

## Known gaps / not-yet-testable
- Times on screen are this device's clock; the saved zone is the clock your day runs on (repeats, reminders, due times, report days). When they differ, the travel prompt offers to line them up.
- Your own time on a task you can no longer see isn't listed in your entries or the export (it comes back if the task does).
- MCP `tasks_time_report` and an API key's "add time" tool are TV-D16's. Home's time widget and the project overview's numbers are TV-H1's / TV-U16's.
- **Verify before release:** apply `20261013200000` then `20261013201000` after TV-D15's fix; check `account_erase_workspace_data`'s anchors (the focus_runs lines) on prod's body; `tasks_time_report` through prod's PostgREST, paging past 1,000 rows; the signed desktop app's Export PDF / Print… (the `print_page` command opens the macOS print dialog, and "Save as PDF" works); an old desktop build's sign-in no longer moving a picked zone; Intl week data (`getWeekInfo`) on the desktop webview (falls back to Monday); a real device zone change for the travel prompt.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
