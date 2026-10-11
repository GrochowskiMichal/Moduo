# Manual test checklist — TV-D11a The shared store

> Generated 2026-10-11 · branch `t/maciej/tv-d11a-store` → `t/maciej/tasks-v3-build` (local build mode) · **Live-verified:** yes, on the local stack (web, `rsbuild dev` on :8137, signed in as `dev@moduo.local`, Chromium through Playwright): Tasks reopened from the device copy with every request to the stack failing ("Offline" in the top bar, a Delete said "Offline" and left the task); with the network off a ⌘⇧K capture showed "Waiting to sync · Inbox" and the task at once, a check-off showed it done, the top bar read "Offline · 2 waiting to sync"; back online both reached the server once, the capture before the check-off; Home's Tasks and Today widgets and the Calendar's tasks panel rendered from the store, and Home → Calendar → Tasks → Notes read the task list twice in all (open tasks, then the rest), not once per page. E2E (after merging TV-D10, one worker): `tests/offline.spec.ts` 2/2, `trust-pass` 12/12, `tasks-toolbar`, `references` 3/3, `tasks-dnd` 5/6 (the 6th, "a sorted project says so…", fails the same way on the integration branch without this block: see Known gaps), 27 in all; the store read areas, sections, teams, members, sessions, reminders and waiting (all 200) and kept them in the device copy.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Opening fast, from the device
- [ ] **Do:** open Tasks, wait a second, reload the page → **Expect:** the list is there at once (no skeleton), then quietly catches up. _(web / desktop)_
- [ ] **Do:** open Home, then Tasks, then Calendar, then Notes, with the browser's Network tab open → **Expect:** the task list is read once at the start (two requests to `tasks`: open ones, then the rest), never again per page. _(web)_
- [ ] **Do:** in a workspace with many Done tasks, open a project → **Expect:** open tasks show first; "Completed" groups fill in a moment later. _(both)_
- [ ] **Do:** open a link to a Done or Won't do task (`/tasks?id=…`) on a fresh browser profile → **Expect:** that task opens (it waits for the Done tasks to arrive), never another task. _(web)_

## Live and quiet
- [ ] **Do:** in a second browser signed in as a teammate, rename a task, add a comment, edit a project's statuses → **Expect:** each shows in the first browser within a second or two, without reloading. _(web)_
- [ ] **Do:** type a new title on a task and, while it saves, have the teammate change its priority → **Expect:** your title stays; their priority shows. _(web)_
- [ ] **Do:** make a change the server refuses (e.g. as a member with view access, or edit a task a teammate just deleted) → **Expect:** a toast says why; only that field goes back; nothing else on the page flickers or reloads. _(both)_

## Offline (default g)
- [ ] **Do:** turn the network off (macOS Wi-Fi off, or DevTools → Offline) with Tasks open → **Expect:** "Offline" in the top bar, left of the Focus timer; the list stays. _(both)_
- [ ] **Do:** ⌘⇧K, type "Call the bank tomorrow", ⏎ → **Expect:** toast "Waiting to sync · Inbox"; the task appears in the Inbox; the top bar reads "Offline · 1 waiting to sync". _(both)_
- [ ] **Do:** tick a task's checkbox → **Expect:** it shows done; "Offline · 2 waiting to sync". _(both)_
- [ ] **Do:** try any other edit (rename, drag, delete, a date) → **Expect:** a toast "Offline — This change needs a connection…"; nothing changes. _(both)_
- [ ] **Do:** reload while still offline (desktop app; on the web, block `127.0.0.1:54321` in DevTools → Network request blocking instead) → **Expect:** the app opens on your workspace, the list and the two waiting changes are still there. _(desktop / web with blocking)_
- [ ] **Do:** turn the network back on → **Expect:** the top bar badge goes away within a few seconds; Supabase Studio shows "Call the bank" once and the ticked task done. _(both)_
- [ ] **Do:** offline, capture from Home's Quick capture widget → **Expect:** "Waiting to sync · Inbox"; it syncs once you're back. _(web)_

## The device copy is one person's
- [ ] **Do:** sign out, then open DevTools → Application → IndexedDB → `moduo-sync` → **Expect:** the `workspaces` store is empty; localStorage has no `moduo:workspaces-on-device`. _(web)_
- [ ] **Do:** sign in as person A, open Tasks; sign out; sign in as person B on the same browser → **Expect:** B never sees A's tasks, not even for a moment. _(web)_
- [ ] **Do:** as the owner, make a project private (remove its workspace grant) while a teammate has Tasks open; the teammate comes back to the window after 10 minutes, or reloads → **Expect:** that project's tasks leave the teammate's list and their device copy. _(web)_
- [ ] **Do:** Settings → Account → delete a throwaway account → **Expect:** its device copy is gone (IndexedDB `moduo-sync` empty). _(web)_
- [ ] **Do:** offline, capture a task; leave the app closed for more than an hour (the session token expires); reopen it before the network is back, then connect → **Expect:** the capture is still "waiting to sync" and is sent once; nothing was wiped. _(desktop)_
- [ ] **Do:** leave a workspace (or have its owner remove you), then open the app → **Expect:** IndexedDB `moduo-sync` has no record for that workspace any more. _(web)_

## Sharing and TV-D10's structure
- [ ] **Do:** as the owner, share a private project (with old tasks) with a teammate who has Tasks open; the teammate comes back to the window → **Expect:** the project, its statuses and its tasks appear within a few seconds (no reload). _(web)_
- [ ] **Do:** make it private again; the teammate comes back to the window → **Expect:** the project, its tasks and its statuses leave their list and their device copy. _(web)_
- [ ] **Do:** in Supabase Studio, add an area, a section to a visible project, a team; open Tasks → **Expect:** IndexedDB `moduo-sync` holds them (`areas`, `sections`, `teams`); a rename in Studio arrives live. _(web)_
- [ ] **Do:** sign in as a new member of a workspace (no Inbox yet) and open Tasks → **Expect:** your Inbox exists and a capture lands in it. _(web)_

## Not up to date
- [ ] **Do:** with Tasks open, make reads fail on the server (e.g. Studio: revoke the session, or end the trial) and come back to the window → **Expect:** the list stays, the top bar says "Not up to date"; clicking it tries again; once reads work it goes away. _(web)_

## Home
- [ ] **Do:** offline, tick a task in Home's Tasks widget → **Expect:** it's done everywhere at once and "Offline · 1 waiting to sync"; back online it reaches the server once. _(web)_

## Drops and Undo (TV-U4's gap)
- [ ] **Do:** with three tasks in your Queue, drag the middle one to the Board's Done column, then Undo → **Expect:** it's back in the Queue in the middle, open. _(both)_

## Edge cases
- [ ] **Do:** first sign-in on a new device while offline → **Expect:** "You're offline. Your tasks show once you're back online." instead of an empty list. _(desktop)_
- [ ] **Do:** a very large workspace (5,000+ tasks) → **Expect:** a notice says which collection was cut (as before); the 10k fixture and virtualization are TV-D11b's. _(both)_

## Migrations / data
- [ ] **Do:** nothing to apply: this block adds no migration → **Expect:** `supabase migration list` on the local stack is unchanged. _(local)_

## Known gaps / not-yet-testable
- A project made from the rail shows twice for a moment if its Realtime insert lands before the op's answer (the project op makes its own id; tasks don't have this, they're created under the client's id). A capture made before the shell has a store (the first second after launch) lands at a fixed place in the Inbox, not at its end.
- `tests/tasks-dnd.spec.ts` "AC11.4 — a sorted project says so; dragging asks to switch back and writes nothing" fails at "Back to manual order" (the list stays sorted by due date). It fails identically on `t/maciej/tasks-v3-build` without this block (checked by running it against the integration branch's code), so it predates TV-D11a: TV-U10 (List v3) owns the sorted line.
- The trust-pass e2e looked for "Status: Won’t do" (typographic apostrophe); since TV-D9 the panel names the project's status and the seeded default is "Won't do" (straight apostrophe). The test now accepts either; the seed's spelling vs the app's "Won’t do" label is a copy inconsistency for a later data block (it needs a migration).
- Completions and attachments aren't in the `supabase_realtime` publication (a migration, not allowed in this block): completions arrive with the next read (focus, reconnect, or the task row's own change, which is live). Noted for TV-D11b.
- Verify before release: the desktop app opening offline (Tauri serves the app shell; not run here); a real network drop on Wi-Fi rather than Playwright's emulation; IndexedDB quota on a 10k workspace; Safari's private window (no IndexedDB: the store still works, it just opens from the server).

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
