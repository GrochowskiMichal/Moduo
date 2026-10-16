# CV-0-S3 — Spike 3: Realtime delivery, typing cost and the plan's quotas

> Branch `t/maciej/cv-0-s3-realtime` · head: the commit that adds this file (base `217d1a62`) · status: built, not landed
> Migration: none. The publication already carried the three chat tables, so nothing was added or removed. Harness: [`scripts/spikes/chat/realtime-load.ts`](../../../scripts/spikes/chat/realtime-load.ts) (all phases, ~12 min) and [`scripts/spikes/chat/realtime-columns.ts`](../../../scripts/spikes/chat/realtime-columns.ts) (which columns an event carries, ~10 s). Every throwaway account, workspace, channel, message, `realtime.messages` row and auth audit line was removed; the harness checks its own leftovers by id after each run (all 0, every run).

## Delivered against the row

Spec Assumptions #17 and #22 against the local stack (Realtime v2.140.10, Postgres 17.11, OrbStack, 18-core Mac). Two full runs, a third run of the hackathon minute, and two short delivery runs that separate subscriber count from send rate. Run 2 is quoted unless noted; the others agree within the ranges given. Four of the five bars pass. **The latency bar fails by 20–85 ms**, and the cause is the server, not the client: Realtime reads the WAL for Postgres Changes about every 0.5 s. **CH31: move to Pro before the event.** 100 people with the app and a tab are exactly 200 sockets, Free's cap, and a busy minute averages 79 Realtime messages a second with peaks of 240. A sustained rate over the cap doesn't slow Postgres Changes, it **stops them for the whole project**, silently.

**Set-up.** 102 throwaway accounts (2 for the browsers, 100 for supabase-js clients). The 100 sign in with tokens minted from the stack's JWT secret, because the stack allows 30 password sign-ins per 5 minutes. One throwaway workspace with a 102-member `general`, a `quiet` channel, two storm channels and five private 4-person rooms. Each node client joins what v1 joins per tab: `chat-db:<ws>:<me>` (Postgres Changes on messages, channels and my memberships), `chat:<ws>` (Presence, tracked) and the open conversation's `chat:typing:<id>`, at 25 joins/s. Two Chromium contexts drive v1's real `/chat` page (rsbuild dev on :8093, `.env.local` at `127.0.0.1`). A `MutationObserver` stamps each `[data-message-id]` when it is added. Context B's socket goes through Playwright `routeWebSocket` so the gap phase can cut it. Senders call `chat_op_send` through PostgREST. The stack is shared: other sessions ran e2e during every run (the global row-count diff shows their tasks and workspaces, not ours).

## Pass bars (round-3 §5, spike 3)

| # | Bar | Measured | Result |
| --- | --- | --- | --- |
| 1 | `supabase_realtime` includes `chat_messages`, `chat_channels` | `chat_channels`, `chat_members`, `chat_messages`, full column lists (no column list or row filter set). Nothing added, nothing to remove | **pass** |
| 2 | p95 receive-to-visible ≤ 500 ms (2 pages + 100 clients) | **102-person conversation, 50 messages 3 s apart:** clients p50 **309** · p95 **530** · p99 597 · max 599 ms (send call → event; commit → event p95 527). Page A (direct socket) **visible in the DOM** p50 321 · p95 **547** · max 610; page B (routed socket) p50 321 · p95 550. Run 1: clients p95 570, page A p95 584. **Hackathon shape** (25 workspaces × 4, 200 sockets): p95 530 / 539 / 520 in runs 2 / 1 / 3. **12 clients**, 20 messages 3 s apart: p50 295 · p95 484 | **fail** (by 20–85 ms; cause below) |
| 3 | zero requests per incoming message | the event carries the whole row: 0 requests are needed (the node clients make none). **v1: 9.98 requests per message** with the conversation open (three badge recounts × `chat_channels` + `chat_members` + `chat_unread_counts`, plus one `chat_op_mark_read`), **2.9** with another conversation open | **pass** (the design); v1's baseline recorded |
| 4 | a 60 s disconnect: list what the stream missed, a `(created_at, id)` delta fills every gap | 20 messages from 4 concurrent senders during the outage (11 pairs share a created_at millisecond), 15 more during the rejoin. **Network lost** (5 clients): missed 28 by stream, back 8.3 s after the network, delta 35 rows, **0 still missing**, 7 in both (deduped by id). **Frozen socket** (5 clients): no error for **43 s**, missed 22, back 1.3 s after, delta 35, **0 missing**. **Page B (v1):** all 35 drawn 8.2 s after the network returned, through v1's resync of every module: **69 requests** | **pass** |
| 5 | typing through `chat_op_typing` + `realtime.send` at 20 typists, 1 event / 3 s | **6.67 database calls/s**; round trip p50 5 · p95 10 ms; **0.9–1.2 ms** of database time per call; **400 `realtime.messages` rows a minute** (one per call); 1,200 of 1,200 delivered, **p95 11 ms**. To a crowd of 99 listeners: 2,970 of 2,970, p95 16 ms. Switching conversations (leave + join): p50 25 · p95 44 ms; 100 clients switching every 10 s = 10 joins/s, p95 15 ms; **200 joins at the same instant**: all joined, p95 537 ms, none refused | **pass** |
| 6 | report for CH31 | below | done |

### Why bar 2 fails: the Postgres Changes poll, not the client

- Sampling `pg_stat_statements` every 50 ms for 15 s showed `realtime.list_changes` running every **473–571 ms** (36 gaps; a poll that finds changes polls again at once). The tenant's setting says `poll_interval_ms: 100`. Idle cadence: 23 polls in 10 s.
- A change therefore waits 0–0.5 s before Realtime reads it, then `apply_rls` checks each subscriber and fans out. The wait dominates: 12 subscribers already give p95 484 ms, and 100 add ~50–90 ms (p95 530–570). The DOM adds only ~12 ms (page A p50 321 vs clients 309), so the client is not the cost.
- Cost grows with subscribers × changes. **20 sends at once into the 102-person conversation:** all 1,980 deliveries arrived, at p50 1,476 · p95 1,499 ms (run 1: 1,569 / 1,602). No error or rate limit was logged for a burst.
- **A sustained rate over the cap stops Postgres Changes for the whole project.** One message a second into the 102-person conversation is ~200 deliveries/s. After 31 s Realtime logged `MessagePerSecondRateLimitReached: Too many postgres changes messages per second`, and **every one of the remaining 10 messages reached nobody** (990 of 3,960 deliveries lost). The clients raised no error; their channel status wasn't recorded in that run. How long the cut-off lasts wasn't measured either (the run ended ~3 s after the last send). Before the trip: p50 346 · p95 571 ms.
- The same server's Broadcast-from-database path (logical replication, no poll) delivered typing at **p95 11–16 ms**.
- Database load from the poll: 7 ms per idle poll. With 102 subscribers and a send every 3 s it averages 14 ms per poll, ~40 ms of database time a second.
- Clock check: the host and database clocks agree within −4…−1 ms (each send's `created_at` falls between its request and its answer), so the commit-based numbers hold.

### What an event carries (for CV-1 and CV-3)

- `{schema, table, commit_timestamp, eventType, new, old, errors}`. INSERT has `old: {}`. `new` is **every column** of `chat_messages`, 19 today. **752 bytes** per event for a 73-character body (`new` alone 612). Each send reaches every connection as **2 events** (the message INSERT, plus the `chat_channels` UPDATE from `last_message_at`); the sender also gets its own `chat_members` UPDATE.
- `created_at` in the event is `2026-10-14T11:25:24.355604+00:00`, byte for byte what PostgREST returns, so the store can merge and keyset on it unchanged. `commit_timestamp` is milliseconds, `Z`.
- **A publication column list does not narrow Postgres Changes.** `realtime.list_changes` decodes with wal2json and passes the publication's tables as `add-tables`, which ignores column lists. The binding's **`select`** does narrow it: `realtime-columns.ts` passes 4/4, cutting 19 columns and 694 bytes to 8 columns and 418 bytes. That holds for `INSERT` and `*`, and on a second socket of the same person. Realtime stores it as `realtime.subscription.selected_columns`.

## CH31: Free or Pro before the hackathon

**Sockets per person:** **1 per tab** (page A opened one socket on `/chat`). The desktop app runs the same web client in its webview: **1**. The Rust side's "realtime" is IMAP IDLE, not Supabase. **Desktop + tab = 2.**

**Channels per connection:** v1 on `/chat` today joins **10**: `focus-runs`, four `tasks-db` channels (tasks, task_completions, agent_sessions, attachments), `tasks-access`, `notice-deliveries`, `chat-db`, `chat:<ws>` and `chat:typing:<open>`. Chat v2's §2.7 adds Catch up, statuses and custom emoji as separate channels: about **13–14 per connection** with one workspace open. The limit is 100.

**A busy hackathon minute, measured:** 25 workspaces × 4 people × 2 sockets = **200 sockets**, each on `chat-db`, Presence and the open conversation's typing topic (600 joins in 23 s, none refused). Each person sends one message at a random second, after three typing events 3 s apart, then a stop: 100 sends and 400 typing calls in the minute.

| | Measured | Free (200 conn, 100 msg/s) | Pro (500, 500) |
| --- | --- | --- | --- |
| Connections | **200** (the 201st refused: `ConnectionRateLimitReached: Too many connected users`) | **at the cap**: anyone else, or any reconnect that loses its slot, is refused (run 3: other sessions' sockets were up, and 3 of our joins failed) | 40% |
| Realtime messages delivered | **78.6/s mean, peak second 240** (4,950 in 63 s: typing 3,168 · message inserts 792 · channel updates 792 · member updates 198) | 79% on average, **2.4× over at peaks** | 16% mean, 48% peak |
| Inbound (sends + typing calls) | 7.9/s | — | — |
| Presence | 12 syncs (teams of 4) | Free allows 20/s | — |
| Message delivery | p95 530 ms; 6 of 600 deliveries missed in runs 1 and 2 (which receivers wasn't recorded); in run 3, 3 single deliveries missed because 3 of our sockets were refused at the cap | | |

**Recommendation: Pro before the event** (CH31 b's trigger: peak sockets 200 > 150). Free is out on connections alone. On Free, one busy shared conversation (e.g. 100 people in an organisers' channel at one message a second) would also cut live chat off for everyone in the project after ~30 s; Pro's 500/s puts that 5× further away. On messages, typing is 64% of the traffic. Two suggestions for CV-1 and CV-3, whatever the plan, would together cut it nearly in half:

1. *Suggestion, product-felt:* join the typing topic only from the focused window. That halves typing (−32% of the total), but a background window shows no typing line until it is focused.
2. Don't publish `last_message_at` on every send: −16%.

The 3-second typing throttle already holds.

The local tenant enforces Free's numbers: it refused the 201st socket, and it **cut off Postgres Changes for the whole tenant** once a sustained ~200 deliveries/s ran for ~31 s (the 1-message-a-second run above). It let short peaks through: a 1.5 s burst of ~4,000 deliveries, the minute's 240-a-second peaks, and 200 joins in under a second. In the minute, Postgres Changes ran at 28 deliveries/s on average, a third of the cap, and typing (Broadcast) at 50/s. The local message only names Postgres Changes, so whether Broadcast counts against the same 100/s on Free was not measured, and Presence's local cap is 1,000/s against Free's 20. The brief kept this off the cloud.

**One 100-person workspace** (not the hackathon shape, but e.g. an organisers' workspace): 100 people opening the app produce **5,926 Presence syncs** (n²/2). Free allows 20 Presence messages a second.

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Bar 2 recorded as a fail with its cause, not tuned away:** the miss is the server's ~0.5 s WAL poll. Why: the local poll setting is not prod's to change, and the client adds ~12 ms. Recommendation for CV-3: keep Postgres Changes as specced, write the live merge so the transport can change, and re-measure p95 on the real project. If prod also misses 500 ms, deliver message rows by Broadcast from the database (the scale path; measured p95 11–16 ms to 99 listeners, one `realtime.messages` row per send per topic). Rejected: changing the local tenant's poll settings (prod's aren't ours to set); claiming a pass from the commit-based numbers (also 527 ms).
- **Tokens minted from the local JWT secret** for the 100 clients; password sign-in only for the two pages. Why: the stack's 30-per-5-minutes sign-in limit. Rejected: magic links (also limited); spreading sign-ins over 20 minutes.
- **The hackathon model:** both of a person's sockets join the open conversation's typing topic and track Presence, as v1 does; one message per person per minute at a random second. Why: it is what v1 would do, so it is the upper bound the trims above cut from. Rejected: one socket per person (under-counts CH31's worry).
- **v1's request count measured with messages 3 s apart:** each message then triggers its own debounced recounts (badge 400 ms, mark-read 600 ms). Bursts collapse them, so 10 per message is v1's steady-state number, not a worst case.
- **Gap simulation:** for the node clients, a WebSocket wrapper passed as realtime-js's `transport`. "Lost" closes the socket uncleanly and refuses reconnects; "frozen" keeps it open and swallows traffic. For page B, Playwright `routeWebSocket` on that context only. Why: it exercises Phoenix's own reconnect and heartbeat paths. Rejected: `realtime.disconnect()` (a clean close that never reconnects by itself).

## Gotchas (area: supabase)

- **supabase (Realtime):** on the local stack, Postgres Changes reads the WAL about every 0.5 s whatever `poll_interval_ms` says, so delivery sits at p50 ~300 / p95 ~530 ms even with a dozen subscribers. Broadcast from the database (`realtime.send`) is ~10 ms. Don't read a 300 ms Postgres Changes delay as a client bug.
- **supabase (Realtime):** a publication column list does not narrow Postgres Changes payloads (wal2json `add-tables`). Narrow them with the binding's `select: [...]`.
- **supabase (Realtime):** the local Realtime restarts its Postgres Changes poller every ~20 minutes (`Rebalancing Postgres Changes replication for a closer region`, a single-node artefact). In run 1 one message sent during that restart reached no subscriber, with every socket up. A rejoin-only gap fill doesn't catch that. (The hackathon minute of runs 1 and 2 also missed 6 of 600 deliveries, with no log line; which receivers wasn't recorded.)
- **supabase (Realtime):** going over `max_events_per_second` for a sustained ~30 s doesn't throttle Postgres Changes: Realtime logs `MessagePerSecondRateLimitReached` and **drops every change for every subscriber in the project**, while each socket stays SUBSCRIBED with no error. A gap fill that runs only on rejoin never notices. The local tenant has Free's 100/s; a 100-person conversation trips it at one message a second.
- **supabase (local stack):** while a test holds 200 sockets, every other session's Realtime connection on the Mac is refused (`Too many connected users`). Run the hackathon phase only when nobody else is testing.
- **supabase (local stack):** load tests can't sign in 100 people by password (30 per 5 minutes per IP). Mint HS256 tokens from `supabase status`'s `JWT_SECRET` at run time. Never print or commit it.
- **supabase (local stack):** the auth admin API writes `auth.audit_log_entries` lines for every create and delete; clean them by the run's email tag. The stack is shared, so a before/after row-count diff shows other sessions' work: check your own leftovers by id.
- **supabase (Realtime):** in every attempt inside the load harness (five runs, as two different people, with 3 to 22 other clients), a `select` binding on a fresh socket answered "Subscribed to PostgreSQL", but no `realtime.subscription` row appeared and no event came. It never failed in isolation (`realtime-columns.ts`, 4/4 on every run), and the difference wasn't found. CV-1 and CV-3 lean on `select`: their probe must assert the narrowed payload arrives in the app's real channel setup, not only that the join succeeds.

## For later blocks

- **CV-1 (publication and columns):**
  - Re-assert the three tables in `supabase_realtime` idempotently, as planned. A column list without `search_tsv` would be harmless but **does nothing for Realtime**.
  - Keep `search_tsv` and `body_text` off the wire with the store's binding `select` (the stream needs id, channel_id, parent_id, author_id, body, created_at, updated_at, edited_at, deleted_at, reactions and the reply fields). Never `select *`. wal2json still decodes the whole row; that's fine.
  - Consider not touching `chat_channels` on every send: the `last_message_at` UPDATE doubles Postgres Changes deliveries and the per-subscriber RLS work for each message. The store can derive "last activity" from message events, and the delta covers the rest.
- **CV-3 (live merge, gap fill, typing):**
  - Apply rows from the event: `new` is the whole row, or the `select` list. `created_at` matches PostgREST's string, so keyset on `(created_at, id)`. UPDATEs carry the full new row (soft deletes, reactions). Skip your own echo by `client_id`.
  - Gap fill: after every re-`SUBSCRIBED` **and** its "Subscribed to PostgreSQL" system message, read `(created_at, id) > newest held` (`updated_at` once CV-1 adds it), union and dedupe by id. Proven 0 missing over a 60 s outage. Also run it on window focus and every minute or two while visible. Events can be lost with the socket up: the project-wide rate-limit cut-off, a poller restart and one unexplained loss, all in Gotchas. A frozen socket also goes unnoticed for ~43 s (25 s heartbeat).
  - Typing: keep `chat_op_typing` (1 ms of database, one row per call). Consider joining the typing topic only from the focused window (the trade-off is under CH31). Switching costs one leave and one join, p95 44 ms.
  - Latency: the ≤ 500 ms budget (#22) is not met by Postgres Changes on this Realtime. Make the merge input transport-agnostic and decide after a prod measurement (above).
- **CV-17 (presence):** in a large workspace, joins cost n²/2 syncs (5,926 for 100 people). Against Free's 20/s, consider tracking only from the focused window, and show a refused or throttled join as an error state (AC1.9).
- **CH31 (Maciej and Mike):** Pro before the hackathon. Peak sockets are 200 with desktop + tab.

## Manual checklist (step → expect → surface)

No UI in this spike. For CV-3's checklist:

- [ ] Two people in one conversation, A sends → B sees it within about half a second, without a page request (DevTools network stays quiet) → Chat stream
- [ ] B turns Wi-Fi off for a minute while A sends 10 messages, then back on → all 10 appear in order within ~10 s, none twice → Chat stream
- [ ] B closes the laptop lid for a minute while A sends, then opens it → the missed messages appear after reconnect → Chat stream
- [ ] A types → B sees "A is typing" within a moment and it clears when A sends → composer line

## Verify before release

- Re-measure delivery p95 on the real project (staging) with `realtime-load.ts`-style clients pointed at it, under the release's own rules for the cloud. The poll cadence there decides whether CV-3 keeps Postgres Changes for message rows.
- The org's plan is Pro before the hackathon, and the project's Realtime quotas read 500 connections / 500 messages/s.
- Prod's Realtime honours `select` on `postgres_changes` (a CV-3 probe that asserts the narrowed payload).
- Presence at Free's 20/s if any workspace at the event has more than ~10 people online.

## How to rerun

`bun scripts/spikes/chat/realtime-load.ts --base-url=http://127.0.0.1:<port>` takes ~12 minutes; it needs `rsbuild dev` from a worktree on the local stack. Without `--base-url` it skips the pages. `--phases=` picks any of `delivery,gap,typing,switch,burst,hackathon`; `--clients`, `--teams`, `--messages`, `--interval`, `--gap-seconds` and `--typing-seconds` size it; `--out` takes the JSON, `--shots` takes the screenshots. `bun scripts/spikes/chat/realtime-columns.ts` takes ~10 s. Both refuse any URL but `127.0.0.1` and clean up after themselves.
