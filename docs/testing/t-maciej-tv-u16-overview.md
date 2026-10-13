# Manual test checklist — TV-U16 Project overview, Done prompt, departures

> Generated 2026-10-13 · branch `t/maciej/tv-u16-overview` · **Live-verified:** yes, on the local stack (web, 1440×900), in the workspace "Overview check (TV-U16)" made for it (dev@moduo.local, with Tess Mate and Third Member): the overview, its edits, Done with Keep and with Won't do + Undo, the client hub, the remove-member and team-default copy, an archived task opened from ⌘K. `tests/project-overview.spec.ts` passes.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Migration `20261013240000_project_description_team_defaults` is on the local stack (applied 2026-10-13).

## The overview (right panel → Project)
- [ ] **Do:** open a project, pick **Project** in the panel's title menu (or ⌥2) → **Expect:** name and colour dot; Status, Start (when set), Target, Lead and Client (when set); "+ Start · Lead · Client" for the rest; the description; the progress bar with "n of m done · k open"; **"Done this month · n · Xh"**; Next up; Sections with "2 of 5" and their end dates; People (lead first, "n open"); Waiting; Files; Lately; Time report · Copy as text · Duplicate… · Archive… _(web / desktop)_
- [ ] **Do:** finish a task in it, log "1h" on another → **Expect:** "Done this month" counts one more and the hours move by 1h (the time report for "This month" agrees). _(web)_
- [ ] **Do:** click a task in Next up, Waiting, Files or Lately → **Expect:** it opens in Details. _(web)_
- [ ] **Do:** the pencil beside the description → type → ⌘⏎ (or click away) → **Expect:** saved; reload keeps it. Esc instead drops the change. "Add a description" when it's empty. _(web)_
- [ ] **Do:** Status → On hold, then Active → **Expect:** saves at once; an On hold or Done project's sidebar row reads one step quieter (not when it's the open one). _(web)_
- [ ] **Do:** "+ Lead", pick someone; "+ Client", search a contact → **Expect:** the lead shows with their avatar; the client as a chip that opens their hub; the pencil changes it, "No client" clears it. _(web)_
- [ ] **Do:** Copy as text → paste → **Expect:** name, state and dates, "n of m done", "Done this month · …", the description, then the open tasks. _(web)_

## Done with open work (REPLAN 78)
- [ ] **Do:** Status → Done on a project with open tasks → **Expect:** "Mark “X” done? · n open tasks — Won't do · Move · Keep". _(web)_
- [ ] **Do:** Keep → **Expect:** status Done, the tasks stay open where they are; toast "“X” is done" with Undo. _(web)_
- [ ] **Do:** Won't do → Undo → **Expect:** the open tasks go to Won't do, then Undo puts the status and every task back. _(web)_
- [ ] **Do:** Move… → pick a project → "Move and mark done" → **Expect:** the open tasks (with subtasks) move there first, then the project reads Done. _(web)_
- [ ] **Do:** Done on a project with nothing open → **Expect:** no question, just the toast. _(web)_

## Archived projects
- [ ] **Do:** ⌘K, search a task of an archived project → **Expect:** it's tagged **Archived**; picking it opens the archived project read-only with the task selected; Project in the panel shows "Archived", no editing, no Archive…. _(web)_
- [ ] **Do:** Settings → Members and access → Teams → a team whose default project is archived → **Expect:** "<name> (archived)" and the line "… is archived, so a task for <team> needs a project picked". Routing a task to that team without a project asks for one. _(web)_

## A client's hub (AC6.4)
- [ ] **Do:** make a contact the Client of a project, open their hub → **Expect:** a **Work** section: the projects with "n open", Next up, "Waiting · n" with since when (Today · Yesterday · Oct 9), "n open tasks", Time report. Clicking a project or task opens it in Tasks. _(web)_

## Someone leaving (AC5.6)
- [ ] **Do:** Settings → Members and access → a member → Remove from workspace → **Expect:** the confirm lists: Inbox tasks go back to their makers, the rest to you; "Name's n open tasks here become unassigned" (with how many go back to a team); projects they lead lose their lead; the teams they leave; projects only they can see go to you (or the owner), named "From Name (archived) …". Cancel. _(web)_
- [ ] **Do:** Settings → Workspace → Leave workspace (as a member) → **Expect:** the same lines, worded for you, the rest going to the workspace owner. _(web)_

## Migrations / data
- [ ] **Do:** `bun run db:test project_overview` → **Expect:** 31 checks pass (only the ops write a description, Edit needed, 20,000 characters, viewers/outsiders can't read or write it, templates and Duplicate carry it, archived team defaults refused and ignored).

## Verify before release
- The migration on the real database (release train), after TV-D15's and TV-D13's.
- The desktop app: the description editor's ⌘⏎ and the overview in the narrower desktop panel.
- MCP doesn't show or write the description yet (TV-D16).

## Polish later
- **Files** re-read only when the project's task list changes: a file added while the overview is open shows after reopening it; and each open reads the workspace's whole attachment list (no per-project read yet).
- **"Done this month"** uses the device's calendar month (like the time report) but dates completions in the saved zone; a traveller near a month boundary can see the two disagree by a day.
- The server trims only trailing spaces from a description; the app trims every trailing whitespace (an MCP/API write keeps trailing newlines).
- With an archived default, `teams__route_project`'s message still says "give the team a default project" (MCP/API callers).
- A Done or Archive with Move shows its toast before the moves land, and keeps it if they're refused (Archive has the same).
- A starter template's description now lands on the project made from it; check the starter copy reads well as a project description.
- The ⌘K "Archived" tag reads the store when results arrive (not live).
- "Done this month" re-reads its month only when the panel draws; left open untouched across midnight on the 1st, it shows last month until something changes.
- The overview's helpers each scan the workspace's task list (and sections clone their tasks); filter the project's tasks once and pass them in.
- A view-only reader's overview is read-only after one access check per project; there's a moment while it's asked when nothing is editable.
- No tests for the hub rollup's rendering, the ⌘K tag, archived deep links or the dimmed rows (logic covered by unit tests where pure).
