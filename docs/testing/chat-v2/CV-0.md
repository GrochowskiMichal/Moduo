# Manual test checklist — CV-0 The five spikes (spikes 2 to 5)

> Generated 2026-10-14 · branch `t/maciej/cv-fold-1`, folded from the spike records [`CV-0-S2`](../../build/chat-v2/CV-0-S2.md), [`S3`](../../build/chat-v2/CV-0-S3.md), [`S4`](../../build/chat-v2/CV-0-S4.md) and [`S5`](../../build/chat-v2/CV-0-S5.md) · **Live-verified:** no. The spikes ran their own harnesses against the local stack; nothing is wired into the app yet, so most items below are for the blocks that build on them.
> Spike 1 (the list in the real webviews) adds its own section when it lands. Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Re-run the spikes (terminal, local stack up)

- [ ] **Do:** run `bun scripts/spikes/chat/s2/run.ts` (about 6 minutes; `sql`, `browser` or `access` runs one bar) → **Expect:** three `PASS` lines (bars 3a and 3b, bars 1 to 4, bar 5), and the scratch schema `spike_s2` gone afterwards _(terminal)_
- [ ] **Do:** run `bun scripts/spikes/chat/s2/summary.ts` → **Expect:** the p50, p95 and max tables match the record's within machine noise _(terminal)_
- [ ] **Do:** with `rsbuild dev` running from a worktree on the local stack and nobody else testing (it holds 200 sockets), run `bun scripts/spikes/chat/realtime-load.ts --base-url=http://127.0.0.1:<port>` (about 12 minutes), then `bun scripts/spikes/chat/realtime-columns.ts` (about 10 seconds) → **Expect:** the record's picture: delivery p95 near 530 ms, 0 messages still missing after the 60-second gap, typing p95 about 11 ms, and the narrowed payload 4 of 4 _(terminal; from the record's "How to rerun")_

## For CV-3's checklist (spike 3, no UI yet)

- [ ] **Do:** two people in one conversation, A sends → **Expect:** B sees it within about half a second, without a page request (DevTools network stays quiet) _(Chat stream)_
- [ ] **Do:** B turns Wi-Fi off for a minute while A sends 10 messages, then turns it back on → **Expect:** all 10 appear in order within about 10 seconds, none twice _(Chat stream)_
- [ ] **Do:** B closes the laptop lid for a minute while A sends, then opens it → **Expect:** the missed messages appear after the reconnect _(Chat stream)_
- [ ] **Do:** A types → **Expect:** B sees "A is typing" within a moment, and it clears when A sends _(composer line)_

## For CV-19's checklist (spike 5, no UI yet)

- [ ] **Do:** press ⌘K and type "zolw" → **Expect:** messages with "żółw", the word highlighted _(⌘K Messages)_
- [ ] **Do:** type "za", then "zad" → **Expect:** the whole word "za" first, then zadania, zadaniem and zadań _(Chat's Search)_
- [ ] **Do:** as someone outside a private channel, search a word only that channel contains, also with "in: that channel" → **Expect:** nothing _(Chat's Search)_
- [ ] **Do:** scroll to the bottom of a long result list → **Expect:** the next page continues with no repeat and no gap _(Chat's Search)_

## Verify before release

From spike 2 (the store):
- [ ] **Do:** measure the cold open and the 500-row write in **WKWebView** (Tauri, macOS) and **WebView2** (Windows) → **Expect:** inside the bars (cold open of the newest 50 within 100 ms; 500 messages within 8 ms of main thread). Not measured yet; WebKit's IndexedDB is said to be slower on many small writes _(desktop)_
- [ ] **Do:** repeat on a slow Windows laptop at real speed → **Expect:** the same bars hold; the 4× throttle was only an emulation _(desktop)_
- [ ] **Do:** run `chat_sync_ids` with the real permission functions on a workspace with a few hundred channels → **Expect:** a few milliseconds, not seconds _(local stack)_

From spike 3 (Realtime):
- [ ] **Do:** re-measure delivery p95 on the real project (staging) with `realtime-load.ts`-style clients pointed at it, under the release's rules for the cloud → **Expect:** at or under 500 ms; if not, CV-3 delivers message rows by Broadcast from the database _(staging)_
- [ ] **Do:** read the project's Realtime quotas once the plan is Pro → **Expect:** 500 connections and 500 messages a second, in place before the hackathon _(Supabase dashboard)_
- [ ] **Do:** run a probe that subscribes with a `select` list on prod → **Expect:** the narrowed payload arrives (prod's Realtime honours `select` on `postgres_changes`) _(prod)_
- [ ] **Do:** check Presence if any workspace at the event has more than about 10 people online → **Expect:** it stays under Free's 20 messages a second _(prod)_

From spike 4 (the stored form):
- [ ] **Do:** re-run `chat__v1_to_v2` and `check_v1_to_v2.ts` read-only over prod's v1 messages before CV-1 applies → **Expect:** every result parses, no v1 token or label is left, and the accepted-change counts are written down (the research data had none of those kinds, so the real counts are unknown until now) _(prod, read-only)_
- [ ] **Do:** look for a real U+0001 character in prod's v1 message bodies before CV-1 applies → **Expect:** none (the converter uses it as an internal marker, so a body holding one would lose it; from the notes for CV-1) _(prod, read-only)_
- [ ] **Do:** after CV-7b wires the composer, type with a live IME (macOS Japanese input) in Safari and in the desktop app → **Expect:** ⏎ confirms the composition and never sends a message _(Safari, desktop)_

From spike 5 (search):
- [ ] **Do:** check that `unaccent` is in prod's `pg_available_extensions` before CV-1 applies (the spec's risk 10) → **Expect:** it is listed _(prod)_
- [ ] **Do:** on prod, run `select alias from ts_debug('public.chat_headline', 'żółw')` → **Expect:** one `word` token (the headline config tokenizes accented text; the index doesn't depend on it) _(prod)_
- [ ] **Do:** note the lock time of CV-1's table rewrite at prod's row count → **Expect:** about 0.8 seconds per 100,000 rows, as measured locally _(prod)_
- [ ] **Do:** run `chat_search` with the 100,000-row fixture on the real instance → **Expect:** p95 at or under 150 ms _(prod)_

## Migrations / data

- [ ] **Do:** list the scratch schemas on the local stack (`select nspname from pg_namespace where nspname like 'spike_%'`) → **Expect:** no rows; no spike changed `public`, and `unaccent` is the one extension the spikes added _(local stack)_

## Known gaps / not-yet-testable

- **Spike 1** (TanStack Virtual against Legend List 3 in the real webviews) is still building; its checks are added here when it lands.
- **WebKit** (Tauri's macOS webview) wasn't measured for spike 2: the installed Playwright wants a WebKit build this Mac doesn't have, and fetching it is a download. `run.ts browser --webkit-only` runs the same bench once it's there.
- **Spike 4** wired nothing into the app, so there is nothing to click: CV-7a's and CV-7b's checklists cover typing, pasting and drawing messages.
- **Spike 3** didn't measure how long the project-wide cut-off lasts after a sustained rate over the plan's cap, whether Broadcast counts against the same 100 a second on Free, or Presence's real cap on Free (the local tenant allows 1,000 a second against Free's 20).

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The records hold the numbers: [CV-0-S2](../../build/chat-v2/CV-0-S2.md), [S3](../../build/chat-v2/CV-0-S3.md), [S4](../../build/chat-v2/CV-0-S4.md), [S5](../../build/chat-v2/CV-0-S5.md).*
