# Manual test checklist — t/maciej/tighten-write-checks

> Generated 2026-10-10 · branch `t/maciej/tighten-write-checks` · **Live-verified:** yes, on the local stack: owner (dev@moduo.local) and member (a second local account), web app. `supabase/probes/write-checks.probe.sql` passes all 102 checks after the migration, with prod's function grants replayed locally (53 fail before it). Live on prod since 2026-10-10 (`20261010141712`).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Projects (buckets)
- [x] **Do:** As the owner, create two projects, rename one, put it in a new section → **Expect:** all saved, nothing errors _(web)_
- [x] **Do:** As a member, rename a shared project → **Expect:** renamed; the project's owner is unchanged _(web)_
- [x] **Do:** As the owner, delete an empty project and let the Undo toast close → **Expect:** gone; tasks (if any) move to the Inbox _(web)_
- [ ] **Do:** As a member, try to delete a project shared with Can edit → **Expect:** refused, as before (deleting a project needs Full) _(web)_

## Tags
- [x] **Do:** Create a tag from a task's Tags row, recolour it, attach it → **Expect:** saved _(web)_
- [x] **Do:** Delete a tag and let the Undo toast close → **Expect:** it comes off every item, including items you can't open _(web)_
- [x] **Do:** As a member, create and attach a tag → **Expect:** saved, the tag is theirs _(web)_
- [ ] **Do:** As a Viewer, open the tag picker → **Expect:** no create / recolour / delete _(web)_

## Dependencies
- [x] **Do:** Add a blocker to a task, then remove it → **Expect:** both saved, the link shows and goes _(web)_
- [ ] **Do:** Try to add a dependency that closes a loop → **Expect:** refused _(web)_

## Assignment
- [x] **Do:** Assign a task in your private Inbox to a teammate, then take it back → **Expect:** they can open it while assigned and can't after _(web)_
- [ ] **Do:** Assign a task in a shared project → **Expect:** no extra access is added (they already have it) _(web)_

## Migrations / data
- [x] **Do:** After the prod apply, check `resource_grants.origin` / `manual_level`, the new policies and triggers, and the function grants (read-only) → **Expect:** as listed in the decision entry; function bodies identical to the probed ones

## Known gaps / not-yet-testable
- Desktop builds were not run; they use the same web runtime for these tables.
- Older builds still send whole rows on save; that works as long as the owner and workspace are unchanged (prod has no projects or tags without an owner).

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
