# CV-7b: The composer (client)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-7b-composer`; record `docs/build/chat-v2/CV-7b.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 7b | **CV-7b** The composer *(client)* | the one-row composer that grows with `+` (upload, link, create), the grammar and Markdown shortcuts on the shared editor, drafts, IME, the Frimousse picker with native emoji, the composer keys; `composer.test.ts` | AC4.3, AC4.7, AC9.7 (`/task` `/note` `/event` through the capture) | 7a, 6a (the prefs op) |

**Depends on:** CV-7a; CV-6a for the prefs op (`user_op_set_chat_prefs`, `user_chat_prefs()`).

## 2. What to build

**§4 The composer and the grammar** (prototype frames 5, 6)
- **One row that grows:** at rest `+` · the text · `@` · emoji · send; past one line the text takes the full width and the tools drop into a row below. Formatting buttons appear only when text is selected (⌘B ⌘I ⌘E as today); Markdown shortcuts work as you type (`**`, `` ` ``, `>`); pasting stays clean text; ⏎ sends (never during IME composition), ⇧⏎ makes a new line. Drafts are kept per conversation and chain on the device.
- **`+` is the one way in for everything that isn't text:** upload a file; link something (tabs All · Tasks · Notes · Events · People, recent first); create a linked task, note or event. Every way to connect lands as the same chip: `@`, `/task` `/note` `/event`, `+`, pasting a Moduo link, dragging an item from the panel or another module onto the box.
- **The grammar** (Tasks 33, RF-1): `@` finds people first, then things (teams, projects, tasks, notes, contacts, events, emails, other conversations); `#` is tags; `/` runs commands (`/task`, `/note`, `/event`, `/today`, `/tomorrow`, `/date`, `/remind`); `:` opens emoji with the workspace's custom ones first. **A typed task handle (`MOD-142`) becomes a live chip as you type**, like a date chip; Esc or ⌘Z keeps the text (CH66). `@channel` reaches everyone in the channel once, only for roles that may "Mention everyone"; `@Team` notifies the team once each (CH7).
- **What's stored** is a Markdown subset with `moduo://` references, never a title; rows are drawn by a pure parser whose tree is cached per message; the composer is the shared Lexical editor with RF-1's menus (§6 #3).

**§16 table rows**
| Scope | Key | Action |
| --- | --- | --- |
| The composer (focused by default; typing anywhere goes here) | ⏎ · ⇧⏎ · ⌘⏎ | Send · new line · send (alias) |
| | ↑ (empty) | Edit your last message |
| | Esc (empty, nothing else open) | Move focus to the newest message (the last step of the Esc order) |
| | `@` `#` `/` `:` | The grammar; Tab accepts a suggestion; ⌫ on a chip removes it |

**Edge cases this block handles** (§Edge cases)
- ⏎ during IME composition (Polish, Japanese input) → nothing sends; ⏎ after composition sends.
- An `@channel` from a role without "Mention everyone" → sent as plain text, nobody is pinged, the composer says so.
- A message of 8,000 stored characters (references included) → refused with the count, nothing partial; a message of 10 files → the eleventh is refused before upload.
- An edit adds `@Anna` → Anna hears once; nobody else hears about the edit; an edit that removes a mention sends nothing.

## 3. Acceptance criteria

**AC4 — A developer team's week**
- **AC4.3** the keyboard reaches everything in §16 and ↑ edits the last message
- **AC4.7** a code block keeps its backticks through the stored form and back into an edit

**AC9 — Chat knows the work**
- **AC9.7** `/task` `/note` `/event` create a linked item from the composer.

**Tests that prove them** (file · name · AC · plain English)

- `src/features/chat/composer/composer.test.ts` · "grammar, handle chip, IME" · proves AC4.1, AC9.7, AC4.7 · `MOD-142` becomes a chip and Esc keeps the text; `@` `#` `/` tokens; `/task` opens the capture; ⏎ during composition doesn't send.
- `src/features/chat/markup/parity.test.ts` · "the stored form round trip" · proves AC12.6, AC4.7 · 200+ corpus cases go editor → stored text → parser → rows and back with 100 % parity; code keeps its backticks; references keep their URIs; `@channel` and `:custom:` survive.
- `tests/chat-keys.spec.ts` · "the key map" · proves AC4.3, AC4.6, AC2.7 · Every row of §16 fires in its scope and nowhere else; ↑ edits the last message; Esc follows the order; `+` never fires inside the composer.

## 4. Decisions that bind it

- **Stored form and editor** (#3, round-3 §2.6; spike 4): the composer is the shared Lexical editor (`src/features/spine/editor/*`: `entity-text-editor.tsx`, `mention-menu-plugin.tsx`, `entity-ref-node.tsx`) with RF-1's menus (`src/features/spine/references/*`) and a restricted shortcut list; it saves the **Markdown subset with `moduo://` references**, never a title (`format_version = 2`); the limit is 8,000 stored characters, references included, refused with the count and nothing partial. The pure parser (CV-7a, spike 4) draws rows; this block completes `src/features/chat/markup/parity.test.ts`: 200+ corpus cases editor → stored → parser → rows → back, 100 % parity, code keeps its backticks, references keep their URIs, `@channel` and `:custom:` survive.
- **One way in** (§4): `@` people first then things; `#` tags; `/` commands (`/task`, `/note`, `/event`, `/today`, `/tomorrow`, `/date`, `/remind`); `:` emoji. Every way to connect lands as the same chip: `@`, `/…`, `+`, pasting a Moduo link, dragging an item onto the box (`src/features/spine/hooks/use-drag-payload.ts`). `/task` `/note` `/event` open the app's capture (the Message type and the "From:" chip are CV-10's); the typed handle chip (`MOD-142`, CH66) is CV-10's too (RF-1's `handle-autolink-plugin.tsx`).
- **`+` menu:** upload, link something (tabs All · Tasks · Notes · Events · People, recent first), create a linked task, note or event. Show an entry only once its block exists (upload CV-9, create CV-10; my reading).
- **Keys** (§16): ⏎ sends but **never during IME composition**, ⇧⏎ new line, ⌘⏎ send; ↑ in an empty composer edits your last message; Esc order ends at "focus the newest message". Formatting buttons only when text is selected (⌘B ⌘I ⌘E); Markdown shortcuts as you type (`**`, `` ` ``, `>`); paste stays clean text.
- **Picker** (#18): Frimousse with self-hosted Emojibase data, native emoji (a flag font on Windows); the workspace's custom emoji section is CV-20's, the personal quick row CV-7c's.
- **Drafts** (#28) per conversation and chain in the store's `meta` record, ids only, never a linked item's or person's name.
- **Typing** goes through the store (CV-3): one event per 3 s, a stop on send or blur.
- **Copy** (#33): "Only roles that may mention everyone can use @channel; it was sent as text." The server decides (CV-2a); the composer says so after the send.
- Kit addition (#32): the filled composer with a 15 px input, a story at three densities (`tests/visual/kit.spec.ts`).

## 5. Files

New: `src/features/chat/composer/` with `composer.test.ts`; `src/features/chat/markup/parity.test.ts` and its corpus. Retire nothing yet (v1's `ui/composer.tsx`, `emoji.ts`, `ui/emoji-picker.tsx` go with CV-8a). Add Frimousse and the Emojibase data as dependencies.

## 6. From earlier blocks

CV-7a: the stream, the parser, event lines. CV-6a: `user_op_set_chat_prefs` / `user_chat_prefs()` (the picker reads the quick row). CV-3: the store (drafts, typing, outbox, send with a client-minted id). Spike 4's corpus.

## 7. Watch out

- v1's `src/features/chat/markup.ts` still exists (v1 screens import `../markup`; CV-8a deletes it). A `markup/` folder beside it makes `./markup` resolve to the **file**: import the v2 parser by explicit path (`markup/parse`), never `./markup`.
- IME (Polish, Japanese): `isComposing`; test it. Shared-editor plugins are shared with Tasks and Notes: change them additively.
- Tokens only; new chrome uses raw HTML, not the `src/tw` shim.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Uploads (CV-9); the capture type, Message capture, handle chip, "Mentioned in" (CV-10); personal quick row (CV-7c); custom emoji (CV-20); the status line above the box and the viewer, announcement and paused lines (CV-17, CV-8a).
