# CV-6b — One device rings (client)

> Branch `t/maciej/cv-6b-device-rings` · head: see the branch · status: built, not landed
> Migration: none

## Delivered against the row

- **One device rings** (`src/components/app/notice-deliveries.tsx`, decision in `src/lib/notices/ring.ts`): the listener now takes chat rows. Chat of the notice's workspace in front of you (window focused and visible, on `/chat`, that workspace selected) → shown in place, `notice_op_ack`. Otherwise the client asks the server at once (`user_op_client_seen(id, surface, active)` → `latest`); only the latest rings. The desktop rings an OS notification (`@tauri-apps/plugin-notification`) and acknowledges; a browser tab never rings itself (its push does, after 8 s, when nobody acknowledged). A burst rings once per tag a minute (the rest acknowledged quietly). `held_for_focus` rows are left for CV-18.
- **Heartbeat** (`src/lib/notices/clients.ts`): an install id per app or tab (`moduo:client-id`, re-minted on `Unknown client.`), stamped on start, every 60 s, on focus and on becoming visible; `active` = focused, visible and touched in the last 5 minutes.
- **The landing**: the desktop's notification has no click of its own (the plugin ignores actions on desktop), so Moduo coming to the front within 10 s of a ring opens that message, switching workspace first. A browser notice opens `/chat?c=…&m=…`; when that conversation isn't the open workspace's, the app reads its workspace (one row, RLS) and switches there.
- **Push worker** (`public/push-sw.js`, `public/push-display.js`): a chat notice (tag `chat:…`) is shown even while a Moduo window is focused (a tab on another module or workspace never acknowledges); titles and text cut to push-send's 120/160; the not-signed-in line no longer says "reminder".
- **Counts:** the Chat tab counts the open workspace's open Catch up items (`catchupCount` over `chat_unread_counts.catchup`, Nothing never counts); the store re-reads its counts when your `chat_catchup` rows move (one read per settled burst). The workspace switcher shows each workspace's number, the dock badge the sum (Tauri `setBadgeCount`, capability `core:window:allow-set-badge-count`), the web the tab title "(3) Moduo" and a favicon dot (`src/lib/notices/chat-counts.ts`, `app-badge.ts`).
- **The web app asks once** (`src/components/app/chat-notice-ask.tsx`, `src/lib/notices/chat-ask.ts`): the first Chat open in a browser shows "Get a notice when someone messages you · Allow · Not now"; the answer is kept per browser (`moduo:chat-notice-ask`). Refused: Settings reads "Not allowed by the browser…"; `useBrowserNoticesOff()` and `NOTICES_OFF_LINE` ("Notifications are off in this browser") are ready for Catch up's view (CV-11).
- **Sound** (`src/lib/notices/sound.ts`): one soft Web Audio sound for a direct message or `chat_mention`, on the client that shows or rings it, off by default (`chatSound`), under the app-wide sound switch.
- **Settings → Preferences → Chat** (`preferences-section.tsx`): Direct messages · Mentions and replies · Announcements · Every message (synced `preferences.notifications.chatDirect|chatMentions|chatAnnouncements|chatEvery`), Show message text and Email when away (`user_op_set_chat_prefs`, read through `user_chat_prefs`, now in `READ_RPCS`), Sound. The browser row now says reminders and messages. `chat.mention` (not `@Team`), `chat.reply` → Mentions and replies, `chat.announcement` → Announcements in `OP_TO_NOTIFICATION_TYPE`.

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC7.6, AC2.2, AC3.1, AC1.5 | `tests/chat-notify.spec.ts` · "one device rings" (in front → acknowledged, no notice; other module + background tab → exactly one notice from the desktop; a burst → still one; another workspace → its name, the click lands there; both closed → unacknowledged and due for the push); `src/lib/notices/ring.test.ts` · "one device rings", "in front" |
| AC7.7 | `tests/chat-notify.spec.ts` · "browser permission and sound" (asks on the first Chat open, never after; refused → Settings says so); `ring.test.ts` · "the browser's one ask" |
| AC7.8 | `tests/chat-notify.spec.ts` · "browser permission and sound" (no sound by default, one switch turns it on); `ring.test.ts` · "sounds only for a direct message or @you" |
| Counts (§11) | `ring.test.ts` · "counts outside Chat" |

Run: `PUBLIC_VAPID_PUBLIC_KEY=<any P-256 public key, base64url> scripts/agent/e2e.sh tests/chat-notify.spec.ts` (2 passed). `bun run verify`: green.

The desktop app is simulated in e2e by a browser context with a stub `__TAURI_INTERNALS__` whose `window.Notification` (what the notification plugin calls) records each OS notification; each context's focus is set by the test (`document.hasFocus`, `visibilityState`). A real Web Push is not delivered in Playwright: the browser's ring is proven as the unacknowledged, due row the push claim takes (CV-6a's SQL proves the claim).

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Ask the server as the notice arrives** · agent · each client stamps itself when a chat row arrives and rings only on `latest` · a 60 s-old heartbeat lets two devices ring or none (round-3 §5 risk 7) · rejected: trusting the last heartbeat.
- **Unknown `latest` never rings** · agent · a failed stamp leaves the notice to the push · two ringing is worse than a delayed browser notice · rejected: ring when unsure.
- **"In front" on the desktop with another module open rings an OS notification** · agent · the brief: another module or workspace counts as not in front · rejected: an in-app toast.
- **Desktop click = Moduo coming to the front within 10 s of a ring** · agent · the desktop notification plugin has no click event · rejected: a click that only brings Moduo forward.
- **Burst on the desktop: one ring per tag a minute**, later rows acknowledged quietly; after the minute the next row rings with the server's "N messages: …" · agent · the OS notification can't be replaced in place · rejected: ringing every message.
- **Switch off = the latest client acknowledges quietly** (no ring, no push) · agent · the server doesn't read the switches yet (see below) · rejected: no client-side check.
- **The switcher's numbers: one `chat_unread_counts(ws)` per other workspace** (≤ 25), re-read 1.5 s after your Catch up rows settle · agent · exactly the Chat tab's rule (Later, Nothing, muted chains, team mutes) with no new RPC · rejected: one own-rows read of `chat_catchup` (re-implements the rule, drifts), a new cross-workspace RPC (a migration this block doesn't hold).
- **A DM vs an Every-message notice** (both `chat_message`): the store's conversation kind when it holds it, else the server title (a DM's names no "#channel") · agent · the row carries no reason · rejected: a migration to add one.
- **Sound for `chat_mention`** covers `@channel` and `@Team` too · agent · the row doesn't say which · rejected: a new kind.
- **The ask is a toast** (sonner, stays until answered; dismissing counts as Not now) · agent · no frame draws it; the Time & region prompt is the precedent · rejected: a banner inside v1's chat page (deleted by CV-8a).
- **Settings rows follow the brief, not frame 9's single switch**; "each key's notifications" is CV-21's (it adds the key reply reason) · agent · rejected: one master switch.
- **Bell rows follow the Chat switches** (the brief's `OP_TO_NOTIFICATION_TYPE` mapping), so a switch also hides its bell rows; Catch up still has every item · agent · rejected: leaving the bell unmapped.
- **Direct Supabase calls** from `src/lib/notices/*` (like the listener already did), no runtime change · agent · keeps `src/lib/runtime*` untouched · rejected: new `ModuoRuntime` methods.
- **Windows taskbar overlay: not built** (the badge call is a no-op there) · agent · macOS-first; an overlay needs a drawn image per count · rejected: a half overlay.
- **CV-3's sidebar-record caching: not needed** · agent · the tab count is now a sum over the badge slice, not the sidebar records · rejected: caching for a cost that no longer exists.

## Gotchas (area: ui)

- `@tauri-apps/plugin-notification`'s `sendNotification` calls `window.Notification` (Tauri injects its own); a test can record OS notifications by replacing it.
- The push worker used to drop every push while any Moduo window was focused: a chat notice must ring there (the tab may be on Tasks).
- A web build aliases `@tauri-apps/plugin-notification` to `src/lib/tauri-plugin-notification-stub.ts`; the stub now does what the plugin's JS does (`window.Notification`), so the desktop simulation can record notifications. Only code behind `isTauriRuntime()` reaches it.
- Headless Chromium answers `Notification.permission === "denied"` before anyone asks: the ask's e2e plays a browser that hasn't asked yet (stubbed permission) and needs a VAPID public key in the build (`PUBLIC_VAPID_PUBLIC_KEY`, any valid P-256 key; the spec skips the ask without one).

## For later blocks

- **CV-18 (server half of the switches):** the four switches live at `user_preferences.preferences -> 'notifications' -> 'chatDirect' | 'chatMentions' | 'chatAnnouncements' | 'chatEvery'` (`false` = off; absent = on), like `teams`. `chat__notify_devices` (or `notice__gate`) and `chat__queue_waiting_emails` read none of them yet: until they do, a switched-off kind still pushes to a browser when no client is open, and still emails. The latest open client acknowledges it quietly.
- **CV-11:** render `NOTICES_OFF_LINE` in Catch up when `useBrowserNoticesOff()` (web only).
- **CV-21:** "each key's notifications" (per-key switch) and its Settings row.
- **CV-8a:** v1's chat page toasts "That conversation isn't available" for a moment before a browser notice from another workspace switches there.
- **CV-18:** honour `held_for_focus` rows on the client (today: left alone) when the summary lands.

## Manual checklist (step → expect → surface)

- [ ] Desktop app on Chat in workspace A; teammate DMs you there → no notification; message appears; no browser notice either → desktop + browser
- [ ] Desktop on Tasks, a browser tab in the background → one desktop notification "Sofia · A"; nothing in the browser → desktop
- [ ] Three quick DMs → one notification → desktop
- [ ] A DM in workspace B while in A → notification says B; click it → Moduo opens B on that message; a running Focus keeps running → desktop
- [ ] Desktop quit, browser tab in the background with notifications on → after ~8 s a browser notification; click → the message → browser
- [ ] First Chat open in a fresh browser → "Get a notice when someone messages you · Allow · Not now"; reload → not asked again → browser
- [ ] Refuse in the browser → Settings → Preferences reads "Not allowed by the browser" → browser
- [ ] Settings → Preferences → Chat → Sound on → a DM rings with a soft sound; off → silent → desktop
- [ ] Show message text off → the next notification has no text → desktop/browser
- [ ] Dock badge shows the sum of Catch up items across workspaces; switcher shows each → desktop

## Verify before release

- Two real clients (round-3 §5 risk 7): desktop + browser, prove exactly one rings in each case above.
- Build the desktop app: `core:window:allow-set-badge-count` must be accepted by the capability schema.
- `push-sw.js` changed: browsers pick up the new worker on the next registration check; confirm a chat push shows while a Moduo tab is focused on Tasks.
- A client that was never focused (opened in the background) has no `last_active_at`, so it is never "latest": by design.
