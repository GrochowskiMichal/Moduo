# CV-7b — The composer (client)

> Branch `t/maciej/cv-7b-composer` · head: the commit that adds this file's last edit (base `b503aee0`) · status: built, not landed
> Migration: none.

## Delivered against the row

- **The composer** (`src/features/chat/composer/chat-composer.tsx`): the shared Lexical editor with v2's nodes (`CHAT_EDITOR_NODES`), seeded with `$importStored` and saving `$exportStored` (Markdown subset + `moduo://` refs, never a title). One row at rest (`+` · text · `@` · emoji · send, frames 5/6); past one line the text takes the full width and the tools drop to a row below until it's empty. 15 px text at every density on the kit's new filled surface (`FEED_COMPOSER_FILLED`).
- **Grammar** (`grammar.ts`, `MentionMenuPlugin` ×3 + a `:` typeahead): `@` people first (from chat's people, a person pick is a `moduo://person/<id>` chip drawn "@Name"), then `@channel`, then things; `#` tags; `/` with `/task` `/note` `/event` (open the capture, the new item's chip lands where the caret was), the date commands; `:` emoji by GitHub shortcode/name. Tab or ⏎ picks.
- **Keys (§16)** (`plugins.tsx`): ⏎ / ⌘⏎ send, never during IME composition (also a CRITICAL guard so an IME commit ⏎ can't pick a menu item), ⇧⏎ new line (a new item inside a list), ↑ in an empty composer edits your last message, Esc in an empty composer focuses the newest message. ⌘B ⌘I, ⌘E code, ⌘⇧X strike; underline and other formats the stored form can't hold do nothing. Formatting buttons float over a selection only. Markdown shortcuts as you type (`**` `*` `_` `~~` `` ` `` ``` `>` `-` `1.`; no headings/rules/checklists).
- **Clean paste:** HTML/text through `pastedBlocks` (spike 4), this app's own deep links (`/tasks?id=`, `/notes?id=`, `/calendar?event=`, `/contacts?type&id`, `/email?thread=`, `/chat?c=`) become reference chips; inside a code block a paste is plain text; files-only pastes are left for CV-9.
- **`+` menu** (`plus-menu.tsx`): Link something (All · Tasks · Notes · Events · People, recent first) and Create, linked (Task/Note/Event → the capture). "Upload a file" waits for CV-9.
- **Emoji picker** (`emoji-picker.tsx`, `emoji-data.ts`): Frimousse over Emojibase's data bundled with the app (dynamic import, own chunk, no CDN), native emoji up to Emoji 15, skin tones.
- **Drafts** per conversation in the store's meta (`store.setDraft`, stored form = ids only), debounced 400 ms, flushed on blur/unmount; restored on open. **Typing** through the store's throttle (stop on send and blur).
- **8,000 stored characters** refused with the count, nothing sent; a counter shows from 7,500.
- **`@channel` refused** → the composer says copy #33 once the sent row is back with `mentionsEveryone` false (scoped to its conversation).
- **v2 send path:** `useChatModule().actions.sendStored` (format `v2`); the main conversation no longer goes through v1's encoder. The thread panel keeps v1's composer (CV-12).
- **Edit in place** with the same component (`mode="edit"`, via the stream's new `renderEditor` prop): opens the stored body (chips, code and all), ⏎ saves (nothing when unchanged against the re-exported baseline), Esc cancels. `stream/edit-box.tsx` is gone.
- **AC2.7 (from CV-7a):** T / "Make a task" opens the app's capture as Task with the message's words on the title line. `CaptureRequest` gained `type`, `draft`, `onCreated`; the shell opens as the named type (when writable) and sets the line; a prefilled open starts a fresh task (no earlier draft rides in); the Task body (plain and template creates) and the one-line bodies report what they made; `createCapturedEntity` returns the note/event `ref`.
- **Feed accessibility (shared with CV-8a, my part):** articles carry `id`, `aria-posinset`, `aria-setsize` (-1 while more exist); the feed sets `aria-activedescendant` to the selected message. Any letter that isn't a message key, pressed in the feed, types into the composer.
- **Kit addition (#32):** `FeedComposer variant="filled"` + `FeedComposerInput size="md"`, story `FilledComposerDensities` registered in the kit (kit.ts/kit.test.ts → `tests/visual/kit.spec.ts` picks it up).
- **Shared-file changes (all additive):** `src/features/spine/references/mention-view.tsx` + `reference-node.tsx` (a host may draw a reference kind itself; no provider = unchanged); `src/lib/capture-registry.ts`, `components/app/capture-shell.tsx`, `capture-line.tsx`, `features/spine/capture-command.ts`, `features/tasks/capture/task-capture.tsx`; `components/ui/feed.tsx`; `stream/message-stream.tsx`, `stream/rows.tsx` (a11y props, `renderEditor`), `stream/message-body.tsx` (`Mention` exported). Deps: `frimousse`, `emojibase-data`.

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC4.3, AC4.6 | `tests/chat-keys.spec.ts` · "the key map" (focused by default, ⇧⏎/⏎/⌘⏎, `+` is text in the composer, ↑ edits last + Esc cancels, Esc → newest message with `aria-activedescendant`/`aria-posinset`, a letter types into the composer, `@` people first → Tab → `moduo://person/<id>` stored) · `src/features/chat/composer/composer.test.ts` · "the keys" |
| AC4.7 | `tests/chat-keys.spec.ts` · "code keeps its backticks through an edit; drafts stay" (`` ` `` shortcut → inline code, stored with backticks, the edit opens it as code and saves it back) · `src/features/chat/markup-v2/parity.test.ts` (CV-0's 200+ corpus, incl. code, `@channel`, `:custom:`; passes) |
| AC9.7 | `tests/chat-keys.spec.ts` · "/task opens the capture; the new task lands as a chip" (stored `moduo://task/<uuid> …`, no title) · `composer.test.ts` · "`/task` opens the capture…" · `src/features/spine/capture-command.test.ts` (note/event refs) |
| AC2.7 (T) | `tests/chat-stream.spec.ts` · "the message keys" (T opens the Capture dialog with the message's words) · `task-capture.test.tsx` · "a prefilled open … starts fresh" |
| IME edge case | `composer.test.ts` · "⏎ during IME composition doesn't send; ⏎ after it does" (`isComposing` and keyCode 229) |
| 8,000 limit | `tests/chat-keys.spec.ts` · "a message over 8,000 characters is refused with the count" · `composer.test.ts` |

`bun run verify` passed (typecheck, Biome, lint:tw, lint:css, all tests). e2e: `chat-keys.spec.ts` 4/4, `chat-stream.spec.ts` 5/5 (selectors moved from `textarea` to the contenteditable; T now expects the capture). Screenshot-compared against round 5 frame 5 / round 4 frame 3 (rest, grown, `+`, emoji, `@`, `/`, selection toolbar, edit in place).

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **`+` shows "Create, linked" now**: agent's choice · AC9.7 (`/task` `/note` `/event`) is this block's and `+` → Create is the same path · rejected: hiding it until CV-10 (brief §4's "my reading").
- **"Linked" = the new item's chip in the message**: agent's choice · the message → item `mentions` link comes from the stored reference on send; the "From:" chip linking the item back to the message is CV-10's · rejected: a second link write from the composer.
- **A prefilled capture starts fresh** (an earlier task draft kept with Esc doesn't ride in; it stays kept until something is changed in the new capture, and a type switch and back restores this capture as usual): agent's choice · "T then ⏎" must not create a task with stale fields · rejected: merging the words into the kept draft.
- **T prefills only the title** (message text, whitespace collapsed, 200 chars): agent's choice · the source link is CV-10's Message type.
- **The parity test stays in `markup-v2/`** (brief says `markup/`): CV-7a's folder choice (a `markup/` folder beside v1's `markup.ts` makes `./markup` ambiguous).
- **The typed handle chip (`MOD-142`)** is CV-10's (brief §4); the brief's composer.test line naming it is not built here.
- **`@channel` is offered to everyone in the menu**: agent's choice · the server decides (CV-2a) and the composer says so after the send, as #33 specifies · rejected: reading `chat_caps_get` client-side to hide it.
- **No `@Team` yet**: agent's choice · chat has no team list client-side; the stream draws `moduo://team/` as "@team" already · for the block that adds teams to chat's people.
- **No drag-from-panel onto the box**: agent's choice · there's no app-wide drag context and no panel listing items in Chat yet · for the right-panel block (dnd-kit's `useDropLinkTarget`).
- **`/remind` hidden**: CV-14's; the shared menu's `/next week` stays (it's the shared grammar).
- **Emoji up to version 15**, no Windows flag font yet: agent's choice · newer emoji draw as boxes on older systems · the flag font is a desktop/Windows packaging item (verify before release).
- **Tool buttons are a local `ToolButton`, not `IconButton`**: agent's choice · they must keep the caret (mousedown preventDefault) and be Radix `asChild` triggers, which IconButton's tooltip wrapper can't be.
- **The limit counts UTF-16 units** (`string.length`), the server `char_length`: agent's choice · the client is stricter by a little with emoji; never sends what the server refuses.

## Review (validator, round 1)

No BLOCKER; 1 MAJOR fixed (a prefill merged into a stale capture draft → prefilled opens start fresh + unit test). MINORs fixed: untouched edit compared against the raw body (now the re-exported baseline), IME commit ⏎ could pick a menu item (CRITICAL guard), `@` button appended at the end (keeps the live caret), template creates didn't report `onCreated`, `@channel` note leaked across conversations, a paste with files fell through to rich HTML, plus-menu tabs/hr → `SegmentedControl`/`Separator`, note/event refs untested (tests added). NITs fixed: letters in a read-only feed, `aria-setsize` with newer pages, `isAttached` in the caret restore, emoji load retry, a failed send no longer clears the box. NITs left: `/task`'s title is read back from the menu label (works; tidy later); "create more" in the capture drops one chip per create at the same caret (intended).

## Review (validator, round 2, on the delta)

All round-1 fixes confirmed. One new MAJOR from the round-1 fix, fixed: a prefilled open overwrote the kept draft on open → the save now waits until something in this capture differs from the prefill (test: "closed without a change, the kept draft is still there"). New MINOR fixed: a type switch and back in a prefilled capture started fresh again → the fresh start happens once per open (`openId`). Left: a multi-line paste in the capture (`createPasted`) makes several tasks and reports none back to chat (no chip).

## Gotchas (area: ui)

- Radix popovers: a closing popover's `onCloseAutoFocus` refocusing the editor steals focus from a popover that just opened (the emoji picker closed itself); only refocus when focus isn't already in another popper.
- Lexical command priorities: the shared menus take ⏎/Tab at HIGH with no IME check; a chat-only CRITICAL ⏎ handler swallows the composing ⏎ first.
- An edit's "unchanged" check must compare with the re-exported body, not the stored string (non-canonical bodies would save a phantom "(edited)"; DF-23's trap again).
- `bun ./scripts/check-arbitrary-tw.ts` flags a function named `capitalize` (small-caps rule); name helpers differently.

## For later blocks

- **CV-7c:** the composer's emoji picker is the one to reuse for "any emoji" in the toolbar (`ChatEmojiPicker`); the personal quick row isn't read yet.
- **CV-8a:** the main composer is v2; the thread panel and v1 `ui/composer.tsx` / `emoji.ts` / `ui/emoji-picker.tsx` remain for CV-8a/CV-12 to retire. `returnToComposer(typed?)` is the stream's way back.
- **CV-9:** `+` → "Upload a file" goes at the top of `PlusMenu`; `CleanPastePlugin` leaves files-only pastes alone (return false) for you; the 10-file cap.
- **CV-10:** handle chip (`HandleAutolinkPlugin` in `chat-composer.tsx`), the Message capture type and "From:" chip (`CaptureRequest` already carries `type`/`draft`/`onCreated`), handle links in `appLinkRef`.
- **CV-12:** the chain composer = `ChatComposer` with `store.draft(channelId, chainId)` / `setDraft(…, chainId, …)` and `sendStored({ parentId })`.
- **CV-14:** add `/remind` to `createCommandsFor`'s menu (not a create) in `slashCandidates`.
- **CV-20:** workspace emoji go first in `matchEmoji` / the picker (`emoji-data.ts`).

## Manual checklist (step → expect → surface)

- [ ] Open a channel and just type → the text goes into the composer → Chat
- [ ] Type a long paragraph → past one line the tools drop below; clear it → back to one row → Chat
- [ ] Type `**bold**`, `` `code` ``, `> quote` → they format as you type; select text → B I S `<>` float above it → Chat
- [ ] `@Mi` → people first; Tab → a chip "@Mike Chen"; send → Mike is mentioned → Chat
- [ ] `/task Order frames` ⏎ → the capture opens as Task with "Order frames"; ⏎ → the task's chip appears in the composer → Chat
- [ ] Press T on someone's message → the capture opens with its words → Chat
- [ ] `+` → Link something → pick a task → chip; `+` → Create → Note → capture as Note → Chat
- [ ] Emoji button → picker, search "party", pick → 🎉 at the caret; `:thu` → 👍 → Chat
- [ ] Paste from Google Docs → text, lines and links only, no fonts → Chat
- [ ] Write a draft, switch conversation and back (or reload) → the draft is there → Chat
- [ ] ↑ in an empty composer → your last message opens with its chips and code; ⏎ saves; Esc cancels → Chat
- [ ] Japanese/Polish IME: ⏎ to commit a candidate doesn't send; ⏎ again sends → Chat (desktop app too)

## Verify before release

- The keyCode-229 commit ⏎ with Japanese input in WKWebView (the macOS app), end to end, with a menu open.
- Emoji rendering on Windows (flag font) and on older macOS (Emoji 15 cut-off).
