# Decisions: Chat

Full entries for this area, newest first. The one-line index of every area is [docs/decisions.md](../decisions.md). Add new entries at the top here **and** a one-line pointer in the index. Earlier chat lines (v1 ships as the 7th tab, 2026-10-06; chat + calls become a planned module, 2026-10-02) stay under Billing and Product in the index.

## 2026-10-14 · Chat v2 build — the orchestrator's later choices, and one call from Maciej

Written into the briefs and the runbook after checkpoint 1 (BR-1…BR-4 are further down). BR-5 and BR-6 are the orchestrator's choices, deferred to by Maciej: confirmed for building, revisitable. BR-7 is Maciej's own call.

- **BR-5 · The bell draws chat excerpts in the stored form, in CV-11, and that completes AC13.7** → CV-11 (`briefs/CV-11.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: CV-1's conversion rewrites old bell excerpts to the stored form and marks every chat excerpt `payload.format_version = 2`. CV-11 draws a marked excerpt through the stored-form parser, so a converted `moduo://person/<id>` shows the person's name. Until then the bell prints the raw text, so AC13.7 is complete only when CV-11 lands.
  - Why: no other block draws the bell's chat text with that parser.
  - Rejected: leaving it to CV-23's cleanup (old excerpts would show raw links until then).
- **BR-6 · An op that writes event lines in a person's name keeps its own pace** → CV-14, CV-16 (`briefs/CV-14.md`, `briefs/CV-16.md`)
  - Who: orchestrator's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14 (from CV-2a's review).
  - Decision: the sending limit doesn't count event lines (CV2a-4), so each op that writes them (moving messages, marking a decision) refuses more than a few per 10 seconds per person with `PT429`, the limit's own code, and has a test for it.
  - Why: event lines are left out of the limit so that moving many messages doesn't lock the mover out; the ops therefore hold their own pace.
  - Rejected: counting event lines in the sending limit.
- **BR-7 · The research workspace was converted to v2 on the local stack** → the runbook (`docs/agents/chat-v2-build.md`)
  - Who: Maciej's call, 2026-10-14.
  - Decision: CV-1's conversion migration was applied once to the local stack, so "Chat replan research" (3,032 messages) holds v2 data now. The v1 dump is in the git-ignored `docs/local/chat-v1-fixture/`. The conversion refuses to run again once v2 data exists (CV1-1).
  - Why: the round trip over this workspace had come out clean, and the blocks after CV-1 build against v2 messages.
  - Rejected: keeping it as v1 rows, with the conversion proven only by the rolled-back round trip and `chat_convert.test.sql`.

## 2026-10-14 · CV-4 (chat in handed-out Team workspaces) — the agent's choices (deferred to by Maciej)

One migration (`20261014100400_chat_v2_plan_source.sql`), a drift gate and an API-level spec; see [the record](../build/chat-v2/CV-4.md). Proven in rolled-back transactions, then applied to the local stack. Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable. BR-2 above fixed the lookup's name; these are the rest.

- **CV4-1 · The owner's plan is asked first, and the grant only when the plan doesn't include chat** → CV-4, TX-9b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_workspace_enabled(ws)` is true when the owner's plan ranks Duo or above (v1's rule). Otherwise it asks `plan_grant_effective_tier(ws)`, if that function exists, and is true when the tier ranks Duo or above. With no such function the owner's plan decides, as in v1.
  - Why: every paying workspace keeps v1's answer and cost, and a broken or slow grant function can't take chat away from one (the test proves a failing stub is never called for a Duo owner).
  - Rejected: `greatest(owner rank, grant rank)` in one expression, which always calls the grant function.
- **CV4-2 · A grant function that fails reads as "no grant", with a log warning** → CV-4, TX-9b
  - Who: agent's choice (code review), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the error is caught around the call only, and the warning carries just the error code.
  - Why: the realtime topic rules, v1's unread counts and `isEnabled` ask this function too. An error would break presence and counts in every Free-owner workspace; now only a granted workspace pauses.
  - Rejected: letting the error through (the first version).
- **CV4-3 · The grant function is called by name, guarded by `to_regprocedure`** → CV-4, TX-9b
  - Who: agent's choice (code review), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the call is written plainly inside plpgsql, so the body never needs the function to exist, and it gets a cached plan that is re-planned when the function is replaced (proven in the test).
  - Why: it works in either merge order with TX-9b.
  - Rejected: `EXECUTE` (planned on every call); a placeholder function this migration creates for TX-9b to replace (it would break TX-9b's plain `CREATE FUNCTION` and fix its return type).
- **CV4-4 · The grant's tier is read as text and ranked by `plan_tier_rank`; the grant stays on the server** → CV-4, TX-9b
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a text or an enum tier both work, and an unknown tier ranks 0 (off). `CHAT_PLAN_TIERS` and `planHasChat` keep their behaviour; the client never learns the grant, and the workspace's answer is `ChatRuntime.isEnabled`. A new drift gate ties the tier list to the newest `plan_tier_rank` body and the lookup to the signature `plan_grant_effective_tier(<one uuid>)`, so a changed signature in TX-9b fails a test instead of switching grants off silently.
  - Why: a grant isn't a tier of its own, and TX-9b may return either type.
  - Rejected: fixing the return type here; a client helper `workspaceHasChat(ownerTier, grantTier)` that nothing would call.
- **CV4-5 · AC10.8 is finished by CV-21 and CV-22, not here** → CV-21, CV-22
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: CV-4 proves that reading and search keep working on a paused plan. v1's Conversations widget and v1's connector still refuse when the plan is off; CV-22 (widgets) and CV-21 (MCP tools) finish AC10.8.
  - Why: those surfaces belong to those blocks.
  - Rejected: changing the widget and the connector here.

## 2026-10-14 · CV-2a (message ops v2) — the agent's choices (deferred to by Maciej)

One migration (`20261014150000_chat_v2_core_ops.sql`), proven by `chat_ops.test.sql` (143 checks) and `chat_wrappers.test.sql` (23), and by a parity run of the mentions reader against the client's parser on 23,367 bodies (0 differences); see [the record](../build/chat-v2/CV-2a.md). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, unless marked.

- **CV2a-1 · Mentions are read on the server by a SQL twin of the client's parser** → CV-5, CV-7a, CV-10
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__mentions` walks blocks the way `chat__body_text` does and reads inline text the way the client's `parseInline` does (code spans, escapes, titled references, link targets, emphasis pairing, a reference ending a word). People, teams and `@channel` come from the text, never from a list the client sends.
  - Why: one reading of a message on both sides. The 23,367 bodies were the 3,032 converted research messages, spike 4's cases, 45 hand cases and 20,000 fuzzed strings.
  - Rejected: a regex over the raw text (it counts code and escaped text); trusting the client's list.
- **CV2a-2 · `@channel` without "Mention everyone" is stored as typed, with the flag off and no error** → CV-7a, CV-7b
  - Who: agent's choice (the brief said "stored as plain text"), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the message posts, nobody is pinged, and the composer says why.
  - Why: the brief said to store it as plain text, and the composer tells the sender.
  - Rejected: refusing the send (v1 did); rewriting the text.
- **CV2a-3 · A client-minted id is the idempotency key, and a resent id answers only its author** → CV-3
  - Who: agent's choice (validator round 1 on the `client_id` part), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a resent id returns the stored row to its author, in its conversation, while they can read it; two sends of one id at once collapse to one. Any other use of an existing id is `22023 That message id is already used.` and returns nothing. While the v1 wrappers live, every send also writes `client_id = id`, and the v1 send wrapper uses v1's client id as the message id.
  - Why: v1 screens and old builds match their optimistic row by `client_id`; without it each v1 send showed twice.
  - Rejected: stopping `client_id` at once (CV-23 does it); answering anyone who knows an id.
- **CV2a-4 · Event lines don't count toward the sending limit, and an API key has its own budget** → CV-14, CV-16, CV-21 (and BR-6 above)
  - Who: event lines are the agent's choice (the orchestrator's question); the per-key budget is the orchestrator's choice. Both deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the numbers and `PT429` stay as they were. Event lines are neither limited nor counted. A row with `api_key_id` counts against that key's own budget (new partial index), not its person's. An app row without a key id keeps the workspace's shared apps budget until CV-21 writes `api_key_id`.
  - Why: event lines come from ops (a move's "moved here"), not from a person typing, and a move of many messages must not lock its mover out. One busy app can't silence its person or the workspace's other apps.
  - Rejected: counting every row.
- **CV2a-5 · The v1 signatures stay as wrappers for one release** → CV-23
  - Who: agent's choice (validator and code review on the edit part), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_op_send` (7 arguments), `chat_op_edit` (3, its default dropped) and `chat_op_react` (2, a toggle) convert v1 markup with `chat__v1_to_v2` and call the v2 ops; `chat_op_agent_post` converts and writes v2. The edit wrapper reads the stored row's format: a v1 row's text is converted whole, and a v2 row's text is kept, with only the tokens v1's pickers add turned into references. A v1 message that would grow past 8,000 characters when converted is refused with the count. The 3-argument edit lost its default because a 2-argument call is otherwise ambiguous in SQL and in PostgREST.
  - Why: v1's screens and old desktop builds keep working until `min_build` passes them.
  - Rejected: dropping the 2-argument react wrapper (reactions would fail on old builds); converting an edit's text every time (v1's composer opens an edit with the stored text, so it would be escaped); guessing the format from the text. A v1 emphasis typed during such an edit (`_x_`) stays literal: a loss on v1 screens only.
- **CV2a-6 · Who may delete, undo a delete, pin and edit** → CV-7a, CV-8a
  - Who: agent's choice (spec §12 plus the builder), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: delete is the author while their role can post, or anyone with "Delete others' messages". Undo is whoever deleted it (while they still may) or anyone with that permission, so an author can't undo an admin's delete (new column `deleted_by`). Pin is whoever can post there (managers only in an announcement channel) and holders of "Manage any channel", up to 100 live pins; a pinned message restored after its conversation filled its pins comes back unpinned. Edit is the author while their role still posts.
  - Why: a viewer can't delete even an old message of theirs; reading "who deleted may undo" literally would let an author put back what an admin took down.
  - Rejected: letting the author undo any delete.
- **CV2a-7 · Delete hides at once; Undo lasts 8 seconds in the app and 10 on the server** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: delete sets `deleted_at` and `deleted_by` and keeps the text for Undo. The server takes a restore up to 10 seconds after, and a job that runs every minute (`chat-blank-deleted`) blanks the text, mentions, reactions and pin once that passes. The bell's excerpt of the deleted message is blanked with it, since it is the only text a bell row carries.
  - Why: the extra 2 seconds covers the request in flight.
  - Rejected: none recorded.
- **CV2a-8 · An archived conversation is read-only, and a removed person can't post** → CV-2b, CV-15
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: in an archived conversation there is no sending, editing, reacting or pinning; deleting (and its Undo) still works. A person a manager removed from a public channel can't post, edit or pin there any more (`42501 You were removed from this conversation.`), though they still read it and may react; a person who left on their own posts and is back in. The removed rule starts to apply once CV-2b's `chat_op_remove_member` stamps `removed_by`, and CV-2b's join decides whether a removed person may rejoin.
  - Why: an archived conversation is closed to change; v1 deleted a removed member's row, so a stamp is the only way to tell a removal from leaving.
  - Rejected: v1's edits, reactions and pins in archived channels.
- **CV2a-9 · Replies and chains at the edges** → CV-12
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a reply joins its root's chain (`parent_id` is the root, `reply_to_id` what it quotes). A reply to a deleted message is refused (`P0002`); a reply to a live reply inside a deleted root's chain is taken. Event lines can't be replied to, pinned or reacted to. A reply moves the conversation's `last_message_at`. The chain's counters are recounted on delete and restore, so "N replies" counts live replies. Posting in a public channel joins it, or back (clears `left_at`), as v1 did.
  - Why: replies are stream messages now; the counters can't drift if they are recounted.
  - Rejected: v1's decrement-only counters, which had no restore.
- **CV2a-10 · The bell rings as v1 rang it until CV-5** → CV-5
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: mentioned people, the conversation on `@channel`, the chain's people and the quoted message's author on a reply; only people who can read the conversation, never the sender; teams aren't expanded. The excerpt is the stored form's first 140 characters without half a reference.
  - Why: CV-5 owns the fan-out and replaces this block.
  - Rejected: expanding teams here.
- **CV2a-11 · Activity rows are written only when something changed, with ids only** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: edit, delete, restore, react and pin each write one attributed row (`chat.message_edit`, `chat.message_delete`, `chat.message_restore`, `chat.react`, `chat.pin`) with ids only; a resent react, pin, delete or restore writes none, and neither does a plain send or typing.
  - Why: the activity feed stays about changes (spec #15), and carries no message text.
  - Rejected: a row for every call.

## 2026-10-14 · CV-1 (foundation and conversion) — the agent's choices (deferred to by Maciej)

Two migrations (`20261014100000_chat_v2_foundation.sql`, `20261014100100_chat_v2_convert_v1.sql`) and the contracts; see [the record](../build/chat-v2/CV-1.md). The conversion was proven in a rolled-back round trip: 3,111 bodies in 0.49 s, a second pass that changed no row, and the research workspace's 3,032 messages drawn as v1 drew them (BR-7 says it was then applied). Each choice is the builder's, deferred to by Maciej: confirmed for building, revisitable, unless marked.

- **CV1-1 · The conversion runs once, before the v2 ops, and refuses rather than truncates** → CV-2a, the release train
  - Who: agent's choice (validator round 1), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: it refuses to run once v2 data exists (a v2 `format_version`, a `left_at`, an event line, a quote, a key id, a team mention, a Catch up item that isn't a `level_reset` line, or a chain mute). It also stops before changing anything if a v1 body holds U+0001 or U+0002 (the converter's markers) or would grow past 8,000 characters. Then it runs seven idempotent steps, and the migration file runs it twice and fails unless the second pass changes nothing.
  - Why: the settings steps can't tell a v1 setting from a v2 choice (a late run would reset someone's v2 "Every message"), and nothing may be lost silently.
  - Rejected: per-row v1 markers on memberships; widening the 8,000-character CHECK for converted rows.
- **CV1-2 · The converter and the stripper live in the foundation; the convert file only calls `chat__convert_v1()`** → CV-2a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__v1_to_v2`, `chat__body_text` and friends are in the foundation file.
  - Why: `chat_convert.test.sql` must pass on a stack where the conversion isn't applied, and CV-2a's v1 wrappers need `chat__v1_to_v2`.
  - Rejected: the functions only in the convert file.
- **CV1-3 · `format_version` defaulted to 1 until CV-2a flipped it to 2** → CV-2a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: v1's live ops kept writing v1 text, so the column's default stayed 1 in this block. CV-2a writes 2 explicitly and flipped the default in its own migration, after which the conversion refuses.
  - Why: a default of 2 would have marked v1's rows as converted and the conversion would have skipped them.
  - Rejected: round-3's default of 2 in this block.
- **CV1-4 · One `level_reset` line per person and conversation, none for an archived channel** → CV-5, CV-11
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: people on "Every message" move to "Mentions and replies" and get one Catch up line for each live conversation.
  - Why: the copy names one conversation ("Acme now notifies you…") and its Change opens that conversation's setting; `channel_id` stays NOT NULL.
  - Rejected: one line per person (which conversation would it name?).
- **CV1-5 · How the oddities of v1 convert** → CV-2b, CV-15
  - Who: agent's choice (code review on the last two), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a notes-to-self conversation becomes one private note (each message under a bold `YYYY-MM-DD HH:MM` line in the person's time zone, else `UTC`; deleted messages left out; a person mention reads `@Name` and other references stay `moduo://` URIs; the workspace grant that `share_note_after` adds is removed, so only that person reads it), and the conversation is deleted. An empty one is closed without a note. A DM whose other people left isn't notes to self. `mentions_everyone` is set from `<!channel>` in the v1 text. General is flagged only on a public, unarchived channel named "general", because new members are joined to it.
  - Why: the note must be readable by its person only, and the General flag is what the new-member join keys on.
  - Rejected: leaving `moduo://person/<id>` in the note; flagging whatever is named general.
- **CV1-6 · Bell excerpts: only those holding a v1 token are rewritten, and every chat excerpt is marked `format_version = 2`** → CV-11 (BR-5)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the v1 client writes excerpts as plain text with names filled in, which the converter would only escape. A server-written raw body carries tokens, and only those are converted. The marker makes the step idempotent, since the converter isn't.
  - Why: converting a plain-text excerpt would escape `2*3` and `C:\x`.
  - Rejected: converting every excerpt.
- **CV1-7 · Typing is for the conversation's members only** → CV-8a, the release
  - Who: agent's choice (spec #17, round-3 §2.7), deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: a person who reads a public channel without being in it gets no typing line there, and neither does someone who left. `chat_privacy.test.sql` changed on purpose: its check "C reads the public channel Q's typing topic" now expects 0 and adds that Q's member A reads it. CV-2a's `chat_op_typing` asks for membership too. This changes behaviour on prod for every conversation, so it ships with the v2 client in the same release; the v2 client joins the typing topic only as a member.
  - Why: the typing topic is the conversation's members' (spec #17, round-3 §2.7).
  - Rejected: v1's "anyone who can read it".
- **CV1-8 · The read rule is written out in two functions, with no nested definer calls, and a parity test guards the copy** → CV-19
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_can_read_channel` and `chat__can_read_channel_as` carry the rule written out. It no longer asks the plan; people who left, deleted conversations and deleted workspaces drop out. A parity test compares both with `perm_user_has`.
  - Why: the read policies call it for every row: 3,032 rows read in 406 ms with nested calls and 23–26 ms written out.
  - Rejected: one function calling the other (and `perm_user_has`): the logic stays in one place but costs about 100 µs a row.
- **CV1-9 · A link with a conversation or a message at either end is hidden from people who can't read it** → CV-10
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the links read rule checks both ends.
  - Why: a link from a task to a private message must not reveal that message.
  - Rejected: checking the source only (round-3's wording).
- **CV1-10 · Catch up rows are the person's own and aren't gated on the conversation's read rule** → CV-5, CV-11
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_catchup` is own-rows only. Items carry ids only, and CV-11 closes items when access goes.
  - Why: a "removed" line has to reach the person who can no longer read the conversation.
  - Rejected: gating items on the read rule, which would hide that line.
- **CV1-11 · The name check is added `NOT VALID`** → CV-23
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat_channels_name_trimmed` checks new and changed names, and existing v1 names aren't re-scanned at release. CV-23 validates it once prod has no untrimmed name.
  - Why: one untrimmed name on prod would roll the whole foundation back.
  - Rejected: validating at once.
- **CV1-12 · The body parser's look-aheads are bounded** → CV-2a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `chat__inline_text` shares a budget of 2 × the length + 1,000 characters across its look-aheads, and pairs emphasis markers in two linear passes. Past the budget an unclosed backtick run or a `](` reads as text.
  - Why: it runs on every message write, and a plpgsql character loop is about 100 times slower than the same loop in JavaScript: an 8,000-character body now takes up to about 70 ms (one took 4.4 s before).
  - Rejected: the client's unbounded scans, which are fast in JavaScript and slow in plpgsql. Only extreme text reads differently from the client now.

## 2026-10-14 · CV-0 spike 1 (the message list in the real webviews) — the agent's choices (deferred to by Maciej)

Measured with the harness in `scripts/spikes/chat/s1/` (nothing in `src/`), in Chromium 153 and in WebKit through a plain WKWebView host, React Compiler on; see [the spike's record](../build/chat-v2/CV-0-S1.md) for the table. **Verdict: TanStack Virtual stays (decision #16 holds).** Every bar the harness can measure passes in both engines. Not measured yet: the Tauri window itself and real trackpad momentum (both are in the checklist). Each choice is the spike builder's, deferred to by Maciej: confirmed for building, revisitable.

- **S1-1 · TanStack Virtual runs the stream, with four settings** → CV-7a (`scripts/spikes/chat/s1/harness/tanstack-stream.tsx`)
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `@tanstack/react-virtual` 3.14 with `anchorTo: 'end'` and `followOnAppend`, plus `useFlushSync: true`, the size-change rule (S1-3), `contain: layout style` on each row and the density re-anchor (S1-5). Result: 0 px of drift over 10 × 10 prepends, folds, edits above the viewport, arrivals and density switches; jumps land within 0.03 px; no frame over 18 ms in a 2-second fling; at most 200 elements in the stream.
  - Why: it passes every bar in both engines, uses 7.5 times less DOM than Legend List, and is already in the bundle. Without `contain: layout style` WebKit lays out the whole stream on every frame (19 fps, 233 ms frames).
  - Rejected: Legend List 3.6.0 (it fails the prepend bar in WebKit by 3.38 px in 5 of 5 runs, keeps about 1,510 elements and brings its own scroller); a custom list.
- **S1-2 · `useFlushSync: true`** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: TanStack writes the scroll correction and the new row positions in the same frame.
  - Why: with `false` the correction paints a frame before the rows move: flashes of 221–262 px in Chromium and 124 ms frames in WebKit.
  - Rejected: VirtualStack's `false` (Tasks). React 19 warns about `flushSync` inside effects; none appeared in these runs.
- **S1-3 · Every size change that lies wholly above the viewport is compensated** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `shouldAdjustScrollPositionOnItemSizeChange` returns true when the item ends at or above the viewport's top.
  - Why: TanStack's default skips re-measures while scrolling backward, which is when edits, reactions and late images land above the reader (a 176 px jump).
  - Rejected: the default; pre-measuring rows off screen before inserting them (7–28 ms per 50 rows, and unneeded once `flushSync` is on).
- **S1-4 · Rows carry the message before the window, and keys are stable** → CV-3, CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: rows are built with the message just before the window (read, not drawn): it decides the top row's grouping and whether a day separator sits above it. Keys are the message id, `d:YYYY-MM-DD` for a day separator and `c:<root id>` for a folded chain. A prepend then never changes a row already drawn.
  - Why: otherwise the reader's row is re-keyed and no longer drawn in 5 of 10 prepends, and most others jump 28–668 px.
  - Rejected: the top row always starting a group under a separator.
- **S1-5 · Density, font loading and width changes use a synchronous re-anchor** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: take the first message row wholly in view and its offset, switch, remeasure every drawn row, set the scroll position and the virtualizer's offset, and flush a render, all in one task (`setDensityAnchored`).
  - Why: it holds the reader's row at 0–1 px; TanStack alone moves 4 px (40 px with `flushSync` off).
  - Rejected: TanStack alone; `measure()` alone (rows above fall back to estimates and the view jumps).
- **S1-6 · A jump loads a window and remounts the stream** → CV-3, CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the window is `[target − 100, target + 100]`, a new stream keyed by the window, with `scrollToIndex(i, { align: 'center' })` in a layout effect on mount. It lands in the first painted frame.
  - Why: the list holds about 200 rows, not the whole history.
  - Rejected: keeping all 10,000 rows (it also lands, within 0.03 px, but holds the whole history).
- **S1-7 · Image boxes are sized by CSS from the stored size** → CV-9
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: the box takes `--w` and `--h` custom properties, capped at 360 × 240, with `object-fit: cover`.
  - Why: Tailwind's preflight sets `img { height: auto }`, so with attributes alone the decoded preview's own ratio takes over (a 0.5 px change per image).
  - Rejected: `width` and `height` attributes alone.
- **S1-8 · The stream file opts out of the React Compiler, and nothing else does** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `"use no memo"` in the stream file only (confirmed in the dev bundle); the rows stay compiled and take only their row object.
  - Why: the compiler caches `getVirtualItems()`, read from TanStack's mutable virtualizer (the TV-D11b trap in `docs/gotchas/ui.md`). Not re-measured here.
  - Rejected: compiling the stream file.
- **S1-9 · The sticky day header comes from `rangeExtractor`** → CV-7a
  - Who: agent's choice, deferred to by Maciej: confirmed for building, revisitable, 2026-10-14.
  - Decision: `rangeExtractor` keeps the active separator drawn, with `position: sticky; top: 0`. It is up to one stale frame at a crossing in Chromium and none in WebKit; if that shows, update the label imperatively in the scroll handler.
  - Why: it is VirtualStack's pattern, and it works in both engines.
  - Rejected for now: `directDomUpdates`, which writes a transform onto the stuck header.

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
