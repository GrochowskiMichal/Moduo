# Manual test checklist — DF-19f-notif Notification type toggles

> Generated 2026-07-12 · branch `t/maciej/df-19f-notif-toggles` · **Live-verified end-to-end on the hosted account** (self-cleaning read-side proof — see the ✅ items). `bun run verify` **1213 green**; skeptical-senior validator **SHIP**. The held DF-19f sub-slice, unblocked by DF-9.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → surface.

## What this block does
Adds per-type notification toggles (**Mentions · Assigned to you · Due & follow-up · Task unblocked**) to Settings → Preferences, all **on** by default. Muting is a **read-side filter** over the notification feed keyed on each row's `op` — no migration, no change to how notifications are generated, and fully reversible (rows persist; un-muting restores them).

## Preferences UI
- [x] ✅ **Do:** Open Settings → **Preferences**. → **Expect:** a **NOTIFICATIONS** group at the **top** (above Default landing view) with the line "Which alerts reach your bell. Muting hides a type — nothing is deleted, and turning it back on brings it back.", then 4 switch rows (Mentions, Assigned to you, Due & follow-up, Task unblocked), **all on**. _(web / both)_
- [x] ✅ **Do:** Toggle **Mentions** off, reopen Settings (or reload). → **Expect:** it stays off — `localStorage["moduo.preferences"].notifications.mention === false`, synced to the cloud `preferences` blob. _(web / both)_
- [ ] **Do:** On a second signed-in device/session, open Settings → Preferences. → **Expect:** the mute you set syncs across (last-write-wins on the `preferences` domain, same as landing view). _(both)_

## Suppression — the bell + badge (read-side)
- [x] ✅ **Do:** With **Mentions muted**, ensure there's a mention-to-you in the workspace (someone else @mentions you in a comment), then open the bell. → **Expect:** that mention is **absent** from the list AND not counted in the Workspace/Global unread badge. _(web — verified via a seeded `comments.add` row: bell showed Workspace 0 / Global 0.)_
- [x] ✅ **Do:** Toggle **Mentions back on** (no reload needed). → **Expect:** the same mention **reappears** in the bell with its unread dot and the badge increments — proving it was hidden, never deleted. _(web — verified: Workspace 1 / Global 1, "opens task" deep-link, instant with no refetch.)_
- [ ] **Do:** Mute **Due & follow-up** with a live snooze-due / follow-up-due email notification present. → **Expect:** it drops from the bell + badge; un-mute restores it. _(desktop — needs an email account synced + a snoozed/follow-up thread that became due.)_
- [ ] **Do (known gap):** Mute **Task unblocked** / **Assigned to you** and generate one (close the last blocker of a parked task / have another member set a task's owner to you). → **Expect:** it's hidden while muted, shown when on. _(both — **only observable once DF-9's `tasks_notify_spine` trigger is applied to prod**; until then no such rows generate. The op→type mapping is unit-tested meanwhile.)_

## Home Activity widget (same feed)
- [ ] **Do:** With a type muted, look at Home's **Activity** widget (if in your layout). → **Expect:** it hides the same muted types as the bell (they share the `notifications_list` feed). _(web)_

## Regression checks
- [x] ✅ **Do:** With all four toggles **on** (default), open the bell and switch the **Workspace / Global** scope tabs. → **Expect:** grouping, unread dots, "Mark all read", and both scope counts behave exactly as before; switching scope no longer triggers a network refetch (it's derived from the already-fetched feed). _(web)_
- [ ] **Do:** Post a comment @mentioning a member (Mentions on). → **Expect:** the @mention notification still lands unchanged. _(web)_

## Desktop confirm-before-quit (DF-19f-quit — same branch)
- [x] ✅ **Do (web):** Open Settings → Preferences → Startup. → **Expect:** on **web** there is **no** "Confirm before quitting" row (it's desktop-only); the app console has no errors from the close-guard. _(web — verified: row absent, `isTauri=false`, clean console.)_
- [ ] **Do (desktop):** In the desktop build, Settings → Preferences → Startup shows **"Confirm before quitting"** (off by default). Turn it **on**, then click the window's close button. → **Expect:** a "Quit Moduo?" confirmation; **Cancel** keeps the app open, **OK** quits. _(desktop — REQUIRES a Tauri build; not exercisable in the web session.)_
- [ ] **Do (desktop):** With the toggle **off** (default), click the window close button. → **Expect:** the app closes immediately with no prompt (no listener registered when off). _(desktop)_
- [ ] **Do (desktop, macOS):** With the toggle **on**, press **⌘Q**. → **Expect (KNOWN GAP):** ⌘Q currently **bypasses** the confirm (it's `ExitRequested`, not a window close). If the confirm should also catch ⌘Q, that needs the deferred Rust-side exit handler. Note the actual behaviour. _(desktop / macOS)_

## Known gaps / not-yet-testable
- **assigned-to-you / task-unblocked** live suppression can't be exercised until **DF-9's migration (`20260712120000_df9_task_notifications.sql`) is applied to prod** — no such rows generate yet. The filter is type-agnostic and the op→type map is unit-tested, so it will govern them automatically once the trigger deploys.
- **Cross-device sync** of a mute wasn't re-verified this session (single session); it rides the same proven `preferences` LWW domain as landing view (DF-19f).
- The live-verify seeded one `module_activity` mention row for the test account and **reverted it** (plus reset the `preferences` blob to `{}`); appearance/focus were left untouched.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
