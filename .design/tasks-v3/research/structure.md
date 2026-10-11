# Lane 4 — The structure of the task system: groups, hierarchy, and what "more than buckets" should be

> Raw research report from the Tasks re-plan, 2026-10-09 (`maciej` @ 95d988b0), kept for its evidence. The synthesis and the open calls are in [../REPLAN.md](../REPLAN.md). Nothing here is decided.

> Research + proposals, 2026-10-09, read-only. Nothing here is decided. Based on `maciej` @ `95d988b0`, `specs/tasks-v2.md`, `docs/decisions/tasks.md`, the 2026-10-09 research round and the schema in `supabase/migrations/`. **Tags:** [V] read in official docs or verified in code this session · † from memory, not verified · [F] forum · [I] inference.

## TL;DR

- Every tool converges on the same spine: **a grouping → a project → an optional stage/section → task → subtask**, plus one cross-cutting axis (labels). The only real fork is whether a task may sit in more than one container (Asana, ClickUp, Plane modules, Trello mirrors, the late Height) or in exactly one (Todoist, Things, Linear, Jira, Basecamp, Sunsama, Motion, Planner). Multi-home tools all pay the same three bills: permission leaks (ClickUp's own doc admits it), partial sync (Trello) and duplicates (Asana forum).
- Moduo's bucket is a **project with no identity**: no description, status, date, client, phases or page. That, not hierarchy depth, is what fails every role's "where are we?" question. The second failure: **nothing inside a bucket can group tasks** except the fixed statuses, so creators and agencies can't have a stage board without reopening the status vocabulary.
- **Recommendation (candidate A):** keep one container per task. Rename Bucket → **Project** with metadata (description, status, target date, colour, client link, progress). Add **Sections** inside a project (ordered, optional, optionally dated) that double as Board columns and Timeline phase markers. Promote today's `group_label` to **Areas** (name, colour, order; no grants). Inbox stays what the schema already makes it, a **private place per person**, and stops masquerading as a project. No multi-home: cross-cutting work uses tags, saved views and the typed spine links the hub already rolls up. No cycles; statuses stay fixed. Cost M in three blocks, none needing a Tier-2 PERM migration or a nullable `bucket_id`.

## 0. Three corrections to the brief

1. **Inbox is already per person, not per workspace.** Since `20261006210000_perm_sharing.sql` the unique index is `(workspace_id, owner_id) WHERE is_system`, `ensureWebInbox` looks the row up by owner, and `share_op_set` refuses with "The Inbox stays private." [V] So the structural problem is not shared capture; it is that N private Inbox *rows* leak into everything that lists buckets: group-by-bucket, Timeline swimlanes, `tasks_list_buckets`, counts.
2. **Height shut down on 2025-09-24** [V, search]. Its "task in many lists" model survives in Asana, ClickUp and Plane.
3. **The spine already calls a bucket a project.** `KNOWN_ENTITY_TYPES` has `"project"`, `entityOpenTarget("project", id)` opens a bucket scope, the hub files it under "open-work", and PERM-1's module map has `'task_project' THEN 'tasks'` [V]. A rename only catches the UI up.

## 1. How the leading tools structure work

| Tool | Container levels (top → bottom) | Task in >1 container? | Container metadata | Sections / stages | Time-boxes | Personal vs shared |
| --- | --- | --- | --- | --- | --- | --- |
| **Todoist** [V API, help] | Workspace → Project → sub-project (personal only, 3 levels; team projects use **folders**) → Section → Task → sub-task | No (`project_id` scalar) | name, colour, view style; no status, no dates | Sections = board columns | None (Today/Upcoming, filters) | Inbox per user; team Inbox per workspace † |
| **Things 3** [V guide] | Area (perpetual) → Project (completable; deadline, notes) → Heading → To-do → Checklist; to-dos may sit in an Area † | No; one area per project | project: deadline, notes | Headings = grouping | Today/Upcoming/Anytime/Someday | Personal only |
| **TickTick** [V, secondary] | Folder → List → Section → Task → nested subtasks (5 levels); nested tags | No | list: colour, view, members | Sections = kanban columns | None | Per-list sharing |
| **MS To Do / Planner** [V Graph; † To Do] | To Do: list groups → List → Task → Steps · Planner: Plan → **Bucket** ("custom column", one plan) → Task → Checklist | No | plan: members, labels; bucket: name only | Planner buckets **are** the columns | None | To Do personal; Planner shared |
| **Linear** [V] | Workspace → Team → Issue (+ ≤1 Project, + ≤1 Cycle †, labels, sub-issues 1 level); Projects → Initiatives (sub-initiatives) | No: "Issues can only be associated with one project at a time" | project: lead team, lead, members, status, start/target dates, labels, description, resources, **milestones** (optional dates, %), updates, `P-TEAM-123` | Milestones; statuses per team | Cycles per team, 1–8 weeks, optional, auto-rollover | Teams; Triage inbox per team |
| **Jira** [V epic; † rest] | Project → Epic → Story/Task/Bug → Sub-task (parent field); components, versions; boards = filters | No | project: lead, key, schemes; epic: dates, % | Issue types + workflows | Sprints; epics "delivered over a set of sprints" | Permission schemes |
| **Trello** [V guide; mirror quote third-party, [F]] | Workspace → Board → List → Card → Checklist; labels, custom fields | Mirror cards (paid): per a third-party add-on's comparison, "checklists and attachments don't follow, Power-Ups don't run, and a teammate needs access to the source board" | board: description, members | Lists **are** the stages | None; Inbox + Planner 2025 † | Shared boards; Inbox personal |
| **Asana** [V multi-home; † rest] | Org → Team → Portfolio → Project → Section → Task → Subtask (≤5 levels †); Goals | **Yes, up to 20 projects**, one object, a section per project | owner, status updates, dates, custom fields, milestones (task type) | Sections per project | None native | Teams; My Tasks personal |
| **ClickUp** [V TIML; † hierarchy] | Workspace → Space → Folder → List → Task → Subtask (nested) → Checklist | **Yes** (home list + others): "Permissions do not follow the task from list to list … accessible to everyone … who has access to that list" | statuses + custom fields per Space/Folder/List | Statuses per container | Sprint Lists † | Each level shareable |
| **Notion** † | Database → page; relations; sub-items (per database, unlimited depth) + dependencies | Via relations | user-defined | user-defined | user-defined | Page sharing |
| **Basecamp** [V] | Project → To-do list (description, files, progress pie) → **Group** → To-do | No | list: description + progress | Groups inside a list; Card Table † | Lineup † | Clients as guests |
| **Height** (closed 2025-09-24) † | List (nested) → Task in **many lists**; custom attributes | Yes | per-list attributes | Sections | None | — |
| **Plane** [V modules, cycles] | Workspace → Project → Work item → sub-items; **Modules** many-to-many ("a work item can belong to both a Feature module and a Release module"); Cycles per project, one at a time | Many modules, **one cycle** | module: lead, members, dates, status, progress | States per project | Cycles, transfer unfinished | Intake (triage) † |
| **Sunsama** [V] | Context (Work/Personal) → Channel (flat) → Task; weekly Objectives | No | name/colour | none | The day and the week | Personal-first |
| **Motion** [V] | Workspace → Folder → Project → Task; workflow templates with **Stages** ("tasks roll up into stages, representing key milestones") | No | dates, template, stages | Stages (reusable) | AI auto-scheduling | Shared |

**What the table says, for Moduo**

1. **Metadata is what turns a list into a project.** Todoist, Things, TickTick and To Do carry none on the container, and that is their simplicity ceiling: no status, progress, due, client, "where are we". Linear, Asana, Plane, Motion and Basecamp answer those on a container page; gr8r's overview tab is the same shape.
2. **Sections do three jobs with one concept:** board columns (Todoist, TickTick, Planner, Trello lists), phases (Motion stages, Linear milestones) and grouping (Things headings, Basecamp groups). Moduo has none of the three inside a bucket.
3. **A grouping above projects appears everywhere once projects pass a handful** (Things areas, Todoist folders, TickTick folders, ClickUp spaces, Motion folders, Sunsama contexts, Asana portfolios, Linear initiatives), and it is almost always presentational-plus, rarely a permission boundary (ClickUp Spaces are the exception, and part of its overwhelm).
4. **Time-boxes are a developer/PM feature.** Even Linear makes cycles optional and per team; everyone else time-boxes with Today/Upcoming/My Day. The Queue plus "due this week" is Moduo's equivalent.
5. **Multi-home never comes free** (ClickUp's leak, Trello's partial mirror, Asana users duplicating tasks instead: "Creating same task in 2 projects", "How to duplicate tasks across multiple projects" [F]). Exclusive tools pay one bill instead: the "belongs to two things" case needs a second axis.
6. **Nobody says "bucket" for the container.** Planner does, for a *column inside a plan*: the opposite meaning.

## 2. What each role actually needs

| Role | Organises by | Stage / phase | Time-box | The "and" case | Shared with |
| --- | --- | --- | --- | --- | --- |
| **Student** | Term → Course → assignments, exams; group projects | weeks; Assignments · Exams · Reading | the week; exam dates | a task in a course **and** a group project | 2–4 classmates, one project |
| **Developer / small dev team** | Product → feature → issues; bugs vs features; sub-issues; PR links; handles | milestones; "cycle" | fortnights (optional) | an issue in a project **and** a sprint | the team; agents as delegates |
| **PM** | Initiative → epic → stories; roadmap across projects | milestones, sprints, grooming | sprints, quarters | a story in an epic **and** a sprint | team; stakeholders read-only |
| **Founder / ≤5 team** | Areas (Product · Sales · Ops · Personal) → projects; recurring ops; never-ending projects | light phases | the week; the Queue | a task in Ops **and** for a client | workspace; some private |
| **Freelancer / agency** | Client → Project → deliverables | Discovery → Design → Build → Launch; In review | due dates | a deliverable in a client project **and** "this week" | team + a client link (parked) |
| **Creator** | Series → episodes | **Idea → Draft → Edit → Publish** board | publish calendar; recurring | an episode in a series **and** a sponsor deal | editor/VA |

**Where they collapse.** Every row is the same shape: *an optional grouping* (term, area, client, initiative) → *a project* (course, feature, client project, series, epic) → *an optional stage grouping* (weeks, phases, pipeline stages, sprint) → task → subtask. Each role's "and" case has a second thing that is either **time** (this week, a sprint), which the Queue, due dates and saved views already express, or **a relationship** (client, sponsor, course), which a tag or a typed link expresses better than a second membership. What differs is *what the levels are called* and *which view opens first*, not the data model; that matches the segments lane's conclusion (views, templates and presets, not feature packs). Two needs the common shape shouldn't absorb: **bug vs feature** is a tag with a convention (Linear uses labels), and a **sprint** is a dated section or a saved view (§4).

## 3. Moduo's current model against those needs: what breaks

1. **A bucket has no identity.** `buckets` is `name, is_system, position, group_label` (+ colour and archive in TV-U6) [V]. No description, status, target date, client, progress or page. The decided overview view would have only counts to show, and the Timeline can draw task bars but no project bar.
2. **Nothing groups tasks inside a bucket** except group-by on fixed fields, and `tasks-v2.md` rightly rules out custom statuses. So Idea → Draft → Edit → Publish, Discovery → Build → Launch, Week 1…12 and Sprint 12 have no home; the only workaround is buckets as stages, which breaks the project.
3. **Sections are a label, not a thing.** `group_label` is a string on each bucket [V]: no colour, page, own order or spine address; renaming a section means relabelling every bucket in it.
4. **One bucket per task, tags as the only second axis**, and tags are workspace-wide across notes, contacts and email, so `#cs101`, `#bug` and `#client-x` pile into one flat list.
5. **Inbox is N private buckets, listed as buckets** in `tasks_list_buckets`, group-by, swimlanes and counts. Deleting a bucket moves its tasks into *the deleter's* private Inbox. The only safeguard found is a **one-time backfill** in the PERM-3…8 migration (`perm_sharing.sql` 560–565, from when the shared Inbox was split per person) that granted each task's owner access [V]; nothing re-grants an assignee today, so a teammate's task can drop out of their view. Verify before relying on it; decision 13 proposes the fix.
6. **"Bucket" as a word** says nothing about goal, end or client, can't be said to a client, collides with Planner's meaning, and blocks the models the roles bring (course, project, series, epic).
7. **No cross-project roadmap:** swimlanes are buckets and there are no project dates to draw.
8. **Templates can only be checklist-deep**; a client-onboarding *project* template needs sections to exist.
9. **MCP has no project semantics** beyond names and an Inbox flag.

Not broken, keep: exclusive membership, subtasks one level deep, workspace-wide tags, the Queue as the personal time-box, workspace-wide handles, the private per-person Inbox, per-bucket sharing inheriting to tasks [V].

## 4. Three candidate structures

### A · Projects with Sections, optional Areas (evolve buckets)

- **User model.** "Your work lives in projects. A project can have sections: phases, stages, weeks, whatever you call them. Projects can be grouped into areas. Anything not yet filed sits in your private Inbox."
- **Naming.** **Project**, **Section**, **Area**, **Inbox**. "Bucket" disappears from the UI; the DB keeps `buckets` for now.
- **Depth.** Area (optional) → Project → Section (optional) → Task → Subtask. A new workspace sees Inbox + projects only.
- **A task in more than one?** No. Cross-cutting = tags, saved views and typed spine links: a task in a group project links to the course project (`references`) and shows in its overview under "Linked work". The hub already has a section for the `project` type [V], but no `'project'` row is written to `entities` anywhere yet [V], so registering projects through the new project ops is ST-1 work, and the precondition for the decided client link.
- **Inbox, My tasks, Queue, saved views, tags.** Inbox = "no project": its own rail row as today, never in project lists, at most one virtual group in group-by, no swimlane, `is_inbox` in MCP. Queue and My tasks unchanged. Saved views gain project/area scope. Tags unchanged.
- **Milestones / phases / cycles.** A section has an optional **target date**. Board → group by Section is the stage board; the Timeline draws a dated section as a phase marker (tick + name + n/m) at its date. This coexists with the existing rule that a task with only a due date is a point milestone. **No cycles**: a dev team names a section "Sprint 12 · Oct 13–24" or saves a "Due this fortnight" view; the spec's out-of-scope line stands.
- **Roles.** Student: Area = term, Project = course, Sections = weeks, group project = a project shared with classmates who are workspace members (per-project grants reach members only; there is no guest link), linked to the course. Dev: Project = feature, Sections = milestones/sprints, tags `bug`/`feature`. PM: project status + target date + progress across the Timeline = the roadmap. Founder: Areas = Product/Sales/Ops/Personal; "Ops" is a project with no target date. Agency: project ↔ client (decided), Sections = phases, waiting field, time per client in the overview. Creator: Project = series, Sections = pipeline stages, episodes = tasks with a checklist template.
- **Sharing.** Project = today's bucket grants, untouched. Sections inherit the project. Areas have **no grants**; an area shows the projects you can see. `SHARE_RESOURCE_TYPES` doesn't change.
- **Views.** Project overview (decided, right panel): description, status, target date, progress by section, waiting, due this week, time, files, client, activity. Board per project by status (default) or by section. Timeline: project swimlanes plus a project bar (first scheduled → target date) and section markers. Area = a rail group; an area overview is a later S block. Workload = the team-load widget already proposed.
- **Handles, client, templates, spine, MCP.** Handles unchanged (what makes the rename free). Client link shown as "Client" in the project header and on the contact hub. Templates: checklist first (decided), then *project templates* = sections + tasks with relative dates. Spine: once ST-1 registers projects in `entities`, the project is a real hub target (project ↔ note, email, event) and the client link has something to attach to. MCP: `tasks_list_projects` (status, target date, client, sections, progress), `tasks_list_buckets` kept as an alias until TV-D7; task shape gains `project` and `section`; the planned `tasks_capture` takes both.
- **Migration.** Additive: `buckets.description`, `status` (contract + CHECK), `target_date`, `area_id`; `areas(id, workspace_id, name, color, position)` seeded from distinct `group_label` values (blank stays ungrouped; the column retires at TV-D7); `project_sections(id, bucket_id, name, position, target_date)` and nullable `tasks.section_id`, with a BEFORE trigger that nulls `section_id` when `bucket_id` changes to a project the section isn't in (old builds move tasks without knowing sections exist). Every bucket becomes a project 1:1 with empty metadata; nothing moves. `tasks.bucket_id` stays NOT NULL; the Inbox rows stay (PRIV-2a's erasure and old builds rely on them).
- **Old builds.** They never send the new columns, so their upserts leave them alone; they keep showing buckets and label-sections.
- **Risks.** "Area" is a third noun: keep it off-screen until the first one exists (as `group_label` is today). "Project" raises expectations of lead/updates/health: ship the overview with real numbers and say no to Linear-style project updates in the spec.
- **Cost: M** — ST-1 Projects (rename, metadata, status vocabulary, `entities` registration via project ops, overview wiring, MCP alias) S–M · ST-2 Sections (table, list grouping, board-by-section, timeline markers, capture pill, drag between sections, MCP) M · ST-3 Areas (`group_label` → rows, rail, colour, reorder) S. PERM work is limited to registering two child tables in `perm_enforce_write`.

### B · Areas → Projects → Sections, with Areas as real containers (Things/ClickUp-Space style)

- **User model.** "Areas hold projects *and* loose tasks. Projects have a lead, milestones and status updates. Sections are phases."
- **Depth / multi-home.** Five levels including subtask; tasks may live directly in an area; no multi-home.
- **Inbox etc.** Inbox becomes "no project, no area": `bucket_id` nullable, the system rows deleted.
- **Milestones / cycles.** A **milestone object** per project (name, date, %, attached tasks) next to sections; no cycles.
- **Roles.** Richest for PMs and dev teams (Linear-shaped projects); Things-style areas with loose tasks for founders; more than students and creators need.
- **Sharing.** Area becomes a grant resource with inheritance area → project → task: a new `SHARE_RESOURCE_TYPES` value, `can_access` and `perm_enforce_write` branches, backfill, the invite "share existing" path. Tier-2 review per AGENTS.md.
- **Views / MCP.** Area page (projects, loose tasks, roadmap); project page with lead + updates + milestones; area and milestone read tools.
- **Migration / old builds.** Everything in A plus a nullable `bucket_id` (old builds' whole-row upserts and the erasure function that re-homes tasks into an Inbox row both break: a shim through TV-D7), area grants, a milestone table.
- **Risks.** The ClickUp slope: three container kinds with pages and permissions; "is this an area or a project?" (Things users ask it constantly †); milestones next to dated sections is two ways to say one thing; lead/updates are team-of-20 features at ≤5.
- **Cost: L.**

### C · Flat Projects + multi-home Lists (Height/Asana-style)

- **User model.** "Projects are where work lives. Lists are any collection: a sprint, a client, 'this week', a course. A task can be on several lists."
- **Depth / multi-home.** Project → Task → Subtask, plus flat Lists as a parallel axis (`task_list_members`); one home project; no areas or sections (lists cover both).
- **Inbox etc.** Inbox stays a project row; the Queue is already a personal list; saved views overlap lists.
- **Milestones / cycles.** A sprint = a dated list; a phase = a list; moving a task through stages means moving it between lists by hand, or lists become statuses in disguise.
- **Roles.** Devs/PMs like sprint lists; students get course + group-project lists; agencies get client lists, which then compete with the decided client link.
- **Sharing.** Either a list is a grant resource and a task is visible through any list it is on (ClickUp's leak, verbatim; Tier-2), or lists are personal and can't be a team's sprint.
- **Views.** A list page per list (list/board), project pages as today, Timeline per list; the project overview problem (§3.1) stays open.
- **Spine / MCP.** A second, untyped membership next to typed `entity_links`; the hub would roll up both; list read/write tools.
- **Migration / old builds.** New table + UI; `tasks` unchanged; old builds see only projects.
- **Risks.** Discoverability and duplicates (Asana's pattern); "which list is home?"; counts (a task counted thrice); lists drifting into statuses and areas at once, Notion's trap by another name. And it leaves §3.1 (a project with no identity) unsolved unless A's metadata is added anyway.
- **Cost: L.**

### The constraints, side by side

| | A · Projects + Sections + Areas | B · Areas as containers | C · Multi-home lists |
| --- | --- | --- | --- |
| New grant resource type (Tier-2 PERM) | **No** | Yes (area) | Yes, or lists stay personal |
| `bucket_id` stays NOT NULL, Inbox rows stay | **Yes** | No (shim to TV-D7) | Yes |
| Stage board without custom statuses | **Yes** (Board by section) | Yes | Only by moving tasks between lists |
| Second membership vs a typed link | Typed link (hub code path exists; `entities` registration is ST-1 work) | Typed link | Second membership (hub + PERM change) |
| Answers "where are we?" | Yes | Yes | Not by itself |
| Cost | **M** | L | L |

## 5. Recommendation

**Candidate A.** It is the shape every exclusive-membership tool converged on; it fixes the two real breaks (a project with no identity, nothing to group by inside one) without reopening statuses, sharing or `bucket_id`; and it keeps the brief's non-goals out: no schema-building (a section is a named row, not a field), no abstract graph, defaults that work on day one (Inbox + projects; areas and sections appear only when you make one). The ≤5-person ceiling argues against B's leads, updates and area grants; the spine argues against C, since Moduo already has a typed, permission-aware way to say "this task also matters to that project" that the hub shows today.

Left on the table, with the cheap path if dogfooding asks: an area overview (S), project templates (S–M, after checklist templates), a project short key for prose ("P-ACME", S, only if handles aren't enough), a "sprint" preset that creates dated sections (S).

### Decisions for the designer (recommended answer inline)

1. **The word for the container.** → **Project.** Students say course, agencies and devs say project; it can be said to a client. Keep "bucket" only in code and the `resource_type` CHECK until a cleanup block, so no PERM migration rides on a rename.
2. **The word for the grouping above.** → **Area** (Things; founders' Product/Sales/Ops). Not "folder" (file metaphor), not "space" (ClickUp's permission boundary), not "team" (PERM already has members).
3. **The word for the grouping inside.** → **Section** (Todoist, Asana, TickTick). A creator will call it a stage, a dev a milestone, a student a week; all three are right.
4. **Depth.** → Area (optional) → Project → Section (optional) → Task → Subtask (one level, as today). No sub-projects: Todoist's three levels exist because it has no areas.
5. **A task in more than one project?** → **No.** Tags for categories, saved views for slices, typed links for "also about". The workspace-wide handle decision already assumes a task moves freely; it should not also be in two places.
6. **Areas?** → **Yes, as the promotion of `group_label`:** name, colour, order; no page in the first block; no grants; a project in at most one area; tasks never directly in an area (which is what keeps `bucket_id` NOT NULL). Hidden until the first area exists.
7. **Sections, and can they carry a date?** → **Yes, with an optional target date.** That one field makes a section a phase, a milestone or a sprint by naming alone; Board → group by Section is the stage board; the Timeline shows dated sections as phase markers; n/m per section feeds the overview.
8. **Milestones as their own object?** → **No.** A dated section is the phase; a task with only a due date stays the point milestone on the Timeline, as already decided. One concept fewer than Linear.
9. **Cycles / sprints?** → **No object.** A "Sprint 12 · Oct 13–24" section plus a "Due this fortnight" saved view cover a small dev team; revisit only if a dev workspace asks for rollover.
10. **Statuses per project or fixed?** → **Fixed** (`todo · in_progress · done · archived` plus the waiting field from ❓5). Sections are the per-project vocabulary; statuses stay the shared one, so cross-project views, MCP and the Queue keep one meaning of "done".
11. **What a project carries.** → **Description, status, target date, colour (TV-U6), area, client link (decided), sections**; computed progress (done/total, per section), time (TV-D3), files (AT-3), waiting (❓5), activity. Status = `active · on_hold · done` as a closed contract + CHECK, with TV-U6's `archived_at` separate (archive is visibility, done is the work). **No lead, no project updates, no health field:** at ≤5 people the assignees *are* the people on it, and "at risk" is the alarm framing the brief rejects. **What status does:** `on_hold` and `done` change nothing about task visibility, All, My tasks, the Queue or drift; status feeds the overview, a dimmed rail row and MCP; only `archived_at` hides. A passed section date is a quiet line in the overview, never red, never drift on its tasks.
12. **What the project page contains.** → The decided right-panel overview: description · progress line ("4 of 18 done · 2 sections · due Nov 2") · waiting and on whom · due this week · time · files · client · recent activity. The centre stays the project's List/Board/Timeline. Areas get no page in the first block.
13. **Inbox.** → **Stays a private place per person, which it already is.** It leaves every project list: its own row as today, at most one virtual "Inbox" group in group-by, no swimlane, `is_inbox` in MCP and out of `tasks_list_projects` by default. The system rows stay in the DB; "no project" is the UI meaning, not a NULL. "Delete project → move tasks to Inbox" should prefer *the task's assignee's* Inbox, else the deleter's, so nobody loses a task into someone else's private row (no trigger re-grants an assignee today; the one-time PERM-3…8 backfill is the only safeguard found; where a task must land in someone else's Inbox, add a task grant for its assignee).
14. **Existing buckets and sections.** → Every bucket becomes a project with empty metadata, same id, grants and handles. Distinct `group_label` values become areas in rail order; blank stays ungrouped. Nothing moves, renumbers or re-shares.
15. **Sharing level of the new things.** → Project = today's bucket grants. Section inherits its project (a child in `perm_enforce_write`, like tasks). Area = none. This is the decision that keeps the change out of Tier 2.
16. **Old builds during the adoption window.** → Additive columns only; old builds keep buckets and label-sections, never see sections, and their whole-row upserts leave the new columns alone. No shim beyond what TV-D7 already plans.
17. **MCP.** → `tasks_list_projects` (+ sections, status, target date, client, progress) and `tasks_list_sections`; `tasks_list_buckets` kept as an alias until TV-D7 like `tasks_today`; task shape gains `project {id, name}` and `section {id, name}`; the planned `tasks_capture` / `tasks_update` take a project and an optional section.
18. **Templates.** → Checklist templates first (decided); then project templates = sections + tasks with relative dates, from "New project → from template" or from a contact ("Onboard Anna"). The brief's "no template hunt" is about system-building templates; these are the user's own procedures.
19. **Build order.** → ST-1 Projects right after TV-U6 lands (it owns `bucket-rail.tsx` and adds colour/archive; don't collide) · ST-2 Sections after TV-U2/U4 (group-by and drag-and-drop are theirs) · ST-3 Areas any time after ST-1. Project templates and the area overview after.

### What this costs the ceilings

Linear-light stays Linear-light: no teams, cycles, initiatives, triage or custom workflows. Todoist's day-one simplicity is kept (Inbox + projects) without its ceiling (a project knows what it is). ClickUp's overwhelm is avoided by making only one of the three nouns mandatory and giving areas no permissions. The Notion/Anytype trap is avoided because nothing here is a schema: a section is a named row with a date, "which project" is a pill, not a relation. And the spine stays the moat: the project becomes a real hub target the moment it has an identity, which is what the client loop, the overview and the team-load widget were all waiting for.
