# Round 2b: the List, Upcoming, the smart views and the Calendar contract

> Raw research report, Tasks re-plan round 2b (2026-10-10). It starts from today's app ([current-state](./current-state.md) §1.3, §1.12, §1.18; [visual-audit](./visual-audit.md) A1, A2, E) and from every ✅ call in [REPLAN.md](../REPLAN.md) §8, which are cited by number and not re-opened. "Unverified" marks a competitor claim not found in the vendor's docs.

## 1. List row anatomy: Standard and Detailed

**Leaders.**
- [Linear](https://linear.app/docs/display-options) puts the ID before the title and right-aligns properties. It has no hover buttons: keys and right-click do the work.
- Todoist shows a hover cluster (edit, date, comment, ⋯).
- Asana has a sortable column header.

**Pattern:** one leading control, a flexible title, fixed right columns, and a header row only in the dense mode.

**Moduo.** Height is Density only (36 / 32 / 28 px, ❓2); presets change content, not height.

| Slot, left → right | Standard | Detailed | Width |
| --- | --- | --- | --- |
| Status glyph (the checkbox) | Category icon (53a) | Same | 16 px glyph, 24 px hit |
| Handle | Off (❓4) | `MOD-142`, tertiary; click copies | 56–72 px |
| Title | 15 px, one line, gives way first (42) | Same | Min 160 px / 200 px |
| Counts | tags · files · comments · n/m · blocked · waiting · repeat; "Claude · working" when visible to you (❓52) | Plus ≤2 tag names, then "+n" | Hug |
| Project | Only when not implied | "Project › Section", always | 140 px |
| Status name | Tooltip | "In review" (the icon can't tell it from In progress) | 96 px |
| Priority | Glyph; the column collapses when empty | Same | 14 px |
| Date | TV-U1's date: next session or due, whichever is first by day | Due and Next session as two columns | The widest value in view, 56–132 px, so "Tomorrow 3:00 PM" never truncates (41) |
| Estimate / time | — | "1h 20m / ~4h" | 88 px |
| Waiting on | Mark in counts | "on Anna · 2d" | 110 px |
| Assignee | 20 px avatar, two initials (43) | Avatar + first name | 20 / 96 px |
| Updated | — | "2d" | 48 px |
| Focus mark | On hover; always once added | Always | 16 px |

**Narrowing** (about 460 px of centre at 1024 px with both panels open):
1. The title shrinks to its minimum.
2. Detailed columns drop whole, in order: Updated → Estimate → Next session → Waiting → Status name → Project › Section → assignee name → Handle. A "+3" header cell opens Display.
3. Standard counts drop behind "+n".
4. The glyph, title, Due, avatar and Focus mark never drop.

**The status glyph:**
- **Click:** Done from any open category, half-filled included. On a Done or Won't do glyph, click reopens the task to its previous status.
- **Right-click or ⇧S:** the status menu, with the project's names by category, or only categories when the selection spans projects.
- **Keys:** ⇧S goes into the one key map (default b). Space and `x` still complete.

**Detailed header row:** 28 px and sticky.

**States** (❓39):
- **Hover:** `state-hover` fill.
- **Selected:** `SELECTED_ROW`. Selected + hover is one step brighter, which fixes today's lost hover.
- **Cursor:** the /50 ring.
- **Done:** strike-through plus the state fade, except on the glyph (38).
- **Drag:** `DRAG_SOURCE` and `DROP_TARGET`.

**Hover reveals, in reserved slots that fade** (R6):
1. the Focus mark ("Add to Focus · Q");
2. a calendar glyph in an empty date cell;
3. on late rows only, the counts swap to **Move · Won't do · Break down** (❓23), on hover or when selected.

**Never on hover:** ⋯, Delete, a drag grip, ▶, or assign and comment icons. Right-click, keys and the panel cover them.

## 2. Grouping and headers

**Leaders.**
- [Linear](https://linear.app/docs/display-options) has a dozen groupings, sticky sub-group headers, and "Show empty groups".
- Todoist ends every section with "Add task".

**Pattern:** sticky headers, collapse on click, add where you look.

**Moduo.**
- **Group by:** Section (a project's default once it has sections) · Status · Project · Area · Assignee · Team · Priority · Date · Completed (77) · None.
  - **Date** groups: Earlier · Today · Tomorrow · five day names · Later · No date. No date is left out only in Upcoming.
  - v2's Time, Due and Scheduled merge into **Date**, which is the row's date.
  - **Tag is out:** a three-tag task would appear three times; it stays a filter. **Energy is out** too, and stays a filter.
- **GroupHeader** (28 px, sticky):
  - The name as typed (40), then the open count in tertiary text.
  - Sections show "2 of 5" in place of the count, plus "ends Oct 24".
  - Each kind leads with its mark (glyph, avatar, priority, project dot).
  - **+** and **⋯** fade in on hover. A click toggles the group.
- **Sticky depth:** one level; two in All (Area › Project).
- **Collapse:**
  - Remembered per person per view, and synced (29e).
  - Everything starts open, which fixes today's "only the first group opens". The exceptions are the Backlog and completed lines, and On hold or Done projects.
  - ⌥-click toggles all; ⌥↑/↓ jumps between headers.
- **Inline add:**
  - In a project grouped by section (or ungrouped), a persistent quiet "+ Add task" line (28 px) ends each section. Elsewhere it's the header's **+**.
  - It opens an in-place row with the capture grammar (❓33, 33a): Enter creates the task and opens the next row, Esc closes, ⌘Enter opens it in the panel.
  - **What's pre-filled:**
    - the group's value (section, project, status, priority, team or person);
    - in Date groups, that day as due. Later opens the picker, and Earlier has no add;
    - plus the view's filters (v2 §7).
- **Empty groups are hidden,** except a project's own sections and Upcoming's next seven days, which take drops. Display has "Show empty groups".
- **Group endings** (28 px, tertiary):
  - "3 completed · show" ends each group.
  - A project ends with "+ Add section", then a folded **"Backlog · 12"** (53b).
  - My tasks ends with one "Backlog · n" (consistency 10).
- **Subtasks:**
  - Nested and collapsed; the "1/3" count toggles them (also → / ←).
  - The indent is 24 px, with a visible hairline guide (today's measures 1.1:1).
  - A subtask that matches without its parent shows flat, with "↳ Parent".
  - Display → Subtasks: Nested · Flat.

## 3. Ordering

**Leaders.** All four lock dragging while something else decides the order:
- [Asana](https://forum.asana.com/t/cant-move-tasks-up-down-when-sorting-by-due-date/106257) drags only with Sort: None.
- In Notion, a sort locks dragging ([secondary source](https://wisechecker.com/?p=6411)).
- [Todoist](https://todoist.com/help/articles/360017135159) blocks dragging while grouped.
- [Linear's](https://linear.app/docs/display-options) manual order is shared by the workspace and can't be reversed.

**Pattern:** a sort never overwrites manual order, and dragging under a sort is blocked.

**Moduo.**
- **Order:** Manual · Date · Priority · Created · Updated · Title.
  - Manual exists only where order is stored: projects, sections and the Inbox (§6.8). All keeps each project's manual order, and you can drag inside it.
  - Upcoming, My tasks and views sort by Date, then Priority.
- **A sort never touches the stored order;** picking Manual restores it exactly.
- **Clicking a Detailed column header:** ascending → descending → back to the view's default.
- **Dragging under a sort:** v2's note, now with a button: "Sorted by date · Use manual order". Cross-group drops still work.
- **What a drop does:**

  | Drop | Result |
  | --- | --- |
  | Within a group (Manual) | Reorders |
  | Another section / status / priority / assignee / team / project | Rewrites that field (status mapped per 53a) |
  | Another day | Moves the date (§6) |
  | The Backlog line | Backlog |
  | Earlier, "N completed", groups you can't edit | Not a target |

- **Nesting** (v2's ~40 px split):
  - Only into a top-level task; a parent can't nest (❓28): "Has subtasks · can't nest".
  - Nesting across projects moves the child to the parent's project and section.
  - Dragging left of the indent detaches. Parents carry their subtasks (P0 #8).
- **Keys:**
  - ⌘↑/↓ and ⌥⌘↑/↓ (v2);
  - **`>`** nests under the row above and **`<`** detaches. Not ⌘] / ⌘[, which are Back and Forward on the web build, and not Tab, which stays focus navigation;
  - ⇧⌘M opens the move dialog.

  All with 8 s Undo (default a).

## 4. Multi-select and bulk

**Leaders.**
- [Linear](https://linear.app/docs/select-issues): X, ⇧-click, ⇧↑/↓, ⌘A, then ⌘K, right-click or a bottom toolbar.
- Figma shows shared properties as "Mixed" in its right panel.

**Moduo.**
- **Selecting:**
  - Click selects one (Details). ⌘-click toggles, ⇧-click selects a range, and ⇧↑/↓ or ⇧J/⇧K extend.
  - ⌘A selects the whole view, off-screen and collapsed rows included. Esc clears.
  - `x` stays Complete (v2), and the key sheet tells Linear users.
- **Selection survives** scrolling, collapsing and live updates: "4 selected · 1 hidden by filters".
- **The bar takes over the bottom bar's centre,** the module's tools (48b). There's no new strip, and it works with both panels hidden:

  **4 selected · Status · Assign · Date · Move · Add to Focus · Complete · More ▾** (Tags · Priority · Section · Waiting on · Team · Copy as text · Delete) **· ✕**

  - Each opens the single-task picker.
  - **Date:** +1 day · Next week · Pick… · Remove (default e).
  - **Status:** categories, or names inside one project.
  - **Section:** only within one project; otherwise disabled with "In 3 projects".
  - One Undo per action (a), and one notice per assignee (80).
- **With the right panel open,** it reads "4 tasks": PropertyRows with the shared value or "Mixed", editable.
  - *Why the split:* verbs belong under the hand, where tools live; values need room to show "Mixed", which is the details column's job (72a).
- **Selections:** single-task keys (`a p d s l q`, ⇧S, ⌘⌫) act on all; dragging moves all.

## 5. Search and filter in the List

**Leaders.**
- Linear and Notion show filters as chips under the view header.
- Todoist's query syntax is a named student pain ([role journeys](./role-journeys.md) §1.1).

**Moduo.**
- **The toolbar** keeps the decided grammar: `Upcoming 23 … Search · Filter · Display | List Board Timeline | New`.
- **Search (`/`):**
  - It expands over the title and live-filters the view by title, description and handle.
  - `#tag`, `@person` and `@project` typed in it become chips (v2 §7).
  - With no results: "No tasks match "invoice" here · Search everywhere ⌘K".
  - ⌘K stays app-wide, done and Won't do included.
- **The chips line:**
  - 32 px, under the toolbar, only while filters are active.
  - One line; overflow becomes "+2", which opens Filter.
  - At the right end: "23 of 76 · Clear", plus "Save view" or "Save changes · Revert".
  - It belongs to the centre surface and vanishes when empty, so it isn't an edge strip under 48b.
- **The chip grammar:** "Field · operator · value", e.g. "Due · before · Fri".
  - Values inside a chip are OR; chips combine as AND. There's no OR across chips, and no query language.
  - Operators: is · is not · any of · none of. Dates add today · this week · before · after · none · late.
- **Dimensions:**
  - Project · Area · Section (one project only) · Status (categories, or names inside one project)
  - Assignee · Team · Creator · Priority · Tags · Due · Session
  - Completed (77) · Waiting on · In my Focus · Blocked · Repeats · Has files · Source (Inbox)
- **Keys:** `f` and `/`.
- **"Save view…"** lands in the sidebar's Views group only (29d): personal, with a link. Inside a project, the project becomes a filter. Your filters on the built-in views are per person (v2).

## 6. Upcoming

**Leaders.**
- [Todoist](https://todoist.com/help/articles/360012582940):
  - a week picker;
  - List / Board / Calendar layouts;
  - Overdue with **Reschedule**;
  - drag between days;
  - "only … the next recurrence";
  - "Add task" on a day pre-fills that date.
- [Things](https://culturedcode.com/things/support/articles/4001304/) lists "the next seven days … separately, starting with tomorrow", then the rest, with drag between days.
- TickTick has "Next 7 Days".

**Pattern:** seven rolling days, then coarser groups; late on top with a bulk fix; next occurrence only.

**Moduo.**
- **Who's in it** (decided): your dated tasks, plus unassigned ones in projects you can see, minus Backlog (53). *Added:* unassigned tasks routed to a team you're not in are left out.
- **Groups** use the one Date grammar (Call 2):
  - **Earlier · Today · Tomorrow ·** five day names **· Later**.
  - Later gets quiet month dividers when it spans months.
  - Group by: Date uses the same groups, plus No date at the end, so "This week" retires.
- **Day headers:** "Thu · Oct 15 · 3 · ~2h 30m".
  - The estimate total shows only when there are estimates.
  - Empty days keep their 28 px header, so they take drops.
- **Placement** reuses TV-U1's rule: one row per task, at the next session or the due date, whichever comes first by day.
  - The other date shows in meta ("due Fri").
  - A passed, unfinished session sits in **Earlier** as "missed 2:00 PM"; a passed due date as "late".
- **Earlier** is muted, never red (❓23). Its header has "Move all…" (Today · Tomorrow · Next week · Pick…).
- **Within a day:**
  - The date column shows only a time ("3:00 PM · 45m").
  - Timed items come first, then by priority, then project order.
- **Repeats:** the next occurrence only (27f). Dragging one asks "This one · All future" (27g).
- **Dragging between days:**
  - a due date moves;
  - a session keeps its time and length;
  - Later opens the picker;
  - Earlier isn't a target.
- **Keys:** ⌥←/→ ±1 day and ⌥⇧←/→ ±1 week (as on the Timeline, ❓70); `d` due, `s` session, `T` Today.
- **Done:** "2 completed · show" per day. Dated subtasks show flat, with "↳ Parent".
- **No week strip.**
  - 48b rejects added strips.
  - The day headers carry each day's load.
  - Upcoming's Board layout gives day columns for drag planning, as Todoist's does.
  - The Calendar is the grid.

## 7. Inbox

**Leaders.**
- [Linear Triage](https://linear.app/docs/triage):
  - Accept `1`, Decline `2`, Duplicate `3`, Snooze `H`;
  - a snoozed item returns "at a time of your choosing, or when there's new activity".
- Todoist and Things keep a plain list.
- [Superlist](https://www.superlist.com/updates/today-view-and-inbox-enhancements) adds a menu-bar inbox.

**Moduo.**
- **The description line** (20), tertiary: "Only you see your Inbox. File a task into a project or assign it, and it moves."
- **Order:** Manual, with new captures on top (Call 4).
- **Source,** in the meta slot (a column in Detailed):
  - your own ⌘⇧K shows nothing;
  - email: ✉ + sender, with the email as a References card atop Details (❓55);
  - an agent: "via Claude Desktop", the key's name (❓52);
  - a person: avatar + "from Mike" (20a).
- **Triage** (default b). The keys work only in the Inbox, and the actions also appear as quiet buttons in the Details header:
  - **`1` Accept:** "File in… ▾", already assigned to you.
  - **`2` Decline:** someone else's task takes a one-line note and returns to them as "Declined by Maciej: …". Your own becomes Won't do.
  - **`3` Duplicate of…:** comments and links move over, then Won't do.
  - **`H` Snooze:** Tomorrow · Next week · Pick…. It returns on top on that date, or when someone comments.
  - After each, the cursor moves to the next row, with 8 s Undo. They work on selections too.
- **Snoozed** tasks fold into "Snoozed · 3" at the end.
- **Zero Inbox:** an EmptyState, "Inbox is clear · New captures from ⌘⇧K, email and your agents land here.", plus "3 snoozed · show" if any. No celebration, no streak.

## 8. My tasks and All

**Leaders.**
- [Linear's My issues](https://linear.app/docs/my-issues) uses a "focus order": urgent, blockers, active, triage, backlog, completed, with started issues first.
- [Asana](https://asana.com/resources/asana-tips-my-tasks) uses Recently assigned · Today · Upcoming · Later.

**My tasks.**
- **Who's in it:** tasks assigned to you, in every project.
- **The team block** sits on top (54): "For Design · 2 unclaimed".
  - Up to 5 rows, then "Show 3 more".
  - **Take it** assigns the task to you, keeps the team, and moves the row into its group, with Undo.
  - It collapses (remembered), and it's absent when nothing is unclaimed.
- **The default grouping is Status, in focus order** (Call 3):
  - **In progress · To do**, sorted by date, then priority;
  - waiting tasks sink to the end of their group;
  - then "Backlog · n" and "N completed".
  - Upcoming already owns dates; My tasks answers the stand-up question, "what am I on".
  - The round-1c prototype (frame 7, approved with 54) shows date groups. They stay one click away.
- **No Created or Subscribed tabs:** "Created by me" is a filter chip, which you can save as a view.

**All.**
- **Who's in it:** every open task in projects you can see; never an Inbox (20).
- **Grouping:** Area › Project, with two sticky levels, in sidebar order.
- **Project headers:** dot · name · count, plus "On hold" or "Done". Those projects are dimmed and start collapsed, never hidden (16).
- **Inside a project:** its manual order, which you can drag. There are no section headers ("Project › Section" is Detailed-only, ❓14), and a "Backlog · n" line ends each project.

## 9. States, for every view

| State | What shows |
| --- | --- |
| **First run / empty** | One EmptyState: glyph, title, line, action.<br>• **Upcoming:** "Nothing dated yet · Tasks with a due date or a work session show here, by day."<br>• **My tasks:** "Nothing assigned to you."<br>• **All:** "No projects yet" + **New project**.<br>• **An empty project:** just a focused "+ Add task" row. |
| **Loading** | The device copy opens instantly (§6.11), so this only happens at first sign-in or for lazy rows.<br>• **Nothing for 300 ms,** then 8 static skeleton rows at density height (glyph + bars at 62 / 48 / 71 / 55 %, decorative fill, no shimmer).<br>• **The empty state never shows** before the view knows it's complete (P0 #5).<br>• **Sidebar counts** stay blank.<br>• **Lazy** completed and Backlog lines read "Loading…". |
| **Offline / error** | Default g.<br>• **The bottom bar's tools slot:** "Offline · 2 waiting to sync".<br>• **Captures and check-offs still work,** with a 12 px clock on pending rows. Other edits are disabled, with "Offline" in the tooltip.<br>• **Online but failing:** one line atop the list, "Couldn't refresh · showing your device copy from 9:14 · Retry". Server text is never shown. |
| **Read-only (viewer)** | • The glyph is inert.<br>• No drag, add, bulk, Focus or New in that project, and "View only" in tertiary text after the title.<br>• Right-click: Open · Copy link · Copy as text. |
| **Very large (10k)** | Virtualized with fixed row heights, so the scrollbar is exact for the whole list (collapsed groups count as their header).<br>• **Sticky headers** name the group at the top edge.<br>• **Dragging the thumb** shows the group name.<br>• **Counts** come from the full set.<br>• **⌘A** reaches off-screen rows. Bulk over 100 confirms "Change 2,340 tasks?", with one Undo. |
| **Filtered to nothing** | "No tasks match · 214 hidden by 2 filters", with **Clear filters** and **Edit filters**. Never "Nothing here yet". |

## 10. The Calendar contract (what Tasks provides)

**Leaders.**
- [Todoist's calendar layout](https://todoist.com/help/articles/360012582940): drag a task to a time; future occurrences toggle on and off.
- [Sunsama](https://help.sunsama.com/docs/planned-and-actual-times) keeps planned and actual time separate. A timebox's length *is* the planned time.
- [Akiflow](https://akiflow.featurebase.app/en/help/articles/3677363-time-blocking-101) sends an unfinished block to Overdue.

| # | Tasks provides | Calendar draws / does |
| --- | --- | --- |
| 1 | Due-only tasks (26) | An all-day chip on the due day (glyph · title · project dot). Late chips stay put, muted. A due *time* (76) is a thin "Due · title" marker, never a block |
| 2 | Work sessions (25) | One block per session, as long as the session, **never the estimate**. A dropped task gets the remaining estimate, else 30 min, saved on the session only |
| 3 | Repeat occurrences (27f) | Faint outline ghosts within the visible range. Dragging one asks 27g's question |
| 4 | Drags from the panel's Tasks view | Onto the grid = a new session. Onto the all-day row = sets due. Moving or resizing a block changes only that session |
| 5 | ▶ on a block | Focus on this (66): one clock |
| 6 | "Took longer" | Extends the session to now. If nothing was tracked on the task during the session (Timer Off, or ▶ never pressed), it offers "Add 40m to time?". **A planned length is never recorded as worked time** (today's bug) |
| 7 | Recorded time | Time entries only (75): clock stretches and "Add time…", each with person, task, start and end |
| 8 | Missed sessions | Stay put, muted. The task surfaces in Upcoming's Earlier; nothing auto-rolls |
| 9 | Scope | Your sessions, plus due chips for tasks assigned to you and for your Inbox (Call 6). Teammates' sessions show only as Busy (d) |
| 10 | Writes | Set due and add / move / resize / remove a session, as logged ops (§6.1) with Undo. Blocks are focusable: ⌥←/→ moves a day, ⌥↑/↓ moves 15 min |

## Calls to ask the designer

1. **Bulk editing:** verbs in the bottom bar's centre (works with panels hidden), plus "4 tasks · Mixed" in the right panel when it's open. The alternatives are the bar alone (Linear) or the panel alone. *Recommend: both (§4).*
2. **One Date grammar, by day:** Earlier · Today · Tomorrow · five day names · Later (+ No date outside Upcoming), rolling, in Upcoming and in Group by: Date everywhere. "This week" retires: on a Saturday it would be one day. *Recommend: yes.*
3. **My tasks' default grouping:** Status in focus order, or date groups as in round-1c frame 7. *Recommend: Status.* Upcoming already answers "when".
4. **Inbox order:** new captures on top, as in email, with manual drag. Todoist and Things append them at the bottom. *Recommend: on top.*
5. **Minimal row hover:** only the Focus mark, an empty-date picker, and the late fixes. The late fixes show on hover or selection only, not always visible as in the structure prototype. *Recommend: yes.*
6. **Calendar scope:** your grid shows only your own due chips (assigned to you, or in your Inbox) and your sessions; unassigned team tasks stay in Upcoming. *Recommend: yes.* The calendar is your time.

**Unverified:** that Linear's group-header "+" pre-fills the group's value (seen in the product, not in its docs), and how Things shows repeats in Upcoming (not documented; see the [3.23 notes](https://macrumors.com/2026/08/19/things-3-23-brings-long-requested-overhaul-of-repeating-to-dos)).
