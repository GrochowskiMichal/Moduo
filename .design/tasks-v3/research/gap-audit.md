# Gap audit: what the re-plan doesn't answer yet

> Raw research report from the Tasks re-plan (round 2a, 2026-10-10), written for the J-gaps calls in [../REPLAN.md](../REPLAN.md). Nothing here is decided.
>
> **Read against:** `REPLAN.md` as of 2026-10-10 06:02 (1,730 lines, round 2a), calls 1–12 in [RESEARCH-2026-10.md](../../tasks-dogfood/RESEARCH-2026-10.md), every report in this folder, `specs/tasks-v2.md`, `REVIEW.md` T1–T28, `docs/PRODUCT_BRIEF.md`, `docs/moduo-module-contract.md`, plus spot checks in code and the Calendar, Universal Inbox and permissions specs. Line numbers point at those versions.
>
> **Method:**
> - each role's Monday to Friday, plus the end of a month or term;
> - every view against every state (empty, first run, loading, error, offline, read-only, 10k tasks, late, deleted, archived);
> - the module contract's obligations;
> - the cross-cutting list.
>
> **Filter:** an item is here only if it's **not addressed**, **contradictory** (two decisions or docs disagree) or **too thin** (a builder would have to stop and ask a product question).
>
> **Left out on purpose:** the Focus redesign (61–66), the Timeline (67–71), the right panel (72), statuses per project (53a) and folded columns (53b), because this round already covers them. Where they leave older text contradicting itself, that's listed under *Contradictions*.

**Severity:**

| Label | Meaning |
| --- | --- |
| **blocks** | A role can't run a normal week without the old tool |
| **degrades** | They switch, but it hurts |
| **polish** | Noticeable, not costly |

---

## Ranked gaps

### 1 · Reminders don't reach you when Moduo isn't open

**Type:** not addressed · **Severity: blocks** (students)

**What's missing.** ❓24 decides "one precise notification" but not where it arrives. Today:
- The desktop app notifies only while it's running.
- The web gets an in-app toast and never asks the browser for permission.
- There's no push, no email and no phone app (❓36).
- The bell shows only the workspace you're in.
- Due dates and work sessions never reach the phone's calendar, because Calendar write-back is v2.

So a 4 pm reminder is lost if the laptop is shut or the tab is closed.

**Who it hurts:**
- Students: a time-of-day reminder is on their must-have list, and they live on their phones.
- Ops and admin generalists, and anyone who closes the laptop.

**Evidence:**
- REPLAN.md:807–812 (❓24), :1061–1065 (❓36), :50 (§0: reminders become a shared contract);
- specs/tasks-v2.md:605–607 (desktop plugin; "Web: in-app toast only");
- specs/universal-inbox.md:31, :70 (current workspace only);
- specs/calendar.md:7 (write-back is v2);
- role-journeys.md:19, :113 (G6), :126 (G19).

**Recommended answer:**
- The reminders contract names its channels:
  - an OS notification from the desktop app even with the window closed (it stays in the menu bar);
  - opt-in web push;
  - a private calendar feed of your dated tasks and sessions, with alerts, so any phone calendar shows them.
- Reminders fire whichever workspace is open.

### 2 · "Import through your AI" can't do what ❓35 promises

**Type:** contradictory + too thin · **Severity: blocks** (everyone switching)

**What's missing.** ❓35 makes "bring Todoist / Linear / Trello through your AI" the *first* way in, and the student's best moment is "syllabus → every deadline in the right course". But the decided MCP write slice (call 7) only captures into the **Inbox** (up to 25 tasks, optional parent). An agent can't:
- create projects, sections or areas;
- file a task into a project or section;
- set a repeat;
- keep the old ID that ❓35 says "stays findable".

And:
- a second run duplicates everything;
- undoing an agent's session is P4, two phases after agents get write access in P1.

**Who it hurts:**
- every switcher;
- students (a syllabus becomes 40 Inbox items);
- Trello PMs (lists → sections);
- Linear developers (`ENG-123` lookups).

**Evidence:**
- RESEARCH-2026-10.md:509 (lands in Inbox);
- REPLAN.md:1053–1059 (❓35), :177 (student row), :453 (P1 MCP writes), :503 (P4 undo);
- role-journeys.md:25 (the syllabus moment), :187 (a source reference for idempotent re-runs);
- structure.md:156 (decision 17 proposed project and section tools; the plan didn't carry them over).

**Recommended answer:**
- The MCP write slice covers projects, sections and areas.
- Capture can go straight into a project or section with dates, repeat and tags.
- Every imported task keeps an "imported from" reference (source and old key) that ⌘K resolves.
- Re-runs update instead of duplicating.
- "Undo this import" ships on day one.
- For people without an AI client, pasting a multi-line list into capture offers "Create 12 tasks?".

### 3 · Tracked time can't be invoiced

**Type:** contradictory + not addressed · **Severity: blocks** (hourly freelancers and agencies)

**What's missing.** §3 says time by client is what lets freelancers drop the old tool, and ❓8 promises a CSV for invoicing. But:
1. **You can't add time after the fact for a day** ("2 h on Acme yesterday"). Corrections only reset a task's total, there's no timesheet, and Toggl/Harvest imports would need dated entries.
2. **Nothing defines the report:** the period, whose time, per task or per day.
3. **Agencies can't see who worked how long.** Each person's share of a task's time is private (tasks-v2 §5, ❓12), so an owner can't see who worked how long for a client. Yet 27d plans a per-cycle history with names and times (see C9).

**Who it hurts:** freelancers and agencies billing by the hour, and consultants. They keep Toggl or Harvest.

**Evidence:**
- REPLAN.md:181, :848 (27d), :1546 (❓63: time is visible to teammates);
- RESEARCH-2026-10.md:551 (❓8), :608 (❓12);
- specs/tasks-v2.md:137–142;
- current-state.md:362 ("no timesheet, report or back-dated entry");
- role-journeys.md:69, :71.

**Recommended answer:**
- "Add time…" with a date and an optional note, plus a list of your own entries that you can edit.
- A time report by client or project × period × task, exportable as CSV.
- Your own time is always yours to export.
- Teammates' time appears only if they turn on "Share my tracked time with the workspace owner" (off by default), which keeps ❓12's no-surveillance rule.

### 4 · Nobody's clock is defined: time zone, week start, 12- or 24-hour

**Type:** too thin · **Severity: degrades** (urgent: P0 #15 builds ❓41's format first)

**What's missing.**
- **Time zones.** §6.4 makes due dates plain dates with an optional due time, but doesn't say whose time zone governs:
  - a due time;
  - a "1 hour before" reminder;
  - the server's roll-over of "every weekday at 9" (27h);
  - the moment a task turns late.

  This matters when teammates sit in different zones or someone travels. No per-person time zone exists anywhere; only booking links have one.
- **Week start.** It drives "This week" in Upcoming, "Due this week", team load, Weekdays repeats and "Next week" presets. Calendar has its own week-start setting; DateField hard-codes Monday.
- **The clock.** ❓41's grammar shows "3:00 PM". Email, the Clock widget and booking force 24-hour, while Tasks follows the browser.

**Who it hurts:**
- a founder pair or agency split across time zones;
- travellers;
- most European and Asian users.

**Evidence:**
- REPLAN.md:393 (§6.4), :808, :852, :1141 (❓41), :447 (P0 #15);
- src/features/calendar/prefs.ts:129, :143;
- src/components/ui/date-field.tsx:87;
- src/features/email/utils/email-format.ts:24;
- src/features/dashboard/ui/widgets/clock-widget.tsx:37;
- src/features/calendar/booking/slots.ts:93;
- src/features/tasks/helpers.ts:269.

**Recommended answer:**
- One personal "Time & region" setting, used by every module:
  - time zone, from the device;
  - week start;
  - 12- or 24-hour.
- A due date is the same date for everyone.
- Due times and reminders are moments, shown in each viewer's local time.
- Repeats roll over in the assignee's time zone (else the creator's).
- ❓41's examples read "per your settings".

### 5 · No notification rulebook for v3's new events

**Type:** contradictory + too thin · **Severity: degrades** (teams)

**What's missing.** §3 says notification rules never change, yet v3 adds new kinds:
- reminders that skip the digest;
- check-backs;
- agent states;
- team mentions;
- assignment into someone's Inbox;
- resurfacing follow-ups.

No table says who gets what, where, grouped or alone, with which mute toggle. Open questions:
- Does a reminder on a shared task go to whoever set it, or to the assignee?
- Does a passed due date ever notify? The Universal Inbox says overdue work isn't a notification.
- Does "Anna replied, no longer waiting" notify?
- Do a team's members hear about a new unclaimed team task?
- A template start, bulk assign, import or agent run that assigns 20 tasks: 20 cards or one?

**Who it hurts:** founders, PMs and agencies. The brief names notification overload as a top reason people leave.

**Evidence:**
- REPLAN.md:201, :809, :1253, :1357, :666 (❓20 point 3);
- specs/universal-inbox.md:10;
- specs/tasks-v2.md:39–44 (today's quiet core set);
- PRODUCT_BRIEF.md:94, :142.

**Recommended answer:**
- One table in the spec: event → who → where (bell, OS, email) → precise or grouped → mute toggle.
- One action that touches many tasks sends one grouped notification: "Maciej assigned you 12 tasks in Acme".
- Reminders and check-backs reach you in any workspace.

### 6 · No record of what got done, or when

**Type:** not addressed · **Severity: degrades**

**What's missing.** A task doesn't store when, or by whom, it was completed; the "7 days" view uses the last edit. The plan never adds it, yet several decided features need it:
- per-cycle history (27d);
- "Done this week" (N2);
- the client hub's "everything done for Anna, with hours";
- the MCP weekly review ("drift, done, stale");
- stand-ups.

Filters have no "Completed: last week". Anyone without an AI client has no weekly look-back at all, since the in-app planning moment (T27) is parked.

**Who it hurts:**
- PMs and founders (Friday status);
- freelancers (the month-end client report);
- developers (what shipped);
- students (end of term).

**Evidence:**
- current-state.md:354;
- specs/tasks-v2.md:161, :171–184 (filter dimensions), :674 (T27 parked);
- REPLAN.md:848;
- RESEARCH-2026-10.md:524, :623–625;
- role-journeys.md:73;
- early-decisions-audit.md:53.

**Recommended answer:**
- Every completion records when and by whom, including each cycle of a repeating task.
- Filter and Group by "Completed": today · this week · last week · this month · a range.
- The project overview and client hub show "Done this month · 14 · 22h".
- PM and founder roles get a seeded "Done last week" view.

### 7 · When people and projects go away

**Type:** not addressed + contradictory · **Severity: degrades** (month and term ends)

**What's missing.**

*A member leaves.* Only "their tasks become Unassigned" is decided. v3 adds private places that would be orphaned:
- their Inbox, including tasks a founder handed them with 20a's "Keep unfiled";
- their private projects;
- the projects they lead;
- their team memberships;
- their templates and views.

*A project ends.*
- On hold and Done never hide tasks (❓16).
- Archive hides the project and its tasks from My tasks, search and queues (tasks-v2 §11). Nothing says:
  - what happens to its open, repeating or reminded tasks;
  - whether search still finds last term's work.
- Deleting a project sends its tasks into each assignee's private Inbox, without telling them (❓20). tasks-v2 offers "Delete the tasks too" with one Undo, and neither says what happens to done tasks or to a Restore.

**Who it hurts:**
- agencies when a contractor's month ends;
- students at the end of term;
- freelancers when an engagement ends;
- creators between seasons.

**Evidence:**
- specs/tasks-v2.md:303–313, :328, :472;
- REPLAN.md:620–628 (❓16), :672 (❓20), :695 (20a).

**Recommended answer:**
- **Removing a member** shows what they leave behind:
  - Inbox tasks someone else created go back to their creators;
  - the rest go to the person removing them;
  - Lead is cleared;
  - private projects are handed on by their owner beforehand, or go to Recently deleted.
- **Marking a project Done, or archiving it, with open tasks** asks once: "4 open tasks — Won't do · Move · Keep".
- **Archived projects** never remind or repeat, and search finds them, labelled.
- **Deleting a project** moves only its open tasks, with one quiet notice to each assignee.

### 8 · Repeat projects are promised but deferred, and template scope is open

**Type:** contradictory + too thin · **Severity: degrades**

**What's missing.**
- §3 counts templates among what replaces Trello and Jira for PMs and seeds a "Project kickoff" starter, and role-journeys lists "templates for repeat projects" as a PM must-have. But ❓9 defers project templates until checklist templates prove themselves.
- 53a says "a template carries its statuses", which only a *project* template could (C3).
- Nobody has decided who can see, use, rename or delete a template, personal or workspace. Round 1 proposed workspace-shared; ❓9 is silent.
- Sales sequences built from templates (❓50) don't stop when the lead replies.

**Who it hurts:**
- PMs and agencies (repeat engagements);
- creators (season 2);
- students (next term);
- founder-led sales.

**Evidence:**
- REPLAN.md:179, :199, :733–735, :1196, :1325;
- role-journeys.md:43;
- RESEARCH-2026-10.md:566.

**Recommended answer:**
- Ship **"Duplicate project…"** with the minimal templates as the repeat-project answer. It copies sections, statuses and open tasks, shifts dates from a new start date, copies nothing done, commented or tracked, and needs no editor.
- Templates are workspace-wide: anyone with edit access uses them; the author renames or deletes them.
- When a linked contact replies, offer once: "Mark the 2 remaining follow-ups Won't do?"

### 9 · No undo rulebook

**Type:** too thin · **Severity: degrades**

**What's missing.** Undo exists piecemeal: delete, bulk actions, ending Focus, Arrange by project. Drag has none. Nothing says which v3 actions get Undo, for how long, or what happens if a teammate changed the task in between. Candidates:
- Won't do, Backlog and status changes;
- moving a task with its subtasks;
- deleting a section or area;
- starting a template;
- assigning a task into someone's Inbox;
- a project's fan-out on delete;
- an agent's edits (P4).

**Who it hurts:** everyone, most of all keyboard users and multi-select.

**Evidence:**
- current-state.md:321;
- current-state-board-timeline-dnd.md:161;
- specs/tasks-v2.md:222, :312;
- REPLAN.md:503, :1521, :1528.

**Recommended answer:**
- Every change made from a list, board, timeline, key or the bulk bar shows Undo for 8 s, and ⌘Z works while it shows.
- Creating many tasks at once (template, import, paste) undoes as one.
- Undo never overwrites a teammate's later change to the same field; it says so instead.

### 10 · Inbox triage and the key map have no owner

**Type:** too thin · **Severity: degrades** (developers, founders)

**What's missing.**
- **Triage is one line in P3:** "Inbox triage keys (accept · decline · duplicate · snooze)".
  - In a *personal* Inbox, accept and decline only mean something for items others or agents put there.
  - Decline could mean Won't do, or handing the task back to whoever sent it.
  - Snooze needs a "hidden until" date that nothing else in the plan has; a start date is still open.
  - Duplicate needs a merge rule.
- **The letters collide:**
  - List keys already use `a` (assign), `d` (due) and `s` (scheduled);
  - `1`–`3` already pick up in-flight cards;
  - Linear users press `x` to select, and in Moduo `x` completes.
- **v3's new concepts have no keys:** section, waiting, reminder, Won't do, Backlog, team.

**Who it hurts:** developers switching from Linear, and founders triaging email → task.

**Evidence:**
- REPLAN.md:178, :483, :1632 (❓72: every view has a shortcut);
- role-journeys.md:33, :199;
- specs/tasks-v2.md:124, :224–248;
- early-decisions-audit.md:45.

**Recommended answer:**
- **Accept** = file into a project and assign to me.
- **Decline** = hand it back to its creator with a note (Won't do if you created it).
- **Duplicate of…** = move its comments and links to the other task, then Won't do.
- **Snooze** = hide from the Inbox until a date, then return to the top.
- Inbox-only keys `1` `2` `3` `H`, as in Linear, plus one key map table in the spec covering every v3 concept.

### 11 · Several workspaces aren't considered

**Type:** not addressed · **Severity: degrades**

**What's missing.** People can belong to several workspaces; there's a switcher. But Focus, Upcoming, My tasks and the bell all work per workspace, and the plan never mentions a second one. Open questions:
- Does a reminder from your personal workspace reach you while you work in an agency's?
- Can a task move between workspaces, and what happens to its MOD-142?
- Is "one workspace with private projects" (❓20) the intended setup?

**Who it hurts:**
- contractors working in a client's or agency's workspace;
- students in a classmate's workspace for a group project;
- founders with a personal and a company workspace.

**Evidence:**
- src/components/workspace-switcher.tsx;
- specs/universal-inbox.md:31;
- specs/tasks-v2.md:572 (the queue belongs to one workspace), :601 (one run per person);
- REPLAN.md:669.

**Recommended answer:**
- Onboarding says plainly that one workspace with private projects is the intended setup.
- Reminders, check-backs and the running Focus chip reach you in any workspace; views stay per workspace.
- "Move to workspace…" either copies the task with a new handle and leaves a link, or is stated as not offered.

### 12 · Work sessions don't count as busy for booking links

**Type:** not addressed · **Severity: degrades**

**What's missing.** Booking links read Moduo events, existing bookings and Google free/busy. Scheduled task sessions are drawn from the task itself and stored nowhere else, so they're never read: a client can book a call on top of a two-hour work block. ❓25 adds several sessions per task. Nothing says whether they show as busy to booking links, or to teammates (permissions already shares free/busy).

**Who it hurts:** freelancers, consultants and founder-led sales, who combine time-blocking (the brief's flagship loop) with booking links.

**Evidence:**
- supabase/functions/booking-public/index.ts:246–300;
- src/features/calendar/lens.ts:1–4;
- REPLAN.md:814–820;
- specs/permissions.md:115;
- PRODUCT_BRIEF.md:78, :126.

**Recommended answer:**
- Scheduled sessions count as busy for your booking links by default, with a switch per link.
- Teammates see them as "Busy", never the title.

### 13 · Bulk actions don't reach v3's concepts

**Type:** not addressed · **Severity: degrades**

**What's missing.** The bulk bar (TV-U5) offers Move · Assign · Tags · Priority · Focus · Complete · Delete. It can't change:
- dates ("push these 6 to next week", the most common weekly clean-up);
- status (Won't do, Backlog);
- section;
- waiting;
- team.

So moving a sprint's leftovers into the next dated section happens one task at a time.

**Who it hurts:** students (the Sunday re-plan), PMs and developers (sprint rollover), freelancers.

**Evidence:**
- specs/tasks-v2.md:222;
- REPLAN.md:647–652 (a sprint is a dated section), :1281–1311 (Backlog);
- current-state.md:309–311 (only drift triage moves dates in bulk).

**Recommended answer:** the bulk bar gains Date (+1 day · Next week · Pick…), Status, Section, Waiting on and Team, all under one Undo.

### 14 · No way to get a list out

**Type:** not addressed · **Severity: polish** (degrades for client reporting)

**What's missing.**
- The brief promises lossless export. Today that's the raw data export in Settings, and the plan doesn't say it grows to cover projects, sections, areas, statuses, templates, time entries and handles.
- There's no way to copy a list or a project overview as text, print a week, or save the current view as CSV. Who needs it:
  - the PM's Friday "paste the overview into the client email";
  - the freelancer's client report;
  - a student's printed week;
  - the brief's promise that you can leave at any time.

**Who it hurts:** PMs and freelancers (client reporting), students, and trust ("your data is yours").

**Evidence:**
- PRODUCT_BRIEF.md:66;
- docs/ROADMAP.md:30;
- role-journeys.md:45, :204 (#20);
- current-state.md:499.

**Recommended answer:**
- "Copy as text" on any selection, view or project overview, pasting cleanly into email or Slack.
- "Export view as CSV", and a print layout.
- The full export covers every new object and can be re-imported.

### 15 · Capture has no offline rule

**Type:** too thin · **Severity: degrades**

**What's missing.** §6.11 builds a copy on the device and calls it a first step towards offline, later. Nothing says what works when the network drops:
- Does ⌘⇧K keep the capture and send it later, or fail?
- §6.11 says a failed write "rolls back that one field". For a brand-new task, that means the capture is gone.

**Who it hurts:** desktop users on trains and planes, and the promise that capture always works (the brief, ADHD lens).

**Evidence:**
- REPLAN.md:408–418;
- specs/tasks-v2.md:319, :347;
- PRODUCT_BRIEF.md:96;
- docs/ROADMAP.md:36.

**Recommended answer:**
- Until full offline, everything opens read-only from the device copy.
- Captures and check-offs are kept on the device and sent when you're back ("2 waiting to sync").
- Other edits say "Offline".

---

## Contradictions

Between decided calls, or between a decided call and older text in the plan:

| # | What disagrees | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| C1 | **Statuses per project (53a, open) vs four places that say statuses never change.** 53's decided text already assumes 53a ("any project can rename it"). If 53a passes, §3's "Stage board by section" and ❓18's "Board by section is the stage board" are stale, because stages become statuses. | REPLAN.md:153, :201, :203, :786 (22a), :1311; :182, :639 | Decide 53a before the spec, then rewrite all of them in one pass |
| C2 | Backlog has to wait for a desktop release (§6.12) vs Backlog no longer waits (53a) | REPLAN.md:419 vs :1331 | Keep whichever matches the 53a answer; delete the other |
| C3 | "A template carries its statuses" (53a) vs project templates deferred (❓9); a task template has no project statuses to carry | REPLAN.md:1325 vs :735 | Becomes true only with "Duplicate project" or project templates (gap 8) |
| C4 | Agent work shows as a visible **"Waiting on Claude"** with a session state (❓6) vs agent sessions are private and teammates just see "In progress" (❓52). Team load and the Waiting filter would show or hide agent waits depending on which wins | RESEARCH-2026-10.md:483 vs REPLAN.md:1258 | The session stays private; the Waiting field is set only when "Show my agent work to teammates" is on |
| C5 | The project overview is a right-panel view (❓8, §2) vs ❓72's list of Tasks' panel views (Details, In flight, Unscheduled, Backlog), which leaves it out | REPLAN.md:152 vs :1636–1638 | Add "Project overview" to ❓72's *about this* group |
| C6 | Deleting a project fans its tasks out into private Inboxes (❓20) vs 20a's own reason ("an unfiled task that belongs to someone else belongs to nobody") and tasks-v2's "Delete the tasks too · one Undo" dialog | REPLAN.md:672 vs :693; specs/tasks-v2.md:472 | Gap 7's rule: open tasks move with a notice; the rest go with the project |
| C7 | `@person` in a title assigns (❓33) vs assigning from your Inbox always asks for a project (20a). A ⌘⇧K line "Call accountant @Mike" has no picker step | REPLAN.md:964 vs :693 | In capture, `@person` without `@project` means "Keep unfiled", and the empty project slot is shown so it can be filled before Enter |
| C8 | Seeded saved views per role (§3 table) vs "saved views are seeded once, for whoever creates the workspace" (❓34), while the role question is asked of every person | REPLAN.md:198 vs :1021–1022 | Seed views per person from their role answer; seed example tasks once per workspace |
| C9 | Individual time is private (tasks-v2 §5, ❓12) vs the per-cycle history "with who did it and the time tracked each cycle" (27d) and time-by-client for agencies (❓8) | specs/tasks-v2.md:140; RESEARCH-2026-10.md:608 vs REPLAN.md:848; RESEARCH-2026-10.md:551 | Per-cycle time shows only to the person who tracked it; others see who and when (gap 3 for reports) |
| C10 | A Backlog task is left out of My tasks, late and reminders (53) vs assigning: the assignee is notified "assigned to you" but can't find the task in My tasks, and a due date on a backlog task never surfaces anywhere | REPLAN.md:1293 | Assigning a backlog task, or giving it a due date, offers "Move to To do?"; My tasks keeps a folded "Backlog · n" line |
| C11 | "Notification rules never change" (§3) vs the new notification kinds in ❓24, ❓52, ❓54 and ❓20 point 3 | REPLAN.md:201 | Strike it from "never changes"; gap 5's table replaces it |
| C12 | Stale backlog lines: P3 still lists project tabs (29d was answered **no**), cues (58 is **parked**) and "the Suggestions setting" (replaced by 59a's one switch); P4's agent-session undo comes after P1's agent writes (gap 2) | REPLAN.md:485, :494, :495, :503 vs :922, :1443, :1458 | Fix in the next edit of §7 |
| C13 | The module contract still says creation needs no activity row and plain field edits may stay raw writes, vs §6.1 (every create and edit is a logged server op). §9's spec step amends tasks-v2, attachments and design-state-layer, but not the contract | docs/moduo-module-contract.md:59–61, :128 vs REPLAN.md:387–390, :1657 | Add the contract to §9's list of documents to amend |

---

## Checked and covered

What was examined and found answered well enough for now. Pointers say where.

**Finding and scale**
- Search finds every task and follows renames (P0 #1, §6.1).
- Search inside Tasks (tasks-v2 §7).
- Server-side search and 10,000 tasks (❓37, §6.11).
- Loading, empty and error states (P0 #5; EmptyState in the kit).

**Recovering and organising**
- Recently deleted for 30 days, and archiving a project (TV-U6, #328). The edge cases are in gap 7.
- Multi-select and the bulk bar (TV-U5). v3's concepts are in gap 13.
- Moving tasks between projects, subtasks following (P0 #8).
- Duplicating a task (exists).

**Statuses, dates and links**
- Late and drift (❓23).
- References to deleted or hidden items: "Deleted task", "Private item" (❓55).
- Dependencies across projects (§6.5, ❓55).
- Repeating tasks with subtasks (27e), and server roll-over (§6.2, 27h). Whose time zone it rolls in is gap 4.

**People and access**
- Who sees a project (today's Share menu, ❓20); team access is later (❓54).
- Guests and clients: no guest logins (❓47); the client status link is parked (❓11).
- Comments get edit and delete; descriptions can mention people (§4, ❓33). Reactions aren't planned; that's polish.
- Attachments (AT-2/3, #327).

**Integrations**
- Handles (calls 3–4), "Copy branch name" (P3), PR status (P4).
- Email → task is desktop-only by design (role-journeys G17).
- Due dates on the calendar and a Month view (❓26); several sessions per task (❓25). Calendar write-back is Calendar's v2.

**Module contract**
- Dashboard widgets: team load, time and Upcoming (§4 Home target, ❓12).
- Activity trail and agent attribution (§6.1, ❓51/52).
- Search registration (§6.1).
- MCP for the new structure is gap 2.

**Moving existing users over**
- Buckets become projects 1:1, rail sections become areas (❓14, ❓15); "Open at" is retired (❓30).
- Existing users can reopen the welcome from the ⋯ menu (❓34).
- Small note: tasks people archived only to hide them will read "Won't do".

**Already settled elsewhere**
- Weekly review: the MCP prompt (call 7), and T27 is parked. The missing piece is the completion record (gap 6).
- Accessibility: screen readers in the List (§4 target), hit targets (§5.1 #10), Timeline keys (being handled).
- Mobile stays out (❓36). Reminders reaching the phone are gap 1.
- Time tracking can be switched off (❓63).
