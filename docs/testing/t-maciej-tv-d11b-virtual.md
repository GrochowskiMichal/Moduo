# Manual test checklist — TV-D11b Virtualization + the 10k fixture

> Generated 2026-10-11 · branch `t/maciej/tv-d11b-virtual` · **Live-verified:** partial — the perf spec (5/5) and the e2e suites (28/28) ran against the local stack with a dev server; the steps below were driven by Playwright, not by hand. Sign in as `perf@moduo.local` (password in `scripts/perf/seed-tasks-10k.ts`) after `bun run perf:seed`, or as `dev@moduo.local` for a small workspace.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Long lists (Perf 10k workspace)
- [ ] **Do:** open Tasks → All. → **Expect:** the first rows within about 1.5 s; groups by project, the first one open. _(web / desktop)_
- [ ] **Do:** Display → Group by → None, then scroll from top to bottom quickly. → **Expect:** rows keep up (no blank stretches longer than a frame), the scrollbar is as long as 1,900 rows, nothing jumps. _(web)_
- [ ] **Do:** Group by → Project, open several groups, scroll. → **Expect:** the header of the group you're in sticks at the top on the card surface until the next group's header takes its place; clicking a stuck header folds its group. _(web)_
- [ ] **Do:** press `j` repeatedly past the bottom edge, then `k` past the top. → **Expect:** the list follows the selection; the panel shows each task. _(web)_
- [ ] **Do:** open a task by deep link to one far down (`/tasks?id=<id>`). → **Expect:** the list opens scrolled to it, selected. _(web)_
- [ ] **Do:** click any row, then switch List → Board → List. → **Expect:** each switch feels instant (the spec measures about 50 ms). _(web)_

## Board columns
- [ ] **Do:** All → Board (grouped by status). Scroll the To do column (1,200 cards) to the middle. → **Expect:** cards keep up; other columns don't move. _(web)_
- [ ] **Do:** drag a card from the middle of To do into In progress. → **Expect:** the drag preview follows the pointer the whole way, the card lands in In progress, Undo puts it back. _(web)_
- [ ] **Do:** drag a card toward the column's bottom edge and hold. → **Expect:** the column auto-scrolls and new cards appear under the pointer. _(web)_

## One edit, one row
- [ ] **Do:** rename a task in a long list, check one off, change a priority from the row's menu. → **Expect:** only that row changes; scrolling position and other rows stay put. _(web)_
- [ ] **Do:** with a long list open, rename a project in the rail and add a new one. → **Expect:** no pause; the row menu "Move to project…" lists the new name. _(web)_

## Search
- [ ] **Do:** `/`, type `quokka`. → **Expect:** at once, the open tasks with "quokka" in the title or the description (20 in the fixture, folded groups aside). _(web)_
- [ ] **Do:** reload and type `quokka` within the first second (closed tasks still loading). → **Expect:** matches show at once; any that the copy didn't have yet join a moment later. _(web)_

## Sharing shows and hides at once (two browsers)
- [ ] **Do:** as dev, share one task (not its project) with the teammate; the teammate has Tasks open. → **Expect:** it appears for the teammate within a few seconds, without a reload (before: up to 10 minutes). _(web)_
- [ ] **Do:** as dev, move a task the teammate can see into a project they can't. → **Expect:** it leaves the teammate's list within a few seconds. _(web)_
- [ ] **Do:** as dev, unshare a project with the teammate. → **Expect:** its tasks leave the teammate's list. _(web)_

## Edge cases
- [ ] **Do:** a project with fewer than 120 rows. → **Expect:** looks and behaves exactly as before (every row drawn; find-in-page finds any row). _(web)_
- [ ] **Do:** the Queue with tasks, drag one to reorder. → **Expect:** unchanged (the Queue isn't virtualized). _(web)_
- [ ] **Do:** go offline (DevTools), search. → **Expect:** the copy's matches; no errors. _(web)_

## Migrations / data
- [ ] **Do:** `bun run db:test sync_feed` on the local stack. → **Expect:** all checks pass (tombstones, the grant feed, `tasks_search`, the publication).
- [ ] **Do:** `select tablename from pg_publication_tables where pubname = 'supabase_realtime'` → **Expect:** includes `task_completions`, `attachments`, `access_changes`.

## Known gaps / not-yet-testable
- **Verify before release:** prod applies `20261011120000_tasks_sync_feed_search` before the app ships (a build ahead of its database keeps working: new tables listen on channels of their own and every read falls back); index builds on prod's `tasks` and `comments` (plain CREATE INDEX: brief write lock); the access check's cost at 10,000 tasks on prod (about 2 s of database time per check locally); the perf gate on a real machine and a CI job with a stack; Realtime events for the grant feed through prod's Realtime.
- The Timeline isn't virtualized (TV-TL1 rebuilds it; the switch to it is logged at about 290 ms on the fixture).
- Not checked by hand: Safari and the desktop webview scrolling a virtualized list at 60 fps.
