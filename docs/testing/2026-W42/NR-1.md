# Manual test checklist — NR-1 (Notes refresh: organizing data) + two Notes UI fixes

> Generated 2026-10-13 · branch `t/mike/notes-refresh-plan` · PR #354 · **Live-verified:** partial. Mike checked classic Notes against prod with the migration NOT applied (it works), and the editor background fix. The database half was rehearsed on a local replica of prod's real code (`nr-1/replica-probe.out`, 108/108).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Notes editor (UI fixes)
- [ ] **Do:** open any note → **Expect:** the editor sits on the same dark-grey panel surface as the empty "Write something down" state, with no black box inset inside the panel _(web / desktop)_
- [ ] **Do:** look at the note header's right cluster → **Expect:** presence, the offline icon, Share and Publish only; there's no show/hide side-panel button _(both)_
- [ ] **Do:** toggle the right panel with the bottom-bar panel button → **Expect:** Detail / Comments / Outline open and close as before _(both)_
- [ ] **Do:** a note with task lines → **Expect:** the task chips (due date / schedule) are still readable on the new surface _(both)_

## Classic Notes still works (new code, migration not applied yet)
- [ ] **Do:** open /notes → **Expect:** Inbox / Workspace / Archive / Trash as before, and no grey "read-only" banner _(web)_
- [ ] **Do:** ⌘N, type a title, reload → **Expect:** the note is in Inbox with its title _(web)_
- [ ] **Do:** drag that note onto a Workspace page → **Expect:** it nests there _(web)_
- [ ] **Do:** right-click → Duplicate → **Expect:** a "(copy)" next to the original _(web)_
- [ ] **Do:** import a small markdown zip → **Expect:** the pages appear and their content opens _(web)_
- [ ] **Do:** DevTools Network, filter `notes`, reload → **Expect:** one `notes` request fails with 42703, immediately followed by one that succeeds _(web)_

## Migrations / data (after the prod apply)
- [ ] **Do:** reload /notes → **Expect:** the same sidebar as before; the request that failed with 42703 is gone _(web)_
- [ ] **Do:** read-only SQL `select count(*) filter (where in_inbox) from notes where deleted_at is null` → **Expect:** it equals the classic Inbox count _(prod)_
- [ ] **Do:** read-only SQL on `note_favorites` → **Expect:** one row per (member, previously pinned note) the member can open _(prod)_
- [ ] **Do:** `has_table_privilege('authenticated','note_favorites','INSERT')` → **Expect:** false; SELECT is true _(prod)_

## Edge cases
- [ ] **Do:** (after the apply) ⌘N in classic → **Expect:** the new note's `in_inbox` is true; a note created via + on a page gets false _(prod SQL)_
- [ ] **Do:** (after the apply) an MCP `notes_create` of a root → **Expect:** it lands with `in_inbox = true` _(prod)_

## Known gaps / not-yet-testable
- Stored Inbox, Favorites and full width have no UI until NR-2. The new ops (`notes_op_file`, `notes_op_set_favorite`) are exercised only by the replica probe and unit tests.
- The replica stubs role and permission checks (`perm_user_has`, `perm_is_owner`), API-key scopes, and prod's other `workspace_members` triggers.
- Desktop (Tauri) wasn't run. The redb-import change only affects first-run desktop imports.
