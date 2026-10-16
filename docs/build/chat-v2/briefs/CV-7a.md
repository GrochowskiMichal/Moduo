# CV-7a: The stream (client, large)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-7a-stream`; record `docs/build/chat-v2/CV-7a.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 7a | **CV-7a** The stream *(client, large)* | `MessageStream` on TanStack Virtual (follow, prepend, windowed jumps, measurement cache, the jump bar), the message row north star (CH29–CH29f), day separators and the recent-past grammar in `lib/time-format.ts`, one renderer for every event line (§18), the "New" pill and floating chip, hover toolbar and ⋯ menu, edit (↑), delete with Undo, jumbo emoji, sending states, density, fades, the message keys and Esc order; stories; the perf fixture and `tests/perf/chat-10k` | AC14.1, AC14.3, AC1.1, AC1.3, AC1.11, AC1.14, AC1.15, AC2.7 (the message keys) | 3, 0 (spikes 1, 4) |

**Depends on:** CV-3 (the store); CV-0 spikes 1 (TanStack Virtual in the real webviews) and 4 (the stored form and the parser).

## 2. What to build

**§3 The conversation: toolbar, stream and message row** (prototype frames 5, 6, 7)
- **The stream** is one virtualized list (TanStack Virtual; `MessageStream`) that opens at the bottom, follows new messages when you're there, never pulls while you read history, and loads older pages by `(created_at, id)` so nothing goes missing at a page boundary. **Day separators are centred** on a hairline, in the shared date grammar extended with the recent past: Today · Yesterday · Mon (up to six days back) · Oct 9 · Oct 9, 2025 (CH29c). The top and bottom edges fade the text (CH29). A deep link or a search result loads a window around the message and shows a jump bar ("Viewing messages from Oct 2 · Jump to present").
- **"New" since you last looked:** a small **"New" pill centred on a hairline** at the read mark, no row tint; when you're scrolled up and a message arrives, a **floating "N new ↓" chip** appears and scrolls you down (CH29d). The read mark is **the last message that was on screen**, never "now", and it moves forward only (§6 #17).
- **The message row** (Slack-calm base, CH29): a 32 px round two-initial avatar with a stable colour (28 / 24 at compact / dense), the name at the body size but heavier, the time small and grey; **body text 15 px at every density** (CH29a); **24 px before a new person (20 / 16 by density), 6 px between one person's lines** (CH29f); one left edge for text, reactions, files and reply quotes; flat rows, hover = a see-through fill; the hover time sits on the first line's centre; media gets the same space below as above. Mentions of others are a light grey mark; `@you` is the one solid accent mark in text; links are underlined, monochrome. Emoji-only messages draw large ("jumbo"). An edited message shows "(edited)"; a deleted one without replies disappears, one with replies reads "Deleted message".
- **Edit and delete:** ↑ in an empty composer edits your last message; an edit that names someone new notifies only them (CH75). Delete hides the message at once with **"Deleted · Undo" for 8 s**, no confirm (§6 #10); after the toast the text, mentions, reactions and pin are blanked on the server and files go to the trash clock.
- **Sending states** (frame 6): your message is visible under 50 ms after ⏎; offline it sits in place as **"Waiting to send"** and sends itself in order when you're back (CH64); only when the server refuses it does it show **"Not sent · Retry"** (a viewer, an announcement channel, a paused plan). Reactions, edits, deletes and pins while offline say "Offline".

**§16 table rows**
| Scope | Key | Action |
| --- | --- | --- |
| A message (↑↓ step through them) | R · E · + · P · T · ⇧D · H · ⌘⌫ · ⏎ | Reply · edit (own) · react · pin · make a task · mark as decision · remind me · delete (own, with Undo; bare ⌫ only with two or more selected) · open the chain when the message has replies, else return to the composer |

**Edge cases this block handles** (§Edge cases)
- A message arrives while you're scrolled up → the floating "N new ↓" chip; the anchor row doesn't move; clicking scrolls down and clears the chip.
- A deep link or a search hit to a message from last month → the stream loads a window around it, highlights it, shows the jump bar; the chain opens beside it when the message is a reply.
- A 10,000-message conversation → opens warm in ≤ 100 ms with the newest 50 from the device copy, draws only what's on screen (≤ ~3,000 elements), scrolls without a frame over 50 ms; switching back is instant (measurement cache).

## 3. Acceptance criteria

**AC14 — North star**
- **AC14.1** the stream matches round 5 in structure: 15 px text at every density, names by weight, 24/20/16 and 6 px rhythm, one left edge, centred day separators, the "New" pill and floating chip, fades at both ends, the one-row composer that grows
- **AC14.3** no raw hex, arbitrary values, rotated text or small-caps user words (the lint guards pass)

**AC1 — Trust pass (v1's fourteen trust bugs, REPLAN §1.3 B)**
- **AC1.1** a failed send shows "Not sent · Retry" and an offline send waits and sends itself
- **AC1.3** the "New" pill starts at the read mark and never jumps
- **AC1.11** a referenced task shows its live status and title
- **AC1.14** delete has Undo, no confirm
- **AC1.15** a 10,000-message conversation stays within the budgets of §Assumptions #23 [sic: the budgets are Assumption #22].

**AC2 — A hackathon team's weekend (the hackathon cut)**
- **AC2.7** ⌥⇧↓ walks unread conversations, ↑ edits your last message and `T` on a message opens the capture

**Tests that prove them** (file · name · AC · plain English)

- `tests/chat-stream.spec.ts` · "offline send, retry, undo delete" · proves AC1.1, AC1.14 · Offline ⏎ shows "Waiting to send" and sends on reconnect; a viewer's send shows "Not sent · Retry"; delete shows Undo and restores within 8 s.
- `tests/chat-stream.spec.ts` · "floating chip, jump bar, deep link" · proves AC1.6, AC1.3 · A message arriving while scrolled up shows "1 new ↓" without moving the anchor; a deep link loads a window with the jump bar and opens the chain.
- `tests/chat-stream.spec.ts` · "live chips, honest errors" · proves AC1.11, AC1.9 · A task referenced in a message changes status in the other context and the chip updates in place; a refused Presence join shows "Presence isn't available", never everyone as away.
- `tests/perf/chat-10k.spec.ts` · "the budgets" · proves AC1.15, AC12.3 · On the 10,000-message fixture: warm open ≤ 100 ms, own message ≤ 50 ms, ≤ 3,000 elements, no frame over 50 ms in a fling, the anchor moves ≤ 1 px on prepend, edit, Wrap up and density.
- `tests/visual/chat-stream.spec.ts` · "the look at three densities" · proves AC14.1, AC14.3 · Structure matches round 5: 15 px text, weights, rhythm, one left edge, centred separators, the pill, fades, the composer at rest and grown; lint guards pass.
- `src/features/chat/timeline.test.ts` · "read mark, New pill, page boundaries" · proves AC1.2, AC1.3, AC1.4 · The mark moves to the last message seen; the pill sits before the first unseen; two messages with one timestamp both appear once; converted replies count as read with their root.

## 4. Decisions that bind it

- **The stream** (#16): `MessageStream` on TanStack Virtual: id keys, a per-conversation measurement cache, sticky day separators, windowed deep jumps, the `feed` pattern with a polite live region that announces new messages without taking focus (#34). Only this file may opt out of the React Compiler (if spike 1 needs it). Wrap up (CV-12) hides replies by a drawing rule; the anchor must not move.
- **Budgets** (#22; spike 1): warm open ≤ 100 ms, own message ≤ 50 ms, ≤ ~3,000 elements, no frame over 50 ms in a 2 s fling, anchor ≤ 1 px on prepends, edits, Wrap up, density. Fixture and spec: `scripts/perf/seed-chat-10k.ts`, `tests/perf/chat-10k.spec.ts`.
- **Kit additions you make** (§17, #32; stories at three densities, `kit-densities.tsx`): avatar size by density (32/28/24), the media size cap in feeds (CV-9 uses it), the recent-past dates in `src/lib/time-format.ts` (Today · Yesterday · Mon up to six days back · Oct 9 · Oct 9, 2025; CH29c).
- **Event lines** (§18): every `kind = 'event'` row draws through one renderer (`moved_out`/`moved_in` come with CV-16); §18's slots are CV-8a's.
- **Hover toolbar and ⋯ menu:** spec §3 bullet "The hover toolbar" (`specs/chat-v2.md` line 52); the quick reactions are Moduo's six defaults until CV-7c; show a ⋯ item only once its block exists.
- The pure parser (cached per message id + `updated_at`, #3) draws rows; start from spike 4; CV-7b completes `parity.test.ts`.

## 5. Files

New: a stream folder under `src/features/chat/` (v1's `ui/*` is deleted by CV-8a: don't build on it), `src/features/chat/markup/`, `scripts/perf/seed-chat-10k.ts`, `tests/chat-stream.spec.ts`, `tests/perf/chat-10k.spec.ts`, `tests/visual/chat-stream.spec.ts`. Touch (and the message rows of `tests/chat-keys.spec.ts`, `tests/visual/kit.spec.ts` are yours): `src/features/chat/timeline.ts` (+ test), `src/lib/time-format.ts` (+ test), `src/components/ui/avatar.tsx`, `feed.tsx`.

## 6. From earlier blocks

CV-3's store (pages, delta, outbox, read mark, `entity-open` landing); CV-0 spikes 1 and 4.

## 7. Watch out

- Tokens only: no raw hex, arbitrary Tailwind values or inline-style design properties (`lint:tw`, `lint:css`; `docs/DESIGN_SYSTEM.md`).
- **Hot files:** `src/features/chat/store/*` and `src/lib/runtime.chat.web.ts` (CV-3's; read, don't reshape). Keep edits there small; another builder may change them too.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Composer and picker (CV-7b); personal quick row (CV-7c); sidebar, toolbar, frame-7 states (CV-8a); Details (CV-8b); inline files (CV-9); chain panel, Wrap up (CV-12); multi-select, move (CV-16).
