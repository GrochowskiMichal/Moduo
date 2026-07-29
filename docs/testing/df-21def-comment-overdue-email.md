# Manual test checklist — DF-21d/e/f (Universal Inbox: comment-notify · overdue opt-in · email-due web)

> Generated 2026-07-14, extended 2026-07-27 · branch `t/maciej/df-21def-comment-overdue-email` · **Live-verified:** DF-17 + accent yes; DF-21d/e/f partial.
> Covers **DF-21d/e/f**, **DF-17** (legacy deletions + onboarding/paywall rebuild) and the **monochrome accent default**. Unit tests green (**1231**). Run top-to-bottom.

## ✅ Migration status (read first)
- [x] `20260714120000_comments_notify_owner_participants.sql` — **APPLIED to prod 2026-07-27** on your explicit go-ahead. Post-apply live probe against the deployed functions confirmed owner-notified / actor-excluded / predicate-targets-owner-not-actor (rolled back clean); grants verified `anon=false`, `authenticated=true`. This also **re-asserted the two-branch `spine_activity_targets_me`**, resurrecting `tasks.unblocked` + email-due, which had been silently dark in prod.
- [ ] **Do:** Open the bell for the first time after the apply. → **Expect:** a possible **one-time burst** of previously-dark notifications. Intended; bounded to ~50; "Mark all read" clears it. _(both)_
- [x] ✅ **DF-21f is LIVE as of 2026-07-29 (OPS-1).** The web sweep calls `email_op_follow_up_due`, from `20260704180000_email_snooze_followup.sql` — **applied to prod 2026-07-29** and proven by an authed rolled-back probe. The DF-21f checks below no longer 404 (PGRST202). _(prod)_

## DF-21d — Comment-on-your-entity notification (needs the migration applied)
- [ ] **Do:** As user B, comment on a task **owned by user A** (no @mention). → **Expect:** A's bell gets "B commented: …"; B (the author) gets nothing. _(both)_
- [ ] **Do:** As A, comment on your OWN task (no other participants). → **Expect:** nobody is notified (self-comment is silent). _(both)_
- [ ] **Do:** After B and A have both commented on A's task, have C comment on it. → **Expect:** both A (owner) and B (prior participant) are notified; C is not. _(both)_
- [ ] **Do:** As B, comment on a **contact/company** (owner-less) that A previously commented on. → **Expect:** A (prior participant) is notified; there is no "owner" ping. _(both)_
- [ ] **Do:** As B, comment on A's task AND @mention A in the same comment. → **Expect:** A gets exactly ONE notification (not two). _(both)_
- [ ] **Do:** Click a comment notification. → **Expect:** deep-links to the task/note/contact and marks it read. _(both)_

## DF-21e — Overdue opt-in section (client-side; testable without the migration)
- [ ] **Do:** With a task **you own** scheduled in the past and not done, open the bell (setting OFF by default). → **Expect:** NO "Overdue" section, and the drifted task does NOT add to the bell badge. _(both)_
- [ ] **Do:** Settings → Preferences → Notifications → turn ON "Show overdue tasks", reopen the bell. → **Expect:** an "Overdue" section listing your past-scheduled, still-open tasks, most-overdue first, with a "scheduled Nd ago" caption; the badge is unchanged (overdue never counts). _(both)_
- [ ] **Do:** Complete or reschedule one of the overdue tasks, reopen the bell. → **Expect:** it drops out of the Overdue section. _(both)_
- [ ] **Do:** In a shared workspace, have a teammate own a past-scheduled task. → **Expect:** it does NOT appear in your Overdue section (owner-scoped to you). _(both)_
- [ ] **Do:** Click an overdue row. → **Expect:** deep-links to that task in /tasks. _(both)_
- [ ] **Do:** With >6 overdue tasks, open the bell. → **Expect:** the first 6 show + a "+N more overdue in Tasks" line. _(both)_
- [ ] **Do:** Turn the setting back OFF. → **Expect:** the Overdue section disappears immediately. _(both)_

## DF-21f — Email-due web parity (needs the migration + email refs; web)
- [ ] **Do:** On the **desktop** app, set a follow-up on a thread with a deadline in the near past (or seed an `email_refs` row with `follow_up_at` in the past, not cleared, not yet notified). Then open the **web** app and blur/refocus the window. → **Expect:** the bell shows "You have a follow-up due: …" for that thread; it deep-links to the thread. _(web)_
- [ ] **Do:** On web, have a **snoozed** thread whose snooze time has passed. → **Expect:** NO snooze-due notification is generated on web (snooze-due stays desktop-only so the IMAP mail is not stranded). _(web)_
- [ ] **Do:** After the web sweep fires a follow-up-due, open the desktop app. → **Expect:** the desktop does NOT re-notify (server one-shot guard). _(both)_

## Edge cases
- [ ] **Do:** Comment on a **trashed** task/note. → **Expect:** the owner is NOT pinged (soft-delete-filtered); prior participants still are. _(both)_
- [ ] **Do:** Mute "Mentions" in Settings, then have someone comment on your task. → **Expect:** the comment notification is hidden (comments ride the `mention` toggle). _(both)_

## Migrations / data
- [ ] **Do:** Confirm `comments_op_add` now logs `notify_user_ids` in the `comments.add` activity payload (comment on a task, inspect the latest `module_activity` row). → **Expect:** `payload->'notify_user_ids'` is present and correct. _(prod)_

## Known gaps / not-yet-testable
- **Live UI verification was not run this session** — the built-in preview binds to another worktree (gotchas §Storybook/live-verify); DF-21e is fully client-side and unit-tested but was not driven in a browser. DF-21d and DF-21f additionally cannot surface until the migration is applied (deploy-gated).
- **`20260714120000` is applied** (see top). **`20260704180000_email_snooze_followup.sql` is applied too, as of 2026-07-29 (OPS-1)** — `email_op_snooze_due`/`_follow_up_due` and `email_refs.follow_up_notified_at` are all present in prod, grants verified (`anon` cannot execute).
- ~~**Duplicate migration timestamps exist**~~ — fixed by OPS-1 on 2026-07-29: the two `user_preferences` domain files were re-stamped `20260702155000` / `20260712115000` (matching prod’s real apply order), and `src/lib/migration-order.test.ts` now fails `bun run verify` on any future collision.
- **DF-21f is desktop→web hybrid only** — a pure-web user can't snooze/follow-up (email UI is desktop-gated), so the web sweep matters only for users who set follow-ups on desktop then check the web bell. Web can't run the desktop reply-clear (no IMAP), so a follow-up whose reply hasn't been desktop-swept may nudge once (self-clears on the next desktop run).

## DF-17 — Legacy deletions + onboarding/paywall rebuild (live-verified)
- [ ] **Do:** Sign out, then sign up / sign in as a brand-new user. → **Expect:** after the code, you land on **ONE** onboarding screen ("Set up your workspace") — no separate "your trial is active" step. _(web)_
- [ ] **Do:** On that screen, press **Enter** in the workspace-name field. → **Expect:** it submits (it previously could not) and creates the workspace. _(web)_
- [ ] **Do:** Look at the field on arrival. → **Expect:** "My workspace" is prefilled AND preselected, so typing replaces it. _(web)_
- [ ] **Do:** As a web user on the free-trial path, check the bottom of the card. → **Expect:** a quiet footnote: "Your 7-day trial is active. Add a card under Settings → Billing…" — not an amber box. On desktop, or arriving from a paid link, the footnote is absent. _(both)_
- [ ] **Do:** Visit `/paywall`. → **Expect:** fully monochrome — no orange/amber anywhere. Pro is emphasised by a brighter border + elevation + a neutral "Most popular" badge + being the only **solid** button; Free/Team have outline buttons. _(web)_
- [ ] **Do:** Toggle Monthly ↔ Yearly on the paywall. → **Expect:** Pro $10→$8 with "billed as $96/yr · 7-day free trial"; Team $9→$7; the three CTAs stay bottom-aligned. _(web)_
- [ ] **Do:** Find the "Start a no-card 7-day trial on Pro" control under the cards. → **Expect:** it is **underlined** (reads as a link, not a caption). _(web)_
- [ ] **Do:** Open a note that embeds a mindmap. → **Expect:** it renders in app colours (no near-black `#111` panel); the embed border/badge match the rest of the UI. _(both)_
- [ ] **Do:** Confirm nothing regressed in the mindmap page at `/mindmap` (still reachable by URL). → **Expect:** loads normally — only 3 unreferenced files were deleted. _(both)_

## Monochrome accent default (live-verified)
- [ ] **Do:** Sign out and look at the login screen. → **Expect:** the "Continue with email" button is **white/neutral**, never pink. _(web)_
- [ ] **Do:** Settings → Appearance → Accent. → **Expect:** **Mono** is the FIRST option; your existing choice (blue/violet) is unchanged and still applied in-app. _(both)_
- [ ] **Do:** Pick a hue (e.g. Blue), then sign out. → **Expect:** the auth screen stays **monochrome** — pre-workspace surfaces (auth, onboarding, paywall, join, public note reader) never inherit your accent. _(web)_
- [ ] **Do:** Switch Theme → **Light** while on onboarding or the paywall. → **Expect:** the primary button becomes **solid black** with white text — clearly visible, not white-on-white. _(both)_
- [ ] **Do:** With Mono selected, look at a selected task row / board card / contact row. → **Expect:** selection now reads as a neutral white tint + bar instead of a coloured one. **This is the most visible knock-on — eyeball it and tell me if you want it tuned.** _(both)_

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up".*
