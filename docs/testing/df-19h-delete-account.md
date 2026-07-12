# Manual test checklist — DF-19h (Account → delete account)

> Generated 2026-07-12 · branch `t/maciej/df-19h-delete-account` · **Live-verified:** yes — the `delete-account` edge function is deployed to prod and both paths were exercised **end-to-end against a disposable fixture user** (blocked→409 with the workspace listed, not deleted; clean→200 + full FK cascade of profile/workspace/members). The reusable hosted test account was NOT deleted (verified untouched). The Danger-zone UI render + confirm-gating were live-verified in the app; the full delete-through-the-UI is left for a throwaway account (irreversible).

## Danger zone UI
- [ ] **Do:** Settings → Account → scroll to **Danger zone** (cloud accounts only) → **Expect:** a red-bordered card, "Permanently delete your account…" copy, a destructive **Delete account** button. _(both)_
- [ ] **Do:** Click **Delete account** → **Expect:** a confirm panel with an input "Type your email or DELETE to confirm"; the confirm button is **disabled** until you type your exact account email (case-insensitive) or the literal word **DELETE**; wrong text keeps it disabled; Cancel closes the panel. _(both)_ — *(verified: disabled empty/wrong, enabled on DELETE, disabled again when cleared.)*

## Delete — clean (throwaway account only!)
- [ ] **Do:** On a **throwaway** account that owns only solo workspaces (no other members), type the confirm + **Delete account** → **Expect:** the account is deleted, you're signed out and land on `/auth`; signing back in fails (account gone); the owned workspaces + data are removed (FK cascade). _(both)_ — **Do NOT run on an account you want to keep.**

## Delete — blocked (sole owner of a shared workspace)
- [ ] **Do:** On an account that **solely owns a workspace with other members**, attempt delete → **Expect:** a 409 → the panel shows "You solely own a workspace with other members. Hand off ownership or delete it first:" + the workspace name(s); no deletion happens; Close dismisses. Hand off ownership (Settings → Workspace → member ⋯ → Make owner) or delete that workspace, then retry → succeeds. _(both)_ — *(the 409 + workspace-list path verified E2E on a fixture.)*

## Edge function (verified server-side)
- [ ] `delete-account` is deployed (`verify_jwt: true`); a no/invalid-JWT call is rejected; a valid caller who solely owns a shared workspace gets 409 `{blocked, workspaces:[…]}`; a caller with only solo workspaces gets 200 `{ok:true}` and is fully cascade-removed. _(verified via curl against a fixture user.)_

## Known gaps / not-yet-testable
- The full delete-through-the-UI on a real reusable account is intentionally not run (irreversible) — the edge fn's both paths + cascade are proven on a disposable fixture; the UI render + gating are proven in-app.
- Desktop (Tauri) sign-out-after-delete path not exercised (no desktop this session); the web signOut → `/auth` path is the same runtime call.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
