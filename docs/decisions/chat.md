# Decisions: Chat

Full entries for this area, newest first. The one-line index of every area is [docs/decisions.md](../decisions.md). Add new entries at the top here **and** a one-line pointer in the index. Earlier chat lines (v1 ships as the 7th tab, 2026-10-06; chat + calls become a planned module, 2026-10-02) stay under Billing and Product in the index.

## 2026-10-14 · CV-0 spike 2 (the chat store and its device copy) — the agent's choices (deferred to by Maciej)

Measured in [the spike's record](../build/chat-v2/CV-0-S2.md) on the local stack, with no migration: the harness is `scripts/spikes/chat/s2/`, the server half a draft in `docs/build/chat-v2/drafts/store.sql`. Every bar passed. Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable. Not measured yet: WebKit (Tauri's macOS webview).

- **S2-1 · The device copy is plain IndexedDB, no library** → CV-3 (`scripts/spikes/chat/s2/page/device-copy.ts`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: about 250 lines of raw IndexedDB, the way `src/lib/sync/` already does it.
  - Why: it clears every bar with room to spare, and nothing needed more than ranges and range deletes.
  - Rejected: Dexie; Tasks' one-record-per-workspace `SyncCache` (reading 10,000 messages back took 51 ms against 1.4 ms for a range read, and every save rewrote the whole record, 18 ms of main thread at 10,000 rows).
- **S2-2 · Messages are keyed by workspace, conversation, time and id** → CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the key is `[workspaceId, channelId, at, id]` (`at` is `created_at` in microseconds), plus a unique index on the id. A conversation is one key range: the newest 50 are read by jumping a cursor back 49 and taking them in one call, 1.4 ms at any size. Dropping a conversation, or its oldest rows, is one range delete.
  - Why: the cost of opening a conversation doesn't depend on how big it is.
  - Rejected: the id as the key with a time index (the read took 2.9 ms and eviction walked row by row, 354 ms); walking a cursor 50 steps.
- **S2-3 · The device keeps 500 messages per conversation; memory holds up to 1,500 per open conversation** → CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: 500 per conversation on the device; past about 20,000 messages in a workspace the least recently opened conversation is evicted, in the same transaction as the write; at most 1,500 per open window in memory.
  - Why: reading doesn't get slower with size, so the cap is only about disk: about 1.3 KB a message, about 26 MB for a full workspace; 1,500 in memory costs +1.8 MB (the bar was +50 MB).
  - Rejected: no cap (one 10,000-message channel is about 13 MB); 1,500 on the device (older history comes from the server by keyset pages anyway).
- **S2-4 · Chat gets its own database, `moduo-chat`, and no worker** → CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: its own IndexedDB database, written on the main thread in transactions of at most 200 rows. Revisit if CV-3's perf fixture shows long tasks.
  - Why: a second database costs 0.2 ms to open next to an open one, and its own database means its own versions, upgrades and wipe; a 500-row write is 3 ms of main thread, and at a 4× slower processor a 200-row transaction is about 5.5 ms (derived, not measured).
  - Rejected: Tasks' `moduo-sync` (its opener would close chat's connection on an upgrade); a worker now (0.5 ms instead of 3, but the rows must reach the main thread to be drawn anyway).
- **S2-5 · `chat_sync_ids` answers three kinds: conversation, member and moved away** → CV-1, CV-3
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: besides the conversations and memberships you still have, it returns the ids moved to somewhere you can't read (read from the `moved_out` lines written since your last check), and `checked_at`. A second move overwrites the line's `moved_from_channel_id`; the line itself stays.
  - Why: one check, 1.5–2.4 ms for 8 conversations, finds every way of losing access with no event: removed, deleted, made private, moved away.
  - Rejected: comparing each held conversation's message ids (up to 500 ids times every conversation, every 10 minutes; estimated, not measured); a `moved_from_channel_id` lookup.
- **S2-6 · History pages are a function that compares `(created_at, id)` in SQL** → CV-1 (`chat_messages_page` in `drafts/store.sql`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: keyset pages as a row comparison in a function. Deltas may stay on PostgREST if they keep the extra `updated_at >= since` bound.
  - Why: the row comparison is an index condition (0.04 ms mid-history); PostgREST's `or=` spelling uses the index only for the order and filters the rest (1.7 ms at depth 5,000, and growing with depth).
  - Rejected: `or=` for history.

## 2026-10-14 · CV-0 spike 3 (Realtime delivery, typing cost and the plan's quotas) — the agent's choices (deferred to by Maciej)

Measured in [the spike's record](../build/chat-v2/CV-0-S3.md) against the local stack, with no migration: the harness is `scripts/spikes/chat/realtime-load.ts`. Four of five bars passed; the latency bar missed by 20–85 ms. The Free-or-Pro call (CH31) stays Maciej and Mike's: the record's recommendation is Pro before the hackathon (peak 200 sockets, Free's cap). Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S3-1 · The latency bar is recorded as a miss, with its cause, not tuned away** → CV-3, and BR-1 below
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: Postgres Changes delivered at p95 530 ms against the 500 ms bar. The cause is the server reading changes about every 0.5 s (the client adds about 12 ms); Broadcast from the database, with no such poll, delivered typing at p95 11–16 ms. Keep Postgres Changes as specced, write the live merge so the transport can change, and re-measure on the real project; if prod misses too, deliver message rows by Broadcast from the database.
  - Why: the local poll setting isn't prod's to change, and the commit-based numbers (527 ms) don't pass either.
  - Rejected: changing the local tenant's poll settings; claiming a pass from the commit-based numbers.
- **S3-2 · The hackathon load was modelled as v1 would behave** → the CH31 numbers
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: 25 workspaces of 4 people, each person with two sockets (desktop and a tab) that both join the open conversation's typing topic and Presence, as v1 does; one message per person at a random second of the minute, after three typing events. That gave 200 sockets, 79 Realtime messages a second on average and peaks of 240.
  - Why: it's the upper bound that the two suggested trims cut from (join the typing topic only from the focused window, and don't touch the channel row on every send).
  - Rejected: one socket per person (it under-counts what CH31 worries about).

## 2026-10-14 · CV-0 spike 4 (the stored form of a message) — the agent's choices (deferred to by Maciej)

Built as the pure module `src/features/chat/markup-v2/` (nothing wired into the app) and the SQL converter draft `docs/build/chat-v2/drafts/chat_v1_to_v2.sql`; see [the spike's record](../build/chat-v2/CV-0-S4.md) for the list of supported constructs and the canonical form. All four bars passed, and the converter turned the research workspace's 3,032 messages into text that draws exactly as v1 drew them. Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S4-1 · People and teams are references like everything else** → CV-1, CV-7a, CV-7b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a person mention is stored as `moduo://person/<profiles.id>` and a team as `moduo://team/<id>`.
  - Why: RF-1 has no person node (its `@` pick inserts plain text), and the reference grammar already reads any `moduo://<type>/<uuid>`.
  - Rejected: `user` or `profile` as the type word ("person" is the product word); a separate `<@id>` syntax.
- **S4-2 · Bold and italic are read by a small stack, not CommonMark's algorithm** → `markup-v2/parse.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: each run closes the innermost mark first and then opens; an opener that never closes goes back to plain text. Proven for every sequence of up to four pieces and fuzzed.
  - Why: CommonMark's pairing mis-reads runs the composer itself writes (208 of 4,368 three-piece sequences failed).
  - Rejected: CommonMark's delimiter process; `@lexical/markdown` (it doesn't escape literal syntax, and would be a second dialect).
- **S4-3 · `*` may open inside a word, and `_` means nothing** → `parse.ts`, the converter
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `un*believ*able` is italic and `snake_case` never needs escaping. The converter rewrites v1's `_italic_` and escapes v1's `2*3*4`, which was text in v1.
  - Why: formatting inside a word from the editor has to survive storage, and underscores in words are common.
  - Rejected: v1's word-boundary rule for `*`; `_` as a second italic.
- **S4-4 · Every new line is a line break, blocks are set apart by one blank line, and two paragraphs in a row become one** → `markup-v2/canonical.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: one paragraph with line breaks is the canonical shape of a message.
  - Why: the composer makes new lines with ⇧⏎, so that is what it holds.
  - Rejected: CommonMark paragraphs (a single new line is a soft break), which would turn two typed lines into one.
- **S4-5 · Formatting is stored flat on each piece of text, like Lexical's formats** → `markup-v2/plan.ts`, `serialize.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a piece of text carries its set of marks and the renderer wraps it.
  - Why: one shape per formatting, which is what the editor holds.
  - Rejected: nested bold and italic nodes, as v1's tree had (two shapes for one meaning).
- **S4-6 · A reference's look isn't stored; where it sits decides** → CV-7a, CV-7b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: alone on its own line in a paragraph it's a card where the kind can show as a card, a tag is a link, anything else is a chip (RF-1's insert rule).
  - Why: the spec says a reference is `moduo://<type>/<id>` and nothing more.
  - Rejected: `?display=card` on the reference.
- **S4-7 · Bare links, `@channel` and `:name:` stay plain text in the composer; the reader finds them** → `markup-v2/tokens.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: what you type is what's stored; the parser turns these into a link, a pill and a custom emoji when it draws.
  - Why: no special nodes to keep in step with the text.
  - Rejected: Lexical's auto-link node in the stored round trip (a typed link the plugin didn't wrap would flip node types).
- **S4-8 · Clean paste keeps text, lines, links, lists, quotes and code blocks, and drops every style** → CV-7b (`markup-v2/paste.ts`, CH15)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: inline code goes too; Moduo's own chips in pasted HTML come back as the reference or the day, never their text, and a broken chip leaves nothing; tables become tab-separated lines; emoji images become their `:name:` or the character.
  - Why: CH15's "clean text"; it sidesteps Google Docs' all-bold wrapper; a chip's text can be an old stored title.
  - Rejected: Lexical's own HTML import (it imports the styles).
- **S4-9 · `@channel` must start a word, also across formatting** → `markup-v2/tokens.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `a**@channel**` is plain text, and so are `@channels` and `x@channel.com`; `@here` and `@everyone` mean nothing.
  - Why: a glued `@channel` must never ping everyone by accident.
  - Rejected: checking each piece of text on its own (the validator's finding).
- **S4-10 · Links are http(s) and mailto only, with no spaces** → `markup-v2/serialize.ts`
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: any other target becomes its label as plain text.
  - Why: a target with a space can't sit inside `[label](target)`, and a message should only link to places people can open.
  - Rejected: relative links and other schemes; encoding spaces silently.
- **S4-11 · The converter fixes two v1 drawing bugs and keeps everything else as v1 drew it** → CV-1 (`drafts/chat_v1_to_v2.sql`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a one-line code fence keeps its word as code (v1 drew an empty block labelled with it), and a `<!channel>` glued to a word gets spaces so it still reaches everyone. Everything else is kept as v1 drew it, v1's own link cuts included.
  - Why: changing where a link points without anyone noticing is worse than keeping an old quirk.
  - Rejected: copying v1's fence bug; "fixing" v1's link cuts.

## 2026-10-14 · CV-0 spike 5 (message search at 100,000 messages) — the agent's choices (deferred to by Maciej)

Measured in [the spike's record](../build/chat-v2/CV-0-S5.md) in a scratch schema on the local stack (dropped), with drafts for CV-1 and CV-19 in `docs/build/chat-v2/drafts/search.sql`. Assumption #9 holds: p95 4.3 ms against a 150 ms bar, "zolw" finds "żółw", and a private conversation's message never reaches a non-member. Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S5-1 · Words of three letters or more are prefixes; one- and two-letter words match whole words only** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: "zad" finds zadania and zadaniem; "za" finds only the word "za"; "ok", "UI" and "PR" stay findable. A negated word stays exact ("-test" doesn't exclude "testy"), and input that can't be turned into a query runs as a plain one, so no input raises an error. The client may still start ⌘K's Messages at two characters: the server takes any input.
  - Why: every variant passes the speed bar at 100,000 rows, but a two-letter prefix matched 20–38 % of all rows, so newest-first shows near-arbitrary messages, and its cost grows with the workspace (near 100 ms in one of a million messages).
  - Rejected: prefixes from two letters; dropping short words; only the last word being a prefix.
- **S5-2 · The read rule is applied once, as a set, inside the indexed query** → CV-1, CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_search` works out the caller's readable conversations in the workspace once and filters the index by them, so the 50 results are the newest 50 readable ones however many unreadable matches are newer: 2.2–3.0 ms with up to 20,000 unreadable newer matches.
  - Why: checking the rule per match costs about 83 µs a time (713 ms at 5,000 unreadable newer matches, 2.8 s at 20,000), and a cap on candidates returns nothing when the newest matches are unreadable.
  - Rejected: the per-match loop (the `tasks_search` pattern); the loop with a cap.
- **S5-3 · The readable set is built set-wise and guarded by a parity test** → CV-1, CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__readable_channel_ids(ws)` runs the workspace check once and the per-conversation part as one query; a test asserts it equals `chat_can_read_channel` for every caller and conversation.
  - Why: calling the rule per conversation costs about 170 ms at 2,025 conversations (a 100-person hackathon workspace's direct messages); the set form took 0.7 ms.
  - Rejected: per-conversation calls (simplest, nothing duplicated, but they grow with direct messages); a semi-join on the set (it doubled the time).
- **S5-4 · The snippet uses its own display-only text search config** → CV-19 (`chat_headline`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `simple` with `unaccent` applied per word, used only to highlight the snippet; the index keeps the specced wrapper. It adds an object to Assumption #9 without changing it.
  - Why: with plain `simple`, "zolw" can't highlight "żółw" and the snippet showed the message's first words with no mark; with the config 50 of 50 snippets highlight.
  - Rejected: a headline over unaccented text (it loses the Polish letters); the config for the index too (it depends on the database's character settings, the wrapper doesn't).
- **S5-5 · Snippet marks are two private characters, not HTML** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: U+E000 and U+E001 mark the start and end of a match; the client splits on them and draws text.
  - Why: the message text is what people typed, so `<b>` markers would make every drawing of a snippet an escaping problem.
  - Rejected: `<b>` or `<mark>`; offsets (`ts_headline` gives none).
- **S5-6 · Search pages continue from the last row's `(created_at, id)`** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the next page passes the last row's time and id; three pages of 50 equalled the first 150 rows of one ordered query.
  - Why: the spec's single `before` repeats or skips rows that share a timestamp at a page edge, which is the stream's own rule (AC1.4).
  - Rejected: offsets; a timestamp alone.

## 2026-10-14 · Chat v2 build — the orchestrator's choices on the block briefs (deferred to by Maciej)

Written into the block briefs ([docs/build/chat-v2/briefs/](../build/chat-v2/briefs/)) while the spikes ran. Each is the orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable.

- **BR-1 · CV-3 keeps Postgres Changes for message rows behind one adapter until delivery is measured on the real project** → CV-3 (`briefs/CV-3.md` §6)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: Assumption #17 holds: message rows come by Postgres Changes, and the live merge takes its input from one adapter so Broadcast from the database can replace it without touching the merge. Delivery p95 is re-measured on the real project before release, and that number decides.
  - Why: spike 3 missed the 500 ms bar by 20–85 ms because the local Realtime reads changes about every 0.5 s, and prod's cadence is unknown.
  - Rejected: switching to Broadcast now (more triggers and topics than the measured miss justifies).
- **BR-2 · CV-4 looks up the dated grant through `public.plan_grant_effective_tier(uuid)`, and falls back to the owner's plan** → CV-4 (`briefs/CV-4.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_workspace_enabled` is true when the owner has Duo, Team or Founder, or when that function exists (found with `to_regprocedure`) and returns a tier for the workspace now (null when no grant is active). Without the function the owner's plan decides, so the order of merging never matters. TX-9b builds the function to this signature.
  - Why: TX-9b isn't built and its function's name isn't fixed.
  - Rejected: blocking CV-4 until TX-9b exists; mixing it up with transactional-email T24's per-email founder `plan_grants`.
- **BR-3 · CV-2b's migration is its own file, `<stamp>_chat_v2_conversation_ops.sql`** → CV-2b (`briefs/CV-2b.md` §5)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the conversation ops go in a new migration, not in message ops' file.
  - Why: CV-2a's file is applied by then, and applied files are never edited.
  - Rejected: adding to CV-2a's file.
- **BR-4 · CV-20 owns the `add_emoji` capability and CV-15 only shows it** → CV-20, CV-15 (`briefs/CV-20.md`, `briefs/CV-15.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: CV-20 adds the switch (the column on `workspace_chat_caps`, the `CHAT_CAPABILITIES` value and `chat_caps_get`, from its live body; on for admins and members, off for viewers). CV-15 shows it in the role editor and adds nothing to its migration for it; if the column isn't there when CV-15 starts, it hands back "blocked on CV-20".
  - Why: custom emoji is built first after the hackathon line (CH16b), before the lifecycle block.
  - Rejected: CV-15 adding it (a column in a block whose feature isn't built).

## 2026-10-14 · Chat v2 — the re-plan's product calls (Maciej) and technical decisions (the agent)

Planned in [`.design/chat-v2/REPLAN.md`](../../.design/chat-v2/REPLAN.md) (calls CH1–CH75, §6 #1–#28) and written as [`specs/chat-v2.md`](../../specs/chat-v2.md) (blocks CV-0…CV-23). Each entry: who · decision · why · rejected. A call number points at REPLAN §8; "§6 #n" at REPLAN §6; "round-3 §n" at [`research/round-3-database.md`](../../.design/chat-v2/research/round-3-database.md).

**Product calls (Maciej, 2026-10-13/14, unless marked as the agent's choice deferred to by him)**

- **C2-1 · Chat's bar and its one great moment** → the spec's Scope (CH1)
  - Who: Maciej, 2026-10-13.
  - Decision: Slack for a team of 2–5 in the parts a team uses every day, and no further; the great moment is "the conversation knows the work" (live references, a message becomes a task with the link both ways, a channel one click from its project or client).
  - Why: the bar is what every chat tool has; the moment is the spine applied to chat, which Slack can't copy.
  - Rejected: "catch up and be done" as the moment (every tool claims calm).
- **C2-2 · Channels and direct messages, and a channel can be linked to one project, client or team** → CV-13 (CH2, CH56, CH57)
  - Who: Maciej, 2026-10-13.
  - Decision: v1's shape kept, plus one optional link per channel; "Start a conversation for X" names the channel after X and makes it private with X's people when X is private; linking a team offers its people once, never kept in sync.
  - Why: the big tools met in the middle in 2025; standalone "new structure" products folded; chat next to the work is what thrives.
  - Rejected: one conversation per project (empty rooms), Zulip topics (overkill at 2–5), comments shown as chat (crosses the Notes boundary).
- **C2-3 · Words and names: "conversation", "channel", "direct message"; names as typed; no `#` before a channel; "Pin to sidebar"; no notes-to-self; one glyph plus a lock** → CV-2, CV-8 (CH3, CH3a, CH32)
  - Who: Maciej, 2026-10-13.
  - Decision: spaces and capitals allowed (1–80 characters, unique ignoring case); `#` means tags; a self-DM becomes a capture; every channel shares one glyph and a private one you're in shows a lock.
  - Why: Slack's no-space rule exists only for a `#name` token Moduo doesn't have (channels are picked from the `@` menu); five icon kinds in one list read messy.
  - Rejected: Slack's slug rule; icons by link type.
- **C2-4 · Chat appears from the second member; a lapsed plan pauses posting and keeps everything readable** → CV-4, CV-8 (CH4, CH4a, CH25, CH67)
  - Who: Maciej, 2026-10-13.
  - Decision: no tab in a one-person workspace; when the owner's plan or a dated grant doesn't include chat, one line replaces the composer ("Chat is paused…"), no marketing page; a hackathon team gets a dated Team plan on its workspace.
  - Why: history that disappears is the most resented thing about Slack's free plan; selling to a member inside a work tool is the wrong person.
  - Rejected: v1's four-card upgrade page; hiding Chat; a chat-only grant (leaves a Free owner's seat and file limits).
- **C2-5 · You're pinged only by what's addressed to you; it reaches you outside the app, in any workspace; one device rings** → CV-5, CV-6 (CH6, CH7, CH39–CH46, CH73–CH75)
  - Who: Maciej, 2026-10-13/14.
  - Decision: a direct message, `@you`, `@Team`, a reply in a chain you're in or to your message, an announcement; "Every message" pings once per burst only when Moduo isn't in front and lists one line per conversation in Catch up; "Nothing" keeps a mention in Catch up silently; an edit notifies only the newly named; Focus, quiet hours, do not disturb, a vacation and a paused workspace hold everything and nothing pings when they end; an email after an hour away, on by default, once per conversation per hour, never for what arrived during a hold; the browser asks once; sound off by default; a notice shows the text with a switch to hide it.
  - Why: the quiet bar (PRODUCT_BRIEF §7) with chat as the real-time exception; the only phone channel until a mobile app is email.
  - Rejected: per-message pushes; a summary notice when quiet hours end; email off by default; ringing every device.
- **C2-6 · Catch up: one list of what's addressed to you, worked like the Inbox; the bell and Catch up are one state** → CV-11 (CH8, CH38, CH51)
  - Who: Maciej, 2026-10-13.
  - Decision: grouped by conversation (newest first as a Display option); Reply `R` · Done `Space` · Task `T` · Later `H` · Open `⏎`; clearing in the bell or Catch up clears both; "Remind me" on any message returns it with one notice.
  - Why: Slack splits this across four views and its own team found thread replies need a place to land.
  - Rejected: separate bell and Catch up states; a "saved for later" list of its own.
- **C2-7 · Replies, not threads: one Reply action in the stream, "N replies ›" on the right, Wrap up by hand, tidy up afterwards** → CV-12, CV-16 (CH30, CH30a, CH30c, CH30d, CH53–CH55)
  - Who: Maciej, 2026-10-13.
  - Decision: a reply posts at the bottom with a quote; a chain opens as a panel item; Wrap up asks which reply settled it and offers "Also mark as decision", hides the replies and is undone by Reopen or a new reply; Reply to… and Move to… fix mistakes (own messages anywhere, others' only by managers and admins to a same-or-narrower audience, a warning when new people would see them); the root's author, managers and admins wrap up; no automatic folding.
  - Why: nobody follows thread rules ("half in, half out"); the tools that cope remove the up-front choice and let anyone fix it afterwards; automatic folding was hard to predict.
  - Rejected: Slack threads (CH12); automatic folding when tangled (rounds 2–3); anyone moving anyone's messages.
- **C2-8 · The look: Slack-calm as the base on Tasks' kit** → CV-7 (CH27–CH29g, CH29c, CH29d)
  - Who: Maciej, 2026-10-13.
  - Decision: 15 px reading text at every density, names by weight, 24/20/16 px before a new person and 6 px within, one left edge, centred day separators, fades at both ends, a centred "New" pill with no row tint and a floating "N new" chip, a one-row composer that grows with `+` as the one way in for files, links and new items, the recent past in the date grammar, density from the app's one setting, three quick reactions on hover with Reply before Task.
  - Why: what makes Slack and Discord look good is reading-size text, hierarchy by weight and rhythm, none of which costs a colour; v1's look was a placeholder.
  - Rejected: the Moduo-hybrid and Discord-depth variants; a two-row composer; a permanent row of module buttons; Task before Reply (agent's choice, deferred).
- **C2-9 · Reactions: a personal quick row, any emoji, custom workspace emoji; comments follow** → CV-7, CV-20 (CH16, CH16a, CH16b, CH29b, CH49, CH60)
  - Who: Maciej, 2026-10-13.
  - Decision: each person sets their own row (six by default); the same row and picker on task and note comments; custom emoji right after the hackathon cut (PNG/GIF/WebP, 256 KB, 128 px, any member unless a role switch says otherwise); viewers react; reactions never notify.
  - Why: "those should be configurable; we also need custom workspace emoji, everyone is using that."
  - Rejected: six fixed everywhere (Tasks 88, amended); workspace-set rows.
- **C2-10 · Presence: green = reachable now; grey shapes for away, do not disturb and Focusing; statuses with presets and your own; shown where you'd message someone and on Home** → CV-17 (CH9, CH28a–CH28d, CH42, CH45, CH47, CH48, CH70)
  - Who: Maciej, 2026-10-13.
  - Decision: outline = away without a time, thick bar = do not disturb, target = focusing ("until" only with a Pomodoro phase or an estimate; the task title only with an opt-in and to people who can see it), nothing = offline; one status for all your workspaces; a "Show me as online" switch; one Team widget on Home with Chat's "now" line.
  - Why: "can I reach them now?" is the one question a dot answers; "green in chat, white elsewhere" leaned toward surveillance.
  - Rejected: grey or white for "here"; per-workspace statuses; "Away since"; two per-person widgets.
- **C2-11 · Chat knows the work: Make a task through the capture with "From:", "Mentioned in" lines, decisions on items, a typed handle becomes a chip, ⌘7 needs a destination** → CV-10, CV-14 (CH10, CH11, CH13, CH52, CH65, CH66)
  - Who: Maciej, 2026-10-13.
  - Decision: `T` opens the capture with the message as the From chip and the linked project as destination; one "Mentioned in Acme · Oct 12" line per conversation on an item, readers only; decisions show on linked or mentioned items to the conversation's readers, even from a direct message; `MOD-142` becomes a live chip as you type; the Message capture picks a destination, recent first, with "Sent to … · Open · Undo".
  - Why: the connection the brief sells; a last-conversation default would send a message to the wrong client.
  - Rejected: v1's silent Inbox task; a "Discuss in chat" button on items; handles only through `@`.
- **C2-12 · Channels: managers add to private channels; public → private once; delete into Recently deleted for 30 days; removal is a quiet line; announcement channels pass "Reply privately"; former members keep their name** → CV-15 (CH23a, CH36, CH50, CH58–CH62)
  - Who: Maciej, 2026-10-13.
  - Decision: as listed; a post in an announcement channel pings everyone once and never breaks through a hold.
  - Why: the states people hit in their first weeks each need one answer; a deleted channel must be recoverable.
  - Rejected: archive only; "Seen by N" and scheduled posts (for now); replies in an announcement stream.
- **C2-13 · Offline sends wait and send themselves; ⌘J retires** → CV-3, CV-19 (CH63, CH64)
  - Who: Maciej, 2026-10-13.
  - Decision: "Waiting to send", in order, with Retry only on a refusal; conversations are found in ⌘K.
  - Why: matches Tasks' queued captures; one search for the app.
  - Rejected: fail at once; a disabled composer; ⌘K filtered to conversations.
- **C2-14 · The hackathon: no event workspace; dated Team plans per team; event news outside Moduo; a stop-gap if the date comes first** → CV-4 and the hackathon plan (CH20–CH22, CH67–CH69, CH26a)
  - Who: Maciej, 2026-10-13.
  - Decision: each team in its own workspace on a dated Team plan handed out by organizers; organizer news by email and venue screens for the first event; if server push or uploads aren't on prod by the date, notices only from an open app or tab and files as task attachments or links; the build order is chat in handed-out workspaces → pings that leave the app → the new look → files → links and make a task → Catch up → replies.
  - Why: "no event workspace necessary, just team plans handed out to teams"; about 100 people, PL + EN, the app stays English.
  - Rejected: an event workspace (C), Discord for the event (D), a help desk (CH24, parked), a chat-only grant.
- **C2-15 · Agents post as their creator "via <key>"; keys may read private channels only with a per-key switch (a column on the key); direct messages never** → CV-21 (CH18)
  - Who: Maciej, 2026-10-13.
  - Decision: as stated; guests wait for one app-wide model after the hackathon (CH19).
  - Why: delegates that name their person read honestly; the other person in a DM never agreed to an app reading it.
  - Rejected: the "App" badge and null author; a chat-only guest.

**Technical decisions (the agent, 2026-10-13/14; REPLAN §6 and round 3; the rejected alternative on each)**

- **C2-16 · v1's data shape stays; nothing is renamed** → CV-1 (§6 #1; round-3 §2.1)
  - Decision: the five tables, every write a `chat_op_*`, reactions and chain rollups on the row, soft deletes; `parent_id` means the chain's root, `starred` is "Pin to sidebar".
  - Why: sound, and a rename breaks every function body and the deployed connector for nothing a person sees.
  - Rejected: rebuilding the tables; child tables for reactions; renaming columns.
- **C2-17 · A `ChatStore` on the shared store pattern, with a server-stamped `updated_at` and client-minted ids as the idempotency key** → CV-3 (§6 #2; blueprint §3)
  - Decision: device copy of the newest ~500 per conversation, keyset pages by `(created_at, id)`, delta reads, Realtime applied from the event, echo skip, one-write rollback, an outbox, an access check; the v1 send/edit signatures stay one release as wrappers.
  - Why: v1's per-page fetch lost messages at boundaries and after reconnects; every untouched desktop must keep sending through the release.
  - Rejected: a generic sync framework; SQLite WASM; dropping the wrappers at once.
- **C2-18 · Messages are stored as a Markdown subset with `moduo://` references and drawn by a pure parser; one shared editor; v1 bodies converted once** → CV-1, CV-7 (§6 #3, #26)
  - Decision: `format_version`, `body_text`, `search_tsv` by trigger; the tree cached per message; 8,000 stored characters, references included; the conversion idempotent in SQL and round-tripped on the local stack.
  - Why: a title stored in text goes stale; an editor per row can't scroll; a v1 parser kept forever is debt.
  - Rejected: Lexical JSON; server HTML; a TypeScript one-off conversion.
- **C2-19 · References: conversation and message kinds; a message registers only when linked, without a label; ⌘K's Messages come from search** → CV-10 (§6 #4, #15)
  - Why: a registry label would carry message text to readers of the registry.
  - Rejected: a registry row per message.
- **C2-20 · Spine links: one `conversation-of` row mirrors the channel's link column; one `mentions` row per conversation and item, kept as history; every chat row outside the chat tables follows the conversation's read rule** → CV-1, CV-10, CV-13 (§6 #5; round-3 §2.21, §2.25 a)
  - Why: "at most one link" needs a column; a link per message is noise; a private conversation's existence must never show through the spine.
  - Rejected: `entity_links` alone; recounting mentions on every edit.
- **C2-21 · Notifications through TV-D12's pipeline: the fan-out in the send op, a per-person Catch up table with bell twins, one gate (send · hold · drop), push at once by a kick trigger, `user_clients` decides which device rings, the email as a 5-minute job through TX-3's outbox** → CV-5, CV-6, CV-18 (§6 #6, #23; round-3 §2.14, §2.15)
  - Why: one sender for the app; a client can't decide holds; a 5-second cron would mostly run empty; cancelling a queued email on read races the worker.
  - Rejected: a chat-only notifier; polling; deriving Catch up from the bell; queueing the email at send.
- **C2-22 · Search: `simple` + an immutable `unaccent` wrapper, a stored `tsvector` with a GIN index, one `chat_search` for ⌘K, the conversation and MCP** → CV-1, CV-19 (§6 #7)
  - Why: Polish has no built-in configuration and v1 scanned the table.
  - Rejected: substring match; `pg_trgm` now; PGroonga; an external engine; on-device search.
- **C2-23 · Panel and capture registries: Details · Reply chains · Files (⌥1–3) and the items chain · person · message in context · reference; the Message capture type** → CV-8, CV-10 (§6 #8)
  - Why: SH-1's registry is the one panel mechanism; Catch up's "message in context" is an item like a task, so the back arrow works.
  - Rejected: chat-only panel modes; a Catch-up-only panel mode.
- **C2-24 · General on the server; leaving is a stamp; delete with Undo and a blanking job; PERM-7 made honest with new ops for managers, the announcement switch, make private, delete and restore** → CV-2, CV-15 (§6 #9–#11, #27)
  - Why: a per-device flag missed people who never opened Chat; Undo is the app's rule (DF-5); v1 promised managers and a switch the server never read.
  - Rejected: the per-device General flag; the confirm toast; two places deciding who may create a channel.
- **C2-25 · Realtime: Postgres Changes for rows with zero requests per message; typing on one private topic per conversation, written only by `chat_op_typing` with the sender from the session; presence display-only; losing access is caught by the store's access check** → CV-1, CV-2, CV-3 (§6 #19; round-3 §2.7)
  - Why: a row RLS stops returning is never delivered; a client-supplied sender could never be trusted.
  - Rejected: client Broadcast with a sender field; full rows over Broadcast; a channel per conversation.
- **C2-26 · The stream is TanStack Virtual (runner-up Legend List 3); Frimousse for emoji; one reaction key format for chat and comments; custom emoji in a private bucket with a poster frame; no end-to-end encryption** → CV-7, CV-20 (§6 #18, #20, #21; round-3 §2.8, §2.9)
  - Why: TanStack Virtual is already in the stack with chat anchoring; one key format keeps chat and comments one component; a poster frame makes "plays on hover only" possible; E2EE would break every server-side feature the calls rely on.
  - Rejected: FlashList (needs react-native-web); emoji-mart; shortcodes as keys; SVG emoji; E2EE (breaks "addressed to you", search, agents, export).
- **C2-27 · Statuses, quiet hours and pausing: `user_statuses` for every workspace, `user_saved_statuses`, quiet hours in the Time & region store, `notices_paused_at` on the membership row, `chat_now` as the one read teammates get (a run seen in the last 3 minutes in any workspace; the task only with the opt-in and visibility)** → CV-17, CV-18 (round-3 §2.10–§2.13)
  - Why: a status is the person's (CH45); the gate must read quiet hours and pauses on the server; teammates need "can I reach them", not the run.
  - Rejected: per-workspace statuses; exposing Focus runs; "Away since".
- **C2-28 · Chains, moving and decisions on the message row: `reply_to_id`, `wrapped_*` + `settled_id`, `reopened_*`, `moved_*`, `decision_*`; Wrap up is a drawing rule; moving writes event lines; a reply moved alone leaves its chain; pins don't move** → CV-12, CV-14, CV-16 (round-3 §2.17–§2.19)
  - Why: one row carries every change through Realtime; Wrap up as a drawing rule keeps unread, search and export untouched.
  - Rejected: a thread table; a decisions table; moving replies into a thread table.
- **C2-29 · Drafts stay on the device (ids only); files upload before the send and are adopted by it; the plan gate reads TX-9b's grant when it exists and falls back to the owner's plan; the conversion gives each self-DM a private note** → CV-3, CV-9, CV-4, CV-1 (round-3 §2.22, §2.25 e, g, §2.6)
  - Why: unsent text on the server is one more thing to erase and export; a conversation isn't a shared item with grants; people's notes must survive the conversion.
  - Rejected: a server drafts table; access to files through `can_access`; deleting notes-to-self.
- **C2-30 · The build: blocks CV-0…CV-23 with the hackathon line after CV-12; one chat migration at a time on the Chat integration branch; live bodies before every redefinition; re-stamped files; the five spikes first; limits, vocabularies, erasure/export, kit additions, copy and accessibility fixed in the spec** → the spec's §Assumptions #22, #29–#36
  - Why: a block must fit one session's context; shared functions are redefined by Tasks blocks too; the Definition-of-Ready fails without the list.
  - Rejected: leaving any of them to the build sessions; a single large data block (round-3's CV-1 was three sessions' worth).
