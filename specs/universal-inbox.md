# Spec: Universal Inbox (DF-21) — "the notification bell grows up"

> Status: **Draft (DoR-ready)** · Owner: maciej · Related briefs: `.design/connective-tissue/BRIEF.md` §Universal Inbox, `.design/connective-tissue/DESIGN_BRIEF.md`, `docs/PRODUCT_BRIEF.md` §7 (quiet notifications) · Block id: **DF-21** (spine lane, Wave C)

## Scope

DF-21 delivers the **cross-module "what needs me right now?" surface** — the visible payoff of the spine ("one place, nothing falls through the cracks"). After the /s1 (this doc), it is **NOT a new inbox screen or a 7th route.** It is the existing **notification bell growing up** into a calm, complete event feed.

The designer's ratified framing (2026-07-12):
- **A notification is an event that *happened* and needs attention** — a mention, an assignment, a comment, an email that came due — **not a standing to-do.** Slipped/overdue work is not a notification; it lives in Tasks/Home (with one opt-in exception, AC9).
- **Home stays the personalized dashboard** ("you see only what you choose"). The bell is the non-personalized "what happened that needs you." The two deliberately do **not** overlap — so DF-21 touches neither Home nor the module pages.
- The surface reuses the existing notification substrate (`module_activity` → `spine_activity_targets_me` → `notifications_list` → `src/features/spine/notifications.ts` reducer → `notification-center.tsx`). The net-new work is a **form-factor rebuild, a dismiss action, two folded-in event types, and one opt-in section** — not new fetching infrastructure.

**Reframe vs. the roadmap:** the roadmap/BRIEF imagined a dedicated Universal Inbox *screen* (its own route) unioning attention + captures + email + suggestions. That maximal surface is **explicitly not built here** (it duplicates Home, the bell, and each module, and risks the "wall of red" the product forbids). DF-21 ships the honest, quiet subset: the bell as the one cross-module event feed.

## Product behavior & UX

**The surface (form factor).** Today the bell opens a right-side `Sheet` (a full-height side panel the designer dislikes). DF-21 replaces it with:
- **A dropdown popover** anchored under the bell icon (top bar, present on every screen). It shows **active** notifications — unread + read-but-not-yet-dismissed — for the **current workspace**, grouped and deep-linking exactly as today. Calm empty state ("You're all caught up.") when nothing is active.
- **A "See all" control** → a **modal** with the **full history** (all events, including read and dismissed), newest first. One secondary surface, no side panel, no new route.
- **A dedicated "Invitations" area** for cross-workspace invites/membership (see below), kept apart from the per-workspace event feed.

**The feed (what's in it).** Event types, all rendered with quiet one-line copy via the existing `spine/activity.ts` vocabulary + `notifications.ts` reducer (grouped target→verb, digest-default — "Sarah and 2 others commented ×3"):
- **@mentions** (comments / notes / task descriptions / event notes) — built.
- **Assigned to you** (`tasks.assigned`) — built (DF-9).
- **Unblocked** (`tasks.unblocked`) — built (DF-9).
- **Email due** — snooze-due + follow-up-due — built (desktop-generated; web parity is the cuttable Block 6).
- **Comments on your entity** — NEW (Block 4): someone comments on a task/note you own, or on a thread you've commented on, without necessarily @mentioning you.
- **Invites & membership** — folded in from the legacy `workspace_notifications` feed, surfaced in the dedicated Invitations area (they are inherently cross-workspace). This is also where "shares" lands for v1 — "someone gave you access to a space" == being added to a workspace.

**Workspace scope.** The event feed is **current-workspace only** — no unrelated-workspace noise. The existing Workspace/Global toggle is **removed**. The single true exception is an **invite to a workspace you're not in yet** (there is no "current workspace" for it): those surface in the Invitations area, which reads the cross-workspace legacy feed.

**Item lifecycle.** A notification moves through **unread → read → dismissed**:
- **Unread**: bold + dot; counts toward the badge.
- **Read**: marked read on open (existing mark-on-open) or by clicking through; no longer bold; leaves the badge; **still in the active dropdown** until dismissed.
- **Dismissed** (NEW): the user clears it (X / action); it leaves the active dropdown but stays in **history** (the modal). Dismiss shows an **undo** (app-wide 8s undo grammar, DF-5). No snooze in v1.

**Clicking a notification** deep-links to its entity (existing `moduo:entity:open` path) and marks it read — unchanged.

**Preferences (quiet-core).** The bell **respects the user's notification preferences** owned by DF-19f (Settings → Preferences → notification toggles). A muted type is **not displayed**. DF-21 reads `user_preferences.preferences.notifications.<type>`; if a key is absent it **defaults to shown** (graceful degrade — DF-21 must not break if DF-19f hasn't shipped that toggle yet). DF-21 does **not** edit any settings file (DF-19e/f/h own them).

**Opt-in overdue nudge (AC9).** Default OFF. When the user turns on "Show overdue tasks" (a toggle in DF-19f's notification settings), the bell shows a **quiet, passive section** of drifted tasks (computed client-side from `isDrifted`, never red, never a running badge count). These items are **not** generated activity rows — they are a synthetic view that clears when the task is done/rescheduled. Off = no overdue items anywhere in the bell.

### States
- **Empty (active):** "You're all caught up." (calm, single line, no illustration-of-guilt).
- **Empty (history modal):** "No notifications yet."
- **Loading:** the existing lightweight "Loading notifications…" line; the dropdown opens instantly with cached items and refreshes on open.
- **Populated:** grouped digest cards, newest first, unread visually distinct (fill + dot + weight — never color alone, R/A11y).
- **Permission / degrade:** a new-RPC-on-a-hot-path failure (dismiss RPC / comments generation not yet deployed) degrades to prior behavior (feed still renders; the action no-ops with a friendly toast) — the `refreshNotifications` try/catch pattern (gotchas §Supabase/migrations).
- **Offline / desktop:** the spine feed is Supabase-direct on both web and desktop (online-only; there is no redb notification store). Email-due generation is desktop-only until Block 6.

## Edge cases

- **Dismiss then it recurs:** a dismissed notification stays dismissed; a *new* event on the same entity is a new row (new group member) and re-surfaces as active — dismiss is per-activity-row, not per-entity.
- **Dismiss undo race:** undo within 8s restores `dismissed_at = NULL`; after the window it stays in history only.
- **Mark-all-read vs dismiss:** "Mark all read" clears unread (badge → 0) but does **not** dismiss; the active list still shows read-not-dismissed items. (A separate "Clear all"/dismiss-all is out of scope v1.)
- **Comment on your own entity by you:** never notifies the commenter (self-action, actor≠me guard).
- **Comment where you are BOTH owner and @mentioned:** one notification, not two (de-dupe the target-id sets).
- **Comment on an owner-less entity** (contact/event/company — no single owner): only @mention + prior-participants notify; there is no "owner" to ping.
- **Workspace switch:** the feed re-scopes to the new workspace (invites area is unaffected — it's cross-workspace).
- **Overdue toggle flipped off with overdue items showing:** they vanish immediately (client-computed, no stored rows to clean up).
- **A muted type with existing unread rows:** muting hides them from display and drops them from the badge; unmuting brings them back (display-time filter, reversible — no data lost).
- **History pagination:** at alpha volumes the modal loads a higher fixed limit (see Assumptions); a "Load more" / keyset page is a follow-up if volume grows.
- **Invite to a brand-new workspace while signed in:** appears in the Invitations area regardless of the selected workspace; accepting it routes into that workspace (existing `/join` + membership flow, DF-24 territory — DF-21 only surfaces the notification, it does not rebuild redemption).

## Acceptance criteria

- **AC1** — Opening the bell shows a **dropdown popover** (not a side panel) of active notifications (unread + not-yet-dismissed) for the current workspace, grouped/deep-linking as today, with a calm "You're all caught up." empty state.
- **AC2** — A "See all" control opens a **modal** listing the full history (including read and dismissed), newest first.
- **AC3** — The event feed is **current-workspace only**; the Workspace/Global toggle is gone; switching workspaces shows that workspace's notifications.
- **AC4** — **Invitations / membership** (cross-workspace) appear in a **dedicated area**, not mixed into the per-workspace event feed.
- **AC5** — A notification can be **dismissed** (leaves the active list, stays in history) with an **undo**; read/unread still works (unread → read → dismissed).
- **AC6** — Clicking a notification **deep-links** to its entity and marks it read (unchanged behavior, all existing types).
- **AC7** — The feed renders these types with quiet copy: @mention, assigned, unblocked, email snooze/follow-up-due, comment-on-your-entity, invite/membership.
- **AC8** — A **comment on an entity you own** (task/note) **or on a thread you've participated in** notifies you even without an @mention; your own comments never notify you; owner+mentioned de-dupes to one notification.
- **AC9** — An **opt-in "overdue tasks" setting** (default OFF) controls a quiet passive overdue section in the bell; when off, no overdue items appear; overdue items never inflate the badge and clear when the task resolves.
- **AC10** — The bell **respects the user's notification preferences**: a muted type is not displayed; an absent pref key defaults to shown (graceful degrade); no settings file is modified by DF-21.
- **AC11** — The unread **badge** counts only unread **event** notifications for the current workspace (capped at 99), excludes the passive overdue section, and reflects read/dismiss.
- **AC12** — *(Cuttable, Block 6)* Email snooze-due / follow-up-due notifications also appear for **web** users, computed from cloud `email_refs`, not only on desktop.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/spine/notifications.test.ts` · "splits active (non-dismissed) from history" | AC1, AC2, AC5 | Given rows with/without `dismissedAt`, the reducer yields the active set (unread+read, non-dismissed) and the full history set correctly. |
| `src/features/spine/notifications.test.ts` · "scopes the event feed to the current workspace" | AC3 | Rows from another workspace are excluded from the event feed; only current-workspace rows remain. |
| `src/features/spine/notifications.test.ts` · "separates invites/membership into their own bucket" | AC4 | Legacy invite/membership rows are partitioned out of the per-workspace event groups into the invitations bucket. |
| `src/features/spine/notifications.test.ts` · "dismiss reducer + undo restores" | AC5 | Marking a row dismissed removes it from active; undo (dismissedAt→null) returns it to active. |
| `src/features/spine/notifications.test.ts` · "badge counts unread events only, excludes overdue" | AC11 | Unread count ignores read, dismissed, and synthetic overdue items; caps at 99. |
| `src/features/spine/notifications.test.ts` · "prefs filter hides muted types, defaults shown" | AC10 | A muted type is filtered from display; an absent pref key leaves the type shown. |
| `src/features/spine/overdue-inbox.test.ts` · "opt-in drifted-task section" | AC9 | With the pref ON, `isDrifted` tasks become passive items; with it OFF, the section is empty; resolving a task drops it. |
| `src/features/spine/notifications.test.ts` · "renders quiet copy for every type incl. comments" | AC7 | Each op (mention/assigned/unblocked/email-due/comments.add/invite) maps to a human sentence, never raw JSON/op token. |
| SQL probe (rolled-back, prod-schema) · "comment on owned/participated entity targets owner+participants, not the commenter" | AC8 | `comments_op_add` writes `notify_user_ids` = owner(task/note) ∪ prior commenters, minus the actor; a self-comment writes none; owner-also-mentioned de-dupes. (DF-9-style probe.) |
| Component/Storybook · `notification-center.stories.tsx` (dropdown + modal + empty + invitations) | AC1, AC2, AC4 | Visual: dropdown popover, "See all" modal, calm empty state, invitations area render in tokens-only. |
| e2e smoke · `tests/notifications.spec.ts` · "click deep-links + marks read; dismiss + undo" | AC5, AC6 | Clicking a card navigates + selects the entity and clears unread; dismiss removes it, undo restores. |

Live-verify (hosted account) covers AC1–AC7, AC10–AC11 end-to-end; AC8 backend generation via a rolled-back SQL probe (migration apply is a separate prod step, per DF-9 precedent); AC12 desktop/web parity is a desktop-engine manual check.

## Assumptions & technical decisions

Data model is **Supabase-first**, reusing the proven notification substrate. Decisions made on the designer's behalf:

1. **Reuse the derived-feed substrate wholesale.** Notifications stay a **read over `module_activity`** gated by `spine_activity_targets_me`, with per-user state in `notification_state` — no stored notifications table (mirrors CT-5). *Rejected:* a materialized notifications table (premature; alpha volume is tiny; the derived read already powers the live bell).
2. **Dismiss = a new nullable `notification_state.dismissed_at`** + ops `notifications_op_dismiss` / `notifications_op_undismiss`; `notifications_list` returns `dismissed_at`; the client splits active (non-dismissed) vs history (all). *Rejected:* a hard delete of the state row (loses history + the read mark; undo impossible).
3. **Form factor = shadcn `Popover` (dropdown) + shadcn `Dialog` (history modal)**, replacing the `Sheet`. Primitives per DESIGN_RULES R4 (wrap shadcn). The current grouping/deep-link/mark-read logic is untouched — only the container changes. *Rejected:* a new `/inbox` route (CLAUDE.md rule 7 route-budget; the designer chose no new tab) and keeping the `Sheet` (designer dislikes it).
4. **Drop the cross-workspace fetch for the event feed.** `notifications_list` is already single-workspace; the client stops synthesizing a "global" feed for spine rows. The **legacy `workspace_notifications`** feed (which *is* cross-workspace, `user_id`-scoped) becomes the **Invitations** source only. *Rejected:* an all-workspaces spine RPC (the designer explicitly does not want unrelated-workspace noise; invites are the only legitimate cross-workspace case).
5. **Comment-on-your-entity generation:** extend `comments_op_add` to compute `notify_user_ids` = (entity owner where resolvable: `tasks.owner_id`, `notes.created_by`) ∪ (prior commenters on that `(entity_type, entity_id)` from the `comments` table) − the actor, unioned/de-duped with `mentioned_user_ids`. Rides the existing **`notify_user_ids`** predicate branch (actor-agnostic, like email-due) — **no predicate change** (gotchas §Email/spine). *Rejected:* notifying all workspace members (spam); owner-only (misses thread participants who don't own the entity).
6. **Overdue nudge is client-computed, not generated.** With the pref ON, the bell derives drifted tasks from `tasks.list` + `isDrifted` (reuse `src/features/tasks/model.ts`), shown as passive synthetic items — **no `module_activity` rows**. *Rejected:* a `tasks.overdue` generated event (writes rows for every drifted task in every workspace = noise; and "overdue" is a standing state, not an event — honors the designer's definition).
7. **Preferences are read at display time, with a canonical key shape** `preferences.notifications.<typeKey>: boolean` (default true). Type keys (the **shared taxonomy** DF-19f must match): `mentions`, `assigned`, `unblocked`, `emailDue`, `comments`, `invites`, and the opt-in `overdueTasks` (default **false**). DF-21 **reads**; **DF-19f owns the toggle UI + writes** these keys into the `user_preferences.preferences` jsonb. Absent key → shown (degrade). *Rejected:* suppress at generation time (couples shared triggers to per-user prefs; not reversible without re-generating).
8. **History modal loads a higher fixed limit (200) for v1**; keyset pagination on `(created_at, id)` is a recorded follow-up if volume grows (the current RPC has no cursor). *Rejected:* building keyset pagination now (over-engineering for alpha volume).
9. **Refresh cadence stays refresh-on-open + after-action** (no realtime yet). Realtime on `module_activity`/`notification_state` is a recorded follow-up. *Rejected:* adding Supabase Realtime now (scope; the dropdown's open-refresh is enough for quiet-core).
10. **Module-contract pillars are N/A for a personal read surface (deliberate exception).** No new MCP tools (an agent should not read/mark your personal notifications; the spine's mutating ops already have MCP coverage) and **no new dashboard widget** — the existing `activity` widget already renders `listNotifications` and stays consistent via the shared `notifications.ts` reducer. Spine wiring (links/@mention/activity) is what this surface *consumes*, not adds. *Recorded per the DF-19 platform-surface precedent.*
11. **Migrations apply is a separate prod step** (DF-9 precedent): the new column/ops are additive + graceful-degrade; the feature light-degrades until applied. Round-trip-verify against the real prod schema via a rolled-back probe; apply when a designer is engaged.

Durable decisions (7's taxonomy, 5's comment rule, the "bell grows up, not a new screen" reframe) get a line in `docs/decisions.md`.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **Bell → dropdown + scope + prefs filter** | Replace the `Sheet` with a `Popover` dropdown of active items; calm empty state; drop the Workspace/Global toggle; scope to current workspace; read notification prefs and filter displayed types (graceful degrade). Keep grouping/deep-link/mark-read. | AC1, AC3, AC6, AC7, AC10, AC11 | — |
| 2 | **Dismiss** | `notification_state.dismissed_at` + `notifications_op_dismiss`/`_undismiss`; `notifications_list` returns it; active = non-dismissed; X affordance + 8s undo (DF-5 grammar). | AC5 | 1 |
| 3 | **History modal + Invitations area** | "See all" → `Dialog` modal with full history (limit 200); dedicated Invitations area sourced from the legacy cross-workspace feed, kept apart from the event feed. | AC2, AC4 | 1, 2 |
| 4 | **Comment-on-your-entity notification** | Extend `comments_op_add` to add owner (task/note) + prior participants to `notify_user_ids` (minus actor, de-duped with mentions); card copy for `comments.add` targeting you. Round-trip probe. | AC8 | — (renders in 1) |
| 5 | **Overdue opt-in section** | Client-computed drifted-task quiet section, gated on `preferences.notifications.overdueTasks` (default off); passive (clears on resolve); never in the badge. Coordinate the toggle with DF-19f (do not edit its files). | AC9 | 1 |
| 6 | **(Cuttable) Email-due web parity** | A web-side due-sweep writing snooze-due/follow-up-due activity rows from cloud `email_refs` (the cloud-write half of the desktop loop, no IMAP), so web users see email-due. | AC12 | 1 |

Sequence: 1 → 2 → 3, with 4 / 5 parallelizable after 1, and 6 last (cut if scope tightens). Each block is self-contained (behavior + ACs + tests) and recoverable from this spec + `docs/decisions.md`.

## Out of scope

- **A dedicated Universal Inbox route/screen** unioning captures + email + suggestions + the planned day. (Reframed away — duplicates Home/bell/modules; violates quiet-core. The bell *is* the surface.)
- **Today's committed tasks + upcoming events in the bell** — those live on Home + Calendar; duplicating them is noise.
- **Per-item sharing / access control** and a "shared-with-you" notification type — the model is workspace-wide; keep the taxonomy extensible for a future add, but build nothing now.
- **Snooze on a notification** (only dismiss in v1); **Clear-all/dismiss-all**; **realtime push**; **keyset history pagination** — recorded follow-ups.
- **The notification-preferences settings UI** — owned by **DF-19f** (in-flight). DF-21 only reads the prefs and defines the shared taxonomy.
- **Invite redemption / membership loop rebuild** — DF-24. DF-21 only surfaces the invite notification.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** filled and unambiguous.
- [x] **Every acceptance criterion has ≥1 test** with a plain-English note (table above; AC12 is cuttable and its test rides Block 6).
- [x] **Open questions is empty** — all product forks resolved with the designer; technical unknowns researched (three Explore maps) and recorded under Assumptions.
- [x] **Data model named and Supabase-first** — `notification_state.dismissed_at` + two ops; `comments_op_add` extension; a pref-key taxonomy; no new tables. Migrations identified; apply is the standard separate prod step.
- [x] **Module-feature contract:** deliberate N/A recorded (personal read surface — no new MCP tool, reuses the existing `activity` widget; spine wiring is consumed, not added) — Assumption 10.
- [x] **Execution blocks** decomposed, sequenced, context-sized, self-contained.
- [x] **Design constraints acknowledged:** tokens-only, shadcn `Popover`/`Dialog`/`Tooltip` primitives (R4), unread signalled by fill+dot+weight not color alone, DF-5 undo grammar, quiet-core (never-red, digest-default).
- [x] **Manual-test surfaces identified:** the bell dropdown, "See all" modal, invitations area, dismiss+undo, deep-link click-through, per-type copy, prefs-mute, overdue opt-in toggle — for `docs/testing/<branch>.md`. Coordination note: DF-19f owns the settings toggles (shared taxonomy in Assumption 7); DF-24 owns invite redemption.

**Ready to execute.**

## Open questions

- [ ] (none)
