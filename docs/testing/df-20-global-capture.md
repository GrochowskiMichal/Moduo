# Manual test checklist — DF-20 Global capture command bar

> Generated 2026-07-11 · branch `t/maciej/df-20-global-capture` · **Live-verified:** yes (hosted account, web) — every route created + read back on its module page; ⌘⇧K + mutual-exclusion confirmed. Desktop unverified (same web runtime; see Known gaps).

## Opening the capture bar
- [ ] **Do:** Press **⌘⇧K** from anywhere (Home, Tasks, mid-typing in a note) → **Expect:** a centered capture dialog opens, placeholder "Capture anything…", four chips (Task active, Note /note, Event /event, Contact /contact), hint "Enter to capture · a plain line makes a task". _(both)_
- [ ] **Do:** Press ⌘⇧K again while it's open → **Expect:** it toggles closed. _(both)_
- [ ] **Do:** Click the **compose (Quick capture)** icon in the bottom bar (between Search and +) → **Expect:** the same dialog opens; tooltip reads "Quick capture (⌘⇧K)". _(both)_
- [ ] **Do:** Open the shortcuts help sheet (`?`) → **Expect:** a "Quick capture (task by default; /note /event /contact)" row with ⌘⇧K. _(both)_

## Capture a task (default)
- [ ] **Do:** Open capture, type `buy milk tomorrow 4pm`, press Enter → **Expect:** toast "buy milk | scheduled <tomorrow>, 4:00 PM · Inbox | Open"; dialog closes; the date is stripped from the title. _(both)_
- [ ] **Do:** Click the toast's **Open** → **Expect:** lands on Tasks; the task is in the **Inbox**, scheduled for tomorrow 4pm. _(both)_
- [ ] **Do:** Capture a plain `walk the dog` (no date) → **Expect:** toast "…| Added to Inbox"; task appears in Inbox unscheduled. _(both)_

## Route prefixes
- [ ] **Do:** Type `/note Design review` → **Expect:** the active chip flips to **Note** as you type; Enter → toast "Design review | Added to Notes | Open"; the note appears in Notes. _(both)_
- [ ] **Do:** Type `/event sync with Sam tomorrow 2pm` → **Expect:** chip flips to **Event**; Enter → toast "sync with Sam | <tomorrow>, 2:00 PM | Open"; a 60-min timed event lands on the calendar at 2pm. _(both)_
- [ ] **Do:** Type `/event standup friday` (date only, no time) → **Expect:** an **all-day** event on Friday. _(both)_
- [ ] **Do:** Type `/event coffee` (no date) → **Expect:** a 60-min event at the **next full hour** today. _(both)_
- [ ] **Do:** Type `/contact Ada Lovelace` → **Expect:** chip flips to **Contact**; Enter → toast "Ada Lovelace | Added to Contacts | Open"; the contact appears in Contacts. _(both)_
- [ ] **Do:** Click a chip (e.g. **Note**) while text is already typed → **Expect:** the `/note ` prefix is inserted and your typed body is preserved. _(both)_

## Mutual exclusion with the search palette
- [ ] **Do:** Open the ⌘K search palette, then press ⌘⇧K → **Expect:** the palette closes and only the capture bar is open (never two stacked dialogs). _(both)_
- [ ] **Do:** Open the capture bar, then press ⌘K → **Expect:** the capture bar closes and only the search palette is open. _(both)_

## Edge cases
- [ ] **Do:** Type `/groceries eggs` (unknown slash word) → **Expect:** it stays a **Task** with the literal title "/groceries eggs" (only /note /event /contact /task route). _(both)_
- [ ] **Do:** Open capture and press Enter on an empty line → **Expect:** nothing happens (no empty entity). _(both)_
- [ ] **Do:** As a **view-only** member of Tasks or Notes, select that route → **Expect:** the chip is disabled and the hint reads "You have view-only access to …s"; Enter is blocked with a toast. _(both — needs a viewer test member)_
- [ ] **Do:** As a **view-only** member, capture a `/contact` (Contacts is ungated client-side, so the chip is enabled) → **Expect:** the server rejects it and the toast reads the friendly "You have view-only access to contacts." (not a raw server error); the dialog stays open with your text + focus intact. _(both — verified via a forced 403 intercept)_
- [ ] **Do:** Trigger a capture on a failing write that ISN'T a permission error (e.g. a validation failure) → **Expect:** the toast shows the real server message (not the "view-only" copy); the dialog stays open, input keeps focus so you can retry. _(both)_

## Known gaps / not-yet-testable
- **Desktop (Tauri) not exercised** — verification ran on the web dev server against the hosted account. Both platforms share the same web runtime write paths (`notesV2.create`, `calendar.createEvent`, `contacts.createContact`, tasks `seedInbox`+`upsertTask`), so behavior should match; a desktop smoke of ⌘⇧K + one task capture is worth a glance.
- **The client-side disabled-chip UI** (Tasks/Notes view-only member) wasn't seen against a real viewer member — the hosted test account owns its workspace (edit on all lanes), so all chips were enabled. The gate itself is unit-tested (`canWriteRoute`). The *server-denied* contacts path + friendly-error mapping WAS live-verified (forced 403 intercept → "You have view-only access to contacts.").
- **Verification artifacts left on the hosted account:** "DF-20 verify plain capture" + "DF-20 post-fix smoke task" (Inbox tasks), "DF-20 verify note capture" (note), "DF-20 sync with Sam" (event), "Ada Lovelace DF20" + "Grace Hopper DF20-errmap" (contacts) — throwaway, safe to delete. ("Denied Person" was rejected by the intercept, never created.)

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
