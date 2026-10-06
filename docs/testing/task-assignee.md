# Manual test checklist — task assignee

> Generated 2026-10-06 · branch `t/mike/task-assignee` · **Live-verified:** no — typecheck, biome, task unit tests only.
> Run top-to-bottom; check off as you go.

## Create
- [ ] **Do:** Open Tasks → New task → look at the pills → **Expect:** an Assignee pill showing "Me" _(web)_
- [ ] **Do:** Pick a teammate, create the task → **Expect:** task shows that teammate's avatar; they get an "assigned to you" notification _(web)_
- [ ] **Do:** Create a task without touching Assignee → **Expect:** assigned to you _(both)_
- [ ] **Do:** Enable "Create more", pick a teammate, create → **Expect:** next capture keeps the teammate; closing and reopening resets to Me _(web)_
- [ ] **Do:** Add a subtask / Focus quick-capture → **Expect:** assigned to you _(both)_

## Edit
- [ ] **Do:** Open a task → Assignee row → pick another member → **Expect:** saves, avatar updates in list/board _(both)_
- [ ] **Do:** Right-click a row and a board card → Assign to → **Expect:** submenu with all members, current one checked _(web)_

## Edge cases
- [ ] **Do:** Solo workspace → **Expect:** no avatars on rows/cards, no "Assign to" menu; detail row still works _(web)_
- [ ] **Do:** Task whose assignee left the workspace → **Expect:** detail shows "Former member", no crash _(web)_
- [ ] **Do:** View-only member → **Expect:** assignee controls disabled _(web)_

## Migrations / data
- None — assignee is the existing `tasks.owner_id`.

## Known gaps / not-yet-testable
- Not exercised in a browser; no filter-by-assignee yet.
