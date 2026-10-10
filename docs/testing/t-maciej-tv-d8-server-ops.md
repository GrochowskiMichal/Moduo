# Manual test checklist — TV-D8 server ops, registry, handles, recurrence, tolerance

> Generated 2026-10-10 · branch `t/maciej/tv-d8-server-ops` → `t/maciej/tasks-v3-build` (local build mode) · **Live-verified:** yes, on the local stack (web, `dev:web` on :8093, signed in as `dev@moduo.local`): time zone saved at sign-in, create through the op (number, registry, trail), ⌘K by handle and by an old-key handle, rename re-registers, Settings → Workspace → Task key (invalid key refused, MW → MOD with the alias kept and every handle refreshed), the handle in the panel header, completing a repeat (server pointer = the app's preview, one completion row), the "Update Moduo" banner with a refused save. Not verified: copying the handle (the preview pane refuses clipboard writes: "Couldn't copy MW-2." — same as Copy link there).
> Migrations: `20261010160000_tasks_ops_registry_handles.sql`, `20261010161000_tasks_recurrence_server.sql` (local only). SQL tests: `bun run db:test` (176 checks in `supabase/tests/`). The server's repeat engine was also swept against rrule.js on 2,300 random rules (no difference).

## Handles and the registry
- [ ] **Do:** open any task → **Expect:** its handle (e.g. `MOD-142`) at the end of the header breadcrumb ("Inbox › MOD-142"); hover says "Copy MOD-142" _(both)_
- [ ] **Do:** click the handle → **Expect:** toast "Copied MOD-142"; pasting gives `MOD-142` _(both; clipboard needs a real browser or the desktop app)_
- [ ] **Do:** create a task from "+ New", ⌘⇧K and a note's task line → **Expect:** each gets the next number; ⌘K finds it by title at once and by typing its handle (`MOD-14` lists MOD-14, MOD-140…) _(both)_
- [ ] **Do:** rename a task, then ⌘K the new and the old title → **Expect:** only the new title finds it; the trail says "You renamed this to “…”" _(both)_
- [ ] **Do:** delete a task, ⌘K its title; Undo, ⌘K again → **Expect:** gone from search while deleted, back after Undo with the same handle; subtasks of a deleted parent stay, at the top level _(both)_
- [ ] **Do:** move a parent with subtasks to another project → **Expect:** the subtasks move with it at once; the trail says "moved this and its N subtasks to another project" _(both)_

## Settings → Workspace → Task key
- [ ] **Do:** as the owner, type `MO1`, then `ab` → **Expect:** "Use letters A to Z only." / the field takes it as `AB`; "Change key" only lights up for a valid, different key _(both)_
- [ ] **Do:** change the key (e.g. MW → MOD) → **Expect:** toast "Task key changed to MOD."; every handle now reads `MOD-…`; ⌘K `MW-12` still finds MOD-12 _(both)_
- [ ] **Do:** open the same section as a member (not the owner) → **Expect:** the key as plain text and "Only the workspace owner can change the key." _(both)_

## Repeats on the server (AC1.2)
- [ ] **Do:** check off a daily repeat on Home's Tasks widget, then reload Tasks → **Expect:** it stays done today; the toast earlier said "Done — next: Tomorrow…" _(both)_
- [ ] **Do:** check off the same kind of repeat through MCP (`calendar_complete_block` or `tasks_set_status`) and reload the app → **Expect:** done until tomorrow, never reopened today _(MCP)_
- [ ] **Do:** wait past local midnight (or run `select count(*) from public.tasks__roll_over()` on the local DB) → **Expect:** the repeat is back as To do for today's occurrence; the trail says "Moduo reopened this for … (recurrence)" _(both)_
- [ ] **Do:** reopen a done repeat by hand → **Expect:** it reopens; its completion is taken back (Completed filters later won't count it) _(both)_
- [ ] **Do:** sign in on a device in another time zone → **Expect:** `user_preferences.time_zone` follows the device (one write per sign-in) _(both)_
- [ ] **Do:** mark a done task Won't do → **Expect:** its completion is taken back, like a reopen _(both)_
- [ ] **Do:** give a repeat a rule that ends ("…, 3 times"), complete it the third time, then run the roll-over twice → **Expect:** it stays done; the first run marks it as having no next occurrence and the second leaves it untouched _(both)_

## Dependencies: one store (AC1.14)
- [ ] **Do:** in a task's hub, link another task with the kind "blocks" → **Expect:** the linked task shows as blocked (Blocked by 1) in Tasks, and closing the blocker unblocks it _(both)_
- [ ] **Do:** change that link's kind to "references", then delete a "blocks" link → **Expect:** the dependency goes each time _(both)_
- [ ] **Do:** try a "blocks" link that would make a loop → **Expect:** refused (no loop is stored) _(both)_

## Old builds (AC12.6)
- [ ] **Do:** `update app_settings set value = '"99.0.0"' where key = 'min_build'` on the local DB, reload the app → **Expect:** the "Update Moduo" strip (web: "Reload →", desktop: "Check for updates →"); everything reads, including notifications, share menus and calendar busy times; any save fails with "This version of Moduo is too old to save changes. Update Moduo to keep working." Set it back to `"0.0.0"` _(both)_
- [ ] **Do:** give a task a status this build doesn't know (`update tasks set status = …` once TV-D9 allows `backlog`) → **Expect:** it still shows, as To do (Won't do for `wont_do`) _(both)_

## MCP
- [ ] **Do:** `tasks_list` with `offset: 1000` in a workspace with more than 1,000 tasks → **Expect:** the tasks after the first 1,000 (AC1.13) _(MCP)_
- [ ] **Do:** `tasks_create` (title only) with a key → **Expect:** the task lands in the key creator's Inbox, assigned to them, with a handle; its trail names the key _(MCP)_
- [ ] **Do:** `tasks_update` with `due_date: null` → **Expect:** the due date clears; nothing else changes _(MCP)_

## Edge cases
- [ ] **Do:** save a repeat rule with `INTERVAL=0`, `COUNT=5000` or `UNTIL=99991231` (MCP `tasks_update`/raw write) → **Expect:** refused: "That repeat can't be saved: …" _(both)_
- [ ] **Do:** export the workspace (Settings → Advanced) → **Expect:** `tasks.json` has every task's `number` and a `completions` list; past 20,000 completions its `truncated` list says so _(both)_
- [ ] **Do:** as a member, delete your task that has a subtask in the owner's private project → **Expect:** the delete goes through; the subtask stays, at the top level, for the owner _(both)_
- [ ] **Do:** through MCP, `tasks_update` a task you can't see, or set a parent you can't see → **Expect:** "Task not found in this workspace." / "That parent task isn't in this workspace." _(MCP)_

## Migrations / data
- [ ] **Do:** on the release train, apply `20261010160000` then `20261010161000` in that order (re-running only the first redefines `tasks__apply_status` without the server pointer: always apply both) → **Expect:** every task numbered per workspace in creation order, every task registered (deleted ones tombstoned), every workspace with a key; `cron.job` has `tasks-roll-over` every 15 minutes _(prod)_
- [ ] **Do:** watch an open app while the number backfill runs on prod → **Expect:** one Realtime update per task arrives (the backfill disables the stamping triggers, not the publication); schedule the apply when few apps are open _(prod)_
- [ ] **Do:** before applying, run `select count(*) from tasks where public.tasks__recurrence_problem(recurrence) is not null` on prod (after creating that function, or with its body inline) → **Expect:** 0. The CHECK is NOT VALID, so old rows aren't checked at apply time, but any such row couldn't be edited or completed afterwards; fix those rules first _(prod)_

## Known gaps / not-yet-testable
- Verify before release: an old desktop build (pre-D8) creating, renaming and completing tasks against these migrations (raw inserts get numbered and registered; whole-row saves keep their number; its client catch-up is ignored and answered with the server's rows).
- Verify before release: the cron job on the hosted project (pg_cron runs `tasks__roll_over` as the job owner; check `cron.job_run_details` after the first run).
- Clipboard copy of the handle in a real browser and the desktop app.
- The handle wraps to a second line in a narrow panel ("Inbox ›" / "MOD-308"); TV-U13 redoes the header anatomy.
- The project delete path (`deleteBucket`) still moves tasks with a raw write: TV-U6 rewrites project deletion.
