> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

# Chat v2: the technical decision blueprint

**Lane:** tech stack. Asked by Mike (co-founder, engineer) for a deeper analysis of the libraries and patterns that make the whole chat feature fast, "senior-like solutions", including whether to swap FlashList for Legend List. "e2e" is read as end to end (the whole feature, from the database to pixels). End-to-end *encryption* gets its own decision (§12).

**How to read it.** Each of the 13 concerns has the same shape: the job and what chat needs · the options compared · a recommendation · rejected options (one line each) · risks · the spike that proves it · the plan block it belongs to. The closing sections hold the decision table (§A), the architecture sketch (§B), the five spikes in order (§C) and the block mapping (§D).

**Legend.** [V] = checked against a primary source (the project's own docs, repo, npm registry, changelog or vendor page), linked. [U] = unverified: a secondary source, a search summary, or prior knowledge. Treat [U] as a lead to check. Repo code is cited as `path:line`. "Local stack" means the OrbStack Supabase on this Mac (image `supabase/postgres:17.11.0.004`, the image hosted projects run); production was not touched.

**Status of this file:** complete (2026-10-13). For Mike's review; it becomes REPLAN §6 and the spec's technical decisions.

---

## 0. The answer in one paragraph

Keep the stack Moduo already has and use it properly; the speed comes more from the data path than from the list library. **The list stays on TanStack Virtual**, which has had chat anchoring built in since May 2026 (`anchorTo: 'end'`, `followOnAppend`) and is already installed at that version. **Legend List is the runner-up, not a beta any more:** its React DOM build has been stable since v3 (May 2026) with no React Native inside. **FlashList is out**: on the web it needs react-native-web, against the repo's direction. The data path: a chat store on Tasks' pattern with a per-row IndexedDB copy, the server's (time, id) order and keyset pages, client-minted ids and an outbox, and a server-stamped `updated_at` (missing on `chat_messages` today) so deltas fill every gap. Each incoming message is applied from its payload with zero requests (v1 made 10). Messages are stored as Markdown with `moduo://` references, parsed once and cached, never an editor per row; image boxes are reserved from stored sizes. Postgres Changes is enough at Moduo's size; Broadcast from the database is the measured way to scale. Search is Postgres full-text search with `unaccent` for Polish. Notifications ride TV-D12 with chat's requirements. **No end-to-end encryption:** it would break five decided features and a planned one, and no work-chat competitor encrypts text. **One plan risk to decide early:** the Supabase Free plan's 200 Realtime connections at the hackathon. Five spikes, the list first in the real webviews, prove all of it before the store migration is written.

## 1. The message list

**The job.** Draw one conversation fast at any length, anchored to the bottom like every chat. It's the heart of the performance problem: v1 renders every loaded message, so a 3,000-message channel reached about 119,000 page elements and a new message took about 3 s to appear ([current state](./current-state.md) §5).

**What chat needs from the list** (REPLAN §6 #17–18 at `.design/chat-v2/REPLAN.md:240-241`; CH27, CH29, CH30):

1. Opens at the bottom, at the "New" line, or at one linked message (a deep link, a search hit, a reply's quote).
2. Older pages prepend with no visible jump.
3. Row heights change after the first draw: a reaction, an edit, a reply chain folding into one row (CH30), the density setting (CH27), images whose box isn't reserved, link previews later.
4. New messages: follow when you're at the bottom; never pull you down while you read history (a "new messages" pill instead).
5. Jump to a message 5,000 back, and back to the present.
6. Sticky day separators (CH29's centred dates).
7. 10,000+ messages in one conversation with a small DOM.
8. Smooth in WKWebView (the macOS desktop app uses the system WebKit) and WebView2 (Windows, Chromium), plus Chrome, Safari and Firefox on the web.
9. Works with the React Compiler, which is on for the whole app (`rsbuild.config.ts:98`).
10. Keyboard and screen readers: move through messages, ↑ edits your last one, focus survives rows being unmounted.

### 1.1 Mike's question first: FlashList, Legend List, and what "beta" means in October 2026

**Moduo uses neither today.** Neither is a dependency (`package.json`), chat v1 has no virtual list at all (current-state §5), and the app's only virtualizer is TanStack Virtual, through Tasks' `VirtualStack`. So the real question is which list chat should adopt, with these two as candidates. Both are React Native list libraries at heart. The question that decides everything for Moduo is whether each runs on React DOM **without** react-native-web.

| | FlashList (Shopify) | Legend List |
| --- | --- | --- |
| Current release | 2.3.3; v2.0.0 shipped 2025-07-31 [V: [npm](https://www.npmjs.com/package/@shopify/flash-list)] | 3.6.0 (2026-09-29). v1.0 2025-04-23, v2.0 2025-09-04, **v3.0 stable 2026-05-28** [V: [npm](https://www.npmjs.com/package/@legendapp/list)] |
| Runs on React DOM without react-native-web | **No.** Peer dependencies are `react` and `react-native` [V: npm]. Shopify says v2 "works a lot better on the web compared to v1" because it no longer needs native components, i.e. through React Native for Web [V: [Shopify Engineering, 2025-07-31](https://shopify.engineering/flashlist-v2)] | **Yes, since v3.** `@legendapp/list/react` is "a DOM-native list with no React Native components or dependencies" [V: [docs](https://legendapp.com/open-source/list/v3/llms-full.txt)]; its published entry imports only `react`, `react-dom` and `use-sync-external-store` [V: [unpkg `react.mjs`](https://unpkg.com/@legendapp/list@3.6.0/react.mjs)]; the only peer dependency is `react` [V: npm] |
| Chat features | `maintainVisibleContentPosition` on by default, `startRenderingFromBottom`, `onStartReached` [V: [v2 changes](https://shopify.github.io/flash-list/docs/v2-changes)] | `alignItemsAtEnd`, `maintainScrollAtEnd` (+ threshold, default 0.1), `maintainVisibleContentPosition` (`size` on by default, `{ data: true }` for prepends), `initialScrollAtEnd`, `initialScrollIndex`, `onStartReached`, `stickyHeaderIndices`, async `scrollToIndex`; a React (web) chat example exists [V: docs, [web chat example](https://legendapp.com/open-source/list/v3/react/examples/chat/)] |
| Recycling | The core of its design (on React Native) | `recycleItems`, off by default; the docs say it "has a neglibible effect on web" [V: docs] |
| Size estimates | None needed in v2 [V: v2 changes] | `estimatedItemSize` is an optional first-render hint (default 100 px); `getEstimatedItemSize` was removed in v3 [V: [v3 migration](https://legendapp.com/open-source/list/v3/migration/)] |
| Benchmarks | "Up to 50% reduced blank area" vs v1, on React Native's New Architecture [V: Shopify] | FlashLight CPU and memory claims on React Native, no numbers in the docs; **no web benchmark found** [V: docs] |
| Accessibility docs | not checked | None in the docs [V: docs] |
| Licence | MIT | MIT |

**What each would mean for Moduo (a React DOM app in a Tauri webview):**
- **FlashList** would bring `react-native` and `react-native-web` back into the web bundle, with React Native's styling model. AGENTS.md says the React Native shim (`src/tw/`) is being phased out and new chrome is raw HTML with tokens. Picking FlashList reverses a stated repo direction for one component. Rejected.
- **Legend List v3** is a real candidate now: DOM-native, MIT, released often (3.3.0 to 3.6.0 between July and September 2026 [V: npm]). Two maturity signals to weigh: its DOM build is five months old, and the GitHub README's roadmap still lists "React DOM implementation" as unchecked while the docs describe it as shipped [V: [repo](https://github.com/LegendApp/legend-list)], so docs and README have drifted. The phrase "Legend List in beta" is out of date in Moduo's favour: the web build is stable.
- **Would an RN-capable list now help a future mobile app?** Less than it seems. Legend List's React Native and React DOM entries share props, not rows: a web row is a `div`, a native row a `View`, so the row components (most of the code) don't carry over without react-native-web. Discord, the closest public example, wrote its core mobile chat view natively because "lists don't perform well for many dynamic rows" [V: [Discord, 2019](https://discord.com/blog/how-discord-achieves-native-ios-performance-with-react-native)]; its later Android work moved to a RecyclerView-based list [U: Discord blog, "Supercharging Discord Mobile"]. The part that really carries to mobile is the data layer: the chat store, the ops, the message parser. The real hedge is to keep those free of the DOM (§3, §2). The mobile plan decides its own list later; this blueprint doesn't pick one for it.

### 1.2 All the options

| Option | How it does chat | Size | Maturity (Oct 2026) | React 19 + Compiler | WebKit / WebView2 | Accessibility | Licence, cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. TanStack Virtual 3** (in the stack) | `anchorTo: 'end'` keeps the visible message in place on prepend (found again by key) and keeps the end pinned while the last row grows; `followOnAppend` follows only when you were at the end; `scrollToEnd`, `isAtEnd`, `getDistanceFromEnd`, `initialOffset`, `initialMeasurementsCache`, `shouldAdjustScrollPositionOnItemSizeChange` [V: [chat guide](https://tanstack.com/virtual/latest/docs/chat), [blog 2026-05-25](https://tanstack.com/blog/tanstack-virtual-chat); installed typings `node_modules/@tanstack/virtual-core/dist/esm/index.d.ts:72-82,118,172-179`] | about 6.1 kB minified [V: [perf blog](https://tanstack.com/blog/tanstack-virtual-perf-and-ios)]; already shipped | virtual-core 3.16.0 shipped the same day as the chat post (2026-05-25) [V: npm]; **Moduo already resolves virtual-core 3.18.0** (`bun.lock:760,766`), whose typings have the chat options (checked). Headless | Needs `"use no memo"` in the file that reads the virtualizer (`src/features/tasks/ui/virtual-stack.tsx:1-4`, `docs/gotchas/ui.md:170`) | iOS Safari touch and momentum fixes built in; backward-scroll jank fixed [V: perf blog]. Desktop WebKit not mentioned | Ours to build (headless) | MIT, free |
| **B. react-virtuoso 4** | `firstItemIndex` (decrease it by the number prepended), `followOutput`, `alignToBottom`, `initialTopMostItemIndex` [V: [API](https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/)]. Its author calls `firstItemIndex` "kind of convoluted and causes complications" and points prepending to the paid message list [V: [discussion #1079, 2024-04-28](https://github.com/petyosi/react-virtuoso/discussions/1079)] | not measured (bundlephobia rate-limited) | 4.18.19, active [V: npm] | Peer deps allow 19 [V: npm]; compiler not checked | virtua's comparison marks Virtuoso's iOS reverse scroll "has glitch with unknown sized items" (a competitor's claim) [V: [virtua README](https://github.com/inokawa/virtua)] | Its own DOM wrappers | MIT, free |
| **C. VirtuosoMessageList** | Purpose-built for chat: declarative scroll modifiers, auto-scroll on arrival, short-conversation alignment, sticky header [V: [product page](https://virtuoso.dev/message-list/)] | not measured | 1.18.1 [V: npm] | Peer deps allow 19 | not checked | not checked | **Commercial**: $168 per developer seat per year, or $312 "Pro"; a `licenseKey` prop in client code; 30-day dev trial [V: [pricing](https://virtuoso.dev/pricing/)] |
| **D. Legend List 3** (`/react`) | `alignItemsAtEnd`, `maintainScrollAtEnd`, `maintainVisibleContentPosition={{ data: true }}`, `onStartReached`, `stickyHeaderIndices` [V: docs] | The React entry is about 347 KB of unminified source as served by unpkg; shipped size not measured | Stable DOM build since 2026-05-28 [V: npm] | Peer dep `react: *`; compiler not documented | Lists Chrome, Safari, Firefox, Edge [V: docs]; no WebKit-specific notes | None documented [V: docs] | MIT, free |
| **E. virtua** | `shift` for prepends, reverse scrolling supported [V: README] | "from ~3kB gzipped" [V: README] | 0.53.5, still 0.x [V: npm] | "react >= 16.14" [V: README] | Its own table marks its iOS reverse scroll "partial: user must release scroll" [V: README] | Ours | MIT, free |
| **F. react-window 2** | No reverse scrolling or prepend anchoring (marked ❌ in virtua's comparison) [V: README] | small | 2.3.4; v2.0 2025-08-28 [V: npm] | Peer deps 18/19 | n/a | Ours | MIT, free |
| **G. FlashList 2 via react-native-web** | See §1.1 | react-native-web on top | 2.3.3 | Through RNW | Through RNW | RN semantics | MIT, plus the RNW runtime |
| **H. Plain DOM + `content-visibility: auto`** | Every message stays in the DOM; the browser skips painting what's off screen. Prepends rely on the browser's scroll anchoring | 0 | `content-visibility` in Safari 18+ [V: [caniuse](https://caniuse.com/css-content-visibility)] | Fine | **WebKit shipped scroll anchoring only in Safari 27.0** [V: [WebKit, Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)]; WKWebView uses the system WebKit and the app sets no minimum macOS (`src-tauri/tauri.conf.json`, checked), so older Macs would jump | Best (real DOM) | Free |
| **I. A custom reverse list** | Whatever we write | ours | weeks of work | ours | ours | ours | Free |

**What Slack, Discord and Linear-class apps do.** None of them documents a web message-list library publicly. What is documented: Slack rebuilt its desktop client so that new code "had to assume a lazily loaded and incomplete data model", with the message pane among the first rebuilt pieces [U: search summary of [Slack Engineering](https://slack.engineering/rebuilding-slack-on-the-desktop/)], and it measures **Time to Visible** (cached content on screen, "unaffected by backend or network performance") separately from **Time to Usable** (newest server content on screen), plus channel-switch time [V: [Slack Engineering](https://slack.engineering/unified-cross-platform-performance-metrics/)]. Discord's mobile chat view is native (above). Linear runs a local-first sync engine over IndexedDB [U]. The shared pattern is cache-first data, a window of messages in memory, and anchoring owned by the app; that's what §1.3 and §3 propose.

### 1.3 Recommendation: TanStack Virtual with end anchoring, in a chat-specific stream component

- **One component, `MessageStream`**, a sibling of `VirtualStack` (not the same component): chat always virtualizes, so there is one anchoring path (VirtualStack draws short lists in plain flow, `virtual-stack.tsx:9-12,27`, which would give chat two behaviours around a threshold).
- **Keys:** the message id; a folded reply chain's row uses the chain's id; a day separator uses its date. Stable keys are what make prepend anchoring work [V: chat guide, "Do not use index keys for chat history"].
- **Options:** `anchorTo: 'end'`; `followOnAppend` on (the stream also scrolls to the end on your own send); `scrollEndThreshold` about 80 px; `estimateSize` per row kind (first message of a group, continuation, day separator, image row from its stored width and height).
- **Restore per conversation:** keep each recent conversation's `measurementsCache` and offset in memory; on return pass them as `initialMeasurementsCache` and `initialOffset`, so switching back is instant and exact.
- **Sticky day separators:** the `rangeExtractor` pattern VirtualStack already uses (`virtual-stack.tsx:75-89`).
- **Deep jumps:** load a window around the target (§3), swap the stream to that window ("viewing older messages · Jump to present"), then `scrollToIndex(index, { align: 'center' })`. The list never holds 10,000 rows in memory.
- **Browser anchoring off on the scroller** (`overflow-anchor: none`), so Chromium, WebView2 and Safari 27's native anchoring never adjusts the same scroll twice [U: TanStack doesn't document this; spike 1 checks it].
- **Accessibility:** the stream as the WAI-ARIA feed pattern (`role="feed"`, each message an `article` with `aria-posinset` / `aria-setsize`, `aria-busy` while a page loads) [U: [W3C APG feed pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)], plus one polite live region that announces only what's addressed to you. Keyboard focus moves by index: scroll to it, then focus once the row is drawn (VirtualStack's `scrollTo` does the first half).

**Why:** it's already in the bundle and the team has shipped it at 10,000 rows (TV-D11b, `docs/decisions/tasks.md:9`); chat anchoring is now built into the version Moduo already resolves; the May 2026 work targeted exactly the hard cases (backward-scroll jank, iOS momentum, a 1,382× faster resize storm) [V: perf blog]; it's headless, so the kit, tokens and accessibility stay ours; MIT, no React Native.

**Runner-up: Legend List 3's React entry**, if spike 1 shows TanStack jumping in WKWebView where Legend List doesn't.

**Rejected:**
- react-virtuoso: its author steers prepending to the paid component; `firstItemIndex` is awkward; one more dependency for what A already does.
- VirtuosoMessageList: a commercial licence key in a public repo's client bundle, and a closed component at the heart of the module.
- FlashList via react-native-web: brings React Native back to the web build against AGENTS.md's direction.
- virtua: still 0.x, and its own table admits partial iOS reverse scrolling.
- react-window 2: no reverse scrolling or prepend anchoring.
- Plain DOM + `content-visibility`: keeps every node (v1's 119,000-element problem), and prepends depend on scroll anchoring that older WebKit doesn't have.
- A custom reverse list: weeks of work for what A now ships; only if every library fails spike 1.
- `column-reverse` or inverted transforms: TanStack's guide advises against them; Legend List's docs warn that `inverted` causes "animation and scroll edge cases" [V: both docs].

**Risks:**
- **A row above the viewport that changes height while you scroll up isn't compensated by default.** TanStack skips re-measure adjustments during backward scrolling to stop the "jump while scrolling up" cascade (`node_modules/@tanstack/virtual-core/dist/esm/index.js:919-945`). So: reserve image boxes from stored sizes (§9), and keep CH30's rule that nothing folds above where you're reading. `shouldAdjustScrollPositionOnItemSizeChange` is the override if needed.
- **Desktop WebKit is the least documented engine** for every candidate. Spike 1 runs in the real Tauri build.
- **The React Compiler** caches reads from the virtualizer's mutable object; the stream file opts out (`"use no memo"`) and rows stay compiled (`docs/gotchas/ui.md:170`).
- **Find in page** can't see rows that aren't drawn; the conversation's own Search covers it (REPLAN §6 #7).
- **A density switch** (CH27) re-measures every row; the anchor must hold through it (spike 1).

**Spike:** spike 1 (§C). **Block:** the message stream block (CH29's look, CH30's rows); the 10,000-message fixture lands with the store block (§3).

## 2. Message rendering

**The job.** Turn a stored message into pixels cheaply enough that the 30–60 rows on screen draw in a few milliseconds, and scrolling never parses text or builds an editor.

### 2.1 The stored form decides the renderer

What's decided: references are stored as `moduo://type/id`, never with a title, and notification excerpts are built on the server from the stored form (REPLAN §6 #3, `.design/chat-v2/REPLAN.md:226`; RF-1-7, `docs/decisions/tasks.md:479`). What exists: comments store plain text with those URIs plus `@Name` for people (`src/features/spine/comments.ts:45-53`); the URI helpers say it's "the convention Notes' markdown already uses" (`src/features/spine/references/text.ts:1-6,18-25`). What CH15 adds: formatting you can see as you type, with markdown shortcuts (`.design/chat-v2/REPLAN.md:482`). v1 stores its own markup with a title inside each reference (`<moduo:TYPE:ID|Label>`, `src/features/chat/markup.ts:3-12`), which §6 #3 converts once.

| Stored form | Size | Server excerpts and search | MCP agents (CH18) | Export (§6 #16) | Fidelity with the editor | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Lexical JSON (`SerializedEditorState`) | Several times the text [U] | The server walks JSON in plpgsql to excerpt and index | Agents must write Lexical JSON, or a server converter does | Needs converting to Markdown | Exact | Rejected |
| **Markdown subset + `moduo://` URIs** | About the text | Plain text in; a derived plain-text column for search (§7) | Agents already write Markdown | Already Markdown | One transformer list both ways, parity-tested | **Recommended** |
| A custom JSON tree | In between | JSON walk again | A format to teach agents | Needs converting | Exact | Rejected |
| HTML | Larger | Strip tags | Awkward | Needs converting | Through `@lexical/html` | Rejected: sanitising on every read |

**The recommended form, concretely:** a CommonMark subset limited to what the composer can make (bold, italic, strikethrough, inline code, fenced code, block quote, bullet and numbered lists, links and bare URLs, line breaks); references as `moduo://<type>/<uuid>` and date chips as `moduo://date/YYYY-MM-DD` (the existing helpers); **people as a URI too** (for example `moduo://person/<uuid>`, to agree with RF-1's kinds), because a stored `@Name` breaks on a rename or a name clash; `mentioned_user_ids` stays on the row for the server's fan-out (`supabase/migrations/20261006150000_chat_module.sql:110`). No raw HTML and no inline images (files are attachments, §9).

### 2.2 The renderer

| Option | Cost per row | Verdict |
| --- | --- | --- |
| A read-only Lexical editor per message | Heavy: each one is an editor, a reconciler and listeners, re-created as rows scroll in | Rejected |
| `@lexical/headless` + `$generateHtmlFromNodes` | Medium, then `dangerouslySetInnerHTML` | Rejected: references are React components (`Reference`), and injected HTML needs sanitising |
| `react-markdown` 10 (already used by the published-note page, `src/routes/pages/published-note-page.tsx:19`) | A unified/remark parse per render; accepts more syntax than the composer makes unless restricted | Fine for Notes' public page; too heavy for the hot path |
| **A small parser → a cached tree → React** | Microseconds per message [U: v1's `markup.ts` parses its grammar with one regex alternation in 257 lines] | **Recommended.** v1's `Block`/`Inline` tree (`src/features/chat/markup.ts:14-28`) is the right shape; swap its tokens for the Markdown subset and `moduo://` URIs |

**Recommendation:**
- **Parse once per version, not per render.** The parser is pure TypeScript with no DOM (the mobile hedge from §1.1). The tree is cached by (message id, `updated_at`) in an LRU of about 2,000 entries; an edit bumps `updated_at`, so a stale tree is never shown.
- **Rows draw the tree with the kit:** `Reference` chips (the same switch comments use, `src/features/spine/ui/comments-panel.tsx:105`), date chips, and mention marks (CH28: only `@you` takes the accent).
- **Memoising is the React Compiler's job** (on, `rsbuild.config.ts:98`). Rows take a message object and a few facts compared by value, never the module API (D11B-3, `docs/decisions/tasks.md:19`; `docs/gotchas/ui.md:174`). The store replaces a message object only when it changes, so unchanged rows are skipped. Only the stream file opts out of the compiler (§1).
- **CSS containment:** `contain: layout style` on each row, so a reaction doesn't re-lay the whole list. Not `paint` (it clips the hover toolbar that overlaps the row above) and not `size` (heights are dynamic) [U: spike 1 measures it].
- **Images never change a row's height:** the box is reserved from the attachment's stored `width` and `height` (AT-1's columns, `specs/attachments.md:168`); the row shows the preview, never the original, with `loading="lazy"` and `decoding="async"`, capped in size (CH29's "a size cap for images in messages").
- **Emoji-only ("jumbo") messages** are detected while parsing, not by measuring.
- **Code blocks:** no syntax highlighting in the hackathon cut; later, highlight only drawn rows, lazily (Prism already ships with `@lexical/code-prism`).

**Rejected:** a Lexical instance per message (cost); server-made HTML (sanitising, and chips are React); `react-markdown` on the hot path (re-parses unless cached, and accepts more than the composer writes); Lexical JSON as the stored form (excerpts, search, agents and export all want text).

**Risks:** two implementations of one grammar (the composer's Markdown export and the renderer's parser) drift apart. Mitigation: one shared list of supported constructs and a parity corpus run in `verify` (spike 4). The person URI needs agreeing with RF-1's kinds before the migration that converts v1 bodies.

**Spike:** spike 4. **Block:** the stream block (renderer), the composer block (serialiser); the one-time v1 body conversion rides the store block's migration.

## 3. The local data layer and sync

**The job.** Keep a copy of your conversations on the device so opening is instant (Slack's "time to visible"), stay correct through Realtime, reconnects and offline, and never lose or double a message.

**Already decided** (REPLAN §6 #2 and #17, `.design/chat-v2/REPLAN.md:225,240`): a device cache per workspace, newest first, delta sync by `updated_at`, the Realtime merge, echo skip, one-field rollback, an offline outbox; the read mark is what you saw; pages fetch by (time, id); gaps are filled before the window shows.

**What the repo gives and what it lacks:**
- `src/lib/sync/` is **Tasks' store**: `WorkspaceStore` imports Tasks' model, live merge and Realtime (`src/lib/sync/store.ts:43-60`). The reusable parts are the IndexedDB wrapper behind the `SyncCache` seam (`src/lib/sync/cache.ts:1-15,39`), "network gone vs server said no" (`network.ts:11`), the delta cursor (`delta-cursor.ts:21`), the React hooks (`react.ts:21-45`), and the rules: ops laid over server rows with one-field rollback (D11a-5, `docs/decisions/tasks.md:239`) and the outbox (D11a-7, `:249`).
- Tasks' device copy is **one record per workspace, written whole**: 10.8 MB and about 30 ms of main thread at 10,000 tasks (D11B-9, `docs/decisions/tasks.md:49`). Chat keeps everything forever (§6 #13), so a whole-record write would grow with history.
- **`chat_messages` has no `updated_at`** (`supabase/migrations/20261006150000_chat_module.sql:103-124`: `created_at`, `edited_at`, `deleted_at`, `pinned_at`; no later migration adds one, the app's `MESSAGE_COLUMNS` has none, `src/lib/runtime.chat.web.ts:15-16`, and the local table's columns confirm it). Reactions and reply counts rewrite the row with no stamp, so "delta sync by `updated_at`" needs a migration. `chat_channels` has one (`:77`).
- v1 pages by `created_at` alone (`src/lib/runtime.chat.web.ts:98`), which skipped a message on a page boundary (current-state, trust bug 4).
- Sends are already idempotent: a client-minted `client_id`, unique per author (`20261006150000_chat_module.sql:122,129`).
- Tasks' copy deliberately holds comments **without text** (D11a-2, `docs/decisions/tasks.md:224-226`). Chat's copy must hold message text, or "offline = read-only from the device copy" (REPLAN §1.4) can't work. Same protections: per person, wiped on sign-out and account deletion, no tokens.

| Option | What it is | For Moduo | Verdict |
| --- | --- | --- | --- |
| **A. Chat's own store on the TV-D11a pattern** | The shared pieces above, plus a per-row IndexedDB layout for messages | Same rules as Tasks; RLS stays the only access model | **Recommended** |
| B. Generalise Tasks' store into one engine first | Refactor `WorkspaceStore` into a core both use | Touches a store that just passed its 10,000-task gate, mid-Tasks-v3 build | Later: extract when a third module (Notes) needs it |
| C. TanStack DB (`@tanstack/react-db` 0.5.8) | Client collections with live queries on differential dataflow; "Updating one row in a sorted 100,000-item collection completes in ~0.7ms on an M1 Pro" [V: [docs](https://tanstack.com/db/latest/docs/overview)] | Pre-1.0 [V: npm]; a second store model beside TV-D11a's; its sync collections target Electric, PowerSync, RxDB | Rejected for now; worth a look for a cross-module query layer |
| D. Zero (Rocicorp) 1.x | A hosted `zero-cache` replicates Postgres into SQLite and syncs queries | Needs a direct database connection for its replication slot, its own permission model (its RLS mode is deprecated), and doesn't support Supabase's HA failover: "a promotion would orphan Zero's replication slot and force a full resync" [V: [Zero docs](https://zero.rocicorp.dev/docs/connecting-to-postgres)] | Rejected: a second authorization system and a new service |
| E. PowerSync (`@powersync/web` 2.4) | Hosted sync with its own "sync rules", SQLite in the browser | Rules separate from RLS, WASM SQLite, a paid service [U] | Rejected |
| F. ElectricSQL (`@electric-sql/client` 1.5) | HTTP "shapes" from Postgres through the Electric service | Auth through a proxy you write; another service | Rejected |
| G. Replicache | In maintenance mode; Rocicorp moved to Zero [V: [replicache.dev](https://replicache.dev/)] | | Rejected |
| H. Dexie 4.4 | IndexedDB with indexes and queries | Chat does need range reads per conversation now; Tasks rejected Dexie as an unused ~40 KB query layer (D11a-1, `docs/decisions/tasks.md:219`) | Fallback if raw IndexedDB schema upgrades get hairy |
| I. SQLite WASM on OPFS | Full SQL and full-text search on the device | A worker, OPFS handles, about 1 MB of WASM [U]; search is server-side by decision (§6 #7) | Rejected: offline search isn't a requirement |

**Recommendation:**
1. **A sibling `ChatStore`** per person and workspace, held by the app shell for the session as Tasks' is (D11a-8, `docs/decisions/tasks.md:254`), built from the shared pieces. Tasks' store isn't refactored now.
2. **Per-row device copy.** A separate IndexedDB database (`moduo-chat`): a `meta` record per workspace (conversations, memberships, read marks, cursors, outbox) and a `messages` store keyed `[workspaceId, conversationId, createdAt, id]`, so a conversation's newest page is one range read. Writes are batched per transaction and throttled, not debounced (`docs/gotchas/supabase.md:126`).
3. **What stays on the device:** the newest ~500 messages of each conversation, at most ~20,000 per workspace, least recently opened evicted first. Older history comes from the server as you scroll. (Numbers tuned in spike 2.)
4. **What stays in memory:** the open conversation's window (at most ~1,500 messages, trimmed at the far end as you scroll; a window that no longer reaches the newest message is "detached", with "Jump to present"), plus the tails of the last few conversations for instant switching.
5. **Order and identity:**
   - Order by the server's `(created_at, id)`, never the device clock (`docs/gotchas/supabase.md:113`).
   - The client mints the message id before sending, as capture does for tasks (`src/lib/sync/capture.ts:33`); the send op is idempotent on it, and echo skip is by id. A resend from the outbox can't double-post.
   - A pending message sits at the bottom in send order; when the server answers it sorts by its server time. A message whose server time is earlier than one already shown is inserted in place, not appended (`created_at` is the transaction's start time).
   - A refused send stays in the stream as "Not sent · Retry" from the outbox (§6 #17; fixes trust bug 1).
6. **The migration deltas need:** `chat_messages.updated_at` stamped by the server on every change (the `zz_stamp_updated_at` trigger pattern, `docs/gotchas/supabase.md:113`) and an index on `(workspace_id, updated_at, id)`. Edits, deletes, reactions, pins and reply counts all move the stamp, so one delta read sees every change. Reads follow D11a-4: `>= cursor − 5 min`, paged by `(updated_at, id)` (`docs/decisions/tasks.md:234`).
7. **History pages by keyset:** `(created_at, id) < (t, id)`, replacing `runtime.chat.web.ts:98`.
8. **Gap filling:** on a Realtime rejoin, the browser's `online`, or a return to the window (throttled to 5 s, `src/lib/sync/store.ts:317-326`), read the workspace's delta and apply it before the window shows. After a long absence (a delta over ~2,000 rows), don't replay it: keep the open conversation, drop the other cached windows and re-read the open one's tail. That's the "lazily loaded and incomplete data model" Slack describes.
9. **Unread counts without recounting:** one call returns counts per conversation at start and after a gap; each live insert then moves the counts in the store. Zero count queries per incoming message (v1 ran three recounts, current-state §5).
10. **Lost access:** leaving or being removed from a private channel moves no message stamp. Reuse D11a-6's id comparison (`docs/decisions/tasks.md:244`) on memberships (small) and drop that conversation's messages from the device.

**Rejected:** B to I as in the table; v1's per-page fetch plus resync (§6 #2).

**Risks:** many small IndexedDB writes are slower in WebKit than in Chromium [U], so batch them; Safari on the web may evict script-written storage under pressure or after a week without a visit [U], which loses queued sends (Tasks accepts the same risk: the copy is a convenience); a big delta after days away (the cap in point 8).

**Spike:** spike 2. **Block:** the chat store block, the first chat block: store, migration (`updated_at` + trigger + index, keyset paging, the one-time v1 body conversion from §2), the 10,000-message fixture.

## 4. Realtime transport

**The job.** Get a new message, an edit, a reaction, typing and presence to everyone allowed to see them, in well under a second, without the server or the clients doing work per person per message that they don't need to.

**Today (v1):** one channel per workspace with `postgres_changes` on `chat_messages` and `chat_channels` (filtered `workspace_id=eq.<ws>`) and on your own `chat_members` rows (`src/features/chat/realtime.ts:79-124`); presence and typing on a private channel `chat:<ws>` (`:127-165`), authorised by RLS on `realtime.messages` (`docs/gotchas/supabase.md:106`). **v1's cost isn't the transport:** one incoming message caused 10 requests because the client recounted badges and marked read (current-state §5). §3's store applies the row it receives and makes no request.

**Facts that shape the choice:**
- Postgres Changes "authorizes every event against each subscriber", processes changes "on a single thread to preserve their order", and doesn't apply RLS to DELETE events [V: [Supabase, Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)]. Chat already avoids hard deletes for that reason (`docs/gotchas/supabase.md:105`).
- Supabase's benchmarks: Postgres Changes with RLS on a Micro instance, 500 clients at 30 changes/s, p95 228 ms; at 3,000 clients, 5 changes/s, p95 616 ms. Broadcast from the database: 80,000 users, 10,000 messages/s, p50 46 ms, p95 132 ms [V: [benchmarks](https://supabase.com/docs/guides/realtime/benchmarks)]. Supabase suggests Broadcast beyond about 3,000 concurrent subscribers on the same changes [V: Postgres Changes page].
- Broadcast from the database: `realtime.send(payload, event, topic, private)` or `realtime.broadcast_changes(…)` from a trigger; messages live in `realtime.messages` partitions deleted after 3 days; private by default; **replay** on private channels returns at most 25 messages from the last 72 hours to 4 days [V: [Broadcast](https://supabase.com/docs/guides/realtime/broadcast)].
- Private-channel policies are "checked when the client connects and joins" and "cached for the duration of the connection"; someone whose access is revoked "will keep receiving messages until their JWT expires or a new one is sent" [V: [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)].
- **Quotas** [V: [limits](https://supabase.com/docs/guides/realtime/limits)]:

  | | Free | Pro | Pro, no spend cap / Team |
  | --- | --- | --- | --- |
  | Concurrent connections | 200 | 500 | 10,000 |
  | Messages per second | 100 | 500 | 2,500 |
  | Channel joins per second | 100 | 500 | 2,500 |
  | Presence messages per second | 20 | 50 | 1,000 |
  | Broadcast payload | 256 KB | 3,000 KB | 3,000 KB |

  Plus 100 channels per connection and 1,024 KB per Postgres Changes payload on every plan. The org is on Supabase's Free plan as of 2026-10-08 (`specs/attachments.md:167`).
- **Moduo's scale:** teams of 2–5 on Duo and Team; the hackathon is at most about 100 people, each team in its own workspace (CH20, CH22). Per-subscriber checks are not a bottleneck at this size.

| Option | Good | Bad | Verdict |
| --- | --- | --- | --- |
| **A. Keep Postgres Changes for message rows; fix the client** | RLS per subscriber with no extra code; whole rows arrive; the same pattern as Tasks | Tops out around 3,000–4,000 messages/s with RLS; p95 grows with clients | **Recommended now** |
| **B. Broadcast from the database: ids-only "pokes" on per-person topics, rows read through RLS** | Broadcast's fan-out; no content on the socket, so the cached-authorization lag leaks nothing but an id; no private-channel activity shown to non-members | One small `realtime.messages` row per member per message; one extra read per batch of pokes | **The scale path**, behind a measured trigger |
| C. Broadcast full rows on per-person topics | Fastest delivery | Message content on a channel whose access lingers until the JWT expires | Rejected |
| D. One topic per conversation | Natural for private channels | 100 channels per connection; join storms against 100 joins/s on Free | Rejected |
| E. The sender's client broadcasts the message | Lowest latency | Not tied to the commit; a client can send what the server refused | Rejected |
| F. A third-party service (Ably, Pusher, Stream, Liveblocks) | Mature | A second authorization model, a new data processor, cost | Rejected |

**Recommendation:**
- **Messages: A.** One chat channel per workspace for `chat_messages` and `chat_channels`, one for your own memberships; a newly published table gets a channel of its own (D11B-8, `docs/decisions/tasks.md:44`; `docs/gotchas/supabase.md:131`). Each event is applied to the store by the server's stamp and makes no request. Realtime stays a latency layer: every rejoin triggers §3's gap fill.
- **Switch to B when spike 3 or production shows it:** p95 receive-to-visible over 1 s, more than about 500 members connected to one workspace, or Realtime messages/s near the plan's cap. B's shape: an AFTER INSERT OR UPDATE trigger on `chat_messages` sends `{conversation, id, updated_at}` to `chat:u:<member>` for each member; clients batch pokes for about 50 ms and read the rows in one select.
- **Typing:** client Broadcast on the private `chat:<ws>` channel, as v1, sent only while `SUBSCRIBED` (`docs/gotchas/supabase.md:108`); at most one "typing" every 3 s per conversation, a "stop" on send or blur, expiring after about 6 s on the receiving side. Never stored.
- **Presence:** Presence on the same channel, one key per person (v1's `presence: { key: userId }`). A refused join must show as an error, not as "nobody online" (v1 only handles success, `realtime.ts:157-164`).
- **Pings from other workspaces (CH6):** don't subscribe to every workspace's chat. Subscribe once to your own notification rows across workspaces (TV-D12's table, filtered by `user_id`), one channel whatever the number of workspaces.
- **Tests wait for "Subscribed to PostgreSQL"** before writing (`docs/gotchas/supabase.md:115`).

**Risks:**
- **The Free plan's 200 connections.** About 100 hackathon participants with the desktop app and a browser tab each is about 200 sockets on one project, before anyone else using Moduo. Moving the org to Pro (500 connections, 500 messages/s) before the event is a cost call for Maciej and Mike; spike 3 counts real sockets per person.
- Presence bursts when 100 people open the app at once, against 20 presence messages/s on Free (whether that limit is per project or per channel isn't stated [U]).
- Reactions rewrite the whole row (body included) to every subscriber; fine for teams, worth watching in large channels.

**Spike:** spike 3. **Block:** the chat store block (the live merge); presence and typing with CH9 / CH28's presence work.

## 5. The editor and composer

**The job.** One Lexical composer (CH15, decided) with the app's grammar (`@` people then things, `#` tags, `/` commands; CH14), `:` emoji, markdown shortcuts, paste and drop of files, ⏎ to send, a draft per conversation, and an inline editor for edits.

**What exists:** the Lexical 0.52 suite is already in the app (`package.json`); RF-1's `MentionMenuPlugin` with `candidatesFor` / `onPick` / `onMenuChange` (`src/features/spine/editor/mention-menu-plugin.tsx`; U14-2, `docs/decisions/tasks.md:74`); the Reference node (RF-1-1); one tokenizer for the grammar (`src/features/spine/grammar.ts`; RF-1-8); the attachments plan's `DRAG_DROP_PASTE` handler (`specs/attachments.md:201`); capture's draft rule, "one per person and workspace, ids only" (U14-9, `docs/decisions/tasks.md:110`).

**The plugin set:**

| Need | Lexical piece | Note |
| --- | --- | --- |
| Rich text, undo | `RichTextPlugin`, `HistoryPlugin` | |
| `@ # /` | RF-1's `MentionMenuPlugin` | the one grammar |
| `:` emoji | a second trigger on the same menu | local index, no network |
| Markdown shortcuts | `MarkdownShortcutPlugin` with **only** §2's subset | the same list exports on send and defines the renderer's grammar |
| Links | `AutoLinkPlugin`, `LinkPlugin` | previews later (§10) |
| Lists, code, quote | `ListPlugin`, `CodeNode`, `QuoteNode` | highlighting later |
| ⏎ sends, ⇧⏎ new line, ↑ edits your last, Esc cancels an edit | a small key plugin on `KEY_ENTER_COMMAND` at high priority | yields to an open menu (⏎ picks) and to IME composition (`isComposing`), for Japanese and other input methods |
| Clean paste | a `PASTE_COMMAND` handler that keeps text and links and drops styles | CH15: "Pasting stays clean text" |
| Pasted or dropped files | `DRAG_DROP_PASTE` → the AT-2 upload pipeline | a pasted screenshot becomes an attachment chip in the composer (§9) |
| Formatting buttons only on a selection | a floating toolbar that reads the selection | CH15's later addition |
| A draft per conversation | the composer's Markdown saved to the chat store's `meta` record about 500 ms after typing stops; restored on open; wiped on sign-out | U14-9's precedent |

**Typeahead speed:** people come from the store's member list (local, instant); things come from `searchEntities`, an `ilike` on the registry's labels (`src/lib/runtime.web.ts:2840-2869`), debounced about 120 ms with the stale request aborted, showing local results (people, recent references) at once so the menu never opens empty; 8–10 results. Emoji search runs over a prebuilt array of about 1,900 entries plus custom ones, built once when the picker data loads.

**Instances:** one composer per open conversation, one in the right panel's reply chain (CH30), and one inline editor only while you edit a message. Never an editor per row (§2).

**Send path:** ⏎ → export Markdown with the Reference node's transformer → mint the id → the store's op (or the outbox offline) → clear. The row appears in the stream at once (budget in §13); `mentioned_user_ids` come from the person URIs.

**Rejected:** a plain text box with an overlay (v1; U14-2 rejected the overlay for capture); Tiptap/ProseMirror or Slate (a second editor framework beside Lexical); a hand-rolled `contentEditable` (Lexical is ratified, CH15).

**Risks:** Markdown export and import fidelity for nested lists and code (spike 4); ⏎ fought over by the menu, IME and send; HTML pasted from Slack or Google Docs (the clean-paste handler); selection quirks in WKWebView [U].

**Spike:** spike 4. **Block:** the composer block (CH14, CH15), on RF-1 and TV-U14, both landed.

## 6. Emoji and custom emoji

**The job.** A picker behind `:` and ☺, and behind "Customize…" for the quick reactions (CH16, CH16a, CH29b); emoji drawn the same way in messages and reactions; and custom workspace emoji (CH16b: PNG, GIF or WebP up to 256 KB, shown at up to 128 px, names like `:shipit:`, an animated one plays only on hover and never with reduced motion, part of the export, admins remove any).

| Picker | What it is | Verdict |
| --- | --- | --- |
| **Frimousse 0.4** (Liveblocks) | "A lightweight, unstyled, and composable emoji picker for React", virtualised; Emojibase data fetched and cached, **self-hostable** through `emojibaseUrl`; custom data through `resolveEmojiData` ("used as-is"), custom drawing through the list's `components`; hides emoji the browser can't draw; React 18/19; MIT; still 0.x [V: [repo](https://github.com/liveblocks/frimousse), [typings](https://unpkg.com/frimousse@0.4.0/dist/index.d.ts), npm] | **Recommended**: unstyled means the kit and tokens style it |
| emoji-picker-element 1.29 | A web component in Shadow DOM, "~12.5kB min+gz", IndexedDB cache, self-hostable data, custom emoji built in, "accessible by default"; Apache-2.0 [V: [README](https://github.com/nolanlawson/emoji-picker-element)] | Runner-up: styling lives behind CSS variables inside a shadow root, hard to make it the kit |
| emoji-mart 5.6 | Last published April 2024; its React wrapper's peer dependencies stop at React 18 [V: npm] | Rejected: stale |
| Our own on `emojibase-data` 17 + a TanStack grid | Full control | Fallback if Frimousse's custom-emoji path doesn't fit |

**Native emoji or an image set?**
- **Native** (the OS font): zero bytes; Apple Color Emoji on macOS, Segoe UI Emoji on Windows. Windows draws **no country flags** (two letters instead); Microsoft's answer cites neutrality [V: [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5554132/it-s-time-for-microsoft-to-fully-support-flag-emoj)].
- **An image set** (a Twemoji fork, Noto): one look everywhere, at the cost of images or a multi-megabyte colour font, plus attribution terms [U].
- **Recommendation:** native for the hackathon cut; on Windows only, a small flag-only web font scoped by `unicode-range` so flags appear [U: size to check]. One image set everywhere is a visual call for Maciej (CH29's territory), not a performance need.

**Custom emoji:**
- **Table** `chat_custom_emoji(id, workspace_id, name, storage_path, poster_path, mime, width, height, bytes, animated, created_by, created_at, updated_at, deleted_at)`, name unique per workspace among live rows; soft deletes, so §3's delta and Realtime see removals.
- **Storage:** the attachments pattern (a private bucket, AT-1), named by content hash; PNG, GIF or WebP up to 256 KB. **No SVG** (it can carry script).
- **Upload, in the browser:** decode with `createImageBitmap` (proves it's an image, reads its size); scale a still image down to the 128 px box; an animated file must already fit (128 px, 256 KB) or is refused with a plain message, because re-encoding animation in the browser is costly; make a **still poster** of the first frame (an `<img>` GIF can't be paused, so "plays on hover only" needs a separate still), via `ImageDecoder` where the engine has it, else a canvas draw [U: per-engine support]. The server op checks name, type and size again; the bucket's own type and size limits are the backstop.
- **Delivery:** a signed URL changes every time it's minted, which defeats the browser's cache. The chat store keeps the workspace's emoji list (through the delta) and caches each image's bytes in IndexedDB by hash, fetched on first use and drawn from object URLs; capped (say 20 MB).
- **In text:** stored as `:name:` (readable in exports and by agents), resolved when drawn; a deleted emoji reads as its text, as in Slack. Reaction keys work the same way.
- **Motion:** the poster at rest; the animated file on hover; never with `prefers-reduced-motion` (CH16b).

**Risks:** Frimousse is 0.x and young; custom emoji through `resolveEmojiData` needs a prototype. Flag font licensing and size [U].

**Spike:** none of its own; a half-day check inside the composer block. **Block:** the picker with the composer block; custom emoji in their own block, right after the hackathon cut (CH16b's recommendation), on AT-2's upload pipeline.

## 7. Search

**The job.** Find messages and conversations: "Messages" and "Conversations" groups in ⌘K, and Search inside a conversation (REPLAN §6 #7, `.design/chat-v2/REPLAN.md:230`); people by name (trust bug 10); Polish and English text (CH20); no history limit (§6 #13).

**Today:** an `ilike '%q%'` on the raw body with no index (`src/lib/runtime.chat.web.ts:139-152`): 410 ms at about 3,000 messages, reading every message and running the read rule on each row first (current-state §5). Under RLS a filter that isn't leakproof runs after the access check on every row (`docs/gotchas/supabase.md:132`); `tasks_search` solved the same by testing text first in a SECURITY DEFINER function (D11B-5, `docs/decisions/tasks.md:29`).

**What Supabase's Postgres 17 offers** (queried on the local stack, the hosted image): `unaccent` 1.1, `pg_trgm` 1.6, `pgroonga` 3.2.5 and `rum` 1.3 are available; **ParadeDB's `pg_search` and `pg_bigm` are not**. There are 29 text-search configurations including `simple` and `english`, and **no `polish`**. `unaccent`'s rules fold every Polish letter (ą→a, ć→c, ę→e, ł→l, ń→n, ó→o, ś→s, ź→z, ż→z) [V: the image's `unaccent.rules`]. Notes already indexes with `to_tsvector('simple', …)` because people write in both languages (`supabase/migrations/20260703120000_notes_module.sql:10,34-44`).

| Option | Good | Bad | Verdict |
| --- | --- | --- | --- |
| **A. Postgres full-text search: `simple` + `unaccent`, prefix matching, GIN** | Built in; Notes' precedent; "zolw" finds "żółw"; prefixes soften Polish endings | No stemming: "zadania" finds "zadaniem" only through the shared prefix | **Recommended** |
| B. A + `pg_trgm` for typos and substrings | Fuzzy matches | A large index; `tasks_search` rejected `pg_trgm` for tasks (D11B-5) | Later, if people ask |
| C. PGroonga | Real multilingual tokenising, CJK included | An extension to enable on prod, its own operators, a heavier index | The upgrade path if inflection or Japanese text becomes a complaint |
| D. ParadeDB `pg_search` (BM25) | Best relevance in Postgres | Not available on Supabase | Rejected |
| E. An external engine (Typesense, Meilisearch, Algolia) | Relevance, typo tolerance | A second copy of every message, access control rebuilt outside RLS, a new data processor | Rejected |
| F. Search on the device | Works offline | Only the cached tail is on the device (§3) | Rejected |

**Recommendation:**
- **Columns** (in the store block's migration, so the table is rewritten once): `body_text` (the Markdown with syntax and `moduo://` URIs stripped), maintained by the trigger that stamps `updated_at`, and a generated `search_tsv` = `to_tsvector('simple', chat_unaccent(body_text))`, where `chat_unaccent` is an IMMUTABLE wrapper around `unaccent` (needed because `unaccent` isn't immutable and a generated column requires it) [U: the standard pattern; spike 5 proves it]. A GIN index on live rows only (`where deleted_at is null`).
- **A reference adds no words** (its title isn't stored, RF-1-2): searching "logo" doesn't find a message that only links a task called "Logo". That's the privacy rule working; ⌘K finds the task itself.
- **One function, `chat_search(workspace, query, conversation?, before?, limit)`, SECURITY DEFINER:** `websearch_to_tsquery` (quotes and `-word` work) with each word made a prefix; the text matched first through the index, then `chat_can_read_channel` on each match until the limit (the D11B-5 pattern); newest first, a relevance sort (`ts_rank_cd`) later; returns ids and a highlighted snippet (`ts_headline`). ⌘K, a conversation's Search and the MCP tool all call it.
- **People** are found from the member list and the registry, not from messages.
- **⌘K:** conversations come from the `entities` registry (channels register there, §6 #15; `searchEntities`, `src/lib/runtime.web.ts:2840`); messages from `chat_search`, debounced, the top 5, then "See all in Chat".
- **Cost on send:** one GIN entry, deferred into GIN's pending list [U]; measured in spike 5.

**Risks:** no Polish stemming (accepted, softened by prefixes; PGroonga is the way out); a SECURITY DEFINER search must re-check access on every match (a Tier 2 review item per AGENTS.md, since it sits next to RLS).

**Spike:** spike 5. **Block:** columns with the store block's migration; the function and ⌘K in the "search in ⌘K" block (the teams-of-2–5 cut, CH26a).

## 8. Notifications and badges

**The job** (CH6, decided; CH7): ping only what's addressed to you (a direct message, `@you`, a reply in a chain you're in, an announcement), as an OS notification on desktop or a browser notification on the web (opt-in), only when Moduo isn't in front of you or you're in another module, from any workspace with its name on the notice, one per conversation per burst ("Sofia · 3 messages"). Focus holds pings until the session ends; quiet hours (off by default) follow your time zone.

**Who builds what:** chat adds rows, not its own sender (REPLAN §6 #6, `.design/chat-v2/REPLAN.md:229`). TV-D12 builds the table and the channels: "browser push via Web Push (VAPID keys in env, a `push-send` Edge Function on pg_cron, a service worker in the web build); desktop via `tauri-plugin-notification` with the app kept alive in the tray when the window closes" (`specs/tasks-v3.md:368`). The plugin is already a dependency (`package.json`, `src-tauri/Cargo.toml:46`) and Focus's phase alerts already ask for permission (`src/features/focus/phase-alert.ts:76`).

**What chat needs from TV-D12** (requirements to hand over, not a second design):
1. **Seconds, not a cron minute.** A `push-send` on pg_cron suits reminders; a direct message must leave within seconds. Chat's rows should wake the sender at once (a trigger through `pg_net`, or a queue the worker drains continuously), with pg_cron only as the sweeper. `pg_net` and `pgmq` are both on the image (§7's query).
2. **The server decides "addressed to you"** when a message is written (mentions from the person URIs, chain membership, DMs, announcement channels), and writes one row per recipient. The excerpt is built on the server from the stored form, with "Private item" for references the recipient can't read (§6 #3, RF-1-7).
3. **One device rings, not all.** With the desktop app and a browser tab open, both would ring. A client shows an OS notification only when its window isn't focused **and** it's the person's most recently active client (an "active at" value in Presence, §4). Web Push goes out only when no client has the row open or acknowledged within a short delay [U: similar to how Slack holds mobile pushes while you're active on desktop].
4. **Bursts:** on the web, a notification with the same `tag` replaces the previous one, so "Sofia · 3 messages" updates in place [U: MDN, to check `renotify`]; on desktop, the client throttles per conversation (the first message rings, later ones within about a minute update a count). Note that tasks-v3 groups the bell by (recipient, kind, hour), which is the bell's rule, not chat's burst rule.
5. **The app must be running on desktop.** Tauri has no push service for a quit app, so close-to-tray (TV-D12) is what keeps pings arriving.
6. **Focus and quiet hours on the server too.** Web Push is sent by the server, so it must see your Focus run (TV-F6's engine) and quiet hours (`user_preferences`, TV-D14). On desktop the client also holds; held pings come back as one summary when Focus ends ("3 held until Focus ends").
7. **Clicking lands on the message**: conversation + message id → §1's deep jump (fixes trust bug 6).

**Badges:**
- **Desktop:** `setBadgeCount` on macOS and Linux (app-wide); **Windows is unsupported** and uses `setOverlayIcon` per window instead (draw "1–9" and "9+" icons; may need the `image-png` feature); `setBadgeLabel` is macOS only; each needs its capability permission (`core:window:allow-set-badge-count` isn't in the default set) [V: [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)]. The installed `@tauri-apps/api` 2.12.1 has both calls (`node_modules/@tauri-apps/api/window.d.ts`, checked).
- **Web:** the tab title "(3) Moduo" and a dot on the favicon. `navigator.setAppBadge` is for installed web apps only [V: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Badging_API)].
- **The number** counts what's addressed to you across workspaces (CH6's "Number"), not every unread message.

**Rejected:** a chat-only notifier (§6 #6); polling; FCM or APNs for desktop (not needed: the desktop app notifies itself while running, the web uses standard Web Push).

**Risks:** duplicate pings across devices (point 3 needs a test with two clients); Web Push delay if the sender stays on cron; Windows notification identity in unsigned dev builds [U].

**Spike:** none in this lane; TV-D12 owns the channel spikes. **Block:** the "pings that leave the app" block (CH6, the hackathon cut's second item), after TV-D12 and, for holding, TV-F6 and TV-D14 (all "Ready, not built", REPLAN §7).

## 9. Files and images

**The job** (CH17, decided, in the hackathon cut): paste, drop or attach; images and PDFs preview inline; everything else is a file chip; through the app's attachments pipeline (50 MB per file today); files listed in the conversation's Details.

**Reuse, not rebuild.** AT-1 is live: a polymorphic `attachments` table with `width`, `height` and `preview_path` (`specs/attachments.md:168`), a private bucket, the client uploading against a pending row. AT-2 (open) brings the pipeline chat needs: TUS resumable uploads above 6 MB through `tus-js-client` (`:173`); previews made in the browser (decode with `createImageBitmap`, or `<img>` for HEIC on WebKit; over 4096 px scaled; EXIF stripped; **WebP only where `toBlob('image/webp')` really returns WebP, since Safari and WKWebView silently return PNG**, else PNG with alpha or JPEG at 0.8, `:188-192`); signed URLs for 1 h (previews) and 10 min (originals) (`:202`); a persistent upload queue with backoff and resume (AT2-1, AT2-6).

**What chat adds:**
- `entity_type = 'chat_message'`, with access following the conversation (`chat_can_read_channel`); the attachments policies learn that type (a migration in the files block).
- **Upload, then send:** chips with progress in the composer; the message goes when its files are done. Offline, the outbox keeps the message and the upload queue keeps the files (as Blobs in IndexedDB), sent in order, files first.
- **No reflow:** the inline preview's box comes from the stored size, capped (CH29), §2.
- **Signed URLs** minted in batches (`createSignedUrls`) per screenful and kept in memory for their lifetime, never per render.
- **PDFs:** a first-page preview made at upload with `pdfjs-dist`, loaded only when a PDF is attached (it's large [U]), stored as the attachment's preview; everything else is a chip.
- **Placeholders:** a token-coloured box at the reserved size. ThumbHash or BlurHash (blurred previews, a few dozen bytes each [U]) are a look decision for later, not a speed need.

**Supabase image transformations: not needed.** They're on Pro and above only, 100 origin images included then $5 per 1,000, sources up to 25 MB and 50 MP, output up to 2,500 px, auto-format WebP only [V: [Supabase](https://supabase.com/docs/guides/storage/serving/image-transformations)]. AT-2 makes previews in the browser, and the org is on Free.

**Rejected:** server-side resizing (cost and plan, above); a chat-only upload path (AT-2 exists); originals in the stream (memory and bandwidth).

**Risks:** AT-2 isn't built yet (REPLAN §7: "AT-2 open"), so chat's files block waits on it; HEIC outside WebKit stays a file chip; WebKit's PNG-instead-of-WebP makes previews larger on macOS.

**Spike:** none of its own (AT-2's). **Block:** the files block (CH17, fourth in the hackathon order), on AT-2.

## 10. Link previews (later)

**The job** (CH26a: "Later"): a title, the site's name and maybe an image under an outside link.

**Recommendation:** an Edge Function, `link-preview`, with a cache table, fetching on the server. Never fetch from each reader's client: most sites block cross-origin reads anyway, and it would tell every linked site each reader's IP address.
- **Server-side request forgery guard:** `http` and `https` only, ports 80 and 443; resolve the host and refuse private, loopback, link-local (including the cloud metadata address 169.254.169.254), carrier-grade NAT, multicast, IPv6 unique-local and link-local, and IPv4-mapped IPv6 addresses; check again on every redirect (at most 3); a 3 s timeout; read at most about 512 KB and only the `<head>` (Open Graph, Twitter card, `<title>`); no cookies or auth headers; one fixed user agent; a rate limit per workspace [U: the usual checklist, e.g. [OWASP's SSRF cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)].
- **Cache:** `link_previews(url_hash, url, title, description, site_name, image_path, status, fetched_at)`, about 24 h for hits and less for failures.
- **Images:** none in the first version. Showing a remote image in the client leaks the reader's IP; copying it into Storage is the later step.

**Rejected:** fetching in the client (above); a third-party unfurl service (iframely, Microlink: every shared URL goes to a third party, plus cost).

**Risks:** DNS rebinding can race a "resolve, check, then fetch" sequence, and Deno's `fetch` can't pin the checked address [U]. The residual risk is low for a function that reads public page headers; an egress proxy closes it if needed.

**Spike:** none until it's scheduled. **Block:** the link-preview block, "Later".

## 11. State and React patterns

**The job.** One new message redraws the stream's frame and one row; a typing event redraws no message; switching conversations never flashes empty.

**The repo's patterns:** an external store read through `useSyncExternalStore` (`src/lib/sync/react.ts:39-45`). With the React Compiler on, a hook must return the snapshot itself (`docs/gotchas/ui.md:71`), and `getSnapshot` must return the same value until something changes: chat v1 shipped a React #185 crash with an inline `() => []` (`docs/gotchas/ui.md:77`). Rows never take the module API (`:174`); `task-list-view.redraw.test.tsx` fails when a row redraws for someone else's change (D11B-3).

| Option | Verdict |
| --- | --- |
| **The existing external store, with selectors** | **Recommended** |
| Zustand 5 / Jotai 3 / TanStack Store 0.11 | Rejected: a second store idiom beside TV-D11a's, for no measured gain |
| MobX (Linear's choice [U]) | Rejected: observable proxies and the React Compiler's caching don't mix well [U], and it's a third pattern |

**Recommendation:**
- `useConversationWindow(store, id)` returns an immutable list of stream items (messages, day separators, folded chains); a new list only when the window changes.
- **Message objects are reused across snapshots when unchanged**, so compiled rows skip; a reaction replaces one object, so one row redraws plus the stream's frame, which maps only the drawn rows.
- A per-row `useMessage(store, id)` subscription only if profiling shows the frame costing more than about 2 ms per update.
- **Typing and presence live in their own small stores** (v1 already does this in `src/features/chat/hooks/use-chat-live.ts`), read only by the typing line and the avatars.
- **Unread counts are their own slice**, so the sidebar and the stream don't redraw each other.
- **Switching conversations runs in a transition** (`startTransition`): the old conversation stays until the new window is ready. `useDeferredValue` for the in-conversation search box.
- **No React Context for values that change per message** (every consumer would redraw).
- **A redraw test for the stream,** like Tasks': "a reaction redraws one row", "a typing event redraws no row", "a message in another conversation redraws nothing here".

**Risks:** snapshot identity mistakes (React #185); stale reads under the compiler. Both caught by the redraw test and a live check in the dev build (the compiler isn't on in `rstest`, `docs/gotchas/ui.md:71`).

**Spike:** inside spikes 1 and 2. **Block:** the stream block and the store block.

## 12. End-to-end encryption

**The question.** Should only the people in a conversation, on their own devices, be able to read its messages, with the server storing only ciphertext?

**Checked against what the plan already decided:**

| Decided feature | With end-to-end encryption |
| --- | --- |
| Server-side search; "Messages" in ⌘K (§6 #7) | **Breaks.** The server can't index ciphertext; only the device could search what it holds |
| Notification excerpts built on the server (§6 #3); Web Push text | **Breaks.** A push could only say "New message" |
| "Addressed to you" worked out on the server (CH6, Catch up CH8) | **Breaks or leaks:** mentions and reply chains would have to stay readable metadata |
| Agents read channels through MCP (CH18); AI only through MCP | **Breaks** unless an agent holds the conversation's keys |
| "Mentioned in" spine links written from message content (§6 #5) | **Breaks:** references inside ciphertext are invisible to the server |
| Link previews (§10) | **Breaks**, or leaks the URL to the server anyway |
| Lossless export (§6 #16) | Works only on a device holding the keys |
| New members reading history, a second device, a lost laptop | Needs key sharing and key backup: the best-known pain of encrypted group chat [U: Matrix/Element's key backup and cross-signing] |
| Erasing an account | Easier (destroy the keys): the one point in favour |

**What the work-chat tools do:**
- **Slack doesn't** end-to-end encrypt messages. Enterprise Key Management lets a customer hold the keys for encryption at rest; Slack's servers still process the content and build the search index [V: [Slack EKM](https://slack.com/help/articles/360019110974-Slack-Enterprise-Key-Management); "not E2EE" is the reading of what EKM covers].
- **Microsoft Teams** end-to-end encrypts only one-to-one calls and meetings set up to require it; chat messages aren't [V: [Microsoft Learn, E2EE](https://learn.microsoft.com/en-us/microsoftteams/teams-end-to-end-encryption), [Encryption in Teams](https://learn.microsoft.com/en-us/microsoftteams/teams-encryption)].
- **Discord** has end-to-end encrypted every voice and video call since March 2026 (DAVE) and says "We have no current plans to extend E2EE to text messages" [V: [Discord, 2026-05-18](https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted)].
- Consumer messengers (Signal, WhatsApp, Element) do encrypt text end to end; they don't offer server search, server-side agents or the spine.

**Recommendation: no end-to-end encryption for chat.** Encryption in transit (TLS) and at rest (Supabase's), access by RLS, agents through scoped keys (CH18). It would break five decided features (search, server excerpts, CH6's routing, CH18's agents, spine links) and a planned one (link previews), plus Moduo's "AI only through MCP", and no work-chat competitor encrypts text end to end.

**Rejected:** end-to-end encryption everywhere (above); an opt-in encrypted "secret DM" (a second message pipeline; revisit only if a customer asks). If a customer ever asks for "encryption", the realistic answer is customer-managed keys at rest, Slack's EKM model. Calls (Moduo Meet, out of scope here) are where end-to-end encryption fits, as Discord and Teams did first.

**Block:** a decision entry in `docs/decisions/chat.md`; nothing to build.

## 13. Performance budgets and how to prove them

**The bar.** Tasks set it: 200 ms, median of three tries, from the input's first event to the frame that shows the result, on a 10,000-task fixture (`tests/perf/tasks-10k.spec.ts:30-31`; D11B-10, `docs/decisions/tasks.md:54`). Chat is used more often and in shorter bursts, so most of its budgets are tighter. v1's numbers come from [current state](./current-state.md) §5 (local stack, timings relative).

| Measure | Budget | v1 today | How it's measured |
| --- | --- | --- | --- |
| Open a conversation, warm (from the device copy) | ≤ 100 ms | ~100 ms from Home with ⌘7, small channel | the in-page clock: click → first message row painted |
| Open a conversation, cold (nothing on the device) | ≤ 200 ms plus one round trip; ≤ 3 requests | first message ~390 ms; 55 requests for the page | same, IndexedDB cleared; requests counted |
| Switch conversation, warm | ≤ 100 ms | n/a | ⌥↓ → the new conversation's last row painted |
| **Send to visible** (your message) | **≤ 50 ms at any channel size** | ~3 s at 3,000 messages | ⏎ → the row with its text painted |
| Receive to visible (someone else's) | p95 ≤ 500 ms end to end (local); ≤ 16 ms of it in the client | ~0.1 s small channel, ~3 s at 3,000 | two browser contexts on one machine: sender's ⏎ → reader's row painted |
| **Requests per incoming message** | **0** | 10 | network log in the reader's context |
| Elements in the stream | ≤ ~3,000 at any history length | ~119,000 at 3,000 messages | count under the stream after scrolling all 10,000 |
| Scrolling 10,000 messages | no frame longer than 50 ms during a 2 s fling; ≥ 55 fps | n/a | Long Animation Frames API (Chromium) and a frame counter |
| Prepend an older page | the anchor row moves ≤ 1 px; ≤ 150 ms from the device, one round trip from the server | jumps (trust bug 3) | the anchor row's position before and after |
| Fold a chain mid-screen; switch density | the anchor row moves ≤ 1 px | n/a | same |
| Jump to a message 5,000 back | ≤ 500 ms to painted and highlighted | opens the bottom (trust bug 6) | deep link click → target row painted |
| Memory | JS heap ≤ +50 MB after scrolling a 10,000-message conversation end to end and back; within 10% after garbage collection | every opened channel stays in memory | CDP performance metrics |
| Device copy | ≤ ~25 MB per workspace; a batch write ≤ 8 ms of main thread | none | storage estimate, profiler |
| Search | server p95 ≤ 150 ms at 100,000 messages per workspace; ⌘K results ≤ 300 ms after typing stops | 410 ms at 3,000, growing linearly | `EXPLAIN ANALYZE`, spec timing |
| Typing indicator | p95 ≤ 300 ms | never appeared locally | two contexts |
| Hackathon-sized load | 100 clients, 5 messages/s: p95 delivery ≤ 500 ms, no quota errors | n/a | spike 3's load script |

**How to prove them:**
- **Fixture:** `scripts/perf/seed-chat-10k.ts`, modelled on `scripts/perf/seed-tasks-10k.ts`: its own person and workspace, idempotent; one channel of 10,000 messages (varied lengths, code, Polish text, references, 400 images with stored sizes, 50 reply chains, reactions) and 20 more channels totalling 100,000 messages for search.
- **Spec:** `tests/perf/chat-10k.spec.ts`, reusing the in-page clock (`window.__perfArm`, `tests/perf/tasks-10k.spec.ts:74`) and the median-of-three rule.
- **Realtime in tests:** two Playwright browser contexts signed in as two people (`signIn`, `tests/support/local-stack.ts:48`), writing only after the "Subscribed to PostgreSQL" system message (`docs/gotchas/supabase.md:115`). The spec first asserts that the chat tables are in the local `supabase_realtime` publication, because `local:up` leaves it empty and every subscription then silently gets nothing (`docs/gotchas/supabase.md:13`).
- **Engines:** Chromium for the gate; Playwright's WebKit project as a stand-in for Safari; a manual pass in the Tauri build on macOS (WKWebView) and Windows (WebView2) in spike 1 and before each release (Playwright's WebKit isn't WKWebView [U]).
- **Load:** Supabase benchmarks Realtime with k6 [V: [benchmarks](https://supabase.com/docs/guides/realtime/benchmarks)]. At Moduo's size a Bun script opening 100 supabase-js clients on the local stack is enough; one run on staging before the hackathon checks the real plan's quotas.
- **Gates:** `bun run perf` on the local stack, not CI (D11B-10); a chat block that touches the stream or the store is done only with the chat perf spec green. The redraw test (§11) and the parser parity corpus (§2) run in `verify`.

**Block:** the fixture and spec with the store block; the stream block adds the scrolling and anchoring cases.

---

## A. Decision table

| # | Concern | Decision (recommended) | Rejected | Main risk | Spike |
| --- | --- | --- | --- | --- | --- |
| 1 | Message list | **TanStack Virtual** (already installed, virtual-core 3.18) with `anchorTo: 'end'`, `followOnAppend`, id keys, per-conversation measurement cache, in a chat-only `MessageStream`; feed-pattern accessibility | Legend List 3 (runner-up), react-virtuoso, VirtuosoMessageList (commercial key), FlashList via react-native-web, virtua (0.x), react-window 2, plain DOM + `content-visibility`, custom list | Rows above the viewport resizing while scrolling up; desktop WebKit least documented | 1 |
| 2 | Rendering | **Markdown subset + `moduo://` URIs** stored; a small pure-TS parser → cached tree (by id + `updated_at`) → compiled rows; reserved image boxes; `contain: layout style` | Lexical JSON storage, an editor per message, server HTML, `react-markdown` on the hot path | Composer export and renderer drifting apart | 4 |
| 3 | Data and sync | **A sibling `ChatStore` on TV-D11a's pattern**, per-row IndexedDB, newest ~500 per conversation on the device, ≤ ~1,500 in memory; server `(created_at, id)` order; client-minted ids; outbox; `updated_at` + stamp trigger migration; keyset pages; gap fill with a "too big, reload the tail" cap | Refactoring Tasks' store now, TanStack DB, Zero, PowerSync, Electric, Replicache, Dexie (fallback), SQLite WASM | WebKit IndexedDB write cost; big deltas after days away | 2 |
| 4 | Realtime | **Postgres Changes for rows now** (RLS per subscriber), zero requests per event; typing by Broadcast, online by Presence on `chat:<ws>`; notifications on one per-person channel; **Broadcast-from-database id pokes on per-person topics** when measured load demands | Full rows over Broadcast, topic per conversation, client-sent messages, third-party realtime | **Free plan's 200 connections at the hackathon** | 3 |
| 5 | Editor | **Lexical** with RF-1's menus, a restricted Markdown-shortcut list, clean paste, file paste/drop to AT-2, ⏎/IME-safe send, drafts per conversation | Text box + overlay, Tiptap/ProseMirror, Slate, hand-rolled `contentEditable` | ⏎ contention (menu, IME, send) | 4 |
| 6 | Emoji | **Frimousse** (self-hosted Emojibase data, custom emoji via `resolveEmojiData`); native emoji + a Windows-only flag font; custom emoji in a private bucket, cached by hash on the device, still poster for hover-to-play, no SVG | emoji-picker-element (runner-up), emoji-mart (stale), an image set (a visual call) | Frimousse is 0.x | — |
| 7 | Search | **Postgres FTS**: `simple` + immutable `unaccent` wrapper, prefixes, GIN on live rows; one SECURITY DEFINER `chat_search` (text first, access per match) for ⌘K, in-conversation search and MCP | `pg_trgm` (later), PGroonga (upgrade path), ParadeDB (not on Supabase), external engines, device search | No Polish stemming | 5 |
| 8 | Notifications | **Rows into TV-D12's table**; immediate push wake-up (not cron-only); one device rings; Focus and quiet hours known to the server; Tauri badge (`setBadgeCount`, `setOverlayIcon` on Windows), title + favicon on the web | A chat-only notifier, polling, FCM/APNs on desktop | Duplicate pings across devices | (TV-D12) |
| 9 | Files | **AT-1/AT-2 as they are**, `entity_type = 'chat_message'`, upload then send, batched signed URLs, PDF first-page preview at upload | Supabase image transformations (Pro only, not needed), a chat-only pipeline | AT-2 not built yet | (AT-2) |
| 10 | Link previews | **Later: an Edge Function with an SSRF guard and a cache table**, no remote images at first | Fetching in the client, third-party unfurlers | DNS rebinding residual | — |
| 11 | State | **The existing external store + selectors**; immutable message objects; typing, presence and unread in their own slices; transitions on switch; a redraw test | Zustand, Jotai, TanStack Store, MobX | Snapshot identity (React #185) | 1, 2 |
| 12 | End-to-end encryption | **No.** TLS + encryption at rest + RLS (breaks five decided features and a planned one); customer-managed keys at rest if ever asked | E2EE everywhere; opt-in secret DMs | A customer asking later | — |
| 13 | Budgets | Open warm ≤ 100 ms, send-to-visible ≤ 50 ms, receive p95 ≤ 500 ms, 0 requests per incoming message, ≤ ~3,000 stream elements, ≤ 1 px anchor shift, search p95 ≤ 150 ms at 100k; `bun run perf` with a chat fixture | Rendering-only checks in `verify` | Playwright's WebKit ≠ WKWebView | all |

## B. Architecture sketch: from Realtime to pixels

```
 Postgres (Supabase, the truth)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ chat_channels · chat_members · chat_messages                             │
 │   + updated_at (server stamp) + body_text + search_tsv (GIN)             │
 │ chat_op_* ops (SECURITY DEFINER, idempotent on the client-minted id)     │
 │ chat_search() · notification rows (TV-D12) · attachments (AT-1) + bucket │
 └───────┬──────────────────────────┬─────────────────────────┬─────────────┘
         │ WAL → Realtime            │ PostgREST               │ trigger → push sender (TV-D12)
         │ postgres_changes,         │ deltas, keyset pages,   │ Web Push (web) · the running
         │ RLS per subscriber        │ search, ops             │ desktop app notifies itself
 ┌───────▼──────────────────────────▼──────────────┐
 │ supabase-js: one socket, several channels       │
 │  chat rows of <ws> · my memberships             │
 │  chat:<ws> private: typing (Broadcast),         │
 │                     online (Presence)           │
 │  my notification rows, every workspace          │
 └───────┬─────────────────────────────────────────┘
         ▼
 ┌──────────────── ChatStore (one per person + workspace, held by the app shell) ─┐
 │ apply by server stamp · echo skip by id · ops over rows (begin/settle/fail)    │
 │ outbox: sends + uploads, in order · gap fill on rejoin / online / focus        │
 │ windows: open conversation ≤ ~1,500 · tails of recent ones · "detached" mode   │
 │ slices: unread · typing · presence (separate) · parse cache (id, updated_at)   │
 └──────┬────────────────────────────────────────┬─────────────────────────────────┘
        │ batched, throttled writes               │ useSyncExternalStore (snapshot)
 ┌──────▼──────────────┐                 ┌────────▼──────────────────────────────────┐
 │ IndexedDB moduo-chat │                 │ React 19.3, React Compiler on             │
 │  meta (per ws)       │                 │ Sidebar: NavRow + unread slice            │
 │  messages            │                 │ MessageStream ("use no memo")             │
 │   [ws, conv,         │                 │   TanStack Virtual: anchorTo 'end',       │
 │    createdAt, id]    │                 │   followOnAppend, id keys, cached sizes   │
 │  emoji bytes by hash │                 │   └ MessageRow (compiled): tree → text,   │
 └──────────────────────┘                 │      Reference chips, reserved images,    │
                                          │      reactions, folded chains             │
                                          │ Composer: Lexical + RF-1 menus ──▶ store op / outbox
                                          └────────┬──────────────────────────────────┘
                                                   ▼
                    WKWebView (macOS) · WebView2 (Windows) · Chrome / Safari / Firefox
                    pixels · OS notification + dock/taskbar badge (Tauri) · Web Notification
```

## C. The five spikes, in order

Run all five before the store block's migration is final: spikes 2, 4 and 5 each shape that migration.

**1. The list, in the real webviews** (2–3 days). The discriminator. A temporary harness mount (deleted before commit) with an in-memory 10,000-message fixture, in the dev build with the React Compiler on. TanStack Virtual first; Legend List 3's React entry in the same harness on a scratch branch. Scenarios: open at the bottom; prepend 50 measured rows ten times; fold a 6-reply chain mid-screen; an edit growing a row above the viewport while scrolling up; a new message while reading history and while at the end; jump to row 5,000 and back; sticky day header; density switch; image rows with reserved boxes. Engines: Chromium, the Tauri app on macOS (WKWebView) and Windows (WebView2), Safari on the web.
- **Pass:** the anchor row moves ≤ 1 px on every prepend, fold and density switch; no pull while reading; follows at the end, trackpad momentum included; the jump lands within 1 px; no frame over 50 ms in a 2 s fling; ≤ 3,000 elements in the stream; only the stream file opts out of the compiler.
- **Fail:** TanStack fails and Legend List passes → Legend List. Both fail → custom compensation through `shouldAdjustScrollPositionOnItemSizeChange` before any hand-written list.

**2. The store and the device copy** (2 days). The `ChatStore` skeleton and the migration on the local stack (`updated_at` + stamp trigger + index, keyset pages).
- **Pass:** a cold open paints the newest 50 of a 10,000-message channel from IndexedDB in ≤ 100 ms; writing 500 messages in one transaction costs ≤ 8 ms of main thread; after missing 1,000 changes (sends, edits, reactions, deletes) a delta read gives the same set as a fresh full read, with nothing missing and nothing twice; keyset pages over 10,000 messages, 200 of them sharing one timestamp, return each exactly once; heap ≤ +50 MB after scrolling end to end.

**3. Realtime delivery and the plan's quotas** (1 day). Two Playwright contexts plus a Bun script with 100 supabase-js clients on the local stack (publication checked first), 5 messages/s spread over 20 workspaces, and a 5-person channel at 2 messages/s.
- **Pass:** p95 receive-to-visible ≤ 500 ms; zero requests per incoming message in the reader; a 60 s disconnect fills every gap on rejoin.
- **Report:** sockets per person (desktop app + tab) and Realtime messages/s against Free (200 connections, 100 messages/s) and Pro (500, 500), so Maciej and Mike can decide the plan before the hackathon.

**4. The stored form, round trip** (1–2 days). One list of supported constructs; Lexical export → stored text → parser → rows, and stored text → Lexical import for edits. A corpus of 200+ cases: nested lists, code containing backticks, quotes, references, person URIs, date chips, emoji and `:custom:`, Polish diacritics, URLs with brackets, HTML pasted from Slack and Google Docs. Plus the one-time v1 body conversion, run on the research workspace's 3,032 messages.
- **Pass:** 100% parity on the corpus; parsing and drawing 30 rows ≤ 5 ms; the `@` menu opens ≤ 50 ms with local results; ⏎ never sends during IME composition (Japanese input, WebKit); every v1 body converts with no title left in the stored text.

**5. Search** (1 day). The generated `search_tsv` with the immutable `unaccent` wrapper over 100,000 messages, and `chat_search` as SECURITY DEFINER.
- **Pass:** p95 ≤ 150 ms for 1–3 word queries; "zolw" finds "żółw" and "zadan" finds "zadania" and "zadaniem"; a private channel's message never reaches a non-member (a test); the index adds ≤ 1 ms per insert (10,000 inserts with and without it); the column backfill on the research workspace's 3,032 messages takes ≤ 1 s.

## D. What this means for the plan's blocks

The spec (`specs/chat-v2.md`) hasn't named its blocks yet (REPLAN §9), so these names are **provisional** and follow CH26a's build order. Each decision lands as an entry in `docs/decisions/chat.md` with its rejected alternatives (REPLAN §6's rule).

| Block (provisional) | Decisions it owns | Waits on |
| --- | --- | --- |
| **Chat store and data migration** (first; the foundation for CH26a's items 2 and 3) | §3 entirely; §4's live merge and channels; the migration (`updated_at` + trigger + index, keyset paging, `body_text` + `search_tsv` columns, the v1 body conversion from §2); §13's fixture and perf spec | TV-D11a (landed); spikes 2, 4, 5 |
| **Message stream** (CH29's look) | §1 (`MessageStream`, anchoring, feed accessibility); §2's parser and rows; §11's selectors and redraw test; §13's scrolling and anchoring cases | DS-6, RF-1 (landed); the store block; spike 1 |
| **Composer** (CH14, CH15) | §5; the picker from §6 | RF-1, TV-U14 (landed); spike 4 |
| **Pings that leave the app** (CH6) | §8: chat's rows, the requirements handed to TV-D12, badges | TV-D12; TV-F6 and TV-D14 for holding |
| **Files** (CH17) | §9 | AT-2 |
| **Replies** (CH30) | §1's fold requirement (row heights change; nothing folds above where you're reading) | the stream block |
| **Presence and typing** (CH9, CH28) | §4's typing and presence | the store block |
| **Search in ⌘K** | §7's function and the ⌘K group (the columns ride the store migration) | the store block |
| **Custom emoji** (CH16b) | §6's custom emoji | AT-2, the composer block |
| **Link previews** (later) | §10 | — |
| **Decision entries only** | §12 (no end-to-end encryption); every "rejected" line above | — |
