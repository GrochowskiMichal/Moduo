# Manual test checklist — DF-16 dead-chrome + copy sweep

> Generated 2026-07-11 · branch `t/maciej/df-16-dead-chrome` · **Live-verified:** partial (web, hosted account) — all interactive surfaces confirmed on web except Email compose (desktop-only) and the paywall Free card (behind an active-trial gate). See Known gaps.

Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Per-module ⌘N / bottom-bar "+" create
- [ ] **Do:** On **Home**, press ⌘N (or click the "+" in the bottom bar) → **Expect:** the "Capture a task…" box in the Quick-capture widget gets focus (cursor blinking, ready to type). Type + Enter drops a task into the Inbox. _(both — needs the Quick-capture widget on the board)_
- [ ] **Do:** On **Tasks**, press ⌘N / "+" → **Expect:** the task capture opens (unchanged from before). _(both)_
- [ ] **Do:** On **Notes**, press ⌘N / "+" → **Expect:** a new root note is created (unchanged from before). _(both)_
- [ ] **Do:** On **Calendar**, press ⌘N / "+" → **Expect:** a quick-create "ghost" event appears on **today's** column at the current time (a 30-min block), popover open with the title field focused; type a title + Enter saves, Esc discards. If today isn't in the visible range, it seeds the first visible day at 9:00. _(both)_
- [ ] **Do:** On **Contacts**, press ⌘N / "+" → **Expect:** the "New contact" dialog opens directly. _(both)_
- [ ] **Do:** On **Email** (desktop, with an account connected), press ⌘N / "+" → **Expect:** a blank compose draft opens. _(desktop — see Known gaps for web)_
- [ ] **Do:** As a **view-only** member, press ⌘N on Calendar/Contacts → **Expect:** nothing happens (no dialog, no error) — create is edit-gated. _(both)_

## Global keyboard-shortcuts help sheet
- [ ] **Do:** From any non-email page, press **?** → **Expect:** a "Keyboard shortcuts" dialog opens listing ⌘K, ⌘N, ⌘⇧N, ⌘,, ⌘⇧W, ⌘/, ?, and ⌘1–⌘6 with descriptions. _(both)_
- [ ] **Do:** Click the **keyboard icon** (leftmost button in the bottom bar) → **Expect:** the same shortcuts sheet opens. Its tooltip reads "Keyboard shortcuts (?)". _(both)_
- [ ] **Do:** On **/email**, press **?** → **Expect:** the EMAIL triage shortcut legend opens (j/k/e/r/…), NOT the global sheet — email keeps its own. _(desktop; on web /email press ? on the tissue view — still email's legend if a thread list is focusable)_
- [ ] **Do:** Type **?** inside a text field / editor → **Expect:** a literal "?" is typed; no dialog opens. _(both)_

## Workspace identity at 1 workspace
- [ ] **Do:** With a single workspace, look at the top-left → **Expect:** the workspace avatar + name + chevron are shown (previously the top-left was empty). _(both)_
- [ ] **Do:** Press **⌘⇧W** (or click the switcher) → **Expect:** the dropdown opens showing your workspace, a settings gear, and Create/Join affordances — but **no trash/delete** icon on the only workspace. _(both)_
- [ ] **Do:** Add a second workspace, reopen the switcher → **Expect:** the delete (trash) affordance now appears per row; type-to-confirm still gates the actual delete. _(both)_

## Command palette (permission filter)
- [ ] **Do:** Press ⌘K → **Expect:** the "Navigate" group lists exactly the modules you can access (Home always; Notes/Tasks/Calendar appear only if you have Notes/Tasks access — Calendar rides the Tasks lane; Email/Contacts always). This mirrors the top-bar nav exactly. _(both)_
- [ ] **Do:** With ⌘K open, type a query (e.g. a task/note title) → **Expect:** entity results still appear grouped (Tasks/Notes/Contacts…) and deep-link on select — DF-10 search is unaffected. _(both)_

## Copy (cloud-first)
- [ ] **Do:** Settings → **About** → **Expect:** "Moduo — a cloud-first workspace", "synced across web and desktop", Storage = "Cloud sync (Supabase)", Runtime = "Web & desktop (Tauri 2) · React 19". No "local-first" / "running on your machine" / "Local Redb vault". _(both)_
- [ ] **Do:** Trigger the paywall (let the trial expire, or the SubscriptionGate) → **Expect:** the Free card reads "Web & desktop" with bullets "Notes, tasks, calendar & contacts / Access on web & desktop / Cloud sync across devices / 7-day Pro trial, no card required" — no "Local-only" / "No cloud features" / "Desktop app only". _(both — see Known gaps)_

## Edge cases
- [ ] **Do:** Open the shortcuts sheet, then press Esc → **Expect:** it closes; pressing ? reopens it. _(both)_
- [ ] **Do:** Have a delete-confirm panel open for one of two workspaces, then get removed from the OTHER workspace by a teammate (list drops to 1) → **Expect:** the delete panel collapses and the confirm can't fire — you can never reach a zero-workspace state. _(both — hard to stage; logic-guarded)_
- [ ] **Do:** On Calendar at ~23:5x, press ⌘N → **Expect:** the ghost clamps to a valid end-of-day block (no inverted/zero-length event). _(both)_

## Migrations / data
- None. This block is UI/chrome + copy only — no schema or data changes.

## Known gaps / not-yet-testable
- **Email compose "+":** verified only that the listener is wired and no-ops cleanly on web (web has no IMAP account; `startNew` returns early). The actual compose draft opening needs the **desktop app with a connected account** — verify there.
- **Paywall Free card copy:** verified by code inspection + typecheck only; the paywall page sits behind the SubscriptionGate and the hosted test account's trial is active, so it wasn't rendered live. The About copy (same kind of static edit) DID render correctly live, giving high confidence.
- **Palette permission-hiding branch:** the hosted account has full permissions, so all 6 modules show. The "hide a module the user can't access" path is logic-verified (mirrors `app-chrome.tsx`'s already-live nav filter) but not exercised live — would need a view-restricted workspace member.
- **`?`-key delivery:** the matcher accepts both `key==='?'` and `shiftKey && key==='/'` after the automation tool delivered the latter; on a real US keyboard either form works.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
