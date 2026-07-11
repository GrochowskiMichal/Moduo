# Manual test checklist — DF-24 workspace membership loop

> Generated 2026-07-11 · branch `t/maciej/df-24-membership-loop` · **Live-verified:** member names, the `/join` accept surface, and the CHECK-constraint fix verified live on the hosted account (single owner identity); the remove-member RPC verified end-to-end against prod (success path + all guards, rolled back). The remaining **two-identity UI** flows (a fresh user redeeming an invite through the browser, leave, remove-member from the modal) could not be exercised solo and need a second sign-in. See Known gaps.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
>
> The remove-member RPC (`workspace_op_remove_member`) is **already applied to prod** — no deploy step needed.

## Member names (the highest-value, regression-prone fix)
- [ ] **Do:** Open the workspace switcher (top-left) → click a workspace's ⚙ gear → the "Workspace members" modal → **Expect:** each member shows their **display name** (e.g. "Claude Test S2"), not a truncated UUID; your own row has a muted "· You"; a member with no profile name shows "Profile name not set" (not a UUID). _(both)_ — ✅ live-verified for the owner.

## Invite → join loop (the core)
- [ ] **Do:** As an owner on a **Team** plan, open Workspace members → type a teammate email → pick a role → **Create invite** → **Expect:** a green box: "Invite created. Moduo doesn't email invites — send this link to your teammate yourself:" with a copyable **`/join?invite=…` link** (and an "Or copy the raw code" fallback). No "Sending…/Sent" language. The link is also copied to your clipboard. _(both)_
- [ ] **Do:** Paste that link into a browser where you're **signed in as a different account** (the invitee) → **Expect:** a centered "Join this workspace" card with **Accept invite** / **Skip for now**. _(web)_
- [ ] **Do:** Click **Accept invite** → **Expect:** toast "You've joined the workspace.", you land on Home, and the new workspace is selected in the switcher; the invitee is NOT shown owner controls (they see a read-only roster + Leave, per their role). _(web)_
- [ ] **Do:** Back as the owner, reopen Workspace members → **Expect:** the new member appears with their display name and correct role badge; the pending invite is gone (now accepted). _(both)_
- [ ] **Do:** Open the invite link while **signed out** → **Expect:** "You've been invited / Sign in to accept" → after sign-in you're returned to the accept card (not dumped on Home). _(web)_

## Leave / remove (two-identity)
- [ ] **Do:** As a **non-owner** member who belongs to **≥2** workspaces, open Workspace members → **Expect:** a red "Leave workspace" at the bottom; clicking it asks to confirm; confirming toasts "You left the workspace." and the workspace disappears from your switcher. _(both)_
- [ ] **Do:** As an owner, open Workspace members → a non-owner member's ⋯ menu → **Remove from workspace** → **Expect:** toast "Member removed.", the row disappears; the removed member loses access on their next refresh. _(both)_ — the RPC itself is ✅ prod-verified (success + guards); this checks the modal wiring.

## Edge cases
- [ ] **Do:** Accept an invite you've **already** accepted (or your own workspace's invite) → **Expect:** inline + toast "You're already a member of this workspace." (not a raw Postgres error). _(web)_ — ✅ live-verified.
- [ ] **Do:** Open `/join` with a **missing/garbage** `?invite` → **Expect:** "Invite link incomplete" with a "Go to Moduo" button; a revoked/expired token → "This invite is invalid or has expired." _(web)_
- [ ] **Do:** Try to **delete or leave your only workspace** → **Expect:** the affordance isn't offered (switcher trash hidden at 1 workspace; modal Leave hidden for owners / single-workspace); even if forced, the provider throws "You can't delete/leave your only workspace." — you're never stranded at zero. _(both)_
- [ ] **Do:** As an owner, revoke a pending invite / change a member's role with a flaky connection → **Expect:** a clear error toast on failure (no silent no-op). _(both)_
- [ ] **Do:** Copy an invite whose token contains `/` or `+` and open the link → **Expect:** it resolves correctly (query param + `encodeURIComponent`, not a path). _(web)_ — ✅ live-verified with a two-slash token.

## Migrations / data
- [x] **`workspace_op_remove_member` applied to prod + round-trip-verified in-session** (SECURITY DEFINER, `search_path=public`, granted `authenticated`/`service_role`, revoked from anon/PUBLIC). A rolled-back probe with simulated `auth.uid()` confirmed: owner removes a real non-owner member (row deleted); `member not found`; `cannot remove the workspace owner` (checks role AND `owner_id`); `only workspace owners and admins can remove members`. No DB pollution.
- [ ] **Do:** (optional) Regenerate `src/types/supabase.ts` — the client is untyped so this is cosmetic; skipped in-session to avoid a large unrelated diff. _(server)_

## Known gaps / not-yet-testable
- **Two-identity UI flows** (a fresh user redeeming through the browser, leave, remove-member from the modal) were **not** run — the build session had only the single owner test account, and creating a second account is out of policy for the agent. The member-insert was proven CHECK-valid to the last step (it stops only at the "already a member" unique guard), every written role/perm value is CHECK-accepted, and the remove RPC is prod-verified end-to-end — so the DB layer is solid; confirm the browser UI wiring end-to-end.
- **Roster completeness across members** depends on the pre-existing `workspace_members` SELECT RLS breadth (co-members visible to each other). With one member it couldn't be checked — verify the owner sees the joined member (and vice-versa) after a real join.
- **remove-member** is inert until its migration is applied (graceful error toast until then).
- **Invite creation UI** shows the Team-upgrade prompt on non-Team plans (the test account is `pro`), so the honest-delivery link box was verified via the invite lifecycle at the DB level, not through the on-plan UI. Verify the link box on a Team-tier account.
