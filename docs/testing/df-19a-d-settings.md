# Manual test checklist — DF-19 Settings overhaul (a–d)

> Generated 2026-07-11 · branch `t/maciej/df-19a-settings-grouped-nav` · **Live-verified:** yes (grouped nav, appearance groups + tags, Account sign-in card, API-keys section all confirmed on the hosted account `grzywaczmj+moduo-s2-test`, web dev server). Password change + key create/revoke were **not executed** against the test account (verified present + wired, not mutated) — see Known gaps.
> Run top-to-bottom; check off as you go. Each item is step → what you should see → where.

## Settings shell — grouped nav (DF-19a)
- [ ] **Do:** Open Settings (`⌘,`, the top-bar avatar menu, or the ⌘K palette → "Settings"). → **Expect:** a modal with a left nav grouped under **PERSONAL** (Account · Billing · Appearance · Preferences · Focus), **WORKSPACE** (Workspace · Integrations · API keys), **APP** (Advanced · About). _(both)_
- [ ] **Do:** Click through each section. → **Expect:** each opens its pane; the active item is highlighted. _(both)_
- [ ] **Do:** Look at the bottom of the nav rail. → **Expect:** **no** "Log out" there anymore (it moved to Account). _(both)_
- [ ] **Do:** Cold-load a deep link — visit `/settings?section=billing` in a fresh tab. → **Expect:** the modal opens straight to Billing. _(web)_

## Appearance — groups + synced-vs-device (DF-19b)
- [ ] **Do:** Open Settings → Appearance. → **Expect:** the header line "Most appearance settings follow you across your devices. Density and module navigation are set per device.", then three labelled cards: **COLOR** (Theme·Shade·Accent), **TYPE** (Font), **LAYOUT** (Density·Corner radius·Module navigation). _(both)_
- [ ] **Do:** Look at the Density and Module-navigation rows. → **Expect:** each title has a small outlined **"THIS DEVICE"** pill; the other five pickers have none. _(both)_
- [ ] **Do:** Change Theme/Accent, then reload. → **Expect:** the change persists (it's synced). _(both)_
- [ ] **Do:** Change Density, then check a second device / browser signed into the same account. → **Expect:** Density does **not** follow (per-device); Theme/Accent/Font/Shade/Radius **do**. _(both)_

## Account — identity + password (DF-19c)
- [ ] **Do:** Open Settings → Account. → **Expect:** a Profile card (avatar + name), then a **Sign-in** card showing "You're signed in with Email", your **email** address, and a **Password** block; then a **Session** card with **Log out**. _(both)_
- [ ] **Do:** In Password, type a new password + a *different* confirmation → Update password. → **Expect:** inline error "The two passwords don't match." (nothing saved). _(both)_
- [ ] **Do:** Type a new password under 8 chars (matching confirm) → Update password. → **Expect:** inline error "Use at least 8 characters." _(both)_
- [ ] **Do:** Type a valid matching password (≥8) → Update password. → **Expect:** "Password updated."; you can sign in with it next time. _(both)_
- [ ] **Do:** Click **Log out** (Session card). → **Expect:** signs out to the `/auth` screen. _(both)_

## API keys — own section (DF-19d)
- [ ] **Do:** Open Settings → Workspace group → **API keys** (as a workspace owner/admin). → **Expect:** a section titled "API keys" with the MCP endpoint (copyable), a key-name field, a View/Edit scope toggle, a Create button, and the existing keys list (or "No keys yet."). _(both)_
- [ ] **Do:** Create a key. → **Expect:** the secret is revealed once with "copy it now, it won't be shown again"; the key appears in the list with a "Tasks · View/Edit" badge. _(both)_
- [ ] **Do:** Revoke a key. → **Expect:** a confirm dialog ("This can't be undone"); on confirm the key disappears. _(both)_
- [ ] **Do:** As a **non-admin** member (or with no workspace selected), open API keys. → **Expect:** "Only workspace owners and admins can manage API keys." (or "No workspace selected."), no create UI. _(both)_

## Edge cases
- [ ] **Do:** (OAuth account, if available) Open Account. → **Expect:** "You're signed in with Google" (or the real provider) and **no** password form — instead "You sign in with … so there's no password to manage here." No wrong-provider flash on open. _(both)_
- [ ] **Do:** Keyboard-navigate the settings nav with arrow keys. → **Expect:** arrows move within a group (Personal / Workspace / App); Tab crosses groups. _(Known trade-off of grouped tablists — see decisions.)_ _(both)_

## Migrations / data
- [ ] None. DF-19a–d are UI-only — no schema changes. (Appearance/Account/API-keys all use existing tables/ops.)

## Known gaps / not-yet-testable
- **API keys still also render inside the old Workspace-settings modal** (opened from the top-bar workspace switcher, or Settings → Workspace → "Open workspace settings"). Intentional: that modal — and its duplicate keys copy — is retired by **DF-19e**. Same data/ops, harmless.
- Password change + key create/revoke were verified **present and wired** but **not executed** against the shared test account (to avoid mutating its credentials/keys). Run them yourself per the steps above.
- Desktop (Tauri) parity for the password form assumes cloud auth (same `supabaseClient` path DF-3's billing uses); verified on web only.
- **Delete-account is NOT in this batch** — it's DF-19h (separate, needs a service-role edge function).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up".*
