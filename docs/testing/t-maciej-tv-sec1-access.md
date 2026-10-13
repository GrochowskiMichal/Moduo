# Manual test checklist — TV-SEC1 access-check hardening

> Generated 2026-10-13 · branch `t/maciej/tv-sec1-access` · **Live-verified:** yes, on the local stack through the local API (PostgREST) and the SQL suite. This block has no screen; these checks confirm the app still behaves the same.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Everyday reads still work
- [ ] **Do:** sign in, open Tasks, switch between projects, open a shared and a private project → **Expect:** the same tasks as before, nothing missing, no error toast _(web / desktop)_
- [ ] **Do:** open a task someone shared with you directly (not its project) → **Expect:** it opens and you can edit it if you could before _(web)_
- [ ] **Do:** open a note, a contact and a calendar event shared with you → **Expect:** they open as before _(web)_
- [ ] **Do:** open a task with an attachment and preview the file → **Expect:** the preview loads _(web)_

## Assigning
- [ ] **Do:** in a project only you can see, assign a task to a teammate → **Expect:** the picker warns "<name> can't see "<project>" — they'll only see this task"; after assigning, they see that one task _(web, two accounts)_
- [ ] **Do:** assign a task in a shared project to a teammate who can see it → **Expect:** no warning _(web)_
- [ ] **Do:** unassign them from the private-project task → **Expect:** it disappears from their list _(web, two accounts)_

## Sharing and chat
- [ ] **Do:** share a private project with a teammate at View → **Expect:** they see it; your share sheet lists them _(web, two accounts)_
- [ ] **Do:** open Chat, send a message in a channel, open a DM → **Expect:** works as before _(web)_

## Agents (MCP)
- [ ] **Do:** with an API key, ask the agent to list your tasks and change one → **Expect:** the agent sees exactly what you see, and the change lands _(Claude Desktop / MCP)_

## Migrations / data
- [ ] **Do:** `bun run db:test` → **Expect:** all files pass, including `access_check.test.sql` (48 checks) _(local stack)_
- [ ] **Do:** in SQL, `select prosecdef from pg_proc where oid = 'public.can_access(text,uuid,text,uuid)'::regprocedure` → **Expect:** `f` (the front door); `private.can_access` → `t` _(local stack)_

## Known gaps / not-yet-testable (verify before release)
- Apply `20261013260000` after every other v3 migration that redefines `can_access`; its preflight refuses a body without TV-D13's rule.
- On a prod copy: `bun run db:test`; the `private` schema not in the API's exposed schemas; tasks, attachments (Storage) and a task change through Realtime read as a signed-in user.
- The access check's database time at 10,000 tasks on prod (one extra call layer; locally 1.5 s against 1.75 s before).
- MCP keys and the chat ops on prod after the release.
