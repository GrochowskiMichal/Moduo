# Manual test checklist — TV-U8 Saved views

> Generated 2026-10-13 · branch `t/maciej/tv-u8-views` · **Live-verified:** yes, on the local stack as the teammate account (Save as view from All, the Views group, Board + Save changes, Revert, reopen after a reload, `?view=` for a view and for a missing one, Share with the workspace, Delete with Undo, the seeded "Done last week"); `tests/tasks-views.spec.ts` passes (2/2, serial).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Saving a view
- [ ] **Do:** open All, pick a filter (Filter → Due date → This week), then the toolbar's ⋯ → Save as view… → **Expect:** a small dialog "Save as view" with the name "All" ready to type over; Save view opens the new view, its name is the title, and it sits under a "Views" header in the sidebar between Pinned and the projects, with no icon (its name lines up with the projects') _(web, desktop)_
- [ ] **Do:** save views from My tasks, Upcoming and a project too → **Expect:** each opens on its own place (a project view shows that project's tasks, sections and statuses); the Inbox, Focus and Won't do have no "Save as view…" _(web)_
- [ ] **Do:** in an open view, switch to Board (or change Group by, a filter, Rows) → **Expect:** "Unsaved changes · Save · Save as new view… · Revert" under the toolbar; Save keeps it (the line goes), Revert puts back what was saved _(web)_
- [ ] **Do:** change a view, open another place, come back → **Expect:** the unsaved change is still there (until a reload); after a reload the view opens as saved _(web)_
- [ ] **Do:** in an open view, ⋯ → Save as new view… → **Expect:** a copy named "<name> copy" with your current changes; the original is untouched _(web)_
- [ ] **Do:** reload Tasks while a view is open → **Expect:** it reopens on that view _(web, desktop)_

## The Views group
- [ ] **Do:** a view's ⋯ → Rename → **Expect:** the name changes in place; the title follows _(web)_
- [ ] **Do:** ⋯ → Move up / Move down → **Expect:** your views reorder; the first can't go up, the last can't go down _(web)_
- [ ] **Do:** ⋯ → Pin to sidebar → **Expect:** it joins Pinned (in pin order, beside pinned projects, no icon); Unpin takes it out _(web)_
- [ ] **Do:** ⋯ → Copy link, paste it in a new tab → **Expect:** Tasks opens on that view and the address goes back to plain /tasks _(web)_
- [ ] **Do:** ⋯ → Delete view → **Expect:** it's gone with an Undo toast; Undo brings it back (with its filter and Display) _(web)_
- [ ] **Do:** collapse the Views header → **Expect:** the group folds, and stays folded after a reload _(web)_

## Sharing
- [ ] **Do:** ⋯ → Share with the workspace → **Expect:** a toast "… is shared with the workspace · People see the tasks they can see through it, nothing more"; a teammate sees it after their next refresh or return to the window, after their own views _(web, two accounts)_
- [ ] **Do:** as the teammate, open the shared view and change its filter → **Expect:** "Unsaved changes · Save as new view… · Revert" (no Save: only its maker changes it); their ⋯ offers Pin and Copy link only _(web)_
- [ ] **Do:** share a view of a private project → **Expect:** only people who can see that project see the view; everyone else never sees its name _(web, two accounts)_
- [ ] **Do:** as the workspace owner or an admin, open a teammate's shared view's ⋯ → **Expect:** Stop sharing and Delete view (no Rename) _(web)_
- [ ] **Do:** as a Viewer, save a view → **Expect:** it saves; its ⋯ has no "Share with the workspace" _(web)_

## Seeded views and the new filters
- [ ] **Do:** a person who answered the role question (or skipped it) opens Tasks in a workspace → **Expect:** their role's views appear once (PM: Waiting, Due this week; founder: Waiting on people; client work: Waiting on client; creator: Pipeline, Publish dates; student: Today; developer: This week) plus "Done last week" for everyone; deleting one never brings it back, on any device _(web)_
- [ ] **Do:** open Done last week → **Expect:** Status is Done + Completed is Last week, the done tasks listed (Completed hidden doesn't hide them), the title counts them _(web)_
- [ ] **Do:** Filter → Completed and Filter → Waiting on → **Expect:** Completed: Today · This week · Last week · This month · Not completed (the week starts per Settings → Time & region); Waiting on: Anything · A teammate · An email reply · An agent · Something else · Not waiting _(web)_

## Folds follow you
- [ ] **Do:** fold a group in a List (or a Board column), then open the same place on another device (or clear site data and reload) → **Expect:** it's still folded; a saved view keeps its own folds apart from its place _(web, desktop)_

## Edge cases
- [ ] **Do:** open `/tasks?view=<an id that was deleted>` → **Expect:** "That view isn't available · It was deleted, or it isn't shared with you"; Tasks stays where it was _(web)_
- [ ] **Do:** delete the project a view looks at → **Expect:** the view opens empty; its owner can still rename or delete it _(web)_
- [ ] **Do:** go offline and try to save, rename or delete a view → **Expect:** "Offline · Saved views change when you're back online"; nothing half-saved _(web)_
- [ ] **Do:** a teammate who shared views leaves the workspace → **Expect:** their shared views disappear for everyone _(web, two accounts)_

## Migrations / data
- [ ] **Do:** `bun run db:test task_views` → **Expect:** 87 checks pass (outsiders, a view of a project you can't see, ids from elsewhere, keys refused, raw writes refused, seeds once, erasure) _(local stack)_
- [ ] **Do:** after the release apply, check `account_erase_workspace_data` on prod has the `task_views` count, `'views_deleted'` and the DELETE line → **Expect:** present (the migration patches it by anchored replace and refuses to run if the anchors are missing)

## Verify before release
- Apply `20261013250000_task_views` once, its final file, with the other v3 migrations (it was re-applied on the local stack while it was revised; it's re-runnable), after TV-D15's and TV-D16's erasure patches (its anchors are TV-D15's template lines in `account_erase_workspace_data`; check them on prod's body first).
- Views read through prod's PostgREST (the read policy calls `task_views__readable` per row; small table).
- Two real devices: a view saved on one shows on the other after a window return; folds follow; seeds don't double.
- The signed desktop build: Copy link writes `/tasks?view=…` with the web origin (check what the desktop app's origin gives).

## Polish later
- View rows carry no count (a view's count would run its filter over every task on each change); revisit with a deferred count if wanted.
- Drag to reorder views (Move up/down only for now); hide someone else's shared view from your sidebar.
- Filter → Completed → a date range (the spec's "range") isn't built.
- A former member named only on tasks you can't see can't be kept in a saved filter (the save says "That filter can't be saved in a view."); the chip could explain.
- Copy link on the desktop app may need the hosted web origin rather than the webview's.
- Visual baselines for the Views group and the unsaved-changes line.

## Known gaps / not-yet-testable
- Realtime: views aren't published; another device's change shows on the next read (open, window return, reconnect).
