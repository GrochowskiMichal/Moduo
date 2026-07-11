# Manual test checklist — joinWorkspace return-shape fix

> Generated 2026-07-11 · branch `t/maciej/join-workspace-return-fix` · **Live-verified:** partial — unit test locks the return shape + selection; the live join-by-code flow needs a real pending invite + a second workspace (see Known gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
>
> **Context:** pre-existing bug surfaced by the DF-24 validator (out of DF-24's scope). `runtime.workspace.joinInvite` returns the accepted *invite* row (`{ id, workspace_id, role, … }`), not a workspace. `joinWorkspace` was `mapWorkspace(inviteRow)` → a garbage summary (id = invite id, name = undefined) and `selectWorkspace(inviteRow.id)` selected a non-existent workspace. Now it resolves the real summary from the refreshed list via `workspace_id` and selects that.

## Join a workspace by code (switcher)
- [ ] **Do:** As user B, from an account with an existing workspace, open the workspace switcher (⌘⇧W) → "Join with code" → paste a **valid pending invite code** for a *different* workspace → confirm. → **Expect:** the menu closes, you are switched *into the joined workspace* (its name shows top-left, its notes/tasks load), and the switcher still renders (does not disappear). _(both)_
- [ ] **Do:** After joining, reload the app. → **Expect:** you stay on the joined workspace (the correct workspace id was persisted to `localStorage`, not the invite id). _(both)_
- [ ] **Do:** In the switcher, paste an **invalid / expired / already-used** code → confirm. → **Expect:** an inline error ("Invalid or expired invite code."), no workspace switch, no crash, switcher stays put. _(both)_

## Regression — no visible change to the happy path
- [ ] **Do:** Create a workspace, rename it, leave a non-primary workspace, switch between workspaces. → **Expect:** all unchanged — `refreshWorkspaces` now returns the list but every existing caller ignores the return value. _(both)_

## Edge cases
- [ ] **Do:** Join with a code whose workspace is somehow absent from your refreshed list (e.g. RLS hides it). → **Expect:** `joinWorkspace` returns `null` → switcher shows the "Invalid or expired invite code." error rather than switching to a phantom workspace. _(both)_

## Known gaps / not-yet-testable
- The end-to-end join-by-code flow was **not** live-driven in this session: it needs a real pending invite token issued to a second account plus a second workspace to join, which isn't provisionable through the preview harness without multi-user Supabase setup. It is instead locked by a unit test ([src/providers/workspace-provider.test.tsx](../../src/providers/workspace-provider.test.tsx)) that mocks the runtime and asserts (a) the returned summary is the *joined workspace* (`id`/`name`/`role` from the workspace row, not the invite), (b) the joined workspace becomes the active selection, and (c) an absent workspace → `null`. Both tests fail against the old `mapWorkspace(inviteRow)` code.
- The DF-24 `/join/:token` accept page (`src/routes/pages/join-page.tsx`, built in a parallel session) is **not present in this worktree** and calls `runtime.workspace.joinInvite` directly without this return value — unaffected by this fix.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
