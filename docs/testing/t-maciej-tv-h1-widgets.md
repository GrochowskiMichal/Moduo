# Manual test checklist — TV-H1 Home widgets for Tasks

> Generated 2026-10-14 · branch `t/maciej/tv-h1-widgets` · **Live-verified:** yes, on the local stack (web, 1440×900), signed in as a throwaway person (home-lead@moduo.local) in a workspace made for it, with a teammate (home-mate@moduo.local): all four widgets on one Home page, a check-off of a parent with two subtasks, its Undo (statuses back, the task back at the top of Focus). `tests/home-widgets.spec.ts` passes ("team load", AC4.5).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

No migration. To place a widget: Home → the pencil in the bottom bar → Add widget → **Tasks**, **Team**, **Upcoming** or **Time** (a full page adds a new page).

## Tasks widget (Focus, else Open)
- [ ] **Do:** add two tasks to your Focus (Q in Tasks) and open Home → **Expect:** the widget is headed **Focus** with the count, rows in Focus's order. _(web / desktop)_
- [ ] **Do:** start a Focus session on the second one (⇧F), back to Home → **Expect:** that task comes first, in medium weight, with a quiet **Now** on the right; stop the session → **Now** goes. _(web)_
- [ ] **Do:** take everything out of Focus → **Expect:** the heading reads **Open** and lists the open tasks (no Backlog, no unassigned task routed to a team you're not in). _(web)_
- [ ] **Do:** check off a task that has two open subtasks → **Expect:** it leaves the widget; toast "Done · also 2 subtasks · Undo"; in Tasks the parent and both subtasks are done. _(web)_
- [ ] **Do:** Undo → **Expect:** the parent and subtasks are back to the status each had; the parent is back in Focus where it was. _(web)_
- [ ] **Do:** check off a task with no subtasks → **Expect:** toast "Done · Undo"; Undo brings it back into Focus. _(web)_
- [ ] **Do:** as someone with view-only Tasks access → **Expect:** the checkboxes are dimmed and do nothing. _(web)_

## Team widget (one row per person; Chat's line comes later)
- [ ] **Do:** in a workspace with a teammate, add the Team widget → **Expect:** you first, then everyone who can take tasks, by name; each row: avatar, name, then one quiet line like "Focus 2 · ~1h 30m · 1 in progress · 1 waiting · 1 due this week" (zeros left out; "Nothing lined up" when there's nothing). _(web)_
- [ ] **Do:** compare with Tasks → **Expect:** Focus = their open lined-up tasks you can see and their estimates; in progress / waiting / due this week = tasks assigned to them; late tasks count as due this week; Backlog never counts. Nothing says how long anyone worked or whether they're running a session. _(web)_
- [ ] **Do:** the teammate lines up a task in their own Inbox (you can't see it) → **Expect:** their Focus count doesn't change. _(web)_
- [ ] **Do:** route a task to a team with nobody assigned → **Expect:** a row "Design · 1 unclaimed" with the team's mark after the people. _(web)_
- [ ] **Do:** the widget's ⋯ → pick a team → **Expect:** only that team's members, the team's name as the header (sentence case), its unclaimed count; Everyone brings everybody back. _(web)_

## Upcoming widget
- [ ] **Do:** give yourself tasks due yesterday, today, Thursday, and one next month → **Expect:** groups Earlier · Today · Thu · Later with counts (no empty days); rows say "Oct 13 · late", "due Thu", "due Nov 12"; a task with a session reads "3:00 PM · 45m". _(web)_
- [ ] **Do:** click a row → **Expect:** the task opens in Tasks. "+n more" opens Tasks. _(web)_

## Time widget (your tracked task time this week)
- [ ] **Do:** "Add time… 45m" on a task (Time field), open Home → **Expect:** "45m · this week · 45m today" and the task listed with 45m; at L size the project shows under it. Works on web (it used to be desktop-only). _(web / desktop)_
- [ ] **Do:** as the workspace owner, with a teammate sharing their time → **Expect:** the widget still shows only your own time (the report sheet is where shared time shows). _(web)_
- [ ] **Do:** finish a Focus session on a task → **Expect:** the widget's total moves once the session's time saves. _(web)_
- [ ] **Do:** Settings → Time & region → change the week start → **Expect:** the widget re-reads for the new week. _(web)_

## Verify before release
- An old desktop build opening a layout that has a **Team** or **Upcoming** widget: older builds drop unknown widget types when they read the layout, and could save it back without them.
- The time report through prod's PostgREST for a long week (paging past 1,000 entries).
- Home on the signed desktop app with all four widgets.

## Polish later
- Visual round for all four widgets (Maciej's call: widgets get their own round after all modules). Visual baselines for `widgets.stories.tsx` aren't captured.
- **Time widget:** a running session's unsaved seconds aren't added live (the total moves when the session saves); the week is the device's week on Time & region's start day while entries are dated in the saved zone (the report sheet does the same), so near midnight in another zone the edge day can differ; the report is read again on every tracked total that moves (a teammate's save on a shared task too): debounce it.
- **Tasks widget:** while a check-off is in flight the row's status shows Done with its old status id (it leaves the widget at once); no undo-toast grouping when several are checked off quickly.
- **Team widget:** Chat's "now" line is read once when the widget mounts (`teamNowLine()`), so if Chat registers later the widget needs a remount; a person row isn't clickable (a link to "their tasks" needs a Tasks filter link).
- **Upcoming widget:** "+n more" opens Tasks, not the Upcoming view itself (no `/tasks` link to a scope yet).
- Validator nits: `todaySeconds` is clamped per task to the week (fixed); view-only members with no load are left out on purpose (H1-2).
