# Lane 5 — What "pleasant and complete" Tasks means per role, and the gaps

> Raw research report from the Tasks re-plan, 2026-10-09 (`maciej` @ 95d988b0), kept for its evidence. The synthesis and the open calls are in [../REPLAN.md](../REPLAN.md). Nothing here is decided.

> Research lane, 2026-10-09, read-only, based on `maciej` @ `95d988b0`. Builds on `research-2026-10/segments.md` (sizes, pain statistics, the need matrix) instead of restating it. Nothing here is decided. Evidence tags: **[V]** read in official docs this session · **[F]** forum / review site · **[M]** from memory, not verified this session · **[I]** inference. Web budget held for 10 searches; the Trello, Asana and Jira export pages and Todoist's Quick Add article 404'd or redirected, so those rows are [M].

**Reading frame.** "Complete" for a role = *they can run a normal week without opening the old tool*. "Pleasant" = the first week feels like the old tool's best moments, not its setup. For each role the question is therefore: which 3–5 things make the old tool unnecessary, what must survive the move, and which single moment only Moduo can give them.

**Moduo vocabulary used below.** `⌘⇧K` global capture · `c` capture · Inbox → triage keys `b d s p l a q` · Display group-by (TV-U2) · Filter `f` · `/` search · saved views (TV-U8) · Queue → `▶ Start run` → Now card → `⏎` Done · Skip · `w` hand off (In flight, TV-F4) · Calendar: drag a task onto the grid = time block, "Start focus", done / push / shrink / drop when it elapses · drift triage · email → task (desktop) · note checkbox → task · contact hub roll-up · MCP via the user's own Claude / ChatGPT.

---

## 1. The six core roles

### 1.1 Student (replacing Todoist; also Google Calendar, paper planners, Notion student templates)

**Loves in Todoist [V/F]:** Quick Add parses `tomorrow 4pm`, `every other tuesday starting March 3`, `#project`, `@label`, `!30min before` and a separate deadline in one line ([Todoist Quick Add](https://todoist.com/hc/articles/115001745265)). Today and Upcoming as the two home screens. Free, fast, on the phone. Board layout per project. **Hates [F]:** no real start dates and thin team features ([aiindigo review](https://aiindigo.com/blog/honest-review-is-todoist-still-the-standard-for-task-management-in-2026), [Capterra](https://www.capterra.com/p/149339/Todoist-for-Business/reviews/)); Karma / streak guilt [M]; filters need a query syntax [M]; templates are personal-only (segments.md §1f).

**Minimum complete set.** *Must:* a course = container; due dates that show on a calendar; capture with a date in one line; simple recurrence ("every Tue 10:00"); a time-of-day reminder; a Today / Upcoming view; free. *Nice:* group-project sharing, study blocks, syllabus import, phone.

**Day in the life, in Moduo terms.** Monday 9:00 `⌘⇧K` `Problem set 4 due friday #cs101` (today `#` = tag; see §4 Q2) → Inbox → `b` CS101 `d` Fri → Display → Group by Time in All shows Today · Tomorrow · This week → `q` three items → `▶ Start run` with pomodoro → `⏎` done → Calendar: drag "Essay draft" into Wednesday 14:00 → Thursday the block elapses → *push* to Friday morning → Sunday: Weekly review prompt in Claude ("what drifted, what's due") → re-queue.

**Switching / import.** Todoist exports one CSV per project: rows typed `task` / `section` / `note`, `INDENT` 1–4, `PRIORITY` 1–4, `DATE` (natural language, recurrence included), `DEADLINE`, `DURATION`, `RESPONSIBLE`; completed tasks and the start of a recurring date are not exported [V] ([Todoist CSV format](https://todoist.com/help/articles/360000748525)). Must survive: project → bucket, section → *an ordered group inside the bucket* (Moduo has none; see §3), labels → tags, `DATE` → `scheduled_at`, `DEADLINE` → `due_date`, notes → comments, depth-2 sub-tasks → subtasks, depth 3–4 flattened under them with the chain in the title. Priority: p1→high, p2→med, p3→low, p4→none. Recurrences the vocabulary can't parse keep the raw text on the task and are counted in the import report. First run: pick "Study" → seeded course buckets (empty, renamable), an "Upcoming" saved view, three teaching tasks.

**One great moment.** Paste the syllabus (or the course page) into Claude → `tasks_capture` lands every deadline in the right course bucket with dates → they are on the calendar before the first lecture. Then: lecture-note checkboxes are real tasks, and the exam week shows as day-fullness, not a red wall.

### 1.2 Developer / small dev team (replacing Linear; also GitHub Issues)

**Loves in Linear [V/F]:** speed and keyboard-first everything (`C` create, `⌘K`), Triage as an inbox with accept / decline / duplicate / snooze on `1 2 3 H` ([Linear triage](https://linear.app/docs/triage)), cycles of 1–8 weeks with automatic rollover and a cooldown ([Linear cycles](https://linear.app/docs/use-cycles)), `ENG-123` keys that link branches and PRs and move the issue to done, delegating issues to coding agents (RESEARCH §6). GitHub Issues gained sub-issues and issue types in 2025 ([GitHub changelog](https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/)) [V]. **Hates [F/M]:** Linear's 250-issue free cap, per-seat price, and that everything non-engineering (the customer who reported the bug, the invoice) lives elsewhere; GitHub Issues has no priority or due date without Projects and feels slow for triage [M].

**Minimum complete set.** *Must:* dense keyboard list, short IDs, PR link on a task, bug vs feature (a tag), an in-review / waiting state, triage keys for Inbox, agent hand-off, "this week" scoping. *Nice:* cycles, velocity, estimates-as-points, GitHub two-way sync.

**Day in the life.** Customer email about a bug (desktop) → email → task, auto-linked to the contact and thread → Inbox triage: `1` accept into Product (bucket + assignee), `2` decline, `3` duplicate-of, `h` snooze (= scheduled) → Detailed preset shows `MOD-142` on rows → in the terminal: `take MOD-142` → the task shows *Waiting on Claude · working*, PR link → `w` hand off from a run to work on MOD-150 meanwhile → *ready for review* lights the In-flight card → review, merge, `⏎` done → Friday: Group by Time "This week" + the Weekly review prompt stand in for the cycle review.

**Switching / import.** Linear imports natively from Jira, GitHub, Asana and Shortcut, and Trello through its CLI importer ([Linear import](https://linear.app/docs/import-issues), [CLI importer](https://linear.app/docs/cli-importer)); out of it there is only CSV and the API [M]; GitHub issues come out through the API / `gh` [M]. Must survive: team → bucket, labels → tags, status map (backlog / todo → todo without a date; in progress / in review → in_progress, review later → waiting on a person; done → done; canceled / duplicate → archived), priority map (urgent + high → high, reported since Moduo has no Urgent level by N4), estimate, comments with author names, sub-issues → one level (deeper levels flatten with the chain in the title), and above all **the old key `ENG-123` as a resolvable alias** of the new `MOD-n` so ⌘K, search and inline text still find it. First run: "Build software" → Detailed preset, Inbox-first, a "This week" saved view, a Product bucket.

**One great moment.** The bug report email, the customer's hub, the task, the agent's PR and the "fixed, reply sent" email are one linked thread — Linear's graph stops at the PR; Moduo's reaches the person who reported it.

### 1.3 PM (replacing Jira and Trello)

**Loves [V/F]:** Trello's board simplicity and drag-anything, Butler rules; Jira's workflows, sprints, burndown / velocity reports, JQL. **Hates [F]:** Trello breaks down past one board: no cross-board visibility, no dependencies, label sprawl, automation that fragments into Power-Ups ([ClickUp on Trello](https://clickup.com/learn/topic/task-management/tools/trello/), [Lark review](https://www.larksuite.com/blog/trello-review)); Jira is slow to load, needs an admin, and its configuration surface overwhelms small teams ([Capterra Jira](https://www.capterra.com/p/19319/JIRA/reviews/), [GitScrum](https://docs.gitscrum.com/en/how-to/best-jira-alternative-for-small-dev-teams)).

**Minimum complete set.** *Must:* board with stage columns per project, a view across all projects, who's-on-what, waiting / review state, dependencies and a timeline, "what's late", comments and @mentions, templates for repeat projects. *Nice:* sprints, burndown, custom fields, automations, portfolio status.

**Day in the life.** Morning: All → Group by Assignee → the team-load widget on Home (queue size, waiting, due this week) → stand-up replaced by claims ("Mike is on this") → a client thread arrives → task *waiting on Anna · check back Thu* → Board of the project grouped by stage → drag card to "Review" (= waiting on the reviewer) → Timeline for the two dependent tasks → Friday: bucket overview ("4 of 18 · waiting on 3 · due this week 5"), paste it into the client email.

**Switching / import.** Trello exports JSON per board (lists, cards, labels, checklists, comments, members, dates, attachment URLs); CSV is Premium [M]. Jira exports CSV, 1,000 rows synchronously or 10,000 asynchronously ([Atlassian KB](https://confluence.atlassian.com/jirakb/export-over-1000-results-in-jira-cloud-779160833.html)) [V]; comment columns exist in the all-fields export [M]. Asana's CSV has Task ID, dates, name, assignee, tags, notes, project and parent task; sections appear as task rows ending in a colon; comments aren't exported ([Asana forum](https://forum.asana.com/t/csv-export-components/1814), [Asana](https://asana.com/ru/inside-asana/export-to-csv.md)) [F]. Must survive: Trello lists / Asana sections → ordered groups (§3), labels → tags, checklists → subtasks, comments attributed, Jira epic → container (the structure lane's call), sprint → a tag, custom statuses → the nearest fixed status plus the old name as a tag. First run: "Run projects" → Board default, one project template.

**One great moment.** A project status that writes itself: the bucket overview and (later) the no-login client link say what's done, what's waiting on whom and what's due, computed from the work and the email threads — no Friday report assembly.

### 1.4 Founder / ≤5-person team (replacing Todoist or Things + Notion + Slack + a spreadsheet CRM)

**Loves:** Things' calm and speed [M]; Todoist's capture; Notion's one-place feeling; Slack's immediacy; the spreadsheet's honesty. **Hates:** Things has no sharing (segments.md §1a); Notion becomes a second job; Slack buries decisions; the CRM sheet rots because nothing logs itself; four subscriptions for one small team.

**Minimum complete set.** *Must:* capture anywhere, personal queue, assignee + claims, comments, email → task tied to the contact, recurring admin, a calendar that holds tasks, "who's on what". *Nice:* templates (onboarding, monthly close), follow-up resurfacing, team load, a chat module (planned for Duo/Team).

**Day in the life.** `⌘⇧K` from anywhere → Inbox triage at 9:00 → investor reply arrives → "Waiting on Anna" clears itself when she answers → call at 11:00 from a booking link → the meeting note's checkboxes become tasks linked to the event and the attendee → `▶ Start run` for the afternoon → `w` hand off "waiting on the designer" with a check-back → Home shows the team load → Sunday: Weekly review prompt in Claude, drift re-planned with Break down.

**Switching / import.** Todoist CSV as in 1.1; Things has no export beyond its URL scheme and Reminders bridge [M]; Notion task databases come out as CSV with properties [M]; the spreadsheet CRM is already covered by the Contacts CSV importer (CO-3, shipped). Must survive: areas / projects → the structure lane's containers, dates, recurrence, comments, people → contacts.

**One great moment.** One thread: the investor's email, the follow-up task, the call on the calendar and the contact hub are one object, and "haven't heard from Anna in 14 days" surfaces from the graph without anyone logging a thing.

### 1.5 Freelancer / agency of 2–5

Profiles and statistics: segments.md §1a–1c. **Loves [F]:** Trello / Asana boards per client, Toggl's one-click timer, HoneyBook's client-facing side. **Hates:** time tracking in another app, clients who won't log in, flat checklists in HoneyBook / Dubsado, per-seat minimums.

**Minimum complete set.** *Must:* bucket ↔ client, waiting-on-client with a check-back, timer that rolls up by client, templates per deliverable, in-review state, who's-on-what. *Nice:* a no-login status link, hours export, revision counters.

**Day in the life.** Monday: client hub → their buckets, open tasks, waiting items, hours → "Client onboarding for Anna" template → run with the timer → `w` "sent for review" → the reply arrives, the card lights up → month end: time by client → CSV → invoice elsewhere.

**Switching / import.** Trello JSON / Asana CSV as in 1.3, plus Toggl / Harvest CSV time entries (`task_time_entries` can take them as `legacy` or adjustment rows) [I]. Must survive: client boards → buckets linked to contacts, hours per client.

**One great moment.** The client hub: everything done for Anna, with hours, with zero logging — no tool holds task + contact + email + time together.

### 1.6 Creators

Profile: segments.md §1e. **Loves:** Notion content-calendar templates (stage board + calendar + per-episode checklist). **Hates:** building and maintaining the database; the calendar in Notion is not their life calendar.

**Minimum complete set.** *Must:* a stage board (idea → draft → edit → publish) per show or channel, a publish calendar that is the same calendar as life, recurring series, an episode template, sponsor deliverables tied to a contact. *Nice:* a review state with a collaborator, attachments on the piece, a waiting-on-sponsor state.

**Day in the life.** Idea captured by voice into Claude → `tasks_capture` → Board grouped by stage tag → "Episode" template spawns the checklist with offsets (script −7d, record −4d, publish 0) → the publish date sits on the calendar → sponsor contact hub shows every deliverable and its state.

**Switching / import.** Notion database CSV (stage property → tags, date → due) [M]; Trello JSON. First run: "Create content" → Board default, a stage tag set seeded, one episode template.

**One great moment.** The sponsor's hub: every deliverable, its stage and the email thread in one place, and the publish calendar is the calendar your dentist appointment is on.

---

## 2. Additional roles — target or not

| Role | Fit with the spine | Verdict | What they need that the six above don't already force |
| --- | --- | --- | --- |
| **Researchers / PhD students** (Todoist + Notion + Trello + Zotero [F]: [IATED](https://library.iated.org/view/BORONAT2020USE), [Rochester](https://rochester.edu/College/gradstudies/support-resources/blog/2025-11-06-must-have-tools.html)) | Strong: year-long milestones (Timeline), supervisor email → task, months-long "waiting on reviewer", notes ↔ tasks, the free tier as the funnel into paid work | **Target** (the senior end of the student role) | Nothing new in the data model: Timeline + waiting + templates + the "Deadlines from this document" prompt. No reference manager; the user's agent bridges Zotero. |
| **Ops / admin generalists** (office manager, EA, chief of staff) | Strongest spine fit after freelancers: email → task, vendors as contacts, recurring admin, templates, waiting on vendors | **Target** (inside the founder choice "Run a business") | Templates, "remind me at", recurrence parity, follow-up resurfacing. |
| **Consultants / coaches** (segments.md §1b) | Strong: booking links already exist, contact-tied follow-ups, session-prep templates | **Target** (inside freelancer) | Nothing beyond 1.5. |
| **Teachers** | Medium: the weekly structure fits, but grading, rosters and parent communication live in the LMS, and they need a phone in the corridor | **Don't target now**; spillover from the student funnel | LMS integrations and mobile, both out of scope. |
| **Households / couples** (segments.md §1g) | Shared lists + recurrence + claims already work; mobile and location reminders don't exist | **Don't target**; keep as spillover from founder pairs | Mobile. |
| **Sales / BD reps** | Weak: pipelines, sequences, dialers; Moduo's light CRM is for founder-led sales | **Don't target** | A pipeline module Moduo is not building. |

---

## 3. Gap map: roles × current state × decided direction

Scale: **Blocks switching** (they keep the old tool open) · **Hurts daily** (they switch but grumble) · **Nice**. Provenance: *Decided* (RESEARCH ❓ call or spec block, not built) · *New* (this lane) · *By design* (out of scope on purpose).

| # | Gap | Roles | Severity | Provenance |
| --- | --- | --- | --- | --- |
| G1 | **No task import of any kind** (only contacts CSV and Notion notes import exist; IM-3 / IM-4 are post-alpha stubs) | all switchers | Blocks switching | New (ledger stubs) |
| G2 | **Agents can't create or edit tasks** through MCP, so neither "syllabus → tasks" nor an agent-mediated import works | S, R, D, F, O, A, C | Blocks switching | Decided ❓7 |
| G3 | **No "ordered group inside a container"**: Todoist sections, Trello lists, Asana sections and Linear projects-within-teams have no landing place; imports and stage boards both need one | S, P, A, C, F | Blocks switching | Input to the structure lane |
| G4 | **No onboarding** (progressive single-module onboarding is still open in ROADMAP Wave 0); Tasks opens on the time-of-day bucket, never a Today / Upcoming surface | S, P, C, F | Blocks switching for Todoist / Trello users | New; an Upcoming opener **re-decides spec §9.4** ("never the full list first"), collision class (c) |
| G5 | **Due dates aren't on the Calendar grid**: only scheduled tasks render; due-only tasks sit in the right-panel "Due soon" list (`calendar/panel.ts`, `calendar-page-view.tsx:317`) | S, R, C, household | Blocks switching from Google Calendar / Todoist Upcoming | New |
| G6 | **No time-of-day reminder on a task** (no `remind` anywhere in tasks / spine / calendar); only scheduled time + drift + check-backs + the overdue digest | S, O, household | Blocks switching for students | New |
| G7 | No lasting **waiting / in-review** state outside a run | D, P, A, F, C, O, R | Blocks switching for client work and review flows | Decided ❓5 |
| G8 | **Board groups only by status or bucket** (`task-board-view.tsx`), so stage boards need the custom statuses Moduo refuses | C, P, A | Blocks switching for creators and Trello PMs | New (extends TV-U2) |
| G9 | No **handles**; PR links only inside a run; no "take MOD-142" hand-off | D, P, F | Hurts daily (blocks Linear devs) | Decided ❓3/4/6 |
| G10 | No **templates** | A, C, O, R, P | Hurts daily | Decided ❓9 |
| G11 | No **bucket ↔ client link, overview or time by client** | A, F, O, P | Hurts daily (blocks agencies) | Decided ❓8 |
| G12 | **Inbox triage is manual**: no accept / decline / merge / snooze keys | D, P, F | Hurts daily | New |
| G13 | **Recurrence vocabulary** is narrow: no "every 3rd friday", no from-completion rules | S, O, C, household | Hurts daily | New |
| G14 | **Capture tokens**: `#tag` only; no `@name`, no reminder token; Todoist's `#project` habit lands on tags | S, D, F | Hurts daily | New (TV-U7) + Q2 |
| G15 | **Row preset / sortable headers** | D, A | Hurts daily | Decided ❓2 |
| G16 | **Team load** on Home | F, A, P | Hurts daily | Decided ❓12 |
| G17 | **Email-linked waits and email → task are desktop-only** | F, A, O on web | Hurts daily on web | By design |
| G18 | **Follow-up resurfacing** from the contact graph | F, A, O | Nice; hurts consultants | New (spine) |
| G19 | **No mobile** | S, household, C | Blocks switching for students who live on the phone | By design (out of scope now) |
| G20 | **No client status link** | A, P | Nice until G7 + G11 exist | Decided park ❓11 |

Preconditions, not gaps: Linear-parity **speed** (the perf budget is still not an enforced gate, ROADMAP Wave 0) gates the developer role, and multi-select / bulk (TV-U5) gates PM triage.

---

## 4. Conflicts between roles, and how one product serves all without packs

**The three real conflicts (designer calls):**

**Q1 · Stage columns.** Creators and Trello PMs think in free-form columns (idea → draft → edit → publish; Backlog → Doing → Review → Done). Moduo has four fixed statuses plus the proposed waiting *field*. The discriminating question: **is "Board grouped by tag (or by waiting-on / assignee / priority), remembered per bucket" an acceptable stage substitute, or does the Board need a per-bucket column mapping of its own?** The detail that decides it: tags aren't exclusive. A task with two stage tags sits in two columns, and dragging across columns is ambiguous unless one tag group is *one-of* ("stage"), which is a step toward the custom status Moduo refuses. Recommendation: grouped-by-tag Board first (G8, no vocabulary change); a one-of stage group only if a creator's dogfooding asks; no per-bucket column map.

**Q2 · `#project` muscle memory.** Todoist users type `#CS101`; GR-0 made `#` = tag. Either accept "courses and projects are tags" in capture, or let capture's `#` suggestions offer **buckets first, then tags**, the picked bucket filling the Bucket pill (no fourth glyph; GR-0's rule is about prose). Recommendation: the latter, as a TV-U7 detail; with projects → buckets and labels → tags on import, the only relearning is `@label` → `#tag`.

**Q3 · Cycles / sprints / reports.** Deliberately not matched (spec: Linear-light). The substitute is Group by Time "This week" + a saved view + the Weekly review prompt + drift as the rollover (Linear's cycle rollover and Moduo's drift are one mechanism, framed differently). Say it plainly: for small-team PMs "complete" means *replaces Trello*; a Jira team that needs burndown is not the target.

**How one product serves all** — one onboarding question ("What will you run in Moduo?" Study · Build software · Run projects · Run a business · Client work · Create content) that sets defaults and seeds, never toggles features:

| Changes per role | Student | Developer | PM | Founder / ops | Freelancer / agency | Creator |
| --- | --- | --- | --- | --- | --- | --- |
| Opens on | Upcoming view (All, grouped by Time) | Inbox, Detailed preset | Board of the first project | Inbox | Client bucket list | Board grouped by stage |
| Row preset / density | Standard · comfortable | Detailed · dense | Standard · compact | Standard · comfortable | Standard · compact | Standard · comfortable |
| Seeded saved view | Upcoming · Today | This week · Mine | Waiting · Due this week | Waiting on people | Per-client views + Waiting on client | Pipeline (by stage) · Publish calendar |
| Seeded tags / template | course tags; none | bug · feature; none | none; "Project kickoff" template | none; "Monthly close" template | "Client onboarding" template | stage tags; "Episode" template |
| Home widgets lead | Queue · Calendar | Queue · Pomodoro | Team load · Due this week | Queue · Team load · Time | Time by client · Waiting | Queue · Calendar |
| Capture hints | `#course`, "tomorrow 4pm" | `@name`, `MOD-n` | `@name`, `#stage` | `@name` | `#client` | `#stage` |
| Three teaching tasks | q · ▶ run · drag to calendar | q · w hand off · copy branch | board drag · waiting · overview | ⌘⇧K · email → task · claims | timer · template · client hub | board drag · template · calendar |

**What never changes:** the data model and the four statuses; routes and the sidebar; the gestures (`⌘⇧K`, `q`, `▶`, `w`, drag); the Queue and the run; the notification rules (digest + the few precise exceptions); the detail panel; the spine links; MCP tools. Progressive disclosure does the rest: Detailed preset, Timeline, dependencies, time tracking, templates and the client loop all exist for everyone and appear when used, never behind a pack. Density and the preset stay user-level settings anyone can change in one step (RESEARCH ❓2).

---

## 5. What Moduo should deliberately NOT match — and why it is still complete

| Incumbent feature | Not matched | Still complete because |
| --- | --- | --- |
| Custom workflows / statuses (Jira, Linear, ClickUp) | Four fixed statuses + waiting field + tags | At ≤5 people the stages people use are todo · doing · waiting · review · done; review *is* "waiting on a person" |
| Cycles, sprints, velocity, burndown, story points | Not built | "This week" grouping + saved view + Weekly review prompt + drift rollover + the capacity mirror with calibrated estimates (❓10) answer the same questions |
| JQL / advanced query language | Filter with is / is not / any of, saved views | Every query a five-person team runs is a filter chip; the rest is a sentence to their agent over MCP |
| Butler / Jira automation / rule builders | No rule builder | The rules small teams write (done leaves queues, waiting clears on reply, recurrence, drift) are built in; bespoke rules run as the user's scheduled agent through MCP |
| Power-Ups / app marketplace | No | MCP is the integration surface; the "lethal trifecta" risk (RESEARCH §6) argues against an open-world plug-in layer |
| Custom fields / databases (Asana, ClickUp, Notion) | No | A client is a contact, a stage is a tag, a deadline is a date; no schema to maintain (PRODUCT_BRIEF §9) |
| Multi-level nesting (Todoist 4, GitHub 8) | One level | Deep trees are planning artefacts; "Break it down" lives on the parent and the import flattens honestly |
| Karma, streaks, confetti | No | A visible done list beats streaks (Harkin 2016; Silverman & Barasch 2023, RESEARCH §5) |
| Motion-style auto-scheduler | No | Drag-to-schedule plus reversible, reason-annotated suggestions only (PRODUCT_BRIEF §9) |
| Urgent priority level | No | Mere-urgency effect (N4); high + waiting + due covers it |
| Guest logins, role matrices, portfolio "at risk" | No | The no-login status link (❓11) is the honest substitute; alarms are the thing users leave over |
| Card covers, inline images | No (decided) | Attachments on every surface (AT-*) |
| Mobile apps | Not now | Not a design position to defend; say it on the pricing page so students decide with open eyes |

---

## 6. The 20 changes that most increase "can replace X", ranked

Roles: S student · R researcher · D developer · P PM · F founder / team · O ops · A freelancer / agency · C creator. Sizes: S ≤ one block fold-in · M one block · L several blocks or a risky path.

| # | Change | Roles | Size | Status |
| --- | --- | --- | --- | --- |
| 1 | **MCP task writes** (`tasks_capture` ≤25, `tasks_update`, subtasks, dependencies, `tasks_comment`) + the Plan my day / Weekly review / Break this down prompts | all | M | Decided ❓7 (MCP-1 slice) |
| 2 | **"Deadlines from this document" and "Extract actions" prompts** (syllabus, brief, meeting note → dated tasks linked to the event and attendees) | S R F O A | S | New, rides on #1 |
| 3 | **Agent-mediated import today**: a documented recipe (the user's Claude reads Todoist / Linear / Trello through *their* MCP, writes through #1) + a `source_ref` on tasks for idempotent re-runs; old keys (`ENG-123`) become handle aliases once #10 exists | all switchers | S (recipe + `source_ref`); aliases after #10 | New |
| 4 | **Native importers**: Todoist CSV (sections, notes, indent, DATE / DEADLINE split), Trello JSON, Linear / Jira / Asana CSV, GitHub via API, generic CSV + markdown checklist (IM-3), each ending in an import report of what was mapped or kept as text, plus the IM-4 leaving checklist | all switchers | L | New (IM-3 / IM-4 stubs) |
| 5 | **Onboarding choice → seeded defaults** (the §4 table; one-click "Remove the examples") | all | M | New (ROADMAP Wave 0 open item) |
| 6 | **Due-dated tasks as all-day chips on the Calendar grid** (week / month) + seeded "Today" and "Upcoming" saved views | S R C household | M | New; needs TV-U8; opening Tasks on Upcoming re-decides spec §9.4, class (c): designer call |
| 7 | **"Remind me at"** on a task: one precise notification (OS on desktop, toast on web), capture token `!16:00` | S O household | M | New; adds a precise-notification class to the digest rule (DF-9, N5): designer call |
| 8 | **Waiting on… field** with check-back, auto-clear, Filter + Group by | D P A F C O R | M | Decided ❓5 |
| 9 | **Agents as delegates**: `tasks_ready`, atomic claim, session update / resolve, needs-input, one notification | D F O | M | Decided ❓6 |
| 10 | **Handles `MOD-142`** resolved in ⌘K, `/`, deep links and every MCP tool; "Copy branch name" in the detail ⋯ | D P F A | M | Decided ❓3/4 + S addition |
| 11 | **Board columns from any Display group** (tag, assignee, priority, waiting-on), remembered per bucket; see Q1 | C P A | M | New (extends TV-U2 / TV-U4) |
| 12 | **Row presets Standard / Detailed** with sortable column headers in Detailed | D A P | S | Decided ❓2 (TV-U2) |
| 13 | **Checklist templates** with relative offsets | A C O R P | M | Decided ❓9 |
| 14 | **Client loop**: bucket ↔ contact, bucket overview, time by client CSV | A F O P | L | Decided ❓8 |
| 15 | **Inbox triage keys**: accept, decline, merge as duplicate (links and comments move), snooze (= scheduled) | D P F | M | New |
| 16 | **Recurrence vocabulary parity** for the common Todoist rules ("every 3rd friday", "every workday at 9", from-completion "every!") on the existing rrule engine | S O C household | M | New |
| 17 | **Capture tokens**: `@name` assigns, `#` suggests buckets then tags (Q2), `!time` reminder (#7); subtasks inline (N7) | S D F | S | New (TV-U7) |
| 18 | **Team-load widget** on Home | F A P | S | Decided ❓12 |
| 19 | **Follow-up resurfacing** from the contact graph (no reply in 14 days → a suggested task) + email "Waiting on reply" | F A O | M | New (spine) |
| 20 | **Tasks export in importer-compatible shape** (Todoist-style CSV per bucket + JSON), so "leave any time" is as true as "arrive easily" | all | S | New; extends DF-19g |

After these: the **no-login client status link** (❓11, L) once #8 and #14 exist. Assumed, not listed: calibrated estimates (❓10), "Break it down" (N1) and the done-this-week line (N2) folding into the open Focus blocks; speed as an enforced perf gate; TV-U5 bulk actions.

**Sequencing.** #1 → #3 gives every role a switching path within weeks at no UI cost; #5 + #6 + #7 + #16 + #17 are the student gate; #8 + #9 + #10 + #15 the developer gate; #8 + #11 + #13 + #14 + #18 the PM / agency / creator gate; #4 is the big-ticket item and waits for the structure lane to settle what sections import into (G3). Mobile (G19) is the one gap no Tasks change closes.

---

## Sources

Official docs read this session [V]: [Todoist CSV format](https://todoist.com/help/articles/360000748525) · [Todoist Quick Add](https://todoist.com/hc/articles/115001745265) (via search summary; the article fetch returned the help homepage) · [Linear import](https://linear.app/docs/import-issues) · [Linear triage](https://linear.app/docs/triage) · [Linear cycles](https://linear.app/docs/use-cycles) · [Linear CLI importer](https://linear.app/docs/cli-importer) (search summary) · [GitHub sub-issues / issue types](https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/) · [Jira export limits](https://confluence.atlassian.com/jirakb/export-over-1000-results-in-jira-cloud-779160833.html).
Forums and reviews [F]: [Asana CSV components](https://forum.asana.com/t/csv-export-components/1814) · [Asana export](https://asana.com/ru/inside-asana/export-to-csv.md) · [Capterra Todoist](https://www.capterra.com/p/149339/Todoist-for-Business/reviews/) · [aiindigo Todoist 2026](https://aiindigo.com/blog/honest-review-is-todoist-still-the-standard-for-task-management-in-2026) · [Capterra Jira](https://www.capterra.com/p/19319/JIRA/reviews/) · [GitScrum on Jira for small teams](https://docs.gitscrum.com/en/how-to/best-jira-alternative-for-small-dev-teams) · [ClickUp on Trello](https://clickup.com/learn/topic/task-management/tools/trello/) · [Lark Trello review](https://www.larksuite.com/blog/trello-review) · [eesel Linear vs Jira](https://www.eesel.ai/blog/linear-vs-jira) · [Rochester grad tools](https://rochester.edu/College/gradstudies/support-resources/blog/2025-11-06-must-have-tools.html) · [IATED thesis-planning study](https://library.iated.org/view/BORONAT2020USE).
Not verified this session [M]: Trello export plans and JSON contents (page 404'd), Jira CSV comment columns, Linear and Notion CSV export columns, Things' lack of export, GitHub's lack of a native CSV export.
Repo evidence: `specs/tasks-v2.md`, `.design/tasks-dogfood/RESEARCH-2026-10.md` + `research-2026-10/*`, `docs/PRODUCT_BRIEF.md`, `docs/ROADMAP.md` (Wave 0 status, IM-3 / IM-4), `specs/BUILD_ORDER.md` (MCP-1), `src/features/calendar/panel.ts`, `src/features/calendar/ui/calendar-page-view.tsx`, `src/features/tasks/ui/task-board-view.tsx`, `src/features/tasks/parse/capture-parser.ts`, `src/features/tasks/default-view.ts`.
