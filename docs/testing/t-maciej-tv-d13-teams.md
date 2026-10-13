# Manual test checklist — TV-D13 Teams: routing, marks, settings

> Generated 2026-10-13 · branch `t/maciej/tv-d13-teams` · **Live-verified:** yes on the local stack (Settings → Teams: create, letters, colour, default project, add people, delete + Undo; `@Design` in capture routes to the default project; the teammate's bell shows "routed “Hero banner” to Design" and opens it; `@Design` in a comment reaches the other member once; Filter → Team; Preferences → Your teams). The "Take it" button is TV-U15's (the op and helpers are here).
> Run top-to-bottom; check off as you go. Sign in as `dev@moduo.local`; a second browser (or profile) as `teammate@moduo.local` (Tess Mate) for the team's side.

## Settings → Members and access → Teams
- [ ] **Do:** Settings → Members and access → **New team** → type "Design" → Create team → **Expect:** the pane opens on Design with "DS" in a rounded square, one line explaining what teams do, "0 people" _(web / desktop)_
- [ ] **Do:** Add someone → Tess Mate, then yourself → **Expect:** both listed with round avatars ("· You" after your name); the rail shows "Design 2" _(both)_
- [ ] **Do:** Change Letters to "DE", press Enter; clear them and blur → **Expect:** the mark reads DE, then DS again (made from the name) _(both)_
- [ ] **Do:** Pick Violet, then Automatic → **Expect:** the mark turns violet, then back to its own colour everywhere (rail, capture, the panel's Team) _(both)_
- [ ] **Do:** Default project → a shared project → **Expect:** it's shown; the hint says to pick one the team can open _(both)_
- [ ] **Do:** As Tess (not the team's creator, not an admin) open Design → **Expect:** no Delete button; she can still rename it and add/remove people _(both)_
- [ ] **Do:** As its creator, Delete → Undo within 8 s → **Expect:** Settings stays open, Design comes back with its people and its tasks still routed to it; Delete again and let the toast go → Design is gone and its tasks show no team _(both)_

## Routing and the team's notices
- [ ] **Do:** ⌘⇧K → "Hero banner @Desi" → pick Design → Create → **Expect:** the destination reads "<default project> (team default)", the pill "Design · unclaimed"; the task lands in that project with Team = Design and nobody assigned _(both)_
- [ ] **Do:** As Tess, open the bell in the same workspace → **Expect:** "<you> routed “Hero banner” to Design", and clicking it opens the task _(both)_
- [ ] **Do:** Route three more tasks to Design within the hour → **Expect:** Tess still has one card: "routed 4 tasks to Design"; once she's read it, the next routing is a new card _(both)_
- [ ] **Do:** As Tess, Preferences → turn off "Your teams" → route another → **Expect:** no card for her _(both)_
- [ ] **Do:** On a team task, comment "Who can take this? @Desi…" and pick Design → **Expect:** "@Design" reads as a mention; every other member hears once ("mentioned Design on “…”"); you (the author) and anyone the comment already told (its creator) get no second card _(both)_

## Taking a team's task (op only; the button is TV-U15's)
- [ ] **Do:** In the SQL editor or MCP, as Tess call `tasks_op_claim` on a Design task → **Expect:** it's hers, still "Design"; a second person taking it is told "Someone already took this task." _(web)_

## An unfiled task given to someone (call 20)
- [ ] **Do:** Capture a task to your Inbox, open it, Assignee → Tess → "Keep unfiled" → **Expect:** it leaves your Inbox and sits in Tess's; you still find it (Created by me) and can edit it; Tess hears "assigned … to you" _(both)_
- [ ] **Do:** As Tess, file it into a project you can't open → **Expect:** it's gone from your lists _(both)_

## Filter
- [ ] **Do:** All → Filter → Team → Design / No team → **Expect:** only Design's tasks / only tasks without a team; Team isn't offered in a workspace with no teams _(both)_

## Edge cases
- [ ] **Do:** Route a task in a project only you can open to Design → **Expect:** members who can't open the project don't see it and get no notice (routing shares nothing) _(both)_
- [ ] **Do:** Remove Tess from the workspace while her Inbox holds a task you created → **Expect:** it comes back to your Inbox with one quiet notice ("removed Tess · your task is back in your Inbox"); she's off every team; projects she led have no lead _(both)_

## Migrations / data
- [ ] **Do:** Confirm `20261013150000_teams_routing`, `20261013170000_teams_mention_once` and `20261013180000_teams_routing_fixes` are applied in that order (local stack) and `bun run db:test teams_routing` passes → **Expect:** 87 checks green _(local)_

## Known gaps / not-yet-testable
- The 3-day / day-before check-back is proven by the SQL test with set clocks; a live one needs a task routed 3 days ago (or a due date tomorrow and 9:00 your time).
- **Verify before release:** the `tasks-team-check-backs` cron on prod (every 15 minutes) and its duration on prod data; the routed notices and the check-back through prod's PostgREST/Realtime; a pre-D13 desktop build saving a team task (the two new columns are kept by the server either way).
