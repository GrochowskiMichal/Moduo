# Manual test checklist — DF-11 Focus session survives navigation

> Generated 2026-07-11 · branch `t/maciej/df-11-focus-nav` · **Live-verified:** yes (hosted web account — full flow below driven end-to-end; desktop parity is the same code path, unverified in-session).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Session survives navigation (the headline)
- [ ] **Do:** Tasks → **Focus** tab. With a task in the queue (or use the capture box below), click **Track time** and let it run to ~10s. → **Expect:** the card shows a running clock (`● 00:1x`) and a quiet **chip appears in the bottom-left of the app chrome**: `● 00:1x <task title>`. _(both)_
- [ ] **Do:** Navigate to **Calendar** (or any other module) while the timer runs; wait ~20s. → **Expect:** the chip **stays visible and keeps counting up** on the other route (the timer did NOT reset or die). _(both)_
- [ ] **Do:** Click the chip. → **Expect:** you land back in **Tasks → Focus** on the same task, the clock **continuous** with where it was (no reset). _(both)_
- [ ] **Do:** Click **Stop** (the ▢). → **Expect:** the chip **disappears**; the card's Track-time button now shows the **total tracked** (e.g. `1m`), which **includes the seconds counted while you were on Calendar**. _(both)_
- [ ] **Do:** Reload the page, return to the same task (Focus, or the detail panel's **Time spent**). → **Expect:** the tracked total **persisted** across the reload (server-saved, not just local). _(both)_

## Chrome chip is a passive indicator (not a second tracker)
- [ ] **Do:** Inspect the chip while running. → **Expect:** it shows only a running dot (or a pause glyph when paused), the elapsed clock, and the task title — **no pause/stop controls on the chip itself** (the live tracker stays in Focus). _(both)_
- [ ] **Do:** Pause the timer in Focus (the ‖), then look at the chip. → **Expect:** the chip shows a **pause glyph** (not the pulsing dot) and the frozen time; tooltip reads "…(paused) · click to open". _(both)_

## Empty-queue capture (no dead end)
- [ ] **Do:** Enter Focus with an **empty** today-queue (or mark the last task done). → **Expect:** instead of only "Back to Plan", there's an **"Add one more…" input + Add** button. _(both)_
- [ ] **Do:** Type a title and press **Enter** (or click Add). → **Expect:** the task is created **and committed to today** — Focus immediately shows it as the current card (Queue count +1). _(both)_
- [ ] **Do:** Mark the last committed task **Done**. → **Expect:** the card flips to "N / N Done · Queue cleared." with the capture box available again (never a dead end); the chip is gone. _(both)_

## Pomodoro / timer parity (no regression from the lift)
- [ ] **Do:** In the card's **⋯** menu turn on **Pomodoro rhythm**; set Work=1 / Break=1 (⋯ or Settings → Focus) and start. → **Expect:** the big clock **counts down** from the work interval, rolls to a break at 0 (chime if sound is on), and — with auto-start off — **pauses** for a manual resume. _(both)_
- [ ] **Do:** While tracking, use ⋯ → **+5m** / **Set total**. → **Expect:** the tracked total updates as before (these still write straight to the task). _(both)_

## Edge cases
- [ ] **Do:** Start a timer, navigate away, come back **without stopping**, then keep working. → **Expect:** the away-seconds are already banked (visible on the next flush/stop) and nothing double-counts. _(both)_
- [ ] **Do:** In the empty-queue capture, use the box **immediately** then try to Track-time on the just-created card within ~1s. → **Expect:** if the card is still saving you get a "Still saving that task…" toast (no broken/duplicate row); a beat later Track time works. _(both)_
- [ ] **Do:** View-only member (no Tasks edit) enters Focus with an empty queue. → **Expect:** no capture box (edit-gated); "Back to Plan" only. _(both)_

## Known gaps / not-yet-testable
- **Desktop (Tauri) not exercised in-session** — verified on the hosted web dev server; the store/chip/capture are platform-agnostic React, so desktop should match, but a desktop pass is worth one run.
- **Backgrounded-tab accrual** is unchanged from the old timer: a `setInterval` tick under-counts while the browser tab is *hidden* (minimized/background) — DF-11 deliberately kept the tick model (foreground navigation, which it targets, is unaffected). Converting to wall-clock accrual (CAL-5's pattern) is a future correctness nicety.
- **Task hard-deleted on another device while a session runs on it** — on return the retained away-seconds are discarded when Focus re-binds to the new current task (extreme edge; the old component-local timer lost them too).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
