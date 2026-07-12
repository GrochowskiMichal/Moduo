# Manual test checklist — DF-19i Settings: About copy + Integrations cleanup

> Generated 2026-07-12 · branch `t/maciej/df-19i-about-integrations` · **Live-verified:** yes — About + Integrations + the AI/MCP→API-keys jump all confirmed on the hosted account `grzywaczmj+moduo-s2-test` (web dev server). Desktop-only rows verified on web as "Desktop only"/hidden; the desktop update hint + system-browser link handoff were not exercised on a real desktop build — see Known gaps.
> Run top-to-bottom; check off as you go. Each item is step → what you should see → where.

## About — cloud-first truth + version/links (AC12)
- [ ] **Do:** Open Settings (`⌘,` / avatar menu / ⌘K palette → "Settings") → **App** group → **About**. → **Expect:** header "About — Moduo — a cloud-first workspace."; a card titled "moduo" with the tagline "Notes, tasks, calendar, email, and contacts — synced across web and desktop, in one window." _(both)_
- [ ] **Do:** Read the detail grid. → **Expect:** **VERSION** = `1.0.0 · build <short-git-sha>` (e.g. `1.0.0 · build f7f0bc0`), **STORAGE** = "Cloud sync (Supabase)", **RUNTIME** = "Web & desktop (Tauri 2) · React 19". No "local-first", "Local Redb vault", or "running on your machine" copy anywhere. _(both)_
- [ ] **Do:** Look under Version **on desktop**. → **Expect:** a muted hint "Updates install when you download the latest build." _(desktop only — absent on web)_
- [ ] **Do:** Look at the link row at the bottom of the card. → **Expect:** four links — **What's new · Privacy · Terms · Support**. _(both)_
- [ ] **Do:** Click each link. → **Expect:** opens `https://moduo.app/{changelog,privacy,terms,support}` — on **desktop** in your system browser (not the app window), on **web** in a new tab. _(both)_

## Integrations — Video gone, AI/MCP added (AC9)
- [ ] **Do:** Open Settings → **Workspace** group → **Integrations**. → **Expect:** header "Integrations — Connect your calendars, email, and AI assistants." (no "video meeting tools"). _(both)_
- [ ] **Do:** Scroll the whole section. → **Expect:** **no "Video meetings" card** (no Zoom / Google Meet). Sections present: Calendar, Email, **AI & MCP**. _(both)_
- [ ] **Do:** Read the **AI & MCP** card. → **Expect:** "Connect Claude and other AI assistants to this workspace over MCP…"; a row "AI assistants (MCP)" with a status subtitle and a button. With **no active keys** the subtitle reads "Not connected" and the button reads **"Set up"**; with ≥1 active key it reads "N active key(s)" and **"Manage keys"**. _(both)_
- [ ] **Do:** Click the AI/MCP button ("Set up" / "Manage keys"). → **Expect:** the modal switches to the **API keys** section (nav highlights "API keys", MCP endpoint + key list shown) — no page reload. _(both)_
- [ ] **Do:** Calendar + Email cards. → **Expect:** unchanged — on web they show "Desktop only"; on desktop they connect as before. _(both)_

## Edge cases
- [ ] **Do:** Open Integrations as a **non-admin** member (or with a workspace whose keys you can't read). → **Expect:** the AI/MCP card shows a neutral subtitle "Manage keys to connect your AI assistants" (never a false "Not connected"); the button still jumps to API keys. _(both)_
- [ ] **Do:** Confirm the old dead **IntegrationsModal** is truly gone — there is no chrome that opens a standalone Zoom/Meet dialog. → **Expect:** nothing references it; the only integrations UI is Settings → Integrations. _(both)_

## Migrations / data
- [ ] None. DF-19i is UI + build-config only — no schema changes. (Rust `integration_*` commands and `runtime.integrations` bindings are **retained**, just no longer surfaced in the UI.)

## Known gaps / not-yet-testable
- **Desktop-only paths verified indirectly.** The "check for updates" hint and system-browser link handoff (`runtime.window.openExternalUrl`) were confirmed in code + on web (web uses `window.open`), but not exercised on a packaged desktop build this session.
- **Build id is the git short SHA at build time.** On the hosted web dev server it rendered `build f7f0bc0` (matching HEAD). A CI build can override it via the `MODUO_BUILD` env var; a git-less build degrades to `build dev`.
- The AI/MCP "active key" count reuses `runtime.workspace.listApiKeys` (filters `revoked_at IS NULL`); on the test account all probe keys are revoked, so it correctly showed "Not connected" / "No keys yet."
