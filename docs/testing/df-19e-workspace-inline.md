# Manual test checklist — DF-19e (Settings → Workspace inlined)

> Generated 2026-07-12 · branch `t/maciej/df-19e-workspace-inline` · **Live-verified:** yes (web, hosted test account, as sole owner of a single workspace). Multi-member / admin-role / delete rows need a second account or a throwaway workspace — see Known gaps.

## Inline management renders
- [ ] **Do:** Open Settings → **Workspace** (Personal? no — Workspace group) → **Expect:** inline cards: **Workspace** (name + Rename [owner] + Add workspace + member/invite counts), **Invite** (owner-only), **Members · N** (roster with role badges), **Pending · N** (owner, when invites exist), **Danger zone** (Leave [non-owner] / Delete [owner, >1 workspace]). No modal-in-modal. _(both)_
- [ ] **Do:** From the top-bar **workspace switcher**, click a workspace's gear/settings entry → **Expect:** it opens Settings → Workspace (the standalone modal is gone). _(both)_

## Rename (owner)
- [ ] **Do:** As owner, edit the workspace name field → **Expect:** the "Rename" button enables only when changed; click it → toast "Workspace renamed", the name persists across reload + shows in the switcher. _(both)_ — *(verified: DB `workspaces.name` updated then reverted.)*
- [ ] **Do:** As a non-owner (admin/editor/viewer) → **Expect:** the name is static text, NO editable field or Rename button (the `workspaces` UPDATE RLS is owner-only, so a client rename would fail). _(both)_

## Members / roles / invite (owner + admin)
- [ ] **Do:** As owner, open a member's ⋯ menu → **Expect:** role options (Viewer/Editor/Admin) + "Make owner" + "Remove from workspace"; changing a role / removing works (toast). _(both)_
- [ ] **Do:** As an **admin**, open a peer **admin's** ⋯ menu → **Expect:** no manage options for that admin (admins manage only editors/viewers); an admin sees no "Admin" role option and no invite/pending/keys forms (owner-only). _(both)_
- [ ] **Do:** As owner with the Team entitlement, invite by email + role → **Expect:** an invite link is created + copied, appears under Pending; copy/revoke work. Without the entitlement → the "Upgrade to Team" CTA. _(both)_

## Danger zone
- [ ] **Do:** As a **non-owner** in a workspace where you're not the only member → **Expect:** "Leave workspace" (inline confirm) — and NO delete. Leaving your only workspace is not offered. _(both)_
- [ ] **Do:** As **owner** with ≥2 workspaces → **Expect:** "Delete workspace"; the confirm button stays disabled until you type the exact workspace name; deleting removes it and re-selects another workspace (never strands you). A sole/only workspace shows no Delete (provider last-one guard). _(both)_

## Mid-open workspace switch
- [ ] **Do:** Open Settings → Workspace, then switch workspace (⌘⇧W) while it's open → **Expect:** the section re-renders for the new workspace; any open transfer dialog / typed invite / delete-confirm is cleared (no stale action against the previous workspace). _(both)_

## Known gaps / not-yet-testable
- Admin-role, multi-member, transfer-ownership, and the delete flow could not be exercised on the single-owner test account — verify with a second account or a throwaway workspace. The underlying ops (role change / remove / transfer / leave / delete) are the same ones DF-24 + the roles-transfer follow-up already round-trip-verified against prod; DF-19e only relocated their UI.
- The specced `workspace-inline.test.ts` full-render test is intentionally NOT written (importing the section `.tsx` hits the vitest `@/lib/utils` alias trap); the pure gating logic (`member-permissions` incl. the new `modulePermissionFor`) is unit-tested and the render/gating is live-verified.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
