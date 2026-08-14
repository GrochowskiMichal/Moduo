# Dogfood-fix plan (from the whole-app critique, 2026-07-09)

> **Status: RATIFIED 2026-07-10** (designer quiz round) — blocks mirrored into `specs/BUILD_ORDER.md` §"Dogfood fixes (DF)". Source: [whole-app-critique-2026-07.md](./whole-app-critique-2026-07.md) (all finding IDs below refer to it).
> **⚠ This file is the DF wave's *spec* (scope, ratified calls, ACs) — [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md) is the status of record.** The checkboxes below are a convenience mirror of the ledger; if the two ever disagree, the ledger wins.
> **Progress (reconciled 2026-08-14, DOC-1):** **23 of 24 DF blocks shipped.** Only **DF-15** (Home first-run composition) remains — and it is gated on the designer's look-approval of the draft layout, not on engineering. *(DF-18 landed the same day this reconcile ran; the count went 22 → 23 mid-session.)*
> **Ledger context (as of 2026-07-10, now superseded):** at ratification time every feature block in BUILD_ORDER was `[x]` except MCP-1 and DESKTOP-1, and the Mindmap rethink existed only in ROADMAP prose. **Both facts have since changed:** Wave 6 (Dashboard, DB-1…DB-8) and Wave D (OPS/IM/NOTE-FIX/SCALE/DOC blocks) were added to the ledger after this, and the **Mindmap rethink was removed from alpha entirely** (designer call 2026-07-29) — MCP-1 no longer waits on it.
> **Shape:** three waves. Wave A = trust-killers before dogfood day 1. Wave B = making the moat *felt*. Wave C = one-product cohesion + the pulled-forward spine features. Each block is sized for one `/s2` session, ends at `bun run verify` + validator, and names its lane so parallel sessions don't collide.

---

## Ratified designer calls (2026-07-10)

1. **Mindmap: HIDE from the alpha nav** until the rethink (DF-4 takes the S-effort path; route stays reachable for the rethink work).
2. **Billing: minimal real Settings → Billing section** — plan + trial state + a "Manage billing" button opening Stripe's hosted customer portal; no in-app card UI (DF-3). Absorbed/refined later by the Settings overhaul (DF-19).
3. **Notifications: the quiet core set** — @mention (exists) · snooze-due / follow-up-due (exists) · **assigned to you** · **your blocked task was unblocked**. Explicitly NOT: edit noise, link events, drift nags (DF-9).
4. **Home default: recompose with free slots** — same 4 widgets sized to content, ~2 free slots; draft layout goes to the designer for a look-approval inside DF-15. Widget fallback heading renamed **"Open"**.
5. **⌘N / "+": wire per-module create** — Calendar → event quick-create, Contacts → new-contact dialog, Email → compose (desktop), Home → focus Quick-capture (DF-16).
6. **Email remote images: block by default** + per-message "Load images" + per-sender allow (DF-6).
7. **Focus session: survive navigation + a quiet chrome timer chip** (elapsed + task, click → Focus) (DF-11).
8. **Settings: full feature pass** — designer verdict: *"Settings deserve a full feature pass, it's an important part of the app that currently is subpar. We need more than [hiding the stubs]."* → new block **DF-19** (starts with its own short /s1 round).
9. **Deferred spine features: pulled into Wave C** — Universal Inbox, global capture bar, cross-pane drag, @mention/-refs everywhere → **DF-20…DF-23** (the two big ones gated on a short /s1 each).

---

## Wave A — trust-killers (fix before dogfooding starts)

- [x] **DF-1 — Deep-link selection: Tasks** · `Sev Critical` · effort M · deps: — · lane: *tasks* · ✅ 2026-07-10 `t/maciej/df-1-task-deep-link`
  URL-held selection on `/tasks` (`?id=`), honor it in plan view (select + scroll + open detail), and carry the id in `entity-open.ts` for `task`/`project`. Kills the #1 dead-end everywhere it appears (dashboard Tasks widget rows, contact-hub rollup rows, note `/task` chips). AC-sketch: click a task in the Home widget → lands selected; refresh keeps selection; invalid id degrades to unselected without a crash. *(Critique: CC-1, live-confirmed.)*
- [x] **DF-2 — Deep-link selection: Calendar + Email** · `Sev Critical` · effort M · deps: DF-1 (pattern) · lane: *calendar/email* · ✅ 2026-07-11 `t/maciej/df-2-deeplink-calendar-email`
  Calendar: `?event=` → navigate to the event's day/week + select + open detail. Email: accept an inbound thread target (URL or a one-shot event payload), select + scroll in the thread list on desktop; on web, route to the thread's tissue card. *(CC-1, §4.3, §4.6.)*
- [x] **DF-3 — Trial/billing fix pack** · `Sev Critical` · effort M · deps: — · lane: *platform* · ✅ 2026-07-10 `t/maciej/df-3-trial-billing`
  (a) Replace `trial-banner.tsx`'s raw fetch with the shared `supabaseClient` — kills the silent env-dependent 401 (`trial-banner.tsx:42-51`). (b) **Ratified:** add a minimal Settings → Billing section (plan + trial state + "Manage billing" → Stripe hosted portal); point the CTA there; fix `onboarding-page.tsx:105` copy. (c) Log/telemetry the SubscriptionGate fail-open path. *(CC-7. DF-19 refines the section later.)*
- [x] **DF-4 — Hide Mindmap for alpha** · `Sev Critical` · effort S · deps: — · lane: *platform* · ✅ 2026-07-10 `t/maciej/df-4-hide-mindmap`
  **Ratified: hide.** Remove from nav tabs + palette + `module-N` shortcuts (mind the five-wiring gotcha in reverse); keep the route reachable for the rethink; remove the leaked "Graph relations tree, feature coming soon" placeholder from its right panel. *(§4.7.)*
- [x] **DF-5 — Destructive-action safety pack (app-wide undo grammar)** · `Sev High` · effort M · deps: — · lane: *contacts/cross* · ✅ 2026-07-10 `t/maciej/df-5-undo-grammar`
  One undo grammar everywhere (the §8.3 inventory): **task delete in the Tasks module gets an 8s Undo** (today: ⌘⌫ = silent permanent delete, while the same task deleted from a note undoes — the app's sharpest edge); contact-delete Undo (soft server-side already); calendar-event-delete toast+Undo; tag-delete feedback; habit-remove window 4s→8s; the trash toast's destructive "Delete task(s)" out of the `cancel` slot; API-key revoke confirm; company-delete guard ("N people work here") + clear-company affordance. Standardize 8s + one success-toast grammar. *(§4.5, §8.3.)*
- [x] **DF-6 — Email daily-use pack (desktop)** · `Sev High` · effort L · deps: — · lane: *email (desktop)* · ✅ 2026-07-10 `t/maciej/df-6-email-pack`
  Remote-image blocking by default (+ per-sender allow), reader iframe auto-height (postMessage scrollHeight), visible sync state + manual refresh + an "account broken" banner on All-inboxes scope, convert-to-task compensating cleanup on mid-sequence failure. *(§4.6 — the four blockers; keyboard `?`/`r` can ride along if the session has room.)*

## Wave B — making the moat felt

- [x] **DF-7 — Rollup snippets + company parity** · `Sev High` · effort M · deps: — · lane: *contacts/spine* · ✅ 2026-07-12 `t/maciej/df-7-rollup-snippets`
  Register snippet projectors for task ("in progress · due Fri"), note (first-line), event (date/time), email (subject · sender); CompanyHub last-touch line parity. Defer last-touch-from-linked-activity to the ledgered CO-2(b) decision unless it falls out cheap. *(§4.5 blockers 1+5.)*
- [x] **DF-8 — Tasks joins the spine** · `Sev High` · effort M–L · deps: DF-1 · lane: *tasks* · ✅ 2026-07-11 `t/maciej/df-8-tasks-spine`
  EntityHub (linked notes/emails/contacts/events) in the task detail panel + accept drag-to-link drops on it. Makes the most-linked-to entity show its links. *(CC-12.)*
- [x] **DF-9 — Notification generation v1** · `Sev High` · effort M · deps: — · lane: *spine* · ✅ 2026-07-12 `t/maciej/df-9-notification-generation` (migration `20260712120000_df9_task_notifications.sql` applied to prod 2026-07-13)
  **Ratified event set:** @mention (exists) · snooze/follow-up-due (exists) · assigned-to-you · blocked-task-unblocked — nothing else. Wire into the existing ops (`notify_user_ids`/`mentioned_user_ids` payloads); route `email_thread` in `notificationDeepLink`. The bell UI already groups correctly — this is generation only. *(CC-4.)*
- [x] **DF-10 — Palette searches entities** · `Sev High` · effort M · deps: — · lane: *platform* · ✅ 2026-07-11 `t/maciej/df-10-palette-search`
  Wire `runtime.spine.searchEntities` into the command palette (debounced, grouped by type, deep-links via the DF-1/DF-2 selection); fix the placeholder copy until then. *(CC-3.)*
- [x] **DF-11 — Focus session survives navigation** · `Sev High` · effort M · deps: — · lane: *tasks* · ✅ 2026-07-11 `t/maciej/df-11-focus-nav`
  Lift the Execute/Focus timer to an app-level context; quiet chrome chip (timer + task title) while running; capture affordance inside Focus when the queue empties. *(CC-14, §4.2.)*
- [x] **DF-12 — Boot fetch consolidation** · `Sev High` · effort M–L · deps: — · lane: *platform* · ✅ 2026-07-11 `t/maciej/df-12-boot-fetch`
  One `auth/user` + one profiles + one workspaces fetch per boot (shared provider or query cache); stop `dashboard_layouts` writing during the read path; dedupe notifications reads. Add a boot-request budget test if cheap. *(CC-13 — counts are real, no StrictMode.)*
- [x] **DF-13 — Notes editor baseline + public page reach** · `Sev High` · effort M · deps: — · lane: *notes* · ✅ 2026-07-10 `t/maciej/df-13-notes-baseline`
  `MarkdownShortcutPlugin` + `⌘B`/`⌘I` + a minimal selection toolbar; unify the checkbox shape (square `/todo` vs round task-line — pick the round `CompleteToggle`); a persistent right-panel summon affordance. Public page (§8.2): child-nav toggle on narrow viewports, authored page order (edge fn gains a position field), loading-state polish. *(§4.4 must-fixes 1/2/5, §8.2.)*

## Wave C — one-product cohesion

- [x] **DF-14 — Selection + accent unification** · `Sev High (visual)` · effort M · lane: *design-system* · ✅ 2026-07-10 `t/maciej/df-14-selection-unify`
  One selection recipe (`--selected-bg` tint + dimmed `hover:bg-accent/60`) across contacts/notes/email/calendar lists; de-tint the five appearance pickers (R5); run `moduo-design-quality` audit as the gate. *(§5 A1 + C1 — the highest cohesion-per-effort fixes.)*
- [ ] **DF-15 — Home first-run composition** · `Sev Medium` · effort S–M · deps: — · lane: *dashboard* · ⏳ **STILL OPEN** — gated on the designer's look-approval of the draft layout
  **Ratified: recompose with free slots** — same 4 widgets sized to content, ~2 free slots; draft layout screenshotted for designer look-approval before merge. Anchor/fill widget content in its frame (tasks list growth, capture input placement, clock centering); rename the fallback heading → **"Open"**; move toasts off the edit controls. *(CC-2 residuals.)*
- [x] **DF-16 — Dead-chrome + copy sweep** · `Sev Medium` · effort M · lane: *platform* · ✅ 2026-07-11 `t/maciej/df-16-dead-chrome`
  Feature-settings no-op button (hide or wire); **ratified: wire per-module create** for `⌘N`/"+" (Calendar → event quick-create · Contacts → new-contact dialog · Email → compose on desktop · Home → focus Quick-capture); About/paywall local-first copy → cloud-first truth; a `?` shortcuts sheet; show a workspace label at 1 workspace; palette permission-filtering. *(CC-9, CC-10, §4.8. Settings stubs moved to DF-19.)*
- [x] **DF-17 — Legacy deletions** · `Sev Medium` · effort M · lane: *cleanup* · ✅ 2026-07-27 `t/maciej/df-21def-comment-overdue-email`
  Delete the dead `email-workspace.tsx` tree (~108 hex, stories-only); token-route or quarantine `EmbeddedMindmap.tsx`; mindmap dead code per call #1; onboarding/paywall re-skin onto tokens (first-impression surfaces). *(§5 B.)*
- [x] **DF-18 — Eyebrow / header / toolbar standardization** · `Sev Medium` · effort M · lane: *design-system* · ✅ 2026-08-14 `t/maciej/df-18-eyebrow-toolbar` (one `Eyebrow` primitive + a drift guard that fails the build on any hand-rolled `uppercase` class; one `DetailTitle` scale; `Toolbar` gained a gap axis and real roving-tabindex keyboard nav; `lint:tw` now catches named palette utilities — §B4 closed)
  One eyebrow spec (`font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground`) extracted as a component; one detail-panel title scale; migrate calendar/contacts/notes toolbars onto `Toolbar`; extend `lint:tw` to catch named palette utilities (`text-red-400` class). *(§5 A2–A4, B4.)*
- [x] **DF-19 — Settings overhaul** · `Sev High` · effort L · deps: ~~short /s1 first~~ (done 2026-07-11 → [`specs/settings-overhaul.md`](../../specs/settings-overhaul.md)) · lane: *platform* · ✅ sub-blocks DF-19a…i, 2026-07-11 → 2026-07-12; the held Notifications slice shipped as **DF-19f-notif** 2026-07-12 + **DF-19f-quit** 2026-07-13
  **Ratified 2026-07-10:** designer wants a full feature pass, not stub-hiding — Settings is "an important part of the app that currently is subpar." Scope to grill in the /s1: section architecture (what exists vs Preferences/Advanced stubs), where API keys live (today split between Settings and the workspace modal), billing's final home (absorbs DF-3's minimal section), integrations organization, appearance-picker layout (+ DF-14's de-tint), device-local vs synced messaging, About-copy truth. *(§4.8 S2/S3/S6 + designer verdict.)*
- [x] **DF-20 — Global capture command bar** · `Sev High` · effort L · deps: — · lane: *spine* · ✅ 2026-07-11 `t/maciej/df-20-global-capture`
  **Pulled into Wave C (ratified).** ⌘-something anywhere → one capture line → routes to task (default) with `/note` `/event` `/contact` prefixes; reuses the quick-capture write path (`seedInbox`+`upsertTask`) and the palette's surface. *(CC-11.)*
- [x] **DF-21 — Universal Inbox** · `Sev High` · effort L–XL · deps: ~~DF-9 + short /s1 first~~ (both done; /s1 2026-07-13 → [`specs/universal-inbox.md`](../../specs/universal-inbox.md)) · lane: *spine* · ✅ sub-blocks DF-21a…f — a/b/c 2026-07-13, d/e/f built 2026-07-14 and landed 2026-07-27. **Reframed by the designer:** not a new route — the notification bell grew into the cross-module feed.
  **Pulled into Wave C (ratified).** One cross-module attention surface (notifications + snoozes/follow-ups due + drifted tasks + suggested links). The /s1 decides: its own route vs a Home widget vs the bell sheet growing into it. *(CC-11.)*
- [x] **DF-22 — Cross-pane drag-to-link** · `Sev Medium` · effort L · deps: DF-8 (tasks accept drops) · lane: *spine* · ✅ 2026-07-11 `t/maciej/df-22-cross-pane-drag`
  **Pulled into Wave C (ratified).** One app-level DndContext so a drag can cross panes (task → contact, email → task); per-module contexts become `useDndMonitor` consumers (the NO-7b pattern, gotchas §Drag). Riskiest block — schedule last in its lane. *(CC-6.)*
- [x] **DF-23 — @mention + /ref beyond Notes** · `Sev Medium` · effort L · deps: DF-1/DF-2 (deep-links must land) · lane: *spine* · ✅ 2026-07-11 `t/maciej/df-23-mention-ref-everywhere`
  **Pulled into Wave C (ratified).** Bring the mention/ref plugins to the task description, email compose (Lexical already), and calendar event notes; requires Lexical-izing the task description `<Textarea>` (the ratified-editor precedent — no silent downgrade). *(CC-5.)*
- [x] **DF-24 — Workspace membership loop** · `Sev Critical (for multiplayer)` · effort M · deps: — · lane: *platform* · ✅ 2026-07-11 `t/maciej/df-24-membership-loop`
  Close the invite loop (§8.1): an accept surface reachable by a brand-new user (`/join/:token` route or an invite-code field — today `joinWorkspace`'s only consumer hides at ≤1 workspace, so **every real invitee has nowhere to redeem**); member names/avatars from the already-fetched `profiles` join (today: truncated UUIDs); leave-workspace UI (plumbed, zero consumers) + a remove-member op; catch-and-toast invite/role errors; be honest about delivery (share-a-code until an email fn exists). DF-19's /s1 decides the permission-editor question. *(§8.1.)*

## Explicitly deferred (recorded, not planned here)

- **Booking links, day-fullness, one-tap reflow** — already spec-deferred in `specs/calendar.md` (§4.3).
- ~~**Mindmap rethink proper** — its own /s1 planning round (ROADMAP already sequences it); DF-4 hides it meanwhile.~~ → **Superseded 2026-07-29: the Mindmap is OUT of alpha entirely** (designer call). It stays hidden from nav but URL-reachable, and **MCP-1 no longer waits on it.**
- **MCP-1** stays the pre-alpha gate after the DF waves; **DESKTOP-1** (updater) is now unblocked by the dashboard landing — schedule at will.
- **What came after this plan:** the DF wave is no longer the whole remaining backlog. **Wave D** (added 2026-07-29 — OPS-1/OPS-2 schema work, the IM import lane, NOTE-FIX-1, SCALE-1, DOC-1, and the alpha lane) sits alongside DF-15/DF-18 in [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md). Read the ledger, not this file, for what to build next.

## Suggested parallel-session assignment

*(Historical — the lanes below were the 2026-07-10 execution plan. Everything in them has shipped except DF-15.)*

| Session lane | Blocks in order |
| --- | --- |
| tasks | DF-1 → DF-8 → DF-11 |
| calendar/email | DF-2 → DF-6 |
| platform | DF-3 → DF-4 → DF-10 → DF-12 → DF-16 → DF-24 → DF-19(/s1→/s2) |
| contacts/spine | DF-5 → DF-7 → DF-9 → DF-20 → DF-21 → DF-22 → DF-23 |
| notes | DF-13 |
| design-system/cleanup | DF-14 → DF-15 → DF-17 → DF-18 |

Merge-barrier rule applies (gotchas §Git): explicit block per session, merge into `maciej` before the next round; don't run two blocks that touch `entity-open.ts`/app-chrome concurrently (DF-1/DF-2/DF-10).
