# Manual test checklist — TV-SEC1 access-check hardening

> Generated 2026-10-13 · branch `t/maciej/tv-sec1-access` · **Live-verified:** yes, on the local stack through the local API (PostgREST) and the SQL suite. This block has no screen; these checks confirm the app behaves the same.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Everyday reads still work
- [ ] **Do:** sign in, open Tasks, switch between projects, open a shared and a private project → **Expect:** the same tasks as before, nothing missing, no error toast _(web / desktop)_
- [ ] **Do:** open a task someone shared with you directly (not its project) → **Expect:** it opens, and you can edit it if you could before _(web)_
- [ ] **Do:** open a note, a contact, a company and a calendar event shared with you → **Expect:** they open as before _(web)_
- [ ] **Do:** open a task with an attachment and preview the file → **Expect:** the preview loads _(web)_
- [ ] **Do:** with a second account, change a task you both see → **Expect:** it updates live on your screen _(web, two accounts)_

## Assigning
- [ ] **Do:** in a project only you can see, assign a task to a teammate → **Expect:** the picker warns "<name> can't see "<project>" — they'll only see this task"; after assigning, they see that one task _(web, two accounts)_
- [ ] **Do:** assign a task in a shared project to a teammate who can see it → **Expect:** no warning _(web)_
- [ ] **Do:** unassign them from the private-project task → **Expect:** it disappears from their list _(web, two accounts)_

## Sharing, mentions and chat
- [ ] **Do:** share a private project with a teammate at View → **Expect:** they see it; your share sheet lists them _(web, two accounts)_
- [ ] **Do:** @-mention a teammate in a task you can edit → **Expect:** they get the notice if they can see the task _(web, two accounts)_
- [ ] **Do:** open Chat, send a message in a channel, open a DM → **Expect:** works as before _(web)_

## Agents (MCP)
- [ ] **Do:** with an API key, ask the agent to list your tasks and change one → **Expect:** the agent sees exactly what you see, and the change lands _(Claude Desktop / MCP)_

## Migrations / data
- [ ] **Do:** `bun run db:test` → **Expect:** all files pass, including `access_check.test.sql` (55 checks) _(local stack)_
- [ ] **Do:** in SQL, `select oid::regprocedure, prosecdef, pronargdefaults from pg_proc where proname = 'can_access'` → **Expect:** two rows, both `t`, both `0` defaults: `can_access(text,uuid,text)` and `can_access(text,uuid,text,uuid)` _(local stack)_

## Known gaps / not-yet-testable (verify before release)
- Apply `20261013260000` after every other v3 migration that redefines `can_access`, with a `lock_timeout`. It stops if the policies that call `can_access` on prod differ from the 17 it lists; compare first.
- On a prod copy: `bun run db:test`; tasks, attachments (Storage) and a live task change (Realtime) as a signed-in user; `can_access` through prod's PostgREST with three arguments (answers) and four (refused).
- The access check's database time at 10,000 tasks on prod (one more call per row; locally 1.4–1.6 s, the same as calling the rules directly).
- MCP keys and the chat ops on prod after the release.
