# Manual test checklist — DF-12 boot fetch consolidation

> Generated 2026-07-11 · branch `t/maciej/df-12-boot-fetch` · **Live-verified:** yes — one clean authed boot on the hosted test account (`grzywaczmj+moduo-s2-test`) measured every target read at exactly 1 (see "Boot fetch counts" below); Home rendered with no regression.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
> This block is a **performance/correctness** change with no new UI — most checks are "confirm nothing regressed" plus a network-count spot check.

## Boot fetch counts (the point of the block)
- [ ] **Do:** Sign in on **web**, open DevTools → Network, filter to `supabase.co`, then hard-reload `/` and let Home settle. → **Expect:** exactly **one** `auth/v1/user`, **one** `profiles`, **one** `workspaces?...workspace_members(*)`, **one** `dashboard_layouts` (a `GET`, **no** `POST … on_conflict` upsert), **one** `workspace_notifications` + **one** `rpc/notifications_list`, **one** `user_preferences`. _(web)_
- [ ] **Do:** In the same Network panel, look specifically for a `dashboard_layouts` **POST/upsert** during that pure reload (no dashboard edits). → **Expect:** none — the read path issues no write. _(web)_
- [ ] **Do:** Repeat the reload 2–3 times. → **Expect:** the counts stay ~1 each every boot (no remount-cascade fan-out). _(both — desktop via the same webview Network inspector)_

## Auth / identity (no regression from the cached user)
- [ ] **Do:** Boot the app signed in. → **Expect:** the app loads to Home, your workspace + tasks + profile all present (the cached `getAuthedUser` returns the right user). _(both)_
- [ ] **Do:** Sign out, then sign in as the SAME user again. → **Expect:** everything loads correctly (the boot cache was cleared on `SIGNED_OUT`/`SIGNED_IN`). _(both)_
- [ ] **Do:** Create a task / bucket (a user-scoped write). → **Expect:** it saves and is owned by you (the cached user id is correct for writes). _(both)_
- [ ] **Do:** Settings → change your display name. → **Expect:** the new name sticks and re-appears after a reload (the profile cache was invalidated on the write). _(both)_

## Workspaces / selection (the ref refactor)
- [ ] **Do:** Switch to another workspace (if you have 2+). → **Expect:** the selection changes, members/notifications refetch for the new workspace, and it persists across a reload. _(both)_
- [ ] **Do:** Create a new workspace. → **Expect:** it appears and becomes selected. _(both)_
- [ ] **Do:** Leave a workspace. → **Expect:** you drop to another workspace (or onboarding if it was your last). _(both)_

## Notifications
- [ ] **Do:** Open the notification bell. → **Expect:** your feed loads (invites + spine notifications), unchanged from before. _(both)_
- [ ] **Do:** Mark a notification read / mark all read. → **Expect:** the unread count updates immediately (the mutation still refetches fresh, not a stale cached feed). _(both)_

## Dashboard layout persistence (write-on-read removed)
- [ ] **Do:** Edit the Home dashboard (move/add/remove a widget), wait ~2s, reload. → **Expect:** the edit persisted (the normal debounced `save` still runs). _(both)_
- [ ] **Do:** Edit a widget, then immediately reload (before 2s) a couple of times. → **Expect:** no data loss — the local cache holds the edit and it reconciles up on the next edit; the layout is never wrong. _(both)_

## Preferences sync (per-user keyed cache)
- [ ] **Do:** Change a synced appearance pref (theme/accent/font), reload. → **Expect:** it persists (one `user_preferences` read on boot, the write still lands). _(both)_
- [ ] **Do:** _(shared browser)_ Sign out of account A and into account B quickly. → **Expect:** B sees B's own prefs, never A's (the prefs cache is keyed by userId). _(web)_

## Edge cases
- [ ] **Do:** Boot **offline** (or kill the network mid-boot). → **Expect:** the app degrades gracefully (empty/cached surfaces), and a later boot with the network back loads normally — a transient `getUser` failure does NOT permanently blank the app. _(both)_
- [ ] **Do:** A brand-new invitee with **zero workspaces** signs in. → **Expect:** they reach onboarding and any invite feed still loads (the `!loading` notifications gate still fires for a null workspace). _(both — hard to stage; see gaps)_

## Migrations / data
- [ ] No schema/migration changes — pure client-side read consolidation. Nothing to apply.

## Known gaps / not-yet-testable
- Live-verified on **web** against the hosted account; the **desktop** (Tauri) boot path shares the same `runtime.web` code and providers but its `/auth/v1/user` counts weren't separately measured here (webview Network inspector needed).
- The **shared-browser fast-switch** prefs-leak check and the **zero-workspace invitee** case were reasoned + unit/validator-covered but not staged end-to-end (need a second account + an invite).
- The `dashboard_layouts` write-on-read removal is proven by a unit test (`layout-repo.test.ts` "a load NEVER writes to the cloud, even when the local cache leads") and by the live count (1 request, no upsert); the specific hard-kill-within-1s cross-device propagation delay is an accepted tradeoff, not a bug.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
