# Manual test checklist — TV-D12 recurrence, reminders, notifications

> Generated 2026-10-13 · branch `t/maciej/tv-d12-recurrence` · **Live-verified:** partial — on the local stack: a reminder fired by the sender reached the bell ("Moduo reminded you about …") and showed a live toast with Open while the app was in front; Settings → Preferences shows the new switches and "Browser notifications · Not allowed by the browser". `tests/reminders.spec.ts` passes. Not verifiable here: the desktop app in the menu bar, a real browser push.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Reminders
- [ ] **Do:** on a task, set "Remind me at…" a minute ahead (capture: `/remind 4pm`), keep Moduo in front → **Expect:** within a minute a toast "Reminder · <task>" with **Open**; the bell's badge goes up and the card reads "Moduo reminded you about “<task>”"; clicking it opens the task. _(web, desktop)_
- [ ] **Do:** same, with another app in front (desktop) → **Expect:** an OS notification "Reminder · <task>". _(desktop)_
- [ ] **Do:** open the task's activity → **Expect:** no line about your reminder (nobody else ever sees it). _(both)_
- [ ] **Do:** set a reminder, then move the task to **Backlog** → **Expect:** it doesn't fire. Move it back to To do → **Expect:** a toast "Restore the reminder?" with **Restore**; Restore → it fires at its time; ignore → it never fires. Same with **Won't do**. _(both)_
- [ ] **Do:** set a reminder on a task in a project, archive the project → **Expect:** no reminder. _(both)_
- [ ] **Do:** set a reminder, mark the task Done before it's due → **Expect:** no reminder. _(both)_

## Reminders reach you when Moduo isn't in front
- [ ] **Do:** desktop: Settings → Preferences → Reminders → "Keep running in the menu bar" is on; close the window (red button) → **Expect:** the window hides, the Moduo icon stays in the menu bar; a reminder still arrives as an OS notification; clicking the menu-bar icon (or the Dock icon) brings the window back. _(desktop)_
- [ ] **Do:** desktop: quit with ⌘Q the first time → **Expect:** "Reminders won't arrive while Moduo is quit…" with Quit / Cancel, once; later quits don't ask again (unless "Confirm before quitting" is on). _(desktop)_
- [ ] **Do:** desktop: turn "Keep running in the menu bar" off, close the window → **Expect:** it quits as before. _(desktop)_
- [ ] **Do:** web: Settings → Preferences → Reminders → turn **Browser notifications** on, allow → **Expect:** the switch stays on; close the Moduo tab; a reminder arrives as a browser notification "Reminder · <task>"; clicking it opens Moduo on the task. _(web — needs the VAPID keys and the push sender, see below)_
- [ ] **Do:** web: block notifications for Moduo in the browser → **Expect:** the row reads "Not allowed by the browser…" and the bell still shows reminders. _(web)_
- [ ] **Do:** web: with browser notifications on, sign out → **Expect:** no more notices on that browser; sign in as someone else and turn them on → **Expect:** only their reminders, never the first person's words. _(web)_

## The notification table (§13) and its switches
- [ ] **Do:** as a teammate, assign you 5 tasks at once (or one by one within an hour) → **Expect:** one bell card "<name> assigned you 5 tasks"; each task's activity still says "assigned this". _(both)_
- [ ] **Do:** read that card, then get one more assignment → **Expect:** a new card. _(both)_
- [ ] **Do:** in a task's description type `@` and pick a person → **Expect:** their name is inserted; they get "mentioned you in “<task>”" (only if they can see the task). _(both)_
- [ ] **Do:** Settings → Preferences → Notifications → turn **Comments** off, keep **Mentions** on; have a teammate comment on your task, then comment naming you → **Expect:** the plain comment doesn't show; the one naming you does. _(both)_
- [ ] **Do:** a task "Waiting on" a teammate; the teammate comments on it → **Expect:** the waiting entry clears; you get a quiet "commented on “<task>” · no longer waiting" (switch: **Waiting**). _(both)_
- [ ] **Do:** a task with a due date that passes → **Expect:** no notification (it shows as late in views). _(both)_

## Repeats
- [ ] **Do:** a weekly repeat due Friday with a work session Thursday 2 PM; complete it → **Expect:** next week it comes back on Thursday with the session Thursday 2 PM and due Friday (both moved by a week). _(both)_
- [ ] **Do:** a weekly repeat with a "1 day before" reminder; complete it → **Expect:** next week it comes back the day before it's due and the reminder fires again. _(both)_
- [ ] **Do:** a repeat with a checklist of subtasks; tick some, complete the parent → **Expect:** when it comes back, the subtasks are To do again. _(both)_
- [ ] **Do:** a repeat at 9:00 across a daylight-saving change → **Expect:** still 9:00 after the change. _(both)_
- [ ] **Do:** skip an occurrence (row ⋯ → Skip) → **Expect:** it moves to the next one the rule picks; the activity says so. _(both)_
- [ ] **Do:** a repeat in a project you archive → **Expect:** it doesn't come back. _(both)_

## Edge cases
- [ ] **Do:** browser notifications on in a browser where someone else had them on and never signed out → **Expect:** turning them on still works (the browser gets a fresh subscription). _(web)_
- [ ] **Do:** a laptop asleep for an hour with several reminders → **Expect:** at most three toasts, newest first; all are in the bell. _(both)_

## Migrations / data
- [ ] **Do:** `20261013110000_notifications_v3.sql`, `20261013111000_recurrence_moves_dst.sql`, then `20261013140000_reminders_repeats_fixes.sql` on the local stack → **Expect:** `bun run db:test` passes (notifications, recurrence_v3, waiting and every older suite). _(db)_

## Known gaps / not-yet-testable (verify before release)
- **Desktop:** the menu-bar icon, close-to-tray, Dock reopen and OS notifications need a signed desktop build (`tauri-plugin-notification` fails silently unsigned; gotchas/desktop.md).
- **Browser push on prod:** generate a VAPID key pair; set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` as push-send secrets and `PUBLIC_VAPID_PUBLIC_KEY` for the web build; deploy `push-send`; put `push_sender_url` (the function's URL) and `push_sender_secret` (64 hex) in Vault. Without the Vault entries nothing is ever pushed (by design). Test on Chrome, Firefox and Safari (macOS: Safari delivers with Safari closed).
- **Cron on prod:** the `tasks-reminders` job now runs every minute; check its duration on prod's data.
- **Email:** a reply arriving clears an email "Waiting on" only when the email engine re-upserts that thread's ref with a newer message; the engine doesn't report every inbound message yet (Email module).
- Old desktop builds: a pre-D12 build ignores suspended reminders (it never reads the column) and has no Settings rows; nothing breaks.
