# Manual test checklist — TV-U6 Sidebar v3 (re-scopes #328)

> Generated 2026-10-11 · branch `t/maciej/tv-u6-sidebar` → `t/maciej/tasks-v3-build` (local build mode) · **Live-verified:** yes, on the local stack (web, `rsbuild dev` on :8136, signed in as `dev@moduo.local` in the "My" workspace): the sidebar order and hairline, the hairline's ⋯ (Customize, New project, New area…, Archived projects, Recently deleted), New area "U6 Clients" and two projects in it through the area's +, Pin (stored in the synced preferences), Archive with "3 open tasks — Won't do · Move · Keep" → Move to another project (tasks moved, project archived), Archived projects → open read-only with the banner, All's search finding the archived project's task under "U6 Acme · Archived". The delete, Undo, Recently deleted → Restore, Archive → Keep → Unarchive and Customize flows ran end to end in `tests/tasks-sidebar.spec.ts` (headless Chrome against the same dev server; the shared Browser pane was hidden, which stalls Radix menus — gotchas/ui.md).
> Migration: `20261011100000_projects_archive_trash.sql` (local only; after TV-D10's three; re-runnable). SQL tests: `bun run db:test departures` (50 checks); e2e: `E2E_BASE_URL=http://127.0.0.1:<port> bunx playwright test --project=e2e tests/tasks-sidebar.spec.ts` (needs Playwright's Chrome, or a config with `channel: "chrome"`); Storybook structure checks: `tests/visual/sidebar.spec.ts -g structure`.

## The decided sidebar (AC11.1)
- [ ] **Do:** open Tasks in a workspace with projects and areas → **Expect:** Inbox · Focus · Upcoming · My tasks, a thin line, All, then projects without an area, then each area (sentence case, a chevron, its open count) with its projects (colour dot · name · count); no "You" / "Workspace" / "Projects" labels, no icons on views _(both)_
- [ ] **Do:** a fresh workspace (one or two projects, no areas, no pins) → **Expect:** no headers at all: Inbox · Focus · Upcoming, the line, All, the projects, "+ New project" _(both)_
- [ ] **Do:** click an area's header → **Expect:** it collapses (chevron turns), its projects hide, the count stays; reload → still collapsed _(both)_
- [ ] **Do:** hover the thin line → ⋯ → Customize sidebar: untick Upcoming and All → **Expect:** both rows go; the Inbox can't be hidden; on another device signed in as you, the same rows are hidden _(both; second device not live-verified)_
- [ ] **Do:** a project's ⋯ → Pin to sidebar → **Expect:** a "Pinned" header appears under All with that project (it also stays in its area); Unpin from sidebar → Pinned disappears with its last project _(both)_
- [ ] **Do:** look for "bucket" anywhere in the sidebar, its menus and dialogs → **Expect:** none; it says "project" _(both)_
- [ ] **Do:** a project's ⋯ → **Expect:** Rename · Colour · Area · Pin to sidebar · Share · Statuses… · (Triage…) · Archive… · Delete project…; no "Open at" _(both)_
- [ ] **Do:** close and reopen Tasks while on Upcoming, All or a project → **Expect:** it reopens there (REPLAN 30) _(both)_

## Areas and projects (TV-D10's ops)
- [ ] **Do:** the line's ⋯ → New area… → type "Clients" → Enter → **Expect:** a "Clients" header at the end _(both)_
- [ ] **Do:** the area's + → type two names, Enter after each → **Expect:** both projects inside the area _(both)_
- [ ] **Do:** an area's ⋯ → Rename / Colour / Move up / Move down → **Expect:** each applies; Move up is greyed on the first area _(both; colour shows only in the menu)_
- [ ] **Do:** an area's ⋯ → Delete area → **Expect:** its projects stay, without an area; Undo brings the area back with them _(both)_
- [ ] **Do:** drag a project onto another project in a different area → **Expect:** it lands just before it, in that area _(both; not live-verified)_
- [ ] **Do:** a project's ⋯ → Colour → Teal → **Expect:** the dot turns teal; Neutral clears it _(both)_
- [ ] **Do:** a project's ⋯ → Area → another area / No area / New area… → **Expect:** it moves there (New area… makes the area and files it) _(both)_

## Archive (REPLAN 16 + 78)
- [ ] **Do:** Archive… on a project with open tasks → **Expect:** "4 open tasks — Won't do · Move · Keep" _(both)_
- [ ] **Do:** Keep → **Expect:** the project leaves the sidebar, its tasks leave every list, count and queue; the toast says where it is; Undo brings it back _(both)_
- [ ] **Do:** Won't do → **Expect:** each open task is marked Won't do, then archived; Undo unarchives and reopens them with their own status _(both; hook-tested)_
- [ ] **Do:** Move… → pick a project → Move and archive → **Expect:** the open tasks (with their subtasks) are in that project; the finished ones stay in the archived one _(both)_
- [ ] **Do:** Archive… on a project with nothing open → **Expect:** no question, archived with Undo _(both)_
- [ ] **Do:** the line's ⋯ → Archived projects → click one → **Expect:** its tasks, read-only, under "Archived Oct 11 · read-only until you unarchive it." with Unarchive _(both)_
- [ ] **Do:** All → search a word from an archived project's task → **Expect:** it's found, grouped under "<project> · Archived" _(both)_
- [ ] **Do:** as a member who can only edit (not Full on) a shared project → Archive… → **Expect:** "Only people with full access to “…” can archive it." and no buttons to archive _(both; SQL-tested, dialog unit-tested)_

## Delete (REPLAN 78, AC5.5)
- [ ] **Do:** Delete project… on a project with your open task, a teammate's open task and a finished one → **Expect:** "Its 2 open tasks go to their assignees' Inboxes (1 task to yours)." and "Its finished task goes with it to Recently deleted."; no radio _(both)_
- [ ] **Do:** Delete project → **Expect:** gone from the sidebar at once; your task is in your Inbox; the teammate's is in theirs and they get one quiet notice ("… · 1 task", naming the project only if they could see it); the finished task is gone _(both; notice text in the bell not live-verified)_
- [ ] **Do:** click Undo on the toast → **Expect:** the project is back with all three tasks in place _(both)_
- [ ] **Do:** delete it again, edit the teammate's task in their Inbox, then restore from Recently deleted → **Expect:** your task and the finished one come back; the edited one stays in the teammate's Inbox _(both; SQL-tested)_
- [ ] **Do:** the toast's "Recently deleted" link → **Expect:** Recently deleted opens _(both)_
- [ ] **Do:** a pinned project, deleted → **Expect:** it leaves Pinned too (a Restore doesn't re-pin) _(both; not live-verified)_
- [ ] **Do:** as someone without Full access → Delete project… → **Expect:** "Only people with full access to “…” can delete it." _(both; SQL-tested)_

## Recently deleted (AC11.10)
- [ ] **Do:** the line's ⋯ → Recently deleted → **Expect:** deleted projects ("Project · 2 tasks deleted with it · 3 tasks sent to Inboxes") and tasks, newest first, days left; never a permanent sidebar row _(both)_
- [ ] **Do:** Restore on a project → **Expect:** back in the sidebar with its finished tasks and its untouched open ones _(both)_
- [ ] **Do:** Delete forever → confirm → **Expect:** gone; the tasks it had sent to Inboxes stay there _(both; SQL-tested)_

## Edge cases
- [ ] **Do:** a project deleted more than 30 days ago → Restore → **Expect:** "That was deleted more than 30 days ago and can't be restored." _(SQL-tested)_
- [ ] **Do:** a team task in a deleted project → **Expect:** it lands in its assignee's Inbox without its team _(SQL-tested)_
- [ ] **Do:** a task assigned to someone who's since become a viewer → **Expect:** the delete sends it to the deleter's Inbox _(SQL-tested)_
- [ ] **Do:** an agent (MCP) lists tasks → **Expect:** archived projects' tasks aren't there unless `include_archived: true`; `tasks_search` finds them with `project_archived: true` _(unit-tested; needs a moduo-mcp redeploy at the release)_

## Migrations / data
- [ ] **Do:** apply `20261011100000_projects_archive_trash.sql` after D10's three → **Expect:** `buckets.color`, `archived_at`, `deleted_batch_id`, `trash_moved_task_ids`, `trash_moved`, `trash_moved_at`, `tasks.deleted_batch_id`; `bun run db:test` all green
- [ ] **Do:** as a signed-in client, PATCH a deleted project's `trash_moved_task_ids` → **Expect:** refused ("Recently deleted is kept by Moduo") _(SQL-tested)_

## Known gaps / not-yet-testable (verify before release)
- The visual snapshots in `tests/visual/sidebar.spec.ts` need a human baseline capture (the structure checks pass).
- Archived projects still remind and repeat until TV-D12 (the roll-over and the reminder sender don't look at `archived_at` yet).
- The ⌘K / `@` search finds archived projects' tasks (they stay registered) but without the "Archived" label; only Tasks' own search labels them.
- The bell's wording for `tasks.project_deleted` (spine/activity.ts) wasn't seen live; there's no mute toggle for it until D12's table.
- An old desktop build: deleting a project there still uses the old raw delete (every task to the deleter's Inbox, not restorable) until the minimum build is raised (TV-D7).
- The moduo-mcp redeploy (archived reads) waits for the release train.
