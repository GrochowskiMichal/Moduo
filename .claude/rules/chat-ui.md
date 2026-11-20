---
paths: ["apps/app/src/features/chat/**", "apps/app/src/lib/notices/**", "apps/app/src/lib/tauri-plugin-notification-stub.ts"]
incident: "The chat typing store's `() => []` snapshot crashed every page load in prod (React #185, 2026-10-06), and a non-canonical body saved phantom '(edited)' marks (CV-7b)"
expires: 2027-01-31
---

# Chat UI: stream, composer, notices

Compiled from the UI and notes gotchas (HV-14b). Editor (Lexical) rules: `.claude/rules/notes-editor.md`. Spike record: [docs/build/chat-v2/CV-0-S1.md](../../docs/build/chat-v2/CV-0-S1.md).

## The stream (TanStack Virtual)
- The stream file is `"use no memo"`; build its rows with `useMemo`, since TanStack's measurement memo keys on `estimateSize` / `getItemKey`.
- A chat stream needs `useFlushSync: true` (Tasks' `VirtualStack` uses `false`), or prepends and upward flings flash; set `shouldAdjustScrollPositionOnItemSizeChange`, since TanStack skips compensating size changes above the viewport while scrolling up.
- Each row has `contain: layout style` (WebKit lays out the whole stream per frame without it).
- A prepend must not change rows already drawn: build rows with the message before the window.
- Open at the bottom only once a message and the scroller both exist (an intro row under the skeleton made rows non-empty too early).
- A density switch re-anchors on the message's text, not its wrapper.
- `scrollIntoView` scrolls every scrolling ancestor: the message in context scrolls only its own list (`offsetTop` on a `relative` list).
- WebKit draws no frames for a window that isn't on screen (timers too): an unattended Tauri run needs the window visible.

## The composer
- Lexical command priority decides who gets ⏎: the shared menus take ⏎ / Tab at HIGH with no IME check, so the chat's CRITICAL ⏎ handler swallows a composing ⏎ (`isComposing`, and WebKit's `keyCode` 229) first (`apps/app/src/features/chat/markup-v2/enter.ts`).
- An edit's "unchanged" check compares with the re-exported body, not the stored string.
- A reference inline needs a real uuid: `serializeBlocks` drops a malformed one.
- `useComposerFiles` and `useMessageFiles` return their store snapshot (the RF-1 trap; only the e2e caught it). The attachment viewer finds a preview by path, not file id.
- `ExportBundle.entries` are text or bytes: `String(…)` before `JSON.parse` in a test.

## Notices
- The stale-answer check compares this client's clock with the server's `created_at`: a skewed clock (±8 s) can miss or double-ring.
- `chat_catchup` has the default replica identity: a Realtime DELETE carries only `id`.
- A chat notice rings even while a Moduo window is focused (the tab may be elsewhere).
- The web build aliases `@tauri-apps/plugin-notification` to `apps/app/src/lib/tauri-plugin-notification-stub.ts`, which calls `window.Notification` as the plugin does; tests record OS notices by replacing it. Headless Chromium answers `Notification.permission === "denied"` up front, and the ask's e2e needs `PUBLIC_VAPID_PUBLIC_KEY` in the build.
- A chat person missing from both member lists is a former member (`composerLine`).
