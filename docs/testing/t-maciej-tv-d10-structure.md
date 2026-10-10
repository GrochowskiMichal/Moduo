# Manual test checklist — TV-D10 areas, projects, sections, sessions, reminders, waiting, teams

> Generated 2026-10-11 · branch `t/maciej/tv-d10-structure` → `t/maciej/tasks-v3-build` (local build mode) · **Live-verified:** yes, on the local stack (web, `rsbuild dev` on :8097, signed in as `dev@moduo.local`): the rail's project ⋯ → Section → New section… "Clients" (an area made, the project filed under it, `group_label` mirrored), Rename on that project (the area kept), the panel's Time → Estimate "2h" (saved as the estimate, the trail says "changed the estimate"), a task's trail after a session op ("scheduled a session for Tue"), Calendar → the booking link editor's Busy calendars ("Work sessions from Tasks" checked on an existing link). The booking busy query ran against the local PostgREST as the function runs it (a 10:00–11:30 session hid three 30-minute slots); the full `booking-public` preview can't offer slots locally (no Google or Zoom connected). Not live-verified: the rows marked below. Most of the block is data: the SQL tests cover it.
> Migrations: `20261010180000_areas_projects_sections.sql`, `20261010181000_task_sessions_reminders_waiting.sql`, `20261010182000_teams.sql` (local only; apply all three, in order). SQL tests: `bun run db:test` (`structure.test.sql` 98, `sessions.test.sql` 52, `teams.test.sql` 38). The rail's Section menu was live-verified before it moved onto `projects_op_file`; the op itself was then run as the dev user on the local stack (filed under a new name and back).

## Areas (REPLAN 14–15)
- [ ] **Do:** a project's ⋯ → Section → New section… → type "Clients" → Enter → **Expect:** a "Clients" header in the rail with the project under it _(both)_
- [ ] **Do:** another project's ⋯ → Section → pick "Clients" → **Expect:** it joins the same header; no second "Clients" _(both; not live-verified)_
- [ ] **Do:** ⋯ → Section → No section → **Expect:** the project goes back to the ungrouped list _(both; not live-verified)_
- [ ] **Do:** rename a project that sits in an area → **Expect:** the new name; it stays in its area _(both)_
- [ ] **Do:** as a teammate who can't see any project in an area (all private to someone else) → **Expect:** that area's header isn't in their rail, also after those projects are deleted _(both; SQL-tested only)_
- [ ] **Do:** file a project under a name that only exists on someone else's private projects → **Expect:** it works and makes your own area; nothing says the name was taken _(both; SQL-tested only)_
- [ ] **Do:** open the app with a build from before TV-D10 against this database, file a project under a section → **Expect:** the new app shows it under the area of that name _(desktop; verify before release)_

## Projects (AC4.1)
- [ ] **Do:** (no UI yet: TV-U6/TV-U16) set a project's status, start/target, lead and client through `projects_op_update` → **Expect:** saved; a target before the start, a lead from outside, or a client contact you can't see is refused _(both; SQL-tested)_
- [ ] **Do:** as someone who can see the project but not its client contact → **Expect:** the contact never opens ("Private item") _(both; SQL-tested)_

## Sections (AC2.1)
- [ ] **Do:** (no UI yet: TV-U10/TV-TL1) a course project with Week 1–3 sections and a "Final exam" with an end date only → **Expect:** saved in order; a start without an end is refused _(both; SQL-tested)_
- [ ] **Do:** move a task in a section to another project (any build) → **Expect:** it's in "No section" there _(both; SQL-tested)_
- [ ] **Do:** delete a section → **Expect:** its tasks stay in the project, in "No section" _(both; SQL-tested)_

## The estimate and work sessions (REPLAN 25)
- [ ] **Do:** open a task → Time → Estimate "2h" → Enter → **Expect:** "of ~2h"; the trail says "changed the estimate" _(both)_
- [ ] **Do:** schedule a task from the panel or by dragging it onto the Calendar → **Expect:** as before; the task now has one work session; its estimate doesn't change _(both; not live-verified in the UI, SQL-tested)_
- [ ] **Do:** resize a scheduled task's block in the Calendar → **Expect:** the block changes; the panel's estimate doesn't _(both; not live-verified)_
- [ ] **Do:** clear a task's scheduled time in the panel → **Expect:** unscheduled; it stays unscheduled after a reload _(both; not live-verified)_
- [ ] **Do:** (no UI yet: TV-U13/TV-F6) add a second session through `tasks_op_session_add` → **Expect:** the task's scheduled time shows the earlier one; the estimate doesn't change _(both; SQL-tested)_
- [ ] **Do:** with a build from before TV-D10, move a scheduled task in the Calendar → **Expect:** the new app shows the session moved _(desktop; verify before release)_

## Booking links (default d)
- [ ] **Do:** Calendar → a booking link → Busy calendars → **Expect:** "Work sessions from Tasks", checked on existing and new links _(both)_
- [ ] **Do:** with Google connected on the deployed function, give yourself a work session tomorrow 10:00–11:30 and open your booking page → **Expect:** those times aren't offered; unchecking "Work sessions from Tasks" brings them back; the page never names the task _(both; verify before release: needs a connected video provider)_

## Reminders, Waiting on…, teams (data only; UI in TV-U13 / TV-D12 / TV-D13)
- [ ] **Do:** `tasks_op_reminder_add` day_before on a task due Friday (no time) → **Expect:** fires Thursday 09:00 in the assignee's zone; the 5-minute job stamps it; nothing is delivered yet (TV-D12) _(both; SQL-tested; the hosted cron: verify before release)_
- [ ] **Do:** `tasks_op_waiting_add` an email you can open, then read the task as a teammate who can't → **Expect:** the entry is there with no subject _(both; SQL-tested)_
- [ ] **Do:** route an Inbox task to a team with a default project → **Expect:** it files into that project; without a default it's refused _(both; SQL-tested)_

## Erasure and export (§Assumptions #26)
- [ ] **Do:** Settings → Advanced → Export → **Expect:** `tasks.json` has `areas`, `sections`, `teams`, `teamMembers`, `sessions`, `reminders` (yours), `waiting`, and project fields on `buckets` _(both; unit-tested)_
- [ ] **Do:** delete a test account that leads a project and has sessions, reminders and a team membership in someone else's workspace → **Expect:** those go (the lead is cleared, the project stays) _(both; SQL-tested; verify before release with the delete-account function)_

## Verify before release
- Prod's `buckets.group_label` values become areas in sidebar order (spot-check a workspace with sections), and labels only on private projects stay hidden from teammates.
- An old desktop build: section menu, Calendar schedule/resize, and a whole-row save of a scheduled task, against these migrations.
- `booking-public` deployed with `_shared/booking-sessions.ts`, on a link with Google connected.
- The two new pg_cron jobs (`tasks-session-mirror`, `tasks-reminders`) run on the hosted project.
