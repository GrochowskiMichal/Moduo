# Spec: Settings overhaul (DF-19)

> Status: **Shipped** — all sub-blocks landed: DF-19a/b/c/d 2026-07-11 · DF-19e/f/g/h/i 2026-07-12. The held Notifications sub-slice shipped separately as **DF-19f-notif** (2026-07-12, spec [`specs/df-19f-notification-toggles.md`](./df-19f-notification-toggles.md)), with **DF-19f-quit** 2026-07-13. **[`specs/BUILD_ORDER.md`](./BUILD_ORDER.md) is the status of record**; this spec is the design/AC reference. · Owner: maciej · Lane: platform · Source: `docs/reviews/whole-app-critique-2026-07.md` §4.8 (S2/S3/S6, CC-7/CC-9/CC-10) + designer verdict ("Settings … currently subpar — we need more"). Ratified /s1 grill 2026-07-11.
> This is a **platform surface**, not a spine entity module — the `docs/moduo-module-contract.md` spine-wiring / MCP-tools / dashboard-widget checklist is **N/A** (see Out of scope).

## Scope

Turn Settings from a flat 9-item modal with two empty stubs and split-across-two-surfaces workspace management into a **complete, grouped, cohesive** settings surface. Keep it a **modal** (no new route). One /s1 (this doc) → a sequence of /s2 blocks.

The overhaul delivers: a **grouped nav** (Personal / Workspace / App); **two stub sections filled for real** (Preferences, Advanced); **API keys promoted** out of the nested workspace modal into their own first-class section; **workspace management inlined** (no more modal-in-modal); a **fuller Account** (email, log-out, change-password, delete-account); **Appearance regrouped** with an honest synced-vs-device story; **Billing kept minimal** (DF-3 absorbed); **Integrations cleaned** (inert Video meetings hidden, AI/MCP connector card added, dead `IntegrationsModal` deleted); and **About re-truthed** to cloud-first.

## Product behavior & UX

### Nav architecture — grouped, keep-modal

Settings stays a centered **modal** (`SettingsModal`, opened via `moduo:settings:open` / `⌘,` / palette / user menu). The `/settings` route keeps its dispatch-and-redirect pattern (DF-3's sticky pending-open buffer already makes `?section=` work on cold load); every section — including the new ones — must be reachable via `?section=<id>` and via a grouped nav.

**Grouped nav (labels: PERSONAL / WORKSPACE / APP):**

| Group | Sections (in order) |
| --- | --- |
| **Personal** | Account · Billing · Appearance · Preferences · Focus |
| **Workspace** | Workspace · Integrations · API keys |
| **App** | Advanced · About |

Group labels render as the standard eyebrow (`text-2xs font-medium uppercase tracking-wide text-muted-foreground` — the DF-18 spec; use inline if DF-18 hasn't extracted a component yet). "Log out" **moves out of the nav rail into the Account section** (see Account). The nav is a vertical list with group headers; the modal's two-pane shell (220px nav + scroll pane) is unchanged.

### Appearance — regroup + honest sync story

The 7 pickers (Theme, Shade, Accent, Font, Density, Radius, Tabs) regroup into three labeled clusters:

- **Color** — Theme · Shade · Accent
- **Type** — Font
- **Layout** — Density · Radius · Tabs

**Synced-vs-device messaging:** a one-line explainer at the top: *"Most appearance settings follow you across your devices. Density and tab style are set per device."* Density and Tabs each carry a subtle **"This device"** tag (a muted micro-label next to the picker title). No behavior change to the pickers themselves (DF-14 already de-tinted them). Theme keeps its System option.

*Definitive persistence (unchanged, just surfaced):* synced = theme/shade/accent/radius/font; device-local = density/tabs (textSize picker stays retired).

### Account — a real account surface (cloud users)

Today cloud users see only name + avatar. Add:

1. **Signed-in identity** — show the account **email** and sign-in provider (email / Google / magic-link) so you know who you're signed in as. Read-only.
2. **Log out** — the sign-out control moves here from the nav rail (a clearly-labeled button; same `signOut()` → `/auth`).
3. **Change password** — a form (`updateUser({ password })`). Shown for accounts with a password identity; magic-link/OAuth-only accounts see **"Set a password"** (same call) or a **"Send reset email"** affordance instead. Requires new-password + confirm; min-length validated; success/error inline (the section's existing pattern).
4. **Delete account** — a destructive, type-to-confirm flow (see Edge cases for the sole-owner rule). Sits in a visually-separated "Danger zone" block at the bottom.

The local-vault "Login key" card stays gated on `hasLocalMnemonic` (future lite only) — unchanged.

### Billing — keep minimal (DF-3 absorbed)

Stays its own top-level section under Personal, **Stripe-hosted-portal only, no in-app card UI** (ratified). DF-19 only polishes copy/plan display and confirms it reads well in the grouped nav. DF-3's `billing.ts` display logic + `create-portal-session` edge fn stay as-is. This resolves DF-3's "DF-19 refines later" note.

### Workspace — inline management (retire the modal-in-modal)

The real management UI (members list + role changes, invite-by-email + role, pending invites with copy/revoke, workspace rename, workspace delete) **moves inline** into Settings → Workspace. The standalone `WorkspaceSettingsModal` is **retired**; the top-bar workspace switcher's "workspace settings" entry point **repoints** to `dispatchOpenSettings({ section: "workspace" })`. "Add workspace" (with the `unlimited_workspaces` entitlement gate → UpgradeModal) stays. The **API-keys** part of that old modal moves to its own section (below), not into Workspace.

> **Coordination:** DF-24 (workspace membership loop) touches the same surfaces (member names from `profiles`, invite-redemption, leave/remove). DF-19's Workspace block and DF-24 **share files and must not run concurrently.** Recommended order: **DF-24 first** (fix the loop + member names), then DF-19 inlines the fixed UI; if DF-19 lands first, DF-24 rebases onto the inlined surface.

### API keys — own first-class section (Workspace group)

The MCP-connector API keys (workspace-scoped; MCP endpoint display; create-with-scope; secret-shown-once; revoke-with-confirm) move from the nested workspace modal into a **dedicated "API keys" section**. Presentation improves (clear "this is how your AI/agents reach this workspace" framing, endpoint copy, per-key last-used + scope). **Scope breadth:** today the create UI only sets `scopes.tasks`; extend to **per-module scope toggles for the modules the server actually enforces** (tasks + notes confirmed; contacts/calendar/links ride the shared lane — verify enforcement per module before exposing). Default new keys to view-only. Owner/admin only (unchanged). Full per-module enforcement hardening remains MCP-1's job — DF-19 must not expose a scope the server silently ignores.

### Integrations — clean + honest

- **Hide Video meetings** (Zoom / Google Meet). It is **inert**: the only references are the settings UI, the runtime binding, and the dead modal — nothing consumes a stored token (its intended consumer was a deferred booking API, CLEAN-1). Remove the "Video meetings" `<section>`; **keep** the Rust OAuth commands + `runtime.integrations` bindings (booking may revive it) — a DF-4-style hide, not a delete.
- **Add an AI / MCP connector card** — a card showing connection status (has ≥1 active key for this workspace?) + a button that jumps to the API-keys section. Makes "connect your AI" discoverable next to calendars/email.
- **Delete the dead `IntegrationsModal`** (`src/components/integrations-modal.tsx` + `.stories.tsx` + its state/mount in `app-chrome.tsx`). Unreachable (`setIntegrationsOpen(true)` is never called); its Zoom/Meet function is the same inert one being hidden. (Claims this from DF-17's cleanup lane.)
- Calendar + Email connect blocks stay (real, desktop-first) — restyled only for cohesion.

### Preferences (new — fill the stub for real)

A real Preferences section owning day-to-day behavior. Persisted to a **new synced `user_preferences.preferences` domain**:

1. **Notifications** — per-type toggles for the quiet set (mention · assigned-to-you · due/follow-up · task-unblocked): which reach your bell. Default **all on** (matches today's always-notify). *Gated on DF-9* — the toggles must actually suppress, so DF-9's generators read this pref. If DF-9 hasn't landed at execution, **hold just this sub-slice** (don't ship a lying control) and note it.
2. **Default landing view** — which surface opens on launch (Home / Tasks / Calendar / Notes / Contacts / Email / Last-used). The app-gate reads it on boot; explicit deep-links (`?section=`, `/p/:token`) still win.
3. **Startup & behavior** — reopen-last-workspace toggle; (desktop-only) confirm-before-quit. Kept light; platform-gate desktop-only rows.
4. **Sounds & motion** — a global sound toggle + a "reduce motion" override (`data-motion`: system/reduced/full, applied like the appearance data-attrs; layered on top of the OS `prefers-reduced-motion`).

### Advanced (new — fill the stub for real)

A real Advanced section, all client-side (no migration):

1. **Data export** — gather the workspace's data via existing runtime reads (tasks, notes `body_md`, contacts, calendar events, habits) → JSON files → **fflate** zip → download. User-initiated save of their own data.
2. **Reset local cache** — clear on-device caches (`moduo.*` localStorage, the notes IndexedDB outbox, and desktop redb caches), then reload. Cloud data untouched (re-syncs on reload). **Guard:** warn about / flush any unsynced notes outbox before clearing (data-loss footgun). Confirm-first.
3. **Diagnostics** — app version + build, platform (web/desktop), current sync status, and a "copy debug info" button (version + platform + workspace id + last-sync). Read-only.

*(No "experimental flags" — designer dropped it.)*

### About — cloud-first truth

Rewrite the stale local-first copy (*"a local-first workspace… Local Redb vault… running on your machine"*) to cloud-first truth. Add: **version + build** (+ "check for updates" hint on desktop), **legal + support links** (Privacy, Terms, Support/contact), and a **What's new** link (changelog). Storage line → cloud sync (Supabase), not "Local Redb vault".

## Edge cases

- **Delete account — sole owner of a shared workspace:** if the user solely owns a workspace that has other members, deletion is **blocked**. The flow surfaces the blocking workspace(s) and tells the user to hand off ownership or delete that workspace first. Sole-owner-of-solo-workspace (no other members) deletes cleanly with the account.
- **Delete account — confirmation:** type-to-confirm (type the account email or "DELETE"); irreversible; mirrors the DF-5 confirm-first grammar for non-restorable actions. No Undo.
- **Change password — no existing password (magic-link/OAuth account):** show "Set a password" instead of "Change password"; still `updateUser({ password })`.
- **Preferences → Notifications before DF-9:** if DF-9 unlanded, the Notifications sub-slice is held (not shipped as an inert toggle). The rest of Preferences ships.
- **Reset local cache with unsynced notes:** the notes outbox may hold un-pushed CRDT updates — warn and attempt a flush before clearing; if offline, block with "you have unsynced changes; reconnect first."
- **Data export while offline / partial failure:** export gathers per-module best-effort; a module that fails to read is noted in the bundle (a `_errors` manifest), never silently dropped.
- **API-keys scope beyond enforcement:** never expose a per-module scope toggle for a module whose server-side permission isn't enforced yet (would be a silent no-op / false-security). Verify per module; default to the enforced set.
- **Workspace inline vs the switcher:** the top-bar switcher must still reach workspace management after the modal is retired (repoint to `?section=workspace`); non-admins see a read-only roster (+ Leave, once DF-24 adds it), not a blank wall.
- **Deep-link to a new section id** (`?section=apikeys` / `preferences` / `advanced`) must resolve; `isSettingsSectionId` and the section registry must include the new/renamed ids.
- **Empty/loading/error states:** Billing already handles loading/error (keep). Account email shows a skeleton until auth resolves. Diagnostics "last sync" shows "—" when never synced.
- **Web vs desktop:** Integrations calendar/email connect are desktop-only (existing gating stays); confirm-on-quit is desktop-only; everything else works on both.

## Acceptance criteria

- **AC1 — Grouped nav.** Settings renders a grouped nav (Personal / Workspace / App) with the sections in the specified order; every section is selectable and deep-linkable via `?section=<id>`; Log out is in Account, not the nav rail.
- **AC2 — Appearance regroup + sync tags.** Appearance shows Color/Type/Layout groups; Density and Tabs are tagged "This device"; a one-line synced-vs-device explainer is present; pickers still write/read the same values.
- **AC3 — Account: email + log out.** The Account section shows the signed-in email + provider and a working Log out control.
- **AC4 — Account: change password.** A password account can change its password (validated new+confirm, min length); a passwordless account sees "Set a password"/reset instead; success/error surface inline.
- **AC5 — Account: delete account.** A user can delete their account via type-to-confirm; if they solely own a shared workspace, deletion is blocked with a clear list of what to resolve first; a clean sole-owner-of-solo-workspace deletes and lands on `/auth`.
- **AC6 — Billing minimal, absorbed.** Billing stays its own Personal section with plan + status + Manage-billing → Stripe portal (no in-app card UI); copy polished; no regressions vs DF-3.
- **AC7 — Workspace inlined.** Members/invites/roles/rename/delete render inline in Settings → Workspace; the standalone `WorkspaceSettingsModal` is retired; the top-bar switcher opens Settings → Workspace.
- **AC8 — API keys promoted.** API keys live in their own section (Workspace group) with endpoint + create-scope + secret-once + revoke-confirm; scopes cover the server-enforced modules; owner/admin-only preserved.
- **AC9 — Integrations cleaned.** Video meetings is hidden (Rust engine retained); an AI/MCP connector card links to API keys; the dead `IntegrationsModal` (+ stories + app-chrome wiring) is deleted.
- **AC10 — Preferences real.** Preferences persists (synced `preferences` domain) default-landing-view, startup/behavior, and sounds/motion; Notifications toggles ship only when DF-9 honors them (else held); landing-view drives the boot route (deep-links still win).
- **AC11 — Advanced real.** Advanced offers data export (zip download), reset-local-cache (guarded, cloud-safe), and diagnostics (version/build/sync/copy-debug).
- **AC12 — About truthful.** About reflects cloud-first storage; shows version/build, legal + support links, and a What's-new link; no "local-first"/"Local Redb vault" copy remains.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/settings/settings-events.test.ts` · "section registry incl. new ids" | AC1 | `isSettingsSectionId` accepts `apikeys`/`preferences`/`advanced`; `?section=` deep-link resolves each. |
| `src/features/settings/settings-nav.test.ts` · "grouped nav order" | AC1 | The nav groups + section order match the spec; Log out is not in the nav rail. |
| `src/lib/appearance.test.ts` · "synced vs device keys" | AC2 | `SYNCED_KEYS` = theme/shade/accent/radius/font; density/tabs never pushed to cloud. |
| `src/features/settings/appearance-groups.test.ts` · "picker grouping + device tags" | AC2 | Color/Type/Layout grouping maps the 7 pickers; Density+Tabs flagged device-local. |
| `src/features/settings/account.test.ts` · "identity + password affordance" | AC3, AC4 | Email/provider derived correctly; password vs passwordless picks change-vs-set; validation rejects short/mismatched. |
| `supabase/functions/delete-account` · "sole-owner block logic" (pure helper `blockingWorkspaces`) | AC5 | Given membership rows, returns the shared workspaces the user solely owns (empty when safe). |
| `src/features/settings/delete-account.test.ts` · "confirm gating" | AC5 | The delete button is disabled until the typed confirmation matches. |
| `src/features/settings/billing.test.ts` · (existing) | AC6 | Plan label + subscription line + trialing hint (kept green). |
| `src/features/settings/workspace-inline.test.ts` · "management surface renders inline" | AC7 | Members/invites/roles/delete render without the standalone modal; non-admin gets read-only roster. |
| `src/features/settings/api-keys.test.ts` · "scope mapping" | AC8 | Scope toggles map to a `scopes` object covering only enforced modules; default view-only. |
| `src/features/settings/integrations.test.ts` · "video hidden, ai card present" | AC9 | The Video-meetings block is absent; the AI/MCP card renders + links to `?section=apikeys`. |
| `src/lib/prefs-sync.test.ts` · "preferences domain reconcile" | AC10 | The new `preferences` domain round-trips through push/reconcile LWW. |
| `src/features/settings/preferences.test.ts` · "defaults + landing resolution" | AC10 | Notifications default all-on; landing-view resolves to a valid route; deep-link precedence. |
| `src/features/settings/data-export.test.ts` · "bundle shape + error manifest" | AC11 | `buildExportBundle` includes each module; a failed read lands in `_errors`, not dropped. |
| `src/features/settings/reset-cache.test.ts` · "keys to clear" | AC11 | The clear list covers `moduo.*` + the notes outbox; cloud tables are never in scope. |
| `src/features/settings/about.test.ts` · "no local-first copy" | AC12 | About strings contain no "local-first"/"Redb vault"; version/legal/what's-new present. |
| Storybook: `settings-modal.stories.tsx`, `appearance-section.stories.tsx`, per new section | AC1,2,3,9,11,12 | Visual/token compliance for the grouped nav + rebuilt sections (Chromatic/Playwright). |

*Delete-account and data-export full round-trips are **manual** (test-account, not the default gate) — see Manual-test surfaces.*

## Assumptions & technical decisions

*(Decided by research, not asked. Durable ones also go to `docs/decisions.md`.)*

1. **Surface = modal, not a route** (ratified). Keep the `/settings` dispatch-and-redirect + DF-3 sticky-open buffer; no new top-level route (honors CLAUDE.md rule #7 + route convergence). Extend the section registry (`SETTINGS_SECTION_IDS`) with `apikeys`, and keep `preferences`/`advanced`.
2. **Grouped nav is presentational** — a `GROUPS: {label, ids[]}[]` map drives the nav; the section registry/components are otherwise unchanged. Labels use the DF-18 eyebrow spec (inline until extracted).
3. **New `user_preferences.preferences` jsonb domain** (synced) via a migration adding `preferences jsonb` + `preferences_updated_at`, plus extending `prefs-sync.ts` `SyncDomain` + `META_KEY`. **One** domain holds notifications/landing/startup/sounds/motion (fewer columns, one LWW lane). Rationale: mirrors the existing appearance/focus domains; avoids per-setting columns. Rejected: a separate `notifications` column (unneeded churn).
4. **Change password** = `supabaseClient.auth.updateUser({ password })` on the live session (no current-password re-entry — Supabase doesn't require it for an authenticated session; note this in copy). Passwordless accounts: same call framed as "Set a password", plus `resetPasswordForEmail` fallback. Rejected: a custom edge fn (unnecessary).
5. **Delete account = a new service-role edge function** `delete-account` (`verify_jwt: true`; reads the caller's JWT; computes blocking workspaces; if none, `auth.admin.deleteUser` + cascade-delete owned solo workspaces + null/detach memberships). A pure `blockingWorkspaces(memberships)` helper is unit-tested; the cascade is exercised manually. Rationale: a client can't delete its own auth user or cascade safely; service-role is required. Sole-owner-of-shared → **blocked** (ratified).
6. **Data export = client-side** gather via existing `runtime` list ops → JSON → **fflate** zip (already a dep from NO-8) → browser download. No backend. Scope v1: tasks, notes (`body_md`), contacts, calendar events, habits; `_errors` manifest for partial failures.
7. **Reset local cache = client-side** clear of `moduo.*` localStorage + the notes IndexedDB outbox (+ desktop redb caches via a runtime op if present) then `location.reload()`. Flush/guard the notes outbox first (unsynced-CRDT footgun → `docs/gotchas.md`).
8. **Diagnostics** reads a build-time version/build define (add one to the rsbuild config if absent) + platform (`__TAURI_INTERNALS__`) + the prefs-sync/last-sync meta. Read-only.
9. **API keys** relocate the existing `ApiKeysSection` into `sections/api-keys-section.tsx`; keep `runtime.workspace.{getMcpEndpoint,listApiKeys,createApiKey,revokeApiKey}`. Extend the create UI's scope object beyond `tasks` to the **verified-enforced** modules only (research each against the connector's permission checks before exposing). Full enforcement = MCP-1.
10. **Workspace inline** lifts the body of `WorkspaceSettingsModal` into the Workspace section (same `runtime.workspace` ops); deletes the standalone modal + its two mount points (`app-chrome.tsx`, `workspace-section.tsx`); repoints the switcher entry to `dispatchOpenSettings({section:"workspace"})`. **Sequence with DF-24** (shared files).
11. **Video meetings hide** = remove the UI `<section>` only; retain Rust `integration_*` commands + `runtime.integrations` (DF-4 pattern). **Dead `IntegrationsModal` delete** claimed here (was DF-17).
12. **Spine-wiring / MCP-tools / dashboard-widget = N/A** — Settings is a global platform surface, not a spine entity. The module-contract "done" checklist doesn't apply; this assumption satisfies the DoR module-feature line as a deliberate exception.
13. **Design:** tokens-only, shadcn-wrapped primitives (Dialog/Tabs/Switch/Select/Input/Button/Card/Badge), R5 (pickers already de-tinted by DF-14; the danger-zone destructive button follows the DF-5 grammar), R6 motion tokens, R1/R2/R3 no-hex/no-arbitrary/no-inline. Grouped-nav labels + section eyebrows follow DF-18.

## Execution blocks

Sub-blocks of the single BUILD_ORDER `DF-19` line. Sequence by dependency; **DF-19a is the backbone**. Each is context-sized and self-contained (a fresh session can resume from this spec + `docs/decisions.md`).

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| DF-19a | **Settings shell: grouped nav + registry** | Grouped nav (Personal/Workspace/App), `apikeys` section id, deep-link parity, Log-out relocation hook, keep-modal | AC1 | — |
| DF-19b | **Appearance regroup + sync tags** | Color/Type/Layout groups, "This device" tags, explainer | AC2 | DF-19a |
| DF-19c | **Account: identity + log-out + change-password** | Email/provider, Log out in Account, change/set-password | AC3, AC4 | DF-19a |
| DF-19d | **API keys section** | Relocate `ApiKeysSection` to its own section + present + enforced-scope breadth | AC8 | DF-19a |
| DF-19e | **Workspace management inlined** | Members/invites/roles/rename/delete inline; retire modal; repoint switcher | AC7 | DF-19a, DF-19d (keys already moved); **coordinate w/ DF-24** |
| DF-19f | **Preferences (new)** | `preferences` domain + migration; landing-view, startup, sounds/motion; Notifications gated on DF-9 | AC10 | DF-19a; Notifications sub-slice ⟶ DF-9 |
| DF-19g | **Advanced (new)** | Data export (zip), reset-cache (guarded), diagnostics | AC11 | DF-19a |
| DF-19h | **Delete account** | `delete-account` edge fn + sole-owner block + type-to-confirm Danger zone | AC5 | DF-19c |
| DF-19i | **Copy + Integrations cleanup** | About cloud-first (version/legal/what's-new); Billing copy polish; hide Video; AI/MCP card; delete dead `IntegrationsModal` | AC6, AC9, AC12 | DF-19a |

**Cuttable if effort must shrink (in order):** DF-19h (delete-account — heaviest, its own edge fn) → DF-19f Notifications sub-slice (if DF-9 unlanded) → DF-19g data-export. The backbone + Account + API-keys + Workspace-inline + Integrations-cleanup + About are the core.

## Out of scope

- **New top-level route** for Settings (stays a modal).
- **In-app card / payment UI** — Stripe hosted portal only (ratified DF-3/DF-19).
- **Full per-module MCP scope enforcement** — DF-19 only exposes already-enforced scopes; hardening is **MCP-1**.
- **Invite-redemption / member-names / leave-remove** — **DF-24** (DF-19 only inlines the existing management UI).
- **Notification generation** — **DF-9** (DF-19 only adds the per-type preference the generators read).
- **Calendar/email prefs cloud sync** — still localStorage-only (CAL-4/6 territory), untouched here.
- **Light-mode tuning, mobile/tablet** — per CLAUDE.md global out-of-scope.
- **Spine wiring / MCP tools / dashboard widget** — N/A for a platform surface (Assumption 12).
- **Experimental-flags shelf in Advanced** — designer dropped it.
- **Reviving Video meetings / booking** — hidden, engine retained; revival is separate.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous.
- [x] **Every AC has ≥1 test** with a plain-English note (table above).
- [x] **Open questions empty** — every product question answered (4 grill rounds), every technical unknown researched and recorded under Assumptions.
- [x] **Data model named + Supabase-first** — new `user_preferences.preferences` jsonb (+`_updated_at`) migration; new `delete-account` edge fn; existing `workspace_api_keys` / `user_entitlements` reused. No other new tables.
- [x] **Module-feature spine wiring** — **N/A, deliberate exception** (Assumption 12): Settings is a platform surface, not a spine entity; no links/attach/drag/@mention/notifications-target/activity/tags/MCP-tools/widget apply.
- [x] **Execution blocks** decomposed (DF-19a…i), sequenced, context-sized, self-contained, with a documented cut order.
- [x] **Design constraints acknowledged** — tokens-only, shadcn-wrapped primitives, DF-14 selection/de-tint already landed, DF-5 destructive grammar for the Danger zone, DF-18 eyebrow for group labels, R1/R2/R3/R5/R6.
- [x] **Manual-test surfaces identified** (below).

**Ready to execute.**

### Manual-test surfaces (for `docs/testing/<branch>.md`)

- Settings modal on **web** and **desktop**: open via `⌘,`, palette, user menu, and `?section=` deep-links (each section + group).
- Appearance: change a synced picker on one device, confirm it follows; change Density/Tabs, confirm it stays device-local; verify the tags + explainer read right.
- Account: email/provider correct; Log out works; change-password (password acct) + set-password (magic-link acct); **delete-account** on a **throwaway test account** — both the sole-owner-blocked path and a clean solo-workspace delete.
- Workspace: inline members/invites/roles/rename/delete; switcher opens Settings → Workspace; non-admin read-only roster.
- API keys: create (scoped) → secret-once → copy → revoke-confirm; endpoint copy; a keyed MCP read/write round-trip (fold into MCP-1).
- Integrations: Video meetings absent; AI/MCP card links to API keys; calendar/email connect still work on desktop.
- Preferences: landing-view drives the boot route; sounds/motion toggles apply; Notifications toggles (only if DF-9 landed) actually suppress.
- Advanced: data export downloads a valid zip; reset-cache clears + reloads without touching cloud data (and blocks/flushes on an unsynced outbox); diagnostics show version/build/sync.
- About: no local-first copy; version/legal/what's-new present.

## Open questions

- [ ] (none)
