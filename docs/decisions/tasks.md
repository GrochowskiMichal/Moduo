# Decisions: Tasks and Timeline

Full entries for this area, newest first. The one-line index of every area is [docs/decisions.md](../decisions.md). Add new entries at the top here **and** a one-line pointer in the index.

## 2026-10-10 · TV-D5 finished (tasks-v3 block 1): a quiet refetch never runs the repeat catch-up

- **The client repeat catch-up runs after a full load only** → TV-D5 (`src/features/tasks/hooks/use-tasks-module.ts`, the `loadStamp` bump in `loadImpl`)
  - Who: agent's choice, deferred to by Maciej, 2026-10-10 (confirmed for building; may be reconsidered).
  - Decision: opening Tasks, a reload or a workspace switch reopens due repeats as before; coming back to the window or reconnecting refetches without it, unless that refetch is the first read of the workspace that worked (the app opened offline).
  - Why: #315 refetches on every return, and the pass would reopen a repeat checked off on Home or by MCP the same day (P0 #2); TV-D8's server roll-over replaces the client pass.
  - Rejected: landing TV-D8's server fix first (it depends on this block); keeping the pass on reconnect (a reconnect hits the same bug).

## 2026-10-10 · Tasks v3 re-plan (calls 13–98, defaults a–u, §6)

[specs/tasks-v3.md](../../specs/tasks-v3.md) supersedes tasks-v2 as the plan of record and says only *what* to build; the entries below are the *why*. Source: [.design/tasks-v3/REPLAN.md](../../.design/tasks-v3/REPLAN.md) §8 (numbers are stable, never reused); calls 1–12 are in [.design/tasks-dogfood/RESEARCH-2026-10.md](../../.design/tasks-dogfood/RESEARCH-2026-10.md).
Format (Maciej, 2026-10-10): who · decision · why · rejected, four lines at most. "Agent's choice, deferred to by Maciej" entries are confirmed for building and may be reconsidered.

### 2026-10-10 · Tasks v3 re-plan — structure (13–20a, 28, 87)

- **13 · The container is called "Project"** → TV-U6, TV-D10 (`buckets` keeps its name until TV-D7; MCP aliases kept)
  - Who: Maciej, 2026-10-09.
  - Decision: "Project" everywhere in the UI, MCP and docs; the schema renames only at the cleanup.
  - Why: every target role says project (or course); a client can be told "your project"; the spine already calls it one.
  - Rejected: "bucket" (nobody's word; Planner uses it for a column).
- **14 · The shape: Area → Project → Section** → TV-D10, TV-U6, TV-U10
  - Who: Maciej, 2026-10-10 (re-asked "what do areas and sections do?").
  - Decision: three levels with distinct jobs; only the project is required; a task never sits in an area, a section never spans projects.
  - Why: areas tidy the sidebar once projects multiply, sections tidy a project once tasks multiply; a new user sees just Inbox and projects.
  - Rejected: areas as containers with permissions (candidate B) and tasks on several lists (C).
- **15 · Areas = today's rail sections, made real** → TV-D10 (`areas` from `group_label`), TV-U6
  - Who: Maciej, 2026-10-09 ("ok, but explain why").
  - Decision: an area has name, colour, order; hidden until created; no permissions, no page, no tasks inside; the rail's "Section" becomes "Area".
  - Why: they already exist as a text label copied onto every bucket; grouping is the first thing every tool adds after projects; kept light so "area or project?" never comes up.
  - Rejected: keeping the label-per-bucket hack (renaming means relabelling every bucket; nothing else can use it).
- **16 · What a project carries** → TV-D10, TV-U16
  - Who: Maciej, 2026-10-09.
  - Decision: description, status Active · On hold · Done, target date, colour, area, client link, sections; computed progress, time, files, waiting, activity; Archive stays separate.
  - Why: On hold and Done only change the overview, a dimmed row and MCP, so they never hide tasks; archive is about visibility, not the work.
  - Rejected: a "health" / "at risk" field and status-update posts (alarm framing).
- **17 · An optional project Lead** → TV-D10
  - Who: Maciej, 2026-10-09.
  - Decision: yes, optional and hidden until set.
  - Why: PMs and agencies ask "whose project is this?"; cheap.
  - Rejected: no lead at all (at ≤5 people assignees answer it, but it costs nothing to offer).
- **18 · Sections inside a project** → TV-D10, TV-U10, TV-U11, TV-TL1
  - Who: Maciej, 2026-10-09 (reworded by 53a on 2026-10-10).
  - Decision: ordered, optional, datable parts of a project (phases, weeks, sprints, milestones, topics); never stages of work.
  - Why: a dated section is a Timeline phase marker with progress; imports land Todoist sections and Trello lists here; stages belong to statuses (53a).
  - Rejected: grouping the Board by tag (tags aren't exclusive, a card could sit in two columns).
- **19 · No separate milestone or sprint object** → TV-D10, TV-TL1
  - Who: Maciej, 2026-10-09.
  - Decision: a dated section *is* the milestone, phase or sprint; a saved view covers the rest; a due-only task is a point (re-worded by 68).
  - Why: one object fewer to learn; the Timeline draws sections as bands and diamonds.
  - Rejected: milestone and sprint tables of their own.
- **20 · The Inbox is personal; the sidebar shows the split with a hairline** → TV-U6, TV-U15
  - Who: Maciej, 2026-10-10 (re-asked "why private?").
  - Decision: per-person Inbox for captures; your block above a hairline, the workspace block below; "Only you see your Inbox…"; assigning an unfiled task moves it to that person's Inbox; filing makes it the project's.
  - Why: captures are half-thoughts and people capture freely only in private; in a shared pile nobody owns the sorting; privacy lives on projects.
  - Rejected: small "You" / "Workspace" labels (B; read as clutter, the welcome explains the split) and a shared team intake (deferred until outside intake exists).
- **20a · Handing an unfiled task to someone asks for a project** → TV-U14, TV-U15
  - Who: Maciej, 2026-10-10.
  - Decision: "Assign to Mike · in [Bugs ▾]" in one picker; "Keep unfiled" allowed, then "Created by me" keeps sight of it.
  - Why: an unfiled task that belongs to someone else belongs to nobody; the founder pair hits "where did it go?" daily.
  - Rejected: Todoist's "no assigning in the Inbox" and a silent move into a private Inbox (trust bug P0 #10).
- **28 · Subtasks stay one level** → TV-U18 (deeper levels flatten on import)
  - Who: Maciej, 2026-10-09.
  - Decision: one level, as today; imports flatten.
  - Why: keeps rows, Focus and the panel simple; the vocabulary already says a subtask is never a parent.
  - Rejected: nested trees.
- **87 · Finishing a task finishes its open subtasks, with one Undo** → TV-U10, TV-F7
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: the same everywhere (List, Board, Focus's Done, agents); the toast names them: "Done · also 2 subtasks · Undo".
  - Why: Todoist does this; Linear's opt-in leaves orphans that look unfinished.
  - Rejected: leaving subtasks open.

### 2026-10-10 · Tasks v3 re-plan — statuses, dates, repeats (21–27, 53, 53a, 53b, 68b, 77)

- **21 · Four statuses; "Archive" on a task becomes "Won't do"** → TV-P0 (label), TV-D9, TV-D7 (value); superseded in part by 53/53a
  - Who: Maciej, 2026-10-09.
  - Decision: To do · In progress · Done · Won't do plus the Waiting field; won't-do tasks get a list and Reopen; "Archive" is kept for projects.
  - Why: "archived" on a task read as hidden, not finished-without-doing; the label changes now, the stored value at TV-D7.
  - Rejected: a fifth "Waiting" status (decided in research call 5: the field route).
- **22 · Board columns from any grouping** → TV-U11
  - Who: Maciej, 2026-10-09.
  - Decision: status (default), section, assignee, priority, waiting-on; remembered per project.
  - Why: one Display grammar for List and Board.
  - Rejected: —
- **22a · Custom columns are sections** → TV-U11
  - Who: Maciej, 2026-10-10.
  - Decision: "+ Add section" on a section board; rename, reorder, ⋯ → Rename · Set date · Delete (tasks go to "No section"); the UI never says "column"; cross-project boards use shared fields only.
  - Why: a column field per board would be a hidden custom field (Notion's trap); a section belongs to one project.
  - Rejected: a separate column field per board; renaming statuses (then re-decided by 53a).
- **23 · A quiet "late" state for passed due dates** → TV-D9 (server flag), TV-U10
  - Who: Maciej, 2026-10-09.
  - Decision: muted, never red; grouped under Earlier; always offers Move · Won't do · Break down; "Rescheduled N×" goes.
  - Why: alarm colours and debt framing are what "complete but calm" rules out.
  - Rejected: red overdue, reschedule counters.
- **24 · Reminders** → TV-D12
  - Who: Maciej, 2026-10-09.
  - Decision: "Remind me at…" plus 1 day / 1 hour before due; one precise notification, exempt from the digest.
  - Why: a reminder is the one notification that must land on time (channels in 73).
  - Rejected: —
- **25 · Several work sessions per task** → TV-D10 (`task_sessions`), TV-U13
  - Who: Maciej, 2026-10-09.
  - Decision: a task can be scheduled into several calendar blocks; the estimate stops doubling as the block length.
  - Why: real work on one task spans several sittings; one `scheduled_at` forced a fake single block.
  - Rejected: one scheduled time per task.
- **26 · Due dates on the Calendar** → spec §18 (Calendar contract; Calendar-module work)
  - Who: Maciej, 2026-10-09.
  - Decision: due-only tasks as all-day chips; Calendar gets a Month view.
  - Why: students and PMs plan by the month; a due date is a day, not a time.
  - Rejected: —
- **27 · Recurrence: one task that comes back, with method a–i** → TV-D8 (server roll-over), TV-D12 (a–i), TV-U13 (picker)
  - Who: Maciej, 2026-10-09 (parity) and 2026-10-10 (a–i, all of them).
  - Decision: keep the cycling row; add RRULE rules, repeat-after-completion, due and scheduled moving together, completion history, subtasks resetting, ghosts on the Calendar, move-one/change-pattern, server roll-over, a picker with one summary line.
  - Why: the copy model piles up overdue copies and duplicates links; the parts people miss from it are history and rules, which the cycling row can carry.
  - Rejected: a new copy per occurrence (Linear, Asana, Jira), rotating or per-occurrence assignees.
- **53 · Backlog: a fifth status, named "Backlog"** → TV-D9, TV-U11, TV-U10
  - Who: Maciej, 2026-10-10 (the status); the word was his "50/50, your call" → agent's choice, deferred to by Maciej (confirmed for building; may be reconsidered).
  - Decision: Backlog · To do · In progress · Done · Won't do; a backlog task keeps its details, sits out of counts, My tasks, Upcoming, Focus suggestions, drift, late and reminders, folded at the end; queuing or scheduling moves it to To do.
  - Why: ideas crowd every active view; Linear, Jira and Plane use the word, so imports map one to one; 53a lets a project rename it "Someday".
  - Rejected: a "someday" flag (odd mixes like someday + in progress) and a section named Backlog (no behaviour, still clutters counts).
- **53a · Statuses per project, inside five fixed categories** → TV-D9 (`project_statuses`, `status_id`), TV-U11, TV-U13
  - Who: Maciej, 2026-10-10 (round 2b), with his icon rule.
  - Decision: each project renames, adds, hides and reorders statuses inside Backlog · To do · In progress · Done · Won't do; new projects start from the workspace default; icons belong to the category only (dotted · empty · half · check · crossed) and nobody edits them.
  - Why: "done" has to mean one thing for Focus, counts, cross-project boards and agents, while other products let projects name their stages; stages leave sections and become statuses.
  - Rejected: free-form statuses (every view would need telling what "Shipped" means) and one global custom list (projects differ).
- **53b · A folded Board column is a small button, never rotated text** → TV-U11
  - Who: Maciej, 2026-10-10 (round 2b), his version.
  - Decision: icon · count · chevron stacked, ~32 px wide, in the column's place; hover shows "Backlog · 6"; drops work once unfolded; Backlog starts folded; the List keeps its "Backlog · 6" line.
  - Why: Backlog shouldn't be a big always-visible panel; sideways text reads ~80 % slower (46a).
  - Rejected: a full-height folded column with a horizontal header (the agent's first fix) and rotated labels.
- **68b · Dates that contradict a dependency are shown, never prevented** → TV-TL2
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: a backwards arrow in the late tone, a "Waits on X, due after this" mark, one-click "Move to Nov 8"; loops stay refused by the database; stubs for undated, cross-project, hidden and same-day blockers.
  - Why: dates and dependencies are both facts people set, in either order; "mirrors, not walls".
  - Rejected: refusing the date.
- **77 · A record of what got done, and when** → TV-D9 (`completed_at` / `completed_by`, per-cycle history)
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: every completion stores when and who, per cycle; Filter/Group by Completed; "Done this month · 14 · 22h" on the project overview; a seeded "Done last week" view for PMs and founders.
  - Why: repeat history, the client hub, the weekly review and the time report all need it, and "last 7 days" was guessing from `updated_at`; the trail tells one task's story but can't answer "what got done last week".
  - Rejected: keeping the `updated_at` guess.

### 2026-10-10 · Tasks v3 re-plan — navigation and views (29–30, 32, 82b–86, 88, 98)

- **29 · The rail's smart views** → TV-U6
  - Who: Maciej, 2026-10-09 (order renamed by 61).
  - Decision: Inbox · Focus · Upcoming · My tasks · All, then Views, then areas and projects; Upcoming = your dated tasks plus unassigned ones in projects you can see.
  - Why: Focus is what I'll do next in my order, Upcoming is what's dated; the two had never been told apart.
  - Rejected: "Open at" (the time-of-day bucket, 30) and a workspace-wide "today".
- **29a · Customize sidebar** → TV-U6
  - Who: Maciej, 2026-10-10.
  - Decision: a ⋯ shows or hides Focus, Upcoming, My tasks and All; the Inbox is always shown; built-ins can't be reordered.
  - Why: every teammate's sidebar reads the same.
  - Rejected: reorderable built-ins.
- **29b · Pin to sidebar** → TV-U6
  - Who: Maciej, 2026-10-10.
  - Decision: "Pin to sidebar" in any project's or view's ⋯ adds it to a Pinned group that exists only once something is pinned; never suggested or pre-filled.
  - Why: a short path to the few things you live in, without a standing empty group.
  - Rejected: a pre-filled or suggested Pinned group.
- **29c · No glyphs on views** → TV-U6
  - Who: Maciej, 2026-10-10 (he asked to be proven wrong; the agent changed its recommendation to B).
  - Decision: B — no glyph; view names align with project names; in Pinned, projects keep their colour dot and views show nothing.
  - Why: most views are lists, so a column of identical glyphs is decoration; the "Views" header already says what they are.
  - Rejected: A, an automatic layout glyph per view.
- **29d · Saved views live in one place** → TV-U8
  - Who: Maciej, 2026-10-10.
  - Decision: no project tabs; a view saved inside a project keeps that project as a filter and lives in the sidebar's Views group.
  - Why: one place to look; tabs could be added later without migrating anything if long Views lists show up.
  - Rejected: views saved inside a project as tabs next to List · Board · Timeline.
- **29e · Collapsible groups, one header style** → TV-U6
  - Who: Maciej, 2026-10-10.
  - Decision: Pinned, Views and each area collapse (remembered per person, open by default); sentence case, secondary text, a chevron; area headers show the open count; no small-caps labels; a fresh workspace has no headers.
  - Why: one header style for every grouping (consistency item 7); headers only when there's something in them.
  - Rejected: small-caps group labels.
- **30 · Landing** → TV-U6
  - Who: Maciej, 2026-10-09.
  - Decision: retire "Open at"; Tasks opens where you left it; the first open follows onboarding.
  - Why: a time-of-day bucket was a solo-planner assumption nobody used.
  - Rejected: —
- **32 · A full-page task view** → TV-U13
  - Who: Maciej, 2026-10-09.
  - Decision: expand a task from the panel into the whole centre, same route; the panel then shows Project; the description never folds.
  - Why: long descriptions and subtask-heavy work need room (56).
  - Rejected: a new route (AGENTS.md rule 7).
- **82b · Multi-select: a short action row with keys, plus More** → TV-U12
  - Who: Maciej, 2026-10-10 (round 2d/2e), his version.
  - Decision: when a bottom-bar mode is active (triage, multi-select), the centre shows at most six actions with their keys, then More ▾: Complete `Space` · Focus `Q` · Assign `@` · Tag `#` · Date `D` · Delete `⌫`; "4 selected · Esc"; the panel's "4 tasks · Mixed" stays.
  - Why: triage already works this way and he wanted it kept; `@` and `#` match the app grammar; Space (not Enter) completes because Enter opens; Q (not F) because F is Filter.
  - Rejected: 82, a full row of twelve verbs ("that much horizontally stacked text"), and 82a, "New" turning into one "Actions · 4" menu.
- **83 · One date grouping everywhere, by day** → TV-U2, TV-U15
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: Earlier · Today · Tomorrow · the next five day names · Later (+ No date outside Upcoming); day headers carry count and time; one row per task at its next session or due date; no week strip.
  - Why: "This week" is one day long on a Saturday; the Board layout and the Calendar already give day columns and the grid.
  - Rejected: a "This week" group (stays as a filter) and a week strip on top.
- **84 · My tasks groups by status, In progress first** → TV-U2, TV-U15
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: the team block on top, then In progress · To do · Backlog folded; date grouping one Display choice away.
  - Why: Upcoming already answers "when"; My tasks answers "what am I in the middle of".
  - Rejected: date groups (the round-1c prototype).
- **85 · Swimlanes: one level, off by default** → TV-U11
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: Display → Lanes: none · assignee · priority · project (across projects) · team; each folds, empty lanes hide; built after the Board basics.
  - Why: Linear, Jira, GitHub, Notion, ClickUp and now Asana all have them; a second axis has to stay calm and fast.
  - Rejected: nested lanes, lanes on by default.
- **86 · Boards always open grouped by status** → TV-U11
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: status is always the default; Section is one Display choice away and remembered per project.
  - Why: since 53a sections are phases and weeks, so "Week 1–12" would open as twelve columns.
  - Rejected: 22a's "a project with sections opens grouped by section".
- **88 · Reactions on comments: six, fixed, never notifying** → TV-U13
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: 👍 ✅ 👀 🙏 ❤️ 😄; hover shows who; nobody adds their own.
  - Why: they replace "ok" / "thanks" comments and the notifications those send.
  - Rejected: a free emoji picker (the same rule as icons) and no reactions (the gap audit's "not planned").
- **98 · Archived projects and Recently deleted have no permanent rows** → TV-U6
  - Who: agent's choice, deferred to by Maciej, 2026-10-10 (confirmed for building; may be reconsidered).
  - Decision: both open from the sidebar's ⋯ next to Customize sidebar; archived projects show in search labelled "Archived"; a delete's Undo toast links to Recently deleted.
  - Why: two standing rows at the bottom are the label clutter he dislikes (29e).
  - Rejected: #328's two permanent sidebar rows.

### 2026-10-10 · Tasks v3 re-plan — shell and the right panel (48b, 72, 72a, 89, 96, 81)

- **48b · The layout is the product's skeleton** → SH-1, spec §19 (a founding rule, in Maciej's words)
  - Who: Maciej, 2026-10-10.
  - Decision: top bar global · middle the module · bottom bar the module's tools and each panel's toggle; left overview · centre surface · right context; no edge strips, rails or extra columns.
  - Why: "it's the love for this layout that made me work on Moduo"; switching inside a panel happens in its own title row.
  - Rejected: anything that adds a fourth column or a side strip.
- **72 · One way to switch the right panel, for every module** → SH-1
  - Who: Maciej, 2026-10-10 (round 2b).
  - Decision: B — the panel's title row is a dropdown that names the view and switches it; everything below follows.
  - Why: four segments already crowd a 300 px panel, and the words drift between modules; B adds no width and holds unlimited views.
  - Rejected: A, a slim icon strip on the window's right edge (the agent's recommendation; it breaks the 3×3 layout, 48b) and C, icon tabs in the header (fits about five).
- **72a · How the dropdown works** → SH-1 (panel view registry; replaces `RightPanelSwitcher`)
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: "Details ▾" lists this module's hand-picked views (about six at most) in two groups, *about this* and *alongside*; references open as items with the title becoming the item's name and a back arrow; collapse/expand stay in the bottom bar; Tasks: Details · Project / In flight, plus No date on the Timeline.
  - Why: items open as a stack, so nothing makes the menu grow (his "20-item list" worry).
  - Rejected: references as extra views in the menu.
- **89 · The right panel is never narrower than 280 px** → SH-1 (a shell change for every module)
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: minimum 280 px; values wrap; the label column narrows from 96 to 76 px under 320 px.
  - Why: at 240 px a value gets ~110 px, which is where "Wed, …" and "0m of …" come from; at 1,024 px the centre keeps ~450 px.
  - Rejected: keeping the 240 px minimum and truncating.
- **96 · Help and the running Focus timer move to the top bar** → SH-0 (its own session)
  - Who: Maciej, 2026-10-10 (round 2e).
  - Decision: top right: Focus timer (quiet "18:02" with a dot, only while running; hover pauses, click opens Focus) · Help (Docs, Keyboard shortcuts, Contact support, Report a bug) · bell · avatar; the bottom bar's centre becomes Search · Quick capture · New.
  - Why: the top bar is global and a session runs whichever module you're in (48b); he wanted Help "even more quiet", next to the bell.
  - Rejected: the timer chip in the bottom bar and a keyboard button there.
- **81 · Motion: foundations now, no blur, signature moments last** → SH-1, DS-6 (tokens)
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: three durations (~100 / 180 / 280 ms), one easing family (ease-out in, quicker ease-in out), four patterns, reduced motion → opacity only; no `backdrop-filter`; signature moments after the modules are done.
  - Why: motion lives inside components, so adding it after the rebuilds would mean touching each module again; blur is expensive in the desktop webview and "performance comes first".
  - Rejected: blur-based transitions now (may return later on hovers and small interactions only, if it costs nothing).

### 2026-10-10 · Tasks v3 re-plan — Focus (10, 31, 57, 59, 59a, 60, 61–66)

- **10 · Calibrated estimates** → TV-F8
  - Who: Maciej, 2026-10-09.
  - Decision: after ~10 finished tasks with both an estimate and tracked time, "≈ 7h 30m at your usual pace" in Up next's header and the run summary; personal, never changes estimates, can be turned off.
  - Why: the planning fallacy is among the most replicated findings; TV-D3's entries make actuals available; a mirror, not a wall.
  - Rejected: auto-adjusting estimates.
- **31 · "Focus on this" from any task** → TV-F7
  - Who: Maciej, 2026-10-09.
  - Decision: ⇧F, the ⋯ menu or the detail header's ▶ puts the task on top and starts a run.
  - Why: a run shouldn't require building a line-up first; `f` is already Filter, so ⇧F.
  - Rejected: —
- **57 · "Along the way" in runs** → TV-F8
  - Who: Maciej, 2026-10-10.
  - Decision: at a project change in a run, one offer of a ≤15-minute task from the project you're leaving ("Take it · Not now"), only in the moment between two tasks; three Not-nows → Shrink · Move · Let go; "Arrange by project" in Up next's header.
  - Why: doing a small task while you're already in a project saves a switch for anyone (48a); task-switch costs are well established.
  - Rejected: a standing suggestion line on the screen.
- **59 → 59a · One switch, "Offer quick tasks along the way"** → TV-F8, Settings → Tasks → Focus
  - Who: Maciej, 2026-10-10 (59 with "I don't fully understand the consequences"; 59a in round 2b).
  - Decision: one switch, on by default, also in Focus's ⋯; reminders always fire; nothing is suggested outside Focus; nothing changes by itself over time.
  - Why: with 58 parked and 60 dropped, "Everywhere" had nothing left in it; a task boundary in a run is the cheapest moment to interrupt.
  - Rejected: Off · During runs · Everywhere (59) and modes that fade as habits form; "Everywhere" may return as a second option after the module rebuilds.
- **60 · No more ADHD-specific exploration this round** → (none)
  - Who: Maciej, 2026-10-10.
  - Decision: not now; the first-step card, the quick sweep and meeting prep stay in REPLAN §10 for later.
  - Why: 48a, 57 and 59a close enough of the gap.
  - Rejected: exploring the three in round 2.
- **61 · The Queue becomes "Focus"** → TV-F7 (words only; the database and MCP keep "queue")
  - Who: Maciej, 2026-10-10 (round 2b).
  - Decision: the sidebar item is Focus; the line-up inside is Up next; verbs Start · Pause · Done · Stop; "Add to Focus" keeps the `Q` key.
  - Why: "Queue" and "Upcoming" both read as "what's coming" while the feature is about doing; six of thirteen tools call the doing surface Focus, none calls the list Queue.
  - Rejected: keeping "Queue".
- **62 · One quiet header; the timer sits on the task it times** → TV-F7
  - Who: Maciej, 2026-10-10 (round 2b: "I like this layout much much more").
  - Decision: header "Focus ⋯" only; one timer pill on the Now card with Pause inside it; Stop in ⋯ and the top-bar timer with "Stopped · Undo" for 10 s; leaving the view never stops a session; the Now card's top line is project › section · due.
  - Why: "Running" and the timer repeated each other; a Pause next to End run is risky; every tool checked puts pause on the timer and none a bare End beside it.
  - Rejected: the two-line header with progress and a bare End-run button.
- **62a · Timer: Per task · Pomodoro · Off** → TV-F6 (`focus_runs.mode` re-cut), TV-F7
  - Who: Maciej, 2026-10-10 (round 2c; Pomodoro was his idea, kept).
  - Decision: Per task (default) is the pill on the card, with an optional countdown of the estimate; Pomodoro puts the rhythm pill in the header beside ⋯ with lengths in the same menu and breaks offered between tasks; time is still recorded per task.
  - Why: nothing was cut from the old screen, only moved (the before/after table in REPLAN 62a); the card carries no second clock.
  - Rejected: a run-level timer separate from the task's.
- **63 · Time tracking is optional, and Off means off** → TV-F7, Settings → Tasks → Focus
  - Who: Maciej, 2026-10-10 (round 2b/2c), with the ⋯ menu as listed.
  - Decision: Off shows no pill and records nothing while Start, Done, Skip and Hand off still work; the ⋯ menu is Timer ▸ · Arrange by project · Offer quick tasks ✓ · Show what's done · ─ · Stop.
  - Why: a task's total time is visible to everyone who can see the task, so quietly recording for someone who turned the clock off would feel like being watched.
  - Rejected: recording quietly anyway (Amazing Marvin, a one-person app).
- **64 · The next meeting is a divider inside Up next** → TV-F8
  - Who: Maciej, 2026-10-10 (round 2b: "it's great").
  - Decision: "── 2:30 PM · Acme call ──" where the meeting falls by your estimates; only for events you attend within ~2 hours or before the line-up runs out.
  - Why: no tool checked puts the next event above the task; "2 quick tasks fit" was the "Everywhere" idea 59a removed.
  - Rejected: the "18 min until Acme call · 2 quick tasks fit" line above the task.
- **65 → 65a · Subtasks in Focus: the focused task stays, a subtask opens its own details in the panel (C)** → TV-F7
  - Who: Maciej, 2026-10-10 (round 2b rejected A and B; round 2c took C).
  - Decision: the Now card keeps the task with its subtasks as an unordered checklist with small marks; click a subtask → its own details in the right panel with a parent breadcrumb; ⇧F makes a subtask the focus; ⏎ is Done for the focused task.
  - Why: "subtasks are not necessarily ordered as steps… we'd force users to build less complex subtasks"; the same click-opens-details rule as List, Board and Timeline.
  - Rejected: A, steps you work through one at a time (the agent's recommendation) and B, the current step unfolded inline.
- **66 · Focus stays visible for everyone, with three ways in** → TV-F7
  - Who: Maciej, 2026-10-10 (round 2b), with his change.
  - Decision: visible by default for every role (hideable in Customize sidebar); a line-up, one big task via ⇧F, or today's scheduled tasks shown as real rows with "+" each and "Line up all 3"; the empty state teaches all three.
  - Why: "useful enough that we shouldn't hide it from users that just started"; people who plan by calendar need a way in too.
  - Rejected: hiding Focus per role and a one-line "Line up today's 3" summary.

### 2026-10-10 · Tasks v3 re-plan — Timeline (67–71, 68a; 68b above)

- **67 · Rows follow the scope: projects across the workspace, tasks inside a project** → TV-TL1
  - Who: Maciej, 2026-10-10 (round 2b).
  - Decision: All/area → area headers then one row per project (bar, dated sections, progress line; expand ▸ to tasks), opening at Quarter; inside a project → the project row, sections and tasks, opening at Month; subtasks hidden by default; an optional "Due per week" count, on for students.
  - Why: this is the PM's roadmap (Linear, Jira, GitHub, Basecamp draw projects as bars) and the student's term at a glance.
  - Rejected: today's flat lanes of task bars with no project level.
- **68 · Tasks are points; projects and sections are spans** → TV-TL1
  - Who: Maciej, 2026-10-10 (round 2b: "I really like it").
  - Decision: a task is a 12 px circle on its due day (hollow on its next session, muted when late, hidden when done); a section with one date is a diamond, a range a band; a project is a bar (solid when set, outlined when worked out); the fade goes.
  - Why: Moduo tasks have no start date, and inventing one is ClickUp's complaint; most "bars" today are fades pretending to be spans.
  - Rejected: task bars with a start date and Jira's "date unknown" fade.
- **68a · Section dates on their own row; a project may have no dates** → TV-TL1
  - Who: Maciej, 2026-10-10 (round 2c: "looks much much better").
  - Decision: every section has a header row and its date shows there (range = band, end only = diamond); dates are set by the chip, ⋯ → Set dates or dragging; one word per kind: tasks are due, sections end, projects have a target; an undated project's bar is outlined from its contents.
  - Why: the prototype drew a task-less section at the bottom where it looked like a stray task; the cost of "no task bars" (Gantt-trained PMs) is accepted, duration lives on phases and sessions.
  - Rejected: a third date field on tasks.
- **69 · Anatomy: a name column, slim bars, quiet structure** → TV-TL1
  - Who: Maciej, 2026-10-10 (round 2b).
  - Decision: a sticky resizable name column (280 px; ⇧[ hides it); rows 36/32/28 px, bars 24/22/20 px with a 3 px colour cap and a 2 px progress line; a two-tier sticky header with a Today pill; hairline grid, weekend tint; Week · Month · Quarter · Year with ⌘-scroll; endless virtualized scroll opening with today a quarter across.
  - Why: titles in a column are never cut by a bar (Asana's fix); monday's taller bars halved the rows that fit.
  - Rejected: labels beside bars, small-caps lane headers, a fixed window.
- **70 · Undated tasks, and working on the canvas** → TV-TL2
  - Who: Maciej, 2026-10-10 (round 2b).
  - Decision: the bottom tray goes ("No date · 12" opens the panel's No date view); click an empty spot to set a due date or draw a project bar; the whole canvas takes drops; drag points, diamonds and bars; multi-move; edge scroll; keyboard ↑↓ ⌥←/→ ⇧ D T; dependency lines only for the selected item plus "Show all"; "Also move the 3 that wait on this" is offered, never automatic.
  - Why: today's 8 px drop strip and fixed window made dragging unreliable; nothing drags between groups so dragging never reassigns.
  - Rejected: the chip tray and silent cascading moves.
- **71 · Display options, and what's left out on purpose** → TV-TL1
  - Who: Maciej, 2026-10-10 (round 2b), after asking what each omission costs.
  - Decision: Display = Group by · Show done · Colour by · Dependencies · Show sessions · Show repeats · Subtasks · Due per week; out: baselines, critical path, auto-scheduling, workload lanes, scenarios, hidden weekends, red health, packed lanes, task start dates, an Inbox lane, drag-to-reassign.
  - Why: those are what make Jira, monday and ClickUp timelines heavy, or they're traps (auto-scheduling moves dates without you; workload reads as surveillance); none is ruled out for good.
  - Rejected: a Gantt feature set.

### 2026-10-10 · Tasks v3 re-plan — capture, references, teams (33, 33a, 54–56, 90–95)

- **33 · Capture follows the app grammar exactly** → TV-U14, RF-1
  - Who: Maciej, 2026-10-10.
  - Decision: `@` mentions (a person assigns, a project files, a thing links), `#` tags, `/` commands; plain words for dates, highlighted and undoable; `#CS 201` matching a project offers "@CS 201"; literal symbols stay text.
  - Why: the first draft used `#` for projects and added `!`, breaking "@ anything · # tag · / command".
  - Rejected: Todoist's `#project` and a fourth symbol.
- **33a · Date commands everywhere; a recognised date leaves the title** → TV-U14, RF-1
  - Who: Maciej, 2026-10-10 (with his follow-up: the date doesn't stay as text).
  - Decision: `/today`, `/tomorrow`, `/next week`, `/date`, `/due …`, `/schedule …`; in capture they set the date and leave the title on save; in prose they insert a date chip; in an existing title only `/` commands act.
  - Why: under our grammar `@tom` would mix Tom with Tomorrow, so dates belong under `/`; renaming a task must never change its date by surprise.
  - Rejected: `@` for dates (Notion, Google Docs) and keeping the date words in the title.
- **54 · Teams of people: routing now, permissions later** → TV-D10 (`teams`, `tasks.team_id`), TV-D13
  - Who: Maciej, 2026-10-10.
  - Decision: named groups from Settings → Members; a task gets an optional team next to its one assignee; members see "For Design · 2 unclaimed" and claim with a click; `@Design` routes in capture and sends one digest from a comment; sharing a project with a team is a later permissions spec.
  - Why: "give it to Design" when you don't know who; access changes the permission model (Tier 2) and gets its own spec.
  - Rejected: "Groups" (clashes with Group by) and `@Design` pinging each member like @channel.
- **55 · References: one spine primitive for links, chips, cards and previews** → RF-1 (absorbs GR-0)
  - Who: Maciej, 2026-10-10.
  - Decision: four presentations, live updates, "Show as: Link · Chip · Card" after inserting, per-type previews defined by each module, and "Private item" with no title or preview for anything you can't see; Tasks builds the primitive, Notes and Chat adopt it when rebuilt.
  - Why: grammar and presentation in one spec can't contradict each other; seven chip languages exist today.
  - Rejected: per-module ad-hoc chips.
- **56 · Long descriptions fold at ~8 lines with counts** → TV-U13
  - Who: Maciej, 2026-10-10.
  - Decision: "Show more · 2 tasks · 1 email"; editing shows all; a card is never cut; every mentioned item is also in Linked; rows and cards never show the description (hover preview shows three lines; a Board "Description preview" option, off); the full page never folds.
  - Why: nothing gets lost and the panel stays scannable.
  - Rejected: descriptions on rows and cards.
- **90 · Two ways to capture, two destinations** → TV-U14
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: ⌘⇧K always files to your Inbox and never asks where; ⌘N, "+ New" and `c` file where you are (project, section, the top of Up next).
  - Why: the Things split (Quick Entry vs New To-Do); muscle memory for the global key.
  - Rejected: one capture that asks where every time.
- **90a → 90b · One global capture for every module; ⌘+number switches its type** → TV-U14, SH-1 (capture type registry)
  - Who: Maciej, 2026-10-10 (round 2e; 90b is his idea).
  - Decision: ⌘⇧K opens as Task; while open, ⌘1–7 switch the capture's type to that module (⌘1 does nothing); a type chip shows it; typing `/note` keeps its prose meaning; each module registers its type and destination.
  - Why: "aren't we locking the global workflow into tasks alone?"; the same keys mean "module" everywhere, so nothing new to learn.
  - Rejected: 90a's switching by typing `/note` as the first word.
- **91 · Capture shows four pills, with the destination on top** → TV-U14
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: Assign (people and teams) · Due · Tags · Priority · ⋯ More (scheduled, reminder, estimate, repeat, waiting on, template); a destination row "Inbox ▾" / "Acme rebrand › Design ▾"; ⏎ creates, ⌘⏎ creates more.
  - Why: eight pills were noise; the destination is where 20a's empty project slot shows.
  - Rejected: —
- **92 · What leaves the title, and what stays** → TV-U14
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: tokens that set a property (person, team, project, tag, date, `/` command) leave the title on save; tokens that link a thing (contact, note, email, event, task) stay as chips.
  - Why: "Call @Anna about @Acme rebrand" keeps reading as a sentence.
  - Rejected: —
- **93 · The thing you're looking at rides along, linked by default** → TV-U14
  - Who: agent's choice, deferred to by Maciej, 2026-10-10 (round 2e: "connections are super important"; confirmed for building; may be reconsidered).
  - Decision: capturing while an email, note, event or contact is open links it in every case, ⌘⇧K included, as a visible "From: …" chip that one key removes.
  - Why: a suggestion keeps far fewer links because people skip optional steps; a missed link is silent, a wrong one is visible and removable; privacy holds through "Private item".
  - Rejected: suggest-only for ⌘⇧K (the agent's revised version; calmer for unrelated thoughts). Revisit if dogfooding shows many removed links.
- **94 · A task routed to a team needs a project** → TV-U14, TV-D13
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: a team can name a default project; without one, capture asks for a project before ⏎.
  - Why: unfiled tasks are private (20) and a routed task has to be visible to the team (54).
  - Rejected: a shared "Requests" intake (deferred with 20).
- **95 · Team marks: a rounded square with two letters** → TV-D13
  - Who: Maciej, 2026-10-10 (round 2d).
  - Decision: people are round, teams are rounded squares; two automatic letters (DS, DV) and a stable colour; letters editable, nothing picked from a list.
  - Why: solves the "D" clash from round 1c without an icon picker.
  - Rejected: picked icons.

### 2026-10-10 · Tasks v3 re-plan — agents, switching, onboarding (9, 34–36, 51, 52, 58, 79)

- **9 · Templates, the minimal version** → TV-D15
  - Who: Maciej, 2026-10-10 (re-asked "prove that this solves problems").
  - Decision: "Save as template" on a real task keeps the work (subtasks with details, tags, priority, estimate, dependencies, lasting links, dates as offsets) and drops the run (comments, time, done states, repeats, one-off links, files); the template task is the editor; "From template…" asks for one date; a small list in Settings → Tasks.
  - Why: consultants, agencies and creators list it as a must, every tool we replace has it, and checklists cut forgotten steps; no editor or gallery keeps it from becoming "system-building as procrastination".
  - Rejected: deferring until the Duplicate data shows repeated procedures; variables, automations, a gallery.
- **34 · Onboarding: one role question, then a per-module welcome** → TV-U17
  - Who: Maciej, 2026-10-09 (role question) and 2026-10-10 (welcome, with two changes).
  - Decision: the role question sets defaults only; each module shows a first-open welcome once per person: basics, "Learn more" (up to three clip steps recorded by script) / "Explore on my own", reopenable from ⋯; Tasks' steps: above the line is yours · line things up in Focus · `@` `#` `/`.
  - Why: completion is highest around three steps; "a feature worth showing doesn't have to be unusual" (so not "Show me what's different"); step 3 should cover all three symbols.
  - Rejected: modal tours, forced steps, ten-item checklists, roles turning features on or off.
- **35 · Import: through your AI first, then native importers** → TV-D16, TV-U18
  - Who: Maciej, 2026-10-09.
  - Decision: "bring Todoist / Linear / Trello through your AI" right after MCP writes; then Todoist CSV → Trello JSON → Linear/Jira/Asana CSV; old IDs stay findable.
  - Why: no importer to build per service, and every service with an AI connector works on day one (74).
  - Rejected: native importers first.
- **36 · Mobile stays out of scope** → (none)
  - Who: Maciej, 2026-10-09.
  - Decision: capture on the phone goes through your AI app (MCP); not mentioned on the pricing page.
  - Why: desktop-first; phones get their own plan once the desktop app is done (73).
  - Rejected: —
- **51 · How an agent's changes are recorded** → TV-D16, TV-F8
  - Who: Maciej, 2026-10-10.
  - Decision: no comment per change; every write is an attributed trail row ("Claude, via Alex's key, set due → Fri"); one hand-back summary, kept with the private session until "Post as comment"; comments only when a person asks.
  - Why: the trail is complete, uneditable and doesn't bury people's comments (Linear's and GitHub's precedent).
  - Rejected: a comment per change.
- **52 · Moduo shows agent status, not conversation** → TV-D16 (`agent_sessions`), TV-F8
  - Who: Maciej, 2026-10-10 (re-asked: "agent work shouldn't be forced public").
  - Decision: five fields (state, note, step n of m, links, times) in one line under the title and a quiet "Claude · working" on rows; no reply box; private by default with "Show my agent work to teammates"; the trail always says "Alex · via Claude Desktop" (the key's name).
  - Why: agent tools change monthly, so drawing their questions and diffs means chasing other products forever; one line plus one mark needs no change when the agents change.
  - Rejected: a question/approval UI in Moduo, transcripts, and the plain "Alex" trail from the prototype.
- **58 · Cues: "Remind me when…"** → parked
  - Who: Maciej, 2026-10-10.
  - Decision: parked; time-based reminders (24) go ahead.
  - Why: its triggers live in projects, contacts, threads and meetings, which may be rebuilt soon.
  - Rejected: building cues now.
- **79 · "Duplicate project…" and project templates** → TV-D15
  - Who: Maciej, 2026-10-10 (round 2b), with his addition of project templates.
  - Decision: Duplicate copies sections, statuses and open tasks with dates shifted from a new start; "Save as template" on a project keeps description, sections, statuses and open tasks with offsets; the template is its own editor; yours until shared with the workspace.
  - Why: repeat projects (next term, season 2, every client onboarding) are a must for PMs and agencies; "if someone always goes through the same phases".
  - Rejected: Duplicate only, with project templates waiting for evidence.

### 2026-10-10 · Tasks v3 re-plan — the visual rules every module inherits (38–46a)

- **38 · Three readable text levels plus one decorative** → DS-6
  - Who: Maciej, 2026-10-10 (re-asked "won't fewer greys impair structure?").
  - Decision: primary, secondary (8.5:1), tertiary (≥4.5:1, a new step) as app-wide tokens, plus one decorative level for things that carry no information; states (done, past, disabled) are treatments, not colours; a lint guard blocks new fades.
  - Why: the /60, /50, /40 steps measured 2–3.5:1 and were hiding information, not structuring it; Primer, Material and Apple all use three.
  - Rejected: keeping ad-hoc opacity fades.
- **39 · One interaction language** → DS-6, TV-U4 (drag visuals)
  - Who: Maciej, 2026-10-09.
  - Decision: hover = fill everywhere; one selection tint, focus ring, drop target and drag preview.
  - Why: the visual audit found surfaces answering the same gesture differently.
  - Rejected: —
- **40 · Never capitalise people's words** → DS-6
  - Who: Maciej, 2026-10-09.
  - Decision: names appear as typed; every grouping header uses one sentence-case style; small caps only for fixed chrome labels.
  - Why: small-caps group headers were showing project names (consistency item 7).
  - Rejected: small-caps headers that carry user text.
- **41 · One date, time and duration grammar** → DS-6, TV-D14 (`time-format`)
  - Who: Maciej, 2026-10-09.
  - Decision: Today · Tomorrow · Mon · Oct 16 · Oct 16, 2027 · 3:00 PM · 45m · 1h 30m · 4h; dates, times and counts never truncate.
  - Why: the audit found truncated dates in the panel, on cards and in Calendar.
  - Rejected: —
- **42 · Titles give way first** → DS-6
  - Who: Maciej, 2026-10-09.
  - Decision: meta drops whole items behind "+n", never fragments.
  - Why: a fragment ("Wed, …") reads as broken.
  - Rejected: —
- **43 · Avatars: two initials plus a stable per-person colour** → DS-6
  - Who: Maciej, 2026-10-09.
  - Decision: never "M" for "Me".
  - Why: one initial can't tell teammates apart.
  - Rejected: —
- **44 · Density applies to everything** → DS-6
  - Who: Maciej, 2026-10-09.
  - Decision: cards, menus, tabs and pills follow the density setting, not only rows.
  - Why: a dense list beside comfortable menus reads as two apps.
  - Rejected: —
- **45 · One chip, one count language** → DS-6
  - Who: Maciej, 2026-10-09.
  - Decision: one chip component and one way to show a count ("· 3", never a coloured badge).
  - Why: seven chip languages exist today (55).
  - Rejected: —
- **46 · An accent budget** → DS-6
  - Who: Maciej, 2026-10-09.
  - Decision: selection > today/now > done check > queued; queued becomes neutral.
  - Why: the accent only means something when few things carry it.
  - Rejected: an accented queue mark.
- **46a · Text is never rotated** → DS-6, TV-U11, TV-TL1
  - Who: Maciej, 2026-10-10 (round 2b, following his 53b answer).
  - Decision: no sideways labels anywhere: folded columns, Timeline lanes, chart axes.
  - Why: horizontal text reads ~80 % faster than text turned 90° (Yu et al. 2010), worse still with astigmatism.
  - Rejected: rotated folded-column labels.

### 2026-10-10 · Tasks v3 re-plan — principles and ceilings (37, 47–50, 48a)

- **37 · A performance target: instant at 10,000 tasks** → TV-D11a, TV-D11b
  - Who: Maciej, 2026-10-09 ("a scale bar? what do you mean?").
  - Decision: opening a task, searching and switching views under ~200 ms in a 10,000-task workspace; a copy on the device, delta sync, open tasks first, server search, virtualized lists; each code layer evolves, consolidates or rebuilds per the table in REPLAN 37.
  - Why: today ~10 screens each download every task and stop at 5,000; it decides whether "replace Linear/Jira" holds in month six.
  - Rejected: a backend from scratch (weeks of migration and permission re-testing for nothing new) and keeping per-screen refetch.
- **47 · Tasks' bar in the brief** → spec §Scope (PRODUCT_BRIEF §6 edited when the spec lands)
  - Who: Maciej, 2026-10-09.
  - Decision: "complete for students, developers, PMs and small teams", with the deliberately-not-built list as non-goals.
  - Why: a stated ceiling stops the module from drifting toward Jira.
  - Rejected: —
- **48 · Principle wording** → spec §Scope
  - Who: Maciej, 2026-10-09.
  - Decision: ADHD becomes a design lens, not the target user; "Defaults decide; options are few, named and easy to find."
  - Why: the research found the ADHD-first framing narrowed who the module was built for.
  - Rejected: ADHD as the named target user.
- **48a · ADHD features serve everyone** → every later call states it
  - Who: Maciej, 2026-10-10 (in his words).
  - Decision: "The ADHD solutions in our app always have to serve non-ADHD people as well, not work as a trade."
  - Why: a founding rule; every proposal from here on says whether someone without ADHD would want it.
  - Rejected: features that help one group at the other's cost.
- **49 · A trust pass before new features** → TV-P0, TV-D8
  - Who: Maciej, 2026-10-09.
  - Decision: REPLAN §7 P0 (search, repeats, parser, won't-do reach, loading states, time saves, notifications, deep links…) comes first.
  - Why: bugs that lose data or hide tasks undo any new feature.
  - Rejected: features first.
- **50 · Named target roles; founder-led sales in, quota reps out** → spec §Scope
  - Who: Maciej, 2026-10-09 (the role list) and 2026-10-10 (sales).
  - Decision: the six roles plus researchers and ops generalists; founder-led sales and small-team business development are a target; follow-ups that resurface move from P4 to P3.
  - Why: Contacts already makes Moduo a light CRM; quota-carrying reps have a mandated CRM with forecasting and dialers Moduo shouldn't chase.
  - Rejected: sales reps as spillover (the first draft) and chasing Salesforce/HubSpot.

### 2026-10-10 · Tasks v3 re-plan — gaps nobody had named (73–78, 80)

- **73 · Reminders reach you when Moduo is closed: desktop tray plus browser notifications** → TV-D12
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: the desktop app keeps running in the menu bar when its window closes; opt-in browser notifications on the web; reminders fire in any workspace.
  - Why: a 4 pm reminder was lost with the laptop shut; too many emails teach people to ignore the important ones.
  - Rejected: email reminders and a private calendar feed (Google refreshes feeds every 12–24 h and drops alerts); phones get their own plan later.
- **74 · "Import through your AI" can do what 35 promises** → TV-D16
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: agents create projects, sections, areas and statuses, file tasks with dates, repeats and tags, keep an "imported from" key, re-run as updates, and "Undo this import" ships on day one; paste-a-list is the no-AI fallback; tested end to end with Claude + Todoist's connector before it's announced.
  - Why: the cheapest first way in (no importer per service), but call 7's tools only dropped tasks into the Inbox and a second run duplicated everything; it needs only Tasks' own tools, not the other modules.
  - Rejected: native importers first.
- **75 · Time you can bill: entries, "Add time…", a report with PDF and CSV** → TV-D14
  - Who: Maciej, 2026-10-10 (round 2c), with his addition of the PDF.
  - Decision: every tracked stretch is an entry; "Add time…" with date and note; a report sheet from a project's overview and a client's hub (period · by task or day · totals · 15-minute rounding); teammates' time reaches the owner only with "Share my tracked time with the workspace owner"; Export PDF (one branded printable layout) · CSV; no rates or invoices.
  - Why: time by client is what lets freelancers drop Toggl or Harvest; a designed document is what gets sent to a client (his years of Jira and Clockify exports); no-surveillance holds through the opt-in.
  - Rejected: CSV only; invoicing inside Moduo.
- **76 · One "Time & region" setting for the whole app** → TV-D14 (`profiles.time_zone …`), Settings → General
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: time zone, week start, 12/24 h and date order, defaulting from the device; a due date is the same date for everyone, times and reminders are moments in each viewer's zone, a repeat rolls over at its assignee's midnight; Calendar's week-start setting moves here; a travel prompt once.
  - Why: nothing decided whose clock counts (Email forced 24 h, Tasks hard-coded Monday); it's small and should land before the date work spreads.
  - Rejected: per-module time settings.
- **78 · When people and projects go away** → TV-U6 (delete), TV-U16 (done/archive prompt), TV-D13 (teams)
  - Who: Maciej, 2026-10-10 (round 2c).
  - Decision: removing a member sends Inbox tasks others created back to their creators and the rest to the remover, clears Lead, hands private projects on or to Recently deleted; Done or archive with open tasks asks once "Won't do · Move · Keep"; archived projects never remind or repeat but stay searchable; deleting a project moves only open tasks, with one quiet notice per assignee.
  - Why: only "their tasks become unassigned" (PRIV-2) was decided; v3 adds private projects, Lead, teams, templates and views that need an owner.
  - Rejected: fanning every task of a deleted project into private Inboxes silently (20's rule) and #328's radio choice.
- **80 · One notification table** → TV-D12, spec §13
  - Who: Maciej, 2026-10-10 (round 2c: "happy to go with your suggestion").
  - Decision: the spec carries event → who → where → grouped or alone → mute switch; one action on many tasks sends one notice; reminders and check-backs reach you in any workspace; §3's "never changes" line is struck.
  - Why: each call had decided its own notification on the side, so nobody could check that the whole stays quiet.
  - Rejected: per-feature notification rules.

### 2026-10-10 · Tasks v3 re-plan — defaults a–u (agent's choices, deferred to by Maciej: "I trust you with them"; confirmed for building; may be reconsidered)

- **a · Undo on every change** → TV-U4, TV-TL2, TV-U12
  - Decision: every change from a list, board, timeline, key or the bulk bar shows Undo for 8 s and ⌘Z works while it shows; creating many at once undoes as one; Undo never overwrites a teammate's later change.
  - Why: no confirm dialogs; a wrong drop costs one key.
  - Rejected: "are you sure?" prompts.
- **b · Inbox triage keys** → TV-U15
  - Decision: Accept files and assigns to you; Decline hands it back with a note; "Duplicate of…" merges comments and links then marks Won't do; Snooze hides until a date; 1 · 2 · 3 · H; one key map table covers every v3 concept.
  - Why: Linear's keys, because A and D already mean Assign and Due.
  - Rejected: —
- **c · Several workspaces** → spec §Edge cases
  - Decision: one workspace with private projects is the intended setup, and onboarding says so; reminders and the Focus timer reach you in any workspace; no "move to another workspace".
  - Why: cross-workspace moves would need every reference re-checked.
  - Rejected: —
- **d · Work sessions and booking links** → spec §18 (Calendar contract)
  - Decision: scheduled sessions count as busy for your booking links, with a switch per link; teammates see "Busy", never the title.
  - Why: a planned session is time you've committed.
  - Rejected: —
- **e · Bulk actions** → TV-U12
  - Decision: the bulk bar gains Date (+1 day · Next week · Pick…), Status, Section, Waiting on and Team, under one Undo.
  - Why: the gap audit found bulk editing stopped at assign and tag.
  - Rejected: —
- **f · Getting a list out** → not yet placed in a block (flagged)
  - Decision: "Copy as text" on any selection, view or project overview; "Export view as CSV" and a print layout; the full export covers every new object.
  - Why: a list has to paste cleanly into email or Slack.
  - Rejected: —
- **g · Capture offline** → TV-D11a
  - Decision: until full offline, everything opens read-only from the device copy; captures and check-offs queue and send when back ("2 waiting to sync"); other edits say "Offline".
  - Why: the first step toward offline that the device copy (§6.11) makes cheap.
  - Rejected: full offline editing now.
- **h · New Inbox items on top** → TV-U15
  - Decision: newest first, with manual drag.
  - Why: the newest thing is usually the one you're about to deal with, as in email.
  - Rejected: adding at the bottom (Todoist, Things).
- **i · A quiet hover** → TV-U10
  - Decision: hover shows only the Focus mark, a date picker in an empty date cell and the late task's fixes.
  - Why: icons on every hovered row are noise and invite misclicks.
  - Rejected: a hover toolbar.
- **j · Status names in Detailed; dates size the column** → TV-U10
  - Decision: Detailed adds a status-name column; columns drop in a fixed order as the centre narrows; the date column sizes to its widest value.
  - Why: icons follow the category (53a), so "In review" and "In progress" look identical; dates never truncate (41).
  - Rejected: —
- **k · Click the status icon to finish; ⇧S for the menu; `>` `<` nest** → TV-U10
  - Decision: as stated; ⌘[ and ⌘] stay Back and Forward.
  - Why: finishing is the most common action, so it gets one click; ⌘[ / ⌘] are browser keys.
  - Rejected: a status menu on click.
- **l · No grouping by tag or energy** → TV-U2, TV-U10
  - Decision: Group by = Section · Status · Priority · Assignee · Team · Date · Project.
  - Why: a task with three tags would appear three times.
  - Rejected: —
- **m · Manual order inside one project only** → TV-U4, TV-U10
  - Decision: sorting shows "Sorted by due · Back to manual order"; dragging while sorted asks to switch back; cross-project views only sort.
  - Why: one shared order can't survive two views sorted differently; competitors either block dragging while sorted or lose your order.
  - Rejected: manual order across projects (#329's version).
- **n · "+" in each group header, adding at the top** → TV-U10, TV-U11
  - Decision: a "+" that stays visible and adds with the group's value filled in; same on the Board.
  - Why: the end of a long group can be hundreds of rows away; the header is always visible.
  - Rejected: an add row at the bottom.
- **o · Fixed card widths, hidden empty columns, no WIP limits** → TV-U11
  - Decision: one Card at 296 / 280 / 264 px by density; status, section and priority columns always show; assignee, team, project and waiting columns hide when empty ("3 hidden"); each column scrolls and virtualizes on its own.
  - Why: fixed widths stop the board reflowing as you scroll; WIP limits are process tooling for large teams.
  - Rejected: flexing columns (TV-U1's 280–400 px) and WIP limits.
- **p · The panel shows the project when nothing is selected** → TV-U13
  - Decision: inside a project with nothing selected, the Project view; with a task open full-page, the panel shows Project and anything clicked opens there with a back arrow.
  - Why: the right panel is context (48b), and the project is the context.
  - Rejected: an empty panel.
- **q · One activity feed with "All · Comments", no threads** → TV-U13
  - Decision: comments can be edited and deleted; Waiting on is a list, not a property row.
  - Why: threads split a small team's conversation; the switch hides the change log when you only want the talk; Waiting on can hold several people.
  - Rejected: threaded comments.
- **r · Your calendar shows only your work** → spec §18 (Calendar contract)
  - Decision: only your own due dates and sessions; unassigned team tasks stay in Upcoming; a session's planned length is never recorded as worked time.
  - Why: the calendar is your time; a block's length is a plan, not work done.
  - Rejected: teammates' unassigned tasks on your grid.
- **s · Unclaimed team tasks are quiet** → TV-D13
  - Decision: members hear once, grouped by the hour; after 3 days unclaimed, or the day before due, the creator gets one check-back; no round-robin.
  - Why: owning work stays a human choice.
  - Rejected: automatic assignment.
- **t · Any member can create a team; creator, owner or admin deletes** → TV-D13
  - Decision: as stated; Upcoming leaves out unassigned tasks routed to a team you're not in.
  - Why: teams only route and hide nothing, so the risk is low; deleting affects others.
  - Rejected: admin-only teams.
- **u · References: six types in four forms; two fixes first** → RF-1, TV-D8 (registration on create)
  - Decision: the per-type table in capture-references-teams.md §6–8 becomes the References spec; tasks register when created, not when first linked; a deleted item reads "Deleted task".
  - Why: today search and `@` can't find a task until it's linked somewhere; a struck-through title reads as "done".
  - Rejected: —

### 2026-10-10 · Tasks v3 re-plan — platform (REPLAN §6, the agent's technical calls under /s1)

- **§6.1 · Every create and every field edit is a server op** → TV-D8 (`tasks_op_create`, `tasks_op_update`), TV-D7 (raw grants revoked)
  - Who: agent (technical call, /s1 §6).
  - Decision: UI, ⌘⇧K, MCP, import and templates all go through ops that register the entity, re-register on rename, assign the handle and log activity.
  - Why: fixes search and mentions, gives agents capture, makes handles possible, one attribution path.
  - Rejected: the module contract's "single-field raw writes for now" clause, which is exactly what left tasks unregistered.
- **§6.2 · Status, recurrence and next occurrence are computed on the server** → TV-D8 (pg_cron roll-over), TV-D12
  - Who: agent (technical call, /s1 §6).
  - Decision: one SQL occurrence function; the pointer moves only in `tasks_op_set_status` and the cron; the client engine previews only.
  - Why: the reopen bug comes from client catch-up on page load; agents and other devices never saw a roll-over.
  - Rejected: keeping client catch-up.
- **§6.3 · The client tolerates statuses it doesn't know; one "is open" rule** → TV-D8
  - Who: agent (technical call, /s1 §6).
  - Decision: unknown values render by category and never drop rows; "is open" lives in one place, shipped before any vocabulary change.
  - Why: today such rows are silently dropped, so a new status would vanish from old builds.
  - Rejected: changing the vocabulary first.
- **§6.4 · `due_date` becomes a calendar date; due time is its own field** → TV-D9
  - Who: agent (technical call, /s1 §6).
  - Decision: `date` plus optional `due_time`; sessions are rows (`task_sessions`); all moments are `timestamptz`.
  - Why: a timestamp gives off-by-one days across time zones.
  - Rejected: a third "start date" on tasks (68a).
- **§6.5 · One store for dependencies** → TV-D8 (`task_relations` canonical)
  - Who: agent (technical call, /s1 §6).
  - Decision: a hub or MCP "blocks" link writes a relation; cycles refused by the existing trigger; duplicate rows cleaned at TV-D7.
  - Why: today a "blocks" link made from the hub or MCP doesn't block anything.
  - Rejected: two stores kept in sync.
- **§6.6 · One shared task store per workspace** → TV-D11a (store), TV-D11b (virtualization)
  - Who: agent (technical call, /s1 §6).
  - Decision: an IndexedDB (Dexie) cache per workspace, delta sync by `updated_at`, Realtime merge with echo-skip, open tasks first, server search, one-field rollback, an offline queue; every Tasks, Calendar and Home surface reads from it; TanStack Virtual for lists.
  - Why: replaces the full reload ~10 surfaces do on mount (37 sets the bar); the first step toward offline.
  - Rejected: a generic ORM/sync framework (one more runtime) and per-screen refetch.
- **§6.7 · A minimum client build, checked at boot** → TV-D8 (`app_settings.min_build`), TV-D7 (raised)
  - Who: agent (technical call, /s1 §6).
  - Decision: below the minimum the app shows "Update Moduo" and runs read-only.
  - Why: the next schema reversal then costs one migration instead of three code paths.
  - Rejected: open-ended shims for every old build.
- **§6.8 · Manual order lives on the project and its sections** → TV-U4, TV-F6 (Board reorder in Focus disabled)
  - Who: agent (technical call, /s1 §6).
  - Decision: `tasks.position` scoped to (project, section); cross-project views sort, never reorder.
  - Why: as tasks-v2 already says, one order can't serve two views.
  - Rejected: a per-view order table.
- **§6.9 · One TV-D7 cleanup for every reversal** → TV-D7 (after ≥2 desktop releases and 14 days past TV-D9)
  - Who: agent (technical call, /s1 §6).
  - Decision: status label and value, `due_date` type, `reschedule_count`, `task_time_blocks`, `group_label` → areas, `committed_for`, the owner shim, duplicate dependency rows, MCP aliases and raw grants all go in one migration.
  - Why: every change before the cleanup adds a shim; expand → migrate → contract holds, nothing dropped before D7.
  - Rejected: a cleanup per reversal.
- **§6.10 · One time engine for the whole app** → TV-F6
  - Who: agent (technical call, /s1 §6).
  - Decision: Focus, Calendar block focus, the Home pomodoro and the top-bar timer share `features/focus/engine`; saves go through `tasks_op_track_time` from any page.
  - Why: three clocks ran separately and Focus time was lost when saved from another page (P0 #6).
  - Rejected: per-surface clocks.
- **§6.11 · Speed at 10,000 tasks, in detail** → TV-D11a, TV-D11b (`tests/perf/tasks-10k.spec.ts`, 200 ms budget in CI)
  - Who: agent (technical call, /s1 §6).
  - Decision: one local copy per workspace shared by every module, delta sync on open and reconnect, lazy done/won't-do/backlog, server search, virtualised and memoised rows, per-field retry or rollback, a CI fixture against the budget.
  - Why: 37's target has no visible feature; this is what makes it hold.
  - Rejected: optimising screen by screen.
- **§6.12 · Status tolerance before Backlog** → superseded
  - Who: agent (technical call, /s1 §6).
  - Decision: void — it applied only if 53a was declined; with per-project statuses, old builds read the category in today's status column, so Backlog doesn't wait for a desktop release.
  - Why: 53a was accepted on 2026-10-10.
  - Rejected: holding Backlog for a release train.

### 2026-10-10 · Tasks v3 re-plan — the six paused PRs reconciled (group L, 97, 98)

- **L · Verdicts for #315, #327, #330, #329, #328, #323** → blocks 1, 2, 6, 7, 13, 22–23
  - Who: agent's choices, deferred to by Maciej, 2026-10-10 (confirmed for building; may be reconsidered).
  - Decision: #315 (TV-D5) finish and merge first with a window-focus guard; #327 (AT-2) finish and merge; #330 (TV-U2), #329 (TV-U4) and #328 (TV-U6) re-scoped to the decided calls (83, 84, default m, 78, 30); #323 (TV-F2) closed and salvaged into TV-F6/F7, its unapplied `focus_runs` migration re-cut to Timer modes first.
  - Why: #315's migrations are already on prod and it's the first brick of the shared store; #323's screen was built to the comp 61–66 replace, while its run record, takeover and claims carry.
  - Rejected: merging #323 as is; applying its migration unchanged.
- **L · Display wording: "Rows: Standard · Detailed" and "Lanes"** → TV-U2, TV-U11
  - Who: agent's choice, deferred to by Maciej (confirmed for building; may be reconsidered).
  - Decision: the preset is "Rows", swimlanes are "Lanes".
  - Why: one word shouldn't mean two things.
  - Rejected: "Density" or "Columns" for either.
- **L · Dropping a task on the Inbox row does nothing** → TV-U4
  - Who: agent's choice, deferred to by Maciej (confirmed for building; may be reconsidered).
  - Decision: the Inbox sidebar row is not a drop target.
  - Why: a shared task would quietly become private (20).
  - Rejected: drop-to-unfile.
- **L · DS-5's sweep of the other modules is superseded; only its lint guards stay** → DS-6
  - Who: agent's choice, deferred to by Maciej (confirmed for building; may be reconsidered).
  - Decision: no repo-wide primitive migration now.
  - Why: those modules are rebuilt after Tasks and would be swept twice.
  - Rejected: sweeping now.
- **97 · Resume #315 and #327 now, before the spec; skip the ultra review for #315** → blocks 1 and 2
  - Who: agent's choice, deferred to by Maciej, 2026-10-10 (he moved on to the spec without objecting; confirmed for building; may be reconsidered).
  - Decision: each finished in its own session with the validator, `/code-review high` and the security scan; #315's Tier 2 ultra review is skipped.
  - Why: both are independent of the re-plan, and #315 brings the repo back in line with prod; its migrations are already live, so an ultra review could only find problems after the fact.
  - Rejected: holding both until the spec landed.

### 2026-10-10 · Tasks v3 re-plan — carried from the research round (RESEARCH 1–8, 11, 12; decided 2026-10-09)

- **1 · "Complete but calm" replaces "quiet and minimal"** → spec §Scope, §19 (PRODUCT_BRIEF §7 edited when the spec lands)
  - Who: Maciej, 2026-10-09.
  - Decision: quiet = low visual weight, no alarm colours, no debt framing; the default shows everything needed for the next decision, nothing hidden without a count, grouping does the calming.
  - Why: relevant load helps, clutter is visual variety not item count, "too sparse" is a documented switching reason.
  - Rejected: fewer facts as the way to calm.
- **2 · Row presets: Standard and Detailed** → TV-U2 (Display → Rows), TV-U10
  - Who: Maciej, 2026-10-09.
  - Decision: one preset for which properties show on rows, separate from Density; Detailed adds handle, project › section, tag names, estimate/time, created/updated and sortable headers; user-level default, overridable per view.
  - Why: Asana, ClickUp and Akiflow users ask for exactly this pair; user-set static presets beat adaptive ones.
  - Rejected: a third Calm preset (only if dogfooding asks) and a fourth Table view.
- **3 · Task handles: workspace key + permanent number** → TV-D8 (`workspaces.task_key`, `tasks.number`)
  - Who: Maciej, 2026-10-09.
  - Decision: `MOD-142`; key from the workspace name, editable, old key kept as an alias; no zero-padding; numbers never reused; moving never changes a handle; free on every plan; never grants access.
  - Why: people say and search it, agents mix up fewer IDs than UUIDs, developers put it in branch names.
  - Rejected: per-project prefixes (every capture lands in Inbox and moves at triage, leaving stale references) — the hybrid prefix is a possible later display option.
- **4 · Handles: hidden on rows by default, everywhere else always** → TV-D8, TV-U10, RF-1 (text behaviour)
  - Who: Maciej, 2026-10-09.
  - Decision: off in Standard, on in Detailed; always in the detail header, ⌘K search and deep links; every MCP tool accepts the handle or the UUID; a typed handle auto-links in text.
  - Why: rows stay calm; references need to resolve wherever they're typed.
  - Rejected: a fourth glyph for handles in text.
- **5 · "Waiting on…" is a field, not a status** → TV-D10 (`task_waiting`), TV-F8 (In flight)
  - Who: Maciej, 2026-10-09 (the field route).
  - Decision: a task waits on a person, contact, email thread, agent, link or note, with an optional check-back; visible on rows, in Filter/Group by, the contact's hub and MCP; clears itself where it can; In flight becomes the run's view of hand-offs.
  - Why: works with any status and needs no vocabulary change; a cue-based reminder beats a timed one for ADHD; agents need it.
  - Rejected: a fifth "waiting" status (contract change, old builds don't know the value) and a separate "In review" status.
- **6 · Agents are delegates; a human stays accountable** → TV-D16
  - Who: Maciej, 2026-10-09.
  - Decision: the assignee stays human; an agent shows as waiting-on with a session state; one notification at needs you / ready / failed; attribution "Claude, via Maciej's key".
  - Why: Linear's delegate model, GitHub co-authorship and Jira's private-until-publish all keep a human accountable with exactly one loud moment.
  - Rejected: agents as assignees.
- **7 · Agents write tasks: pulled ahead from MCP-1** → TV-D16
  - Who: Maciej, 2026-10-09.
  - Decision: a server create op, then capture/update/subtasks/dependencies/comment tools, output schemas and annotations, a read-only preset, and three prompts (Plan my day, Weekly review, Break this down).
  - Why: every used agent workflow starts with creating tasks (syllabus → dated tasks, meeting notes → tasks).
  - Rejected: waiting for the rest of MCP-1.
- **8 · The client loop: project ↔ client, project overview, time by client** → TV-U16, TV-D14
  - Who: Maciej, 2026-10-09 (carries over to "project").
  - Decision: link a project to a contact or company in one gesture; a project overview as a right-panel view (progress, waiting, due this week, time, files, client, activity); the client's hub shows their projects, open tasks and time; time export for invoicing elsewhere.
  - Why: client work is where the spine is structurally ahead; no task tool links task + contact + email + time.
  - Rejected: "at risk" alarms on the overview; a finance module.
- **11 · A client status link (no login)** → parked
  - Who: Maciej, 2026-10-09.
  - Decision: park until 5 and 8 have landed.
  - Why: it needs a PERM review, a Tier 2 security review and the waiting state first, or the page has nothing honest to say.
  - Rejected: building it in this wave.
- **12 · Team load widget on Home** → TV-H1
  - Who: Maciej, 2026-10-09.
  - Decision: one row per member — queue size and lined-up time, in progress, waiting, due this week; nothing about runs or time per person.
  - Why: show ownership, not surveillance; claims already make queues visible, so no new exposure.
  - Rejected: per-person time or run stats.

## Earlier entries (tasks-v2 and before)

- **2026-10-09 · TV-U1: rows get fixed right-hand columns and quiet counts, completed tasks hide behind a "N completed · show" line, and board cards carry one meta line** (`specs/tasks-v2.md` block 9; no migration).
  - **Row anatomy:** checkbox · title · quiet counts right after it (`# N` tags, subtasks done/total, blocked, repeats; muted, hidden at zero), then fixed columns: priority · [energy] · date · assignee · queue. Each cell has a set width (`w-icon-sm`, `w-19`, `w-icon`), so the columns line up at every density. `rowColumns` (`src/features/tasks/row-layout.ts`) decides them once per list, from the listed rows and their subtasks (expanding a parent never pops a column in): a column empty on every row collapses. Read-only, the queue column shows only when something is queued or claimed.
  - **One date column:** the scheduled time or the due date, whichever comes first by day; on the same day the scheduled time wins. A time today shows as the time; otherwise Today / Tomorrow / Yesterday, a weekday for the coming week, else the date. A clock marks a scheduled time; a passed one is the quiet drift emphasis. The tooltip names both dates. A click opens the editor for the date shown; `s` / `d` and the menu open either one in the same cell. An empty cell holds its place but isn't clickable.
  - **Tags are `# N`**, never chips (U1-2); their names are in the tooltip. Clicking a row's tag chip to filter is gone with the chips; the toolbar's tag filter stays until TV-U2's Filter. The bucket shows as dot + name text only where it isn't implied (Q1-3's rule), and it is still the bucket picker.
  - **The queue toggle** shows on hover, keyboard focus or selection unless the task is queued or claimed (comp), keeping its space and fading (R6). The reveal lives in `QueueToggle` (`revealOnHover`), next to its own "claimed" rule, so TV-F2's live "is on this" claims keep the mark visible once both are in. When some row is in my queue and someone else's, the column widens so both marks fit.
  - **Priority glyph:** three rising bars always drawn, the level read by fill, the rest as 25% ghosts. Energy is the same idea with stacked bars and is off on rows by default. The old glyph map used the key `"med"`, so medium priority and energy never rendered at all; the new map is typed by the vocabulary.
  - **Completed (U1-3):** Display → Completed: Hidden (default) · 7 days · All, remembered per workspace and scope (`moduo:tasks:view:<ws>:<scope>`, DS-4's view prefs). Each list, group and board column ends with "N completed · show"; show is per group, until the scope or grouping changes. Group and column counts are every task in the group. **"7 days" measures from `updated_at`**, since no completion time is stored (a done task is rarely edited, and the server stamps it since TV-D5); a `completed_at` column would make it exact. A done parent with open subtasks stays listed, so they don't vanish with it. **The selected task and its parent always stay listed**, so a deep link (`?id=`), the panel or a spine "open task" never points at a row that isn't there (a done subtask nests under its done parent, which stays and expands). A deep-linked task also stays after you move on, until the scope changes (`useOpenedHere`); tasks you only browse through while completed ones are shown hide again with "hide". The page's selection backstop skips hidden tasks (`useTasksDisplay().isHidden`), so it never opens the panel on a card the Board doesn't show. Board drops are placed among every task of the column, hidden ones included (`boardDropPosition`), because `position` also orders the List. The Queue ignores Completed (TV-D4 keeps a checked-off task there until reload).
  - **Just checked off stays (U1-3):** `useJustCompleted` records every task seen going from open to done while a scope shows, and it stays listed, struck through, until the scope changes or the page reloads. It's derived during render, so the row never disappears for a frame. A teammate's completion arriving live also stays in place rather than jumping out.
  - **Done rows** dim as a whole except the checkbox (title cell and columns at 40%); done cards fade to 50% (comp).
  - **Display (TV-U1 part):** Completed and "Show on rows" (Priority, Energy, Date, Assignee). `src/features/tasks/display.ts` holds the value; TV-U2 adds layout, group, order and subtasks to it and moves Group out of the toolbar.
  - **Board (U1-4):** columns flex between 280 and 400 px (`min-w-70 max-w-100 flex-1`); a card is `rounded-lg` with one meta line (priority · date · counts · bucket where not implied · parent, then the queue mark and the assignee). Selection stays `SELECTED_OPTION`. Display applies to cards too.
  - **Avatars on the icon rung:** `Avatar` gains `size="icon"` (`size-icon`, one initial). The task avatar's `size-4` / `size-5` classes had never applied, because Avatar's `data-[size=sm]:size-6` variant wins over a plain size class, so every row avatar was 24 px and pushed dense rows past `--row-h` (gotchas/ui.md). Rows, cards and the queue mark use the icon size; the detail panel and capture keep theirs (TV-U3 and TV-U7 own them).
  - **Not in TV-U1:** the 📎 count (AT-3), a 💬 count (no per-task comment count is loaded yet), visual baselines (`tests/visual/tasks-list.spec.ts`, `tasks-board.spec.ts`; a human captures them).

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §6 · [src/features/tasks/row-layout.ts](../../src/features/tasks/row-layout.ts) · [src/features/tasks/completed.ts](../../src/features/tasks/completed.ts)

- **2026-10-09 · TV-U3: the task detail panel follows the comp (rule C properties, the Time row, the queue toggle in the header), and comments live in it on shared spine pieces** (`specs/tasks-v2.md` block 10; no migration).
  - **One view of the right panel, never the panel.** Tasks lists its right-panel views through `RightPanelSwitcher` (Details only today; TV-F4 adds In flight) with `hideWhenSingle`, so one view shows just its body; Contacts keeps its one-option header. Calendar, Notes and Email keep hosting the same panel as one of their views.
  - **Header:** the bucket breadcrumb is the bucket picker (the Bucket row is gone), a subtask's breadcrumb continues to its parent, then the queue toggle ("Queue" / "In queue", pressed when queued, `Q`) with a teammate's ringed claim avatar beside it, copy link (`/tasks?id=`, `PUBLIC_WEB_ORIGIN` on desktop), and ⋯: Duplicate, Detach from parent, Archive · won't do (Reopen when archived), Delete. The full-width queue button is gone (U3-3).
  - **Properties (rule C):** Status, Assignee, Priority, Due and Tags always; Energy, Scheduled, Time and Repeat once set, else one quiet line "+ Energy · Scheduled · Time · Repeat" where each name shows its row with the editor open (the row stays while the task is open, even if left empty). Values are `PropertyValue`s: a 14 px icon slot, no chevron, hover shows the field; view-only keeps them at full strength, inert. Skip occurrence moved into the Repeat menu; drift reads "passed" beside the Scheduled value; "Rescheduled N×" moved to the metadata line.
  - **Time row:** estimate and tracked time are one row, "1h 20m of ~4h" with a hairline bar, editing both in one popover (a typed tracked total is TV-D3's `set_total`; a field left as it opened writes nothing, even if Focus saved meanwhile). **"you 50m" shows only when it's a real share** (0 < mine < total, in whole minutes): when all the time is yours it would repeat the total. The share comes from `tasks_time_totals`, read once per workspace and reused for 30 s unless the task's total moved; a task with no time reads nothing.
  - **Comments & activity:** one feed, oldest first: creation, the trail, comments; older items fold behind "Show N earlier" past eight. The composer is text + @mentions: typing `@` (or the @ button) lists active members, ⌘↵ posts, and only people still named in the text are notified; `comments_op_add` adds the assignee, the creator and earlier commenters (TV-D1). Everyone who sees the panel gets the composer, as in Notes; the server's spine guard decides.
  - **Shared spine pieces** (spec decision 12): `spine/comments.ts` (pure rules), `useCommentThread`, `useCommentPeople`, and `CommentComposer` / `CommentCard` / `CommentBody` in `spine/ui/comments-panel.tsx`. Notes' Comments panel runs on them now, so its authors show real names instead of "Teammate".
  - **Duplicate copies the plan, not the history:** title, description, bucket, parent, assignee, priority, energy, dates, estimate, repeat rule and tags; the copy is open, unqueued, with no tracked time, subtasks, blockers, links or comments. It lands at the end of its bucket and is selected.
  - **Title** is `DetailTitle size="lead"` (18 px semibold, wraps) in an auto-growing field; the other inspectors keep `rail` until their own redesign.
  - **Linked +** links a note, contact, company or event (`EntityLinkPicker`, origin `manual`), with the "Already linked" guard the hub drop uses.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §9 · [src/features/tasks/ui/task-detail-panel.tsx](../../src/features/tasks/ui/task-detail-panel.tsx) · [src/features/spine/ui/comments-panel.tsx](../../src/features/spine/ui/comments-panel.tsx)
- **2026-10-08 · TV-D5: Tasks is live over Supabase Realtime; your own edits hold teammates' changes back until they settle, and coming back to the app refetches** (`specs/tasks-v2.md` block 8, decision 10; migrations `20261008223000_tasks_realtime_publication.sql`, applied to production 2026-10-08, and `20261008224500_tasks_server_updated_at.sql`).
  - **Published:** `tasks`, `buckets`, `task_queue`, `tags`, `tag_links`, `comments` join `supabase_realtime`. Inserts and updates reach only subscribers whose RLS lets them read the row; a delete reaches every subscriber of the table but carries only its uuid. `comments` is published for TV-U3 (no Tasks listener yet); `attachments` doesn't exist yet, so AT-1/AT-2 add it.
  - **One channel per workspace and person** (`tasks-db:<ws>:<me>`, `src/features/tasks/realtime.ts`), shared by every surface running `useTasksModule` and filtered by `workspace_id`. Like chat and notes it sits outside the runtime seam (NO-6).
  - **Merge rules** (`src/features/tasks/live.ts`): a change for a row we have lands only if its `updated_at` is newer (to the microsecond; Realtime and PostgREST format timestamps differently), and soft-deleted rows leave. While any of the module's own `runtime.tasks` calls is in flight, plus 1 s after (the echo usually trails the response), changes wait in a buffer and then land in order. So an echo never reverts an optimistic edit, and a row you just removed isn't put back by its insert's late echo. A stalled call can hold changes for 10 s at most. *Rejected: per-entity pending sets wired into every mutation (~20 call sites) — the runtime wrapper covers them all, including future ones.*
  - **One clock for `updated_at`** (`20261008224500_tasks_server_updated_at.sql`): a `BEFORE INSERT OR UPDATE` trigger stamps `tasks`, `buckets` and `tags` with `clock_timestamp()`. Client-direct writes used to send the device's clock while ops used the server's, so a device running ahead made its rows look newer than later changes and open apps dropped them (validator, round 1). Old builds' stamps are quietly replaced. *Rejected: comparing by Realtime's commit timestamp — reads carry no such column to compare against.*
  - **Refetch** on reconnect (socket rejoin, `online`), with one trailing read if inside the 5 s throttle, and on coming back to the window (focus or visibility, leading-only, so one return reads once). It's quiet: no loading flag, no error banner, and the result is discarded and retried if one of our saves started while it was out.
  - **Where changes land:** tasks and buckets in the hook's bundle; queue rows in TV-D4's `queueRows` (claims and my line-up update live; a quiet refetch keeps the done tasks shown in place in my Queue); tags and links in TV-T1's workspace tag store (`applyLiveTags`), where a pending op stays on top and a saved one gives way to a later change on the same tag or link; the store remembers when a live change touched each tag and link, so a read that started before it (a hub's single-item read, another surface's load) can't put the older state back. A done task kept in place in my Queue leaves it if a teammate reopens it. Not caught live: a row that stops being visible to you (unshared, moved to a bucket you can't see) sends you nothing, so it stays until the next refetch.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §12, decision 10 · probe: `supabase/probes/tasks-realtime.{stub,probe}.sql`

- **2026-10-08 · TV-D3: tracked time is a log of entries; a save resent after a reload counts once, and saving time never puts back anyone's edit** (`specs/tasks-v2.md` block 5; migration `20261008225500_tasks_time_entries.sql`, applied to production 2026-10-09 as version `20261008221907`, after AT-1 and TV-D5's stamp, with Maciej's OK; then a rolled-back probe there as a workspace owner passed: a focus save, its resend answered `duplicate`, an adjustment and its Undo, a typed total, an unknown task `gone`, own rows only through RLS, the totals read, an old build's write as an adjustment, nothing else on the row changed, no activity rows; round-trip `supabase/probes/tasks-time.{stub,seed,probe}.sql` on the TV-D2 stub chain plus AT-1's migration, in both orders).
  - **`task_time_entries`**: one row per focus or waiting stretch (who, when it ended, how long), per adjustment (signed), and one `legacy` row per task holding the total it had before (no person, no date). Written only by `tasks_op_track_time` and the old-build shim; each person reads only their own rows. Time ops write no `module_activity` rows (spec decision 5).
  - **A task's total** = every entry except waiting, never below zero. `tasks.time_spent_seconds` keeps it, so lists, the MCP task shape and old builds read the same number everywhere (D3-2). **`tasks_time_totals(workspace, since?)`** adds the caller's own share, their waiting time and their share since a time (legacy never counts there: D3-4); nobody can read anyone else's share.
  - **Saving time changes only the time.** The op writes `time_spent_seconds` (and bumps `updated_at`, as TV-F1's save did, so TV-D5's live updates, which apply a row only when it is newer, carry the new total) and nothing else on the row; the app takes the server's total from the answer, which already counts teammates' time. Edits can't carry the time column any more (`editableTaskFields` drops it), so no edit or re-save can put back a stale total.
  - **The duplicate guard TV-F1 asked for.** Each save from the Focus engine carries an idempotency key (`FocusCredit.flightKey`). A save that failed, came back "not now", or died with its page is kept as it was and sent again with the same seconds and key; the server records one entry per (task, key) and answers `duplicate` to a resend. Time earned meanwhile goes as its own save right after. A hand-off from a build before keys counts as unsaved again, as before (once, at the upgrade).
  - **Corrections (D3-3).** Typing a Time value sends `set_total` (one adjustment makes the total exactly that, or none); "Took longer" and Execute's "+5m" add one adjustment, and Undo removes exactly that entry by id (only your own, only adjustments), so time tracked meanwhile stays. Taking time away stops at zero, and the hidden sum never goes below it: an Undo after someone took time away (typed 0, say) adds an evening-out entry nobody can undo, so time saved later counts in full. Calendar's block focus saves real focus stretches. One task's time writes from one Tasks view go one at a time, in order (a request that hangs fails after 30 s), so the total shown last is the latest; Calendar and Tasks each keep their own order, which only affects what's on screen until the next load.
  - **"Gone" is the server's answer now.** A task deleted for good, not shared with you any more, or in another workspace answers `gone` (the same answer for all three, so nothing leaks) and the engine drops the seconds with a note. A task in the trash still takes its time. A module viewer, or view-only access to the task, is refused (the save stays "not saved yet", as in TV-F1).
  - **Old builds keep working (D3-5).** Their writes of `time_spent_seconds` become the writer's adjustment, so the total lands on what they wrote (last writer wins on that column, as before). **Except a lower value from a whole-row upsert** (how builds before TV-D1 save every edit), which carries a possibly stale copy of the total: it's ignored, so renaming a task on an old build can't take away a teammate's time. The upsert is told apart by its BEFORE INSERT pass on an existing id (a transaction-local setting the UPDATE pass reads and clears). A task created with time on it gets that time as its creator's adjustment. Removed in TV-D7.
    - **Accepted costs until those builds update.** A higher stale copy from such an upsert is still added (it can put back time someone took away), because ignoring increases would drop every bit of focus those builds track (the TV-D2 queue shim made the same call). And builds from TV-D1 to before TV-D3 save focus as a narrow write of their own copy of the total, which looks exactly like a typed value: a copy that missed a teammate's newer time lowers the total. **Rebuild the desktop app as soon as TV-D3 is on `maciej`**, so totals are exact on every device (D3-1).
  - **Account deletion** keeps the seconds in the task's total and forgets whose they were (`user_id` SET NULL). Leaving a workspace keeps the entries.
  - *Deviation from the spec's wording* ("opens/heartbeats/closes the caller's open entry, one open entry per user+task"): the TV-F1 engine keeps the clock on the device and saves finished stretches every minute, so the op appends closed stretches with a key. There are no open entries to heartbeat or expire; "is on this" comes from `focus_runs` (TV-F2), which also gets `run_id`'s foreign key.
  - **Before the migration reaches the database** the runtime writes the old column only (read the total, write the new one), as builds before TV-D3 did; `listTimeTotals` is empty.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §5 · probe: `supabase/probes/tasks-time.{seed,probe}.sql` · checklist [docs/testing/t-maciej-tv-d3-time-entries.md](../testing/t-maciej-tv-d3-time-entries.md)

- **2026-10-08 · TV-D4: the app reads and writes my personal queue; claims show who else has a task lined up; "My tasks" joins the rail** (`specs/tasks-v2.md` block 7; no migration).
  - **One queue in the app: mine.** The row/card toggle, `q`, the context menus, the detail panel button, the rail's Queue row, Focus, the Home Tasks widget and Calendar's tasks panel all use `task_queue` through `useTasksModule` (`queuedTasks`, `queuedTaskIds`, `queueClaims`, `queueCount`; `toggleQueue` / `addToQueue` / `removeFromQueue` / `moveQueuedToEnd` / `reorderQueue` / `captureToQueue`). The old `committedTasks`, `toggleCommit`, `rescheduleFromToday`, `commitNewTaskToday` and `commitOrderUpdates` are gone. The pure rules live in `src/features/tasks/queue.ts`.
  - **The new app no longer writes `committed_for` / `commit_order`.** Old desktop builds keep their own shared day list (their commits still land in the committer's queue through the TV-D2 shims), but what the new app queues doesn't show in an old build's "today". The columns go in TV-D7.
  - **Queue ops are sent one at a time, in the order they were made** (a promise chain in the hook), and only the newest answer is applied. Each op answers with my whole queue, so a later answer always includes the earlier ops, and pending optimistic edits aren't put back by an older answer. Ops on a task that's still saving (a `tmp-` id) are refused with "Still saving that task".
  - **Done leaves the queue at once, on screen too.** Completing, archiving or deleting a task drops every person's row locally (as the server does). A task I complete stays in the Queue view, done, in place, until the next load (tasks-v2 §6), so Focus still reads "1 / 2 done". Reopening it doesn't re-queue it (TV-D2). Done and archived tasks get no queue mark, menu item or panel button.
  - **Claims (D4-2):** a task in someone else's queue shows their small ringed avatar in the queue column ("In Mike's queue"; with several people, "In Mike's and Ola's queues"); it stays clickable and adds the task to mine, with a quiet toast "Also in Mike's queue". When we both have it, their avatar sits beside my accent toggle. The detail panel shows the same line above its queue button. View-only members see claims without actions. "<name> is on this" (a running run's Now) is TV-F2's.
  - **My tasks (D4-3, D4-4):** a rail row between Queue and Inbox, shown only with two or more active members (`showsMyTasks`). Scope `"mine"` = tasks assigned to me across buckets, archived left out and done kept, like All (TV-U1 hides completed tasks everywhere). It groups by bucket like All, and rows and cards there leave out the assignee avatar. The rail count is my open ones.
  - **Focus Skip = to the end of my queue** (spec §3), not "out of today": never a reschedule; alone in the queue, the task stays Now. "Remove from queue" in Focus arrives with TV-F2's ⋯.
  - **Home Tasks widget:** my queue's open tasks, headed "Queue"; when it's empty, the open tasks in list order, headed "Open" (decision 17). It reads a new `taskQueue` source in the dashboard data context.
  - **Not decided here:** the stale line-up prompt's "last touched" source (TV-F2; removals delete rows, see TV-D2).

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §1, §2 · [src/features/tasks/queue.ts](../../src/features/tasks/queue.ts)

- **2026-10-08 · TV-T1 landed: one workspace tag store feeds every surface, and a tag can be created by name and attached before its task exists** (`specs/tasks-v2.md` block 6; no migration).
  - **One store per workspace** (`src/features/tags/store.ts`, a module-level `useSyncExternalStore` store like TV-Q1's hidden buckets). Tasks, Calendar, Notes and Email (each its own `useTasksModule`), the note/email/contact/company tag rows and the contacts directory filter all read it, so a tag change shows everywhere at once (T1-1). Tag code moved out of `features/contacts` into `features/tags` (`store.ts`, `selectors.ts`, `hooks/use-entity-tags.ts`, `ui/entity-tag-row.tsx`).
  - **Reads seed it; writes are ops on top.** Each read hands in what it loaded, the part of the links it covered (all, some entity types, or one entity: a seed replaces only that part, and never a part a newer read already loaded) and when its request started. A write shows at once as an op over the loaded data; it stays on top until a read that started after it saved comes back, so a slow older read can't put back a change, and a failed write drops it with a toast on every surface. A read whose links hit the SCALE-1 row cap can't tell a removed link from one past the cap, so it doesn't count as having loaded its scope and leaves alone what full reads of single items or types loaded; it still refreshes tags, and no read brings back a link written after it started. Signing in as someone else (or out) empties the store (`attachTagUser`, from the AuthProvider).
  - **New tags get a client-generated uuid** (the runtime's `upsertTag` already accepted one), so there are no temp tag ids to swap and the "Still saving that tag" guard is gone: an attach waits for its tag's row, and writes to the same link, or to the same tag, run one after another.
  - **Create-or-attach by name** (`createOrAttachByName`, Tasks' `createTagForTask`) attaches the live tag with that name (any case) or creates it, in one step, and takes the item's id as a promise: `createTask` now resolves to the saved task, so capture (TV-U7) can tag a task before it is saved (T1-2). If the task is never saved, a tag made just for it is deleted again unless something else uses it by then.
  - **Delete keeps its Undo grammar** and now commits through `undoToast`'s `onCommit` (when the toast closes), instead of a fixed timer.
  - *Deviation from the spec's "event renamed":* the `moduo:contact-tags:changed` window event is gone rather than renamed. Its only listener was the contacts directory, which now reads the store, so every surface re-renders from the same state without an event.
  - **`listEntityTags` fixed** (the spec's "separate chip" never landed): a stray third query filtered `tag_links.deleted_at`, a column that table doesn't have, so every hub tag row (contacts, companies, notes, email) failed its read and showed nothing until this block.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §Assumptions 11 · [src/features/tags/store.ts](../../src/features/tags/store.ts) · tests [store.test.ts](../../src/features/tags/store.test.ts)

- **2026-10-08 · TV-D2: each person has their own Queue, not tied to a date; the old day columns stay for old builds, and their commits land in the committer's queue** (`specs/tasks-v2.md` block 4; migration `20261008171500_tasks_personal_queue.sql`, applied to production 2026-10-08 after a drift check and a rolled-back dry run, then probed there; round-trip `supabase/probes/tasks-queue.{stub,seed,probe}.sql`).
  - **`task_queue`** is one row per (person, task), ordered by `position` (`COLLATE "C"`, the app's fractional keys: 10 base-36 digits, 2^20 apart, so a client can mint an optimistic key between two). The server only writes clean keys and renumbers a person's queue when two neighbours run out of room. Writes go only through `tasks_op_queue_add` (`end`, or `top` for Calendar's "Start focus"), `_remove`, `_reorder` (after a task, or the top) and `_move_to_end`, each acting for `perm_actor_id()` (an API key: its creator), serialized per person by an advisory lock, and returning that person's queue. Add and remove are in the task's trail (`tasks.queue_add` / `tasks.queue_remove`: "queued this", "removed this from the queue"); moves aren't.
  - **Who sees what.** Anyone who can see a task can read who has it queued (claims, for TV-D4); the read policy and the ops' answers both drop a task you can no longer see. You can still remove your own row for it (quietly: its trail isn't yours to write in). `perm_enforce_write` is registered for INSERT/UPDATE only: removals follow someone else's change (a task completed, a member removed) that already passed its check, and a cascade must never fail on a person's queue.
  - **Leaving queues:** done, archived, deleted (soft or hard), or deleted together with its bucket; a removed member's queue in that workspace goes too (so nobody sees "In <name>'s queue" for a former member), and deleting an account empties every queue through the `profiles` cascade. Reopening, restoring, catch-up and moving or reassigning never touch queues.
  - **Carry-over (once):** open tasks committed for a date that is today somewhere on Earth when the migration runs (UTC-12 to UTC+14) go to the latest committer (an API key's: its creator) if still in the workspace, else the assignee if they are, in day then `commit_order` order. Production had none when it was applied (2026-10-08, 19:17 UTC), so nothing carried over.
  - **Old builds keep working, with the old shared day list.** `tasks_op_commit` / `uncommit` / `skip_today` now also add to (commit: to the end; again: moves there) or take out of the caller's queue, and still write `committed_for` / `commit_order`, which builds before TV-D4 read as "today". `skip_today` no longer bumps `reschedule_count` (spec decision 4; the app's optimistic Skip matches). An old build's direct writes are mirrored into the writer's queue too: an insert or update setting a current `committed_for` (capture straight into today) adds it at the end, and a `commit_order` change re-sorts that day's rows in the writer's queue. **Removals are never mirrored:** a whole-row save from a build before TV-D1 can write a stale NULL, which must not empty a queue (the opposite stale case re-adds a task to the writer's queue, which is what their build shows them).
  - **Deviation from the spec's wording** (decision 4: "catch-up and recurrence stop touching commit columns; `clear_commit` / `release_commit` are ignored"): `tasks_op_catch_up` and `tasks_op_skip_occurrence` are unchanged and still clear the old columns, so old builds keep today's behaviour, but the queue never follows them (the mirror ignores removals). What the spec is after, a queue that midnight and recurrence don't empty, holds.
  - **Between TV-D2 and TV-D4** the app still shows the old day list while commits also pile up, dateless, in personal queues. TV-D4's switch shows everything still queued; the stale-line-up prompt ("Lined up 3 days ago…") is the intended answer. Removals delete rows, so "last touched" for that prompt needs its own source (`module_activity` add/remove rows, or a per-person timestamp): TV-D4/TV-F2 decide.
  - **MCP:** `tasks_queue` (read) and `tasks_queue_add` / `_remove` / `_reorder` (`position`: top, end, or after `after_task_id`) act on the key creator's queue; every task carries `queued_by_me`. `tasks_today` / `tasks_commit` / `tasks_uncommit` / `tasks_skip_today` stay as aliases until TV-D7 (`tasks_today` returns the queue; its `date` is echoed, not a filter). `committed_for` / `commit_order` stay in the task shape until TV-D7.
  - **App:** `runtime.tasks.listQueue` (every visible row, sorted by person then position; empty until the migration is applied) and `opQueueAdd` / `Remove` / `Reorder` / `MoveToEnd`, for TV-D4 to use. No UI change in this block.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §2, decision 4 · probe: `supabase/probes/tasks-queue.{stub,seed,probe}.sql`

- **2026-10-08 · TV-D1 landed: task edits save field by field, a task has its own assignee, and owner_id is the creator again** (`specs/tasks-v2.md` block 3; migration `20261008150000_tasks_assignee_creator.sql`, applied to production 2026-10-08 after a rolled-back dry run, then probed there).
  - **Edits send only what changed.** `patchTask` → `runtime.tasks.updateTask` sends the edited columns plus `updated_at` (`src/lib/task-rows.ts`), so one person's edit can't put back a field a teammate changed. Creation stays an upsert (`upsertTask`); re-saving a task that exists writes its editable fields only, never the creator or assignee. Undo writes back only what the undone action changed (a delete's Undo: `deleted_at`, and the subtasks' `parent_id`). Same-field conflicts stay last-writer-wins.
  - **`tasks.assignee_id`** (NULL = Unassigned, FK to `profiles` ON DELETE SET NULL) is backfilled from `owner_id` (an owner whose account is gone becomes Unassigned). `owner_id` is now the creator: whoever inserts the task (an API key: its creator), never changed afterwards. **Creator recovery:** a DF-9 `tasks.assigned` row logged within a minute of the task's `created_at` is the insert's own row, so its actor is the creator (production: 5 such tasks); a task reassigned later with no such row keeps `owner_id` as it was and gets **`creator_unknown = true`**, and the app leaves "Created by" out. Server-owned: clients can't change either column. **Limit:** an old-model "Assign to → Me" pickup logged nothing, so such a task now says it was created by whoever picked it up; nothing in the data can tell (no guessing, per the spec).
  - **Old builds keep working.** They read `owner_id` as the assignee and write it back. A BEFORE trigger (`assignee_and_creator_*`, named to run before `perm_enforce_write`) turns an `owner_id` change into an assignment and keeps the creator. They never send `assignee_id`, so its column default is the nil uuid: the insert trigger sees "not sent", maps the legacy `owner_id`, and a CHECK guarantees the placeholder is never stored. Known costs, until it updates: an old build *shows* the creator where it used to show the assignee, and it can't hand a task back to its creator (writing `owner_id` = the creator is no change, so nothing is assigned; it shows that person as the assignee anyway). Removed in TV-D7.
  - **`tasks_op_assign`** is the assignment op (UI and MCP `tasks_assign`): the person must be a member who can work on tasks (`perm_user_has(…, 'tasks.edit')`), else "Viewers can't be assigned tasks." / "That person isn't a member of this workspace." The `perm_enforce_write` assignee check now runs only when the assignee is *set*, so a teammate who later became a viewer or left no longer freezes the task.
  - **Notifications have one generator: the `tasks_notify_spine` trigger,** not the op. Every assignee change is logged as `tasks.assigned` with `{from, to, self}`, attributed to the actor, whatever the path (the op, an old build's `owner_id` write, a create for someone else); only a change to someone other than the actor (`perm_actor_id()`, so an API key assigning its own creator stays quiet) names them in `mentioned_user_ids` and reaches their bell. Unassigning and taking a task are trail rows ("unassigned this", "took this"), never notifications; member removal unassigns quietly. *Deviation from the spec's wording* ("the op logs; the trigger keeps only its INSERT branch"): that design notifies old builds' reassignments zero times, and direct writes either zero or twice; one generator makes "exactly once" (D1-4) hold for every path. New **`tasks.completed`**: completing a one-off task someone else created tells the creator once (open → done, creator ≠ completer, creator known; never for a repeating task, so a daily chore doesn't ping its creator every day: Maciej, 2026-10-08); it has its own mute, "Completed by someone else", and stays out of the task's trail (`tasks.set_status` already says it). Unblocked and overdue go to the assignee, else the creator when known; a task comment reaches the assignee, the creator (when known) and earlier commenters, minus its author (spec §1). A creator who can no longer see the task (`can_access`) gets no completed, unblocked or comment notification about it, since those carry its title or an excerpt (security scan, 2026-10-08).
  - **PRIV-2a re-keyed.** `share_member_removed` and `account_erase_workspace_data` (live in production since 2026-10-08, from PR #251; the migration refuses to run without them) unassign by `assignee_id`; the creator stays on tasks a removed or deleted member made. This keeps PRIV-2's AC9 ("a removed member's tasks there become unassigned"), which conflicts with tasks-v2's edge case "Assignee leaves → stays assigned as Former member": **Maciej kept AC9 (2026-10-08):** a removed member's tasks become Unassigned so someone can pick them up; the UI still labels a former member if one ever appears (e.g. "Created by a former member").
  - **MCP:** every task carries `assignee` (`{id, name}`, null = Unassigned) and `creator` (left out when unknown); `tasks_list_assignees` lists who can be assigned; `tasks_assign` takes a member id, `"me"` or null.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) · probe: `supabase/probes/tasks-assignee.{stub,seed,probe}.sql`

- **2026-10-08 · TV-F1: Focus keeps time by the wall clock, survives reloads, and asks about away time** (`/s2` TV-F1).
  - **One engine.** `src/features/focus/engine.ts` (pure model: `engine-core.ts`) replaces the tick-counting `tasks/focus-session-store.ts`. Elapsed time is `Date.now()` arithmetic; the 1 Hz tick only repaints and looks. TV-F2 builds the queue run on it, TV-D3 swaps its save path; neither changes the engine's API (bind, start, pause/resume, stop, pomodoro, resolve away, register a sink, flush, read the session).
  - **Persisted per person** in localStorage under `moduo:tasks:focus:<user id>`: outside the `moduo.*` keys Settings → Advanced → Reset local cache clears. The AuthProvider attaches the engine to whoever is signed in.
  - **One clock per device.** Only one tab runs the clock (credits, saves, alerts); other tabs mirror it and take over when you act in them, when that tab closes (pagehide hands it over), or after 75 s without a heartbeat. 75 s is under the 90 s away gap, so a takeover never reads as away. A tab that takes the clock reloads its task list before its first save, and a background tab never takes the clock just to save (its list could revert edits). The desktop webview always runs it. *Rejected:* Web Locks / BroadcastChannel leader election — more machinery for a web-only, two-tab case.
  - **Away** = more than 90 s between two looks at a running clock (sleep, a suspended webview). The gap's work time is held, never credited, until you answer:
    - **Keep** credits it to the task it accrued on — in pomodoro only up to the scheduled end of the block it was in;
    - **Discard** credits nothing and leaves the rhythm as caught up;
    - **Count as break** credits nothing and, in pomodoro, starts a fresh focus block at the moment you answer.
    - Unanswered when the session ends (Stop, the queue empties) → dropped.
  - **Pomodoro catch-up:** phase ends inside a gap are computed from timestamps, a work block never starts by itself while away, and caught-up ends don't chime or notify. The prompt says what happened ("Your 25-min focus ended at 2:25 PM").
  - **The rhythm belongs to the session.** Binding another task (Done or Skip moves Now) keeps phase, block count, pomodoro and running; the stopwatch keeps counting the sitting across tasks.
  - **Saving.** Unsaved seconds are kept per task and handed to the workspace's sink: `true` = saved, `false` = not now (silent), `"gone"` = the task is missing from a complete list of its workspace loaded after the time was tracked (deleted, unshared): the seconds are dropped and the person gets a note, so "not saved yet" can't stick forever. A promise = the write; a failed write marks that task "not saved yet" and retries (15 s doubling to 2 min) until it saves. The save writes only the task's time total (never the whole row, which would put back a Done in flight or another tab's edit), as an absolute total built on the fresher of the bundle row and the last save any tab made (`moduo:tasks:focus:saved:<user>`). Saving is at-least-once; TV-D3 should add an idempotency key. The Focus view only *follows* its current task — it never takes the clock from another tab or moves a session on another workspace's task — while Done/Skip on the session's task move it explicitly. Account deletion erases the device's focus record.
  - **Desktop:** `backgroundThrottling: "disabled"` on the main window, `tauri-plugin-notification` 2.5.1 with `notification:default`. The plugin can't schedule, so the engine fires the alert at the computed time. A background phase end leaves one in-app toast that waits for you, plus one OS notification on desktop (the plugin swallows delivery failures, so the toast is the reliable layer); in front, only the chime.
  - **Not verified here:** OS-notification delivery on a signed build (this Mac has no signing identity) — on the manual checklist, with the spec's UNUserNotificationCenter fallback if it fails.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) §3, §5 · [src/features/focus/engine.ts](../../src/features/focus/engine.ts) · checklist [docs/testing/t-maciej-tv-f1-focus-engine.md](../testing/t-maciej-tv-f1-focus-engine.md)

- **2026-10-08 · TV-Q1: the List leaves modified keys alone, a row's buttons keep Space/Enter, the bucket pill shows only where the bucket isn't implied, and deleting a bucket confirms, then commits when its Undo toast closes.**
  - **Keys** (`src/features/tasks/ui/list-keys.ts`): the List ignores every ⌘/Ctrl/Alt combo except the ones it binds (today only ⌘⌫), so ⌘K, ⌘⇧K, ⌘1–7 and ⌘C/⌘V/⌘X always reach the app or the OS. Shift is not a bail-out (TV-U5 binds ⇧J/⇧K). Keys typed in a row's portaled popover or context menu never reach the List. Space/Enter on a row's own button activate that button; the selected row's title counts as the row (clicking it is how a row gets selected, and Chromium focuses a clicked button). Any List key pressed while focus sits on a row's button hands focus back to the List, and so does a mouse click on a row's button (Chromium focuses it; desktop WebKit doesn't), so the next Space/Enter acts on the selected row.
  - **Drag:** the row root is the only keyboard drag activator (`setActivatorNodeRef`), on List, Queue and Board. List and Queue rows aren't focusable, so they have no keyboard lift until TV-U5's ⌘↑/⌘↓; a focused Board card still lifts with Space.
  - **Bucket pill:** hidden in a single-bucket scope and when grouped by bucket (`showBucketPill`). The bucket popover stays mounted, so the `b` key still opens the bucket picker where the pill is hidden.
  - **Delete bucket:** a confirm names the bucket and its task count — every task its list shows, with the open share named when done tasks are included, since the rail counts open ones ("It has 5 tasks (3 open), which will move to Inbox."). The choice "Delete the tasks too" arrives in TV-U6 with Recently deleted, so Q1 states the move instead of showing a one-option radio. The delete is a **deferred commit** like `deleteTag`: the bucket is hidden at once through a session-wide store (`src/features/tasks/hidden-buckets.ts`) that every `useTasksModule` applies (its tasks show in Inbox), the server delete runs only when the Undo toast closes without Undo (`undoToast`'s new `onCommit`), and Undo un-hides it. The loaded data is never rewritten, so edits made meanwhile still save the task's real bucket, and a reload or another pending delete can't bring the bucket back early. Known limit until TV-U6: closing the app while the toast is up means the delete never happens.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) (Q1-1–Q1-5)

- **2026-10-08 · Tasks v2 calls answered: saved views are personal and synced; buckets get Archive, "Delete the tasks too" and a 30-day Recently deleted** (Maciej, answering the `/s1` open questions).
  - **Saved views** ship in this wave (TV-U8). They're personal and sync across your devices (`task_views`, own rows). Sharing a view with the workspace comes later, on top of PERM sharing.
  - **Buckets** can be archived: hidden everywhere, restorable any time. Deleting one asks whether to move its tasks to Inbox or delete them too, and anything deleted (tasks, buckets, files) stays in **Recently deleted** for 30 days.
  - **Mike's rebuild** is the agent setup (Harness v2), not Tasks code, `runtime.web.ts`, migrations or the MCP function, so the Tasks blocks need no extra sequencing with him.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md)

- **2026-10-07 · Tasks v2 planned: the team model, a personal Queue, Focus as a queue run** (`/s1` with Maciej + Mike, from the dogfood review).
  - **Assignee:** one optional assignee (`tasks.assignee_id`, nullable = Unassigned); `owner_id` goes back to meaning the creator and becomes immutable. No multiple assignees — queue "claims" cover "who's on it".
  - **Queue:** personal and not tied to a date (`task_queue`), replacing the workspace-wide `committed_for`. A task leaves every queue when it's done, archived or deleted.
  - **Focus:** a *run* of your Queue. No Plan/Focus switch, pomodoro per run, `focus_runs` persisted, "In flight" for handed-off work.
  - **Time:** recorded as append-only `task_time_entries`. These ops write no `module_activity` rows — the entry table is the attributed log.
  - **Saves:** task edits send only the changed fields.
  - **Live updates:** tasks get Supabase Realtime.
  - **Migrations:** expand → migrate → contract, with shims for old desktop builds; cleanup in TV-D7.
  - **Landing:** `maciej` only, not `develop`, until Maciej says otherwise.

  → [specs/tasks-v2.md](../../specs/tasks-v2.md) · working notes: [.design/tasks-dogfood/REVIEW.md](../../.design/tasks-dogfood/REVIEW.md)

- **2026-07-11 · DF-22: Tasks unifies to ONE app-level `DndContext`, but the Timeline deliberately keeps its own nested one.** The ratified scope was "one app-level DndContext; per-module contexts become `useDndMonitor` consumers." Applied to the List + Board (they now render as `dndMode="external"` monitor consumers so a center-pane task drag reaches the right-pane DF-8 hub → link). The **Timeline was left as a nested context** on purpose: its only dnd-kit draggable is the tray→axis chip, whose drop is pointer-derived and **requires `autoScroll={false}`** and a **keyboard-disabled** sensor — both genuinely conflict with the shared context the Board wants (autoScroll-on, sortable-keyboard), and the Timeline has no cross-pane drop target (bars are custom pointer engines, not dnd-kit). A nested context is isolated (the inner claims tray drags; the hub handler never sees them), so the Timeline is byte-for-byte unchanged and the tray→hub gesture is simply out of scope (marginal). The one shared collision (`appCollision`) must branch per surface to stay byte-for-byte: hub wins pointer-first over `link:*`, else **Board=`closestCorners`, Queue reorder=`closestCenter`, nest=`pointerFirstCollision`** — Queue must NOT use pointer-first (whole-row activator → off-center grabs make the dragged-rect-centre and the pointer diverge, changing the drop index). → `src/features/tasks/ui/tasks-plan-view.tsx`, `docs/gotchas.md §Drag-to-link`.

- **2026-07-03 · Tasks TL-3 timeline dependency creation landed — Timeline view complete.** The connector-dot gesture (AC8) on top of TL-1's arrow rendering. Block decisions: **(a)** **cycle drops are silent no-ops like self/duplicate** — `resolveConnectorDrop` rejects them pre-flight (no highlight, no write, no modal; mid-gesture is no place for an error), while the List picker's explicit cycle toast stays; **(b)** **done bars offer no connector dot** — a completed task can never block (`blockedTaskIds` counts open blockers only), so the gesture would draw an arrow with zero effect and no lock: an inert-affordance trap; **(c)** **connector drops re-hit-test at release**, not from move-time state (the TL-2 wheel-scroll lesson generalizes to every pointer-resolved target), and the browser's follow-up click is swallowed one-shot so no connector gesture doubles as a selection; **(d)** the gesture is pointerId-filtered with second-press teardown (multi-touch can't leak document listeners or ghost-commit), and its Escape cancel runs capture-first + consumes the key so it never also dismisses an open overlay; **(e)** beside-the-bar label clusters are drop targets too (`data-timeline-drop` on both; `data-timeline-bar` stays unique per task for e2e); **(f)** within-view dependency **removal** stays in the detail panel at v1, per spec. → [specs/tasks-timeline.md](../../specs/tasks-timeline.md)

- **2026-07-03 · Tasks TL-2 timeline drag interactions landed.** Bar move/edge-resize on a custom pointer engine, tray→axis on dnd-kit; every write rides the optimistic `patchTask`. Block decisions: **(a)** **drag deltas are DAY-anchored, never pixel-anchored** — the grabbed local day is recorded at pointerdown and the delta is `differenceInCalendarDays(pointerDay, grabDay)`, so a mid-drag axis-window origin shift (midnight tick, a collaborator extending the extent) can't displace the commit; it also clamps the delta to the window (no invisible off-canvas overshoot commits). **(b)** **The drop day is resolved from raw pointer coordinates against a rect measured AT DROP TIME**, with dnd-kit `autoScroll` disabled — a tracker that only computes on pointermove goes stale whenever the canvas moves under a stationary pointer (see the extended gotcha); a flick-drop with no tracked move falls back to activator+delta (pure travel with autoScroll off). **(c)** **`TaskDropTarget` ships `{type:"timeline-axis"}` (day-less), amending the spec's `timeline-day` sketch** — one droppable beats ~500 measured per-day rects; the day is derived, not carried (spec §Assumptions updated in place). **(d)** **`setBarEdge` never stores even a sub-day inversion** — the day-level clamp re-applied a clock time that could put `scheduledAt` after a same-day midnight `dueDate`; edges now clamp to the other edge's instant. **(e)** **A faded edge is grabbed at the solid span's open-side edge** — the interactive element is the solid span only (the fade extension is `pointer-events-none` paint, closing the invisible-hit-surface hole), so "drag the faded edge to set the missing date" = drag the solid span's edge on that side. **(f)** **Keyboard "drags" are disabled on pointer-resolved drop surfaces** (`useTaskDndSensors({keyboard:false})`) — a lift that can never commit is worse than none; the detail panel's Schedule/Due fields are the accessible path. **(g)** Optimistic **`tmp-` id tray chips are undraggable** until the create round-trip mints the real id (`patchTask`'s raw-upsert branch would send `tmp-…` to a uuid column — the same latent race exists for Board drags of just-captured cards, recorded as a known infra gap). **(h)** Cancelled drags are true no-ops on both engines: bar click-suppression arms only on the commit path (a stale flag ate the next click), and tray chips swallow the browser's click-after-drag so an aborted drop doesn't select. → [specs/tasks-timeline.md](../../specs/tasks-timeline.md)

- **2026-07-03 · Tasks TL-1 static timeline landed.** The third Plan view (List | Board | **Timeline**), riding existing data — no migration, no library. Block decisions: **(a)** **half-open bars never carry in-bar content** — whenever an edge fades (`mask-image` over the FADE_PX extension), the whole content cluster (checkbox + title + lock + drift dot) renders *beside* the bar past the fade; content sits inside only when both edges are solid and the bar is ≥110px. The mask can therefore never hide the check-off (validator catch). **(b)** **Bars are mouse-selection surfaces (Board parity)** — no `role="button"`/tabIndex on the bar container: a keyboard-focusable container was hijacking Enter/Space from the nested native CompleteToggle and doubling tab stops; the checkbox is the row's native keyboard stop and List stays the keyboard-first view. Timeline-specific keyboard nav is a deferred refinement. **(c)** **Lane rows sort by day, never pixel x** — a due-only bar's −80px fade offset is presentation; sorting on x reordered rows per zoom. **(d)** **The axis window clamps its dated extent per zoom** (±120/400/800 days around today) so one typo'd year (2126) can't render a century of ticks; bars past the cap fall off-axis until fixed. **(e)** **The viewport anchors to the date, not the pixel** — when `win.start` shifts at constant zoom (scope change, midnight rollover) scrollLeft is adjusted by the day delta; zoom/load recenter absolutely (the anchor effect is declared first so recenter wins). **(f)** The minute today-line tick memoizes geometry on the local **day** — the tick moves two style offsets, never recomputes the rollup. **(g)** Tray membership = undated + open + **not a nested subtask** (parent in scope covers it — List/Board parity); dated subtasks get their own bars per spec. **(h)** Zoom persists per workspace via the existing `lsKey` pattern (`timelineZoom`, Month default); lane collapse + tray state stay transient per mount. → [specs/tasks-timeline.md](../../specs/tasks-timeline.md)

- **2026-07-02 · Tasks Timeline view specced (light plan) — the "Gantt deferred" is un-deferred.** Third Plan-mode view on existing data (no migration, no library — custom bars + SVG arrows on dnd-kit/date-fns). Locked product grammar: **solid bar edge = known date, faded edge = unknown** (scheduled-only fades right, due-only fades left — no milestone diamonds); bucket swimlanes; bottom unscheduled tray (drop sets `scheduledAt` only, 09:00 local); drift stays the ambient dot, never red; light dependency-creation (connector-dot drag) ships in v1 as TL-3's cuttable half. → [specs/tasks-timeline.md](../../specs/tasks-timeline.md)

- **Subtasks are full tasks** (`parent_id`), exactly one level deep (a subtask is never a parent); hidden from top-level lists by default, individually committable, never invisible (render top-level if the parent is out of scope); deleting a parent promotes its subtasks. → [moduo-architecture-vocabulary.md](../moduo-architecture-vocabulary.md) · feature-spec §5b

- **Recurrence = one task row that cycles** (never a template spawning instances). → [moduo-architecture-vocabulary.md](../moduo-architecture-vocabulary.md) · feature-spec §5d
