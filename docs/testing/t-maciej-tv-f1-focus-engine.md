# Manual test checklist — TV-F1 Focus engine

> Generated 2026-10-08 · branch `t/maciej/tv-f1-focus-engine` (PR #256) · **Live-verified:** partial. The web items marked ✅ were checked live in a local harness that mounted the real Focus view with fake tasks and a fake save (no sign-in), shifting `Date.now` to simulate hidden windows and sleep. Desktop items were not run (no signing identity on this Mac).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Focus clock (Tasks → Focus)
- [ ] ✅ **Do:** Focus mode, click **Track time** on the Now card → **Expect:** the clock runs on the card and the chip in the bottom bar shows the same time. _(both)_
- [ ] ✅ **Do:** with the clock running, reload the page (⌘R) → **Expect:** Focus comes back still running, with the time it had before plus the reload. _(web)_
- [ ] **Do:** quit the desktop app mid-session and reopen it within a minute → **Expect:** the session resumes with the right time and no prompt. _(desktop)_
- [ ] **Do:** switch to another browser tab for 10 minutes, then come back → **Expect:** about 10 more minutes on the clock and no prompt. (If the browser froze the tab instead of slowing it, you get the away prompt; **Keep** restores the time.) _(web)_
- [ ] **Do:** pause, then stop → **Expect:** the tracked time lands on the task (the Now card total and the detail panel's Time agree). _(both)_
- [ ] **Do:** Settings → Advanced → **Reset local cache** while a session runs → **Expect:** after the reload the session is still running. _(both)_
- [ ] **Do:** sign out mid-session, sign back in → **Expect:** the session is there again (with an away prompt if more than 90 s passed). Sign in as someone else on the same machine → **Expect:** no session. _(both)_

## While you were away
- [ ] ✅ **Do:** start the clock, close the lid (or sleep the Mac) for 5+ minutes, wake it → **Expect:** "You were away 5m" with **Keep · Discard · Count as break** on the Now card and next to the chip; the clock didn't add the away time and keeps running from the wake-up. _(both)_
- [ ] ✅ **Do:** **Keep** → **Expect:** the away minutes are added to the task and the prompt disappears in both places. _(both)_
- [ ] **Do:** repeat, **Discard** → **Expect:** nothing is added. _(both)_
- [ ] ✅ **Do:** with Pomodoro on, repeat, **Count as break** → **Expect:** nothing is added and a fresh 25-min focus block starts. _(both)_
- [ ] **Do:** leave the prompt unanswered and press **Stop** (or finish the last task) → **Expect:** the away time is dropped, not added. _(both)_

## Pomodoro
- [ ] ✅ **Do:** Pomodoro on, start, mark the task **Done** mid-block → **Expect:** the next task becomes Now and the same countdown keeps running (no reset, Pomodoro stays on). _(both)_
- [ ] ✅ **Do:** start a block, sleep the Mac past its end, wake → **Expect:** "Your 25-min focus ended at <time>." in the prompt, **Keep** offers only the rest of that block ("Keep 15m"), and the timer waits at the break (or at "resume") — a new focus block never starts by itself while you were away. _(both)_
- [ ] **Do:** turn **Auto-start next** on (Settings → Focus) and let a block end while you're at the screen → **Expect:** one chime, the break starts by itself. _(both)_

## Phase-end alerts
- [ ] ✅ **Do:** set Work to 1 minute, start a block, switch to another tab or app until it ends, come back → **Expect:** one in-app toast "Focus block done · Start your 5-min break when you're ready." _(web)_
- [ ] **Do:** same, with Moduo in front the whole time → **Expect:** only the chime (if sounds are on), no toast or notification. _(both)_
- [ ] **Do:** on a **signed** desktop build (a CI release), set Work to 1 minute, start, then hide or minimize the window until the minute ends → **Expect:** exactly one macOS notification "Focus block done". Check System Settings → Notifications lists Moduo. _(desktop)_
- [ ] **Do:** signed desktop build, hide or minimize the window for 10 minutes with the clock running (no pomodoro) → **Expect:** about 10 more minutes and no away prompt (background throttling is off on macOS 14+). _(desktop)_

## Saving
- [ ] **Do:** turn Wi-Fi off, track 30 s, pause (✅ checked with a simulated failed save, not real Wi-Fi) → **Expect:** "· not saved yet" next to the total (and in the chip's tooltip); the total doesn't drop. Turn Wi-Fi on → **Expect:** within about 15 s to 2 min it saves and the note goes away; the total is right (not doubled). _(both)_
- [ ] **Do:** open Moduo in two browser tabs, start Focus in one, then rename the task in the other tab and pause from there → **Expect:** both show the session; the task's time went up once, not twice, and the rename stays. _(web)_

## Edge cases
- [ ] **Do:** track time, turn Wi-Fi off and pause ("not saved yet"), delete the task from another device, turn Wi-Fi on → **Expect:** a note that the focus time couldn't be saved because the task is gone, and "not saved yet" clears. _(both)_
- [ ] **Do:** in a second tab, mark the session's task **Done** → **Expect:** the session moves to the next task in that tab. _(web)_
- [ ] **Do:** finish the last task in the queue mid-session → **Expect:** the session ends; the end screen appears; time banked. _(both)_
- [ ] **Do:** have someone delete the task you're focusing on, then pause → **Expect:** no error toast; nothing breaks. _(both)_
- [ ] **Do:** as a view-only member of a workspace, track time → **Expect:** "· not saved yet" stays (view-only members can't save time). _(both)_
- [ ] **Do:** start Focus in workspace A, switch to workspace B and open Focus there → **Expect:** the chip still shows A's task and keeps counting (B's queue doesn't take it over); A's time saves once you're back in A's Tasks. _(both)_

## Migrations / data
- [ ] **Do:** none to apply — no migration in this block. The running session lives in localStorage under `moduo:tasks:focus:<your user id>`; tracked time is still saved into each task's time total (time entries come in TV-D3). → **Expect:** nothing to check beyond the items above.

## Known gaps / not-yet-testable
- **Desktop notifications and background accrual were not run here.** This Mac has no code-signing identity, and an unsigned build shares its bundle id and storage with the installed Moduo.app. The plugin is known to fail silently when signing doesn't match, and in `tauri dev` its notifications show as Terminal. If the signed build shows nothing, the spec's fallback is a small UNUserNotificationCenter command.
- **Two browser tabs:** only the tab running the clock shows the phase-end toast, so it can land in a hidden tab.
- **An edit made in another tab or device can be reverted** by the next focus save from the tab running the clock (whole-row write; pre-existing). A tab that takes the clock reloads first, which covers the common two-tab case. TV-D1's field-level saves fix the rest.
- **Time on a tab without Tasks open waits.** If the tab running the clock has left Tasks, its time is held on the device (not lost) and saves when that tab opens Tasks again or you act on the session in a tab that has it open.
- **Idle without sleep** (walking away from an awake machine) isn't detected — out of scope per the spec.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
