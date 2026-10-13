# Manual test checklist — TV-D16 Agents and MCP v3

> Generated 2026-10-13 · branch `t/maciej/tv-d16-mcp` · **Live-verified:** yes, on the local stack: the connector served locally (`bun run local:functions`) answered a Todoist-shaped import, its re-run, Undo, a session and a cascade (`bun scripts/mcp-import-roundtrip.ts`, 15/15); in the app as dev@moduo.local, an agent's "working" showed on the row and as the task's line, "ready" arrived live with its summary fold, "Post as comment" made the comment, the bell said "Claude is ready for review", and the Agents switch saved both ways.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Set up
- [ ] **Do:** Settings → API keys → New key "Claude Desktop" with Tasks: Edit and Links: Edit; add Moduo's connector to Claude (Desktop or Code) with that key → **Expect:** the connector lists the tools; `projects_list`, `imports_begin` and `tasks_session_status` among them. _(web / desktop)_
- [ ] **Do:** a second key with Tasks: View only → **Expect:** only the read tools; any write answers "This API key can't use … it needs Tasks: Edit". _(Claude)_

## An agent works on a task (AC3.4)
- [ ] **Do:** ask Claude to create a task "Write the release notes" in a project, section Week 1, status "In review" (a project status), due Friday, tag `docs` → **Expect:** the task is there with all of it, a handle (MOD-…), and its trail reads "You · via Claude Desktop created this". _(web)_
- [ ] **Do:** ask Claude to post its status on it ("working, writing tests, step 3 of 5, with a link to a PR") → **Expect:** the row shows "Claude Desktop · working"; the panel shows "Claude Desktop · Writing tests · step 3 of 5 · just now · PR #42 ↗" under the title. _(web)_
- [ ] **Do:** wait 30+ minutes without a new report → **Expect:** the line says "No update for 3xm"; no notification. _(web)_
- [ ] **Do:** ask Claude to report "needs you: which branch?" → **Expect:** one bell notice "Claude Desktop needs you on “…”" and an OS / browser notice (where allowed); the row says "needs you". _(web / desktop)_
- [ ] **Do:** ask Claude to report "ready" with a summary → **Expect:** a bell notice "is ready for review"; the row mark goes; the line has "Summary": open it → the summary and **Post as comment**; post it → the comment is yours in the feed, the fold says "Posted as a comment." _(web)_
- [ ] **Do:** ask Claude to mark the task done when it has two open subtasks → **Expect:** both subtasks are done too; Claude reports "also finished 2". A repeating task's subtasks stay open. _(web)_
- [ ] **Do:** × on your session line → **Expect:** the line goes. _(web)_

## Private by default
- [ ] **Do:** as a teammate who can see the task, open it while an agent of yours works on it → **Expect:** no row mark, no line. _(web, second account)_
- [ ] **Do:** Settings → Preferences → Agents → turn on "Show my agent work to teammates" → **Expect:** the teammate sees the mark and the line within a few seconds, reading "<your first name>'s Claude Desktop · …" (never the agent's name alone), without the summary or Post / ×; turn it off → it disappears for them. _(web, two accounts)_
- [ ] **Do:** Settings → API keys → revoke the key while its session says "working" → **Expect:** the line reads "Claude Desktop · Stopped (key revoked)"; the trail still says "via Claude Desktop". _(web)_
- [ ] **Do:** Settings → Preferences → Notifications → turn off "Your agents", then have the agent report "failed" → **Expect:** no bell card and no OS notice. _(web)_

## Import through your AI (AC2.6, AC3.6)
- [ ] **Do:** ask Claude (with Todoist's connector too) to bring a Todoist project into Moduo → **Expect:** it begins an import, makes the project and its sections, the tasks with dates, labels as tags, repeats, subtasks and reminders; each task carries "imported from todoist <id>". _(Claude + web)_
- [ ] **Do:** search Moduo (MCP `tasks_search`) for a Todoist id, and for a Linear key like `ENG-123` after a Linear import → **Expect:** the task. _(Claude)_
- [ ] **Do:** type `ENG-123` into the Tasks search box and into ⌘K → **Expect:** the imported task. _(web)_
- [ ] **Do:** run the same import again → **Expect:** nothing new; the tasks update (renamed ones take the new names). _(Claude + web)_
- [ ] **Do:** edit one imported task in the app, then ask Claude to undo the first import → **Expect:** what nobody touched goes to Recently deleted, the edited one stays (with its section and project); Claude reports the counts. _(Claude + web)_
- [ ] **Do:** rename a section the import made, then undo the import → **Expect:** that section (and its project) stays; an untouched empty one goes. _(Claude + web)_
- [ ] **Do:** after an Undo, run the import again, then restore an undone task from Recently deleted → **Expect:** it comes back (no error); the new task keeps the "imported from" link. _(Claude + web)_
- [ ] **Do:** a teammate tries to undo your import (their own key) → **Expect:** "No import with that id." _(Claude)_

## Other tools
- [ ] **Do:** ask Claude to route a task to a team, then (as a team member's agent) to take it → **Expect:** routed; taken by that member; a second taker gets "Someone already took this task." _(Claude)_
- [ ] **Do:** ask Claude to duplicate a project you can only view → **Expect:** "You need edit access to this project to copy it."; one you can edit → the copy with shifted dates. _(Claude)_
- [ ] **Do:** ask Claude for this month's time report by day → **Expect:** your entries (and, as the owner, teammates who share theirs), totals per day. _(Claude)_
- [ ] **Do:** ask Claude for a task by handle in lower case ("mod-142") and for a task in a project you can't see → **Expect:** the first works; the second says "Task not found in this workspace." exactly like a made-up handle. _(Claude)_

## Notices after access changes (follow-up)
- [ ] **Do:** have a reminder fire and an agent report "needs you" on a task in a project someone shares with you, then have them take the project away → **Expect:** the bell keeps the cards but no longer names the task ("this"); no OS notice arrives for it; the agent's summary and line on it are gone for you. _(web, two accounts)_
- [ ] **Do:** route a task to a team you're in while you can see it → **Expect:** the bell names it ("routed “…” to Ops"); after losing access it reads "routed this to Ops". _(web, two accounts)_
- [ ] **Do:** ask Claude to create a task with the id of a task that's already there (an import resent) → **Expect:** the existing task comes back unchanged (`"action": "existing"`), with no new tags or reminders, and Undo of that import never removes it. _(Claude)_

## Verify before release
- [ ] Apply `20261013268000_agents_privacy_fix` after `20261013220000` (anchored replaces: probe prod's bodies of `module_activity_log`, `tasks_op_agent_report`, `tasks__fire_reminders`, `tasks_notify_spine`, `tasks_op_create_with` and the `notice_deliveries` read policy first).
- [ ] Apply `20261013220000_agents_imports_mcp` after every v3 migration before it (it re-cuts `module_activity_log`, `tasks_search` and `notice_deliveries__claim` in full and `tasks_op_create`, `account_erase_workspace_data` and the notice gate by anchored replace: probe the live bodies on prod first).
- [ ] Deploy `moduo-mcp` and `push-send` from a build with this block (push-send reads the delivery's kind; an older one says "Reminder" for an agent's notice).
- [ ] The real check (74): Claude with Todoist's own connector importing a real project end to end, then re-run and Undo.
- [ ] Agent notices on a signed desktop build (OS notification) and Web Push with prod's VAPID keys.
- [ ] `agent_sessions` through prod's Realtime (a published table on its own channel) and the access check dropping a session when its person turns sharing off.
- [ ] A long-running connector call (a 200-task import) under the Edge Function time limit; split runs if it isn't.

## Polish later
_Nothing open: the validator's one screen finding (a teammate's line naming whose agent it is) was fixed in the block._
