# Manual test checklist — Help menu + Focus timer in the top bar (call 96)

> Generated 2026-10-10 · branch `t/maciej/top-bar-help-focus-timer` · **Live-verified:** partial. On web against the local stack at 1024 and 1440 px: the timer, hover pause/resume, click-to-Focus from Home, the Help menu, the shortcuts dialog (from Help and from `?`, with focus back on Help after Esc), the bug-report form, the Docs and Contact support targets (mail hand-offs were intercepted, so no mail app opened), and the narrow/wide switch of the short forms. Not live: the desktop app, a pomodoro break, "while you were away" (unit-tested), and "not saved yet" (unit-tested).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The Focus timer (top bar)
- [ ] **Do:** With no Focus session, look at the top right. → **Expect:** Help (?) · bell · avatar, nothing else. _(both)_
- [ ] **Do:** Tasks → Focus → Track time on a task, then go to Home. → **Expect:** left of Help, a small dot and the clock ("0:12") in grey text, no box. The bottom bar's left corner is empty on Home (or shows page dots with more than one page). _(both)_
- [ ] **Do:** Hover the timer. → **Expect:** a soft box appears, the dot turns into a pause sign, and the tooltip names the task. _(both)_
- [ ] **Do:** Click the pause sign. → **Expect:** the clock stops; at rest it shows a pause sign instead of the dot; hovering offers resume (▷). Focus shows the same paused time. _(both)_
- [ ] **Do:** Click the clock itself. → **Expect:** Tasks opens on Focus. _(both)_
- [ ] **Do:** Tab to the timer with the keyboard. → **Expect:** pause/resume and the clock each take a visible focus ring, and the box shows while either is focused. _(both)_
- [ ] **Do:** Switch Focus to Pomodoro and wait for a break, in a wide window (about 1280 px or more with all seven tabs). → **Expect:** "Break 4:12" (or "Long break …"). In a narrow window: a small cup instead of the dot and just "4:12". _(both)_
- [ ] **Do:** Leave a running session, come back after a while away, on Home. → **Expect:** the timer says "Away 42m" (just "Away" in a narrow window); clicking it asks Keep · Discard · Count as break in a small popover, with "Open Focus" under it. _(both)_
- [ ] **Do:** Same, but come back to the Focus view. → **Expect:** the Now card asks the question, and the top bar shows the plain clock (asked once). _(both)_
- [ ] **Do:** Go offline, track a minute, Stop. → **Expect:** "Focus time not saved yet" (a cloud-off icon in a narrow window) with the tooltip "Retrying — nothing is lost"; it clears once you're back online. _(both)_

## Help (?)
- [ ] **Do:** Click Help. → **Expect:** Docs · Keyboard shortcuts (with "?") · Contact support · Report a bug. _(both)_
- [ ] **Do:** Docs. → **Expect:** moduo.app/docs opens in the browser (for now it shows the landing page). _(both)_
- [ ] **Do:** Keyboard shortcuts, then Esc. → **Expect:** the shortcuts dialog opens and stays open; after Esc the keyboard focus is back on Help. Pressing `?` anywhere outside a text field opens it too, and Esc returns focus to where you were. _(both)_
- [ ] **Do:** Contact support on web. → **Expect:** your mail app opens a new email to support@moduo.app, and a toast offers "Copy address". _(web)_
- [ ] **Do:** Contact support in the desktop app. → **Expect:** a toast says "support@moduo.app copied"; paste it to check. _(desktop)_
- [ ] **Do:** Report a bug, type a sentence, press Email report (or ⌘↵). → **Expect:** the form closes and your mail app opens an email to hello@moduo.app; the subject is "Bug: <your first line>", and the body ends with the version, build, platform and page. _(web)_
- [ ] **Do:** Report a bug in the desktop app, press Copy report. → **Expect:** a toast says the report was copied; pasting shows your text plus the version block. _(desktop)_
- [ ] **Do:** Report a bug, type something, press Cancel, then open it again. → **Expect:** your draft is still there. _(both)_

## Bottom bar
- [ ] **Do:** Look at the bottom bar in any module. → **Expect:** centre: Search · Quick capture · New (no keyboard button); left: only the left-panel toggle; right: the right-panel toggle. _(both)_

## Edge cases
- [ ] **Do:** At a 1024 px wide window with all seven tabs, run a session past one hour. → **Expect:** "1:04:12" fits with the avatar at full size and a gap before the Chat tab. _(desktop)_
- [ ] **Do:** Report a bug with an empty description. → **Expect:** Email report / Copy report stays disabled. _(both)_

## Migrations / data
- None. Nothing is stored or sent by Moduo; reports go through the person's own mail app.

## Known gaps / not-yet-testable
- **support@moduo.app has to exist** before Contact support is useful (Maciej's call, 2026-10-10).
- **moduo.app/docs falls through to the landing page** until there are docs.
- The desktop paths (copy instead of mail) were not run in the desktop app this session; they're covered by the code branch on `IS_DESKTOP` only.
- PR #323 (queue runs) rewrites the same timer file; when it lands, its run state needs porting to this quieter form.
