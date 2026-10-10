# gr8r walkthrough notes (2026-10-09, live click-through at 1440x900)

> Raw research report, 2026-10-09, kept for its sources. The synthesis and the open calls are in [../RESEARCH-2026-10.md](../RESEARCH-2026-10.md). Nothing here is decided.

What it is: a front-end-only demo ("Gr8r Studio", persona Tanjim Islam, 8-person design studio, seeded data, several tabs render empty until re-clicked, settings gear inert, Calendar/Timeline animate in). A Linear x Asana hybrid aimed at a studio with teams. Pattern reference, not market evidence.

## Navigation
- Sidebar: Home, Inbox (4), My Tasks (2), Favorites, Notifications (6) | Workspace: Overview, Projects, Tasks, Calendar, Timeline, Members, Activity | Projects (each expands: Board, List, Timeline, Files; star = favorite; restricted project has lock icon) | Archive | Teams (Design, Engineering, Marketing, Product) | Help, Settings, account.
- Top bar: ⌘K "Search or jump to…", notifications bell, "+ New" (Task, Project, Team, Invite member), avatar.
- Keys: N new task, P new project, / search, ? shortcuts, [ toggle sidebar, ⌘⇧L dark mode, G then H/T/P/I/C/S navigation, ⌘↵ submit/send.

## Home
- Greeting + date + "Here's what's happening across your workspace".
- 4 stat tiles: Active projects 5 (1 at risk) · Open tasks 39 (7 assigned to you) · Completed 9 this week · Overdue 2 need attention (red).
- My tasks card with tabs Upcoming 6 / Overdue 1 / Completed 1; rows = status ring, title, project dot+name, priority bars, due (Today in amber).
- Project progress table: project, status pill, progress bar %, due, team avatars.
- Upcoming deadlines: Today / Tomorrow / This week (+10 more), with priority glyph + assignee avatar.
- Recent activity feed: "Sarah Chen moved Create homepage wireframes to Review in Website Redesign · 38m ago".

## Tasks (workspace-wide)
- "Every task across 6 projects." Search, Filter, Sort: Manual, Group: Status; layouts List / Board / Table.
- List rows: checkbox · ID (WEB-130, mono, muted) · title · subtask count (1/3) · comment count · Status · Assignee (avatar + full name) · Priority (bars + word; Urgent = red square) · Due (relative: Today/Tomorrow/Sun/Oct 27; "Set date" placeholder) · Project (dot + name) · ⋯. Grouped by status with counts and "Add task" per group. Subtasks expand with a chevron.
- Statuses (fixed in demo): Backlog, To Do, In Progress, Review, Done.
- Priority: Low, Medium, High, Urgent.
- IDs: per-project prefix (WEB, MOB, MKT, LCH, DS, MW) + number. ⌘K resolves "WEB-1" to matching tasks with the ID shown right-aligned.
- Filter popover: "Combine filters to narrow the task list, e.g. Status is In Progress and Assignee is Sarah." Dimensions: Status, Assignee, Priority, Due date, Project, Labels, Created date, Updated date. Active filter shows as a chip "Priority is Urgent, High ×", "+ Add", "Clear all".
- Table view: columns resizable; "Columns" picker (Status, Priority, Assignee, Due date, Start date, Labels, Dependencies, Estimate, Created, Project) + "Reset widths". ID shown next to the title. Labels show as coloured chips.

## Task detail (side panel)
- Header: project breadcrumb / WEB-112 · Mark complete · favourite ★ · copy link · expand to full page · close.
- Properties: Status, Priority, Assignee, Due date, Start date, Project, Labels (chips), Repeat, Estimate (2d), Blocked by.
- Description; Subtasks with progress bar (1/3) and inline add; Attachments (drop zone + Upload); Comments (2) | Activity (0) tabs; comments have @mentions, emoji reactions, attach in composer, ⌘↵ to send.

## Projects
- Project = first-class object: icon, name, status (Planning / In Progress / At Risk / On Hold / Completed), description, progress % (done/total), due date, last activity, members, lead, team, start date, milestones.
- Projects page: grid / list / table; filter by status; sort by recent activity, name, due date, progress. Restricted project card: "Restricted — request access to see tasks".
- Project page tabs: Overview, Board, List, Table, Calendar, Timeline, Files, Activity, + saved views (e.g. "High priority" = filter chip Priority is Urgent, High) and "+" → Save view dialog (name + layout; "Save the current filters as a tab on this project").
- Project Overview: About (editable), Progress ("4 of 18 tasks done · 22% · 24 days until Nov 2 · 1 overdue" + status-segmented bar), Coming up list, Details (status, lead, team, start, due, members), Milestones (dated diamonds), Recent activity.
- Files tab: every file in the project across tasks, filter by type (Figma, PDF, Archive, Image, Spreadsheet, Document, Code), sort, upload up to 250 MB each.
- Board: cards = labels (coloured dot + word) on top, title, subtask progress bar, ID, priority glyph, due, comment/attachment counts, assignee avatar.

## Workspace Overview ("Health of every project")
- Tiles: Projects 6 (1 completed), Tasks 48 (39 open), Completion rate 19%, Members 8 (1 pending invite).
- Portfolio table: Project, Lead, Status, Progress, Open, Overdue, Due.
- Tasks by status (stacked bar + counts + %).
- Workload: open tasks per person, bar segmented by status.
- Upcoming milestones across projects.

## Calendar / Timeline (workspace)
- Calendar: month/week; tasks on their due date as chips coloured by project, timed events (11:00 Campaign kickoff, 15:00 Launch sync); done ones struck through; "+1 more".
- Timeline: weeks/months; group by project; milestones row; bars with assignee avatar; dependency curves; Today marker.

## Inbox / notifications
- Inbox tabs: Unread / All 6 · Mentions 2 · Assignments 1 · Comments 1 · Updates 2. Two-pane: "Read the conversation and reply without leaving your inbox."
- System items: "Campaign brief is due today", "Product Launch is at risk — 3 tasks due this week are not started".
- Notification settings: Email, Push, Mentions, Task assignments (assigned / my task changes status / my task is overdue).

## My Tasks
- "1 due today · 1 overdue · 5 upcoming". Groups Overdue / Today / Upcoming / Completed (collapsed). Layout List / Calendar.

## Members / Teams / Permissions
- Members table: role (Owner/Admin/Member/Guest), team, active projects, tasks, last active (Online / 22m ago), status (Active / Invited). Guest = diego@freelance.io.
- Teams group people + projects.
- Permissions: Members can create projects; Members can invite guests ("Guests only see projects they are added to"); Allow public share links ("Anyone with the link can view a project"); role × permission matrix (view, comment, create/edit tasks, create projects, invite, manage roles, workspace settings, billing, delete workspace).

## Activity
- Workspace-wide feed, filter All / Status changes / Comments / Projects, filter by person; grouped Today / Yesterday / This week / Earlier.

## Settings worth noting
- Appearance: theme, accent (6), **Density: Sidebar density Comfortable/Compact; Task display Comfortable/Compact ("Row height in lists and card padding on boards")**; Motion follow system / reduce.
- Projects: Default project view (Board/List/Table/Overview/Timeline); Show completed tasks on boards; Archived projects.
- Preferences: Open on launch (Home / My Tasks / Inbox); Open tasks in Side panel / Full page; Confirm before deleting tasks.
- Workspace URL warning "Changing the URL will break existing links."

## New task dialog
- Task name, description, pills: Project · Status · Assignee · Priority · Due date · Start date · Labels · Repeat; Subtasks inline ("Add a subtask and press Enter"); Attachments; "Create more" toggle; ⌘↵ Create task.
