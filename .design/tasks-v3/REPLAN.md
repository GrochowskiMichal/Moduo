# Tasks v3 — the re-plan

> **Status: round 2b answers recorded (2026-10-10); open calls are listed in §8's round 2b table.** Earlier: **round 2a of the re-plan (2026-10-10).** Calls 1–60 are answered (✅ under each; 58 is parked and 60 dropped). Round 2a adds the follow-ups 53a, 53b and 59a, and group J in §8: Focus, the Timeline, the right panel and the gaps nobody had named. Mike's research is evaluated separately in §10.
> - The calls are numbered from 13, continuing calls 1–12 in [RESEARCH-2026-10.md](../tasks-dogfood/RESEARCH-2026-10.md); 9 and 10 keep their numbers.
> - [`specs/tasks-v2.md`](../../specs/tasks-v2.md) stays the plan of record for code until this re-plan's spec lands.
> - The running Tasks sessions are paused.
>
> **Evidence:**
> - five research lanes on `maciej` @ `95d988b0`, four of them on Fable 5.1;
> - a live walkthrough of the app on the local stack, in a seeded workspace with product, client, school and personal work and a second member;
> - the earlier research round.
>
> The raw reports are in [`research/`](./research/). Every claim below points at one of them.

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | What's wrong, and why |
| §2 | The proposed shape of Tasks |
| §3 | How one product serves every role |
| §4 | Each view, today and its target |
| §5 | The visual north star: what would spread to other modules, and the rules that stop it |
| §6 | Technical decisions I'm taking, so the designer doesn't have to |
| §7 | One prioritised backlog, replacing the four overlapping "top N" lists in the reports |
| §8 | The calls |
| §9 | What happens next |

**Collision classes on each call:**

| Class | Meaning |
| --- | --- |
| **(a)** | Folds into a block that's still open (cheap now) |
| **(b)** | A new block |
| **(c)** | Re-decides something already ratified |

**PR tags** name the in-flight pull request a call touches:

| Tag | PR | Blocks |
| --- | --- | --- |
| #328 | TV-U6 | rail: colours, archive, Recently deleted |
| #330 | TV-U2/U7/U8 | toolbar & filters, capture, saved views |
| #329 | TV-U4/U5/DS-5 | drag and drop, multi-select, design-system sweep |
| #323 | TV-F2–F5/F4 | Focus |
| #327 | AT-2/3 | attachments UI |
| #315 | TV-D5 | live updates |

**Correction to something said earlier in the session:** the Inbox is *not* shared. Since the sharing migration (`20261006210000`) each person has their own private Inbox. The real problem is different: those Inbox rows show up wherever projects are listed (see ❓20).

**Context from Maciej (2026-10-10):** every module other than Tasks will be rebuilt after Tasks (confirmed in round 2b), so Tasks sets the patterns and today's other modules are not examples to follow. So anything shared, such as References (❓55), the right panel (J) and reminders, is designed as a contract each module adopts when it's rebuilt, not around today's Notes, Chat or Email code. Reminder triggers that live in other modules (cues, ❓58) wait for that rebuild. **Mobile** (Maciej, round 2c) is deferred to its own plan once desktop is properly done, not "not wanted" (❓36).

---

## 1. Diagnosis

### 1.1 The root cause

Tasks was specified on 2026-06-06 for one person: "Target user: people with ADHD… Maciej is the dogfooding user" (feature spec §1).

Every decision that has since had to be reversed has the same shape: **a solo-planner assumption stored as a column on the task.**

| Column | The solo assumption |
| --- | --- |
| `committed_for` | One "today" for the whole workspace |
| `owner_id` | Doubled as the assignee |
| `time_spent_seconds` | One number, with no record of who tracked it |
| `task_time_blocks` | A time-of-day routine stored as workspace data |
| `reschedule_count` | A personal-discipline mirror |

Tasks v2 already paid for four of these with compatibility layers for old desktop builds. Every further change to the task table before the planned cleanup (TV-D7) adds another.

**So the re-plan decides every reversal that touches the schema now, and TV-D7 becomes one cleanup instead of three.** ([early-decisions audit](./research/early-decisions-audit.md) §0, §5)

### 1.2 What is genuinely strong (keep)

**Product:**
- One home per task, plus a catch-all Inbox.
- A bare title is a complete task; capture never asks where something goes.
- **Due** and **scheduled** are separate, and a task in your queue isn't the same as a task on your calendar.
- Drift and "blocked" are computed and quiet.
- A repeating task is one row that comes back. Missed occurrences never pile up as "7 overdue".
- Subtasks are full tasks.
- "Mirrors, not walls", and no streaks or red.
- The personal dateless Queue, claims, a single assignee, and a creator that never changes.
- Tasks appear in Calendar as a lens, not a copy.
- One tag store, attachments-only, one permission model.

**Platform:** intent ops + an attributed activity trail + MCP registration, as the module contract.

**Visual** ([visual audit](./research/visual-audit.md) §0): the state layer, the selection recipe, the control rung, PropertyRow, NavRow, MetaCount and the row anatomy all exist and mostly hold.

**The big shapes are right. The seams are what would spread.**

### 1.3 What's broken, in five kinds

**A · Structure: a project with no identity.**
- A bucket has a name and a position, and nothing else: no description, status, date, client, progress or page.
- Nothing can group tasks *inside* a bucket except the fixed statuses. So a creator's Idea → Draft → Edit → Publish, an agency's phases, a student's weeks and a dev's milestones have nowhere to go.
- Rail sections are a text label copied onto each bucket.
- "Bucket" is a word no target user uses ([structure](./research/structure.md) §3).

**B · Trust: bugs that make people stop believing the app.** The full list is in §7, P0. The worst:
- **Search can't find most tasks.** ⌘K, `@` and `/` only see a task after it has been linked, blocked or commented on, and they never see renames.
- **Repeating tasks can reopen themselves the same day** when checked off on Home or through MCP.
- **The capture parser eats words.**
  - "Send March report" → "Send report", due Mar 1.
  - "Call Mike at 5" → 05:00.
  - A date plus a repeat in one line drops the date: "tomorrow 3pm every week" → *today* 3pm.
- **Archiving a task is one-way.** Reopen can't be reached.
- **List and Board flash "Nothing here yet"** on every visit, because there's no loading state.
- **Focus time is only saved while the Tasks page is open.**
- **Notifications never say which task.**
- **Moving a parent leaves its subtasks behind.**

([current state](./research/current-state.md) §1, §5; walkthrough)

**C · Capability gaps by view.**
- No reordering inside a bucket in the List.
- No sort, no search inside Tasks, no multi-select.
- The Board groups only by status or bucket.
- Timeline lanes are buckets only, with no project bars and no keyboard.
- Focus can't pick the next task.
- Due-only tasks never reach the calendar grid.
- No reminders.
- No import of any kind, and no onboarding.

**D · Visual seams that would spread** (§5): six fading grey steps used as hierarchy, three drop-target recipes, two hover languages, native date inputs, density honoured by rows only, seven chip languages, and date and duration formats that vary between surfaces.

**E · No way in.**
- No task importer.
- No onboarding.
- A first run lands in an empty workspace on a time-of-day bucket.
- AI agents can read tasks but can't create or edit one.

---

## 2. The proposed shape

```
Yours:      Inbox (private until filed or assigned) · Queue · Upcoming · My tasks (teams)
Workspace:  All · Pinned · Views
Areas (optional grouping, e.g. Product · Clients · School · Personal)
  └─ Projects (a client project, a course, a launch, a series)
       ├─ Sections (optional: stages, phases, weeks, a sprint — can carry a date)
       │    └─ Tasks ── Subtasks (one level)
       └─ Tasks without a section
Across everything: tags · links to people, emails, notes, events · handles (MOD-142)
On a task: status · Waiting on… · due · scheduled sessions · reminder · estimate · time
```

- **One home per task.** "This task is also about X" is said with tags, saved views and typed links. Those links are what the contact hub already rolls up.
- **What a project carries:** description, status, target date, colour, area, client, sections. It computes its progress, time, files, what's waiting and recent activity. Its overview is a right-panel view (decided ❓8).
- **Statuses are per project, inside five fixed categories** (Backlog · To do · In progress · Done · Won't do, plus the Waiting field; ❓53a), so "done" still means one thing everywhere: views, Focus, MCP. **Sections are the parts of a project:** phases, weeks, sprints, milestones, topics.
- **Unchanged:** handles, the Queue and runs, claims, presets, the spine, the permission model.
  - Projects keep today's bucket sharing.
  - Sections inherit from their project.
  - Areas carry no permissions.
  - **None of it needs the risky permissions path.**

**Alternatives weighed** ([structure](./research/structure.md) §4):

| Candidate | What it is | Why not |
| --- | --- | --- |
| **B** | Areas as real containers that hold loose tasks, have permissions and milestones | L cost and a Tier-2 permission change, for ClickUp-style "is this an area or a project?" confusion |
| **C** | Tasks living on several lists (Asana/Height-style) | Permission leaks (ClickUp documents its own), duplicates, and it still leaves the project with no identity |

**Recommended: A.**

---

## 3. One product, every role

**"Complete" means you can run a normal week without opening the old tool. "Pleasant" means the first week feels like the old tool's best moments, not its setup.** ([role journeys](./research/role-journeys.md))

| Role | What makes the old tool unnecessary | Where in this plan |
| --- | --- | --- |
| **Student** (Todoist) | Course = project; Upcoming; due dates on the calendar; reminders; Todoist-level repeats; syllabus → tasks via your AI; Todoist import | ❓14–18, 24, 26, 27, 29, 35; decided ❓7 |
| **Developer** (Linear) | Handles; agents as delegates; Detailed rows; waiting/review; Inbox triage keys; sections as milestones; Linear import with old IDs findable | Decided ❓2–7; ❓18, 35; backlog P1 |
| **PM** (Jira/Trello) | Projects with status, target and lead; stage board; project bars on the Timeline; team load; templates; Trello/Jira import | ❓16–18, 22; decided ❓9, ❓12; ❓35; Round 2 |
| **Founder / ≤5 team** | Areas; claims and My tasks; email → task with waiting that clears itself; templates; team load; client loop | ❓15; decided ❓5, ❓8, ❓12; ❓9 |
| **Freelancer / agency** | Client loop with time by client; waiting on client; phase sections; templates | Decided ❓5, ❓8; ❓18; ❓9 |
| **Creator** | Pipeline board by status (Ideas · Drafting · Editing · Published); episode template; publish dates on the calendar | ❓53a, 22, 26; ❓9, ❓79 |

**Two more roles worth naming as targets:**
- **Researchers / PhD students**, the senior end of students: milestones, supervisor email → task, months of "waiting on reviewer".
- **Ops / admin generalists**, the strongest spine fit after freelancers.

Neither needs extra features.

**Founder-led sales and small-team business development** are a target too (❓50). They're served by Contacts plus Tasks follow-ups, waiting-on-reply, resurfacing follow-ups and follow-up sequences. Quota-carrying sales reps, teachers and households stay spillover.

**What changes per role is only defaults**, set by one onboarding question (❓34):

| | Student | Developer | PM | Founder / ops | Client work | Creator |
| --- | --- | --- | --- | --- | --- | --- |
| Opens on | Upcoming | Inbox | First project's Board | Inbox | Client projects | Board by status |
| Row preset | Standard | Detailed | Standard | Standard | Standard | Standard |
| Seeded saved views | Upcoming · Today | This week · Mine | Waiting · Due this week | Waiting on people | Waiting on client | Pipeline · Publish dates |
| Starter template (only if ❓9 is yes) | — | — | Project kickoff | Monthly close | Client onboarding | Episode |

**What never changes:** the data model and the statuses; routes and the sidebar; the gestures (⌘⇧K, `q`, ▶ run, `w` hand off, drag); the Queue; the detail panel; MCP. *(Notification rules were struck from this list in round 2a: ❓80.)*

**Deliberately not built**, and still complete without them (❓47): custom status workflows, story points, sprint objects and burndown, a query language, an automation builder, custom fields and databases, deep nesting, streaks and karma, an auto-scheduler, an Urgent priority, guest logins and role matrices.

The substitutes are:
- sections and the Waiting field;
- minutes calibrated against your own actuals;
- dated sections plus "This week" views;
- filter chips plus your AI;
- built-in rules plus scheduled agents through MCP;
- a client status link later.

The one gap no Tasks change closes is **mobile** (❓36).

---

## 4. The views — today and their target

Per-view detail is round 2's work. Here: what each view lacks and what the target is, so the structure calls can be judged against them. Today's capability matrix is in [current state](./research/current-state.md) §3.

**List**

- **Today:**
  - The row anatomy is right.
  - You can't drag to reorder inside a bucket; dropping a task on another makes it a subtask.
  - No sort, search or multi-select.
  - In All, grouped by bucket, only the first group opens.
  - Group headers shout user names in capitals ("CS 201 ALGORITHMS").
  - Dates truncate ("12:00 P…").
  - Screen readers can't follow the cursor.
- **Target:**
  - Reorder and nest (TV-U4); sort, filter and search (TV-U2).
  - Group by section.
  - Inline "add task" per group.
  - Sticky group headers.
  - The Detailed preset with sortable column headers.
  - Screen-reader support.

**Board**

- **Today:**
  - Columns are status or bucket only.
  - Cards ignore density; every card shows a faint queue icon.
  - The single meta line truncates into fragments ("C…", "Webs…").
  - No add-per-column.
  - Its menu differs from the row's menu.
- **Target:**
  - Columns from any grouping: status, section, assignee, priority, waiting (❓22).
  - Add per column.
  - The card rules from §5.
  - One context menu for every view.
  - Swimlanes are a round-2 question.

**Timeline**

- **Today:**
  - Bucket lanes only.
  - Mostly faded bars, because most tasks have only a due date.
  - No project bars or phases.
  - No keyboard.
  - On an empty timeline the drop target is 8 px tall.
  - Grid lines are invisible.
  - Its toolbar differs from the List's and Board's.
- **Target:** redesigned in round 2a, ❓67–71:
  - project rows with phases across the workspace, and tasks as points inside a project;
  - a name column;
  - the keyboard;
  - no tray;
  - the shared toolbar grammar.

**Queue and Focus**

- **Today:**
  - The Plan/Focus switch is still there.
  - The Queue can be shown as a timeline.
  - Focus can't pick the next task or open details.
  - Time is saved only on /tasks.
  - Three separate clocks exist.
- **Target:**
  - TV-F2–F5 per the comp.
  - "Focus on this" from any task (❓31).
  - In flight reshaped onto the Waiting field (decided ❓5/❓6).
  - One clock app-wide.

**Upcoming (new)** — everything with a date, grouped Earlier · Today · Tomorrow · This week · Later. Todoist's Today and Upcoming in one view (❓29).

**Detail panel**

- **Today:**
  - Close to the comp.
  - The narrow panel truncates values ("Wed, …", "0m of …").
  - No full-page mode.
  - Comments are plain text, with no edit or delete.
  - You can't mention people in the description.
  - The activity trail ignores field edits, creation and deletion.
- **Target:**
  - Full-page mode (❓32).
  - Project, section, lead, reminder and waiting fields.
  - The trail records every change (§6).
  - Comments get edit and delete.

**Capture**

- **Today:**
  - Eight pills.
  - The parser bugs from §1.3.
  - ⌘A doesn't select text.
  - No tags, queue or parent.
  - Native time and number inputs.
- **Target:**
  - TV-U7 per the comp.
  - The capture grammar (❓33).
  - Subtasks typed inline.
  - "From template" (❓9).

**Calendar ↔ Tasks**

- **Today:**
  - Due-only tasks never appear on the grid.
  - Panel titles truncate.
  - Durations read "240m".
  - Block focus runs its own clock.
- **Target:**
  - Due dates as all-day chips and a Month view (❓26).
  - Several sessions per task (❓25).
  - One clock.

**Home**

- **Today:**
  - The Tasks widget shows the queue, or else every open task team-wide.
  - The time widget never reads task time.
  - There's no team-load widget.
- **Target:** team load (decided ❓12), a working time widget, Upcoming.

---

## 5. The visual north star

From the [visual audit](./research/visual-audit.md): 199 Storybook captures with computed-style measurements, plus the live walkthrough.

### 5.1 What would spread if copied today

| # | Issue | Evidence | Kind |
| --- | --- | --- | --- |
| 1 | **Six faded grey steps used as hierarchy** (`/70 /60 /50 /40 /25` + opacity). Four are below readable contrast: board empty text 2.7:1, the card queue icon 2.2:1, done-row meta 2.1:1 | visual audit B1 | New rule → ❓38 |
| 2 | **Duplicated interaction recipes**: three drop targets, four drag overlays (two of them black on black), two drag-source opacities, three focus rings, hover by fill on rows but by border on cards | B2, B5, B7 | Rule → ❓39; the DS-4 pieces exist and nothing uses them |
| 3 | **Native date, time and number inputs** inside token UI (row date popovers, capture time and duration, Focus inputs) | B3 | Fix list (DateField is the only date UI) |
| 4 | **Density honoured only by rows and the panel**: cards are 65 px at every density; menus, tabs and app tabs are fixed | B6 | Rule → ❓44 |
| 5 | **Seven chip languages, three count languages** | A12, B9 | Rule → ❓45 |
| 6 | **Inline editors change typeface**: a 15 px body title turns into 13 px display while you edit | B10 | Fix list |
| 7 | **29 hand-rolled buttons**, about a third of them where a primitive already exists; four hand-rolled empty states | B11 | Fix list |
| 8 | **Two floating-surface recipes** (menus vs Filter/Display/comments) | B12 | Fix list |
| 9 | **Accent stacking**: selection, queued, done and Today are the same accent on one screen | B13 | Rule → ❓46 |
| 10 | **Hit targets under 24 px**: checkbox, queue toggle, expand, drift dot | B14 | Fix list (pad the hit area, keep the glyphs) |
| 11 | **Formats vary and truncate**: "Today 3:00 PM" vs "Sat, Oct 10, 3:00 PM"; "240m" vs "1h 30m"; "C…", "12:00 P…" | walkthrough | Rule → ❓41, ❓42 |
| 12 | **People's words in capitals** (group and column headers) | walkthrough | Rule → ❓40 |
| 13 | **Avatar identity**: one initial (Maciej = Mike), and "M" for "Me" | walkthrough, A1 | Rule → ❓43 |
| 14 | **Stories out of date**: the app-chrome story crashes; the Toolbar story still shows the old language | B15 | Fix list |
| 15 | **Docs contradict themselves**: DESIGN_SYSTEM's typography roles vs R4 | B10 | Fix list |

Checked and ruled out: the "2 px accent ring around the list pane on load" only appears in Storybook. In the live app the list takes focus without a visible ring.

### 5.2 The north-star kit

These primitives are standardised once and every module builds on them. One-line contracts for each are in visual audit §C.

| Group | Primitives |
| --- | --- |
| Lists and cards | Row, Card, GroupHeader (sticky; shared by list groups, board columns, timeline lanes and rail sections), MetaCount(s) |
| Properties | PropertyRow / PropertyValue, CollectionHeader |
| Navigation and toolbars | NavRow, the Toolbar grammar (`title + count … Search · Filter · Display | view switch | one primary`), FilterBar / DisplayMenu |
| Chips and pickers | **Chip** (new: one chip for pickers, capture pills, references and filters), Picker pill |
| Feedback and history | EmptyState, the Feed item / card / composer |
| Inputs and progress | DateField (the only date UI), Progress (neutral) |
| Shared recipes | One selection recipe, one focus recipe, Avatar |

**Tasks-only:** priority and energy glyphs, the queue toggle and claims, the "N completed" line, the Timeline, run surfaces, the drift mark.

Each fix-list item is a violation of a rule that already exists, so it goes into the trust/visual pass (§7, P2) with no call needed.

---

## 6. Technical decisions I'm taking

Per `/s1`, these are mine to decide. They'll be recorded under *Assumptions & technical decisions* in the spec and in `docs/decisions/tasks.md`. They're listed here so nothing surprises anyone.

1. **Every create and every field edit goes through a server op** (`tasks_op_create`, `tasks_op_update`), whether it comes from the UI, ⌘⇧K, MCP, import or a template.
   - The op registers the task for search and mentions, updates that entry on rename, assigns the handle number, and logs an activity row.
   - Raw table writes are revoked at TV-D7.
   - This fixes search, gives agents capture, and makes handles possible.
2. **A task's status, recurrence and next occurrence are computed on the server for every path.** This fixes the reopen bug. Catch-up for missed repeats becomes a server job later.
3. **The client tolerates statuses it doesn't know** (today such rows are silently dropped), and the "is open" rule lives in one place, before any vocabulary change ships.
4. **`due_date` becomes a calendar date** instead of a timestamp. The timestamp gives off-by-one days across time zones; a due *time* is its own optional field.
5. **One store for dependencies.** Today a "blocks" link made from the hub or MCP doesn't block anything.
6. **One shared task store per workspace**, kept live by Realtime (TV-D5), with per-view server reads and virtualised lists. This replaces the full reload that about ten surfaces do on mount (❓37 sets the bar).
7. **A minimum client build, checked at boot**, so the next schema reversal costs one migration instead of three code paths.
8. **Manual order lives on the project and its sections.** Cross-project views sort; they don't reorder (as tasks-v2 already says). A Board reorder in the Queue scope is disabled.
9. **One TV-D7 cleanup for every reversal:**
   - the status label and value;
   - the `due_date` type;
   - `reschedule_count`;
   - `task_time_blocks`;
   - `group_label` → areas;
   - `committed_for`;
   - the owner shim;
   - duplicate dependency rows.
10. **One time engine for the whole app.** Focus, Calendar block focus and the Home pomodoro share it, and saves work from any page.
11. **Speed at 10,000 tasks (❓37), in detail:**
    - one local copy per workspace on the device (IndexedDB on web and in the desktop webview), shared by every module;
    - the app opens from that copy, then a delta sync fetches only rows changed since the last sync;
    - Realtime keeps it live (TV-D5); a reconnect runs a delta sync;
    - open tasks load first; done, Won't do and backlog tasks and history load lazily or on demand;
    - search over everything runs on the server;
    - lists are virtualised, rows memoised, and hooks keep stable identities, so editing one task redraws one row;
    - failed writes retry or roll back that one field, never reload everything;
    - CI runs a 10,000-task fixture against the 200 ms budget.

    It's also the first step toward offline use, which the brief wants later.
12. **Status tolerance before Backlog (❓53):** the client tolerance and "is open" fix (§6.3) ships in a desktop release first. The Backlog status goes live only after that release is out; until then, old builds would drop backlog tasks. *Applies only if ❓53a is declined. With 53a, old builds keep reading the category in today's status field, so Backlog doesn't wait.*

---

## 7. One backlog

This replaces the four "top N" lists in the reports. Phases run top to bottom; inside a phase, the order is by impact.

**P0 — Trust pass** (one or two blocks; bugs, so no calls)

1. Search, mentions and refs find every task and follow renames (§6.1).
2. Repeating tasks never reopen themselves (§6.2).
3. The parser keeps the words people typed:
   - only clear date phrases are parsed;
   - "at 5" means 5 PM in the daytime;
   - a date and a repeat in one line both stick;
   - ⌘A selects text in capture.
4. Archived ("won't do") tasks can be reached and reopened. Overlaps #330's planned Filter → Status: Archived; count it once.
5. List and Board get a loading state, and an empty filter says "No tasks match" instead of "Nothing here yet".
6. Focus time is saved from any page.
7. Notifications name the task.
8. Moving a parent takes its subtasks with it.
9. New from the Queue queues the task.
10. A task in a project you can't see is never labelled "Inbox", and its deep link opens that task.
11. "Rescheduled N×" is removed.
12. Date popovers save once, and scheduling from a row is recorded in the trail.
13. MCP task lists page past 1,000 rows.
14. A "blocks" link always blocks (§6.5).
15. Avatar initials and one date/time/duration format (❓41, ❓43).
16. No truncated dates or times in the panel, on cards or in the Calendar panel.

**P1 — Foundations**

- Server create/update ops + search registry + handles (§6.1, decided ❓3/4).
- MCP task writes (decided ❓7).
- Projects (❓13, 16, 17, 20).
- Sections and Board-by-anything (❓18, 22).
- Areas (❓15).
- Won't do and late (❓21, 23).
- Smart views and landing (❓29, 30).
- Presets (decided ❓2, inside TV-U2).
- Status tolerance (§6.3) → Backlog (❓53).
- Date commands (❓33a), in the capture grammar.

**P2 — Views and the visual system**

- The north-star rules and kit (❓38–46, the §5 fix list).
- Per-view detail from round 2.
- The in-flight TV-U2/U4/U5/U7/U8, F2–F5, AT-2/3, D5 work, reconciled in round 3.

**P3 — Complete per role**

- Reminders (❓24).
- Due dates on the calendar + Month view (❓26).
- Recurrence parity (❓27).
- Templates (❓9).
- Onboarding (❓34).
- Import (❓35).
- The client loop (decided ❓8).
- The team-load widget (decided ❓12).
- Sessions per task (❓25).
- Calibrated estimates (❓10).
- "Focus on this" (❓31).
- Full-page task (❓32).
- Inbox triage keys (accept · decline · duplicate · snooze).
- Customize sidebar and Pin (❓29a/b).
- ~~Views saved inside a project as project tabs (❓29d)~~ — 29d is no.
- Per-module first-open moments (❓34).
- Recurrence method a–i (❓27).
- The agent session line and hand-back summary (❓51, ❓52).
- Follow-ups that resurface from the contact graph (moved up from P4 by ❓50).
- Teams: task routing (❓54).
- The References primitive, with task, email and contact previews (❓55).
- Long descriptions (❓56).
- "Along the way", Arrange by project and dividers (❓57).
- ~~Cues (❓58)~~ — parked.
- The "along the way" switch (❓59a).
- Per-module welcome dialogs (❓34).
- "Copy branch name" for developers.

**Round 2a/2b calls, placed** (2026-10-10; final order is set in the spec):
- **P1 (foundations):**
  - 53a statuses per project and 77 the completion record, both folding into TV-D7;
  - 74 the agent tools for import;
  - 76 Time & region;
  - 48b and 72a: the panel title dropdown in the shell.
- **P2 (views and the visual system):**
  - 61–66 Focus;
  - 67–71 Timeline;
  - 53b folded columns;
  - 68b dates that contradict dependencies;
  - 46a;
  - 80, written as the notification table in the spec.
- **P3 (complete per role):**
  - 73 reminder channels (the desktop app in the menu bar, and browser notifications);
  - 75 time entries and the report (PDF and CSV);
  - 78 people and projects going away;
  - 79 Duplicate project and project templates;
  - defaults a–g.
- **Later:** suggestions outside Focus (59a), after the module rebuilds.

**P4 — Later**

- The client status link (parked ❓11).
- GitHub PR status on a linked PR.
- ~~"Undo an agent's session" (❓52)~~ — moved to P1 with agent writes (❓74).
- Mobile capture beyond MCP.

---

## 8. The calls

**Status after round 1b (2026-10-09):** Maciej answered 13–50 and 9–10.

| Status | Calls |
| --- | --- |
| ✅ Decided | 13, 15, 16, 17, 18, 19, 21, 23, 24, 25, 26, 28, 30, 31, 32, 35, 36, 37, 39–49, 10 |
| ❓ Re-asked, with fuller reasoning | 9, 14, 20, 22a, 27, 29a–d, 33, 34, 38, 50 |
| ❓ New | 20a (handing off an unfiled task), 51, 52 (agents) |

**Round 1c (2026-10-10):** 9, 14, 15, 20 (hairline), 20a, 22a, 27, 29a, 29b, 33, 37, 38, 50 and 51 were decided; the ✅ marks are under each call. 48a was added as a principle, in Maciej's words.

| Status | Calls |
| --- | --- |
| ❓ Re-asked | 29c (re-argued), 29d (not answered yet), 34 (redesigned around his welcome dialog), 52 (rethought) |
| ❓ New | 29e (collapsible groups), 33a (date commands), and the round-1c topics 53–60 in group I |

**Round 2a (2026-10-10):** 9, 22a, 29c (B), 29d (no), 29e, 33a, 34, 37, 52, 53, 54, 55, 56 and 57 were decided. 58 is parked, because its triggers live in modules that may be rebuilt. 60 is dropped: no more ADHD-specific exploration for now. 59 was accepted, and 59a simplifies it.

| Status | Calls |
| --- | --- |
| ❓ Follow-ups | 53a (statuses per project), 53b (folded columns, text never rotated), 59a (one switch) |
| ❓ New | 46a (text never rotated) and group J: Focus 61–66, Timeline 67–71, the right panel 72, gaps 73–80 plus defaults a–g |

**Round 2b (2026-10-10):** decided:
- 33a, 37, 46a, 53a (with his icon rule), 53b (his folded button), 59a, 61, 64, 66 (task rows), 67, 69, 70, 71, 79 (plus project templates);
- 72: B, the title-row dropdown. A was rejected, and principle 48b was added in his words.

His questions on 73–78 and 80 are answered under each, and those calls stay open.

| Status | Calls |
| --- | --- |
| ❓ Rewritten | 62a (Pomodoro, and where everything went), 63 (the ⋯ menu), 65a (variant C), 68a (section dates and trade-offs), 72a (how B works) |
| ❓ Still open | 73–78, 80 |
| ❓ New | 81 (motion) |

**Round 2c (2026-10-10):** round 2a and 2b's calls are all decided:
- 53a, 53b, 59a, 62a, 63, 65a (C), 66, 68a, 71, 72a, 76, 77, 78, 80;
- 73 (desktop and browser only);
- 74;
- 75 (plus a PDF report);
- 81 (no blur for now).

**68b** (dates that contradict a dependency) was then decided too. Round 2b's per-view work started on 2026-10-10 (§9).

**Round 2b (2026-10-10), group K:** the everyday views. Open: 82–95, plus defaults h–u.

**Round 2e (2026-10-10):** decided:
- 82b (the action-row pattern) and 90b (⌘+number switches the capture's module);
- 93 (linked by default; the agent's choice);
- 96;
- defaults a–u (the agent's choices, deferred to by Maciej, confirmed for building).

The re-plan's calls are closed; next is round 3 (the paused PRs).

**Round 3 (2026-10-10), group L:** verdicts for the six paused PRs. 97 and 98 recorded as the agent's choices (deferred). **The spec is being written: `specs/tasks-v3.md` (2026-10-10, on Fable 5.1).**

**Round 2d (2026-10-10):** 82–95 decided except 90a (one global capture for every module), 93 (now suggested, not automatic) and new 96 (Help and the timer in the top bar). Each default has its reason under the defaults table.

**How to answer:** numbers with ok / no / notes, as before.

### Consistency pass (round 1b)

Maciej spotted inconsistencies in the first draft; checking every call against every other turned up these. Each is fixed below.

1. **The capture tokens broke the app grammar** (`#` for projects, a new `!`). → ❓33 now uses only `@` · `#` · `/` with their app-wide meanings.
2. **Onboarding seeded a "starter template"** while templates (❓9) were undecided. → Seeds include a template only if ❓9 is yes; otherwise three example tasks.
3. **"Section" meant two things.** Today the rail's ⋯ → Section groups buckets; the proposal uses Section for parts *inside* a project. → Today's rail sections become **Areas** (❓15); "Section" only ever means a part of a project (❓18).
4. **Who Upcoming covers was never defined.** → Upcoming = your dated tasks plus unassigned ones, in projects you can see. Everyone's dated work = All grouped by Time.
5. **"Focus on this" had no key, and `f` is Filter** (tasks-v2 key map). → Its key is ⇧F, plus the ⋯ menu and the detail header's ▶.
6. **"Two greys" undercounted.** → ❓38 restated as three readable text levels plus one decorative.
7. **❓40 (never capitalise people's words) clashed with today's small-caps group and column headers**, which show project names. → One header style for every grouping, in sentence case. Small caps stay only for fixed chrome labels.
8. **Decided calls 2 and 8 still said "bucket".** → Read as "project". The Detailed preset's bucket column becomes "Project › Section".
9. **The pricing-page line in ❓36.** → Struck, per Maciej.
10. **"Scale bar" in ❓37 was jargon.** → Renamed to a performance target and explained.
11. **❓50 put sales reps in "spillover"** while the Contacts module already makes Moduo a light CRM. → Founder-led sales and small-team business development become a target (❓50).
12. **The Inbox read as "private space at the top of a shared workspace".** → ❓20 explains why it's personal and fixes how that shows.

### A · Structure

**★ 13 · The container is called "Project"**
- Every target role says project (or course). A client can be told "your project". Microsoft Planner uses "bucket" for a *column*. The spine already calls it a project.
- The code and the schema keep `buckets` until the cleanup; MCP keeps `tasks_list_buckets` as an alias.
- (c) · #328, #330

✅ **Decided 2026-10-09:** yes.

**★ 14 · The shape** — *re-asked: "what do areas and sections do here? what is their purpose and how should they be displayed?"*

Three levels, each with a different job. Only the project is required; a new user sees just Inbox and projects.

| Level | The question it answers | Examples | Where you see it |
| --- | --- | --- | --- |
| **Area** (optional) | "Which part of my work or life is this?" | Product · Clients · School · Personal | Collapsible headers in the sidebar, grouping projects |
| **Project** | "What are we trying to finish?" | Acme rebrand · CS 201 · Launch v1 · Podcast season 2 | Sidebar rows; the home of every task |
| **Section** (optional) | "Which stage or part of this project?" | Discovery → Design → Delivery · Week 1 … Week 12 · Idea → Draft → Edit → Publish · Sprint 12 | Inside one project: list headers, board columns, timeline markers |

- **Areas tidy the sidebar** once projects multiply. **Sections tidy a project** once its tasks multiply.
  - The two never mix: a task never sits directly in an area, and a section never spans projects.
- **How it's displayed** (prototype [`prototypes/structure.html`](./prototypes/structure.html), frames 1–3):

  | Where | What shows |
  | --- | --- |
  | Sidebar | Projects without an area first. Then each area as a collapsible header (sentence case, open-task count, a hover "+" for a new project, and ⋯), with its projects underneath as rows: colour dot · name · count. |
  | Project, List | Tasks without a section first, with no header. Then each section as a header: name · "2 of 5" · optional date · chevron, tasks underneath. "+ Add section" at the end. |
  | Project, Board | Grouped by section: these are your own columns (❓22a). A project without sections is grouped by status. |
  | Project, Timeline | The project as a bar ending at its target date. Dated sections appear as phase markers. |
  | All, Upcoming, My tasks | Area works as a filter and a grouping. A task shows "Project › Section" only in the Detailed preset. |

- Every existing bucket becomes a project with the same id, shares and tasks. Nothing moves.
- *Recommend: yes.* (b) · #328

❓ With these jobs and this display, adopt the shape?

✅ **Decided 2026-10-10:** adopted.

**15 · Areas = today's rail sections, made real** — *"ok, but explain why"*

**Why areas exist at all:**
1. **You already have them.** Today's "PRODUCT ▾ / CLIENTS ▾" sidebar headers are areas in all but name.
   - They're stored as a text label copied onto every bucket, so renaming one means relabelling every bucket in it.
   - Nothing else in the app can use them.
   - Making them real costs little.
2. **Projects multiply.** A flat list of 15–30 projects is a wall:
   - a freelancer with eight clients;
   - a student with five courses plus personal life;
   - a founder with product, sales and ops.

   Grouping is the first thing every tool adds after projects: Things areas, Todoist and TickTick folders, Linear teams, Asana portfolios, Motion folders.
3. **They become useful elsewhere:**
   - Upcoming or All filtered to "School";
   - team load by area;
   - an agent asked "what's due in Clients this week?".
4. **They stay deliberately light:**
   - no permissions (sharing stays per project);
   - no page;
   - no tasks directly inside.

   So "is this an area or a project?", Things' best-known confusion, never comes up.

**Naming change:** the rail's ⋯ → "Section" becomes "Area". "Section" now means a part of a project (❓18).

- Detail: an area has a name, colour and order; it's hidden until you create one; today's sections become areas in rail order.
- (b) · #328

✅ **Decided 2026-10-09:** yes (reasons above).

**16 · What a project carries**
- **Fields:** description, status (**Active · On hold · Done**), target date, colour, area, client link, sections.
- **Computed:** progress, time, files, waiting, activity.
- **Left out:** no "health" or "at risk" field, and no status-update posts.
- *Archive* stays separate: it's about visibility, not the work.
- On hold and Done only change the overview, a dimmed rail row and MCP. They never hide tasks.
- (b) · #328

✅ **Decided 2026-10-09:** yes.

**17 · An optional project Lead**
- **For:** PMs and agencies ask "whose project is this?"; it's cheap, and hidden until set.
- **Against:** at ≤5 people the assignees already answer it.
- (b)

✅ **Decided 2026-10-09:** yes — optional, and hidden until set.

**★ 18 · Sections inside a project**
- Sections are ordered and optional, and can carry a date.
- Board grouped by section shows the parts of a project: agency phases, student weeks, sprints. *(Round 2b: stages and pipelines moved to per-project statuses, ❓53a.)*
- A dated section is a Timeline phase marker, with progress per section.
- Imports land Todoist sections and Trello lists here.
- Chosen over grouping the Board by tag, because tags aren't exclusive and a card could sit in two columns.
- (b) · #330, #329

✅ **Decided 2026-10-09:** yes.

**19 · No separate milestone or sprint object**
- A dated section *is* the milestone, phase or sprint ("Sprint 12 · Oct 13–24").
- A saved view covers the rest.
- A task with only a due date is the point milestone on the Timeline.

✅ **Decided 2026-10-09:** yes.

**20 · The Inbox: personal, and why** — *re-asked: "why private? why would the shared workspace's first section be something private?"*

**What the Inbox is for.** It's the tray where quick captures land before you decide where they go: ⌘⇧K, email → task, an agent's capture. It isn't a team space; it's each person's unsorted pile, like an email inbox.

**Why per person:**
- **Captures are half-thoughts.** "Call accountant re: VAT", "idea: referral program", "reply to Maya". People capture freely only when it's private; a shared pile turns capturing into posting.
- **Someone has to sort each item.** In a shared pile everyone sees it and nobody owns it. In a personal one, whoever captured it does.
- **It's what your users already know.** Todoist, Things, Asana (My tasks) and Linear (Inbox, My issues) all put the personal block first in the sidebar and the shared workspace below it.

**What's actually wrong today:** the split isn't visible, and a task can get stuck. The fix:
1. **The sidebar shows the split:** your block (Inbox · Queue · Upcoming · My tasks) above the workspace block (All · Pinned · Views · areas and projects). Either a hairline (A) or small "You" / "Workspace" labels (B), prototype frame 1.
2. **The Inbox says so:** "Only you see your Inbox. File a task into a project or assign it, and it moves."
3. **Assigning an unfiled task moves it to that person's Inbox**, with the usual "assigned to you". Today it stays in yours, invisible to them: that's trust bug P0 #10.
4. **Filing a task into a project makes it the team's**, or rather everyone the project is shared with.

**Where privacy lives:** on projects. A project is shared with the workspace or kept to chosen people (today's Share menu), so a "Personal" area can hold private projects in a team workspace.

**Also:**
- When a project is deleted, each of its tasks goes to its assignee's Inbox, and unassigned ones to the deleter's.
- The Inbox never appears in project lists, board columns, timeline lanes or MCP's project list.

**Not proposed now:** a shared team intake ("Requests") for work arriving from outside, such as a client form or a shared email address. It belongs to whenever outside intake exists.

- *Recommend: personal Inbox, with 1–4.* (a/b) · #328

❓ OK? And for the sidebar split: hairline only (A), or small labels (B)?

✅ **Decided 2026-10-10:** a personal Inbox with points 1–4, using **the hairline (A)** and no labels.
- Labels for every block ("You", "Workspace", "Pinned", "Projects") read as clutter.
- The you/everyone split is explained in Tasks' first-open welcome instead (❓34).

**20a · Handing an unfiled task to someone** *(new in round 1b)*

**The gap in point 3 above:** if an unfiled task moves into Mike's private Inbox, whoever captured and delegated it loses sight of it. A founder pair hits this daily: "I handed it to Mike — where did it go?"

**How others handle it:**
- Todoist doesn't allow assigning inside the Inbox at all.
- Asana keeps the creator on the task as a collaborator.

**Proposal:** assigning a task from your Inbox to someone else asks for a project in the same picker — "Assign to Mike · in [Bugs ▾]" — because an unfiled task that belongs to someone else belongs to nobody.
- Filing it puts it where the team (and you) can see it.
- "Keep unfiled" is still allowed. The task then sits in Mike's Inbox, and you keep sight of it, because you created it, through the "Created by me" filter.

- *Recommend: yes, the picker with a project.* (a/b) · #328

❓ OK?

✅ **Decided 2026-10-10:** yes.

**9 · Templates** — *re-asked: "isn't that going to overcomplicate things? prove that this solves problems for our users before I say yes"*

**The problem.** The same multi-step work keeps coming back: onboarding a client, a lab report, a release, an episode, a monthly close, a lead follow-up. In Moduo today you either:
- retype the steps;
- Duplicate an old task (you have to find it, and its dates don't move); or
- keep the checklist in a note.

Steps get forgotten, and dates get recalculated by hand.

**Evidence that it's real for our users:**
- **Roles.**
  - Consultants, agencies and creators list it as a *must*; ops, researchers and PMs as *hurts daily* (segments matrix; role-journeys gap G10).
  - Sales follow-up sequences are the same need (❓50).
- **Switching.** Every tool we've promised to replace has templates:
  - Todoist: project templates;
  - Linear: issue and project templates;
  - Trello: card and board templates;
  - Asana and Jira: task and issue templates.

  The freelancer back-office tools (HoneyBook, Dubsado) are built around workflow templates. People who depend on them would keep the old tool just for that.
- **Science.**
  - Checklists for repeated procedures cut forgotten steps. The strongest evidence is from surgery: the WHO checklist took major complications from 11.0% to 7.0% (Haynes et al., NEJM 2009). Different domain, same mechanism.
  - Writing the steps down offloads memory (Gilbert 2022), which matters most for ADHD users.
  - A pre-broken-down task gets better time estimates (Kruger & Evans 2004).
- **What there's no evidence for:** that our current users need it *now*. The dogfood data doesn't show it yet.
  - A cheap check before building: how often Duplicate is used on tasks with subtasks, and whether titles with subtasks repeat.

**How it stays simple.** The risk is real: template editors and galleries turn into "system-building as procrastination", the brief's #1 failure mode. So:
- **No editor.** "Save as template" on a real task (in its ⋯) keeps its title, description, subtasks, tags, estimate and priority, with dates stored as offsets.
- **"From template…"** in New (or `/template` in capture) asks for one date, plus optionally a project and a contact, and computes the rest.
- **A small list** in Settings → Tasks to rename or delete templates.
- No variables, no automations, no gallery.
- Project templates (sections + tasks) come only if checklist templates get used.

- *Recommend: the minimal version in P3, after the trust pass and the structure; project templates only on evidence of use. If you'd rather see the signal first, defer it until the Duplicate check shows repeated procedures.* (b)

❓ Minimal version in P3, or defer until the data shows it?

✅ **Decided 2026-10-10:** yes, the minimal version (P3). Answers to the two follow-up questions:

- **Does saving a task with subtasks save all of it?** Yes, everything except the parts that belong to one particular run of the work.

  | Kept in the template | Not kept |
  | --- | --- |
  | Title and description (formatting, checklists, embedded references) | Comments and activity |
  | Every subtask, each with its own description, tags, priority, estimate and assignee | Tracked time |
  | Dependencies between the subtasks | Done states (everything starts open) |
  | Tags, priority, energy and estimate | Queue membership, Waiting on |
  | Every date, stored as an offset ("3 days after start") | Recurrence (a repeating task is what repeats) |
  | Links to lasting things, like a note or a contact | Links to one-off things, like a specific email or event |
  | The default project and section | Files, in v1 (link a note that holds them instead) |

- **Is the template task the editor?** Yes. "Edit template" opens it in the normal detail panel, marked *Template*, with dates shown as offsets. There's no separate editor to learn. Editing a template never changes tasks already made from it.
- **Starting one:** "From template…" asks for one date (the start or the due date, whichever the template counts from), plus optionally a project and a contact, and creates everything.

### B · Workflow and dates

**★ 21 · Four statuses; "Archive" on a task becomes "Won't do"**
- To do · In progress · Done · Won't do, plus the Waiting field (decided ❓5).
- Won't-do tasks get a list you can reach and **Reopen**.
- "Archive" is kept for hiding a project.
- The label changes now; the stored value changes at TV-D7.
- (c) · #330

✅ **Decided 2026-10-09:** yes.

**22 · Board columns from any grouping**
- Status (default), section, assignee, priority, waiting-on; remembered per project.
- (a/b) · #330, #329

✅ **Decided 2026-10-09:** yes.

**22a · Custom columns** — *"ok, also custom columns?"*

Yes: **custom columns are sections.** On a project's Board grouped by section:
- **"+ Add column"** at the end creates a section.
- **Editing columns:** rename a column in place, drag columns to reorder them, and use ⋯ → Rename · Set date · Delete. Deleting moves its tasks to "No section"; it never deletes them.
- **Dragging a card** between columns moves it between sections. Its status doesn't change.
- A project with sections opens its Board grouped by section; one without sections opens grouped by status.

**Boards that span projects** (All, My tasks, saved views) take their columns from shared fields: status, project, area, assignee, priority, waiting-on. A section belongs to one project, so it can't be a column there.

**Not proposed:**
- renaming statuses;
- a separate "column field" per board. That would be a hidden custom field (Notion's trap) and a custom workflow (❓47 says no).

❓ Custom columns = sections, as above?

✅ **Decided 2026-10-10:** yes.

**Naming rule:** the UI only ever says **section**:
- "+ Add section", "Rename section", "Delete section…";
- the Display menu reads "Group by: Section".

"Column" is never used as a noun. When a board is grouped by assignee or priority, there's no add button. *(Round 2b: one project's Board grouped by status gets "+ Add status", ❓53a.)*

**23 · A quiet "late" state for passed due dates**
- Muted, never red.
- Grouped under "Earlier".
- Always offers a fix: Move · Won't do · Break down.
- (b)

✅ **Decided 2026-10-09:** yes.

**24 · Reminders**
- "Remind me at…" plus presets for 1 day / 1 hour before due.
- One precise notification, exempt from the digest.
- (b)

✅ **Decided 2026-10-09:** yes.

**25 · Several work sessions per task**
- One task can be scheduled into several calendar blocks.
- The estimate stops doubling as the block length.
- Design now, build after the Focus lane.
- (b) · #323

✅ **Decided 2026-10-09:** yes.

**26 · Due dates on the Calendar**
- Due-only tasks appear as all-day chips.
- Calendar gets a Month view.
- This is Calendar-module work.
- (b)

✅ **Decided 2026-10-09:** yes.

**27 · Recurrence: the method** — *"ok, anything else we can do here? what method should we use?"*

**The two methods:**

| Method | Who uses it | Gains | Costs |
| --- | --- | --- | --- |
| **One task that comes back** | Todoist, Things, TickTick, Moduo today | Completing it moves its date forward. Calm: no pile of copies and no "7 overdue"; comments and links stay on one task. | No history per occurrence. |
| **A new copy per occurrence** | Linear, Asana, Jira | Full history. | Clutter, missed copies pile up, links and files get duplicated. |

**Recommendation:** keep "one task that comes back", and add the parts of the copy model people actually miss:

- **a) Rules from the calendar standard** (RRULE, already in the app):
  - every 2nd Tuesday, every 3rd Friday, workdays;
  - monthly on the 15th, or on the last Friday;
  - yearly;
  - ending "until Dec 15" (end of term) or "after 10 times".
- **b) Repeat after completion** ("water plants 7 days after I last did it"), alongside repeating on a schedule.
- **c) Due and scheduled move together**, keeping their gap. Today only the scheduled time moves.
- **d) A completion history on the task**: "Done Oct 2 · Oct 9 · skipped Oct 16", with who did it and the time tracked each cycle. Misses are never listed.
- **e) Subtasks reset each cycle**, so a weekly checklist works.
- **f) Future occurrences show as faint ghosts on the Calendar**, like recurring events. Upcoming shows the next one.
- **g) "Move just this one" or "change the pattern"** when you drag or reschedule one occurrence.
- **h) The server rolls tasks over on time**, on every device and for agents. Today this only happens when a page loads.
- **i) A picker:**
  - presets: Every day · Weekdays · Weekly on Fri · Monthly on the 15th;
  - a Custom option: frequency, interval, days, nth weekday, end, and schedule vs completion;
  - always one plain summary line ("Every 3rd Friday, until Dec 15");
  - capture understands the same phrases and shows what it understood.

**Not proposed:**
- a new task per occurrence;
- rotating assignees (household chore rotas);
- different assignees per occurrence (templates cover team cases).

- (b)

✅ **Decided 2026-10-09:** recurrence parity — yes.

❓ Method: a–i as above? Strike any you don't want.

✅ **Decided 2026-10-10:** a–i, all of them.

**28 · Subtasks stay one level**
- Deeper levels flatten on import.
- (—)

✅ **Decided 2026-10-09:** yes.

### C · Navigation and views

**★ 29 · The rail's smart views**
- Inbox · Queue · **Upcoming** · My tasks (teams) · All, then Views, then areas and projects.
- **Queue** = what I'll do next, in my order. **Upcoming** = what's dated: your dated tasks plus unassigned ones (consistency item 4).
- (b) · #328, #330

✅ **Decided 2026-10-09:** yes.

**29a–d · Customising the sidebar** — *"anything else? any way to customise the sidebar other than custom views? can people choose icons for views (I'd rather not)?"*

- **29a · Customize sidebar.** A ⋯ next to the top block shows or hides Queue, Upcoming, My tasks and All. The Inbox is always shown. Built-ins can't be reordered, so every teammate's sidebar reads the same. *Recommend: yes.*
- **29b · Pin.** "Pin to sidebar" in any project's or view's ⋯ adds it to a "Pinned" group at the top of the workspace block. The group exists only once something is pinned. *Recommend: yes.*
- **29c · No user-picked icons for views.** Two options (prototype frame 5):
  - **A:** each view shows an automatic glyph for its layout (list / board / timeline). It tells you what will open, and there's nothing to choose.
  - **B:** no glyph; names align with project names.

  *Recommend: A.*
- **29d · Views saved inside a project live in that project.** They appear as tabs next to List · Board · Timeline ("Waiting on client · My open"). The sidebar's Views group holds only views saved from All, Upcoming or My tasks, which keeps it short as views multiply. *Recommend: yes.* (a) · #330 (TV-U8)

❓ 29a, 29b, 29c (A or B), 29d?

✅ **Decided 2026-10-10:** **29a** yes. **29b** yes, never suggested or pre-filled: the Pinned group appears only once you pin something yourself.

**29c · View icons, re-argued** (he couldn't decide and asked to be proven wrong about glyphs)
- **What a glyph would give:**
  1. a signal that this row is a view, not a project;
  2. an anchor that keeps every row's text in one line;
  3. a hint of what opens (list, board or timeline).
- **Why each is weak here:**
  1. The "Views" header already says what they are.
  2. View names can align with project names without a glyph.
  3. The layout hint matters for only a moment, since you see the layout as soon as it opens. And most views are lists, so most rows would carry the *same* glyph. Icons help scanning only when they differ, so a column of identical glyphs is decoration.
- **Where glyphs would earn their place:** if views and projects were mixed in one list. In Pinned they are, and there projects keep their colour dot while views show nothing, which still tells them apart.
- *Recommendation changed: B, no glyphs.* His instinct (simpler, and visibly separates views from projects) holds up.

❓ 29c: B?

✅ **Decided 2026-10-10:** B, no glyphs.

**29d** (not answered yet): views saved inside a project become tabs in that project's header, and the sidebar's Views group holds only workspace-wide views. *Recommend: yes.*

❓ 29d?

✅ **Decided 2026-10-10:** no. Saved views live in one place, the sidebar's Views group; a view saved inside a project simply keeps that project as a filter. Project tabs could be added later without migrating anything, if long Views lists ever show up in use.

**29e · Collapsible groups, one header style** (new)
- **Every sidebar group collapses:** Pinned, Views and each area. Collapse is remembered per person; groups are open by default.
- **One header style for all of them:** sentence case, secondary text, a chevron. Area headers show the open-task count; Pinned and Views headers show nothing.
- **No small-caps labels anywhere in the sidebar.** The Pinned and Views headers exist only when there's something in them.
- **A fresh workspace has no headers at all:** Inbox, Queue, Upcoming, the hairline, All, then its projects.
- *Recommend: yes.* Prototype `round-1c.html`, frame 1.

❓ 29e?

✅ **Decided 2026-10-10:** yes.

**30 · Landing**
- Retire "Open at" (the time-of-day bucket).
- Tasks opens where you left it; the first open follows onboarding.
- (c) · #328

✅ **Decided 2026-10-09:** yes.

**31 · "Focus on this" from any task**
- Starts a run with that task on top of your Queue.
- Reached from ⇧F, the ⋯ menu, or the detail header's ▶ (consistency item 5).
- (a) · #323

✅ **Decided 2026-10-09:** yes.

**32 · A full-page task view**
- Expand a task from the panel into the whole centre.
- Same route.
- (b)

✅ **Decided 2026-10-09:** yes.

### D · Capture

**33 · Capture follows the app grammar exactly** — *re-asked: "how will this stay consistent with '@ to mention anything, # to tag, / for commands'?"*

The first draft broke the rule: it used `#` for projects and added a new `!`. In the revision, capture uses the same three symbols with the same meaning they have everywhere else.

- **`@` mentions** — people first, then things.
  - In a task's **title**, a mention does what mentioning means for a task:
    - **a person** → assigns them;
    - **a project** → files the task there;
    - **a contact, note, email or event** → links it ("Call @Anna about @Acme rebrand").
  - In descriptions and comments, `@` stays a plain mention: it notifies and links, and never assigns.
- **`#` tags.** Capture applies the tag; in prose it links (decided 2026-10-08).
- **`/` commands.**
  - In capture they set the things that have no word: `/remind 4pm` · `/priority high` · `/estimate 2h` · `/repeat` · `/template`.
  - In prose they keep inserting and creating, as today (`/task`, `/note`).
- **Plain words for dates.** "Tomorrow 3pm" and "every Tuesday until Dec 15" need no symbol. Recognised words are highlighted, and one click or Esc undoes them.
- **The Todoist habit.** Typing `#CS 201` when a project, not a tag, matches offers "CS 201 is a project — @CS 201" in the suggestions; one tap converts it.
- **Literal symbols stay text:** `C#`, `#123`, `and/or`, an email address. Esc right after a trigger leaves the symbol as typed.
- *Recommend: yes, and this becomes the capture column of the grammar spec (GR-0).* (a) · #330 (TV-U7)

❓ OK?

✅ **Decided 2026-10-10:** yes.

**33a · Date commands everywhere** (new: "we'd still be able to type /tomorrow, /today across the app, right?")

Yes. `/` is the commands symbol, so dates belong there:
- **The commands:** `/today`, `/tomorrow`, `/next week`, `/date` (opens a picker), plus `/due …` and `/schedule …` when you want to be explicit.
- **In a task title (capture),** they set the date, following the same rule as typed words: a date alone sets the due date; a date with a time schedules it.
- **In descriptions, notes, comments and chat,** they insert a **date chip**. It reads "Tomorrow" while that's true and the plain date afterwards; hover shows the full date.
- **Plain words** like "tomorrow 3pm" still work in capture, with no symbol needed. In prose they never turn into dates by themselves, so notes don't change under your fingers.
- **Why `/` and not `@` (Notion's and Google Docs' choice):** under our grammar `@` lists people first, so "@tom" would mix Tom with Tomorrow. Commands under `/` are unambiguous.

❓ 33a OK?

✅ **Decided 2026-10-10:** yes. **His follow-up: does the date stay as text in the title? No.**
- In capture, a recognised date (typed words or a `/` command) is highlighted as you type. On save it leaves the title and becomes the task's date, shown in the row's date slot.
- Esc on the highlight keeps the words as plain text ("Prepare Monday notes").
- In an existing title, only `/` commands act, so renaming a task never changes its date by surprise.
- In prose, `/` dates become date chips, as in Slack.

### E · Switching, onboarding and reach

**34 · Onboarding** — *"ok. should each module have their own onboarding, displayed once on first open for each user?"*

**The role question** ("What will you run in Moduo?") sets defaults only:
- your preset and first view;
- saved views;
- three teaching tasks;
- a starter template, but only if ❓9 is yes.

It never turns features on or off.

**Per-module onboarding:** yes, as a first-open *moment* rather than a tour.
- **Once per person per module.** The module's empty state teaches what it's for and the one gesture that matters ("⌘⇧K captures from anywhere").
- **At most one setup card**, where something has to be connected:
  - Calendar: "Connect a calendar";
  - Email: "Connect an account";
  - Contacts: "Import a CSV";
  - Notes: a starter note.

  Dismiss it with × and it's gone for good. Teammates who join later get their own.
- **No modal tours, no forced steps, no ten-item checklists.** Vendor benchmarks (e.g. Chameleon's product-tour data) show completion is highest around three steps and falls as tours grow, and people skip tutorials they didn't ask for. The brief already says "onboard like a single-purpose tool; reveal modules progressively".
- **Who gets asked what:**
  - The role question is asked once per person, because it sets *their* preset and first view.
  - Example tasks and saved views are seeded once, for whoever creates the workspace.

- (b)

✅ **Decided 2026-10-09:** the role question — yes.

❓ Per-module first-open moments, as above?

✅ **Decided 2026-10-10:** a first-open moment for each module, once per person, with no forced steps and no app-wide tours.

**Redesigned around his proposal** (a multi-step welcome dialog, because some modules work differently from tools people know):
- **Step 1 is the basics:** what the module is for, three one-line basics, and two buttons, **"Show me what's different"** (up to 3 short steps) and **"Explore on my own"**, which closes it.
- **Each step:** a short looping clip (or a still) with one or two sentences, Back / Next, progress dots, and a Close that's always there. Esc closes.
- **It never shows itself again,** but it can be reopened from the module's ⋯ menu ("What's in Tasks") and from Help.
- **Clips are recorded from the real app by script** (the same Playwright setup as the visual audit), so they can be regenerated whenever the UI changes instead of going stale.
- **The empty-state teaching and the single setup card (connect, import) stay** for whoever skips.
- **Order on the very first visit:** the role question first (once per person), then Tasks' welcome.

**Proposed steps for Tasks' welcome:**
1. Above the line is yours (Inbox, Queue, Upcoming); below it is shared. This is where the hairline gets explained.
2. Line things up in the Queue and run them.
3. Hand work off with Waiting on, and link anything with `@`.

❓ This welcome design, and these three Tasks steps?

✅ **Decided 2026-10-10:** yes, with two changes from Maciej:
- **The buttons read "Learn more"** (up to three steps) **and "Explore on my own".** "Show me what's different" limited what could be shown: a feature worth showing doesn't have to be unusual.
- **Step 3 covers all three symbols:** "`@` assigns, files and links · `#` tags · `/` runs commands, like `/tomorrow` — the same everywhere in Moduo."

So Tasks' steps are: 1 · above the line is yours, below it is shared; 2 · line things up in Focus and work through them (❓61); 3 · `@` `#` `/`.

**35 · Import**
- First: "bring Todoist / Linear / Trello through your AI", right after MCP writes land.
- Then native importers: Todoist CSV → Trello JSON → Linear / Jira / Asana CSV.
- Old IDs stay findable.
- (b)

✅ **Decided 2026-10-09:** yes.

**36 · Mobile stays out of scope**
- Capture on the phone goes through your AI app (MCP).
- (—)

✅ **Decided 2026-10-09:** yes. Not mentioned on the pricing page.

**37 · A performance target** — *"a scale bar? what do you mean?"*

That was jargon. It's a **performance target**:
- Tasks stays instant — opening a task, searching and switching views all under ~200 ms, the brief's existing budget — in a workspace of **10,000 tasks**.
- That's what a 3–5-person team accumulates in a year or two of using Moduo instead of Linear or Jira.

**Why it needs a decision:**
- Today every screen that shows tasks downloads every task ever created, done ones included, when it opens.
- About ten places do this separately, and it stops at 5,000 tasks.
- Nothing renders only the visible rows.
- That's fine at a few hundred tasks, slow at a few thousand, and eventually incomplete.

**Saying yes commits the build to:** loading only what a view needs, keeping one shared copy updated live, and rendering only what's on screen (§6.6). There's no visible feature; it decides whether "replace Linear/Jira" still holds in month six.

- (b) · #315

✅ **Decided 2026-10-09:** yes.

**How it stays quick** (round 1c, in plain words):
- Moduo keeps a copy of your workspace on your device. Tasks opens instantly from it, then fetches only what changed since last time.
- Every module shares that one copy instead of downloading everything separately.
- Open tasks load first; done, Won't do and old history arrive afterwards, or only when you open them. Searching everything happens on the server.
- Lists draw only the rows on screen, so 2,000 tasks feel like 30.
- The cost: a few MB on the device, and the first sign-in on a new device takes a few seconds.
- Detail is in §6.6.

**His follow-up: will the old code slow the rebuild down? Reshape it, or build the backend from scratch?** It's a technical call, so it's answered here rather than asked. Neither extreme: each layer gets what its condition earns.

| Layer | Verdict | Why |
| --- | --- | --- |
| Tables and stored data | **Evolve with migrations** | The data is people's real tasks. Starting over would still mean migrating every row, plus re-proving permissions. The schema changes (projects, sections, statuses, sessions) fold into the one cleanup, TV-D7. |
| Permissions (who sees what) | **Keep** | Proven on prod, and the riskiest thing to redo. Sections and statuses inherit from their project. |
| Server operations (create, update, move…) | **Consolidate** | Already decided in §6: one set of server ops used by every client and agent. |
| How screens get their tasks (the client data layer) | **Rebuild** | This is the real burden: about ten places each download every task, three clocks run separately, and nothing loads in parts. The one shared copy (§6.6) replaces them all. |
| Design primitives and the row anatomy | **Keep** | The visual audit found they mostly hold; they become the north-star kit. |
| List, Board, the detail panel, capture | **Rework**, on the new data layer | The behaviour is mostly right and the fixes are known (§4, §7). |
| Timeline | **Rebuild** | About 1,200 lines on a custom drag engine, with whole-tree re-renders and no virtualization, and the design target changes (group J). |
| Focus | **Rebuild** around the new design (group J) | The engine's ideas carry over; the screen doesn't. |

**In short:** the "burdened" feeling is right about the data layer and the Timeline, and wrong about the visual kit. A backend built from scratch would cost weeks of data migration and permission re-testing with nothing new to show for it. The speed comes from rebuilding the data layer.

### F · Visual north-star rules (every module inherits these)

**38 · Text levels** — *re-asked: "won't fewer shades of grey impair showing structure in other modules?"*

No. The first draft was badly worded. The proposal doesn't cut the levels we use; it cuts the **unreadable** ones.

- **Three readable text levels for every module:**

  | Level | Used for | Contrast |
  | --- | --- | --- |
  | Primary | Titles, content | — |
  | Secondary | Meta, labels | 8.5:1 (today's muted) |
  | Tertiary | Timestamps, hints, counts | At least 4.5:1, a new step just above the readability line (exact value set in round 2) |

- **One decorative level below that**, only for things that carry no information: the priority glyph's ghost bars, a disabled control, placeholder text.
- **States are separate from levels.** Done, past and disabled rows use a state treatment (row fade, strikethrough), not a text colour.
- **This is the norm in mature design systems:** GitHub Primer (default / muted / subtle), Material (high / medium / disabled emphasis), Apple (label / secondary / tertiary, plus quaternary for placeholders).
- **Grey isn't what carries structure.** Weight, size, spacing, grouping and icons do most of the work. The steps we drop (/60, /50, /40) measured 2–3.5:1 in the audit: they were hiding information, not structuring it.
- **It flows everywhere, which is the point.** The three levels become app-wide tokens, and a lint guard blocks new one-off fades. Notes, Email, Calendar, Contacts and Chat use the same three.
- *Recommend: yes — three readable levels plus one decorative.*

❓ OK?

✅ **Decided 2026-10-10:** yes.

**39 · One interaction language** — hover = fill everywhere; one selection tint, focus ring, drop target and drag preview.

✅ **Decided 2026-10-09:** yes.

**40 · Never capitalise people's words** — names appear as typed.

✅ **Decided 2026-10-09:** yes. Every grouping header uses one sentence-case style; small caps stay only for fixed chrome labels (consistency item 7).

**41 · One date, time and duration grammar** — Today · Tomorrow · Mon · Oct 16 · Oct 16, 2027 · 3:00 PM · 45m · 1h 30m · 4h. Dates, times and counts never truncate.

✅ **Decided 2026-10-09:** yes.

**42 · Titles give way first** — meta drops whole items behind "+n", never fragments.

✅ **Decided 2026-10-09:** yes.

**43 · Avatars** — two initials plus a stable per-person colour; never "M" for "Me".

✅ **Decided 2026-10-09:** yes.

**44 · Density applies to everything** — cards, menus, tabs and pills.

✅ **Decided 2026-10-09:** yes.

**45 · One chip, one count language.**

✅ **Decided 2026-10-09:** yes.

**46 · An accent budget** — selection > today/now > done check > queued; queued becomes neutral.

✅ **Decided 2026-10-09:** yes.

**46a · Text is never rotated** *(new in round 2a, from ❓53b)* — no sideways labels anywhere: folded columns, Timeline lanes, chart axes. Horizontal text reads about 80% faster than text turned 90° ([Yu, Park, Gerold & Legge 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2921212)), and astigmatism makes it harder still.

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes. It follows from his 53b answer ("basically what we had before, but without the vertical text").

### G · Ceilings and principles

**47 · Tasks' bar in the brief** — "complete for students, developers, PMs and small teams", with the deliberately-not-built list in §3 as the non-goals.

✅ **Decided 2026-10-09:** yes. (PRODUCT_BRIEF §6 and tasks-v2's out-of-scope list are edited when the spec lands.)

**48 · Principle wording** — ADHD becomes a design lens, not the target user. "Defaults decide; options are few, named and easy to find."

✅ **Decided 2026-10-09:** yes.

**49 · A trust pass before new features** — §7 P0 comes first.

✅ **Decided 2026-10-09:** yes.

**48b · The layout is the product's skeleton** *(new in round 2b, in his words)* — "Moduo's symmetry and the '3 vertical, 3 horizontal' layout is something I really care about… top bar is the global stuff, middle area is the module and context, bottom area are tools related to the viewed module… the left panel serving as the overview with all top-level items for browsing and navigation in a module, middle panel is the main module surface (where most of the work happens and most of the content is displayed), and the right panel is context or details, so deeper stuff… it's the love for this layout that made me work on Moduo."
- **The three rows:**
  - **Top bar:** global.
  - **Middle:** the module.
  - **Bottom bar:** the module's tools, plus each side panel's toggle under that panel, so everything can be hidden and still brought back.
- **The three columns of the middle:**
  - **Left:** overview and navigation.
  - **Centre:** the main surface.
  - **Right:** context and details.
- **The consequence:** no edge strips, rails or extra columns. Switching inside a panel happens in the panel's own title row (❓72a).

✅ **Decided 2026-10-10:** yes, a founding rule.

**50 · Named target roles, and sales** — *"ok, but with other modules this app could become a CRM for some, so maybe sales reps is not something we should ignore?"*

Agreed, with a line drawn.

**Target: founder-led sales and small-team business development** — the founder selling, an agency's new-business person, a consultant's pipeline. Moduo is already shaped for them:
- Contacts with statuses, which work as a pipeline;
- email → task, linked to the person;
- booking links.

Tasks adds:
- follow-up tasks on a contact;
- "Waiting on reply" that clears itself (decided ❓5);
- follow-ups that resurface when someone goes quiet;
- follow-up sequences as templates ("day 0 email · day 3 call · day 7 email", linked to the lead), another reason for ❓9.

**Not a target: quota-carrying reps inside sales organisations.** Their company mandates a CRM (Salesforce, HubSpot) with forecasting, dialers and sequencing, and Moduo shouldn't chase that.

**Effect on this plan:** "follow-ups that resurface from the contact graph" moves from P4 to P3. The pipeline itself belongs to a future Contacts re-plan, not this one.

The other roles stand: the six in §3, plus researchers / PhD students and ops / admin generalists. Teachers and households stay spillover.

✅ **Decided 2026-10-09:** the role list — yes.

❓ Sales as above (founder-led sales and business development in, quota reps out)?

✅ **Decided 2026-10-10:** yes.

**10 · Calibrated estimates**
- After about 10 finished tasks that have both an estimate and tracked time, your own ratio appears in the Queue header ("≈ 7h 30m at your usual pace") and in the run summary.
- It's personal, never changes your estimates, and can be turned off.
- (a) · #323

✅ **Decided 2026-10-09:** yes — Queue header and run summary first.

### H · Agents on tasks *(new in round 1b)*

**51 · How an agent's changes are recorded** — *"should agents add comments to a task when they change it, to keep track of delegated tasks?"*
- **No comment per change.**
  - Every change an agent makes is recorded automatically in the task's activity trail, attributed ("Claude, via Alex's key, set due → Fri"), because every write goes through server ops (§6.1).
  - That record is complete, can't be edited, and doesn't bury people's comments.
- **One summary comment when the agent hands work back:** what it did, its links (PR, doc) and any open questions. This is the part people want to read later.
- **Otherwise, comments only when a person asks** ("leave a note for Sam"). The MCP server's instructions tell agents this; the comment tool still exists.
- **Precedent:**
  - Linear asks agents to report progress as activities, not comments, because comments are editable and noisy.
  - GitHub's coding agent leaves one review request at the end.
  - Jira keeps agent output private until someone publishes it.
- *Recommend: yes.* (b)

❓ OK?

✅ **Decided 2026-10-10:** yes. One adjustment follows from ❓52's privacy rule: the hand-back summary stays with the private session, and "Post as comment" shares it.

**52 · What Moduo shows about agent work** — *re-asked: "I'm afraid of implementing AI controls through our app… focus on states… steps?… agent work shouldn't be forced public"*

**He's right on the main point.** Agent tools change every month: questions, plans, approvals and diffs look different in every client. Drawing any of that in Moduo means chasing other products forever, and it pulls Moduo toward being a built-in AI, which it isn't. **So Moduo shows status, not conversation.**

**What an agent can tell Moduo** (the same five plain fields, whichever agent it is):

| Field | Example |
| --- | --- |
| State | working · needs you · ready for review · failed. "No update for 40m" is computed after 30 minutes of silence. |
| A one-line note | "Writing tests" |
| An optional step count | "step 3 of 5" |
| Links | a PR, a document, the agent's own session page |
| Times | started, last update |

**How it looks:**
- **Row or card:** the agent's name and state in the quiet meta area: "Claude · working". By the brand rule there's no AI colour or badge, just a name and a word.
- **Task:** one line under the title, e.g. "Claude · Writing tests · step 3 of 5 · 2 min ago · PR #42 ↗". Clicking it shows the earlier notes, one per line with times; that list is collapsed by default.
- **"Needs you":** a state with a note ("Needs you: pick a logo direction"), answered in your AI tool, not in Moduo. **No reply box and no question UI.**
- **Notifications:** one, to the person who started the agent, at needs you, ready for review or failed (decided ❓6).

**Steps:** if an agent reports "step 3 of 5", Moduo shows the count next to the current note, and nothing more: no plans, no transcripts, no tool calls. Agents re-plan constantly, so the count is a hint, not a promise. If no steps are sent, the line shows only the note.

**Privacy: private by default.**
- Agent sessions are visible only to the person who started them. Teammates see the task as usual: assignee Alex, In progress.
- **The cost of that default:** a team that works openly with agents, like a dev team, won't see that a bot is on it. So there's one personal setting, "Show my agent work to teammates", off by default.
- **The trail stays honest either way.** Each change shows the person and how it was made: "Alex · via Claude Desktop", where "Claude Desktop" is the name you gave the key. Teammates know who changed what; you choose how the channel is named.
- The hand-back summary (❓51) stays with the private session; "Post as comment" shares it.

**Not in Moduo for now:** sending tasks to agents, answering agents, approving their actions, transcripts. If dispatch comes later, it's a feature of its own.

**Why this is easy to maintain:** five fields any agent can fill through one MCP tool, and the UI is one line plus one mark. Nothing has to change when Claude, ChatGPT or Cursor change their own interfaces.

- *Recommend: yes.* (b) · #323 (the TV-F4 reshape)
- Prototype `round-1c.html`, frame 5: what you see vs what a teammate sees.

❓ OK?

✅ **Decided 2026-10-10:** yes, including the honest trail: teammates see "Alex · via Claude Desktop", using the name you give the key. The plain "Alex" in the prototype was the alternative, now rejected.


### I · Round 1c topics *(new 2026-10-10: one opening call each; details for round 2)*

**48a · ADHD features serve everyone** — a principle in Maciej's words: "The ADHD solutions in our app always have to serve non-ADHD people as well, not work as a trade."

✅ **Decided 2026-10-10:** yes. Every proposal from here on states whether someone without ADHD would want it.

**53 · Backlog: a fifth status** *(re-decides ★21)*
- **The problem:** ideas and "maybe later" tasks pile up inside projects and crowd every active view: All, My tasks, the Board, the sidebar counts. People need to park a task inside its project, with all its details, without committing to it.
- **The options:**

  | Option | Who does it | The catch |
  | --- | --- | --- |
  | **(a) A fifth status** | Linear, Jira | — |
  | **(b) A separate "someday" flag** | Things | Creates odd mixes like "someday" and "in progress" at once |
  | **(c) A section named Backlog** | — | No special behaviour, so it still clutters counts and Upcoming |

- **Recommended: (a).** The statuses become Backlog · To do · In progress · Done · Won't do. A backlog task:
  - keeps its project, section, assignee, tags, estimate and description;
  - is left out of sidebar counts, My tasks, Upcoming, Queue suggestions, drift, late and reminders;
  - sits behind a collapsed "Backlog · 12" line at the end of the project's list, and in a first Board column when grouped by status;
  - moves to To do when you queue or schedule it.
- **The word:**
  - **Backlog** suits teams, developers and PMs, with "Not planned yet" as its description.
  - **Someday** is friendlier for personal lists.
  - **Later** clashes with Upcoming's "Later" group.

  *Recommend: Backlog.*
- **The sequencing trap:** old app versions silently drop tasks whose status they don't recognise (§6.3). That fix must ship in a desktop release first. Only then can Backlog go live; otherwise backlog tasks vanish from old builds. *(53a removes this trap; see there.)*
- (c) · #330, #329
- Prototype `round-1c.html`, frame 6.

❓ Backlog as a fifth status, named "Backlog"?

✅ **Decided 2026-10-10:** a Backlog status, yes. **The word is Backlog** (Maciej: "your call, it's 50/50"):
- Linear, Jira and Plane use it, so imports map one to one.
- It's widely read as "not yet".
- With ❓53a, any project can rename it to "Someday" or "Ideas".

Two follow-ups came with the answer.

**53a · Statuses per project, inside fixed categories** *(re-decides ★21, 22a's "renaming statuses: not proposed" and ❓47's "custom status workflows")* — *"I want status columns to be customizable per project; not allowing that would be a drift from what other products offer for no good reason."*

There was one good reason, and it still holds: **"done" has to mean one thing everywhere.** Focus, Upcoming, My tasks, the counts, Home, boards across projects, agents through MCP and the activity trail all need to know whether a task is waiting, started or finished, whatever its project calls it. Free-form statuses break that: "Shipped", "Live" and "Closed" all mean done, and every view has to be told.

**The model that gives both** is Linear's, and Notion's and Plane's are close to it:
- **Five fixed categories:** Backlog · To do · In progress · Done · Won't do. The app's behaviour hangs on the category.
- **Each project has its own statuses inside them:** rename, add, hide and reorder. Each status belongs to one category. For example:
  - a dev team: Backlog · Todo · In progress · **In review** · Done · Canceled;
  - a creator: **Ideas** (backlog) · **Drafting · Editing** (in progress) · **Published** (done);
  - a student, who never opens the editor: Backlog · To do · In progress · Done · Won't do.
- **New projects start from the workspace default**, set in Settings → Tasks. A template carries its statuses (❓9).
- **Where you edit them:** the project's ⋯ → Statuses, or "+ Add status" at the end of one project's Board grouped by status.
- **Boards across projects** (All, My tasks, views) group by category and show each project's own status name on the card. If every project in view uses the same names, they group by name.

**What it changes elsewhere:**
- **Sections get a cleaner job.** Stages of work (Idea → Draft → Publish) become statuses. Sections are the parts of a project: phases, weeks, milestones, sprints, topics. ❓22a stays for boards grouped by section.
- **§6, my side:** a statuses table per project, with each task pointing to a status. It folds into the one schema cleanup (TV-D7), so it has to be decided before the spec. Old desktop builds keep reading the category in today's status field (a backlog task shows there as To do), so nothing disappears from them, and **Backlog no longer has to wait for a desktop release.**
- *Recommend: yes.* (c) · #330, #329
- Prototype `round-2a.html`, frame 6 (variants: dev · creator · statuses editor).

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes. **His addition: status icons belong to the category, never to a custom status, and nobody edits them.**
- To do is an empty circle.
- Anything in progress, whatever it's called (In review, Drafting, Editing), is a half-filled circle.
- Done is a check; Backlog is a dotted circle; Won't do is a crossed circle.
- The name belongs to the project; the icon belongs to the app.

**His question: "anything else this causes? should I rethink other decisions?"** Nothing needs re-deciding. These follow, and the older text is rewritten in place:
- **Sections and statuses:**
  - Sections are now only the parts of a project: phases, weeks, sprints, milestones, topics.
  - Stages of work are statuses.
  - §2, ★18 and 22a are reworded, and a creator now opens on the Board grouped by status (§3).
- **Adding columns:**
  - A single project's Board grouped by status gets "+ Add status"; grouped by section, it gets "+ Add section".
  - "Column" still never appears as a word.
- **Boards across projects** group by category, and each card shows its own project's status name.
- **Finishing and repeating:**
  - Done in Focus, a finished repeat, and an agent's "complete" all set the project's first Done status.
  - A repeat comes back in the project's first To do status.
- **Moving a task to another project:** it keeps its status if that name exists there; otherwise it takes the first status of the same category.
- **Templates** and "Duplicate project…" carry statuses (❓79).
- **Imports:**
  - Linear and Jira map one to one, because both already use categories.
  - Trello lists become statuses, with a guessed category you confirm.
  - Todoist and Asana sections stay sections.
- **Agents (MCP)** read and write either the category or the project's own status name.
- **Filters** offer categories everywhere, and status names inside one project.
- **A "Waiting" or "Blocked" status:** someone may add one, and that's allowed. The default stays the Waiting field, because it records who and since when.

**53b · A folded column keeps its name horizontal** — *"very hard to read sideways… let's look for a different solution, or prove this is better."*
- **Rotation isn't better.** Horizontal text reads about 80% faster than text turned 90° (46a), and astigmatism makes it worse.
- **The fix:**
  - A folded column shrinks to its header, which stays horizontal: "Backlog · 6", on one line, about 120 px wide.
  - The full height stays a drop target, and a click unfolds it.
  - Folded columns keep their places, so Backlog stays first.
  - Linear does the same for hidden columns: they stay on the board and still take drops ([docs](https://linear.app/docs/board-layout)).
- **The rule behind it** becomes north-star rule 46a: text is never rotated.
- *Recommend: yes.* (a) · #329
- Prototype `round-2a.html`, frame 6.

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** his version. Backlog shouldn't be a big panel that's always visible, so a folded column is **a small button, not a full-height column**:
- The Backlog icon, the count and a chevron, stacked vertically, about 32 px wide, in the column's place.
- No text, so nothing is rotated. Hover shows "Backlog · 6".
- Drops work only once it's unfolded; that's a rare action.
- Backlog starts folded on every board. The List keeps its quiet "Backlog · 6" line at the end.
- Prototype frame 6, redrawn.

**54 · Teams of people: routing now, permissions later**
- **What it is:** named groups of members, set up in Settings → Members, e.g. Design, Development, Board, Marketing.
- **The scoping question first.** There are two uses, with different costs:
  - **Routing (Tasks, now):** give a task to a team when you don't know who'll do it.
    - A task gets an optional **team** next to its optional assignee (still one person; decided).
    - Members see unclaimed team tasks in My tasks ("For Design · 2 unclaimed") and take one with one click. The team stays on the task as context.
    - Filter and group by team; the team-load widget can show teams.
    - `@Design` in capture routes the task, consistent with `@` meaning "mention anything".
  - **Access (Settings and permissions, later):** share a project with a whole team. This changes the permission model (Tier 2), so it gets its own spec.
- **Mentioning a team in a comment** sends its members a single digest notification, not a ping each. Otherwise `@Design` becomes Slack's @channel.
- **The name:** **Teams**, because people say "the design team", and GitHub's Team plan has teams, so the plan name can coexist. "Groups" clashes with Display's "Group by".
- *Recommend: yes. Routing in this re-plan, access later, named Teams.* (b)
- Prototype `round-1c.html`, frame 7.

❓ OK?

✅ **Decided 2026-10-10:** yes.

**55 · References: one spine spec for chips, cards and previews**
- **What it is:** one way to show a linked item anywhere in the app: tasks in notes, emails on tasks, contacts in descriptions, anything in chat.
- **Four presentations:**
  - **link:** inline text with a type icon;
  - **chip:** an inline pill with one live fact, such as a task's status and due date or a contact's avatar;
  - **card:** a block with the item's key facts and one action;
  - **hover preview:** the card, shown when you hover over any link or chip.
- **Live:** status and titles update in place; a deleted item reads "Deleted task".
- **Your choice, per reference:** after inserting one (`@` or paste), a small "Show as: Link · Chip · Card" menu. The defaults:
  - in running text, a chip;
  - alone on a line in a note or description, a card;
  - in chat, a chip in the text plus preview cards under the message (collapsible; the sender can remove them).
- **A hard rule from day one:** if you can't see an item, its reference reads "Private item", with no title and no preview.
- **Each module defines its item's preview:**

  | Item | Chip | Card |
  | --- | --- | --- |
  | Task | status · title · due | status, title, handle, project › section, assignee, due, subtasks n/m, waiting; one action: complete |
  | Email | — | sender, subject, two-line snippet, date, message count, "Waiting on reply" |
  | Contact | avatar · name | avatar, name, role · company, last contact, open tasks |
  | Note | — | title, excerpt, who edited it and when |
  | Event | — | title, time, people |

- **Where it lives:** one spine spec, "References", that also absorbs the reference grammar (GR-0: `@` `#` `/`), so grammar and presentation can't contradict each other.
  - Tasks v3 depends on it. It builds the primitive (Tasks is the north star) and the task, email and contact previews.
  - Notes and Chat adopt it when they're rebuilt.
- *Recommend: yes.* (b)
- Prototype `round-1c.html`, frames 2–4.

❓ OK?

✅ **Decided 2026-10-10:** yes.

**56 · Long descriptions**
- **In the panel:**
  - A description shows about 8 lines, then fades into "Show more · 2 tasks · 1 email", counting the references hidden below the fold.
  - "Show less" sits at the end.
  - Editing always shows the whole text.
  - A card is never cut in half; the fold moves above it.
- **Nothing gets lost:** every item mentioned in the description is also listed in Linked, with its preview card.
- **The full-page view** (❓32) never collapses.
- **Rows and cards never show the description;** the hover preview shows its first three lines. For creators and PMs, Display offers a "Description preview" option for board cards, off by default.
- **In capture,** the description field grows to about 6 lines, then scrolls.
- *Recommend: yes.* (a/b)
- Prototype `round-1c.html`, frame 3.

❓ OK?

✅ **Decided 2026-10-10:** yes.

**57 · "Along the way" in runs** *(from Mike's research, §10)*
- **The offer:** in a run, when the next task belongs to a different project, Moduo offers **one** small task from the project you're leaving: "Before you leave Acme: Send invoice #14 · 5m — Take it · Not now".
  - Only tasks with an estimate of 15 minutes or less.
  - Never more than one offer per project change.
  - "Not now" costs nothing. After three "Not now"s on the same task, the next offer becomes "Shrink · Move · Let go".
- **Seeing the switches:** thin dividers with the project name separate projects in Up next. The Queue header gets **"Arrange by project"**: it groups your line-up by project, keeps your order inside each, puts high priority first, explains itself ("3 switches instead of 7"), and can be undone.
- **Would someone without ADHD want it?** Yes. Doing small tasks while you're already in a project saves a switch for anyone. Task-switch costs are well established; attention residue is moderate evidence.
- **Evidence for the "along the way" urge itself** (pre-crastination): moderate for the behaviour, early for the explanation.
- *Recommend: yes.* (b) · #323, after TV-F2/F3
- Prototype `round-1c.html`, frame 8.

❓ OK?

✅ **Decided 2026-10-10:** yes. The Focus redesign (group J) shows the offer only in the moment between two tasks, never as a standing line.

**58 · Cues: "Remind me when…"** *(from Mike's research, §10; builds on ❓24)*
- **Besides a time, a reminder can wait for a moment in the app:**
  - when I open a particular project, contact, email thread or note;
  - when my next meeting with a particular person is about to start;
  - later, when I next chat with a particular person.
- **It shows once, quietly, where you are** ("Next time with Anna: ask about invoice #14"), never as a pop-up. The task stays in its project.
- **Would someone without ADHD want it?** Yes. "Next time I talk to Anna, ask about X" is universal; Apple Reminders has "when messaging a person". It's also uniquely Moduo, because the spine knows who a meeting or thread is with.
- **Evidence:** if-then plans are strong (d ≈ .65). Cue-based remembering being more robust than time-based remembering in ADHD is early evidence.
- *Recommend: yes.* (b)

❓ OK?

⏸ **Parked 2026-10-10:** a good idea, not now. Its triggers live in other modules (projects, contacts, threads, meetings), and those may be rebuilt soon (§0). Time-based reminders (❓24) go ahead.

**59 · One setting for suggestions** *(from Mike's research, §10)*
- **The setting:** Settings → Tasks → **Suggestions: Off · During runs · Everywhere**.
  - **During runs** (the default) shows "along the way" offers only at task boundaries in a run.
  - **Everywhere** adds "while you're here" strips when you open a project or contact, and lines like "18 min until your Acme call · 2 quick tasks fit" before meetings.
  - **Reminders and cues you set yourself** (❓24, ❓58) always fire, whatever the setting.
- **Why "During runs" is the default:** a task boundary in a run is the cheapest moment to interrupt, because you're between tasks and already in doing mode (breakpoint research). It also keeps the rest of the app quiet.
- **Not proposed:** modes that change themselves as habits form ("fading"). The ADHD evidence lane found people prefer controls they set over ones that adapt by themselves.
- *Recommend: yes.* (b)

❓ OK?

✅ **Decided 2026-10-10:** yes, with "I don't feel like I fully understand the consequences". 59a answers that, and simplifies the setting.

**59a · One switch, and what it changes**
- **Why it shrinks:** with ❓58 parked and ❓60 dropped, "Everywhere" has almost nothing left in it, because its project strips and pre-meeting lines came from those two.
- **The setting becomes one switch:** Settings → Tasks → **"Offer quick tasks along the way"**, on by default. It's also in Focus's ⋯ menu.
- **What it changes, in one scenario:** you finish "Logo concepts" in Acme, and the next task in Focus is from Website.
  - **On:** for a moment between the two, one line appears: "Before you leave Acme: Send invoice #14 · 5m — Take it · Not now".
  - **Off:** you go straight to the Website task.
- **What it never touches:**
  - reminders you set always fire;
  - nothing is suggested outside Focus;
  - nothing changes by itself over time.
- *Recommend: yes.* (b)

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes ("I love how it looks between tasks"). **Later, not now:** he'd also welcome short, related suggestions outside Focus. That waits for the module rebuilds (§0), where "related" can be defined module by module. The switch then gains a second option: In Focus · Everywhere.

**60 · The rest of Mike's ideas: explore in round 2?**
- **Worth exploring** (details in §10):
  - a **first step** on the Now card (the next open subtask), with an optional "Just start · 2 min";
  - a **quick sweep** run: your small tasks, smallest first, for 15 minutes;
  - **meeting prep:** tasks involving the people in your next meeting, shown before it starts.
- **Not adopted, with reasons in §10:**
  - the Metro status language;
  - the four-size ladder;
  - "Step away" trips;
  - modes that adapt by themselves;
  - reordering quick tasks before long ones;
  - spatial "doors".
- *Recommend: explore the three in round 2.*

❓ OK?

✗ **Decided 2026-10-10:** not now. The decided work (48a, 57, 59a) closes enough of the gap, so there's no more ADHD-specific exploration this round. The three ideas stay in §10 for later.

### J · Round 2a: Focus, the Timeline, the right panel, gaps *(new 2026-10-10)*

Prototype: [`round-2a.html`](./prototypes/round-2a.html). Each call names its frame.

#### Focus

**61 · The Queue becomes "Focus"** — *"Focus is more catchy than Queue… Queue sells itself more like 'upcoming' on first glance."*
- **Agreed, and it fixes a real confusion.** "Queue" and "Upcoming" both read as "what's coming", while the feature is about *doing*. "Focus" names what you do there.
- **One name for the list and the doing:**
  - The sidebar item is **Focus**.
  - Inside it, your line-up is **Up next**, and ▶ **Start** works through it.
  - "Focus on this" (⇧F) now reads as what it does: put this on top and start.
- **What changes with the name:**
  - "Add to Focus" replaces "Add to queue" in menus and tooltips. The key stays **Q**: shortcuts don't have to spell the word, and Q is already learned.
  - Sidebar order: Inbox · Focus · Upcoming · My tasks · All (❓29).
  - The app-wide chip that shows a running session already says "Focus"; now the list matches it.
  - Every other place the app says "Queue" today follows.
  - Internally (database, MCP) it stays "queue". Only the words change.
- **Collisions checked:** "focus" already names the running-session chip and the Pomodoro's work interval. Both mean focused work, so they reinforce the name.
- **The evidence:** of 13 tools checked, six call the doing surface "Focus" and none calls the list "Queue" ([focus research](./research/focus-competitors.md) §5). Nobody has published a test of which name is clearest, so this rests on convention.
- **Plain verbs inside:** Start · Pause · Done · Stop.
- *Recommend: yes.* (c, wording only) · #323, #328

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes: **Focus**.

**62 · One quiet header; the timer sits on the task it times** — *"2 lines above the task, one line at the top, a suggestion below… a pause button right next to End run is risky… Running and the timer repeat each other."*
- **The header keeps only the view's name and ⋯:** "Focus · ⋯".
  - "Running · 2 of 7 done" goes. Progress is already shown by "Up next · 4" and by "2 done · 1h 12m" at the bottom.
- **The timer is one pill on the Now card, top right:** `⏸ 18:02 of ~45m`.
  - Pause is part of the pill: click it. Paused, it reads `▶ Paused · 18:02`.
  - One number per job: the pill is this task, the bottom line is the whole session.
- **When the estimate runs out,** the pill shows a neutral "+5m", never red or orange.
- **Stopping is far from pausing:**
  - **Stop** lives in ⋯, at the other end of the row, and in the app-wide chip. It's never next to Pause.
  - Stopping shows "Stopped · Undo" for 10 seconds instead of asking "are you sure?".
  - The current task stays on top for next time.
  - **Leaving the Focus view never stops a session.** It keeps running in the app-wide chip, as in Sunsama.
  - A session also ends by itself when Up next runs out.
  - Every tool checked puts pause on the timer, and none puts a bare End next to it. Session hides End in a menu, and Structured puts it in the far corner ([focus research](./research/focus-competitors.md) §1).
- **The Now card's top line is one quiet line:** project › section · due.
  - Priority shows as a mark only when it's high.
  - The subtask and link counts go, since you can see both below.
- **"Arrange by project" moves into Up next's header.**
  - It shows only when it would save at least two switches: "Arrange by project · 3 fewer switches".
  - Undo is a toast.
- **Between tasks, nothing waits on screen.** The "along the way" offer (❓57) appears only in the moment after Done, in place of the next card, and needs one answer: Take it or Not now (Esc).
- *Recommend: yes.* (a) · #323
- Prototype frame 1 (variants: running · paused · between tasks).

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** the layout, yes ("I like this layout much much more visually"). His worry, "oversimplified… reduces usability for looks", is answered in 62a.

**62a · Nothing was cut: where every piece went, and Pomodoro** — *"what happens with pomodoro?… maybe a switch between a global pomodoro (pill next to the ⋯ button) and a stopwatch (per-card) could live under ⋯?"*

| Before | Now |
| --- | --- |
| "Running · 2 of 7 done" | "Up next · 4", and "2 done · 1h 12m" at the bottom |
| The run's timer | The pill on the task (Per task), or the Pomodoro pill (below) |
| Pause | Inside whichever pill is showing |
| End run | **Stop**: in ⋯ and in the bottom bar's Focus chip, with Undo |
| Arrange by project | Up next's header when it saves switches, and ⋯ |
| Pomodoro phases and breaks | Timer → Pomodoro (below) |
| "Along the way" | The moment between two tasks |
| The meeting line | A divider inside Up next |
| What you did this session | "2 done · Show" at the bottom |

**Pomodoro, his idea, kept:** Timer has three settings, **Per task · Pomodoro · Off**.
- **Per task** (the default) is the pill on the task, as in frame 1. "Count down the estimate" is an option under it.
- **Pomodoro** puts the session's rhythm in one pill in the header, next to ⋯ ("Focus 18:40", then "Break 4:12"), with pause inside it.
  - Lengths are set in the same menu (25/5 by default).
  - When a work phase ends, the between-tasks moment offers "Take a 5-minute break · Skip".
  - Time is still recorded per task, quietly, in the task's Time field. The card carries no second clock.
- **Off:** see ❓63.
- **Wherever you are in the app,** a running session also shows in the bottom bar's Focus chip, which is where it lives today.
- *Recommend: yes.* (a) · #323
- Prototype frame 1 (variants: Pomodoro · ⋯ menu open).

❓ OK?

✅ **Decided 2026-10-10 (round 2c):** yes.

**63 · Time tracking is optional, and off means off** — *"If someone isn't tracking time, then they need neither."*
- **One setting**, in Focus's ⋯ and in Settings → Tasks: **Timer: Elapsed · Countdown · Off**. Elapsed is the default.
  - **Countdown** counts down the task's estimate, which helps anyone who loses track of time. With no estimate, it counts up.
  - **Why on by default:** your usual pace (❓10) and time by client (❓8) both need recorded time.
- **Elapsed or Countdown:**
  - the pill shows the time;
  - the time is added to the task;
  - your usual-pace line appears after about 10 timed tasks (❓10).
- **Off:**
  - no pill, and nothing is recorded;
  - Focus still works: Start, Done, Skip and Hand off;
  - Up next still shows estimates where tasks have them;
  - the usual-pace line doesn't appear, because it needs times.
- **Why not record quietly anyway,** as Amazing Marvin does ([focus research](./research/focus-competitors.md) §2): Marvin is a one-person app. In Moduo, a task's total time is visible to everyone who can see the task, so time recorded for someone who turned the clock off would show up there and feel like being watched.
- *Recommend: yes.* (a) · #323
- Prototype frame 1, variant "no timer".

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes, as one of Timer's three settings (62a). **His question: where is it switched, and what's in the list?**
- **Focus's ⋯ menu, top to bottom:**
  1. **Timer ▸** Per task · Pomodoro · Off. "Count down the estimate" sits under Per task, and "Pomodoro lengths…" under Pomodoro.
  2. **Arrange by project.** It's also in Up next's header whenever it saves switches.
  3. **Offer quick tasks along the way** ✓ (59a).
  4. **Show what's done this session.**
  5. A hairline, then **Stop**, with its shortcut, at the bottom and away from everything else.
- **Settings → Tasks → Focus** holds the same settings as your defaults, and the menu changes them everywhere.

✅ **Decided 2026-10-10 (round 2c):** yes (the ⋯ menu as listed).

**64 · Your next meeting shows inside Up next, not above the task** — *"is there any other way to display that information, and will it only really be displayed when we have an upcoming event shortly?"*
- **The "18 min until Acme call · 2 quick tasks fit" line goes.**
- **In its place, a divider inside Up next, where the meeting falls:** "── 2:30 PM · Acme call ──".
  - Tasks that fit before it sit above the line, the rest below it, using your estimates.
  - Without estimates, the divider sits at the top of Up next.
- **When it shows:** only for events you're attending, within the next two hours or before your line-up runs out. Otherwise there's nothing.
- **"2 quick tasks fit" is dropped.** It was the "Everywhere" idea that 59a removes.
- **The evidence:** no tool checked puts the next event above the task. Akiflow shows it at the bottom, Notion Calendar only within a lead time, and Structured at the screen edge ([focus research](./research/focus-competitors.md) §4).
- **Without ADHD too?** Yes. Anyone working between meetings sees what fits.
- *Recommend: yes.* (b) · #323
- Prototype frame 1, variant "meeting ahead".

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes ("it's great").

**65 · Subtasks become steps you can work in** — *"subtasks… didn't get enough real estate and respect… If we have important references or description in the subtasks, then the current view doesn't allow us to view them."*
- **When the task in Focus has subtasks, you step into them.** The Now card shows:
  - **the parent as one line:** "Acme rebrand › Logo concepts round 2 · step 2 of 4". Its description is one click away.
  - **the current step as the big item:** its title, its description (folded at about 6 lines, ❓56), its references as chips you can open, and its files;
  - **a compact step list underneath:** done steps ticked, the current one marked, and small marks on the rest for what they hold ("1 file · 2 links").
- **The actions:**
  - **Step done ⏎** · Skip step · Hand off W.
  - On the last step, ⏎ reads **Done ⏎** and finishes the task.
  - ⇧⏎ finishes the whole task at any time.
- **Steps don't have to go in order.** Click any step to make it the current one.
- **Up next folds to one line** ("Up next · 4 · ~1h") while you're in a task's steps, to give the step the room.
- **The evidence:**
  - Every focus tool gives subtasks the body of the screen, but only as bare checklist rows. None shows a subtask's own notes or links inside focus, so Moduo would be first.
  - Amazing Marvin and Todoist can show one step at a time, with the parent linked above ([focus research](./research/focus-competitors.md) §3).
- **Anything referenced opens in the right panel**, with a back arrow, so reading an email or a note never means leaving Focus. The panel's **Task** view shows the whole task: description, every step, comments and files (❓72).
- **The alternative (variant B):** keep the parent big and unfold the current step inside the checklist. It's what you suggested ("expandable tasks with more details"), and it's closer to the other tools.
  - It shows the whole list at once, but gives each step less room, and "Step done ⏎" sits under the parent's title, which reads oddly.
- **Why A:** in Focus you work on one step; the panel's Task view is where you see the whole task. The two layouts behave the same way and differ only in what's big, so frame 2 shows both.
- **Without ADHD too?** Yes. It's how anyone works through a brief with parts, and it's the "one thing at a time" that Focus exists for.
- *Recommend: steps (A).* (b) · #323
- Prototype frame 2 (A: steps · B: unfolded inline).

❓ A or B?

✗ **Not steps, not inline (round 2b):** *"The subtasks are not necessarily going to be ordered as steps… Subtasks can be complex, and how the parent-child relation is weighted in complexity is the user's choice… we'd force the users to build less complex subtasks and more complex parent tasks."*

**65a · Variant C: the focused task stays; a subtask opens its own details in the right panel**
- **The Now card keeps the focused task:** its line, title, description and references, then its subtasks as a checklist that implies no order.
  - Each subtask row carries small marks for what it holds: "1 file · 2 links · notes".
- **Click a subtask** and the right panel shows *that subtask's own* details:
  - its description, files, links, comments and activity, with the parent as a breadcrumb at the top;
  - nothing the Now card already shows is repeated;
  - the panel's title becomes the subtask's name, with a back arrow to In flight (❓72a).
- **Check a subtask off** from the list or from its panel.
- **⏎ is Done for the focused task again.** There are no steps.
- **A subtask can become the focus:** ⇧F on it, in the list or in its panel, makes it the Now card, with its parent as the breadcrumb. A complex subtask gets the whole card whenever you want it, so nobody has to flatten their work to fit the screen.
- **References anywhere on the card** (an email, a note) open in the panel the same way. It's the same rule as List, Board and Timeline: click an item, and its details open on the right.
- *Recommend: C.* (b) · #323
- Prototype frame 2 (variant C).

❓ C?

✅ **Decided 2026-10-10 (round 2c):** C ("good").

**66 · Focus stays visible for everyone, with three ways in** — *"useful enough that we shouldn't hide it from the users that just started… some users wouldn't find any use for it — particularly ones that don't actually complete short tasks one-by-one."*
- **Visible by default for every role.** Anyone can hide it in Customize sidebar (❓29a), and nothing hides it on its own.
- **Three ways in, so it isn't only for short tasks:**
  1. **A line-up:** several small tasks, worked through in order. This is the classic session.
  2. **One big task:** ⇧F runs a single task, step by step (❓65), e.g. a developer's ticket for the day, a student's essay, a designer's deliverable.
  3. **Today's calendar:** when Up next is empty and you have tasks scheduled today, Focus offers "Line up today's 3 scheduled tasks", in time order. ▶ on a task's block in Calendar does the same as "Focus on this", with the same one clock. This is for people who plan by calendar.
- **The empty state teaches all three** in three short lines, and Tasks' welcome step 2 shows Focus (❓34).
- **Who will still skip it:** people who mostly coordinate others' work. They lose nothing, because Focus never pushes.
- *Recommend: yes.* (a/b) · #323
- Prototype frame 3 (the empty state).

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes, with his change: **today's scheduled tasks show as real task rows, not a summary.**
- Click one and its details open in the panel, the same rule as 65a.
- "+" adds just that one to Up next; "Line up all 3" adds them all.
- Prototype frame 3.

#### The Timeline

**What's wrong today** (screenshot and code audit):
- **Most "bars" are fakes.** Most tasks have only a due date, so most bars are fades pretending to be spans.
- **Text breaks:**
  - labels sit outside the bars and get cut ("Already shipp…");
  - lane headers shout in small caps ("DEEP WORK 6");
  - with no name column, a title's position depends on its date.
- **The structure doesn't show:**
  - the grid is invisible;
  - undated tasks sit in a chip tray at the bottom;
  - there are no project bars or phases, so the PM's roadmap doesn't exist.
- **Underneath:**
  - no keyboard;
  - nothing virtualized: a 34,000 px canvas at Week;
  - drags stop at the edge of a fixed window.

**What the leaders do** ([timeline research](./research/timeline-competitors.md), 13 tools, 49 sources):
- **Projects or epics as bars, milestones as markers:** Linear, Jira, GitHub's roadmap, Basecamp's Lineup. Linear's timeline shows *only* projects; issues never appear on it.
- **A task with just a due date is a small point with its name beside it** (Asana).
- **Long names:** Asana fixed cut-off names with a name column.
- **Bar height:** monday's 2025 redesign doubled bar height, and users said half as many rows fit.
- **Gaps we can own:** nobody documents moving dates from the keyboard, and nobody draws work sessions on a timeline.

**67 · Rows follow the scope: projects across the workspace, tasks inside a project**
- **All, or one area:**
  - area headers, then **one row per project**: its bar from start to target, its dated sections on the bar, and a thin progress line;
  - expand a project (▸) to see its tasks, by section;
  - it opens at Quarter.

  This is the PM's and founder's roadmap.
- **Inside a project:**
  - the project row on top, then its sections and their tasks;
  - it opens at Month.
- **My tasks and Upcoming:** grouped by project; teams can group by assignee.
- **Subtasks** are hidden by default. When shown, they're nested and indented.
- **Students: the term at a glance.**
  - An optional **"due per week" count** in the header shows which weeks are crowded, which the research found students want more than bars.
  - Expanding a course shows its deadlines as points.
  - The student role turns the count on by default (❓34: roles change defaults only).
- *Recommend: yes.* (b) · Timeline rebuild
- Prototype `round-2a.html`, frame 4 (variants: Quarter · Due per week).

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes.

**68 · Each date is drawn as what it is: tasks are points, projects and sections are spans**

| The item | Drawn as |
| --- | --- |
| A task with a due date | A **circle** (12 px) on that day |
| A task with only work sessions | A **hollow circle** on its next session |
| A task past its due date | Its circle in the muted "late" tone (❓23), where it was. Never red |
| Done | Hidden by default; with Show done, muted with the done check |
| A repeat | Its next occurrence only, with the repeat mark |
| A section with one date | A **diamond**: the milestone |
| A section with a range ("Sprint 12 · Oct 13–24") | A **band** behind its tasks, and a segment on its project's bar |
| A project | A **bar** from start to target. Solid when you set the dates; an outline when they're worked out from its tasks |

- **No task bars:**
  - Moduo tasks have no start date, and making one up is what ClickUp users complain about: its Gantt invents a start date when you drag.
  - Work that takes three weeks is a section (a phase) or a project.
- **The fade goes.** Jira Plans uses a fade to mean "date unknown", which is wrong for the most common kind of task.
- **This re-words decided ❓19,** "a task with only a due date is the point milestone". Tasks become circles, and diamonds mean a dated section, the milestone.
- **Who feels it:** a PM used to Asana or monday can't stretch a single task across days. Duration lives on phases (dated sections) and projects instead.
- *Recommend: yes, circles for tasks and diamonds for sections.* (c, wording) · Timeline rebuild
- Prototype `round-2a.html`, frames 4–5.

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** the direction, yes ("I really like it"). His three questions and the visual pass are in 68a.

**68a · Section dates, the diamond, and what "no task bars" costs** — *"if the diamond is a section, why is it not on the section, but at the bottom of the project?… Where do we set that label and its dates? Is it still possible to not set project's dates, but only set section dates?"*
- **The diamond belongs on its section's own row.** The prototype used a section with no tasks ("Client sign-off") as a milestone and drew it at the bottom, where it looked like a stray task. That's fixed. The rule: every section has one header row, and its date shows *on that row*:
  - a **range** ("Design · Oct 13–24") is a band across that row and behind its tasks;
  - **only an end date** ("Design · by Oct 24") is a diamond on that date, on that row. That's all a milestone is here: the date a part of the project has to be done by.
- **Where dates are set:**
  - **a section:** the date chip next to its name (in the List, Board and Timeline headers), or ⋯ → Set dates, or by dragging its band or diamond on the Timeline;
  - **a project:** the "Target" chip in its header, plus an optional start, or by dragging its bar.
- **One word per kind:** tasks are *due*, sections *end* (or run from–to), and projects have a *target*. Hovering always spells it out: "Design ends Oct 24".
- **Yes, a project can have no dates of its own.** Its bar is then the outlined one, worked out from its sections and tasks, and it fills in as you date them.
- **The visual pass** fixes what read as broken:
  - empty boxes between phases: now one continuous bar with a quiet gap;
  - bands that didn't line up with their rows;
  - the stray diamond;
  - a dependency line that wandered across rows: now a short, direct path, for the selected task only.

  Prototype frames 4–5, redrawn.
- **What "tasks are points" gains and costs:**

  | | |
  | --- | --- |
  | **Gains** | Every mark is a date someone set, never a guess. Rows stay readable with hundreds of tasks. No third date field to learn (due, scheduled and target are enough). It's the picture Linear users already know. |
  | **Costs** | A PM coming from Asana or monday can't stretch a single task across days. That duration goes on a phase (a dated section), or into work sessions on the Calendar. Imports drop task start dates, and the import summary says so. Critical-path planning isn't possible (❓71). |
  | **Who feels it** | Agencies and PMs who plan in task-level Gantt charts. Students, developers, founders and creators don't. |

- *Recommend: yes.* (a)

❓ OK?

✅ **Decided 2026-10-10 (round 2c):** yes ("looks much much better").

**68b · Dates that contradict a dependency** — *"do we prevent tasks depending on something that comes after its due date, or other things that could mess up how the arrow is drawn?"*
- **Don't prevent; show it quietly and offer one fix.** Dates and dependencies are both facts people set, and plans change in either order. Refusing a date would be a wall; the rule is "mirrors, not walls".
  - When a task is due before something it waits on, its arrow runs backwards, in the muted late tone.
  - The waiting task gets a small mark: "Waits on *Export logo files*, due after this".
  - One click offers "Move to Nov 8", the day after the blocker. Nothing moves by itself.
- **Already impossible:** loops. A task can't end up waiting on itself through a chain, because the database refuses it.
- **Every other case where an arrow has nowhere obvious to go:**

  | Case | What's drawn |
  | --- | --- |
  | The blocker has no date | The arrow starts at the name column's edge, from a small "no date" stub |
  | The blocker is in another project | A short stub at the row's edge: "↗ Website · Fix nav" |
  | The blocker is hidden (filtered out, or in a folded group) | The arrow ends at the folded group's header, or at a stub |
  | The blocker is done | No arrow, unless Show done is on |
  | Both are on the same day | A short vertical hook |

- *Recommend: yes.* (a)

❓ OK?

✅ **Decided 2026-10-10 (round 2c):** yes.

**69 · Anatomy: a name column, slim bars, quiet structure**
- **A sticky name column on the left:**
  - 280 px by default, resizable from 200 to 480; ⇧[ hides it.
  - Titles live there, so nothing is cut by a bar.
  - Bars show a name only when it fits inside.
- **Sizes follow density:**
  - **Rows:** 36 / 32 / 28 px.
  - **Project bars:** 24 / 22 / 20 px, never taller than about 1.2× their label.
  - **Bar style:** a neutral fill, a 3 px cap in the project's colour, and a 2 px progress line.
  - **Points and diamonds:** 12 px.
- **The time header:**
  - two lines (month above; weeks or days below), sticky, with a "Today" pill;
  - group headers stick under it in sentence case: "Design · 2 of 5 · Oct 14".
- **Colour:** accent only for the selection, today's 1 px line and the done check (46).
- **Grid:** hairlines per unit, stronger at month starts, with a faint weekend tint at Week and Month.
- **Zoom:** Week · Month · Quarter · Year, and ⌘-scroll also zooms.
  - It scrolls endlessly both ways, drawing only what's on screen (❓37).
  - It opens with today a quarter of the way across.
- **No rotated text anywhere** (46a).
- *Recommend: yes.* (a/b)
- Prototype `round-2a.html`, frames 4–5.

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes.

**70 · Undated tasks, and working on the canvas**
- **The bottom tray goes.** "No date · 12" in the toolbar opens the panel's **No date** view (❓72). Drag a task from there onto a day.
- **Clicking an empty spot:**
  - on a task's row, it sets the due date there;
  - on a project's row, it draws a bar, or you can drag to draw one.
- **The whole canvas takes drops,** which fixes today's 8 px drop strip.
- **Dragging:**
  - a point moves its due date;
  - a diamond moves its section's date;
  - a project bar moves as a whole, and its ends resize.
  - Nothing drags between groups, so dragging never reassigns.
- **Several at once:** select several and they move together. The view scrolls when you drag near its edge.
- **Undo** follows default (a).
- **The keyboard:**
  - the rows are a real list (↑↓), so screen readers can follow;
  - ⌥←/→ moves a date a day, and adding ⇧ moves it a week;
  - D opens the date picker, T jumps to today.
  - The final letters go into the one key map (default b).
- **Dependencies:**
  - lines show only for the selected or hovered item, plus "Show all" in Display;
  - moving a task never silently moves the ones after it; it offers "Also move the 3 that wait on this".
- *Recommend: yes.* (b)
- Prototype `round-2a.html`, frame 5 (variant: No date panel).

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes.

**71 · Display options, and what's left out on purpose**
- **Display** uses the same grammar as List and Board:
  - Group by;
  - Show done (Hidden · 7 days · All);
  - Colour by (project · status category · none);
  - Dependencies;
  - Show sessions;
  - Show repeats;
  - Subtasks;
  - Due per week.
- **Left out:**
  - baselines, critical path, slack, and lead and lag;
  - auto-scheduling, workload lanes, scenarios;
  - hidden weekends and working-day calendars;
  - red health and forecasts;
  - packed lanes, task start dates, an Inbox lane, and drag-to-reassign.

  These are what make Jira, monday and ClickUp timelines heavy, or they're traps.
- **Empty state:** the rows are still listed, with the today line and one sentence: "Nothing has a date yet. Click a day on a row, or open No date."
- *Recommend: yes.* (a)

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes. **His question: why are these left out, and what do we gain and lose?**

| Left out | What it is | Why it's out | What we lose | Who'd miss it |
| --- | --- | --- | --- | --- |
| Baselines | A frozen copy of the plan to compare against later | Small teams rarely look back at a frozen plan; "late" and drift already show slippage | A before-and-after picture of the schedule | PMs reporting to clients |
| Critical path, slack, lead and lag | The chain of tasks that sets the end date, and each task's spare time | Impossible by design: they need task durations, and tasks are points (68a) | Formal schedule risk | Construction-style project managers |
| Auto-scheduling | The app moves your dates for you | Dates would change without you ("mirrors, not walls"); it's the most common complaint about Motion | Automatic re-planning | People who like Motion |
| Workload lanes | Capacity bars per person | Reads as surveillance in a small team; the team-load widget (❓12) shows ownership instead | Hour-level capacity planning | Resource managers at 20+ person agencies |
| Scenarios | Alternative what-if plans | Enterprise planning that doubles every date | Comparing plans side by side | Portfolio managers |
| Hidden weekends, working-day calendars | Collapsing weekends; per-person working days | Complexity for a small gain; weekends are tinted instead | About 2/7 of the width | People planning dense multi-week work |
| Red health, forecasts | "At risk" colours and predicted end dates | The no-red rule; without durations, predictions are guesses | An at-a-glance alarm | Executives scanning many projects |
| Packed lanes | Several tasks in one row | Hard to read and to click | Vertical density | Very large plans |
| Task start dates | A start field on every task | See 68a | Task bars | Gantt-trained PMs |
| An Inbox lane | Unfiled tasks on the plan | Unfiled means unplanned; they live in No date | — | — |
| Drag-to-reassign | Dragging between people's rows changes the assignee | Too easy to do by accident; assigning stays explicit | One gesture | Leads re-balancing work |

None of this is ruled out for good; each can come back if real use asks for it.

#### The right panel

**72 · One way to switch the right panel, for every module** — *"The tabs at the top of the right panel can't work the way they're now… notes, calendar, chat or email could have more panel options that could serve as context for whatever the user is doing."*

**Today:** each module puts a full-width segmented control at the top of its panel:
- Tasks: Details (In flight was planned next);
- Calendar: Tasks · Detail · Notes;
- Email: Reader · Contact · Detail · Task;
- Notes: Detail · Comments · Outline · Task;
- Contacts: Notes.

**Why it doesn't last:**
- Four segments already crowd a 300 px panel, and a fifth won't fit.
- The words drift between modules ("Detail" vs "Details").
- Two different jobs share one control:
  - **about this:** the selected item's details, comments, outline;
  - **alongside:** another module's list to work next to, such as Tasks beside a calendar or Notes beside an email.

**The options:**

| | What it is | Gains | Costs |
| --- | --- | --- | --- |
| **A · Panel strip** | A slim column of icons on the window's right edge, one per panel view. Click to open that view; click the open one again to close the panel. | Holds up to about 8. Always visible, even with the panel closed, so "Tasks beside this email" is one click. Gmail's side panel and most IDEs work this way. | About 32 px of width all the time. Icons need tooltips at first. |
| **B · Header menu** | The panel header names the open view: "Details ▾". The menu lists the others. | No extra width, and unlimited views. | The other views are hidden, and switching takes two clicks. |
| **C · Icon tabs in the header** | A row of icons at the top of the panel; the open one also shows its name. | No extra width, and visible. | Fits about 5. Nothing shows while the panel is closed. |

**Recommended: A, with these rules.**
- **Two groups, split by the hairline from ❓20:** *about this* views on top, *alongside* views below.
- **Fixed icons only:** each view uses the app's existing type icon (the task, note, contact, email and event icons from References, ❓55), plus a few system ones (details, comments, outline, in flight). Nothing is user-picked, and the same view has the same icon in every module.
  - This is consistent with ❓29c: there, icons were all alike, so they were noise. Here every icon is different, so they help.
- **A count, never a colour,** when a view has something new: In flight 2, Comments 3 (rule 45).
- **The panel remembers** its last view, open or closed, and its width, per person and per module.
- **Every view has a shortcut,** shown in its tooltip.
- **One back arrow.** Opening a reference inside the panel (an email from a task, a contact from a note) stacks it, and the panel header's back arrow returns. This is where References open (❓55).
- **Modules register their views** in one list, in a fixed order. A module or view with only one panel view still shows its icon, so the strip never jumps.
- **For Tasks:**
  - about this: **Details** (the selected task) and **Project** (the project's overview, ❓8);
  - alongside: **In flight**.
  - The Timeline adds **No date** (❓70), only in that view.
- **Other modules adopt it when they're rebuilt (§0).** The strip and the registry are built once, in the shell.
- *Recommend: A.* (b) · shell work, plus each module's adoption
- Prototype frame 7 (variants A · B · C, in Tasks and in Email).

❓ A?

✗ **A rejected (round 2b):** *"Moduo's symmetry and the '3 vertical, 3 horizontal' layout is something I really care about, and this breaks it."* The rule behind that is now principle 48b. The A/B/C table above stays as the record of what was weighed.

✅ **Decided 2026-10-10 (round 2b):** **B: the panel's title row is a dropdown**, his own first idea. "You change the top part (which names the panel and its purpose), and everything below it changes accordingly."

**72a · How B works**
- **The title row names the panel and switches it.** "Details ▾" opens a short menu of this module's views, with their shortcuts.
- **References open as items, not views.**
  - Clicking a task, email, contact or note opens it in the panel.
  - The title becomes that item's name, with a back arrow to the view you were on.
  - So the menu only ever lists hand-picked views: about 6 per module at most (the biggest today has 4). That answers his "20-item list" worry: nothing makes the menu grow.
- **The menu has two groups, split by a hairline:** *about this* (Details, Project) and *alongside* (In flight, No date).
- **Collapse and expand stay in the bottom bar,** under each side panel, where they are today. With both panels hidden, the controls are still there.
- **For Tasks:** Details · Project / In flight, plus No date in the Timeline.
- *Recommend: B, as above.* (b)
- Prototype frame 7 (B, and B with a reference open).

❓ OK?

✅ **Decided 2026-10-10 (round 2c):** yes ("nice idea about the arrow").

#### Gaps nobody had named

He asked: "if the timeline view was not identified by you as a quality gap… there might be some other gaps." A separate audit read the whole plan and every report, the way a reviewer would:
- each role's Monday to Friday, plus the end of a month or term;
- every view in every state;
- the module contract;
- the cross-cutting list.

It found 15 gaps and 13 contradictions; the raw report is [research/gap-audit.md](./research/gap-audit.md). The eight that change what someone can do are calls below. The other seven are defaults I'll write into the spec unless he objects (listed after the calls), and the contradictions are fixed in the consistency pass that follows.

**73 · Reminders that reach you when Moduo is closed** *(blocks students)*
- **The gap:** ❓24 decided reminders, but not where they arrive.
  - Today the desktop app notifies only while it's running.
  - The web shows an in-app toast and never asks for permission.
  - There's no phone app (❓36).
  - So a 4 pm reminder is lost if the laptop is shut.
- **The answer:** reminders name their channels.
  - **Desktop:** the app keeps running in the menu bar when its window closes, so OS notifications still arrive.
  - **Web:** opt-in browser notifications.
  - **A private calendar feed** of your dated tasks and work sessions, which any phone calendar can subscribe to. The phone then shows due dates and alerts, with no Moduo phone app. This is the cheapest bridge to mobile.
  - Reminders fire whichever workspace you have open.
- *Recommend: yes.* (b)

❓ OK?

**His question: ideas?** Four channels, each with its own job:
- **The desktop app with its window closed:** Moduo keeps running in the menu bar (with "Open at login"), so OS notifications still arrive. This is the most reliable channel on a laptop.
- **Browser notifications**, opt-in. On a Mac, Safari delivers them even when Safari is closed (since Safari 16, [WebKit](https://webkit.org/?p=12945)). Chrome needs Chrome running.
- ~~**Email**, opt-in per person. It's the dependable way to reach a phone today: one email per reminder, never a digest.~~ *Considered and dropped in round 2c.*
- ~~**A private calendar feed** for your phone's calendar, with due dates and work sessions as events.~~ *Considered and dropped in round 2c.*
  - It's for *seeing* your plan on the phone, not for reminders: Google Calendar refreshes subscribed feeds only every 12–24 hours and drops their alerts ([refresh](https://usecarly.com/blog/google-calendar-ics-refresh-rate/), [alerts](https://support.google.com/calendar/thread/9627602?hl=en)).
- **The setting:** Settings → Notifications → "Reminders reach me by: Desktop ✓ · Browser · Email".
- **Later:** push from a phone app, once mobile is in scope.

✅ **Decided 2026-10-10 (round 2c):** **the desktop app keeps running in the menu bar, plus browser notifications.**
- **Email and the calendar feed are dropped.** Too many emails teach people to ignore the important ones.
- **Phones get their own plan**, once the desktop app is properly done (❓36 stays: mobile is out of scope for now).

**74 · "Import through your AI" has to be able to do what ❓35 promises** *(blocks people switching)*
- **The gap:** ❓35 makes "bring Todoist, Linear or Trello through your AI" the first way in, and the student's best moment is "syllabus → every deadline in the right course". But the agent tools decided in call 7 only drop tasks into the Inbox. They can't:
  - create projects or sections;
  - file tasks, or set repeats;
  - keep old IDs.

  And a second run duplicates everything.
- **The answer:**
  - Agents can create projects, sections and areas, and file tasks with dates, repeats and tags.
  - Every imported task keeps an "imported from" reference ("ENG-123" from Linear), which search finds.
  - Running an import again updates instead of duplicating.
  - **"Undo this import"** ships on day one, not later.
  - **Without an AI:** pasting a multi-line list into capture offers "Create 12 tasks?".
- *Recommend: yes.* (b) · MCP slice, P1

❓ OK?

**His questions: do we need it? Does it mean the user's own AI?** Yes, that's what it means.
- **How it works:** your AI app (Claude, ChatGPT) is connected to Todoist through Todoist's connector and to Moduo through ours. You say "move my Todoist into Moduo", and it reads one and writes the other.
- **The same pipe** handles "turn this syllabus into deadlines in CS 201".
- **Why do it:** it's the cheapest first way in. There's no importer to build and maintain per service, and every service with an AI connector works on day one.
- **The catch:** it only works for people who use an AI app. So the paste-a-list fallback and the native importers still follow (❓35: Todoist CSV, then Trello, Linear, Jira, Asana).
- **What it needs from us** is the list in 74 above.
- **Without it,** native importers come first, one per service.

✅ **Decided 2026-10-10 (round 2c):** yes.

**His question: does this need the whole app finished, with the MCP ready and polished?** It needs **Tasks' own agent tools** finished and solid. Those are part of this Tasks build anyway (agents as delegates, decided 6 and 7; P1 in §7):
- creating projects, sections and statuses;
- filing and dating tasks;
- repeats;
- old IDs;
- re-runs that update;
- "Undo this import".

The other modules aren't needed for importing tasks. It's tested end to end with Claude connected to Todoist's own connector before it's announced. ✅ He agreed (round 2c).

**75 · Time you can bill** *(blocks freelancers and agencies who bill by the hour)*
- **The gap:** time by client is what lets freelancers drop Toggl or Harvest (❓8). But:
  - you can't log "2 h on Acme yesterday";
  - no report is defined;
  - an agency owner can't see who worked how long, because individual time is private (tasks-v2 §5).
- **The answer:**
  - **"Add time…"** on any task, with a date and an optional note, plus a list of your own entries you can edit.
  - **A time report:** client or project × period × task, exportable as CSV.
  - Your own time is always yours to export.
  - **Teammates' time reaches the owner only if they opt in:** "Share my tracked time with the workspace owner", off by default. That keeps ❓12's no-surveillance rule.
- *Recommend: yes.* (b)

❓ OK?

**His question: how would you go about it?** Within the current layout, with no new page (AGENTS.md rule 7):
1. **Every tracked stretch becomes a time entry** (who, which task, date, how long, an optional note), not just a running total. Focus already knows when each stretch starts and stops.
2. **"Add time…"** in the task's Time field: "2h · yesterday · note". Your own entries are listed there, and you can edit them.
3. **The report** opens as a sheet from a project's overview (❓8) and from a client's hub in Contacts:
   - pick a period;
   - see time by task or by day, with totals;
   - "Export CSV" for invoicing elsewhere, with optional rounding to 15 minutes.
4. **Sharing:** your own time is always yours to export. A teammate's time appears in the owner's report only if they turn on "Share my tracked time with the workspace owner".
5. **No rates or invoices:** Moduo hands the numbers to the invoicing tool.

✅ **Decided 2026-10-10 (round 2c):** yes, **with a designed document next to the CSV** (his addition, from years of generating them in Jira and Clockify).
- **Export: PDF · CSV.**
- **The PDF is a clean, branded time report:**
  - the client, the project, the period and the total on top;
  - time by task (or by day), with notes;
  - who tracked it, only where they've opted in;
  - a quiet Moduo footer.
- **One layout,** printable, the same in light and dark. It follows the north-star type and spacing, and it's ready to send to a client as it is.

**76 · One "Time & region" setting for the whole app**
- **The gap:** nothing decides whose clock counts:
  - Time zone, for due times, reminders, a repeat's roll-over, and the moment a task turns late.
  - Week start, which Calendar has and Tasks hard-codes to Monday.
  - 12- or 24-hour: Email and the Clock widget force 24h, while Tasks follows the browser.

  This matters for a founder pair in two time zones, for travellers, and for most of Europe and Asia.
- **The answer:**
  - One personal setting used by every module: time zone (from the device), week start, and 12h or 24h.
  - A due *date* is the same date for everyone.
  - Due *times* and reminders are moments, shown in each viewer's own time.
  - A repeat rolls over in its assignee's time zone.
- *Recommend: yes.* (b) · global setting (allowed: global surfaces)

❓ OK?

**His question: thoughts?** It's small to build and touches every module, so it should land before the date work spreads.
- **Defaults come from the device and its language,** with an override in Settings → General → Time & region:
  - time zone;
  - week start;
  - 12- or 24-hour;
  - date order (Oct 16 or 16 Oct).

  ❓41's examples follow these.
- **Calendar's own week-start setting moves here,** so the whole app agrees.
- **Travelling:** when the device's time zone changes, a quiet prompt asks once: "Your computer is on New York time now. Show times in New York time?"
- **Shared work:**
  - a due *date* is the same date for everyone;
  - a due *time*, a reminder or a meeting is a moment, shown in each person's own time;
  - a repeat rolls over at its assignee's midnight.

✅ **Decided 2026-10-10 (round 2c):** yes.

**77 · A record of what got done, and when**
- **The gap:** a task doesn't store when it was completed, or by whom. The "last 7 days" view guesses from the last edit. Several decided features silently depend on that record:
  - repeat history (27d);
  - the client hub's "done for Anna, with hours";
  - the weekly review;
  - a stand-up;
  - the month-end client report.
- **The answer:**
  - Every completion records when and who, including each cycle of a repeat.
  - Filter and group by **Completed**: today · this week · last week · this month · a range.
  - A project's overview shows "Done this month · 14 · 22h".
  - PM and founder roles get a seeded "Done last week" view.
- *Recommend: yes.* (b) · folds into TV-D7

❓ OK?

**His question: where did the activity history go?** Nothing was lost.
- **The activity trail** at the bottom of the details stays, and becomes complete: §6.1 records every change, including creation, field edits and completion.
- **Agent history is in it too:**
  - ❓51 records every agent change in the trail ("Alex · via Claude Desktop");
  - ❓52 keeps an agent session's notes under its session line, private to whoever started it.
- **What 77 adds is different.** The trail tells one task's story, but it can't quickly answer "what got done last week, across everything". A completion date stored on each task can: it's what powers a "Completed" filter, "Done this month" and the client report.

✅ **Decided 2026-10-10 (round 2c):** yes.

**78 · When people and projects go away**
- **The gap:** only "their tasks become unassigned" is decided. Three things are open:
  - **A member leaves:** their Inbox, private projects, lead roles, teams and views have no owner.
  - **A project is done or archived:** nothing says what happens to its open, repeating or reminded tasks.
  - **A project is deleted:** its tasks fan out into private Inboxes without telling anyone.
- **The answer:**
  - **Removing a member** shows what they leave behind:
    - Inbox tasks that others created go back to their creators;
    - the rest goes to the person removing them;
    - lead roles are cleared;
    - private projects are handed on first, or go to Recently deleted.
  - **Marking a project Done, or archiving it, with open tasks** asks once: "4 open tasks — Won't do · Move · Keep".
  - **Archived projects** never remind or repeat. Search still finds them, labelled "Archived".
  - **Deleting a project** moves only its open tasks, with one quiet notice to each assignee.
- *Recommend: yes.* (b) · #328

❓ OK?

**His question: did we lose the rules for people leaving?** No. They're decided in the account-erasure spec (PRIV-2, live since 2026-10-08):
- removing a member makes their tasks in that workspace unassigned;
- deleting an account hands shared items in their private places to the teammate they're assigned to, or else to the owner.

78 only adds what v3 introduces (their private projects, Lead, teams, templates and views) and the separate question of closing a project that still has open tasks.

✅ **Decided 2026-10-10 (round 2c):** yes.

**79 · Repeat projects: "Duplicate project…"**
- **The gap:** templates for repeat projects are a must-have for PMs and agencies, and for next term and season 2. ❓9 decided *task* templates and deferred *project* templates, and nobody decided who can see a template.
- **The answer:**
  - **"Duplicate project…"** copies the project's sections, statuses and open tasks.
  - It shifts every date from a new start date you pick.
  - It copies nothing done, commented or tracked, and it needs no editor.
  - It's the repeat-project answer without project templates.
- **Who sees a template:** it's yours until you share it with the workspace. Saving one from a private project never shares its contents by itself.
- *Recommend: yes.* (b)

❓ OK?

✅ **Decided 2026-10-10 (round 2b):** yes, **and project templates too** (his addition: "if someone always goes through the same phases/sections in their work").
- **"Duplicate project…"** works as described above.
- **Project templates:**
  - "Save as template" on any project keeps its description, sections, statuses and open tasks, including subtasks, descriptions, and dates stored as offsets from a start date.
  - Nothing done, commented or tracked is kept.
  - "New project → From template…" asks for a name and a start date.
- **The template is its own editor,** like task templates (❓9). It opens as a project marked *Template*, and editing it never changes projects already made from it.
- **Who sees it:** it's yours until you share it with the workspace. Saving a template from a private project never shares its contents by itself.
- **Where templates live:** in "New project", and in Settings → Tasks → Templates.

**80 · One notification table**
- **The gap:** §3 said notification rules never change, yet v3 adds new kinds:
  - reminders;
  - check-backs;
  - agent states;
  - team mentions;
  - tasks assigned into someone's Inbox;
  - resurfacing follow-ups.

  Nothing says who hears about what, where, or how a bulk action is grouped.
- **The answer:**
  - The spec carries one table: event → who → where (bell, OS, email) → on its own or grouped → which switch mutes it.
  - **Rule:** one action that touches many tasks sends one notice ("Maciej assigned you 12 tasks in Acme").
  - **Rule:** reminders and check-backs reach you in any workspace.
  - The notification lines are struck from §3's "never changes" list.
- *Recommend: yes.* (b)

❓ OK?

**His question: what do you mean?** Each call so far has decided its own notification on the side:
- reminders in ❓24;
- agent states in ❓52;
- team mentions in ❓54;
- tasks handed into your Inbox in 20a.

Nothing lists them together, so nobody can check whether the whole stays quiet. The table is that list. A few of its rows:

| Event | Who hears | Where | When | Turned off by |
| --- | --- | --- | --- | --- |
| A reminder you set | You | OS notification and bell (plus email, if on) | At its time, on its own | The reminder itself |
| Someone assigns you a task | You | Bell | Grouped with others from the same hour | Settings → Notifications → Assigned to me |
| 12 tasks assigned at once (template, import, bulk) | You | Bell | One notice: "Maciej assigned you 12 tasks in Acme" | Same |
| Your agent needs you | Whoever started it | OS notification and bell | At once | That agent key's notifications |
| `@Design` in a comment | Design's members | Bell | One notice each, not a ping per mention | Your team's mute |
| Something you were waiting on comes in | You | Bell | At once, quietly | Settings → Notifications → Waiting |

✅ **Decided 2026-10-10 (round 2c):** yes ("happy to go with your suggestion"). The spec carries the full table.

**Defaults I'll write into the spec unless he objects:**

| | The gap | The default |
| --- | --- | --- |
| a | **Undo** | Every change from a list, board, timeline, key or the bulk bar shows Undo for 8 s, and ⌘Z works while it shows. Creating many tasks at once undoes as one. Undo never overwrites a teammate's later change. |
| b | **Inbox triage and keys** | Accept files the task and assigns it to you. Decline hands it back to its sender with a note. "Duplicate of…" merges comments and links, then marks it Won't do. Snooze hides it until a date. One key map table covers every v3 concept, with no clashes. |
| c | **Several workspaces** | The intended setup is one workspace with private projects, and onboarding says so. Reminders and the running Focus chip reach you in any workspace. Moving a task to another workspace isn't offered. |
| d | **Work sessions and booking links** | Scheduled work sessions count as busy for your booking links, with a switch per link. Teammates see "Busy", never the title. |
| e | **Bulk actions** | The bulk bar gains Date (+1 day · Next week · Pick…), Status, Section, Waiting on and Team, all under one Undo. |
| f | **Getting a list out** | "Copy as text" on any selection, view or project overview, which pastes cleanly into email or Slack. "Export view as CSV" and a print layout. The full export covers every new object. |
| g | **Capture offline** | Until full offline arrives, everything opens read-only from the device copy. Captures and check-offs wait on the device and send when you're back ("2 waiting to sync"). Other edits say "Offline". |

#### Motion *(new in round 2b)*

**81 · Motion: foundations now, signature moments last** — *"pleasant, quiet and elegant animations, probably quick and blur-based… If you see value in getting the basic animations in sooner and testing them, I'm open."*
- **Foundations now, as part of the north-star kit:** motion lives inside every component (panels, menus, popovers, lists, drags). Adding it after the modules are rebuilt would mean touching each one again. Two tokens already exist (`--motion-fade`, `--ease-out`).
  - **Three durations:** fast (about 100 ms) for hover and press; base (about 180 ms) for menus and popovers; slow (about 280 ms) for panels and view switches.
  - **One easing family:** ease-out when something arrives, a quicker ease-in when it leaves.
  - **Four patterns:**
    - a panel slides and fades;
    - a popover grows from where it was opened;
    - a list row's height and opacity change as it's added or removed;
    - views crossfade.
  - **Reduced motion is respected:** only opacity changes.
- **Blur is tested small first.** A blur over a moving surface is expensive in the desktop app's web view, especially over long lists. It goes only on small surfaces (menus, popovers, the welcome dialog), and it's measured against the 10,000-task target before it spreads.
- **Signature moments come last,** once modules truly work: the welcome dialog's clips, Focus's between-tasks transition, a finished task's send-off.
- *Recommend: yes.* (b) · one small block in the kit

❓ OK?

✅ **Decided 2026-10-10 (round 2c):** yes, **with blur left out for now.**
- **The basics** go in as recommended: three durations, one easing family, four patterns, and reduced motion respected.
- **Blur** may come back later, only on hovers and small interactions and never on slide-ins or other frequent animations, once everything is done and only if it doesn't cost performance ("performance comes first").
- **Signature moments** come after all the modules are done.

### Consistency pass (round 2a)

The audit's 13 contradictions, each resolved here and in place:

1. **Statuses per project (53a) vs every place that says statuses never change** (§2, §3, ❓18, ❓22a): **done in round 2b.** 53a was answered yes, and stages moved from sections to statuses.
2. **"Backlog waits for a desktop release" (§6.12) vs 53a's "no longer waits":** §6.12 now says it applies only if 53a is declined.
3. **"A template carries its statuses" (53a) vs task-only templates (❓9):** it holds for "Duplicate project…" (❓79). Task templates carry no statuses.
4. **A visible "Waiting on Claude" (❓6) vs private agent sessions (❓52):** the session stays private. Teammates see "Waiting on Claude" only if "Show my agent work to teammates" is on; otherwise they see In progress.
5. **The project overview as a right-panel view (❓8) vs ❓72's Tasks views:** added to ❓72 as *about this*: Details (a task) · Project (its overview).
6. **Deleting a project fans tasks into private Inboxes (❓20) vs 20a and tasks-v2's delete dialog:** ❓78's rule replaces it.
7. **`@person` in capture assigns (❓33) vs assigning from your Inbox asks for a project (20a):** in capture, `@person` with no `@project` keeps the task unfiled. The empty project slot shows before Enter, so you can fill it.
8. **Seeded views per role (§3) vs views seeded once per workspace (❓34):** views are seeded per person from their role answer; example tasks once per workspace.
9. **Private individual time (tasks-v2 §5) vs per-cycle times with names (27d):** in a repeat's history, each person sees only their own time; others see who did it and when. Reports follow ❓75.
10. **A Backlog task is left out of My tasks (53) vs being assigned or given a due date:** either action offers "Move to To do?". My tasks keeps a folded "Backlog · n" line.
11. **"Notification rules never change" (§3) vs the new notification kinds:** struck; ❓80 replaces it.
12. **Stale backlog lines (§7):** project tabs (29d is no), cues (58 is parked), the Suggestions setting (now 59a) and the agent undo (now ❓74, P1) are corrected.
13. **The module contract still allows unlogged creates and edits** vs §6.1's every-change-is-a-logged-server-op: the contract is added to §9's list of documents to amend.

### K · Round 2b: the everyday views *(new 2026-10-10)*

**Where this comes from:** three research lanes, each comparing the leaders view by view and state by state, then recommending:
- [views-list-upcoming.md](./research/views-list-upcoming.md): List, Upcoming, Inbox, My tasks, All, and the Calendar contract;
- [views-board-detail.md](./research/views-board-detail.md): Board, the detail panel, the full-page task;
- [capture-references-teams.md](./research/capture-references-teams.md): Capture, References (❓55), teams (❓54).

**How this group is split:** below are only the product calls. Everything else is a default, listed after them, and goes into the spec unless he objects.

Prototype: [`round-2b.html`](./prototypes/round-2b.html).

#### List, Upcoming and the smart views

**82 · Bulk editing lives in the bottom bar** (48b: the bottom bar holds the module's tools)
- **Select two or more tasks** (⇧-click, ⌘-click, or ⇧↑↓), and the centre of the bottom bar turns into the bulk verbs:
  - Move, Assign, Status, Date, Section, Priority, Tags, Waiting, Team, Focus, Complete, Delete;
  - "4 selected · Esc".
- It works with both panels hidden.
- **With the right panel open,** it shows "4 tasks", with shared values and "Mixed" where they differ (as in Figma). You can edit them there too.
- One Undo covers the whole change.
- *Recommend: both: the bar and the panel.* (a) · #329 (TV-U5)
- Prototype frame 1.

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes, with his change: *"do we have to add that much horizontally stacked text on the bottom bar? can't we turn the 'new' button into 'actions'?"*

**82a · One "Actions" button instead of a row of words**
- **When two or more tasks are selected,** the bottom bar's "+ New" button becomes **"Actions · 4"**. Nobody creates a task in the middle of a multi-select.
  - It opens the same menu as right-clicking a selection: Move, Assign, Status, Date, Section, Priority, Tags, Waiting, Team, Focus, Complete, Delete.
  - Next to it, a quiet "Esc" clears the selection.
- **The single-task keys work on a selection too,** so the most common changes are one key away, without the menu.
- **The right panel's "4 tasks · Mixed" stays** for anyone who prefers editing fields.

**82b · Replaces 82a, his version: a short action row with keys, plus More** — *"maybe we could just have less stuff on the bottom bar with an expandable more button?… for triage it's great and I don't want to drop that… del for deleting, f for focus, enter for complete… shift+2 (@) for mention and shift+3 (#) for tagging."*
- **One pattern for every "mode" of the bottom bar.** When a mode is active (Inbox triage, a multi-select, and later other modules' modes), the bar's centre shows that mode's **few most-used actions, each with its key**, then **More ▾** for the rest.
  - This is the same pattern as triage, so triage stays exactly as he liked it.
  - **The cap:** six actions, then More.
- **Multi-select's row:** Complete `Space` · Focus `Q` · Assign `@` · Tag `#` · Date `D` · Delete `⌫` · More ▾, then "4 selected · Esc".
  - More holds Move, Status, Section, Priority, Waiting and Team.
- **His keys, kept where they don't collide:**
  - `@` (⇧2) assigns and `#` (⇧3) tags, which fits the app's grammar exactly.
  - Delete is `⌫`/Del.
  - **Complete is `Space`, not Enter:** Space already completes a selected row, and Enter opens a task, so Enter completing a whole selection would be easy to hit by mistake.
  - **Focus is `Q`, not F:** F is Filter and ⇧F is "Focus on this" (❓61 kept Q for "Add to Focus").
- The right panel's "4 tasks · Mixed" stays.
- *Recommend: yes.* (a) · #329

❓ OK?

**His other question: how do you get to the Detailed rows?** Display (in the toolbar) → **Rows: Standard · Detailed**. The choice is remembered per view. The developer role starts on Detailed (❓34).

**83 · One date grouping everywhere, by day**
- **Groups:** Earlier · Today · Tomorrow · the next five day names · Later, plus No date outside Upcoming.
- **The same groups** are used in Upcoming and wherever you choose Group by: Date.
- **"This week" retires.** On a Saturday it would be one day long. "Due this week" stays as a filter.
- **Day headers carry the load:** "Thu · Oct 15 · 3 · ~2h 30m".
- **No week strip on top.** The Board layout of Upcoming gives you day columns, and the Calendar is the grid.
- **One row per task,** at its next session or its due date, whichever comes first.
  - A missed session goes to Earlier as "missed 2:00 PM".
  - A passed due date shows as "late" (❓23).
- *Recommend: yes.* (c, re-words ❓29's groups) · #330

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**84 · My tasks groups by status, In progress first**
- Upcoming already answers "when". My tasks answers "what am I in the middle of": In progress, then To do, then Backlog folded.
- The team block ("For Design · 2 unclaimed", ❓54) sits on top.
- The round-1c prototype showed date groups here. That's one Display choice away.
- *Recommend: status.* (a)
- Prototype frame 3.

❓ Status or date?

✅ **Decided 2026-10-10 (round 2d):** status.

#### Board

**85 · Swimlanes, one level, off by default**
- **Display → Rows:** none · assignee · priority · project (on boards across projects) · team.
- **Lanes:** each fold, with a sentence-case header and a count, and empty lanes hide.
- **Who has them:** Linear, Jira, GitHub, Notion, ClickUp and, since 2025, Asana, after years of requests.
- **The cost** is a second axis to keep calm and fast, so it's built after the Board basics.
- *Recommend: yes.* (b)
- Prototype frame 4.

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**86 · Boards open grouped by status, always** *(re-decides part of 22a)*
- 22a opened a project with sections grouped by section. Since 53a, sections are phases and weeks, so "Week 1–12" would open as 12 columns.
- Status is always the default; Section is one Display choice away and remembered per project.
- *Recommend: yes.* (c)

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**87 · Finishing a task finishes its open subtasks too, with one Undo**
- The toast names them: "Done · also 2 subtasks · Undo".
- **The same everywhere:** List, Board, Focus's Done ⏎, agents.
- Todoist does this. Linear leaves subtasks open unless a team opts in, which leaves orphans that look unfinished.
- *Recommend: yes.* (a)

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

#### The detail panel

**88 · Reactions on comments: six, fixed, never notifying**
- They replace the "ok" and "thanks" comments, and the notifications those send.
- Hover shows who reacted.
- **The six:** 👍 ✅ 👀 🙏 ❤️ 😄. Nobody picks or adds their own (the same rule as icons).
- This re-decides "reactions aren't planned" from the gap audit.
- *Recommend: yes.* (b)

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**89 · The right panel is never narrower than 280 px** (a shell change, for every module)
- **Today it can shrink to 240 px.** At that width a value gets about 110 px, which is where "Wed, …" and "0m of …" come from.
- **At 280 px:**
  - values wrap instead of truncating;
  - the label column narrows from 96 to 76 px when the panel is under 320 px.
- **The cost:** at a 1,024 px window, the centre keeps about 450 px.
- *Recommend: yes.* (a)

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

#### Capture

**90 · Two ways to capture, two destinations**
- **⌘⇧K (from anywhere) always files to your Inbox:** capture never asks where.
- **⌘N, "+ New" and `c`** file where you are:
  - in a project, that project;
  - in a section's group, that section;
  - in Focus, the top of Up next.
- The same split as Things (Quick Entry vs New To-Do).
- *Recommend: yes.* (a) · #330 (TV-U7)

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes, with his question: *"what about capturing quick notes and other quick actions in different modules? Aren't we locking too much of the global workflow into tasks alone?"*

**90a · One global capture for every module; Tasks is its first type**
- **He's right:** ⌘⇧K is global, so it shouldn't only make tasks.
- **It opens the app's capture with a type chip in front of the destination:** "Task ▾ · Inbox ▾".
  - It always opens as **Task**, the most common type, so muscle memory stays reliable.
  - Switch the type with the chip, or by typing `/note`, `/event` or `/message` as the first word. That's the same `/` grammar as everywhere else.
- **Each module registers its own capture type,** with its own default destination ("Note · Quick notes", "Event · Today") and its own pills. It's the same shape as the right panel's view registry.
- **Tasks specs the shell and the Task type now.** Notes, Calendar and Chat plug in their types when they're rebuilt (§0).
- **⌘N stays "new item of this module, here"** (❓90): a note in Notes, an event in Calendar.
- *Recommend: yes.* (b) · shell

❓ OK?

**90b · Replaces 90a's way of switching: ⌘+number switches the capture's module** — *"Task by default… but clicking cmd + number just switches the module context in the modal while it's active instead of the modules behind a modal."*
- **⌘⇧K opens capture as Task.** While it's open, **⌘1–⌘7 switch the capture's type**, not the app behind it. The numbers are the same as the top bar's module order, so ⌘2 makes a note, ⌘4 an event, ⌘7 a message.
  - ⌘1 (Home) has no capture type and does nothing in the modal.
- **The type chip** shows the current type and can be clicked.
- **Typing `/note` doesn't switch the type.** In a title, `/note` keeps its prose meaning (insert or create a note link). One way per job.
- **Why:** the same keys mean "module" everywhere, so there's nothing new to learn.

✅ **Decided 2026-10-10 (round 2e):** yes, his idea.

**91 · Capture shows four pills, with the destination on top**
- **The eight pills become:** Assign (people and teams) · Due · Tags · Priority · ⋯ More.
  - More holds: scheduled, reminder, estimate, repeat, waiting on, template.
- **The project moves up** into a destination row at the top: "Inbox ▾" or "Acme rebrand › Design ▾".
  - That's where 20a's empty project slot shows when you `@` someone without a project.
- Create is ⏎; ⌘⏎ creates and keeps the window open ("Create more").
- *Recommend: yes.* (a) · #330
- Prototype frame 6.

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**92 · What leaves the title, and what stays**
- **Tokens that set a property leave the title on save** and land in their pill: a person, a team, a project, a tag, a date, a `/` command (as decided for dates in 33a).
- **Tokens that link a thing stay in the title as chips:** a contact, note, email, event or another task. "Call @Anna about @Acme rebrand" keeps reading as a sentence.
- *Recommend: yes.* (a)

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**93 · The thing you're looking at rides along**
- Capturing while an email, note, event or contact is open adds a removable **"From: Re: Launch date"** chip. On save it becomes a link.
- On by default; one click removes it.
- *Recommend: yes.* (a)

❓ OK?

**His question: "not sure about this one, explain your reasoning."**

- **Why link the source at all:** most tasks are born from something: an email asking for something, an action item in a note, a meeting. The link is the spine's whole point. Opening the task later shows the email; the email shows "1 task". "Waiting on reply" (decided ❓5) only works when the link exists, and nobody links by hand afterwards.
- **What his doubt catches:** ⌘⇧K is also used for unrelated thoughts ("buy milk" while reading a client email). An automatic link would then be wrong, and teammates might see a link to an email they can't open ("Private item"). Explicit "Create task from this email" actions are different: there you meant it.
- **Revised recommendation:**
  - **Explicit actions link automatically:** "Create task from this" in an email, note, event or contact, and ⌘N inside one.
  - **⌘⇧K only suggests:** a dimmed "Link Re: Launch date?" chip. Tab or a click attaches it; ignoring it leaves the task clean.
- *Recommend: the revised version.* (a)

❓ OK?

✅ **Agent's choice, deferred to by Maciej (round 2e):** *"just recommend what you think will be best… connections are super important."*
- **The source is linked by default, in every case, including ⌘⇧K.** It shows as a visible "From: Re: Launch date" chip, and one key (⌫ on the chip) removes it before saving.
- **Why the default and not the suggestion:** a suggestion keeps far fewer links, because people skip optional steps. A missed link loses its value silently, while a wrong link is visible and removable. Privacy holds either way: a teammate who can't open the email sees "Private item" (❓55), never its content.
- **Rejected: suggest-only.** It's calmer for unrelated thoughts, but it costs the connections that make Moduo what it is.
- **Revisit if** dogfooding shows many removed links.

#### Teams

**94 · A task routed to a team needs a project**
- Unfiled tasks are private (❓20), and a routed task has to be visible to the team (❓54). So "@Design" with no project has nowhere to go.
- **The fix:** a team can name a default project, e.g. Design → "Design requests". Without one, capture asks for a project before Enter.
- This is an ordinary project, not the shared "Requests" intake that ❓20 deferred.
- *Recommend: yes.* (a)

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**95 · Team marks: a rounded square with two letters**
- **People are round; teams are rounded squares.** Each shows two automatic letters (Design **DS**, Development **DV**) and a stable colour.
- The letters can be edited; nothing is picked from a list. This solves the "D" clash from round 1c.
- *Recommend: yes.* (a)
- Prototype frame 3.

❓ OK?

✅ **Decided 2026-10-10 (round 2d):** yes.

**Defaults I'll write into the spec unless he objects (round 2b):**

| | Where | The default |
| --- | --- | --- |
| h | Inbox | New captures go on top, as in email, with manual drag. Todoist and Things add them at the bottom. |
| i | Rows | Hover shows only the Focus mark, a date picker in an empty date cell, and the late task's fixes (Move · Won't do · Break down). Those fixes show only on hover or selection, never always. |
| j | Rows | The Detailed preset adds a status-name column, since the icon can't tell "In review" from "In progress". Columns drop in a fixed order as the centre narrows, and the date column sizes to its widest value, so dates never truncate. |
| k | Rows | Clicking the status icon completes the task; ⇧S opens the status menu. Nest and un-nest with `>` and `<` (⌘[ and ⌘] are Back and Forward on the web). |
| l | Group by | Section · Status · Priority · Assignee · Team · Date · Project. Tag and Energy are left out: a task with three tags would appear three times. |
| m | Sorting | Manual order exists only inside one project. Sorting shows "Sorted by due · Back to manual order". Dragging while sorted asks to switch back. |
| n | Inline add | A "+" in each group header that stays visible, adding at the top with that group's value filled in. Same on the Board. |
| o | Board | One card that scales with density, at a fixed width (296 / 280 / 264 px). Columns for statuses, sections and priorities always show; columns for assignee, team, project and waiting hide when empty, with "3 hidden". No WIP limits. Each column scrolls on its own and draws only what's on screen. |
| p | Panel | With nothing selected in a project, the panel shows the Project view. With a task open full-page, the panel shows Project, and anything you click on the page opens there with a back arrow. |
| q | Panel | One activity feed, with an "All · Comments" switch. Comments can be edited and deleted; there are no threads. Waiting on is a list, not a property row. |
| r | Calendar | Your grid shows only your own due dates (assigned to you, or in your Inbox) and your sessions; unassigned team tasks stay in Upcoming. A session's planned length is never recorded as worked time: time comes only from the clock or "Add time…". |
| s | Teams | Members hear about an unclaimed team task once, grouped by the hour. If it's still unclaimed after 3 days, or the day before it's due, the creator gets one check-back. No round-robin. |
| t | Teams | Any member can create a team and edit its members (routing hides nothing). Only its creator, an owner or an admin can delete it. Upcoming leaves out unassigned tasks routed to a team you're not in. |
| u | References | The six item types (task, email, contact, note, event, project), each in the four forms, are specified in [capture-references-teams.md](./research/capture-references-teams.md) §6–8 and become the References spec. Two fixes come first: tasks get registered when they're created, not when first linked, and a deleted item reads "Deleted task", not a struck-through title. |

**Status of defaults a–g and h–u:** ✅ **Agent's choices, deferred to by Maciej on 2026-10-10** ("I trust you with them"). They're **confirmed for building**, and can be reconsidered later if one turns out to be a problem.

**Why each default** (his ask: "I need to know why those decisions were made and what everything does"):
- **h · New Inbox items on top.** The newest thing is usually the one you're about to deal with, as in email.
  - The triage keys are Linear's (1 accept · 2 decline · 3 duplicate · H snooze), because A and D already mean Assign and Due.
- **i · A quiet hover.** Icons on every hovered row are noise and invite misclicks. These three are the ones you need without opening the task.
- **j · Status names in Detailed.** Icons follow the category (53a), so "In review" and "In progress" look identical. Developers need the name.
  - Dates size the column, so they never truncate (41).
- **k · Click the status icon to finish.** Finishing is the most common action, so it gets one click.
  - The menu sits on ⇧S.
  - `>` and `<` nest, because ⌘[ and ⌘] are Back and Forward in the browser.
- **l · No grouping by tag or energy.** A task with three tags would appear three times in the list.
- **m · Manual order inside one project only.** One shared order can't survive two views sorted differently. Every competitor either blocks dragging while sorted or loses your order. Ours says plainly when it's sorted, and how to get back.
- **n · "+" in the group header, adding at the top.** The end of a long group can be hundreds of rows away; the header is always visible.
- **o · Fixed card widths, no WIP limits.**
  - Fixed widths stop the board reflowing as you scroll.
  - Empty assignee or team columns hide so a board stays readable.
  - WIP limits are process tooling for large teams.
- **p · The panel shows the project when nothing is selected.** The right panel is context (48b); inside a project with nothing selected, the project *is* the context.
- **q · One activity feed with an "All · Comments" switch, and no threads.**
  - Threads split a small team's conversation.
  - The switch hides the change log when you only want the talk.
  - Waiting on can hold several people, so it's a list, not a field.
- **r · Your calendar shows only your work.** The calendar is your time, and teammates' unassigned tasks would clutter it (they're in Upcoming).
  - A block's planned length is a plan, not work done, so it never counts as tracked time.
- **s · Unclaimed team tasks are quiet.**
  - Members hear once, grouped by the hour.
  - The creator gets one nudge if nobody takes the task.
  - Nothing is assigned automatically, because owning work stays a human choice.
- **t · Any member can make a team.** Teams only route work and hide nothing, so the risk is low. Deleting one affects others, so it's limited to its creator, an owner or an admin.
- **u · Two fixes come first.**
  - Today search and `@` can't find a task until it's linked somewhere (a §1.3 bug).
  - A struck-through title reads as "done", not "deleted".

#### The top bar *(new in round 2d)*

**96 · Help and the running Focus timer move to the top bar** — *"move it to the top right corner… right next to the bell, and even more quiet… a help button, which would house docs, support contact, bug reports and keyboard shortcuts."*
- **Why the top bar fits** (48b): the top bar is global, and the bottom bar is the viewed module's tools. A Focus session runs whichever module you're in, so it's global.
- **Top right, from left to right:** the Focus timer · Help (?) · the bell · your avatar.
  - **The timer** is quieter than today's chip: just "18:02" in secondary text with a small dot ("Break 4:12" in Pomodoro). It appears only while a session runs. Hover shows pause; a click opens Focus.
  - **Help:**
    - Docs;
    - Keyboard shortcuts (the existing dialog);
    - Contact support;
    - Report a bug: a short form that attaches the app version.

    Help stays through alpha and beta.
- **The bottom bar's centre** becomes Search · Quick capture · New. The keyboard button goes into Help, and "New" turns into "Actions · 4" during a multi-select (82a).
- **Scope:** shell chrome, not Tasks. It's built as a small separate block now, because he wants it soon, and it's independent of the Tasks spec. The timer's words follow 62a when Focus is rebuilt.
- *Recommend: yes.* (b)

❓ OK?

✅ **Decided 2026-10-10 (round 2e):** yes. It's being built in its own session ("Move Help and the Focus timer to the top bar").

### L · Round 3: the six paused PRs *(2026-10-10)*

Each PR was read against every decided call. Reports:
- [round3-pr-323-315.md](./research/round3-pr-323-315.md)
- [round3-pr-328-330.md](./research/round3-pr-328-330.md)
- [round3-pr-329-327.md](./research/round3-pr-329-327.md)

| PR | Block | Verdict | What carries · what changes | Lands |
| --- | --- | --- | --- | --- |
| #315 | TV-D5 live updates | **Finish and merge first** | Both its migrations are already on prod but not in `maciej`, so a local reset builds a different schema until it lands. It's the first brick of the shared store (§6.6): the socket, the merge rules and the server stamp all carry over, while its full refetch and per-page state get replaced later. One fix: a guard so refocusing the window doesn't re-run the client repeat catch-up (the P0 #2 same-day reopen). About 2 hours. | 1st |
| #327 | AT-2 attachments | **Finish and merge** | Independent of the re-plan, and fits the panel anatomy and the 280 px minimum. Still to do: one shared drop-highlight fix, the reviews (Tier 2: it touches a contracts file), and the desktop Finder-drop check. About half a session. | Any time |
| #330 | TV-U2 toolbar, filter, display, search | **Re-scope** | Keep the toolbar, Filter, search and Display logic. Then: Group by loses Tag and Energy and gets one day-by-day Date grouping (83); My tasks groups by status (84); labels "To do" / "Won't do"; "Group by", not "Columns"; add Rows: Standard · Detailed; fix one red test (test-side). Covers P0 #4, and can take #5. It holds **no capture (TV-U7) or saved-views (TV-U8) code**, so those are specced fresh. About one block. | 2nd, with the P0 pass |
| #329 | TV-U4 drag and drop | **Re-scope** | Only drag and drop is built; multi-select (TV-U5) and DS-5 have no code. Keep the two tested drop planners and the shared drag visuals (39). Before merging: fix the validator's MAJOR and five MINORs; no manual order across projects (default m); the "sorted" note becomes an action; Undo on every drop; use #330's sort type, not its own copy. About one session. | After #330 |
| #328 | TV-U6 sidebar, archive, Recently deleted | **Re-scope** | The schema, colours, reorder and Recently deleted hold. Rewrite delete per 78 (open tasks go to their assignees with a notice; no radio choice); archived projects stay findable in search; the words say "project"; "Open at" goes (30). About one block, plus a Tier 2 review. It conflicts with #330 in one file. | After #330 and the private permissions change |
| #323 | TV-F2 queue run | **Close and salvage** | About three quarters carries into the new Focus blocks: the run's server record, cross-device takeover, claims ("is on this"), the run rules, and the capture default that fixes P0 #9. The screen doesn't carry: it's built to the old comp that 61–66 replace. Its migration `20261009120000_focus_runs.sql` is not on prod and must not be applied as it stands: its run-mode check is re-cut to Timer: Per task · Pomodoro · Off (62a) first. It doesn't fix P0 #6 (time saved from any page). | Salvaged into the Focus blocks |

**Agent's choices made in round 3** (deferred, confirmed for building, revisitable):
- **Display wording:** **Rows: Standard · Detailed** (the preset) and **Lanes** for swimlanes (85), so one word doesn't mean two things.
- **Dropping a task on the Inbox row does nothing.** Otherwise a shared task would quietly become private (❓20).
- **DS-5's sweep of the other modules is superseded,** because those modules are rebuilt after Tasks. Only its lint guards stay.

**97 · Resume #315 and #327 now, before the spec**
- Both are independent of the re-plan's open work.
- #315 also brings the repo back in line with prod, which already has its migrations.
- Each would be finished in its own session, with the validator, `/code-review high` and the security scan.
- **#315's Tier 2 ultra review hasn't run.** Its migrations are already live, so the ultra review can only find problems after the fact; the other reviews still run.
- *Recommend: yes, resume both now; skip the ultra review for #315.* (a)

❓ OK?

✅ **Agent's choice, deferred to by Maciej (2026-10-10):** yes. He moved on to the spec ("switched to fable, spec") without objecting; confirmed for building, revisitable.

**98 · Where archived projects and Recently deleted live**
- #328 adds them as two permanent rows at the bottom of the sidebar. That's the label clutter he dislikes (29e).
- **The recommendation:** no permanent rows.
  - Both open from the sidebar's ⋯ menu, next to Customize sidebar.
  - Archived projects also show in search, labelled "Archived".
  - A just-deleted item's Undo toast links to Recently deleted.
- *Recommend: yes.* (a) · #328

❓ OK?

✅ **Agent's choice, deferred to by Maciej (2026-10-10):** yes, no permanent rows. Confirmed for building, revisitable.

---

## 9. What happens next

1. **Answers to the calls.** Anything answered "no" or with notes gets a short follow-up round.
2. **Round 2: views and the visual system in detail**, in two parts:
   - **2a (2026-10-10, group J):** Focus, the Timeline, the right panel, and an audit for gaps nobody had named.
   - **2b:** List, Board, Upcoming, the detail panel, Capture, the Calendar link and Home, in the same depth: every state and element, against the decided structure and the north-star kit. Swimlanes, inline add and sticky headers are settled here. Also the **References** spec, which absorbs the grammar GR-0 (❓55), and the details of team routing (❓54).
3. **Round 3: reconcile the in-flight work** *(done 2026-10-10, group L)*. For each of the six open PRs (#328, #330, #329, #323, #327, #315): keep, rebase, re-scope or stop, against the answered calls. The PR tags on each call above are the starting map.
4. **The spec**, on Fable 5.1 at high effort for the synthesis:
   - `specs/tasks-v3.md` plus amendments to tasks-v2, attachments, design-state-layer and the module contract (`docs/moduo-module-contract.md`: every create and edit becomes a logged server op);
   - `docs/decisions/tasks.md` entries;
   - BUILD_ORDER re-sequenced into blocks;
   - the Definition-of-Ready gate.

   After that, `/s2` runs without direction questions.
5. **Calls 61–80 go into §7's backlog (P0–P4) after his answers.** Until then they're unplaced on purpose.
6. **How decisions are written in the spec** (Maciej, 2026-10-10: every agent should be able to find a simple "why", without clutter):
   - Every decision in `docs/decisions/tasks.md` gets at most four short lines:
     - **who decided:** "Maciej", or "agent's choice, deferred to by Maciej";
     - **the decision;**
     - **why**, in one line;
     - **rejected:** the main alternative, in one line.
   - **Status is "confirmed for building".** Choices deferred to the agent add "may be reconsidered later".
   - The spec itself says only *what* to build and points to those entries, so building agents aren't slowed by the reasoning.
7. **After the module is specced: a dashboard-widgets round for Tasks.**
   - Already decided: team load (❓12), the time widget, Upcoming.
   - Maciej has more ideas, which go in when he shares them.
   - Kept out of the module spec on purpose ("let's focus on getting the module itself done first").
8. **Owed at the end of this conversation:** a reusable prompt template that runs this same process on every other module (Maciej, 2026-10-10). What this round's process taught, so the template keeps it:
   - **Start from the root cause:** who the module was first specified for, and which reversals share one shape (§1.1).
   - **Research lanes in parallel, each writing to a file:**
     - the current state from code and the live app, in a seeded workspace with a second member;
     - a visual audit with measurements;
     - an audit of early decisions (keep / adjust / reverse);
     - structure across competitors;
     - role journeys;
     - competitors view by view.
   - **Calls:**
     - Number each call once and never renumber it.
     - Give each a recommendation, a collision class and the PRs it touches.
     - Record the answer under the call, in his words.
     - Answer technical questions yourself, and raise them only in product terms.
   - **Prototypes:** a throwaway prototype each round for whatever words can't settle, with keys and variants.
   - **Principles in his words** (48a, 46a), applied to every later call.
   - **Checks each round:** a consistency pass, plus an audit for gaps nobody named before the spec.
   - **The spec comes last,** on the strongest model.

## 10. Mike's "Along the way" research — evaluated separately

The source is [research/along-the-way-mike.md](./research/along-the-way-mike.md), written by Mike's Claude without full app context and shared on 2026-10-10. It's kept apart from this plan's own research, as asked.

**The honest read:**
- The strongest evidence in it is evidence we already had: if-then plans, steeper delay discounting in ADHD, the CBT trials.
- The new *design* ideas rest mostly on **early** evidence: the reason behind pre-crastination, the doorway effect, behavioural momentum in adults, wait-learning.
- That makes them good reasons to try something, not proof that it works.
- Every item is held to principle 48a: would someone without ADHD want it?

| # | Idea | Evidence (as labelled there) | Without ADHD too? | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Offer a nearby small task "along the way" | Moderate (the behaviour); early (why) | Yes: saves a switch | **Adopt → ❓57** |
| 2 | Tie tasks to places, people and moments | Strong (if-then plans); early (ADHD cue advantage) | Yes: "next time I see Anna…" | **Adopt as cues → ❓58** |
| 3 | One offer per visit, silent in focus and calls, "Not now" is free, three skips → shrink, move or let go | Early (JITAI framework) | Yes | **Adopt as rules of ❓57 and ❓59** |
| 4 | Batch the queue by context; make switches visible | Moderate (attention residue) | Yes | **Adopt → ❓57** (Arrange by project + dividers) |
| 5 | A resume note before switching | Moderate | Yes | **Already decided** (the hand-off note) |
| 6 | Show the first step; a "touch" counts as progress | Early (microtasks); moderate (CBT breakdowns) | Mostly | **Explore → ❓60** (next subtask on the Now card + "Just start · 2 min") |
| 7 | A four-size ladder (Touch / Start / Chunk / All) | Early | Rarely | **Not adopted.** Four sizes are configuration; "Just start" keeps the useful part |
| 8 | "Riders": quick tasks placed before long ones for momentum | Early, and from children and single-case designs | Unclear | **Not adopted.** "Along the way" offers cover it without reordering |
| 9 | Show the pile honestly (time totals) | Strong (planning fallacy) | Yes | **Already decided** (capacity mirror + calibrated estimates, ❓10) |
| 10 | A short timed sweep, smallest first | Practice | Yes | **Explore → ❓60** (quick sweep run) |
| 11 | Metro status language (Good service / Delays) | — | No: a metaphor to learn | **Not adopted.** "Late" and "drifted" are plainer, and decided |
| 12 | Spare minutes before a call | Early (wait-learning) | Yes | **Explore → ❓60** (meeting prep) and ❓59's *Everywhere* |
| 13 | "Step away" trips and a launching pad | Early / practice | Low without a phone app | **Not adopted** (desktop only); revisit with mobile capture |
| 14 | Door modes that fade as habits form | Practice / theory | — | **Not adopted.** Replaced by one static setting (❓59); users prefer controls they set |
| 15 | Spatial "doors" layout (method of loci) | Small, not ADHD-specific | No | **Not adopted** |
| 16 | Temptation bundling | Moderate, fading effects | — | **Not adopted** (no clear place in the product) |
| 17 | The retracted self-imposed-deadlines study | — | — | **Applied:** struck from our evidence file |

**How this changes earlier reasoning:**
- It doesn't overturn any decision.
- It strengthens three that were already made: no red or streaks, skip never counts as a reschedule, the hand-off note.
- It turns two loose notes into calls:
  - "remind me when…" anchors, previously N9 → ❓58;
  - meeting prep → ❓60.

## Appendix — evidence

| Report | What it covers |
| --- | --- |
| [current-state.md](./research/current-state.md) | Every surface, its capability matrix, the top 15 limitations, the top 10 smells. Fuller notes: [Focus, Calendar, Home](./research/current-state-focus-calendar-home.md) · [Board, Timeline, drag and drop](./research/current-state-board-timeline-dnd.md) |
| [visual-audit.md](./research/visual-audit.md) | Element-by-element measurements, the propagating issues, the north-star kit, Standard vs Detailed. Capture scripts in `visual-audit-scripts/` |
| [early-decisions-audit.md](./research/early-decisions-audit.md) | 47 early decisions with keep / adjust / reverse verdicts, and the doc text to change |
| [structure.md](./research/structure.md) | How 15 tools structure work, what each role needs, candidates A / B / C |
| [role-journeys.md](./research/role-journeys.md) | Per-role complete sets, day-in-the-life flows, import formats, the gap map, the top 20 changes |
| [../tasks-dogfood/RESEARCH-2026-10.md](../tasks-dogfood/RESEARCH-2026-10.md) | Round 1: competitors, ADHD and productivity science, agents and MCP, segments |
| [along-the-way-mike.md](./research/along-the-way-mike.md) | Mike's "Along the way" research (shared 2026-10-10), kept separate and evaluated in §10 |
| [timeline-competitors.md](./research/timeline-competitors.md) | Round 2a: how 13 tools draw timelines, Gantts and roadmaps, decided question by question, plus a Moduo target sketch |
| [focus-competitors.md](./research/focus-competitors.md) | Round 2a: focus modes in 13 tools (timer controls, untimed focus, subtasks, calendar awareness, naming, reach) |
| [views-list-upcoming.md](./research/views-list-upcoming.md) · [views-board-detail.md](./research/views-board-detail.md) · [capture-references-teams.md](./research/capture-references-teams.md) | Round 2b: the everyday views compared with leaders, state by state |
| [gap-audit.md](./research/gap-audit.md) | Round 2a: 15 gaps and 13 contradictions found by reading the whole plan role by role and view by view |
| [prototypes/structure.html](./prototypes/structure.html) · [prototypes/round-1c.html](./prototypes/round-1c.html) · [prototypes/round-2a.html](./prototypes/round-2a.html) | Throwaway prototypes for the structure, round-1c and round-2a questions |
