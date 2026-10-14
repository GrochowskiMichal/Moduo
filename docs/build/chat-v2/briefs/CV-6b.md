# CV-6b: One device rings (client)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-6b-device-rings`; record `docs/build/chat-v2/CV-6b.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 6b | **CV-6b** One device rings *(client)* | the desktop's OS notifications when Moduo isn't in front and the ack; web push through the service worker after 8 s; bursts per tag; the dock, tab and switcher counts; the browser's one-time ask and its refused state; sound; Settings → Notifications' chat rows (the five switches, Show message text, Email when away, Browser); `tests/chat-notify` | AC7.6–7.8, AC2.2, AC3.1, AC1.5 | 6a, 3 |

**Depends on:** CV-6a (the rows, `user_op_client_seen`, `notice_op_ack`, `user_chat_prefs()`), CV-3 (the store's unread slice for counts).

## 2. What to build

**§11 Notifications: the table, all of it** (prototype frame 9)
Chat adds rows to the app's one pipeline (TV-D12) and never builds its own sender. A device notice reaches you **only when Moduo isn't in front of you** (another app, another module or another workspace counts), **in any workspace**, with the workspace's name; a message's push goes out **at once** from the write, not on the minute; **only one device rings** (your most recently active client; a client that has your attention shows the message in place and acknowledges); a browser rings only when nothing acknowledged within 8 s; a burst in one conversation replaces the last notice ("Sofia · 3 messages"); a click lands on the message. What a notice shows: the sender and the conversation, and the text, with a switch "Show message text" for people who share their screen (CH33); references are drawn as names you can see. **Sound:** one soft sound for direct messages and `@you`, off by default (CH34). **The web app asks once**, the first time you open Chat in a browser ("Get a notice when someone messages you · Allow · Not now"); refused, Catch up says notifications are off in this browser (CH44). **"Count":** a conversation's number is how many of its unread messages are addressed to you (on "Every message", every unread one); the Chat tab, the workspace switcher and the dock or taskbar badge count open Catch up items (an "Every message" conversation is one item; an item from a conversation set to "Nothing" never counts, CH40), per workspace and summed. **The switches** in Settings → Notifications are Direct messages · Mentions and replies · Announcements · Every message · each key's notifications; a switch turns off the device notice and the email for its rows and nothing else (the bell row and the Catch up item are always written).

**§15 Settings, and where each thing lives**
- **Settings → Notifications:** the Chat switches of the table (direct messages, mentions and replies, announcements, Every message, each key's notifications) · "Show message text" · Sound · "Email when away" · Browser notifications (the permission's state, "Not allowed by the browser") · **Quiet hours** (one switch and a range, in your Time & region zone; off by default; holds every module's notices).

**Edge cases this block handles** (§Edge cases)
- A direct message while the desktop app is in front → no notice; shown in place; the browser tab doesn't ring either (acknowledged).
- A direct message with the desktop app open on another module and a browser tab in the background → exactly one notice (the most recently active client); none from the browser.
- Three messages from Sofia in a minute → one notice that updates ("Sofia · 3 messages"), one Catch up group, a count of 3.
- A notice from another workspace → it says the workspace's name; clicking it switches workspace and lands on the message; a running Focus keeps running.
- Browser permission refused → Catch up says notifications are off in this browser; the setting reads "Not allowed by the browser"; the bell still fills.
- A conversation set to "Every message" → one notice per burst only when Moduo isn't in front; one Catch up line per conversation; the sidebar counts every message.

## 3. Acceptance criteria

**AC7 — Catch up and notifications**
- **AC7.6** one device rings
- **AC7.7** the browser asks once and reports refusal
- **AC7.8** sound is off by default and one switch turns it on

**AC2 — A hackathon team's weekend (the hackathon cut)**
- **AC2.2** a teammate's direct message and an `@you` reach a desktop or a browser when Moduo isn't in front, once per burst, one device

**AC3 — A duo's week**
- **AC3.1** a direct message pings in any workspace with the workspace's name

**AC1 — Trust pass (v1's fourteen trust bugs, REPLAN §1.3 B)**
- **AC1.5** a direct message reaches you outside the app and in any workspace

**Tests that prove them** (file · name · AC · plain English)

- `tests/chat-notify.spec.ts` · "one device rings" · proves AC7.6, AC2.2, AC3.1, AC1.5, AC6.4 · Desktop in front → no notice; desktop on another module + background tab → exactly one notice from the desktop; both closed → the browser rings after 8 s; a burst replaces the last notice; a notice names the other workspace and lands on the message.
- `tests/chat-notify.spec.ts` · "browser permission and sound" · proves AC7.7, AC7.8 · The first Chat open in a browser asks once; refused shows the Catch up line and the setting's state; sound plays only when switched on.

## 4. Decisions that bind it

- **Desktop** (round-3 §2.14 e, #7): the app hears its own `notice_deliveries` rows live (published, filtered by person, any workspace) and shows an OS notification **only when Moduo isn't in front** (another app, another module or another workspace counts) **and** it is the person's most recently active client; then it calls `notice_op_ack(ids)`. A client that has the person's attention acknowledges without ringing and shows the message in place. Throttle per `tag` for about a minute. Today's mechanism: `src/components/app/notice-deliveries.tsx` (`@tauri-apps/plugin-notification`, `isAppInBackground`, `noticeCopy`).
- **Heartbeat:** `user_op_client_seen(client_id, surface, active)` every 60 s while open (`active` = focused and not idle); the client mints and keeps its install id.
- **Browser:** the page never rings. Web Push through the service worker (`public/push-sw.js`, `public/push-display.js`, `src/lib/notices/browser-push.ts`) rings only for a row nobody acknowledged by `push_after` (created + 8 s); notices with one `tag` replace each other ("Sofia · 3 messages"); a click lands on the message. **The first time Chat opens in a browser** it asks once ("Get a notice when someone messages you · Allow · Not now"); refused, Catch up says "Notifications are off in this browser" (#33) and Settings reads "Not allowed by the browser" (CH44).
- **Counts** (§2.14 h, §11 "Count"): per conversation from `chat_unread_counts`, moved by the store as rows arrive (zero queries per incoming message); the Chat tab counts the open workspace's open Catch up items, the workspace switcher each workspace, the dock or taskbar badge the sum (one query across workspaces, own rows); desktop through Tauri's badge count (macOS, Linux) and an overlay icon on Windows, web through the tab title and a favicon dot. No Rust change (#36).
- **Sound** (CH34): one soft sound for direct messages and `@you`, off by default, one switch; a client setting.
- **Settings → Notifications' chat rows** (§15; shown above): the five switches (Direct messages · Mentions and replies · Announcements · Every message · each key's notifications) turn off the device notice and the email for their rows only (the bell row and the Catch up item are always written); "Show message text" and "Email when away" save through `user_op_set_chat_prefs`; Browser shows the permission's state. Map the bell ops `chat.mention`, `chat.reply`, `chat.announcement` to the Chat switches in `OP_TO_NOTIFICATION_TYPE` (`src/lib/preferences.ts`; renders in `preferences-section.tsx`). Quiet hours is CV-18's row.
- **Copy** (#33): "Notifications are off in this browser" · "3 messages while you focused" (that summary's writer is CV-18).

## 5. Files

New: `tests/chat-notify.spec.ts` (two browser contexts; the desktop app is simulated by a context with the in-front flag, state your approach in the record). Touch: `src/components/app/notice-deliveries.tsx`, `src/lib/notices/*`, `public/push-sw.js`, `src/components/app/app-chrome.tsx` (the Chat tab badge) and `src/components/workspace-switcher.tsx` (counts), `src/features/settings/sections/preferences-section.tsx`, `src/lib/preferences.ts`, `src/lib/min-build.ts` (`READ_RPCS`: add `user_chat_prefs`).

## 6. From earlier blocks

CV-6a: the six notice kinds with server-built title, text and link, `user_clients`, `user_op_client_seen`, `notice_op_ack`, `user_op_set_chat_prefs` / `user_chat_prefs()`, push at once. CV-3: the store's unread slice (replaces `use-chat-badge.ts`, which CV-8a deletes). CV-5: `chat_catchup` items for the counts.

## 7. Watch out

- Round-3 §5 risk 7: two devices ringing, or none; prove with two real clients before the release.
- The browser ask must happen once (remember the answer); a refused permission can only be undone in the browser's settings.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Server rows, gate and email (CV-6a); gate rules, quiet hours, pause, Focus holds (CV-18); the Catch up view (CV-11); the stop-gap of CH68 (a release matter, AC2.9).
