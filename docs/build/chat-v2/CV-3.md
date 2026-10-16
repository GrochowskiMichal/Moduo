# CV-3 — The chat store (client)

> Branch `t/maciej/cv-3-store` · head: the commit carrying this line · status: built, not landed
> Migration: none. Nothing on the cloud. Verified on the local stack (probe + a throwaway smoke run, below).

## Delivered against the row

- **`ChatStore`** (`src/features/chat/store/store.ts`) on Tasks' pattern, one per person and workspace (`chatStore(runtime, user, ws)`; `react.ts` holds it with `useChatStore` / `useChatSnapshot`):
  - **Device copy** (`device-copy.ts`): IndexedDB `moduo-chat`, `messages` keyed `[owner, conversation, sortable at, id]` with a unique `byId` index on `[owner, id]` (a moved row's old key is deleted first), at most 200 rows a transaction with the eviction to the newest 500 per conversation in the same transaction; one `meta` record per owner (`<person>:<workspace>`): the held conversations, the delta cursor, the access check's mark, the outbox, drafts and the sidebar (conversations, memberships, people, counts) so a cold open paints. Only server rows are kept; a send waits in the outbox. A memory copy with the same contract stands in for tests and where there's no IndexedDB.
  - **Keyset pages** of 51 on `(created_at, id)` (the stream draws 50 and needs one past the edge), a jump window `[target − 100, target + 100]` (`openAt`, `loadNewer`, `jumpToLatest`), chains (`openChain`). A newest page that doesn't reach what was held is a gap: the window starts again at the page. A read reconciles what it covered (a held row it didn't return is gone from here), never dropping a row that landed after the read began.
  - **Delta** by the server's `updated_at`, five minutes early, paged under `(updated_at, id)`: on every (re)join, focus, the network coming back and every 90 s while visible; never per message. Rows for conversations the store doesn't hold are never kept (spike 2's registration rule). A delta 20 pages behind stops and re-reads the open window.
  - **Live merge** from one adapter (`realtime.ts`): a row lands only if newer by the server's stamp; an equal one is your echo and changes nothing; a hard delete of an id not held is ignored; a `moved_out` line drops its ids still filed there. Zero requests per incoming message; the badge slice (`unread`) moves from the row.
  - **Writes:** sends go into the outbox under a client-minted id, visible at once (`sending`), sent in order; a lost network leaves them `waiting` (and kept in meta), sent by themselves on `online` or the retry timer; a refusal makes them `failed` with the server's words ("Not sent · Retry", `retry`, `discard`). Edits, deletes, reactions and pins lay an idempotent overlay over the row until the answer; a refusal drops only that overlay; offline they return `{ offline: true, message: "Offline" }`.
  - **Access check** (`access.ts`, `chat_sync_ids`): on the first load, every rejoin, focus, every 10 minutes and whenever one of your membership rows changes (a live `member` / `member-left`). Removed, deleted, made private and moved-away rows leave memory and the device; an answer without its `checked` row drops nothing.
  - **Read mark** (`markSeen`): forward only, to the message given (the last one on screen), sent 600 ms later; counts refresh after it. `markUnread` by message id.
  - **Drafts** (`draft` / `setDraft`) per conversation and chain in meta. **Wipes:** `wipeChatCopies` (sign-out, account deletion), `attachChatUser` (another person signs in), `keepChatWorkspaces` (workspaces you left), called beside Tasks' three.
- **Typing and presence stores** (`store/typing.ts`, `store/presence.ts`): typing joins only the open conversation's `chat:typing:<id>` (ref-counted, left on switch), sends through `chat_op_typing` at most every 3 s with an immediate stop, expires entries after 6 s, drops your own; presence on `chat:<ws>` tracks you once joined. A refused or failed join is an error state on both ("Typing isn't available", "Presence isn't available"), never empty (AC1.9).
- **The live adapter** (`realtime.ts` rewritten): `postgresChangesSource(socket)`, four client channels (messages and conversations by workspace, your memberships, your Catch up items); messages bound with `select` = `CHAT_MESSAGE_COLUMN_LIST` (`columns.ts`: `search_tsv`, `body_text`, `client_id` off the wire); `joined` only on Realtime's "Subscribed to PostgreSQL" system message, `lost` on error/timeout/close. Broadcast from the database can replace it without touching the merge.
- **Runtime seam**: `src/lib/runtime.chat.supabase.ts` `chatRuntimeOn(client)` (the app's is `runtime.chat.web.ts`, the probe's a test client). New `{ data, error }` transport (never throws): `page`, `chain`, `message`, `delta`, `syncIds`, `people`, `counts`, `send` (client id; `format: "v1"` goes through the 7-argument wrapper, which keeps the id), `edit`, `remove`, `react(key, on)`, `pin`, `markRead/markUnread(messageId)`, `typing`. Op answers narrowed with `.rpc(...).select(columns)`. v1's reads that other surfaces call (`isEnabled`, `listChannels`, `listMyMemberships`, `unreadCounts`, `listPinned`, `search`) and the conversation ops stay (throwing). `ChatRuntime` in `model.ts` is the transport; the v1-only reads (`listMessages`, `listReplies`, `getMessage`, v1 `send/edit/react/markRead`) are gone.
- **Model**: `ChatMessage` gains `replyToId`, `kind`, `event`, `formatVersion`, `mentionedTeamIds`, `mentionsEveryone`, `updatedAt`, `sendState/sendError`; `ChatMember.lastReadId`; `ChatUnread.addressed/catchup`; `ChatPerson.former`; `ChatChannel.isDefault`. Mappers for `chat_people` and `chat_sync_ids`.
- **v1 re-pointed**: `use-chat-module.ts` shapes the store's snapshot for v1's screens (top-level messages in the channel, chains in the thread panel, event lines hidden, workspace members for roles and the picker) and returns a `ChatLink` facade over the typing/presence stores, so `chat-page.tsx` changed by a few lines (`focusMessageId`, "Mark as read", the jump). v1's `MessageList` keeps "Jump to latest" showing while the window is around a linked message and calls `actions.jumpToLatest`; reopening a conversation after a jump also goes back to the newest messages. `use-chat-badge.ts` holds the store app-wide and reads the badge slice (no recount per message); the Home chat widget reads the snapshot too. v1's send path sends v1 markup under the client id (the server converts it).
- **`entity-open`**: `entityOpenTarget(type, id, { messageId, chainId })` → `/chat?c&m&t`; chat notices carry `message_id` / `parent_id` through `notificationDeepLink`, the notification center and the chrome's host; `useChatModule({ focusMessageId })` loads the window around a message not in view.
- `READ_RPCS` lists `chat_people` and `chat_sync_ids`.
- **Probe** `supabase/probes/chat-store.probe.ts`: the app's store, transport and live source on a signed-in test client on the local stack (14 checks).

## Acceptance criteria proven

| AC | Test or live check |
| --- | --- |
| AC12.2 | `src/features/chat/store/store.test.ts` · "device copy, delta, echo, outbox" (9 tests): opens from the device copy before the server answers; after 1,000 missed changes (sends, edits, reactions, deletes, pins, moves, a private conversation) a paged delta equals a full read (the open window in memory, both conversations on the device), and a commit stamped a minute before the cursor is read only through the lookback (negative control with no lookback: missed); a live row with zero requests; the echo changes nothing; a write in flight isn't flicked back; a refusal rolls back one write; the outbox sends in order under the same ids; a message deleted while it's being sent is deleted on the server once it lands. Probe: live row with zero requests, delta = full read, the narrowed `select` payload in the app's channel setup |
| AC1.1 | `store.test.ts` · "offline sends wait, then go in order under the same ids; a refusal says Not sent"; smoke run on the real app: a message sent offline shows, isn't on the server, and is sent after `online` |
| AC1.4 | `store.test.ts` · "no message is lost at a page boundary: 200 share one timestamp", "a reconnect fills the gap before the window shows"; probe: keyset pages over 200 messages on one stamp |
| AC1.6 | `src/lib/entity-open.test.ts` · "lands a chat notice on its message and opens its chain"; `src/features/spine/notifications.test.ts` · "lands a chat notice on its message and chain"; `store.test.ts` · "lands on a message from last month"; `use-chat-module.test.tsx` · "lands a deep link on its message". The on-screen jump bar and highlight are CV-7a's |
| AC1.9 | `src/features/chat/realtime.test.ts` · "a refused join is an error state, not an empty line", "a refused join shows as an error, never as everyone away". On-screen wording is CV-7a's / CV-17's |
| AC10.6, AC10.3 (store half) | `src/features/chat/store/access.test.ts` · "losing access without an event" (removed, deleted, made private, moved away; re-filed by the next delta; a member-left event runs the check; moved-away rows of a conversation only the device holds; two tabs keep each other's conversations registered); probe: a removal leaves the store |

`bun run verify` green (before review). `bun supabase/probes/chat-store.probe.ts`: 14/14. Smoke run of v1's Chat on the store through `scripts/agent/e2e.sh` (a throwaway spec, not committed): loads, live row from another person, composer send, offline send then sent, reload: passed.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Device rows keyed by person and workspace** (`[<person>:<workspace>, conversation, at, id]`): agent · one browser never shows a person another's rows, and a sign-in wipe is a key match (Tasks' copy does the same) · rejected: spike 2's `[workspaceId, …]` (a second person on the device would read the first one's rows until a wipe).
- **Persist none for conversations not held**: agent · the workspace-wide delta and Realtime bring rows of every conversation; only conversations the store opened (registered in meta before any row is written) keep rows, so the access check sees everything on the device · rejected: registering every conversation a delta touches (the device fills with conversations never opened).
- **History pages through PostgREST's spelling, not an RPC**: agent · `lte(created_at) + or(created_at.lt."T", id.lt.X)` is the same keyset (12/12 in spike 2, 200 on one stamp in the probe); CV-1 shipped no `chat_messages_page` and this block has no migration · rejected: a migration for the RPC (spike 2 measured 1.7 ms at depth 5,000 for this spelling; revisit if deep history is slow on prod).
- **v1's screens send v1 markup through the 7-argument wrapper** (`format: "v1"`): agent · it keeps the client id as the row id (`coalesce(p_client_id, …)`) and converts on the server with CV-1's proven converter, so v1's composer works unchanged until CV-7b · rejected: converting on the client with spike 4's `v1Tree` (a test helper, not a send path).
- **Any server answer that isn't a network failure is a refusal** ("Not sent · Retry"), not only `42501` / `P0002` / `22023`: agent · the send limit answers `PT429`, a length `22023`; only a request that never got an answer waits · rejected: waiting on unknown codes (a rate-limited message would retry forever).
- **Four client channels, one adapter**: agent · the brief's "each its own client channel"; joins are debounced into one gap fill · rejected: one channel with four bindings (v1's shape; one error drops all four).
- **Catch up events subscribed but ignored**: agent · a Catch up row arrives per message addressed to you, so a recount on it would be a request per incoming message; CV-11 builds Catch up · rejected: recounting on each.
- **v1's read mark = the newest message in the window while the tab is visible**: agent · v1's list shows the newest messages on open and reports nothing about what's on screen; CV-7a calls `markSeen` with the last row it drew · rejected: marking "now" (v1's old behaviour, against #17).
- **The Home chat widget reads the store** (outside the brief's file list): agent · it held v1's realtime link and recounted with three requests per message; the store's snapshot has everything it shows · rejected: keeping a v1 link for the widget alone (two Postgres Changes subscriptions per workspace).
- **`runtime.chat.supabase.ts` split from `runtime.chat.web.ts`**: agent · the probe runs the app's transport on a test client without loading `runtime.web.ts` · rejected: testing the PostgREST spelling only in mocks.

## Review (validator, one round + this delta)

Three MAJORs fixed: moved-away and hard-deleted ids leave the device even when their conversation isn't in memory (the server names a moved id once); meta merges another tab's conversations and drafts instead of overwriting them; a jump window reopened or "Jump to latest" goes back to the newest page (the window starts again there, never drawing the gap). MINORs fixed: delete while sending, the access check judges what was held when it began, a sign-out stops a multi-chunk write, conversations that aren't open leave memory after a delta, the late-commit test now proves the lookback. Left as noted: the open conversation's window grows with `loadOlder` (no cap; CV-7a's virtual list decides the in-memory budget); `countArrival` approximates `chat_unread_counts` (team mentions, archived, v1 thread replies) until the next gap fill; v1's screens still draw a refused presence as nobody online (the error state is in the store; CV-7a/CV-17 show it).

## Code review (`/code-review high`, `origin/t/maciej/chat-v2-build...HEAD`)

Ten findings; nine changed code, one is left as noted. Each fix has a unit test (`store.test.ts`, `realtime.test.ts`), checked against the code without the fix where it could fail.
- The memberships binding counts only your own row: Realtime doesn't filter deletes, so another person's removed membership arrived as yours; a left stamp from another workspace is ignored too.
- "Jump to latest" reads the newest page only from a window that doesn't reach it (the "N new messages" chip just scrolls).
- Row writes and "mark unread" are refused as offline only when the browser says so: one failed background read no longer refuses every write until the retry timer.
- The gap to the newest page is judged from the held run's newest message (`edge`, kept per conversation in meta), not the newest row held: a live or delta row that landed while the conversation wasn't open no longer hides a gap. Too many delta pages clear the edge.
- A waiting send this tab read from the device and another tab has since sent or discarded leaves this tab's outbox (checked before sending and before writing meta back).
- Delete while sending marks the entry `deleted` (kept with the outbox, out of sight): it's deleted on the server when its answer or its echo lands, even if the answer was lost; refused, it just goes.
- Realtime channels: the four Postgres Changes sources get a fresh topic per start, and typing and presence join a named topic again only once its previous channel has left (realtime-js hands back a leaving channel for the same topic).
- The delta reads only the conversations the store holds (up to 100; more: the workspace).
- `stampMinus` lives once in `features/tasks/live.ts` (re-exported by `lib/sync/store.ts`); the owner key is the sync copy's `cacheKey` / `isKeyOf`.
- `markRead` reads the snapshot at call time (the actions no longer rebuild on every notify). Left: the snapshot's sidebar records are rebuilt on every notify (cheap at chat's sizes); CV-6b caches them if the badge shows up in profiles.

After the review: `bun run test` for chat, sync and tasks live green; e2e: CV-3 owns no committed spec (`tests/chat-stream.spec.ts` is CV-7a's); the throwaway v1 smoke was re-run through `scripts/agent/e2e.sh` and stopped in setup: the reset local stack has the seed person but no workspace for them (stack state, not this change). `bun run verify`: typecheck, Biome, lint:tw, lint:css green; tests green but one, `chat_privacy.test.sql`'s three "activity" checks: the shared stack runs CV-5's catch-up migration (a direct message rings no bell), which this branch doesn't have; the build head's copy of that test (CV-5) adds the edit that writes the row, so it passes after the merge into the build branch.

## Gotchas (area: supabase · store · tooling)

- **(supabase)** Postgres Changes doesn't filter DELETE events by the binding's `filter`: every subscriber gets every deleted row's key. Check the key's person before acting on a delete.
- **(store)** realtime-js `channel(topic)` returns the channel that is still leaving when the same topic is asked for again, and `subscribe()` on it does nothing: wait for `removeChannel` before joining a named topic again (`whenTopicFree` in `realtime.ts`).

- **(store)** An `async` IIFE assigned to a "running" field (`this.x = (async () => { … finally { this.x = null } })()`) that settles without awaiting runs its `finally` before the assignment: the field stays set forever and every later call waits on a finished promise. Chain `.finally` on the promise instead (`drain`, `sync`, `checkAccess` do).
- **(supabase)** The local stack's send limit counts directly inserted rows by author too: a probe or spec that seeds messages "now" as a person, then sends as that person, gets `PT429`. Seed with an older `created_at`, or insert the later rows directly.
- **(supabase)** Typing in a spec writes `chat:typing:<id>` rows to `realtime.messages`; `chat_privacy.test.sql` counts all of them ("typing: a refusal writes nothing") and fails `verify` on any worktree. Delete the topics of conversations you made (or orphaned ones) after a UI run.
- **(store)** A keyset window around a jumped-to message isn't contiguous with the newest page: going back to the newest must restart the window at that page (`lo = null`), or the overlap rule draws the gap between them as if nothing were missing.
- **(store)** `chat_sync_ids` names a moved-away id only for the check after the move: drop it from the device even when its conversation isn't in memory, or it stays there for good.
- **(supabase)** `rpc(...).select(columns)` narrows a composite op answer on PostgREST (probe-checked); without it every op answer carries `search_tsv`.
- **(tooling)** The worktree guard refuses inline `python3 -c` and `$(…)` edits; write the script to the scratchpad and run it with the path.

## For later blocks

- **CV-7a (stream):** read `snapshot.windows[c]` (`rows`, `hasOlder`, `hasNewer`, `newAfter` for the "New" pill, `target` for the highlight); call `open`, `loadOlder`, `loadNewer`, `jumpToLatest`, `openAt` (returns the chain to open), `markSeen(c, lastDrawnId)`; `sendState` `sending | waiting | failed` + `sendError`; `retry` / `discard`; writes return `{ ok } | { offline, message }`. Event lines (`kind: "event"`) are in `rows`. The e2e rows of `tests/chat-stream.spec.ts` are yours. `snapshot.offline` + `fromDevice` → "You're offline · reading from this device".
- **CV-7b (composer):** `store.send({ channelId, body, replyToId, format: "v2" })`; `draft` / `setDraft(c, chain, text)`; typing via `chatTypingStore(runtime, me).send(c, parent, stop)`.
- **CV-8a:** delete `use-chat-module.ts`, `use-chat-live.ts`, the `ChatLink` facade, `format: "v1"` sends and the v1 reads left on `ChatRuntime` (`listPinned`, `search` move to their blocks); `snapshot.status === "locked"` is the paused state's input.
- **CV-6b:** the badge slice is `snapshot.unread[c]` (`unread`, `mentions`, `addressed`, `catchup`), refreshed from `chat_unread_counts` at every gap fill and moved by the store on each new message; `use-chat-badge.ts` holds the store and presence app-wide.
- **CV-11:** the `catchup` live source is subscribed and ignored; Catch up's items come from your rows there.
- **CV-17:** `ChatPresenceStore` is display only; the preference and focused-window tracking go there.
- **CV-9:** the outbox holds text only (`ChatOutboxEntry`); files join it there.
- **Orchestrator:** spike 3's open question is answered on the local stack: the `select` binding's narrowed payload arrives in the app's real channel setup (probe check 11).

## Manual checklist (step → expect → surface)

- [ ] `DOCKER_CONTEXT=orbstack bun supabase/probes/chat-store.probe.ts` → 14 PASS → terminal
- [ ] Sign in, open Chat in a Duo workspace → General paints; reload → the conversation shows at once from the device, then updates → Chat
- [ ] In a second browser as another member, send a message → it appears in the first without a reload; the Chat tab's dot follows → Chat, nav
- [ ] DevTools → Network → Offline, send a message → it shows at the bottom; back online → it's sent (one copy on the server) → Chat
- [ ] Open a chat mention notice from the bell → Chat opens on that conversation at the message (its thread opens when it's a reply) → bell → Chat
- [ ] As the owner remove a member from a private channel → within seconds it leaves their sidebar → Chat (second browser)

## Verify before release

- Delivery p95 of Postgres Changes on the real project (spike 3's local miss is the WAL poll): if it misses 500 ms, swap `postgresChangesSource` for Broadcast from the database behind the same `ChatLiveSource`.
- The cold-open budget (≤ 100 ms for the newest 50 of 10,000) and the 500-rows-in-8-ms put were measured by spike 2's harness, not on this code; re-measure in the real webviews with CV-7a's stream.
- Two tabs of one person: a tab sends the waiting sends it read from the device unless another tab sent or discarded them first (a resend under the same id never doubles a message: the op returns the stored row).
