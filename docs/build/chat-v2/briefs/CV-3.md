# CV-3: The chat store (client, large)

> Read `docs/agents/chat-v2-build.md` first. Branch `t/maciej/cv-3-store`; record `docs/build/chat-v2/CV-3.md`. Quotes are verbatim from `specs/chat-v2.md`; CH… and §6 #n point at `.design/chat-v2/REPLAN.md`, round-3 §… at `.design/chat-v2/research/round-3-database.md`; `#n` is a spec Assumption.

## 1. The row

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 3 | **CV-3** The chat store *(client, large)* | `ChatStore` on the shared pattern (device copy, keyset pages, delta sync, Realtime merge with zero requests, echo skip, one-write rollback, the outbox, the access check), typing and presence stores, the runtime seam re-scoped, the badge slice, `entity-open` landing on the message; v1's screens keep mounting on it until CV-8a | AC12.2, AC1.1, AC1.4, AC1.6, AC1.9 | 2b, 0 (spike 3) |

**Depends on:** CV-2b (the server reads and ops it calls); CV-0 spike 3 (Realtime delivery, the typing cost, the plan's quotas).

## 2. What to build

**§3 The conversation: toolbar, stream and message row** (prototype frames 5, 6, 7)
- **"New" since you last looked:** a small **"New" pill centred on a hairline** at the read mark, no row tint; when you're scrolled up and a message arrives, a **floating "N new ↓" chip** appears and scrolls you down (CH29d). The read mark is **the last message that was on screen**, never "now", and it moves forward only (§6 #17).
- **Sending states** (frame 6): your message is visible under 50 ms after ⏎; offline it sits in place as **"Waiting to send"** and sends itself in order when you're back (CH64); only when the server refuses it does it show **"Not sent · Retry"** (a viewer, an announcement channel, a paused plan). Reactions, edits, deletes and pins while offline say "Offline".

**Edge cases this block handles** (§Edge cases)
- ⏎ while offline → the message sits in place as "Waiting to send" with its real time once sent; reconnecting sends the outbox in order with the same client-minted ids (no duplicate on a retry); a refusal (viewer, announcement channel, paused plan) turns it into "Not sent · Retry" and never into a silently vanished message.
- 200 unread when a channel opens → only the messages that were on screen become read; the read mark moves to the last one seen; the "New" pill sits before the first unseen one and never jumps as older pages load.
- Two messages share a timestamp at a page boundary → both appear exactly once (pages key on time and id).
- A 60 s disconnect with more than 50 new messages → after reconnecting every gap is filled by a delta read before the window shows; nothing is missing for good.
- A 10,000-message conversation → opens warm in ≤ 100 ms with the newest 50 from the device copy, draws only what's on screen (≤ ~3,000 elements), scrolls without a frame over 50 ms; switching back is instant (measurement cache).
- A deep link or a search hit to a message from last month → the stream loads a window around it, highlights it, shows the jump bar; the chain opens beside it when the message is a reply.
- Someone is removed from a private channel → a quiet Catch up line; the channel leaves their sidebar; they can't rejoin unless added; the channel's messages stop arriving in their store within one access check.

## 3. Acceptance criteria

**AC12 — Platform**
- **AC12.2** the chat store opens from the device copy, delta-syncs by `updated_at`, applies Realtime events with zero requests per incoming message, skips its own echo, rolls back one write on refusal and drains an outbox in order

**AC1 — Trust pass (v1's fourteen trust bugs, REPLAN §1.3 B)**
- **AC1.1** a failed send shows "Not sent · Retry" and an offline send waits and sends itself
- **AC1.4** no message is lost at a page boundary or after a reconnect
- **AC1.6** a notice, a search hit and a deep link land on the message and open its chain
- **AC1.9** presence and typing errors show as errors, never as "everyone away"

**Tests that prove them** (file · name · AC · plain English)

- `src/features/chat/store/store.test.ts` · "device copy, delta, echo, outbox" · proves AC12.2, AC1.1, AC1.4 · Opens from IndexedDB; a delta read after 1,000 missed changes equals a full read; the own echo is skipped; a refusal rolls one write back; the outbox sends in order with the same ids.
- `src/features/chat/store/access.test.ts` · "losing access without an event" · proves AC10.6, AC10.3 · Removed, deleted, made private and moved-away conversations leave memory and the device copy within one access check.

The e2e rows that prove AC1.1, AC1.4, AC1.6 and AC1.9 on screen (`tests/chat-stream.spec.ts`: "offline send, retry, undo delete", "floating chip, jump bar, deep link", "live chips, honest errors") need the new stream, so they are completed by CV-7a; prove your halves at unit level (the outbox, the deep-link landing in `entity-open`, a refused presence join surfacing as an error state, never as "everyone away").

## 4. Decisions that bind it

- **`ChatStore` on the shared pattern** (#2, TV-D11a; reference implementation `src/lib/sync/store.ts` with `cache.ts`, `delta-cursor.ts`, `network.ts`, `react.ts`): one IndexedDB row per message (newest ~500 per conversation on the device, ≤ ~1,500 in memory); keyset pages by `(created_at, id)`; delta reads by the server-stamped `updated_at` (soft deletes included); Realtime applied from the event with **zero requests per incoming message**; echo skip by id; one-write rollback on refusal; an outbox for sends drained in order with the same client-minted ids; an access check (`chat_sync_ids`) on rejoin, on focus, every 10 minutes and whenever one of your membership rows changes. Typing and presence get their own small stores (a keystroke redraws no row).
- **Realtime** (round-3 §2.7, #17): Postgres Changes on `chat_messages` + `chat_channels` filtered `workspace_id=eq.<ws>`, `chat_members` filtered to you, `chat_catchup` filtered to you, each its own client channel; every rejoin fills gaps by delta (Realtime is latency, never truth). A row lands only if newer by the server's stamp (`isNewer` in `src/features/tasks/live.ts`). A Realtime delete carries only primary keys: ignore ids you don't hold.
- **Typing:** join only the open conversation's topic `chat:typing:<id>` (leave on switch); send through `chat_op_typing` (the server takes the sender from the session), one event per 3 s, a stop on send or blur, expiry about 6 s on receive. **Presence** on `chat:<ws>` is display only; a refused join is an error state ("Presence isn't available"), never everyone away (AC1.9). "Show me as online" is CV-17's.
- **Losing access sends no event** (§2.7): removed, channel deleted, made private, messages moved away: the conversation leaves memory and the device copy within one access check (spike 2 proves each case).
- **Offline** (CH64): the ops' codes `42501`, `P0002`, `22023` mean the server said no ("Not sent · Retry"); a lost connection leaves the message "Waiting to send". Reactions, edits, deletes and pins offline say "Offline". Add "You're offline · reading from this device" (#33).
- **Drafts** (#28) live in the store's `meta` record per account, workspace, conversation and chain (ids only; wiped on sign-out and account deletion).
- **Runtime seam** (round-3 §1.2): `src/lib/runtime.chat.web.ts` becomes keyset pages, delta reads and client-minted ids (check `error`, never throw); `ChatRuntime` (`src/features/chat/model.ts`, `src/lib/runtime.types.ts` line ~1343) is replaced by the store's API. Always `getRuntime()`, never a bare `{ runtime }` import.
- **`entity-open`** (`src/lib/entity-open.ts`, case `chat_channel`): open the conversation **at the message** and its chain when the payload names one (AC1.6). **Badge slice:** per-conversation counts from `chat_unread_counts`, then moved by the store as rows arrive; the dock, tab and switcher counts are CV-6b's.
- **Budgets** (#22, spike 2): cold open paints the newest 50 of 10,000 in ≤ 100 ms; 500 rows in one transaction ≤ 8 ms of main thread; a delta after 1,000 missed changes equals a full read; heap ≤ +50 MB. Page deltas under a total order with a unique tiebreaker (PostgREST caps responses at 1,000 rows, `docs/gotchas/supabase.md`).

## 5. Files

New `src/features/chat/store/` (store, access check, outbox, typing and presence stores) with `store/store.test.ts` and `store/access.test.ts`. Change `src/lib/runtime.chat.web.ts`, `src/lib/runtime.types.ts`, `src/features/chat/model.ts`, `mappers.ts`, `realtime.ts`, `src/lib/entity-open.ts` (+ test). **Re-point v1's hooks** (`hooks/use-chat-module.ts`, `use-chat-badge.ts`, `use-chat-live.ts`) at the store so v1's screens keep mounting until CV-8a deletes them.

## 6. From earlier blocks

CV-2b: `chat_sync_ids`, `chat_people`, `chat_unread_counts`, `chat_op_mark_read/_unread` (message-id arguments), `chat_op_bootstrap`. CV-2a: `chat_op_send` with the client-minted `id`, `chat_op_typing`. CV-1: `updated_at`, `last_read_id`, the three published tables. CV-0 spike 3's numbers and spike 2's design: read the "For later blocks" sections of `docs/build/chat-v2/CV-0-S3.md` and `CV-0-S2.md` (the store shape, the access check's rule that every conversation the store persists is registered, the binding `select`, the gap fill on re-subscribe, focus and every minute or two). **Transport (orchestrator's choice, deferred to by Maciej):** spike 3 missed the ≤ 500 ms delivery bar by 20–85 ms because the local Realtime reads changes about every 0.5 s. Keep Postgres Changes for message rows as Assumption #17 says, but make the live merge take its input from one adapter so Broadcast from the database can replace it without touching the merge; delivery p95 is re-measured on the real project before release, and that number decides. Rejected: switching to Broadcast now (more triggers and topics than the measured miss justifies).

## 7. Watch out

- List each new read RPC the client calls (`chat_sync_ids`, `chat_people`) in `READ_RPCS` (`src/lib/min-build.ts`), or `min-build.test.ts` fails.
- The local stack has no Realtime publication until a migration adds it; e2e waits for "Subscribed to PostgreSQL" and uses two browser contexts.
- **Tier 2** (migrations, RLS, contracts, moduo-mcp, src/lib/runtime*): one `/code-review high` and one security scan of the diff at the end; scan findings go only into the hand-back.
- **Hot files:** `src/lib/runtime.chat.web.ts` and `src/features/chat/store/*` (this block creates the store; later blocks extend it). Keep edits there small; another builder may change them too.
- **Public repo:** describe no security weakness in any file; tell the orchestrator in the hand-back.

## 8. Out of scope for this block

Every screen: stream (CV-7a), composer (7b), sidebar and states (8a), panel (8b); file uploads in the outbox (CV-9); Catch up UI (CV-11); the presence preference and shapes (CV-17); notices and badges' rings (CV-6b); search.
