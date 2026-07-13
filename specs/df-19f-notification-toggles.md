# Spec: Settings → Preferences → Notification toggles (held DF-19f sub-slice)

> Status: **Draft — DoR-ready** · Owner: maciej · Parent: [`specs/settings-overhaul.md`](./settings-overhaul.md) (DF-19f row · AC10 · "Preferences → Notifications before DF-9" edge case) · Unblocked by **DF-9** (notification generation, landed 2026-07-12)

## Scope

The one piece of DF-19f that shipped **held**: per-type notification toggles for the quiet set — **Mentions · Assigned to you · Due & follow-up · Task unblocked** — added to the existing synced `preferences` jsonb domain, rendered as a new **"Notifications"** group at the top of the Preferences section. Default **all on** (matches today's always-notify). DF-9 landed the two new generated types (`tasks.assigned`, `tasks.unblocked`) alongside the already-live `comments.add` (@mention) and `email.snooze_due`/`email.follow_up_due` (due) types, so the read path now carries all four — the toggle must respect **every** live type, not just DF-9's two.

Also folds in a decision (not the build) for the **desktop confirm-before-quit** toggle that was held with this slice: it rides a **separate desktop-only block** (rationale in §Confirm-before-quit).

**Not in scope:** any migration (the `preferences` column already exists and is applied to prod — DF-19f); any change to notification *generation* (the DF-9 trigger, the email due ops, `comments_op_add`); any new notification type; push/email digest suppression; the confirm-before-quit Tauri wiring (its own block).

## The key decision — how muting suppresses (read-side, client filter)

DF-9 generates notifications via a `SECURITY DEFINER` trigger `tasks_notify_spine` on `public.tasks` that writes `module_activity` rows; the bell reads them through `notifications_list` → `spine_activity_targets_me` → the client reducer in [`src/features/spine/notifications.ts`](../src/features/spine/notifications.ts). Two ways to make a mute suppress:

- **(a) Generation-side** — the trigger (and the email due ops, and `comments_op_add`) read the *recipient's* `user_preferences.preferences->'notifications'` before writing the row.
- **(b) Read-side** — the muted types are filtered out of the feed the user reads, keyed on the row's `op` token.

**Recommendation: (b) read-side, implemented as a pure client-side filter at the feed choke point. Zero migration.** Rationale, decisive-first:

1. **It's the ratified direction.** The DF-19f decision (docs/decisions.md, 2026-07-12) explicitly reserves this sub-slice for a **"no migration, opaque jsonb"** add — "data-model reserved for zero-migration add." Generation-side (a) needs migrations to **four** SQL writers across three files (the DF-9 trigger + both email due ops + `comments_op_add`); an SQL read-side filter in `notifications_list` still needs a migration. Only a **client** read-side filter needs zero SQL. Honor the ratified constraint.
2. **Reversibility — the semantics a *preference* wants.** Read-side keeps every row in `module_activity`; a mute only *hides* it. Un-muting restores the type retroactively (the rows persist). Generation-side is lossy: a muted week is gone forever, un-muting shows nothing past. Moduo's principle is "quiet, not gone" (graceful slippage / never a red wall) — a toggle should hide, not destroy.
3. **One place, all four types, uniformly.** Every normalized `NotificationItem` (spine **and** legacy) already carries its `op`, and each quiet type maps to a distinct op token (table below) — the map is unambiguous. Generation-side would thread a recipient-pref read into four different writers, including the hottest, most-proven op in the system (`comments_op_add` / @mention). Read-side is one pure function at one array choke point.
4. **No cross-user reads / no new coupling.** Generation-side makes the *actor's* `SECURITY DEFINER` trigger read the *recipient's* settings row on every task write — a cross-user read baked into the write path, plus per-generation latency. Read-side reads only the caller's own pref (already loaded + synced via `usePreferences()`).
5. **Independent of DF-9's prod-apply state.** The DF-9 trigger migration is **still pending prod apply** (`apply_migration` denied ×2 in the non-interactive `/s2`). A read-side filter is type-agnostic: it needs only the DF-9 *type tokens* (defined in code, already merged), not the trigger being live. It governs `tasks.assigned`/`tasks.unblocked` automatically the moment those rows start generating, and today already governs the live mention/due types. Building generation-side muting on top of an unapplied trigger would compound deploy risk.
6. **Testability.** The op→type→enabled decision is a pure function → trivial vitest unit tests (no DB round-trip, no `.tsx` import → dodges the `@/lib/utils` alias trap). Generation-side needs a live DB to verify.

**Accepted cost of read-side:** muted rows still occupy the `notifications_list` window (`LIMIT 50` bell / `40` widget) and cross the wire. At quiet-core alpha volume this is negligible. **Future, additive upgrade path** (recorded, not built): if volume ever explodes or server-enforced muting is needed (e.g. to also gate a future push/email digest), move the *same* op→type map into `notifications_list` — it reads the **caller's own** pref via `auth.uid()` (no cross-user read, no generation change). That is a clean later migration, not a redo.

### Type → op map (the pure logic — lives in `src/lib/preferences.ts`)

| Toggle (`NotificationType`) | Governs op token(s) | Predicate branch it rides |
| --- | --- | --- |
| `mention` | `comments.add` | `mentioned_user_ids` @> me, actor ≠ me |
| `assigned` | `tasks.assigned` | `mentioned_user_ids` @> me, actor ≠ me |
| `dueFollowUp` | `email.snooze_due`, `email.follow_up_due` | `notify_user_ids` @> me (actor-agnostic) |
| `unblocked` | `tasks.unblocked` | `notify_user_ids` @> me (actor-agnostic) |

Every `comments.add` row that reaches the feed is already a mention-to-me (it only passes `spine_activity_targets_me` via the mention branch), so `comments.add → mention` is exact in the notification context. Any op **not** in the map (legacy workspace invites/membership, any future type) returns **enabled = true** — mutes are opt-in per *known* type; nothing unknown is ever silently hidden ("no over-eager control").

## Product behavior & UX

**Preferences section (`preferences-section.tsx`) gains a new `Notifications` `PrefGroup` at the very top**, above "Default landing view":

- Group eyebrow: **Notifications**. Four `PrefRow`s, each a title + one-line description + a `Switch` (shadcn primitive, already used in the section). All bound to `preferences.notifications.<type>`; all default **on**.
  1. **Mentions** — "When someone @mentions you in a comment."
  2. **Assigned to you** — "When a task's owner is set to you by someone else."
  3. **Due & follow-up** — "Snoozed and follow-up items that come due." *(today: email; any future due-reminder type joins this toggle.)*
  4. **Task unblocked** — "When the last thing blocking a task is finished."
- A one-line group intro under the eyebrow (matching the section's voice): *"Which alerts reach your bell. Muting hides a type — nothing is deleted, and turning it back on brings it back."*
- Flipping a switch writes through `usePreferences().setPreferences({ notifications: { ...current, [type]: v } })` — instant local update + localStorage mirror + cross-device push (same path as every other pref). No save button, no toast (consistent with the rest of Preferences).

**Effect (the bell + Home Activity):** the muted type's rows disappear from the notification bell **and** its unread badge, and from the dashboard **Activity** widget (same per-user `notifications_list` feed). Non-muted types are untouched. The change is live on next feed refresh (`refreshNotifications` fires on workspace resolve, scope switch, and `moduo:data-refresh`; the widget on its own refetch triggers) — no reload required.

**States:**
- *Populated / default:* all four on; nothing filtered; bell identical to today.
- *One or more muted:* those rows + their unread contribution vanish from bell, badge, and Activity widget; the rest render normally.
- *Empty:* if muting empties the current scope, the bell shows its existing "No notifications yet." empty state (unchanged).
- *Loading / error / offline:* the pref is read from the synced store (localStorage mirror = instant first paint; defaults all-on if never set); the feed still loads/degrades exactly as today. A pref read never gates the feed — if `notifications` is somehow absent, sanitize defaults it all-on (fail-open, never hide).
- *Cross-device:* a mute set on device A syncs to B (LWW on the `preferences` domain, same as landing view). B's next feed refresh reflects it.

## Assumptions & technical decisions

1. **Suppression = read-side client filter.** See §The key decision. **No migration, no `prefs-columns.ts` change** (the `preferences` column already exists + is applied to prod).
2. **Domain shape (opaque jsonb — extend `src/lib/preferences.ts`):**
   ```ts
   export type NotificationType = "mention" | "assigned" | "dueFollowUp" | "unblocked";
   export type NotificationPrefs = Record<NotificationType, boolean>;
   export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs =
     { mention: true, assigned: true, dueFollowUp: true, unblocked: true };
   ```
   Added to `Preferences` as `notifications: NotificationPrefs`, to `DEFAULT_PREFERENCES`, and to `sanitizePreferences` (coerce each key to boolean, **missing → true** so a new type added later defaults on for existing users; the whole `notifications` object missing → the all-on default). The full `preferences` object is what syncs, so the nested object round-trips for free (jsonb).
3. **Pure helpers in `preferences.ts` (unit-tested):**
   - `DEFAULT_NOTIFICATION_PREFS` (all-on).
   - `notificationTypeForOp(op: string): NotificationType | null` — the op→type map above.
   - `isNotificationEnabled(op: string, prefs: NotificationPrefs): boolean` — `notificationTypeForOp(op)` is `null` → `true` (unknown op shown); else `prefs[type]`.
   Kept dependency-free (takes `op: string` + prefs, not `NotificationItem`) so `preferences.ts` imports no feature/component code and the test imports it relatively (`./preferences`) — dodges the `@/lib/utils` vitest alias trap (gotchas §Repo/build).
4. **The two read choke points** (both filter the raw item array **before** grouping and before any unread count, so bell list + badge + widget stay consistent):
   - **Bell + badge:** [`src/providers/workspace-provider.tsx`](../src/providers/workspace-provider.tsx) `refreshNotifications` — insert `.filter((i) => isNotificationEnabled(i.op, prefs))` on `all` (the merged `[...spine, ...legacy]`) **before** it splits into `workspaceFeed`/`globalFeed` and computes both `setUnreadCount*`. The provider reads the pref from the shared preferences store (`readLocalPreferences()` synchronously, or subscribe) — it is not a React consumer of `usePreferences` today; use the store read to avoid re-architecting the provider. Re-run on pref change (add the notifications slice to `refreshNotifications`' deps or listen for the pref store change).
   - **Home Activity widget:** [`src/features/dashboard/context/dashboard-data-context.tsx`](../src/features/dashboard/context/dashboard-data-context.tsx) `notifications` source (`rt.spine.listNotifications`) — filter its result the same way, or filter at the widget before `groupNotifications`. One shared pure helper, applied at both sites, keeps "muted in the bell" == "muted on Home."
5. **`confirmBeforeQuit: boolean` field is added in THIS block** (defaults `false`), even though its Tauri wiring ships in the separate desktop block — so the domain edits live in one place and the desktop block never re-touches `preferences.ts` (parallel-lane-safe). An inert *data field* in an opaque blob is not a "lying control" (no UI here); it's the reserved-capacity pattern the decision already blessed.
6. **Rollout window (graceful):** during the merge-before-deploy gap, an older client (pre-this-block) that writes the `preferences` blob last would omit `notifications`; the new client's `sanitizePreferences` re-defaults it all-on. That's a fail-open degrade (mutes reset to all-on if an old client wins LWW), same class as the existing deploy-gap guard. Negligible at single-version alpha; noted, not mitigated.
7. **Data model = Supabase-first**, no new tables/columns (opaque jsonb reuse). **Spine wiring / MCP tools / dashboard widget = N/A** — this is a settings control on a platform surface, the deliberate DoR exception recorded for all of DF-19 (settings-overhaul §"Module-feature spine wiring — N/A").
8. **Design constraints:** tokens-only, shadcn `Switch`/`Select` already in the section; the new group reuses the existing `PrefGroup`/`PrefRow` helpers verbatim — no new primitive, no new story needed. `DESIGN_RULES.md` R1–R4 satisfied by reuse.

## Edge cases

- **Unknown / legacy op** (workspace invite, membership, any future type) → `isNotificationEnabled` returns `true`; never hidden by these four toggles.
- **Mute empties a scope** → bell shows the existing "No notifications yet." empty state; no crash, no phantom badge.
- **Badge vs list drift** → prevented by filtering the raw array before *both* `groupNotifications` and the unread counts (one insertion point per read site).
- **Muted rows consume the `LIMIT` window** → a muted-heavy feed could show fewer visible items than the cap; accepted at alpha volume (recorded in §Assumptions cost).
- **`notifications` absent in the synced blob** (old row, first run) → sanitize defaults all-on (fail-open — never hide when the pref is unknown).
- **DF-9 trigger not yet applied to prod** → no `tasks.assigned`/`tasks.unblocked` rows generate, so those two toggles have nothing to hide *yet*; mention + due toggles work on the live types today. The toggles are correct and inert-safe until the trigger deploys; they need no re-touch when it does.
- **Cross-device LWW** → a mute syncs like landing view; last writer wins the whole `preferences` blob (documented behavior, not a regression).
- **`prefers-reduced-motion` / a11y** → each row is a labelled `Switch` with `aria-label` (matches the existing Sound switch); color is not the only signal (label + switch state).

## Acceptance criteria

- **AC1 — Toggles persist (synced), default all-on.** The Notifications group renders four switches (Mentions · Assigned to you · Due & follow-up · Task unblocked), all **on** by default; flipping one persists to the synced `preferences` domain and survives reload; a fresh account with no stored pref reads all-on.
- **AC2 — Muting suppresses in the bell + badge.** With a type muted, its `module_activity` rows are absent from the notification bell list **and** do not count toward the unread badge (workspace or global scope); un-muting restores them (rows were never deleted).
- **AC3 — All four live types respected.** The op→type map governs the already-live `comments.add` (mention) and `email.snooze_due`/`email.follow_up_due` (due) as well as DF-9's `tasks.assigned`/`tasks.unblocked` — not just the two new ones.
- **AC4 — Unknown types never hidden.** An op with no mapped type (legacy invite/membership, any future op) is always shown regardless of toggle state.
- **AC5 — Home Activity widget honors the mute.** The dashboard Activity widget (same `notifications_list` feed) hides the same muted types as the bell.
- **AC6 — No migration / generation change.** The block adds no migration and does not alter the DF-9 trigger, the email due ops, or `comments_op_add`; the `preferences` column is reused as opaque jsonb.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/settings/preferences.test.ts` · "notifications default all-on" | AC1 | `DEFAULT_NOTIFICATION_PREFS` = all true; `sanitizePreferences({})` yields `notifications` all-on; a partial/garbage `notifications` blob coerces per-key with missing → true. |
| `src/features/settings/preferences.test.ts` · "op → notification type map" | AC3 | `notificationTypeForOp` maps `comments.add`→mention, `tasks.assigned`→assigned, `email.snooze_due`/`email.follow_up_due`→dueFollowUp, `tasks.unblocked`→unblocked. |
| `src/features/settings/preferences.test.ts` · "isNotificationEnabled honors + fails open" | AC2, AC4 | Enabled when the type is on; hidden when off; **true** for an unmapped op (e.g. `workspace.invite_accepted`) whatever the prefs. |
| `src/features/settings/preferences.test.ts` · "confirmBeforeQuit defaults false, sanitizes" | AC1 | New `confirmBeforeQuit` field defaults `false`, coerces to boolean, survives round-trip through `sanitizePreferences`. |
| `src/lib/prefs-sync.test.ts` · "preferences domain carries notifications" (extend existing) | AC1, AC6 | The `preferences` blob round-trips the nested `notifications` object through push/reconcile LWW unchanged — no new column. |

*(The two filter insertion points — provider + dashboard context — are React/runtime wiring; they're proven by the pure `isNotificationEnabled` unit tests above + **live verification** on the hosted account, per the manual-test checklist. Do not import `preferences-section.tsx` or the provider `.tsx` into vitest — alias trap.)*

## Confirm-before-quit — separate desktop-only block (decision)

**Decision: it does NOT ride this block. It ships as its own desktop-only block, sequenced after this one.** Why:

- **Different surface, real integration cost.** No scaffolding exists today: `@tauri-apps/api/window` is unused (only `/core`'s `invoke` is imported, and web builds alias it to a stub). Confirm-before-quit needs `getCurrentWindow().onCloseRequested()` from `@tauri-apps/api/window` (a new import surface needing the same web-stub/alias or a desktop-only dynamic import), a Tauri **capability permission** for the close-request listener in `src-tauri/capabilities/default.json`, a handler that reads `preferences.confirmBeforeQuit` and shows a confirm, a desktop-only mount point, and a **desktop verification pass** — the web preview cannot exercise an `isDesktop`-gated close handler (exactly why DF-19f held it: "unverifiable this web session").
- **Don't drag desktop verification onto a clean web-verifiable slice.** The notif toggles are pure client logic + a UI group, fully web-verifiable and valuable now (DF-9 landed). Bundling would block their clean ship behind a desktop build.
- **Cheap coordination.** This block already adds the `confirmBeforeQuit` field to the `preferences` domain (§Assumptions 5), so the desktop block is **domain-edit-free** — it only adds the Tauri wiring + one desktop-gated `PrefRow` in the existing "Startup" group + the capability grant. It therefore **depends on this block** (for the field + to avoid a `preferences-section.tsx` conflict) and should not run concurrently on that file.
- **Recommended default `confirmBeforeQuit: false`** (opt-in guard, not a default nag; "kept light" per the spec) — a small product call the designer can flip; recorded as an assumption for the desktop block, not a blocker.

## Execution blocks (for BUILD_ORDER)

- **DF-19f-notif — Notification type toggles** · deps: DF-9 (done) · lane platform · **This block.** Extend `preferences.ts` (`NotificationType`/`NotificationPrefs`/`DEFAULT_NOTIFICATION_PREFS`, add `notifications` + `confirmBeforeQuit` fields to `Preferences`/`DEFAULT_PREFERENCES`/`sanitizePreferences`, pure `notificationTypeForOp`/`isNotificationEnabled`); add the read-side filter at the two feed choke points (`workspace-provider.tsx`, `dashboard-data-context.tsx`); add the "Notifications" `PrefGroup` (4 switches) to the top of `preferences-section.tsx`. Unit tests in `preferences.test.ts` (+ extend `prefs-sync.test.ts`). **No migration.** Context-sized, self-contained, web-verifiable.
- **DF-19f-quit — Desktop confirm-before-quit** · deps: **DF-19f-notif** (domain field + section file) · lane desktop · Tauri `onCloseRequested` handler reading `preferences.confirmBeforeQuit`; capability grant; one desktop-gated `PrefRow` in the Startup group. **Desktop verification required.** Do not run concurrently with DF-19f-notif on `preferences-section.tsx`.

## Manual-test surfaces (for `docs/testing/<branch>.md`)

- Preferences → Notifications group renders 4 switches, all on; flip each, reload, state persists (web).
- Mute **Mentions**, have another member @mention you → no bell card, badge unchanged; un-mute → the card reappears (web, 2 members).
- Mute **Due & follow-up** with a live snooze-due/follow-up-due email notification present → it drops from bell + badge; un-mute restores (desktop, email synced).
- Mute **Task unblocked**: seed a `module_activity` row op `tasks.unblocked` targeting me (or, once the DF-9 trigger is applied, close the last blocker) → it drops from bell + Home Activity widget; un-mute restores (web).
- **Assigned to you** live proof is gated on the DF-9 trigger prod-apply (known gap until applied) — covered meanwhile by the op→type unit test + the generic filter path.
- Cross-device: mute on web, confirm the mute syncs (LWW) on a second session.

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note. (AC1→defaults/sanitize/sync; AC2→isNotificationEnabled+live; AC3→op-map; AC4→fail-open; AC5→shared helper+live; AC6→no-migration is a build constraint verified by the diff + prefs-sync round-trip.)
- [x] **Open questions is empty** — the key suppression decision is resolved (read-side client filter) with rationale; the confirm-before-quit routing is resolved (separate desktop block); the default for `confirmBeforeQuit` is chosen (false) and recorded.
- [x] **Data model is named and Supabase-first** — reuses the existing `user_preferences.preferences` opaque jsonb column; **no new tables/columns/migrations** (deliberate, recorded); no `prefs-columns.ts` change.
- [x] For a **module feature**: **N/A — deliberate exception** (settings is a platform surface; the DF-19 spine/MCP/widget exception applies).
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained (DF-19f-notif now; DF-19f-quit after, desktop).
- [x] **Design constraints acknowledged** — tokens-only; reuses the section's shadcn `Switch` + `PrefGroup`/`PrefRow`; no new primitive/story; R1–R4 met by reuse.
- [x] **Manual-test surfaces identified** for the wrap-up checklist (above).

**Ready to execute.**
