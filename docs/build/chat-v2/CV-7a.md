# CV-7a — The stream (client, large)

> Branch `t/maciej/cv-7a-stream` · head: the commit that adds this file's last edit (base `06db53f5`) · status: built, not landed
> Migration: none.

## Delivered against the row

- **`MessageStream`** (`src/features/chat/stream/message-stream.tsx`, the one file that opts out of the React Compiler, decision #16) on TanStack Virtual with spike 1's settings verbatim (`anchorTo: "end"`, `followOnAppend`, `scrollEndThreshold: 80`, `useFlushSync`, overscan 6, the "adjust every size change above the viewport" rule, `overflow-anchor: none`, `contain: layout style`, sticky day separator through the `rangeExtractor`). Opens at the bottom; follows while you're there; never pulls while you read; loads older pages within 600 px of the top and newer ones near the bottom of a jump window; draws 50 of the store's 51 (the row past the edge only sets grouping and the separator). **Measurement cache** per conversation and density (estimates use the remembered height). **Windowed jumps**: the store's `target` is centred and lit for 2.5 s; the **jump bar** ("Viewing messages from Oct 2 · Jump to present") shows while the window doesn't reach the newest message. **Floating "N new ↓" chip** counts arrivals from others since you left the bottom; the reader's row doesn't move. **Density** switches re-anchor synchronously (spike 1's helper, anchored on the message text). The `feed` pattern with a polite live region ("New message from Mike Chen").
- **The read mark** is the last message wholly on screen, reported after scrolling settles, on arrival at the bottom and on returning to the window; the store moves it forward only. The v1 hook's "mark the newest held" effect is gone (`use-chat-module.ts` now only passes the stream's mark through).
- **Rows** (`stream/rows.tsx`): the message row north star (CH29–CH29f: 32/28/24 avatar via the kit's new `feed` rung, name at 15 px semibold, time 12 px subtle, 15 px body at every density, 24/20/16 px before a new person, 6 px between one person's lines, one left edge, flat rows with a see-through hover fill, the hover time on the first line's centre); centred day separators in the recent-past grammar; the "New" pill on a hairline; **one renderer for every event line** (§18: a table of types, `moved_out`/`moved_in` today); "Deleted message" for a deleted message with replies (without replies it leaves no trace); the quote line of a reply; reactions (the kit's ChipButton); the replies line; **sending states** ("Waiting to send", "Not sent · Retry · Delete", pending text dimmed).
- **Body renderer** (`stream/message-body.tsx`) from spike 4's tree (`messageTree(id, updatedAt, body)`): marks as a bitmask, links and bare URLs underlined monochrome, `@channel` and other people's mentions a light grey mark, `@you` the one solid accent mark, RF-1 `Reference` chips (live title/status; a card when alone on a line), date chips, code, quotes, one-level lists, "(edited)" inline, **jumbo** emoji-only messages (≤ 8).
- **Hover toolbar and ⋯ menu** (`stream/message-actions.tsx`): first three of Moduo's six default quick reactions · Reply · Task · ⋯ (Reply, Make a task, Pin/Unpin, Copy link, Mark unread, Edit and Delete on your own); right-click opens the menu with all six reactions on top. Only verbs whose blocks exist are shown.
- **Edit in place** (`stream/edit-box.tsx`): ↑ in an empty composer edits your last message (or steps into the stream when you have none); ⏎ saves as v2 (`store.edit(id, body, "v2")`), Esc cancels and returns to the composer.
- **Delete with Undo** (`chat-page.tsx`): hidden at once, "Deleted" toast with Undo for 8 s, no confirm; the server delete runs when the time is up, or at once when you leave the page; an unsent message is discarded instead.
- **Message keys** on the selected message (↑↓ step through; the feed takes focus): R reply (opens the chain), E edit (own), + react (the menu with the six), P pin, T make a task, ⌘⌫ delete (own), ⏎ open the chain when it has replies else back to the composer, Esc back to the composer; ↓ past the newest returns to the composer.
- **Kit additions:** `Avatar` / `PersonAvatar` size `feed` on `--avatar-feed` (32/28/24 by density; `avatar.stories.tsx` "Feed"); `--feed-person-gap` per density; `--stream-fade-top/bottom` (the fade is a mask in `global.css`, `.chat-stream`); `--feed-media-max-w/h` (360 × 240) for CV-9; `formatPastDay` in `src/lib/time-format.ts` (Today · Yesterday · Mon up to six days back · Oct 9 · Oct 9, 2025).
- **Pure helpers** in `timeline.ts`: `buildStream`, `lastSeenMessage`, `countNewSince`, `localDay`, `isEmojiOnlyText` (v1's `buildTimeline` stays for the v1 thread panel).
- **Wiring:** `chat-page.tsx` draws `MessageStream` in the centre in place of v1's `MessageList` (v1's header, composer, sidebar and thread panel stay until CV-7b/8a/12); `useChatModule` also returns `store`, `snap` and `markSeen`.
- **Stories:** `src/features/chat/stream/stream.stories.tsx` (Densities, Stream). **Fixture:** `scripts/perf/seed-chat-10k.ts`; e2e helpers `tests/support/chat-room.ts` (a Duo room of its own, `sendAs`, `seedHistory` as the service role).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC1.1, AC1.14 | `tests/chat-stream.spec.ts` · "offline send, retry, undo delete" (offline ⏎ shows "Waiting to send" and sends on reconnect; a refused send (plan paused) shows "Not sent", Retry sends once allowed; delete hides with Undo, Undo restores and the server keeps it; without Undo the server deletes it after 8 s) |
| AC1.6, AC1.3 | `tests/chat-stream.spec.ts` · "floating chip, jump bar, deep link" ("1 new" while scrolled up, the reader's row moves ≤ 1 px; a deep link lights the message in a window with the jump bar; Jump to present) · "the New pill sits at the read mark and never jumps" |
| AC1.11 | `tests/chat-stream.spec.ts` · "live chips, honest errors" (the task chip changes title in place after another context's change) |
| AC2.7 (message keys) | `tests/chat-stream.spec.ts` · "the message keys" (↑ edits your last, Esc back to the composer, ↑↓ select, E edits, R opens the chain, P pins, + opens the six reactions, T makes a task, ⏎ returns to the composer, ⌘⌫ deletes with Undo) |
| AC1.15, AC12.3 | `tests/perf/chat-10k.spec.ts` · "the budgets", local dev build: warm open 31 ms (≤ 100), own message 30 ms (≤ 50), 196 elements in the stream (≤ 3,000), worst frame in a 2 s fling 33 ms (≤ 50), anchor drift 0 px on a held-then-released prepend (7,020 px), a live edit above and a density switch |
| AC14.1, AC14.3 | `tests/visual/chat-stream.spec.ts` · "the look at three densities" (15 px everywhere, names by weight, 32/28/24 avatar, 6 px and 24/20/16 px rhythm, one left edge, centred separator, the pill); `lint:tw` + `lint:css` pass |
| AC1.2–1.4 (pure) | `src/features/chat/timeline.test.ts` · "read mark, New pill, page boundaries" (11 tests); `src/lib/time-format.test.ts` · recent past |

`bun run verify`: typecheck, Biome, `lint:tw`, `lint:css` pass; 4,466 of 4,467 tests pass. The one failure is the shared-stack check `supabase/tests/chat_privacy.test.sql` ("typing: a refusal writes nothing"), which this branch doesn't touch (runbook: the shared stack). e2e: `tests/chat-stream.spec.ts` 5/5 (after the review fixes); perf 1/1; visual 1/1.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **The stream goes into today's Chat page**: agent's choice · the e2e rows need it on screen, and v1's list can't show v2 rows honestly · rejected: a separate harness route (a new route needs the designer) and waiting for CV-8a.
- **Edit in place is a plain box over the stored text** until CV-7b's composer (`$importStored`): agent's choice · v1's composer can't read v2 bodies and the brief forbids building on v1's `ui/*` · rejected: pulling a Lexical editor into this block (CV-7b's). References show as their `moduo://` link while editing.
- **The renderer lives in `stream/message-body.tsx`**, the pure tree stays in `markup-v2/`: agent's choice · a `markup/` folder next to v1's `markup.ts` would make `./markup` ambiguous · rejected: the brief's `markup/` folder name.
- **"T" / "Task" creates the task at once (v1's behaviour)** with the message text: agent's choice · the capture's request type has no title or source seed yet · rejected: opening an empty capture. A capture prefilled from the message needs `CaptureRequest` to carry it.
- **Right-click opens the ⋯ menu** (with the six reactions on top) anchored on the toolbar, not at the pointer: agent's choice · one menu, one set of items · rejected: a second ContextMenu per row (DOM budget).
- **"+" opens the menu's reaction row**; "any emoji" (☺) waits for CV-7b's picker: agent's choice.
- **Delete runs at once when you leave the page** inside the 8 s: agent's choice · a delete never silently doesn't happen · rejected: dropping it.
- **A refused send also offers "Delete"** beside Retry (discard): agent's choice · otherwise a refused message can't be cleared.
- **⇧D (decision) and H (remind me) do nothing yet**; their menu items are hidden until CV-13 / CV-14.

## Review (validator, round 1)

No BLOCKER; 5 MAJOR, all addressed:
1. Undo could be offered after the server delete (sonner pauses its clock on hover / a hidden tab, the page's own timer didn't) → the delete now runs from the toast's own `onAutoClose` / `onDismiss`; the pagehide/unmount flush dismisses the toast.
2. A newer page landing in a jump window could pull the reader to its end (`followOnAppend` doesn't know `hasNewer`) → follow only while neither this nor the previous window has newer messages.
3. Your own message sent while scrolled up wasn't on screen → the composer's submit calls the stream's `showLatest()` (jumps to the present from a jump window).
4. ↑-edit of an off-screen message did nothing visible / lost typing on scroll → the edited row is always drawn (`rangeExtractor`) and scrolled into view when editing starts; `editLast` skips ids inside their Undo and the undrawn edge row.
5. Keys untested → "the message keys" e2e now also presses P, +, T, ⏎ and ⌘⌫ (with Undo). **T's wording is open (❓ below).**
MINORs fixed: the perf spec now holds the older page at the network and releases it inside the sampling window (asserts a prepend landed: 7,020 px, drift 0 px) and waits for the live edit to be drawn (drift 0 px); the hover toolbar and context menu are hidden where you can't write. MINORs left (recorded): the chip test changes the title, not the status, and proves the in-place update through the window-return re-read; the deep-link test's target isn't a reply (chain opening is CV-12's panel); feed a11y (`aria-activedescendant` / `aria-posinset`) and "any unbound letter types into the composer" → CV-7b with the composer; unsent rows from v1's composer show v1 tokens until CV-7b sends v2; Mark unread no longer moves the pill while open; the pagehide delete is a plain fetch (no keepalive); two edit boxes if the v1 thread panel edits the same message (CV-12 replaces it). For the orchestrator (CV-3's store): `open()` returns early for a conversation already loaded, so `newAfter` isn't refreshed on a return to a small conversation.

## ❓ Needs Maciej

- **T / "Task" on a message**: the AC says it "opens the capture"; it creates the task at once from the message's text (v1's behaviour, toast "Task created · Open"), because the capture's request type can't carry a title or the message as source yet. Agent's choice for now; to open the capture prefilled, `CaptureRequest` needs a seed for the title/source (a small change in the capture shell, its own block).

## Gotchas (area: ui)

- In the full e2e run the first ↑ in the stream sometimes selected a row above the newest; the spec steps down to its message. Worth a look in CV-7b when the composer's ↑/Esc hand-off is rebuilt.

- The intro row made `rows` non-empty under the loading skeleton, so the open-at-bottom ran before the scroller existed; open only when a message and the scroller are there.
- TanStack's measurement memo is keyed on `estimateSize` / `getItemKey`: build the rows array with `useMemo` (the file has no compiler), or every render re-walks every row.
- A density switch re-anchors on the message's text, not its wrapper: a row that starts a person carries the gap inside it, so its wrapper and its text move differently (8 px at comfortable → dense).
- Playwright `/new/` matched another button: the chip's name is matched as `^\d+ new$`.

## For later blocks

- **CV-7b (composer):** replace `EditBox` with the composer (`$importStored(body)`), keep `[data-chat-composer]` on the wrapper (the stream returns focus there) and `onEditLast` (↑ edits your last, else `focusLast()` steps into the stream). Add "any emoji" to the toolbar and the `+` key.
- **CV-7c:** the toolbar reads `DEFAULT_QUICK_ROW` (`message-actions.tsx`); swap in the personal row.
- **CV-8a:** remove v1's `MessageList`/`MessageItem` (the thread panel still uses `MessageItem`); the stream already takes `intro`; frame 7's states replace the skeleton and intro; the presence wording of "honest errors" ("Presence isn't available") is yours/CV-17's.
- **CV-9:** media boxes use `--feed-media-max-w/h`; the stream's `estimate()` should learn a file's stored size.
- **CV-12:** chain folding: the spike's note (scroll the folded chain row to the top edge) applies; `onOpenChain` currently navigates to v1's thread panel (`t=`).
- **CV-13 / CV-14 / CV-15 / CV-16:** add Mark as decision (⇧D), Remind me (H), Make a note, Move to… to `ActionsMenu` and the keys in `onKeyDown`; `moved_*` lines draw through `EVENT_LINES`.
- **Orchestrator:** on the local stack a service-role change to a task didn't reach the chip through Realtime within 20 s; the e2e proves the in-place update through the window-return re-read. Worth checking on the real project (RF-1's live link).

## Manual checklist (step → expect → surface)

- [ ] Open a busy channel → it opens at the newest message; scroll up a few screens and have someone post → "1 new ↓" appears, nothing moves; click it → you're at the bottom → Chat
- [ ] Open a link to an old message (`/chat?c=…&m=…`) → the message is lit in the middle, "Viewing messages from …" at the bottom; Jump to present → newest → Chat
- [ ] Hover a message → the toolbar floats over its top edge (👍 ✅ 👀 · Reply · Task · ⋯); right-click → the menu with six reactions → Chat
- [ ] ↑ in an empty composer → your last message opens for editing; ⏎ saves with "(edited)"; Esc cancels → Chat
- [ ] Delete your message → it vanishes with "Deleted · Undo"; Undo brings it back; let it go → it's gone for the other person after 8 s → Chat (two browsers)
- [ ] Turn the network off, send → "Waiting to send"; back on → sent once → Chat
- [ ] Settings → density: dense/compact/comfortable while reading history → the line you're reading stays put → Chat
- [ ] Send just "🎉" → it draws large → Chat

## Verify before release

- The perf budgets on a production build in the desktop app (WKWebView) with a real trackpad (spike 1's open item); these are Chromium dev-build numbers.
- The read mark across two tabs (the last message wholly on screen in either moves it forward only).
