# Manual test checklist — DF-4 hide Mindmap for alpha

> Generated 2026-07-10 · branch `t/maciej/df-4-hide-mindmap` · **Live-verified:** yes — nav, palette, ⌘-shortcuts, direct `/mindmap` load, and the placeholder removal were all confirmed on the hosted test account (web dev server). Everything below is confirmation, not first-discovery.

## Top-bar nav
- [ ] **Do:** Open the app and look at the top module tabs → **Expect:** exactly six tabs — Home, Notes, Tasks, Calendar, Email, Contacts. **No "Mindmap" tab.** _(both)_
- [ ] **Do:** Hover each tab and read the tooltip/aria shortcut hint → **Expect:** Home ⌘1, Notes ⌘2, Tasks ⌘3, Calendar ⌘4, **Email ⌘5, Contacts ⌘6** (Email/Contacts shifted down one from before). _(both)_

## Keyboard shortcuts (desktop / Tauri — ⌘1..6; on web the browser may intercept ⌘number)
- [ ] **Do:** Press ⌘5 → **Expect:** navigates to Email. _(desktop)_
- [ ] **Do:** Press ⌘6 → **Expect:** navigates to Contacts. _(desktop)_
- [ ] **Do:** Press ⌘7 → **Expect:** nothing happens (there is no 7th module; the shortcut was removed, not left dangling). _(desktop)_

## Command palette
- [ ] **Do:** Open the command palette (⌘K) and read the "Navigate" group → **Expect:** Open Home / Notes / Tasks / Calendar / Email / Contacts. **No "Open Mindmap".** _(both)_
- [ ] **Do:** Type "mindmap" in the palette → **Expect:** no navigate result for it (route still reachable by URL, just not surfaced). _(both)_

## Mindmap route still reachable (kept for the post-Email/Dashboard rethink)
- [ ] **Do:** Navigate directly to `/mindmap` (type the URL / paste a deep link) → **Expect:** the Mindmap page loads and **stays** on `/mindmap` — it is NOT bounced to Home. _(both)_
- [ ] **Do:** On `/mindmap`, look at the right panel → **Expect:** it reads a neutral **"Details panel"**, NOT the old leaked dev string "Graph relations tree, feature coming soon." _(both)_
- [ ] **Do:** On `/mindmap`, toggle the left/right panel buttons in the bottom bar → **Expect:** they act on the mindmap layout (its `routeToFeatureLayout` entry is intact — panel state doesn't leak into another module). _(both)_

## Edge cases
- [ ] **Do:** Navigate to a genuinely unknown route, e.g. `/nope` → **Expect:** still bounced to the first nav tab (Home) — the redirect guard only exempts `/mindmap` + `/settings`, it didn't go permissive. _(both)_
- [ ] **Do:** With a workspace where the Notes or Tasks permission is limited, re-check the tab count → **Expect:** permission filtering still works; the ⌘N shortcuts map to whatever tabs remain visible, in order, with no dead shortcut. _(both)_

## Known gaps / not-yet-testable
- ⌘number shortcuts collide with the browser's tab-switch shortcuts on the web dev build (by design — moduo is Tauri-first). Verify the ⌘5/⌘6/⌘7 items on the desktop build; on web the in-app event wiring was verified programmatically instead.
- No automated test covers the app-chrome redirect guard, so the "`/mindmap` stays reachable" behavior is guarded only by this manual check + the live verification done in-session.
