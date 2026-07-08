# Manual test checklist — Calendar CAL-4 (the loop) + CAL-5 (focus timer)

> Generated 2026-07-02 · branch `claude/trusting-shirley-e14fa6` · **Live-verified: yes (web, hosted account)** — the strip, elapsed treatment, triage popover, Review sub-state, Move-to-today + Undo, and the focus start/stop were all exercised end-to-end on the hosted test account with zero console errors on a clean mount. This checklist is confirmation, not first-discovery.
>
> No migration in this pack — the loop rides shipped Tasks ops (`reschedule`/`unschedule`/`set_status`/`addTimeSpent`). Nothing to deploy.
>
> **Seeding "elapsed":** the loop needs an OPEN task scheduled earlier today (its block-end passed). Fastest seed: drag a backlog task from the right panel onto a slot BEFORE now (or use capture "today 9am"), then wait past its end. The hosted account's recurring "Water plants" (9:00 today) is a ready-made elapsed block after ~09:30 local.

## The strip (AC9)
- [ ] **Do:** open `/calendar` with at least one open task scheduled earlier today (or in the last 7 days) whose time has passed → **Expect:** a quiet line above the grid: "· N unfinished from earlier" with **Move to today** and **Review** — muted, never red, no card. _(web / desktop)_
- [ ] **Do:** with NO past-due open tasks → **Expect:** no strip line at all (it only renders when non-empty). _(both)_
- [ ] **Do:** click **Move to today** → **Expect:** each unfinished block relocates to the next free slot after now within working hours (skipping events/other blocks); toast "Moved N to today · Undo" (or "N moved · M didn't fit" when the day is full). _(both)_
- [ ] **Do:** click **Undo** on that toast → **Expect:** every moved block returns to its original time; the strip reappears. _(both)_
- [ ] **Do:** click **Review** → **Expect:** the right panel (Tasks view) grows an "Unfinished from earlier (N)" section at the top: each row a checkbox (included) · title · origin ("Thu, Jul 2 · 9:00 AM · 30m") · a remove (×), plus a "Move N to today" button and a close (×). The normal Today/Due-soon/Backlog groups stay below. _(web)_
- [ ] **Do:** in Review, untick one item, then "Move N to today" → **Expect:** only the ticked items move; the count on the button reflects the ticked subset. _(web)_
- [ ] **Do:** in Review, drag a row onto the grid → **Expect:** it schedules at the drop slot (the universal drag contract, same as the Tasks-view rows). _(web)_

## Elapsed-block triage (AC8)
- [ ] **Do:** find an open block whose end has passed (today or earlier this week) → **Expect:** the chip takes a quiet dashed/desaturated "elapsed" treatment. Events and done blocks never do. _(both)_
- [ ] **Do:** click that block → **Expect:** its popover shows **Later today · Took longer · Remove** (plus the checkbox = Done, and Open). _(both)_
- [ ] **Do:** on a TALL elapsed block (≥ ~55 min rendered), look at the chip itself → **Expect:** an inline "Later · Longer · Remove" row inside the block (short blocks defer these to the popover). _(both)_
- [ ] **Do:** **Later today** → **Expect:** the block jumps to the next free slot after now; toast "Moved to HH:MM · Undo". If the day is full: toast "No open slot left today — it's waiting in the strip below" and the block stays put. _(both)_
- [ ] **Do:** **Took longer** → **Expect:** toast "+Nm logged · kept open · Undo"; the block dims with a clock glyph (a "worked" state), the task stays OPEN and on the grid, its tracked time increased by the block's planned span, and it leaves the strip. Undo removes exactly that logged time. _(both)_
- [ ] **Do:** **Remove** → **Expect:** the block leaves the grid (task unscheduled, otherwise untouched); toast "Removed from the calendar · Undo". Undo re-schedules it to its old time. _(both)_
- [ ] **Do:** **Done** (checkbox or popover) on an elapsed recurring block → **Expect:** completes in place; recurrence pointer advances (same as completing in Tasks). _(both)_

## Focus timer (CAL-5, AC10)
- [ ] **Do:** open the popover of a current-ish block (elapsed, or starting within the hour) → **Expect:** a **Start focus** button. A far-future block has none. _(both)_
- [ ] **Do:** click **Start focus** → **Expect:** the block grows a `primary` leading edge + a live "MM:SS" readout that counts up; the popover shows the readout with **Pause** and **Stop**. _(both)_
- [ ] **Do:** **Pause** then **Resume** → **Expect:** the clock freezes on pause and continues from where it left off on resume (no reset). _(both)_
- [ ] **Do:** **Stop** → **Expect:** toast "Nm logged to <task>" (or "Less than a minute logged to …"); the readout/edge clear; the task's tracked total (Tasks detail → time) increased by the focused duration. _(both)_
- [ ] **Do:** start focus on block A, then start focus on block B → **Expect:** A's session stops quietly (its time banked to A) and B's begins; only one live readout at a time. _(both)_
- [ ] **Do:** focus a block, then leave the tab in the background for a while and return → **Expect:** the readout shows the true elapsed time AND Stop logs that same amount (accrual is wall-clock, not throttled 1 Hz ticks — the persisted total matches what you saw). _(web)_

## Edge cases
- [ ] **Do:** a block scheduled 23:45 on a PAST day (spans past midnight) → **Expect:** it still shows the elapsed treatment / offers triage (past-day fallback treats every open block as elapsed). _(both)_
- [ ] **Do:** view-only member (or a workspace where you lack edit) → **Expect:** the strip shows the count but not the action buttons; the in-grid triage row and popover triage/Start-focus are absent; nothing mutates. _(both)_
- [ ] **Do:** DST week (spring-forward / fall-back), "Move to today" or "Later today" → **Expect:** placements land at correct wall-clock times (gap-finder resolves working-hours through a local Date). _(both)_
- [ ] **Do:** deploy-gap sanity (calendar tables absent) → **Expect:** the loop still works — it rides Tasks reads/ops, not `calendar_*`. _(both)_

## Known gaps / not-yet-testable
- **"Worked" (took-longer) suppression is client-session only.** The logged TIME persists, but the visual "worked" state + strip/triage suppression reset on reload — a still-open, still-elapsed block re-offers triage after a refresh (the lens model has no per-block store; recorded in decisions.md CAL-4 (b)). Re-triaging is harmless (the time was already logged).
- **Working-hours prefs are local (per-device) for now.** The gap-finder honors them, but there's no Settings UI yet and no cross-device sync — the `user_preferences.calendar` cloud transport + the Settings "Calendar" group land with **CAL-6** (which owns the prefs cloud half). Defaults are 08:00–18:00.
- **`origin:'calendar-roll-forward'` activity note not attached** — roll-forward writes an attributed `tasks.reschedule` row, but the shipped op payload is `{from,to,days}` (no origin field). A dedicated origin needs an op migration; deferred.
- **e2e `e2e/calendar/loop.spec.ts`** is env-gated (`E2E_APP_URL`), uses Playwright's clock to make "elapsed" deterministic, and is not part of `bun run verify` (mirrors CAL-3's schedule spec). The pure logic (elapsed/gap-finder/strip/roll-forward/triage/focus) has full unit coverage.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
